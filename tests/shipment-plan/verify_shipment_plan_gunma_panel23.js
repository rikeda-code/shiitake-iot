// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）パネル2（収穫予測、table2）・
// パネル3（在庫予測、table3）の群馬対応の検証。実際のスプレッドシートには触れず、
// page.route()でCSV（/export?format=csv）を実際のシートの形に合わせてモックする
// （他ファイルへの依存なし）。
// 「今日」は2026-10-28に固定（基準日=2026-10-28、実績日は既定で基準日の前日=2026-10-27）。
// パネル1（在庫・出荷予定）が群馬で実データ表示になることの検証は別ファイル
// verify_shipment_plan_gunma_panel1.js が担当する（このファイルはパネル1の値を
// パネル3の計算材料として使うための簡単なモックのみ用意する）。
// 確かめること：
//  - 群馬の収穫実績（URL_収穫管理表の群馬列→群馬の「収獲目標値(合計)」タブ）が
//    M/L/2L/袋ごとに正しく集計され、サイズ比率・秀/優（収穫_秀優比率の40/60をLに按分）が
//    目安の表のとおりに表示される
//  - 日別の収穫予測（群馬の「転写」タブの日別合計×比率）が、月をまたいだ列（2026.10→
//    2026.11）の切替を含めて正しく計算され、データが無い日は「－」になる
//  - 在庫予測（table3）が、パネル1の製品在庫＋生在庫を在庫実績とし、当日〜2日後が
//    「在庫実績＋収穫予測－出荷予定」の積み上げで正しく計算される
//  - いなべ→群馬→いなべの切り替え、実績日の変更で、それぞれの拠点・日付の数字に
//    描き直され、途中で古い読み込み（前の拠点向け）が遅れて終わってもその時点の
//    表示を上書きしない（世代チェック）
//  - 南丹はパネル1〜3とも「－」＋「南丹は準備中です」のまま
//  - 群馬のパネル2・3に「準備中」の注記が出ない
//  - URL_収穫管理表の群馬の欄が空の月は、群馬の実績・比率・予測が「－」になる
// 実行：python3 -m http.server 8812 --directory dashboard を起動してから
//       node tests/shipment-plan/verify_shipment_plan_gunma_panel23.js
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
function fmt(v) { return (Math.round(v * 10) / 10).toFixed(1); }

const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STOCK_URL_SHEET_GID = '717295394'; // 「URL_在庫管理表」タブ
const HARVEST_URL_SHEET_GID = '1996914203'; // 「URL_収穫管理表」タブ
const GRADE_RATIO_SHEET_GID = '1773303848'; // 「収穫_秀優比率」タブ
const SALES_SHEET_ID = '18zyC0JwVyaW3i18LQdvHQeDpEcfzM8iolhclgNocrnM';
const SALES_INDEX_GID = '538861653'; // 「シート判別」タブ

const INABE_STOCK_SHEET_ID = 'FAKE_INABE23_STOCK_SHEET_ID';
const INABE_STOCK_GID = '0';
const INABE_ALLOCATION_GID = '276290820';
const GUNMA_STOCK_SHEET_ID = 'FAKE_GUNMA23_STOCK_SHEET_ID';
const GUNMA_STOCK_GID = '0';
const GUNMA_ALLOCATION_GID = '272244694';

const INABE_HARVEST_SHEET_ID = 'FAKE_INABE23_HARVEST_SHEET_ID';
const INABE_HARVEST_GID = '888888001';
const GUNMA_HARVEST_SHEET_ID = '1j40ZnXmxXqu8yl61b1WT7pPGgdRFEBn-yH6gyjtI6OY'; // 「10月群馬収穫管理表」（実物のID）
const GUNMA_HARVEST_GID = '676064999'; // 「収獲目標値(合計)」タブ（実物のgid）

const INABE_DAILY_TOTAL_SHEET_ID = '1B7XEllKSlCEfkBPmNf_fvAz48I6XvMS3hfT_Dy4w_Tw'; // 「2026.5いなべ収穫計画」（実物のID）
const INABE_DAILY_TOTAL_GID = '1164843574'; // 「転写」タブ（実物のgid）
const GUNMA_DAILY_TOTAL_SHEET_ID = '1iZK3xgGkPhXTlnx_DGunW8YQ8bZZFE-r_5Si513r46Y'; // 「2026.5群馬収穫計画」（実物のID）
const GUNMA_DAILY_TOTAL_GID = '1272257227'; // 「転写」タブ（実物のgid）

const OCT_MONTH_GID = '333333001';
const PAGE_URL = 'http://localhost:8812/shiitake-shipment-plan.html';

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`); }

// baseline=基準日(2026-10-28)。stockDate/actualDate=基準日の前日(2026-10-27)
const baseline = new Date(2026, 9, 28);
const actualDate = addDays(baseline, -1);

// 群馬の実績・比率の目安（指示文の目安の表どおり）
const GUNMA_ACTUAL = { M: 66.3, L: 206.35, '2L': 248.65, '袋': 157.75 };
const GUNMA_TOTAL = GUNMA_ACTUAL.M + GUNMA_ACTUAL.L + GUNMA_ACTUAL['2L'] + GUNMA_ACTUAL['袋'];
// 群馬の在庫実績（パネル1の製品在庫＋生在庫。合計がM431.7・L285.1・2L640.4・袋487.0になるよう
// 製品在庫・生在庫を適当に按分する。秀・優の製品在庫按分は確認対象外のため、転写_秀優_判別は空）
const GUNMA_STOCK_ACTUAL = { M: { product: 31.7, raw: 400.0 }, L: { product: 85.1, raw: 200.0 }, '2L': { product: 140.4, raw: 500.0 }, '袋': { product: 87.0, raw: 400.0 } };
// 群馬の出荷予定（販売予実抽出シートのAY〜BB列）：全日共通の簡単な値
const GUNMA_SHIPMENT = { M: 11.1, L: 247.7, '2L': 136.2, '袋': 155.0 };
// 群馬の「転写」タブの日別収穫合計予測値（10/28〜10/31、11/1。11/2以降は値を置かない）
const GUNMA_DAILY_TOTAL = { '2026/10/28': 845, '2026/10/29': 755, '2026/10/30': 615, '2026/10/31': 525, '2026/11/1': 493 };

// 「URL_在庫管理表」タブ：1行目=見出し(A「出荷量」・B以降に拠点名)、2026年の行に各拠点の椎茸在庫ファイルURL
function buildStockUrlCsv() {
  return toCsvText([
    ['出荷量', 'いなべ', '群馬', '南丹'],
    [2026, 'https://docs.google.com/spreadsheets/d/' + INABE_STOCK_SHEET_ID + '/edit?gid=' + INABE_STOCK_GID + '#gid=' + INABE_STOCK_GID,
      'https://docs.google.com/spreadsheets/d/' + GUNMA_STOCK_SHEET_ID + '/edit?gid=' + GUNMA_STOCK_GID + '#gid=' + GUNMA_STOCK_GID, ''],
  ]);
}
// いなべの椎茸在庫（切替テスト用の簡単な値。他ファイルのいなべ基準値と同じ）
function buildInabeStockCsv(stockDate) {
  const dates = []; for (let i = -3; i <= 3; i++) dates.push(addDays(stockDate, i));
  const header = ['', ''].concat(dates.map(d => dstr(d.getFullYear(), d.getMonth() + 1, d.getDate())));
  const rows = [header];
  function row(label, v) { const cells = ['', label]; dates.forEach(d => cells.push(sameDay(d, stockDate) ? v : '')); rows.push(cells); }
  row('M製品在庫', 50); row('M生在庫', 30);
  row('L製品在庫', 100); row('L生在庫　秀Ｌ_40　優Ｌ_60', 60);
  row('2L製品在庫', 20); row('2L生在庫', 10);
  row('袋製品在庫', 15); row('袋生在庫', 5);
  return toCsvText(rows);
}
function buildInabeAllocationCsv() { return toCsvText([['key', 'include', 'exclude', 'factor', 'target']]); }

// 群馬の椎茸在庫。M/L/2L/袋の製品在庫・生在庫の合計が目安の在庫実績(M431.7・L285.1・2L640.4・袋487.0)になる
function buildGunmaStockCsv(stockDate) {
  const dates = []; for (let i = -3; i <= 3; i++) dates.push(addDays(stockDate, i));
  const header = ['', ''].concat(dates.map(d => dstr(d.getFullYear(), d.getMonth() + 1, d.getDate())));
  const rows = [header];
  function row(label, v) { const cells = ['', label]; dates.forEach(d => cells.push(sameDay(d, stockDate) ? v : '')); rows.push(cells); }
  row('M製品在庫', GUNMA_STOCK_ACTUAL.M.product); row('M生在庫', GUNMA_STOCK_ACTUAL.M.raw);
  row('L製品在庫', GUNMA_STOCK_ACTUAL.L.product); row('L生在庫　秀Ｌ_40　優Ｌ_60', GUNMA_STOCK_ACTUAL.L.raw);
  row('2L製品在庫', GUNMA_STOCK_ACTUAL['2L'].product); row('2L生在庫', GUNMA_STOCK_ACTUAL['2L'].raw);
  row('袋製品在庫', GUNMA_STOCK_ACTUAL['袋'].product); row('袋生在庫', GUNMA_STOCK_ACTUAL['袋'].raw);
  return toCsvText(rows);
}
function buildGunmaAllocationCsv() { return toCsvText([['key', 'include', 'exclude', 'factor', 'target']]); }

// 「収穫_秀優比率」タブ：拠点の区別はなく、収穫予測・在庫予測とも秀40・優60（指示文どおり）
function buildGradeRatioCsv() {
  return toCsvText([
    ['パネル', '等級', '比率'],
    ['収穫予測', '秀', 40],
    ['', '優', 60],
    ['在庫予測', '秀', 40],
    ['', '優', 60],
  ]);
}

// 「URL_収穫管理表」タブ：1行目=見出し(A「収穫管理表」・B「いなべ」・C「群馬」・D「南丹」)、
// 2026/10の行にいなべ・群馬それぞれの「収獲目標値」ファイルのURLを置く。
// opts.noGunmaHarvestUrl=trueのときは群馬の欄を空にする
function buildHarvestUrlCsv(opts) {
  opts = opts || {};
  const gunmaUrl = opts.noGunmaHarvestUrl ? '' :
    'https://docs.google.com/spreadsheets/d/' + GUNMA_HARVEST_SHEET_ID + '/edit?gid=' + GUNMA_HARVEST_GID + '#gid=' + GUNMA_HARVEST_GID;
  return toCsvText([
    ['収穫管理表', 'いなべ', '群馬', '南丹'],
    ['2026/10', 'https://docs.google.com/spreadsheets/d/' + INABE_HARVEST_SHEET_ID + '/edit?gid=' + INABE_HARVEST_GID + '#gid=' + INABE_HARVEST_GID, gunmaUrl, ''],
  ]);
}
// いなべの「収獲目標値」：切替テスト用の簡単な値（M100,L200,2L50,袋50、合計400）
function buildInabeHarvestTargetCsv(date) {
  return toCsvText([
    ['日付', 'M', 'L', '2L', '袋'],
    [dstr(date.getFullYear(), date.getMonth() + 1, date.getDate()), 100, 200, 50, 50],
  ]);
}
// 群馬の「収獲目標値(合計)」：3行目が見出し、4行目以降が日別実績。2026年10月分から
// 秀M・優M・秀L・優L・秀2L・優2L・袋1・袋2の8区分になり、群馬は優M・優L・優2L・袋2が
// 常に0.00kg（指示文どおり）。目安の実績(M66.3/L206.35/2L248.65/袋157.75)になるよう
// 秀側にすべて寄せる
function buildGunmaHarvestTargetCsv(date) {
  const d = dstr(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return toCsvText([
    [],
    [],
    ['日付', '目標値', '収穫実績値', '秀M', '優M', '秀L', '優L', '秀2L', '優2L', '袋1', '袋2', '累積目標値'],
    [d, '', '', GUNMA_ACTUAL.M, 0, GUNMA_ACTUAL.L, 0, GUNMA_ACTUAL['2L'], 0, GUNMA_ACTUAL['袋'], 0, ''],
  ]);
}

// いなべの「転写」タブ：切替テスト用に全日400kg固定
function buildInabeDailyTotalCsv(baseDateForKey) {
  const key = baseDateForKey.getFullYear() + '.' + (baseDateForKey.getMonth() + 1);
  const rows = [['', key]];
  for (let d = 1; d <= 31; d++) rows.push(['', 400]);
  return toCsvText(rows);
}
// 群馬の「転写」タブ：1行目=年月見出し（群馬はB1が「見込み1」。年月の列はそれより右にある）。
// 2026.10列は10/28〜10/31に目安の合計値、2026.11列は11/1のみ値を置き、11/2以降は空欄のままにする
// （「転写の2026.11の列に1日しか値がないため－になる」ケースの再現）
function buildGunmaDailyTotalCsv(baseDateForKey) {
  const octKey = baseDateForKey.getFullYear() + '.' + (baseDateForKey.getMonth() + 1);
  const nextMonth = new Date(baseDateForKey.getFullYear(), baseDateForKey.getMonth() + 1, 1);
  const novKey = nextMonth.getFullYear() + '.' + (nextMonth.getMonth() + 1);
  const rows = [['見込み1', octKey, novKey]];
  for (let day = 1; day <= 31; day++) {
    const octDate = new Date(baseDateForKey.getFullYear(), baseDateForKey.getMonth(), day);
    const octKeyStr = octDate.getFullYear() + '/' + (octDate.getMonth() + 1) + '/' + octDate.getDate();
    const octVal = GUNMA_DAILY_TOTAL[octKeyStr] !== undefined ? GUNMA_DAILY_TOTAL[octKeyStr] : '';
    const novDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), day);
    const novKeyStr = novDate.getFullYear() + '/' + (novDate.getMonth() + 1) + '/' + novDate.getDate();
    const novVal = GUNMA_DAILY_TOTAL[novKeyStr] !== undefined ? GUNMA_DAILY_TOTAL[novKeyStr] : '';
    rows.push(['', octVal, novVal]);
  }
  return toCsvText(rows);
}

function buildSalesIndexCsv(baseDateForKey) {
  const key = baseDateForKey.getFullYear() + '.' + (baseDateForKey.getMonth() + 1);
  return toCsvText([
    ['年月', 'URL'],
    [key, 'https://docs.google.com/spreadsheets/d/' + SALES_SHEET_ID + '/edit#gid=' + OCT_MONTH_GID],
  ]);
}
// 受注計画の月シート：いなべ=W〜Z列(22〜25)、群馬はいなべの+28列＝AY〜BB列(50〜53)。
// 両拠点とも全日共通の値を置く（パネル3の積み上げ計算に必要な分だけでよいため）
function buildOrderMonthCsv(maxDay) {
  const width = 54; // 0〜53列（BB列まで）
  const rows = [];
  for (let i = 0; i <= maxDay + 3; i++) {
    const row = new Array(width).fill('');
    row[22] = 20; row[23] = 40; row[24] = 10; row[25] = 10; // いなべ（この回帰の確認では厳密値は見ない）
    row[50] = GUNMA_SHIPMENT.M; row[51] = GUNMA_SHIPMENT.L; row[52] = GUNMA_SHIPMENT['2L']; row[53] = GUNMA_SHIPMENT['袋'];
    rows.push(row);
  }
  return toCsvText(rows);
}

async function setupPage(browser, opts) {
  opts = opts || {};
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await fixTodayTo(page, 2026, 9, 28);
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));

  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    let body = '﻿\r\n';
    if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + STOCK_URL_SHEET_GID)) body = buildStockUrlCsv();
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + HARVEST_URL_SHEET_GID)) body = buildHarvestUrlCsv(opts);
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + GRADE_RATIO_SHEET_GID)) body = buildGradeRatioCsv();
    else if (url.includes(INABE_STOCK_SHEET_ID) && url.includes('gid=' + INABE_STOCK_GID)) body = buildInabeStockCsv(actualDate);
    else if (url.includes(INABE_STOCK_SHEET_ID) && url.includes('gid=' + INABE_ALLOCATION_GID)) body = buildInabeAllocationCsv();
    else if (url.includes(GUNMA_STOCK_SHEET_ID) && url.includes('gid=' + GUNMA_STOCK_GID)) body = buildGunmaStockCsv(actualDate);
    else if (url.includes(GUNMA_STOCK_SHEET_ID) && url.includes('gid=' + GUNMA_ALLOCATION_GID)) body = buildGunmaAllocationCsv();
    else if (url.includes(INABE_HARVEST_SHEET_ID) && url.includes('gid=' + INABE_HARVEST_GID)) body = buildInabeHarvestTargetCsv(opts.actualDateOverride || actualDate);
    else if (url.includes(GUNMA_HARVEST_SHEET_ID) && url.includes('gid=' + GUNMA_HARVEST_GID)) body = buildGunmaHarvestTargetCsv(opts.actualDateOverride || actualDate);
    else if (url.includes(INABE_DAILY_TOTAL_SHEET_ID) && url.includes('gid=' + INABE_DAILY_TOTAL_GID)) body = buildInabeDailyTotalCsv(baseline);
    else if (url.includes(GUNMA_DAILY_TOTAL_SHEET_ID) && url.includes('gid=' + GUNMA_DAILY_TOTAL_GID)) body = buildGunmaDailyTotalCsv(baseline);
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_INDEX_GID)) body = buildSalesIndexCsv(baseline);
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + OCT_MONTH_GID)) body = buildOrderMonthCsv(31);

    if (opts.delayGunmaDailyTotal && url.includes(GUNMA_DAILY_TOTAL_SHEET_ID) && url.includes('gid=' + GUNMA_DAILY_TOTAL_GID)) {
      await new Promise(r => setTimeout(r, opts.delayGunmaDailyTotal));
    }
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
  });

  await page.goto(PAGE_URL + (opts.query || ''));
  await page.waitForSelector('#grid, #table1');
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
const mainHarvestCell = (size, o) => `[data-harvest="${size}"][data-harvest-offset="${o}"]`;
const mainStockCell = (size, o) => `[data-stock-forecast="${size}"][data-stock-forecast-offset="${o}"]`;

// 群馬の期待値（指示文の目安の表どおりに、このファイルのモック値から計算する。
// 手計算の誤りを防ぐため、アプリ側と同じ丸め方（0.1刻み）を使ってここで再計算する）
const gunmaRatio = {};
Object.keys(GUNMA_ACTUAL).forEach(k => { gunmaRatio[k] = GUNMA_ACTUAL[k] / GUNMA_TOTAL; });
const GUNMA_DAY_FORECAST = {}; // offset(0〜4) -> {M,L,2L,袋,秀,優,合計}
['2026/10/28', '2026/10/29', '2026/10/30', '2026/10/31', '2026/11/1'].forEach((key, offset) => {
  const dayTotal = GUNMA_DAILY_TOTAL[key];
  const row = { '合計': String(dayTotal) };
  Object.keys(GUNMA_ACTUAL).forEach(size => { row[size] = fmt(dayTotal * gunmaRatio[size]); });
  row['秀'] = fmt(dayTotal * gunmaRatio['L'] * 0.4);
  row['優'] = fmt(dayTotal * gunmaRatio['L'] * 0.6);
  GUNMA_DAY_FORECAST[offset] = row;
});
// パネル3（在庫予測）の当日〜2日後の積み上げ
const GUNMA_STOCK_FORECAST = {};
{
  let prev = {};
  Object.keys(GUNMA_STOCK_ACTUAL).forEach(k => { prev[k] = GUNMA_STOCK_ACTUAL[k].product + GUNMA_STOCK_ACTUAL[k].raw; });
  for (let offset = 0; offset <= 2; offset++) {
    const row = {};
    Object.keys(GUNMA_STOCK_ACTUAL).forEach(size => {
      const harvestV = parseFloat(GUNMA_DAY_FORECAST[offset][size]);
      const v = Math.round((prev[size] + harvestV - GUNMA_SHIPMENT[size]) * 10) / 10;
      row[size] = v.toFixed(1);
      prev[size] = v;
    });
    GUNMA_STOCK_FORECAST[offset] = row;
  }
}

(async () => {
  const browser = await chromium.launch();

  console.log('=== ①群馬の収穫実績・比率・秀優（基準日2026-10-28、実績日2026-10-27） ===');
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('群馬') });
    await waitStable(page, '[data-harvest-actual="M"]');
    const expectActual = { M: fmt(GUNMA_ACTUAL.M), L: fmt(GUNMA_ACTUAL.L), '2L': fmt(GUNMA_ACTUAL['2L']), '袋': fmt(GUNMA_ACTUAL['袋']) };
    for (const size of ['M', 'L', '2L', '袋']) {
      const actual = await text(page, '[data-harvest-actual="' + size + '"]');
      check(`群馬：${size}の収穫実績=${expectActual[size]}`, actual === expectActual[size], actual);
    }
    const expectRatio = { M: '9.76%', L: '30.39%', '2L': '36.62%', '袋': '23.23%' };
    for (const size of ['M', 'L', '2L', '袋']) {
      const ratio = await text(page, '[data-harvest-ratio="' + size + '"]');
      check(`群馬：${size}の収穫比率=${expectRatio[size]}`, ratio === expectRatio[size], ratio);
    }
    const syu = await text(page, '[data-harvest-actual="秀"]');
    const yuu = await text(page, '[data-harvest-actual="優"]');
    check('群馬：秀の実績=82.5(Lの実績×40%)', syu === '82.5', syu);
    check('群馬：優の実績=123.8(Lの実績×60%)', yuu === '123.8', yuu);
    check('群馬：table2に「群馬は準備中です」の注記は出ない', (await text(page, '#table2SiteNote')) === '', await text(page, '#table2SiteNote'));
    await page.close();
  }

  console.log('=== ②日別の収穫予測（転写タブ×比率。月またぎ・データ無しの日を含む） ===');
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('群馬') });
    await waitStable(page, mainHarvestCell('M', 0));
    for (let offset = 0; offset <= 4; offset++) {
      const expect = GUNMA_DAY_FORECAST[offset];
      const totalCell = await text(page, '[data-harvest-total-offset="' + offset + '"]');
      check(`群馬：offset${offset}の合計=${expect['合計']}`, parseFloat(totalCell) === parseFloat(expect['合計']), totalCell);
      for (const size of ['M', 'L', '2L', '袋', '秀', '優']) {
        const v = await text(page, mainHarvestCell(size, offset));
        check(`群馬：offset${offset}の${size}=${expect[size]}`, v === expect[size], v);
      }
    }
    for (let offset = 5; offset <= 8; offset++) {
      const v = await text(page, mainHarvestCell('M', offset));
      check(`群馬：offset${offset}(11月2日以降、転写に値が無い)は「－」`, v === '－', v);
    }
    await page.close();
  }

  console.log('=== ③在庫予測（パネル1の在庫実績＋収穫予測－出荷予定の積み上げ） ===');
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('群馬') });
    await waitStable(page, mainStockCell('M', 0));
    const expectActual = { M: '431.7', L: '285.1', '2L': '640.4', '袋': '487.0' };
    for (const size of ['M', 'L', '2L', '袋']) {
      const v = await text(page, '[data-stock-forecast-actual="' + size + '"]');
      check(`群馬：在庫予測の${size}の在庫実績=${expectActual[size]}`, v === expectActual[size], v);
    }
    for (let offset = 0; offset <= 2; offset++) {
      const expect = GUNMA_STOCK_FORECAST[offset];
      for (const size of ['M', 'L', '2L', '袋']) {
        const v = await text(page, mainStockCell(size, offset));
        check(`群馬：在庫予測offset${offset}の${size}=${expect[size]}`, v === expect[size], v);
      }
    }
    check('群馬：table3に「群馬は準備中です」の注記は出ない', (await text(page, '#table3SiteNote')) === '', await text(page, '#table3SiteNote'));
    await page.close();
  }

  console.log('=== ④いなべ→群馬→いなべで、それぞれの拠点の数字に描き直される（世代チェック） ===');
  {
    const page = await setupPage(browser, {});
    await waitStable(page, mainHarvestCell('M', 0));
    const inabeHarvest = await text(page, mainHarvestCell('M', 0));
    check('いなべの収穫予測M(offset0)=100.0', inabeHarvest === '100.0', inabeHarvest);
    const inabeStockForecast = await text(page, mainStockCell('M', 0));
    check('いなべの在庫予測M(offset0)は実データ(－ではない)', inabeStockForecast !== '－', inabeStockForecast);

    await clickSite(page, '群馬');
    await waitStable(page, mainHarvestCell('M', 0));
    const gunmaHarvest = await text(page, mainHarvestCell('M', 0));
    check('群馬に切替後、収穫予測M(offset0)が群馬の値(82.5)になる', gunmaHarvest === '82.5', gunmaHarvest);

    await clickSite(page, 'いなべ');
    await waitStable(page, mainHarvestCell('M', 0));
    const backToInabe = await text(page, mainHarvestCell('M', 0));
    check('いなべに戻すと収穫予測M(offset0)がいなべの値(100.0)に戻る', backToInabe === '100.0', backToInabe);
    await page.close();
  }

  console.log('=== ④-2 群馬の読み込みが遅れている間にいなべへ戻しても上書きされない ===');
  {
    const page = await setupPage(browser, { delayGunmaDailyTotal: 1200 });
    await waitStable(page, mainHarvestCell('M', 0));
    await clickSite(page, '群馬'); // 転写タブの取得が1.2秒遅れる
    await page.waitForTimeout(300);
    await clickSite(page, 'いなべ'); // 群馬の応答が届く前にいなべへ戻す
    await waitStable(page, mainHarvestCell('M', 0), 600);
    const soonAfterSwitch = await text(page, mainHarvestCell('M', 0));
    check('いなべに戻した直後はいなべの収穫予測M(100.0)のまま', soonAfterSwitch === '100.0', soonAfterSwitch);
    await page.waitForTimeout(1500); // 群馬の遅れた読み込みが届く頃まで待つ
    const afterDelay = await text(page, mainHarvestCell('M', 0));
    check('群馬の遅れた読み込みが届いても、いなべの表示(100.0)が上書きされない', afterDelay === '100.0', afterDelay);
    await page.close();
  }

  console.log('=== ④-3 実績日を変更すると、変更後の実績日の収穫実績に描き直される ===');
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('群馬'), actualDateOverride: new Date(2026, 9, 25) });
    await waitStable(page, '[data-harvest-actual="M"]');
    // 実績日を変更前(10/27)のモックでは10/25の行が無いため、変更前は実績が「－」になる
    const before = await text(page, '[data-harvest-actual="M"]');
    check('実績日変更前(10/27指定だがモックは10/25のみ)はM実績が「－」', before === '－', before);
    await page.fill('#harvestRefDateInput', '2026-10-25');
    await page.dispatchEvent('#harvestRefDateInput', 'change');
    await waitStable(page, '[data-harvest-actual="M"]');
    const after = await text(page, '[data-harvest-actual="M"]');
    check('実績日を2026-10-25に変更すると、その日の実績(66.3)に描き直される', after === fmt(GUNMA_ACTUAL.M), after);
    await page.close();
  }

  console.log('=== ⑤南丹はパネル1〜3とも「－」＋「準備中」のまま ===');
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('南丹') });
    await page.waitForTimeout(800);
    check('南丹：table1(パネル1)は－', (await text(page, '[data-stock-product="M"]')) === '－');
    check('南丹：table1に「南丹は準備中です」の注記', (await text(page, '#table1SiteNote')) === '南丹は準備中です');
    check('南丹：table2(収穫予測)は－', (await text(page, mainHarvestCell('M', 0))) === '－');
    check('南丹：table2に「南丹は準備中です」の注記', (await text(page, '#table2SiteNote')) === '南丹は準備中です');
    check('南丹：table3(在庫予測)は－', (await text(page, mainStockCell('M', 0))) === '－');
    check('南丹：table3に「南丹は準備中です」の注記', (await text(page, '#table3SiteNote')) === '南丹は準備中です');
    await page.close();
  }

  console.log('=== ⑥URL_収穫管理表の群馬の欄が空のとき、収穫実績・比率・予測が「－」 ===');
  {
    const page = await setupPage(browser, { query: '?site=' + encodeURIComponent('群馬'), noGunmaHarvestUrl: true });
    await page.waitForTimeout(800);
    for (const size of ['M', 'L', '2L', '袋', '秀', '優']) {
      const actual = await text(page, '[data-harvest-actual="' + size + '"]');
      check(`群馬(収穫URL無し)：${size}の実績は－`, actual === '－', actual);
    }
    for (const size of ['M', 'L', '2L', '袋']) {
      const ratio = await text(page, '[data-harvest-ratio="' + size + '"]');
      check(`群馬(収穫URL無し)：${size}の比率は－`, ratio === '－', ratio);
    }
    for (let offset = 0; offset <= 8; offset++) {
      const v = await text(page, mainHarvestCell('M', offset));
      check(`群馬(収穫URL無し)：offset${offset}のMは－`, v === '－', v);
    }
    check('群馬(収穫URL無し)：table2に「準備中」の注記は出ない(URLが無いだけのため)', (await text(page, '#table2SiteNote')) === '', await text(page, '#table2SiteNote'));
    // パネル1(table1)は在庫管理表のURLがある前提なので実データのまま（パネル1はこのファイルの対象外だが、
    // パネル2が「－」でもパネル1に影響しないことの確認を兼ねる）
    check('群馬(収穫URL無し)：table1(製品在庫)は実データのまま(－ではない)', (await text(page, '[data-stock-product="M"]')) !== '－');
    await page.close();
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})();
