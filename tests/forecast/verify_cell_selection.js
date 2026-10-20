// 直近工数計画ダッシュボードの「セルを範囲選択して集計を表示する」機能の検証。
// Googleスプレッドシートのような範囲選択(ドラッグ・Shift+クリック・Ctrl(⌘)+クリック/
// ドラッグでの複数表にまたがる追加選択)・タップでのトグル選択(スマートフォン)・
// 画面下の集計帯(合計・平均・個数・最小・最大、単位混在/合計列二重計上の注意表示)・
// 選択可能セルの判定(「－」等は選べるが集計に入らない。見出し行・列や実績/受注印の行は
// 選べない)・基準日/拠点/区分の切替での選択解除(描画の世代チェックとの整合)・
// 栽培 標準工数 小計の合計列への「*」伝播、栽培・出荷×いなべ・群馬・南丹の全6画面での
// 選択可能性を確認する。
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
const GUNMA_TRANSFER_ID = '1iZK3xgGkPhXTlnx_DGunW8YQ8bZZFE-r_5Si513r46Y';
const GUNMA_TRANSFER_GID = '1272257227';
const SHIFT_SHEET_ID = '12xrXyXUSbiQVUWsAC7mbrExyWrIw863Oleq_1v81vRw';
const SHIFT_SHEET_GID = '872290181';
const STD_LABOR_HOURS_SHEET = { id: '1LtYb1feXR6jtIEfxaADLiTEWpPabKJDDlwoS1V-yuG0', gid: '1404355975' };
const GUNMA_SHIFT_SHEET_ID = '1eqN5kfymPPvOOi9UbTg7ZxLn04YE7YnjrJw-jADySUM';
const CULT_GUNMA_GID_202610 = '2074687161';
const SHIP_GUNMA_GID_202610 = '1087258434';
const NANTAN_SHIFT_SHEET_ID = '1Wt3yN_a1QAfxcTItL54miPEv5Gldd4J6SjUTDX8Gvq8';
const NANTAN_SHIFT_SHEET_GID = '716401757';

// 日ごとに芽かきを行うコンテナ数が変わる(day0=3台,day1=2台,day2以降=1台)栽培管理シート。
// 稼働コンテナ数・芽かきの合計列がドラッグ選択の集計テストで異なる値を持つようにするため
function buildVariedCultCsv(dates) {
  const header = ['', '', ''].concat(dates.map(d => `${d.getMonth() + 1}/${d.getDate()}`));
  const weekdayRow = ['', '', ''].concat(dates.map(d => WD[d.getDay()]));
  const rows = [header, weekdayRow];
  rows.push(['1', '', '1'].concat(dates.map(() => '芽かき')));
  rows.push(['1', '', '2'].concat(dates.map((d, i) => (i <= 1 ? '芽かき' : ''))));
  rows.push(['1', '', '3'].concat(dates.map((d, i) => (i === 0 ? '芽かき' : ''))));
  return toCsvText(rows);
}
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
  const cultFactors = { '菌床入れ': { factor: 10, unit: '分' }, '収穫': { factor: 50, unit: 'kg/h' }, 'コンテナ点検時間': { factor: 2, unit: 'h' } };
  Object.keys(cultFactors).forEach((waku, i) => {
    const f = cultFactors[waku];
    rows.push([i === 0 ? '栽培' : '', waku, f.factor, '', '', '', '', f.unit]);
  });
  const shipFactors = { 'パック並べる': { factor: 30, unit: '秒' }, '付帯作業': { factor: '', unit: '' } };
  Object.keys(shipFactors).forEach((waku, i) => {
    const f = shipFactors[waku];
    rows.push([i === 0 ? '出荷' : '', waku, f.factor, '', '', '', '', f.unit]);
  });
  return toCsvText(rows);
}
function buildGunmaTransferCsv(dayValues) {
  const header = ['', '見込み1', '2026.10'];
  const rows = [header];
  for (let d = 1; d <= 31; d++) rows.push(['', '', dayValues[d] === undefined ? '' : dayValues[d]]);
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
// 南丹の勤務表(FORECAST_SHIFT_SOURCES['南丹']、datedHoursSheet形式)相当のCSV。
// 1行目=日付(YYYY/M/D、年あり)、2行目=曜日、3行目以降=人(A列=名前、B列以降=時刻等)
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

async function center(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error('要素が見つからない: ' + selector);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let allOk = true;
  function check(name, cond) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}`); if (!cond) allOk = false; }

  const DATES = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 25)); // 10/19(基準日・月)〜10/25(日)の7日分

  console.log('=== 共通の画面を用意する(栽培×いなべ。芽かきの台数を日ごとに変え、収穫kgは未入力のままにしてharvestMissingを発生させる) ===');
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await fixTodayTo(page, 2026, 9, 19);
  await setupRoutes(page, [
    staticHandler([[CULTIVATION_SHEETS['いなべ'].id, CULTIVATION_SHEETS['いなべ'].gid]], buildVariedCultCsv(DATES)),
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
    // 群馬の収穫見込(転写シート)：19〜25日とも値を入れる(harvestMissingが出ない対照群として使う)
    staticHandler([[GUNMA_TRANSFER_ID, GUNMA_TRANSFER_GID]], buildGunmaTransferCsv({ 19: 500, 20: 500, 21: 500, 22: 500, 23: 500, 24: 500, 25: 500 })),
    // 群馬の勤務表(栽培・出荷とも同じ月度のシートを使う。人別内訳の選択可能性の確認用)
    staticHandler([[GUNMA_SHIFT_SHEET_ID, CULT_GUNMA_GID_202610]], buildGunmaShiftCsv('2026.10', [{ name: '群馬太郎', cellsByIso: Object.fromEntries(DATES.map(d => [isoKey(d), '8:00-17:00'])) }])),
    staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], buildGunmaShiftCsv('2026.10', [{ name: '群馬花子', cellsByIso: Object.fromEntries(DATES.map(d => [isoKey(d), '8:00-17:00'])) }])),
    // 南丹の勤務表(栽培の人別内訳の選択可能性の確認用)
    staticHandler([[NANTAN_SHIFT_SHEET_ID, NANTAN_SHIFT_SHEET_GID]], buildNantanShiftCsv(DATES, [{ name: '南丹次郎', cellsByIso: Object.fromEntries(DATES.map(d => [isoKey(d), '8:00-17:00'])) }])),
  ]);
  await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);

  console.log('=== ①ドラッグで四角い範囲を選ぶと、丸める前の値の合計・平均・個数・最小・最大が表示される ===');
  {
    const start = await center(page, '[data-cult="芽かき"][data-cult-offset="0"]');
    const mid = await center(page, '[data-cult="芽かき"][data-cult-offset="1"]');
    const end = await center(page, '[data-cult="芽かき"][data-cult-offset="2"]');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.move(end.x, end.y);
    await page.mouse.up();
    const bar = await page.evaluate(() => ({
      shown: document.getElementById('aggBar').classList.contains('show'),
      sum: document.getElementById('aggSum').textContent,
      avg: document.getElementById('aggAvg').textContent,
      count: document.getElementById('aggCount').textContent,
      min: document.getElementById('aggMin').textContent,
      max: document.getElementById('aggMax').textContent,
      hasAggBarClass: document.body.classList.contains('has-agg-bar'),
      selectedRaws: window.__test.getCellSelection().map(c => c.getAttribute('data-raw')).sort(),
    }));
    check('day0〜day2の3セル(芽かき=3,2,1)が選択される', JSON.stringify(bar.selectedRaws) === JSON.stringify(['1', '2', '3']));
    check('集計帯が表示され、bodyにhas-agg-barが付く(下の余白確保)', bar.shown && bar.hasAggBarClass);
    check('合計=6.0(3+2+1。件数は個数(パック数等)に含まれないため整数表示にはならない)', bar.sum === '6.0');
    check('平均=2.0(常に小数1桁)', bar.avg === '2.0');
    check('個数=3', bar.count === '3');
    check('最小=1.0・最大=3.0', bar.min === '1.0' && bar.max === '3.0');
    check('選択したセルの背景が選択色(cell-selected)になる', await page.evaluate(() =>
      document.querySelector('[data-cult="芽かき"][data-cult-offset="0"]').classList.contains('cell-selected')));
  }

  console.log('=== ②丸める前の値を足してから1回だけ丸めている(0.04+0.04→0.1。0.0+0.0にはならない) ===');
  {
    await page.evaluate(() => {
      const a = document.querySelector('[data-cult="芽かき"][data-cult-offset="3"]');
      const b = document.querySelector('[data-cult="芽かき"][data-cult-offset="4"]');
      a.setAttribute('data-raw', '0.04'); a.textContent = '0.0';
      b.setAttribute('data-raw', '0.04'); b.textContent = '0.0';
      window.__test.clearCellSelection();
    });
    const c1 = await center(page, '[data-cult="芽かき"][data-cult-offset="3"]');
    const c2 = await center(page, '[data-cult="芽かき"][data-cult-offset="4"]');
    await page.mouse.move(c1.x, c1.y); await page.mouse.down(); await page.mouse.move(c2.x, c2.y); await page.mouse.up();
    const sum = await page.evaluate(() => document.getElementById('aggSum').textContent);
    check('表示は0.0+0.0の2セルでも、合計は丸める前の値0.04+0.04=0.08を丸めた0.1になる', sum === '0.1');
  }

  console.log('=== ③Shift＋クリックで範囲拡張、Ctrl(⌘)＋クリックで別の表のセルを追加選択できる ===');
  {
    await page.evaluate(() => window.__test.clearCellSelection());
    const d0 = await center(page, '[data-cult="芽かき"][data-cult-offset="0"]');
    await page.mouse.click(d0.x, d0.y);
    const d2 = await center(page, '[data-cult="芽かき"][data-cult-offset="2"]');
    await page.keyboard.down('Shift');
    await page.mouse.click(d2.x, d2.y);
    await page.keyboard.up('Shift');
    let count = await page.evaluate(() => window.__test.getCellSelection().length);
    check('Shift+クリックでday0〜day2の3セルに拡張される', count === 3);

    const otherTableCell = await center(page, '[data-work="コンテナ点検時間"][data-work-offset="0"]');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(modifier);
    await page.mouse.click(otherTableCell.x, otherTableCell.y);
    await page.keyboard.up(modifier);
    const after = await page.evaluate(() => {
      const cells = window.__test.getCellSelection();
      const tables = new Set(cells.map(c => c.closest('table').id));
      return { count: cells.length, tableCount: tables.size };
    });
    check('Ctrl(⌘)＋クリックで、別の表(標準工数)のセルが既存の選択に追加される(4セル・2つの表)', after.count === 4 && after.tableCount === 2);

    console.log('=== ④単位混在・合計列との二重計上の注意表示 ===');
    const warn = await page.evaluate(() => ({
      unit: document.getElementById('aggWarnUnit').style.display,
      double: document.getElementById('aggWarnDouble').style.display,
    }));
    check('単位(件とh)が混在しているため「単位が混在しています」が表示される', warn.unit !== 'none');
    check('合計列は含まれていないため「二重に数えている可能性」は出ない', warn.double === 'none');

    await page.evaluate(() => window.__test.clearCellSelection());
    const dayCell = await center(page, '[data-cult="芽かき"][data-cult-offset="0"]');
    const totalCell = await center(page, '[data-cult="芽かき"][data-cult-offset="total"]');
    await page.mouse.click(dayCell.x, dayCell.y);
    await page.keyboard.down(modifier);
    await page.mouse.click(totalCell.x, totalCell.y);
    await page.keyboard.up(modifier);
    const warn2 = await page.evaluate(() => document.getElementById('aggWarnDouble').style.display);
    check('日ごとの列と合計列を一緒に選ぶと「合計の列を含むため、二重に数えている可能性があります」が表示される', warn2 !== 'none');
  }

  console.log('=== ⑤「－」「計算方法未定」・補足文字は計算・個数に入らない。見出し行・列は選べない ===');
  {
    await page.evaluate(() => window.__test.clearCellSelection());
    const harvestCell = await center(page, '[data-work="収穫"][data-work-offset="0"]');
    await page.mouse.click(harvestCell.x, harvestCell.y);
    const r = await page.evaluate(() => {
      const cell = document.querySelector('[data-work="収穫"][data-work-offset="0"]');
      return {
        text: cell.textContent.trim(),
        hasRaw: cell.hasAttribute('data-raw'),
        selected: cell.classList.contains('cell-selected'),
        count: document.getElementById('aggCount').textContent,
        sum: document.getElementById('aggSum').textContent,
      };
    });
    check('収穫kg未入力のため「－」表示で、data-raw属性を持たない', r.text === '－' && !r.hasRaw);
    check('「－」セルも選択はできる(背景が変わる)', r.selected);
    check('集計には入らない(個数0・合計「－」)', r.count === '0' && r.sum === '－');

    await page.evaluate(() => window.__test.clearCellSelection());
    const headerCellSelectable = await page.evaluate(() => {
      const labelTh = document.querySelector('#table1cultBody tr th.sticky-1');
      const weekdayTh = document.querySelector('#table1cult thead .dcol');
      return {
        labelSelectable: labelTh.classList.contains('selectable-cell'),
        weekdaySelectable: weekdayTh.classList.contains('selectable-cell'),
      };
    });
    check('行見出し(作業区分/工程名のth)はselectable-cellクラスを持たず選べない', !headerCellSelectable.labelSelectable);
    check('日付/曜日の見出し行はselectable-cellクラスを持たず選べない', !headerCellSelectable.weekdaySelectable);
  }

  console.log('=== ⑥Esc・表の外のクリック・基準日の切替で選択が解除され、帯が消える ===');
  {
    const c = await center(page, '[data-cult="芽かき"][data-cult-offset="0"]');
    await page.mouse.click(c.x, c.y);
    check('選択直後は帯が表示される', await page.evaluate(() => document.getElementById('aggBar').classList.contains('show')));
    await page.keyboard.press('Escape');
    check('Escで選択解除・帯が消える', await page.evaluate(() => !document.getElementById('aggBar').classList.contains('show') && window.__test.getCellSelection().length === 0));

    await page.mouse.click(c.x, c.y);
    await page.mouse.click(5, 5); // 表の外(左上の余白)をクリック
    check('表の外をクリックすると選択解除される', await page.evaluate(() => window.__test.getCellSelection().length === 0));

    await page.mouse.click(c.x, c.y);
    check('クリック直後は選択されている(基準日切替前の前提)', await page.evaluate(() => window.__test.getCellSelection().length === 1));
    await page.click('#nextDay');
    await page.waitForTimeout(800);
    check('基準日を切り替えると選択が解除される(render()のたびにclearCellSelection())', await page.evaluate(() => window.__test.getCellSelection().length === 0 && !document.getElementById('aggBar').classList.contains('show')));
    await page.click('#prevDay');
    await page.waitForTimeout(800);
  }

  console.log('=== ⑦タッチ操作：タップのたびに選択に加える/外す。「選択を解除」ボタンで解除できる ===');
  {
    const touchPage = await browser.newPage({ viewport: { width: 1600, height: 1000 }, hasTouch: true });
    await fixTodayTo(touchPage, 2026, 9, 19);
    await setupRoutes(touchPage, [
      staticHandler([[CULTIVATION_SHEETS['いなべ'].id, CULTIVATION_SHEETS['いなべ'].gid]], buildVariedCultCsv(DATES)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await touchPage.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await touchPage.waitForTimeout(1000);
    const tc = await center(touchPage, '[data-cult="芽かき"][data-cult-offset="0"]');
    await touchPage.touchscreen.tap(tc.x, tc.y);
    check('1回目のタップで選択に加わる', await touchPage.evaluate(() => window.__test.getCellSelection().length === 1));
    await touchPage.touchscreen.tap(tc.x, tc.y);
    check('同じセルを2回目タップすると選択から外れる', await touchPage.evaluate(() => window.__test.getCellSelection().length === 0));
    await touchPage.touchscreen.tap(tc.x, tc.y);
    const clearBtn = await center(touchPage, '#aggClearBtn');
    await touchPage.touchscreen.tap(clearBtn.x, clearBtn.y);
    check('「選択を解除」ボタンで選択が解除される', await touchPage.evaluate(() => window.__test.getCellSelection().length === 0 && !document.getElementById('aggBar').classList.contains('show')));
    await touchPage.close();
  }

  console.log('=== ⑧既存のクリックの動き(拠点/区分トグル・基準日ボタン・詳細の開閉)が変わらない ===');
  {
    await page.evaluate(() => window.__test.clearCellSelection());
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    check('区分トグルのクリックで出荷パネルに切り替わる', await page.evaluate(() => document.getElementById('shippingPanels').style.display !== 'none'));
    await page.click('[data-business="栽培"]');
    await page.waitForTimeout(800);
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(1000);
    check('拠点トグルのクリックで群馬に切り替わる', await page.evaluate(() => document.querySelector('[data-site="群馬"]').classList.contains('active')));
    await page.click('[data-site="いなべ"]');
    await page.waitForTimeout(1000);

    const summary = page.locator('#table1cult').locator('xpath=../../..').locator('details.detail-rows summary').first();
    await summary.click();
    const opened = await page.evaluate(() => document.querySelector('.cult details.detail-rows').open);
    check('詳細のsummaryクリックでdetailsが開く(選択機能の追加後も壊れていない)', opened);
    await summary.click();
  }

  console.log('=== ⑨栽培 標準工数 小計：日ごとの小計に「*」が付く日があれば、合計列の小計にも「*」が付く ===');
  {
    const r = await page.evaluate(() => {
      const day0 = document.querySelector('[data-work-subtotal-offset="0"]');
      const total = document.querySelector('[data-work-subtotal-offset="total"]');
      return {
        day0Text: day0.textContent.trim(),
        totalText: total.textContent.trim(),
        totalRaw: total.getAttribute('data-raw'),
        noteShown: document.getElementById('workHarvestNote').style.display !== 'none',
      };
    });
    check('収穫kgが未入力のため、日ごとの小計に「*」が付く(収穫を含まない値)', r.day0Text.endsWith('*'));
    check('合計列の小計にも同じ「*」が付く', r.totalText.endsWith('*'));
    check('data-raw属性は数値のまま(「*」を含まない。集計に影響しない)', r.totalRaw !== null && !isNaN(Number(r.totalRaw)) && !r.totalRaw.includes('*'));
    check('注記(「* 収穫計画のkgが未入力のため…」)は今までどおり表示される', r.noteShown);

    // 対照群：群馬は収穫見込(転写シート)を19〜25日とも入力済みのため、「*」が付かないはず
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(1000);
    const r2 = await page.evaluate(() => {
      const total = document.querySelector('[data-work-subtotal-offset="total"]');
      return { totalText: total.textContent.trim(), noteShown: document.getElementById('workHarvestNote').style.display !== 'none' };
    });
    check('群馬は収穫見込が全日入力済みのため、合計列の小計に「*」が付かない', !r2.totalText.endsWith('*'));
    check('群馬は注記も表示されない', !r2.noteShown);
    await page.click('[data-site="いなべ"]');
    await page.waitForTimeout(1000);
  }

  console.log('=== ⑩栽培・出荷×いなべ・群馬・南丹の6画面すべてで、3段の表(詳細・人別内訳を含む)が選択可能 ===');
  {
    for (const business of ['栽培', '出荷']) {
      await page.click(`[data-business="${business}"]`);
      await page.waitForTimeout(800);
      for (const site of ['いなべ', '群馬', '南丹']) {
        await page.click(`[data-site="${site}"]`);
        await page.waitForTimeout(1000);
        // 折りたたみの詳細・人別内訳をすべて開く
        await page.evaluate(() => document.querySelectorAll('details.detail-rows').forEach(d => { d.open = true; }));
        const tableIds = business === '栽培'
          ? ['table1cult', 'table1cultDetail', 'table2work', 'table3labor', 'table3laborDetail']
          : ['table1ship', 'table1shipDetail', 'table2ship', 'table3ship', 'table3shipDetail'];
        const counts = await page.evaluate((ids) => ids.map(id => {
          const t = document.getElementById(id);
          return t ? t.querySelectorAll('.selectable-cell').length : -1;
        }), tableIds);
        tableIds.forEach((id, i) => {
          check(`${business}×${site}：${id} に選択可能セルがある`, counts[i] > 0);
        });
      }
    }
    await page.click('[data-business="栽培"]');
    await page.click('[data-site="いなべ"]');
    await page.waitForTimeout(800);
  }

  console.log('=== ⑪出荷：付帯作業(計算方法未定)は選べるが集計に入らない。実績・受注の印の行(見出し)は選べない ===');
  {
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(600);
    await page.click('[data-site="南丹"]'); // 付帯作業はSHIPPING_SITE_FILTERで南丹・群馬にのみ表示される
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.__test.clearCellSelection());
    const fuyoCell = await center(page, '[data-shipwork="付帯作業"][data-shipwork-offset="0"]');
    await page.mouse.click(fuyoCell.x, fuyoCell.y);
    const r = await page.evaluate(() => {
      const cell = document.querySelector('[data-shipwork="付帯作業"][data-shipwork-offset="0"]');
      return {
        selected: cell.classList.contains('cell-selected'),
        hasRaw: cell.hasAttribute('data-raw'),
        count: document.getElementById('aggCount').textContent,
        kindSelectable: document.querySelector('#table1ship thead .dcol-kind').classList.contains('selectable-cell'),
      };
    });
    check('付帯作業(計算方法未定)のセルも選択はできる', r.selected);
    check('付帯作業はdata-rawを持たず集計・個数に入らない', !r.hasRaw && r.count === '0');
    check('出荷数量の実績・受注の印の行(見出し)はselectable-cellクラスを持たず選べない', !r.kindSelectable);
    await page.evaluate(() => window.__test.clearCellSelection());
    await page.click('[data-site="いなべ"]');
    await page.waitForTimeout(600);
    await page.click('[data-business="栽培"]');
    await page.waitForTimeout(600);
  }

  await page.close();
  await browser.close();

  console.log('');
  console.log('=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
