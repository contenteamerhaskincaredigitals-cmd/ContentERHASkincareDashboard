"""Tes versi English + mode live (auto-sinkron & update antar pengguna). Dijalankan oleh test/run_live.sh"""
import os, re, sys, datetime
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:3101'); OUT = os.environ.get('OUT', '/tmp/smm-live'); PW = os.environ['PW']
os.makedirs(OUT, exist_ok=True)
res = []
def check(n, c, d=''):
    res.append((n, bool(c))); print(('PASS ' if c else 'FAIL ') + n + ('' if c or not d else ' — ' + str(d)[:400]))
today = datetime.date.today(); d = lambda n: (today - datetime.timedelta(days=n)).isoformat()
csv = "title,type,date,views,reach,likes,comments,saves,shares,interactions\n" + "\n".join(
    f"Post {i},{'Reels' if i % 2 else 'Carousel'},{d(i * 3)},{5000 + i * 300},{4000 + i * 200},{200 + i},{10},{30 + i},{12},," for i in range(1, 12))
open(f'{OUT}/en.csv', 'w').write(csv)
ID_WORDS = r'\b(yang|belum|tidak|dari|untuk|Simpan|Hapus|Tambah|Tanggal|hari|Cari|Sumber|Pengaturan|Laporan|Kampanye|Catatan|sejak|Ringkasan|Muat|Unduh|Impor|Cek|Isi|Buka|Sinkron|terakhir|Periode|Rekomendasi|Selisih|Bulan|Kalender|Ide|bertanggal|Semua|Kustom|Dari|Sampai|kosong|Belum|Tidak)\b'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    def login(ctx):
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector('#login:not([hidden])'); pg.fill('#login-user', 'admin'); pg.fill('#login-pass', PW); pg.click('#login-form button')
        pg.wait_for_selector('#kpis .kpi'); return pg, errs
    A, errsA = login(b.new_context(viewport={'width': 1300, 'height': 900}, timezone_id='Asia/Jakarta'))
    # ---- tema tidak hitam
    bg = A.evaluate("getComputedStyle(document.body).backgroundColor"); ink = A.evaluate("getComputedStyle(document.querySelector('h1')).color")
    check('Latar terang (bukan hitam)', bg == 'rgb(243, 246, 251)', bg); check('Teks navy, bukan hitam', ink == 'rgb(28, 43, 74)', ink)
    A.emulate_media(color_scheme='dark'); bg2 = A.evaluate("getComputedStyle(document.body).backgroundColor")
    check('Tetap terang walau OS dark mode', bg2 == bg, bg2); A.emulate_media(color_scheme='light')
    A.click('#period-seg button[data-p="30"]'); seg = A.evaluate("getComputedStyle(document.querySelector('#period-seg button[aria-pressed=true]')).backgroundColor")
    check('Tombol periode aktif biru', seg == 'rgb(10, 92, 255)', seg)
    check('Banner data contoh tampil di mode Demo', 'sample data' in A.inner_text('#demo-banner').lower() or 'data contoh' in A.inner_text('#demo-banner').lower())
    check('Pill status: bukan real time', 'bukan real time' in A.inner_text('#live-pill'))
    A.screenshot(path=f'{OUT}/01-id-light.png', full_page=True)
    # ---- English
    A.click('#lang-seg button[data-lang="en"]')
    check('Tab dalam English', 'Overview' in A.inner_text('#tabs') and 'Data sources' in A.inner_text('#tabs'))
    check('KPI dalam English', 'ER (weighted' in A.inner_text('#kpis'))
    check('Pill: Sample data · not live', 'not live' in A.inner_text('#live-pill'))
    A.click('#tabs button[data-v="sumber"]'); A.set_input_files('#csv-file', f'{OUT}/en.csv'); A.click('#csv-import'); A.wait_for_timeout(400)
    check('Impor CSV pesan English', 'rows imported' in A.inner_text('#csv-msg'))
    A.set_input_files('#csv-file', f'{OUT}/en.csv'.replace('en.csv', 'en.csv'));
    open(f'{OUT}/bad.csv', 'w').write("a,b\n1,2\n"); A.set_input_files('#csv-file', f'{OUT}/bad.csv'); A.click('#csv-import'); A.wait_for_timeout(300)
    check('Error CSV English', 'Required columns not found' in A.inner_text('#csv-msg'))
    # ide & eksperimen & kampanye supaya semua view berisi
    A.click('#tabs button[data-v="planner"]'); A.click('#idea-add'); A.fill('#idea-f [name=title]', 'Team idea from A'); A.fill('#idea-f [name=date]', today.isoformat()); A.click('#idea-f button.primary'); A.wait_for_timeout(300)
    A.click('#tabs button[data-v="eksperimen"]'); A.click('#exp-add'); A.fill('#exp-f [name=hypothesis]', 'Question hook beats statement hook'); A.fill('#exp-f [name=a_date]', d(6)); A.fill('#exp-f [name=b_date]', d(1)); A.click('#exp-f button.primary'); A.wait_for_timeout(300)
    A.click('#tabs button[data-v="leads"]'); A.fill('#cmp-name', 'Promo'); A.click('#cmp-form button.primary'); A.wait_for_timeout(300)
    check('Pesan WA English', 'Hi ERHA AcneAct' in A.input_value('#cmp-msg'))
    A.click('#inq-form button.primary'); A.wait_for_timeout(300)
    leftovers = {}
    for v in ['ringkasan', 'konten', 'nextsteps', 'tren', 'planner', 'laporan', 'eksperimen', 'leads', 'sumber', 'pengaturan']:
        A.click(f'#tabs button[data-v="{v}"]'); A.wait_for_timeout(250)
        if v == 'sumber': [x.evaluate('e=>e.open=true') for x in A.locator('details.guide').all()]
        txt = A.evaluate("""() => { const v = document.querySelector('.view.on').cloneNode(true);
            v.querySelectorAll('.t-title,legend,#cmp-table a,#wl-list,.idea h4,.cal .chip,#k-table td:first-child,code').forEach(e=>e.remove()); return v.innerText + '\\n' + document.querySelector('header.top').innerText; }""")
        hits = sorted(set(re.findall(ID_WORDS, txt)))
        if hits: leftovers[v] = hits
        A.screenshot(path=f'{OUT}/en-{v}.png', full_page=True)
    check('Tidak ada sisa teks Indonesia di tampilan English', not leftovers, leftovers)
    A.click('#tabs button[data-v="laporan"]'); A.click('#rep-seg button[data-p="30"]'); rp = A.inner_text('#report-paper')
    check('Laporan English', 'Report: Instagram' in rp and 'percentage points' in rp and 'Recommendations' in rp, rp[:300])
    check('Angka format English (koma ribuan)', re.search(r'\d,\d{3}', rp) is not None)
    # ---- live: token → auto-sinkron tanpa klik
    A.click('#tabs button[data-v="sumber"]'); A.fill('#meta-token', 'GOODTOKEN_aaaaaaaaaaaaaaaaaaaaaaaaa'); A.click('#meta-save'); A.wait_for_timeout(1500)
    check('Info sinkron otomatis aktif', 'Automatic sync is on' in A.inner_text('#meta-status'), A.inner_text('#meta-status'))
    A.wait_for_timeout(2500)
    A.click('#src-pick [data-src="meta"]'); A.wait_for_timeout(300)
    A.evaluate('__smm.pollLive()'); A.wait_for_timeout(600)
    A.click('#tabs button[data-v="ringkasan"]')
    pill = A.inner_text('#live-pill'); check('Pill Live dengan jadwal berikutnya', 'Live' in pill and 'every 15 min' in pill and 'next' in pill, pill)
    vals = A.locator('#kpis .val').all_inner_texts(); check('Data Meta masuk otomatis tanpa klik Sinkron', vals[0] == '215,432', vals)
    check('Sinkron terakhir terisi', 'Last sync: –' not in A.inner_text('#last-sync'))
    A.screenshot(path=f'{OUT}/02-en-live.png', full_page=True)
    # ---- multi-user: B melihat perubahan A tanpa reload
    B, errsB = login(b.new_context(viewport={'width': 1300, 'height': 900}, timezone_id='Asia/Jakarta'))
    B.click('#tabs button[data-v="planner"]'); n0 = B.locator('#idea-list .idea').count()
    A.click('#tabs button[data-v="planner"]'); A.click('#idea-add'); A.fill('#idea-f [name=title]', 'Live idea from teammate'); A.click('#idea-f button.primary'); A.wait_for_timeout(1200)
    B.evaluate('__smm.pollLive()'); B.wait_for_timeout(800)
    check('Ide dari user A muncul di user B tanpa reload', B.locator('#idea-list .idea', has_text='Live idea from teammate').count() == 1, f'{n0} -> {B.locator("#idea-list .idea").count()}')
    # ---- interval sinkron
    A.click('#tabs button[data-v="pengaturan"]'); A.select_option('#set-sync', '5'); A.click('#set-save'); A.wait_for_timeout(800)
    lv = A.evaluate("fetch('/api/live').then(r=>r.json())"); check('Interval sinkron bisa diubah (5 menit)', lv['minutes'] == 5, lv)
    A.click('#lang-seg button[data-lang="id"]'); A.click('#tabs button[data-v="ringkasan"]')
    check('Kembali ke Indonesia', 'Ringkasan' in A.inner_text('#tabs') and 'tiap 5 mnt' in A.inner_text('#live-pill'), A.inner_text('#live-pill'))
    check('Tanpa error JS', not errsA and not errsB, errsA + errsB)
    b.close()
print(f"\n{sum(r[1] for r in res)}/{len(res)} lulus"); sys.exit(0 if all(r[1] for r in res) else 1)
