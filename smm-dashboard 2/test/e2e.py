"""Tes end-to-end: python3 test/e2e.py  (server + mock harus sudah jalan, lihat test/run.sh)"""
import os, sys, json, datetime, re
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:3100')
OUT = os.environ.get('OUT', '/tmp/smm-test')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail and not cond else ''))

today = datetime.date.today()  # container UTC; app pakai WIB, selisih maks 1 hari → pakai tanggal aman
d = lambda n: (today - datetime.timedelta(days=n)).isoformat()

GOOD_CSV = "title,type,date,views,reach,likes,comments,saves,shares,interactions,permalink\n" + "\n".join([
  f"Tes A,Reels,{d(2)},10000,8000,400,20,100,80,600,https://www.instagram.com/reel/a/",
  f"Tes B,Reels,{d(5)},5000,4000,100,10,0,0,,",           # interactions kosong → 110 dari 4 komponen; saves/shares 0 valid
  f"Tes C,Carousel,{d(6)},3000,2000,50,5,,10,,",            # saves kosong → engagements tidak bisa dihitung
  f"Tes D,Reels,{d(9)},9000,7000,300,15,60,25,400,",
  f"Tes E,Reels,{d(10)},8000,6000,280,14,50,20,364,",
  f"Tes F,Reels,{d(12)},2000,1500,20,1,2,1,24,",
  f"Tes H,Reels,{d(25)},8500,6500,250,12,40,18,320,",
  f"Tes I,Reels,{d(28)},9000,7200,270,13,45,20,348,",
  f"Tes G,Image,{d(40)},1000,900,30,2,5,3,40,",
])
BAD_CSV = "judul,tipe,tanggal\nx,y,z\n"
BAD_DATE_CSV = "title,type,date,views,reach,likes,comments,saves,shares,interactions\nX,Reels,20/11/2026,1.000,10,1,1,1,1,4\n"
open(f'{OUT}/good.csv', 'w').write(GOOD_CSV)
open(f'{OUT}/bad.csv', 'w').write(BAD_CSV)
open(f'{OUT}/bad_date.csv', 'w').write(BAD_DATE_CSV)
open(f'{OUT}/empty.csv', 'w').write("title,type,date,views,reach,likes,comments,saves,shares,interactions\n")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1300, 'height': 900}, accept_downloads=True, timezone_id='Asia/Jakarta')
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text))
    pg.goto(BASE)
    # login
    pg.wait_for_selector('#login:not([hidden])')
    pg.fill('#login-user', 'admin'); pg.fill('#login-pass', 'salah-password'); pg.click('#login-form button')
    pg.wait_for_selector('#login-msg .note'); check('Login salah ditolak', 'salah' in pg.inner_text('#login-msg'))
    pg.fill('#login-pass', os.environ['PW']); pg.click('#login-form button')
    pg.wait_for_selector('#kpis .kpi')
    check('Login & ringkasan tampil (mode Demo)', 'Demo' in pg.inner_text('#mode-badge'))
    kp = pg.inner_text('#kpis'); check('4 kartu utama', pg.locator('#kpis .kpi').count() == 4 and 'Followers' in kp and 'ER' in kp)
    pg.screenshot(path=f'{OUT}/01-ringkasan-demo.png', full_page=True)
    pg.click('#period-seg button[data-p="90"]')
    check('Label cakupan followers 90 hari (snapshot demo 60 hari)', 'Cakupan followers' in pg.inner_text('#coverage-note'))
    pg.select_option('#chart-metric', 'views'); check('Grafik views punya batang', pg.locator('#main-chart svg rect').count() > 5)
    check('Catatan grafik per tanggal posting', 'total terakhir' in pg.inner_text('#chart-note'))

    # ---- impor CSV salah format
    pg.click('#tabs button[data-v="sumber"]')
    pg.set_input_files('#csv-file', f'{OUT}/bad.csv'); pg.click('#csv-import')
    pg.wait_for_selector('#csv-msg .note.err'); m = pg.inner_text('#csv-msg')
    check('CSV salah kolom → pesan jelas', 'Kolom wajib tidak ditemukan' in m, m)
    pg.set_input_files('#csv-file', f'{OUT}/bad_date.csv'); pg.click('#csv-import'); pg.wait_for_timeout(300)
    m = pg.inner_text('#csv-msg'); check('CSV tanggal/angka salah → baris disebut', 'Baris 2' in m and 'YYYY-MM-DD' in m and 'bukan angka' in m, m)
    pg.set_input_files('#csv-file', f'{OUT}/empty.csv'); pg.click('#csv-import'); pg.wait_for_timeout(300)
    check('CSV hanya header → ditolak', 'belum ada baris data' in pg.inner_text('#csv-msg'))
    check('Mode tetap Demo setelah gagal impor', 'Demo' in pg.inner_text('#mode-badge'))
    pg.screenshot(path=f'{OUT}/02-csv-error.png')
    # ---- impor CSV benar
    pg.set_input_files('#csv-file', f'{OUT}/good.csv'); pg.click('#csv-import')
    pg.wait_for_selector('#csv-msg .note.ok'); check('CSV valid diimpor, mode CSV', 'CSV' in pg.inner_text('#mode-badge'))
    # snapshot followers manual
    pg.fill('#snap-date', d(20)); pg.fill('#snap-val', '1000'); pg.click('#snap-form button'); pg.wait_for_timeout(300)
    pg.fill('#snap-date', d(1)); pg.fill('#snap-val', '1250'); pg.click('#snap-form button'); pg.wait_for_timeout(300)
    pg.click('#tabs button[data-v="ringkasan"]'); pg.click('#period-seg button[data-p="30"]')
    vals = pg.locator('#kpis .val').all_inner_texts()
    # 30 hari: A..F,H,I. Engagement: 600+110+400+364+24+320+348 (C tidak bisa) = 2166 ; reach ER = 40200 → 5,39% ; views 54500
    check('Followers dari snapshot = 1.250', vals[0] == '1.250', vals[0])
    check('Perubahan followers +250', '+250' in pg.inner_text('#kpis .kpi:nth-child(1) .sub'))
    check('Total Engagements = 2.166 (fallback 4 komponen, data kosong tidak dihitung)', vals[1] == '2.166', vals[1])
    check('Total Views = 54.500', vals[2] == '54.500', vals[2])
    check('ER berbobot = 5,39%', vals[3] == '5,39%', vals[3])
    pg.click('#period-seg button[data-p="90"]')
    check('Cakupan CSV dilabel di 90 hari', 'Cakupan posting' in pg.inner_text('#coverage-note'))
    pg.click('#period-seg button[data-p="30"]')
    pg.select_option('#chart-metric', 'followers'); check('Grafik followers garis', pg.locator('#main-chart svg path').count() == 1)
    pg.select_option('#chart-metric', 'saves'); check('Grafik saves dari CSV', pg.locator('#main-chart svg rect').count() >= 4)
    pg.screenshot(path=f'{OUT}/03-ringkasan-csv.png', full_page=True)

    # ---- tabel konten
    pg.click('#tabs button[data-v="konten"]')
    check('Tabel 9 posting', pg.locator('#k-table tbody tr').count() == 9)
    row_c = pg.locator('#k-table tbody tr', has_text='Tes C').inner_text()
    check('Saves kosong tampil "–" (bukan 0)', '–' in row_c, row_c)
    row_b = pg.locator('#k-table tbody tr', has_text='Tes B').inner_text()
    check('Nol tetap tampil 0', '\t0\t' in row_b or ' 0 ' in row_b, row_b)
    pg.fill('#k-search', 'Tes A'); check('Pencarian', pg.locator('#k-table tbody tr').count() == 1)
    pg.fill('#k-search', ''); pg.select_option('#k-type', 'Image'); check('Filter format', pg.locator('#k-table tbody tr').count() == 1)
    pg.select_option('#k-type', 'all'); pg.select_option('#k-sort', 'er:desc')
    first = pg.locator('#k-table tbody tr').first.inner_text(); check('Urut ER tertinggi', 'Tes A' in first or 'Tes D' in first or 'Tes B' in first, first)
    with pg.expect_download() as dl: pg.click('#k-export')
    path = dl.value.path(); txt = open(path, encoding='utf-8-sig').read()
    check('Ekspor CSV hasil filter', txt.startswith('title,type,date') and txt.count('\n') >= 7)
    with pg.expect_download() as dl: pg.click('#k-template')
    tpl = open(dl.value.path()).read(); open(f'{OUT}/template.csv', 'w').write(tpl); check('Unduh template', tpl.startswith('title,type,date,views,reach'))
    # detail posting + analisis + simpan ide
    pg.select_option('#k-sort', 'date:desc')
    pg.locator('#k-table tbody tr', has_text='Tes F').click()
    pg.wait_for_selector('#modal:not([hidden])')
    mt = pg.inner_text('#modal-body'); check('Detail posting + analisis', 'Analisis' in mt and 'Pembanding' in mt, mt[:200])
    check('Insight reach rendah utk Tes F', 'Reach rendah' in mt, mt)
    pg.screenshot(path=f'{OUT}/04-detail.png')
    pg.click('#pd-idea'); pg.wait_for_selector('#idea-f')
    check('Form ide terisi judul dari posting', 'Tes F' in pg.input_value('#idea-f [name=title]'))
    pg.fill('#idea-f [name=hook]', 'Hook baru: kamu salah pakai BHA?')
    pg.fill('#idea-f [name=date]', today.isoformat())
    pg.click('#idea-f button.primary'); pg.wait_for_timeout(300)
    pg.locator('#k-table tbody tr', has_text='Tes A').click(); pg.wait_for_selector('#modal:not([hidden])')
    check('Posting baru → kalimat 3 hari', 'Cek performa konten 3 hari setelah diposting.' in pg.inner_text('#modal-body'))
    pg.click('#modal-close')
    # next steps
    pg.click('#tabs button[data-v="nextsteps"]'); ns = pg.inner_text('#ns-grid')
    check('Next Steps: 4 bagian', all(k in ns for k in ['Ulangi', 'Perbaiki', 'Tes', 'Konten baru']))
    check('Next Steps: kalimat konten baru', 'Cek performa konten 3 hari setelah diposting' in ns)

    # ---- tren → ide
    pg.click('#tabs button[data-v="tren"]')
    href = pg.get_attribute('#kw-go', 'href'); check('Link Google Trends ID 90 hari', 'geo=ID' in href and 'today%203-m' in href, href)
    pg.fill('#kw-input', 'bekas jerawat'); href = pg.get_attribute('#kw-go', 'href')
    reqs = []
    ctx.on('request', lambda r: reqs.append(r.url))
    with ctx.expect_page() as newp: pg.click('#kw-go')
    np = newp.value; np.wait_for_timeout(800)
    check('Telusuri membuka tab baru ke Google Trends ID 90 hari', any('trends.google.com/trends/explore' in u and 'geo=ID' in u for u in reqs), str(reqs[-3:])); np.close()
    check('Link fallback tampil', 'bekas%20jerawat' in pg.inner_html('#kw-result') or 'bekas+jerawat' in pg.inner_html('#kw-result'))
    pg.click('#tr-load'); pg.wait_for_selector('#tr-list .tr-item')
    check('Trending Now: cocok kata kunci', 'Cocok' in pg.inner_text('#tr-list'))
    pg.check('#tr-only'); check('Filter cocok saja', pg.locator('#tr-list .tr-item').count() == 2, str(pg.locator('#tr-list .tr-item').count()))
    pg.locator('#tr-list [data-tidea]').first.click(); pg.wait_for_selector('#idea-f')
    check('Simpan tren sebagai ide: judul & link', 'tren' in pg.input_value('#idea-f [name=title]').lower() and pg.input_value('#idea-f [name=ref]').startswith('https://'))
    pg.click('#idea-f button.primary'); pg.wait_for_timeout(300)
    # watchlist sebelum token
    pg.fill('#wl-input', '@skintific_id'); pg.click('#wl-form button.primary'); pg.wait_for_timeout(800)
    check('Watchlist tanpa token → status jelas', 'token belum ada' in pg.inner_text('#wl-list'), pg.inner_text('#wl-list'))
    pg.screenshot(path=f'{OUT}/05-tren.png', full_page=True)

    # ---- planner
    pg.click('#tabs button[data-v="planner"]')
    check('Bank ide berisi 2 ide', pg.locator('#idea-list .idea').count() == 2)
    pg.select_option('#idea-dated', 'undated'); check('Ide tanpa tanggal tetap di bank', pg.locator('#idea-list .idea').count() == 1)
    pg.select_option('#idea-dated', 'all')
    check('Ide bertanggal muncul di kalender', pg.locator('#cal .chip').count() >= 1)
    # jadwalkan ide tren lewat edit
    pg.locator('#idea-list .idea', has_text='tren').click(); pg.wait_for_selector('#idea-f')
    pg.fill('#idea-f [name=date]', (today + datetime.timedelta(days=2)).isoformat()); pg.select_option('#idea-f [name=status]', 'Terjadwal')
    pg.click('#idea-f button.primary'); pg.wait_for_timeout(300)
    if (today + datetime.timedelta(days=2)).month != today.month: pg.click('#cal-next')
    check('Ide tren terjadwal di kalender', pg.locator('#cal .chip', has_text='tren').count() == 1)
    pg.fill('#idea-search', 'BHA'); check('Cari ide', pg.locator('#idea-list .idea').count() == 1); pg.fill('#idea-search', '')
    pg.screenshot(path=f'{OUT}/06-planner.png', full_page=True)

    # ---- laporan
    pg.click('#tabs button[data-v="laporan"]'); pg.click('#rep-seg button[data-p="30"]')
    rp = pg.inner_text('#report-paper')
    check('Laporan: brand, sumber, rentang', 'ERHA AcneAct' in rp and 'CSV' in rp and 'Pembanding' in rp)
    check('Laporan: ER dalam poin persentase atau – bila pembanding kosong', 'poin persentase' in rp or 'ER berbobot' in rp)
    check('Laporan: cakupan pembanding belum lengkap', 'Periode pembanding belum lengkap' in rp, rp[:400])
    check('Laporan: posting terbaik & rekomendasi', 'Posting terbaik' in rp and 'Rekomendasi' in rp)
    pg.click('#rep-seg button[data-p="7"]'); rp7 = pg.inner_text('#report-paper')
    check('Laporan 7 hari: ER pp diff (periode pembanding ada data)', 'poin persentase' in rp7, rp7[:600])
    pg.emulate_media(media='print'); pg.pdf(path=f'{OUT}/laporan.pdf', format='A4', print_background=True); pg.emulate_media(media='screen')
    check('PDF laporan dibuat', os.path.getsize(f'{OUT}/laporan.pdf') > 10000)
    pg.screenshot(path=f'{OUT}/07-laporan.png', full_page=True)

    # ---- eksperimen
    pg.click('#tabs button[data-v="eksperimen"]'); pg.click('#exp-add'); pg.wait_for_selector('#exp-f')
    pg.fill('#exp-f [name=hypothesis]', 'Hook pertanyaan menaikkan reach dibanding hook pernyataan')
    pg.select_option('#exp-f [name=variable]', 'Hook'); pg.select_option('#exp-f [name=primary]', 'reach')
    pg.fill('#exp-f [name=a_label]', 'Hook pernyataan'); pg.fill('#exp-f [name=a_date]', d(5)); pg.fill('#exp-f [name=a_link]', 'https://www.instagram.com/p/aaa/')
    pg.fill('#exp-f [name=b_label]', 'Hook pertanyaan'); pg.fill('#exp-f [name=b_date]', d(1))
    pg.click('#exp-f button.primary'); pg.wait_for_timeout(300)
    t = pg.inner_text('#exp-list'); check('Eksperimen: tanggal evaluasi & variasi menunggu', 'Evaluasi' in t and 'Isi hasil mulai' in t)
    # edit tanggal variasi ke 4 hari lalu supaya bisa diisi
    pg.click('#exp-list [data-edit]'); pg.fill('#exp-f [name=b_date]', d(4)); pg.click('#exp-f button.primary'); pg.wait_for_timeout(300)
    def fill_res(k, vals):
        pg.click(f'#exp-list [data-res][data-k="{k}"]'); pg.wait_for_selector('#res-f')
        for m, v in vals.items(): pg.fill(f'#res-f [name={m}]', str(v))
        pg.click('#res-f button.primary'); pg.wait_for_timeout(300)
    fill_res('a', dict(reach=5000, views=7000, likes=200, comments=10, shares=0, saves=40, interactions=250))
    check('Selisih belum muncul sebelum kedua hasil', 'Selisih muncul setelah' in pg.inner_text('#exp-list'))
    fill_res('b', dict(reach=6500, views=9000, likes=260, comments=0, shares=12, saves=55, interactions=327))
    t = pg.inner_text('#exp-list')
    check('Selisih tampil (reach +1.500)', '+1.500' in t, t)
    check('Nol valid: komentar 10 → 0 = −10', '−10' in t, t)
    check('ER selisih dalam poin persentase', 'poin persentase' in t)
    check('Shares dari 0 dihitung', 'dari 0' in t)
    pg.screenshot(path=f'{OUT}/08-eksperimen.png', full_page=True)

    # ---- leads WA
    pg.click('#tabs button[data-v="leads"]')
    code = pg.input_value('#cmp-code'); check('Kode kampanye otomatis', code.startswith('ACN-'), code)
    pg.fill('#cmp-name', 'Promo 12.12'); pg.fill('#cmp-phone', '0812 3456 7890'); pg.click('#cmp-form button.primary'); pg.wait_for_timeout(300)
    check('Nomor diawali 0 ditolak', pg.locator('#cmp-table tbody tr td.muted').count() == 1)
    pg.fill('#cmp-phone', '+62 812-3456-7890'); pg.click('#cmp-form button.primary'); pg.wait_for_timeout(400)
    link = pg.locator('#cmp-table a').first.get_attribute('href')
    check('Link wa.me dengan kode', link.startswith('https://wa.me/6281234567890?text=') and code in link.replace('%2D', '-'), link)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    pg.click('#cmp-table [data-copy]'); pg.wait_for_timeout(200)
    clip = pg.evaluate('navigator.clipboard.readText()'); check('Salin link', clip == link)
    pg.fill('#inq-note', 'Tanya harga serum, dari story'); pg.select_option('#inq-status', 'Inquiry'); pg.click('#inq-form button.primary'); pg.wait_for_timeout(300)
    pg.fill('#inq-note', 'Sudah booking konsultasi'); pg.select_option('#inq-status', 'Booked'); pg.click('#inq-form button.primary'); pg.wait_for_timeout(300)
    row = pg.locator('#cmp-table tbody tr').first.inner_text()
    check('Jumlah inquiry 2 & booking 1 per kampanye', re.search(r'\t2\t1\t1\t0', row) is not None, row)
    pg.screenshot(path=f'{OUT}/09-leads.png', full_page=True)

    # ---- Meta: token kedaluwarsa, izin kurang, tanpa page, API down, sukses
    pg.click('#tabs button[data-v="sumber"]')
    def set_token(t):
        pg.fill('#meta-token', t); pg.click('#meta-save'); pg.wait_for_timeout(1500)
        return pg.inner_text('#meta-status')
    s = set_token('EXPIREDTOKEN_aaaaaaaaaaaaaaaaaaaaaa'); check('Token kedaluwarsa dikenali', 'Token kedaluwarsa' in s and 'Sambungkan ulang' in s, s)
    pg.screenshot(path=f'{OUT}/10-token-expired.png')
    s = set_token('NOPERMTOKEN_aaaaaaaaaaaaaaaaaaaaaaa'); check('Izin kurang dikenali + daftar izin', 'Izin kurang' in s and 'instagram_manage_insights' in s, s)
    s = set_token('NOPAGETOKEN_aaaaaaaaaaaaaaaaaaaaaaa'); check('Page tidak ditemukan', 'Facebook Page tidak ditemukan' in s, s)
    s = set_token('NOIGTOKEN_aaaaaaaaaaaaaaaaaaaaaaaaa'); check('Akun IG tidak ditemukan', 'Akun IG Professional tidak ditemukan' in s, s)
    s = set_token('DOWNTOKEN_aaaaaaaaaaaaaaaaaaaaaaaaa'); check('API gagal dihubungi', 'tidak bisa dihubungi' in s, s)
    pg.fill('#meta-token', 'abc'); pg.click('#meta-save'); pg.wait_for_timeout(500)
    s = set_token('GOODTOKEN_aaaaaaaaaaaaaaaaaaaaaaaaa'); check('Token valid → Tersambung', 'Tersambung' in s, s)
    mp = pg.inner_text('#meta-map'); check('Pemetaan brand: AcneAct OK, Truwhite tidak ditemukan', 'OK' in mp and 'Tidak ditemukan' in mp)
    pg.click('#src-pick [data-src="meta"]'); pg.wait_for_timeout(300)
    pg.click('#tabs button[data-v="ringkasan"]'); pg.click('#sync-btn'); pg.wait_for_timeout(2500)
    check('Mode Meta Insights + sinkron', 'Meta Insights' in pg.inner_text('#mode-badge') and 'Sinkron terakhir: –' not in pg.inner_text('#last-sync'))
    vals = pg.locator('#kpis .val').all_inner_texts(); check('Followers dari Meta = 215.432', vals[0] == '215.432', str(vals))
    pg.click('#tabs button[data-v="konten"]'); pg.select_option('#k-period', 'all')
    check('Posting Meta masuk tabel (8)', pg.locator('#k-table tbody tr').count() == 8, str(pg.locator('#k-table tbody tr').count()))
    r3 = pg.locator('#k-table tbody tr', has_text='Mock post 3').inner_text(); check('Metrik tak didukung → "–" (fallback per metrik)', '–' in r3, r3)
    r2 = pg.locator('#k-table tbody tr', has_text='Mock post 2').inner_text(); check('Saves 0 dari Meta tetap 0', '\t0\t' in r2, r2)
    check('Link posting tersedia', pg.locator('#k-table a', has_text='Buka').count() == 8)
    pg.click('#tabs button[data-v="tren"]'); pg.click('#wl-list [data-check]'); pg.wait_for_timeout(1200)
    check('Business Discovery: data kompetitor', '1,2' in pg.inner_text('#wl-list') or 'jt' in pg.inner_text('#wl-list'), pg.inner_text('#wl-list'))
    pg.fill('#wl-input', 'privatexyz'); pg.click('#wl-form button.primary'); pg.wait_for_timeout(1200)
    check('Akun tidak tersedia via API ditandai', 'tidak tersedia via API' in pg.inner_text('#wl-list'))
    pg.screenshot(path=f'{OUT}/11-meta-watchlist.png', full_page=True)
    # token kedaluwarsa saat sinkron
    pg.click('#tabs button[data-v="sumber"]'); set_token('EXPIREDTOKEN_bbbbbbbbbbbbbbbbbbbbbb')
    pg.click('#tabs button[data-v="ringkasan"]'); pg.click('#sync-btn'); pg.wait_for_timeout(1500)
    check('Sinkron dengan token kedaluwarsa → toast saran', 'kedaluwarsa' in pg.inner_text('#toast').lower(), pg.inner_text('#toast'))

    # ---- persistensi setelah reload + data kosong brand lain
    pg.reload(); pg.wait_for_selector('#kpis .kpi')
    pg.click('#tabs button[data-v="planner"]'); check('Ide tetap ada setelah reload', pg.locator('#idea-list .idea').count() == 2)
    pg.select_option('#brand-select', 'truwhite'); pg.click('#tabs button[data-v="sumber"]'); pg.click('#src-pick [data-src="csv"]')
    pg.click('#tabs button[data-v="ringkasan"]'); k = pg.inner_text('#kpis'); n = pg.inner_text('#coverage-note')
    check('Data kosong: kartu "–" + pesan', k.count('–') >= 4 and 'Belum ada data posting' in n, k)
    check('Grafik kosong ada pesan', 'Belum ada data' in pg.inner_text('#main-chart'))
    pg.screenshot(path=f'{OUT}/12-kosong.png', full_page=True)
    # token tidak bocor ke browser
    kv = pg.evaluate("fetch('/api/kv').then(r=>r.text())"); st = pg.evaluate("fetch('/api/meta/status').then(r=>r.text())")
    check('Token tidak pernah dikirim ke browser', 'TOKEN_' not in kv and 'TOKEN_' not in st)
    # mobile
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.select_option('#brand-select', 'acneact'); pg.click('#tabs button[data-v="ringkasan"]')
    sw = pg.evaluate('document.documentElement.scrollWidth'); check('Tidak melebar di layar HP', sw <= 392, str(sw))
    pg.screenshot(path=f'{OUT}/13-mobile.png', full_page=True)
    check('Tanpa error JavaScript', not errors, '; '.join(errors[:5]))
    b.close()

print('\n%d/%d lulus' % (sum(r[1] for r in results), len(results)))
json.dump(results, open(f'{OUT}/results.json', 'w'), indent=1)
sys.exit(0 if all(r[1] for r in results) else 1)
