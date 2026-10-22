// 直近工数計画「出荷」パネル1・2の「作業日Dの列には出荷日D+1のデータを表示する」機能の検証。
// パネル3(標準労働時間)は列の日付(作業日自身)のまま変えないこと、過不足(パネル2とパネル3の
// 比較)が同じ列番号どうしで比較されていること(ナイーブに列自身の日付のデータを使った場合と
// 異なる値になるケースで確認)、栽培には影響しないことを中心に確認する。
// 実績/受注の判定がユーザー指示の例どおりになることは tests/forecast/verify_forecast_shipping_sales.js
// の②-2で、日付の列が無い場合の「－」・合計の部分合計＋「（◯日分）」は同ファイルの⑤と
// verify_regression_consolidated.js の⑦で確認済みのため、本ファイルでは重複させない。
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
function isoKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STD_WORK_HOURS_GID = '264266810';
const SALES_URL_SHEET_GID = '1130067935';
const CULTIVATION_SHEETS = {
  'いなべ': { id: '1X8RMzKwg_DoVMogqCRh78bcqecVgHzvRWc5FeKc1TPM', gid: '1452537379' },
};
// いなべの出荷の勤務表(栽培と同じ旧シフト表システム)
const SHIFT_SHEET_ID = '12xrXyXUSbiQVUWsAC7mbrExyWrIw863Oleq_1v81vRw';
const SHIFT_SHEET_GID = '872290181';

function buildStdWorkHoursCsv(opts) {
  opts = opts || {};
  const rows = [];
  rows.push(['', '', '', '', '', '', '', '']);
  rows.push(['cs数=(合計点数-バラ数)÷P/cs+バラ数', '', '', '', '', '', '', '']);
  rows.push(['パック・袋P/cs', '', '', '', '', '', '', '']);
  rows.push(['30', '', '', '', '', '', '', '']);
  const shipFactors = opts.shipFactors || { 'パック並べる': { factor: 1, unit: 'h' } };
  Object.keys(shipFactors).forEach((waku, i) => {
    const f = shipFactors[waku];
    rows.push([i === 0 ? '出荷' : '', waku, f.factor, '', '', '', '', f.unit]);
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
// いなべの旧シフト表(栽培と共通)相当のCSV。dayHoursByIso: { iso: '8:00-17:00'等 | '' }
function buildInabeShiftCsv(dates, dayHoursByIso) {
  const rows = [['', ''].concat(dates.map(d => `${d.getMonth() + 1}/${d.getDate()}`))];
  for (let i = 1; i < 13; i++) rows.push(['', '']);
  rows.push(['山田', '出荷'].concat(dates.map(d => dayHoursByIso[isoKey(d)] || '')));
  return toCsvText(rows);
}
function buildCultCsv(start, end) {
  const dates = []; for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) dates.push(new Date(d));
  const header = ['', '', ''].concat(dates.map(d => `${d.getMonth() + 1}/${d.getDate()}`));
  const weekdayRow = ['', '', ''].concat(dates.map(d => WD[d.getDay()]));
  const row = ['1', '', '1'].concat(dates.map(() => '収穫'));
  return toCsvText([header, weekdayRow, row]);
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

  console.log('=== ①基準日が今日でない場合も、列見出しの出荷日の注記(個別・合計)が作業日+1日で正しく計算されること ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 11, 1); // 今日=2026/12/1(出荷データ自体は使わないため何でもよい)
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(500);
    // 基準日を2027-02-20にする(今日から離れた任意の過去日)。作業日の列0-6=2/20〜2/26、出荷日=2/21〜2/27
    await page.fill('#basisDateInput', '2027-02-20');
    await page.dispatchEvent('#basisDateInput', 'change');
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({
      qtyCol0: document.querySelector('#table1ship thead .dcol-shipwork[data-offset="0"]').textContent.trim(),
      qtyCol6: document.querySelector('#table1ship thead .dcol-shipwork[data-offset="6"]').textContent.trim(),
      qtyTotal: document.querySelector('#table1ship thead .dcol-shipwork-total').textContent.trim(),
      workCol0: document.querySelector('#table2ship thead .dcol-shipwork[data-offset="0"]').textContent.trim(),
      workTotal: document.querySelector('#table2ship thead .dcol-shipwork-total').textContent.trim(),
      // 列自身の日付(作業日)はPR #497の仕組みのまま変わっていないこと
      ownDateCol0: document.querySelector('#table1ship thead .dcol[data-offset="0"]').textContent.trim(),
      ownRange: document.querySelector('#table1ship thead .dcol-total').textContent.trim(),
    }));
    console.log(JSON.stringify(r));
    check('パネル1列0(作業日2/20)の出荷日注記が「出荷 2/21」になる', r.qtyCol0 === '出荷 02/21');
    check('パネル1列6(作業日2/26)の出荷日注記が「出荷 2/27」になる', r.qtyCol6 === '出荷 02/27');
    check('パネル1合計列の出荷日範囲注記が「出荷 02/21〜02/27」になる', r.qtyTotal === '出荷 02/21〜02/27');
    check('パネル2にも同じ出荷日注記が付く', r.workCol0 === '出荷 02/21' && r.workTotal === '出荷 02/21〜02/27');
    check('列自身の日付(作業日)は従来どおり2/20のまま(出荷日ではない)', r.ownDateCol0.startsWith('02/20'));
    check('列自身の日付の合計範囲(作業日)は02/20〜02/26のまま', r.ownRange === '02/20〜02/26');
    await page.close();
  }

  console.log('\n=== ②パネル3(標準労働時間)は列の日付(作業日自身)のまま変わらないこと(曜日ごとに異なる労働時間で確認) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19); // 今日=2026/10/19
    const workDates = []; for (let o = 0; o < 7; o++) workDates.push(addDays(new Date(2026, 9, 19), o)); // 作業日10/19〜10/25
    // 作業日ごとに異なる労働時間(拘束-休憩)を設定：10/19=8h,10/20=7h,...のように8時始まりの終了時刻を変える
    const hoursByIso = {};
    const shiftHours = ['17:00', '16:00', '18:00', '15:00', '19:00', '14:00', '20:00']; // 8h,7h?... (拘束-1h休憩で計算)
    workDates.forEach((d, i) => { hoursByIso[isoKey(d)] = `8:00-${shiftHours[i]}`; });
    const shiftCsv = buildInabeShiftCsv(workDates, hoursByIso);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
      staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], shiftCsv),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1200);
    const laborByOffset = await page.evaluate(() => Array.from({ length: 7 }, (_, o) =>
      document.querySelector(`[data-shiplabor-total-offset="${o}"]`).textContent.trim()));
    console.log('labor:', JSON.stringify(laborByOffset));
    // 拘束時間(終業-8:00)から休憩時間を引いた値(労働基準法どおり：6h超で45分、8h超で60分控除)。
    // 8:00-17:00→拘束9h-休憩1h=8.0h, 8:00-18:00→拘束10h-休憩1h=9.0h,
    // 8:00-14:00→拘束6h-休憩0h=6.0h, 8:00-20:00→拘束12h-休憩1h=11.0h
    check('列0(作業日10/19、終業17:00)の標準労働時間は8.0h(列自身の日付のまま。出荷日10/20にシフトしていない)', laborByOffset[0] === '8.0');
    check('列2(作業日10/21、終業18:00)の標準労働時間は9.0h', laborByOffset[2] === '9.0');
    check('列5(作業日10/24、終業14:00)の標準労働時間は6.0h(拘束6hちょうどのため休憩控除なし)', laborByOffset[5] === '6.0');
    check('列6(作業日10/25、終業20:00)の標準労働時間は11.0h', laborByOffset[6] === '11.0');
    await page.close();
  }

  console.log('\n=== ③過不足(パネル2とパネル3の比較)が同じ列どうしで比較されること(ナイーブに列自身の出荷数量を使うと異なる値になる例) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19); // 今日=2026/10/19
    const workDate0 = new Date(2026, 9, 19); // 作業日10/19(列0)
    const ownDate0 = new Date(2026, 9, 19);   // 列0自身の日付(10/19) ※誤って使うとこちらの値を拾ってしまう
    const shippingDate0 = new Date(2026, 9, 20); // 列0が正しく使うべき出荷日(10/20)
    // 列0自身の日付(10/19)には「誤って使われたら気づける」ダミー値(パック5個=5h)、
    // 正しい出荷日(10/20)には本来の値(パック2個=2h)を置く。パネル2の標準工数は
    // パック数×1h/個(factor=1,unit='h')の単純な係数にして、丸め・秒換算を気にせず
    // 整数hで比較できるようにする
    const csv = buildSalesSheetCsv([ownDate0, shippingDate0], [
      { kind: '個数', product: '秀L6 130g', valuesByDate: { [isoKey(ownDate0)]: 5, [isoKey(shippingDate0)]: 2 } },
    ]);
    const urlCsv = buildSalesUrlListCsv([{ site: 'いなべ', kind: '受注', url: salesSheetUrl('shortfall_check', '9001') }]);
    // 労働時間：列0(作業日10/19)は8:00-18:00(拘束10h-休憩1h=9h)
    const shiftCsv = buildInabeShiftCsv([workDate0], { [isoKey(workDate0)]: '8:00-18:00' });
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], urlCsv),
      staticHandler([['shortfall_check', '9001']], csv),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv({ shipFactors: { 'パック並べる': { factor: 1, unit: 'h' } } })),
      staticHandler([[SHIFT_SHEET_ID, SHIFT_SHEET_GID]], shiftCsv),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({
      pack0: document.querySelector('[data-shipqty="パック数"][data-shipqty-offset="0"]').textContent.trim(),
      work0: document.querySelector('[data-shipwork="パック並べる"][data-shipwork-offset="0"]').textContent.trim(),
      labor0: document.querySelector('[data-shiplabor-total-offset="0"]').textContent.trim(),
      shortfall0: document.querySelector('[data-shipshortfall-offset="0"]').textContent.trim(),
    }));
    console.log(JSON.stringify(r));
    check('パネル1列0のパック数は出荷日(10/20)の値(2)。列自身の日付(10/19)のダミー値(5)ではない', r.pack0 === '2');
    check('パネル2列0の標準工数は2.0h(パック2個×1h)。ダミー値(5個→5h)ではない', r.work0 === '2.0');
    check('パネル3列0の標準労働時間は9.0h(列自身の日付10/19の労働時間のまま)', r.labor0 === '9.0');
    // 正しい(出荷日基準の)過不足＝9.0－2.0＝7.0。もし誤って列自身の日付の数量(5)を使うと
    // 9.0－5.0＝4.0になってしまうため、7.0であることでシフトが正しく列を揃えて
    // 比較されていることを確認する
    check('過不足が正しく7.0になる(労働時間9.0－出荷日基準の標準工数2.0。誤って列自身の日付を使うと4.0になってしまう)', r.shortfall0 === '7.0');
    await page.close();
  }

  console.log('\n=== ④栽培タブの画面・計算は変更されていないこと ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [
      staticHandler([[CULTIVATION_SHEETS['いなべ'].id, CULTIVATION_SHEETS['いなべ'].gid]], buildCultCsv(new Date(2025, 9, 1), new Date(2026, 10, 30))),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({
      harvest0: document.querySelector('[data-cult="収穫"][data-cult-offset="0"]').textContent.trim(),
      cultError: document.getElementById('cultError').classList.contains('show'),
      hasShipworkCol: document.querySelector('#table1cult thead .dcol-shipwork') !== null,
    }));
    check('栽培(いなべ)の収穫件数が従来どおり(1.0)', r.harvest0 === '1.0');
    check('栽培のパネル1がエラー表示にならない', !r.cultError);
    check('栽培の表には出荷日注記(.dcol-shipwork)が無い(出荷パネル専用のため)', !r.hasShipworkCol);
    await page.close();
  }

  console.log('\n=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');

  await browser.close();
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
