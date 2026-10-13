// Flying Fish — Surprisingly Good Sets: accounts + rewards server.
// No npm dependencies (works with Netlify drag-and-drop deploys).
// All points/balances are written ONLY here, with a Google service account,
// so browsers can never award themselves points.
//
// Env vars (Netlify → Site settings → Environment variables):
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
const crypto = require('crypto');

// Accepts the private key however it was pasted into Netlify: with literal \n, with real
// line breaks, wrapped in quotes, with a trailing comma, or even the whole service-account JSON.
function cleanKey(raw) {
  let k = String(raw || '').trim();
  if (k.startsWith('{')) { try { k = JSON.parse(k).private_key || ''; } catch (e) { /* fall through */ } }
  k = k.replace(/,\s*$/, '').trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  k = k.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(k);
  if (!m) return k;
  const body = m[1].replace(/\s+/g, '').match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${body.join('\n')}\n-----END PRIVATE KEY-----\n`;
}
const env = () => ({
  project: (process.env.FIREBASE_PROJECT_ID || '').trim().replace(/^"|"$/g, ''),
  email: (process.env.FIREBASE_CLIENT_EMAIL || '').trim().replace(/^"|"$/g, ''),
  key: cleanKey(process.env.FIREBASE_PRIVATE_KEY),
});
const docsBase = () => `https://firestore.googleapis.com/v1/projects/${env().project}/databases/(default)/documents`;
const docName = (path) => `projects/${env().project}/databases/(default)/documents/${path}`;

const DEFAULT_RULES = {
  welcomeBonus: 50,
  vodPerMin: 1, livePerMin: 2,
  vodCapPerVideoDay: 30, liveCapPerVideoDay: 120,
  liveAttendBonus: 25, liveAttendAfterMin: 5,
  chatPoints: 2, chatCapDay: 10, chatMinGapSec: 20,
  reactPoints: 1, reactCapDay: 10, reactMinGapSec: 5,
  dailyBase: 10, streakStep: 2, streakMax: 7,
  dailyCap: 400,
  redemptionsOpen: false, prizesEnabled: false,
};
const BEAT_MIN_GAP_MS = 50 * 1000; // heartbeats arrive every 60s

// ---------- helpers ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const json = (status, body) => ({ statusCode: status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) });
class HttpErr extends Error { constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; } }
const fail = (status, code, detail) => { throw new HttpErr(status, code, detail); };
const now = () => Date.now();
const sastDay = (t = now()) => new Date(t + 2 * 3600e3).toISOString().slice(0, 10);

// ---------- Firestore value encoding ----------
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
function toFields(o) { const f = {}; for (const k of Object.keys(o)) if (o[k] !== undefined) f[k] = toValue(o[k]); return f; }
function fromValue(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
function fromFields(f) { const o = {}; for (const k of Object.keys(f || {})) o[k] = fromValue(f[k]); return o; }

// ---------- Google auth ----------
let tokenCache = { t: null, exp: 0 };
async function googleToken() {
  if (tokenCache.t && now() < tokenCache.exp - 60000) return tokenCache.t;
  const { email, key } = env();
  if (!email || !key) fail(500, 'server_not_configured');
  const iat = Math.floor(now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  let sig;
  try { sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(key); }
  catch (e) {
    // Shape-only diagnostics — never echoes key material.
    const raw = String(process.env.FIREBASE_PRIVATE_KEY || '');
    const d = `pasted ${raw.length} chars; BEGIN ${/BEGIN PRIVATE KEY/.test(raw) ? 'found' : 'missing'}; END ${/END PRIVATE KEY/.test(raw) ? 'found' : 'missing'}; body ${(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END/.exec(key) || ['', ''])[1].replace(/\s+/g, '').length} chars (expect ~1620)`;
    console.error('private key unusable:', e.message, d); fail(500, 'bad_private_key', d);
  }
  const r = await deps.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claim + '.' + b64u(sig),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) { console.error('token error', j); fail(500, j.error === 'invalid_grant' ? 'bad_client_email_or_key' : 'server_auth_failed'); }
  tokenCache = { t: j.access_token, exp: now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.t;
}

let certCache = { certs: null, exp: 0 };
async function googleCerts() {
  if (certCache.certs && now() < certCache.exp) return certCache.certs;
  const r = await deps.fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  const certs = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  certCache = { certs, exp: now() + (m ? Number(m[1]) * 1000 : 3600e3) };
  return certs;
}

// Verifies a Firebase Auth ID token (RS256, Google x509 certs).
async function verifyIdToken(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3) fail(401, 'bad_token');
  const [h, p, s] = parts;
  let header, payload;
  try { header = JSON.parse(Buffer.from(h, 'base64url')); payload = JSON.parse(Buffer.from(p, 'base64url')); } catch { fail(401, 'bad_token'); }
  if (header.alg !== 'RS256') fail(401, 'bad_token');
  const cert = (await googleCerts())[header.kid];
  if (!cert) fail(401, 'bad_token');
  const ok = crypto.createVerify('RSA-SHA256').update(h + '.' + p).verify(cert, Buffer.from(s, 'base64url'));
  const t = Math.floor(now() / 1000), project = env().project;
  if (!ok || payload.aud !== project || payload.iss !== 'https://securetoken.google.com/' + project ||
      !(payload.exp > t) || !(payload.iat <= t + 300) || !payload.sub) fail(401, 'bad_token');
  return { uid: payload.sub, email: payload.email || '', emailVerified: !!payload.email_verified };
}

// ---------- Firestore REST ----------
async function fsGet(path) {
  const r = await deps.fetch(`${docsBase()}/${path}`, { headers: { authorization: 'Bearer ' + await googleToken() } });
  if (r.status === 404) return null;
  const j = await r.json();
  if (!r.ok) { console.error('get', path, j); fail(500, 'db_error'); }
  return { data: fromFields(j.fields), updateTime: j.updateTime };
}
async function fsList(path, pageSize = 50) {
  const r = await deps.fetch(`${docsBase()}/${path}?pageSize=${pageSize}`, { headers: { authorization: 'Bearer ' + await googleToken() } });
  const j = await r.json();
  if (!r.ok) { console.error('list', path, j); fail(500, 'db_error'); }
  return (j.documents || []).map((d) => ({ id: d.name.split('/').pop(), data: fromFields(d.fields) }));
}
// Returns true on success, false if a precondition failed (someone else wrote first).
async function fsCommit(writes) {
  const r = await deps.fetch(`${docsBase()}:commit`, {
    method: 'POST', headers: { authorization: 'Bearer ' + await googleToken(), 'content-type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  if (r.ok) return true;
  const j = await r.json().catch(() => ({}));
  const st = j.error && j.error.status;
  if (st === 'FAILED_PRECONDITION' || st === 'ALREADY_EXISTS' || st === 'NOT_FOUND' || st === 'ABORTED') return false;
  console.error('commit', JSON.stringify(j)); fail(500, 'db_error');
}
const pre = (doc) => (doc ? { updateTime: doc.updateTime } : { exists: false });
function wSet(path, data, precondition) { // full replace
  const w = { update: { name: docName(path), fields: toFields(data) } };
  if (precondition) w.currentDocument = precondition;
  return w;
}
function wMerge(path, data, { inc, append, precondition } = {}) { // merge listed fields (+ increments)
  const w = { update: { name: docName(path), fields: toFields(data) }, updateMask: { fieldPaths: Object.keys(data) } };
  const t = [];
  for (const k of Object.keys(inc || {})) t.push({ fieldPath: k, increment: toValue(inc[k]) });
  for (const k of Object.keys(append || {})) t.push({ fieldPath: k, appendMissingElements: { values: append[k].map(toValue) } });
  if (t.length) w.updateTransforms = t;
  if (precondition) w.currentDocument = precondition;
  return w;
}
const newId = () => crypto.randomBytes(10).toString('hex');

// Points change: user balance, public leaderboard, ledger line — all in one atomic commit with `extra` writes.
function pointWrites(uid, user, amount, reason, meta = {}) {
  const writes = [
    wMerge(`users/${uid}`, { lastActive: new Date() }, { inc: amount > 0 ? { points: amount, lifetime: amount } : { points: amount } }),
    wSet(`users/${uid}/ledger/${newId()}`, { amount, reason, at: new Date(), ...meta }, { exists: false }),
  ];
  if (amount > 0) writes.push(wMerge(`leaderboard/${uid}`, { name: user.name || 'Viewer' }, { inc: { lifetime: amount } }));
  return writes;
}

let rulesCache = { r: null, exp: 0 };
async function rules() {
  if (rulesCache.r && now() < rulesCache.exp) return rulesCache.r;
  const d = await fsGet('config/rewards');
  rulesCache = { r: { ...DEFAULT_RULES, ...((d && d.data) || {}) }, exp: now() + 60000 };
  return rulesCache.r;
}

function ageOn(dob, t = now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || '');
  if (!m) return -1;
  const today = new Date(t + 2 * 3600e3);
  let age = today.getUTCFullYear() - Number(m[1]);
  const mo = today.getUTCMonth() + 1, da = today.getUTCDate();
  if (mo < Number(m[2]) || (mo === Number(m[2]) && da < Number(m[3]))) age--;
  return age;
}

// Day doc holds every per-day counter for a user so one precondition guards them all.
const emptyDay = () => ({ total: 0, chat: 0, react: 0, lastChatAt: 0, lastReactAt: 0, lastBeatAt: 0, w: {}, att: {}, chatIds: [] });

// ---------- actions ----------
const actions = {
  async me(ctx) {
    const u = await fsGet(`users/${ctx.uid}`);
    const r = await rules();
    const day = await fsGet(`users/${ctx.uid}/days/${sastDay()}`);
    const admin = await fsGet(`admins/${ctx.uid}`);
    return { profile: u ? publicProfile(u.data) : null, rules: r, today: day ? { total: day.data.total } : { total: 0 }, isAdmin: !!admin };
  },

  async profile(ctx, b) {
    const name = String(b.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 30) fail(400, 'bad_name');
    const existing = await fsGet(`users/${ctx.uid}`);
    if (existing && existing.data.verified) { // name / marketing change only
      const ok = await fsCommit([
        wMerge(`users/${ctx.uid}`, { name, marketing: !!b.marketing }, { precondition: pre(existing) }),
        wMerge(`leaderboard/${ctx.uid}`, { name }),
      ]);
      if (!ok) fail(409, 'retry');
      return { ok: true };
    }
    const age = ageOn(b.dob);
    if (age < 0 || age > 120) fail(400, 'bad_dob');
    if (age < 18) fail(403, 'under_18'); // nothing stored for under-18s
    if (!b.consent) fail(400, 'consent_required');
    const r = await rules();
    const user = { uid: ctx.uid, email: ctx.email, name, dob: b.dob, verified: true, marketing: !!b.marketing,
      consentAt: new Date(), createdAt: new Date(), lastActive: new Date(), points: 0, lifetime: 0, streak: 0, lastDaily: '', unlocks: [] };
    const writes = [wSet(`users/${ctx.uid}`, user, pre(existing)), wSet(`leaderboard/${ctx.uid}`, { name, lifetime: 0 })];
    if (r.welcomeBonus > 0) writes.push(...pointWrites(ctx.uid, user, r.welcomeBonus, 'welcome'));
    if (!(await fsCommit(writes))) fail(409, 'retry');
    return { ok: true, awarded: r.welcomeBonus || 0 };
  },

  async daily(ctx) {
    const { user, doc } = await needUser(ctx);
    const r = await rules();
    const today = sastDay(), yesterday = sastDay(now() - 86400e3);
    if (user.lastDaily === today) return { awarded: 0, streak: user.streak || 1, already: true };
    const streak = user.lastDaily === yesterday ? (user.streak || 0) + 1 : 1;
    const amount = r.dailyBase + r.streakStep * (Math.min(streak, r.streakMax) - 1);
    const writes = pointWrites(ctx.uid, user, amount, 'daily', { streak });
    writes[0] = wMerge(`users/${ctx.uid}`, { lastActive: new Date(), lastDaily: today, streak },
      { inc: { points: amount, lifetime: amount }, precondition: pre(doc) });
    if (!(await fsCommit(writes))) return { awarded: 0, streak, already: true };
    return { awarded: amount, streak };
  },

  async heartbeat(ctx, b) {
    const { user } = await needUser(ctx);
    const videoId = cleanId(b.videoId);
    const state = b.state === 'playing' ? 'playing' : b.state === 'unknown' ? 'unknown' : 'idle';
    if (!b.visible || state === 'idle') return { awarded: 0, reason: 'not_watching' };
    const v = await fsGet(`videos/${videoId}`);
    if (!v) fail(404, 'no_video');
    const r = await rules();
    const live = !!v.data.isLive;
    const dayPath = `users/${ctx.uid}/days/${sastDay()}`;
    const dayDoc = await fsGet(dayPath);
    const day = { ...emptyDay(), ...(dayDoc ? dayDoc.data : {}) };
    const t = now();
    if (t - day.lastBeatAt < BEAT_MIN_GAP_MS) return { awarded: 0, reason: 'too_soon' }; // blocks multi-tab / multi-video farming
    day.lastBeatAt = t;
    let cap = live ? r.liveCapPerVideoDay : r.vodCapPerVideoDay;
    let rate = live ? r.livePerMin : r.vodPerMin;
    if (state === 'unknown') { cap = Math.floor(cap / 2); rate = r.vodPerMin; } // player couldn't report play state
    const mins = day.w[videoId] || 0;
    let amount = 0, reason = 'watch';
    if (mins < cap) { day.w = { ...day.w, [videoId]: mins + 1 }; amount = rate; }
    if (live && !day.att[videoId] && (day.w[videoId] || 0) >= r.liveAttendAfterMin) {
      day.att = { ...day.att, [videoId]: true }; amount += r.liveAttendBonus; reason = 'live_attend';
    }
    amount = Math.max(0, Math.min(amount, r.dailyCap - day.total));
    day.total += amount;
    const writes = [wSet(dayPath, day, pre(dayDoc))];
    if (amount > 0) writes.push(...pointWrites(ctx.uid, user, amount, reason, { videoId }));
    if (!(await fsCommit(writes))) return { awarded: 0, reason: 'too_soon' };
    return { awarded: amount, reason: amount ? reason : (mins >= cap ? 'video_cap' : 'daily_cap'), minutes: day.w[videoId] || mins, cap, live };
  },

  async chat(ctx, b) {
    const { user } = await needUser(ctx);
    const videoId = cleanId(b.videoId), msgId = cleanId(b.msgId);
    const msg = await fsGet(`videos/${videoId}/chat/${msgId}`);
    if (!msg || msg.data.uid !== ctx.uid) fail(404, 'no_message');
    if (Math.abs(now() - (msg.data.ts || 0)) > 120000) return { awarded: 0, reason: 'stale' };
    return counterAward(ctx, user, 'chat', { idKey: msgId, videoId });
  },

  async react(ctx, b) {
    const { user } = await needUser(ctx);
    return counterAward(ctx, user, 'react', { videoId: cleanId(b.videoId) });
  },

  async redeem(ctx, b) {
    const { user, doc } = await needUser(ctx);
    const r = await rules();
    if (!r.redemptionsOpen) fail(403, 'redemptions_closed');
    const rewardId = cleanId(b.rewardId);
    const rw = await fsGet(`rewards/${rewardId}`);
    if (!rw || !rw.data.active) fail(404, 'no_reward');
    const reward = rw.data;
    if (reward.type === 'prize' && !r.prizesEnabled) fail(403, 'prizes_closed');
    if (reward.type === 'unlock' && (user.unlocks || []).includes(reward.unlockKey)) fail(400, 'already_unlocked');
    if (typeof reward.stock === 'number' && reward.stock <= 0) fail(400, 'out_of_stock');
    const cost = Math.floor(Number(reward.cost) || 0);
    if (cost <= 0) fail(400, 'bad_reward');
    if ((user.points || 0) < cost) fail(400, 'not_enough_points');
    let contact = null;
    if (reward.type === 'prize') {
      const phone = String(b.phone || '').replace(/[^\d+ ]/g, '').trim();
      if (phone.length < 9) fail(400, 'phone_required');
      contact = { phone, email: user.email || ctx.email };
    }
    const redemptionId = newId();
    const writes = [
      wMerge(`users/${ctx.uid}`, { lastActive: new Date() }, {
        inc: { points: -cost }, precondition: pre(doc),
        append: reward.type === 'unlock' ? { unlocks: [reward.unlockKey] } : undefined,
      }),
      wSet(`users/${ctx.uid}/ledger/${newId()}`, { amount: -cost, reason: 'redeem', rewardId, title: reward.title, at: new Date() }, { exists: false }),
      wSet(`redemptions/${redemptionId}`, { uid: ctx.uid, name: user.name, rewardId, title: reward.title, type: reward.type, cost,
        status: reward.type === 'prize' ? 'pending' : 'done', contact, at: new Date() }, { exists: false }),
    ];
    if (typeof reward.stock === 'number') writes.push(wMerge(`rewards/${rewardId}`, { stock: reward.stock - 1 }, { precondition: pre(rw) }));
    if (!(await fsCommit(writes))) fail(409, 'retry');
    return { ok: true, redemptionId, type: reward.type, unlockKey: reward.unlockKey || null };
  },

  // Returns the real source of a locked video to users who unlocked it.
  async source(ctx, b) {
    const { user } = await needUser(ctx);
    const videoId = cleanId(b.videoId);
    const v = await fsGet(`videos/${videoId}`);
    if (!v) fail(404, 'no_video');
    const admin = await fsGet(`admins/${ctx.uid}`);
    if (v.data.locked && !admin && !(user.unlocks || []).includes(v.data.unlockKey)) fail(403, 'locked');
    const p = await fsGet(`videos_private/${videoId}`);
    if (!p) fail(404, 'no_source');
    return { source: p.data };
  },

  // Admin: upload a logo/background/thumbnail (browser has already resized + compressed it).
  async upload(ctx, b) {
    if (!(await fsGet(`admins/${ctx.uid}`))) fail(403, 'not_admin');
    const buf = Buffer.from(String(b.data || ''), 'base64');
    if (buf.length < 64) fail(400, 'bad_image');
    if (buf.length > 3.5 * 1024 * 1024) fail(400, 'image_too_large');
    const ext = sniffImage(buf);
    if (!ext) fail(400, 'bad_image'); // PNG, JPEG or WebP only (no SVG: it can carry script)
    const key = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24) + '.' + ext;
    deps.blobs(ctx.event);
    await deps.store().set(key, buf, { metadata: { by: ctx.uid, at: Date.now(), kind: String(b.kind || '').slice(0, 20) } });
    return { url: '/img/' + key, bytes: buf.length };
  },

  // Admin: manual points adjustment (prize corrections, competitions run elsewhere).
  async adjust(ctx, b) {
    if (!(await fsGet(`admins/${ctx.uid}`))) fail(403, 'not_admin');
    const uid = cleanId(b.uid);
    const amount = Math.trunc(Number(b.amount));
    if (!amount || Math.abs(amount) > 100000) fail(400, 'bad_amount');
    const u = await fsGet(`users/${uid}`);
    if (!u) fail(404, 'no_user');
    const writes = pointWrites(uid, u.data, amount, 'admin', { note: String(b.note || '').slice(0, 120), by: ctx.uid });
    if (!(await fsCommit(writes))) fail(409, 'retry');
    return { ok: true };
  },
};

async function counterAward(ctx, user, kind, { idKey, videoId }) {
  const r = await rules();
  const pts = kind === 'chat' ? r.chatPoints : r.reactPoints;
  const cap = kind === 'chat' ? r.chatCapDay : r.reactCapDay;
  const gap = (kind === 'chat' ? r.chatMinGapSec : r.reactMinGapSec) * 1000;
  const lastKey = kind === 'chat' ? 'lastChatAt' : 'lastReactAt';
  const dayPath = `users/${ctx.uid}/days/${sastDay()}`;
  const dayDoc = await fsGet(dayPath);
  const day = { ...emptyDay(), ...(dayDoc ? dayDoc.data : {}) };
  const t = now();
  if (idKey && day.chatIds.includes(idKey)) return { awarded: 0, reason: 'already' };
  if (day[kind] >= cap) return { awarded: 0, reason: 'cap' };
  if (t - day[lastKey] < gap) return { awarded: 0, reason: 'too_soon' };
  const amount = Math.max(0, Math.min(pts, r.dailyCap - day.total));
  day[kind] += 1; day[lastKey] = t; day.total += amount;
  if (idKey) day.chatIds = [...day.chatIds, idKey].slice(-30);
  const writes = [wSet(dayPath, day, pre(dayDoc))];
  if (amount > 0) writes.push(...pointWrites(ctx.uid, user, amount, kind, { videoId }));
  if (!(await fsCommit(writes))) return { awarded: 0, reason: 'too_soon' };
  return { awarded: amount, reason: amount ? kind : 'daily_cap', count: day[kind], cap };
}

async function needUser(ctx) {
  const doc = await fsGet(`users/${ctx.uid}`);
  if (!doc || !doc.data.verified) fail(403, 'profile_required');
  return { user: doc.data, doc };
}
function sniffImage(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
function cleanId(s) { s = String(s || ''); if (!/^[A-Za-z0-9_-]{1,128}$/.test(s)) fail(400, 'bad_id'); return s; }
function publicProfile(u) {
  return { name: u.name, email: u.email, verified: !!u.verified, points: u.points || 0, lifetime: u.lifetime || 0,
    streak: u.streak || 0, lastDaily: u.lastDaily || '', unlocks: u.unlocks || [], marketing: !!u.marketing };
}

const deps = {
  fetch: (...a) => fetch(...a), verify: verifyIdToken,
  blobs: (event) => require('@netlify/blobs').connectLambda(event),
  store: () => require('@netlify/blobs').getStore('media'),
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad_json' }); }
  const fn = Object.prototype.hasOwnProperty.call(actions, body.action) && actions[body.action];
  if (!fn) return json(400, { error: 'unknown_action' });
  try {
    const auth = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    if (!auth) fail(401, 'sign_in_required');
    const ctx = await deps.verify(auth);
    ctx.event = event;
    return json(200, await fn(ctx, body));
  } catch (e) {
    if (e instanceof HttpErr) return json(e.status, e.detail ? { error: e.code, detail: e.detail } : { error: e.code });
    console.error(e); return json(500, { error: 'server_error', detail: String(e && e.message || e).slice(0, 160) });
  }
};
exports._deps = deps;
exports._internal = { ageOn, sastDay, DEFAULT_RULES, resetCaches: () => { tokenCache = { t: null, exp: 0 }; rulesCache = { r: null, exp: 0 }; certCache = { certs: null, exp: 0 }; } };
