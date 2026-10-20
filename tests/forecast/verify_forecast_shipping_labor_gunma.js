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
const SHIP_GUNMA_GID_FAKE_202611 = '888777666'; // テスト用の仮gid(2026.11、次の月度の検証用)
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
function countingHandler(idGidPairs, body, counter) {
  return {
    match: (url) => idGidPairs.some(([id, gid]) => url.includes(id) && (gid === null || url.includes(`gid=${gid}`))),
    handle: async (route) => { counter.count++; await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body }); },
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
    cells: Array.from(tr.querySelectorAll('td:not(.total-col)')).slice(1).map(td => td.textContent.trim()),
    totalHtml: tr.querySelector('td.total-col') ? tr.querySelector('td.total-col').innerHTML.trim() : null,
  })));
}
async function shipLaborTotals(page) {
  return page.evaluate(() => Array.from({ length: 7 }, (_, o) =>
    document.querySelector(`[data-shiplabor-total-offset="${o}"]`).textContent.trim()));
}
async function shipLaborGrandTotal(page) {
  return page.evaluate(() => {
    const cell = document.querySelector('[data-shiplabor-total-offset="total"]');
    return { html: cell.innerHTML.trim(), text: cell.textContent.trim() };
  });
}
async function shipLaborNotices(page) {
  return page.evaluate(() => document.getElementById('shipLaborNotices').textContent.trim());
}
async function setFakeNextPeriodGid(page, periodKey, gid) {
  await page.evaluate(([periodKey, gid]) => {
    window.__test.FORECAST_SHIPPING_SHIFT_SOURCES['群馬'].gids[periodKey] = gid;
  }, [periodKey, gid]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let allOk = true;
  function check(name, cond) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}`); if (!cond) allOk = false; }

  console.log('=== ①休と休の間の空欄が出勤になること（「休, 空欄, 空欄, 休」） ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19); // 今日=2026/10/19
    const octDates = datesForPeriod('2026.10');
    // 3日周期で「休」を繰り返す(index0,3,6,9,...が休、その他は空欄)。先頭が休のため
    // 先頭の空欄の判断(前の月度にいるか)は関係ない
    const cells = Object.fromEntries(octDates.map((d, i) => [isoKey(d), (i % 3 === 0) ? '休' : '']));
    const octCsv = buildGunmaShiftCsv('2026.10', [{ name: '高山', cellsByIso: cells }]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setBasisDate(page, '2026-10-11'); // offset0-6 = index0-6
    const rows = await shippingLaborDetailRows(page);
    const takayama = rows.find(r => r.name === '高山');
    console.log('高山(休,空欄,空欄,休,...):', JSON.stringify(takayama && takayama.cells));
    check('index0(休)=0.0h', takayama && takayama.cells[0] === '0.0');
    check('index1(休と休の間の空欄)=出勤(8.5h)', takayama && takayama.cells[1] === '8.5');
    check('index2(休と休の間の空欄)=出勤(8.5h)', takayama && takayama.cells[2] === '8.5');
    check('index3(休)=0.0h', takayama && takayama.cells[3] === '0.0');
    const notices = await shipLaborNotices(page);
    check('休みの印の間の空欄にはアラートが出ない', !notices.includes('高山'));
    // 合計列：index0,3,6が休(0.0)で残り4日が出勤(8.5)。すべて実際に判断できた値(0.0h含む)
    // なので7日分の合計(8.5×4=34.0)になり「（◯日分）」は付かない
    const takayamaTotal = (await shippingLaborDetailRows(page)).find(r => r.name === '高山').totalHtml;
    console.log('高山 合計列:', takayamaTotal);
    check('合計列が7日分の合計(34.0)になり日数の注記が付かない', takayamaTotal === '34.0');
    await page.close();
  }

  console.log('\n=== ②月度の最後の休みの印の後の空欄が、次の月度に休みの印があれば出勤になること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sepDates = datesForPeriod('2026.9');
    const octDates = datesForPeriod('2026.10');
    const novPeriodDates = datesForPeriod('2026.11'); // 2026.11期間=11/11〜12/10
    // 9月度に高山がいる(先頭の空欄は既存の人として出勤になる)
    const sepCsv = buildGunmaShiftCsv('2026.9', [{ name: '高山', cellsByIso: Object.fromEntries(sepDates.map(d => [isoKey(d), ''])) }]);
    // 10月度：序盤に1回だけ休(10/15)、それ以降(10/16〜11/10)は全部空欄
    const octCells = Object.fromEntries(octDates.map(d => [isoKey(d), (d.getMonth() === 9 && d.getDate() === 15) ? '休' : '']));
    const octCsv = buildGunmaShiftCsv('2026.10', [{ name: '高山', cellsByIso: octCells }]);
    // 11月度(仮のgid)：高山がいて休みの印がある(どこでもよい。期間内の最初の日=11/11に設定)
    const novCsv = buildGunmaShiftCsv('2026.11', [{ name: '高山', cellsByIso: { [isoKey(novPeriodDates[0])]: '休' } }]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_FAKE_202611]], novCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setFakeNextPeriodGid(page, '2026.11', SHIP_GUNMA_GID_FAKE_202611);
    await setBasisDate(page, '2026-11-03'); // offset0-6 = 11/3〜11/9(すべて2026.10期間、最後の休(10/15)より後)
    const rows = await shippingLaborDetailRows(page);
    const takayama = rows.find(r => r.name === '高山');
    console.log('高山(11/3〜11/10、次月度に休みあり):', JSON.stringify(takayama && takayama.cells));
    check('最後の休み(10/15)より後の空欄(11/3〜11/10)が、次の月度に休みの印があるため出勤(8.5h)になる', takayama && takayama.cells.every(v => v === '8.5'));
    const notices = await shipLaborNotices(page);
    check('出勤と判断できたのでアラートは出ない', !notices.includes('高山'));
    await page.close();
  }

  console.log('\n=== ③次の月度を読めたが休みの印がない場合、休み扱い(計上しない)+アラートになること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sepDates = datesForPeriod('2026.9');
    const octDates = datesForPeriod('2026.10');
    const sepCsv = buildGunmaShiftCsv('2026.9', [{ name: '高山', cellsByIso: Object.fromEntries(sepDates.map(d => [isoKey(d), ''])) }]);
    const octCells = Object.fromEntries(octDates.map(d => [isoKey(d), (d.getMonth() === 9 && d.getDate() === 15) ? '休' : '']));
    const octCsv = buildGunmaShiftCsv('2026.10', [{ name: '高山', cellsByIso: octCells }]);
    // 11月度(仮のgid)：高山はいるが休みの印が一つもない
    const novCsv = buildGunmaShiftCsv('2026.11', [{ name: '高山', cellsByIso: {} }]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_FAKE_202611]], novCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setFakeNextPeriodGid(page, '2026.11', SHIP_GUNMA_GID_FAKE_202611);
    await setBasisDate(page, '2026-11-03');
    const rows = await shippingLaborDetailRows(page);
    const takayama = rows.find(r => r.name === '高山');
    console.log('高山(次月度に休みなし):', JSON.stringify(takayama && takayama.cells));
    check('次の月度に休みの印が無いため、休み扱い(0.0h)になる', takayama && takayama.cells.every(v => v === '0.0'));
    const notices = await shipLaborNotices(page);
    console.log('補足:', notices);
    check('「次の月度まで休みの記載がない」旨のアラートが出る(名前・日付範囲入り)', notices.includes('高山') && notices.includes('次の月度まで休みの記載がない') && notices.includes('11/3') && notices.includes('11/9'));
    await page.close();
  }

  console.log('\n=== ④次の月度が未設定の場合、最後の休みの印の後の空欄が計上されずアラートになること(実際の10月度構成のモック) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sepDates = datesForPeriod('2026.9');
    const octDates = datesForPeriod('2026.10');
    const sepCsv = buildGunmaShiftCsv('2026.9', [
      { name: '高山', cellsByIso: Object.fromEntries(sepDates.map(d => [isoKey(d), ''])) },
      { name: '平本', cellsByIso: Object.fromEntries(sepDates.map(d => [isoKey(d), ''])) },
    ]);
    // 高山：最後の休みが11/7。それ以降(11/8〜11/10)は空欄
    const takayamaCells = Object.fromEntries(octDates.map(d => [isoKey(d), (d.getMonth() === 10 && d.getDate() === 7) ? '休' : '']));
    // 平本：最後の休みが11/9。それ以降(11/10)は空欄
    const hiramotoCells = Object.fromEntries(octDates.map(d => [isoKey(d), (d.getMonth() === 10 && d.getDate() === 9) ? '休' : '']));
    const octCsv = buildGunmaShiftCsv('2026.10', [
      { name: '高山', cellsByIso: takayamaCells },
      { name: '平本', cellsByIso: hiramotoCells },
    ]);
    const laborRows = [
      { flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' },
      { flag: '1', site: '群馬', dept: '出荷場', name: '平本', hoursPerDay: 8, shiftName: '平本' },
    ];
    // 2026.11は設定しない(実際の構成どおり未設定)
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    // 基準日〜6日後(7日分)=11/4〜11/10にする(旧仕様の基準日11/3〜11/10の8日分から、
    // 表示が7日になった分だけ1日後ろにずらし、11/10までの同じ検証内容を保つ)
    await setBasisDate(page, '2026-11-04'); // offset0-6 = 11/4〜11/10
    const rows = await shippingLaborDetailRows(page);
    const takayama = rows.find(r => r.name === '高山');
    const hiramoto = rows.find(r => r.name === '平本');
    console.log('高山(11/4〜11/10):', JSON.stringify(takayama && takayama.cells), takayama && takayama.totalHtml);
    console.log('平本(11/4〜11/10):', JSON.stringify(hiramoto && hiramoto.cells), hiramoto && hiramoto.totalHtml);
    // 11/4〜11/6はoffset0-2、11/7がoffset3(休)、11/8〜11/10がoffset4-6(次の月度未設定)
    check('高山：11/4〜11/6(休み(11/7)より前)は出勤(8.5h)', takayama && takayama.cells.slice(0, 3).every(v => v === '8.5'));
    check('高山：11/7(休み)は0.0h', takayama && takayama.cells[3] === '0.0');
    check('高山：11/8〜11/10(次の月度未設定)は計上されない(0.0h)', takayama && takayama.cells.slice(4).every(v => v === '0.0'));
    check('平本：11/4〜11/8(休み(11/9)より前)は出勤(8.0h)', hiramoto && hiramoto.cells.slice(0, 5).every(v => v === '8.0'));
    check('平本：11/9(休み)は0.0h', hiramoto && hiramoto.cells[5] === '0.0');
    check('平本：11/10(次の月度未設定)は計上されない(0.0h)', hiramoto && hiramoto.cells[6] === '0.0');
    // 合計列：休み・次の月度未設定の空欄は「判断できず計上しない(null)」ではなく「0hと確定した値」
    // なので、7日分すべてが計上対象になり「（◯日分）」は付かない
    // 高山=8.5×3+0×4=25.5、平本=8.0×5+0×2=40.0
    check('高山の合計列が7日分の合計(25.5)になり日数の注記が付かない', takayama && takayama.totalHtml === '25.5');
    check('平本の合計列が7日分の合計(40.0)になり日数の注記が付かない', hiramoto && hiramoto.totalHtml === '40.0');
    const notices = await shipLaborNotices(page);
    console.log('補足:', notices);
    check('高山に「次の月度の勤務表がない」旨のアラートが出る(11/8〜11/10)', notices.includes('高山') && notices.includes('次の月度の勤務表がないため') && notices.includes('11/8') && notices.includes('11/10'));
    check('平本に「次の月度の勤務表がない」旨のアラートが出る(11/10)', notices.includes('平本') && notices.includes('11/10'));
    check('「次の月度のシートを設定すると判断できます」の案内が出る', notices.includes('次の月度のシートを設定すると判断できます'));
    await page.close();
  }

  console.log('\n=== ⑤前の月度にいる人で、行が全部空欄の場合、出勤にならず計上しない+アラートになること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sepDates = datesForPeriod('2026.9');
    const octDates = datesForPeriod('2026.10');
    const sepCsv = buildGunmaShiftCsv('2026.9', [{ name: '全部空欄太郎', cellsByIso: Object.fromEntries(sepDates.map(d => [isoKey(d), ''])) }]);
    const octCsv = buildGunmaShiftCsv('2026.10', [{ name: '全部空欄太郎', cellsByIso: Object.fromEntries(octDates.map(d => [isoKey(d), ''])) }]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '全部空欄太郎', hoursPerDay: 8, shiftName: '全部空欄太郎' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setBasisDate(page, '2026-10-11');
    const rows = await shippingLaborDetailRows(page);
    const zenbu = rows.find(r => r.name === '全部空欄太郎');
    const notices = await shipLaborNotices(page);
    console.log('全部空欄太郎(前月度にいるが今月は全部空欄):', JSON.stringify(zenbu && zenbu.cells), '補足:', notices);
    check('前の月度にいても、行が全部空欄なら出勤にならない(すべて0.0h)', zenbu && zenbu.cells.every(v => v === '0.0'));
    check('「行がすべて空欄」のアラートが出る(日付範囲なし)', notices.includes('勤務表の行がすべて空欄のため計上していません：全部空欄太郎'));
    await page.close();
  }

  console.log('\n=== ⑥先頭の空欄の扱いが今までどおりであること(例：10月度の高山の10/11〜10/13が出勤) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const sepDates = datesForPeriod('2026.9');
    const octDates = datesForPeriod('2026.10');
    const sepCsv = buildGunmaShiftCsv('2026.9', [{ name: '高山', cellsByIso: Object.fromEntries(sepDates.map(d => [isoKey(d), ''])) }]);
    // 先頭3日(10/11-10/13)空欄、以降は3日周期で休を挟む(中間の空欄が自己完結するように)
    const octCells = Object.fromEntries(octDates.map((d, i) => [isoKey(d), (i < 3) ? '' : (i % 3 === 0 ? '休' : '')]));
    const octCsv = buildGunmaShiftCsv('2026.10', [{ name: '高山', cellsByIso: octCells }]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202609]], sepCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setBasisDate(page, '2026-10-11');
    const rows = await shippingLaborDetailRows(page);
    const takayama = rows.find(r => r.name === '高山');
    console.log('高山(10/11〜、前月度にいる):', JSON.stringify(takayama && takayama.cells));
    check('先頭(10/11〜10/13)が既存の人として出勤(8.5h)になる', takayama && takayama.cells.slice(0, 3).every(v => v === '8.5'));
    const notices = await shipLaborNotices(page);
    check('既存の人として判断できたのでアラートは出ない', !notices.includes('高山'));
    await page.close();
  }

  console.log('\n=== ⑦有休・夏・振休など休以外の休みの印も休みの印として扱われ、「入社」は休みの印でないこと ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv())]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    const types = await page.evaluate(() => {
      const t = window.__test;
      return {
        yasumi: t.classifyGunmaShiftCell('休').type,
        yukyu: t.classifyGunmaShiftCell('有休').type,
        natsu: t.classifyGunmaShiftCell('夏').type,
        furikyu: t.classifyGunmaShiftCell('振休').type,
        ki: t.classifyGunmaShiftCell('季').type,
        daikyu: t.classifyGunmaShiftCell('代休').type,
        ketsu: t.classifyGunmaShiftCell('欠').type,
        shi: t.classifyGunmaShiftCell('シ').type,
        ki2: t.classifyGunmaShiftCell('忌').type,
        nyusha: t.classifyGunmaShiftCell('入社').type,
        jikoku: t.classifyGunmaShiftCell('9:00-17:00').type,
      };
    });
    console.log(JSON.stringify(types));
    ['yasumi', 'yukyu', 'natsu', 'furikyu', 'ki', 'daikyu', 'ketsu', 'shi', 'ki2'].forEach(k => {
      check(`「${k}」は休みの印(other)として分類される`, types[k] === 'other');
    });
    check('「入社」は休みの印でなくnyushaとして分類される', types.nyusha === 'nyusha');
    check('時刻は出勤の印(time)として分類される', types.jikoku === 'time');

    // classifyGunmaMiddleBlankPolicy()を直接呼び、「夏」のような休以外の印でも
    // 同じ月度の残りの判断に使えることを確認する
    const middleResult = await page.evaluate(() => {
      const t = window.__test;
      // 先頭=時刻、以降「」「夏」「」で、index1の空欄を判定する(index2の「夏」が後ろにある)
      const p = { firstEntryIdx: 0, lastRestIdx: 2 };
      return t.classifyGunmaMiddleBlankPolicy(p, 1, undefined);
    });
    check('「夏」のような休以外の印も、同じ月度の残りの休みの印として扱われ出勤と判定される', middleResult.counted === true);
    await page.close();
  }

  console.log('\n=== ⑧表示7日間に「次の月度が必要な空欄」が無いときは、次の月度のシートを読まないこと ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const octDates = datesForPeriod('2026.10');
    // 3日周期で休を繰り返す(①と同じ、全ての空欄が同じ月度内で自己完結する)
    const cells = Object.fromEntries(octDates.map((d, i) => [isoKey(d), (i % 3 === 0) ? '休' : '']));
    const octCsv = buildGunmaShiftCsv('2026.10', [{ name: '高山', cellsByIso: cells }]);
    const novCsv = buildGunmaShiftCsv('2026.11', [{ name: '高山', cellsByIso: {} }]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    const novCounter = { count: 0 };
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      countingHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_FAKE_202611]], novCsv, novCounter),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows)),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await gotoGunmaShipping(page);
    await setFakeNextPeriodGid(page, '2026.11', SHIP_GUNMA_GID_FAKE_202611);
    await setBasisDate(page, '2026-10-11'); // 表示する7日間はすべて同じ月度内の休みの印で解決できる
    await page.waitForTimeout(500);
    console.log('2026.11(仮)への読み込み回数:', novCounter.count);
    check('次の月度のシートが読まれない(不要な読み込みをしない)', novCounter.count === 0);
    await page.close();
  }

  console.log('\n=== ⑨吉村(出)・高橋(出)が集計されない。栽培(収穫班)が変更前と同じ。いなべ・南丹が今までどおり ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const octDates = datesForPeriod('2026.10');
    const cellsFor = () => Object.fromEntries(octDates.map((d, i) => [isoKey(d), (i % 3 === 0) ? '休' : '']));
    const octCsv = buildGunmaShiftCsv('2026.10', [
      { name: '高山', cellsByIso: cellsFor() },
      { name: '吉村(出)', cellsByIso: cellsFor() },
      { name: '高橋(出)', cellsByIso: cellsFor() },
    ]);
    const laborRows = [{ flag: '1', site: '群馬', dept: '出荷場', name: '高山', hoursPerDay: 8.5, shiftName: '高山' }];
    // 栽培(収穫班)のモック：野呂(社員、空行前)、助っ人(パート、空行後、全日空欄)
    const cultCsv = buildGunmaShiftCsv('2026.10', [
      { name: '野呂', cellsByIso: Object.fromEntries(octDates.map(d => [isoKey(d), ''])) },
      { name: '助っ人', cellsByIso: Object.fromEntries(octDates.map(d => [isoKey(d), ''])) },
    ], { blankSeparatorAfterIndex: 0 });
    const cultLaborRows = [
      { flag: '1', site: '群馬', dept: '収穫', name: '野呂', hoursPerDay: 8, shiftName: '野呂' },
      { flag: '1', site: '群馬', dept: '収穫', name: '助っ人', hoursPerDay: 6, shiftName: '助っ人' },
    ];
    await setupRoutes(page, [
      staticHandler([[GUNMA_SHIFT_SHEET_ID, SHIP_GUNMA_GID_202610]], octCsv),
      staticHandler([[GUNMA_SHIFT_SHEET_ID, CULT_GUNMA_GID_202610]], cultCsv),
      staticHandler([[STD_LABOR_HOURS_SHEET.id, STD_LABOR_HOURS_SHEET.gid]], buildStdLaborCsv(laborRows.concat(cultLaborRows))),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    // 栽培側をまず確認
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-site="群馬"]');
    await setBasisDate(page, '2026-10-11');
    const cultRows = await page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => ({
      name: tr.querySelector('th').textContent.trim(),
      cells: Array.from(tr.querySelectorAll('td:not(.total-col)')).slice(1).map(td => td.textContent.trim()),
    })));
    const noro = cultRows.find(r => r.name === '野呂');
    const sukedachi = cultRows.find(r => r.name === '助っ人');
    console.log('野呂(社員・空行前):', JSON.stringify(noro && noro.cells));
    console.log('助っ人(パート・空行後):', JSON.stringify(sukedachi && sukedachi.cells));
    check('栽培(収穫班)：社員(空行の前)の空欄は今までどおり出勤(標準労働時間8.0h)になる(休みの印ルールの影響を受けない)', noro && noro.cells.every(v => v === '8.0'));
    check('栽培(収穫班)：パート(空行の後)の空欄は今までどおり計上されない(0.0h)', sukedachi && sukedachi.cells.every(v => v === '0.0'));

    // 出荷側(群馬)
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1200);
    const shipRows = await shippingLaborDetailRows(page);
    const shipNames = shipRows.map(r => r.name);
    console.log('出荷(群馬)の人別内訳:', JSON.stringify(shipNames));
    check('吉村(出)が集計されない', !shipNames.includes('吉村(出)'));
    check('高橋(出)が集計されない', !shipNames.includes('高橋(出)'));

    // いなべ・南丹
    await page.click('[data-site="いなべ"]');
    await page.waitForTimeout(800);
    const bannerInabe = await page.evaluate(() => getComputedStyle(document.getElementById('shippingSampleBanner')).display);
    check('いなべの出荷パネル3は今までどおり実データ接続(サンプル帯が出ない)', bannerInabe === 'none');
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
