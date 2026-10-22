// 直近工数計画「出荷×南丹」パネル3（標準労働時間）を、紙の勤務表から作成した
// 南丹の勤務表ファイル（栽培の南丹勤務表と同じスプレッドシート）の「勤務用_出荷」
// シート（datedHoursSheet形式、26.10/11〜11/10）の実データに接続した機能の検証。
// 「8H」「7H」「6H」「4H」「3H」が時間として数えられ出勤人数に入ること、
// 「休」「-/法」「-/公」は0時間で出勤人数に入らないこと、シートに日付の列が
// 無い日は「－」になり合計列が「（◯日分）」の部分合計になること、サンプルデータの
// 帯が表示されなくなったこと、人別内訳が実名（部門は「－」固定）で表示されることを
// 確認する。読み込み・計算は栽培の南丹(renderLaborNantan())と同じ関数
// (fetchNantanShiftSheets/classifyNantanShiftCell/computeNantanStandardLaborHours)を
// 使っており、読むシート(gid)だけが違うため、栽培の南丹・出荷のいなべ/群馬の結果が
// 変わっていないことも回帰として確認する。
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

const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STD_WORK_HOURS_GID = '264266810';
const NANTAN_SHIFT_SHEET_ID = '1Wt3yN_a1QAfxcTItL54miPEv5Gldd4J6SjUTDX8Gvq8';
const CULT_NANTAN_GID = '716401757'; // 栽培の南丹勤務表（勤務表）シート
const SHIP_NANTAN_GID = '1439827078'; // 出荷の南丹勤務表（勤務用_出荷）シート

function buildStdWorkHoursCsv() {
  const rows = [];
  rows.push(['', '', '', '', '', '', '', '']);
  rows.push(['cs数=(合計点数-バラ数)÷P/cs+バラ数', '', '', '', '', '', '', '']);
  rows.push(['パック・袋P/cs', '', '', '', '', '', '', '']);
  rows.push(['30', '', '', '', '', '', '', '']);
  rows.push(['出荷', 'パック並べる', 30, '', '', '', '', '秒']);
  rows.push(['', '付帯作業', '', '', '', '', '', '']);
  return toCsvText(rows);
}

// 南丹の勤務表(datedHoursSheet)相当のCSV。1行目=A1「名前」+日付("2026/10/11"形式)、
// 2行目=A2「曜日」+曜日、3行目以降=人(A列が空になった行で終端)
function buildNantanDatedHoursCsv(dates, people) {
  const header = ['名前'].concat(dates.map(d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`));
  const weekdayRow = ['曜日'].concat(dates.map(d => WD[d.getDay()]));
  const rows = [header, weekdayRow];
  people.forEach(p => rows.push([p.name].concat(dates.map(d => { const v = p.cellsByIso ? p.cellsByIso[isoKey(d)] : undefined; return v === undefined ? '' : v; }))));
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

async function setBasisDate(page, iso) {
  await page.fill('#basisDateInput', iso);
  await page.dispatchEvent('#basisDateInput', 'change');
  await page.waitForTimeout(1200);
}
async function shipLaborTotals(page) {
  return page.evaluate(() => Array.from({ length: 7 }, (_, o) => ({
    total: document.querySelector(`[data-shiplabor-total-offset="${o}"]`).textContent.trim(),
    attend: document.querySelector(`[data-shipattendance-offset="${o}"]`).textContent.trim(),
  })));
}
async function shippingLaborDetailRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#table3shipDetailBody tr')).map(tr => ({
    name: tr.querySelector('th').textContent.trim(),
    dept: tr.querySelector('td.dept-col').textContent.trim(),
    cells: Array.from(tr.querySelectorAll('td:not(.total-col)')).slice(1).map(td => td.textContent.trim()),
    totalHtml: tr.querySelector('td.total-col') ? tr.querySelector('td.total-col').innerHTML.trim() : null,
  })));
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let allOk = true;
  function check(name, cond) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}`); if (!cond) allOk = false; }

  // 26.10/11〜11/10の31日分(シートの実際の日付範囲)
  const SHEET_DATES = dateRange(new Date(2026, 9, 11), new Date(2026, 10, 10));
  // 「8H」「7H」「6H」「4H」「3H」と「休」「-/法」「-/公」を混在させる
  function cellFor(d, i) {
    if (d.getDay() === 0) return '休'; // 日曜は休み
    if (i % 13 === 3) return '-/法';
    if (i % 17 === 5) return '-/公';
    const hours = ['8H', '7H', '6H', '4H', '3H'][i % 5];
    return hours;
  }
  const PEOPLE = [
    { name: '出荷太郎', cellsByIso: Object.fromEntries(SHEET_DATES.map((d, i) => [isoKey(d), cellFor(d, i)])) },
    { name: '出荷花子', cellsByIso: Object.fromEntries(SHEET_DATES.map((d, i) => [isoKey(d), cellFor(d, i + 2)])) },
  ];
  const SHIP_NANTAN_CSV = buildNantanDatedHoursCsv(SHEET_DATES, PEOPLE);

  function expectedDay(iso) {
    let total = 0, attend = 0;
    PEOPLE.forEach(p => {
      const raw = p.cellsByIso[iso];
      const m = raw && raw.match(/^(\d+(\.\d+)?)H$/i);
      const h = m ? parseFloat(m[1]) : 0;
      total += h;
      if (h > 0) attend++;
    });
    return { total: Math.round(total * 10) / 10, attend };
  }

  console.log('=== ①「8H」「7H」「6H」「4H」「3H」が時間として数えられ、「休」「-/法」「-/公」は0時間・出勤人数に入らない ===');
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await fixTodayTo(page, 2026, 9, 19); // 今日=2026/10/19(月)。基準日の初期値もこの日
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
      staticHandler([[NANTAN_SHIFT_SHEET_ID, SHIP_NANTAN_GID]], SHIP_NANTAN_CSV),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(600);
    await page.click('[data-site="南丹"]');
    await page.waitForTimeout(1000);

    const bannerDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('shippingSampleBanner')).display);
    check('出荷×南丹のパネル3は実データ接続のため、サンプルデータの帯が表示されない', bannerDisplay === 'none');

    const totals = await shipLaborTotals(page);
    const basisDates = dateRange(new Date(2026, 9, 19), new Date(2026, 9, 25));
    basisDates.forEach((d, o) => {
      const exp = expectedDay(isoKey(d));
      check(`${isoKey(d)}：標準労働時間合計=${exp.total.toFixed(1)}`, totals[o].total === exp.total.toFixed(1));
      check(`${isoKey(d)}：出勤人数=${exp.attend}（「休」「-/法」「-/公」は数えない）`, totals[o].attend === String(exp.attend));
    });

    const rows = await shippingLaborDetailRows(page);
    const names = rows.map(r => r.name);
    check('人別内訳がシートの実名(出荷太郎・出荷花子)で表示される(サンプル名ではない)', names.includes('出荷太郎') && names.includes('出荷花子') && names.every(n => !n.startsWith('出荷 サンプル')));
    check('人別内訳の部門は「－」固定(標準労働時間シートとの照合はしない)', rows.every(r => r.dept === '－'));

    // 時刻セルの値そのものも確認(出荷太郎のday0〜4は cellFor()の8H/7H/6H/4H/3Hパターン)
    const taroCells = rows.find(r => r.name === '出荷太郎').cells;
    check('出荷太郎のday0〜4のセルが8H/7H/6H/4H/3Hどおり(日曜等を除く)', taroCells.slice(0, 5).every((v, i) => {
      const iso = isoKey(basisDates[i]);
      const raw = PEOPLE[0].cellsByIso[iso];
      const m = raw && raw.match(/^(\d+(\.\d+)?)H$/i);
      const h = m ? parseFloat(m[1]) : 0;
      return v === h.toFixed(1);
    }));
    await page.close();
  }

  console.log('=== ②シートに列がない日(11/11以降)は「－」。合計列は範囲内日数だけの部分合計＋「（◯日分）」になる ===');
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await fixTodayTo(page, 2026, 9, 19);
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
      staticHandler([[NANTAN_SHIFT_SHEET_ID, SHIP_NANTAN_GID]], SHIP_NANTAN_CSV),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(600);
    await page.click('[data-site="南丹"]');
    await page.waitForTimeout(800);
    // 基準日=11/05 → 表示は11/05〜11/11の7日分。シートは11/10までのため、11/11(offset6)は列がない
    await setBasisDate(page, '2026-11-05');
    const totals = await shipLaborTotals(page);
    check('11/05〜11/10(offset0〜5)は値が表示される(「－」でない)', totals.slice(0, 6).every(t => t.total !== '－'));
    check('11/11(offset6、シートの範囲外)は「－」になる', totals[6].total === '－' && totals[6].attend === '－');
    const totalCellHtml = await page.evaluate(() => document.querySelector('[data-shiplabor-total-offset="total"]').innerHTML);
    check('合計列が「（6日分）」の部分合計になる(7日中1日が範囲外)', totalCellHtml.includes('（6日分）'));
    const attendTotalHtml = await page.evaluate(() => document.querySelector('[data-shipattendance-offset="total"]').innerHTML);
    check('出勤人数の合計列も同じく「（6日分）」になる(延べ人数)', attendTotalHtml.includes('（6日分）'));
    await page.close();
  }

  console.log('=== ③回帰：出荷×いなべ・出荷×群馬・栽培×南丹の結果が変わらない ===');
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await fixTodayTo(page, 2026, 9, 19);
    const jiroCellsByIso = Object.fromEntries(SHEET_DATES.map((d, i) => [isoKey(d), cellFor(d, i)]));
    await setupRoutes(page, [
      staticHandler([[DB_SHARE_SHEET_ID, STD_WORK_HOURS_GID]], buildStdWorkHoursCsv()),
      staticHandler([[NANTAN_SHIFT_SHEET_ID, CULT_NANTAN_GID]], buildNantanDatedHoursCsv(SHEET_DATES, [
        { name: '栽培次郎', cellsByIso: jiroCellsByIso },
      ])),
      staticHandler([[NANTAN_SHIFT_SHEET_ID, SHIP_NANTAN_GID]], SHIP_NANTAN_CSV),
    ]);
    await page.goto('http://localhost:8811/work-hours-forecast.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-site="南丹"]'); // 栽培×南丹(既定の区分は栽培)
    await page.waitForTimeout(1000);
    const cultRows = await page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => ({
      name: tr.querySelector('th').textContent.trim(),
      cells: Array.from(tr.querySelectorAll('td:not(.total-col)')).slice(1).map(td => td.textContent.trim()),
    })));
    const jiro = cultRows.find(r => r.name === '栽培次郎');
    check('栽培×南丹(勤務表シート、gid716401757)は今までどおり自分のシートの値で計算される(出荷のシートの影響を受けない)', !!jiro);
    if (jiro) {
      const raw0 = jiroCellsByIso[isoKey(new Date(2026, 9, 19))];
      const m0 = raw0 && raw0.match(/^(\d+(\.\d+)?)H$/i);
      const h0 = m0 ? parseFloat(m0[1]) : 0;
      check('栽培×南丹day0の値が、栽培用のシート(gid716401757)の値どおり(出荷のシートとは別の内容)', jiro.cells[0] === h0.toFixed(1));
    }

    // いなべ・群馬は実データ接続のまま、未モックでもエラーにならないことだけ確認
    // (詳細な照合・集計の検証はverify_forecast_shipping_labor_inabe.js/_gunma.jsで実施済み)
    await page.click('[data-business="出荷"]');
    await page.waitForTimeout(600);
    await page.click('[data-site="いなべ"]');
    await page.waitForTimeout(800);
    const bannerInabe = await page.evaluate(() => getComputedStyle(document.getElementById('shippingSampleBanner')).display);
    check('出荷×いなべのサンプル帯は今までどおり表示されない', bannerInabe === 'none');
    await page.click('[data-site="群馬"]');
    await page.waitForTimeout(800);
    const bannerGunma = await page.evaluate(() => getComputedStyle(document.getElementById('shippingSampleBanner')).display);
    check('出荷×群馬のサンプル帯は今までどおり表示されない', bannerGunma === 'none');
    await page.close();
  }

  console.log('\n=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');

  await browser.close();
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
