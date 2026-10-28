// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）に追加した、表のセルの範囲選択と
// 画面下の集計の帯（直近工数計画・PR #498 と同じ操作感）の検証。
// 椎茸在庫・販売抽出・DB共有・収獲目標値・転写タブ・収穫見込GASのモック、日付固定（2026/11/15）は
// verify_shipment_plan_harvest_detail.js と同じもの（実際の表の構成：table1・table2・table3と
// 収穫予測・在庫予測の詳細の表）をこのファイルに複製して使う（他ファイルへの依存なし）。
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
  const page = opts.mobile
    ? await (await browser.newContext({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true })).newPage()
    : await browser.newPage({ viewport: { width: opts.width || 1280, height: 900 } });
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


// ページの読み込み（在庫・出荷・収穫・詳細の非同期の描画）が落ち着くまで待つ。
// 表の文字が書き換わると選択が解除される仕様のため、操作の前に必ず待つ
async function settle(page) {
  await page.waitForLoadState('networkidle');
  let prev = null;
  for (let i = 0; i < 20; i++) {
    const snap = await page.evaluate(() => ['table1', 'table2', 'table2detail', 'table3', 'table3detail'].map(id => document.getElementById(id).tBodies[0].textContent).join('|'));
    if (snap === prev) return;
    prev = snap;
    await page.waitForTimeout(250);
  }
}

// テスト側の数値の読み取り（ページの実装とは別に書く）。「－」・空欄はnull、カンマ・%は除く
function parseNum(t) {
  t = String(t || '').trim();
  if (t === '' || t === '－') return null;
  const n = Number(t.replace(/,/g, '').replace(/%$/, ''));
  return isNaN(n) ? null : n;
}
// 表のセルのセレクタ（tbodyの行番号・列番号。列番号はサイズ名の<th>を0とした位置）
const cellSel = (tableId, row, col) => `#${tableId} tbody tr:nth-child(${row + 1}) > :nth-child(${col + 1})`;
async function cellText(page, tableId, row, col) { return page.locator(cellSel(tableId, row, col)).innerText(); }
async function center(page, tableId, row, col) {
  const loc = page.locator(cellSel(tableId, row, col));
  await loc.scrollIntoViewIfNeeded();
  let b = await loc.boundingBox();
  // タイトル部分（画面の上に固定）の下に隠れている場合は、その分だけスクロールして見える位置にする
  const headBottom = await page.evaluate(() => document.querySelector('header').getBoundingClientRect().bottom);
  if (b.y < headBottom + 2) {
    await page.evaluate(dy => window.scrollBy(0, dy), b.y - headBottom - 40);
    b = await loc.boundingBox();
  }
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function clickCell(page, tableId, row, col, modifiers) {
  const p = await center(page, tableId, row, col);
  if (modifiers && modifiers.length) for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  if (modifiers && modifiers.length) for (const m of modifiers) await page.keyboard.up(m);
}
async function dragCells(page, tableId, r0, c0, r1, c1) {
  const a = await center(page, tableId, r0, c0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const b = await center(page, tableId, r1, c1);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
}
async function barState(page) {
  return page.evaluate(() => {
    const bar = document.getElementById('aggBar');
    const vis = id => document.getElementById(id).style.display !== 'none';
    return {
      shown: bar.classList.contains('show') && getComputedStyle(bar).display !== 'none',
      sum: document.getElementById('aggSum').textContent, avg: document.getElementById('aggAvg').textContent,
      count: document.getElementById('aggCount').textContent, min: document.getElementById('aggMin').textContent,
      max: document.getElementById('aggMax').textContent,
      warnUnit: vis('aggWarnUnit'), warnTotal: vis('aggWarnTotal'), warnGrade: vis('aggWarnGrade'),
      selected: document.querySelectorAll('.cell-selected').length,
      sel: window.__test.getCellSelection().length,
    };
  });
}
function fmt(v, digits, pct) { return v === null ? '－' : v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + (pct ? '%' : ''); }
// 選んだセルの表示文字列から期待する帯の表示を作る
function expectedBar(texts, digits, pct) {
  const nums = texts.map(parseNum).filter(n => n !== null);
  const sum = nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  return {
    sum: fmt(sum, digits, pct), avg: fmt(nums.length ? sum / nums.length : null, digits, pct), count: String(nums.length),
    min: fmt(nums.length ? Math.min(...nums) : null, digits, pct), max: fmt(nums.length ? Math.max(...nums) : null, digits, pct),
  };
}
async function rectTexts(page, tableId, r0, c0, r1, c1) {
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(await cellText(page, tableId, r, c));
  return out;
}
function sameBar(bar, exp) { return bar.sum === exp.sum && bar.avg === exp.avg && bar.count === exp.count && bar.min === exp.min && bar.max === exp.max; }

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let okCount = 0, ngCount = 0;
  function check(label, ok, extra) {
    console.log('  ' + label + ': ' + (ok ? 'OK' : 'NG') + (!ok && extra !== undefined ? ' (' + JSON.stringify(extra) + ')' : ''));
    if (ok) okCount++; else ngCount++;
  }

  console.log('=== ①選べるセル・選べないセル ===');
  {
    const { page } = await setupPage(browser);
    await settle(page);
    const r = await page.evaluate(() => {
      const count = id => document.querySelectorAll('#' + id + ' tbody td.selectable-cell').length;
      const all = id => document.querySelectorAll('#' + id + ' tbody td').length;
      return {
        t1: [count('table1'), all('table1')], t2: [count('table2'), all('table2')], t3: [count('table3'), all('table3')],
        d2: [count('table2detail'), all('table2detail')], d3: [count('table3detail'), all('table3detail')],
        th: document.querySelectorAll('th.selectable-cell').length,
        inputCells: Array.from(document.querySelectorAll('.harvest-input')).filter(i => i.closest('td').classList.contains('selectable-cell')).length,
        inputCount: document.querySelectorAll('.harvest-input').length,
        userSelect: getComputedStyle(document.querySelector('#table1 tbody td.selectable-cell')).userSelect,
      };
    });
    check('table1・table2・table3の数字のセル（7行×11列）はすべて選べる', r.t1[0] === 77 && r.t1[1] === 77 && r.t2[0] === 77 && r.t3[0] === 77, r);
    check('在庫予測の詳細（7行×11列）はすべて選べる、収穫予測の詳細は合計の行の入力欄9つ以外の68セルが選べる', r.d3[0] === 77 && r.d2[0] === 68 && r.d2[1] === 77, r);
    check('見出し（サイズ名・列見出しの<th>）と入力欄のセルは選べない', r.th === 0 && r.inputCount === 9 && r.inputCells === 0, r);
    check('選べるセルは文字選択されない（user-select:none）', r.userSelect === 'none', r.userSelect);
    // サイズ名・見出しのクリックでは選択されない
    const sizeTh = page.locator('#table1 tbody tr:nth-child(1) th');
    await sizeTh.click();
    await page.locator('#table1 thead th').nth(3).click();
    check('サイズ名・見出しをクリックしても選択されず帯も出ない', (await barState(page)).sel === 0 && !(await barState(page)).shown);
    await page.close();
  }

  console.log('=== ②ドラッグ・Shift・Ctrl（Cmd）で選ぶ／帯の表示 ===');
  {
    const { page } = await setupPage(browser);
    await settle(page);
    // table1：Mの行〜2Lの行は在庫・出荷のkg。M〜L（行0〜1）×当日〜2日後（列3〜5）をドラッグ
    await dragCells(page, 'table1', 0, 3, 1, 5);
    let bar = await barState(page);
    let exp = expectedBar(await rectTexts(page, 'table1', 0, 3, 1, 5), 1);
    check('ドラッグで四角い範囲（2行×3列＝6セル）が選ばれ、色が付く', bar.sel === 6 && bar.selected === 6, bar);
    check('帯に合計・平均・個数・最小・最大が出る（kgは小数1桁）', bar.shown && sameBar(bar, exp), { bar, exp });
    const bg = await page.locator(cellSel('table1', 0, 3)).evaluate(el => getComputedStyle(el).backgroundColor);
    check('選んだセルは直近工数計画と同じ色（#bfe0fb）', bg === 'rgb(191, 224, 251)', bg);
    check('ドラッグしてもブラウザの文字選択（青い反転）が起きない', (await page.evaluate(() => String(window.getSelection()))) === '');
    // Shift＋クリックで範囲を広げる（起点は最後に単独で押したセル＝M・当日）
    await clickCell(page, 'table1', 3, 4, ['Shift']);
    bar = await barState(page);
    exp = expectedBar(await rectTexts(page, 'table1', 0, 3, 3, 4), 1);
    check('Shift＋クリックで起点（M・当日）から優・翌日までの範囲（4行×2列）に広がる', bar.sel === 8 && sameBar(bar, exp), { bar, exp });
    // Ctrl＋クリックで別の表のセルを1つ追加し、もう一度で解除
    const before = bar.sel;
    await clickCell(page, 'table2', 0, 3, ['Control']);
    bar = await barState(page);
    check('Ctrl＋クリックで別の表（収穫予測）のセルを追加できる', bar.sel === before + 1, bar);
    await clickCell(page, 'table2', 0, 3, ['Control']);
    bar = await barState(page);
    check('もう一度Ctrl＋クリックするとそのセルだけ解除される', bar.sel === before, bar);
    await clickCell(page, 'table2', 1, 4, ['Meta']);
    bar = await barState(page);
    check('Mac の Cmd（Meta）＋クリックでも追加できる', bar.sel === before + 1, bar);
    // 別の表へのドラッグは起点のセルだけ（直近工数計画と同じ扱い）
    await dragCells(page, 'table1', 0, 3, 0, 3);
    const a = await center(page, 'table1', 0, 3);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    const b = await center(page, 'table3', 1, 4);
    await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
    bar = await barState(page);
    check('ドラッグで別の表にまたがっても、範囲は起点の表の中だけ（起点の1セル）', bar.sel === 1, bar);
    // 「選択を解除」ボタン
    await page.click('#aggClearBtn');
    bar = await barState(page);
    check('「選択を解除」で選択が消え、帯が消える', bar.sel === 0 && bar.selected === 0 && !bar.shown, bar);
    // Escでも解除
    await clickCell(page, 'table1', 0, 3);
    await page.keyboard.press('Escape');
    check('Escでも選択が解除される', (await barState(page)).sel === 0);
    // 表の外のクリックで解除
    await clickCell(page, 'table1', 0, 3);
    await page.mouse.click(5, 5);
    check('表の外をクリックすると選択が解除される', (await barState(page)).sel === 0);
    await page.close();
  }

  console.log('=== ③「－」・「0.0」の扱い、比率（%）の表示 ===');
  {
    const { page } = await setupPage(browser);
    await settle(page);
    // 表の数字の書き換えは選択の解除につながるため、選ぶ前にテスト用の値に置き換える
    await page.evaluate(() => {
      const row = document.querySelector('#table3 tbody tr:nth-child(1)');
      row.cells[3].textContent = '0.0';
      row.cells[4].textContent = '－';
      row.cells[5].textContent = '';
      row.cells[6].textContent = '12.5';
    });
    await page.waitForTimeout(50);
    // table3のMの行を画面の一番下に見えている行にする（ドラッグを始めて帯が
    // 出ると帯の下に隠れる位置）。そこからのドラッグでも範囲が選べることも、あわせて確認する
    // （行の高さに左右されないよう、その行が画面の一番下に来るようにスクロールしてから確かめる）
    // （ページの一番上でもその行が画面の下端に届かない場合は、画面の高さを合わせる）
    const rowBottom0 = await page.evaluate(() => document.querySelector('#table3 tbody tr:nth-child(1)').getBoundingClientRect().bottom + window.scrollY);
    if (rowBottom0 + 4 < 900) await page.setViewportSize({ width: 1280, height: Math.ceil(rowBottom0) + 4 });
    const nearBottom = await page.evaluate(() => {
      const row = document.querySelector('#table3 tbody tr:nth-child(1)');
      window.scrollBy(0, row.getBoundingClientRect().bottom - (window.innerHeight - 4));
      const r = row.getBoundingClientRect();
      return { ok: r.bottom > window.innerHeight - 40 && r.bottom <= window.innerHeight, bottom: r.bottom, innerHeight: window.innerHeight, scrollY: window.scrollY };
    });
    await dragCells(page, 'table3', 0, 3, 0, 6);
    let bar = await barState(page);
    check('帯の下に隠れる位置（画面の一番下の行）からのドラッグでも範囲が選べる', nearBottom.ok && bar.sel === 4, { nearBottom, sel: bar.sel });
    check('「－」・空欄は数えず、「0.0」は0として数える（4セル選んで個数2・合計12.5・最小0.0）',
      bar.sel === 4 && bar.count === '2' && bar.sum === '12.5' && bar.min === '0.0' && bar.avg === '6.3' && bar.max === '12.5', bar);
    // 収穫比率（table2の比率の列）：M・L・2L・袋（秀・優の比率は「－」）
    await page.click('#aggClearBtn');
    await dragCells(page, 'table2', 0, 2, 5, 2);
    bar = await barState(page);
    const texts = await rectTexts(page, 'table2', 0, 2, 5, 2);
    const pct = texts.filter(t => parseNum(t) !== null).every(t => /%$/.test(t.trim()));
    let exp = expectedBar(texts, 2, pct);
    check('比率（%）の列だけを選ぶと小数2桁で表示（秀・優の「－」は数えない）', sameBar(bar, exp) && bar.count === '4' && !bar.warnUnit, { bar, exp, texts });
    // 在庫比率（table3の比率の列）
    await page.click('#aggClearBtn');
    await dragCells(page, 'table3', 1, 2, 4, 2);
    bar = await barState(page);
    const texts3 = await rectTexts(page, 'table3', 1, 2, 4, 2);
    const pct3 = texts3.filter(t => parseNum(t) !== null).every(t => /%$/.test(t.trim()));
    exp = expectedBar(texts3, 2, pct3);
    check('在庫比率も小数2桁（表示が「%」付きなら帯も「%」付き）', sameBar(bar, exp), { bar, exp, texts3 });
    // 純粋関数
    const pure = await page.evaluate(() => {
      const t = window.__test;
      const mk = (text, cls, label) => { const tr = document.createElement('tr'); const th = document.createElement('th'); th.textContent = label || 'M'; tr.appendChild(th); const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); return td; };
      return {
        parse: ['1,234.5', '0.0', '－', '', '25.5%', '-3.2', 'abc', '−4.0'].map(t.parseSelectionCellNumber),
        agg: t.computeSelectionAggregation([mk('1.0'), mk('－'), mk('0.0'), mk('2,000.5')]),
      };
    });
    check('数値の読み取り：カンマ・%を除き、「－」・空欄・文字は数えない、マイナスも読む',
      JSON.stringify(pure.parse) === JSON.stringify([1234.5, 0, null, null, 25.5, -3.2, null, -4]), pure.parse);
    check('集計の純粋関数：合計2001.5・個数3・最小0・最大2000.5',
      pure.agg.sum === 2001.5 && pure.agg.count === 3 && pure.agg.min === 0 && pure.agg.max === 2000.5 && pure.agg.unit === 'kg', pure.agg);
    await page.close();
  }

  console.log('=== ④注意表示 ===');
  {
    const { page } = await setupPage(browser);
    await settle(page);
    // kgと比率の混在（収穫予測：収穫実績と収穫比率の列）
    await dragCells(page, 'table2', 0, 1, 0, 2);
    let bar = await barState(page);
    check('kgのセルと比率（%）のセルが混ざると単位混在の注意が出る（集計は出す）', bar.warnUnit && bar.shown && bar.count === '2' && !bar.warnTotal && !bar.warnGrade, bar);
    // 合計の行と各サイズの行
    await page.click('#aggClearBtn');
    await dragCells(page, 'table1', 0, 3, 0, 4);
    check('サイズの行だけなら合計の行の注意は出ない', !(await barState(page)).warnTotal);
    await clickCell(page, 'table1', 6, 3, ['Control']);
    bar = await barState(page);
    check('合計の行と各サイズの行を一緒に選ぶと二重計上の注意が出る', bar.warnTotal && !bar.warnUnit && !bar.warnGrade, bar);
    await page.click('#aggClearBtn');
    await dragCells(page, 'table3detail', 6, 3, 6, 6);
    check('合計の行だけなら注意は出ない', !(await barState(page)).warnTotal);
    await clickCell(page, 'table3detail', 4, 3, ['Control']);
    check('詳細の表でも合計の行＋サイズ（2L）の行で注意が出る', (await barState(page)).warnTotal);
    // Lと秀・優
    await page.click('#aggClearBtn');
    await dragCells(page, 'table1', 1, 3, 2, 3); // L・秀
    bar = await barState(page);
    check('Lの行と秀の行を一緒に選ぶと「秀・優はLの内訳」の注意が出る', bar.warnGrade && !bar.warnTotal, bar);
    await page.click('#aggClearBtn');
    await dragCells(page, 'table2', 2, 3, 3, 4); // 秀・優だけ
    check('秀・優だけならLの内訳の注意は出ない', !(await barState(page)).warnGrade);
    await clickCell(page, 'table3', 1, 3, ['Control']); // 別の表のL
    check('別の表のLの行と優の行の組み合わせでも注意が出る', (await barState(page)).warnGrade);
    await page.close();
  }

  console.log('=== ⑤帯の高さ・ページの一番下の行が隠れない ===');
  for (const width of [1280, 375]) {
    const { page } = await setupPage(browser, { width });
    await settle(page);
    await clickCell(page, 'table1', 0, 3);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => {
      const bar = document.getElementById('aggBar').getBoundingClientRect();
      const lastRow = document.querySelector('#table3detail tbody tr:last-child').getBoundingClientRect();
      const lastSection = document.querySelector('.wrap > section:last-of-type').getBoundingClientRect();
      const lineH = parseFloat(getComputedStyle(document.querySelector('#aggBar .agg-item .v')).lineHeight);
      return { barH: bar.height, barTop: bar.top, lastRowBottom: lastRow.bottom, sectionBottom: lastSection.bottom, lineH,
        pb: parseFloat(getComputedStyle(document.body).paddingBottom) };
    });
    const oneLine = width >= 1280 ? m.barH <= m.lineH * 1.6 + 8 : m.barH <= m.lineH * 2 * 1.6 + 8;
    check(`幅${width}px：帯は${width >= 1280 ? '1行分' : '最大2行分（折り返し時）'}の高さ（${Math.round(m.barH)}px）`, oneLine, m);
    check(`幅${width}px：一番下までスクロールしても、ページの一番下（在庫予測パネル）が帯に隠れない`, m.sectionBottom <= m.barTop + 0.5 && m.pb >= m.barH, m);
    await page.evaluate(() => { document.getElementById('stockDetailSection').open = true; window.scrollTo(0, document.documentElement.scrollHeight); });
    await page.waitForTimeout(100);
    const m2 = await page.evaluate(() => ({ barTop: document.getElementById('aggBar').getBoundingClientRect().top, lastRowBottom: document.querySelector('#table3detail tbody tr:last-child').getBoundingClientRect().bottom }));
    check(`幅${width}px：詳細を開いた状態でも、一番下の行（在庫予測の詳細の合計）が帯に隠れない`, m2.lastRowBottom <= m2.barTop + 0.5, m2);
    await page.close();
  }

  console.log('=== ⑥スマートフォン：タップで1セルずつ追加・解除 ===');
  {
    const { page } = await setupPage(browser, { mobile: true });
    await settle(page);
    const tap = async (t, r, c) => { const p = await center(page, t, r, c); await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(50); };
    await tap('table1', 0, 3);
    await tap('table1', 1, 4);
    await tap('table2', 0, 3);
    let bar = await barState(page);
    const exp = expectedBar([await cellText(page, 'table1', 0, 3), await cellText(page, 'table1', 1, 4), await cellText(page, 'table2', 0, 3)], 1);
    check('タップのたびに1セルずつ追加される（別の表も追加できる）', bar.sel === 3 && sameBar(bar, exp), { bar, exp });
    await tap('table1', 1, 4);
    bar = await barState(page);
    check('選択済みのセルをもう一度タップすると解除される', bar.sel === 2, bar);
    await page.close();
  }

  console.log('=== ⑦再描画・詳細の開閉との関係 ===');
  {
    const { page, posts } = await setupPage(browser);
    await settle(page);
    // 詳細の開閉では他の表の選択は残る
    await clickCell(page, 'table1', 0, 3);
    await clickCell(page, 'table2detail', 0, 3, ['Control']);
    await page.click('#harvestDetailSection > summary'); // 閉じる
    await page.waitForTimeout(100); // details の toggle イベントは非同期で届く
    let bar = await barState(page);
    check('詳細を閉じても他の表（table1）の選択は残り、閉じた詳細の表のセルだけ選択から外れる',
      bar.sel === 1 && (await page.locator(cellSel('table1', 0, 3)).evaluate(el => el.classList.contains('cell-selected'))), bar);
    await page.click('#harvestDetailSection > summary'); // 開く
    await page.waitForTimeout(100);
    check('詳細を開いても選択は残る', (await barState(page)).sel === 1);
    // 基準日の切り替え
    await page.click('#prevDay');
    await page.waitForTimeout(100);
    bar = await barState(page);
    check('基準日の切り替えで選択が解除され、帯が消える', bar.sel === 0 && !bar.shown, bar);
    await settle(page);
    await page.click('#nextDay');
    await settle(page);
    // 実績日の切り替え
    await clickCell(page, 'table3', 0, 3);
    await page.click('#harvestPrevDay');
    await settle(page);
    bar = await barState(page);
    check('実績日の切り替えで選択が解除される', bar.sel === 0 && !bar.shown, bar);
    await page.click('#harvestTodayBtn');
    await settle(page);
    // 拠点の切り替え（いなべ→いなべ以外→いなべ）
    await clickCell(page, 'table1', 0, 3);
    await page.click('#siteToggle button[data-site="群馬"]');
    await settle(page);
    bar = await barState(page);
    check('拠点の切り替えで選択が解除される', bar.sel === 0 && !bar.shown, bar);
    await page.click('#siteToggle button[data-site="いなべ"]');
    await settle(page);
    // 詳細の再計算（収穫見込の入力→Enter）で描き直されたら解除。入力・保存はこれまでどおり
    await clickCell(page, 'table1', 0, 3);
    await page.evaluate(() => { const i = document.querySelector('[data-harvest-input-offset="1"]'); i.value = '500'; i.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(300);
    bar = await barState(page);
    const harvestM1 = await page.locator('[data-harvest-detail="M"][data-harvest-detail-offset="1"]').innerText();
    check('詳細の再計算（収穫見込の入力）で表が描き直されると選択が解除される', bar.sel === 0 && !bar.shown, bar);
    check('収穫見込の入力・保存はこれまでどおり（GASへ保存され、Mの按分が500×0.25＝125.0）',
      posts.length === 1 && posts[0].kg === 500 && harvestM1 === '125.0', { posts, harvestM1 });
    // 入力欄のクリック・入力の操作は選択に邪魔されない（クリックしてもセルが選ばれず、入力できる）
    const inp = page.locator('[data-harvest-input-offset="2"]');
    await inp.click();
    await inp.fill('400');
    await inp.press('Enter');
    await page.waitForTimeout(300);
    check('入力欄をクリック・入力しても選択は始まらず、Enterで保存される', (await barState(page)).sel === 0 && posts.length === 2 && posts[1].kg === 400, posts);
    await page.close();
  }

  await browser.close();
  console.log(`\n${ngCount === 0 ? 'すべてOK' : 'NGあり'} (OK ${okCount} / NG ${ngCount})`);
  console.log('DONE');
  process.exit(ngCount === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
