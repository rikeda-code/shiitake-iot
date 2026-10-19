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
const SHIPPING_GUNMA_GID_202610 = '1087258434'; // 26.10/11~11/10 出荷場
const STD_LABOR_HOURS_SHEET = { id: '1LtYb1feXR6jtIEfxaADLiTEWpPabKJDDlwoS1V-yuG0', gid: '1404355975' };
const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STD_WORK_HOURS_GID = '264266810';
const SALES_URL_SHEET_GID = '1130067935';

// 月度(例："2026.10")の日番号列(11〜翌月10)を作る
function dayNumbersForPeriod(periodKey) {
  const out = [];
  for (let d = 11; d <= 31; d++) out.push(d);
  for (let d = 1; d <= 10; d++) out.push(d);
  return out;
}
// 出荷場シート(収穫班シートと同じ形)相当のCSV。
// employees: [{name, cellsByIso:{iso: raw}}] (先頭のかたまり=社員)
// others: [{name, cellsByIso}] (空行の後=パート)
// 実際のシートに合わせ、1〜2行目は読まれない見出し、3行目=日番号、4行目=曜日、
// 5行目以降が人の行。パート合計の行で読み終わる
function buildGunmaShiftCsv(periodKey, employees, others, opts) {
  opts = opts || {};
  const parts = periodKey.split('.').map(Number);
  let year = parts[0], month = parts[1];
  const dayNumbers = dayNumbersForPeriod(periodKey);
  const dates = [];
  let prevDay = null;
  dayNumbers.forEach(n => {
    if (prevDay !== null && n < prevDay) { month++; if (month > 12) { month = 1; year++; } }
    prevDay = n;
    dates.push(new Date(year, month - 1, n));
  });
  const rows = [];
  rows.push(['出荷場勤務表', '', '']); // 1行目(読まれない)
  rows.push(['', '', '']); // 2行目(読まれない)
  rows.push([''].concat(dayNumbers)); // 3行目: 日番号
  rows.push(['']. concat(dates.map(d => WD[d.getDay()]))); // 4行目: 曜日
  function personRow(p) {
    const cells = dates.map(d => { const v = p.cellsByIso ? p.cellsByIso[isoKey(d)] : undefined; return v === undefined ? '' : v; });
    return [p.name].concat(cells);
  }
  employees.forEach(p => rows.push(personRow(p)));
  if (opts.blankNumericRow) {
    // 名前が空欄で数字だけの行(集計の端数等)。読み飛ばされるべき
    const blankRow = [''].concat(dates.map((d, i) => (i === 0 ? '134.1' : '')));
    rows.push(blankRow);
  } else {
    rows.push(['']. concat(dates.map(() => ''))); // 空行(社員区分の終端)
  }
  others.forEach(p => rows.push(personRow(p)));
  rows.push(['パート合計'].concat(dates.map(() => '999'))); // 集計欄(読まれない)
  rows.push(['合計'].concat(dates.map(() => '9999'))); // 集計欄(読まれない)
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
async function shipLaborAttendance(page) {
  return page.evaluate(() => Array.from({ length: 8 }, (_, o) =>
    document.querySelector(`[data-shipattendance-offset="${o}"]`).textContent.trim()));
}
async function shipLaborNotices(page) {
  return page.evaluate(() => document.getElementById('shipLaborNotices').textContent.trim());
}

// 標準的な群馬・出荷場の実データ相当モック一式(各テストで使い回す)
function buildStandardGunmaShippingMocks(dates) {
  const cellsByIsoFor = (value) => Object.fromEntries(dates.map(d => [isoKey(d), value]));
  const employees = [
    { name: '高山', cellsByIso: cellsByIsoFor('') },
    { name: '平本', cellsByIso: cellsByIsoFor('') },
    { name: 'ソー', cellsByIso: cellsByIsoFor('') },
    { name: '吉村(出)', cellsByIso: cellsByIsoFor('') }, // 配送担当。対象外
    { name: '高橋(出)', cellsByIso: cellsByIsoFor('') }, // 配送担当。対象外
  ];
  const partNames = ['小井土', '鈴木', '黛', '石井', '上原', '奥澤', '長岡', '小板橋', '磯貝'];
  const others = partNames.map(name => ({ name, cellsByIso: cellsByIsoFor('') }));
  const shiftCsv = buildGunmaShiftCsv('2026.10', employees, others);
  const laborRows = [
    { flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' },
    { flag: '1', site: '群馬', dept: '出荷場', name: '平本', hoursPerDay: 8, shiftName: '平本' },
    { flag: '1', site: '群馬', dept: '出荷場', name: 'SAW MIN HTET', hoursPerDay: 7.5, shiftName: '' },
  ];
  return { shiftCsv, laborRows, employees, others, partNames };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let allOk = true;
  function check(name, cond) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}`); if (!cond) allOk = false; }

  console.log('=== ①群馬の出荷パネル3に、出荷場シートの高山・平本・ソー(社員)と小井土〜磯貝(パート)が集計されること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19); // 今日=2026/10/19
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const mocks = buildStandardGunmaShippingMocks(dates);
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIPPING_GUNMA_GID_202610]], mocks.shiftCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(mocks.laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(1200);
    const rows = await shippingLaborDetailRows(page);
    const names = rows.map(r => r.name).sort();
    console.log('names:', JSON.stringify(names));
    check('高山・平本・ソーが人別内訳に入る', ['高山', '平本', 'ソー'].every(n => names.includes(n)));
    check('パート(小井土〜磯貝、9名)が人別内訳に入る', mocks.partNames.every(n => names.includes(n)));
    check('人数が社員3名+パート9名=12名である(配送担当2名は含まれない)', names.length === 12);
    await page.close();
  }

  console.log('\n=== ②吉村(出)・高橋(出)が集計されないこと。名前が空欄で数字だけの行が集計されないこと。「パート合計」以降が読まれないこと ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const cellsByIsoFor = (value) => Object.fromEntries(dates.map(d => [isoKey(d), value]));
    const employees = [
      { name: '高山', cellsByIso: cellsByIsoFor('') },
      { name: '吉村(出)', cellsByIso: cellsByIsoFor('') },
      { name: '高橋(出)', cellsByIso: cellsByIsoFor('') },
    ];
    const others = [{ name: '小井土', cellsByIso: cellsByIsoFor('') }];
    const shiftCsv = buildGunmaShiftCsv('2026.10', employees, others, { blankNumericRow: true });
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIPPING_GUNMA_GID_202610]], shiftCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv([])),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(1200);
    const rows = await shippingLaborDetailRows(page);
    const names = rows.map(r => r.name).sort();
    console.log('names:', JSON.stringify(names));
    check('吉村(出)が集計されない', !names.includes('吉村(出)') && !names.includes('吉村'));
    check('高橋(出)が集計されない', !names.includes('高橋(出)') && !names.includes('高橋'));
    check('名前が空欄で数字(134.1)だけの行は集計されない(高山・小井土の2名のみ)', names.length === 2 && names.includes('高山') && names.includes('小井土'));
    check('「パート合計」「合計」の集計行は人として読まれない', !names.includes('パート合計') && !names.includes('合計'));
    await page.close();
  }

  console.log('\n=== ③社員の空欄が標準労働時間シートの1日の時間になること。ソーがSAW MIN HTETで照合。未登録の社員は8h+補足 ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const mocks = buildStandardGunmaShippingMocks(dates);
    // 標準労働時間シート未登録の社員を追加
    const cellsByIsoFor = (value) => Object.fromEntries(dates.map(d => [isoKey(d), value]));
    const employees = mocks.employees.concat([{ name: '新人太郎', cellsByIso: cellsByIsoFor('') }]);
    const shiftCsv = buildGunmaShiftCsv('2026.10', employees, mocks.others.map(o => ({ name: o.name, cellsByIso: cellsByIsoFor('') })));
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIPPING_GUNMA_GID_202610]], shiftCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(mocks.laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(1200);
    const rows = await shippingLaborDetailRows(page);
    const byName = Object.fromEntries(rows.map(r => [r.name, r.cells[0]]));
    console.log('byName:', JSON.stringify(byName));
    check('高山(空欄)→標準労働時間シートの1日の時間(8.5h)', byName['高山'] === '8.5');
    check('平本(空欄)→標準労働時間シートの1日の時間(8.0h)', byName['平本'] === '8.0');
    check('ソー(空欄)→SAW MIN HTETで照合され7.5h', byName['ソー'] === '7.5');
    check('標準労働時間シート未登録の社員(新人太郎)は8.0h+補足', byName['新人太郎'] === '8.0');
    const notices = await shipLaborNotices(page);
    console.log('notices:', notices);
    check('未登録の補足に「新人太郎」が含まれる', notices.includes('新人太郎'));
    await page.close();
  }

  console.log('\n=== ④時刻(改行入り)・休・有休が、栽培と同じ時間になること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26)); // 8日
    const vals = ['8:00-\n17:00', '', '休', '有休', '', '', '', ''];
    const cellsByIso = {};
    dates.forEach((d, i) => { cellsByIso[isoKey(d)] = vals[i]; });
    const employees = [{ name: '高山', cellsByIso }];
    const others = [];
    const shiftCsv = buildGunmaShiftCsv('2026.10', employees, others);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIPPING_GUNMA_GID_202610]], shiftCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(1200);
    const rows = await shippingLaborDetailRows(page);
    const takayama = rows.find(r => r.name === '高山');
    console.log('高山 cells:', JSON.stringify(takayama && takayama.cells));
    check('「8:00-\\n17:00」(改行入り、拘束9h)→8.0h(休憩込みで固定8h)', takayama && takayama.cells[0] === '8.0');
    check('空欄(社員)→標準労働時間シートの1日の時間(8.5h)', takayama && takayama.cells[1] === '8.5');
    check('「休」→0.0h', takayama && takayama.cells[2] === '0.0');
    check('「有休」→0.0h', takayama && takayama.cells[3] === '0.0');
    await page.close();
  }

  console.log('\n=== ⑤過不足が、標準労働時間－パネル2の小計(群馬の販売抽出シートの実データ)になること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const cellsByIsoFor = (value) => Object.fromEntries(dates.map(d => [isoKey(d), value]));
    // 高山のみ、当日だけ出勤(標準労働時間8.5h)。他は空欄なので毎日8.5hになってしまうため、
    // 過不足を検証しやすいよう当日以外は「休」にする
    const cellsByIso = {};
    dates.forEach((d, i) => { cellsByIso[isoKey(d)] = (i === 0) ? '' : '休'; });
    const employees = [{ name: '高山', cellsByIso }];
    const shiftCsv = buildGunmaShiftCsv('2026.10', employees, []);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    const salesCsv = buildSalesSheetCsv('群馬', [dates[0]], [{ kind: '個数', product: '秀L6 130g', valuesByDate: { [isoKey(dates[0])]: 240 } }]);
    const urlCsv = buildSalesUrlListCsv([{ site: '群馬', kind: '受注', url: salesSheetUrl('gunma_shortfall', '9101') }]);
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIPPING_GUNMA_GID_202610]], shiftCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['gunma_shortfall', '9101']], salesCsv),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv({ shipFactors: { 'パック並べる': { factor: 30, unit: '秒' } } })),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(1200);
    const shortfall0 = await page.evaluate(() => document.querySelector('[data-shipshortfall-offset="0"]').textContent.trim());
    // 標準労働時間=8.5h、パネル2小計=パック数240×30秒=2.0h → 過不足=8.5-2.0=6.5
    const expected = Math.round((8.5 - 2.0) * 10) / 10;
    console.log('shortfall0:', shortfall0, 'expected:', expected);
    check(`過不足(標準労働時間8.5h－パネル2小計2.0h)=${expected}`, parseFloat(shortfall0) === expected);
    await page.close();
  }

  console.log('\n=== ⑥10/10以前・11/11以降の日が「－」と補足になること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sheetDates = dateRange(new Date(2026, 9, 11), new Date(2026, 10, 10)); // 2026/10/11〜11/10
    const cellsByIso = Object.fromEntries(sheetDates.map(d => [isoKey(d), '']));
    const employees = [{ name: '高山', cellsByIso }];
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8, shiftName: '高山' }];
    const shiftCsv = buildGunmaShiftCsv('2026.10', employees, []);
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIPPING_GUNMA_GID_202610]], shiftCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(800);
    // 基準日を11/8にする。offset0-7=11/8〜11/15(11/11以降は出荷場シートの範囲外=2026.9が未設定)
    await page.fill('#basisDateInput', '2026-11-08');
    await page.dispatchEvent('#basisDateInput', 'change');
    await page.waitForTimeout(1200);
    const totalsNov = await shipLaborTotals(page);
    console.log('totals(基準日11/8〜):', JSON.stringify(totalsNov));
    check('11/8〜11/10(シート範囲内)は値が表示される', totalsNov.slice(0, 3).every(v => v !== '－'));
    check('11/11以降(2026.9側の出荷場シートが未設定)は「－」になる', totalsNov.slice(3).every(v => v === '－'));
    const periodNotice = await page.evaluate(() => document.getElementById('shipLaborPeriodNotices').textContent.trim());
    console.log('periodNotice(11/8〜):', periodNotice);
    check('勤務表のシートが未設定の期間の補足が出る', periodNotice.includes('勤務表のシートが未設定の期間'));

    // 基準日を10/8にする。offset0-7=10/8〜10/15(10/10以前は2026.9側で未設定)
    await page.fill('#basisDateInput', '2026-10-08');
    await page.dispatchEvent('#basisDateInput', 'change');
    await page.waitForTimeout(1200);
    const totalsOct = await shipLaborTotals(page);
    console.log('totals(基準日10/8〜):', JSON.stringify(totalsOct));
    check('10/8〜10/10(2026.9側、未設定)は「－」になる', totalsOct.slice(0, 3).every(v => v === '－'));
    check('10/11以降(2026.10側、設定済み)は値が表示される', totalsOct.slice(3).every(v => v !== '－'));
    await page.close();
  }

  console.log('\n=== ⑦いなべの出荷パネル3(PR #492)、南丹の出荷パネル3(サンプル)が今までどおりであること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    const bannerInabe = await page.evaluate(() => getComputedStyle(document.getElementById('shippingSampleBanner')).display);
    check('いなべは引き続き実データ接続(サンプル帯が出ない)', bannerInabe === 'none');
    await page.click('[data-site="南丹"]');
    await page.waitForTimeout(1000);
    const bannerNantan = await page.evaluate(() => document.getElementById('shippingSampleBanner').textContent.trim());
    check('南丹は引き続きサンプルデータの帯が表示される', bannerNantan.includes('パネル3（標準労働時間）はサンプルデータです'));
    const rows = await shippingLaborDetailRows(page);
    check('南丹は引き続きサンプル名(「出荷 サンプル」)で表示される', rows.length > 0 && rows.every(r => r.name.startsWith('出荷 サンプル')));
    await page.close();
  }

  console.log('\n=== ⑧栽培の画面・値(群馬の収穫班シートの読み込み含む)が変更前と同じであること。栽培と出荷で読むシートが混ざらないこと ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const cellsByIsoFor = (value) => Object.fromEntries(dates.map(d => [isoKey(d), value]));
    // 収穫班(栽培)シート：野呂のみ(ソーはいない想定どおり)
    const cultEmployees = [{ name: '野呂', cellsByIso: cellsByIsoFor('') }];
    const cultShiftCsv = buildGunmaShiftCsv('2026.10', cultEmployees, []);
    const cultLaborRows = [{ flag: '1', site: '群馬', dept: '収穫', name: '野呂', hoursPerDay: 8, shiftName: '野呂' }];
    // 出荷場シート：高山のみ
    const shipEmployees = [{ name: '高山', cellsByIso: cellsByIsoFor('') }];
    const shipShiftCsv = buildGunmaShiftCsv('2026.10', shipEmployees, []);
    const CULT_GUNMA_GID_202610 = '2074687161'; // 栽培(収穫班)の既存gid
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, CULT_GUNMA_GID_202610]], cultShiftCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIPPING_GUNMA_GID_202610]], shipShiftCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(cultLaborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    // 栽培→出荷→栽培と素早く切り替える
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(1200);
    const cultRows1 = await page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => tr.querySelector('th').textContent.trim()));
    console.log('栽培(1回目):', JSON.stringify(cultRows1));
    check('栽培の人別内訳に野呂が表示される(収穫班シートの読み込みが変更前と同じ)', cultRows1.includes('野呂'));
    check('栽培に高山(出荷場側の人)が混ざらない', !cultRows1.includes('高山'));

    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(100);
    await page.click('[data-business="栽培"]');
    await page.waitForTimeout(100);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1200);
    const shipRows = await shippingLaborDetailRows(page);
    console.log('出荷(素早い切替後):', JSON.stringify(shipRows.map(r => r.name)));
    check('出荷側には高山だけが表示される(野呂が混ざらない)', shipRows.length === 1 && shipRows[0].name === '高山');

    await page.click('[data-business="栽培"]');
    await page.waitForTimeout(1200);
    const cultRows2 = await page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => tr.querySelector('th').textContent.trim()));
    console.log('栽培(切替後):', JSON.stringify(cultRows2));
    check('栽培側には野呂だけが表示される(高山が混ざらない)', cultRows2.includes('野呂') && !cultRows2.includes('高山'));
    await page.close();
  }

  console.log('\n=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');

  await browser.close();
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
