// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）の収穫予測・在庫予測
// パネルの「詳細」（収穫見込：手入力、table2detail・table3detail）の、拠点ごとの
// 対応状況の検証。詳細は拠点を見て収穫見込GAS（直近工数計画・PR #503が実データとして
// 使う）に読み書きするため、本体（パネル1〜3）が未対応の拠点を選んだまま入力すると、
// 本体の表示と食い違う拠点の実データを書き換えてしまう。これを防ぐため、本体が対応
// している拠点（いなべ・群馬。SITE_DATAにある拠点）でだけ詳細の読み込み・保存・入力
// ができ、未対応の拠点（南丹）では止まる（PR #515の安全策。対応拠点が増えたことに
// 合わせてPR #540〜#542で判定をSITE_DATA基準に変更）。
// 保存先GAS(HARVEST_FORECAST_GAS_URL)・CSVモックの組み立ては
// verify_shipment_plan_harvest_detail.js と同じ構成を複製している（他ファイルへの依存なし）。
// 本体（table1〜3）は、パネル1〜3（在庫・出荷予定・収穫予測・在庫予測）が群馬でも
// 実データで表示するようになったため、「拠点トグルを切り替えても常にいなべのデータを
// 表示する」仕様では無くなった。⑥で、群馬・南丹を選んだときにいなべの数字を出し続け
// ないこと（南丹のパネル1〜3は「－」＋「◯◯は準備中です」になること、群馬は「準備中」の
// 注記を出さないこと）を確認する（パネル1・パネル2・3が群馬の実データで正しく表示
// されることの検証は別ファイル verify_shipment_plan_gunma_panel1.js・
// verify_shipment_plan_gunma_panel23.js が担当する）。
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

const STOCK_SHEET_ID = '1ecjNSdIIT3BzQpUIq5T25v1IjEV8eYwZpC1XwU5bacE';
const STOCK_SHEET_GID = '0';
const ALLOCATION_SHEET_GID = '276290820';
const SALES_SHEET_ID = '18zyC0JwVyaW3i18LQdvHQeDpEcfzM8iolhclgNocrnM';
const SALES_INDEX_GID = '538861653';
const SALES_RAW_SHEET_ID = '17DD5aRxc9bv8uZzEfnK_Q9IGOvQVH4ieJU1c-qu7dOc';
const SALES_RAW_INABE_ORDER_GID = '545062393';
const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const GRADE_RATIO_SHEET_GID = '1773303848';
const HARVEST_URL_SHEET_GID = '1996914203';
const STOCK_URL_SHEET_GID = '717295394'; // 「URL_在庫管理表」タブ（いなべの列・2026年の行を使う）
const HARVEST_DAILY_TOTAL_SHEET_ID = '1B7XEllKSlCEfkBPmNf_fvAz48I6XvMS3hfT_Dy4w_Tw';
const HARVEST_DAILY_TOTAL_GID = '1164843574';
const TARGET_SHEET_ID = 'FAKE_TARGET_SHEET_ID';
const TARGET_SHEET_GID = '999999999';
const SALES_MONTH_GID = '111111111';
const FAKE_GAS_URL = 'https://script.google.com/macros/s/TEST_SHIPMENT_HARVEST_FORECAST_SITEGATE/exec';
const PAGE_URL = 'http://localhost:8812/shiitake-shipment-plan.html';

// 群馬：本体（パネル1〜3）が対応したため、詳細も動く拠点になったことを確認するための
// モック一式。いなべと見分けがつくよう、あえて違う値にする（ratioはいなべと同じ25%に
// 揃え、300kg手入力時の按分結果(75.0)を使い回せるようにしてある）
const GUNMA_STOCK_SHEET_ID = 'FAKE_GUNMA_STOCK_SHEET_ID';
const GUNMA_STOCK_GID = '0';
const GUNMA_ALLOCATION_GID = '272244694';
const GUNMA_TARGET_SHEET_ID = 'FAKE_GUNMA_TARGET_SHEET_ID';
const GUNMA_TARGET_SHEET_GID = '999999998';
const GUNMA_DAILY_TOTAL_SHEET_ID = '1iZK3xgGkPhXTlnx_DGunW8YQ8bZZFE-r_5Si513r46Y'; // 「2026.5群馬収穫計画」（実物のID）
const GUNMA_DAILY_TOTAL_GID = '1272257227'; // 「転写」タブ（実物のgid）

function buildStockCsv(baseline) {
  const dates = [];
  for (let i = -3; i <= 3; i++) dates.push(addDays(baseline, i));
  const header = ['', ''].concat(dates.map(d => dstr(d.getFullYear(), d.getMonth() + 1, d.getDate())));
  const rows = [header];
  function row(label, valueAtMinus1) {
    const cells = ['', label];
    dates.forEach(d => cells.push(sameDay(d, addDays(baseline, -1)) ? valueAtMinus1 : ''));
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
function buildAllocationCsv() {
  return toCsvText([['key', 'include', 'exclude', 'factor', 'target']]);
}
function buildGradeRatioCsv() {
  return toCsvText([
    ['パネル', '等級', '比率'],
    ['収穫予測', '秀', 60],
    ['', '優', 40],
    ['在庫予測', '秀', 30],
    ['', '優', 20],
  ]);
}
function buildSalesIndexCsv(key) {
  return toCsvText([['年月', 'URL'], [key, 'https://docs.google.com/spreadsheets/d/' + SALES_SHEET_ID + '/edit#gid=' + SALES_MONTH_GID]]);
}
// いなべ=W〜Z列(22〜25)、群馬はいなべの+28列＝AY〜BB列(50〜53)
function buildSalesMonthCsv(maxDay) {
  const rows = [];
  for (let i = 0; i <= maxDay + 3; i++) rows.push(new Array(54).fill(''));
  for (let day = 1; day <= maxDay; day++) {
    const idx = (day + 3) - 1;
    rows[idx][22] = 20; rows[idx][23] = 40; rows[idx][24] = 10; rows[idx][25] = 10;
    rows[idx][50] = 5; rows[idx][51] = 10; rows[idx][52] = 2; rows[idx][53] = 3;
  }
  return toCsvText(rows);
}
function buildSalesRawInabeCsv(baseline) {
  const dates = [];
  for (let i = 0; i <= 8; i++) dates.push(addDays(baseline, i));
  const header = new Array(6).fill('').concat(dates.map(d => dstr(d.getFullYear(), d.getMonth() + 1, d.getDate())));
  const rows = [header];
  function row(unit, grade, size, val) {
    const cells = new Array(6).fill('');
    cells[1] = unit; cells[4] = grade; cells[5] = size;
    dates.forEach(() => cells.push(val));
    rows.push(cells);
  }
  row('重量', '秀', 'L', 10);
  row('重量', '優', 'L', 5);
  return toCsvText(rows);
}
// 「URL_在庫管理表」タブ：1行目=見出し(A列「出荷量」・B以降に拠点名)、以降の行=年×拠点のURL。
// いなべ・群馬それぞれの2026年の欄に、このテストが使う椎茸在庫ファイルのURLを入れる
function buildStockUrlCsv() {
  return toCsvText([
    ['出荷量', 'いなべ', '群馬', '南丹'],
    [2026, 'https://docs.google.com/spreadsheets/d/' + STOCK_SHEET_ID + '/edit?gid=' + STOCK_SHEET_GID + '#gid=' + STOCK_SHEET_GID,
      'https://docs.google.com/spreadsheets/d/' + GUNMA_STOCK_SHEET_ID + '/edit?gid=' + GUNMA_STOCK_GID + '#gid=' + GUNMA_STOCK_GID, ''],
  ]);
}
// 群馬の椎茸在庫（いなべと見分けがつく簡単な値）
function buildGunmaStockCsv(baseline) {
  const dates = [];
  for (let i = -3; i <= 3; i++) dates.push(addDays(baseline, i));
  const header = ['', ''].concat(dates.map(d => dstr(d.getFullYear(), d.getMonth() + 1, d.getDate())));
  const rows = [header];
  function row(label, valueAtMinus1) {
    const cells = ['', label];
    dates.forEach(d => cells.push(sameDay(d, addDays(baseline, -1)) ? valueAtMinus1 : ''));
    rows.push(cells);
  }
  row('M製品在庫', 10); row('M生在庫', 20);
  row('L製品在庫', 20); row('L生在庫　秀Ｌ_40　優Ｌ_60', 40);
  row('2L製品在庫', 5); row('2L生在庫', 10);
  row('袋製品在庫', 5); row('袋生在庫', 5);
  return toCsvText(rows);
}
function buildGunmaAllocationCsv() { return toCsvText([['key', 'include', 'exclude', 'factor', 'target']]); }
// 「URL_収穫管理表」タブ：いなべ・群馬それぞれの欄に、このテストが使う「収獲目標値」ファイルのURLを入れる
function buildHarvestUrlCsv() {
  return toCsvText([
    ['収穫管理表', 'いなべ', '群馬', '南丹'],
    [dstr(2026, 11, 1), 'https://docs.google.com/spreadsheets/d/' + TARGET_SHEET_ID + '/edit#gid=' + TARGET_SHEET_GID,
      'https://docs.google.com/spreadsheets/d/' + GUNMA_TARGET_SHEET_ID + '/edit#gid=' + GUNMA_TARGET_SHEET_GID, ''],
  ]);
}
function buildHarvestTargetCsv(actualDate) {
  const rows = [];
  rows.push(['日付', 'M', 'L', '2L', '袋']);
  rows.push([dstr(actualDate.getFullYear(), actualDate.getMonth() + 1, actualDate.getDate()), 100, 200, 50, 50]);
  return toCsvText(rows);
}
// 群馬の収穫実績（いなべと見分けがつく簡単な値。合計・比率はいなべと同じになるよう揃えてある
// ＝M=25%,L=50%,2L=12.5%,袋=12.5%。これにより300kg手入力時の按分結果(M=75.0)がいなべと
// 同じになるため、「いなべの計算と同じ」ことの確認に流用できる）
function buildGunmaHarvestTargetCsv(actualDate) {
  const rows = [];
  rows.push(['日付', 'M', 'L', '2L', '袋']);
  rows.push([dstr(actualDate.getFullYear(), actualDate.getMonth() + 1, actualDate.getDate()), 50, 100, 25, 25]);
  return toCsvText(rows);
}
function buildDailyTotalCsv(baseline) {
  const key = baseline.getFullYear() + '.' + (baseline.getMonth() + 1);
  const rows = [['', key]];
  for (let day = 1; day <= 30; day++) rows.push(['', 400]);
  return toCsvText(rows);
}
// 群馬の「転写」タブ（実物のID・gid宛。全日200kg固定）
function buildGunmaDailyTotalCsv(baseline) {
  const key = baseline.getFullYear() + '.' + (baseline.getMonth() + 1);
  const rows = [['', key]];
  for (let day = 1; day <= 30; day++) rows.push(['', 200]);
  return toCsvText(rows);
}

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

async function setupPage(browser, opts) {
  opts = opts || {};
  const baseline = new Date(2026, 10, 15); // 2026/11/15
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await fixTodayTo(page, 2026, 10, 15);
  const posts = [];
  const loadQueries = [];

  await page.route('**/shiitake-shipment-plan.html*', async route => {
    const res = await route.fetch();
    const html = await res.text();
    const re = /var HARVEST_FORECAST_GAS_URL = '[^']*';/;
    if (!re.test(html)) throw new Error('HARVEST_FORECAST_GAS_URLの定義が見つからない');
    const body = html.replace(re, "var HARVEST_FORECAST_GAS_URL = '" + FAKE_GAS_URL + "';");
    await route.fulfill({ response: res, body });
  });
  await page.route(FAKE_GAS_URL + '**', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      const parsed = JSON.parse(req.postData());
      posts.push(parsed);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
      return;
    }
    const url = new URL(req.url());
    const q = Object.fromEntries(url.searchParams);
    loadQueries.push(q);
    // opts.loadValuesBySiteがあれば拠点ごとに違う値を返す（古い拠点の読み込みが新しい拠点に
    // 残っていないことを見分けるため）。無ければ全拠点共通でopts.loadValuesを返す
    const values = opts.loadValuesBySite ? (opts.loadValuesBySite[q.site] || {}) : (opts.loadValues || {});
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', values: values }) });
  });

  const actualDate = addDays(baseline, -1);
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    let body = '﻿\r\n';
    if (url.includes(STOCK_SHEET_ID) && url.includes('gid=' + STOCK_SHEET_GID)) body = buildStockCsv(baseline);
    else if (url.includes(STOCK_SHEET_ID) && url.includes('gid=' + ALLOCATION_SHEET_GID)) body = buildAllocationCsv();
    else if (url.includes(GUNMA_STOCK_SHEET_ID) && url.includes('gid=' + GUNMA_STOCK_GID)) body = buildGunmaStockCsv(baseline);
    else if (url.includes(GUNMA_STOCK_SHEET_ID) && url.includes('gid=' + GUNMA_ALLOCATION_GID)) body = buildGunmaAllocationCsv();
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + GRADE_RATIO_SHEET_GID)) body = buildGradeRatioCsv();
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + HARVEST_URL_SHEET_GID)) body = buildHarvestUrlCsv();
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + STOCK_URL_SHEET_GID)) body = buildStockUrlCsv();
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_INDEX_GID)) body = buildSalesIndexCsv(baseline.getFullYear() + '.' + (baseline.getMonth() + 1));
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_MONTH_GID)) body = buildSalesMonthCsv(31);
    else if (url.includes(SALES_RAW_SHEET_ID) && url.includes('gid=' + SALES_RAW_INABE_ORDER_GID)) body = buildSalesRawInabeCsv(baseline);
    else if (url.includes(TARGET_SHEET_ID) && url.includes('gid=' + TARGET_SHEET_GID)) body = buildHarvestTargetCsv(actualDate);
    else if (url.includes(GUNMA_TARGET_SHEET_ID) && url.includes('gid=' + GUNMA_TARGET_SHEET_GID)) body = buildGunmaHarvestTargetCsv(actualDate);
    else if (url.includes(HARVEST_DAILY_TOTAL_SHEET_ID) && url.includes('gid=' + HARVEST_DAILY_TOTAL_GID)) body = buildDailyTotalCsv(baseline);
    else if (url.includes(GUNMA_DAILY_TOTAL_SHEET_ID) && url.includes('gid=' + GUNMA_DAILY_TOTAL_GID)) body = buildGunmaDailyTotalCsv(baseline);
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
  });

  await page.goto(PAGE_URL);
  await page.evaluate(() => {
    const a = document.getElementById('harvestDetailSection');
    const b = document.getElementById('stockDetailSection');
    if (a) a.open = true;
    if (b) b.open = true;
  });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-harvest="M"][data-harvest-offset="0"]');
    return el && el.textContent.trim() !== '－';
  }, null, { timeout: 15000 });
  await page.waitForSelector('[data-harvest-input-offset="0"]:not([disabled])', { timeout: 15000 });
  return { page, posts, loadQueries, baseline, actualDate };
}

function text(page, sel) { return page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; }, sel); }
function isDisabled(page, sel) { return page.evaluate(s => { const el = document.querySelector(s); return !!el && el.disabled; }, sel); }
const detailCell = (size, o) => `[data-harvest-detail="${size}"][data-harvest-detail-offset="${o}"]`;
const stockDetailCell = (size, o) => `[data-stock-detail="${size}"][data-stock-detail-offset="${o}"]`;
const harvestDetailActual = size => `[data-harvest-detail-actual="${size}"]`;
const harvestDetailRatio = size => `[data-harvest-detail-ratio="${size}"]`;
const stockDetailActual = size => `[data-stock-detail-actual="${size}"]`;
const stockDetailRatio = size => `[data-stock-detail-ratio="${size}"]`;
const mainHarvestCell = (size, o) => `[data-harvest="${size}"][data-harvest-offset="${o}"]`;
const mainStockCell = (size, o) => `[data-stock-forecast="${size}"][data-stock-forecast-offset="${o}"]`;
const input = o => `[data-harvest-input-offset="${o}"]`;
const DETAIL_SIZES_PLUS_TOTAL = ['M', 'L', '秀', '優', '2L', '袋', '合計'];

async function clickSite(page, site) {
  await page.click('[data-site="' + site + '"]');
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let allOk = true;
  function check(label, ok) { console.log('  ' + label + ': ' + (ok ? 'OK' : 'NG')); if (!ok) allOk = false; }

  console.log('=== ①群馬を選ぶと、収穫見込GASへ群馬向けの読み込みが行われ、返した値が入力欄に入る ===');
  {
    const { page, loadQueries } = await setupPage(browser, { loadValuesBySite: { 'いなべ': { '2026-11-15': 300 }, '群馬': { '2026-11-15': 150 } } });
    loadQueries.length = 0;
    await clickSite(page, '群馬');
    await page.waitForSelector(input(0) + ':not([disabled])', { timeout: 15000 });
    check('群馬を選んだ後、group向けの読み込み(action=load&site=群馬)が発行される', loadQueries.some(q => q.site === '群馬'));
    // 群馬の収穫実績(M=50,L=100,2L=25,袋=25)はいなべ(M=100,L=200,2L=50,袋=50)と比率が同じになる
    // よう作ってあるため、GASが返した150kgの按分結果(M=37.5)で、いなべ向けの値(300kg→M=75.0)の
    // 読み込みが残っていないことを確認できる
    check('群馬のGASが返した値(150kg→M=37.5)が入力欄・詳細に反映される', (await text(page, detailCell('M', 0))) === '37.5');
    await page.close();
  }

  console.log('=== ②群馬で入力欄が有効になり、詳細の収穫予測・在庫予測が群馬の本体の値から計算される（いなべと同じ計算）。注記は出ない ===');
  {
    const { page } = await setupPage(browser, { loadValuesBySite: { 'いなべ': { '2026-11-15': 300 }, '群馬': { '2026-11-15': 150 } } });
    await clickSite(page, '群馬');
    await page.waitForSelector(input(0) + ':not([disabled])', { timeout: 15000 });
    for (let o = 0; o < 9; o++) {
      check('入力欄offset' + o + 'が有効', !(await isDisabled(page, input(o))));
    }
    check('収穫予測の詳細 実績[M]=群馬の本体の実績(50.0)', (await text(page, harvestDetailActual('M'))) === '50.0');
    check('収穫予測の詳細 比率[M]=群馬の本体の比率(25%)', (await text(page, harvestDetailRatio('M'))) === '25%');
    check('収穫予測の詳細M[0]=150kg×25%=37.5（群馬の本体の比率で計算される）', (await text(page, detailCell('M', 0))) === '37.5');
    check('在庫予測の詳細 実績[M]=群馬の本体(在庫実績)の値(－ではない)', (await text(page, stockDetailActual('M'))) !== '－');
    check('在庫予測の詳細M[0]は群馬の在庫実績・出荷予定から計算される(－ではない)', (await text(page, stockDetailCell('M', 0))) !== '－');
    check('注記は表示されない（群馬は対応拠点のため）', !(await text(page, '#harvestDetailSaveStatus') || '').includes('のみ対応です'));
    await page.close();
  }

  console.log('=== ③群馬で入力欄にkgを入れると action:save, site:群馬 で保存される ===');
  {
    const { page, posts } = await setupPage(browser, { loadValuesBySite: { 'いなべ': {}, '群馬': {} } });
    await clickSite(page, '群馬');
    await page.waitForSelector(input(0) + ':not([disabled])', { timeout: 15000 });
    await page.fill(input(0), '400');
    await page.dispatchEvent(input(0), 'change');
    await page.waitForTimeout(300);
    const saved = posts.find(p => p.action === 'save');
    check('action:save, site:群馬, kg:400 で保存される', !!saved && saved.site === '群馬' && saved.kg === 400, saved);
    check('保存後は「保存しました」が表示される', (await text(page, '#harvestDetailSaveStatus')) === '保存しました');
    await page.close();
  }

  console.log('=== ④南丹は引き続き止まる（入力無効・数値－・新しい注記）===');
  {
    const { page, posts } = await setupPage(browser, { loadValues: {} });
    await clickSite(page, '南丹');
    for (let o = 0; o < 9; o++) {
      check('入力欄offset' + o + 'が無効', await isDisabled(page, input(o)));
    }
    for (const size of DETAIL_SIZES_PLUS_TOTAL) {
      check('収穫予測の詳細 実績[' + size + ']=－', (await text(page, harvestDetailActual(size))) === '－');
      check('在庫予測の詳細 実績[' + size + ']=－', (await text(page, stockDetailActual(size))) === '－');
    }
    // 秀・優の比率セルは本体同様もともとdata属性を持たない固定の「－」表示のため対象外
    for (const size of ['M', 'L', '2L', '袋', '合計']) {
      check('収穫予測の詳細 比率[' + size + ']=－', (await text(page, harvestDetailRatio(size))) === '－');
      check('在庫予測の詳細 比率[' + size + ']=－', (await text(page, stockDetailRatio(size))) === '－');
    }
    let allHarvestDash = true, allStockDash = true;
    for (const size of ['M', 'L', '秀', '優', '2L', '袋']) {
      for (let o = 0; o < 9; o++) {
        if ((await text(page, detailCell(size, o))) !== '－') allHarvestDash = false;
        if ((await text(page, stockDetailCell(size, o))) !== '－') allStockDash = false;
      }
    }
    check('収穫予測の詳細の日別セルが全てM/L/秀/優/2L/袋×9日分すべて－', allHarvestDash);
    check('在庫予測の詳細の日別セルが全てM/L/秀/優/2L/袋×9日分すべて－', allStockDash);
    check('保存は行われていない', posts.length === 0);
    check('新しい注記（いなべ・群馬のみ対応）が表示される', (await text(page, '#harvestDetailSaveStatus')).includes('この画面は現在いなべ・群馬のみ対応です。南丹の収穫見込は直近工数計画で入力してください。'));
    await page.close();
  }

  console.log('=== ⑤いなべ→群馬→南丹→いなべと切り替えると、それぞれの状態になり、古い読み込み・入力が残らない ===');
  {
    const { page, loadQueries } = await setupPage(browser, { loadValuesBySite: { 'いなべ': { '2026-11-15': 300 }, '群馬': { '2026-11-15': 150 } } });
    check('いなべでは300kg→M=75.0が読み込まれている', (await text(page, detailCell('M', 0))) === '75.0');

    // コミット（change）前の入力中の値が、拠点切替で新しい拠点に残らないことも確認する
    await page.fill(input(1), '999');
    await clickSite(page, '群馬');
    await page.waitForSelector(input(0) + ':not([disabled])', { timeout: 15000 });
    check('群馬に切り替えると群馬向けの読み込みが行われる(action=load&site=群馬)', loadQueries.some(q => q.site === '群馬'));
    check('群馬ではいなべの読み込み結果(75.0)が残っていない(150kg→37.5になる)', (await text(page, detailCell('M', 0))) === '37.5');
    check('いなべで未確定だった入力中の値(999)が群馬の入力欄に残っていない', (await page.evaluate(s => document.querySelector(s).value, input(1))) !== '999');

    loadQueries.length = 0;
    await clickSite(page, '南丹');
    check('南丹では読み込みが行われない', !loadQueries.some(q => q.site === '南丹'));
    check('南丹では群馬の読み込み結果(37.5)が残っていない(－になる)', (await text(page, detailCell('M', 0))) === '－');
    check('南丹では入力欄が無効', await isDisabled(page, input(0)));

    loadQueries.length = 0;
    await clickSite(page, 'いなべ');
    check('いなべに戻すと再度読み込みが行われる(action=load&site=いなべ)', loadQueries.some(q => q.site === 'いなべ'));
    check('いなべに戻すと南丹の「－」が残っていない(手入力の値300kg→M=75.0が復元される)', (await text(page, detailCell('M', 0))) === '75.0');
    check('入力欄が有効に戻る', !(await isDisabled(page, input(0))));
    check('詳細の実績・比率も本体の値に戻る(実績M=100.0)', (await text(page, harvestDetailActual('M'))) === '100.0');
    await page.close();
  }

  // 拠点ごとの設定（SITE_DATA）に無い動作の追加により、本体（table1〜3）は拠点トグルを
  // 切り替えても「常にいなべのデータを表示する」仕様では無くなった（パネル1〜3＝在庫・出荷予定・
  // 収穫予測・在庫予測のすべてが、群馬でも実データで表示するようになった。南丹のパネル1〜3は、
  // SITE_DATAに設定が無いため、いなべの数字を出さないよう「－」＋「◯◯は準備中です」の注記に
  // なる）。この回帰確認は、新しい仕様（いなべの数字を出し続けない）に合わせて書き直した
  console.log('=== ⑥本体（table1・table2・table3）：群馬・南丹を選んでもいなべの数字を出し続けない（回帰） ===');
  {
    const { page } = await setupPage(browser, { loadValues: {} });
    const before = {
      t2: await text(page, mainHarvestCell('M', 0)),
      t3: await text(page, mainStockCell('M', 0)),
      stockProduct: await text(page, '[data-stock-product="M"]'),
    };
    check('切替前のtable1はいなべの実データ(－ではない)', before.stockProduct !== '－');
    check('切替前のtable2はいなべの実データ(－ではない)', before.t2 !== '－');
    check('切替前のtable3はいなべの実データ(－ではない)', before.t3 !== '－');

    await clickSite(page, '群馬');
    // このテストは詳細（①〜⑤）の確認のため、群馬の在庫管理表・収穫管理表のURLも用意して
    // あるので、本体（table1〜3）は群馬の実データ（table1はM製品在庫10.0・生在庫20.0、
    // table2はM実績50.0）になる（いなべの数字のままではなく、「準備中」の注記も出ない）
    check('table1(製品在庫)は群馬選択後、いなべの数字のままではない', (await text(page, '[data-stock-product="M"]')) !== before.stockProduct);
    check('table1は群馬の実データ(製品在庫M=10.0)になる', (await text(page, '[data-stock-product="M"]')) === '10.0');
    check('table1に「準備中」等の注記は出ない(群馬の在庫管理表が見つかっている)', (await text(page, '#table1SiteNote')) === '');
    check('table2(収穫予測)は群馬選択後、いなべの数字のままではない', (await text(page, mainHarvestCell('M', 0))) !== before.t2);
    check('table2は群馬の実データ(実績M=50.0)になる', (await text(page, mainHarvestCell('M', 0))) === '50.0');
    check('table2に「群馬は準備中です」の注記は出ない(パネル2も群馬に対応したため)', (await text(page, '#table2SiteNote')) === '');
    check('table3(在庫予測)は群馬選択後、実データになる(－ではない)', (await text(page, mainStockCell('M', 0))) !== '－');
    check('table3に「群馬は準備中です」の注記は出ない(パネル3も群馬に対応したため)', (await text(page, '#table3SiteNote')) === '');

    await clickSite(page, '南丹');
    check('table1(製品在庫)は南丹選択後「－」になる', (await text(page, '[data-stock-product="M"]')) === '－');
    check('table1に「南丹は準備中です」の注記が出る', (await text(page, '#table1SiteNote')) === '南丹は準備中です');
    check('table2(収穫予測)は南丹選択後も「－」になる', (await text(page, mainHarvestCell('M', 0))) === '－');
    check('table3(在庫予測)は南丹選択後も「－」になる', (await text(page, mainStockCell('M', 0))) === '－');

    await clickSite(page, 'いなべ');
    check('いなべに戻すとtable1がもとの実データに戻る', (await text(page, '[data-stock-product="M"]')) === before.stockProduct);
    check('いなべに戻すとtable2がもとの実データに戻る', (await text(page, mainHarvestCell('M', 0))) === before.t2);
    check('いなべに戻すとtable3がもとの実データに戻る', (await text(page, mainStockCell('M', 0))) === before.t3);
    check('いなべに戻すと注記が消える', (await text(page, '#table1SiteNote')) === '' && (await text(page, '#table2SiteNote')) === '' && (await text(page, '#table3SiteNote')) === '');
    await page.close();
  }

  await browser.close();
  console.log(allOk ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
