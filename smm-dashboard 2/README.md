# Social Media Monitoring - ERHASkincare, ERHAIR & Hiserha

Dashboard harian untuk 7 brand: ERHA AcneAct, ERHAIR, ERHA Truwhite, ERHA Agecorrector, ERHA Skinsitive, ERHA Perfect Shield, dan Hiserha.
Platform: **Instagram, TikTok, Threads**, plus tampilan **Semua platform** (gabungan). Isinya: ringkasan, performa konten + CSV, Next Steps, kompetitor & tren, content planner, laporan PDF, experiment tracker, dan lead tracker WhatsApp.

## Tiga cara menjalankan

| Versi | Data tersimpan di | Demo & CSV | Meta Insights live | Trending Now |
|---|---|---|---|---|
| **Server (disarankan)** `node server.js` | Database SQLite di server, wajib login | ✓ | ✓ (token terenkripsi di server) | ✓ |
| **Versi claude.ai (artifact privat)** | Database artifact, area privat per akun | ✓ | – | – |
| Buka `public/index.html` langsung | localStorage browser ini saja | ✓ | – | – |

## Platform
Pilih **Instagram / TikTok / Threads / Semua** di header. Semua modul ikut: ringkasan, tabel konten, Next Steps, watchlist, ide (field platform), eksperimen, kanal kampanye WA, dan laporan.

| | Instagram | TikTok | Threads |
|---|---|---|---|
| Metrik posting | reach, views, likes, komentar, shares, saves | views, likes, komentar, shares (+ saves via CSV) | views, likes, replies, reposts, quotes, shares |
| ER berbobot | engagements ÷ reach | engagements ÷ views | engagements ÷ views |
| Engagements kalau total kosong | likes+komentar+shares+saves | likes+komentar+shares | likes+replies+reposts+quotes |
| Koneksi live | Meta (1 token untuk semua Page) | TikTok Login Kit + Display API (per akun, OAuth) | Threads API (token per akun) |
| Kompetitor | Business Discovery (otomatis) | manual (catat followers) | manual (catat followers) |

Tampilan **Semua**: followers & views dijumlahkan, grafik batang ditumpuk per platform, ER gabungan memakai views untuk semua platform (ER resmi tiap platform tetap ditampilkan terpisah).

Format CSV per platform (template bisa diunduh di Sumber data):
- Instagram: `title,type,date,views,reach,likes,comments,saves,shares,interactions` (+ `permalink`)
- TikTok: `title,type,date,views,likes,comments,shares,interactions` (+ `saves,permalink`)
- Threads: `title,type,date,views,likes,replies,reposts,quotes,interactions` (+ `shares,permalink`)

## Bahasa
Tombol **ID / EN** di kanan atas mengganti seluruh tampilan, format angka & tanggal, pesan error, panduan setup, dan laporan PDF ke English (atau kembali ke Bahasa Indonesia). Pilihan bahasa diingat per browser.

## Seberapa real time datanya?
- **Mode Demo**: angka contoh, tidak pernah berubah. Ini bukan data asli.
- **Mode CSV**: berubah hanya saat file baru diimpor.
- **Mode Meta Insights (versi server)**: server menarik data otomatis. Tiap 15 menit (bisa diatur 5/10/15/30/60 menit di Pengaturan) diambil posting 14 hari terakhir + followers terbaru, dan sekali sehari dilakukan sinkron penuh 90 hari. Browser mengecek server tiap 30 detik dan memperbarui tampilan sendiri, termasuk perubahan dari anggota tim lain. Status ditunjukkan pill **Live** di header.
- Batas dari sisi Meta: data metrik bisa tertunda hingga 48 jam, jadi angka API tidak selalu sama persis per menit dengan app Instagram.

## Menjalankan versi server

Butuh **Node.js 22.5 atau lebih baru** (memakai `node:sqlite` bawaan). Tidak ada `npm install`.

```bash
cd smm-dashboard
node server.js
# buka http://localhost:3000
```

Saat pertama jalan, akun admin dibuat otomatis dan password-nya ditulis ke `data/initial-login.txt`.
Ganti password / tambah user tim:

```bash
node server.js user:add admin passwordBaruYangPanjang
node server.js user:add sasha passwordSasha123
```

Variabel lingkungan (opsional):

| Variabel | Fungsi | Default |
|---|---|---|
| `PORT` | Port HTTP | 3000 |
| `DATA_DIR` | Folder database & kunci | `./data` |
| `APP_SECRET` | Kunci enkripsi token (kalau kosong dibuat acak di `data/.secret`) | acak |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Akun awal | admin / acak |
| `COOKIE_SECURE=1` | Wajib kalau di-hosting dengan HTTPS | mati |
| `META_API_VERSION` | Versi Graph API | v27.0 |
| `AUTO_SYNC=0` | Matikan sinkron otomatis | aktif |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | Dari TikTok Developer Portal; wajib untuk tombol "Hubungkan akun TikTok" & perpanjang token otomatis | kosong |
| `PUBLIC_URL` atau `TIKTOK_REDIRECT_URI` | Alamat publik server (mis. https://dashboard.domainmu.com) untuk redirect OAuth TikTok | host request |

**Backup:** cukup salin folder `data/` (berisi `app.db` dan `.secret`). Tanpa `.secret`/`APP_SECRET` yang sama, token Meta harus dimasukkan ulang.

### Hosting
Pilih hosting yang bisa menjalankan Node 22 **dan punya disk persisten** (supaya `data/` tidak hilang): VPS (DigitalOcean, Biznet Gio, IDCloudHost), Railway / Render / Fly.io dengan volume. Pasang HTTPS dan set `COOKIE_SECURE=1`.
Jangan pakai hosting statis (Netlify/Vercel static/GitHub Pages) untuk versi server — Meta API dan token harus di server.

## Memakai CSV

Kolom wajib: `title,type,date,views,reach,likes,comments,saves,shares,interactions` (opsional `permalink`).
- Tanggal `YYYY-MM-DD`.
- Angka tanpa titik/koma ribuan (`12500`).
- **Sel kosong = data belum ada** (ditampilkan "–"), **0 = benar-benar nol**.
- `interactions` kosong → Total Engagements dihitung dari likes + comments + shares + saves, hanya kalau keempatnya terisi.
- Followers dicatat lewat **Sumber data → Snapshot followers**.

File contoh: `sample/template-instagram.csv`, `sample/contoh-data-acneact.csv`.

## Rumus

- **ER berbobot** = total engagements ÷ total reach × 100, hanya untuk posting yang punya keduanya dan reach > 0.
- Grafik & laporan berbasis posting dikelompokkan per **tanggal tayang**: angkanya adalah total terakhir dari posting yang terbit di tanggal/periode itu, bukan angka harian.
- Perubahan ER di laporan ditulis dalam **poin persentase**.
- Insight per posting membandingkan dengan posting **format sama dan umur tayang mirip** (<3 hari, 3–7, 8–30, >30 hari); minimal 3 pembanding. Reach/ER < 70% median = rendah, ≥120% = perform.

## Meta Insights (versi server)

Panduan lengkap ada di aplikasi: **Sumber data → Panduan setup Meta**. Ringkasnya:
1. Akun IG Professional terhubung ke Facebook Page.
2. Buat Meta App (mode Development cukup untuk akun yang dikelola sendiri).
3. Graph API Explorer → User Token dengan izin `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights` → tempel di dashboard → **Simpan & uji**.
4. Tukar ke long-lived token untuk pemakaian harian. Kalau kedaluwarsa, dashboard memberi tanda — tempel token baru → Sambungkan ulang.

Uji koneksi membedakan: token kedaluwarsa, token tidak valid, izin kurang, Page tidak ditemukan, akun IG tidak ditemukan, batas API, dan API tidak bisa dihubungi.

## Tes

```bash
pip install playwright && playwright install chromium   # sekali
bash test/run.sh
```
Tes memakai mock Graph API (`test/mock-graph.js`) — 84 skenario + cek token tidak muncul di log dan tidak tersimpan plaintext.
`bash test/run_platforms.sh` menguji TikTok, Threads, tampilan gabungan, OAuth & refresh token TikTok (49 skenario).
`bash test/run_live.sh` menguji tema, versi English, auto-sinkron, dan update antar pengguna (23 skenario).
