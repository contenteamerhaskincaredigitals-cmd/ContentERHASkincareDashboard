"""Tes TikTok, Threads & tampilan gabungan. Dijalankan oleh test/run_platforms.sh"""
import os, re, sys, datetime
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:3102'); OUT = os.environ.get('OUT', '/tmp/smm-plat'); PW = os.environ['PW']
os.makedirs(OUT, exist_ok=True)
res = []
def check(n, c, d=''):
    res.append((n, bool(c))); print(('PASS ' if c else 'FAIL ') + n + ('' if c or not d else ' — ' + str(d)[:500]))
today = datetime.date.today(); d = lambda n: (today - datetime.timedelta(days=n)).isoformat()
TT = "title,type,date,views,likes,comments,shares,interactions,saves\n" + "\n".join([
  f"TT A,Video,{d(1)},50000,3000,100,200,,500", f"TT B,Video,{d(5)},20000,1000,40,0,,",  # interactions kosong → 1000+40+0
  f"TT C,Video,{d(9)},10000,400,20,,,",  # shares kosong → engagements tidak bisa dihitung
  f"TT D,Video,{d(12)},30000,2000,50,100,2150,"])
TH = "title,type,date,views,likes,replies,reposts,quotes,interactions,shares\n" + "\n".join([
  f"TH A,Text,{d(2)},8000,400,60,20,0,,5", f"TH B,Image,{d(6)},4000,100,10,5,1,,", f"TH C,Text,{d(10)},6000,200,30,,2,,"])
open(f'{OUT}/tt.csv', 'w').write(TT); open(f'{OUT}/th.csv', 'w').write(TH)
open(f'{OUT}/ig_for_threads.csv', 'w').write("title,type,date,views,reach,likes,comments,saves,shares,interactions\nX,Reels,2026-11-20,1,1,1,1,1,1,4\n")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1300, 'height': 900}, timezone_id='Asia/Jakarta', accept_downloads=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector('#login:not([hidden])'); pg.fill('#login-user', 'admin'); pg.fill('#login-pass', PW); pg.click('#login-form button'); pg.wait_for_selector('#kpis .kpi')
    # ---- TikTok demo
    pg.click('#plat-seg button[data-plat="tiktok"]')
    check('TikTok: ER label ÷ views', '÷ views' in pg.inner_text('#kpis'))
    check('TikTok: metrik grafik tanpa Saves', 'Saves' not in pg.inner_text('#chart-metric') and 'Followers' in pg.inner_text('#chart-metric'))
    pg.click('#tabs button[data-v="konten"]'); hdr = pg.inner_text('#k-table thead')
    check('TikTok: tabel tanpa kolom Reach', 'Reach' not in hdr and 'Views' in hdr, hdr)
    pg.screenshot(path=f'{OUT}/01-tiktok-demo.png', full_page=True)
    # ---- CSV TikTok & Threads
    pg.click('#tabs button[data-v="sumber"]')
    check('Sumber data ikut platform TikTok', pg.get_attribute('#src-plat-seg button[data-plat="tiktok"]', 'aria-pressed') == 'true')
    check('Bantuan CSV TikTok', 'TikTok' in pg.inner_text('#csv-help') and 'views,likes,comments,shares,interactions' in pg.inner_text('#csv-help'))
    with pg.expect_download() as dl: pg.click('#csv-template')
    check('Template CSV TikTok', open(dl.value.path()).read().startswith('title,type,date,views,likes,comments,shares,interactions'))
    pg.set_input_files('#csv-file', f'{OUT}/tt.csv'); pg.click('#csv-import'); pg.wait_for_selector('#csv-msg .note.ok')
    pg.click('#src-plat-seg button[data-plat="threads"]')
    pg.set_input_files('#csv-file', f'{OUT}/ig_for_threads.csv'); pg.click('#csv-import'); pg.wait_for_timeout(300)
    m = pg.inner_text('#csv-msg'); check('CSV format IG ditolak untuk Threads', 'replies' in m and 'Threads' in m, m)
    pg.set_input_files('#csv-file', f'{OUT}/th.csv'); pg.click('#csv-import'); pg.wait_for_selector('#csv-msg .note.ok')
    pg.fill('#snap-date', d(10)); pg.fill('#snap-val', '3000'); pg.click('#snap-form button'); pg.wait_for_timeout(250)
    pg.fill('#snap-date', d(0)); pg.fill('#snap-val', '3400'); pg.click('#snap-form button'); pg.wait_for_timeout(250)
    # ---- TikTok angka
    pg.click('#plat-seg button[data-plat="tiktok"]'); pg.click('#tabs button[data-v="ringkasan"]'); pg.click('#period-seg button[data-p="30"]')
    v = pg.locator('#kpis .val').all_inner_texts()
    # eng: A 3000+100+200=3300 (interactions kosong), B 1040, C null, D 2150 → 6490 ; views (eng ada): 50000+20000+30000=100000 → 6,49%
    check('TikTok: Total Engagements 6.490', v[1] == '6.490', v); check('TikTok: Views 110.000', v[2] == '110.000', v); check('TikTok: ER ÷ views 6,49%', v[3] == '6,49%', v)
    pg.click('#tabs button[data-v="konten"]'); rc = pg.locator('#k-table tbody tr', has_text='TT C').inner_text()
    check('TikTok: shares kosong tampil "–"', '–' in rc, rc)
    rb = pg.locator('#k-table tbody tr', has_text='TT B').inner_text(); check('TikTok: shares 0 tetap 0', '\t0\t' in rb, rb)
    # ---- Threads angka
    pg.click('#plat-seg button[data-plat="threads"]'); pg.click('#tabs button[data-v="ringkasan"]')
    v = pg.locator('#kpis .val').all_inner_texts()
    # eng: A 400+60+20+0=480, B 100+10+5+1=116, C reposts kosong → null ; views ER: 8000+4000 → 596/12000 = 4,97%
    check('Threads: followers 3.400 dari snapshot', v[0] == '3.400', v); check('Threads: Total Engagements 596', v[1] == '596', v); check('Threads: ER 4,97%', v[3] == '4,97%', v)
    check('Threads: perubahan followers +400', '+400' in pg.inner_text('#kpis .kpi:nth-child(1) .sub'))
    pg.click('#tabs button[data-v="konten"]'); h = pg.inner_text('#k-table thead'); check('Threads: kolom Replies/Reposts/Quotes', all(x in h for x in ['Replies', 'Reposts', 'Quotes']), h)
    pg.locator('#k-table tbody tr', has_text='TH A').click(); pg.wait_for_selector('#modal:not([hidden])')
    check('Threads: detail posting baru → cek 3 hari', 'Cek performa konten 3 hari setelah diposting.' in pg.inner_text('#modal-body'))
    pg.click('#pd-idea'); pg.wait_for_selector('#idea-f'); check('Ide dari Threads: platform Threads', pg.input_value('#idea-f [name=platform]') == 'threads'); pg.click('#idea-f button.primary'); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/02-threads.png', full_page=True)
    # ---- Gabungan
    pg.click('#plat-seg button[data-plat="all"]'); pg.click('#tabs button[data-v="ringkasan"]')
    k = pg.inner_text('#kpis'); check('Gabungan: label ER gabungan', 'ER gabungan' in k); check('Gabungan: rincian per platform', 'IG' in k and 'TT' in k and 'TH' in k, k)
    check('Gabungan: legenda platform di grafik', 'TikTok' in pg.inner_text('#chart-legend'))
    pg.select_option('#chart-metric', 'views'); check('Gabungan: batang ditumpuk', pg.locator('#main-chart svg rect').count() > 10)
    pg.screenshot(path=f'{OUT}/03-gabungan.png', full_page=True)
    pg.click('#tabs button[data-v="konten"]'); check('Gabungan: kolom Platform', 'Platform' in pg.inner_text('#k-table thead'))
    with pg.expect_download() as dl: pg.click('#k-export')
    check('Gabungan: ekspor CSV punya kolom platform', open(dl.value.path(), encoding='utf-8-sig').read().startswith('platform,title'))
    pg.click('#tabs button[data-v="laporan"]'); pg.click('#rep-seg button[data-p="30"]'); rp = pg.inner_text('#report-paper')
    check('Laporan gabungan: ER per platform + gabungan', all(x in rp for x in ['Semua platform', 'Followers Instagram', 'Followers TikTok', 'Followers Threads', 'ER gabungan']), rp[:600])
    pg.emulate_media(media='print'); pg.pdf(path=f'{OUT}/laporan-gabungan.pdf', format='A4', print_background=True); pg.emulate_media(media='screen')
    pg.screenshot(path=f'{OUT}/04-laporan-gabungan.png', full_page=True)
    pg.click('#tabs button[data-v="planner"]'); pg.select_option('#idea-plat', 'threads'); check('Filter ide per platform', pg.locator('#idea-list .idea').count() == 1)
    # ---- Eksperimen TikTok
    pg.click('#plat-seg button[data-plat="tiktok"]'); pg.click('#tabs button[data-v="eksperimen"]'); pg.click('#exp-add'); pg.wait_for_selector('#exp-f')
    check('Eksperimen TikTok: metrik tanpa reach', 'Reach' not in pg.inner_text('#exp-primary'))
    pg.fill('#exp-f [name=hypothesis]', 'Hook POV menaikkan views'); pg.fill('#exp-f [name=a_date]', d(6)); pg.fill('#exp-f [name=b_date]', d(5)); pg.click('#exp-f button.primary'); pg.wait_for_timeout(300)
    for k_, vals in (('a', dict(views=10000, likes=500, comments=20, shares=30, interactions='')), ('b', dict(views=15000, likes=900, comments=40, shares=60, interactions=''))):
        pg.click(f'#exp-list [data-res][data-k="{k_}"]'); pg.wait_for_selector('#res-f')
        for m_, v_ in vals.items(): pg.fill(f'#res-f [name={m_}]', str(v_))
        pg.click('#res-f button.primary'); pg.wait_for_timeout(300)
    t = pg.inner_text('#exp-list'); check('Eksperimen TikTok: ER ÷ views & selisih', '5,50%' in t and '6,67%' in t and 'poin persentase' in t, t)
    # ---- Live Threads
    pg.click('#tabs button[data-v="sumber"]'); pg.click('#src-plat-seg button[data-plat="threads"]'); pg.wait_for_selector('#pl-form')
    pg.fill('#pl-token', 'THEXP_aaaaaaaaaaaaaaaaaaaaaaaa'); pg.click('#pl-form button'); pg.wait_for_timeout(1200)
    check('Threads: token kedaluwarsa dikenali', 'Token kedaluwarsa' in pg.inner_text('#live-other'))
    pg.fill('#pl-token', 'THOTHER_aaaaaaaaaaaaaaaaaaaaaa'); pg.click('#pl-form button'); pg.wait_for_timeout(1200)
    check('Threads: akun lain dikenali (username tidak cocok)', 'Username tidak cocok' in pg.inner_text('#live-other'))
    pg.fill('#pl-token', 'THNOINS_aaaaaaaaaaaaaaaaaaaaaa'); pg.click('#pl-form button'); pg.wait_for_timeout(1200)
    check('Threads: izin insights kurang', 'Izin kurang' in pg.inner_text('#live-other'))
    pg.fill('#pl-token', 'THGOOD_aaaaaaaaaaaaaaaaaaaaaaa'); pg.click('#pl-form button'); pg.wait_for_timeout(1500)
    lo = pg.inner_text('#live-other'); check('Threads: tersambung + followers', 'Tersambung' in lo and '30.500' in lo, lo)
    pg.click('#src-pick [data-src="api"]'); pg.wait_for_timeout(300); pg.click('#pl-sync'); pg.wait_for_timeout(1500)
    pg.click('#plat-seg button[data-plat="threads"]'); pg.click('#tabs button[data-v="konten"]'); pg.select_option('#k-period', 'all')
    check('Threads API: 5 posting (repost orang lain dibuang)', pg.locator('#k-table tbody tr').count() == 5, pg.locator('#k-table tbody tr').count())
    check('Threads API: badge mode', 'Threads API' in pg.inner_text('#mode-badge'))
    # ---- Live TikTok: manual token kedaluwarsa tanpa refresh, lalu dengan refresh (auto-refresh), lalu OAuth
    pg.click('#tabs button[data-v="sumber"]'); pg.click('#src-plat-seg button[data-plat="tiktok"]'); pg.wait_for_selector('#live-other #tt-connect')
    check('TikTok: tombol Hubungkan akun TikTok (client key terpasang)', pg.locator('#tt-connect').count() == 1)
    pg.click('#live-other details summary'); pg.fill('#pl-token', 'TTEXP_aaaaaaaaaaaaaaaaaaaaa'); pg.click('#pl-form button'); pg.wait_for_timeout(1200)
    check('TikTok: token kedaluwarsa tanpa refresh token', 'Token kedaluwarsa' in pg.inner_text('#live-other'))
    pg.click('#live-other details summary'); pg.fill('#pl-token', 'TTEXP_aaaaaaaaaaaaaaaaaaaaa'); pg.fill('#pl-refresh', 'RTGOOD_1234567890'); pg.click('#pl-form button'); pg.wait_for_timeout(1500)
    lo = pg.inner_text('#live-other'); check('TikTok: diperbarui otomatis pakai refresh token', 'Tersambung' in lo and '120.400' in lo and 'diperbarui otomatis' in lo, lo)
    loc = pg.evaluate("fetch('/api/tiktok/connect?brandId=erhair',{redirect:'manual'}).then(r=>r.type)")
    r = ctx.request.get(BASE + '/api/tiktok/connect?brandId=erhair', max_redirects=0)
    locn = r.headers.get('location', ''); check('TikTok OAuth: redirect ke halaman izin dengan scope', 'tiktok/auth' in locn and 'video.list' in locn and 'state=' in locn, locn)
    state = re.search(r'state=([a-f0-9]+)', locn).group(1)
    r2 = ctx.request.get(BASE + f'/api/tiktok/callback?code=CODEGOOD&state={state}', max_redirects=0)
    check('TikTok OAuth: callback menyimpan token', 'tiktok=ok' in r2.headers.get('location', ''), r2.headers)
    r3 = ctx.request.get(BASE + f'/api/tiktok/callback?code=CODEGOOD&state={state}', max_redirects=0)
    check('TikTok OAuth: state sekali pakai', 'tiktok=gagal' in r3.headers.get('location', ''))
    pg.click('#src-pick [data-src="api"]'); pg.wait_for_timeout(300); pg.click('#pl-sync'); pg.wait_for_timeout(1500)
    pg.click('#plat-seg button[data-plat="tiktok"]'); pg.click('#tabs button[data-v="ringkasan"]')
    v = pg.locator('#kpis .val').all_inner_texts(); check('TikTok API: followers 120.400', v[0] == '120.400', v)
    pg.click('#tabs button[data-v="konten"]'); pg.select_option('#k-period', 'all'); check('TikTok API: 6 video', pg.locator('#k-table tbody tr').count() == 6)
    # ---- Live pill & gabungan
    lv = pg.evaluate("fetch('/api/live').then(r=>r.json())"); check('Live: Threads & TikTok terjadwal', 'acneact' in lv['platforms']['threads'] and 'acneact' in lv['platforms']['tiktok'], lv['platforms'])
    pg.evaluate('__smm.pollLive()'); pg.wait_for_timeout(500); pg.click('#plat-seg button[data-plat="all"]')
    check('Pill gabungan menunjukkan platform live', 'TT ✓' in pg.inner_text('#live-pill') and 'TH ✓' in pg.inner_text('#live-pill'), pg.inner_text('#live-pill'))
    # ---- token tidak bocor
    allkv = pg.evaluate("fetch('/api/kv').then(r=>r.text())") + pg.evaluate("fetch('/api/platforms/status').then(r=>r.text())")
    check('Token Threads/TikTok tidak dikirim ke browser', 'THGOOD' not in allkv and 'TTGOOD' not in allkv and 'RTGOOD' not in allkv)
    # ---- English untuk TikTok
    pg.click('#lang-seg button[data-lang="en"]'); pg.click('#plat-seg button[data-plat="tiktok"]'); pg.click('#tabs button[data-v="sumber"]'); pg.wait_for_timeout(800)
    check('EN: kartu TikTok', 'Connect TikTok account' in pg.inner_text('#live-other') and 'Setup guide: TikTok' in pg.inner_text('#guide-title'))
    pg.click('#lang-seg button[data-lang="id"]')
    # ---- HP
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.click('#tabs button[data-v="ringkasan"]')
    check('Tidak melebar di HP', pg.evaluate('document.documentElement.scrollWidth') <= 392)
    pg.screenshot(path=f'{OUT}/05-mobile.png', full_page=True)
    check('Tanpa error JS', not errs, errs)
    b.close()
print(f"\n{sum(r[1] for r in res)}/{len(res)} lulus"); sys.exit(0 if all(r[1] for r in res) else 1)
