// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）パネル1（在庫・出荷予定、table1）の
// 出荷予定について、「受注計画（W〜Z列）のM・L・2L・袋が4つとも空欄の日だけ、修正計画
// （S〜V列＝受注計画の4列左）の値に替え、秀・優は「－」にする」対応の検証。
// 実際のスプレッドシートには触れず、page.route()でCSV（/export?format=csv）を実際のシートの形
// （2行目=「修正計画」「受注計画」の見出し、4行目以降=日別。日付dの行は(d+3)行目、
// 群馬はいなべの+28列）に合わせてモックする（他ファイルへの依存なし）。
// 「今日」は2026-10-28に固定（当日=10/28〜8日後=11/5）。
// 確かめること（群馬。日別に5パターンを置く）：
//  - 10/28 受注計画4つとも入力あり → 受注計画の値、秀・優は群馬_受注から（6.0/4.0）
//  - 10/29 受注計画4つとも空欄・修正計画あり → 修正計画の値、秀・優は「－」
//  - 10/30 受注計画がMだけ入力 → 受注計画のまま（空欄のサイズは「－」）、秀・優は群馬_受注から
//  - 10/31 受注計画が4つとも0 → 0.0のまま（0は入力済み。修正計画に替えない）、秀・優は群馬_受注から
//  - 11/1  受注計画も修正計画も空欄 → すべて「－」、秀・優も「－」
//  いなべ：W〜Zが空欄でS〜Vに値がある日は修正計画（いなべの列位置）で表示される
// 実行：python3 -m http.server 8812 --directory dashboard を起動してから
//       node tests/shipment-plan/verify_shipment_plan_revised_plan_fallback.js
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

const SALES_SHEET_ID = '18zyC0JwVyaW3i18LQdvHQeDpEcfzM8iolhclgNocrnM';
const SALES_INDEX_GID = '538861653'; // 「シート判別」タブ
const SALES_RAW_SHEET_ID = '17DD5aRxc9bv8uZzEfnK_Q9IGOvQVH4ieJU1c-qu7dOc';
const GUNMA_ORDER_GID = '1218802781'; // 「群馬_受注」タブ
const OCT_MONTH_GID = '222222221';
const NOV_MONTH_GID = '222222222';
const PAGE_URL = 'http://localhost:8812/shiitake-shipment-plan.html';

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`); }

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
// 月シート。修正計画=S〜V列(18〜21)・受注計画=W〜Z列(22〜25)に、群馬は+28列。
// valuesByDay={ day: { revised: [M,L,2L,袋], order: [M,L,2L,袋] } }（無い側は空欄）
function buildMonthCsv(maxDay, valuesByDay, colOffset) {
  const width = 54;
  const rows = [];
  for (let i = 0; i <= maxDay + 3; i++) rows.push(new Array(width).fill(''));
  rows[1][18 + colOffset] = '修正計画';
  rows[1][22 + colOffset] = '受注計画';
  Object.keys(valuesByDay).forEach(dayStr => {
    const idx = (Number(dayStr) + 3) - 1;
    const v = valuesByDay[dayStr];
    (v.revised || []).forEach((x, i) => { rows[idx][18 + colOffset + i] = x; });
    (v.order || []).forEach((x, i) => { rows[idx][22 + colOffset + i] = x; });
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

const baseline = new Date(2026, 9, 28);

// 群馬：10/28〜11/1（月シートは10月・11月）
const GUNMA_OCT = {
  28: { revised: [1, 2, 3, 4], order: [15, 25, 8, 5] },
  29: { revised: [11, 22, 33, 44] },
  30: { revised: [7, 8, 9, 10], order: [12, '', '', ''] },
  31: { revised: [7, 8, 9, 10], order: [0, 0, 0, 0] },
};
const GUNMA_NOV = {}; // 11/1は両方空欄
// いなべ：10/29がW〜Z空欄・S〜V入力
const INABE_OCT = {
  28: { revised: [1, 2, 3, 4], order: [15, 25, 8, 5] },
  29: { revised: [11, 22, 33, 44] },
};

async function setupPage(browser, query, octValues, novValues, colOffset) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await fixTodayTo(page, 2026, 9, 28);
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    let body = '﻿\r\n';
    if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_INDEX_GID)) body = buildSalesIndexCsv(baseline);
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + OCT_MONTH_GID)) body = buildMonthCsv(31, octValues, colOffset);
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + NOV_MONTH_GID)) body = buildMonthCsv(30, novValues, colOffset);
    else if (url.includes(SALES_RAW_SHEET_ID) && url.includes('gid=' + GUNMA_ORDER_GID)) {
      const dates = []; for (let i = 0; i <= 8; i++) dates.push(addDays(baseline, i));
      body = buildGunmaRawOrderCsv(dates, 6, 4);
    }
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
  });
  await page.goto(PAGE_URL + query);
  await page.waitForSelector('#table1');
  return page;
}

async function shipment(page, size, offset) {
  return page.evaluate(([s, o]) => {
    const el = document.querySelector('[data-shipment="' + s + '"][data-shipment-offset="' + o + '"]');
    return el ? el.textContent.trim() : null;
  }, [size, offset]);
}
async function waitShipment(page) {
  // 当日（10/28）のMが「－」以外になるまで待つ（描画完了の目印）
  for (let i = 0; i < 40; i++) {
    const v = await shipment(page, 'M', 0);
    if (v && v !== '－' && v !== '−') { await page.waitForTimeout(400); return; }
    await page.waitForTimeout(150);
  }
}
const DASH = /^[－−-]$/;
function isDash(v) { return v !== null && DASH.test(v); }

(async () => {
  const browser = await chromium.launch();

  console.log('=== ①群馬：受注計画が4つとも空欄の日だけ修正計画に替わる ===');
  {
    const page = await setupPage(browser, '?site=' + encodeURIComponent('群馬'), GUNMA_OCT, GUNMA_NOV, 28);
    await waitShipment(page);
    const row = async (offset) => [await shipment(page, 'M', offset), await shipment(page, 'L', offset), await shipment(page, '2L', offset), await shipment(page, '袋', offset), await shipment(page, '秀', offset), await shipment(page, '優', offset)];

    const d28 = await row(0);
    check('10/28 受注計画の値（15.0/25.0/8.0/5.0）、秀・優は6.0/4.0', JSON.stringify(d28) === JSON.stringify(['15.0', '25.0', '8.0', '5.0', '6.0', '4.0']), d28);

    const d29 = await row(1);
    check('10/29 修正計画の値（11.0/22.0/33.0/44.0）', JSON.stringify(d29.slice(0, 4)) === JSON.stringify(['11.0', '22.0', '33.0', '44.0']), d29);
    check('10/29 修正計画のとき、秀・優は「－」', isDash(d29[4]) && isDash(d29[5]), d29);

    const d30 = await row(2);
    check('10/30 受注計画がMだけ入力→Mは12.0、L・2L・袋は「－」（修正計画に替えない）', d30[0] === '12.0' && isDash(d30[1]) && isDash(d30[2]) && isDash(d30[3]), d30);
    check('10/30 受注計画のままなので秀・優は6.0/4.0', d30[4] === '6.0' && d30[5] === '4.0', d30);

    const d31 = await row(3);
    check('10/31 受注計画が4つとも0→0.0のまま（修正計画に替えない）', JSON.stringify(d31.slice(0, 4)) === JSON.stringify(['0.0', '0.0', '0.0', '0.0']), d31);
    check('10/31 受注計画のままなので秀・優は6.0/4.0', d31[4] === '6.0' && d31[5] === '4.0', d31);

    const d101 = await row(4);
    check('11/1 受注計画も修正計画も空欄→すべて「－」（秀・優も「－」で値は出ない）', d101.slice(0, 4).every(isDash) && isDash(d101[4]) && isDash(d101[5]), d101);
    await page.close();
  }

  console.log('=== ②いなべ：W〜Zが空欄でS〜Vに値がある日は修正計画（いなべの列位置）で表示される ===');
  {
    const page = await setupPage(browser, '', INABE_OCT, {}, 0);
    await waitShipment(page);
    const d28 = [await shipment(page, 'M', 0), await shipment(page, 'L', 0), await shipment(page, '2L', 0), await shipment(page, '袋', 0)];
    const d29 = [await shipment(page, 'M', 1), await shipment(page, 'L', 1), await shipment(page, '2L', 1), await shipment(page, '袋', 1)];
    check('いなべ 10/28 受注計画の値', JSON.stringify(d28) === JSON.stringify(['15.0', '25.0', '8.0', '5.0']), d28);
    check('いなべ 10/29 修正計画の値', JSON.stringify(d29) === JSON.stringify(['11.0', '22.0', '33.0', '44.0']), d29);
    const syu29 = await shipment(page, '秀', 1);
    const yuu29 = await shipment(page, '優', 1);
    check('いなべ 10/29 修正計画のとき、秀・優は「－」', isDash(syu29) && isDash(yuu29), [syu29, yuu29]);
    await page.close();
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(ng === 0 ? 'すべてOK' : `NGあり（${ng}件）`);
  console.log('DONE');
  process.exit(ng === 0 ? 0 : 1);
})();
