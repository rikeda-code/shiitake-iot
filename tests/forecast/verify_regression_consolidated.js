// 注意：本ファイルの前身のテスト群(verify_forecast_gunma.js等)は、タスクの合間に
// サンドボックス環境がリセットされ、スクラッチパッド(/tmp配下)の内容が失われたため
// 再構築した。production側のコード(dashboard/work-hours-forecast.html)自体は
// gitで永続化されており無事。本ファイルは、PR #459〜#490で入った各機能(栽培の
// いなべ・群馬・南丹対応、上部固定、群馬の収穫見込、描画の追い越し対策、基準日の
// 未来選択、出荷のレイアウト)について、現在のコードが引き続き正しく動くことを
// 一通り確認する、新規の回帰確認テストである
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
function q(business, site) { return '?div=' + encodeURIComponent(business) + '&site=' + encodeURIComponent(site); }

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
const INABE_HARVEST_ID = '1B7XEllKSlCEfkBPmNf_fvAz48I6XvMS3hfT_Dy4w_Tw';
const INABE_HARVEST_GID = '1164843574';

function buildCultCsv(start, end) {
  const dates = dateRange(start, end);
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
  rows.push(['30', '', '', '', '', '', '', '']);
  const cultFactors = { '菌床入れ': { factor: 10, unit: '分' }, '収穫': { factor: 50, unit: 'kg/h' } };
  Object.keys(cultFactors).forEach((waku, i) => {
    const f = cultFactors[waku];
    rows.push([i === 0 ? '栽培' : '', waku, f.factor, '', '', '', '', f.unit]);
  });
  const shipFactors = { 'パック並べる': { factor: 10, unit: '秒' }, '付帯作業': { factor: '', unit: '' } };
  Object.keys(shipFactors).forEach((waku, i) => {
    const f = shipFactors[waku];
    rows.push([i === 0 ? '出荷' : '', waku, f.factor, '', '', '', '', f.unit]);
  });
  return toCsvText(rows);
}
function buildInabeHarvestCsv(dayValues) {
  const header = ['', '2026.10'];
  const rows = [header];
  for (let d = 1; d <= 31; d++) rows.push(['', dayValues[d] === undefined ? '' : dayValues[d]]);
  return toCsvText(rows);
}
function buildGunmaTransferCsv(dayValues) {
  const header = ['', '見込み1', '2026.10'];
  const rows = [header];
  for (let d = 1; d <= 31; d++) rows.push(['', '', dayValues[d] === undefined ? '' : dayValues[d]]);
  return toCsvText(rows);
}
function salesSheetUrl(id, gid) { return `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${gid}`; }
function isoKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
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

function allSalesHandlers(site, dates) {
  const id = 'sales_' + site, gid = '9999';
  const csv = buildSalesSheetCsv(dates, [{ kind: '個数', product: '秀L6 130g', valuesByDate: Object.fromEntries(dates.map((d, i) => [isoKey(d), 100 + i])) }]);
  return { urlEntry: { site, kind: '受注', url: salesSheetUrl(id, gid) }, handler: staticHandler([[id, gid]], csv) };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let allOk = true;
  function check(name, cond) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}`); if (!cond) allOk = false; }

  console.log('=== ①栽培：いなべ・群馬・南丹とも、パネル1〜3がエラーなく表示されること(PR #459,460,465,466,486) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [
      staticHandler([[CULTIVATION_SHEETS['いなべ'].id, CULTIVATION_SHEETS['いなべ'].gid]], buildCultCsv(new Date(2025, 9, 1), new Date(2026, 10, 30))),
      staticHandler([[CULTIVATION_SHEETS['群馬'].id, CULTIVATION_SHEETS['群馬'].gid]], buildCultCsv(new Date(2023, 0, 1), new Date(2026, 11, 31))),
      staticHandler([[CULTIVATION_SHEETS['南丹'].id, CULTIVATION_SHEETS['南丹'].gid]], buildCultCsv(new Date(2023, 1, 25), new Date(2026, 11, 31))),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
      staticHandler([[INABE_HARVEST_ID, INABE_HARVEST_GID]], buildInabeHarvestCsv({ 19: 500 })),
      staticHandler([[GUNMA_TRANSFER_ID, GUNMA_TRANSFER_GID]], buildGunmaTransferCsv({ 19: 300 })),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);
    for (const site of ['いなべ', '群馬', '南丹']) {
      if (site !== 'いなべ') { await page.click(`[data-site="${site}"]`); await page.waitForTimeout(1200); }
      const r = await page.evaluate(() => ({
        cultHarvest0: document.querySelector('[data-cult="収穫"][data-cult-offset="0"]').textContent.trim(),
        cultError: document.getElementById('cultError').classList.contains('show'),
        workError: document.getElementById('workError').classList.contains('show'),
        laborError: document.getElementById('laborError').classList.contains('show'),
      }));
      check(`${site}：収穫件数が表示される(1.0)`, r.cultHarvest0 === '1.0');
      check(`${site}：パネル1・2・3がエラー表示にならない`, !r.cultError && !r.workError && !r.laborError);
    }
    await page.close();
  }

  console.log('\n=== ②上部固定(.sticky-head)がスクロールしても表示され続けること(PR #485) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [
      staticHandler([[CULTIVATION_SHEETS['いなべ'].id, CULTIVATION_SHEETS['いなべ'].gid]], buildCultCsv(new Date(2025, 9, 1), new Date(2026, 10, 30))),
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
      staticHandler([[INABE_HARVEST_ID, INABE_HARVEST_GID]], buildInabeHarvestCsv({ 19: 500 })),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => { document.querySelectorAll('details').forEach(d => { d.open = true; }); });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(300);
    const rect = await page.evaluate(() => document.querySelector('.sticky-head').getBoundingClientRect());
    check('スクロール後も.sticky-headがビューポート上端(top=0)に固定される', Math.abs(rect.top) < 1);
    await page.close();
  }

  console.log('\n=== ③基準日の未来選択と見出しの当日/基準日切り替え(PR #488) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [staticHandler([[CULTIVATION_SHEETS['いなべ'].id, CULTIVATION_SHEETS['いなべ'].gid]], buildCultCsv(new Date(2025, 9, 1), new Date(2026, 10, 30)))]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    const labelsToday = await page.evaluate(() => Array.from(document.querySelectorAll('#supportedPanels .basis-label-0')).map(el => el.textContent.trim()));
    check('基準日=今日のとき見出しが「当日」', labelsToday.every(v => v === '当日'));
    await page.fill('#basisDateInput', '2026-10-30'); // 未来
    await page.dispatchEvent('#basisDateInput', 'change');
    await page.waitForTimeout(600);
    const dateVal = await page.evaluate(() => document.getElementById('basisDateInput').value);
    check('未来の日付(2026-10-30)を選べる', dateVal === '2026-10-30');
    const labelsFuture = await page.evaluate(() => Array.from(document.querySelectorAll('#supportedPanels .basis-label-0')).map(el => el.textContent.trim()));
    check('未来の基準日のとき見出しが「基準日」に切り替わる', labelsFuture.every(v => v === '基準日'));
    await page.close();
  }

  console.log('\n=== ④render()の世代チェック：拠点を素早く切り替えても最後の選択だけが表示されること(PR #487、栽培) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const delaysCsv = {
      match: (url) => url.includes(CULTIVATION_SHEETS['いなべ'].id),
      handle: async (route) => { await new Promise(r => setTimeout(r, 3000)); await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: buildCultCsv(new Date(2025, 9, 1), new Date(2026, 10, 30)) }); },
    };
    const fastCsv = {
      match: (url) => url.includes(CULTIVATION_SHEETS['群馬'].id),
      handle: async (route) => { await new Promise(r => setTimeout(r, 50)); await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: buildCultCsv(new Date(2023, 0, 1), new Date(2026, 11, 31)) }); },
    };
    await setupRoutes(page, [delaysCsv, fastCsv]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(300);
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(1500);
    const site = await page.evaluate(() => document.querySelector('#siteToggle button.active').dataset.site);
    check('群馬選択後、拠点の選択状態が群馬のまま(いなべの遅い応答に巻き戻らない想定)', site === '群馬');
    await page.waitForTimeout(2500);
    const siteAfter = await page.evaluate(() => document.querySelector('#siteToggle button.active').dataset.site);
    const cultErrorAfter = await page.evaluate(() => document.getElementById('cultError').classList.contains('show'));
    check('いなべの古い応答が後から届いても、拠点の選択状態は群馬のまま', siteAfter === '群馬');
    check('いなべの古い応答によってエラー表示にもならない(世代チェックで描画自体が捨てられる)', !cultErrorAfter);
    await page.close();
  }

  console.log('\n=== ⑤出荷：いなべ・群馬・南丹ともパネル1〜3が表示され、付帯作業が群馬・南丹のみ表示されること(PR #490) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    const dates = []; for (let o = 0; o < 8; o++) { const d = new Date(2026, 9, 19); d.setDate(d.getDate() + o); dates.push(d); }
    const s1 = allSalesHandlers('いなべ', dates);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, SALES_URL_SHEET_GID]], buildSalesUrlListCsv([s1.urlEntry])),
      s1.handler,
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(1000);
    const bannerDisplayInabe = await page.evaluate(() => getComputedStyle(document.getElementById('shippingSampleBanner')).display);
    check('いなべの出荷パネル3は実データ接続のため、サンプルデータの帯が表示されない(PR #492)', bannerDisplayInabe === 'none');
    const inabeTaifu = await page.evaluate(() => !!Array.from(document.querySelectorAll('#table2shipBody tr')).find(tr => tr.querySelector('th').textContent.trim() === '付帯作業'));
    check('いなべでは付帯作業の行が表示されない', !inabeTaifu);
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(800);
    const bannerDisplayGunma = await page.evaluate(() => getComputedStyle(document.getElementById('shippingSampleBanner')).display);
    check('群馬の出荷パネル3も実データ接続のため、サンプルデータの帯が表示されない(PR #494)', bannerDisplayGunma === 'none');
    const gunmaTaifu = await page.evaluate(() => {
      const tr = Array.from(document.querySelectorAll('#table2shipBody tr')).find(tr => tr.querySelector('th').textContent.trim() === '付帯作業');
      return tr ? tr.querySelector('td').textContent.trim() : null;
    });
    check('群馬では付帯作業の行が「－」付きで表示される', gunmaTaifu && gunmaTaifu.startsWith('－'));
    const gunmaLaborError = await page.evaluate(() => document.getElementById('shipLaborError').classList.contains('show'));
    check('群馬の出荷パネル3(標準労働時間)はシート未モックでもエラー表示にならない(未設定期間の補足のみ)', !gunmaLaborError);
    await page.click('[data-site="南丹"]');
    await page.waitForTimeout(800);
    const bannerTextNantan = await page.evaluate(() => document.getElementById('shippingSampleBanner').textContent.trim());
    check('南丹では、パネル3用のサンプルデータの帯が引き続き表示される', bannerTextNantan.includes('パネル3（標準労働時間）はサンプルデータです'));
    const laborTotalNantan = await page.evaluate(() => document.querySelector('[data-shiplabor-total-offset="0"]').textContent.trim());
    check('南丹の出荷パネル3(標準労働時間)がサンプル値で表示される(「－」のまま止まっていない)', laborTotalNantan !== '－');
    await page.close();
  }

  console.log('\n=== ⑥区分・拠点の選択がURL・再読み込み後も保持されること(PR #462) ===');
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [
      staticHandler([[CULTIVATION_SHEETS['群馬'].id, CULTIVATION_SHEETS['群馬'].gid]], buildCultCsv(new Date(2023, 0, 1), new Date(2026, 11, 31))),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html' + q('栽培', '群馬'), { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({
      business: document.querySelector('#businessToggle button.active').dataset.business,
      site: document.querySelector('#siteToggle button.active').dataset.site,
    }));
    check('URL(?div=栽培&site=群馬)で開くと群馬が選択される', r.business === '栽培' && r.site === '群馬');
    await page.close();
  }

  console.log('\n=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');

  await browser.close();
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
