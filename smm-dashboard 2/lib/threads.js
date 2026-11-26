'use strict';
// Threads API (graph.threads.net, v1.0) — token per akun Threads, disimpan terenkripsi di server.
// Izin: threads_basic (semua endpoint) + threads_manage_insights (insights).
const { MetaError, classify, jakartaDate, norm, pool } = require('./meta');

const base = () => (process.env.THREADS_BASE || 'https://graph.threads.net').replace(/\/$/, '');
const MEDIA_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];
const FATAL = ['token_expired', 'token_invalid', 'unreachable', 'rate_limit'];

async function call(path, token, params = {}, versioned = true) {
  if (!token) throw new MetaError('no_token', 'Token belum diisi');
  const url = new URL(`${base()}/${versioned ? 'v1.0/' : ''}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch { throw new MetaError('unreachable', 'API Threads tidak bisa dihubungi'); }
  let body; try { body = await res.json(); } catch { throw new MetaError('api_error', `Respons Threads tidak bisa dibaca (HTTP ${res.status})`); }
  if (body && body.error) throw classify(body.error);
  if (!res.ok) throw new MetaError('api_error', `HTTP ${res.status}`);
  return body;
}

async function followers(token) {
  try {
    const r = await call('me/threads_insights', token, { metric: 'followers_count' });
    const d = (r.data || [])[0];
    return d ? (d.total_value?.value ?? d.values?.[0]?.value ?? null) : null;
  } catch (e) { if (FATAL.includes(e.kind)) throw e; if (e.kind === 'permission') throw e; return null; }
}

// Uji: token valid → profil → izin insights → username cocok dengan handle brand
async function test(token, handle) {
  const me = await call('me', token, { fields: 'id,username' });
  let f = null;
  try { f = await followers(token); }
  catch (e) { if (e.kind === 'permission') return { ok: false, kind: 'permission', username: me.username, missing: ['threads_manage_insights'] }; throw e; }
  const match = !handle || norm(me.username) === norm(handle);
  return { ok: match, kind: match ? null : 'handle_mismatch', username: me.username, userId: me.id, followers: f };
}

async function insights(token, id) {
  const out = {};
  try {
    const r = await call(`${id}/insights`, token, { metric: MEDIA_METRICS.join(',') });
    for (const d of r.data || []) out[d.name] = d.values?.[0]?.value ?? d.total_value?.value ?? null;
    return out;
  } catch (e) { if (FATAL.includes(e.kind)) throw e; }
  for (const m of MEDIA_METRICS) {
    try { const r = await call(`${id}/insights`, token, { metric: m }); const d = (r.data || [])[0]; out[m] = d ? (d.values?.[0]?.value ?? d.total_value?.value ?? null) : null; }
    catch (e) { if (FATAL.includes(e.kind)) throw e; out[m] = null; }
  }
  return out;
}

const TYPE = { TEXT_POST: 'Text', IMAGE: 'Image', VIDEO: 'Video', CAROUSEL_ALBUM: 'Carousel', AUDIO: 'Audio' };

async function sync(token, days = 90) {
  const sinceMs = Date.now() - days * 864e5;
  let media = [], after = null, page = 0;
  do {
    const params = { fields: 'id,text,media_type,media_product_type,timestamp,permalink,is_quote_post', limit: '50' };
    if (after) params.after = after;
    const r = await call('me/threads', token, params);
    const batch = r.data || [];
    media.push(...batch);
    after = r.paging?.cursors?.after && r.paging?.next ? r.paging.cursors.after : null;
    if (batch.length && Date.parse(batch[batch.length - 1].timestamp) < sinceMs) after = null;
    page++;
  } while (after && page < 8);
  media = media.filter((m) => m.media_type !== 'REPOST_FACADE' && Date.parse(m.timestamp) >= sinceMs);
  const ins = await pool(media, 4, (m) => insights(token, m.id));
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const posts = media.map((m, i) => {
    const x = ins[i] || {};
    return { id: 'th_' + m.id, title: (m.text || '(tanpa teks)').replace(/\s+/g, ' ').slice(0, 90), type: (m.is_quote_post ? 'Quote' : TYPE[m.media_type] || 'Text'), date: jakartaDate(m.timestamp),
      views: num(x.views), reach: null, likes: num(x.likes), comments: num(x.replies), reposts: num(x.reposts), quotes: num(x.quotes), shares: num(x.shares), saves: null, interactions: null, permalink: m.permalink || null, source: 'api' };
  });
  return { posts, followers: await followers(token), fetchedDays: days };
}

// Long-lived token (60 hari) bisa di-refresh kalau umurnya ≥ 24 jam dan belum kedaluwarsa
async function refresh(token) {
  const r = await call('refresh_access_token', token, { grant_type: 'th_refresh_token' }, false);
  return { token: r.access_token, expiresIn: r.expires_in };
}

module.exports = { test, sync, refresh };
