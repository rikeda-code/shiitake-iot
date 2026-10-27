// 拠点シフト表（site-shift.html）：localStorage が満杯でも開けることの検証。
// 同じサイトの収穫ダッシュボードのキャッシュ（gvizCache:）で localStorage が埋まると、
// 以前は Firestore のタブ間同期が QuotaExceededError で止まり「読み込み中…」のままになった。
// 確かめること：
//  - 満杯の状態で開いても表が出る（ログインの案内で止まらない）
//  - 満杯のときは gvizCache: のキャッシュが空けられ、ほかのキーは残る
// 実行：python3 -m http.server 8811 --directory dashboard を起動してから node tests/site-shift/verify_storage_full.js
const { chromium } = require('playwright');
const { openShiftPage } = require('./helpers');

const URL = 'http://localhost:8811/site-shift.html';
const SITE = 'いなべ';
const MEMBERS = [
  { key: 'k1', name: '栽培 一郎', dept: '栽培', empType: 'アルバイト', flag: 1, row: 1, join: '2024-04-01' },
];

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const seed = {
    [`shiftSites/${SITE}/meta/members`]: { list: MEMBERS, updatedAt: 4102444800000 },
    [`shiftSites/${SITE}/months/2026-10`]: { cells: { k1: { '2026-10-12': '8:00-17:00' } } },
    [`shiftSites/${SITE}/months/2026-11`]: { cells: {} },
    [`shiftSites/${SITE}/meta/fixed`]: {},
  };
  const page = await openShiftPage(ctx, { seed, members: MEMBERS });
  // ページの前に同じ場所のページを開き、localStorage を収穫ダッシュボードのキャッシュで満杯にする
  await page.goto(URL.replace('site-shift.html', 'no-such-page'));
  const filled = await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('sizeGradeMode', 'keep');
    const big = 'x'.repeat(256 * 1024);
    let n = 0;
    try { for (;;) { localStorage.setItem('gvizCache:' + n, big); n++; } } catch (e) { /* 満杯 */ }
    // 端数も埋める
    for (const size of [16384, 1024, 64, 1]) { try { for (let m = 0; ; m++) localStorage.setItem('gvizCache:s' + size + '_' + m, 'x'.repeat(size)); } catch (e) { /* 満杯 */ } }
    let full = false; try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); } catch (e) { full = true; }
    return { n, full };
  });
  check('準備：localStorage が満杯になった', filled.full, JSON.stringify(filled));

  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
  await page.goto(URL);
  const shown = await page.waitForSelector('#grid tbody td.name[data-r]', { timeout: 8000 }).then(() => true, () => false);
  check('満杯でも表が出る', shown, await page.textContent('#gridBox').catch(() => ''));
  const left = await page.evaluate(() => ({ gviz: Object.keys(localStorage).filter(k => k.startsWith('gvizCache:')).length, keep: localStorage.getItem('sizeGradeMode') }));
  check('gvizCache: のキャッシュが空けられる', left.gviz === 0, JSON.stringify(left));
  check('ほかのキー（sizeGradeMode）は残る', left.keep === 'keep', JSON.stringify(left));

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
