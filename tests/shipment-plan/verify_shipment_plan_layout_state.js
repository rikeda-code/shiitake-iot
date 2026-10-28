// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）の
//  ・タイトル部分（タイトル・拠点ボタン・下の罫線）の画面上部への固定
//  ・表（table1・table2・table3・収穫予測／在庫予測の詳細）の行の高さを約10%詰めたこと
//  ・表示状態（拠点・詳細の開閉）のURLのクエリへの保持（リロードしても同じ状態で開く）
// の検証。モック・日付固定（2026/11/15）・範囲選択の操作の補助関数は
// verify_shipment_plan_cell_selection.js と同じものをこのファイルに複製して使う（他ファイルへの依存なし）。
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
    : await browser.newPage({ viewport: { width: opts.width || 1280, height: opts.height || 900 } });
  await fixTodayTo(page, 2026, 10, 15);
  const posts = [];
  const loadQueries = [];

  // htmlpreview形式（?https://github.com/…）のクエリ付きでも差し替えられるよう、パスで判定する
  await page.route(u => new URL(u).pathname.endsWith('/shiitake-shipment-plan.html'), async route => {
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

  await page.goto(PAGE_URL + (opts.query || ''));
  // 詳細パネルは最初閉じた状態（仕様どおり）。テストで中身を操作・確認するため開いておく
  // （表示状態の保持を確かめるテストでは開閉に触れない：keepDetails）
  if (!opts.keepDetails) await page.evaluate(() => {
    const a = document.getElementById('harvestDetailSection');
    const b = document.getElementById('stockDetailSection');
    if (a) a.open = true;
    if (b) b.open = true;
  });
  // 実績日をモックの実績日（基準日の前日）以外にすると収穫実績のデータが無く表が「－」のままに
  // なるため、日付を変えるテストでは数字の表示を待たない（skipDataWait）
  if (!opts.skipDataWait) {
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-harvest="M"][data-harvest-offset="0"]');
      return el && el.textContent.trim() !== '－';
    }, null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-stock-forecast="M"][data-stock-forecast-offset="0"]');
      return el && el.textContent.trim() !== '－';
    }, null, { timeout: 15000 });
  }
  if (!opts.noGas && !opts.skipDetailWait && !opts.keepDetails) {
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


const decodeSearch = page => page.evaluate(() => decodeURIComponent(location.search));
async function viewState(page) {
  return page.evaluate(() => ({
    site: (document.querySelector('#siteToggle button.active') || {}).textContent,
    activeCount: document.querySelectorAll('#siteToggle button.active').length,
    harvestDetail: document.getElementById('harvestDetailSection').open,
    stockDetail: document.getElementById('stockDetailSection').open,
    inputDisabled: Array.from(document.querySelectorAll('.harvest-input')).every(i => i.disabled),
  }));
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let okCount = 0, ngCount = 0;
  function check(label, ok, extra) {
    console.log('  ' + label + ': ' + (ok ? 'OK' : 'NG') + (!ok && extra !== undefined ? ' (' + JSON.stringify(extra) + ')' : ''));
    if (ok) okCount++; else ngCount++;
  }

  console.log('=== ①タイトル部分の固定 ===');
  for (const width of [1280, 375]) {
    // 詳細を閉じた状態でもページがスクロールするよう、パソコンの画面は高さを低めにする
    const { page } = await setupPage(browser, { width, height: 560, mobile: width === 375, keepDetails: true });
    await settle(page);
    const before = await page.evaluate(() => {
      const h = document.querySelector('header');
      const cs = getComputedStyle(h);
      return { position: cs.position, top: cs.top, zIndex: Number(cs.zIndex), bg: cs.backgroundColor, paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
        hasTitle: !!h.querySelector('h1'), hasToggle: !!h.querySelector('#siteToggle'), hasDayNav: !!h.querySelector('.day-nav'), border: cs.borderBottomWidth };
    });
    check(`幅${width}px：タイトル・拠点ボタン・下の罫線が固定（sticky・top:0）で、基準日・実績日の操作欄は含まない`,
      before.position === 'sticky' && before.top === '0px' && before.hasTitle && before.hasToggle && !before.hasDayNav && before.border === '2px', before);
    check(`幅${width}px：固定部分はページと同じ背景色（${before.paper}）で塗られ、表・パネル・集計の帯（z-index 30）より手前`,
      before.bg === 'rgb(247, 242, 231)' && before.zIndex > 30, before);
    // 収穫予測パネルが見えるところまでスクロール
    await page.evaluate(() => window.scrollTo(0, document.getElementById('table2').getBoundingClientRect().top + window.scrollY - 30));
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => {
      const h = document.querySelector('header').getBoundingClientRect();
      const t1 = document.getElementById('table1').getBoundingClientRect();
      const nav = document.getElementById('refDateInput').getBoundingClientRect();
      // 固定部分の中の点で一番手前にある要素が固定部分自身であること（下を流れる表が透けない）
      const pts = [[Math.round(h.left + 5), h.bottom - 4], [Math.round(h.left + h.width / 2), h.bottom - 4], [Math.round(h.left + 5), h.top + 5]];
      const front = pts.map(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('header')); });
      // その点の下にパネル（表）が流れていること
      const behind = pts.map(([x, y]) => document.elementsFromPoint(x, y).some(e => e.closest && e.closest('section.panel')));
      return { headTop: h.top, headBottom: h.bottom, scrollY: window.scrollY, t1Top: t1.top, navBottom: nav.bottom, front, behind };
    });
    check(`幅${width}px：スクロールしてもタイトル部分が画面の上に残る`, after.scrollY > 100 && Math.abs(after.headTop) < 1, after);
    check(`幅${width}px：パネル（在庫・出荷予定）は固定部分の下を流れ、基準日の操作欄は一緒にスクロールして見えなくなる`,
      after.t1Top < after.headBottom && after.navBottom < after.headBottom, after);
    check(`幅${width}px：固定部分は下を流れるパネル・表より手前に描かれる（透けない）`, after.front.every(Boolean) && after.behind.some(Boolean), after);
    // スクロールした状態で拠点ボタンが押せる
    await page.click('#siteToggle button[data-site="群馬"]');
    await page.waitForTimeout(100);
    let st = await viewState(page);
    check(`幅${width}px：スクロールした状態でも拠点ボタンが押せる（群馬に切り替わる）`, st.site === '群馬' && st.activeCount === 1, st);
    await page.click('#siteToggle button[data-site="いなべ"]');
    await page.waitForTimeout(100);
    st = await viewState(page);
    check(`幅${width}px：いなべに戻せる`, st.site === 'いなべ', st);
    await page.close();
  }

  console.log('=== ②表の行の高さ（約10%低く） ===');
  {
    const { page } = await setupPage(browser);
    await settle(page);
    const ids = ['table1', 'table2', 'table2detail', 'table3', 'table3detail'];
    const measure = () => page.evaluate(ids => ids.map(id => {
      const t = document.getElementById(id);
      return {
        id,
        rows: Array.from(t.rows).map(r => r.getBoundingClientRect().height),
        cols: Array.from(t.rows[0].cells).map(c => Math.round(c.getBoundingClientRect().width * 10) / 10),
        font: getComputedStyle(t.tBodies[0].rows[0].cells[0]).fontSize + '/' + getComputedStyle(t.tHead.rows[0].cells[0]).fontSize,
        bg: getComputedStyle(t.tBodies[0].rows[0].cells[0]).backgroundColor,
      };
    }), ids);
    const nowM = await measure();
    // 変更前の余白（上下だけ）に戻すスタイルを一時的に足して、変更前の高さを同じ画面で測る
    await page.addStyleTag({ content: `
      thead th{ padding:4px 10px !important; }
      thead tr.weekday th{ padding:3px 10px 4px !important; }
      tbody td, tbody th{ padding:4px 10px !important; }
      tr.grade-row td, tr.grade-row th{ padding-top:3px !important; padding-bottom:3px !important; }` });
    await page.waitForTimeout(50);
    const oldM = await measure();
    const ratios = [], inputRatios = [];
    nowM.forEach((t, ti) => t.rows.forEach((h, ri) => {
      const isInputRow = t.id === 'table2detail' && ri === t.rows.length - 1;
      (isInputRow ? inputRatios : ratios).push({ id: t.id, ri, now: Math.round(h * 10) / 10, old: Math.round(oldM[ti].rows[ri] * 10) / 10, ratio: Math.round(h / oldM[ti].rows[ri] * 1000) / 1000 });
    }));
    console.log('    行の高さ（変更前→変更後, px）：' + nowM.map((t, ti) => t.id + '[' + t.rows.map((h, ri) => (Math.round(oldM[ti].rows[ri] * 10) / 10) + '→' + (Math.round(h * 10) / 10)).join(' ') + ']').join(' '));
    check('見出しの行・データの行とも、行の高さが変更前の約90%（0.88〜0.92倍）', ratios.every(r => r.ratio >= 0.88 && r.ratio <= 0.92), ratios.filter(r => r.ratio < 0.88 || r.ratio > 0.92));
    check('収穫予測の詳細の合計の行（入力欄）は縮み方が小さい（0.85〜0.95倍）', inputRatios.every(r => r.ratio >= 0.85 && r.ratio <= 0.95), inputRatios);
    check('文字の大きさ・列の幅・色は変わらない', JSON.stringify(nowM.map(t => [t.cols, t.font, t.bg])) === JSON.stringify(oldM.map(t => [t.cols, t.font, t.bg])), { now: nowM.map(t => [t.font, t.bg]), old: oldM.map(t => [t.font, t.bg]) });
    await page.close();
    // 余白を詰めた状態（追加したスタイルなし）で入力欄に入力・保存できる
    const p2 = await setupPage(browser);
    await settle(p2.page);
    const inp = p2.page.locator('[data-harvest-input-offset="2"]');
    const box = await inp.boundingBox();
    await inp.click();
    await inp.fill('400');
    await inp.press('Enter');
    await p2.page.waitForTimeout(300);
    const m2 = await p2.page.locator('[data-harvest-detail="M"][data-harvest-detail-offset="2"]').innerText();
    check('入力欄は入力しやすい大きさのまま（高さ20px以上）で、入力・保存・再計算ができる', box.height >= 20 && p2.posts.length === 1 && p2.posts[0].kg === 400 && m2 === '100.0', { h: box.height, posts: p2.posts, m2 });
    await p2.page.close();
  }

  console.log('=== ③表示状態（拠点・詳細の開閉）をURLのクエリに保ち、リロードしても同じ状態で開く ===');
  {
    const { page, posts, loadQueries } = await setupPage(browser, { keepDetails: true });
    await settle(page);
    let st = await viewState(page);
    check('クエリが無いときは いなべ・詳細は閉じた状態', st.site === 'いなべ' && !st.harvestDetail && !st.stockDetail && (await page.evaluate(() => location.search)) === '', st);
    const histLen0 = await page.evaluate(() => history.length);
    await page.click('#siteToggle button[data-site="群馬"]');
    await page.click('#harvestDetailSection > summary');
    await page.click('#stockDetailSection > summary');
    await page.waitForTimeout(200);
    const q1 = await decodeSearch(page);
    check('拠点の切り替え・詳細の開閉でURLのクエリが書き換わる（?site=群馬&harvestDetail=open&stockDetail=open）',
      q1 === '?site=群馬&harvestDetail=open&stockDetail=open', q1);
    check('URLの書き換えで履歴は増えない（replaceState）', (await page.evaluate(() => history.length)) === histLen0);
    const loadsBefore = loadQueries.length, postsBefore = posts.length;
    await page.reload();
    await settle(page);
    await page.waitForTimeout(300);
    st = await viewState(page);
    check('リロードすると群馬・収穫予測の詳細・在庫予測の詳細が開いた状態で表示される', st.site === '群馬' && st.activeCount === 1 && st.harvestDetail && st.stockDetail, st);
    const note = await page.evaluate(() => document.getElementById('harvestDetailNote').textContent);
    const dash = await page.evaluate(() => document.querySelector('[data-harvest-detail="M"][data-harvest-detail-offset="0"]').textContent.trim());
    check('群馬の状態でリロードしても、GASへの収穫見込の読み込み・保存は送られず、入力欄は無効・詳細は「－」（PR #515 の安全策）',
      loadQueries.length === loadsBefore && posts.length === postsBefore && st.inputDisabled && dash === '－' && note.includes('いなべのみ対応'), { loads: loadQueries.length - loadsBefore, posts: posts.length - postsBefore, st, dash });
    // いなべ・詳細を閉じた状態に戻してリロード
    await page.click('#siteToggle button[data-site="いなべ"]');
    await page.click('#harvestDetailSection > summary');
    await page.click('#stockDetailSection > summary');
    await page.waitForTimeout(200);
    check('いなべ・詳細を閉じた状態に戻すとクエリが無くなる', (await page.evaluate(() => location.search)) === '', await decodeSearch(page));
    await page.reload();
    await settle(page);
    st = await viewState(page);
    check('リロードすると いなべ・詳細が閉じた状態で表示され、収穫見込の読み込みも今までどおり行われる',
      st.site === 'いなべ' && !st.harvestDetail && !st.stockDetail && loadQueries.length > loadsBefore && !st.inputDisabled, { st, loads: loadQueries.length - loadsBefore });
    // 在庫予測の詳細だけ開いた状態
    await page.click('#stockDetailSection > summary');
    await page.waitForTimeout(200);
    check('在庫予測の詳細だけ開くと ?stockDetail=open', (await decodeSearch(page)) === '?stockDetail=open', await decodeSearch(page));
    await page.reload();
    await settle(page);
    st = await viewState(page);
    check('リロードすると在庫予測の詳細だけ開いた状態', st.site === 'いなべ' && !st.harvestDetail && st.stockDetail, st);
    await page.close();
  }
  {
    // 南丹をクエリで直接開く（リロードと同じ）
    // 南丹はパネル1〜3が「準備中」で数字が出ないため、本体の数字を待たない（skipDataWait）
    const { page, posts, loadQueries } = await setupPage(browser, { keepDetails: true, skipDataWait: true, query: '?site=' + encodeURIComponent('南丹') + '&harvestDetail=open' });
    await settle(page);
    await page.waitForTimeout(300);
    const st = await viewState(page);
    check('?site=南丹&harvestDetail=open で開くと南丹・収穫予測の詳細が開いた状態、GASへの読み込み・保存は送られない',
      st.site === '南丹' && st.harvestDetail && !st.stockDetail && loadQueries.length === 0 && posts.length === 0 && st.inputDisabled, { st, loads: loadQueries.length });
    await page.close();
  }
  for (const q of ['?site=' + encodeURIComponent('大阪') + '&harvestDetail=yes&stockDetail=1', '?site=&harvestDetail=&foo=bar', '?%%%']) {
    const { page, loadQueries } = await setupPage(browser, { keepDetails: true, query: q });
    await settle(page);
    const st = await viewState(page);
    check(`値がおかしいクエリ（${q}）では いなべ・詳細が閉じた状態`, st.site === 'いなべ' && st.activeCount === 1 && !st.harvestDetail && !st.stockDetail && loadQueries.length > 0, { st, loads: loadQueries.length });
    await page.close();
  }

  console.log('=== ④htmlpreview でのプレビュー（URLが ?https://github.com/… の形） ===');
  {
    const previewPrefix = '?https://github.com/rikeda-code/shiitake-iot/blob/feature/shipment-plan-cell-selection/dashboard/shiitake-shipment-plan.html';
    const { page: pp } = await setupPage(browser, { keepDetails: true });
    const pure = await pp.evaluate(prefix => {
      const t = window.__test;
      return {
        split: t.splitViewStateSearch(prefix + '?site=%E7%BE%A4%E9%A6%AC&stockDetail=open'),
        splitNone: t.splitViewStateSearch(prefix),
        state: t.readViewStateFromSearch(prefix + '?site=%E7%BE%A4%E9%A6%AC&stockDetail=open'),
        stateNone: t.readViewStateFromSearch(prefix),
        normal: t.readViewStateFromSearch('?site=%E5%8D%97%E4%B8%B9&harvestDetail=open'),
      };
    }, previewPrefix);
    await pp.close();
    check('htmlpreview形式のURLから、表示するファイルのURLとこのページの状態のクエリを分けて読める',
      pure.split.prefix === previewPrefix && pure.split.query === 'site=%E7%BE%A4%E9%A6%AC&stockDetail=open'
      && pure.splitNone.prefix === previewPrefix && pure.splitNone.query === ''
      && pure.state.site === '群馬' && pure.state.stockDetail && !pure.state.harvestDetail
      && pure.stateNone.site === 'いなべ' && !pure.stateNone.harvestDetail
      && pure.normal.site === '南丹' && pure.normal.harvestDetail, pure);
    // 実際に htmlpreview と同じ形のURLで開き、切り替え→リロード
    const { page, loadQueries } = await setupPage(browser, { keepDetails: true, query: previewPrefix });
    await settle(page);
    let st = await viewState(page);
    check('htmlpreview形式のURL（状態のクエリなし）で開くと いなべ・詳細が閉じた状態', st.site === 'いなべ' && !st.harvestDetail && !st.stockDetail, st);
    await page.click('#siteToggle button[data-site="群馬"]');
    await page.click('#harvestDetailSection > summary');
    await page.waitForTimeout(200);
    const q = await decodeSearch(page);
    check('切り替えると、表示するファイルのURLの後ろに状態のクエリが付く（前のURLは壊さない）', q === previewPrefix + '?site=群馬&harvestDetail=open', q);
    const loads = loadQueries.length;
    await page.reload();
    await settle(page);
    st = await viewState(page);
    check('htmlpreview形式のURLのままリロードしても、群馬・収穫予測の詳細が開いた状態で表示され、GASへの読み込みは送られない',
      st.site === '群馬' && st.harvestDetail && !st.stockDetail && loadQueries.length === loads, { st, loads: loadQueries.length - loads });
    await page.close();
  }

  console.log('=== ⑤範囲選択と集計の帯（スクロールした状態でも） ===');
  {
    const { page } = await setupPage(browser);
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, document.getElementById('table3').getBoundingClientRect().top + window.scrollY - 150));
    await page.waitForTimeout(100);
    const scrolled = await page.evaluate(() => window.scrollY);
    await dragCells(page, 'table3', 1, 3, 4, 5);
    let bar = await barState(page);
    let exp = expectedBar(await rectTexts(page, 'table3', 1, 3, 4, 5), 1);
    check('スクロールした状態でもドラッグで四角い範囲（4行×3列）が選べ、帯の集計が正しい', scrolled > 200 && bar.sel === 12 && sameBar(bar, exp), { scrolled, bar, exp });
    await clickCell(page, 'table3', 6, 6, ['Shift']);
    bar = await barState(page);
    exp = expectedBar(await rectTexts(page, 'table3', 1, 3, 6, 6), 1);
    check('スクロールした状態でもShift＋クリックで範囲を広げられる（合計の行の注意も出る）', bar.sel === 24 && sameBar(bar, exp) && bar.warnTotal, { bar, exp });
    await clickCell(page, 'table2detail', 0, 4, ['Control']);
    bar = await barState(page);
    check('スクロールした状態でもCtrl＋クリックで別の表（収穫予測の詳細）のセルを追加できる', bar.sel === 25, bar);
    // 固定したタイトル部分の上をクリックしても、その下の表のセルは選ばれない
    const hit = await page.evaluate(() => { const h = document.querySelector('header').getBoundingClientRect(); return [h.left + 300, h.bottom - 3]; });
    await page.mouse.click(hit[0], hit[1]);
    bar = await barState(page);
    check('固定したタイトル部分の上をクリックしても下の表のセルは選ばれない（表の外のクリックとして選択を解除）', bar.sel === 0 && !bar.shown, bar);
    await page.close();
  }
  {
    const { page } = await setupPage(browser, { mobile: true });
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, document.getElementById('table2').getBoundingClientRect().top + window.scrollY - 150));
    await page.waitForTimeout(100);
    const tap = async (t, r, c) => { const p = await center(page, t, r, c); await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(50); };
    await tap('table2', 0, 3);
    await tap('table2', 4, 5);
    const bar = await barState(page);
    const exp = expectedBar([await cellText(page, 'table2', 0, 3), await cellText(page, 'table2', 4, 5)], 1);
    check('スマートフォン：スクロールした状態でもタップで1セルずつ追加できる', bar.sel === 2 && sameBar(bar, exp), { bar, exp });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => ({ barTop: document.getElementById('aggBar').getBoundingClientRect().top, bottom: document.querySelector('.wrap > section:last-of-type').getBoundingClientRect().bottom }));
    check('スマートフォン：集計の帯は画面の一番下で、ページの一番下が帯に隠れない', m.bottom <= m.barTop + 0.5, m);
    await page.close();
  }

  console.log('=== ⑥基準日・実績日をURLのクエリに保ち、リロードしても同じ日付で開く ===');
  {
    const qp = async page => Object.fromEntries(new URLSearchParams(await page.evaluate(() => location.search)));
    const dates = page => page.evaluate(() => ({
      base: document.getElementById('refDateInput').value, actual: document.getElementById('harvestRefDateInput').value,
      baseMax: document.getElementById('refDateInput').max, actualMax: document.getElementById('harvestRefDateInput').max,
      firstCol: document.querySelector('#table1 thead tr.weekday th.dcol.today-col').textContent.trim(),
      nextDisabled: document.getElementById('nextDay').disabled, hNextDisabled: document.getElementById('harvestNextDay').disabled,
    }));
    const { page, loadQueries } = await setupPage(browser, { keepDetails: true });
    await settle(page);
    let d = await dates(page);
    check('既定：基準日＝今日（2026-11-15）・実績日＝前日（2026-11-14）で、クエリに日付は付かない', d.base === '2026-11-15' && d.actual === '2026-11-14' && !('base' in await qp(page)) && !('actual' in await qp(page)), d);
    // 基準日を入力欄で、実績日を ‹ ボタンで変える（拠点・詳細も一緒に）
    await page.click('#siteToggle button[data-site="群馬"]');
    await page.click('#harvestDetailSection > summary');
    await page.fill('#refDateInput', '2026-11-10');
    await page.press('#refDateInput', 'Enter');
    await page.dispatchEvent('#refDateInput', 'change');
    await page.click('#harvestPrevDay');
    await page.click('#harvestPrevDay');
    await page.waitForTimeout(200);
    let q = await qp(page);
    d = await dates(page);
    check('基準日（入力欄）・実績日（‹ボタン）を変えるとクエリに反映される（他方の日付は変わらない）',
      d.base === '2026-11-10' && d.actual === '2026-11-12' && q.base === '2026-11-10' && q.actual === '2026-11-12' && q.site === '群馬' && q.harvestDetail === 'open' && !('stockDetail' in q), { d, q });
    const hist = await page.evaluate(() => history.length);
    await page.click('#prevDay'); // 基準日 11/09
    await page.click('#nextDay'); // 11/10
    await page.click('#harvestNextDay'); // 実績日 11/13
    await page.click('#prevMonth'); // 基準日 10/10
    await page.click('#nextMonth'); // 11/10
    await page.click('#harvestPrevMonth'); // 実績日 10/13
    await page.waitForTimeout(200);
    q = await qp(page);
    check('«・‹・›・» のどれでもクエリが更新され、履歴は増えない', q.base === '2026-11-10' && q.actual === '2026-10-13' && (await page.evaluate(() => history.length)) === hist, { q });
    await page.click('#harvestNextMonth'); // 実績日 11/13
    await page.waitForTimeout(100);
    // リロード
    await page.reload();
    await settle(page);
    d = await dates(page);
    const st = await viewState(page);
    check('リロードすると基準日・実績日がそのまま（2026-11-10・2026-11-13）で、拠点・詳細の状態も一緒に保たれる',
      d.base === '2026-11-10' && d.actual === '2026-11-13' && d.firstCol.startsWith('11/10') && st.site === '群馬' && st.harvestDetail && !st.stockDetail, { d, st });
    check('今日でない日付のときは「翌日」ボタンが使え、選べる範囲（max＝今日）は変わらない', !d.nextDisabled && !d.hNextDisabled && d.baseMax === '2026-11-15' && d.actualMax === '2026-11-15', d);
    // 翌日に開き直す（今日を1日進める）：クエリの日付はそのまま
    await fixTodayTo(page, 2026, 10, 16);
    await page.reload();
    await settle(page);
    d = await dates(page);
    check('翌日に開き直しても、クエリの日付（2026-11-10・2026-11-13）のまま表示され、選べる範囲は新しい今日（2026-11-16）まで', d.base === '2026-11-10' && d.actual === '2026-11-13' && d.baseMax === '2026-11-16', d);
    // 「今日」「前日」ボタンで既定に戻り、クエリから日付が消える（新しい今日・前日）
    await page.click('#todayBtn');
    await page.waitForTimeout(100);
    q = await qp(page); d = await dates(page);
    check('「今日」ボタンで基準日が新しい今日（2026-11-16）に戻り、クエリから base が消える（実績日はそのまま）', d.base === '2026-11-16' && !('base' in q) && q.actual === '2026-11-13', { d, q });
    await page.click('#harvestTodayBtn');
    await page.waitForTimeout(100);
    q = await qp(page); d = await dates(page);
    check('「前日」ボタンで実績日が新しい前日（2026-11-15）に戻り、クエリから actual も消える（拠点・詳細は残る）', d.actual === '2026-11-15' && !('actual' in q) && q.site === '群馬' && q.harvestDetail === 'open', { d, q });
    // クエリに日付が無いまま翌日に開き直すと、新しい今日・前日
    await page.reload();
    await settle(page);
    d = await dates(page);
    check('クエリに日付が無ければ、翌日に開き直すと新しい今日・前日（2026-11-16・2026-11-15）で表示される', d.base === '2026-11-16' && d.actual === '2026-11-15', d);
    await page.close();
  }
  {
    // おかしな日付のクエリ：その日付だけ既定に戻る（他方・拠点・詳細は保たれる）
    const cases = [
      ['?base=2026-13-45&actual=abc', '2026-11-15', '2026-11-14'],
      ['?base=2026-11-20&actual=2099-01-01', '2026-11-15', '2026-11-14'], // 今日より先は選べない
      ['?base=2026-02-30&actual=2026-11-10', '2026-11-15', '2026-11-10'], // 実在しない日（base）だけ既定
      ['?base=2026-11-10&actual=1999-12-31', '2026-11-10', '2026-11-14'], // 古すぎる日（actual）だけ既定
      ['?base=&actual=2026-1-5', '2026-11-15', '2026-11-14'],
      ['?base=2026-11-10&actual=2026-11-08', '2026-11-10', '2026-11-08'], // 正しい値は両方使われる
    ];
    for (const [q, base, actual] of cases) {
      const { page } = await setupPage(browser, { keepDetails: true, skipDataWait: true, query: q + '&site=' + encodeURIComponent('南丹') + '&stockDetail=open' });
      await settle(page);
      const d = await page.evaluate(() => ({ base: document.getElementById('refDateInput').value, actual: document.getElementById('harvestRefDateInput').value }));
      const st = await viewState(page);
      check(`おかしな日付のクエリ（${q}）：基準日＝${base}・実績日＝${actual}（その日付だけ既定に戻り、拠点・詳細は保たれる）`,
        d.base === base && d.actual === actual && st.site === '南丹' && st.stockDetail, { d, st });
      await page.close();
    }
    const { page } = await setupPage(browser, { keepDetails: true });
    const pure = await page.evaluate(() => {
      const v = window.__test.validViewDate;
      return ['2026-11-15', '2026-11-16', '2000-01-01', '1999-12-31', '2026-02-29', '2024-02-29', 'x', '', null, '2026-11-1'].map(x => v(x, '2026-11-15'));
    });
    check('日付の検査：実在し、2000-01-01〜今日の日付だけを通す', JSON.stringify(pure) === JSON.stringify(['2026-11-15', null, '2000-01-01', null, null, '2024-02-29', null, null, null, null]), pure);
    await page.close();
  }
  {
    // htmlpreview形式のURLでも、日付が表示するファイルのURLの後ろに付く
    const prefix = '?https://github.com/rikeda-code/shiitake-iot/blob/feature/shipment-plan-cell-selection/dashboard/shiitake-shipment-plan.html';
    const { page } = await setupPage(browser, { keepDetails: true, skipDataWait: true, query: prefix });
    await settle(page);
    await page.fill('#harvestRefDateInput', '2026-11-05');
    await page.dispatchEvent('#harvestRefDateInput', 'change');
    await page.waitForTimeout(200);
    check('htmlpreview形式のURLでも、日付のクエリは表示するファイルのURLの後ろに付く', (await decodeSearch(page)) === prefix + '?actual=2026-11-05', await decodeSearch(page));
    await page.close();
  }

  await browser.close();
  console.log(`\n${ngCount === 0 ? 'すべてOK' : 'NGあり'} (OK ${okCount} / NG ${ngCount})`);
  console.log('DONE');
  process.exit(ngCount === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
