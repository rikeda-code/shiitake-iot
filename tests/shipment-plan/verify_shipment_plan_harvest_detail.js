// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）の収穫予測パネル（table2）・
// 在庫予測パネル（table3）に追加した「詳細」（収穫見込の手入力・按分計算）の検証。
// 収穫見込の保存先GAS(HARVEST_FORECAST_GAS_URL)はページ取得時に差し替え、GASへの
// GET/POSTはpage.route()でモックする（実際のGAS・スプレッドシートには触れない）。
// 椎茸在庫・販売抽出・DB共有・収獲目標値・転写タブ等も、実際のシート構成に合わせた
// CSVモックで差し替える。
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
const FAKE_GAS_URL = 'https://script.google.com/macros/s/TEST_SHIPMENT_HARVEST_FORECAST/exec';
const PAGE_URL = 'http://localhost:8812/shiitake-shipment-plan.html';

// 2026/11/15(基準日)〜2026/11/23(8日後)。実績日は既定で基準日の前日=11/14。
// シナリオ：
//   - 収穫実績(11/14, 収獲目標値シート): M=100,L=200,2L=50,袋=50 (合計400, 比率 M.25/L.5/2L.125/袋.125)
//   - 収穫_秀優比率: 収穫予測パネル 秀=60%,優=40%(Lに対して) / 在庫予測パネル 秀=30%,優=20%(Lの在庫実績に対して)
//   - 転写(日別収穫合計予測): 11/15〜11/23は400kg/日固定。ただし11/20(offset5)だけ空欄(未設定)
//   - 在庫実績(11/14, 椎茸在庫シート): M製品50+生30=80 / L製品100+生60=160(秀L_40 優L_60) / 2L製品20+生10=30 / 袋製品15+生5=20
//   - 出荷予定(受注シート): M=20,L=40,2L=10,袋=10 を全日固定。秀=10,優=5(いなべ_受注のRAWから)
function buildStockCsv(baseline) {
  // 列0,1はラベル列として空読みされる前提の構成とし、列2以降を日付ごとの実データ列にする
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
// 列22,23,24,25=M,L,2L,袋。行index=(day+3)-1
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
// 「URL_在庫管理表」タブ：1行目=見出し(A列「出荷量」・B以降に拠点名)、以降の行=年×拠点のURL。
// いなべの2026年の欄に、このテストが使う椎茸在庫ファイル(STOCK_SHEET_ID)のURLを入れる
function buildStockUrlCsv() {
  return toCsvText([
    ['出荷量', 'いなべ', '群馬', '南丹'],
    [2026, 'https://docs.google.com/spreadsheets/d/' + STOCK_SHEET_ID + '/edit?gid=' + STOCK_SHEET_GID + '#gid=' + STOCK_SHEET_GID, '', ''],
  ]);
}
function buildHarvestUrlCsv() {
  return toCsvText([
    ['収穫管理表', 'いなべ', '群馬', '南丹'],
    [dstr(2026, 11, 1), 'https://docs.google.com/spreadsheets/d/' + TARGET_SHEET_ID + '/edit#gid=' + TARGET_SHEET_GID, '', ''],
  ]);
}
// 収獲目標値シート：A列が"日付"の見出し行＋サイズ見出し、以降A列=日付の行
function buildHarvestTargetCsv(actualDate) {
  const rows = [];
  rows.push(['日付', 'M', 'L', '2L', '袋']);
  rows.push([dstr(actualDate.getFullYear(), actualDate.getMonth() + 1, actualDate.getDate()), 100, 200, 50, 50]);
  return toCsvText(rows);
}
// 転写タブ：1行目=年月見出し、2行目以降=1日,2日,...。11/20(5番目のoffset)だけ空欄にする
function buildDailyTotalCsv(baseline) {
  const key = baseline.getFullYear() + '.' + (baseline.getMonth() + 1);
  const rows = [['', key]];
  for (let day = 1; day <= 30; day++) {
    const d = new Date(baseline.getFullYear(), baseline.getMonth(), day);
    const missing = sameDay(d, addDays(baseline, 5)); // offset5 = 11/20
    rows.push(['', missing ? '' : 400]);
  }
  return toCsvText(rows);
}

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function toISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

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
    const body = html.replace(re, "var HARVEST_FORECAST_GAS_URL = '" + (opts.noGas ? '' : FAKE_GAS_URL) + "';");
    await route.fulfill({ response: res, body });
  });
  await page.route(FAKE_GAS_URL + '**', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      const parsed = JSON.parse(req.postData());
      posts.push(parsed);
      const body = opts.failSave ? { status: 'error', message: 'テスト用の保存エラー' } : { status: 'ok' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    const url = new URL(req.url());
    loadQueries.push(Object.fromEntries(url.searchParams));
    if (opts.loadDelayMs) await new Promise(r => setTimeout(r, opts.loadDelayMs));
    if (opts.failLoad) { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'error', message: 'テスト用の読み込みエラー' }) }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', values: opts.loadValues || {} }) });
  });

  const actualDate = addDays(baseline, -1); // 実績日の既定値＝基準日の前日
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    let body = '﻿\r\n';
    if (url.includes(STOCK_SHEET_ID) && url.includes('gid=' + STOCK_SHEET_GID)) body = buildStockCsv(baseline);
    else if (url.includes(STOCK_SHEET_ID) && url.includes('gid=' + ALLOCATION_SHEET_GID)) body = buildAllocationCsv();
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + GRADE_RATIO_SHEET_GID)) body = buildGradeRatioCsv();
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + HARVEST_URL_SHEET_GID)) body = buildHarvestUrlCsv();
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + STOCK_URL_SHEET_GID)) body = buildStockUrlCsv();
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_INDEX_GID)) body = buildSalesIndexCsv(baseline.getFullYear() + '.' + (baseline.getMonth() + 1));
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_MONTH_GID)) body = buildSalesMonthCsv(31);
    else if (url.includes(SALES_RAW_SHEET_ID) && url.includes('gid=' + SALES_RAW_INABE_ORDER_GID)) body = buildSalesRawInabeCsv(baseline);
    else if (url.includes(TARGET_SHEET_ID) && url.includes('gid=' + TARGET_SHEET_GID)) body = buildHarvestTargetCsv(actualDate);
    else if (url.includes(HARVEST_DAILY_TOTAL_SHEET_ID) && url.includes('gid=' + HARVEST_DAILY_TOTAL_GID)) body = buildDailyTotalCsv(baseline);
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
  });

  await page.goto(PAGE_URL);
  // 詳細パネルは最初閉じた状態（仕様どおり）。テストで中身を操作・確認するため開いておく
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
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-stock-forecast="M"][data-stock-forecast-offset="0"]');
    return el && el.textContent.trim() !== '－';
  }, null, { timeout: 15000 });
  if (!opts.noGas && !opts.skipDetailWait) {
    await page.waitForSelector('[data-harvest-input-offset="0"]:not([disabled])', { timeout: 15000 });
  }
  return { page, posts, loadQueries, baseline, actualDate };
}

function text(page, sel) { return page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; }, sel); }
function numAt(page, sel) { return page.evaluate(s => { const el = document.querySelector(s); if (!el) return null; const t = el.textContent.trim().replace(/,/g, ''); if (t === '－' || t === '') return null; return parseFloat(t); }, sel); }
function hasClass(page, sel, cls) { return page.evaluate(([s, c]) => { const el = document.querySelector(s); return !!el && el.classList.contains(c); }, [sel, cls]); }
const detailCell = (size, o) => `[data-harvest-detail="${size}"][data-harvest-detail-offset="${o}"]`;
const stockDetailCell = (size, o) => `[data-stock-detail="${size}"][data-stock-detail-offset="${o}"]`;
const mainHarvestCell = (size, o) => `[data-harvest="${size}"][data-harvest-offset="${o}"]`;
const mainStockCell = (size, o) => `[data-stock-forecast="${size}"][data-stock-forecast-offset="${o}"]`;
const input = o => `[data-harvest-input-offset="${o}"]`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let allOk = true;
  function check(label, ok) { console.log('  ' + label + ': ' + (ok ? 'OK' : 'NG')); if (!ok) allOk = false; }

  console.log('=== ①純粋関数：見込kg×比率の按分（秀・優はLの按分）===');
  {
    const { page } = await setupPage(browser, { noGas: true });
    const r = await page.evaluate(() => {
      const t = window.__test;
      const sizeRatios = { M: 0.25, L: 0.5, '2L': 0.125, '袋': 0.125 };
      const gradeRatios = { '秀': 0.6, '優': 0.4 };
      return {
        d300: t.computeHarvestDetailDayValues(300, sizeRatios, gradeRatios),
        d0: t.computeHarvestDetailDayValues(0, sizeRatios, gradeRatios),
        parse: ['', ' 120 ', '1,200', '１２０kg', 'abc', '-5'].map(t.parseManualHarvestInput),
        cellNum: ['123.4', '－', '', '1,234.5', '50%'].map(t.parseDetailCellNumber),
      };
    });
    check('300kg→M75/L150/2L37.5/袋37.5/秀90/優60', r.d300.M === 75 && r.d300.L === 150 && r.d300['2L'] === 37.5 && r.d300['袋'] === 37.5 && r.d300['秀'] === 90 && r.d300['優'] === 60);
    check('0kg→すべて0（0も計算対象）', r.d0.M === 0 && r.d0.L === 0 && r.d0['秀'] === 0 && r.d0['優'] === 0);
    check('入力値の読み取り（空欄=null、全角・カンマ・kg可、数値以外・負はundefined）', JSON.stringify(r.parse) === JSON.stringify([null, 120, 1200, 120, undefined, undefined]));
    check('表示文字列→数値（"－"・空欄はnull、カンマ・%も読める）', JSON.stringify(r.cellNum) === JSON.stringify([123.4, null, null, 1234.5, 50]));
    await page.close();
  }

  console.log('=== ②純粋関数：在庫予測の詳細は収穫が「－」の日も0として最後まで計算を続ける ===');
  {
    const { page } = await setupPage(browser, { noGas: true });
    const r = await page.evaluate(() => {
      const t = window.__test;
      const harvestTexts = ['50.0', '－', '30.0'];
      const shipments = [10, 10, 10];
      return t.computeStockDetailSeries(100, harvestTexts, shipments);
    });
    check('「－」の日はharvest=0として継続計算（本体のようにnullを引きずらない）', JSON.stringify(r) === JSON.stringify([140, 130, 150]));
    await page.close();
  }

  console.log('=== ③実データ相当のモックで本体が描画される ===');
  {
    const { page } = await setupPage(browser, { noGas: true });
    check('収穫実績の比率どおり(M=100)', await text(page, mainHarvestCell('M', 0)) === '100.0');
    check('在庫予測本体(M=80+100-20=160)', await text(page, mainStockCell('M', 0)) === '160.0');
    await page.close();
  }

  console.log('=== ④手入力ありの日は見込×比率で青字、手入力なしは本体の値 ===');
  {
    const { page, posts, loadQueries } = await setupPage(browser, { loadValues: { '2026-11-15': 300, '2026-11-18': 0 } });
    check('GASに拠点・期間を指定して読みに行く', loadQueries.length >= 1 && loadQueries[0].site === 'いなべ' && loadQueries[0].from === '2026-11-15' && loadQueries[0].to === '2026-11-23');
    check('offset0(見込300)：M=75、青字', (await text(page, detailCell('M', 0))) === '75.0' && await hasClass(page, detailCell('M', 0), 'harvest-manual'));
    check('offset0：秀=90、優=60', (await text(page, detailCell('秀', 0))) === '90.0' && (await text(page, detailCell('優', 0))) === '60.0');
    check('offset1(手入力なし)：本体と同じ100.0、青字ではない', (await text(page, detailCell('M', 1))) === '100.0' && !(await hasClass(page, detailCell('M', 1), 'harvest-manual')));
    check('offset3(見込0)：M=0、青字（0も手入力として優先）', (await text(page, detailCell('M', 3))) === '0.0' && await hasClass(page, detailCell('M', 3), 'harvest-manual'));
    check('offset5(本体も「－」)：詳細も「－」、青字ではない', (await text(page, detailCell('M', 5))) === '－' && !(await hasClass(page, detailCell('M', 5), 'harvest-manual')));
    check('合計の入力欄に見込値が入る(offset0=300, offset3=0)', (await page.inputValue(input(0))) === '300' && (await page.inputValue(input(3))) === '0');
    check('合計の入力欄が空欄の日は本体合計がplaceholder表示(offset1=400)', (await page.getAttribute(input(1), 'placeholder')) === '400.0');
    check('本体合計がplaceholder表示(offset5は本体も「－」のためplaceholderなし)', (await page.getAttribute(input(5), 'placeholder')) === '');
    await page.close();

    console.log('=== ⑤在庫予測の詳細：手入力・本体フォールバック・「－」継続を反映した積み上げ ===');
    const { page: p2 } = await setupPage(browser, { loadValues: { '2026-11-15': 300, '2026-11-18': 0 } });
    check('M: offset0=135', await numAt(p2, stockDetailCell('M', 0)) === 135);
    check('M: offset3(見込0)=275', await numAt(p2, stockDetailCell('M', 3)) === 275);
    check('M: offset5(本体「－」でも0として継続)=335', await numAt(p2, stockDetailCell('M', 5)) === 335);
    check('M: offset8まで計算が止まらず継続=575', await numAt(p2, stockDetailCell('M', 8)) === 575);
    check('本体(table3)は offset5 以降「－」のまま（詳細とは違う挙動）', await text(p2, mainStockCell('M', 5)) === '－' && await text(p2, mainStockCell('M', 8)) === '－');
    check('L: offset0=270, offset8=1150', await numAt(p2, stockDetailCell('L', 0)) === 270 && await numAt(p2, stockDetailCell('L', 8)) === 1150);
    check('秀: offset0=128, offset8=768（Lの詳細値×0.3が在庫実績比率で加算される）', await numAt(p2, stockDetailCell('秀', 0)) === 128 && await numAt(p2, stockDetailCell('秀', 8)) === 768);
    check('優: offset0=87, offset8=527', await numAt(p2, stockDetailCell('優', 0)) === 87 && await numAt(p2, stockDetailCell('優', 8)) === 527);
    check('2L: offset0=57.5, 袋: offset0=47.5', await numAt(p2, stockDetailCell('2L', 0)) === 57.5 && await numAt(p2, stockDetailCell('袋', 0)) === 47.5);
    check('合計行(M+L+2L+袋。秀優は除外) offset0=510', await numAt(p2, stockDetailCell('合計', 0)) === 510);
    check('合計行 offset8=2270', await numAt(p2, stockDetailCell('合計', 8)) === 2270);
    check('プラス/マイナスの色分け(すべて正値なのでpos)', await hasClass(p2, stockDetailCell('M', 0), 'pos'));
    await p2.close();
  }

  console.log('=== ⑥入力→即時再計算・保存、空欄でkg:null ===');
  {
    const { page, posts } = await setupPage(browser, { loadValues: {} });
    await page.fill(input(2), '500');
    await page.press(input(2), 'Enter');
    await page.waitForFunction(() => document.getElementById('harvestDetailSaveStatus').textContent.includes('保存しました'));
    check('POSTの中身（拠点・日付・kg）', posts.length === 1 && posts[0].action === 'save' && posts[0].site === 'いなべ' && posts[0].date === '2026-11-17' && posts[0].kg === 500);
    check('即時再計算される(500×0.25=125.0、青字)', (await text(page, detailCell('M', 2))) === '125.0' && await hasClass(page, detailCell('M', 2), 'harvest-manual'));
    check('在庫予測の詳細も連動して再計算される', (await numAt(page, stockDetailCell('M', 2))) !== null);

    await page.fill(input(2), '');
    await page.press(input(2), 'Enter');
    await page.waitForFunction(() => document.getElementById('harvestDetailSaveStatus').textContent.includes('保存しました'));
    check('空欄にするとkg:nullで保存される', posts.length === 2 && posts[1].date === '2026-11-17' && posts[1].kg === null);
    check('本体の値に戻る(100.0、青字ではない)', (await text(page, detailCell('M', 2))) === '100.0' && !(await hasClass(page, detailCell('M', 2), 'harvest-manual')));
    await page.close();
  }

  console.log('=== ⑦不正な入力・保存失敗 ===');
  {
    const { page, posts } = await setupPage(browser, { loadValues: {}, failSave: true });
    await page.fill(input(0), 'abc');
    await page.press(input(0), 'Enter');
    check('数値以外は保存しない', posts.length === 0);
    check('入力欄が元に戻り、エラー表示が出る', (await page.inputValue(input(0))) === '' &&
      await page.evaluate(() => document.getElementById('harvestDetailSaveStatus').classList.contains('error')));

    await page.fill(input(1), '-5');
    await page.press(input(1), 'Enter');
    check('負の値も保存しない', posts.length === 0);

    await page.fill(input(0), '300');
    await page.press(input(0), 'Enter');
    await page.waitForFunction(() => document.getElementById('harvestDetailSaveStatus').textContent.includes('保存できませんでした'));
    check('保存失敗で赤枠になる', await hasClass(page, input(0), 'save-error'));
    check('画面上は入力値で計算されたまま(300×0.25=75.0)', (await text(page, detailCell('M', 0))) === '75.0');
    await page.focus(input(0));
    await page.press(input(0), 'Enter');
    await page.waitForTimeout(300);
    check('値を変えずにEnterすると、失敗した欄は保存し直す', posts.length === 2);
    await page.focus(input(1));
    await page.press(input(1), 'Enter');
    await page.waitForTimeout(300);
    check('失敗していない欄は、値を変えずにEnterしても保存しない', posts.length === 2);
    await page.close();
  }

  console.log('=== ⑧保存先GAS未設定：入力欄は使えず、本体の値だけで詳細を表示 ===');
  {
    const { page } = await setupPage(browser, { noGas: true });
    check('入力欄は無効', await page.evaluate(s => document.querySelector(s).disabled, input(0)));
    check('詳細は本体の値をそのまま表示(M=100.0)', (await text(page, detailCell('M', 0))) === '100.0');
    check('在庫予測の詳細も表示される', (await numAt(page, stockDetailCell('M', 0))) !== null);
    await page.close();
  }

  console.log('=== ⑨読み込みに失敗したとき：本体の値で詳細を表示し続け、エラーを知らせる ===');
  {
    const { page } = await setupPage(browser, { failLoad: true, skipDetailWait: true });
    await page.waitForFunction(() => document.getElementById('harvestDetailSaveStatus').textContent.includes('取得できませんでした'), null, { timeout: 15000 });
    check('エラーメッセージが出る', await page.evaluate(() => document.getElementById('harvestDetailSaveStatus').classList.contains('error')));
    check('詳細は本体の値のまま表示される(M=100.0)', (await text(page, detailCell('M', 0))) === '100.0');
    await page.close();
  }

  console.log('=== ⑪詳細パネルは最初閉じた状態 ===');
  {
    const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await fixTodayTo(page2, 2026, 10, 15);
    await page2.route('**/shiitake-shipment-plan.html*', async route => {
      const res = await route.fetch();
      const html = await res.text();
      const body = html.replace(/var HARVEST_FORECAST_GAS_URL = '[^']*';/, "var HARVEST_FORECAST_GAS_URL = '';");
      await route.fulfill({ response: res, body });
    });
    await page2.route('**/export**', route => route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' }));
    await page2.goto(PAGE_URL);
    check('収穫予測の詳細は閉じている', !(await page2.evaluate(() => document.getElementById('harvestDetailSection').open)));
    check('在庫予測の詳細は閉じている', !(await page2.evaluate(() => document.getElementById('stockDetailSection').open)));
    await page2.close();
  }

  console.log('=== ⑫基準日・実績日・拠点を切り替えたら、古い読み込み結果を捨てる ===');
  {
    const { page, loadQueries } = await setupPage(browser, { loadValues: {}, loadDelayMs: 400 });
    loadQueries.length = 0;
    // 基準日をすばやく2回切り替える（nextDayは当日が上限のため、prevDayで2日戻す）：
    // 先に発行された読み込みの結果が後から届いても、最後の切替後の表示を上書きしないことを確認する
    await page.click('#prevDay');
    await page.click('#prevDay');
    await page.waitForTimeout(1200);
    check('基準日の切替で詳細の読み込みが複数回行われる', loadQueries.length >= 2);
    check('最後に発行された読み込みのfromが最新の基準日(2回戻したので2026-11-13)', loadQueries[loadQueries.length - 1].from === '2026-11-13');
    check('入力欄が有効になっている（古い読み込みで無効のまま止まっていない）', !(await page.evaluate(s => document.querySelector(s).disabled, input(0))));
    await page.close();

    console.log('  --- 拠点をいなべのまま切り替え直しても、同じ拠点で読み直す ---');
    // 群馬・南丹への拠点切替時に詳細の読み込み・保存を止める安全策
    // （verify_shipment_plan_detail_inabe_only.js で検証）が入ったため、
    // ここでは「拠点切替そのものが詳細の再読み込みの引き金になること」を、
    // いなべ→いなべの切替（本体のクリック処理は拠点が変わらなくても毎回発火する）で確認する
    const { page: page3, loadQueries: loadQueries2 } = await setupPage(browser, { loadValues: {} });
    loadQueries2.length = 0;
    await page3.click('[data-site="いなべ"]');
    await page3.waitForTimeout(500);
    check('拠点ボタンのクリックで詳細を読み直す(いなべを指定)', loadQueries2.some(q => q.site === 'いなべ'));
    await page3.close();
  }

  console.log('=== ⑩本体（table1・table2・table3）の表示・計算が変わらないこと（回帰） ===');
  {
    const { page } = await setupPage(browser, { loadValues: { '2026-11-15': 300 } });
    check('table1の製品在庫・生在庫(M=50/30)', (await text(page, '[data-stock-product="M"]')) === '50.0' && (await text(page, '[data-stock-raw="M"]')) === '30.0');
    check('table1の出荷予定(M offset0=20)', (await text(page, '[data-shipment="M"][data-shipment-offset="0"]')) === '20.0');
    check('table2本体はGASの手入力に影響されず、収穫比率どおり(M=100.0)', (await text(page, mainHarvestCell('M', 0))) === '100.0');
    check('table2本体の収穫実績・収穫比率(M=100.0, 25%)', (await text(page, '[data-harvest-actual="M"]')) === '100.0' && (await text(page, '[data-harvest-ratio="M"]')) === '25%');
    check('table3本体は offset5 で「－」になる(本体のnull伝播)', (await text(page, mainStockCell('M', 5))) === '－');
    await page.close();
  }

  await browser.close();
  console.log(allOk ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
