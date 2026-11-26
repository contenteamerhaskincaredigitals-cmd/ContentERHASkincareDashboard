'use strict';
// TikTok API v2 (Login Kit + Display API): user.info.basic, user.info.stats, video.list
// Access token berumur pendek → server memperbarui otomatis pakai refresh token (butuh client key & secret).
const { MetaError, jakartaDate } = require('./meta');

const base = () => (process.env.TIKTOK_BASE || 'https://open.tiktokapis.com').replace(/\/$/, '');
const authBase = () => process.env.TIKTOK_AUTH_URL || 'https://www.tiktok.com/v2/auth/authorize/';
const SCOPES = 'user.info.basic,user.info.stats,video.list';
const configured = () => !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);

function classify(err, status) {
  const code = String(err?.code || '');
  if (status === 401 || /access_token_invalid|token.*expired|invalid_token/i.test(code)) return new MetaError('token_expired', 'Token TikTok kedaluwarsa/tidak valid');
  if (/scope_not_authorized|scope_permission_missed|permission/i.test(code)) return new MetaError('permission', 'Izin TikTok kurang');
  if (/rate_limit/i.test(code) || status === 429) return new MetaError('rate_limit', 'Batas API TikTok tercapai');
  return new MetaError('api_error', `TikTok API error (${code || status})`);
}

async function req(method, path, token, { query = {}, body } = {}) {
  const url = new URL(base() + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  let res;
  try { res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) }); }
  catch { throw new MetaError('unreachable', 'API TikTok tidak bisa dihubungi'); }
  let j; try { j = await res.json(); } catch { throw new MetaError('api_error', `Respons TikTok tidak bisa dibaca (HTTP ${res.status})`); }
  if ((j.error && j.error.code && j.error.code !== 'ok') || !res.ok) throw classify(j.error, res.status);
  return j.data || {};
}

async function tokenCall(params) {
  if (!configured()) throw new MetaError('config', 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET belum diisi');
  const form = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, ...params });
  let res;
  try { res = await fetch(base() + '/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(20000) }); }
  catch { throw new MetaError('unreachable', 'API TikTok tidak bisa dihubungi'); }
  const j = await res.json().catch(() => ({}));
  if (!j.access_token) {
    const e = String(j.error || j.error_code || '');
    if (/invalid_grant|expired/i.test(e) || /refresh/i.test(j.error_description || '')) throw new MetaError('token_expired', 'Refresh token TikTok tidak berlaku');
    throw new MetaError('api_error', `TikTok OAuth error (${e || res.status})`);
  }
  const now = Date.now();
  return { access: j.access_token, refresh: j.refresh_token, expiresAt: now + (j.expires_in || 3600) * 1000, refreshExpiresAt: j.refresh_expires_in ? now + j.refresh_expires_in * 1000 : null, openId: j.open_id || null, scope: j.scope || '' };
}
const authUrl = (state, redirect) => `${authBase()}?${new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY || '', scope: SCOPES, response_type: 'code', redirect_uri: redirect, state })}`;
const exchange = (code, redirect) => tokenCall({ code, grant_type: 'authorization_code', redirect_uri: redirect });
const refresh = (refreshToken) => tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken });

// Pastikan access token masih berlaku; perbarui 10 menit sebelum habis. Mengembalikan {tok, changed}
async function fresh(tok) {
  if (tok.expiresAt && tok.expiresAt - Date.now() > 10 * 60e3) return { tok, changed: false };
  if (!tok.refresh) { if (!tok.expiresAt) return { tok, changed: false }; throw new MetaError('token_expired', 'Access token TikTok habis dan tidak ada refresh token'); }
  const n = await refresh(tok.refresh);
  return { tok: { ...tok, ...n, refresh: n.refresh || tok.refresh }, changed: true };
}

async function user(access) {
  const d = await req('GET', '/v2/user/info/', access, { query: { fields: 'open_id,display_name,follower_count,video_count,likes_count' } });
  const u = d.user || {};
  return { openId: u.open_id || null, displayName: u.display_name || '', followers: u.follower_count ?? null, videos: u.video_count ?? null };
}

async function videos(access, days = 90) {
  const sinceMs = Date.now() - days * 864e5, out = [];
  let cursor = null, page = 0, more = true;
  while (more && page < 15) {
    const d = await req('POST', '/v2/video/list/', access, { query: { fields: 'id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count' }, body: cursor ? { max_count: 20, cursor } : { max_count: 20 } });
    const vs = d.videos || [];
    out.push(...vs);
    more = !!d.has_more && vs.length > 0 && vs[vs.length - 1].create_time * 1000 >= sinceMs;
    cursor = d.cursor; page++;
  }
  const num = (v) => (v == null ? null : Number(v));
  return out.filter((v) => v.create_time * 1000 >= sinceMs).map((v) => ({
    id: 'tt_' + v.id, title: (v.title || v.video_description || '(tanpa judul)').replace(/\s+/g, ' ').slice(0, 90), type: 'Video',
    date: jakartaDate(new Date(v.create_time * 1000).toISOString()), views: num(v.view_count), reach: null, likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count), saves: null, interactions: null,
    permalink: v.share_url || null, source: 'api',
  }));
}

module.exports = { configured, authUrl, exchange, refresh, fresh, user, videos, SCOPES };
