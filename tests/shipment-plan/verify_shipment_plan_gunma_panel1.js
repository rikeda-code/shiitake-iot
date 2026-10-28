// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）パネル1（在庫・出荷予定、table1）の
// 群馬対応の検証。実際のスプレッドシートには触れず、page.route()でCSV（/export?format=csv）を
// 実際のシートの形に合わせてモックする（他ファイルへの依存なし）。
// 「今日」は2026-10-28に固定（在庫は基準日の前日=2026-10-27の列を読む）。
// 確かめること：
//  - ?site=群馬 で開くと、URL_在庫管理表（DB共有）の「群馬」列・2026年の行から椎茸在庫ファイルを
//    特定し、群馬のパネル1（製品在庫・生在庫、秀/優を含む）が目安の表のとおりに表示される
//    （行名のＭ・Ｌの全角表記、転写_秀優_判別の群馬用gidでの按分を含む）
//  - 出荷予定（M/L/2L/袋）が受注計画のAY〜BB列（いなべのW〜Z列から+28列）、秀/優が
//    群馬_受注（販売抽出シート(商品別)）から読まれる
//  - いなべ→群馬→いなべと切り替えると、それぞれの拠点の数字に描き直され、切り替えの途中で
//    古い読み込み（前の拠点向け）が遅れて終わってもその時点の表示を上書きしない（世代チェック）
//  - URL_在庫管理表の群馬の欄が空のとき、製品在庫・生在庫（秀・優を含む）が「－」になり、
//    見出し近くに「URL_在庫管理表に群馬の在庫管理表がありません」の注記が出る
//  - 群馬のパネル2・3、南丹のパネル1〜3が「－」＋「◯◯は準備中です」になる
// 実行：python3 -m http.server 8812 --directory dashboard を起動してから
//       node tests/shipment-plan/verify_shipment_plan_gunma_panel1.js
const { chromium } = require('playwright');

function csvCell(v) { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function csvRow(cells) { return cells.map(csvCell).join(','); }
function toCsvText(rows) { return '﻿' + rows.map(csvRow).join('\r\n') + '\r\n'; }
function fixTodayTo(page, y, m, d) {
  return page.addInitScript(([y, m, d]) => {
    const FIXED = new Date(y, m, d, 9, 0, 0).getTime();
    const OrigDate = Date;
    class FixedDate extends OrigDate {
      constructor(...args) { if (args.length === 0) return new OrigDate(FIXED); return new OrigDate(...args); }
      static now() { return FIXED; }
    }
    window.Date = FixedDate;
  }, [y, m, d]);
}
function dstr(y, m, d) { return `Date(${y},${m - 1},${d})`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STOCK_URL_SHEET_GID = '717295394'; // 「URL_在庫管理表」タブ
const SALES_SHEET_ID = '18zyC0JwVyaW3i18LQdvHQeDpEcfzM8iolhclgNocrnM';
const SALES_INDEX_GID = '538861653'; // 「シート判別」タブ
const SALES_RAW_SHEET_ID = '17DD5aRxc9bv8uZzEfnK_Q9IGOvQVH4ieJU1c-qu7dOc';
const GUNMA_ORDER_GID = '1218802781'; // 「群馬_受注」タブ
const GUNMA_ALLOCATION_GID = '272244694'; // 群馬の椎茸在庫ファイル内「転写_秀優_判別」タブ
const GUNMA_STOCK_SHEET_ID = 'FAKE_GUNMA_STOCK_SHEET_ID';
const GUNMA_STOCK_GID = '0';
const INABE_STOCK_SHEET_ID = 'FAKE_INABE_STOCK_SHEET_ID';
const INABE_STOCK_GID = '0';
const INABE_ALLOCATION_GID = '276290820';
const OCT_MONTH_GID = '222222221';
const NOV_MONTH_GID = '222222222';
const PAGE_URL = 'http://localhost:8812/shiitake-shipment-plan.html';

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`); }

// URL_在庫管理表：1行目=見出し(A「出荷量」・B以降に拠点名)、以降の行=年×拠点のURL
function buildStockUrlCsv(opts) {
  opts = opts || {};
  const gunmaUrl = opts.noGunma ? '' : 'https://docs.google.com/spreadsheets/d/' + GUNMA_STOCK_SHEET_ID + '/edit?gid=' + GUNMA_STOCK_GID + '#gid=' + GUNMA_STOCK_GID;
  return toCsvText([
    ['出荷量', 'いなべ', '群馬', '南丹'],
    [2026, 'https://docs.google.com/spreadsheets/d/' + INABE_STOCK_SHEET_ID + '/edit?gid=' + INABE_STOCK_GID + '#gid=' + INABE_STOCK_GID, gunmaUrl, ''],
  ]);
}

// 群馬（安中）の「椎茸在庫」タブ：Ｍ製品在庫・Ｌ製品在庫は全角、それ以外（M生在庫・L生在庫・
// 2L製品在庫・2L生在庫・袋製品在庫・袋生在庫）は半角。A6(30入り)・A5(30入り)・B5(30入り)は
// 転写_秀優_判別の按分対象（秀・優の製品在庫）。stockDate=基準日の前日(2026-10-27)
function buildGunmaStockCsv(stockDate) {
  const dates = [];
  for (let i = -3; i <= 3; i++) dates.push(addDays(stockDate, i));
  const header = ['', ''].concat(dates.map(d => dstr(d.getFullYear(), d.getMonth() + 1, d.getDate())));
  const rows = [header];
  function row(label, valueAtStockDate) {
    const cells = ['', label];
    dates.forEach(d => cells.push(sameDay(d, stockDate) ? valueAtStockDate : ''));
    rows.push(cells);
  }
  row('Ｍ製品在庫', 11.7);
  row('M生在庫', 420.0);
  row('Ｌ製品在庫', 72.3);
  row('L生在庫　秀L_40　優L_60', 212.8);
  row('2L製品在庫', 138.4);
  row('2L生在庫', 502.0);
  row('袋製品在庫', 96.0);
  row('袋生在庫', 391.0);
  row('A6(30入り)', 9);
  row('A5(30入り)', 2);
  row('B5(30入り)', 13);
  return toCsvText(rows);
}

function buildGunmaAllocationCsv() {
  return toCsvText([
    ['key', 'include', 'exclude', 'factor', 'target'],
    ['A6', 'A6(30入り)', '', 3.9, '秀・製品在庫'],
    ['A5', 'A5(30入り)', '', 3.0, '秀・製品在庫'],
    ['B5', 'B5(30入り)', '', 2.4, '優・製品在庫'],
  ]);
}

// いなべの椎茸在庫（切替テスト用の簡単な値）
function buildInabeStockCsv(stockDate) {
  const dates = [];
  for (let i = -3; i <= 3; i++) dates.push(addDays(stockDate, i));
  const header = ['', ''].concat(dates.map(d => dstr(d.getFullYear(), d.getMonth() + 1, d.getDate())));
  const rows = [header];
  function row(label, v) {
    const cells = ['', label];
    dates.forEach(d => cells.push(sameDay(d, stockDate) ? v : ''));
    rows.push(cells);
  }
  row('M製品在庫', 50);
  row('M生在庫', 30);
  row('L製品在庫', 100);
  row('L生在庫　秀Ｌ_40　優Ｌ_60', 60);
  row('2L製品在庫', 20);
  row('2L生在庫', 10);
  row('袋製品在庫', 15);
  row('袋生在庫', 5);
  return toCsvText(rows);
}
function buildInabeAllocationCsv() { return toCsvText([['key', 'include', 'exclude', 'factor', 'target']]); }

function buildSalesIndexCsv(baseline) {
  const octKey = baseline.getFullYear() + '.' + (baseline.getMonth() + 1);
  const nextMonth = new Date(baseline.getFullYear(), baseline.getMonth() + 1, 1);
  const novKey = nextMonth.getFullYear() + '.' + (nextMonth.getMonth() + 1);
  return toCsvText([
    ['年月', 'URL'],
    [octKey, 'https://docs.google.com/spreadsheets/d/' + SALES_SHEET_ID + '/edit#gid=' + OCT_MONTH_GID],
    [novKey, 'https://docs.google.com/spreadsheets/d/' + SALES_SHEET_ID + '/edit#gid=' + NOV_MONTH_GID],
  ]);
}
// 受注計画の月シート：いなべ=W〜Z列(22〜25)、群馬はいなべの+28列＝AY〜BB列(50〜53)。
// gunmaValuesByDay={ day: [M,L,2L,袋] }
function buildOrderMonthCsv(maxDay, gunmaValuesByDay) {
  const width = 54; // 0〜53列（BB列まで）
  const rows = [];
  for (let i = 0; i <= maxDay + 3; i++) rows.push(new Array(width).fill(''));
  Object.keys(gunmaValuesByDay || {}).forEach(dayStr => {
    const day = Number(dayStr);
    const idx = (day + 3) - 1;
    const [m, l, l2, fukuro] = gunmaValuesByDay[dayStr];
    rows[idx][50] = m; rows[idx][51] = l; rows[idx][52] = l2; rows[idx][53] = fukuro;
  });
  return toCsvText(rows);
}
// 群馬_受注（販売抽出シート(商品別)）：B列="重量"・E列=grade・F列=サイズ。日付はG列以降
function buildGunmaRawOrderCsv(dates, syuVal, yuuVal) {
  const header = new Array(6).fill('').concat(dates.map(d => dstr(d.getFullYear(), d.getMonth() + 1, d.getDate())));
  const rows = [header];
  function row(grade, size, val) {
    const cells = new Array(6).fill('');
    cells[1] = '重量'; cells[4] = grade; cells[5] = size;
    dates.forEach(() => cells.push(val));
    rows.push(cells);
  }
  row('秀', 'L', syuVal);
  row('優', 'L', yuuVal);
  return toCsvText(rows);
}

// baseline=基準日(2026-10-28)。stockDate=基準日の前日(2026-10-27)
const baseline = new Date(2026, 9, 28);
const stockDate = addDays(baseline, -1);

async function setupPage(browser, opts) {
  opts = opts || {};
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await fixTodayTo(page, 2026, 9, 28);
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));

  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    let body = '﻿\r\n';
    if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + STOCK_URL_SHEET_GID)) body = buildStockUrlCsv(opts);
    else if (url.includes(GUNMA_STOCK_SHEET_ID) && url.includes('gid=' + GUNMA_STOCK_GID)) body = buildGunmaStockCsv(stockDate);
    else if (url.includes(GUNMA_STOCK_SHEET_ID) && url.includes('gid=' + GUNMA_ALLOCATION_GID)) body = buildGunmaAllocationCsv();
    else if (url.includes(INABE_STOCK_SHEET_ID) && url.includes('gid=' + INABE_STOCK_GID)) body = buildInabeStockCsv(stockDate);
    else if (url.includes(INABE_STOCK_SHEET_ID) && url.includes('gid=' + INABE_ALLOCATION_GID)) body = buildInabeAllocationCsv();
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_INDEX_GID)) body = buildSalesIndexCsv(baseline);
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + OCT_MONTH_GID)) body = buildOrderMonthCsv(31, opts.gunmaOctValues || { 28: [15, 25, 8, 5] });
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + NOV_MONTH_GID)) body = buildOrderMonthCsv(30, opts.gunmaNovValues || {});
    else if (url.includes(SALES_RAW_SHEET_ID) && url.includes('gid=' + GUNMA_ORDER_GID)) {
      const dates = []; for (let i = 0; i <= 8; i++) dates.push(addDays(baseline, i));
      body = buildGunmaRawOrderCsv(dates, opts.gunmaSyu === undefined ? 6 : opts.gunmaSyu, opts.gunmaYuu === undefined ? 4 : opts.gunmaYuu);
    }
    if (opts.delayGunmaStock && url.includes(GUNMA_STOCK_SHEET_ID) && url.includes('gid=' + GUNMA_STOCK_GID)) {
      await new Promise(r => setTimeout(r, opts.delayGunmaStock));
    }
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
  });

  await page.goto(PAGE_URL + (opts.query || ''));
  await page.waitForSelector('#grid, #table1'); // ページが読み込まれたことの確認（site-shiftと混同しない保険）
  return page;
}

function text(page, sel) { return page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; }, sel); }
async function clickSite(page, site) { await page.click('[data-site="' + site + '"]'); }
async function waitStable(page, sel, ms) {
  ms = ms || 1500;
  let prev = null;
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await text(page, sel);
    if (v === prev && v !== null) { await page.waitForTimeout(150); if ((await text(page, sel)) === v) return v; }
    prev = v;
    await page.waitForTimeout(150);
  }
  return text(page, sel);
}

(async () => {
  const browser = await chromium.launch();

  console.log('=== ①?site=群馬 で開くと、目安の表のとおりに表示される ===');
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('群馬') });
    await waitStable(page, '[data-stock-product="M"]');
    const expected = {
      M: { product: '11.7', raw: '420.0' },
      L: { product: '72.3', raw: '212.8' },
      '秀': { product: '41.1', raw: '85.1' },
      '優': { product: '31.2', raw: '127.7' },
      '2L': { product: '138.4', raw: '502.0' },
      '袋': { product: '96.0', raw: '391.0' },
    };
    for (const size of Object.keys(expected)) {
      const product = await text(page, '[data-stock-product="' + size + '"]');
      const raw = await text(page, '[data-stock-raw="' + size + '"]');
      check(`群馬：${size}の製品在庫=${expected[size].product}`, product === expected[size].product, product);
      check(`群馬：${size}の生在庫=${expected[size].raw}`, raw === expected[size].raw, raw);
    }
    const totalCells = await page.$$eval('#table1 tbody tr:last-child td', tds => tds.map(td => td.textContent.trim()));
    check('群馬：合計の製品在庫=318.4', totalCells[0] === '318.4', totalCells[0]);
    check('群馬：合計の生在庫=1,525.8', totalCells[1] === '1,525.8', totalCells[1]);
    check('群馬：注記は出ない（在庫管理表が見つかっている）', (await text(page, '#table1SiteNote')) === '', await text(page, '#table1SiteNote'));
    await page.close();
  }

  console.log('=== ②出荷予定：M/L/2L/袋はAY〜BB列(+28列)、秀/優は群馬_受注から ===');
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('群馬'), gunmaOctValues: { 28: [15, 25, 8, 5] }, gunmaSyu: 6, gunmaYuu: 4 });
    await waitStable(page, '[data-shipment="M"][data-shipment-offset="0"]');
    const shipM = await text(page, '[data-shipment="M"][data-shipment-offset="0"]');
    const shipL = await text(page, '[data-shipment="L"][data-shipment-offset="0"]');
    const ship2L = await text(page, '[data-shipment="2L"][data-shipment-offset="0"]');
    const shipFukuro = await text(page, '[data-shipment="袋"][data-shipment-offset="0"]');
    const shipSyu = await text(page, '[data-shipment="秀"][data-shipment-offset="0"]');
    const shipYuu = await text(page, '[data-shipment="優"][data-shipment-offset="0"]');
    check('群馬：当日(10/28)のM出荷予定=15.0(AY列)', shipM === '15.0', shipM);
    check('群馬：当日のL出荷予定=25.0(AZ列)', shipL === '25.0', shipL);
    check('群馬：当日の2L出荷予定=8.0(BA列)', ship2L === '8.0', ship2L);
    check('群馬：当日の袋出荷予定=5.0(BB列)', shipFukuro === '5.0', shipFukuro);
    check('群馬：当日の秀出荷予定=6.0(群馬_受注)', shipSyu === '6.0', shipSyu);
    check('群馬：当日の優出荷予定=4.0(群馬_受注)', shipYuu === '4.0', shipYuu);
    await page.close();
  }

  console.log('=== ③いなべ→群馬→いなべで、それぞれの数字に描き直される（古い読み込みに上書きされない） ===');
  {
    const page = await setupPage(browser, {});
    await waitStable(page, '[data-stock-product="M"]');
    const inabeProduct = await text(page, '[data-stock-product="M"]');
    check('いなべの製品在庫M=50.0', inabeProduct === '50.0', inabeProduct);

    await clickSite(page, '群馬');
    await waitStable(page, '[data-stock-product="M"]');
    const gunmaProduct = await text(page, '[data-stock-product="M"]');
    check('群馬に切り替えると群馬の製品在庫M=11.7に描き直される', gunmaProduct === '11.7', gunmaProduct);

    await clickSite(page, 'いなべ');
    await waitStable(page, '[data-stock-product="M"]');
    const backProduct = await text(page, '[data-stock-product="M"]');
    check('いなべに戻すと再びいなべの製品在庫M=50.0に戻る', backProduct === '50.0', backProduct);
    await page.close();
  }

  console.log('=== ③-2 群馬の読み込みが遅れている間にいなべへ戻しても、遅れて届いた群馬の結果で上書きされない ===');
  {
    const page = await setupPage(browser, { delayGunmaStock: 1200 });
    await waitStable(page, '[data-stock-product="M"]');
    check('最初はいなべの製品在庫M=50.0', (await text(page, '[data-stock-product="M"]')) === '50.0');

    await clickSite(page, '群馬'); // 群馬の在庫取得は1.2秒遅れて届く
    await page.waitForTimeout(300); // 群馬の読み込みがまだ終わっていないうちに
    await clickSite(page, 'いなべ'); // いなべに戻す
    await waitStable(page, '[data-stock-product="M"]', 600);
    const soonAfterSwitch = await text(page, '[data-stock-product="M"]');
    check('いなべに戻した直後はいなべの製品在庫M=50.0のまま', soonAfterSwitch === '50.0', soonAfterSwitch);

    await page.waitForTimeout(1500); // 群馬の遅れていた読み込みが届く頃まで待つ
    const afterDelay = await text(page, '[data-stock-product="M"]');
    check('群馬の遅れた読み込みが届いても、いなべの表示(50.0)が上書きされない', afterDelay === '50.0', afterDelay);
    await page.close();
  }

  console.log('=== ④URL_在庫管理表の群馬の欄が空のとき、「－」＋注記 ===');
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('群馬'), noGunma: true });
    await page.waitForTimeout(800);
    for (const size of ['M', 'L', '秀', '優', '2L', '袋']) {
      check(`群馬(URL無し)：${size}の製品在庫は－`, (await text(page, '[data-stock-product="' + size + '"]')) === '－');
      check(`群馬(URL無し)：${size}の生在庫は－`, (await text(page, '[data-stock-raw="' + size + '"]')) === '－');
    }
    check('群馬(URL無し)：注記「URL_在庫管理表に群馬の在庫管理表がありません」', (await text(page, '#table1SiteNote')) === 'URL_在庫管理表に群馬の在庫管理表がありません', await text(page, '#table1SiteNote'));
    await page.close();
  }

  console.log('=== ⑤群馬のパネル2・3、南丹のパネル1〜3は「－」＋「準備中」 ===');
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('群馬') });
    await waitStable(page, '[data-stock-product="M"]');
    check('群馬：table1(パネル1)は実データ(－ではない)', (await text(page, '[data-stock-product="M"]')) !== '－');
    check('群馬：table2(収穫予測)は－', (await text(page, '[data-harvest="M"][data-harvest-offset="0"]')) === '－');
    check('群馬：table2に「群馬は準備中です」の注記', (await text(page, '#table2SiteNote')) === '群馬は準備中です');
    check('群馬：table3(在庫予測)は－', (await text(page, '[data-stock-forecast="M"][data-stock-forecast-offset="0"]')) === '－');
    check('群馬：table3に「群馬は準備中です」の注記', (await text(page, '#table3SiteNote')) === '群馬は準備中です');
    await page.close();
  }
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('南丹') });
    await page.waitForTimeout(800);
    check('南丹：table1(パネル1)は－', (await text(page, '[data-stock-product="M"]')) === '－');
    check('南丹：table1に「南丹は準備中です」の注記', (await text(page, '#table1SiteNote')) === '南丹は準備中です');
    check('南丹：table2(収穫予測)は－', (await text(page, '[data-harvest="M"][data-harvest-offset="0"]')) === '－');
    check('南丹：table2に「南丹は準備中です」の注記', (await text(page, '#table2SiteNote')) === '南丹は準備中です');
    check('南丹：table3(在庫予測)は－', (await text(page, '[data-stock-forecast="M"][data-stock-forecast-offset="0"]')) === '－');
    check('南丹：table3に「南丹は準備中です」の注記', (await text(page, '#table3SiteNote')) === '南丹は準備中です');
    await page.close();
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
