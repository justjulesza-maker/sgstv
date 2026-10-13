/* Flying Fish — Surprisingly Good Sets: shared front-end */
(function () {
  const FF = (window.FF = {});
  firebase.initializeApp(window.FF_CONFIG.firebase);
  FF.auth = firebase.auth();
  FF.db = firebase.firestore();
  FF.ts = firebase.firestore.FieldValue.serverTimestamp;
  FF.user = null;      // firebase user
  FF.profile = null;   // server profile {name, points, verified, unlocks, ...}
  FF.rules = {};
  FF.isAdmin = false;
  FF.site = {
    name: 'Surprisingly Good Sets', tagline: 'Sets you didn’t see coming.', logoUrl: '',
    bg: '#071526', brand: '#ffd23f', accent: '#29d3c3', pointsName: 'Fish Points',
    legalLine: 'Not for sale to persons under the age of 18. Enjoy responsibly.',
    footerText: '', privacyUrl: '', termsUrl: '',
    baseEmojis: ['🔥', '🙌', '💃', '🐟', '🍋', '❤️'],
    emojiPacks: [],
  };
  const listeners = [];
  FF.onReady = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  // ---------- utils ----------
  FF.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  FF.qs = (k) => new URLSearchParams(location.search).get(k);
  FF.$ = (sel, el = document) => el.querySelector(sel);
  FF.fmt = (n) => Number(n || 0).toLocaleString('en-ZA');
  FF.ms = (v) => (v && v.toMillis ? v.toMillis() : typeof v === 'number' ? v : v ? new Date(v).getTime() : 0);
  FF.when = (v) => { const t = FF.ms(v); return t ? new Date(t).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };

  const ERRORS = {
    sign_in_required: 'Please sign in first.', profile_required: 'Finish setting up your profile first.',
    under_18: 'Sorry — you must be 18 or older to join.', consent_required: 'Please accept the terms to continue.',
    bad_dob: 'Please enter a valid date of birth.', bad_name: 'Display name must be 2–30 characters.',
    redemptions_closed: 'Redemptions open soon.', prizes_closed: 'Prize redemptions aren’t open yet.',
    not_enough_points: 'Not enough points yet.', out_of_stock: 'That reward is out of stock.',
    already_unlocked: 'You already have this.', phone_required: 'Add a phone number so we can arrange your prize.',
    locked: 'This one is locked.', retry: 'Something changed — please try again.', server_not_configured: 'Server not configured yet (missing Netlify env vars).',
    bad_private_key: 'Server key problem: FIREBASE_PRIVATE_KEY on Netlify is not a valid key.',
    slow_down: 'Hang on a minute before asking for another link.', bad_email: 'Enter a valid email.',
    domain_not_authorized: 'This web address isn’t authorised in Firebase yet (Authentication → Settings → Authorized domains).',
    email_link_disabled: 'Email-link sign-in is switched off in Firebase.', email_send_failed: 'Couldn’t send the email — check the Resend settings.',
    'auth/quota-exceeded': 'Too many sign-in emails today — please try again tomorrow.',
    playlist_not_found: 'Playlist not found — is it public?', bad_playlist: 'That doesn’t look like a playlist link or ID.', youtube_unavailable: 'YouTube didn’t answer — try again in a minute.',
    image_too_large: 'That image is still too big after compressing — try a smaller one.', bad_image: 'That file isn’t a usable image or font (PNG, JPG, WebP, WOFF2, WOFF, TTF, OTF).', not_admin: 'Admins only.',
    bad_client_email_or_key: 'Server key problem: FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY don’t match.',
  };
  FF.errText = (e) => (ERRORS[e && e.code] || (e && e.message) || 'Something went wrong.') + (e && e.detail ? ' — ' + e.detail : '');

  FF.call = async (action, data = {}) => {
    const u = FF.auth.currentUser;
    const token = u ? await u.getIdToken() : null;
    const r = await fetch('/.netlify/functions/ff', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
      body: JSON.stringify(Object.assign({ action }, data)),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'request_failed'); e.code = j.error; e.detail = j.detail; throw e; }
    return j;
  };

  FF.toast = (msg, ms = 3200) => {
    let box = FF.$('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.remove(), ms);
  };
  FF.earned = (n, why) => {
    if (!n) return;
    FF.toast(`+${n} ${FF.site.pointsName}${why ? ' · ' + why : ''}`);
    const p = FF.$('#ff-points'); if (p) { p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
  };

  FF.modal = (html) => {
    const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="box">${html}</div>`;
    document.body.appendChild(m);
    m.close = () => m.remove();
    return m;
  };

  // ---------- site config ----------
  async function loadSite() {
    try {
      const d = await FF.db.doc('config/site').get();
      if (d.exists) Object.assign(FF.site, d.data());
    } catch (e) { console.warn('site config', e); }
    try { const r = await FF.db.doc('config/rewards').get(); FF.rules = r.exists ? r.data() : {}; } catch (e) { FF.rules = {}; }
    const s = document.documentElement.style;
    applyFonts();
    if (FF.site.bg) s.setProperty('--bg', FF.site.bg);
    if (FF.site.brand) s.setProperty('--brand', FF.site.brand);
    if (FF.site.accent) s.setProperty('--accent', FF.site.accent);
    if (FF.site.bg) {
      s.setProperty('--surface', `color-mix(in srgb, ${FF.site.bg} 82%, #ffffff 8%)`);
      s.setProperty('--surface-2', `color-mix(in srgb, ${FF.site.bg} 70%, #ffffff 14%)`);
    }
  }

  // Licensed fonts uploaded in the admin override the free stand-ins.
  const FONT_SLOTS = { fontDisplayUrl: ['FF Display', '--display', "Georgia, serif"], fontHeadingUrl: ['FF Heading', '--heading', 'system-ui, sans-serif'], fontBodyUrl: ['FF Body', '--body', 'system-ui, sans-serif'] };
  const FORMATS = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
  function applyFonts() {
    let css = '';
    for (const k of Object.keys(FONT_SLOTS)) {
      const url = FF.site[k]; if (!url) continue;
      const [fam, v, fallback] = FONT_SLOTS[k];
      const ext = (/\.(woff2|woff|ttf|otf)(\?|$)/i.exec(url) || [])[1];
      const safe = String(url).replace(/["\\\n]/g, '');
      css += `@font-face{font-family:"${fam}";src:url("${safe}")${ext ? ` format("${FORMATS[ext.toLowerCase()]}")` : ''};font-weight:100 900;font-style:normal;font-display:swap}`;
      document.documentElement.style.setProperty(v, `"${fam}", ${fallback}`);
    }
    if (!css) return;
    let st = document.getElementById('ff-fonts');
    if (!st) { st = document.createElement('style'); st.id = 'ff-fonts'; document.head.appendChild(st); }
    st.textContent = css;
  }

  // Raw file upload (fonts) — no resizing.
  FF.uploadFile = async (file, kind) => {
    if (file.size > 3 * 1024 * 1024) throw new Error('Font file is over 3 MB — use the .woff2 version.');
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(file); });
    return (await FF.call('upload', { data, kind })).url;
  };

  // ---------- chrome ----------
  function renderHeader() {
    const el = FF.$('#ff-header'); if (!el) return;
    const page = document.body.dataset.page || '';
    const logo = FF.site.logoUrl ? `<img src="${FF.esc(FF.site.logoUrl)}" alt="">` : '';
    el.className = 'ff-header';
    el.innerHTML = `<div class="wrap">
      <a class="ff-brand" href="/" aria-label="${FF.esc(FF.site.name)}">${logo}<span class="${logo && !FF.site.showNameWithLogo ? 'sr-only' : ''}">${FF.esc(FF.site.name)}</span></a>
      <nav class="ff-nav">
        <a href="/" class="${page === 'home' ? 'on' : ''}">Home</a>
        <a href="/#channels" class="">Shows</a>
        <a href="/rewards.html" class="${page === 'rewards' ? 'on' : ''}">Rewards</a>
      </nav>
      <div class="ff-right" id="ff-account"></div></div>`;
    renderAccount();
  }
  function renderAccount() {
    const el = FF.$('#ff-account'); if (!el) return;
    if (FF.profile && FF.profile.verified) {
      el.innerHTML = `<a class="pill" id="ff-points" href="/rewards.html" title="${FF.esc(FF.site.pointsName)}"><span class="coin"></span><span>${FF.fmt(FF.profile.points)}</span></a>
        <button class="btn ghost small" id="ff-out">Sign out</button>`;
      FF.$('#ff-out').onclick = () => FF.auth.signOut().then(() => location.reload());
    } else if (FF.user) {
      el.innerHTML = `<button class="btn small" id="ff-finish">Finish sign-up</button>`;
      FF.$('#ff-finish').onclick = profileModal;
    } else {
      el.innerHTML = `<button class="btn small" id="ff-in">Sign in · earn ${FF.esc(FF.site.pointsName)}</button>`;
      FF.$('#ff-in').onclick = () => FF.signIn();
    }
  }
  function renderFooter() {
    const el = FF.$('#ff-footer'); if (!el) return;
    el.className = 'ff-footer';
    const links = [FF.site.privacyUrl && `<a href="${FF.esc(FF.site.privacyUrl)}" target="_blank" rel="noopener">Privacy</a>`,
      FF.site.termsUrl && `<a href="${FF.esc(FF.site.termsUrl)}" target="_blank" rel="noopener">Rewards terms</a>`].filter(Boolean).join(' · ');
    el.innerHTML = `<div class="wrap"><div class="legal">${FF.esc(FF.site.legalLine)}</div>
      <div>${FF.esc(FF.site.footerText)}</div><div style="margin-top:8px">${links}</div></div>`;
  }

  // ---------- age gate (all visitors) ----------
  function ageGate() {
    let ok = null; try { ok = localStorage.getItem('ff_age_ok'); } catch (e) {}
    if (ok === '1') return;
    const m = FF.modal(`<h3>Are you 18 or older?</h3>
      <p class="muted">You must be of legal drinking age to enter this site.</p>
      <label>Date of birth</label><input type="date" id="ag-dob" max="${new Date().toISOString().slice(0, 10)}">
      <div class="err" id="ag-err"></div>
      <div class="row"><button class="btn" id="ag-go">Enter</button></div>`);
    FF.$('#ag-go', m).onclick = () => {
      const age = ageFrom(FF.$('#ag-dob', m).value);
      if (age < 0) { FF.$('#ag-err', m).textContent = 'Please enter your date of birth.'; return; }
      if (age < 18) { m.querySelector('.box').innerHTML = '<h3>Sorry</h3><p class="muted">You need to be 18 or older to visit this site.</p>'; return; }
      try { localStorage.setItem('ff_age_ok', '1'); } catch (e) {}
      m.close();
    };
  }
  function ageFrom(dob) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || ''); if (!m) return -1;
    const d = new Date(); let a = d.getFullYear() - +m[1];
    if (d.getMonth() + 1 < +m[2] || (d.getMonth() + 1 === +m[2] && d.getDate() < +m[3])) a--;
    return a;
  }

  // ---------- sign in (email link, no passwords) ----------
  FF.signIn = (reason) => {
    const m = FF.modal(`<h3>Sign in</h3>
      <p class="muted">${FF.esc(reason || `Join to chat, react and earn ${FF.site.pointsName}.`)} We’ll email you a sign-in link — no password needed.</p>
      <label>Email</label><input type="email" id="si-email" autocomplete="email" placeholder="you@example.com">
      <div class="err" id="si-err"></div>
      <div class="row"><button class="btn" id="si-go">Email me a link</button><button class="btn ghost" id="si-x">Cancel</button></div>`);
    FF.$('#si-x', m).onclick = m.close;
    FF.$('#si-go', m).onclick = async () => {
      const email = FF.$('#si-email', m).value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { FF.$('#si-err', m).textContent = 'Enter a valid email.'; return; }
      FF.$('#si-go', m).disabled = true;
      try {
        const continueUrl = location.href.split('#')[0];
        // Our server sends a branded email via Resend; if that isn't configured, fall back to Firebase's own email.
        const r = await FF.call('sendLink', { email, continueUrl });
        if (!r.sent) await FF.auth.sendSignInLinkToEmail(email, { url: continueUrl, handleCodeInApp: true });
        try { localStorage.setItem('ff_signin_email', email); } catch (e) {}
        m.querySelector('.box').innerHTML = `<h3>Check your inbox</h3><p class="muted">We sent a sign-in link to <b>${FF.esc(email)}</b>. Open it on this device.</p><div class="row"><button class="btn" id="si-ok">OK</button></div>`;
        FF.$('#si-ok', m).onclick = m.close;
      } catch (e) {
        FF.$('#si-go', m).disabled = false; FF.$('#si-err', m).textContent = FF.errText(e) || 'Could not send link.';
      }
    };
  };
  async function completeEmailLink() {
    if (!FF.auth.isSignInWithEmailLink(location.href)) return;
    let email = null; try { email = localStorage.getItem('ff_signin_email'); } catch (e) {}
    if (!email) email = prompt('Confirm your email to finish signing in');
    if (!email) return;
    try {
      await FF.auth.signInWithEmailLink(email, location.href);
      try { localStorage.removeItem('ff_signin_email'); } catch (e) {}
    } catch (e) { FF.toast('That sign-in link has expired — please request a new one.', 5000); }
    const u = new URL(location.href);
    ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl'].forEach((k) => u.searchParams.delete(k));
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  }

  // ---------- profile (age-verified registration) ----------
  function profileModal() {
    const m = FF.modal(`<h3>Set up your profile</h3>
      <p class="muted">Your display name shows in chat and on the leaderboard.</p>
      <label>Display name</label><input id="pf-name" maxlength="30">
      <label>Date of birth</label><input type="date" id="pf-dob" max="${new Date().toISOString().slice(0, 10)}">
      <label class="check"><input type="checkbox" id="pf-consent"> <span>I’m 18 or older and agree to the ${FF.site.termsUrl ? `<a href="${FF.esc(FF.site.termsUrl)}" target="_blank" rel="noopener"><u>terms</u></a>` : 'terms'} and ${FF.site.privacyUrl ? `<a href="${FF.esc(FF.site.privacyUrl)}" target="_blank" rel="noopener"><u>privacy policy</u></a>` : 'privacy policy'}.</span></label>
      <label class="check"><input type="checkbox" id="pf-mkt"> <span>Send me news about upcoming shows and rewards (optional).</span></label>
      <div class="err" id="pf-err"></div>
      <div class="row"><button class="btn" id="pf-go">Join</button><button class="btn ghost" id="pf-x">Later</button></div>`);
    FF.$('#pf-x', m).onclick = m.close;
    FF.$('#pf-go', m).onclick = async () => {
      FF.$('#pf-go', m).disabled = true; FF.$('#pf-err', m).textContent = '';
      try {
        const r = await FF.call('profile', { name: FF.$('#pf-name', m).value, dob: FF.$('#pf-dob', m).value,
          consent: FF.$('#pf-consent', m).checked, marketing: FF.$('#pf-mkt', m).checked });
        m.close();
        await refreshMe();
        document.dispatchEvent(new CustomEvent('ff:auth'));
        if (r.awarded) FF.earned(r.awarded, 'welcome bonus');
        claimDaily();
      } catch (e) {
        FF.$('#pf-go', m).disabled = false; FF.$('#pf-err', m).textContent = FF.errText(e);
        if (e.code === 'under_18') { FF.$('#pf-go', m).remove(); FF.auth.signOut(); }
      }
    };
  }
  FF.requireProfile = (reason) => {
    if (!FF.user) { FF.signIn(reason); return false; }
    if (!FF.profile || !FF.profile.verified) { profileModal(); return false; }
    return true;
  };

  let userUnsub = null;
  async function refreshMe() {
    const r = await FF.call('me');
    FF.profile = r.profile; FF.rules = r.rules || FF.rules; FF.isAdmin = !!r.isAdmin;
    renderAccount();
    if (userUnsub) userUnsub();
    if (FF.profile && FF.profile.verified) {
      userUnsub = FF.db.doc('users/' + FF.user.uid).onSnapshot((d) => {
        if (!d.exists) return;
        const x = d.data();
        Object.assign(FF.profile, { points: x.points || 0, lifetime: x.lifetime || 0, streak: x.streak || 0, unlocks: x.unlocks || [] });
        const p = FF.$('#ff-points span:last-child'); if (p) p.textContent = FF.fmt(FF.profile.points);
        document.dispatchEvent(new CustomEvent('ff:profile'));
      });
    }
  }
  async function claimDaily() {
    try {
      const d = await FF.call('daily');
      if (d.awarded) FF.earned(d.awarded, d.streak > 1 ? `${d.streak}-day streak` : 'daily visit');
    } catch (e) { /* not fatal */ }
  }

  // ---------- backgrounds ----------
  // strength: 'light' (home), 'medium' (show pages), 'heavy' (watch/rewards — content first)
  FF.setBackdrop = (url, strength = 'medium') => {
    let el = document.querySelector('.ff-backdrop');
    if (!url) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'ff-backdrop'; document.body.prepend(el); }
    const shade = { light: [25, 65], medium: [45, 78], heavy: [72, 88] }[strength] || [45, 78];
    el.style.setProperty('--shade-top', shade[0] + '%');
    el.style.setProperty('--shade-mid', shade[1] + '%');
    el.style.backgroundImage = `url("${String(url).replace(/["\\\n]/g, '')}")`;
  };

  // ---------- image upload (admin) ----------
  // Resizes in the browser so a 12 MB phone photo becomes a ~200 KB WebP before it leaves the device.
  FF.uploadImage = async (file, { max = 1200, kind = 'image' } = {}) => {
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) throw Object.assign(new Error('Use a PNG, JPG, WebP or SVG image.'), {});
    const src = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image.')); i.src = src; });
      let w = img.naturalWidth || 1200, h = img.naturalHeight || 800;
      const scale = Math.min(1, max / Math.max(w, h)); w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const toBlob = (type, q) => new Promise((res) => c.toBlob(res, type, q));
      let blob = await toBlob('image/webp', 0.84);
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(kind === 'bg' ? 'image/jpeg' : 'image/png', 0.85); // older Safari
      const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
      const out = await FF.call('upload', { data, kind });
      return out.url;
    } finally { URL.revokeObjectURL(src); }
  };

  // ---------- media helpers ----------
  FF.thumbHtml = (v, ch) => {
    let img = v.thumb || '';
    if (!img && v.type === 'youtube' && v.sourceId) img = `https://i.ytimg.com/vi/${encodeURIComponent(v.sourceId)}/hqdefault.jpg`;
    const color = (ch && ch.color) || '';
    const inner = img ? `<img class="cover" src="${FF.esc(img)}" alt="" loading="lazy">`
      : ch && ch.logoUrl ? `<img class="logo" src="${FF.esc(ch.logoUrl)}" alt="">` : '';
    const badge = v.isLive ? '<span class="badge live">● LIVE</span>'
      : v.scheduledAt && FF.ms(v.scheduledAt) > Date.now() ? `<span class="badge">${FF.esc(FF.when(v.scheduledAt))}</span>` : '';
    const lock = v.locked ? '<span class="badge lock">🔒 Unlock</span>' : '';
    return `<div class="thumb" style="--c:${FF.esc(color)}">${inner}${badge}${lock}</div>`;
  };
  FF.videoCard = (v, ch) => `<a class="card" href="/watch.html?v=${encodeURIComponent(v.id)}">${FF.thumbHtml(v, ch)}
    <div class="body"><div class="t">${FF.esc(v.title)}</div><div class="s">${FF.esc(ch ? ch.name : '')}${v.durationMin ? ' · ' + v.durationMin + ' min' : ''}</div></div></a>`;
  FF.loadChannels = async () => {
    const s = await FF.db.collection('channels').where('active', '==', true).get();
    return s.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => (a.order || 0) - (b.order || 0));
  };
  FF.publishedVideos = async (channelId) => {
    let q = FF.db.collection('videos').where('published', '==', true);
    if (channelId) q = q.where('channelId', '==', channelId);
    const s = await q.get();
    return s.docs.map((d) => Object.assign({ id: d.id }, d.data()))
      .sort((a, b) => (b.isLive - a.isLive) || FF.ms(b.publishedAt) - FF.ms(a.publishedAt));
  };

  // ---------- boot ----------
  FF.boot = async () => {
    await loadSite();
    renderHeader(); renderFooter();
    if (document.body.dataset.page !== 'admin') ageGate();
    await completeEmailLink();
    let first = true;
    FF.auth.onAuthStateChanged(async (u) => {
      FF.user = u; FF.profile = null;
      if (u) {
        try { await refreshMe(); } catch (e) { console.warn(e); }
        if (FF.profile && FF.profile.verified) claimDaily();
        else if (document.body.dataset.page !== 'admin') profileModal();
      }
      renderAccount();
      if (first) { first = false; emit(); } else document.dispatchEvent(new CustomEvent('ff:auth'));
    });
  };
})();
