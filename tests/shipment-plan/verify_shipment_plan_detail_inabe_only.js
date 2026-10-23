// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）の収穫予測・在庫予測
// パネルの「詳細」が、いなべ以外（群馬・南丹）を選んだときに止まることの検証。
// 本体（table1〜3）は拠点トグルを切り替えても常にいなべのデータを表示する作り
// （見た目のみのトグル）だが、詳細は拠点を見て収穫見込GAS（直近工数計画・PR #503が
// 実データとして使う）に読み書きするため、いなべ以外を選んだまま入力すると、本体の
// 表示と食い違う拠点の実データを書き換えてしまう。これを防ぐ安全策の確認。
// 保存先GAS(HARVEST_FORECAST_GAS_URL)・CSVモックの組み立ては
// verify_shipment_plan_harvest_detail.js と同じ構成を複製している（他ファイルへの依存なし）。
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
const HARVEST_DAILY_TOTAL_SHEET_ID = '1B7XEllKSlCEfkBPmNf_fvAz48I6XvMS3hfT_Dy4w_Tw';
const HARVEST_DAILY_TOTAL_GID = '1164843574';
const TARGET_SHEET_ID = 'FAKE_TARGET_SHEET_ID';
const TARGET_SHEET_GID = '999999999';
const SALES_MONTH_GID = '111111111';
const FAKE_GAS_URL = 'https://script.google.com/macros/s/TEST_SHIPMENT_HARVEST_FORECAST_SITEGATE/exec';
const PAGE_URL = 'http://localhost:8812/shiitake-shipment-plan.html';

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
function buildSalesMonthCsv(maxDay) {
  const rows = [];
  for (let i = 0; i <= maxDay + 3; i++) rows.push(new Array(26).fill(''));
  for (let day = 1; day <= maxDay; day++) {
    const idx = (day + 3) - 1;
    rows[idx][22] = 20; rows[idx][23] = 40; rows[idx][24] = 10; rows[idx][25] = 10;
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
function buildHarvestUrlCsv() {
  return toCsvText([
    ['収穫管理表', 'いなべ', '群馬', '南丹'],
    [dstr(2026, 11, 1), 'https://docs.google.com/spreadsheets/d/' + TARGET_SHEET_ID + '/edit#gid=' + TARGET_SHEET_GID, '', ''],
  ]);
}
function buildHarvestTargetCsv(actualDate) {
  const rows = [];
  rows.push(['日付', 'M', 'L', '2L', '袋']);
  rows.push([dstr(actualDate.getFullYear(), actualDate.getMonth() + 1, actualDate.getDate()), 100, 200, 50, 50]);
  return toCsvText(rows);
}
function buildDailyTotalCsv(baseline) {
  const key = baseline.getFullYear() + '.' + (baseline.getMonth() + 1);
  const rows = [['', key]];
  for (let day = 1; day <= 30; day++) rows.push(['', 400]);
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
    loadQueries.push(Object.fromEntries(url.searchParams));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', values: opts.loadValues || {} }) });
  });

  const actualDate = addDays(baseline, -1);
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    let body = '﻿\r\n';
    if (url.includes(STOCK_SHEET_ID) && url.includes('gid=' + STOCK_SHEET_GID)) body = buildStockCsv(baseline);
    else if (url.includes(STOCK_SHEET_ID) && url.includes('gid=' + ALLOCATION_SHEET_GID)) body = buildAllocationCsv();
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + GRADE_RATIO_SHEET_GID)) body = buildGradeRatioCsv();
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + HARVEST_URL_SHEET_GID)) body = buildHarvestUrlCsv();
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_INDEX_GID)) body = buildSalesIndexCsv(baseline.getFullYear() + '.' + (baseline.getMonth() + 1));
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_MONTH_GID)) body = buildSalesMonthCsv(31);
    else if (url.includes(SALES_RAW_SHEET_ID) && url.includes('gid=' + SALES_RAW_INABE_ORDER_GID)) body = buildSalesRawInabeCsv(baseline);
    else if (url.includes(TARGET_SHEET_ID) && url.includes('gid=' + TARGET_SHEET_GID)) body = buildHarvestTargetCsv(actualDate);
    else if (url.includes(HARVEST_DAILY_TOTAL_SHEET_ID) && url.includes('gid=' + HARVEST_DAILY_TOTAL_GID)) body = buildDailyTotalCsv(baseline);
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

  console.log('=== ①群馬を選ぶと、収穫見込GASへ新規の読み込みが行われない ===');
  {
    const { page, loadQueries } = await setupPage(browser, { loadValues: { '2026-11-15': 300 } });
    loadQueries.length = 0;
    await clickSite(page, '群馬');
    check('群馬を選んだ後、群馬向けのload/saveリクエストが発行されない', !loadQueries.some(q => q.site === '群馬'));
    check('load自体が一切発行されない（load/saveどちらも拠点を問わず0件）', loadQueries.length === 0);
    await page.close();
  }

  console.log('=== ②群馬を選ぶと、入力欄が無効になり、詳細の数値がすべて「－」になる ===');
  {
    const { page, posts } = await setupPage(browser, { loadValues: { '2026-11-15': 300 } });
    await clickSite(page, '群馬');
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
    check('注記が表示される', (await text(page, '#harvestDetailSaveStatus')).includes('この画面は現在いなべのみ対応です。群馬・南丹の収穫見込は直近工数計画で入力してください。'));
    await page.close();
  }

  console.log('=== ③南丹でも同様（入力無効・数値－・注記）===');
  {
    const { page } = await setupPage(browser, { loadValues: {} });
    await clickSite(page, '南丹');
    check('入力欄が無効', await isDisabled(page, input(0)));
    check('収穫予測の詳細M[0]=－', (await text(page, detailCell('M', 0))) === '－');
    check('在庫予測の詳細M[0]=－', (await text(page, stockDetailCell('M', 0))) === '－');
    check('注記が表示される', (await text(page, '#harvestDetailSaveStatus')).includes('いなべのみ対応'));
    await page.close();
  }

  console.log('=== ④いなべに戻すと、読み込み・入力・表示が元どおりになる ===');
  {
    const { page, loadQueries } = await setupPage(browser, { loadValues: { '2026-11-15': 300 } });
    await clickSite(page, '群馬');
    check('群馬では入力欄が無効', await isDisabled(page, input(0)));
    loadQueries.length = 0;
    await clickSite(page, 'いなべ');
    check('いなべに戻すと再度読み込みが行われる', loadQueries.some(q => q.site === 'いなべ'));
    check('入力欄が有効に戻る', !(await isDisabled(page, input(0))));
    check('手入力の値(300kg→M=75.0、青字)が復元される', (await text(page, detailCell('M', 0))) === '75.0');
    check('詳細の実績・比率も本体の値に戻る(実績M=100.0)', (await text(page, harvestDetailActual('M'))) === '100.0');
    await page.close();
  }

  console.log('=== ⑤本体（table1・table2・table3）は拠点切替の影響を受けない（回帰） ===');
  {
    const { page } = await setupPage(browser, { loadValues: {} });
    const before = {
      t2: await text(page, mainHarvestCell('M', 0)),
      t3: await text(page, mainStockCell('M', 0)),
      stockProduct: await text(page, '[data-stock-product="M"]'),
    };
    await clickSite(page, '群馬');
    check('table2本体は群馬選択後も変わらない', (await text(page, mainHarvestCell('M', 0))) === before.t2);
    check('table3本体は群馬選択後も変わらない', (await text(page, mainStockCell('M', 0))) === before.t3);
    check('table1本体は群馬選択後も変わらない', (await text(page, '[data-stock-product="M"]')) === before.stockProduct);
    await clickSite(page, '南丹');
    check('table2本体は南丹選択後も変わらない', (await text(page, mainHarvestCell('M', 0))) === before.t2);
    await page.close();
  }

  await browser.close();
  console.log(allOk ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
