'use strict';
// Instagram API with Facebook Login — semua panggilan dilakukan di server.
// Token TIDAK pernah dimasukkan ke pesan error, log, atau respons ke browser.

const REQUIRED_PERMS = ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_manage_insights'];
const MEDIA_METRICS = ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions'];

const base = () => (process.env.META_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/$/, '');
const ver = () => process.env.META_API_VERSION || 'v27.0';

class MetaError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

const ADVICE = {
  token_expired: 'Token sudah kedaluwarsa. Buat token baru di Graph API Explorer (atau tukar jadi long-lived token), lalu klik "Sambungkan ulang".',
  token_invalid: 'Token tidak valid (salah salin, dicabut, atau password Facebook diganti). Buat token baru lalu sambungkan ulang.',
  permission: 'Izin kurang. Di Graph API Explorer centang pages_show_list, pages_read_engagement, instagram_basic, dan instagram_manage_insights, klik Generate Access Token, lalu tempel token barunya.',
  no_page: 'Token tidak melihat Facebook Page mana pun. Pastikan akun Facebook-mu admin/punya akses ke Page, dan saat generate token Page tersebut dicentang.',
  ig_not_found: 'Page ditemukan, tapi tidak ada akun Instagram Professional yang tersambung. Hubungkan akun IG ke Page lewat Meta Business Suite / pengaturan Instagram (Akun yang dihubungkan).',
  rate_limit: 'Batas panggilan API tercapai. Tunggu sekitar 1 jam lalu sinkron lagi.',
  unreachable: 'Server tidak bisa menghubungi graph.facebook.com. Cek koneksi internet server/hosting, lalu coba lagi.',
  api_error: 'Meta API mengembalikan error. Coba lagi beberapa menit lagi; kalau berulang, cek status di developers.facebook.com/status.',
  not_available: 'Akun ini tidak tersedia lewat Business Discovery (bukan akun Professional, dibatasi umur, privat, atau username salah).',
  no_token: 'Belum ada token tersimpan. Masukkan Facebook User Access Token di menu Sumber data.',
};

function classify(e) {
  const code = e.code, sub = e.error_subcode, msg = String(e.message || '');
  if (code === 190) {
    if (sub === 463 || /expired|session has expired/i.test(msg)) return new MetaError('token_expired', 'Token kedaluwarsa');
    return new MetaError('token_invalid', 'Token tidak valid');
  }
  if (code === 10 || (code >= 200 && code < 300)) return new MetaError('permission', 'Izin tidak cukup', { metaMessage: msg.slice(0, 200) });
  if ([4, 17, 32, 613, 80002].includes(code)) return new MetaError('rate_limit', 'Batas panggilan API tercapai');
  if (code === 110 || (code === 100 && /business_discovery|Cannot find|does not exist|Invalid user/i.test(msg))) return new MetaError('not_available', 'Akun tidak tersedia');
  return new MetaError('api_error', `Meta API error (kode ${code ?? '?'})`, { metaMessage: msg.slice(0, 200) });
}

async function graph(pathPart, token, params = {}) {
  if (!token) throw new MetaError('no_token', 'Token belum diisi');
  const url = new URL(`${base()}/${ver()}/${pathPart}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(20000) }); }
  catch { throw new MetaError('unreachable', 'API Meta tidak bisa dihubungi'); }
  let body;
  try { body = await res.json(); } catch { throw new MetaError('api_error', `Respons Meta tidak bisa dibaca (HTTP ${res.status})`); }
  if (body && body.error) throw classify(body.error);
  if (!res.ok) throw new MetaError('api_error', `HTTP ${res.status}`);
  return body;
}

const norm = (u) => String(u || '').trim().replace(/^@/, '').toLowerCase();

// Uji koneksi: token → izin → Page → akun IG Professional → cocokkan ke handle tiap brand
async function testConnection(token, brands) {
  const me = await graph('me', token, { fields: 'id,name' });
  let granted = [];
  try {
    const p = await graph('me/permissions', token);
    granted = (p.data || []).filter((x) => x.status === 'granted').map((x) => x.permission);
  } catch (e) { if (e.kind !== 'permission') throw e; }
  const missing = REQUIRED_PERMS.filter((x) => !granted.includes(x));
  let pages = [];
  try {
    const acc = await graph('me/accounts', token, { fields: 'id,name,instagram_business_account{id,username,followers_count}', limit: '100' });
    pages = (acc.data || []).map((pg) => ({ id: pg.id, name: pg.name, ig: pg.instagram_business_account || null }));
  } catch (e) {
    if (e.kind === 'permission') return { ok: false, kind: 'permission', advice: ADVICE.permission, user: me.name, missing, pages: [], brands: {} };
    throw e;
  }
  const result = { ok: true, user: me.name, granted, missing, pages: pages.map((p) => ({ name: p.name, igUsername: p.ig?.username || null })), brands: {}, accounts: {} };
  if (!pages.length) return { ...result, ok: false, kind: 'no_page', advice: ADVICE.no_page };
  const igPages = pages.filter((p) => p.ig);
  if (!igPages.length) return { ...result, ok: false, kind: 'ig_not_found', advice: ADVICE.ig_not_found };
  for (const b of brands) {
    const hit = igPages.find((p) => norm(p.ig.username) === norm(b.handle));
    if (hit) {
      result.brands[b.id] = { status: 'ok', page: hit.name, username: hit.ig.username, followers: hit.ig.followers_count ?? null };
      result.accounts[b.id] = { igId: hit.ig.id, pageId: hit.id, page: hit.name, username: hit.ig.username };
    } else {
      result.brands[b.id] = { status: 'ig_not_found', advice: `Akun @${norm(b.handle)} tidak ada di Page yang bisa dilihat token ini. Cek ejaan username di Pengaturan, atau pastikan Page-nya dicentang saat generate token.` };
    }
  }
  if (missing.length) { result.ok = false; result.kind = 'permission'; result.advice = ADVICE.permission; }
  return result;
}

const jakartaDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

function mapType(m) {
  if (m.media_product_type === 'REELS') return 'Reels';
  if (m.media_product_type === 'STORY') return 'Story';
  if (m.media_type === 'CAROUSEL_ALBUM') return 'Carousel';
  if (m.media_type === 'VIDEO') return 'Video';
  return 'Image';
}

async function mediaInsights(token, id) {
  const out = {};
  try {
    const r = await graph(`${id}/insights`, token, { metric: MEDIA_METRICS.join(',') });
    for (const d of r.data || []) out[d.name] = d.values?.[0]?.value ?? d.total_value?.value ?? null;
    return out;
  } catch (e) {
    if (['token_expired', 'token_invalid', 'unreachable', 'rate_limit'].includes(e.kind)) throw e;
  }
  // Sebagian metrik tidak didukung untuk tipe media tertentu → ambil satu per satu, yang gagal = data kosong (bukan nol)
  for (const m of MEDIA_METRICS) {
    try {
      const r = await graph(`${id}/insights`, token, { metric: m });
      const d = (r.data || [])[0];
      out[m] = d ? (d.values?.[0]?.value ?? d.total_value?.value ?? null) : null;
    } catch (e) {
      if (['token_expired', 'token_invalid', 'unreachable', 'rate_limit'].includes(e.kind)) throw e;
      out[m] = null;
    }
  }
  return out;
}

async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}

async function syncAccount(token, igId, days = 90) {
  const acct = await graph(igId, token, { fields: 'username,followers_count,media_count' });
  const sinceMs = Date.now() - days * 864e5;
  let media = [], next = null, page = 0;
  do {
    const r = next ? await graph(`${igId}/media`, token, { fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count', limit: '50', after: next })
                   : await graph(`${igId}/media`, token, { fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count', limit: '50' });
    const batch = r.data || [];
    media.push(...batch);
    next = r.paging?.cursors?.after && r.paging?.next ? r.paging.cursors.after : null;
    if (batch.length && Date.parse(batch[batch.length - 1].timestamp) < sinceMs) next = null;
    page++;
  } while (next && page < 8);
  media = media.filter((m) => Date.parse(m.timestamp) >= sinceMs);
  const insights = await pool(media, 4, (m) => mediaInsights(token, m.id));
  const posts = media.map((m, i) => {
    const ins = insights[i] || {};
    const num = (v) => (v == null || v === '' ? null : Number(v));
    return {
      id: 'ig_' + m.id,
      title: (m.caption || '(tanpa caption)').replace(/\s+/g, ' ').slice(0, 90),
      type: mapType(m),
      date: jakartaDate(m.timestamp),
      views: num(ins.views),
      reach: num(ins.reach),
      likes: num(ins.likes ?? m.like_count),
      comments: num(ins.comments ?? m.comments_count),
      saves: num(ins.saved),
      shares: num(ins.shares),
      interactions: num(ins.total_interactions),
      permalink: m.permalink || null,
      source: 'meta',
    };
  });
  return { account: { username: acct.username, followers: acct.followers_count ?? null, mediaCount: acct.media_count ?? null }, posts, fetchedDays: days };
}

async function businessDiscovery(token, igId, username) {
  const u = norm(username).replace(/[^a-z0-9._]/g, '');
  if (!u) throw new MetaError('not_available', 'Username kosong');
  const r = await graph(igId, token, {
    fields: `business_discovery.username(${u}){username,name,followers_count,media_count,media.limit(12){caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink}}`,
  });
  const bd = r.business_discovery;
  if (!bd) throw new MetaError('not_available', 'Akun tidak tersedia');
  const media = (bd.media?.data || []).map((m) => ({
    caption: (m.caption || '').replace(/\s+/g, ' ').slice(0, 80), likes: m.like_count ?? null, comments: m.comments_count ?? null,
    date: m.timestamp ? jakartaDate(m.timestamp) : null, type: mapType(m), permalink: m.permalink || null,
  }));
  return { username: bd.username, name: bd.name || '', followers: bd.followers_count ?? null, mediaCount: bd.media_count ?? null, recent: media };
}

module.exports = { MetaError, ADVICE, REQUIRED_PERMS, testConnection, syncAccount, businessDiscovery, jakartaDate, norm, classify, pool };
