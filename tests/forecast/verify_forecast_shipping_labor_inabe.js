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

const SHIFT_SHEET_ID = '12xrXyXUSbiQVUWsAC7mbrExyWrIw863Oleq_1v81vRw';
const SHIFT_SHEET_GID = '872290181';
const STD_LABOR_HOURS_SHEET = { id: '1LtYb1feXR6jtIEfxaADLiTEWpPabKJDDlwoS1V-yuG0', gid: '1404355975' };
const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STD_WORK_HOURS_GID = '264266810';
const SALES_URL_SHEET_GID = '1130067935';

// シフト表(いなべ栽培出荷シフト表)相当のCSV。1行目=日付、2行目=曜日、3〜13行目=空欄(ヘッダ等)、
// 14行目以降(0-based index13〜)=人。people: [{name, dept, cellsByIso: {iso: raw}}]
function buildShiftSheetCsv(dates, people) {
  const header = ['', ''].concat(dates.map(d => `${d.getMonth() + 1}/${d.getDate()}`));
  const weekdayRow = ['', ''].concat(dates.map(d => WD[d.getDay()]));
  const rows = [header, weekdayRow];
  for (let i = 0; i < 11; i++) rows.push(['', ''].concat(dates.map(() => ''))); // 3〜13行目(空欄)
  people.forEach(p => {
    const cells = dates.map(d => {
      const v = p.cellsByIso ? p.cellsByIso[isoKey(d)] : undefined;
      return v === undefined ? '' : v;
    });
    rows.push([p.name, p.dept].concat(cells));
  });
  return toCsvText(rows);
}

// 標準労働時間シート(ファーム勤務時間)相当のCSV。1〜2行目=空欄、3行目=ヘッダ(「シフト表名」を含む)、
// 4行目以降=データ。entries: [{flag, site, dept, name, hoursPerDay, shiftName}]
function buildStdLaborCsv(entries) {
  const COLS = 16;
  const blank = () => new Array(COLS).fill('');
  const rows = [blank(), blank()];
  const header = blank();
  header[15] = 'シフト表名';
  rows.push(header);
  entries.forEach(e => {
    const row = blank();
    row[1] = e.flag;
    row[3] = e.site;
    row[5] = e.dept;
    row[7] = e.name;
    row[9] = e.hoursPerDay !== undefined && e.hoursPerDay !== null ? String(e.hoursPerDay) : '';
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
  const cultFactors = { '菌床入れ': { factor: 10, unit: '分' }, '収穫': { factor: 50, unit: 'kg/h' } };
  Object.keys(cultFactors).forEach((waku, i) => {
    const f = cultFactors[waku];
    rows.push([i === 0 ? '栽培' : '', waku, f.factor, '', '', '', '', f.unit]);
  });
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
function buildSalesSheetCsv(dates, productRows) {
  const header = ['拠点', '個数/重量(kg)', '区分', '商品', '秀・優・袋①・袋②', 'サイズ'].concat(
    dates.map(d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`));
  const rows = [header];
  productRows.forEach(pr => {
    const cells = dates.map(d => {
      const key = isoKey(d);
      const v = pr.valuesByDate[key];
      return v === undefined ? '' : v;
    });
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

async function shippingLaborDetailRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#table3shipDetailBody tr')).map(tr => ({
    name: tr.querySelector('th').textContent.trim(),
    dept: tr.querySelector('td.dept-col').textContent.trim(),
    cells: Array.from(tr.querySelectorAll('td')).slice(1).map(td => td.textContent.trim()),
  })));
}
async function laborDetailRows(page) { // 栽培側
  return page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => ({
    name: tr.querySelector('th').textContent.trim(),
    dept: tr.querySelector('td.dept-col').textContent.trim(),
    cells: Array.from(tr.querySelectorAll('td')).slice(1).map(td => td.textContent.trim()),
  })));
}
async function shipLaborTotals(page) {
  return page.evaluate(() => Array.from({ length: 8 }, (_, o) =>
    document.querySelector(`[data-shiplabor-total-offset="${o}"]`).textContent.trim()));
}
async function shipLaborWarnings(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#shipLaborWarningsList li')).map(li => li.textContent.trim()));
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let allOk = true;
  function check(name, cond) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}`); if (!cond) allOk = false; }

  console.log('=== ①B列の部門「出荷」「配送・出荷」の行だけが集計され、「栽培」「配送・栽培」「生産部長」、空欄は入らないこと ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19); // 今日=2026/10/19
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const timeVal = '09:00-17:00'; // 拘束8h→休憩0.75引いて7.25h
    const people = [
      { name: 'A出荷', dept: '出荷', cellsByIso: Object.fromEntries(dates.map(d => [isoKey(d), timeVal])) },
      { name: 'B配送出荷', dept: '配送・出荷', cellsByIso: Object.fromEntries(dates.map(d => [isoKey(d), timeVal])) },
      { name: 'C栽培', dept: '栽培', cellsByIso: Object.fromEntries(dates.map(d => [isoKey(d), timeVal])) },
      { name: 'D配送栽培', dept: '配送・栽培', cellsByIso: Object.fromEntries(dates.map(d => [isoKey(d), timeVal])) },
      { name: 'E部長', dept: '生産部長', cellsByIso: Object.fromEntries(dates.map(d => [isoKey(d), timeVal])) },
      { name: 'F空欄', dept: '', cellsByIso: Object.fromEntries(dates.map(d => [isoKey(d), timeVal])) },
    ];
    await setupRoutes(page, [
      staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], buildShiftSheetCsv(dates, people)),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv([])),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const rows = await shippingLaborDetailRows(page);
    const names = rows.map(r => r.name).sort();
    console.log('names:', JSON.stringify(names));
    check('「出荷」「配送・出荷」の2名だけが人別内訳に入る', names.length === 2 && names.includes('A出荷') && names.includes('B配送出荷'));
    check('「栽培」「配送・栽培」「生産部長」「空欄」の行は入らない', !names.includes('C栽培') && !names.includes('D配送栽培') && !names.includes('E部長') && !names.includes('F空欄'));
    const total0 = (await shipLaborTotals(page))[0];
    check('合計時間(7.25×2=14.5)が反映される', total0 === '14.5');
    await page.close();
  }

  console.log('\n=== ②同じ名前の行が2つあり、片方のB列が「出荷」、もう片方が空欄の場合、「出荷」の行だけが数えられること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const people = [
      { name: '同姓同名', dept: '出荷', cellsByIso: Object.fromEntries(dates.map((d, i) => [isoKey(d), i === 0 ? '09:00-17:00' : ''])) },
      { name: '同姓同名', dept: '', cellsByIso: Object.fromEntries(dates.map((d, i) => [isoKey(d), i === 0 ? '1' : ''])) },
    ];
    await setupRoutes(page, [
      staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], buildShiftSheetCsv(dates, people)),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv([])),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const rows = await shippingLaborDetailRows(page);
    console.log('rows:', JSON.stringify(rows.map(r => ({ name: r.name, dept: r.dept, cell0: r.cells[0] }))));
    check('「同姓同名」の行は1件だけ(空欄の行は数えない)', rows.length === 1);
    check('数えられるのは「出荷」の行(時刻セル→7.3h)で、空欄の行(数値セル→本来なら未照合扱い)ではない', rows[0] && rows[0].dept === '出荷' && rows[0].cells[0] === '7.3');
    await page.close();
  }

  console.log('\n=== ③シフトの値の扱い（時刻・1・１・0.5・✖・休・夏季休暇・廃菌床処理）===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26)); // 8日
    const vals = ['09:00-17:00', '1', '１', '0.5', '✖', '休', '夏季休暇', '廃菌床処理'];
    const cellsByIso = {};
    dates.forEach((d, i) => { cellsByIso[isoKey(d)] = vals[i]; });
    const people = [{ name: '田中出荷', dept: '出荷', cellsByIso }];
    const labor = [{ flag: '1', site: 'いなべ', dept: '出荷', name: '田中出荷', hoursPerDay: 8, shiftName: '田中出荷' }];
    await setupRoutes(page, [
      staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], buildShiftSheetCsv(dates, people)),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(labor)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const rows = await shippingLaborDetailRows(page);
    const tanaka = rows.find(r => r.name === '田中出荷');
    console.log('田中出荷 cells:', JSON.stringify(tanaka && tanaka.cells));
    check('時刻(09:00-17:00、拘束8h-休憩0.75h=7.25hを1桁に丸めて表示)→7.3h', tanaka && tanaka.cells[0] === '7.3');
    check('「1」→1×8h=8.0h', tanaka && tanaka.cells[1] === '8.0');
    check('「１」(全角)→1×8h=8.0h', tanaka && tanaka.cells[2] === '8.0');
    check('「0.5」→0.5×8h=4.0h', tanaka && tanaka.cells[3] === '4.0');
    check('「✖」→0.0h', tanaka && tanaka.cells[4] === '0.0');
    check('「休」→0.0h', tanaka && tanaka.cells[5] === '0.0');
    check('「夏季休暇」→0.0h', tanaka && tanaka.cells[6] === '0.0');
    check('「廃菌床処理」(文字)→0.0h', tanaka && tanaka.cells[7] === '0.0');

    const otherWords = ['有休', '代休', '時間調整休', 'レンタカー返却', '自社配送', '志摩応援', '研修', '荷物'];
    const classifyResults = await page.evaluate((words) => words.map(w => window.__test.classifyCell(w).type), otherWords);
    check('有休・代休・時間調整休・レンタカー返却・自社配送・志摩応援・研修・荷物は、いずれもclassifyCell()で"other"(0時間)に分類される',
      classifyResults.every(t => t === 'other'));
    await page.close();
  }

  console.log('\n=== ④「1」の時間が標準労働時間シートの名前+部門で照合されること。部門不一致は未照合警告+0時間。エイリアス照合 ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const oneOnDay0 = Object.fromEntries(dates.map((d, i) => [isoKey(d), i === 0 ? '1' : '']));
    const people = [
      { name: '照合太郎', dept: '出荷', cellsByIso: oneOnDay0 },
      { name: '不一致花子', dept: '出荷', cellsByIso: oneOnDay0 },
      { name: 'アユブ', dept: '出荷', cellsByIso: oneOnDay0 },
      { name: 'イマム', dept: '出荷', cellsByIso: oneOnDay0 },
    ];
    const labor = [
      { flag: '1', site: 'いなべ', dept: '出荷', name: '照合太郎', hoursPerDay: 6, shiftName: '照合太郎' },
      { flag: '1', site: 'いなべ', dept: '栽培', name: '不一致花子', hoursPerDay: 8, shiftName: '' }, // 部門不一致
      { flag: '2', site: 'いなべ', dept: '出荷', name: 'MUHAMAD AYUB FAYYUQI', hoursPerDay: 7.5, shiftName: '' },
      { flag: '3', site: 'いなべ', dept: '出荷', name: 'IMAM ADI SAPUTRA', hoursPerDay: 7, shiftName: '' },
    ];
    await setupRoutes(page, [
      staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], buildShiftSheetCsv(dates, people)),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(labor)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const rows = await shippingLaborDetailRows(page);
    const byName = Object.fromEntries(rows.map(r => [r.name, r.cells[0]]));
    console.log('byName:', JSON.stringify(byName));
    check('シフト表名での照合：照合太郎 1×6h=6.0h', byName['照合太郎'] === '6.0');
    check('部門不一致(不一致花子：シフト表「出荷」⇔標準労働時間「栽培」)は0.0hになる', byName['不一致花子'] === '0.0');
    check('エイリアス照合：アユブ→MUHAMAD AYUB FAYYUQI 1×7.5h=7.5h', byName['アユブ'] === '7.5');
    check('エイリアス照合：イマム→IMAM ADI SAPUTRA 1×7h=7.0h', byName['イマム'] === '7.0');
    const warnings = await shipLaborWarnings(page);
    console.log('warnings:', JSON.stringify(warnings));
    check('部門不一致の人について未照合の警告が出る', warnings.some(w => w.includes('不一致花子')));
    check('照合できた人については警告が出ない', !warnings.some(w => w.includes('照合太郎') || w.includes('アユブ') || w.includes('イマム')));
    await page.close();
  }

  console.log('\n=== ⑤拠点シフト表のGASから読む場合も、部門「出荷」「配送・出荷」で絞り込まれること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    const result = await page.evaluate(async () => {
      const basisDate = new Date(2026, 9, 19);
      window.__gasFixture = {
        status: 'ok',
        persons: [
          { name: 'GAS出荷太郎', dept: '出荷', days: { '2026-10-19': 8 } },
          { name: 'GAS配送出荷', dept: '配送・出荷', days: { '2026-10-19': 5 } },
          { name: 'GAS栽培花子', dept: '栽培', days: { '2026-10-19': 8 } },
        ],
      };
      const origFetch = window.fetch;
      window.fetch = async (url) => {
        if (String(url).includes('action=hours')) {
          return { json: async () => window.__gasFixture };
        }
        return origFetch(url);
      };
      try {
        const persons = await window.__test.fetchShiftPersonsFromApp(basisDate, window.__test.SHIPPING_LABOR_DEPTS);
        return persons.map(p => p.name).sort();
      } finally {
        window.fetch = origFetch;
      }
    });
    console.log('GAS経由の結果:', JSON.stringify(result));
    check('GAS経由でも部門「出荷」「配送・出荷」の人だけに絞り込まれる', result.length === 2 && result.includes('GAS出荷太郎') && result.includes('GAS配送出荷'));
    check('部門「栽培」の人は含まれない', !result.includes('GAS栽培花子'));
    await page.close();
  }

  console.log('\n=== ⑥過不足が、標準労働時間－パネル2の小計(実データ)になること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const people = [{ name: '過不足花子', dept: '出荷', cellsByIso: Object.fromEntries(dates.map((d, i) => [isoKey(d), i === 0 ? '09:00-17:00' : ''])) }];
    const salesCsv = buildSalesSheetCsv([dates[0]], [{ kind: '個数', product: '秀L6 130g', valuesByDate: { [isoKey(dates[0])]: 240 } }]);
    const urlCsv = buildSalesUrlListCsv([{ site: 'いなべ', kind: '受注', url: salesSheetUrl('shortfall1', '9001') }]);
    await setupRoutes(page, [
      staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], buildShiftSheetCsv(dates, people)),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv([])),
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['shortfall1', '9001']], salesCsv),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv({ shipFactors: { 'パック並べる': { factor: 30, unit: '秒' } } })),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const shortfall0 = await page.evaluate(() => document.querySelector('[data-shipshortfall-offset="0"]').textContent.trim());
    // 標準労働時間=7.25h、パネル2小計=パック数240×30秒=2.0h → 過不足=7.25-2.0=5.25(切り捨てずround1桁)=5.3 (Math.round(5.25*10)/10=5.3の浮動小数点挙動に注意)
    const expected = Math.round((7.25 - 2.0) * 10) / 10;
    console.log('shortfall0:', shortfall0, 'expected:', expected);
    check(`過不足(標準労働時間7.25h－パネル2小計2.0h)=${expected}`, parseFloat(shortfall0) === expected);
    await page.close();
  }

  console.log('\n=== ⑦シフト表に日付がない日(11/11以降)が「－」と補足になること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sheetDates = dateRange(new Date(2026, 3, 11), new Date(2026, 10, 10)); // 2026/4/11〜11/10
    const people = [{ name: '範囲外太郎', dept: '出荷', cellsByIso: Object.fromEntries(sheetDates.map(d => [isoKey(d), '09:00-17:00'])) }];
    await setupRoutes(page, [
      staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], buildShiftSheetCsv(sheetDates, people)),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv([])),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    // 基準日を11/8にする。offset0-7 = 11/8〜11/15(11/11以降はシートの範囲外)
    await page.fill('#basisDateInput', '2026-11-08');
    await page.dispatchEvent('#basisDateInput', 'change');
    await page.waitForTimeout(1200);
    const totals = await shipLaborTotals(page);
    console.log('totals(基準日11/8〜):', JSON.stringify(totals));
    check('11/8〜11/10(シート範囲内)は値が表示される', totals.slice(0, 3).every(v => v !== '－'));
    check('11/11以降(シート範囲外)は「－」になる', totals.slice(3).every(v => v === '－'));
    const periodNotice = await page.evaluate(() => document.getElementById('shipLaborPeriodNotices').textContent.trim());
    console.log('periodNotice:', periodNotice);
    check('「シフト表に2026/11/11以降の日付がありません」の補足が出る', periodNotice.includes('2026/11/11'));
    await page.close();
  }

  console.log('\n=== ⑧群馬・南丹の出荷パネル3は、今までどおりサンプルであること ===');
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
    for (const site of ['群馬', '南丹']) {
      await page.click(`[data-site="${site}"]`);
      await page.waitForTimeout(800);
      const rows = await shippingLaborDetailRows(page);
      const bannerDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('shippingSampleBanner')).display);
      console.log(site, 'names:', JSON.stringify(rows.map(r => r.name)), 'bannerDisplay:', bannerDisplay);
      check(`${site}の出荷パネル3は引き続きサンプル名(「出荷 サンプル」)で表示される`, rows.every(r => r.name.startsWith('出荷 サンプル')));
      check(`${site}ではサンプルデータの帯が表示される`, bannerDisplay !== 'none');
    }
    await page.close();
  }

  console.log('\n=== ⑨栽培と出荷を素早く切り替えても、それぞれの部門の人だけが表示されること(部門が混ざらない) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const cells = Object.fromEntries(dates.map(d => [isoKey(d), '09:00-17:00']));
    // 同じシフト表(1枚)に栽培・出荷両方の人が混在している、という実際の構成を再現する
    const people = [
      { name: '栽培一郎', dept: '栽培', cellsByIso: cells },
      { name: '出荷二郎', dept: '出荷', cellsByIso: cells },
    ];
    await setupRoutes(page, [
      staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], buildShiftSheetCsv(dates, people)),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv([])),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    // 栽培→出荷→栽培→出荷と素早く切り替える
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(100);
    await page.click('[data-business="栽培"]');
    await page.waitForTimeout(100);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1200);
    const shipRows = await shippingLaborDetailRows(page);
    console.log('出荷側:', JSON.stringify(shipRows.map(r => r.name)));
    check('出荷側には「出荷二郎」だけが表示される(栽培一郎が混ざらない)', shipRows.length === 1 && shipRows[0].name === '出荷二郎');

    await page.click('[data-business="栽培"]');
    await page.waitForTimeout(1200);
    const cultRows = await laborDetailRows(page);
    console.log('栽培側:', JSON.stringify(cultRows.map(r => r.name)));
    check('栽培側には「栽培一郎」だけが表示される(出荷二郎が混ざらない)', cultRows.length === 1 && cultRows[0].name === '栽培一郎');
    await page.close();
  }

  console.log('\n=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');

  await browser.close();
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
