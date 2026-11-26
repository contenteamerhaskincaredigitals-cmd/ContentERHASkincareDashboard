/* Social Media Monitoring — ERHASkincare, ERHAIR & Hiserha
   Platform: Instagram, TikTok, Threads + tampilan gabungan "Semua".
   Satu file frontend untuk tiga cara jalan:
   - server  : dijalankan oleh server.js (login, data di SQLite, koneksi live Meta/Threads/TikTok + auto-sinkron)
   - artifact: dipublish di claude.ai (data tersimpan privat per akun lewat capability db)
   - file    : index.html dibuka langsung (data di localStorage browser ini saja)
   Bahasa: Indonesia (default) & English — L('teks id', 'english text'). */
{
'use strict';

// ================= state & bahasa =================
const S = { view: 'ringkasan', period: 30, brand: null, calMonth: null, repPreset: '30', trends: null, lang: 'id', plat: 'ig', srcPlat: 'ig', live: null, kvVersion: null, plStatus: null };
try { const l = localStorage.getItem('smm-lang'); if (l === 'en' || l === 'id') S.lang = l; const p = localStorage.getItem('smm-plat'); if (['ig', 'tiktok', 'threads', 'all'].includes(p)) S.plat = p; } catch {}
const L = (id, en) => (S.lang === 'en' ? en : id);
const LOC = () => (S.lang === 'en' ? 'en-GB' : 'id-ID');

// ================= util =================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'Asia/Jakarta';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
S.calMonth = today().slice(0, 7);
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const fmtN = (v) => (v == null || Number.isNaN(v) ? '–' : new Intl.NumberFormat(LOC()).format(Math.round(v)));
const fmtC = (v) => (v == null ? '–' : new Intl.NumberFormat(LOC(), { notation: 'compact', maximumFractionDigits: 1 }).format(v));
const dec = (v, d) => (S.lang === 'en' ? v.toFixed(d) : v.toFixed(d).replace('.', ','));
const fmtPct = (v, d = 2) => (v == null || !isFinite(v) ? '–' : dec(v, d) + '%');
const fmtPP = (v) => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + dec(v, 2) + L(' poin persentase', ' percentage points'));
const fmtD = (d, opt = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString(LOC(), { ...opt, timeZone: 'UTC' }) : '–');
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString(LOC(), { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB' : '–');
const fmtT = (iso) => (iso ? new Date(iso).toLocaleTimeString(LOC(), { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '–');
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const signed = (v) => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '±') + new Intl.NumberFormat(LOC()).format(Math.abs(Math.round(v))));
const pctChange = (x, y) => (x == null || y == null || y === 0 ? '–' : ((x - y) / y * 100 > 0 ? '+' : '') + dec((x - y) / y * 100, 1) + '%');
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const safeUrl = (u) => (/^https:\/\//i.test(String(u || '')) ? String(u) : null);
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
const sumArr = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((x, y) => x + y, 0) : null; };

function toast(msg, kind = '') {
  const d = document.createElement('div'); d.textContent = msg; if (kind) d.className = kind;
  const box = $('#toast'); while (box.children.length >= 3) box.firstChild.remove();
  box.append(d); setTimeout(() => d.remove(), kind === 'err' ? 6000 : 3200);
}
function applyStatic() {
  document.documentElement.lang = S.lang;
  $$('[data-en]').forEach((el) => { if (el.dataset.id === undefined) el.dataset.id = el.innerHTML; if (S.lang === 'en') el.textContent = el.dataset.en; else el.innerHTML = el.dataset.id; });
  $$('[data-en-ph]').forEach((el) => { if (el.dataset.idPh === undefined) el.dataset.idPh = el.placeholder; el.placeholder = S.lang === 'en' ? el.dataset.enPh : el.dataset.idPh; });
  $$('#lang-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang)));
}

// ================= platform =================
const PLATS = ['ig', 'tiktok', 'threads'];
const PNAME = { ig: 'Instagram', tiktok: 'TikTok', threads: 'Threads' };
const PSHORT = { ig: 'IG', tiktok: 'TT', threads: 'TH' };
const PCOLOR = { ig: '#e1306c', tiktok: '#00a8b5', threads: '#7c3aed' };
const pName = (p) => (p === 'all' ? L('Semua platform', 'All platforms') : PNAME[p]);
const LIVE_SRC = { ig: 'meta', tiktok: 'api', threads: 'api' };
const LIVE_LABEL = { ig: 'Meta Insights', tiktok: 'TikTok API', threads: 'Threads API' };
const srcLabel = (s, plat) => (s === 'demo' ? 'Demo' : s === 'csv' ? 'CSV' : LIVE_LABEL[plat] || 'API');
const commentsLabel = (plat) => (plat === 'threads' ? 'Replies' : plat === 'all' ? L('Komentar/Replies', 'Comments/Replies') : L('Komentar', 'Comments'));
// base = penyebut ER; comps = komponen Total Engagements bila total kosong (semua harus tersedia)
const PM = {
  ig: { base: 'reach', comps: ['likes', 'comments', 'shares', 'saves'], cols: () => [['reach', 'Reach'], ['views', 'Views'], ['likes', 'Likes'], ['comments', commentsLabel('ig')], ['shares', 'Shares'], ['saves', 'Saves']], chart: ['followers', 'engagements', 'views', 'likes', 'comments', 'shares', 'saves'] },
  tiktok: { base: 'views', comps: ['likes', 'comments', 'shares'], cols: () => [['views', 'Views'], ['likes', 'Likes'], ['comments', commentsLabel('tiktok')], ['shares', 'Shares'], ['saves', L('Saves/Favorit', 'Saves/Favourites')]], chart: ['followers', 'engagements', 'views', 'likes', 'comments', 'shares'] },
  threads: { base: 'views', comps: ['likes', 'comments', 'reposts', 'quotes'], cols: () => [['views', 'Views'], ['likes', 'Likes'], ['comments', 'Replies'], ['reposts', 'Reposts'], ['quotes', 'Quotes'], ['shares', 'Shares']], chart: ['followers', 'engagements', 'views', 'likes', 'comments', 'reposts', 'quotes'] },
  all: { cols: () => [['views', 'Views'], ['likes', 'Likes'], ['comments', commentsLabel('all')], ['shares', 'Shares']], chart: ['followers', 'engagements', 'views', 'likes', 'comments'] },
};
const baseOf = (plat) => PM[plat]?.base || 'views';
const erLabel = (plat) => (plat === 'all' ? L('ER gabungan (÷ views)', 'Combined ER (÷ views)') : plat === 'ig' ? L('ER (berbobot, ÷ reach)', 'ER (weighted, ÷ reach)') : L('ER (berbobot, ÷ views)', 'ER (weighted, ÷ views)'));
const curPlat = () => (S.plat === 'all' ? 'ig' : S.plat);

// ================= lingkungan & penyimpanan =================
const HOST = $('meta[name=app-mode]').content === 'server' ? 'server' : (window.claude && typeof window.claude.use === 'function' ? 'artifact' : 'file');
let downloads = null;
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-SMM': '1' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error(L('Sesi habis, silakan login lagi.', 'Session expired, please sign in again.')); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.status = r.status; throw e; }
  return j;
}
const Store = {
  kind: HOST, cache: {}, db: null, uid: null, q: {},
  async init() {
    if (this.kind === 'server') { this.cache = await api('GET', '/api/kv'); return; }
    if (this.kind === 'artifact') {
      try {
        const [db, user] = await Promise.all([withTimeout(window.claude.use('db'), 10000), withTimeout(window.claude.use('user'), 10000)]);
        downloads = await withTimeout(window.claude.use('downloads'), 5000);
        const id = db && user ? await user.id() : null;
        if (db && id) {
          this.db = db; this.uid = id;
          const snap = await withTimeout(db.collection('data/users/' + id).limit(1000).get(), 10000);
          if (snap) { snap.docs.forEach((d) => { const v = d.data(); if (v && typeof v.k === 'string') this.cache[v.k] = v.v; }); return; }
        }
      } catch (e) { console.warn(e); }
      this.kind = 'file';
    }
    try { const raw = localStorage.getItem('smm-store-v1'); if (raw) this.cache = JSON.parse(raw); } catch { this.kind = 'memory'; }
  },
  get(k, d) { return Object.prototype.hasOwnProperty.call(this.cache, k) ? this.cache[k] : d; },
  set(k, v) { this.cache[k] = v; return this._queue(k, v); },
  del(k) { delete this.cache[k]; return this._queue(k, undefined); },
  _queue(k, v) { const p = (this.q[k] || Promise.resolve()).then(() => this._write(k, v)).catch((e) => toast(L('Gagal menyimpan: ', 'Could not save: ') + (e.message || e.code || e), 'err')); this.q[k] = p; return p; },
  async _write(k, v) {
    if (this.kind === 'server') return v === undefined ? api('DELETE', '/api/kv/' + k) : api('PUT', '/api/kv/' + k, { value: v });
    if (this.kind === 'artifact') {
      const ref = this.db.collection('data/users/' + this.uid).doc(k);
      if (v === undefined) return ref.delete();
      if (JSON.stringify(v).length > 240000) throw new Error(L('data terlalu besar untuk satu dokumen (maks ±240 KB). Kurangi baris CSV atau pakai versi server.', 'data too large for one document (max ~240 KB). Use fewer CSV rows or the server version.'));
      return ref.set({ k, v });
    }
    if (this.kind === 'file') localStorage.setItem('smm-store-v1', JSON.stringify(this.cache));
  },
  async reloadServer() { if (this.kind === 'server') this.cache = await api('GET', '/api/kv'); },
};

// ================= brand default =================
const DEFAULT_BRANDS = [
  { id: 'acneact', name: 'ERHA AcneAct', handle: 'ERHA_AcneAct', threads: 'ERHA_AcneAct', tiktok: '', code: 'ACN', color: '#e6261f',
    niche: 'Perawatan kulit berjerawat & bekas jerawat (dermatologist-formulated)', audience: 'Perempuan & laki-laki 18–30 dengan jerawat aktif atau bekas jerawat (PIH), Gen Z – milenial awal',
    keywords: ['jerawat', 'bekas jerawat', 'serum jerawat', 'BHA', 'jerawat hormonal', 'skincare jerawat'], suggest: ['skintific_id', 'somethincofficial', 'azarinecosmetic'] },
  { id: 'erhair', name: 'ERHAIR', handle: 'ERHAIR_Official', threads: 'ERHAIR_Official', tiktok: '', code: 'HAIR', color: '#0a5cff',
    niche: 'Perawatan rambut rontok & kulit kepala (ketombe, hair growth)', audience: 'Pria & wanita 20–40 dengan rambut rontok, rambut tipis, atau ketombe',
    keywords: ['rambut rontok', 'hair tonic', 'ketombe', 'shampoo rambut rontok', 'rambut tipis', 'baby hair'], suggest: ['makarizo.advisor', 'labonhair_id'] },
  { id: 'truwhite', name: 'ERHA Truwhite', handle: 'ERHA_Truwhite', threads: 'ERHA_Truwhite', tiktok: '', code: 'TRW', color: '#ffb400',
    niche: 'Brightening: kulit kusam, flek hitam, warna kulit tidak merata', audience: 'Perempuan 20–35 yang ingin kulit cerah merata, peduli bahan aktif (vitamin C, niacinamide, TXA)',
    keywords: ['flek hitam', 'kulit kusam', 'serum vitamin c', 'niacinamide', 'skincare mencerahkan'], suggest: ['glad2glow', 'theoriginote'] },
  { id: 'agecorrector', name: 'ERHA Agecorrector', handle: 'Erha_Agecorrector', threads: 'Erha_Agecorrector', tiktok: '', code: 'AGE', color: '#7c3aed',
    niche: 'Anti-aging & collagen: garis halus, kekenyalan kulit, regenerasi', audience: 'Perempuan 25–45 yang mulai merawat garis halus dan kekenyalan kulit',
    keywords: ['collagen', 'garis halus', 'kerutan', 'retinol', 'skincare anti aging'], suggest: ['wardahbeauty', 'somethincofficial'] },
  { id: 'skinsitive', name: 'ERHA Skinsitive', handle: 'ERHA_Skinsitive', threads: 'ERHA_Skinsitive', tiktok: '', code: 'SKS', color: '#00a05a',
    niche: 'Kulit sensitif & skin barrier (ceramide, menenangkan kemerahan)', audience: 'Perempuan & laki-laki 18–35 dengan kulit sensitif, mudah merah, atau barrier rusak',
    keywords: ['skin barrier', 'kulit sensitif', 'ceramide', 'kulit kemerahan', 'moisturizer kulit sensitif'], suggest: ['skintific_id', 'cosrx'] },
  { id: 'perfectshield', name: 'ERHA Perfect Shield', handle: 'ERHA_Perfectshield', threads: 'ERHA_Perfectshield', tiktok: '', code: 'PSH', color: '#ff7a00',
    niche: 'Sunscreen & perlindungan UV harian', audience: 'Perempuan & laki-laki 18–35 dengan aktivitas outdoor, butuh sunscreen ringan & nyaman',
    keywords: ['sunscreen', 'sunscreen spf 50', 'tabir surya', 'reapply sunscreen', 'sunscreen kulit berminyak'], suggest: ['azarinecosmetic', 'skin1004.indonesia'] },
  { id: 'hiserha', name: 'Hiserha', handle: 'Hisherha.official', threads: 'Hisherha.official', tiktok: '', code: 'HIS', color: '#0f9fb5',
    niche: "Men's grooming: rambut, wajah, dan badan pria", audience: 'Pria 18–35 yang mulai rutin grooming (rambut rontok/uban, facial wash, jerawat badan)',
    keywords: ['skincare pria', 'facial wash pria', 'rambut rontok pria', 'uban', 'jerawat punggung'], suggest: ['kahfi.id', 'menspotion'] },
];
const FORMATS = ['Reels', 'Carousel', 'Image', 'Video', 'Story', 'Live', 'TikTok', 'Threads'];
const STATUSES = ['Ide', 'Brief', 'Produksi', 'Review', 'Terjadwal', 'Tayang'];
const STATUS_EN = { Ide: 'Idea', Brief: 'Brief', Produksi: 'Production', Review: 'Review', Terjadwal: 'Scheduled', Tayang: 'Published' };
const stLabel = (s) => L(s, STATUS_EN[s] || s);
const SOURCES_IDEA = ['Posting performa', 'Riset tren', 'Trending Now', 'Kompetitor', 'Brainstorm', 'Lainnya'];
const SOURCE_EN = { 'Posting performa': 'Post performance', 'Riset tren': 'Trend research', 'Trending Now': 'Trending Now', Kompetitor: 'Competitor', Brainstorm: 'Brainstorm', Lainnya: 'Other' };
const ideaSrcLabel = (s) => (s ? L(s, SOURCE_EN[s] || s) : '–');
const LEAD_STATUS = ['Inquiry', 'Qualified', 'Booked', 'Closed'];
const settings = () => Store.get('settings', null);
const brands = () => (settings()?.brands || DEFAULT_BRANDS).map((b) => ({ threads: b.handle, tiktok: '', ...b }));
const bk = (k, b = S.brand) => `b:${b.id}:${k}`;
const pk = (k, plat = curPlat(), b = S.brand) => (plat === 'ig' ? `b:${b.id}:${k}` : `b:${b.id}:${plat}:${k}`);
const handleOf = (b, plat) => String((plat === 'ig' ? b.handle : b[plat]) || '').replace(/^@/, '');

// ================= data demo (deterministik, ditandai Demo) =================
const DEMO_BASE = { acneact: 212000, erhair: 96000, truwhite: 158000, agecorrector: 87000, skinsitive: 63000, perfectshield: 118000, hiserha: 41000 };
const PLAT_SCALE = { ig: 1, tiktok: 0.7, threads: 0.18 };
const DEMO_TOPICS = {
  acneact: ['Decode jerawat hormonal: kenapa muncul di dagu', '3 kesalahan pakai BHA yang bikin breakout', 'Bekas jerawat merah vs hitam: beda cara rawat', 'Rutinitas malam kulit berjerawat (step by step)', 'Mitos: odol bisa keringkan jerawat?', 'Jerawat punggung: penyebab & cara rawat', 'Post Acne Spot Serum: 2 minggu pemakaian', 'Kenapa skincare "buat semua orang" bikin jerawat balik', 'Dr. Act jawab DM: purging atau breakout?', 'Totol jerawat yang benar'],
  erhair: ['Rontok 100 helai sehari: normal atau tidak?', 'Cara pakai hair tonic biar nyerap', 'Ketombe kering vs berminyak', 'Baby hair mulai tumbuh: timeline realistis', 'Kesalahan keramas yang bikin rontok', 'Rambut rontok setelah melahirkan', 'Kopexil & ginseng: kerjanya gimana', 'Styling aman dari panas 220°C', 'Rontok karena stres: yang bisa dilakukan', 'Shampoo vs tonic: mana duluan'],
  truwhite: ['Beyond the surface: kenapa kusam balik lagi', 'Vitamin C oksidasi: tanda & cara simpan', 'Flek hitam vs bekas jerawat', 'Layering niacinamide + vitamin C', 'Airless pump: kenapa penting', 'Rutinitas pagi biar cerah merata', 'TXA untuk flek: mitos & fakta', 'Night cream: kapan mulai pakai', 'Leher lebih gelap dari wajah?', 'Kulit cerah bukan berarti putih'],
  agecorrector: ['Nabung collagen sejak 25', 'Garis halus pertama: jangan panik', 'Retinol pemula: frekuensi aman', 'Galactomyces essence: buat apa', 'Saldo collagen bocor karena UV', 'Rutinitas malam regenerasi', 'Peptide vs retinol', 'Kantong mata & area mata', 'Kenyal itu soal hidrasi juga', 'Mulai anti-aging tanpa ribet'],
  skinsitive: ['Tanda skin barrier rusak', 'Kulit merah setelah ganti skincare', 'Ceramide: penjaga gerbang kulit', 'Patch test yang benar', 'Over-exfoliation: cara pulihkan', 'Moisturizer untuk kulit sensitif berminyak', 'Fragrance-free kenapa penting', 'Rutinitas minimalis 3 langkah', 'Alarm darurat kulit: perih & gatal', 'Sensitif vs alergi'],
  perfectshield: ['Reapply sunscreen di atas makeup', 'SPF 30 vs 50: bedanya', '2 jari sunscreen: cukup?', 'Sunscreen di dalam ruangan perlu?', 'Celah perlindungan: telinga & leher', 'Sunscreen kulit berminyak anti-cakey', 'UV indeks Jakarta hari ini', 'Shield in every sun moment', 'Sunscreen pria: tanpa whitecast', 'Mitos: kulit gelap tak perlu sunscreen'],
  hiserha: ['Rutinitas grooming pria 5 menit', 'Uban di usia 20-an', 'Facial wash pria: pilih sesuai kulit', 'Rambut rontok pria: tanda awal', 'Jerawat punggung habis gym', 'Hair dust: volume tanpa lengket', 'Kulit kusam karena begadang', 'Grooming sebelum interview', 'Body wash untuk keringat berlebih', 'Hair tonic untuk pria sibuk'],
};
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const demoCache = {};
function demoData(b, plat = 'ig') {
  const key = b.id + plat + today();
  if (demoCache[key]) return demoCache[key];
  const t = today(), base = (DEMO_BASE[b.id] || 50000) * PLAT_SCALE[plat], topics = DEMO_TOPICS[b.id] || DEMO_TOPICS.acneact;
  const posts = [], seedP = plat === 'ig' ? '' : plat;
  for (let i = 0; i < 120; i++) {
    const d = addDays(t, -i), r = rng(hashStr(b.id + seedP + d));
    if (r() > (plat === 'threads' ? 0.6 : 0.5)) continue;
    const matur = Math.min(1, 0.35 + i * 0.22), x = r(), pick = topics[Math.floor(r() * topics.length)];
    let p;
    if (plat === 'ig') {
      const type = x < 0.45 ? 'Reels' : x < 0.8 ? 'Carousel' : 'Image';
      const reach = Math.round(base * (0.04 + r() * 0.16) * (type === 'Reels' ? 1.4 : 1) * (r() < 0.07 ? 3.2 : 1) * matur);
      const views = Math.round(reach * (type === 'Reels' ? 1.7 + r() * 1.3 : 1.1 + r() * 0.5));
      const likes = Math.round(reach * (0.015 + r() * 0.045)), comments = Math.round(reach * (0.0008 + r() * 0.005));
      const saves = Math.round(reach * (type === 'Carousel' ? 0.008 + r() * 0.03 : 0.002 + r() * 0.012)), shares = Math.round(reach * (0.001 + r() * 0.009));
      p = { id: 'demo_' + b.id + '_' + d, title: pick, type, date: d, views, reach, likes, comments, saves, shares, interactions: likes + comments + saves + shares };
      const q = r(); if (q < 0.08) p.interactions = null; else if (q < 0.11) { p.interactions = null; p.saves = null; }
    } else if (plat === 'tiktok') {
      const type = x < 0.8 ? 'Video' : 'Photo';
      const views = Math.round(base * (0.04 + r() * 0.5) * (r() < 0.08 ? 4 : 1) * matur);
      const likes = Math.round(views * (0.03 + r() * 0.06)), comments = Math.round(views * (0.001 + r() * 0.004)), shares = Math.round(views * (0.001 + r() * 0.006)), saves = Math.round(views * (0.002 + r() * 0.01));
      p = { id: 'demo_tt_' + b.id + '_' + d, title: pick, type, date: d, views, reach: null, likes, comments, shares, saves, interactions: r() < 0.5 ? likes + comments + shares : null };
    } else {
      const type = x < 0.6 ? 'Text' : x < 0.85 ? 'Image' : 'Carousel';
      const views = Math.round(base * (0.05 + r() * 0.35) * (r() < 0.06 ? 3.5 : 1) * matur);
      const likes = Math.round(views * (0.02 + r() * 0.05)), comments = Math.round(views * (0.003 + r() * 0.012)), reposts = Math.round(views * (0.001 + r() * 0.005)), quotes = Math.round(views * r() * 0.002), shares = Math.round(views * r() * 0.003);
      p = { id: 'demo_th_' + b.id + '_' + d, title: pick, type, date: d, views, reach: null, likes, comments, reposts, quotes, shares, saves: null, interactions: null };
    }
    p.permalink = null; p.source = 'demo'; posts.push(p);
  }
  const snaps = [], r2 = rng(hashStr(b.id + seedP + 'followers'));
  let f = base * 0.95;
  for (let i = 59; i >= 0; i--) { f += base * (0.0004 + r2() * 0.0012) * (plat === 'tiktok' ? 1.8 : 1) - (r2() < 0.1 ? base * 0.001 : 0); snaps.push({ date: addDays(t, -i), followers: Math.round(f) }); }
  demoCache[key] = { posts, snaps, coverage: { from: addDays(t, -119), to: t } };
  return demoCache[key];
}

// ================= akses data =================
const source = (b = S.brand, plat = curPlat()) => Store.get(pk('source', plat, b), 'demo');
const tag = (arr, plat) => arr.map((p) => (p.plat === plat ? p : { ...p, plat }));
const postCache = new Map();
function postsOf(b, plat) {
  const s = source(b, plat), raw = s === 'demo' ? demoData(b, plat).posts : Store.get(pk('posts:' + s, plat, b), []);
  const k = b.id + plat + s; const c = postCache.get(k);
  if (c && c.raw === raw) return c.out;
  const out = tag(raw, plat); postCache.set(k, { raw, out }); return out;
}
function posts(b = S.brand, plat = S.plat) { return plat === 'all' ? PLATS.flatMap((p) => postsOf(b, p)) : postsOf(b, plat); }
function snapsOf(b, plat) { const s = source(b, plat); return s === 'demo' ? demoData(b, plat).snaps : Store.get(pk('snaps:' + s, plat, b), []); }
function coverageOf(b, plat) {
  const s = source(b, plat);
  if (s === 'demo') return demoData(b, plat).coverage;
  const c = Store.get(pk('coverage:' + s, plat, b), null); if (c) return c;
  const ps = postsOf(b, plat); if (!ps.length) return null;
  const ds = ps.map((p) => p.date).sort(); return { from: ds[0], to: ds[ds.length - 1] };
}
const lastSyncOf = (b, plat) => Store.get(pk('lastSync:' + source(b, plat), plat, b), null);

const eng = (p) => { if (p.interactions != null) return p.interactions; const a = PM[p.plat || 'ig'].comps.map((c) => p[c]); return a.every((x) => x != null) ? a.reduce((s, x) => s + x, 0) : null; };
const erBase = (p) => p[baseOf(p.plat || 'ig')];
const erOf = (p) => { const e = eng(p), b = erBase(p); return e != null && b > 0 ? (e / b) * 100 : null; };
const erViewsOf = (p) => { const e = eng(p); return e != null && p.views > 0 ? (e / p.views) * 100 : null; };
const erFor = (plat) => (plat === 'all' ? erViewsOf : erOf); // tampilan gabungan: ER selalu ÷ views supaya setara
const sumF = (arr, f) => sumArr(arr.map(f));
function agg(ps) {
  const er = ps.filter((p) => eng(p) != null && erBase(p) > 0), ev = ps.filter((p) => eng(p) != null && p.views > 0);
  return {
    n: ps.length, views: sumF(ps, (p) => p.views), reach: sumF(ps, (p) => p.reach), eng: sumF(ps, eng),
    likes: sumF(ps, (p) => p.likes), comments: sumF(ps, (p) => p.comments), shares: sumF(ps, (p) => p.shares), saves: sumF(ps, (p) => p.saves), reposts: sumF(ps, (p) => p.reposts), quotes: sumF(ps, (p) => p.quotes),
    er: er.length ? (er.reduce((a, p) => a + eng(p), 0) / er.reduce((a, p) => a + erBase(p), 0)) * 100 : null, erN: er.length,
    erV: ev.length ? (ev.reduce((a, p) => a + eng(p), 0) / ev.reduce((a, p) => a + p.views, 0)) * 100 : null, erVN: ev.length,
    engN: ps.filter((p) => eng(p) != null).length,
  };
}
const inRange = (ps, a, b) => ps.filter((p) => p.date >= a && p.date <= b);
function followersAt(sn, a, b) {
  const inP = sn.filter((s) => s.date >= a && s.date <= b && s.followers != null).sort((x, y) => x.date.localeCompare(y.date));
  const before = sn.filter((s) => s.date < a && s.followers != null).sort((x, y) => x.date.localeCompare(y.date)).pop();
  const first = before && diffDays(before.date, a) <= 3 ? before : inP[0];
  return { first: first || null, last: inP[inP.length - 1] || null, list: inP };
}
const fChange = (F) => (F.first && F.last && F.first !== F.last ? F.last.followers - F.first.followers : null);
// followers (per platform atau gabungan) untuk satu periode
function followerStats(plat, a, e) {
  const plats = plat === 'all' ? PLATS : [plat];
  const per = Object.fromEntries(plats.map((p) => [p, followersAt(snapsOf(S.brand, p), a, e)]));
  const last = sumArr(plats.map((p) => per[p].last?.followers ?? null));
  const ch = plats.map((p) => fChange(per[p])).filter((x) => x != null);
  return { per, last, change: ch.length ? ch.reduce((x, y) => x + y, 0) : null, firstDate: plats.map((p) => per[p].first?.date).filter(Boolean).sort()[0] || null, lastDate: plats.map((p) => per[p].last?.date).filter(Boolean).sort().pop() || null };
}

// ================= navigasi =================
const VIEWS = () => [['ringkasan', L('Ringkasan', 'Overview')], ['konten', L('Performa konten', 'Content performance')], ['nextsteps', 'Next Steps'], ['tren', L('Kompetitor & Tren', 'Competitors & Trends')], ['planner', 'Content Planner'], ['laporan', L('Laporan', 'Reports')], ['eksperimen', L('Eksperimen', 'Experiments')], ['leads', 'Leads WhatsApp'], ['sumber', L('Sumber data', 'Data sources')], ['pengaturan', L('Pengaturan', 'Settings')]];
function renderTabs() { $('#tabs').innerHTML = VIEWS().map(([k, l]) => `<button data-v="${k}" aria-current="${k === S.view ? 'page' : 'false'}">${esc(l)}</button>`).join(''); $$('#tabs button').forEach((b) => (b.onclick = () => go(b.dataset.v))); }
function go(v, push = true) {
  if (!VIEWS().some(([k]) => k === v)) v = 'ringkasan';
  S.view = v;
  $$('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false'));
  $$('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
  if (push && location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  render();
}
function render() {
  const fn = { ringkasan: rSummary, konten: rContent, nextsteps: rNext, tren: rTrend, planner: rPlanner, laporan: rReport, eksperimen: rExp, leads: rLeads, sumber: rSource, pengaturan: rSettings }[S.view];
  try { fn && fn(); } catch (e) { console.error(e); toast(L('Ada error saat menampilkan: ', 'Display error: ') + e.message, 'err'); }
  rHeader();
}
function rHeader() {
  $$('#plat-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plat === S.plat)));
  const mb = $('#mode-badge');
  if (S.plat === 'all') { mb.className = 'badge b-grey'; mb.textContent = PLATS.map((p) => `${PSHORT[p]}: ${srcLabel(source(S.brand, p), p)}`).join(' · '); }
  else { const s = source(); mb.className = 'badge b-' + (s === 'api' ? 'meta' : s); mb.textContent = 'Mode: ' + srcLabel(s, S.plat); }
  document.documentElement.style.setProperty('--brand', S.brand.color || '#0a5cff');
  const where = { server: L('Data tersimpan di server (login)', 'Data stored on the server (sign-in)'), artifact: L('Data tersimpan privat di akun Claude kamu', 'Data stored privately in your Claude account'), file: L('Data tersimpan di browser ini saja', 'Data stored in this browser only'), memory: L('Penyimpanan browser tidak tersedia — data hilang saat reload', 'Browser storage unavailable — data is lost on reload') }[Store.kind];
  const handles = (S.plat === 'all' ? PLATS : [S.plat]).map((p) => `${S.plat === 'all' ? PSHORT[p] + ' ' : ''}${handleOf(S.brand, p) ? '@' + handleOf(S.brand, p) : L('(username belum diisi)', '(username not set)')}`).join(' · ');
  $('#env-line').textContent = `${S.brand.name} · ${handles} · ${where} · ${L('Zona waktu WIB', 'Time zone WIB')}`;
  rLivePill();
  $('nav.tabs').style.setProperty('--hh', $('header.top').offsetHeight + 'px');
}

// ================= status live =================
const KIND_LABEL = () => ({ token_expired: L('Token kedaluwarsa', 'Token expired'), token_invalid: L('Token tidak valid', 'Invalid token'), permission: L('Izin kurang', 'Missing permissions'), no_page: L('Facebook Page tidak ditemukan', 'Facebook Page not found'), ig_not_found: L('Akun IG Professional tidak ditemukan', 'IG Professional account not found'), rate_limit: L('Batas API tercapai', 'API rate limit reached'), unreachable: L('API tidak bisa dihubungi', 'API unreachable'), api_error: L('Error dari API', 'API error'), no_token: L('Belum ada token', 'No token yet'), not_available: L('Tidak tersedia via API', 'Not available via API'), config: L('Konfigurasi server belum lengkap', 'Server configuration incomplete'), handle_mismatch: L('Username tidak cocok', 'Username mismatch') });
function liveInfoFor(plat) {
  const s = source(S.brand, plat);
  if (s === 'demo') return { cls: 'b-demo', on: false, text: L('Data contoh · bukan real time', 'Sample data · not live') };
  if (s === 'csv') return { cls: 'b-csv', on: false, text: L('CSV · diperbarui saat impor', 'CSV · updates on import') };
  const lv = S.live;
  if (HOST !== 'server' || !lv) return { cls: 'b-grey', on: false, text: LIVE_LABEL[plat] };
  if (!lv.autoSync) return { cls: 'b-grey', on: false, text: L('Auto-sinkron dimatikan di server', 'Auto-sync disabled on server') };
  if (plat === 'ig' && !lv.hasToken) return { cls: 'b-red', on: false, text: L('Live mati · token belum ada', 'Live off · no token') };
  if (lv.lastError && lv.lastError.plat === plat && lv.lastError.brandId === S.brand.id && ['token_expired', 'token_invalid', 'permission', 'config'].includes(lv.lastError.kind)) return { cls: 'b-red', on: false, text: L('Live berhenti · ', 'Live stopped · ') + (KIND_LABEL()[lv.lastError.kind] || lv.lastError.kind) };
  const br = lv.platforms?.[plat]?.[S.brand.id];
  if (!br) return { cls: 'b-grey', on: false, text: L(`${PNAME[plat]} belum tersambung`, `${PNAME[plat]} not connected`) };
  const running = lv.running && lv.current?.plat === plat && lv.current?.id === S.brand.id;
  return { cls: 'b-meta live-on', on: true, text: running ? L('Live · menyinkron…', 'Live · syncing…') : `Live · ${L('tiap', 'every')} ${lv.minutes} ${L('mnt', 'min')} · ${L('berikutnya', 'next')} ${fmtT(br.nextSync)}` };
}
function rLivePill() {
  const p = $('#live-pill');
  if (S.plat === 'all') {
    const infos = PLATS.map((pl) => [pl, liveInfoFor(pl)]), on = infos.filter(([, i]) => i.on).length;
    p.className = 'badge ' + (on ? 'b-meta live-on' : 'b-grey');
    p.innerHTML = `<span class="live-dot"></span>${esc(on ? `Live ${on}/3 · ` + infos.map(([pl, i]) => `${PSHORT[pl]} ${i.on ? '✓' : '–'}`).join(' ') : L('Tidak ada platform live', 'No live platform'))}`;
    p.title = infos.map(([pl, i]) => `${PNAME[pl]}: ${i.text}`).join('\n'); return;
  }
  const i = liveInfoFor(S.plat);
  p.className = 'badge ' + i.cls; p.title = i.on ? L('Server menarik data otomatis. Data platform bisa tertunda (Meta: hingga 48 jam).', 'The server pulls data automatically. Platform data can be delayed (Meta: up to 48 hours).') : '';
  p.innerHTML = `<span class="live-dot"></span>${esc(i.text)}`;
}
async function pollLive(first = false) {
  if (HOST !== 'server' || !$('#login').hidden) return;
  try {
    const lv = await api('GET', '/api/live');
    const changed = S.kvVersion && lv.version !== S.kvVersion;
    S.live = lv; S.kvVersion = lv.version;
    if (changed && !first) {
      await Store.reloadServer();
      const busy = !$('#modal').hidden || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (!busy && S.view !== 'sumber') render(); else rHeader();
    } else rLivePill();
  } catch {}
}

// ================= grafik SVG =================
const charts = new Map();
const chartRO = new ResizeObserver((es) => es.forEach((e) => charts.get(e.target)?.()));
function mountChart(host, cfg) { if (!charts.has(host)) chartRO.observe(host); const fn = () => drawChart(host, cfg); charts.set(host, fn); fn(); }
// series: [{name,color,values}] — bar: ditumpuk; line: beberapa garis
function drawChart(host, { dates, series, kind, label }) {
  const W = host.clientWidth, H = host.clientHeight; if (!W || !H) return;
  const totals = dates.map((_, i) => sumArr(series.map((s) => s.values[i])));
  const all = kind === 'bar' ? totals.filter((v) => v != null) : series.flatMap((s) => s.values.filter((v) => v != null));
  if (!all.length) { host.innerHTML = `<div class="empty">${esc(L('Belum ada data untuk metrik ini di periode yang dipilih.', 'No data yet for this metric in the selected period.'))}</div>`; return; }
  const narrow = W < 520, l = narrow ? 54 : 62, r = 12, t = 14, b = 30;
  let min = kind === 'line' ? Math.min(...all) : 0, max = Math.max(...all);
  if (kind === 'line') { const pad = (max - min) * 0.15 || Math.max(1, max * 0.01); min = Math.max(0, min - pad); max += pad; }
  if (max === min) max = min + 1;
  const n = dates.length, iw = (W - l - r) / n;
  const x = (i) => l + (i + 0.5) * iw, y = (v) => t + (H - t - b) * (1 - (v - min) / (max - min));
  let s = '';
  for (let k = 0; k <= 4; k++) { const v = min + ((max - min) * k) / 4, yy = y(v); s += `<line x1="${l}" x2="${W - r}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="${l - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(fmtC(v))}</text>`; }
  const step = Math.max(1, Math.ceil(n / (narrow ? 4 : 7)));
  for (let i = 0; i < n; i += step) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(fmtD(dates[i], { day: 'numeric', month: 'short' }))}</text>`;
  if (kind === 'bar') {
    const bw = Math.max(2, Math.min(28, iw * 0.7));
    dates.forEach((d, i) => {
      let acc = 0;
      series.forEach((se) => { const v = se.values[i]; if (v == null || v === 0 && series.length > 1) return; const y0 = y(acc), y1 = y(acc + v); acc += v; s += `<rect x="${x(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(1, y0 - y1)}" rx="${series.length > 1 ? 1 : 3}" fill="${se.color}"><title>${esc(fmtD(d))} · ${esc(se.name)}: ${esc(fmtN(v))} ${esc(label)}</title></rect>`; });
    });
  } else {
    series.forEach((se) => {
      const pts = se.values.map((v, i) => (v == null ? null : [x(i), y(v), v, dates[i]])).filter(Boolean);
      if (!pts.length) return;
      s += `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('')}" fill="none" stroke="${se.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
      pts.forEach((p) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="${pts.length > 40 ? 2 : 3.5}" fill="#fff" stroke="${se.color}" stroke-width="2"><title>${esc(fmtD(p[3]))} · ${esc(se.name)}: ${esc(fmtN(p[2]))} ${esc(label)}</title></circle>`; });
    });
  }
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${s}</svg>`;
}

// ================= 1. RINGKASAN =================
function periodRange(n) { const e = today(); return [addDays(e, -(n - 1)), e]; }
function coverageNotes(n) {
  const [a] = periodRange(n), out = [], plats = S.plat === 'all' ? PLATS : [S.plat], pre = (p) => (S.plat === 'all' ? PNAME[p] + ': ' : '');
  for (const p of plats) {
    const c = coverageOf(S.brand, p);
    if (!c) out.push(pre(p) + L('Belum ada data posting untuk sumber ini. Impor CSV atau sambungkan API di menu Sumber data.', 'No post data for this source yet. Import a CSV or connect the API in Data sources.'));
    else if (c.from > a) out.push(pre(p) + L(`Cakupan posting: data baru tersedia mulai ${fmtD(c.from)} (${diffDays(c.from, today()) + 1} dari ${n} hari periode ini).`, `Post coverage: data only available from ${fmtD(c.from)} (${diffDays(c.from, today()) + 1} of ${n} days in this period).`));
    const sn = snapsOf(S.brand, p).filter((s) => s.followers != null).sort((x, y) => x.date.localeCompare(y.date));
    if (!sn.length) out.push(pre(p) + L('Belum ada snapshot followers.', 'No follower snapshots yet.'));
    else if (sn[0].date > a) out.push(pre(p) + L(`Cakupan followers: snapshot pertama ${fmtD(sn[0].date)}, jadi perubahan followers dihitung dari tanggal itu.`, `Follower coverage: first snapshot ${fmtD(sn[0].date)}, so follower change is counted from that date.`));
  }
  return out;
}
const METRIC_NAME = (m, plat) => ({ followers: 'Followers', engagements: 'Total Engagements', views: 'Views', likes: 'Likes', comments: commentsLabel(plat), shares: 'Shares', saves: 'Saves', reposts: 'Reposts', quotes: 'Quotes' }[m]);
function rSummary() {
  $$('#period-seg button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.p === S.period)));
  const plat = S.plat, single = plat !== 'all', s = single ? source() : null;
  const demoAny = single ? s === 'demo' : PLATS.some((p) => source(S.brand, p) === 'demo');
  $('#demo-banner').innerHTML = demoAny ? `<div class="banner"><p><strong>${esc(single ? L('Ini data contoh, bukan data asli.', 'This is sample data, not real data.') : L('Sebagian platform masih memakai data contoh.', 'Some platforms still use sample data.'))}</strong> ${esc(L('Angka demo dibuat otomatis untuk mencoba dashboard, jadi tidak bergerak real time. Untuk angka asli: impor CSV, atau sambungkan API platform di versi server supaya data tersinkron otomatis tiap beberapa menit.', 'Demo numbers are generated so you can try the dashboard, so they do not move in real time. For real numbers: import a CSV, or connect the platform API in the server version so data syncs automatically every few minutes.'))}</p><button class="primary" id="go-source">${esc(L('Ke Sumber data', 'Go to Data sources'))}</button></div>` : '';
  if (demoAny) $('#go-source').onclick = () => go('sumber');
  const [a, e] = periodRange(S.period);
  $('#range-label').textContent = `${pName(plat)} · ${fmtD(a)} – ${fmtD(e)}`;
  const ls = single ? lastSyncOf(S.brand, plat) : PLATS.map((p) => lastSyncOf(S.brand, p)).filter(Boolean).sort().pop();
  $('#last-sync').textContent = L('Sinkron terakhir: ', 'Last sync: ') + fmtDT(ls);
  $('#sync-btn').textContent = single && s === 'csv' ? L('Impor CSV baru', 'Import new CSV') : (!single || s === 'meta' || s === 'api') ? L('Sinkron sekarang', 'Sync now') : L('Sinkron', 'Sync');
  $('#coverage-note').innerHTML = coverageNotes(S.period).map((t) => `<p class="note" style="margin:6px 0">${esc(t)}</p>`).join('');
  const ps = inRange(posts(), a, e), A = agg(ps), F = followerStats(plat, a, e);
  const shortD = (d) => esc(fmtD(d, { day: 'numeric', month: 'short' }));
  let fSub;
  if (!single) fSub = PLATS.map((p) => `${PSHORT[p]} ${esc(fmtC(F.per[p].last?.followers ?? null))}`).join(' · ') + (F.change != null ? ` · <span class="${F.change >= 0 ? 'up' : 'down'}">${signed(F.change)}</span>` : '');
  else { const P = F.per[plat]; fSub = P.last ? (fChange(P) != null ? `<span class="${fChange(P) >= 0 ? 'up' : 'down'}">${signed(fChange(P))}</span> ${L('sejak', 'since')} ${shortD(P.first.date)}` : `${L('Snapshot', 'Snapshot')} ${esc(fmtD(P.last.date))} · ${L('perubahan butuh ≥2 snapshot', 'change needs ≥2 snapshots')}`) : L('Belum ada snapshot di periode ini', 'No snapshot in this period'); }
  const erVal = single ? A.er : A.erV, erN = single ? A.erN : A.erVN;
  let erSub = erN ? L(`Engagements ÷ ${baseOf(plat === 'all' ? 'tiktok' : plat)} · ${erN} posting`, `Engagements ÷ ${baseOf(plat === 'all' ? 'tiktok' : plat)} · ${erN} posts`) : L(`Butuh posting dengan engagements & ${baseOf(plat === 'all' ? 'tiktok' : plat)} > 0`, `Needs posts with engagements & ${baseOf(plat === 'all' ? 'tiktok' : plat)} > 0`);
  if (!single) erSub += '<br>' + PLATS.map((p) => `${PSHORT[p]} ${esc(fmtPct(agg(ps.filter((x) => x.plat === p)).er))}`).join(' · ');
  $('#kpis').innerHTML = [
    ['Followers', fmtN(F.last), fSub],
    ['Total Engagements', fmtN(A.eng), A.n ? L(`dari ${A.engN} dari ${A.n} posting yang datanya lengkap`, `from ${A.engN} of ${A.n} posts with complete data`) : L('Tidak ada posting di periode ini', 'No posts in this period')],
    ['Total Views', fmtN(A.views), A.n ? L(`${A.n} posting`, `${A.n} posts`) : L('Tidak ada posting di periode ini', 'No posts in this period')],
    [erLabel(plat), fmtPct(erVal), erSub],
  ].map(([l, v, sub]) => `<div class="kpi"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div><div class="sub">${sub}</div></div>`).join('');
  // grafik
  const sel = $('#chart-metric'), avail = PM[plat].chart, cur = avail.includes(sel.value) ? sel.value : 'followers';
  sel.innerHTML = avail.map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${esc(METRIC_NAME(m, plat))}</option>`).join('');
  const m = cur, dates = [];
  for (let d = a; d <= e; d = addDays(d, 1)) dates.push(d);
  const plats = single ? [plat] : PLATS;
  const series = plats.map((p) => {
    if (m === 'followers') { const by = Object.fromEntries(F.per[p].list.map((x) => [x.date, x.followers])); return { name: PNAME[p], color: single ? 'var(--brand)' : PCOLOR[p], values: dates.map((d) => by[d] ?? null) }; }
    const f = m === 'engagements' ? eng : (q) => q[m]; const pp = ps.filter((q) => q.plat === p);
    return { name: PNAME[p], color: single ? 'var(--brand)' : PCOLOR[p], values: dates.map((d) => sumF(pp.filter((q) => q.date === d), f)) };
  });
  const kind = m === 'followers' ? 'line' : 'bar';
  let note = m === 'followers' ? L('Followers dari snapshot bertanggal (satu angka per hari sinkron). Tanggal tanpa snapshot tidak digambar.', 'Followers from dated snapshots (one value per synced day). Dates without a snapshot are not drawn.') + (single && fChange(F.per[plat]) != null ? L(` Perubahan ${signed(fChange(F.per[plat]))} dari ${fmtD(F.per[plat].first.date)} ke ${fmtD(F.per[plat].last.date)}.`, ` Change ${signed(fChange(F.per[plat]))} from ${fmtD(F.per[plat].first.date)} to ${fmtD(F.per[plat].last.date)}.`) : '')
    : L('Dikelompokkan per tanggal posting: tiap batang = total terakhir dari semua posting yang terbit di tanggal tersebut (bukan angka harian). Posting yang datanya kosong tidak dihitung.', 'Grouped by post date: each bar = the latest lifetime total of all posts published that day (not daily figures). Posts with missing data are not counted.');
  if (!single) note += ' ' + L('Batang ditumpuk per platform.', 'Bars are stacked by platform.');
  $('#chart-title').textContent = L('Tren ', 'Trend: ') + METRIC_NAME(m, plat);
  $('#chart-note').textContent = note;
  $('#chart-legend').innerHTML = single ? '' : PLATS.map((p) => `<span style="display:inline-flex;gap:6px;align-items:center"><span style="width:12px;height:12px;border-radius:3px;background:${PCOLOR[p]}"></span>${PNAME[p]}</span>`).join('');
  mountChart($('#main-chart'), { dates, series, kind, label: METRIC_NAME(m, plat).toLowerCase() });
  const erf = erFor(plat), top = ps.filter((p) => erf(p) != null).sort((x, y) => erf(y) - erf(x)).slice(0, 3);
  $('#top-mini').innerHTML = top.length ? postTable(top, false) : `<p class="muted">${esc(L('Belum ada posting dengan data engagements di periode ini.', 'No posts with engagement data in this period yet.'))}</p>`;
  bindPostRows($('#top-mini'));
}

// ================= 2. KONTEN =================
function postTable(ps, full = true, plat = S.plat) {
  const cols = PM[plat].cols(), multi = plat === 'all', erf = erFor(plat);
  return `<table class="stack"><thead><tr>${multi ? '<th>Platform</th>' : ''}<th>${L('Judul / caption', 'Title / caption')}</th><th>${L('Tanggal', 'Date')}</th><th>Format</th>${cols.map(([, l]) => `<th class="n">${esc(l)}</th>`).join('')}<th class="n">Total Eng.</th><th class="n" title="${esc(erLabel(plat))}">${multi ? 'ER (÷ views)' : 'ER'}</th>${full ? '<th>Link</th>' : ''}</tr></thead><tbody>${ps.map((p) => `<tr class="click" data-id="${esc(p.id)}" tabindex="0">${multi ? `<td><span class="pill" style="background:${PCOLOR[p.plat]}22;color:${PCOLOR[p.plat]}">${PNAME[p.plat]}</span></td>` : ''}<td class="t-title">${esc(p.title)}</td><td style="white-space:nowrap">${esc(fmtD(p.date))}</td><td>${esc(p.type)}</td>${cols.map(([k]) => `<td class="n">${fmtN(p[k])}</td>`).join('')}<td class="n">${fmtN(eng(p))}</td><td class="n">${fmtPct(erf(p))}</td>${full ? `<td>${safeUrl(p.permalink) ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener">${L('Buka', 'Open')}</a>` : '–'}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
function bindPostRows(root) {
  $$('tr.click', root).forEach((tr) => {
    const open = (ev) => { if (ev.target.closest('a')) return; const p = posts().find((x) => x.id === tr.dataset.id); if (p) postDetail(p); };
    tr.addEventListener('click', open); tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(ev); });
  });
}
function filteredPosts() {
  const q = $('#k-search').value.trim().toLowerCase(), t = $('#k-type').value || 'all', per = $('#k-period').value, [sk, dir] = $('#k-sort').value.split(':');
  let ps = posts();
  if (q) ps = ps.filter((p) => String(p.title).toLowerCase().includes(q));
  if (t !== 'all') ps = ps.filter((p) => p.type === t);
  if (per !== 'all') { const [a, e] = periodRange(+per); ps = inRange(ps, a, e); }
  const val = (p) => (sk === 'date' ? p.date : sk === 'eng' ? eng(p) : sk === 'er' ? erFor(S.plat)(p) : p[sk]);
  return [...ps].sort((x, y) => { const a = val(x), b = val(y); if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1; return (a < b ? -1 : a > b ? 1 : 0) * (dir === 'asc' ? 1 : -1); });
}
function rContent() {
  const types = [...new Set(posts().map((p) => p.type))].sort(), cur = $('#k-type').value || 'all';
  $('#k-type').innerHTML = `<option value="all">${L('Semua format', 'All formats')}</option>` + types.map((t) => `<option ${t === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const ps = filteredPosts(), srcTxt = S.plat === 'all' ? pName('all') : srcLabel(source(), S.plat);
  $('#k-count').textContent = L(`${ps.length} posting · ${pName(S.plat)} · sumber: ${srcTxt} · klik baris untuk detail & analisis`, `${ps.length} posts · ${pName(S.plat)} · source: ${srcTxt} · click a row for details & analysis`);
  const host = $('#k-table');
  host.innerHTML = ps.length ? postTable(ps).replace(/^<table class="stack">|<\/table>$/g, '') : `<tbody><tr><td class="muted" style="padding:24px">${esc(L('Belum ada posting yang cocok. ', 'No matching posts. ') + (posts().length ? L('Ubah filter pencarian.', 'Change the filters.') : L('Impor CSV atau pilih sumber data lain di menu Sumber data.', 'Import a CSV or choose another source in Data sources.')))}</td></tr></tbody>`;
  bindPostRows(host);
}
function ageBucket(d) { return d < 3 ? 0 : d <= 7 ? 1 : d <= 30 ? 2 : 3; }
const bucketLabel = (b) => [L('kurang dari 3 hari', 'under 3 days'), L('3–7 hari', '3–7 days'), L('8–30 hari', '8–30 days'), L('lebih dari 30 hari', 'over 30 days')][b];
function insightFor(p, all = posts()) {
  const plat = p.plat || 'ig', bk_ = baseOf(plat), BN = bk_ === 'reach' ? 'Reach' : 'Views';
  const t = today(), age = diffDays(p.date, t), bucket = ageBucket(age);
  const peers = all.filter((q) => q.id !== p.id && (q.plat || 'ig') === plat && q.type === p.type && ageBucket(diffDays(q.date, t)) === bucket);
  const pr = peers.filter((q) => q[bk_] != null), pe = peers.filter((q) => erOf(q) != null);
  const mR = median(pr.map((q) => q[bk_])), mE = median(pe.map(erOf)), er = erOf(p), bv = p[bk_];
  const rate = (k, q) => (q[k] != null && q[bk_] > 0 ? (q[k] / q[bk_]) * 100 : null);
  const saveRate = rate('saves', p), shareRate = rate('shares', p);
  const mSave = median(peers.map((q) => rate('saves', q)).filter((v) => v != null)), mShare = median(peers.map((q) => rate('shares', q)).filter((v) => v != null));
  const r = { age, bucket: bucketLabel(bucket), peersN: peers.length, mR, mE, er, saveRate, shareRate, mSave, mShare, hyp: [], BN, plat };
  if (age < 3) { r.status = 'baru'; r.label = L('Masih baru', 'Still new'); r.text = L('Cek performa konten 3 hari setelah diposting.', 'Check content performance 3 days after posting.'); return r; }
  if (bv == null) { r.status = 'kurang'; r.label = L('Data belum cukup', 'Not enough data'); r.text = L(`${BN} posting ini kosong, jadi belum bisa dibandingkan.`, `This post has no ${BN.toLowerCase()} value, so it cannot be compared yet.`); return r; }
  if (pr.length < 3) { r.status = 'kurang'; r.label = L('Data pembanding belum cukup', 'Not enough comparison data'); r.text = L(`Baru ada ${pr.length} posting ${p.type} lain dengan umur tayang ${r.bucket}. Butuh minimal 3 untuk dibandingkan.`, `Only ${pr.length} other ${p.type} posts aged ${r.bucket}. At least 3 are needed to compare.`); return r; }
  const low = bv < 0.7 * mR, erLow = er != null && pe.length >= 3 && er < 0.7 * mE;
  const perform = !low && !erLow && (bv >= 1.2 * mR || (er != null && pe.length >= 3 && er >= 1.2 * mE));
  const dist = plat === 'tiktok' ? L('For You Page', 'For You Page') : plat === 'threads' ? L('feed Threads', 'the Threads feed') : 'Explore/Reels';
  if (low) {
    r.status = 'reach'; r.label = bk_ === 'reach' ? L('Reach rendah', 'Low reach') : L('Views rendah', 'Low views'); r.text = `${BN} ${fmtN(bv)} vs median ${fmtN(mR)} (${Math.round((bv / mR) * 100)}%).`;
    r.hyp = [plat === 'threads' ? L('Kalimat pembuka mungkin kurang memancing orang berhenti membaca.', 'The opening line may not make people stop and read.') : L('Hook atau cover di 1–3 detik pertama mungkin kurang menghentikan scroll.', 'The hook or cover in the first 1–3 seconds may not be stopping the scroll.'), L('Jam tayang mungkin tidak pas dengan jam aktif audiens.', 'Posting time may not match when the audience is active.'), L(`Topik mungkin kurang menarik untuk non-follower, jadi distribusi ke ${dist} terbatas.`, `The topic may not appeal to non-followers, limiting distribution to ${dist}.`)];
    if (er != null && mE != null && er >= mE) r.hyp.push(L('ER tetap baik, jadi isi kontennya disukai — masalahnya kemungkinan di distribusi, bukan di isi.', 'ER is still good, so the content itself is liked — the issue is likely distribution, not substance.'));
  } else if (erLow) {
    r.status = 'eng'; r.label = L('Engagement rendah', 'Low engagement'); r.text = `ER ${fmtPct(er)} vs median ${fmtPct(mE)}; ${BN.toLowerCase()} ${fmtN(bv)} vs median ${fmtN(mR)}.`;
    r.hyp = [L('Konten sampai ke orang, tapi CTA mungkin kurang jelas untuk memancing aksi.', 'The content reaches people, but the CTA may be too weak to trigger action.'), plat === 'threads' ? L('Coba akhiri dengan pertanyaan terbuka supaya orang membalas atau me-repost.', 'Try ending with an open question so people reply or repost.') : L('Isi mungkin kurang "layak disimpan" — coba tambah langkah konkret atau checklist.', 'The content may not be "save-worthy" — try concrete steps or a checklist.'), L('Caption/visual mungkin tidak mengundang komentar — coba pertanyaan terbuka.', 'The caption/visual may not invite comments — try an open question.')];
  } else if (perform) {
    r.status = 'perform'; r.label = 'Perform'; r.text = `${BN} ${fmtN(bv)} (median ${fmtN(mR)}), ER ${fmtPct(er)} (median ${fmtPct(mE)}).`;
    r.hyp = [L(`Topik/angle ini kemungkinan resonan dengan audiens ${S.brand.name} di ${PNAME[plat]}.`, `This topic/angle likely resonates with the ${S.brand.name} audience on ${PNAME[plat]}.`), L(`Format ${p.type} tampaknya cocok untuk topik ini.`, `The ${p.type} format seems to suit this topic.`)];
    if (saveRate != null && mSave != null && saveRate > mSave * 1.2) r.hyp.push(L('Save rate di atas median: konten dianggap berguna untuk disimpan.', 'Save rate above median: people find it useful enough to save.'));
    if (shareRate != null && mShare != null && shareRate > mShare * 1.2) r.hyp.push(L('Share rate di atas median: konten relatable dan layak dibagikan.', 'Share rate above median: relatable and share-worthy.'));
  } else { r.status = 'rata'; r.label = L('Sesuai rata-rata', 'Around average'); r.text = `${BN} ${fmtN(bv)} (median ${fmtN(mR)}), ER ${fmtPct(er)} (median ${fmtPct(mE)}).`; r.hyp = [L('Performa mendekati posting sejenis; belum ada sinyal kuat untuk diulang atau diperbaiki.', 'Performance is close to similar posts; no strong signal to repeat or fix yet.')]; }
  return r;
}
const STATUS_BADGE = { perform: 'b-meta', reach: 'b-red', eng: 'b-demo', rata: 'b-grey', kurang: 'b-grey', baru: 'b-csv' };
function postDetail(p) {
  const r = insightFor(p), plat = p.plat || 'ig';
  const metrics = PM[plat].cols().map(([k, l]) => [l, fmtN(p[k])]).concat([['Total Engagements', fmtN(eng(p))], [erLabel(plat), fmtPct(erOf(p))]]);
  if (plat !== 'threads') metrics.push(['Save rate', fmtPct(r.saveRate)]);
  metrics.push(['Share rate', fmtPct(r.shareRate)]);
  openModal(p.title, `
    <p class="muted" style="margin-top:-6px">${esc(PNAME[plat])} · ${esc(fmtD(p.date))} · ${esc(p.type)} · ${esc(L(`umur tayang ${r.age} hari`, `${r.age} days live`))} · ${esc(L('sumber', 'source'))} ${esc(srcLabel(source(S.brand, plat), plat))}</p>
    <div class="mgrid">${metrics.map(([l, v]) => `<div><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    ${p.interactions == null && eng(p) != null ? `<p class="muted" style="font-size:13px">${esc(L('Total Engagements kosong di sumber → dihitung dari ', 'Total Engagements was empty in the source → calculated from ') + PM[plat].comps.map((c) => METRIC_NAME(c, plat).toLowerCase()).join(' + ') + '.')}</p>` : ''}
    <h3 style="margin:16px 0 6px">${L('Analisis', 'Analysis')} <span class="badge ${STATUS_BADGE[r.status]}">${esc(r.label)}</span></h3>
    <p style="margin:0 0 6px">${esc(r.text)}</p>
    <p class="muted" style="font-size:13px;margin:0 0 6px">${esc(L(`Pembanding: ${r.peersN} posting ${PNAME[plat]} ${p.type} lain dengan umur tayang ${r.bucket}. Median ${r.BN.toLowerCase()} ${fmtN(r.mR)} · median ER ${fmtPct(r.mE)} · median share rate ${fmtPct(r.mShare)}.`, `Comparison: ${r.peersN} other ${PNAME[plat]} ${p.type} posts aged ${r.bucket}. Median ${r.BN.toLowerCase()} ${fmtN(r.mR)} · median ER ${fmtPct(r.mE)} · median share rate ${fmtPct(r.mShare)}.`))}</p>
    ${r.hyp.length ? `<p style="font-weight:700;margin:10px 0 4px">${esc(L('Kemungkinan penyebab (hipotesis, perlu dites):', 'Possible causes (hypotheses, to be tested):'))}</p><ul style="margin:0">${r.hyp.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
    ${r.status === 'baru' ? `<p class="note info">${esc(L(`Cek performa konten 3 hari setelah diposting (${fmtD(addDays(p.date, 3))}). Catat ${plat === 'ig' ? 'reach, ER, saves, dan shares' : plat === 'tiktok' ? 'views, ER, shares, dan komentar' : 'views, ER, replies, dan reposts'}.`, `Check content performance 3 days after posting (${fmtD(addDays(p.date, 3))}). Record ${plat === 'ig' ? 'reach, ER, saves, and shares' : plat === 'tiktok' ? 'views, ER, shares, and comments' : 'views, ER, replies, and reposts'}.`))}</p>` : ''}
    <div class="row" style="margin-top:16px">
      <button class="primary" id="pd-idea">${esc(L('Simpan sebagai ide', 'Save as idea'))}</button>
      <button id="pd-exp">${esc(L('Jadikan eksperimen', 'Turn into experiment'))}</button>
      ${safeUrl(p.permalink) ? `<a class="btn" href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc(L('Buka posting', 'Open post'))}</a>` : ''}
    </div>`);
  $('#pd-idea').onclick = () => ideaForm({ title: (r.status === 'perform' ? L('Ulangi angle: ', 'Repeat angle: ') : r.status === 'reach' || r.status === 'eng' ? L('Perbaiki: ', 'Improve: ') : '') + p.title, platform: plat, format: plat === 'tiktok' ? 'TikTok' : plat === 'threads' ? 'Threads' : FORMATS.includes(p.type) ? p.type : 'Reels', source: 'Posting performa', ref: safeUrl(p.permalink) || '', brief: L(`Referensi posting ${PNAME[plat]} ${fmtD(p.date)} (${p.type}). ${r.BN} ${fmtN(erBase(p))}, ER ${fmtPct(erOf(p))}. ${r.label}: ${r.text}`, `Reference ${PNAME[plat]} post ${fmtD(p.date)} (${p.type}). ${r.BN} ${fmtN(erBase(p))}, ER ${fmtPct(erOf(p))}. ${r.label}: ${r.text}`) });
  $('#pd-exp').onclick = () => expForm({ platform: plat, hypothesis: r.status === 'perform' ? L(`Kalau angle ini diulang dengan hook berbeda, ${r.BN.toLowerCase()}/ER akan naik dibanding "${p.title}"`, `If this angle is repeated with a different hook, ${r.BN.toLowerCase()}/ER will rise vs "${p.title}"`) : L(`Kalau hook diperbaiki, ${r.BN.toLowerCase()}/ER akan naik dibanding "${p.title}"`, `If the hook is improved, ${r.BN.toLowerCase()}/ER will rise vs "${p.title}"`), variable: 'Hook', a: { label: p.title, date: p.date, link: safeUrl(p.permalink) || '' } });
}

// ================= NEXT STEPS =================
function rNext() {
  const [a, e] = periodRange(90), all = posts(), ps = inRange(all, a, e);
  const ins = ps.map((p) => ({ p, r: insightFor(p, all) }));
  const card = (t, sub, items, empty) => `<div class="card"><h3>${esc(t)}</h3><p class="muted" style="margin:-4px 0 10px;font-size:13px">${esc(sub)}</p>${items.length ? `<div class="list">${items.join('')}</div>` : `<p class="muted">${esc(empty)}</p>`}</div>`;
  const item = (x, extra = '') => `<div class="idea"><h4>${S.plat === 'all' ? `<span class="pill" style="background:${PCOLOR[x.p.plat]}22;color:${PCOLOR[x.p.plat]}">${PSHORT[x.p.plat]}</span> ` : ''}${esc(x.p.title)}</h4><div class="muted" style="font-size:13px">${esc(fmtD(x.p.date))} · ${esc(x.p.type)} · ${x.r.BN.toLowerCase()} ${fmtN(erBase(x.p))} · ER ${fmtPct(erOf(x.p))} · shares ${fmtN(x.p.shares)}</div>${extra}<div class="row" style="margin-top:6px"><button data-open="${esc(x.p.id)}">${L('Detail', 'Details')}</button><button data-idea="${esc(x.p.id)}">${L('Simpan sebagai ide', 'Save as idea')}</button></div></div>`;
  const repeat = ins.filter((x) => x.r.status === 'perform').sort((x, y) => (erOf(y.p) ?? 0) - (erOf(x.p) ?? 0)).slice(0, 4);
  const fix = ins.filter((x) => x.r.status === 'reach' || x.r.status === 'eng').sort((x, y) => y.p.date.localeCompare(x.p.date)).slice(0, 4);
  const fresh = ins.filter((x) => x.r.status === 'baru');
  const groups = {}; ps.forEach((p) => { const k = p.plat + '|' + p.type; (groups[k] = groups[k] || []).push(p); });
  const tests = [];
  const testCard = (title, body, v, h, plat) => `<div class="idea"><h4>${esc(title)}</h4><div class="muted" style="font-size:13px">${esc(body)}</div><div class="row" style="margin-top:6px"><button data-exp-var="${esc(v)}" data-exp-h="${esc(h)}" data-exp-p="${plat}">${L('Buat eksperimen', 'Create experiment')}</button></div></div>`;
  for (const plat of (S.plat === 'all' ? PLATS : [S.plat])) {
    const ts = Object.entries(groups).filter(([k]) => k.startsWith(plat + '|')).map(([k, arr]) => ({ t: k.split('|')[1], n: arr.length, A: agg(arr) })).filter((x) => x.n >= 3 && x.A.er != null).sort((x, y) => y.A.er - x.A.er);
    const pre = S.plat === 'all' ? PNAME[plat] + ' · ' : '';
    if (ts.length >= 2) { const hi = ts[0], lo = ts[ts.length - 1]; tests.push(testCard(pre + L(`Tes format: ${hi.t} vs ${lo.t}`, `Format test: ${hi.t} vs ${lo.t}`), L(`ER berbobot ${hi.t} ${fmtPct(hi.A.er)} (${hi.n} posting) vs ${lo.t} ${fmtPct(lo.A.er)} (${lo.n} posting). Angkat satu topik yang sama dalam dua format.`, `Weighted ER ${hi.t} ${fmtPct(hi.A.er)} (${hi.n} posts) vs ${lo.t} ${fmtPct(lo.A.er)} (${lo.n} posts). Cover one topic in both formats.`), 'Format', L(`Topik yang sama dalam format ${hi.t} akan menghasilkan ER lebih tinggi daripada ${lo.t}`, `The same topic as ${hi.t} will get a higher ER than as ${lo.t}`), plat)); }
    const fp = fix.filter((x) => x.p.plat === plat);
    if (fp.some((x) => x.r.status === 'reach')) tests.push(testCard(pre + L('Tes hook / cover', 'Hook / cover test'), L(`Ada posting dengan ${baseOf(plat)} di bawah 70% median. Uji 2 versi hook pada topik yang sama: pertanyaan vs pernyataan mengejutkan.`, `Some posts have ${baseOf(plat)} below 70% of the median. Test 2 hook versions on the same topic: question vs surprising statement.`), 'Hook', L(`Hook berbentuk pertanyaan akan menaikkan ${baseOf(plat)} dibanding hook pernyataan`, `A question hook will increase ${baseOf(plat)} compared with a statement hook`), plat));
    if (fp.some((x) => x.r.status === 'eng')) tests.push(testCard(pre + L('Tes CTA', 'CTA test'), L(`Ada posting dengan ${baseOf(plat)} normal tapi ER rendah. Uji dua CTA berbeda (mis. "simpan/bagikan" vs "komen pengalamanmu").`, `Some posts have normal ${baseOf(plat)} but low ER. Test two CTAs (e.g. "save/share" vs "comment your experience").`), 'CTA', L('CTA ajakan berinteraksi akan menaikkan ER', 'An interaction CTA will increase ER'), plat));
  }
  $('#ns-grid').innerHTML =
    card(L('Ulangi', 'Repeat'), L('Posting yang perform dibanding format, platform & umur tayang yang mirip. Ulangi angle-nya dengan variasi baru.', 'Posts that outperform peers of the same platform, format & age. Repeat the angle with a new variation.'), repeat.map((x) => item(x, `<p style="margin:6px 0 0;font-size:14px">${esc(x.r.hyp[0] || '')}</p>`)), L('Belum ada posting yang jelas perform dibanding pembandingnya.', 'No post clearly outperforms its peers yet.')) +
    card(L('Perbaiki', 'Improve'), L('Reach/views atau engagement di bawah 70% median posting sejenis.', 'Reach/views or engagement below 70% of the median for similar posts.'), fix.map((x) => item(x, `<p style="margin:6px 0 0;font-size:14px"><span class="badge ${STATUS_BADGE[x.r.status]}">${esc(x.r.label)}</span> ${esc(x.r.hyp[0] || '')}</p>`)), L('Tidak ada posting dengan reach/engagement jauh di bawah pembanding.', 'No posts far below their peers on reach/engagement.')) +
    card(L('Tes', 'Test'), L('Saran eksperimen satu variabel dari pola data.', 'Single-variable experiment ideas from data patterns.'), tests, L('Belum cukup data per format (minimal 3 posting per format) untuk menyarankan tes.', 'Not enough data per format (at least 3 posts per format) to suggest a test.')) +
    card(L('Konten baru', 'New content'), L('Posting kurang dari 3 hari.', 'Posts less than 3 days old.'), fresh.map((x) => item(x, `<p class="note info" style="margin:6px 0 0">${esc(L(`Cek performa konten 3 hari setelah diposting — ${fmtD(addDays(x.p.date, 3))}. Catat ${x.r.BN.toLowerCase()}, ER, ${x.p.plat === 'threads' ? 'replies, dan reposts' : 'saves, dan shares'}.`, `Check content performance 3 days after posting — ${fmtD(addDays(x.p.date, 3))}. Record ${x.r.BN.toLowerCase()}, ER, ${x.p.plat === 'threads' ? 'replies, and reposts' : 'saves, and shares'}.`))}</p>`)), L('Tidak ada posting baru dalam 3 hari terakhir.', 'No new posts in the last 3 days.'));
  $$('#ns-grid [data-open]').forEach((b) => (b.onclick = () => postDetail(posts().find((p) => p.id === b.dataset.open))));
  $$('#ns-grid [data-idea]').forEach((b) => (b.onclick = () => { const p = posts().find((x) => x.id === b.dataset.idea); ideaForm({ title: p.title, platform: p.plat, source: 'Posting performa', ref: safeUrl(p.permalink) || '', brief: L(`Referensi posting ${PNAME[p.plat]} ${fmtD(p.date)}. ER ${fmtPct(erOf(p))}.`, `Reference ${PNAME[p.plat]} post ${fmtD(p.date)}. ER ${fmtPct(erOf(p))}.`) }); }));
  $$('#ns-grid [data-exp-var]').forEach((b) => (b.onclick = () => expForm({ hypothesis: b.dataset.expH, variable: b.dataset.expVar, platform: b.dataset.expP })));
}

// ================= 3. KOMPETITOR & TREN =================
const trendsUrl = (q) => 'https://trends.google.com/trends/explore?date=' + encodeURIComponent('today 3-m') + '&geo=ID&q=' + encodeURIComponent(q.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5).join(','));
const profileUrl = (plat, u) => (plat === 'ig' ? `https://www.instagram.com/${encodeURIComponent(u)}/` : plat === 'tiktok' ? `https://www.tiktok.com/@${encodeURIComponent(u)}` : `https://www.threads.com/@${encodeURIComponent(u)}`);
const WL_STATUS = () => ({ ok: L('Tersedia via API', 'Available via API'), 'belum dicek': L('belum dicek', 'not checked'), 'butuh versi server': L('butuh versi server', 'needs server version'), 'tidak tersedia via API': L('tidak tersedia via API', 'not available via API'), 'token belum ada': L('token belum ada', 'no token yet'), 'token kedaluwarsa': L('token kedaluwarsa', 'token expired'), 'gagal dicek': L('gagal dicek', 'check failed'), manual: L('dipantau manual', 'tracked manually') });
const wlPlat = () => curPlat();
function rTrend() {
  const plat = wlPlat(), key = pk('watchlist', plat), wl = Store.get(key, []);
  $('#wl-title').textContent = L(`Watchlist kompetitor ${PNAME[plat]}`, `${PNAME[plat]} competitor watchlist`) + (S.plat === 'all' ? L(' (pilih platform di atas untuk ganti)', ' (pick a platform above to switch)') : '');
  const sug = plat === 'ig' ? (S.brand.suggest || []).filter((u) => !wl.some((w) => w.username === u)) : [];
  $('#wl-suggest').innerHTML = sug.map((u) => `<button type="button" data-u="${esc(u)}">+ @${esc(u)}</button>`).join('') + (sug.length ? `<span class="muted" style="font-size:12px;align-self:center">${esc(L('contoh, cek dulu username-nya', 'examples — verify the usernames'))}</span>` : '');
  $$('#wl-suggest [data-u]').forEach((b) => (b.onclick = () => addWatch(b.dataset.u)));
  $('#wl-check-all').hidden = plat !== 'ig';
  $('#wl-note').innerHTML = plat !== 'ig' ? `<p class="note info">${esc(L(`API resmi ${PNAME[plat]} untuk dashboard ini tidak menyediakan data akun kompetitor, jadi watchlist ${PNAME[plat]} dipantau manual: buka profilnya dan catat followers secara berkala supaya pertumbuhannya terlihat.`, `The official ${PNAME[plat]} API used here does not provide competitor account data, so the ${PNAME[plat]} watchlist is tracked manually: open the profile and log followers regularly to see growth.`))}</p>` : HOST === 'server' ? '' : `<p class="note info">${esc(L('Cek otomatis via Business Discovery butuh versi server + token Meta. Di versi ini watchlist tetap tersimpan dan statusnya ditandai.', 'Automatic checks via Business Discovery need the server version + a Meta token. Here the watchlist is still saved and its status is shown.'))}</p>`;
  $('#wl-list').innerHTML = wl.length ? wl.map((w, i) => {
    const d = w.data, st = w.status || 'belum dicek';
    const stb = st === 'ok' ? 'b-meta' : st === 'belum dicek' || st === 'manual' ? 'b-grey' : 'b-red';
    const mL = d ? median((d.recent || []).map((m) => m.likes).filter((v) => v != null)) : null, mC = d ? median((d.recent || []).map((m) => m.comments).filter((v) => v != null)) : null;
    const hist = (w.history || []).slice(-5);
    return `<div class="idea"><div class="row between"><h4 style="margin:0">@${esc(w.username)}</h4><span class="badge ${stb}">${esc(WL_STATUS()[st] || st)}</span></div>
      ${d ? `<div class="mgrid" style="margin-top:8px"><div><span>Followers</span><b>${fmtC(d.followers)}</b></div><div><span>${L('Total posting', 'Total posts')}</span><b>${fmtN(d.mediaCount)}</b></div><div><span>${L('Median likes (12 terbaru)', 'Median likes (latest 12)')}</span><b>${fmtN(mL)}</b></div><div><span>${L('Median komentar', 'Median comments')}</span><b>${fmtN(mC)}</b></div></div>
      <details style="margin-top:6px"><summary style="cursor:pointer">${L('Posting terbaru', 'Latest posts')} (${(d.recent || []).length})</summary><table><tbody>${(d.recent || []).map((m) => `<tr><td>${esc(fmtD(m.date))}</td><td>${esc(m.type)}</td><td class="t-title">${safeUrl(m.permalink) ? `<a href="${esc(m.permalink)}" target="_blank" rel="noopener">${esc(m.caption || L('(tanpa caption)', '(no caption)'))}</a>` : esc(m.caption || L('(tanpa caption)', '(no caption)'))}</td><td class="n">${fmtN(m.likes)} likes</td><td class="n">${fmtN(m.comments)} ${L('kom.', 'com.')}</td></tr>`).join('')}</tbody></table></details>` : ''}
      ${plat !== 'ig' ? `<div class="muted" style="font-size:13px;margin-top:6px">${hist.length ? hist.map((h) => `${esc(fmtD(h.date))}: ${fmtN(h.followers)}`).join(' · ') + (hist.length >= 2 ? ` · <strong>${signed(hist[hist.length - 1].followers - hist[0].followers)}</strong>` : '') : esc(L('Belum ada catatan followers.', 'No follower logs yet.'))}</div><form class="row" data-hist="${i}" style="margin-top:6px"><input type="number" min="0" placeholder="${esc(L('Followers hari ini', "Today's followers"))}" style="width:180px" required><button>${L('Catat', 'Log')}</button></form>` : ''}
      ${w.kind || w.advice ? `<p class="muted" style="font-size:13px;margin:6px 0 0">${esc(w.kind ? adviceFor(w.kind) : w.advice)}</p>` : ''}
      <div class="row" style="margin-top:8px">${w.checkedAt ? `<span class="muted" style="font-size:12px">${L('Dicek', 'Checked')}: ${esc(fmtDT(w.checkedAt))}</span>` : ''}${plat === 'ig' ? `<button data-check="${i}">${L('Cek via API', 'Check via API')}</button>` : ''}<a class="btn" href="${esc(profileUrl(plat, w.username))}" target="_blank" rel="noopener">${L('Buka profil', 'Open profile')}</a><button class="danger" data-rm="${i}">${L('Hapus', 'Remove')}</button></div></div>`;
  }).join('') : `<p class="muted">${esc(L(`Watchlist ${PNAME[plat]} masih kosong. Tambahkan username akun kompetitor.`, `The ${PNAME[plat]} watchlist is empty. Add competitor usernames.`))}</p>`;
  $$('#wl-list [data-rm]').forEach((b) => (b.onclick = async () => { const l = [...Store.get(key, [])]; l.splice(+b.dataset.rm, 1); await Store.set(key, l); rTrend(); }));
  $$('#wl-list [data-check]').forEach((b) => (b.onclick = () => checkWatch(+b.dataset.check)));
  $$('#wl-list [data-hist]').forEach((f) => (f.onsubmit = async (ev) => { ev.preventDefault(); const v = +$('input', f).value; const l = [...Store.get(key, [])], w = { ...l[+f.dataset.hist] }; w.history = (w.history || []).filter((h) => h.date !== today()).concat([{ date: today(), followers: v }]); w.checkedAt = new Date().toISOString(); l[+f.dataset.hist] = w; await Store.set(key, l); toast(L('Followers kompetitor dicatat.', 'Competitor followers logged.')); rTrend(); }));
  $('#kw-chips').innerHTML = (S.brand.keywords || []).map((k) => `<button type="button" data-k="${esc(k)}">${esc(k)}</button>`).join('');
  $$('#kw-chips [data-k]').forEach((b) => (b.onclick = () => { $('#kw-input').value = b.dataset.k; updKw(); }));
  updKw(); rTrendList();
}
function updKw() {
  const q = $('#kw-input').value.trim() || (S.brand.keywords || ['skincare'])[0];
  const url = trendsUrl(q), first = q.split(',')[0].trim();
  $('#kw-go').href = url;
  $('#kw-result').innerHTML = `<p class="muted" style="font-size:13px;margin:0">${esc(L('Google Trends · Indonesia · 90 hari terakhir', 'Google Trends · Indonesia · last 90 days'))}: <strong>${esc(q)}</strong>. ${esc(L('Kalau tab tidak terbuka, pakai link ini:', 'If the tab did not open, use this link:'))}<br><a href="${esc(url)}" target="_blank" rel="noopener" style="overflow-wrap:anywhere">${esc(url)}</a></p>
    <p class="muted" style="font-size:13px;margin:8px 0 0">${esc(L('Cek juga di platform:', 'Also check on the platforms:'))} <a href="https://www.tiktok.com/search?q=${encodeURIComponent(first)}" target="_blank" rel="noopener">${L('Cari di TikTok', 'Search TikTok')}</a> · <a href="https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en" target="_blank" rel="noopener">TikTok Creative Center (${L('tren hashtag', 'hashtag trends')})</a> · <a href="https://www.threads.com/search?q=${encodeURIComponent(first)}" target="_blank" rel="noopener">${L('Cari di Threads', 'Search Threads')}</a> · <a href="https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(first)}" target="_blank" rel="noopener">${L('Cari di Instagram', 'Search Instagram')}</a></p>
    <div class="row" style="margin-top:8px"><button id="kw-idea">${esc(L('Simpan sebagai ide', 'Save as idea'))}</button></div><p class="muted" style="font-size:12px;margin:6px 0 0">${esc(L('Volume & grafik minat dilihat langsung di sumbernya (Google Trends, TikTok Creative Center); dashboard tidak menebak angka.', 'Interest volume & charts are viewed directly at the source (Google Trends, TikTok Creative Center); the dashboard does not guess numbers.'))}</p>`;
  $('#kw-idea').onclick = () => ideaForm({ title: L('Konten tentang "', 'Content about "') + q + '"', source: 'Riset tren', ref: url, brief: L('Dari riset Google Trends Indonesia 90 hari: ', 'From Google Trends Indonesia 90-day research: ') + q });
}
async function addWatch(u) {
  const plat = wlPlat(), key = pk('watchlist', plat);
  u = String(u).trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram|tiktok|threads)\.(com|net)\/@?/i, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(u)) return toast(L('Username tidak valid.', 'Invalid username.'), 'err');
  const l = Store.get(key, []);
  if (l.some((w) => w.username === u)) return toast(L('@' + u + ' sudah ada di watchlist.', '@' + u + ' is already on the watchlist.'));
  await Store.set(key, [...l, { username: u, addedAt: new Date().toISOString(), status: plat !== 'ig' ? 'manual' : HOST === 'server' ? 'belum dicek' : 'butuh versi server' }]);
  toast(L('@' + u + ' ditambahkan.', '@' + u + ' added.')); rTrend();
  if (plat === 'ig' && HOST === 'server') checkWatch(Store.get(key).length - 1);
}
async function checkWatch(i) {
  const key = pk('watchlist', 'ig'), l = [...Store.get(key, [])], w = { ...l[i] };
  if (HOST !== 'server') { w.status = 'butuh versi server'; w.kind = 'needs_server'; }
  else {
    try {
      const r = await api('POST', '/api/meta/discovery', { brandId: S.brand.id, username: w.username });
      if (r.ok) { w.status = 'ok'; w.data = r.data; w.kind = ''; w.advice = ''; }
      else { w.status = r.kind === 'not_available' ? 'tidak tersedia via API' : r.kind === 'no_token' ? 'token belum ada' : r.kind === 'token_expired' ? 'token kedaluwarsa' : 'gagal dicek'; w.kind = r.kind; }
    } catch (e) { w.status = 'gagal dicek'; w.kind = ''; w.advice = e.message; }
  }
  w.checkedAt = new Date().toISOString(); l[i] = w; await Store.set(key, l); rTrend();
}
async function loadTrends() {
  $('#tr-list').innerHTML = `<p class="muted">${esc(L('Memuat feed…', 'Loading feed…'))}</p>`;
  if (HOST !== 'server') { S.trends = { ok: false, err: 'needs_server' }; return rTrendList(); }
  try { S.trends = await api('GET', '/api/trends'); } catch (e) { S.trends = { ok: false, error: e.message }; }
  rTrendList();
}
function rTrendList() {
  const T = S.trends, link = `<a href="https://trends.google.com/trending?geo=ID" target="_blank" rel="noopener">${esc(L('Buka Trending Now Indonesia di Google Trends', 'Open Trending Now Indonesia on Google Trends'))}</a>`;
  if (!T) { $('#tr-list').innerHTML = `<p class="muted">${esc(L('Klik "Muat feed" untuk mengambil topik yang sedang naik di Indonesia.', 'Click "Load feed" to fetch topics rising in Indonesia right now.'))} ${link}</p>`; return; }
  if (!T.ok) {
    const msg = T.err === 'needs_server' ? L('Feed Trending Now diambil lewat server (browser tidak boleh mengambil data Google Trends langsung). Jalankan versi server, atau buka Google Trends langsung.', 'The Trending Now feed is fetched by the server (browsers cannot pull Google Trends data directly). Run the server version, or open Google Trends directly.') : L('Feed Google Trends tidak bisa diakses dari server ini (jaringan diblokir, timeout, atau sumber menolak).', 'The Google Trends feed could not be reached from this server (network blocked, timeout, or the source refused).');
    $('#tr-list').innerHTML = `<p class="note err">${esc(L('Gagal memuat: ', 'Could not load: ') + msg)}</p><p>${link}</p>`; return;
  }
  const kws = (S.brand.keywords || []).map((k) => k.toLowerCase());
  const words = new Set(kws.flatMap((k) => k.split(/\s+/)).filter((w) => w.length > 3));
  let items = T.items.map((it) => { const hay = (it.title + ' ' + it.news.map((n) => n.title).join(' ')).toLowerCase(); const m = kws.filter((k) => hay.includes(k)).concat([...words].filter((w) => hay.includes(w) && !kws.some((k) => k.includes(w) && hay.includes(k)))); return { ...it, match: [...new Set(m)] }; });
  if ($('#tr-only').checked) items = items.filter((x) => x.match.length);
  $('#tr-list').innerHTML = `<p class="muted" style="font-size:13px;margin:0 0 6px">${esc(L(`Sumber: Google Trends RSS (${T.source}) · diambil ${fmtDT(T.fetchedAt)} · angka traffic sesuai sumber.`, `Source: Google Trends RSS (${T.source}) · fetched ${fmtDT(T.fetchedAt)} · traffic figures as reported by the source.`))}</p>` + (items.length ? items.map((it, i) => `<div class="tr-item"><div><strong>${esc(it.title)}</strong> ${it.match.length ? `<span class="badge match">${L('Cocok', 'Match')}: ${esc(it.match.join(', '))}</span>` : ''}<div class="muted" style="font-size:13px">${esc(it.traffic || '–')} ${L('pencarian', 'searches')} · ${esc(it.pubDate || '')}</div>${it.news.map((n) => safeUrl(n.url) ? `<div style="font-size:13px"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">${esc(n.source)}</span></div>` : '').join('')}</div><div class="row" style="flex:none"><a class="btn" href="${esc(trendsUrl(it.title))}" target="_blank" rel="noopener">${L('Telusuri', 'Explore')}</a><button data-tidea="${i}">${L('Simpan sebagai ide', 'Save as idea')}</button></div></div>`).join('') : `<p class="muted">${esc(L('Tidak ada topik trending yang cocok dengan kata kunci brand saat ini. Matikan filter untuk melihat semua.', 'No trending topic matches the brand keywords right now. Turn off the filter to see everything.'))}</p>`);
  $$('#tr-list [data-tidea]').forEach((b) => (b.onclick = () => { const it = items[+b.dataset.tidea]; ideaForm({ title: L('Ide dari tren: ', 'Idea from trend: ') + it.title, source: 'Trending Now', ref: safeUrl(it.news[0]?.url) || trendsUrl(it.title), brief: L(`Trending di Indonesia (${it.traffic || '–'} pencarian).`, `Trending in Indonesia (${it.traffic || '–'} searches).`) }); }));
}

// ================= 4. PLANNER =================
const ideas = () => Store.get(bk('ideas'), []);
const IDEA_PLATS = () => [['ig', 'Instagram'], ['tiktok', 'TikTok'], ['threads', 'Threads'], ['multi', L('Multi-platform', 'Multi-platform')]];
const ideaPlatName = (p) => (IDEA_PLATS().find(([k]) => k === p) || [0, 'Instagram'])[1];
function ideaForm(init = {}) {
  const it = { status: 'Ide', format: 'Reels', platform: S.plat === 'all' ? 'multi' : S.plat, ...init };
  const isNew = !it.id;
  openModal(isNew ? L('Simpan ide', 'Save idea') : L('Edit ide', 'Edit idea'), `<form id="idea-f" class="form">
    <label class="full">${L('Judul', 'Title')}<input name="title" required value="${esc(it.title || '')}"></label>
    <label class="full">Hook<input name="hook" value="${esc(it.hook || '')}" placeholder="${esc(L('Kalimat pembuka 3 detik pertama', 'Opening line for the first 3 seconds'))}"></label>
    <label>Platform<select name="platform">${IDEA_PLATS().map(([k, l]) => `<option value="${k}" ${k === it.platform ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label>Format<select name="format">${FORMATS.map((f) => `<option ${f === it.format ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
    <label>Status<select name="status">${STATUSES.map((f) => `<option value="${f}" ${f === it.status ? 'selected' : ''}>${esc(stLabel(f))}</option>`).join('')}</select></label>
    <label>${L('Tanggal tayang', 'Publish date')}<input type="date" name="date" value="${esc(it.date || '')}"></label>
    <label>CTA<input name="cta" value="${esc(it.cta || '')}"></label>
    <label>${L('Sumber ide', 'Idea source')}<select name="source">${SOURCES_IDEA.map((f) => `<option value="${esc(f)}" ${f === it.source ? 'selected' : ''}>${esc(ideaSrcLabel(f))}</option>`).join('')}</select></label>
    <label class="full">${L('Link referensi', 'Reference link')}<input name="ref" type="url" value="${esc(it.ref || '')}" placeholder="https://…"></label>
    <label class="full">Brief<textarea name="brief">${esc(it.brief || '')}</textarea></label>
    <div class="full row between"><div class="row"><button class="primary">${L('Simpan', 'Save')}</button><button type="button" id="idea-cancel">${L('Batal', 'Cancel')}</button></div>${isNew ? '' : `<button type="button" class="danger" id="idea-del">${L('Hapus ide', 'Delete idea')}</button>`}</div></form>`);
  $('#idea-cancel').onclick = closeModal;
  if (!isNew) $('#idea-del').onclick = async () => { if (await confirmBox(L('Hapus ide "', 'Delete idea "') + it.title + '"?')) { await Store.set(bk('ideas'), ideas().filter((x) => x.id !== it.id)); toast(L('Ide dihapus.', 'Idea deleted.')); render(); } };
  $('#idea-f').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    if (f.date && !isDate(f.date)) return toast(L('Tanggal tidak valid.', 'Invalid date.'), 'err');
    if (f.ref && !/^https?:\/\//i.test(f.ref)) return toast(L('Link referensi harus diawali https://', 'Reference link must start with https://'), 'err');
    const rec = { ...it, ...f, title: f.title.trim(), id: it.id || uid(), updated: new Date().toISOString(), created: it.created || new Date().toISOString() };
    const list = ideas().filter((x) => x.id !== rec.id); list.push(rec);
    await Store.set(bk('ideas'), list); closeModal();
    toast(isNew ? L('Ide tersimpan di bank ide' + (rec.date ? ' & kalender.' : '.'), 'Idea saved to the idea bank' + (rec.date ? ' & calendar.' : '.')) : L('Ide diperbarui.', 'Idea updated.')); render();
  };
}
function rPlanner() {
  const stv = $('#idea-status').value || 'all', fmv = $('#idea-format').value || 'all', plv = $('#idea-plat').value || 'all';
  $('#idea-status').innerHTML = `<option value="all">${L('Semua status', 'All statuses')}</option>` + STATUSES.map((s) => `<option value="${s}" ${s === stv ? 'selected' : ''}>${esc(stLabel(s))}</option>`).join('');
  $('#idea-format').innerHTML = `<option value="all">${L('Semua format', 'All formats')}</option>` + FORMATS.map((s) => `<option ${s === fmv ? 'selected' : ''}>${s}</option>`).join('');
  $('#idea-plat').innerHTML = `<option value="all">${L('Semua platform', 'All platforms')}</option>` + IDEA_PLATS().map(([k, l]) => `<option value="${k}" ${k === plv ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const q = $('#idea-search').value.trim().toLowerCase(), st = $('#idea-status').value, fm = $('#idea-format').value, pl = $('#idea-plat').value, dt = $('#idea-dated').value;
  const pass = (i) => (!q || [i.title, i.hook, i.brief, i.cta].join(' ').toLowerCase().includes(q)) && (st === 'all' || i.status === st) && (fm === 'all' || i.format === fm) && (pl === 'all' || (i.platform || 'ig') === pl);
  const list = ideas().filter((i) => pass(i) && (dt === 'all' || (dt === 'dated' ? !!i.date : !i.date)));
  list.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (b.created || '').localeCompare(a.created || ''));
  const pPill = (p) => { p = p || 'ig'; const c = PCOLOR[p] || '#5d6b85'; return `<span class="pill" style="background:${c}22;color:${c}">${esc(p === 'multi' ? 'Multi' : PSHORT[p])}</span>`; };
  $('#idea-list').innerHTML = list.length ? list.map((i) => `<div class="idea" data-id="${esc(i.id)}" style="cursor:pointer" tabindex="0"><div class="row between"><h4>${pPill(i.platform)} ${esc(i.title)}</h4><span class="pill st-${esc(i.status)}">${esc(stLabel(i.status))}</span></div><div class="muted" style="font-size:13px">${esc(ideaPlatName(i.platform || 'ig'))} · ${esc(i.format)} · ${i.date ? esc(fmtD(i.date)) : L('belum bertanggal', 'no date yet')} · ${esc(ideaSrcLabel(i.source))}${safeUrl(i.ref) ? ` · <a href="${esc(i.ref)}" target="_blank" rel="noopener">${L('referensi', 'reference')}</a>` : ''}</div>${i.hook ? `<div style="font-size:14px;margin-top:4px">Hook: ${esc(i.hook)}</div>` : ''}</div>`).join('') : `<p class="muted">${esc(ideas().length ? L('Tidak ada ide yang cocok dengan filter.', 'No ideas match the filters.') : L('Bank ide masih kosong. Simpan ide dari detail posting, riset tren, atau tombol Tambah ide.', 'The idea bank is empty. Save ideas from post details, trend research, or the Add idea button.'))}</p>`;
  $$('#idea-list [data-id]').forEach((d) => { const o = (ev) => { if (ev.target.closest('a')) return; ideaForm(ideas().find((x) => x.id === d.dataset.id)); }; d.onclick = o; d.onkeydown = (ev) => ev.key === 'Enter' && o(ev); });
  const first = `${S.calMonth}-01`;
  $('#cal-title').textContent = L('Kalender ', 'Calendar: ') + new Date(first + 'T00:00:00Z').toLocaleDateString(LOC(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7, start = addDays(first, -dow), t = today();
  const byDate = {}; ideas().filter(pass).forEach((i) => { if (i.date) (byDate[i.date] = byDate[i.date] || []).push(i); });
  let h = (S.lang === 'en' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']).map((d) => `<div class="dow">${d}</div>`).join('');
  for (let k = 0; k < 42; k++) {
    const d = addDays(start, k); if (k >= 35 && d.slice(0, 7) !== S.calMonth) break;
    h += `<div class="day ${d.slice(0, 7) !== S.calMonth ? 'out' : ''} ${d === t ? 'today' : ''}" data-d="${d}"><span class="dnum">${+d.slice(8)}</span>${(byDate[d] || []).map((i) => `<button class="chip st-${esc(i.status)}" data-id="${esc(i.id)}" title="${esc(ideaPlatName(i.platform || 'ig') + ' · ' + i.title + ' · ' + stLabel(i.status))}" style="border-left:3px solid ${PCOLOR[i.platform] || '#5d6b85'}">${esc(i.title)}</button>`).join('')}</div>`;
  }
  $('#cal').innerHTML = h;
  $$('#cal .day').forEach((d) => (d.onclick = (ev) => { const c = ev.target.closest('.chip'); if (c) ideaForm(ideas().find((x) => x.id === c.dataset.id)); else ideaForm({ date: d.dataset.d, status: 'Terjadwal' }); }));
}

// ================= 5. LAPORAN =================
function repRange() {
  if (S.repPreset !== 'custom') { const [a, e] = periodRange(+S.repPreset); $('#rep-start').value = a; $('#rep-end').value = e; return [a, e]; }
  const a = $('#rep-start').value, e = $('#rep-end').value;
  return isDate(a) && isDate(e) && a <= e ? [a, e] : periodRange(30);
}
function recommendations(cur, all) {
  const out = [], ins = cur.map((p) => ({ p, r: insightFor(p, all) }));
  const perf = ins.filter((x) => x.r.status === 'perform'), low = ins.filter((x) => x.r.status === 'reach'), lowE = ins.filter((x) => x.r.status === 'eng');
  const multi = S.plat === 'all', pre = (p) => (multi ? `[${PNAME[p]}] ` : '');
  if (perf.length) out.push(L(`Ulangi angle dari ${perf.length} posting yang perform, mis. ${pre(perf[0].p.plat)}"${perf[0].p.title}" (${perf[0].p.type}), dengan hook atau visual baru.`, `Repeat the angle of ${perf.length} outperforming posts, e.g. ${pre(perf[0].p.plat)}"${perf[0].p.title}" (${perf[0].p.type}), with a new hook or visual.`));
  for (const plat of (multi ? PLATS : [S.plat])) {
    const byType = {}; cur.filter((p) => p.plat === plat).forEach((p) => (byType[p.type] = byType[p.type] || []).push(p));
    const ts = Object.entries(byType).map(([t, a]) => ({ t, n: a.length, A: agg(a) })).filter((x) => x.A.er != null).sort((a, b) => b.A.er - a.A.er);
    if (ts.length >= 2) out.push(pre(plat) + L(`Format dengan ER berbobot tertinggi: ${ts[0].t} (${fmtPct(ts[0].A.er)}, ${ts[0].n} posting). Pertimbangkan menambah porsinya dan tes satu topik di ${ts[ts.length - 1].t} vs ${ts[0].t}.`, `Format with the highest weighted ER: ${ts[0].t} (${fmtPct(ts[0].A.er)}, ${ts[0].n} posts). Consider increasing its share and test one topic as ${ts[ts.length - 1].t} vs ${ts[0].t}.`));
  }
  if (multi) {
    const pe = PLATS.map((p) => [p, agg(cur.filter((x) => x.plat === p))]).filter(([, A]) => A.n);
    if (pe.length >= 2) { const byV = [...pe].sort((a, b) => (b[1].erV ?? -1) - (a[1].erV ?? -1)); out.push(L(`Berdasarkan ER ÷ views, platform paling responsif periode ini: ${PNAME[byV[0][0]]} (${fmtPct(byV[0][1].erV)}). Pertimbangkan memprioritaskan topik terbaiknya untuk diadaptasi ke platform lain.`, `By ER ÷ views, the most responsive platform this period: ${PNAME[byV[0][0]]} (${fmtPct(byV[0][1].erV)}). Consider adapting its best topics to the other platforms.`)); }
  }
  if (low.length) out.push(L(`${low.length} posting reach/views-nya di bawah 70% median pembanding. Tes hook/cover dan jam tayang lewat Experiment Tracker.`, `${low.length} posts had reach/views below 70% of the peer median. Test hook/cover and posting time in the Experiment Tracker.`));
  if (lowE.length) out.push(L(`${lowE.length} posting distribusinya normal tapi ER rendah. Perjelas CTA dan tambahkan isi yang layak disimpan/dibagikan.`, `${lowE.length} posts had normal distribution but low ER. Sharpen the CTA and add save/share-worthy content.`));
  const igA = agg(cur.filter((p) => p.plat === 'ig'));
  if (igA.saves != null && igA.reach) out.push(L(`Save rate Instagram periode ini ${fmtPct((igA.saves / igA.reach) * 100)}. Konten edukasi bertahap (carousel checklist) biasanya mendorong saves — jadikan target periode berikutnya.`, `Instagram save rate this period: ${fmtPct((igA.saves / igA.reach) * 100)}. Step-by-step educational content (checklist carousels) usually drives saves — set it as next period's target.`));
  if (!out.length) out.push(L('Data belum cukup untuk rekomendasi spesifik. Pastikan metrik terisi dan tambah jumlah posting pembanding.', 'Not enough data for specific recommendations. Make sure metrics are filled in and add more comparable posts.'));
  out.push(L('Untuk tiap konten baru: cek performa konten 3 hari setelah diposting, catat reach/views, ER, saves, dan shares.', 'For every new post: check content performance 3 days after posting and record reach/views, ER, saves, and shares.'));
  return out;
}
function buildReportHTML() {
  const plat = S.plat, multi = plat === 'all', plats = multi ? PLATS : [plat];
  const [a, e] = repRange(), len = diffDays(a, e) + 1, pe = addDays(a, -1), pa = addDays(pe, -(len - 1));
  const all = posts(), cur = inRange(all, a, e), prev = inRange(all, pa, pe), C = agg(cur), P = agg(prev);
  const covNotes = [];
  for (const p of plats) {
    const c = coverageOf(S.brand, p), pre = multi ? PNAME[p] + ': ' : '';
    if (!c) covNotes.push(pre + L('Belum ada data posting di sumber ini.', 'No post data in this source yet.'));
    else {
      if (c.from > pa) covNotes.push(pre + L(`Periode pembanding belum lengkap: data posting baru tersedia mulai ${fmtD(c.from)}${c.from > pe ? ' (periode pembanding tidak tercakup sama sekali)' : ''}.`, `Comparison period incomplete: post data only available from ${fmtD(c.from)}${c.from > pe ? ' (the comparison period is not covered at all)' : ''}.`));
      if (c.from > a) covNotes.push(pre + L(`Periode laporan juga belum lengkap: data mulai ${fmtD(c.from)}.`, `The report period is also incomplete: data starts ${fmtD(c.from)}.`));
    }
    const snS = snapsOf(S.brand, p).filter((s) => s.followers != null).map((s) => s.date).sort();
    if (snS.length && snS[0] > pa) covNotes.push(pre + L(`Snapshot followers pertama ${fmtD(snS[0])}; perubahan followers periode pembanding bisa tidak lengkap.`, `First follower snapshot ${fmtD(snS[0])}; follower change for the comparison period may be incomplete.`));
  }
  const row = (l, x, y) => `<tr><td>${esc(l)}</td><td class="n">${esc(fmtN(x))}</td><td class="n">${esc(fmtN(y))}</td><td class="n">${x == null || y == null ? '–' : esc(signed(x - y))}</td><td class="n">${pctChange(x, y)}</td></tr>`;
  const erRow = (l, x, y) => `<tr><td>${esc(l)}</td><td class="n">${fmtPct(x)}</td><td class="n">${fmtPct(y)}</td><td class="n" colspan="2">${x != null && y != null ? esc(fmtPP(x - y)) : '–'}</td></tr>`;
  const Fc = followerStats(plat, a, e), Fp = followerStats(plat, pa, pe);
  let rows = '';
  if (multi) for (const p of PLATS) rows += row(`Followers ${PNAME[p]}`, Fc.per[p].last?.followers ?? null, Fp.per[p].last?.followers ?? null);
  rows += row(multi ? L('Followers total (snapshot terakhir)', 'Total followers (latest snapshot)') : L('Followers (snapshot terakhir)', 'Followers (latest snapshot)'), Fc.last, Fp.last);
  rows += row(L('Pertumbuhan followers', 'Follower growth'), Fc.change, Fp.change);
  rows += row(L('Jumlah posting', 'Posts'), C.n, P.n) + row('Total Views', C.views, P.views);
  if (plat === 'ig') rows += row('Total Reach', C.reach, P.reach);
  rows += row('Total Engagements', C.eng, P.eng) + row('Likes', C.likes, P.likes) + row(commentsLabel(plat), C.comments, P.comments) + row('Shares', C.shares, P.shares);
  if (plat === 'ig' || plat === 'tiktok') rows += row('Saves', C.saves, P.saves);
  if (plat === 'threads') rows += row('Reposts', C.reposts, P.reposts) + row('Quotes', C.quotes, P.quotes);
  if (multi) { for (const p of PLATS) { const c1 = agg(cur.filter((x) => x.plat === p)), p1 = agg(prev.filter((x) => x.plat === p)); rows += erRow(`${erLabel(p)} · ${PNAME[p]}`, c1.er, p1.er); } rows += erRow(erLabel('all'), C.erV, P.erV); }
  else rows += erRow(erLabel(plat), C.er, P.er);
  const erf = erFor(plat), top = cur.filter((p) => erf(p) != null).sort((x, y) => erf(y) - erf(x)).slice(0, 5);
  const topV = cur.filter((p) => p.views != null).sort((x, y) => y.views - x.views).slice(0, 3);
  const srcTxt = plats.map((p) => (multi ? PNAME[p] + ': ' : '') + srcLabel(source(S.brand, p), p)).join(' · ');
  const anyDemo = plats.some((p) => source(S.brand, p) === 'demo');
  return `<div class="stripe"></div>
  <h1>${L('Laporan', 'Report:')} ${esc(pName(plat))} ${esc(S.brand.name)}</h1>
  <p class="meta-line">${plats.map((p) => (handleOf(S.brand, p) ? `${multi ? PSHORT[p] + ' ' : ''}@${esc(handleOf(S.brand, p))}` : '')).filter(Boolean).join(' · ')} · ${L('Sumber data', 'Data source')}: <strong>${esc(srcTxt)}</strong>${anyDemo ? L(' (Demo = angka contoh, bukan data asli)', ' (Demo = sample numbers, not real data)') : ''} · ${L('Periode', 'Period')}: <strong>${esc(fmtD(a))} – ${esc(fmtD(e))}</strong> (${len} ${L('hari', 'days')}) · ${L('Pembanding', 'Comparison')}: ${esc(fmtD(pa))} – ${esc(fmtD(pe))} · ${L('Dibuat', 'Generated')} ${esc(fmtDT(new Date().toISOString()))}</p>
  ${covNotes.map((t) => `<p class="note">${esc(t)}</p>`).join('')}
  <h2>${L('Ringkasan vs periode sebelumnya', 'Summary vs previous period')}</h2>
  <p class="meta-line">${esc(L('Perbandingan berbasis posting dikelompokkan per tanggal tayang: angka adalah total terakhir dari posting yang terbit di masing-masing periode (bukan angka harian). Followers dari snapshot bertanggal.', 'Post-based comparisons are grouped by publish date: figures are the latest lifetime totals of posts published in each period (not daily figures). Followers come from dated snapshots.') + (plat === 'ig' ? '' : ' ' + L('ER TikTok & Threads dihitung dari views (platform ini tidak menyediakan reach).', 'TikTok & Threads ER is based on views (these platforms do not provide reach).')))}</p>
  <table><thead><tr><th>${L('Metrik', 'Metric')}</th><th class="n">${L('Periode ini', 'This period')}</th><th class="n">${L('Sebelumnya', 'Previous')}</th><th class="n">${L('Selisih', 'Change')}</th><th class="n">%</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>${L('Posting terbaik (ER tertinggi)', 'Best posts (highest ER)')}</h2>
  ${top.length ? `<table><thead><tr><th>#</th>${multi ? '<th>Platform</th>' : ''}<th>${L('Judul', 'Title')}</th><th>${L('Tanggal', 'Date')}</th><th>Format</th><th class="n">${plat === 'ig' ? 'Reach' : 'Views'}</th><th class="n">Views</th><th class="n">Shares</th><th class="n">${multi ? 'ER (÷ views)' : 'ER'}</th></tr></thead><tbody>${top.map((p, i) => `<tr><td>${i + 1}</td>${multi ? `<td>${PNAME[p.plat]}</td>` : ''}<td>${esc(p.title)}</td><td style="white-space:nowrap">${esc(fmtD(p.date))}</td><td>${esc(p.type)}</td><td class="n">${fmtN(erBase(p))}</td><td class="n">${fmtN(p.views)}</td><td class="n">${fmtN(p.shares)}</td><td class="n">${fmtPct(erf(p))}</td></tr>`).join('')}</tbody></table>` : `<p>${esc(L('Tidak ada posting dengan data engagements di periode ini.', 'No posts with engagement data in this period.'))}</p>`}
  ${topV.length ? `<p class="meta-line">${L('Views tertinggi', 'Highest views')}: ${topV.map((p) => `${multi ? PSHORT[p.plat] + ' · ' : ''}${esc(p.title)} (${fmtN(p.views)})`).join(' · ')}</p>` : ''}
  <h2>${L('Rekomendasi periode berikutnya', 'Recommendations for next period')}</h2>
  <ol>${recommendations(cur, all).map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
  <p class="meta-line" style="margin-top:18px">${esc(L('ER berbobot = total engagements ÷ total reach (Instagram) atau ÷ total views (TikTok, Threads) × 100, hanya untuk posting yang punya kedua angka dan penyebut > 0. ER gabungan memakai views untuk semua platform. Tanda "–" berarti data belum tersedia (berbeda dari nol).', 'Weighted ER = total engagements ÷ total reach (Instagram) or ÷ total views (TikTok, Threads) × 100, only for posts that have both values and a denominator > 0. Combined ER uses views for all platforms. "–" means data not available yet (different from zero).'))}</p>`;
}
function rReport() {
  $$('#rep-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === S.repPreset)));
  $('#report-paper').innerHTML = buildReportHTML();
  $('#rep-hint').textContent = (HOST === 'artifact' ? L('Di versi claude.ai, tombol cetak menyimpan file HTML laporan; buka file itu lalu pilih Cetak → Simpan sebagai PDF.', 'In the claude.ai version, the print button saves the report as an HTML file; open it and choose Print → Save as PDF.') : L('Tombol cetak membuka dialog print browser. Pilih "Simpan sebagai PDF" untuk menyimpan.', 'The print button opens the browser print dialog. Choose "Save as PDF" to save.')) + ' ' + L('Platform laporan mengikuti pilihan di header (pilih "Semua" untuk laporan gabungan).', 'The report platform follows the header choice (pick "All" for a combined report).');
}
async function printReport() {
  if (HOST !== 'artifact') { window.print(); return; }
  const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
  const html = `<!DOCTYPE html><html lang="${S.lang}"><head><meta charset="utf-8"><title>${esc(L('Laporan', 'Report'))} ${esc(S.brand.name)}</title><style>${css}\nbody{background:#fff;padding:20px}.paper{border:0}</style></head><body><div class="paper">${$('#report-paper').innerHTML}</div><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`;
  await saveFile(`${L('Laporan', 'Report')}-${S.brand.name.replace(/\s+/g, '-')}-${S.plat}-${repRange().join('_')}.html`, html, 'text/html');
}

// ================= 6. EKSPERIMEN =================
const EXP_METRICS = (plat = 'ig') => PM[plat].cols().map(([k, l]) => [k, l]).concat([['interactions', 'Total Engagements']]);
const VARS = ['Hook', 'Cover', 'CTA', 'Format', 'Caption', 'Jam tayang', 'Lainnya'];
const VAR_EN = { 'Jam tayang': 'Posting time', Lainnya: 'Other' };
const varLabel = (v) => L(v, VAR_EN[v] || v);
const exps = () => Store.get(bk('experiments'), []);
function expForm(init = {}) {
  const x = { variable: 'Hook', platform: curPlat(), a: {}, b: {}, ...init }; x.a = { ...x.a }; x.b = { ...x.b };
  const isNew = !x.id;
  const ver = (k, t) => `<fieldset class="full form" style="border:1px solid var(--line);border-radius:10px;padding:10px"><legend style="font-weight:700;padding:0 6px">${t}</legend>
    <label class="full">${L('Label / deskripsi', 'Label / description')}<input name="${k}_label" value="${esc(x[k].label || '')}" placeholder="${esc(k === 'a' ? L('mis. Hook pernyataan', 'e.g. Statement hook') : L('mis. Hook pertanyaan', 'e.g. Question hook'))}"></label>
    <label>${L('Tanggal tayang', 'Publish date')}<input type="date" name="${k}_date" value="${esc(x[k].date || '')}"></label>
    <label>${L('Link posting', 'Post link')}<input type="url" name="${k}_link" value="${esc(x[k].link || '')}" placeholder="https://…"></label></fieldset>`;
  const metOpts = (plat) => EXP_METRICS(plat).concat([['er', 'ER']]).map(([k, l]) => `<option value="${k}" ${k === (x.primary || 'er') ? 'selected' : ''}>${esc(l)}</option>`).join('');
  openModal(isNew ? L('Eksperimen baru', 'New experiment') : L('Edit eksperimen', 'Edit experiment'), `<form id="exp-f" class="form">
    <label class="full">${L('Hipotesis', 'Hypothesis')}<textarea name="hypothesis" required placeholder="${esc(L('Kalau … maka … karena …', 'If … then … because …'))}">${esc(x.hypothesis || '')}</textarea></label>
    <label>Platform<select name="platform" ${x.a.res || x.b.res ? 'disabled' : ''}>${PLATS.map((p) => `<option value="${p}" ${p === x.platform ? 'selected' : ''}>${PNAME[p]}</option>`).join('')}</select></label>
    <label>${L('Variabel yang dites (satu saja)', 'Variable tested (only one)')}<select name="variable">${VARS.map((v) => `<option value="${v}" ${v === x.variable ? 'selected' : ''}>${esc(varLabel(v))}</option>`).join('')}</select></label>
    <label>${L('Metrik utama', 'Primary metric')}<select name="primary" id="exp-primary">${metOpts(x.platform)}</select></label>
    ${ver('a', L('Versi awal', 'Original'))}${ver('b', L('Variasi', 'Variant'))}
    <div class="full row between"><div class="row"><button class="primary">${L('Simpan', 'Save')}</button><button type="button" id="exp-cancel">${L('Batal', 'Cancel')}</button></div>${isNew ? '' : `<button type="button" class="danger" id="exp-del">${L('Hapus', 'Delete')}</button>`}</div></form>`);
  $('#exp-f [name=platform]').onchange = (ev) => { $('#exp-primary').innerHTML = metOpts(ev.target.value); };
  $('#exp-cancel').onclick = closeModal;
  if (!isNew) $('#exp-del').onclick = async () => { if (await confirmBox(L('Hapus eksperimen ini?', 'Delete this experiment?'))) { await Store.set(bk('experiments'), exps().filter((e) => e.id !== x.id)); render(); } };
  $('#exp-f').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    for (const k of ['a', 'b']) { if (f[k + '_date'] && !isDate(f[k + '_date'])) return toast(L('Tanggal tidak valid.', 'Invalid date.'), 'err'); if (f[k + '_link'] && !/^https?:\/\//i.test(f[k + '_link'])) return toast(L('Link posting harus diawali https://', 'Post link must start with https://'), 'err'); }
    const rec = { ...x, id: x.id || uid(), hypothesis: f.hypothesis.trim(), variable: f.variable, primary: f.primary, platform: f.platform || x.platform, created: x.created || new Date().toISOString(),
      a: { ...x.a, label: f.a_label, date: f.a_date, link: f.a_link }, b: { ...x.b, label: f.b_label, date: f.b_date, link: f.b_link } };
    const list = exps().filter((e) => e.id !== rec.id); list.unshift(rec); await Store.set(bk('experiments'), list); closeModal(); toast(L('Eksperimen tersimpan.', 'Experiment saved.')); if (S.view !== 'eksperimen') go('eksperimen'); else render();
  };
}
function resForm(id, k) {
  const x = exps().find((e) => e.id === id), v = x[k], res = v.res || {}, plat = x.platform || 'ig';
  openModal(L(`Hasil ${k === 'a' ? 'versi awal' : 'variasi'} (setelah 3 hari)`, `${k === 'a' ? 'Original' : 'Variant'} results (after 3 days)`), `<p class="muted" style="margin-top:-6px">${esc(PNAME[plat])} · ${esc(v.label || '')} · ${L('tayang', 'published')} ${esc(fmtD(v.date))} · ${L('evaluasi', 'evaluation')} ${esc(fmtD(addDays(v.date, 3)))}. ${esc(L('Kosongkan kalau datanya belum ada; isi 0 kalau memang nol.', 'Leave empty if the data is not available yet; enter 0 if it really is zero.'))}</p>
    <form id="res-f" class="form">${EXP_METRICS(plat).map(([m, l]) => `<label>${esc(l)}<input type="number" min="0" step="1" name="${m}" value="${res[m] ?? ''}"></label>`).join('')}
    <div class="full row"><button class="primary">${L('Simpan hasil', 'Save results')}</button><button type="button" id="res-cancel">${L('Batal', 'Cancel')}</button></div></form>`);
  $('#res-cancel').onclick = closeModal;
  $('#res-f').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target)), out = { savedAt: new Date().toISOString() };
    for (const [m] of EXP_METRICS(plat)) { const s = String(f[m] ?? '').trim(); out[m] = s === '' ? null : Number(s); if (out[m] != null && (!Number.isFinite(out[m]) || out[m] < 0)) return toast(L('Angka tidak valid di ', 'Invalid number in ') + m, 'err'); }
    const list = exps().map((e) => (e.id === id ? { ...e, [k]: { ...e[k], res: out } } : e));
    await Store.set(bk('experiments'), list); closeModal(); toast(L('Hasil tersimpan.', 'Results saved.')); render();
  };
}
const expER = (r, plat) => (r ? erOf({ ...r, plat }) : null);
function rExp() {
  const t = today(), list = exps().filter((x) => S.plat === 'all' || (x.platform || 'ig') === S.plat);
  $('#exp-list').innerHTML = list.length ? list.map((x) => {
    const plat = x.platform || 'ig', M = EXP_METRICS(plat);
    const side = (k, title) => {
      const v = x[k] || {}, ev = v.date ? addDays(v.date, 3) : null, ready = ev && t >= ev;
      return `<div class="idea"><div class="row between"><strong>${title}</strong>${v.res ? `<span class="badge b-meta">${L('Hasil terisi', 'Results in')}</span>` : ready ? `<span class="badge b-demo">${L('Siap dievaluasi', 'Ready to evaluate')}</span>` : `<span class="badge b-grey">${L('Menunggu', 'Waiting')}</span>`}</div>
      <div style="font-size:14px;margin:4px 0">${esc(v.label || '–')}</div>
      <div class="muted" style="font-size:13px">${L('Tayang', 'Published')}: ${esc(fmtD(v.date))} · ${L('Evaluasi', 'Evaluation')}: ${esc(fmtD(ev))}${safeUrl(v.link) ? ` · <a href="${esc(v.link)}" target="_blank" rel="noopener">${L('posting', 'post')}</a>` : ''}</div>
      ${v.res ? `<div class="mgrid" style="margin-top:6px">${M.map(([m, l]) => `<div><span>${esc(l)}</span><b>${fmtN(v.res[m])}</b></div>`).join('')}<div><span>ER</span><b>${fmtPct(expER(v.res, plat))}</b></div></div>` : ''}
      <div style="margin-top:8px">${!v.date ? `<span class="muted" style="font-size:13px">${L('Isi tanggal tayang dulu (Edit).', 'Fill in the publish date first (Edit).')}</span>` : ready ? `<button data-res="${esc(x.id)}" data-k="${k}">${v.res ? L('Edit hasil', 'Edit results') : L('Isi hasil', 'Enter results')}</button>` : `<button disabled>${L('Isi hasil mulai', 'Enter results from')} ${esc(fmtD(ev))}</button>`}</div></div>`;
    };
    let cmp = '';
    if (x.a?.res && x.b?.res) {
      const rows = M.map(([m, l]) => { const A = x.a.res[m], B = x.b.res[m]; return `<tr><td>${esc(l)}</td><td class="n">${fmtN(A)}</td><td class="n">${fmtN(B)}</td><td class="n">${A != null && B != null ? signed(B - A) : '–'}</td><td class="n">${A != null && B != null && A > 0 ? pctChange(B, A) : A === 0 && B != null ? L('dari 0', 'from 0') : '–'}</td></tr>`; }).join('');
      const ea = expER(x.a.res, plat), eb = expER(x.b.res, plat);
      const pm = x.primary || 'er', pa = pm === 'er' ? ea : x.a.res[pm], pb = pm === 'er' ? eb : x.b.res[pm];
      const verdict = pa == null || pb == null ? L('Metrik utama belum lengkap di salah satu versi.', 'The primary metric is missing in one version.') : pb > pa ? L('Variasi lebih tinggi di metrik utama.', 'The variant is higher on the primary metric.') : pb < pa ? L('Versi awal lebih tinggi di metrik utama.', 'The original is higher on the primary metric.') : L('Hasil metrik utama sama.', 'The primary metric is tied.');
      cmp = `<h3 style="margin:12px 0 6px">${L('Selisih (variasi − versi awal)', 'Difference (variant − original)')}</h3><div class="scroll"><table><thead><tr><th>${L('Metrik', 'Metric')}</th><th class="n">${L('Versi awal', 'Original')}</th><th class="n">${L('Variasi', 'Variant')}</th><th class="n">${L('Selisih', 'Change')}</th><th class="n">%</th></tr></thead><tbody>${rows}<tr><td>${esc(erLabel(plat))}</td><td class="n">${fmtPct(ea)}</td><td class="n">${fmtPct(eb)}</td><td class="n" colspan="2">${ea != null && eb != null ? esc(fmtPP(eb - ea)) : '–'}</td></tr></tbody></table></div><p class="note info" style="margin-top:8px">${esc(verdict + L(' Satu eksperimen belum cukup untuk kesimpulan pasti — ulangi minimal sekali sebelum dijadikan aturan.', ' One experiment is not enough for a firm conclusion — repeat it at least once before making it a rule.'))}</p>`;
    } else cmp = `<p class="muted" style="font-size:13px;margin:10px 0 0">${esc(L('Selisih muncul setelah hasil kedua versi diisi.', 'The difference appears once both versions have results.'))}</p>`;
    return `<div class="card"><div class="row between"><div><span class="pill" style="background:${PCOLOR[plat]}22;color:${PCOLOR[plat]}">${PNAME[plat]}</span> <span class="badge b-csv">${L('Variabel', 'Variable')}: ${esc(varLabel(x.variable))}</span> <span class="muted" style="font-size:13px">${L('Metrik utama', 'Primary metric')}: ${esc((M.find(([k]) => k === x.primary) || ['', 'ER'])[1])}</span></div><button data-edit="${esc(x.id)}">Edit</button></div>
      <p style="font-weight:600;margin:8px 0">${esc(x.hypothesis)}</p><div class="grid g2">${side('a', L('Versi awal', 'Original'))}${side('b', L('Variasi', 'Variant'))}</div>${cmp}</div>`;
  }).join('') : `<div class="card"><p class="muted" style="margin:0">${esc(L('Belum ada eksperimen untuk platform ini. Klik "Tambah eksperimen", tulis hipotesis, pilih satu variabel (hook, cover, CTA, atau format), lalu isi versi awal dan variasi.', 'No experiments for this platform yet. Click "Add experiment", write a hypothesis, pick one variable (hook, cover, CTA, or format), then fill in the original and the variant.'))}</p></div>`;
  $$('#exp-list [data-edit]').forEach((b) => (b.onclick = () => expForm(exps().find((e) => e.id === b.dataset.edit))));
  $$('#exp-list [data-res]').forEach((b) => (b.onclick = () => resForm(b.dataset.res, b.dataset.k)));
}

// ================= 7. LEADS WHATSAPP =================
const camps = () => Store.get(bk('campaigns'), []);
const inqs = () => Store.get(bk('inquiries'), []);
const allCodes = () => brands().flatMap((b) => Store.get(bk('campaigns', b), []).map((c) => c.code.toUpperCase()));
function newCode() { let c; do { c = `${S.brand.code || 'ERHA'}-${today().slice(2, 4)}${today().slice(5, 7)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; } while (allCodes().includes(c)); return c; }
const normPhone = (p) => String(p || '').replace(/[\s\-().]/g, '').replace(/^\+/, '');
const waText = (c) => (c.message.toUpperCase().includes(c.code.toUpperCase()) ? c.message : `${c.message.trim()} (${L('Kode', 'Code')}: ${c.code})`);
const waLink = (c) => `https://wa.me/${c.phone}?text=${encodeURIComponent(waText(c))}`;
const chName = (c) => (c === 'other' ? L('Lainnya', 'Other') : PNAME[c] || 'Instagram');
function resetCampForm() {
  $('#cmp-name').value = ''; $('#cmp-phone').value = settings()?.wa || '';
  $('#cmp-code').value = newCode(); $('#cmp-channel').value = curPlat();
  $('#cmp-msg').value = L(`Halo ${S.brand.name}, saya tertarik dan mau tanya lebih lanjut. Kode: ${$('#cmp-code').value}`, `Hi ${S.brand.name}, I'm interested and would like to know more. Code: ${$('#cmp-code').value}`);
}
function rLeads() {
  if (!$('#cmp-code').value || !$('#cmp-code').value.startsWith(S.brand.code || 'ERHA')) resetCampForm();
  if (!$('#inq-date').value) $('#inq-date').value = today();
  const C = camps(), I = inqs();
  $('#inq-cmp').innerHTML = C.length ? C.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.code)})</option>`).join('') : `<option value="">${L('Buat kampanye dulu', 'Create a campaign first')}</option>`;
  $('#cmp-table').innerHTML = C.length ? `<thead><tr><th>${L('Kampanye', 'Campaign')}</th><th>${L('Kode', 'Code')}</th><th>${L('Kanal', 'Channel')}</th><th>${L('Link WhatsApp', 'WhatsApp link')}</th><th class="n">Inquiry</th><th class="n">Qualified</th><th class="n">Booking</th><th class="n">Closed</th><th></th></tr></thead><tbody>${C.map((c) => {
    const my = I.filter((i) => i.campaignId === c.id), n = (s) => my.filter((i) => s.includes(i.status)).length;
    return `<tr><td>${esc(c.name)}</td><td><code>${esc(c.code)}</code></td><td>${esc(chName(c.channel || 'ig'))}</td><td style="max-width:320px"><a href="${esc(waLink(c))}" target="_blank" rel="noopener" style="overflow-wrap:anywhere;font-size:13px">${esc(waLink(c))}</a></td><td class="n">${my.length}</td><td class="n">${n(['Qualified', 'Booked', 'Closed'])}</td><td class="n">${n(['Booked', 'Closed'])}</td><td class="n">${n(['Closed'])}</td><td><div class="row"><button data-copy="${esc(c.id)}">${L('Salin link', 'Copy link')}</button><button class="danger" data-delc="${esc(c.id)}">${L('Hapus', 'Delete')}</button></div></td></tr>`;
  }).join('')}</tbody>` : `<tbody><tr><td class="muted">${L('Belum ada kampanye.', 'No campaigns yet.')}</td></tr></tbody>`;
  $('#inq-table').innerHTML = I.length ? `<thead><tr><th>${L('Tanggal', 'Date')}</th><th>${L('Kampanye', 'Campaign')}</th><th>${L('Catatan', 'Notes')}</th><th>Status</th><th></th></tr></thead><tbody>${[...I].sort((a, b) => b.date.localeCompare(a.date)).map((i) => { const c = C.find((x) => x.id === i.campaignId); return `<tr><td style="white-space:nowrap">${esc(fmtD(i.date))}</td><td>${esc(c ? c.name + ' (' + c.code + ')' : L('(kampanye dihapus)', '(campaign deleted)'))}</td><td>${esc(i.note || '–')}</td><td><select data-st="${esc(i.id)}" style="width:auto">${LEAD_STATUS.map((s) => `<option ${s === i.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><button class="danger" data-deli="${esc(i.id)}">${L('Hapus', 'Delete')}</button></td></tr>`; }).join('')}</tbody>` : `<tbody><tr><td class="muted">${L('Belum ada inquiry tercatat.', 'No inquiries logged yet.')}</td></tr></tbody>`;
  $$('[data-copy]').forEach((b) => (b.onclick = async () => { const c = camps().find((x) => x.id === b.dataset.copy); try { await navigator.clipboard.writeText(waLink(c)); toast(L('Link disalin.', 'Link copied.')); } catch { openModal(L('Salin link', 'Copy link'), `<p>${esc(L('Salin manual link berikut:', 'Copy this link manually:'))}</p><textarea readonly style="min-height:100px">${esc(waLink(c))}</textarea>`); } }));
  $$('[data-delc]').forEach((b) => (b.onclick = async () => { if (await confirmBox(L('Hapus kampanye ini? Inquiry yang terkait tetap tersimpan.', 'Delete this campaign? Linked inquiries are kept.'))) { await Store.set(bk('campaigns'), camps().filter((c) => c.id !== b.dataset.delc)); rLeads(); } }));
  $$('[data-st]').forEach((s) => (s.onchange = async () => { await Store.set(bk('inquiries'), inqs().map((i) => (i.id === s.dataset.st ? { ...i, status: s.value } : i))); toast(L('Status diperbarui.', 'Status updated.')); rLeads(); }));
  $$('[data-deli]').forEach((b) => (b.onclick = async () => { if (await confirmBox(L('Hapus inquiry ini?', 'Delete this inquiry?'))) { await Store.set(bk('inquiries'), inqs().filter((i) => i.id !== b.dataset.deli)); rLeads(); } }));
}

// ================= 8. SUMBER DATA =================
function adviceFor(kind, plat = 'ig') {
  const tokSrc = plat === 'threads' ? L('Threads (lewat alur login Threads di Meta App)', 'Threads (via the Threads login flow in your Meta App)') : plat === 'tiktok' ? L('TikTok (klik "Hubungkan akun TikTok")', 'TikTok (click "Connect TikTok account")') : 'Graph API Explorer';
  const A = {
    token_expired: L(`Token sudah kedaluwarsa. Buat token baru di ${tokSrc}, lalu sambungkan ulang.`, `The token has expired. Create a new token in ${tokSrc}, then reconnect.`),
    token_invalid: L('Token tidak valid (salah salin, dicabut, atau password diganti). Buat token baru lalu sambungkan ulang.', 'The token is invalid (copied wrong, revoked, or the password changed). Create a new token and reconnect.'),
    permission: plat === 'threads' ? L('Izin kurang. Token Threads harus punya threads_basic dan threads_manage_insights.', 'Missing permissions. The Threads token needs threads_basic and threads_manage_insights.') : plat === 'tiktok' ? L('Izin kurang. Akun TikTok harus menyetujui user.info.basic, user.info.stats, dan video.list.', 'Missing permissions. The TikTok account must approve user.info.basic, user.info.stats, and video.list.') : L('Izin kurang. Di Graph API Explorer centang pages_show_list, pages_read_engagement, instagram_basic, dan instagram_manage_insights, klik Generate Access Token, lalu tempel token barunya.', 'Missing permissions. In Graph API Explorer tick pages_show_list, pages_read_engagement, instagram_basic, and instagram_manage_insights, click Generate Access Token, then paste the new token.'),
    no_page: L('Token tidak melihat Facebook Page mana pun. Pastikan akun Facebook-mu admin/punya akses ke Page, dan saat generate token Page tersebut dicentang.', 'The token cannot see any Facebook Page. Make sure your Facebook account is an admin/has access to the Page, and that the Page is ticked when generating the token.'),
    ig_not_found: L('Page ditemukan, tapi tidak ada akun Instagram Professional yang tersambung. Hubungkan akun IG ke Page lewat Meta Business Suite / pengaturan Instagram (Akun yang dihubungkan).', 'A Page was found, but no Instagram Professional account is linked. Link the IG account to the Page via Meta Business Suite / Instagram settings (Linked accounts).'),
    rate_limit: L('Batas panggilan API tercapai. Tunggu sekitar 1 jam lalu sinkron lagi, atau perpanjang interval sinkron otomatis.', 'API call limit reached. Wait about an hour and sync again, or lengthen the automatic sync interval.'),
    unreachable: L('Server tidak bisa menghubungi API platform. Cek koneksi internet server/hosting, lalu coba lagi.', 'The server cannot reach the platform API. Check the server/hosting internet connection, then try again.'),
    api_error: L('API platform mengembalikan error. Coba lagi beberapa menit lagi; kalau berulang, cek halaman status developer platform.', 'The platform API returned an error. Try again in a few minutes; if it repeats, check the platform developer status page.'),
    not_available: L('Akun ini tidak tersedia lewat Business Discovery (bukan akun Professional, dibatasi umur, privat, atau username salah).', 'This account is not available via Business Discovery (not a Professional account, age-restricted, private, or wrong username).'),
    no_token: L('Belum ada token tersimpan untuk brand ini.', 'No token saved for this brand yet.'),
    needs_server: L('Business Discovery dipanggil dari server dengan token Meta. Jalankan versi server dan sambungkan token di Sumber data.', 'Business Discovery is called from the server with a Meta token. Run the server version and connect a token in Data sources.'),
    config: L('Server belum diisi TIKTOK_CLIENT_KEY dan TIKTOK_CLIENT_SECRET (dari TikTok Developer Portal). Tanpa itu, token TikTok tidak bisa diperbarui otomatis.', 'The server is missing TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET (from the TikTok Developer Portal). Without them, TikTok tokens cannot be refreshed automatically.'),
    handle_mismatch: L('Token ini milik akun Threads lain. Cek username Threads brand di Pengaturan, atau buat token dari akun yang benar.', 'This token belongs to a different Threads account. Check the brand Threads username in Settings, or create a token from the right account.'),
  };
  return A[kind] || A.api_error;
}
const CSV_SPEC = {
  ig: { req: ['title', 'type', 'date', 'views', 'reach', 'likes', 'comments', 'saves', 'shares', 'interactions'], opt: ['permalink'] },
  tiktok: { req: ['title', 'type', 'date', 'views', 'likes', 'comments', 'shares', 'interactions'], opt: ['saves', 'permalink'] },
  threads: { req: ['title', 'type', 'date', 'views', 'likes', 'replies', 'reposts', 'quotes', 'interactions'], opt: ['shares', 'permalink'] },
};
const COL_FIELD = { replies: 'comments' };
const NUMERIC = ['views', 'reach', 'likes', 'comments', 'replies', 'saves', 'shares', 'reposts', 'quotes', 'interactions'];
function rSource() {
  const plat = S.srcPlat, s = source(S.brand, plat), live = LIVE_SRC[plat];
  $$('#src-plat-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plat === plat)));
  const opts = [['demo', 'Demo', L('Data contoh untuk mencoba dashboard. Angka bukan data asli dan tidak real time.', 'Sample data to try the dashboard. Numbers are not real and not live.')], ['csv', 'CSV', L(`${Store.get(pk('posts:csv', plat), []).length} posting dari file CSV. Diperbarui saat impor.`, `${Store.get(pk('posts:csv', plat), []).length} posts from CSV files. Updated on import.`)], [live, LIVE_LABEL[plat], HOST === 'server' ? L(`${Store.get(pk('posts:' + live, plat), []).length} posting dari ${LIVE_LABEL[plat]}. Tersinkron otomatis.`, `${Store.get(pk('posts:' + live, plat), []).length} posts from ${LIVE_LABEL[plat]}. Synced automatically.`) : L('Butuh versi server.', 'Needs the server version.')]];
  $('#src-pick').innerHTML = opts.map(([k, l, d]) => `<button class="${k === s ? 'primary' : ''}" data-src="${k}" ${k === live && HOST !== 'server' ? 'disabled' : ''} aria-pressed="${k === s}" title="${esc(d)}">${esc(l)}</button>`).join('');
  $('#src-desc').textContent = `${PNAME[plat]}: ` + (opts.find((o) => o[0] === s) || opts[0])[2] + L(' Sumber dipilih per brand & per platform.', ' The source is chosen per brand & per platform.');
  $$('#src-pick [data-src]').forEach((b) => (b.onclick = async () => { await Store.set(pk('source', plat), b.dataset.src); toast(`${PNAME[plat]} · ` + L('Sumber data: ', 'Data source: ') + srcLabel(b.dataset.src, plat)); render(); }));
  const sp = CSV_SPEC[plat];
  $('#csv-help').innerHTML = L(`<strong>${PNAME[plat]}</strong> — kolom wajib: <code>${sp.req.join(',')}</code>. Opsional: <code>${sp.opt.join(',')}</code>. Tanggal <code>YYYY-MM-DD</code>. Sel kosong = data belum ada (bukan nol).`, `<strong>${PNAME[plat]}</strong> — required columns: <code>${sp.req.join(',')}</code>. Optional: <code>${sp.opt.join(',')}</code>. Dates <code>YYYY-MM-DD</code>. Empty cell = no data yet (not zero).`);
  const sn = [...Store.get(pk('snaps:csv', plat), [])].sort((a, b) => b.date.localeCompare(a.date));
  $('#snap-list').innerHTML = sn.length ? `<table style="margin-top:8px"><thead><tr><th>${L('Tanggal', 'Date')}</th><th class="n">Followers</th><th></th></tr></thead><tbody>${sn.map((x) => `<tr><td>${esc(fmtD(x.date))}</td><td class="n">${fmtN(x.followers)}</td><td><button class="ghost" data-dsnap="${esc(x.date)}">${L('Hapus', 'Delete')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="muted" style="font-size:13px">${esc(L(`Belum ada snapshot ${PNAME[plat]}. Catat followers secara rutin (mis. tiap Senin) supaya pertumbuhan bisa dihitung.`, `No ${PNAME[plat]} snapshots yet. Record followers regularly (e.g. every Monday) so growth can be calculated.`))}</p>`;
  $$('[data-dsnap]').forEach((b) => (b.onclick = async () => { await Store.set(pk('snaps:csv', plat), Store.get(pk('snaps:csv', plat), []).filter((x) => x.date !== b.dataset.dsnap)); rSource(); }));
  if (!$('#snap-date').value) $('#snap-date').value = today();
  const imp = Store.get(pk('lastSync:csv', plat), null);
  if (!$('#csv-msg').dataset.keep) $('#csv-msg').innerHTML = imp ? `<p class="muted" style="font-size:13px">${L('Impor terakhir', 'Last import')}: ${esc(fmtDT(imp))}</p>` : '';
  $('#live-ig').hidden = plat !== 'ig'; $('#live-other').hidden = plat === 'ig';
  if (plat === 'ig') rMeta(); else rPlatLive(plat);
  rGuide(plat);
}
async function rMeta() {
  const box = $('#meta-status');
  if (HOST !== 'server') {
    $('#meta-form').hidden = true; $('#meta-map').innerHTML = '';
    box.innerHTML = `<p class="note info">${esc(L('Koneksi live dan sinkron otomatis hanya berjalan di versi server (token disimpan & dipakai di server, tidak pernah di browser). Versi ini bisa dipakai penuh untuk mode Demo dan CSV. Cara menjalankan versi server ada di README paket aplikasi.', 'Live connections and automatic sync only run in the server version (tokens are stored & used on the server, never in the browser). This version fully supports Demo and CSV modes. How to run the server version is in the app package README.'))}</p>`;
    return;
  }
  $('#meta-form').hidden = false;
  box.innerHTML = `<p class="muted">${L('Mengecek status…', 'Checking status…')}</p>`;
  try { showMeta(await api('GET', '/api/meta/status')); } catch (e) { box.innerHTML = `<p class="note err">${esc(e.message)}</p>`; }
}
function showMeta(st) {
  const s = st.status, box = $('#meta-status'), K = KIND_LABEL();
  let h = `<div class="row"><span class="badge ${st.hasToken ? (s?.ok ? 'b-meta' : 'b-red') : 'b-grey'}">${st.hasToken ? (s?.ok ? L('Tersambung', 'Connected') : (K[s?.kind] || L('Perlu dicek', 'Needs checking'))) : L('Belum tersambung', 'Not connected')}</span><span class="muted" style="font-size:13px">${L('Token disimpan', 'Token saved')}: ${esc(fmtDT(st.tokenSavedAt))} · ${L('Dicek', 'Checked')}: ${esc(fmtDT(s?.checkedAt))} · Graph API ${esc(st.apiVersion)}</span></div>`;
  if (s && !s.ok && s.kind) h += `<p class="note err">${esc(K[s.kind] || 'Error')}: ${esc(adviceFor(s.kind, 'ig'))}${s.kind === 'token_expired' ? ' ' + esc(L('Klik "Sambungkan ulang" setelah menempel token baru.', 'Click "Reconnect" after pasting the new token.')) : ''}</p>`;
  if (s?.missing?.length) h += `<p class="note err">${L('Izin yang belum diberikan', 'Permissions not granted')}: ${s.missing.map((m) => `<code>${esc(m)}</code>`).join(' ')}</p>`;
  if (s?.user) h += `<p class="muted" style="font-size:13px;margin:4px 0">${L('Token milik', 'Token owner')}: ${esc(s.user)} · ${L('Page terlihat', 'Visible Pages')}: ${(s.pages || []).map((p) => esc(p.name) + (p.igUsername ? ' → @' + esc(p.igUsername) : L(' (tanpa IG)', ' (no IG)'))).join(', ') || '–'}</p>`;
  if (st.hasToken && s?.ok) h += `<p class="note ok">${esc(L(`Sinkron otomatis aktif: tiap ${S.live?.minutes || 15} menit (ubah di Pengaturan). Data Meta sendiri bisa tertunda hingga 48 jam.`, `Automatic sync is on: every ${S.live?.minutes || 15} minutes (change in Settings). Meta's own data can be delayed up to 48 hours.`))}</p>`;
  box.innerHTML = h;
  const B = s?.brands || {};
  $('#meta-map').innerHTML = st.hasToken ? `<table class="stack" style="margin-top:8px"><thead><tr><th>Brand</th><th>Handle</th><th>Status</th><th></th></tr></thead><tbody>${brands().map((b) => { const r = B[b.id]; return `<tr><td>${esc(b.name)}</td><td>@${esc(b.handle.replace(/^@/, ''))}</td><td>${r ? (r.status === 'ok' ? `<span class="badge b-meta">OK</span> ${esc(r.page)}` : `<span class="badge b-red">${L('Tidak ditemukan', 'Not found')}</span><div class="muted" style="font-size:12px">${esc(L(`Akun @${b.handle.replace(/^@/, '').toLowerCase()} tidak ada di Page yang bisa dilihat token ini. Cek ejaan username di Pengaturan, atau pastikan Page-nya dicentang saat generate token.`, `@${b.handle.replace(/^@/, '').toLowerCase()} is not on any Page this token can see. Check the username spelling in Settings, or make sure the Page was ticked when generating the token.`))}</div>`) : `<span class="badge b-grey">${L('Belum dicek', 'Not checked')}</span>`}</td><td>${r?.status === 'ok' ? `<button data-msync="${esc(b.id)}">${L('Sinkron', 'Sync')}</button>` : ''}</td></tr>`; }).join('')}</tbody></table>` : '';
  $$('[data-msync]').forEach((b) => (b.onclick = () => platSync('ig', b.dataset.msync, b)));
  $('#meta-save').textContent = st.hasToken ? L('Sambungkan ulang', 'Reconnect') : L('Simpan & uji', 'Save & test');
}
async function rPlatLive(plat) {
  const box = $('#live-other');
  const head = `<h3>${plat === 'threads' ? 'Threads API (graph.threads.net)' : 'TikTok API (Login Kit + Display API)'}</h3>`;
  if (HOST !== 'server') { box.innerHTML = head + `<p class="note info">${esc(L('Koneksi live dan sinkron otomatis hanya berjalan di versi server (token disimpan & dipakai di server, tidak pernah di browser). Versi ini bisa dipakai penuh untuk mode Demo dan CSV.', 'Live connections and automatic sync only run in the server version (tokens are stored & used on the server, never in the browser). This version fully supports Demo and CSV modes.'))}</p>`; return; }
  box.innerHTML = head + `<p class="muted">${L('Mengecek status…', 'Checking status…')}</p>`;
  try { S.plStatus = await api('GET', '/api/platforms/status'); } catch (e) { box.innerHTML = head + `<p class="note err">${esc(e.message)}</p>`; return; }
  const st = S.plStatus[plat][S.brand.id] || {}, s = st.status, K = KIND_LABEL();
  let h = head + `<p class="muted" style="font-size:13px;margin:0">${esc(L(`Token ${PNAME[plat]} berlaku per akun, jadi tiap brand disambungkan sendiri-sendiri. Brand aktif: ${S.brand.name} (@${handleOf(S.brand, plat) || '–'}).`, `${PNAME[plat]} tokens are per account, so each brand is connected separately. Active brand: ${S.brand.name} (@${handleOf(S.brand, plat) || '–'}).`))}</p>`;
  h += `<div class="row"><span class="badge ${st.hasToken ? (s?.ok ? 'b-meta' : 'b-red') : 'b-grey'}">${st.hasToken ? (s?.ok ? L('Tersambung', 'Connected') : (K[s?.kind] || L('Perlu dicek', 'Needs checking'))) : L('Belum tersambung', 'Not connected')}</span><span class="muted" style="font-size:13px">${L('Token disimpan', 'Token saved')}: ${esc(fmtDT(st.savedAt))} · ${L('Dicek', 'Checked')}: ${esc(fmtDT(s?.checkedAt))}</span></div>`;
  if (s && !s.ok && s.kind) h += `<p class="note err">${esc(K[s.kind] || 'Error')}: ${esc(adviceFor(s.kind, plat))}</p>`;
  if (s?.ok) h += `<p class="note ok">${esc(plat === 'threads' ? L(`Akun @${s.username} · followers ${fmtN(s.followers)}. Token long-lived diperpanjang otomatis tiap ±7 hari.`, `Account @${s.username} · followers ${fmtN(s.followers)}. The long-lived token is extended automatically every ~7 days.`) : L(`Akun ${s.displayName} · followers ${fmtN(s.followers)}. ${st.autoRefresh ? 'Access token diperbarui otomatis.' : 'Auto-refresh belum aktif (butuh refresh token + client key/secret di server).'}`, `Account ${s.displayName} · followers ${fmtN(s.followers)}. ${st.autoRefresh ? 'The access token is refreshed automatically.' : 'Auto-refresh is not active (needs a refresh token + client key/secret on the server).'}`))}</p>`;
  if (plat === 'tiktok') {
    h += S.plStatus.tiktokConfigured ? `<div class="row"><a class="btn primary" id="tt-connect" href="/api/tiktok/connect?brandId=${encodeURIComponent(S.brand.id)}">${L('Hubungkan akun TikTok', 'Connect TikTok account')}</a><span class="muted" style="font-size:13px">${esc(L('Login dengan akun TikTok brand ini, lalu setujui izin.', "Sign in with this brand's TikTok account, then approve the permissions."))}</span></div>`
      : `<p class="note">${esc(L('Tombol "Hubungkan akun TikTok" aktif setelah server diisi TIKTOK_CLIENT_KEY dan TIKTOK_CLIENT_SECRET. Redirect URI yang harus didaftarkan di TikTok Developer Portal:', 'The "Connect TikTok account" button activates once the server has TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET. Redirect URI to register in the TikTok Developer Portal:'))} <code>${esc(S.plStatus.tiktokRedirect)}</code></p>`;
    h += `<details style="margin-top:6px"><summary style="cursor:pointer">${L('Atau tempel token manual', 'Or paste tokens manually')}</summary><form id="pl-form" class="stack-sm" style="margin-top:8px"><label>Access token<input type="password" id="pl-token" autocomplete="off"></label><label>Refresh token (${L('opsional, untuk perpanjang otomatis', 'optional, for automatic renewal')})<input type="password" id="pl-refresh" autocomplete="off"></label><button class="primary">${L('Simpan & uji', 'Save & test')}</button></form></details>`;
  } else {
    h += `<form id="pl-form" class="stack-sm"><label>Threads User Access Token (long-lived)<input type="password" id="pl-token" autocomplete="off" placeholder="${esc(L('Tempel token Threads untuk brand ini', 'Paste the Threads token for this brand'))}"></label><button class="primary">${st.hasToken ? L('Sambungkan ulang', 'Reconnect') : L('Simpan & uji', 'Save & test')}</button></form>`;
  }
  h += `<div class="row"><button id="pl-test" ${st.hasToken ? '' : 'disabled'}>${L('Uji koneksi', 'Test connection')}</button><button id="pl-sync" ${s?.ok ? '' : 'disabled'}>${L('Sinkron sekarang', 'Sync now')}</button><button class="danger" id="pl-del" ${st.hasToken ? '' : 'disabled'}>${L('Hapus token', 'Remove token')}</button></div>`;
  h += `<p class="muted" style="font-size:13px;margin:0">${esc(L('Token disimpan terenkripsi di server dan tidak pernah dikirim balik ke browser.', 'Tokens are stored encrypted on the server and never sent back to the browser.'))}</p>`;
  h += `<table class="stack" style="margin-top:8px"><thead><tr><th>Brand</th><th>Username</th><th>Status</th></tr></thead><tbody>${brands().map((b) => { const x = S.plStatus[plat][b.id] || {}; return `<tr><td>${esc(b.name)}</td><td>${handleOf(b, plat) ? '@' + esc(handleOf(b, plat)) : `<span class="muted">${L('belum diisi', 'not set')}</span>`}</td><td>${x.hasToken ? (x.status?.ok ? `<span class="badge b-meta">OK</span>` : `<span class="badge b-red">${esc(K[x.status?.kind] || L('Perlu dicek', 'Needs checking'))}</span>`) : `<span class="badge b-grey">${L('Belum tersambung', 'Not connected')}</span>`}</td></tr>`; }).join('')}</tbody></table>`;
  box.innerHTML = h;
  $('#pl-form').onsubmit = async (ev) => {
    ev.preventDefault(); const t = $('#pl-token').value.trim(); if (!t) return toast(L('Tempel token dulu.', 'Paste a token first.'), 'err');
    try {
      const r = plat === 'threads' ? await api('POST', '/api/threads/token', { brandId: S.brand.id, token: t }) : await api('POST', '/api/tiktok/token', { brandId: S.brand.id, accessToken: t, refreshToken: $('#pl-refresh').value.trim() });
      toast(r.ok ? L('Token tersimpan & koneksi OK. Sinkron otomatis dimulai.', 'Token saved & connection OK. Automatic sync started.') : L('Token tersimpan, tapi ada masalah: ', 'Token saved, but there is a problem: ') + (K[r.kind] || r.kind), r.ok ? '' : 'err');
    } catch (e) { toast(e.status === 400 ? L('Format token tidak dikenali. Salin ulang tanpa spasi atau tanda kutip.', 'Token format not recognised. Copy it again without spaces or quotes.') : e.message, 'err'); }
    await Store.reloadServer(); pollLive(true); rPlatLive(plat);
  };
  $('#pl-test').onclick = async () => { await api('POST', `/api/${plat}/test`, { brandId: S.brand.id }).catch((e) => toast(e.message, 'err')); rPlatLive(plat); };
  $('#pl-sync').onclick = (ev) => platSync(plat, S.brand.id, ev.target);
  $('#pl-del').onclick = async () => { if (await confirmBox(L(`Hapus token ${PNAME[plat]} untuk ${S.brand.name}? Data yang sudah tersinkron tetap ada.`, `Remove the ${PNAME[plat]} token for ${S.brand.name}? Already-synced data is kept.`))) { await api('DELETE', '/api/platform/token', { platform: plat, brandId: S.brand.id }); toast(L('Token dihapus.', 'Token removed.')); pollLive(true); rPlatLive(plat); } };
}
async function platSync(plat, brandId, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api('POST', '/api/sync', { platform: plat, brandId, days: 90 });
    if (r.ok) { await Store.reloadServer(); toast(L(`${PNAME[plat]}: sinkron selesai, ${r.fetched} posting, followers ${fmtN(r.followers)}.`, `${PNAME[plat]}: sync complete, ${r.fetched} posts, followers ${fmtN(r.followers)}.`)); }
    else toast(`${PNAME[plat]} · ` + (KIND_LABEL()[r.kind] || L('Gagal', 'Failed')) + ': ' + adviceFor(r.kind, plat), 'err');
    pollLive(true);
    return r;
  } catch (e) { toast(e.message, 'err'); return { ok: false }; }
  finally { if (btn) btn.disabled = false; render(); }
}
function rGuide(plat) {
  const g = $('#guide');
  if (g.dataset.key === S.lang + plat) return;
  g.dataset.key = S.lang + plat;
  $('#guide-title').textContent = L('Panduan setup ', 'Setup guide: ') + (plat === 'ig' ? 'Meta (Instagram)' : PNAME[plat]);
  const en = S.lang === 'en';
  if (plat === 'threads') {
    g.innerHTML = en ? `
    <details class="guide"><summary>1. Create a Meta App with the Threads use case</summary><ol><li>At developers.facebook.com → My Apps → Create App, choose the <em>Access the Threads API</em> use case.</li><li>Add permissions <code>threads_basic</code> (required for all Threads endpoints) and <code>threads_manage_insights</code> (required for insights).</li><li>Add each brand's Threads account as a <em>Threads Tester</em> in App roles, and accept the invite in the Threads app (Settings → Account → Website permissions).</li></ol></details>
    <details class="guide"><summary>2. Get a long-lived token per brand</summary><ol><li>Generate a Threads user token for each brand account (User Token Generator in the app dashboard, or the authorization window <code>threads.net/oauth/authorize</code>).</li><li>Short-lived tokens last 1 hour; exchange them for a long-lived token (60 days) via <code>GET graph.threads.net/access_token?grant_type=th_exchange_token</code>.</li><li>Paste the long-lived token here. The server refreshes it automatically (allowed once the token is ≥24 hours old and not yet expired).</li></ol></details>
    <details class="guide"><summary>3. Data & limits</summary><ul><li>Per post: views, likes, replies, reposts, quotes, shares. No reach or saves, so ER = engagements ÷ views.</li><li>Followers come from <code>followers_count</code> in user insights; growth comes from the dashboard's daily snapshots.</li><li>Reposts of other people's posts are excluded.</li></ul></details>
    <p class="muted" style="font-size:13px">References: <a href="https://developers.facebook.com/docs/threads/insights/" target="_blank" rel="noopener">Threads Insights</a> · <a href="https://developers.facebook.com/docs/threads/get-started/long-lived-tokens/" target="_blank" rel="noopener">Long-lived tokens</a></p>` : `
    <details class="guide"><summary>1. Buat Meta App dengan use case Threads</summary><ol><li>Di developers.facebook.com → My Apps → Create App, pilih use case <em>Access the Threads API</em>.</li><li>Tambahkan izin <code>threads_basic</code> (wajib untuk semua endpoint Threads) dan <code>threads_manage_insights</code> (wajib untuk insights).</li><li>Tambahkan akun Threads tiap brand sebagai <em>Threads Tester</em> di App roles, lalu terima undangannya di app Threads (Pengaturan → Akun → Izin situs web).</li></ol></details>
    <details class="guide"><summary>2. Ambil token long-lived per brand</summary><ol><li>Buat Threads user token untuk tiap akun brand (User Token Generator di dashboard app, atau authorization window <code>threads.net/oauth/authorize</code>).</li><li>Token short-lived berlaku 1 jam; tukar jadi long-lived (60 hari) lewat <code>GET graph.threads.net/access_token?grant_type=th_exchange_token</code>.</li><li>Tempel token long-lived di sini. Server memperpanjangnya otomatis (boleh setelah token berumur ≥24 jam dan belum kedaluwarsa).</li></ol></details>
    <details class="guide"><summary>3. Data & batasan</summary><ul><li>Per posting: views, likes, replies, reposts, quotes, shares. Tidak ada reach dan saves, jadi ER = engagements ÷ views.</li><li>Followers diambil dari <code>followers_count</code> di user insights; pertumbuhan dari snapshot harian dashboard.</li><li>Repost dari posting orang lain tidak dihitung.</li></ul></details>
    <p class="muted" style="font-size:13px">Rujukan: <a href="https://developers.facebook.com/docs/threads/insights/" target="_blank" rel="noopener">Threads Insights</a> · <a href="https://developers.facebook.com/docs/threads/get-started/long-lived-tokens/" target="_blank" rel="noopener">Long-lived tokens</a></p>`;
    return;
  }
  if (plat === 'tiktok') {
    g.innerHTML = en ? `
    <details class="guide"><summary>1. Create an app in the TikTok Developer Portal</summary><ol><li>At developers.tiktok.com create an app and add the <em>Login Kit</em> and <em>Display API</em> products. Both need TikTok's approval.</li><li>Request scopes <code>user.info.basic</code>, <code>user.info.stats</code> (follower count), and <code>video.list</code> (videos with views, likes, comments, shares).</li><li>Register the server's redirect URI (shown in the TikTok card above) and note the <em>Client key</em> and <em>Client secret</em>.</li></ol></details>
    <details class="guide"><summary>2. Configure the server</summary><ol><li>Set <code>TIKTOK_CLIENT_KEY</code> and <code>TIKTOK_CLIENT_SECRET</code> (and <code>PUBLIC_URL</code> or <code>TIKTOK_REDIRECT_URI</code> if the server is behind a domain), then restart.</li><li>Pick a brand, open Data sources → TikTok → <em>Connect TikTok account</em>, sign in with that brand's TikTok account, and approve.</li><li>Access tokens are short-lived; the server renews them automatically with the refresh token.</li></ol></details>
    <details class="guide"><summary>3. Data & limits</summary><ul><li>Per video: views, likes, comments, shares. No reach or saves via this API, so ER = engagements ÷ views. Saves/favourites can be added via CSV.</li><li>Only public videos of the authorised account are returned.</li><li>While the app is unapproved (sandbox), only test users added in the portal can connect.</li></ul></details>
    <p class="muted" style="font-size:13px">References: <a href="https://developers.tiktok.com/doc/display-api-get-started/" target="_blank" rel="noopener">Display API</a> · <a href="https://developers.tiktok.com/doc/oauth-user-access-token-management" target="_blank" rel="noopener">Access token management</a></p>` : `
    <details class="guide"><summary>1. Buat app di TikTok Developer Portal</summary><ol><li>Di developers.tiktok.com buat app, tambahkan produk <em>Login Kit</em> dan <em>Display API</em>. Keduanya perlu persetujuan TikTok.</li><li>Minta scope <code>user.info.basic</code>, <code>user.info.stats</code> (jumlah followers), dan <code>video.list</code> (video dengan views, likes, komentar, shares).</li><li>Daftarkan redirect URI server (tertera di kartu TikTok di atas) dan catat <em>Client key</em> serta <em>Client secret</em>.</li></ol></details>
    <details class="guide"><summary>2. Atur server</summary><ol><li>Isi <code>TIKTOK_CLIENT_KEY</code> dan <code>TIKTOK_CLIENT_SECRET</code> (plus <code>PUBLIC_URL</code> atau <code>TIKTOK_REDIRECT_URI</code> kalau server memakai domain), lalu restart.</li><li>Pilih brand, buka Sumber data → TikTok → <em>Hubungkan akun TikTok</em>, login dengan akun TikTok brand itu, lalu setujui.</li><li>Access token berumur pendek; server memperbaruinya otomatis dengan refresh token.</li></ol></details>
    <details class="guide"><summary>3. Data & batasan</summary><ul><li>Per video: views, likes, komentar, shares. Reach dan saves tidak tersedia lewat API ini, jadi ER = engagements ÷ views. Saves/favorit bisa ditambahkan lewat CSV.</li><li>Yang terbaca hanya video publik akun yang memberi izin.</li><li>Selama app belum disetujui (sandbox), hanya akun tester yang didaftarkan di portal yang bisa tersambung.</li></ul></details>
    <p class="muted" style="font-size:13px">Rujukan: <a href="https://developers.tiktok.com/doc/display-api-get-started/" target="_blank" rel="noopener">Display API</a> · <a href="https://developers.tiktok.com/doc/oauth-user-access-token-management" target="_blank" rel="noopener">Access token management</a></p>`;
    return;
  }
  const P = ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_manage_insights'].map((p) => `<code>${p}</code>`).join(', ');
  g.innerHTML = en ? `
  <p class="muted" style="margin-top:0">Official path: <strong>Instagram API with Facebook Login</strong> for Instagram Professional accounts (Business/Creator) linked to a Facebook Page. Permission names were checked against Meta's documentation as of 25 Nov 2026 — re-check the docs if Meta changes them.</p>
  <details class="guide"><summary>1. Make sure each IG account is Professional & linked to a Facebook Page</summary><ol><li>In the Instagram app: Settings → Account type and tools → make sure the account is <em>Professional</em> (Business or Creator).</li><li>Link it to a Facebook Page via Meta Business Suite or the Page settings → Linked accounts.</li><li>The Facebook account used to create the token must have access to that Page. Repeat for all seven brand accounts.</li></ol></details>
  <details class="guide"><summary>2. Set up a Meta App</summary><ol><li>developers.facebook.com → My Apps → Create App, choose a use case covering Instagram API with Facebook Login / Page management.</li><li>Keep the app in <strong>Development</strong> mode as long as it only serves accounts you manage; add team members under App roles.</li></ol></details>
  <details class="guide"><summary>3. Create a User Access Token in Graph API Explorer</summary><ol><li>Open <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Graph API Explorer</a> and pick your app.</li><li>Choose <em>User Token</em> and add: ${P}. If your account has a Business Manager role on the Page, the Insights docs also mention <code>ads_management</code> and <code>ads_read</code>.</li><li>Generate the token, tick all brand Pages, copy it, and exchange it for a long-lived token for daily use.</li><li>Paste it above → <em>Save &amp; test</em>. The dashboard checks token → permissions → Pages → IG accounts per brand.</li></ol></details>
  <details class="guide"><summary>4. Access & data limits</summary><ul><li><strong>Standard Access / Development mode</strong> is enough for accounts you own or manage — no App Review needed.</li><li>Account insights are kept up to 90 days; unavailable data is returned empty, not 0 ("–").</li><li>Metric data can be delayed up to 48 hours on Meta's side.</li><li>Business Discovery only works for other Professional accounts that are not age-restricted.</li></ul></details>
  <details class="guide"><summary>5. If the app ever serves other people's accounts (Advanced Access)</summary><ul><li>Serving accounts you don't manage needs <strong>Advanced Access</strong>: App Review, Business Verification, a privacy policy, and a proper login flow. Not needed for the 7 ERHA accounts.</li></ul></details>
  <p class="muted" style="font-size:13px">References: <a href="https://developers.facebook.com/documentation/instagram-platform/insights" target="_blank" rel="noopener">Insights</a> · <a href="https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery/" target="_blank" rel="noopener">Business Discovery</a> · <a href="https://developers.facebook.com/docs/graph-api/guides/explorer/" target="_blank" rel="noopener">Graph API Explorer</a></p>` : `
  <p class="muted" style="margin-top:0">Jalur resmi: <strong>Instagram API with Facebook Login</strong> untuk akun Instagram Professional (Business/Creator) yang terhubung ke Facebook Page. Nama izin dicek terhadap dokumentasi Meta per 25 Nov 2026 — cek ulang kalau Meta mengubahnya.</p>
  <details class="guide"><summary>1. Pastikan akun IG Professional & terhubung ke Facebook Page</summary><ol><li>Di aplikasi Instagram: Pengaturan → Jenis akun dan alat → pastikan akun <em>Professional</em> (Business atau Creator).</li><li>Hubungkan ke Facebook Page lewat Meta Business Suite atau pengaturan Page → Akun yang dihubungkan.</li><li>Akun Facebook pembuat token harus punya akses ke Page tersebut. Ulangi untuk ketujuh akun brand.</li></ol></details>
  <details class="guide"><summary>2. Siapkan Meta App</summary><ol><li>developers.facebook.com → My Apps → Create App, pilih use case yang mencakup Instagram API with Facebook Login / pengelolaan Page.</li><li>Biarkan app di mode <strong>Development</strong> selama hanya dipakai untuk akun yang kamu kelola; tambahkan anggota tim di App roles.</li></ol></details>
  <details class="guide"><summary>3. Buat User Access Token di Graph API Explorer</summary><ol><li>Buka <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Graph API Explorer</a>, pilih app kamu.</li><li>Pilih <em>User Token</em> dan tambahkan: ${P}. Jika akunmu punya peran Business Manager di Page tersebut, dokumentasi Insights juga menyebut <code>ads_management</code> dan <code>ads_read</code>.</li><li>Generate token, centang semua Page brand, salin, lalu tukar jadi long-lived token untuk pemakaian harian.</li><li>Tempel di atas → <em>Simpan &amp; uji</em>. Dashboard mengecek token → izin → Page → akun IG per brand.</li></ol></details>
  <details class="guide"><summary>4. Batasan akses & data</summary><ul><li><strong>Standard Access / mode Development</strong> cukup untuk akun yang kamu miliki atau kelola — tanpa App Review.</li><li>Account insights disimpan maksimal 90 hari; data yang tidak tersedia dikembalikan kosong, bukan 0 ("–").</li><li>Data metrik bisa tertunda hingga 48 jam di sisi Meta.</li><li>Business Discovery hanya untuk akun Professional lain yang tidak dibatasi umur.</li></ul></details>
  <details class="guide"><summary>5. Kalau suatu saat melayani akun orang lain (Advanced Access)</summary><ul><li>Melayani akun yang tidak kamu kelola butuh <strong>Advanced Access</strong>: App Review, Business Verification, kebijakan privasi, dan alur login yang benar. Tidak dibutuhkan untuk 7 akun ERHA.</li></ul></details>
  <p class="muted" style="font-size:13px">Rujukan: <a href="https://developers.facebook.com/documentation/instagram-platform/insights" target="_blank" rel="noopener">Insights</a> · <a href="https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery/" target="_blank" rel="noopener">Business Discovery</a> · <a href="https://developers.facebook.com/docs/graph-api/guides/explorer/" target="_blank" rel="noopener">Graph API Explorer</a></p>`;
}

// ================= CSV =================
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
const TYPE_MAP = { reel: 'Reels', reels: 'Reels', carousel: 'Carousel', carousel_album: 'Carousel', album: 'Carousel', image: 'Image', photo: 'Photo', foto: 'Image', single: 'Image', video: 'Video', story: 'Story', stories: 'Story', text: 'Text', teks: 'Text', text_post: 'Text', quote: 'Quote' };
function validateCSV(text, plat = 'ig') {
  const spec = CSV_SPEC[plat], rows = parseCSV(text), errors = [];
  if (!rows.length) return { errors: [L('File kosong.', 'The file is empty.')] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const missing = spec.req.filter((c) => !head.includes(c));
  if (missing.length) return { errors: [L(`Kolom wajib tidak ditemukan: ${missing.join(', ')}. Baris pertama harus berisi header ${PNAME[plat]}: ${spec.req.join(',')}`, `Required columns not found: ${missing.join(', ')}. The first row must contain the ${PNAME[plat]} header: ${spec.req.join(',')}`)] };
  if (rows.length < 2) return { errors: [L('File hanya berisi header, belum ada baris data.', 'The file only has a header, no data rows yet.')] };
  const idx = Object.fromEntries(head.map((h, i) => [h, i])), li = idx.permalink ?? idx.link ?? idx.url;
  const cols = spec.req.concat(spec.opt).filter((c) => NUMERIC.includes(c) && idx[c] != null);
  const out = [];
  rows.slice(1).forEach((r, k) => {
    const line = k + 2, get = (c) => String(r[idx[c]] ?? '').trim();
    const p = { title: get('title'), type: get('type'), date: get('date'), source: 'csv', reach: null, saves: null, shares: null, reposts: null, quotes: null };
    if (!p.title) errors.push(L(`Baris ${line}: kolom title kosong.`, `Row ${line}: title is empty.`));
    if (!isDate(p.date)) errors.push(L(`Baris ${line}: tanggal "${p.date}" tidak valid — pakai format YYYY-MM-DD, contoh 2026-11-20.`, `Row ${line}: date "${p.date}" is invalid — use YYYY-MM-DD, e.g. 2026-11-20.`));
    p.type = TYPE_MAP[p.type.toLowerCase()] || (p.type ? p.type[0].toUpperCase() + p.type.slice(1) : 'Lainnya');
    for (const c of cols) {
      const v = get(c), fld = COL_FIELD[c] || c;
      if (v === '' || v === '-' || v === '–') { p[fld] = null; continue; }
      if (!/^\d+$/.test(v)) { errors.push(L(`Baris ${line}: ${c} "${v}" bukan angka bulat. Tulis tanpa titik/koma ribuan (mis. 12500), kosongkan kalau datanya belum ada.`, `Row ${line}: ${c} "${v}" is not a whole number. Write it without thousand separators (e.g. 12500), or leave it empty if there is no data yet.`)); continue; }
      p[fld] = Number(v);
    }
    const link = li != null ? String(r[li] ?? '').trim() : '';
    p.permalink = /^https:\/\//i.test(link) ? link : null;
    p.id = 'csv_' + (plat === 'ig' ? '' : plat + '_') + hashStr(p.title + '|' + p.date + '|' + line).toString(36);
    out.push(p);
  });
  if (errors.length) return { errors: errors.slice(0, 12).concat(errors.length > 12 ? [L(`…dan ${errors.length - 12} error lainnya.`, `…and ${errors.length - 12} more errors.`)] : []) };
  return { posts: out };
}
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function toCSV(ps, plat = S.plat, extra = true) {
  const cols = plat === 'all' ? ['platform', 'title', 'type', 'date', 'views', 'reach', 'likes', 'comments', 'saves', 'shares', 'reposts', 'quotes', 'interactions', 'permalink'] : CSV_SPEC[plat].req.concat(CSV_SPEC[plat].opt.filter((c) => !CSV_SPEC[plat].req.includes(c)));
  const all = extra ? cols.concat(['er']) : cols;
  const get = (p, c) => (c === 'er' ? (erOf(p) == null ? '' : erOf(p).toFixed(2)) : c === 'platform' ? PNAME[p.plat] : p[COL_FIELD[c] || c]);
  return '﻿' + [all.join(',')].concat(ps.map((p) => all.map((c) => csvCell(get(p, c))).join(','))).join('\r\n');
}
function templateCSV(plat = 'ig') {
  if (plat === 'tiktok') return 'title,type,date,views,likes,comments,shares,interactions,saves,permalink\r\nContoh: 3 kesalahan pakai BHA,Video,2026-11-20,85000,5200,140,310,,900,https://www.tiktok.com/@akun/video/XXXX\r\nContoh: data belum lengkap (shares kosong),Video,2026-11-21,12000,800,25,,,,\r\n';
  if (plat === 'threads') return 'title,type,date,views,likes,replies,reposts,quotes,interactions,shares,permalink\r\nContoh: Jerawat hormonal itu bukan salah kamu,Text,2026-11-20,9000,420,65,18,4,,6,https://www.threads.com/@akun/post/XXXX\r\nContoh: data belum lengkap (quotes kosong),Image,2026-11-21,3000,150,12,3,,,,\r\n';
  return 'title,type,date,views,reach,likes,comments,saves,shares,interactions,permalink\r\nContoh: 3 kesalahan pakai BHA,Reels,2026-11-20,25000,18000,900,45,320,110,1375,https://www.instagram.com/reel/XXXX/\r\nContoh: data belum lengkap (saves kosong),Carousel,2026-11-21,8000,6500,410,12,,30,,\r\n';
}
async function saveFile(name, text, mime = 'text/csv') {
  if (HOST === 'artifact') {
    if (!downloads) { openModal(L('Salin isi file', 'Copy file contents'), `<p>${esc(L('Unduhan tidak tersedia di tampilan ini. Salin isi di bawah lalu simpan sebagai', 'Downloads are not available in this view. Copy the contents below and save as'))} <code>${esc(name)}</code>.</p><textarea readonly style="min-height:240px;font-family:monospace;font-size:12px">${esc(text)}</textarea>`); return; }
    try { await downloads.save({ filename: name, data: text }); } catch (e) { if (e?.code !== 'declined') toast(L('Gagal menyimpan file: ', 'Could not save file: ') + (e?.message || e?.code), 'err'); }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' })); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function importCSVText(text, merge, plat) {
  const r = validateCSV(text, plat), box = $('#csv-msg');
  box.dataset.keep = '1';
  if (r.errors) { box.innerHTML = `<div class="note err"><strong>${esc(L(`File ${PNAME[plat]} tidak bisa diimpor.`, `The ${PNAME[plat]} file could not be imported.`))}</strong><ul style="margin:6px 0 0">${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul><div style="margin-top:6px">${esc(L('Unduh template CSV untuk contoh format yang benar.', 'Download the CSV template for an example of the correct format.'))}</div></div>`; toast(L('Format CSV salah — lihat detail di Sumber data.', 'Wrong CSV format — see details in Data sources.'), 'err'); return false; }
  let list = r.posts;
  if (merge) { const old = Store.get(pk('posts:csv', plat), []), key = (p) => p.title + '|' + p.date; const m = new Map(old.map((p) => [key(p), p])); list.forEach((p) => m.set(key(p), p)); list = [...m.values()]; }
  list.sort((a, b) => b.date.localeCompare(a.date));
  await Store.set(pk('posts:csv', plat), list);
  await Store.set(pk('coverage:csv', plat), { from: list[list.length - 1].date, to: list[0].date });
  await Store.set(pk('lastSync:csv', plat), new Date().toISOString());
  await Store.set(pk('source', plat), 'csv');
  box.innerHTML = `<p class="note ok">${esc(L(`${PNAME[plat]}: ${r.posts.length} baris diimpor (${list.length} posting CSV total). Mode ${PNAME[plat]} brand ini sekarang CSV. Rentang data: ${fmtD(list[list.length - 1].date)} – ${fmtD(list[0].date)}.`, `${PNAME[plat]}: ${r.posts.length} rows imported (${list.length} CSV posts in total). This brand's ${PNAME[plat]} is now in CSV mode. Data range: ${fmtD(list[list.length - 1].date)} – ${fmtD(list[0].date)}.`))}</p>`;
  toast(L(`${r.posts.length} posting ${PNAME[plat]} diimpor. Mode: CSV.`, `${r.posts.length} ${PNAME[plat]} posts imported. Mode: CSV.`));
  return true;
}
async function readFileText(file) { if (!file) return null; if (file.size > 5e6) { toast(L('File terlalu besar (maks 5 MB).', 'File too large (max 5 MB).'), 'err'); return null; } return file.text(); }

// ================= 9. PENGATURAN =================
function rSettings() {
  $('#set-wa').value = settings()?.wa || '';
  $('#set-sync').value = String(Store.get('cfg:sync', { minutes: 15 }).minutes || 15);
  $('#set-sync').disabled = HOST !== 'server';
  $('#sync-help').textContent = HOST === 'server' ? L('Server menarik posting 14 hari terakhir + followers semua platform yang tersambung tiap interval ini, dan sinkron penuh 90 hari sekali sehari. Interval sangat pendek memakai kuota API lebih banyak. Data Meta bisa tertunda hingga 48 jam.', 'The server pulls the last 14 days of posts + followers for every connected platform at this interval, and does a full 90-day sync once a day. Very short intervals use more API quota. Meta data can be delayed up to 48 hours.') : L('Hanya berlaku di versi server (yang tersambung ke API).', 'Only applies to the server version (connected to the APIs).');
  $('#set-brands').innerHTML = brands().map((b, i) => `<fieldset class="form" data-i="${i}" style="border:1px solid var(--line);border-radius:10px;padding:12px;border-left:5px solid ${esc(b.color || '#0a5cff')}">
    <legend style="font-weight:800;padding:0 6px">${esc(b.name)}</legend>
    <label>${L('Nama brand', 'Brand name')}<input data-f="name" value="${esc(b.name)}"></label>
    <label>${L('Username Instagram', 'Instagram username')}<input data-f="handle" value="${esc(b.handle)}"></label>
    <label>${L('Username TikTok', 'TikTok username')}<input data-f="tiktok" value="${esc(b.tiktok || '')}" placeholder="${esc(L('belum diisi', 'not set'))}"></label>
    <label>${L('Username Threads', 'Threads username')}<input data-f="threads" value="${esc(b.threads || '')}"></label>
    <label>${L('Kode kampanye WA', 'WA campaign code')}<input data-f="code" value="${esc(b.code || '')}" maxlength="6"></label>
    <label class="full">Niche<input data-f="niche" value="${esc(b.niche || '')}"></label>
    <label class="full">${L('Target audiens', 'Target audience')}<input data-f="audience" value="${esc(b.audience || '')}"></label>
    <label class="full">${L('Kata kunci riset (pisahkan koma)', 'Research keywords (comma separated)')}<input data-f="keywords" value="${esc((b.keywords || []).join(', '))}"></label>
    <label class="full">${L('Contoh kompetitor Instagram (pisahkan koma)', 'Example Instagram competitors (comma separated)')}<input data-f="suggest" value="${esc((b.suggest || []).join(', '))}"></label>
    ${b.id === 'hiserha' ? `<p class="full muted" style="font-size:13px;margin:0">${esc(L('Catatan: username yang diberikan "Hisherha.official" (pakai "sh"), sementara nama brand "Hiserha". Cek ejaan di Instagram/Threads, karena pencocokan akun API memakai username ini.', 'Note: the username provided is "Hisherha.official" (with "sh"), while the brand name is "Hiserha". Check the spelling on Instagram/Threads, because API account matching uses this username.'))}</p>` : ''}
  </fieldset>`).join('') + `<p class="muted" style="font-size:13px">${esc(L('Username Threads diisi sama dengan Instagram karena akun Threads memakai username Instagram. Username TikTok belum diketahui — isi sesuai akun resmi tiap brand.', 'Threads usernames default to the Instagram ones because Threads accounts use the Instagram username. TikTok usernames are unknown — fill them in for each brand.'))}</p>`;
  const where = {
    server: L('Semua data (watchlist, ide, kalender, eksperimen, kampanye, inquiry, snapshot, data CSV & API) tersimpan di database server dan hanya bisa diakses setelah login. Token Meta/Threads/TikTok disimpan terenkripsi di server. Perubahan dari anggota tim lain ikut muncul otomatis dalam ±30 detik.', 'All data (watchlist, ideas, calendar, experiments, campaigns, inquiries, snapshots, CSV & API data) is stored in the server database and only accessible after sign-in. Meta/Threads/TikTok tokens are stored encrypted on the server. Changes from other team members appear automatically within ~30 seconds.'),
    artifact: L('Semua data tersimpan privat di akun Claude kamu (database artifact, area data/users milikmu sendiri — tidak terlihat orang lain walau link dibagikan). Koneksi API live tidak tersedia di versi ini.', 'All data is stored privately in your Claude account (artifact database, your own data/users area — not visible to others even if the link is shared). Live API connections are not available in this version.'),
    file: L('Data tersimpan di localStorage browser ini saja: tidak ikut ke perangkat/browser lain dan hilang jika data situs dihapus. Pakai versi server atau versi claude.ai untuk penyimpanan yang aman.', "Data is stored in this browser's localStorage only: it does not follow you to other devices/browsers and is lost if site data is cleared. Use the server or claude.ai version for safe storage."),
    memory: L('Penyimpanan browser diblokir — data hilang saat halaman dimuat ulang.', 'Browser storage is blocked — data is lost when the page reloads.'),
  }[Store.kind];
  $('#storage-info').innerHTML = `<p style="margin:0;font-size:14px">${esc(where)}</p><p class="muted" style="font-size:13px">${esc(L('Yang hanya tersimpan di browser: pilihan bahasa, platform & brand terakhir, tab & periode tampilan.', 'Stored only in the browser: language, last platform & brand, tab & period view.'))}</p>`;
}
async function saveSettings() {
  const wa = normPhone($('#set-wa').value);
  if (wa && !/^[1-9]\d{7,14}$/.test(wa)) return toast(L('Nomor WA default harus format internasional, mis. 6281234567890.', 'The default WA number must be in international format, e.g. 6281234567890.'), 'err');
  const list = brands().map((b, i) => {
    const fs = $(`#set-brands fieldset[data-i="${i}"]`), v = (f) => $(`[data-f="${f}"]`, fs).value.trim();
    return { ...b, name: v('name') || b.name, handle: v('handle').replace(/^@/, '') || b.handle, tiktok: v('tiktok').replace(/^@/, ''), threads: v('threads').replace(/^@/, ''), code: v('code').toUpperCase().replace(/[^A-Z0-9]/g, '') || b.code, niche: v('niche'), audience: v('audience'), keywords: v('keywords').split(',').map((s) => s.trim()).filter(Boolean), suggest: v('suggest').split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean) };
  });
  await Store.set('settings', { ...(settings() || {}), brands: list, wa });
  if (HOST === 'server') { const m = +$('#set-sync').value; if (m !== Store.get('cfg:sync', {}).minutes) await Store.set('cfg:sync', { minutes: m }); pollLive(true); }
  S.brand = list.find((b) => b.id === S.brand.id) || list[0];
  fillBrandSelect(); toast(L('Pengaturan tersimpan.', 'Settings saved.')); render();
}

// ================= modal =================
let modalResolve = null;
function openModal(title, html) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; $('#modal').hidden = false; $('#modal-body input, #modal-body textarea, #modal-body select, #modal-body button')?.focus(); }
function closeModal() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; if (modalResolve) { modalResolve(false); modalResolve = null; } }
function confirmBox(msg) {
  return new Promise((res) => {
    openModal(L('Konfirmasi', 'Confirm'), `<p>${esc(msg)}</p><div class="row"><button class="danger" id="cf-yes">${L('Ya, lanjutkan', 'Yes, continue')}</button><button id="cf-no">${L('Batal', 'Cancel')}</button></div>`);
    modalResolve = res;
    $('#cf-yes').onclick = () => { modalResolve = null; closeModal(); res(true); };
    $('#cf-no').onclick = () => closeModal();
  });
}
function showLogin() { $('#login').hidden = false; $('#login-user').focus(); }

const labelObs = new MutationObserver(() => { for (const c of document.querySelectorAll('.stack td:not([data-l])')) { const t = c.closest('table'); const head = t && t.tHead ? t.tHead.rows[0] : null; let i = 0, q = c; while ((q = q.previousElementSibling)) i += q.colSpan; c.dataset.l = head?.cells[i]?.textContent || ''; } });
labelObs.observe(document.body, { childList: true, subtree: true });

// ================= event binding =================
function fillBrandSelect() { $('#brand-select').innerHTML = brands().map((b) => `<option value="${esc(b.id)}" ${b.id === S.brand.id ? 'selected' : ''}>${esc(b.name)}</option>`).join(''); }
function setLang(l) {
  S.lang = l; try { localStorage.setItem('smm-lang', l); } catch {}
  applyStatic(); renderTabs();
  $$('.stack td[data-l]').forEach((c) => delete c.dataset.l);
  $('#csv-msg').dataset.keep = ''; $('#cmp-code').value = '';
  if (S.started) render();
}
function setPlat(p) {
  S.plat = p; if (p !== 'all') S.srcPlat = p;
  try { localStorage.setItem('smm-plat', p); } catch {}
  $('#k-type').value = 'all'; $('#csv-msg').dataset.keep = '';
  render();
}
function bind() {
  window.addEventListener('hashchange', () => go(location.hash.slice(1), false));
  $$('#lang-seg button').forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
  $$('#plat-seg button').forEach((b) => (b.onclick = () => setPlat(b.dataset.plat)));
  $$('#src-plat-seg button').forEach((b) => (b.onclick = () => { S.srcPlat = b.dataset.plat; $('#csv-msg').dataset.keep = ''; rSource(); }));
  $('#brand-select').onchange = () => { S.brand = brands().find((b) => b.id === $('#brand-select').value); try { localStorage.setItem('smm-brand', S.brand.id); } catch {} $('#cmp-code').value = ''; $('#csv-msg').dataset.keep = ''; $('#csv-msg').innerHTML = ''; render(); };
  $$('#period-seg button').forEach((b) => (b.onclick = () => { S.period = +b.dataset.p; rSummary(); }));
  $('#chart-metric').onchange = rSummary;
  $('#sync-btn').onclick = async () => {
    const plats = S.plat === 'all' ? PLATS : [S.plat], live = plats.filter((p) => ['meta', 'api'].includes(source(S.brand, p)));
    if (S.plat !== 'all' && source() === 'csv') { toast(L('Mode CSV: impor file terbaru untuk memperbarui data.', 'CSV mode: import the latest file to update data.')); S.srcPlat = S.plat; go('sumber'); return; }
    if (!live.length) { for (const p of plats) await Store.set(pk('lastSync:demo', p), new Date().toISOString()); toast(L('Data demo dimuat ulang. Angka demo memang tidak berubah — pilih CSV atau API untuk data asli.', 'Demo data reloaded. Demo numbers do not change — choose CSV or an API for real data.')); render(); return; }
    $('#sync-btn').disabled = true; $('#sync-btn').textContent = L('Menyinkron…', 'Syncing…');
    for (const p of live) await platSync(p, S.brand.id);
    $('#sync-btn').disabled = false;
  };
  ['#k-search', '#k-type', '#k-period', '#k-sort'].forEach((s) => $(s).addEventListener('input', rContent));
  $('#k-export').onclick = () => { const ps = filteredPosts(); if (!ps.length) return toast(L('Tidak ada data untuk diekspor.', 'No data to export.'), 'err'); saveFile(`posts-${S.brand.id}-${S.plat}-${today()}.csv`, toCSV(ps, S.plat)); };
  $('#k-template').onclick = () => saveFile(`template-${curPlat()}.csv`, templateCSV(curPlat()));
  $('#csv-template').onclick = () => saveFile(`template-${S.srcPlat}.csv`, templateCSV(S.srcPlat));
  $('#csv-sample').onclick = () => saveFile(`sample-data-${S.brand.id}-${S.srcPlat}.csv`, toCSV(tag(demoData(S.brand, S.srcPlat).posts, S.srcPlat), S.srcPlat, false));
  $('#k-import').onclick = () => { if (S.plat === 'all') { toast(L('Pilih platform dulu (Instagram, TikTok, atau Threads) sebelum impor CSV.', 'Pick a platform first (Instagram, TikTok, or Threads) before importing a CSV.'), 'err'); return; } $('#hidden-csv').click(); };
  $('#hidden-csv').onchange = async (ev) => { const t = await readFileText(ev.target.files[0]); ev.target.value = ''; if (t == null) return; S.srcPlat = curPlat(); const ok = await importCSVText(t, false, curPlat()); if (ok) render(); else go('sumber'); };
  $('#csv-import').onclick = async () => { const f = $('#csv-file').files[0]; if (!f) return toast(L('Pilih file CSV dulu.', 'Choose a CSV file first.'), 'err'); const t = await readFileText(f); if (t == null) return; if (await importCSVText(t, $('#csv-merge').checked, S.srcPlat)) { $('#csv-file').value = ''; render(); } };
  $('#csv-clear').onclick = async () => { const p = S.srcPlat; if (await confirmBox(L(`Hapus semua data CSV & snapshot CSV ${PNAME[p]} untuk `, `Delete all ${PNAME[p]} CSV data & CSV snapshots for `) + S.brand.name + '?')) { for (const k of ['posts:csv', 'coverage:csv', 'snaps:csv', 'lastSync:csv']) await Store.del(pk(k, p)); $('#csv-msg').dataset.keep = ''; toast(L('Data CSV dihapus.', 'CSV data deleted.')); render(); } };
  $('#snap-form').onsubmit = async (ev) => { ev.preventDefault(); const d = $('#snap-date').value, v = $('#snap-val').value, p = S.srcPlat; if (!isDate(d) || v === '' || +v < 0) return toast(L('Isi tanggal dan jumlah followers yang valid.', 'Enter a valid date and follower count.'), 'err'); const list = Store.get(pk('snaps:csv', p), []).filter((x) => x.date !== d); list.push({ date: d, followers: +v }); list.sort((a, b) => a.date.localeCompare(b.date)); await Store.set(pk('snaps:csv', p), list); $('#snap-val').value = ''; toast(L('Snapshot tersimpan.', 'Snapshot saved.')); rSource(); };
  $('#meta-form').onsubmit = async (ev) => {
    ev.preventDefault(); const t = $('#meta-token').value.trim(); if (!t) return toast(L('Tempel token dulu.', 'Paste a token first.'), 'err');
    $('#meta-save').disabled = true; $('#meta-status').innerHTML = `<p class="muted">${L('Menyimpan & menguji token…', 'Saving & testing token…')}</p>`;
    try { const r = await api('POST', '/api/meta/token', { token: t }); $('#meta-token').value = ''; toast(r.ok ? L('Token tersimpan & koneksi OK. Sinkron otomatis dimulai.', 'Token saved & connection OK. Automatic sync started.') : L('Token tersimpan, tapi ada masalah: ', 'Token saved, but there is a problem: ') + (KIND_LABEL()[r.kind] || r.kind), r.ok ? '' : 'err'); }
    catch (e) { toast(e.status === 400 ? L('Format token tidak dikenali. Salin ulang token dari Graph API Explorer (tanpa spasi atau tanda kutip).', 'Token format not recognised. Copy the token again from Graph API Explorer (no spaces or quotes).') : e.message, 'err'); }
    $('#meta-save').disabled = false; await Store.reloadServer(); pollLive(true); rMeta();
  };
  $('#meta-test').onclick = async () => { $('#meta-status').innerHTML = `<p class="muted">${L('Menguji koneksi…', 'Testing connection…')}</p>`; try { await api('POST', '/api/meta/test'); } catch (e) { toast(e.message, 'err'); } rMeta(); };
  $('#meta-remove').onclick = async () => { if (await confirmBox(L('Hapus token Meta dari server? Data yang sudah tersinkron tetap ada.', 'Remove the Meta token from the server? Already-synced data is kept.'))) { await api('DELETE', '/api/meta/token'); toast(L('Token dihapus.', 'Token removed.')); pollLive(true); rMeta(); } };
  $('#wl-form').onsubmit = (ev) => { ev.preventDefault(); const v = $('#wl-input').value; $('#wl-input').value = ''; addWatch(v); };
  $('#wl-check-all').onclick = async () => { const n = Store.get(pk('watchlist', 'ig'), []).length; for (let i = 0; i < n; i++) await checkWatch(i); };
  $('#kw-form').onsubmit = (ev) => { ev.preventDefault(); updKw(); $('#kw-go').click(); };
  $('#kw-input').addEventListener('input', updKw);
  $('#kw-go').addEventListener('click', updKw);
  $('#tr-load').onclick = loadTrends; $('#tr-only').onchange = rTrendList;
  $('#idea-add').onclick = () => ideaForm({});
  ['#idea-search', '#idea-status', '#idea-format', '#idea-plat', '#idea-dated'].forEach((s) => $(s).addEventListener('input', rPlanner));
  const shiftMonth = (n) => { const [y, m] = S.calMonth.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1)); S.calMonth = d.toISOString().slice(0, 7); rPlanner(); };
  $('#cal-prev').onclick = () => shiftMonth(-1); $('#cal-next').onclick = () => shiftMonth(1); $('#cal-today').onclick = () => { S.calMonth = today().slice(0, 7); rPlanner(); };
  $$('#rep-seg button').forEach((b) => (b.onclick = () => { S.repPreset = b.dataset.p; rReport(); }));
  ['#rep-start', '#rep-end'].forEach((s) => $(s).addEventListener('change', () => { S.repPreset = 'custom'; rReport(); }));
  $('#rep-build').onclick = rReport; $('#rep-print').onclick = printReport;
  $('#exp-add').onclick = () => expForm({});
  $('#cmp-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const phone = normPhone($('#cmp-phone').value), code = $('#cmp-code').value.trim().toUpperCase(), name = $('#cmp-name').value.trim(), message = $('#cmp-msg').value.trim();
    if (/^0/.test(phone)) return toast(L('Nomor harus format internasional: ganti 0 di depan dengan kode negara, mis. 62812…', 'Use international format: replace the leading 0 with the country code, e.g. 62812…'), 'err');
    if (!/^[1-9]\d{7,14}$/.test(phone)) return toast(L('Nomor WhatsApp tidak valid. Contoh: 6281234567890 (tanpa +, spasi, atau 0 di depan).', 'Invalid WhatsApp number. Example: 6281234567890 (no +, spaces, or leading 0).'), 'err');
    if (!/^[A-Z0-9-]{3,24}$/.test(code)) return toast(L('Kode kampanye hanya huruf, angka, dan tanda minus (3–24 karakter).', 'Campaign code: letters, numbers, and hyphens only (3–24 characters).'), 'err');
    if (allCodes().includes(code)) return toast(L('Kode ' + code + ' sudah dipakai kampanye lain. Pakai kode unik.', 'Code ' + code + ' is already used by another campaign. Use a unique code.'), 'err');
    const c = { id: uid(), name, code, phone, message, channel: $('#cmp-channel').value, created: new Date().toISOString() };
    await Store.set(bk('campaigns'), [...camps(), c]); toast(L('Kampanye tersimpan. Link WhatsApp siap disalin.', 'Campaign saved. WhatsApp link ready to copy.')); resetCampForm(); rLeads();
  };
  $('#inq-form').onsubmit = async (ev) => {
    ev.preventDefault(); const cid = $('#inq-cmp').value, d = $('#inq-date').value;
    if (!cid) return toast(L('Buat kampanye dulu.', 'Create a campaign first.'), 'err'); if (!isDate(d)) return toast(L('Tanggal tidak valid.', 'Invalid date.'), 'err');
    await Store.set(bk('inquiries'), [...inqs(), { id: uid(), campaignId: cid, date: d, note: $('#inq-note').value.trim(), status: $('#inq-status').value, created: new Date().toISOString() }]);
    $('#inq-note').value = ''; toast(L('Inquiry tercatat.', 'Inquiry logged.')); rLeads();
  };
  $('#set-save').onclick = saveSettings;
  $('#backup-btn').onclick = () => saveFile(`backup-smm-${today()}.json`, JSON.stringify(Store.cache, null, 1), 'application/json');
  $('#reset-brand').onclick = async () => { if (await confirmBox(L(`Hapus SEMUA data ${S.brand.name} di semua platform (CSV, ide, kalender, eksperimen, kampanye, inquiry, watchlist, snapshot)? Data hasil sinkron API tetap ada. Tidak bisa dibatalkan.`, `Delete ALL ${S.brand.name} data on every platform (CSV, ideas, calendar, experiments, campaigns, inquiries, watchlist, snapshots)? API-synced data is kept. This cannot be undone.`))) { for (const k of Object.keys(Store.cache)) if (k.startsWith(`b:${S.brand.id}:`) && !/:(meta|api)$/.test(k) && !k.includes(':meta') && !k.endsWith(':api')) await Store.del(k); toast(L('Data brand dihapus.', 'Brand data deleted.')); render(); } };
  $('#modal-close').onclick = closeModal;
  $('#modal').addEventListener('click', (ev) => { if (ev.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  $('#login-form').onsubmit = async (ev) => {
    ev.preventDefault(); $('#login-msg').innerHTML = '';
    try { await api('POST', '/api/login', { username: $('#login-user').value, password: $('#login-pass').value }); $('#login').hidden = true; $('#login-pass').value = ''; await start(); }
    catch (e) { $('#login-msg').innerHTML = `<p class="note err">${esc(e.status === 401 ? L('Username atau password salah.', 'Wrong username or password.') : e.status === 429 ? L('Terlalu banyak percobaan. Coba lagi 15 menit lagi.', 'Too many attempts. Try again in 15 minutes.') : e.message)}</p>`; }
  };
  $('#logout-btn').onclick = async () => { await api('POST', '/api/logout'); location.reload(); };
}

async function start() {
  try { await Store.init(); }
  catch (e) { if (HOST === 'server') { showLogin(); return; } }
  if (!settings()) await Store.set('settings', { brands: DEFAULT_BRANDS, wa: '6281234567890' });
  let saved = null; try { saved = localStorage.getItem('smm-brand'); } catch {}
  S.brand = brands().find((b) => b.id === saved) || brands()[0];
  S.srcPlat = curPlat();
  fillBrandSelect();
  $('#logout-btn').hidden = HOST !== 'server';
  if (HOST === 'server') { await pollLive(true); if (!S.pollTimer) S.pollTimer = setInterval(() => pollLive(), 30000); }
  S.started = true;
  const qs = new URLSearchParams(location.search).get('tiktok');
  if (qs) { S.srcPlat = 'tiktok'; toast(qs === 'ok' ? L('Akun TikTok tersambung.', 'TikTok account connected.') : L('Gagal menghubungkan TikTok. Coba lagi.', 'Could not connect TikTok. Try again.'), qs === 'ok' ? '' : 'err'); history.replaceState(null, '', location.pathname + location.hash); }
  go(location.hash.slice(1) || 'ringkasan', false);
}
applyStatic(); renderTabs(); bind();
if (HOST === 'server') fetch('/api/me', { credentials: 'same-origin' }).then((r) => (r.ok ? start() : showLogin())).catch(() => showLogin());
else start();
window.__smm = { parseCSV, validateCSV, agg, eng, erOf, insightFor, Store, S, demoData, toCSV, templateCSV, setLang, setPlat, pollLive };
}
