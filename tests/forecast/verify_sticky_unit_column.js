// 直近工数計画ダッシュボードの「見出しの固定を『氏名』の列の幅だけにし、上の段の表に
// 単位の列を設ける」変更の検証。固定(position:sticky)されるのは1列目(氏名の幅)だけで
// あること、2列目(単位。人別内訳では部門)は日付の列と一緒に横スクロールすること、
// 上の段の表の2列目に行ごとの単位(data-unitと同じ割り当て)が右寄せで表示されること、
// 見出しの行は「単位」・単位が無い行は空欄であること、1列目に収まらない見出し
// (「小計（出荷 標準工数合計）」等)が省略されず折り返すこと、上の段の表と人別内訳の表で
// 日付の列の位置がそろうこと、単位の列が選択できないこと、表を指で動かしても選択されない
// こと、狭い画面(375px)で上部固定(基準日・トグル)が横にずれないこと、
// 栽培・出荷×いなべ・群馬・南丹の全6画面・3段すべての表で同じ動きになることを確認する。
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
const CULT_GUNMA_GID_202610 = '2074687161';
const SHIP_GUNMA_GID_202610 = '1087258434';
const NANTAN_SHIFT_SHEET_ID = '1Wt3yN_a1QAfxcTItL54miPEv5Gldd4J6SjUTDX8Gvq8';
const NANTAN_SHIFT_SHEET_GID = '716401757';

function buildCultCsv(dates) {
  const header = ['', '', ''].concat(dates.map(d => `${d.getMonth() + 1}/${d.getDate()}`));
  const weekdayRow = ['', '', ''].concat(dates.map(d => WD[d.getDay()]));
  const row = ['1', '', '1'].concat(dates.map(() => ''));
  return toCsvText([header, weekdayRow, row]);
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
  rows.push(['合計'].concat(dates.map(() => '9999')));
  return toCsvText(rows);
}
function buildNantanShiftCsv(dates, people) {
  const row0 = [''].concat(dates.map(d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`));
  const row1 = [''].concat(dates.map(d => WD[d.getDay()]));
  const rows = [row0, row1];
  people.forEach(p => {
    const cells = dates.map(d => (p.cellsByIso && p.cellsByIso[isoKey(d)]) || '');
    rows.push([p.name].concat(cells));
  });
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
  let allOk = true;
  function check(name, cond) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}`); if (!cond) allOk = false; }

  const DATES = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 25)); // 10/19(基準日・月)〜10/25(日)の7日分

  async function setupCommon(page) {
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [
      staticHandler([[CULTIVATION_SHEETS['いなべ'].id, CULTIVATION_SHEETS['いなべ'].gid]], buildCultCsv(DATES)),
      staticHandler([[CULTIVATION_SHEETS['群馬'].id, CULTIVATION_SHEETS['群馬'].gid]], buildCultCsv(DATES)),
      staticHandler([[CULTIVATION_SHEETS['南丹'].id, CULTIVATION_SHEETS['南丹'].gid]], buildCultCsv(DATES)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], buildSalesUrlListCsv([
        { site: 'いなべ', kind: '受注', url: salesSheetUrl('sales_inabe', '9999') },
      ])),
      staticHandler([['sales_inabe', '9999']], buildSalesSheetCsv(DATES, [
        { kind: '個数', product: '秀L6 130g', valuesByDate: Object.fromEntries(DATES.map((d, i) => [isoKey(d), 100 + i])) },
      ])),
      staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], buildShiftSheetCsv(DATES, [
        { name: '栽培一郎', dept: '栽培', cellsByIso: Object.fromEntries(DATES.map(d => [isoKey(d), '8:00-17:00'])) },
        { name: '出荷二郎', dept: '出荷', cellsByIso: Object.fromEntries(DATES.map(d => [isoKey(d), '8:00-17:00'])) },
      ])),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv([
        { flag: '1', site: 'いなべ', dept: '栽培', name: '栽培一郎', hoursPerDay: 8, shiftName: '栽培一郎' },
        { flag: '1', site: 'いなべ', dept: '出荷', name: '出荷二郎', hoursPerDay: 8, shiftName: '出荷二郎' },
      ])),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, CULT_GUNMA_GID_202610]], buildGunmaShiftCsv('2026.10', [{ name: '群馬太郎', cellsByIso: Object.fromEntries(DATES.map(d => [isoKey(d), '8:00-17:00'])) }])),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], buildGunmaShiftCsv('2026.10', [{ name: '群馬花子', cellsByIso: Object.fromEntries(DATES.map(d => [isoKey(d), '8:00-17:00'])) }])),
      staticHandler([[NANTAN_SHIFT_SHEET_ID, NANTAN_SHIFT_SHEET_GID]], buildNantanShiftCsv(DATES, [{ name: '南丹次郎', cellsByIso: Object.fromEntries(DATES.map(d => [isoKey(d), '8:00-17:00'])) }])),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);
  }

  console.log('=== 共通の画面を用意する(栽培×いなべ、1920px幅) ===');
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await setupCommon(page);

  console.log('=== ①1280px幅で、すべての表で1列目だけが固定(position:sticky)され、2列目は固定されないこと ===');
  {
    const r = await page.evaluate(() => {
      function stickiness(sel) {
        const el = document.querySelector(sel);
        if (!el) return null;
        return getComputedStyle(el).position;
      }
      return {
        cultLabel: stickiness('#table1cultBody tr th.sticky-1'),
        cultUnit: stickiness('#table1cultBody tr th.unit-col'),
        cultHeadLabel: stickiness('#table1cult thead th.sticky-1'),
        cultHeadUnit: stickiness('#table1cult thead th.unit-col'),
        laborName: stickiness('#table3laborDetailBody tr th.sticky-1'),
        laborDept: stickiness('#table3laborDetailBody tr td.dept-col'),
      };
    });
    check('工程件数の行見出し(1列目)はposition:stickyで固定される', r.cultLabel === 'sticky');
    check('工程件数の単位(2列目)は固定されない(position:static)', r.cultUnit !== 'sticky');
    check('見出し行の1列目(工程)も固定される', r.cultHeadLabel === 'sticky');
    check('見出し行の2列目(単位ラベル)は固定されない', r.cultHeadUnit !== 'sticky');
    check('人別内訳の氏名(1列目)は固定される', r.laborName === 'sticky');
    check('人別内訳の部門(2列目)は固定されない', r.laborDept !== 'sticky');
  }

  console.log('=== ①(つづき)375px幅でも同じ(1列目だけ固定)であること ===');
  {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      cultLabel: getComputedStyle(document.querySelector('#table1cultBody tr th.sticky-1')).position,
      cultUnit: getComputedStyle(document.querySelector('#table1cultBody tr th.unit-col')).position,
    }));
    check('375px幅でも、工程件数の行見出し(1列目)は固定される', r.cultLabel === 'sticky');
    check('375px幅でも、単位(2列目)は固定されない', r.cultUnit !== 'sticky');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(300);
  }

  console.log('=== ②上の段の表の2列目に、行ごとの単位(data-unitと同じ割り当て)が表示される。見出しは「単位」、単位が無い行は空欄 ===');
  {
    const r = await page.evaluate(() => {
      function unitOf(dataAttr, value) {
        const cell = document.querySelector(`[${dataAttr}="${value}"]`);
        const tr = cell.closest('tr');
        return tr.querySelector('th.unit-col').textContent.trim();
      }
      const harvestCellUnit = document.querySelector('[data-work="収穫"][data-work-offset="0"]').getAttribute('data-unit');
      const harvestRowUnit = unitOf('data-work', '収穫');
      const contCellUnit = document.querySelector('[data-cult="稼働コンテナ数"][data-cult-offset="0"]').getAttribute('data-unit');
      const contRowUnit = unitOf('data-cult', '稼働コンテナ数');
      const packCellUnit = null; // 出荷パネル確認は別途下で行う
      const headUnit1 = document.querySelector('#table1cult thead tr:first-child th.unit-col').textContent.trim();
      const headUnit2 = document.querySelector('#table1cult thead tr.weekday th.unit-col').textContent.trim();
      const kindRowUnit = document.querySelectorAll('#table1cult thead tr.weekday')[1]
        ? document.querySelectorAll('#table1cult thead tr.weekday')[1].querySelector('th.unit-col')
        : null;
      return { harvestCellUnit, harvestRowUnit, contCellUnit, contRowUnit, headUnit1, headUnit2 };
    });
    check('標準工数「収穫」のdata-unit(h)と2列目の表示が一致する', r.harvestCellUnit === 'h' && r.harvestRowUnit === 'h');
    check('工程件数「稼働コンテナ数」のdata-unit(台)と2列目の表示が一致する', r.contCellUnit === '台' && r.contRowUnit === '台');
    check('見出し行(1行目)の2列目は「単位」', r.headUnit1 === '単位');
    check('見出し行(日付／曜日)の2列目は空欄', r.headUnit2 === '');

    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    const r2 = await page.evaluate(() => {
      function unitOf(dataAttr, value) {
        const cell = document.querySelector(`[${dataAttr}="${value}"]`);
        const tr = cell.closest('tr');
        return tr.querySelector('th.unit-col').textContent.trim();
      }
      const packUnit = unitOf('data-shipqty', 'パック数');
      const csUnit = unitOf('data-shipqty', 'cs数');
      const kgUnit = unitOf('data-shipqtykg', 'パック');
      // 実績・受注の印の行(見出し)の2列目は空欄であること
      const kindHeadUnit = document.querySelectorAll('#table1ship thead tr.weekday')[1].querySelector('th.unit-col').textContent.trim();
      return { packUnit, csUnit, kgUnit, kindHeadUnit };
    });
    check('出荷数量「パック数」の2列目は「個」', r2.packUnit === '個');
    check('出荷数量「cs数」の2列目は「cs」', r2.csUnit === 'cs');
    check('出荷数量 詳細「パック」(kg)の2列目は「kg」', r2.kgUnit === 'kg');
    check('実績・受注の印の行(見出し)の2列目は空欄', r2.kindHeadUnit === '');
    await page.click('[data-business="栽培"]');
    await page.waitForTimeout(800);
  }

  console.log('=== ③1列目に収まらない長い見出しが、省略されず折り返して表示される ===');
  {
    const r = await page.evaluate(() => {
      const subtotalTh = document.querySelector('[data-work-subtotal-offset="0"]').closest('tr').querySelector('th.sticky-1');
      const shortfallTh = document.querySelector('[data-shortfall-offset="0"]').closest('tr').querySelector('th.sticky-1');
      return {
        subtotalText: subtotalTh.textContent.trim(),
        subtotalWhiteSpace: getComputedStyle(subtotalTh).whiteSpace,
        shortfallText: shortfallTh.textContent.trim(),
        shortfallWhiteSpace: getComputedStyle(shortfallTh).whiteSpace,
      };
    });
    check('「小計（栽培 標準工数合計）」が省略されず全文表示される', r.subtotalText === '小計（栽培 標準工数合計）');
    check('見出しセルのwhite-spaceはnowrapではなく折り返し可能(normal)', r.subtotalWhiteSpace === 'normal');
    check('「過不足（標準労働時間－標準工数）」が省略されず全文表示される', r.shortfallText === '過不足（標準労働時間－標準工数）');
    check('過不足の見出しセルも折り返し可能(normal)', r.shortfallWhiteSpace === 'normal');
  }

  console.log('=== ④上の段の表と人別内訳の表で、日付の列(当日〜合計)の位置がそろっている ===');
  {
    const r = await page.evaluate(() => {
      const mainToday = document.querySelector('#table3labor thead th.today-col').getBoundingClientRect();
      const detailToday = document.querySelector('#table3laborDetail thead th.today-col').getBoundingClientRect();
      const mainTotal = document.querySelector('#table3labor thead th.total-col').getBoundingClientRect();
      const detailTotal = document.querySelector('#table3laborDetail thead th.total-col').getBoundingClientRect();
      return {
        todayDiff: Math.abs(mainToday.left - detailToday.left),
        totalDiff: Math.abs(mainTotal.left - detailTotal.left),
      };
    });
    check('「当日」列の左端が、標準労働時間の本体表と人別内訳表でそろっている', r.todayDiff < 1);
    check('「合計」列の左端も、本体表と人別内訳表でそろっている', r.totalDiff < 1);
  }

  console.log('=== ⑤単位のセルは選べない。表を指で動かしてもセルが選択されない ===');
  {
    const r = await page.evaluate(() => {
      const unitCell = document.querySelector('#table1cultBody tr th.unit-col');
      return {
        selectable: unitCell.classList.contains('selectable-cell'),
        hasSelCol: unitCell.hasAttribute('data-sel-col'),
      };
    });
    check('単位のセルはselectable-cellクラスを持たない', !r.selectable);
    check('単位のセルはdata-sel-colを持たない(選択対象の列位置を持たない)', !r.hasSelCol);

    await page.evaluate(() => window.__test.clearCellSelection());
    const touchPage = await browser.newPage({ viewport: { width: 1600, height: 1000 }, hasTouch: true });
    await setupCommon(touchPage);
    const box = await touchPage.locator('[data-cult="芽かき"][data-cult-offset="0"]').boundingBox();
    const startX = box.x + box.width / 2, startY = box.y + box.height / 2;
    await touchPage.touchscreen.tap(startX, startY); // まずタップで選択状態にする
    const afterTap = await touchPage.evaluate(() => window.__test.getCellSelection().length);
    // 同じ箇所から大きく動かす(スクロール相当)操作では、既存の選択を変えない
    // (タップ判定の移動量しきい値10px超のため、タッチ操作の選択トグルは発火しない)
    const dx = 40, dy = 0;
    const cdp = await touchPage.context().newCDPSession(touchPage);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + dx, y: startY + dy }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterDrag = await touchPage.evaluate(() => window.__test.getCellSelection().length);
    check('タップ直後は1セル選択される', afterTap === 1);
    check('指で大きく動かした(スクロール相当の)操作では選択状態が変わらない(タップ判定のしきい値10px超で無視される)', afterDrag === afterTap);
    await touchPage.close();
  }

  console.log('=== ⑥狭い画面(375px)で、表を横スクロールしても上部固定(基準日・トグル)が横にずれない ===');
  {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => document.querySelector('.sticky-head').getBoundingClientRect().left);
    await page.evaluate(() => {
      const scroller = document.querySelector('#table1cult').closest('.table-scroll');
      scroller.scrollLeft = 200;
    });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => document.querySelector('.sticky-head').getBoundingClientRect().left);
    const scrolled = await page.evaluate(() => document.querySelector('#table1cult').closest('.table-scroll').scrollLeft > 0);
    check('表自体は横スクロールできる(scrollLeftが動く)', scrolled);
    check('表を横スクロールしても、上部固定(.sticky-head)の左端位置は変わらない', before === after);
    await page.evaluate(() => { document.querySelector('#table1cult').closest('.table-scroll').scrollLeft = 0; });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(300);
  }

  console.log('=== ⑦栽培・出荷×いなべ・群馬・南丹の全6画面・3段の表(詳細・人別内訳含む)で、1列目だけ固定・2列目は固定されない ===');
  {
    for (const business of ['栽培', '出荷']) {
      await page.click(`[data-business="${business}"]`);
      await page.waitForTimeout(800);
      for (const site of ['いなべ', '群馬', '南丹']) {
        await page.click(`[data-site="${site}"]`);
        await page.waitForTimeout(1000);
        await page.evaluate(() => document.querySelectorAll('details.detail-rows').forEach(d => { d.open = true; }));
        const tableIds = business === '栽培'
          ? ['table1cult', 'table1cultDetail', 'table2work', 'table3labor', 'table3laborDetail']
          : ['table1ship', 'table1shipDetail', 'table2ship', 'table3ship', 'table3shipDetail'];
        const r = await page.evaluate((ids) => ids.map(id => {
          const t = document.getElementById(id);
          if (!t) return null;
          const firstRow = t.querySelector('tbody tr') || t.querySelector('thead tr');
          if (!firstRow) return null;
          const ths = firstRow.querySelectorAll('th, td.dept-col');
          const col1 = ths[0], col2 = ths[1];
          return {
            col1Sticky: col1 ? getComputedStyle(col1).position === 'sticky' : null,
            col2NotSticky: col2 ? getComputedStyle(col2).position !== 'sticky' : null,
          };
        }), tableIds);
        tableIds.forEach((id, i) => {
          if (r[i] === null) return; // table2workは小計のみ(しきい値確認は他表で十分)
          check(`${business}×${site}：${id} の1列目は固定、2列目は固定されない`, r[i].col1Sticky && r[i].col2NotSticky);
        });
      }
    }
    await page.click('[data-business="栽培"]');
    await page.click('[data-site="いなべ"]');
    await page.waitForTimeout(800);
  }

  await page.close();
  await browser.close();

  console.log('');
  console.log('=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
