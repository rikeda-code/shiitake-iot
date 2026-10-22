// 直近工数計画ダッシュボードで、表の最後の行が「合計の行」の位置にあるというだけで
// 合計行と同じ太字・背景色の見た目になってしまう不具合（原因：CSSがtbody tr:last-child
// というテーブル内の位置だけで合計行の見た目を決めていたため）の修正を確認する。
// 修正後は、class="agg-row"を付けた本物の合計・小計行だけが太字・背景色になり、
// 人別内訳の最後の人の行や、栽培の工程詳細の最後の行（コンテナ点検）のような、
// たまたま最後にあるだけの普通のデータ行は、ほかの行と同じ見た目になることを確認する。
const { chromium } = require('playwright');
const WD = ['日', '月', '火', '水', '木', '金', '土'];

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
function dateRange(start, end) {
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}
function isoKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

const CULTIVATION_SHEETS = {
  'いなべ': { id: '1X8RMzKwg_DoVMogqCRh78bcqecVgHzvRWc5FeKc1TPM', gid: '1452537379' },
  '群馬':   { id: '12Xa_bkHE5tw9-YgGPIONzAj9ex3jr0Au-3B1k6DSZDY', gid: '1776859904' },
  '南丹':   { id: '1WBnGT3tkVfGhDJ7OZ2mZE4Juvd-t7le68bUlVRHGIeM', gid: '2146042804' },
};
const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STD_WORK_HOURS_GID = '264266810';
const SALES_URL_SHEET_GID = '1130067935';
const SHIFT_SHEET_ID = '12xrXyXUSbiQVUWsAC7mbrExyWrIw863Oleq_1v81vRw';
const SHIFT_SHEET_GID = '872290181';
const STD_LABOR_HOURS_SHEET = { id: '1LtYb1feXR6jtIEfxaADLiTEWpPabKJDDlwoS1V-yuG0', gid: '1404355975' };
const GUNMA_SHIFT_SHEET_ID = '1eqN5kfymPPvOOi9UbTg7ZxLn04YE7YnjrJw-jADySUM';
const CULT_GUNMA_GID = '2074687161';
const SHIP_GUNMA_GID = '1087258434';
const NANTAN_SHIFT_SHEET_ID = '1Wt3yN_a1QAfxcTItL54miPEv5Gldd4J6SjUTDX8Gvq8';
const CULT_NANTAN_GID = '716401757';
const SHIP_NANTAN_GID = '1439827078';

// 栽培管理シート：工程詳細5種(芽待ち／成長待ち・芽発生・培養・コンテナ掃除・コンテナ点検)を
// それぞれ別コンテナに割り当てる(verify_regression_consolidated.jsの⑦と同じ考え方)。
// 「コンテナ点検」が、DETAIL_PROCESSESの並び順で最後の行になる
function buildCultDetailCsv(dates) {
  const header = ['', '', ''].concat(dates.map(d => `${d.getMonth() + 1}/${d.getDate()}`));
  const weekdayRow = ['', '', ''].concat(dates.map(d => WD[d.getDay()]));
  const waitingRow = ['1', '', '1'].concat(dates.map(() => '芽待ち'));
  const sproutRow = ['1', '', '2'].concat(dates.map(() => '芽発生'));
  const cultureRow = ['1', '', '3'].concat(dates.map(() => '培養'));
  const cleaningRow = ['1', '', '4'].concat(dates.map(() => 'コンテナ掃除'));
  const inspectionRow = ['1', '', '5'].concat(dates.map(() => 'コンテナ点検'));
  return toCsvText([header, weekdayRow, waitingRow, sproutRow, cultureRow, cleaningRow, inspectionRow]);
}
function buildStdWorkHoursCsv() {
  const rows = [];
  rows.push(['', '', '', '', '', '', '', '']);
  rows.push(['cs数=(合計点数-バラ数)÷P/cs+バラ数', '', '', '', '', '', '', '']);
  rows.push(['パック・袋P/cs', '', '', '', '', '', '', '']);
  rows.push(['30', '', '', '', '', '', '', '']);
  rows.push(['栽培', '収穫', 50, '', '', '', '', 'kg/h']);
  rows.push(['', 'コンテナ点検時間', 2, '', '', '', '', 'h']);
  rows.push(['出荷', 'パック並べる', 30, '', '', '', '', '秒']);
  rows.push(['', '付帯作業', '', '', '', '', '', '']);
  return toCsvText(rows);
}
function buildShiftSheetCsv(dates, people) {
  const header = ['', ''].concat(dates.map(d => `${d.getMonth() + 1}/${d.getDate()}`));
  const weekdayRow = ['', ''].concat(dates.map(d => WD[d.getDay()]));
  const rows = [header, weekdayRow];
  for (let i = 0; i < 11; i++) rows.push(['', ''].concat(dates.map(() => '')));
  people.forEach(p => {
    const cells = dates.map(d => { const v = p.cellsByIso ? p.cellsByIso[isoKey(d)] : undefined; return v === undefined ? '' : v; });
    rows.push([p.name, p.dept].concat(cells));
  });
  return toCsvText(rows);
}
function buildStdLaborCsv(entries) {
  const COLS = 16;
  const blank = () => new Array(COLS).fill('');
  const rows = [blank(), blank()];
  const header = blank(); header[15] = 'シフト表名'; rows.push(header);
  entries.forEach(e => {
    const row = blank();
    row[1] = e.flag; row[3] = e.site; row[5] = e.dept; row[7] = e.name;
    row[9] = e.hoursPerDay != null ? String(e.hoursPerDay) : '';
    row[15] = e.shiftName || '';
    rows.push(row);
  });
  return toCsvText(rows);
}
function dayNumbersForPeriod() { const out = []; for (let d = 11; d <= 31; d++) out.push(d); for (let d = 1; d <= 10; d++) out.push(d); return out; }
function datesForPeriod(periodKey) {
  const parts = periodKey.split('.').map(Number);
  let year = parts[0], month = parts[1];
  const dayNumbers = dayNumbersForPeriod();
  const dates = []; let prevDay = null;
  dayNumbers.forEach(n => { if (prevDay !== null && n < prevDay) { month++; if (month > 12) { month = 1; year++; } } prevDay = n; dates.push(new Date(year, month - 1, n)); });
  return dates;
}
function buildGunmaShiftCsv(periodKey, people) {
  const dayNumbers = dayNumbersForPeriod();
  const dates = datesForPeriod(periodKey);
  const rows = [];
  rows.push(['勤務表', '', '']);
  rows.push(['', '', '']);
  rows.push([''].concat(dayNumbers));
  rows.push(['']. concat(dates.map(d => WD[d.getDay()])));
  people.forEach(p => {
    const cells = dates.map(d => { const v = p.cellsByIso ? p.cellsByIso[isoKey(d)] : undefined; return v === undefined ? '' : v; });
    rows.push([p.name].concat(cells));
  });
  rows.push(['パート合計'].concat(dates.map(() => '9999'))); // 「パート合計」以降は人として読まれない(parseGunmaShiftSheet)
  return toCsvText(rows);
}
// 南丹の勤務表(datedHoursSheet)相当のCSV。栽培(勤務表)・出荷(勤務用_出荷)とも同じ形式
function buildNantanDatedHoursCsv(dates, people) {
  const header = ['名前'].concat(dates.map(d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`));
  const weekdayRow = ['曜日'].concat(dates.map(d => WD[d.getDay()]));
  const rows = [header, weekdayRow];
  people.forEach(p => rows.push([p.name].concat(dates.map(d => { const v = p.cellsByIso ? p.cellsByIso[isoKey(d)] : undefined; return v === undefined ? '' : v; }))));
  return toCsvText(rows);
}
function salesSheetUrl(id, gid) { return `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${gid}`; }
function buildSalesUrlListCsv(entries) {
  const rows = [['拠点', '区分', 'URL']];
  entries.forEach(e => rows.push([e.site, e.kind, e.url]));
  return toCsvText(rows);
}
function buildSalesSheetCsv(dates, productRows) {
  const header = ['拠点', '個数/重量(kg)', '区分', '商品', '', ''].concat(
    dates.map(d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`));
  const rows = [header];
  productRows.forEach(pr => {
    const cells = dates.map(d => { const v = pr.valuesByDate[isoKey(d)]; return v === undefined ? '' : v; });
    rows.push(['いなべ', pr.kind, '出荷', pr.product, '', ''].concat(cells));
  });
  return toCsvText(rows);
}

async function setupRoutes(page, handlers) {
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    for (const h of handlers) { if (h.match(url)) { await h.handle(route); return; } }
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' });
  });
}
function staticHandler(idGidPairs, body) {
  return {
    match: (url) => idGidPairs.some(([id, gid]) => url.includes(id) && (gid === null || url.includes(`gid=${gid}`))),
    handle: async (route) => { await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body }); },
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  const origNewPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => { const p = await origNewPage(...args); await p.route('https://script.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', values: {} }) })); return p; };
  let allOk = true;
  function check(name, cond) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}`); if (!cond) allOk = false; }

  const DATES = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 25)); // 10/19(基準日・月)〜10/25(日)の7日分
  const timeCells = Object.fromEntries(DATES.map(d => [isoKey(d), '8:00-17:00']));
  const hourCells = Object.fromEntries(DATES.map(d => [isoKey(d), '8H']));

  // 合計行かどうかを、該当セルを含む<tr>の「合計列でも基準日の列でもないtd」1個の
  // font-weight・background-colorで判定する(th側は行見出しとして常にfont-weight:700の
  // ため、tdで見ないと合計行かどうかを区別できない。基準日の列(today-col)は
  // .cult/.work/.labor td.today-colの!important指定で別の背景色になるため、
  // 合計行かどうかの判定には使えない。合計行ならfont-weight:700・background:
  // rgb(243, 234, 212)、普通の行ならfont-weight:400・背景なし(transparent)になるはず
  async function tdStyleOf(page, selector) {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const tr = el.closest('tr');
      const td = tr.querySelector('td:not(.total-col):not(.today-col)') || tr.querySelector('td:not(.total-col)') || tr.querySelector('td');
      if (!td) return null;
      const cs = getComputedStyle(td);
      return { fontWeight: cs.fontWeight, background: cs.backgroundColor };
    }, selector);
  }
  function isAggLook(style) { return !!style && style.fontWeight === '700' && style.background === 'rgb(243, 234, 212)'; }
  function isPlainLook(style) { return !!style && style.fontWeight !== '700' && style.background !== 'rgb(243, 234, 212)'; }

  console.log('=== 共通の画面を用意する(栽培×いなべ、1920px幅) ===');
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await fixTodayTo(page, 2026, 9, 19);
  await setupRoutes(page, [
    staticHandler([[CULTIVATION_SHEETS['いなべ'].id, CULTIVATION_SHEETS['いなべ'].gid]], buildCultDetailCsv(DATES)),
    staticHandler([[CULTIVATION_SHEETS['群馬'].id, CULTIVATION_SHEETS['群馬'].gid]], buildCultDetailCsv(DATES)),
    staticHandler([[CULTIVATION_SHEETS['南丹'].id, CULTIVATION_SHEETS['南丹'].gid]], buildCultDetailCsv(DATES)),
    staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], buildSalesUrlListCsv([
      { site: 'いなべ', kind: '受注', url: salesSheetUrl('sales_inabe', '9999') },
    ])),
    staticHandler([['sales_inabe', '9999']], buildSalesSheetCsv(DATES, [
      { kind: '個数', product: '秀L6 130g', valuesByDate: Object.fromEntries(DATES.map((d, i) => [isoKey(d), 100 + i])) },
      { kind: '個数', product: '秀バラパック 3kg', valuesByDate: Object.fromEntries(DATES.map((d, i) => [isoKey(d), 20 + i])) },
    ])),
    staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], buildShiftSheetCsv(DATES, [
      { name: '栽培一郎', dept: '栽培', cellsByIso: timeCells },
      { name: '栽培三郎', dept: '栽培', cellsByIso: timeCells },
      { name: '出荷二郎', dept: '出荷', cellsByIso: timeCells },
      { name: '出荷四郎', dept: '出荷', cellsByIso: timeCells },
    ])),
    staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv([
      { flag: '1', site: 'いなべ', dept: '栽培', name: '栽培一郎', hoursPerDay: 8, shiftName: '栽培一郎' },
      { flag: '1', site: 'いなべ', dept: '栽培', name: '栽培三郎', hoursPerDay: 8, shiftName: '栽培三郎' },
      { flag: '1', site: 'いなべ', dept: '出荷', name: '出荷二郎', hoursPerDay: 8, shiftName: '出荷二郎' },
      { flag: '1', site: 'いなべ', dept: '出荷', name: '出荷四郎', hoursPerDay: 8, shiftName: '出荷四郎' },
    ])),
    staticHandler([[GUNMA_SHIFT_SHEET_ID, CULT_GUNMA_GID]], buildGunmaShiftCsv('2026.10', [
      { name: '群馬太郎', cellsByIso: timeCells },
      { name: '群馬次郎', cellsByIso: timeCells },
    ])),
    staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID]], buildGunmaShiftCsv('2026.10', [
      { name: '群馬花子', cellsByIso: timeCells },
      { name: '群馬梅子', cellsByIso: timeCells },
    ])),
    staticHandler([[NANTAN_SHIFT_SHEET_ID, CULT_NANTAN_GID]], buildNantanDatedHoursCsv(DATES, [
      { name: '南丹次郎', cellsByIso: hourCells },
      { name: '南丹五郎', cellsByIso: hourCells },
    ])),
    staticHandler([[NANTAN_SHIFT_SHEET_ID, SHIP_NANTAN_GID]], buildNantanDatedHoursCsv(DATES, [
      { name: '南丹六郎', cellsByIso: hourCells },
      { name: '南丹七郎', cellsByIso: hourCells },
    ])),
  ]);
  await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.querySelectorAll('details').forEach(d => { d.open = true; }); });
  await page.waitForTimeout(200);

  console.log('=== ①栽培×いなべ：工程件数・稼働コンテナ数(本体の最後の行)は本物の合計行のため、太字・背景色のままであること ===');
  {
    const style = await tdStyleOf(page, '[data-cult="稼働コンテナ数"][data-cult-offset="0"]');
    check('稼働コンテナ数の行は合計行の見た目(font-weight:700・背景色)のまま', isAggLook(style));
  }

  console.log('=== ②栽培×いなべ：工程件数の詳細で、最後の行(コンテナ点検)は合計行ではないため、合計行の見た目にならないこと ===');
  {
    const inspection = await tdStyleOf(page, '[data-cult="コンテナ点検"][data-cult-offset="0"]');
    const cleaning = await tdStyleOf(page, '[data-cult="コンテナ掃除"][data-cult-offset="0"]');
    const waiting = await tdStyleOf(page, '[data-cult="芽待ち／成長待ち"][data-cult-offset="0"]');
    check('最後の行「コンテナ点検」は合計行の見た目にならない(普通の行と同じ)', isPlainLook(inspection));
    check('「コンテナ点検」は、同じ詳細表のほかの行(コンテナ掃除)と同じ見た目になる', inspection && cleaning && inspection.fontWeight === cleaning.fontWeight && inspection.background === cleaning.background);
    check('「コンテナ点検」は、同じ詳細表のほかの行(芽待ち／成長待ち)と同じ見た目になる', inspection && waiting && inspection.fontWeight === waiting.fontWeight && inspection.background === waiting.background);
  }

  console.log('=== ③栽培×いなべ：標準工数の小計(本体の最後の行)は本物の合計行のため、太字・背景色のままであること ===');
  {
    const style = await tdStyleOf(page, '[data-work-subtotal-offset="0"]');
    check('標準工数「小計（栽培 標準工数合計）」の行は合計行の見た目のまま', isAggLook(style));
  }

  console.log('=== ④栽培×いなべ：標準労働時間の過不足(本体の最後の行)は本物の合計行のため、太字・背景色のままであること ===');
  {
    const style = await tdStyleOf(page, '[data-shortfall-offset="0"]');
    check('標準労働時間「過不足」の行は合計行の見た目のまま', isAggLook(style));
  }

  console.log('=== ⑤栽培×いなべ：人別内訳(table3laborDetail)の最後の人の行が、合計行の見た目にならないこと ===');
  {
    const r = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('#table3laborDetailBody tr'));
      function styleOf(tr) {
        const td = tr.querySelector('td[data-sel-col="1"]');
        const cs = getComputedStyle(td);
        return { name: tr.querySelector('th').textContent.trim(), fontWeight: cs.fontWeight, background: cs.backgroundColor };
      }
      return trs.map(styleOf);
    });
    check('人別内訳に2人分の行が表示されている', r.length === 2);
    const first = r[0], last = r[r.length - 1];
    check('最後の人(2人目)の行は合計行の見た目にならない', isPlainLook(last));
    check('最後の人の行は、最初の人の行と同じ見た目(どちらも普通の行)になる', first && last && first.fontWeight === last.fontWeight && first.background === last.background);
  }

  console.log('=== ⑥出荷×いなべ：切り替えて、出荷数量の合計点数・cs数・標準工数の小計・標準労働時間の過不足・人別内訳の最後の人の行を確認 ===');
  {
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1200);
    const totalPieces = await tdStyleOf(page, '[data-shipqty="合計点数"][data-shipqty-offset="0"]');
    const cs = await tdStyleOf(page, '[data-shipqty="cs数"][data-shipqty-offset="0"]');
    check('出荷数量「合計点数」は合計行の見た目のまま', isAggLook(totalPieces));
    check('出荷数量「cs数」(本体の最後の行)は合計行の見た目のまま', isAggLook(cs));
    const kgTotal = await tdStyleOf(page, '[data-shipqtykg="合計"][data-shipqtykg-offset="0"]');
    const kgPack = await tdStyleOf(page, '[data-shipqtykg="パック"][data-shipqtykg-offset="0"]');
    check('出荷数量 詳細「合計」(kg、詳細表の最後の行)は合計行の見た目のまま', isAggLook(kgTotal));
    check('出荷数量 詳細「パック」(合計行ではない)は合計行の見た目にならない', isPlainLook(kgPack));
    const shipSubtotal = await tdStyleOf(page, '[data-shipwork-subtotal-offset="0"]');
    check('標準工数「小計（出荷 標準工数合計）」の行は合計行の見た目のまま', isAggLook(shipSubtotal));
    const shipShortfall = await tdStyleOf(page, '[data-shipshortfall-offset="0"]');
    check('標準労働時間「過不足」の行は合計行の見た目のまま', isAggLook(shipShortfall));
    const r = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('#table3shipDetailBody tr'));
      function styleOf(tr) {
        const td = tr.querySelector('td[data-sel-col="1"]');
        const cs2 = getComputedStyle(td);
        return { fontWeight: cs2.fontWeight, background: cs2.backgroundColor };
      }
      return trs.map(styleOf);
    });
    check('出荷×いなべの人別内訳に2人分の行が表示されている', r.length === 2);
    check('出荷×いなべ：最後の人の行は合計行の見た目にならない', isPlainLook(r[r.length - 1]));
    check('出荷×いなべ：最後の人の行は、最初の人の行と同じ見た目になる', r[0] && r[1] && r[0].fontWeight === r[1].fontWeight && r[0].background === r[1].background);
  }

  console.log('=== ⑦栽培・出荷×群馬：人別内訳の最後の人の行が、合計行の見た目にならないこと ===');
  {
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(1200);
    const shipR = await page.evaluate(() => Array.from(document.querySelectorAll('#table3shipDetailBody tr')).map(tr => {
      const td = tr.querySelector('td[data-sel-col="1"]');
      const cs = getComputedStyle(td);
      return { fontWeight: cs.fontWeight, background: cs.backgroundColor };
    }));
    check('出荷×群馬の人別内訳に2人分の行が表示されている', shipR.length === 2);
    check('出荷×群馬：最後の人の行は合計行の見た目にならない', isPlainLook(shipR[shipR.length - 1]));

    await page.click('[data-business="栽培"]');
    await page.waitForTimeout(1200);
    const cultR = await page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => {
      const td = tr.querySelector('td[data-sel-col="1"]');
      const cs = getComputedStyle(td);
      return { fontWeight: cs.fontWeight, background: cs.backgroundColor };
    }));
    check('栽培×群馬の人別内訳に2人分の行が表示されている', cultR.length === 2);
    check('栽培×群馬：最後の人の行は合計行の見た目にならない', isPlainLook(cultR[cultR.length - 1]));
  }

  console.log('=== ⑧栽培・出荷×南丹：人別内訳の最後の人の行が、合計行の見た目にならないこと ===');
  {
    await page.click('[data-site="南丹"]');
    await page.waitForTimeout(1200);
    const cultR = await page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => {
      const td = tr.querySelector('td[data-sel-col="1"]');
      const cs = getComputedStyle(td);
      return { fontWeight: cs.fontWeight, background: cs.backgroundColor };
    }));
    check('栽培×南丹の人別内訳に2人分の行が表示されている', cultR.length === 2);
    check('栽培×南丹：最後の人の行は合計行の見た目にならない', isPlainLook(cultR[cultR.length - 1]));

    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1200);
    const shipR = await page.evaluate(() => Array.from(document.querySelectorAll('#table3shipDetailBody tr')).map(tr => {
      const td = tr.querySelector('td[data-sel-col="1"]');
      const cs = getComputedStyle(td);
      return { fontWeight: cs.fontWeight, background: cs.backgroundColor };
    }));
    check('出荷×南丹の人別内訳に2人分の行が表示されている', shipR.length === 2);
    check('出荷×南丹：最後の人の行は合計行の見た目にならない', isPlainLook(shipR[shipR.length - 1]));
  }

  await page.close();

  console.log('\n=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');

  await browser.close();
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
