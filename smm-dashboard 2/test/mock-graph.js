'use strict';
// Mock Meta Graph API + RSS Google Trends untuk pengujian lokal (bukan data asli).
const http = require('node:http');
const PORT = Number(process.env.MOCK_PORT) || 4555;
const today = new Date();
const iso = (d) => new Date(today.getTime() - d * 864e5).toISOString().replace('Z', '+0000');
const MEDIA = [0, 1, 4, 6, 9, 12, 20, 33].map((d, i) => ({ id: 'm' + i, caption: `Mock post ${i} tentang jerawat`, media_type: i % 3 === 0 ? 'CAROUSEL_ALBUM' : 'VIDEO', media_product_type: i % 3 === 0 ? 'FEED' : 'REELS', timestamp: iso(d), permalink: `https://www.instagram.com/p/mock${i}/`, like_count: 100 + i * 10, comments_count: 5 + i }));
const err = (res, code, sub, msg) => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: msg, type: 'OAuthException', code, error_subcode: sub } })); };
const ok = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const RSS = `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss"><channel>
<item><title>sunscreen viral</title><ht:approx_traffic>2000+</ht:approx_traffic><pubDate>Tue, 25 Nov 2026 03:00:00 +0700</pubDate><ht:news_item><ht:news_item_title>Tren sunscreen &amp; jerawat</ht:news_item_title><ht:news_item_url>https://example.com/a</ht:news_item_url><ht:news_item_source>Contoh</ht:news_item_source></ht:news_item></item>
<item><title>timnas indonesia</title><ht:approx_traffic>100000+</ht:approx_traffic><pubDate>Tue, 25 Nov 2026 02:00:00 +0700</pubDate></item>
<item><title>bekas jerawat cara hilangkan</title><ht:approx_traffic>500+</ht:approx_traffic><pubDate>Tue, 25 Nov 2026 01:00:00 +0700</pubDate></item>
</channel></rss>`;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/threads/')) return threadsMock(req, res, u);
  if (u.pathname.startsWith('/tiktok/')) return tiktokMock(req, res, u);
  if (u.pathname === '/rss') { res.writeHead(200, { 'Content-Type': 'application/rss+xml' }); return res.end(RSS); }
  const tok = u.searchParams.get('access_token') || '';
  const p = u.pathname.replace(/^\/v[\d.]+\//, '');
  if (tok.startsWith('DOWN')) return req.socket.destroy();
  if (tok.startsWith('EXPIRED')) return err(res, 190, 463, 'Error validating access token: Session has expired');
  if (tok.startsWith('BAD')) return err(res, 190, 0, 'Invalid OAuth access token');
  if (p === 'me') return ok(res, { id: '1', name: 'Tester ERHA' });
  if (p === 'me/permissions') {
    const all = ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_manage_insights'];
    return ok(res, { data: (tok.startsWith('NOPERM') ? all.slice(0, 2) : all).map((x) => ({ permission: x, status: 'granted' })) });
  }
  if (p === 'me/accounts') {
    if (tok.startsWith('NOPAGE')) return ok(res, { data: [] });
    if (tok.startsWith('NOIG')) return ok(res, { data: [{ id: 'p0', name: 'Page tanpa IG' }] });
    return ok(res, { data: [
      { id: 'p1', name: 'ERHA AcneAct Page', instagram_business_account: { id: 'ig_acn', username: 'erha_acneact', followers_count: 215432 } },
      { id: 'p2', name: 'ERHAIR Page', instagram_business_account: { id: 'ig_hair', username: 'erhair_official', followers_count: 97001 } },
    ] });
  }
  if (p === 'ig_acn' || p === 'ig_hair') {
    const f = u.searchParams.get('fields') || '';
    if (f.startsWith('business_discovery')) {
      const name = (f.match(/username\(([^)]+)\)/) || [])[1];
      if (name === 'skintific_id') return ok(res, { business_discovery: { username: 'skintific_id', name: 'Skintific', followers_count: 1200000, media_count: 2100, media: { data: [{ caption: 'Mock kompetitor', like_count: 3400, comments_count: 120, timestamp: iso(1), media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://www.instagram.com/p/k1/' }, { caption: 'Mock 2', like_count: 1500, comments_count: 40, timestamp: iso(3), media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/k2/' }] } } });
      return err(res, 110, 2207013, 'Cannot find User using provided username');
    }
    return ok(res, { username: p === 'ig_acn' ? 'erha_acneact' : 'erhair_official', followers_count: p === 'ig_acn' ? 215432 : 97001, media_count: 800 });
  }
  if (/^ig_(acn|hair)\/media$/.test(p)) return ok(res, { data: MEDIA, paging: { cursors: { after: 'x' } } });
  const mi = p.match(/^(m\d+)\/insights$/);
  if (mi) {
    const metric = u.searchParams.get('metric');
    const i = +mi[1].slice(1);
    if (i === 3 && metric.includes(',')) return err(res, 100, 0, '(#100) The Media Insights API does not support the views metric for this media product type'); // uji fallback
    if (i === 3 && metric === 'views') return err(res, 100, 0, 'unsupported');
    const val = { reach: 2000 + i * 300, views: 3000 + i * 500, likes: 100 + i * 10, comments: 5 + i, shares: 10 + i, saved: i === 2 ? 0 : 20 + i, total_interactions: 135 + i * 12 + (i === 2 ? -20 - i : 0) };
    return ok(res, { data: metric.split(',').map((m) => ({ name: m, period: 'lifetime', values: [{ value: val[m] }] })) });
  }
  return err(res, 100, 0, 'Unknown path ' + p);
}).listen(PORT, () => console.log('mock graph on', PORT));

// ---- Threads mock
function threadsMock(req, res, u) {
  const tok = u.searchParams.get('access_token') || '', p = u.pathname.replace(/^\/threads\/(v1\.0\/)?/, '');
  if (tok.startsWith('THEXP')) return err(res, 190, 463, 'Session has expired');
  if (p === 'refresh_access_token') return ok(res, { access_token: tok, token_type: 'bearer', expires_in: 5183944 });
  if (p === 'me') return ok(res, { id: 't1', username: tok.startsWith('THOTHER') ? 'akun_lain' : 'erha_acneact' });
  if (p === 'me/threads_insights') { if (tok.startsWith('THNOINS')) return err(res, 10, 0, 'Application does not have permission'); return ok(res, { data: [{ name: 'followers_count', period: 'day', total_value: { value: 30500 } }] }); }
  if (p === 'me/threads') return ok(res, { data: [0, 2, 5, 8, 11].map((d, i) => ({ id: 'tp' + i, text: `Thread mock ${i} soal jerawat`, media_type: i === 1 ? 'IMAGE' : 'TEXT_POST', timestamp: iso(d), permalink: `https://www.threads.com/@erha_acneact/post/m${i}`, is_quote_post: false })).concat([{ id: 'rp', media_type: 'REPOST_FACADE', timestamp: iso(1) }]) });
  const mi = p.match(/^tp(\d+)\/insights$/);
  if (mi) { const i = +mi[1], v = { views: 4000 + i * 700, likes: 120 + i * 9, replies: 14 + i, reposts: 6 + i, quotes: i === 0 ? 0 : 2, shares: 3 }; return ok(res, { data: (u.searchParams.get('metric') || '').split(',').map((m) => ({ name: m, period: 'lifetime', values: [{ value: v[m] }] })) }); }
  return err(res, 100, 0, 'Unknown threads path ' + p);
}
// ---- TikTok mock
function tiktokMock(req, res, u) {
  const p = u.pathname.replace(/^\/tiktok/, '');
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  const tt = (code, status = 200, data = {}) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data, error: { code, message: code, log_id: 'x' } })); };
  if (p === '/v2/oauth/token/') {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const f = new URLSearchParams(body);
      if (f.get('refresh_token') === 'RTGOOD_1234567890' || f.get('code') === 'CODEGOOD') return ok(res, { access_token: 'TTGOOD_refreshed_123456', expires_in: 86400, refresh_token: 'RTGOOD_1234567890', refresh_expires_in: 31536000, open_id: 'o1', scope: 'user.info.basic,user.info.stats,video.list', token_type: 'Bearer' });
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token is invalid or expired' }));
    }); return;
  }
  if (auth.startsWith('TTEXP')) return tt('access_token_invalid', 401);
  if (auth.startsWith('TTNOSCOPE') && p === '/v2/user/info/') return tt('scope_not_authorized', 403);
  if (p === '/v2/user/info/') return tt('ok', 200, { user: { open_id: 'o1', display_name: 'ERHA AcneAct', follower_count: 120400, video_count: 300, likes_count: 900000 } });
  if (p === '/v2/video/list/') {
    const now = Math.floor(Date.now() / 1000);
    return tt('ok', 200, { videos: [0, 1, 3, 4, 7, 9].map((d, i) => ({ id: 'v' + i, title: `TikTok mock ${i}`, create_time: now - d * 86400 - 3600, share_url: `https://www.tiktok.com/@erha/video/${i}`, view_count: 20000 + i * 5000, like_count: 1500 + i * 100, comment_count: 40 + i, share_count: i === 2 ? 0 : 60 + i })), cursor: 0, has_more: false });
  }
  return tt('invalid_params', 400);
}
