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

const GUNMA_SHIFT_SHEET_ID = '1eqN5kfymPPvOOi9UbTg7ZxLn04YE7YnjrJw-jADySUM';
const CULT_GUNMA_GID_202610 = '2074687161'; // 栽培(収穫班)の既存gid
const SHIP_GUNMA_GID_202609 = '305870764';  // 26.9/11~10/10 出荷場
const SHIP_GUNMA_GID_202610 = '1087258434'; // 26.10/11~11/10 出荷場
const SHIP_GUNMA_GID_REF_202608 = '999000111'; // テスト用の仮gid(2026.8、referenceGids検証用)
const STD_LABOR_HOURS_SHEET = { id: '1LtYb1feXR6jtIEfxaADLiTEWpPabKJDDlwoS1V-yuG0', gid: '1404355975' };
const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STD_WORK_HOURS_GID = '264266810';
const SALES_URL_SHEET_GID = '1130067935';

function dayNumbersForPeriod() { const out = []; for (let d = 11; d <= 31; d++) out.push(d); for (let d = 1; d <= 10; d++) out.push(d); return out; }
function datesForPeriod(periodKey) {
  const parts = periodKey.split('.').map(Number);
  let year = parts[0], month = parts[1];
  const dayNumbers = dayNumbersForPeriod();
  const dates = []; let prevDay = null;
  dayNumbers.forEach(n => { if (prevDay !== null && n < prevDay) { month++; if (month > 12) { month = 1; year++; } } prevDay = n; dates.push(new Date(year, month - 1, n)); });
  return dates;
}
// 出荷場(収穫班と同じ形)相当のCSV。people: [{name, cellsByIso:{iso: raw}}]。
// 実際の出荷場シートには社員・パートを分ける空行が無いため、デフォルトでは空行を
// 入れない。opts.blankSeparatorAfterIndexを指定すると、そのindexの後に空行を
// 1つ挟む(栽培の収穫班シート相当のモックを作るときに使う)
function buildGunmaShiftCsv(periodKey, people, opts) {
  opts = opts || {};
  const dayNumbers = dayNumbersForPeriod();
  const dates = datesForPeriod(periodKey);
  const rows = [];
  rows.push(['出荷場勤務表', '', '']);
  rows.push(['', '', '']);
  rows.push([''].concat(dayNumbers));
  rows.push(['']. concat(dates.map(d => WD[d.getDay()])));
  function personRow(p) {
    const cells = dates.map(d => { const v = p.cellsByIso ? p.cellsByIso[isoKey(d)] : undefined; return v === undefined ? '' : v; });
    return [p.name].concat(cells);
  }
  people.forEach((p, i) => {
    rows.push(personRow(p));
    if (opts.blankSeparatorAfterIndex === i) rows.push(['']. concat(dates.map(() => '')));
  });
  rows.push(['パート合計'].concat(dates.map(() => '999')));
  rows.push(['合計'].concat(dates.map(() => '9999')));
  return toCsvText(rows);
}

function buildStdLaborCsv(entries) {
  const COLS = 16;
  const blank = () => new Array(COLS).fill('');
  const rows = [blank(), blank()];
  const header = blank(); header[15] = 'シフト表名';
  rows.push(header);
  entries.forEach(e => {
    const row = blank();
    row[1] = e.flag; row[3] = e.site; row[5] = e.dept; row[7] = e.name;
    row[9] = e.hoursPerDay != null ? String(e.hoursPerDay) : '';
    row[15] = e.shiftName || '';
    rows.push(row);
  });
  return toCsvText(rows);
}
function buildStdWorkHoursCsv(opts) {
  opts = opts || {};
  const rows = [];
  rows.push(['', '', '', '', '', '', '', '']);
  rows.push(['cs数=(合計点数-バラ数)÷P/cs+バラ数', '', '', '', '', '', '', '']);
  rows.push(['パック・袋P/cs', '', '', '', '', '', '', '']);
  rows.push([String(opts.pcsPerCs !== undefined ? opts.pcsPerCs : 30), '', '', '', '', '', '', '']);
  rows.push(['栽培', '収穫', 50, '', '', '', '', 'kg/h']);
  const shipFactors = opts.shipFactors || { 'パック並べる': { factor: 30, unit: '秒' } };
  Object.keys(shipFactors).forEach((waku, i) => {
    const f = shipFactors[waku];
    rows.push([i === 0 ? '出荷' : '', waku, f.factor, '', '', '', '', f.unit]);
  });
  return toCsvText(rows);
}
function buildSalesUrlListCsv(entries) {
  const rows = [['拠点', '区分', 'URL']];
  entries.forEach(e => rows.push([e.site, e.kind, e.url]));
  return toCsvText(rows);
}
function salesSheetUrl(id, gid) { return `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${gid}`; }
function buildSalesSheetCsv(site, dates, productRows) {
  const header = ['拠点', '個数/重量(kg)', '区分', '商品', '秀・優・袋①・袋②', 'サイズ'].concat(
    dates.map(d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`));
  const rows = [header];
  productRows.forEach(pr => {
    const cells = dates.map(d => { const v = pr.valuesByDate[isoKey(d)]; return v === undefined ? '' : v; });
    rows.push([site, pr.kind, '出荷', pr.product, '', ''].concat(cells));
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

async function gotoGunmaShipping(page) {
  await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await page.click('[data-business="出荷"]');
  await page.waitForTimeout(800);
  await page.click('[data-site="群馬"]');
  await page.waitForTimeout(1200);
}
async function setBasisDate(page, iso) {
  await page.fill('#basisDateInput', iso);
  await page.dispatchEvent('#basisDateInput', 'change');
  await page.waitForTimeout(1200);
}
async function shippingLaborDetailRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#table3shipDetailBody tr')).map(tr => ({
    name: tr.querySelector('th').textContent.trim(),
    dept: tr.querySelector('td.dept-col').textContent.trim(),
    cells: Array.from(tr.querySelectorAll('td')).slice(1).map(td => td.textContent.trim()),
  })));
}
async function shipLaborTotals(page) {
  return page.evaluate(() => Array.from({ length: 8 }, (_, o) =>
    document.querySelector(`[data-shiplabor-total-offset="${o}"]`).textContent.trim()));
}
async function shipLaborNotices(page) {
  return page.evaluate(() => document.getElementById('shipLaborNotices').textContent.trim());
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let allOk = true;
  function check(name, cond) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}`); if (!cond) allOk = false; }

  console.log('=== ①基準日9月・10月をまたぐ場合に、両方の出荷場シートから値が読まれること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19); // 今日=2026/10/19
    const cellsFor = (dates) => { const o = {}; dates.forEach((d, i) => { o[isoKey(d)] = (i === 0) ? '09:00-17:00' : ''; }); return o; };
    const sepDates = datesForPeriod('2026.9');
    const octDates = datesForPeriod('2026.10');
    const sepCsv = buildGunmaShiftCsv('2026.9', [{ name: '高山', cellsByIso: cellsFor(sepDates) }]);
    const octCsv = buildGunmaShiftCsv('2026.10', [{ name: '高山', cellsByIso: cellsFor(octDates) }]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setBasisDate(page, '2026-09-25');
    const totalsSep = await shipLaborTotals(page);
    console.log('基準日9/25〜:', JSON.stringify(totalsSep));
    check('9月度の出荷場シートから値が読まれる(「－」のまま止まらない)', totalsSep.every(v => v !== '－'));

    await setBasisDate(page, '2026-10-07'); // offset0-7=10/7〜10/14(9月度と10月度をまたぐ)
    const totalsCross = await shipLaborTotals(page);
    console.log('基準日10/7〜(9月/10月をまたぐ):', JSON.stringify(totalsCross));
    check('9月度側(10/7〜10/10)も値が読まれる', totalsCross.slice(0, 4).every(v => v !== '－'));
    check('10月度側(10/11〜10/14)も値が読まれる', totalsCross.slice(4).every(v => v !== '－'));
    await page.close();
  }

  console.log('\n=== ②10月度の高山(先頭3日空欄、9月度にいる)が既存の人と判断され、10/11〜10/13が出勤になること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sepDates = datesForPeriod('2026.9');
    const octDates = datesForPeriod('2026.10');
    const sepCellsByIso = {}; sepDates.forEach((d, i) => { sepCellsByIso[isoKey(d)] = (i === 0) ? '09:00-17:00' : ''; });
    const octCellsByIso = {}; octDates.forEach((d, i) => { octCellsByIso[isoKey(d)] = (i < 3) ? '' : '休'; }); // 先頭3日(10/11-10/13)空欄
    const sepCsv = buildGunmaShiftCsv('2026.9', [{ name: '高山', cellsByIso: sepCellsByIso }]);
    const octCsv = buildGunmaShiftCsv('2026.10', [{ name: '高山', cellsByIso: octCellsByIso }]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setBasisDate(page, '2026-10-11'); // offset0-7=10/11〜10/18
    const rows = await shippingLaborDetailRows(page);
    const takayama = rows.find(r => r.name === '高山');
    console.log('高山(10/11〜):', JSON.stringify(takayama && takayama.cells));
    check('10/11〜10/13(先頭の空欄)が既存の人として出勤(標準労働時間8.5h)になる', takayama && takayama.cells.slice(0, 3).every(v => v === '8.5'));
    const notices = await shipLaborNotices(page);
    check('既存の人として判断できたのでアラートは出ない', !notices.includes('高山'));
    await page.close();
  }

  console.log('\n=== ③10月度にだけいて先頭空欄・途中から記入の人は新しい人と判断。「入社」の人は入社日以前が計上されない ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sepDates = datesForPeriod('2026.9');
    const octDates = datesForPeriod('2026.10');
    // 9月度には「新人花子」も「入社太郎」もいない(10月度にだけ新規でいる想定)
    const sepCsv = buildGunmaShiftCsv('2026.9', [{ name: '高山', cellsByIso: Object.fromEntries(sepDates.map((d, i) => [isoKey(d), i === 0 ? '09:00-17:00' : ''])) }]);
    const shinninCells = {}; octDates.forEach((d, i) => { shinninCells[isoKey(d)] = (i < 4) ? '' : (i === 4 ? '09:00-17:00' : ''); }); // 先頭4日空欄→5日目(index4)に記入、以降空欄
    const nyushaCells = {}; octDates.forEach((d, i) => { nyushaCells[isoKey(d)] = (i === 2) ? '入社' : ''; }); // 3日目(index2)が入社
    const octCsv = buildGunmaShiftCsv('2026.10', [
      { name: '高山', cellsByIso: Object.fromEntries(octDates.map((d, i) => [isoKey(d), i === 0 ? '09:00-17:00' : ''])) },
      { name: '新人花子', cellsByIso: shinninCells },
      { name: '入社太郎', cellsByIso: nyushaCells },
    ]);
    const laborRows = [
      { flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' },
      { flag: '1', site: '群馬', dept: '出荷場', name: '新人花子', hoursPerDay: 7, shiftName: '新人花子' },
      { flag: '1', site: '群馬', dept: '出荷場', name: '入社太郎', hoursPerDay: 6, shiftName: '入社太郎' },
    ];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setBasisDate(page, '2026-10-11'); // offset0-7=10/11(index0)〜10/18(index7)
    const rows = await shippingLaborDetailRows(page);
    const shinnin = rows.find(r => r.name === '新人花子');
    const nyusha = rows.find(r => r.name === '入社太郎');
    console.log('新人花子:', JSON.stringify(shinnin && shinnin.cells));
    console.log('入社太郎:', JSON.stringify(nyusha && nyusha.cells));
    check('新人花子：最初の記入(5日目)より前(1〜4日目)の空欄は計上されない(0.0h)', shinnin && shinnin.cells.slice(0, 4).every(v => v === '0.0'));
    check('新人花子：最初の記入(5日目)は時刻どおり(拘束8h-休憩0.75h=7.25h→7.3h)', shinnin && shinnin.cells[4] === '7.3');
    check('新人花子：最初の記入より後(6日目以降)の空欄は出勤(標準労働時間7.0h)になる', shinnin && shinnin.cells.slice(5).every(v => v === '7.0'));
    check('入社太郎：入社日(3日目)以前(1〜2日目)の空欄は計上されない(0.0h)', nyusha && nyusha.cells.slice(0, 2).every(v => v === '0.0'));
    check('入社太郎：入社日より後(4日目以降)の空欄は出勤(標準労働時間6.0h)になる', nyusha && nyusha.cells.slice(3).every(v => v === '6.0'));
    const notices = await shipLaborNotices(page);
    check('新しい人・入社の判断ができたのでアラートは出ない', !notices.includes('判断できない'));
    await page.close();
  }

  console.log('\n=== ④9月度(前の月度=2026.8が未設定)で先頭空欄の高山がアラートになる。referenceGidsを設定するとアラートが消える ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sepDates = datesForPeriod('2026.9');
    const sepCellsByIso = {}; sepDates.forEach((d, i) => { sepCellsByIso[isoKey(d)] = (i < 3) ? '' : (i === 3 ? '09:00-17:00' : ''); }); // 先頭3日空欄→4日目に記入
    const sepCsv = buildGunmaShiftCsv('2026.9', [{ name: '高山', cellsByIso: sepCellsByIso }]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setBasisDate(page, '2026-09-11'); // offset0-7=9/11〜9/18
    const rows1 = await shippingLaborDetailRows(page);
    const takayama1 = rows1.find(r => r.name === '高山');
    const notices1 = await shipLaborNotices(page);
    console.log('referenceGids未設定:', JSON.stringify(takayama1 && takayama1.cells), '補足:', notices1);
    check('前の月度(2026.8)が未設定のため、先頭3日(9/11-9/13)は計上されない(0.0h)', takayama1 && takayama1.cells.slice(0, 3).every(v => v === '0.0'));
    check('判断できない旨のアラートが出る(名前・日付範囲入り)', notices1.includes('高山') && notices1.includes('9/11') && notices1.includes('9/13'));
    check('「前の月度のシートを設定すると判断できます」の案内が出る', notices1.includes('前の月度のシートを設定すると判断できます'));

    // referenceGids['2026.8']にモックを設定(2026.8のシートに高山がいる=既存と判断できるようになる)
    const refCsv = buildGunmaShiftCsv('2026.8', [{ name: '高山', cellsByIso: {} }]);
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_REF_202608]], refCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.evaluate((gid) => {
      window.__test.FORECAST_SHIPPING_SHIFT_SOURCES['群馬'].referenceGids['2026.8'] = gid;
    }, SHIP_GUNMA_GID_REF_202608);
    await setBasisDate(page, '2026-09-12'); // 基準日を変えて再描画をトリガ
    await setBasisDate(page, '2026-09-11');
    const rows2 = await shippingLaborDetailRows(page);
    const takayama2 = rows2.find(r => r.name === '高山');
    const notices2 = await shipLaborNotices(page);
    console.log('referenceGids設定後:', JSON.stringify(takayama2 && takayama2.cells), '補足:', notices2);
    check('referenceGidsを設定すると、既存の人と判断され先頭3日も出勤(8.5h)になる', takayama2 && takayama2.cells.slice(0, 3).every(v => v === '8.5'));
    check('アラートが消える', !notices2.includes('高山'));
    await page.close();
  }

  console.log('\n=== ⑤行が全部空欄の人(「(仮)」以外)が計上されずアラートになること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const octDates = datesForPeriod('2026.10');
    const allBlankCells = Object.fromEntries(octDates.map(d => [isoKey(d), '']));
    const octCsv = buildGunmaShiftCsv('2026.10', [{ name: '全部空欄太郎', cellsByIso: allBlankCells }]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '全部空欄太郎', hoursPerDay: 8, shiftName: '全部空欄太郎' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setBasisDate(page, '2026-10-11');
    const rows = await shippingLaborDetailRows(page);
    const zenbu = rows.find(r => r.name === '全部空欄太郎');
    const notices = await shipLaborNotices(page);
    console.log('全部空欄太郎:', JSON.stringify(zenbu && zenbu.cells), '補足:', notices);
    check('行が全部空欄の人は計上されない(すべて0.0h)', zenbu && zenbu.cells.every(v => v === '0.0'));
    check('判断できない旨のアラートが出る', notices.includes('全部空欄太郎'));
    await page.close();
  }

  console.log('\n=== ⑥空欄が出勤で標準労働時間シートにない人が8h+補足。時刻と休だけの人には補足が出ない。パートも同じルール(空行なしモック) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const octDates = datesForPeriod('2026.10');
    // 未登録太郎：1日目に時刻(先頭に空欄なし)、以降空欄→出勤扱い、未登録なので8h+補足が出るべき
    const mitoroku = Object.fromEntries(octDates.map((d, i) => [isoKey(d), i === 0 ? '09:00-17:00' : '']));
    // 時刻休だけ花子：時刻と休のみで空欄が一切無い→未登録でも補足は出ないはず
    const jikokuYasumi = Object.fromEntries(octDates.map((d, i) => [isoKey(d), i % 2 === 0 ? '09:00-17:00' : '休']));
    // パート一郎：社員・パートの区分(空行)が無いモックでも、同じルールで空欄が扱われることを確認
    const partIchiro = Object.fromEntries(octDates.map((d, i) => [isoKey(d), i === 0 ? '13:00-17:00' : '']));
    const octCsv = buildGunmaShiftCsv('2026.10', [
      { name: '未登録太郎', cellsByIso: mitoroku },
      { name: '時刻休だけ花子', cellsByIso: jikokuYasumi },
      { name: 'パート一郎', cellsByIso: partIchiro },
    ]); // opts省略=空行なし
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: 'パート一郎', hoursPerDay: 5, shiftName: 'パート一郎' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setBasisDate(page, '2026-10-11');
    const rows = await shippingLaborDetailRows(page);
    const mitorokuRow = rows.find(r => r.name === '未登録太郎');
    const jikokuRow = rows.find(r => r.name === '時刻休だけ花子');
    const partRow = rows.find(r => r.name === 'パート一郎');
    const notices = await shipLaborNotices(page);
    console.log('未登録太郎:', JSON.stringify(mitorokuRow && mitorokuRow.cells));
    console.log('時刻休だけ花子:', JSON.stringify(jikokuRow && jikokuRow.cells));
    console.log('パート一郎:', JSON.stringify(partRow && partRow.cells));
    console.log('補足:', notices);
    check('未登録太郎：空欄(出勤)が標準労働時間シート未登録のため8.0hになる', mitorokuRow && mitorokuRow.cells.slice(1).every(v => v === '8.0'));
    check('未登録太郎の補足が出る(空欄を実際に8hとして使ったため)', notices.includes('未登録太郎'));
    check('時刻休だけ花子：未登録でも補足が出ない(空欄が一つも無いため)', !notices.includes('時刻休だけ花子'));
    check('時刻休だけ花子：時刻の日は7.25h、休の日は0.0h', jikokuRow && jikokuRow.cells[0] === '7.3' && jikokuRow.cells[1] === '0.0');
    check('パート(空行なしモック)の空欄も同じルールで標準労働時間(5.0h)になる', partRow && partRow.cells.slice(1).every(v => v === '5.0'));
    await page.close();
  }

  console.log('\n=== ⑦吉村(出)・高橋(出)が9月度・10月度とも集計されないこと ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sepDates = datesForPeriod('2026.9');
    const octDates = datesForPeriod('2026.10');
    const cellsFor = (dates) => Object.fromEntries(dates.map((d, i) => [isoKey(d), i === 0 ? '09:00-17:00' : '']));
    const sepCsv = buildGunmaShiftCsv('2026.9', [
      { name: '高山', cellsByIso: cellsFor(sepDates) },
      { name: '吉村(出)', cellsByIso: cellsFor(sepDates) },
      { name: '高橋(出)', cellsByIso: cellsFor(sepDates) },
    ]);
    const octCsv = buildGunmaShiftCsv('2026.10', [
      { name: '高山', cellsByIso: cellsFor(octDates) },
      { name: '吉村(出)', cellsByIso: cellsFor(octDates) },
      { name: '高橋(出)', cellsByIso: cellsFor(octDates) },
    ]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setBasisDate(page, '2026-09-20');
    const namesSep = (await shippingLaborDetailRows(page)).map(r => r.name);
    console.log('9月度:', JSON.stringify(namesSep));
    check('9月度で吉村(出)・高橋(出)が集計されない', !namesSep.includes('吉村(出)') && !namesSep.includes('高橋(出)'));
    await setBasisDate(page, '2026-10-15');
    const namesOct = (await shippingLaborDetailRows(page)).map(r => r.name);
    console.log('10月度:', JSON.stringify(namesOct));
    check('10月度で吉村(出)・高橋(出)が集計されない', !namesOct.includes('吉村(出)') && !namesOct.includes('高橋(出)'));
    await page.close();
  }

  console.log('\n=== ⑧栽培の収穫班シートでは今までどおり空行の後の空欄が計上されないこと。いなべ・南丹が今までどおりであること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const octDates = datesForPeriod('2026.10');
    // 収穫班(栽培)のモック：野呂(社員、空行の前)、助っ人(パート、空行の後。全日空欄)
    const cultCsv = buildGunmaShiftCsv('2026.10', [
      { name: '野呂', cellsByIso: Object.fromEntries(octDates.map(d => [isoKey(d), ''])) },
      { name: '助っ人', cellsByIso: Object.fromEntries(octDates.map(d => [isoKey(d), ''])) },
    ], { blankSeparatorAfterIndex: 0 });
    const cultLaborRows = [
      { flag: '1', site: '群馬', dept: '収穫', name: '野呂', hoursPerDay: 8, shiftName: '野呂' },
      { flag: '1', site: '群馬', dept: '収穫', name: '助っ人', hoursPerDay: 6, shiftName: '助っ人' },
    ];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, CULT_GUNMA_GID_202610]], cultCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(cultLaborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-site="群馬"]');
    await setBasisDate(page, '2026-10-11');
    const cultRows = await page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => ({
      name: tr.querySelector('th').textContent.trim(),
      cells: Array.from(tr.querySelectorAll('td')).slice(1).map(td => td.textContent.trim()),
    })));
    const noro = cultRows.find(r => r.name === '野呂');
    const sukedachi = cultRows.find(r => r.name === '助っ人');
    console.log('野呂(社員・空行前):', JSON.stringify(noro && noro.cells));
    console.log('助っ人(パート・空行後):', JSON.stringify(sukedachi && sukedachi.cells));
    check('栽培(収穫班)：社員(空行の前)の空欄は今までどおり出勤(標準労働時間8.0h)になる', noro && noro.cells.every(v => v === '8.0'));
    check('栽培(収穫班)：パート(空行の後)の空欄は今までどおり計上されない(0.0h)。perPersonルールの影響を受けない', sukedachi && sukedachi.cells.every(v => v === '0.0'));

    const bannerInabe = await page.evaluate(() => { document.querySelector('[data-business="出荷"]').click(); return null; });
    await page.waitForTimeout(800);
    const bannerDisplayInabe = await page.evaluate(() => getComputedStyle(document.getElementById('shippingSampleBanner')).display);
    await page.click('[data-site="いなべ"]');
    await page.waitForTimeout(800);
    const bannerDisplayInabe2 = await page.evaluate(() => getComputedStyle(document.getElementById('shippingSampleBanner')).display);
    check('いなべの出荷パネル3は今までどおり実データ接続(サンプル帯が出ない)', bannerDisplayInabe2 === 'none');
    await page.click('[data-site="南丹"]');
    await page.waitForTimeout(800);
    const bannerTextNantan = await page.evaluate(() => document.getElementById('shippingSampleBanner').textContent.trim());
    const nantanRows = await shippingLaborDetailRows(page);
    check('南丹の出荷パネル3は今までどおりサンプルデータの帯が表示される', bannerTextNantan.includes('パネル3（標準労働時間）はサンプルデータです'));
    check('南丹の出荷パネル3は今までどおりサンプル名(「出荷 サンプル」)で表示される', nantanRows.length > 0 && nantanRows.every(r => r.name.startsWith('出荷 サンプル')));
    await page.close();
  }

  console.log('\n=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');

  await browser.close();
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
