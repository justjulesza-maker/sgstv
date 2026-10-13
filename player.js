/* One player interface over Bunny Stream, Cloudflare Stream (VOD + live), YouTube and Vimeo.
   FF.mountPlayer(el, src) -> { state(): 'playing' | 'paused' | 'idle' | 'unknown' }
   'unknown' = the provider never confirmed it can report play/pause (earns at a reduced rate). */
(function () {
  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
  const iframe = (src) => {
    const f = document.createElement('iframe');
    f.src = src; f.allow = 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true; f.setAttribute('frameborder', '0');
    f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0';
    return f;
  };

  window.FF = window.FF || {};
  FF.mountPlayer = function (el, src) {
    let st = 'idle', ready = false;
    const markReady = () => { ready = true; if (st === 'unknown') st = 'paused'; };
    const on = (s) => { ready = true; st = s; };
    el.innerHTML = '';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; // never undo an absolute holder (that collapsed it to 0px tall)
    const id = encodeURIComponent(src.sourceId || '');

    // If the provider never says it is ready, fall back to 'unknown' (counts only while tab is visible).
    setTimeout(() => { if (!ready) st = 'unknown'; }, 20000);

    if (src.type === 'youtube') {
      const div = document.createElement('div'); el.appendChild(div);
      const make = () => new YT.Player(div, {
        videoId: src.sourceId, width: '100%', height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: (e) => { markReady(); const f = e.target.getIframe(); f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; },
          onStateChange: (e) => on(e.data === 1 || e.data === 3 ? 'playing' : 'paused'),
        },
      });
      if (window.YT && YT.Player) make();
      else {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { prev && prev(); make(); };
        loadScript('https://www.youtube.com/iframe_api').catch(() => {});
      }
    } else if (src.type === 'vimeo') {
      const f = iframe(`https://player.vimeo.com/video/${id}?dnt=1&title=0&byline=0`); el.appendChild(f);
      loadScript('https://player.vimeo.com/api/player.js').then(() => {
        const p = new Vimeo.Player(f);
        p.ready().then(markReady);
        p.on('play', () => on('playing')); p.on('pause', () => on('paused')); p.on('ended', () => on('paused'));
      }).catch(() => {});
    } else if (src.type === 'cloudflare') {
      const host = src.cfCustomerCode ? `https://customer-${encodeURIComponent(src.cfCustomerCode)}.cloudflarestream.com/${id}/iframe` : `https://iframe.videodelivery.net/${id}`;
      const f = iframe(host); el.appendChild(f);
      loadScript('https://embed.cloudflarestream.com/embed/sdk.latest.js').then(() => {
        const p = window.Stream(f);
        markReady();
        p.addEventListener('play', () => on('playing')); p.addEventListener('playing', () => on('playing'));
        p.addEventListener('pause', () => on('paused')); p.addEventListener('ended', () => on('paused'));
        p.addEventListener('waiting', () => {}); // buffering keeps last state
      }).catch(() => {});
    } else if (src.type === 'bunny') {
      const lib = encodeURIComponent(src.bunnyLibraryId || '');
      const f = iframe(`https://iframe.mediadelivery.net/embed/${lib}/${id}?autoplay=false&preload=true&responsive=true`); el.appendChild(f);
      // Bunny's player speaks the open player.js postMessage protocol.
      const send = (method, value) => { try { f.contentWindow.postMessage(JSON.stringify({ context: 'player.js', version: '0.0.11', method, value, listener: value }), '*'); } catch (e) {} };
      window.addEventListener('message', (e) => {
        if (e.source !== f.contentWindow) return;
        let d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { return; } }
        if (!d || d.context !== 'player.js') return;
        if (d.event === 'ready') { markReady(); ['play', 'pause', 'ended'].forEach((ev) => send('addEventListener', ev)); }
        else if (d.event === 'play') on('playing');
        else if (d.event === 'pause' || d.event === 'ended') on('paused');
      });
    } else {
      el.innerHTML = '<div class="empty" style="position:absolute;inset:0;display:grid;place-items:center">Video source not set</div>';
    }
    return { state: () => st };
  };
})();
