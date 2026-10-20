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

const CULTIVATION_SHEETS = {
  'いなべ': { id: '1X8RMzKwg_DoVMogqCRh78bcqecVgHzvRWc5FeKc1TPM', gid: '1452537379' },
  '群馬':   { id: '12Xa_bkHE5tw9-YgGPIONzAj9ex3jr0Au-3B1k6DSZDY', gid: '1776859904' },
};
const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STD_WORK_HOURS_GID = '264266810';
const SALES_URL_SHEET_GID = '1130067935';

function buildInabeCultCsv() {
  const dates = dateRange(new Date(2025, 9, 1), new Date(2026, 10, 30));
  const header = ['', '', ''].concat(dates.map(d => `${d.getMonth() + 1}/${d.getDate()}`));
  const weekdayRow = ['', '', ''].concat(dates.map(d => WD[d.getDay()]));
  const row = ['1', '', '1'].concat(dates.map(() => '収穫'));
  return toCsvText([header, weekdayRow, row]);
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

// DB共有「販売抽出シート(商品別)」の参照先一覧
function buildSalesUrlListCsv(entries) {
  const rows = [['拠点', '区分', 'URL']];
  entries.forEach(e => rows.push([e.site, e.kind, e.url]));
  return toCsvText(rows);
}
function salesSheetUrl(id, gid) { return `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${gid}`; }

// 販売抽出シート(商品別)の1タブ相当のCSV。productRows: [{kind:'個数'|'重量', product, valuesByDate:{iso:val}}]
function buildSalesSheetCsv(dates, productRows, opts) {
  opts = opts || {};
  const header = ['拠点', '個数/重量(kg)', '区分', '商品', '秀・優・袋①・袋②', 'サイズ'].concat(
    dates.map(d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`));
  const rows = [header];
  productRows.forEach(pr => {
    const cells = dates.map(d => {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const v = pr.valuesByDate[key];
      return v === undefined ? '' : v;
    });
    rows.push(['いなべ', pr.kind, '出荷', pr.product, '', ''].concat(cells));
  });
  if (!opts.noTrailingBlankRows) {
    for (let i = 0; i < 6; i++) rows.push(['', '', '', '', '', ''].concat(dates.map(() => '')));
  }
  return toCsvText(rows);
}
function isoKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

async function setupRoutes(page, handlers) {
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    for (const h of handlers) {
      if (h.match(url)) { await h.handle(route); return; }
    }
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' });
  });
}
function staticHandler(idGidPairs, body) {
  return {
    match: (url) => idGidPairs.some(([id, gid]) => url.includes(id) && (gid === null || url.includes(`gid=${gid}`))),
    handle: async (route) => { await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body }); },
  };
}

async function shippingQtyRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#table1shipBody tr')).map(tr => ({
    label: tr.querySelector('th').textContent.trim(),
    cells: Array.from(tr.querySelectorAll('td:not(.total-col)')).map(td => td.textContent.trim()),
    totalHtml: tr.querySelector('td.total-col') ? tr.querySelector('td.total-col').innerHTML.trim() : null,
    totalText: tr.querySelector('td.total-col') ? tr.querySelector('td.total-col').textContent.trim() : null,
  })));
}
async function shippingQtyDetailRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#table1shipDetailBody tr')).map(tr => ({
    label: tr.querySelector('th').textContent.trim(),
    cells: Array.from(tr.querySelectorAll('td:not(.total-col)')).map(td => td.textContent.trim()),
    totalText: tr.querySelector('td.total-col') ? tr.querySelector('td.total-col').textContent.trim() : null,
  })));
}
async function shippingKinds(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-kind-offset]')).map(el => el.textContent.trim()));
}
async function shippingTotalRangeHeader(page) {
  return page.evaluate(() => document.querySelector('#table1ship .dcol-total').textContent.trim());
}
async function shippingWorkRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#table2shipBody tr')).map(tr => ({
    label: tr.querySelector('th').textContent.trim(),
    cells: Array.from(tr.querySelectorAll('td:not(.total-col)')).map(td => td.textContent.trim()),
    totalText: tr.querySelector('td.total-col') ? tr.querySelector('td.total-col').textContent.trim() : null,
  })));
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let allOk = true;
  function check(name, cond) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}`); if (!cond) allOk = false; }

  console.log('=== ①いなべ・群馬・南丹とも、DB共有の一覧から実績・受注のタブの場所を見つけ、パネル1に値が表示されること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19); // 今日=2026/10/19
    const dates = []; for (let o = 0; o < 7; o++) { const d = new Date(2026, 9, 19); d.setDate(d.getDate() + o); dates.push(d); }
    const sites = ['いなべ', '群馬', '南丹'];
    const urlEntries = [];
    const handlers = [];
    sites.forEach((site, i) => {
      const orderId = `order_${i}`, orderGid = `${2000 + i}`;
      urlEntries.push({ site, kind: '受注', url: salesSheetUrl(orderId, orderGid) });
      const csv = buildSalesSheetCsv(dates, [{ kind: '個数', product: 'テスト商品A', valuesByDate: Object.fromEntries(dates.map((d, j) => [isoKey(d), 100 + i * 10 + j])) }]);
      handlers.push(staticHandler([[orderId, orderGid]], csv));
    });
    handlers.push(staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], buildSalesUrlListCsv(urlEntries)));
    handlers.push(staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()));
    await setupRoutes(page, handlers);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const headerRange = await shippingTotalRangeHeader(page);
    check('見出しが基準日〜6日後の7日分になり、合計列の見出しが期間(10/19〜10/25)になる', headerRange === '10/19〜10/25');
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      if (site !== 'いなべ') { await page.click(`[data-site="${site}"]`); await page.waitForTimeout(800); }
      const rows = await shippingQtyRows(page);
      const packRow = rows.find(r => r.label === 'パック数');
      const expected = String(100 + i * 10);
      check(`${site}：DB共有の一覧から受注のタブが見つかり、パネル1に値が表示される(${expected})`, packRow && packRow.cells[0] === expected);
      // 合計列：7日分(j=0..6)の合計＝7×(100+i×10)+21。7日分そろうので「（◯日分）」は付かない
      const expectedTotal = (7 * (100 + i * 10) + 21).toLocaleString('ja-JP');
      check(`${site}：合計列が7日分の合計(${expectedTotal})になり、日数の注記が付かない`, packRow.totalHtml === expectedTotal);
      const err = await page.evaluate(() => document.getElementById('shipQtyError').classList.contains('show'));
      check(`${site}：パネル1がエラー表示にならない`, !err);
    }
    await page.close();
  }

  console.log('\n=== ②今日より前の日は実績、今日以降は受注の値になり、列見出しに「実績」「受注」の印が付くこと ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19); // 今日=2026/10/19
    const actualDates = dateRange(new Date(2026, 9, 12), new Date(2026, 9, 18)); // 10/12〜10/18
    const orderDates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26)); // 10/19〜10/26
    const actualCsv = buildSalesSheetCsv(actualDates, [{ kind: '個数', product: '秀L6 130g', valuesByDate: Object.fromEntries(actualDates.map((d, i) => [isoKey(d), 500 + i])) }]);
    const orderCsv = buildSalesSheetCsv(orderDates, [{ kind: '個数', product: '秀L6 130g', valuesByDate: Object.fromEntries(orderDates.map((d, i) => [isoKey(d), 700 + i])) }]);
    const urlCsv = buildSalesUrlListCsv([
      { site: 'いなべ', kind: '実績', url: salesSheetUrl('actual_x', '3001') },
      { site: 'いなべ', kind: '受注', url: salesSheetUrl('order_x', '3002') },
    ]);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['actual_x', '3001']], actualCsv),
      staticHandler([['order_x', '3002']], orderCsv),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(800);
    // 基準日を10/17にする(過去)。offset0-7 = 10/17〜10/24
    await page.fill('#basisDateInput', '2026-10-17');
    await page.dispatchEvent('#basisDateInput', 'change');
    await page.waitForTimeout(1200);
    const rows = await shippingQtyRows(page);
    const kinds = await shippingKinds(page);
    const packRow = rows.find(r => r.label === 'パック数');
    console.log('packCells:', JSON.stringify(packRow.cells), 'kinds:', JSON.stringify(kinds));
    check('10/17(実績)=505', packRow.cells[0] === '505');
    check('10/18(実績)=506', packRow.cells[1] === '506');
    check('10/19(受注、今日を含む)=700', packRow.cells[2] === '700');
    check('10/20(受注)=701', packRow.cells[3] === '701');
    check('10/17・10/18の印が「実績」', kinds[0] === '実績' && kinds[1] === '実績');
    check('10/19以降の印が「受注」', kinds.slice(2).every(k => k === '受注'));
    await page.close();
  }

  console.log('\n=== ③判定ルールどおりに分かれること。設定の表を変えると判定が変わること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    await page.route('**/export**', async route => { await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' }); });
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const t = window.__test;
      return {
        a: t.classifyShippingProduct('秀L6 130g'),
        b: t.classifyShippingProduct('袋150g 150g'),
        c: t.classifyShippingProduct('優バラ1kg 1,000g'),
        d: t.classifyShippingProduct('秀袋 200g'),
        e: t.classifyShippingProduct('秀L バラ5kg 5,000g'),
        f: t.classifyShippingProduct(' 25g'),
        g: t.classifyShippingProduct('350g'),
        h: t.classifyShippingProduct('優2L袋 200g'),
        i: t.classifyShippingProduct('規格外袋500g'),
        j: t.classifyShippingProduct('規格外バラ3キロ'),
        k: t.classifyShippingProduct('秀バラ袋 200g'), // 「袋」と「バラ」の両方を含む→袋が優先
        ruleCount: t.SHIPPING_PRODUCT_CLASSIFICATION_RULES.length,
      };
    });
    console.log(JSON.stringify(r));
    check('「秀L6 130g」→パック', r.a === 'pack');
    check('「袋150g 150g」→袋', r.b === 'bag');
    check('「優バラ1kg 1,000g」→バラ', r.c === 'bara');
    check('「秀袋 200g」→袋', r.d === 'bag');
    check('「秀L バラ5kg 5,000g」→バラ', r.e === 'bara');
    check('「 25g」(商品名が空欄で重さだけ)→パックとして計上', r.f === 'pack');
    check('「350g」→パックとして計上', r.g === 'pack');
    check('「優2L袋 200g」→袋', r.h === 'bag');
    check('「規格外袋500g」→袋', r.i === 'bag');
    check('「規格外バラ3キロ」→バラ', r.j === 'bara');
    check('「袋」と「バラ」の両方を含む商品名→袋が優先される', r.k === 'bag');
    check('判定ルールが表(配列)として3件(袋→バラ→パック)存在する', r.ruleCount === 3);

    // 設定の表を直接書き換えて判定が変わることを確認(「バラ」を含む名前を強制的にパック扱いにする設定に差し替え)
    const changed = await page.evaluate(() => {
      const t = window.__test;
      const original = t.SHIPPING_PRODUCT_CLASSIFICATION_RULES.slice();
      t.SHIPPING_PRODUCT_CLASSIFICATION_RULES.length = 0;
      t.SHIPPING_PRODUCT_CLASSIFICATION_RULES.push({ label: '袋', kind: 'bag', test: function(name){ return name.indexOf('袋') !== -1; } });
      t.SHIPPING_PRODUCT_CLASSIFICATION_RULES.push({ label: 'パック(すべて)', kind: 'pack', test: function(){ return true; } });
      const after = t.classifyShippingProduct('優バラ1kg 1,000g');
      // 元に戻す
      t.SHIPPING_PRODUCT_CLASSIFICATION_RULES.length = 0;
      original.forEach(r => t.SHIPPING_PRODUCT_CLASSIFICATION_RULES.push(r));
      return after;
    });
    check('設定の表を変える(バラのルールを削除)と、「優バラ1kg」がパック判定に変わる', changed === 'pack');
    await page.close();
  }

  console.log('\n=== ④「重量」の行が点数に入らないこと(「個数」の行だけで数えること) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = [new Date(2026, 9, 19)];
    const csv = buildSalesSheetCsv(dates, [
      { kind: '個数', product: '秀L6 130g', valuesByDate: { [isoKey(dates[0])]: 100 } },
      { kind: '重量', product: '秀L6 130g', valuesByDate: { [isoKey(dates[0])]: 9999 } }, // 点数に混ざってはいけない大きな値
    ]);
    const urlCsv = buildSalesUrlListCsv([{ site: 'いなべ', kind: '受注', url: salesSheetUrl('o2', '4001') }]);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['o2', '4001']], csv),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const rows = await shippingQtyRows(page);
    const packRow = rows.find(r => r.label === 'パック数');
    console.log('pack0:', packRow.cells[0]);
    check('「重量」の行(9999)が点数(パック数)に混ざらず、「個数」の行(100)だけが使われる', packRow.cells[0] === '100');
    await page.close();
  }

  console.log('\n=== ⑤販売抽出シートにない日付(11月以降等)が「－」と補足になり、表示が止まらないこと。モックで日付の列を追加すると値が入ること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const orderDates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 24)); // 10/19〜10/24のみ(10/25,26は無い)
    const orderCsv = buildSalesSheetCsv(orderDates, [{ kind: '個数', product: '秀L6 130g', valuesByDate: Object.fromEntries(orderDates.map((d, i) => [isoKey(d), 300 + i])) }]);
    const urlCsv = buildSalesUrlListCsv([{ site: 'いなべ', kind: '受注', url: salesSheetUrl('o3', '5001') }]);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['o3', '5001']], orderCsv),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const rows = await shippingQtyRows(page);
    const packRow = rows.find(r => r.label === 'パック数');
    const notice = await page.evaluate(() => ({
      text: document.getElementById('shipQtyPeriodNotice').textContent,
      shown: document.getElementById('shipQtyPeriodNotice').style.display !== 'none',
    }));
    console.log('pack:', JSON.stringify(packRow.cells), 'notice:', JSON.stringify(notice));
    check('10/19〜10/24は値が表示される', packRow.cells.slice(0, 6).every(v => v !== '－'));
    check('10/25(シートに無い日付。基準日〜6日後の最後の日)は「－」になる', packRow.cells[6] === '－');
    check('「販売抽出シートに2026/10/25以降の日付がありません」の補足が出る(表示は止まらない)', notice.shown && notice.text.includes('2026/10/25'));
    // 合計列：10/19〜10/24の6日分(300+301+302+303+304+305=1815)の部分合計＋「（6日分）」になる
    console.log('pack total:', packRow.totalHtml);
    check('合計列が部分合計(1,815)になる', packRow.totalHtml.startsWith('1,815'));
    check('合計列に「（6日分）」の注記が付く', packRow.totalHtml.includes('（6日分）'));

    // モックで日付の列を右に追加する(10/25,26も含める)
    const orderDates2 = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 26));
    const orderCsv2 = buildSalesSheetCsv(orderDates2, [{ kind: '個数', product: '秀L6 130g', valuesByDate: Object.fromEntries(orderDates2.map((d, i) => [isoKey(d), 300 + i])) }]);
    const page2 = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page2, 2026, 9, 19);
    await setupRoutes(page2, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['o3', '5001']], orderCsv2),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page2.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page2.waitForTimeout(500);
    await page2.click('[data-business="出荷"]');
    await page2.waitForTimeout(1000);
    const rows2 = await shippingQtyRows(page2);
    const packRow2 = rows2.find(r => r.label === 'パック数');
    console.log('列追加後のpack:', JSON.stringify(packRow2.cells));
    check('モックで日付の列を追加すると、10/25にも値が入る', packRow2.cells[6] !== '－');
    check('7日分そろうと合計列に「（◯日分）」が付かない', !!packRow2.totalHtml && !packRow2.totalHtml.includes('日分'));
    await page.close();
    await page2.close();
  }

  console.log('\n=== ⑥パネル2が、パネル1の実データの数量から計算されること(例：パック数×30秒) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = [new Date(2026, 9, 19)];
    const csv = buildSalesSheetCsv(dates, [{ kind: '個数', product: '秀L6 130g', valuesByDate: { [isoKey(dates[0])]: 240 } }]);
    const urlCsv = buildSalesUrlListCsv([{ site: 'いなべ', kind: '受注', url: salesSheetUrl('o4', '6001') }]);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['o4', '6001']], csv),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv({ shipFactors: { 'パック並べる': { factor: 30, unit: '秒' } } })),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const workRows = await shippingWorkRows(page);
    const packWork = workRows.find(r => r.label === 'パック並べる');
    const expected = Math.round((240 * 30 / 3600) * 10) / 10; // 2.0h
    console.log('packWork0:', packWork.cells[0], 'expected:', expected);
    check('パネル2「パック並べる」= パック数(240) × 係数(30秒/個) = 2.0h', parseFloat(packWork.cells[0]) === expected);
    await page.close();
  }

  console.log('\n=== ⑦拠点・基準日を素早く切り替えても、最後の選択の値だけが表示されること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = [new Date(2026, 9, 19)];
    const delays = [3000, 1200, 50];
    const urlCsv = buildSalesUrlListCsv([
      { site: 'いなべ', kind: '受注', url: salesSheetUrl('race_inabe', '7001') },
      { site: '群馬', kind: '受注', url: salesSheetUrl('race_gunma', '7002') },
    ]);
    let callCount = 0;
    const inabeHandler = {
      match: (url) => url.includes('race_inabe') && url.includes('gid=7001'),
      handle: async (route) => {
        callCount++;
        await new Promise(r => setTimeout(r, 3000)); // いなべ(古い方)は常に遅い
        const csv = buildSalesSheetCsv(dates, [{ kind: '個数', product: '秀L6 130g', valuesByDate: { [isoKey(dates[0])]: 999 } }]);
        await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: csv });
      },
    };
    const gunmaHandler = {
      match: (url) => url.includes('race_gunma') && url.includes('gid=7002'),
      handle: async (route) => {
        await new Promise(r => setTimeout(r, 50)); // 群馬(新しい方)は速い
        const csv = buildSalesSheetCsv(dates, [{ kind: '個数', product: '秀L6 130g', valuesByDate: { [isoKey(dates[0])]: 50 } }]);
        await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: csv });
      },
    };
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      inabeHandler, gunmaHandler,
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]'); // いなべの受注取得(3000ms)が開始
    await page.waitForTimeout(200);
    await page.click('[data-site="群馬"]'); // いなべより先に群馬の応答(50ms)が届く
    await page.waitForTimeout(1200);
    const mid = await shippingQtyRows(page);
    const packMid = mid.find(r => r.label === 'パック数');
    console.log('群馬選択後すぐ:', packMid.cells[0]);
    check('群馬選択後すぐ、群馬の値(50)が表示される', packMid.cells[0] === '50');
    await page.waitForTimeout(2200); // いなべの3000ms応答が届くのを待つ(本来は捨てられるべき)
    const after = await shippingQtyRows(page);
    const packAfter = after.find(r => r.label === 'パック数');
    console.log('いなべの古い応答が届いた後も:', packAfter.cells[0]);
    check('いなべの古い応答が後から届いても、群馬の値(50)のまま(999に上書きされない)', packAfter.cells[0] === '50');
    const site = await page.evaluate(() => document.querySelector('#siteToggle button.active').dataset.site);
    check('拠点の選択状態も群馬のまま', site === '群馬');
    await page.close();
  }

  console.log('\n=== ⑧栽培の画面・値が変更前と同じであること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [
      staticHandler([[CULTIVATION_SHEETS['いなべ'].id, CULTIVATION_SHEETS['いなべ'].gid]], buildInabeCultCsv()),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({
      cultHarvest0: document.querySelector('[data-cult="収穫"][data-cult-offset="0"]').textContent.trim(),
      cultError: document.getElementById('cultError').classList.contains('show'),
    }));
    check('栽培(いなべ)の収穫件数が従来どおり(1.0)', r.cultHarvest0 === '1.0');
    check('栽培のパネル1がエラー表示にならない', !r.cultError);
    await page.close();
  }

  console.log('\n=== ⑨パネル1の個数の表示形式(整数+3桁区切り／cs数・kg詳細は小数1桁+3桁区切り)。計算に使う値は丸めないこと ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const d0 = new Date(2026, 9, 19);
    const csv = buildSalesSheetCsv([d0], [
      { kind: '個数', product: '秀L6 130g', valuesByDate: { [isoKey(d0)]: 2151 } },       // パック(個数)
      { kind: '重量', product: '秀L6 130g', valuesByDate: { [isoKey(d0)]: 1234.5 } },     // パック(重量kg)
      { kind: '個数', product: '袋150g 150g', valuesByDate: { [isoKey(d0)]: 2500 } },      // 袋(個数)
      { kind: '個数', product: '優バラ1kg 1,000g', valuesByDate: { [isoKey(d0)]: 1200 } }, // バラ(個数)
    ]);
    const urlCsv = buildSalesUrlListCsv([{ site: 'いなべ', kind: '受注', url: salesSheetUrl('fmt1', '8001') }]);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['fmt1', '8001']], csv),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv({ shipFactors: { 'パック並べる': { factor: 30, unit: '秒' } } })),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const rows = await shippingQtyRows(page);
    const detailRows = await shippingQtyDetailRows(page);
    const workRows = await shippingWorkRows(page);
    const pack = rows.find(r => r.label === 'パック数');
    const bag = rows.find(r => r.label === '袋数');
    const bara = rows.find(r => r.label === 'バラ数');
    const total = rows.find(r => r.label === '合計点数');
    const cs = rows.find(r => r.label === 'cs数');
    const packKg = detailRows.find(r => r.label === 'パック');
    const totalKg = detailRows.find(r => r.label === '合計');
    const packWork = workRows.find(r => r.label === 'パック並べる');
    console.log('pack:', pack.cells[0], 'bag:', bag.cells[0], 'bara:', bara.cells[0], 'total:', total.cells[0],
      'cs:', cs.cells[0], 'packKg:', packKg.cells[0], 'totalKg:', totalKg.cells[0], 'packWork:', packWork.cells[0]);
    // totalPieces=2151+2500+1200=5851, bara=1200, cs=(5851-1200)/30+1200=1355.0(小数点以下切り上げ前の生値のまま計算に使う)
    check('パック数が整数・3桁区切りで表示される(2,151)', pack.cells[0] === '2,151');
    check('袋数が整数・3桁区切りで表示される(2,500)', bag.cells[0] === '2,500');
    check('バラ数が整数・3桁区切りで表示される(1,200)', bara.cells[0] === '1,200');
    check('合計点数が整数・3桁区切りで表示される(5,851)', total.cells[0] === '5,851');
    check('cs数が小数1桁・3桁区切りで表示される(1,355.0)', cs.cells[0] === '1,355.0');
    check('詳細のパック(kg)が小数1桁・3桁区切りで表示される(1,234.5)', packKg.cells[0] === '1,234.5');
    check('詳細の合計(kg)が小数1桁・3桁区切りで表示される(1,234.5)', totalKg.cells[0] === '1,234.5');
    check('パネル2「パック並べる」はパネル1の表示用に丸める前の値(2151個)から計算され17.9hになる(2151×30秒÷3600)', packWork.cells[0] === '17.9');
    await page.close();
  }

  console.log('\n=== ⑩値がない日は従来どおり「－」のままであること(パネル1個数のみの表示形式変更で崩れないこと) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const orderDates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 19)); // 10/19のみ
    const orderCsv = buildSalesSheetCsv(orderDates, [{ kind: '個数', product: '秀L6 130g', valuesByDate: { [isoKey(orderDates[0])]: 1500 } }]);
    const urlCsv = buildSalesUrlListCsv([{ site: 'いなべ', kind: '受注', url: salesSheetUrl('fmt2', '8002') }]);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['fmt2', '8002']], orderCsv),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const rows = await shippingQtyRows(page);
    const detailRows = await shippingQtyDetailRows(page);
    const pack = rows.find(r => r.label === 'パック数');
    const cs = rows.find(r => r.label === 'cs数');
    const packKg = detailRows.find(r => r.label === 'パック');
    console.log('pack:', JSON.stringify(pack.cells), 'cs:', JSON.stringify(cs.cells));
    check('10/19は値が表示される(1,500)', pack.cells[0] === '1,500');
    check('値がない日(10/20以降)はパック数が「－」のまま', pack.cells.slice(1).every(v => v === '－'));
    check('値がない日(10/20以降)はcs数が「－」のまま', cs.cells.slice(1).every(v => v === '－'));
    check('値がない日(10/20以降)はkg詳細が「－」のまま', packKg.cells.slice(1).every(v => v === '－'));
    await page.close();
  }

  console.log('\n=== ⑪商品名が空欄で重さだけの行がパックとして計上され、除外の表示が出ないこと ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const d0 = new Date(2026, 9, 19);
    const csv = buildSalesSheetCsv([d0], [
      { kind: '個数', product: ' 25g', valuesByDate: { [isoKey(d0)]: 400 } },        // 商品名が空欄で重さだけ(群馬の例)
      { kind: '個数', product: '秀L6 130g', valuesByDate: { [isoKey(d0)]: 100 } },   // 通常のパック商品
    ]);
    const urlCsv = buildSalesUrlListCsv([{ site: 'いなべ', kind: '受注', url: salesSheetUrl('nameless1', '8101') }]);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['nameless1', '8101']], csv),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv({ shipFactors: { '段ボール詰める': { factor: 1, unit: 'h' } } })),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const rows = await shippingQtyRows(page);
    const workRows = await shippingWorkRows(page);
    const pack = rows.find(r => r.label === 'パック数');
    const total = rows.find(r => r.label === '合計点数');
    const cs = rows.find(r => r.label === 'cs数');
    const box = workRows.find(r => r.label === '段ボール詰める');
    console.log('pack:', pack.cells[0], 'total:', total.cells[0], 'cs:', cs.cells[0], '段ボール詰める:', box.cells[0]);
    // パック数=400(25g)+100(秀L6 130g)=500、合計点数=500、cs=500÷30=16.666...→16.7
    check('商品名が空欄で重さだけの行(「 25g」、400個)がパック数に含まれる(400+100=500)', pack.cells[0] === '500');
    check('合計点数にも含まれる(500)', total.cells[0] === '500');
    const expectedCs = Math.round((500 / 30) * 10) / 10;
    check(`cs数にも含まれる(${expectedCs})`, cs.cells[0] === expectedCs.toFixed(1));
    check('パネル2「段ボール詰める」がcs数(500÷30=16.7)から計算される', box.cells[0] === expectedCs.toFixed(1));
    const excludedBoxExists = await page.evaluate(() => document.getElementById('shipExcludedNote') !== null);
    check('詳細(折りたたみ)に「除外した商品」の表示欄が無い', !excludedBoxExists);
    await page.close();
  }

  console.log('\n=== ⑫合計列は丸める前の値を足してから丸めること(日ごとに丸めてから足すと誤差が積み重なる例) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.route('**/export**', async route => { await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' }); });
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const t = window.__test;
      const daily = [0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04]; // 日ごとに丸めると0.0×7=0.0になってしまう例
      const total = t.computeRowTotal(daily);
      return { value: total.value, count: total.count, fmt: t.fmtNum(total.value) };
    });
    console.log('0.04×7日分:', JSON.stringify(r));
    check('合計(丸める前)が0.28になる', Math.abs(r.value - 0.28) < 1e-9);
    check('7日分すべて計上される(count=7)', r.count === 7);
    check('表示は丸める前の値を足してから1回だけ丸めるため0.3になる(日ごとに丸めてから足す0.0にはならない)', r.fmt === '0.3');
    await page.close();
  }

  console.log('\n=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');

  await browser.close();
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
