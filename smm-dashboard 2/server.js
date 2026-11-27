'use strict';
// Social Media Monitoring — server (Node 22+, tanpa dependency eksternal)
// - Login + session cookie (HttpOnly), data privat tersimpan di SQLite
// - Token Meta disimpan terenkripsi AES-256-GCM, tidak pernah dikirim ke browser
// - Proxy Meta Graph API, Business Discovery, dan feed Trending Now Google Trends

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');
const meta = require('./lib/meta');
const threads = require('./lib/threads');
const tiktok = require('./lib/tiktok');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const SESSION_DAYS = 14;
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- kunci enkripsi ----------
function loadKey() {
  if (process.env.APP_SECRET) return crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
}
const KEY = loadKey();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(row) {
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(row.iv, 'base64'));
  d.setAuthTag(Buffer.from(row.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(row.data, 'base64')), d.final()]).toString('utf8');
}

// ---------- database ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated TEXT NOT NULL, by_user INTEGER);
CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, iv TEXT NOT NULL, tag TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL);
`);

const kvGet = (k) => { const r = db.prepare('SELECT v FROM kv WHERE k=?').get(k); return r ? JSON.parse(r.v) : undefined; };
const kvSet = (k, v, uid = null) => db.prepare('INSERT INTO kv(k,v,updated,by_user) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated=excluded.updated, by_user=excluded.by_user').run(k, JSON.stringify(v), new Date().toISOString(), uid);
const kvDel = (k) => db.prepare('DELETE FROM kv WHERE k=?').run(k);

function hashPass(p, salt = crypto.randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${crypto.scryptSync(p, salt, 64).toString('hex')}`;
}
function checkPass(p, stored) {
  const [, salt, h] = String(stored).split('$');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(p, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function addUser(username, password) {
  db.prepare('INSERT INTO users(username,pass,created) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET pass=excluded.pass').run(username, hashPass(password), new Date().toISOString());
}

// ---------- CLI: node server.js user:add <nama> <password> ----------
if (process.argv[2] === 'user:add') {
  const [, , , u, p] = process.argv;
  if (!u || !p || p.length < 8) { console.log('Pakai: node server.js user:add <username> <password minimal 8 karakter>'); process.exit(1); }
  addUser(u, p); console.log(`User "${u}" disimpan.`); process.exit(0);
}
if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) {
  const u = process.env.ADMIN_USER || 'admin';
  const p = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  addUser(u, p);
  if (!process.env.ADMIN_PASSWORD) {
    const f = path.join(DATA_DIR, 'initial-login.txt');
    fs.writeFileSync(f, `username: ${u}\npassword: ${p}\n(ganti dengan: node server.js user:add ${u} <password-baru>)\n`, { mode: 0o600 });
    console.log(`Akun awal dibuat. Username & password ada di ${f}`);
  }
}

// ---------- helpers ----------
const sendJSON = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
};
function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Payload terlalu besar'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('JSON tidak valid'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((s) => s.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function currentUser(req) {
  const t = parseCookies(req.headers.cookie).smm_session;
  if (!t) return null;
  const s = db.prepare('SELECT s.user_id, s.expires, u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?').get(sha(t));
  if (!s || s.expires < Date.now()) return null;
  return { id: s.user_id, username: s.username };
}
const loginAttempts = new Map();
function rateLimited(ip) {
  const now = Date.now(), w = loginAttempts.get(ip) || [];
  const recent = w.filter((t) => now - t < 15 * 60e3);
  loginAttempts.set(ip, recent);
  return recent.length >= 10;
}

// ---------- Meta token ----------
const getToken = () => { const r = db.prepare("SELECT * FROM secrets WHERE name='meta_user_token'").get(); if (!r) return null; try { return decrypt(r); } catch { return null; } };
const setToken = (t) => { const e = encrypt(t); db.prepare("INSERT INTO secrets(name,iv,tag,data,updated) VALUES('meta_user_token',?,?,?,?) ON CONFLICT(name) DO UPDATE SET iv=excluded.iv, tag=excluded.tag, data=excluded.data, updated=excluded.updated").run(e.iv, e.tag, e.data, new Date().toISOString()); };
const tokenInfo = () => db.prepare("SELECT updated FROM secrets WHERE name='meta_user_token'").get() || null;
const brandsFromSettings = () => (kvGet('settings')?.brands || []).map((b) => ({ id: b.id, handle: b.handle }));
const oauthStates = new Map();
const tiktokRedirect = (req) => process.env.TIKTOK_REDIRECT_URI || `${process.env.PUBLIC_URL || `http://${req.headers.host}`}/api/tiktok/callback`;
const metaFail = (e) => ({ ok: false, kind: e.kind || 'api_error', message: e.message, advice: meta.ADVICE[e.kind] || meta.ADVICE.api_error, metaMessage: e.metaMessage });

async function runTest() {
  const token = getToken();
  if (!token) return { ok: false, kind: 'no_token', advice: meta.ADVICE.no_token };
  try {
    const r = await meta.testConnection(token, brandsFromSettings());
    kvSet('meta:accounts', r.accounts || {});
    const status = { ...r, checkedAt: new Date().toISOString() }; delete status.accounts;
    kvSet('meta:status', status);
    return status;
  } catch (e) {
    const s = { ...metaFail(e), checkedAt: new Date().toISOString() };
    kvSet('meta:status', s);
    return s;
  }
}

// Simpan hasil sinkron (semua platform) ke kv: posting digabung per id, snapshot followers hari ini diperbarui
const PLATS = ['ig', 'tiktok', 'threads'];
const keyPre = (plat, id) => (plat === 'ig' ? `b:${id}:` : `b:${id}:${plat}:`);
const srcOf = (plat) => (plat === 'ig' ? 'meta' : 'api');
function storeSync(plat, brandId, newPosts, followers, days) {
  const pre = keyPre(plat, brandId), src = srcOf(plat);
  const old = kvGet(`${pre}posts:${src}`) || [];
  const byId = new Map(old.map((p) => [p.id, p]));
  for (const p of newPosts) byId.set(p.id, p);
  kvSet(`${pre}posts:${src}`, [...byId.values()].sort((a, b) => b.date.localeCompare(a.date)));
  const today = meta.jakartaDate(new Date().toISOString());
  const snaps = (kvGet(`${pre}snaps:${src}`) || []).filter((x) => x.date !== today);
  if (followers != null) snaps.push({ date: today, followers });
  snaps.sort((a, b) => a.date.localeCompare(b.date));
  kvSet(`${pre}snaps:${src}`, snaps);
  const now = new Date().toISOString();
  kvSet(`${pre}lastSync:${src}`, now);
  const cov = kvGet(`${pre}coverage:${src}`) || {};
  const since = meta.jakartaDate(new Date(Date.now() - days * 864e5).toISOString());
  kvSet(`${pre}coverage:${src}`, { from: cov.from && cov.from < since ? cov.from : since, to: today });
  return { ok: true, fetched: newPosts.length, followers, syncedAt: now };
}

// Batas tarik histori: maksimal 1 tahun ke belakang (dipakai untuk isi histori sejak awal 2026)
const MAX_DAYS = 366;
async function runSync(brandId, days = 90) {
  const token = getToken();
  if (!token) return { ok: false, kind: 'no_token', advice: meta.ADVICE.no_token };
  const acc = (kvGet('meta:accounts') || {})[brandId];
  if (!acc) return { ok: false, kind: 'ig_not_found', advice: 'Brand ini belum terpetakan ke akun Instagram. Klik "Uji koneksi" di Sumber data dulu.' };
  try {
    const d = Math.min(Math.max(Number(days) || 90, 7), MAX_DAYS);
    const r = await meta.syncAccount(token, acc.igId, d);
    return storeSync('ig', brandId, r.posts, r.account.followers, d);
  } catch (e) { return metaFail(e); }
}

// ---------- Threads & TikTok: token per brand, terenkripsi ----------
const getSecret = (name) => { const r = db.prepare('SELECT * FROM secrets WHERE name=?').get(name); if (!r) return null; try { return JSON.parse(decrypt(r)); } catch { return null; } };
const setSecret = (name, obj) => { const e = encrypt(JSON.stringify(obj)); db.prepare('INSERT INTO secrets(name,iv,tag,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET iv=excluded.iv, tag=excluded.tag, data=excluded.data, updated=excluded.updated').run(name, e.iv, e.tag, e.data, new Date().toISOString()); };
const delSecret = (name) => db.prepare('DELETE FROM secrets WHERE name=?').run(name);
const brandById = (id) => (kvGet('settings')?.brands || []).find((b) => b.id === id) || null;
function setPlatStatus(plat, brandId, st) { const all = kvGet(`meta:${plat}:accounts`) || {}; all[brandId] = { ...st, checkedAt: new Date().toISOString() }; kvSet(`meta:${plat}:accounts`, all); }

async function testThreads(brandId) {
  const sec = getSecret(`threads:${brandId}`);
  if (!sec) return { ok: false, kind: 'no_token' };
  try {
    const r = await threads.test(sec.token, brandById(brandId)?.threads || brandById(brandId)?.handle);
    setPlatStatus('threads', brandId, r); return r;
  } catch (e) { const f = metaFail(e); setPlatStatus('threads', brandId, f); return f; }
}
async function syncThreads(brandId, days = 90) {
  const sec = getSecret(`threads:${brandId}`);
  if (!sec) return { ok: false, kind: 'no_token' };
  try {
    // perpanjang long-lived token tiap ±7 hari (harus berumur ≥24 jam)
    if (Date.now() - Date.parse(sec.refreshedAt || sec.savedAt) > 7 * 864e5) {
      try { const n = await threads.refresh(sec.token); setSecret(`threads:${brandId}`, { ...sec, token: n.token, refreshedAt: new Date().toISOString() }); sec.token = n.token; } catch (e) { if (['token_expired', 'token_invalid'].includes(e.kind)) throw e; }
    }
    const d = Math.min(Math.max(Number(days) || 90, 7), MAX_DAYS);
    const r = await threads.sync(sec.token, d);
    return storeSync('threads', brandId, r.posts, r.followers, d);
  } catch (e) { const f = metaFail(e); if (['token_expired', 'token_invalid', 'permission'].includes(f.kind)) setPlatStatus('threads', brandId, f); return f; }
}
async function tiktokToken(brandId, force = false) {
  const sec = getSecret(`tiktok:${brandId}`);
  if (!sec) throw new meta.MetaError('no_token', 'Belum tersambung');
  const { tok, changed } = await tiktok.fresh(force && sec.refresh ? { ...sec, expiresAt: 0 } : sec);
  if (changed) setSecret(`tiktok:${brandId}`, tok);
  return tok;
}
// jalankan panggilan TikTok; kalau access token ditolak dan ada refresh token, perbarui sekali lalu ulangi
async function withTT(brandId, fn) {
  try { return await fn(await tiktokToken(brandId)); }
  catch (e) {
    const sec = getSecret(`tiktok:${brandId}`);
    if (e.kind === 'token_expired' && sec?.refresh) return fn(await tiktokToken(brandId, true));
    throw e;
  }
}
async function testTiktok(brandId) {
  try { const u = await withTT(brandId, (tok) => tiktok.user(tok.access)); const sec = getSecret(`tiktok:${brandId}`) || {}; const r = { ok: true, displayName: u.displayName, followers: u.followers, autoRefresh: !!sec.refresh && tiktok.configured() }; setPlatStatus('tiktok', brandId, r); return r; }
  catch (e) { const f = metaFail(e); setPlatStatus('tiktok', brandId, f); return f; }
}
async function syncTiktok(brandId, days = 90) {
  try {
    const d = Math.min(Math.max(Number(days) || 90, 7), MAX_DAYS);
    const [u, vids] = await withTT(brandId, async (tok) => [await tiktok.user(tok.access), await tiktok.videos(tok.access, d)]);
    return storeSync('tiktok', brandId, vids, u.followers, d);
  } catch (e) { const f = metaFail(e); if (['token_expired', 'token_invalid', 'permission', 'config', 'no_token'].includes(f.kind)) setPlatStatus('tiktok', brandId, f); return f; }
}
const syncAny = (plat, id, days) => (plat === 'ig' ? runSync(id, days) : plat === 'threads' ? syncThreads(id, days) : syncTiktok(id, days));
function liveAccounts() {
  const brands = (kvGet('settings')?.brands || []).map((b) => b.id);
  return {
    ig: getToken() ? Object.keys(kvGet('meta:accounts') || {}) : [],
    threads: brands.filter((id) => getSecret(`threads:${id}`) && (kvGet('meta:threads:accounts') || {})[id]?.ok !== false),
    tiktok: brands.filter((id) => getSecret(`tiktok:${id}`) && !['token_expired', 'token_invalid', 'config'].includes((kvGet('meta:tiktok:accounts') || {})[id]?.kind)),
  };
}

// ---------- Sinkron otomatis (mendekati real-time) ----------
// Tiap brand yang terpetakan disinkron ulang tiap N menit (cfg:sync.minutes, default 15):
// - sinkron cepat: posting 14 hari terakhir + followers terbaru (snapshot hari ini diperbarui)
// - sinkron penuh 90 hari: sekali sehari per brand
// Catatan: Meta menyebut data metrik bisa tertunda hingga 48 jam, jadi angka API tidak selalu sama dengan app Instagram.
const syncMinutes = () => { const m = Number(kvGet('cfg:sync')?.minutes); return [5, 10, 15, 30, 60].includes(m) ? m : 15; };
const live = { running: false, current: null, lastRunAt: null, lastError: null };
async function autoSync() {
  if (process.env.AUTO_SYNC === '0' || live.running) return;
  live.running = true;
  try {
    const today = meta.jakartaDate(new Date().toISOString()), acc = liveAccounts();
    for (const plat of PLATS) {
      for (const id of acc[plat]) {
        const pre = keyPre(plat, id), src = srcOf(plat);
        const last = Date.parse(kvGet(`${pre}lastSync:${src}`) || 0) || 0;
        if (Date.now() - last < syncMinutes() * 60e3 - 5e3) continue;
        const full = kvGet(`${pre}lastFull:${src}`) !== today;
        live.current = { plat, id };
        const r = await syncAny(plat, id, full ? 90 : 14);
        if (r.ok && full) kvSet(`${pre}lastFull:${src}`, today);
        if (!r.ok) {
          live.lastError = { plat, brandId: id, kind: r.kind, at: new Date().toISOString() };
          if (plat === 'ig' && ['token_expired', 'token_invalid', 'permission'].includes(r.kind)) { kvSet('meta:status', { ...r, checkedAt: new Date().toISOString() }); break; }
          if (r.kind === 'rate_limit') break;
        } else if (live.lastError?.plat === plat && live.lastError?.brandId === id) live.lastError = null;
      }
    }
  } finally { live.running = false; live.current = null; live.lastRunAt = new Date().toISOString(); }
}

// ---------- Google Trends: Trending Now (RSS publik) ----------
let trendsCache = null;
const decodeXml = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
function parseTrendsRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const tag = (t) => decodeXml((it.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1]);
    const news = [...it.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].slice(0, 2).map(([, n]) => ({
      title: decodeXml((n.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/) || [])[1]),
      url: decodeXml((n.match(/<ht:news_item_url>([\s\S]*?)<\/ht:news_item_url>/) || [])[1]),
      source: decodeXml((n.match(/<ht:news_item_source>([\s\S]*?)<\/ht:news_item_source>/) || [])[1]),
    }));
    return { title: tag('title'), traffic: tag('ht:approx_traffic'), pubDate: tag('pubDate'), news };
  }).filter((x) => x.title);
}
async function getTrends() {
  if (trendsCache && Date.now() - trendsCache.at < 15 * 60e3) return trendsCache.data;
  const src = process.env.TRENDS_RSS_URL || 'https://trends.google.com/trending/rss?geo=ID';
  try {
    const r = await fetch(src, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 SMM-Dashboard' } });
    if (!r.ok) return { ok: false, error: `Sumber Google Trends menjawab HTTP ${r.status}.`, source: src };
    const items = parseTrendsRss(await r.text());
    const data = { ok: true, items, source: src, fetchedAt: new Date().toISOString() };
    if (items.length) trendsCache = { at: Date.now(), data };
    return data;
  } catch {
    return { ok: false, error: 'Feed Google Trends tidak bisa diakses dari server ini (jaringan diblokir atau timeout).', source: src };
  }
}

// ---------- router ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  if (p === '/api/health') return sendJSON(res, 200, { ok: true, mode: 'server' });

  if (m !== 'GET' && req.headers['x-smm'] !== '1') return sendJSON(res, 403, { error: 'Header permintaan tidak valid' });

  if (p === '/api/login' && m === 'POST') {
    const ip = req.socket.remoteAddress || '';
    if (rateLimited(ip)) return sendJSON(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
    const { username, password } = await readBody(req, 10000);
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || ''));
    if (!u || !checkPass(String(password || ''), u.pass)) { loginAttempts.get(ip).push(Date.now()); return sendJSON(res, 401, { error: 'Username atau password salah.' }); }
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)').run(sha(token), u.id, Date.now() + SESSION_DAYS * 864e5);
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    return sendJSON(res, 200, { ok: true, username: u.username }, { 'Set-Cookie': `smm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${COOKIE_SECURE ? '; Secure' : ''}` });
  }
  if (p === '/api/logout' && m === 'POST') {
    const t = parseCookies(req.headers.cookie).smm_session;
    if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(t));
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': 'smm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  const user = currentUser(req);
  if (!user) return sendJSON(res, 401, { error: 'Silakan login dulu.' });
  if (p === '/api/me') return sendJSON(res, 200, { username: user.username });
  if (p === '/api/tiktok/connect' && m === 'GET') {
    const id = url.searchParams.get('brandId') || '';
    if (!tiktok.configured()) { res.writeHead(302, { Location: '/#sumber' }); return res.end(); }
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { id, exp: Date.now() + 10 * 60e3 });
    res.writeHead(302, { Location: tiktok.authUrl(state, tiktokRedirect(req)) }); return res.end();
  }
  if (p === '/api/tiktok/callback' && m === 'GET') {
    const st = oauthStates.get(url.searchParams.get('state') || ''); oauthStates.delete(url.searchParams.get('state') || '');
    if (!st || st.exp < Date.now() || !url.searchParams.get('code')) { res.writeHead(302, { Location: '/?tiktok=gagal#sumber' }); return res.end(); }
    try { const tok = await tiktok.exchange(url.searchParams.get('code'), tiktokRedirect(req)); setSecret(`tiktok:${st.id}`, { ...tok, savedAt: new Date().toISOString() }); await testTiktok(st.id); setTimeout(() => autoSync().catch(() => {}), 500); res.writeHead(302, { Location: '/?tiktok=ok#sumber' }); }
    catch { res.writeHead(302, { Location: '/?tiktok=gagal#sumber' }); }
    return res.end();
  }

  if (p === '/api/kv' && m === 'GET') {
    const out = {};
    for (const r of db.prepare('SELECT k,v FROM kv').all()) out[r.k] = JSON.parse(r.v);
    return sendJSON(res, 200, out);
  }
  const kvm = p.match(/^\/api\/kv\/([A-Za-z0-9:_\-.]{1,120})$/);
  if (kvm) {
    const k = kvm[1];
    if (k.startsWith('meta:')) return sendJSON(res, 403, { error: 'Kunci ini dikelola server.' });
    if (m === 'PUT') { const b = await readBody(req); kvSet(k, b.value ?? null, user.id); return sendJSON(res, 200, { ok: true }); }
    if (m === 'DELETE') { kvDel(k); return sendJSON(res, 200, { ok: true }); }
  }

  if (p === '/api/meta/status' && m === 'GET') {
    const info = tokenInfo();
    return sendJSON(res, 200, { hasToken: !!info, tokenSavedAt: info?.updated || null, status: kvGet('meta:status') || null, accounts: Object.fromEntries(Object.entries(kvGet('meta:accounts') || {}).map(([k, v]) => [k, { page: v.page, username: v.username }])), apiVersion: process.env.META_API_VERSION || 'v27.0' });
  }
  if (p === '/api/meta/token' && m === 'POST') {
    const { token } = await readBody(req, 20000);
    const t = String(token || '').trim();
    if (!/^[A-Za-z0-9_\-|.]{20,1000}$/.test(t)) return sendJSON(res, 400, { error: 'Format token tidak dikenali. Salin ulang token dari Graph API Explorer (tanpa spasi atau tanda kutip).' });
    setToken(t);
    const r = await runTest();
    if (r.ok) setTimeout(() => autoSync().catch(() => {}), 500);
    return sendJSON(res, 200, r);
  }
  if (p === '/api/meta/token' && m === 'DELETE') {
    db.prepare("DELETE FROM secrets WHERE name='meta_user_token'").run(); kvDel('meta:accounts'); kvDel('meta:status');
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/meta/test' && m === 'POST') return sendJSON(res, 200, await runTest());
  if (p === '/api/meta/sync' && m === 'POST') { const b = await readBody(req, 10000); return sendJSON(res, 200, await runSync(String(b.brandId || ''), b.days)); }
  if (p === '/api/meta/discovery' && m === 'POST') {
    const b = await readBody(req, 10000);
    const token = getToken();
    if (!token) return sendJSON(res, 200, { ok: false, kind: 'no_token', advice: meta.ADVICE.no_token });
    const acc = (kvGet('meta:accounts') || {})[String(b.brandId || '')] || Object.values(kvGet('meta:accounts') || {})[0];
    if (!acc) return sendJSON(res, 200, { ok: false, kind: 'ig_not_found', advice: 'Belum ada akun IG brand yang terpetakan. Jalankan "Uji koneksi" di Sumber data.' });
    try { return sendJSON(res, 200, { ok: true, data: await meta.businessDiscovery(token, acc.igId, b.username) }); }
    catch (e) { return sendJSON(res, 200, metaFail(e)); }
  }
  if (p === '/api/live' && m === 'GET') {
    const mins = syncMinutes(), acc = liveAccounts(), platforms = {};
    for (const plat of PLATS) platforms[plat] = Object.fromEntries(acc[plat].map((id) => { const ls = kvGet(`${keyPre(plat, id)}lastSync:${srcOf(plat)}`) || null; return [id, { lastSync: ls, nextSync: ls ? new Date(Math.max(Date.parse(ls) + mins * 60e3, Date.now())).toISOString() : null }]; }));
    return sendJSON(res, 200, { serverTime: new Date().toISOString(), version: db.prepare('SELECT MAX(updated) v FROM kv').get().v || null, minutes: mins, autoSync: process.env.AUTO_SYNC !== '0', hasToken: !!getToken(), running: live.running, current: live.current, lastRunAt: live.lastRunAt, lastError: live.lastError, platforms });
  }
  // ---- Threads
  if (p === '/api/threads/token' && m === 'POST') {
    const b = await readBody(req, 20000), id = String(b.brandId || ''), t = String(b.token || '').trim();
    if (!brandById(id)) return sendJSON(res, 400, { error: 'Brand tidak dikenal' });
    if (!/^[A-Za-z0-9_\-|.]{20,1000}$/.test(t)) return sendJSON(res, 400, { error: 'Format token tidak dikenali' });
    setSecret(`threads:${id}`, { token: t, savedAt: new Date().toISOString() });
    const r = await testThreads(id); if (r.ok) setTimeout(() => autoSync().catch(() => {}), 500);
    return sendJSON(res, 200, r);
  }
  if (p === '/api/threads/test' && m === 'POST') { const b = await readBody(req, 10000); return sendJSON(res, 200, await testThreads(String(b.brandId || ''))); }
  // ---- TikTok
  if (p === '/api/tiktok/token' && m === 'POST') {
    const b = await readBody(req, 20000), id = String(b.brandId || ''), at = String(b.accessToken || '').trim(), rt = String(b.refreshToken || '').trim();
    if (!brandById(id)) return sendJSON(res, 400, { error: 'Brand tidak dikenal' });
    if (!/^[A-Za-z0-9_\-|.!*~]{10,2000}$/.test(at) || (rt && !/^[A-Za-z0-9_\-|.!*~]{10,2000}$/.test(rt))) return sendJSON(res, 400, { error: 'Format token tidak dikenali' });
    setSecret(`tiktok:${id}`, { access: at, refresh: rt || null, expiresAt: rt ? Date.now() + 60e3 * 50 : null, savedAt: new Date().toISOString() });
    const r = await testTiktok(id); if (r.ok) setTimeout(() => autoSync().catch(() => {}), 500);
    return sendJSON(res, 200, r);
  }
  if (p === '/api/tiktok/test' && m === 'POST') { const b = await readBody(req, 10000); return sendJSON(res, 200, await testTiktok(String(b.brandId || ''))); }
  if (p === '/api/platforms/status' && m === 'GET') {
    const out = { tiktokConfigured: tiktok.configured(), tiktokRedirect: tiktokRedirect(req), threads: {}, tiktok: {} };
    const ts = kvGet('meta:threads:accounts') || {}, tk = kvGet('meta:tiktok:accounts') || {};
    for (const b of kvGet('settings')?.brands || []) {
      const s1 = getSecret(`threads:${b.id}`), s2 = getSecret(`tiktok:${b.id}`);
      out.threads[b.id] = { hasToken: !!s1, savedAt: s1?.savedAt || null, status: s1 ? ts[b.id] || null : null };
      out.tiktok[b.id] = { hasToken: !!s2, savedAt: s2?.savedAt || null, autoRefresh: !!(s2?.refresh && tiktok.configured()), status: s2 ? tk[b.id] || null : null };
    }
    return sendJSON(res, 200, out);
  }
  if (p === '/api/platform/token' && m === 'DELETE') {
    const b = await readBody(req, 10000), plat = b.platform, id = String(b.brandId || '');
    if (!['threads', 'tiktok'].includes(plat)) return sendJSON(res, 400, { error: 'Platform tidak dikenal' });
    delSecret(`${plat}:${id}`); const all = kvGet(`meta:${plat}:accounts`) || {}; delete all[id]; kvSet(`meta:${plat}:accounts`, all);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/sync' && m === 'POST') {
    const b = await readBody(req, 10000);
    if (!PLATS.includes(b.platform)) return sendJSON(res, 400, { error: 'Platform tidak dikenal' });
    return sendJSON(res, 200, await syncAny(b.platform, String(b.brandId || ''), b.days));
  }
  if (p === '/api/trends' && m === 'GET') return sendJSON(res, 200, await getTrends());
  return sendJSON(res, 404, { error: 'Tidak ditemukan' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, SEC_HEADERS); return res.end('Tidak ditemukan'); }
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('<meta name="app-mode" content="static">', '<meta name="app-mode" content="server">'));
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC_HEADERS });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('Error:', e.status || 500, e.message);
    if (!res.headersSent) sendJSON(res, e.status || 500, { error: e.status ? e.message : 'Terjadi kesalahan di server.' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Social Media Monitoring berjalan di http://localhost:${PORT}`));
  setTimeout(() => autoSync().catch(() => {}), 10e3);
  setInterval(() => autoSync().catch(() => {}), 60e3); // cek tiap menit, sinkron sesuai interval
}
module.exports = { server, parseTrendsRss, encrypt, decrypt };
