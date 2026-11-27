// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）のパネル1「在庫・出荷予定」に、2Lの内訳として
// 「2L」「3L」の行（親の2Lの行のすぐ下、秀・優と同じ字下げ）を足した対応の検証。
// 管理資料は2L以上（3Lを含む）をすべて「2L」に集計しているため、親の2Lは 在庫＝在庫管理表の「2L製品在庫」
// 「2L生在庫」のまま、出荷予定＝販売予実抽出シートの 2L＋3L。内訳の行は表示だけで、合計の行・在庫予測には使わない。
// 実際のスプレッドシートには触れず、page.route()でCSV（/export?format=csv）を実際のシートの形に合わせてモックする
// （他ファイルへの依存なし）。在庫の品目名・係数・数量は、実際の在庫ファイルの 11/18 の列に合わせている：
//   いなべ：秀2L8（×3.08）空欄・秀3L6 4箱・優2L8（×2.8）64箱・優3L6（×2.8）7箱 → 内訳2L 179.2・内訳3L 31.92、親 211.12
//   群馬：A2L6-8（10入り）10箱×2・（12入り）4箱×2.4・（14入り）4箱×2.8 → 内訳2L 40.8（＝親）、3Lの商品は無い
//   南丹：マスターシートの1cs重量で、秀2L6 10箱（2L）・優3L6 14入 5箱（3L）・優2L8/優3L6 2箱（2L・3Lが混ざった商品→内訳2L）
// 「今日」は2026-11-19に固定（在庫は前日11/18の列、出荷予定は11/19〜11/27）。
// 確かめること：
//  ①パネル1の行の並び（M・L・秀・優・2L・2L・3L・袋・合計）と、内訳の行が秀・優と同じ字下げ（grade-row）であること
//  ②親の2Lの出荷予定＝2L＋3L（両方あり・3Lだけ・2Lだけ・両方空欄）、内訳の行は2L・3Lをそのまま出すこと
//  ③内訳の在庫（製品在庫）が拠点ごとの商品の振り分けどおり、3Lの商品が無い拠点（群馬）は「－」、生在庫は3拠点とも「－」
//  ④南丹の2L・3Lが混ざった商品が内訳2Lに入ること（半分にしない）
//  ⑤内訳の行が合計の行に入らないこと（合計＝M＋L＋2L（親）＋袋）、在庫予測（パネル3）の2Lは親の2L（2L＋3L）で計算されること
//  ⑥セルの範囲選択：親の2Lと内訳の行を一緒に選ぶと二重計上の注意が出ること
//  ⑦品目の行が在庫タブに無いときは内訳を「－」にすること（computeProductBreakdown2L）
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/shipment-plan/verify_shipment_plan_2l_breakdown.js
const { chromium } = require('playwright');

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

const PAGE_URL = 'http://localhost:8812/shiitake-shipment-plan.html';
// 基準日の既定が「明日」になったため、このテストでは今までどおり基準日＝今日（fixTodayTo で決めた日）で開く
// （URL の base= で基準日を指定する。実績日の既定（前日）は変わらない）
function withBaseToday(url, y, m, d) { const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return url + (url.includes('?') ? '&' : '?') + 'base=' + iso; }
const SALES_SHEET_ID = '18zyC0JwVyaW3i18LQdvHQeDpEcfzM8iolhclgNocrnM';
const SALES_INDEX_GID = '538861653';
const NOV_MONTH_GID = '444444441';
const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STOCK_URL_SHEET_GID = '717295394';
const STOCK_IDS = { 'いなべ': 'FAKE_INABE_STOCK', '群馬': 'FAKE_GUNMA_STOCK', '南丹': 'FAKE_NANTAN_STOCK' };
const NANTAN_MASTER_GID = '1337213550';
const SITES = ['いなべ', '群馬', '南丹'];
const STOCK_DATES = ['11/16', '11/17', '11/18', '11/19'];
const STOCK_DATE = '11/18';

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const D = '－';

// ---- 在庫ファイル（椎茸在庫タブ）：1行目＝日付（m/d）、B列＝行の名前。数量は11/18の列にだけ置く ----
function stockTab(rowsSpec, colA) {
  const rows = [['', ''].concat(STOCK_DATES)];
  rowsSpec.forEach(([label, v], i) => {
    const r = [(colA && colA[i]) || '', label];
    STOCK_DATES.forEach(d => r.push(d === STOCK_DATE ? (v === undefined ? '' : v) : ''));
    rows.push(r);
  });
  return rows;
}
const INABE_STOCK = stockTab([
  ['秀M8', '33箱'], ['優2L4', ''], ['', ''], ['秀2L8', ''], ['秀3L6', '4箱'], ['', ''], ['優2L8', '64箱'], ['優3L6', '7箱'],
  ['2L生在庫', '113'], ['L生在庫　秀L_40　優L_60', '300'], ['M生在庫', '50'], ['袋生在庫', '20'],
  ['2L製品在庫', '211.12'], ['L製品在庫', '400'], ['M製品在庫', '120'], ['袋製品在庫', '90'],
]);
const GUNMA_STOCK = stockTab([
  ['A6 (30入り)', '34箱'], ['2L4 (30入り)', ''], ['A2L6-8（10入り)', '10箱'], ['A2L6-8（12入り)', '4箱'], ['A2L6-8（14入り)', '4箱'],
  ['A2L6-8（20入り)', ''], ['B2L6-8（12入り)', ''], ['B2L6-8（14入り)', ''], ['2Lバラ（3kg)', ''], ['2Lバラ（5kg)', ''], ['2Lバラ（8kg)', ''],
  ['2L生在庫', '838.8'], ['L生在庫　秀L_40　優L_60', '200'], ['M生在庫', '30'], ['袋生在庫', '10'],
  ['2L製品在庫', '40.8'], ['Ｌ製品在庫', '100'], ['Ｍ製品在庫', '20'], ['袋製品在庫', '15'],
]);
// 南丹：A列が「製品在庫(箱数)」の行から、B列の品目が空欄になるまでが製品在庫の品目（ページの computeNantanProductStock）
const NANTAN_STOCK = stockTab([
  ['秀2L6', '10箱'], ['優3L6 14入', '5箱'], ['優2L8/優3L6', '2箱'], ['秀L6', '3箱'], ['', ''],
  ['2L生在庫', '70'], ['L生在庫', '60'], ['M生在庫', '40'], ['袋生在庫', '5'],
], ['製品在庫\n(箱数)']);
const NANTAN_MASTER = [
  ['', '表記ゆれ（ / 区切り）', '等級', 'サイズ', '梱包', '入数', '既定g', '1cs重量'],
  ['秀2L6', '', '秀', '2L', '', '1', '', '2.8'],
  ['優3L6 14入', '', '優', '3L', '', '14', '', '2.8'],
  ['優2L8/優3L6', '', '優', '2L・3L', '', '1', '', '2.8'],
  ['秀L6', '', '秀', 'L', '', '1', '', '3.9'],
];

// ---- 販売予実抽出シート 2026.11（1拠点31列＝M・L・2L・3L・袋）。値は受注計画に置く ----
function salesTab(values) {
  const FORMS = ['買取', '市場', '委託', '全体'], SIZES = ['M', 'L', '2L', '3L', '袋'];
  const groups = [['月初計画', FORMS], ['修正計画', FORMS], ['受注計画', FORMS], ['月初計画', SIZES], ['修正計画', SIZES], ['受注計画', SIZES], ['出荷実績', FORMS]];
  const head = [['', '拠点'], ['', '版'], ['', '販売形態/サイズ']];
  const pos = {};
  SITES.forEach(site => groups.forEach(([ver, names], gi) => names.forEach((n, k) => {
    if (gi === 5) { pos[site] = pos[site] || {}; pos[site][n] = head[0].length; }
    head[0].push(site); head[1].push(k === 0 ? ver : ''); head[2].push(n);
  })));
  const rows = head;
  for (let day = 1; day <= 30; day++) {
    const r = new Array(head[0].length).fill(''); r[0] = day === 1 ? '日付' : ''; r[1] = String(day);
    SITES.forEach(site => { const v = values[site] && values[site][day]; if (v) Object.keys(v).forEach(sz => { r[pos[site][sz]] = v[sz]; }); });
    rows.push(r);
  }
  const total = new Array(head[0].length).fill(''); total[1] = '合計'; rows.push(total);
  return rows;
}
// 11/19：両方あり／11/20：3Lだけ／11/21：2Lだけ／11/22：両方空欄（M・L・袋だけ）
const SALES = {
  'いなべ': {
    19: { M: 10, L: 20, '2L': 66.7, '3L': 50.5, '袋': 30 },
    20: { M: 1, L: 2, '3L': 5, '袋': 3 },
    21: { M: 1, L: 2, '2L': 9, '袋': 3 },
    22: { M: 1, L: 2, '袋': 3 },
  },
  '群馬': { 19: { M: 4, L: 5, '2L': 10, '袋': 6 } },
  '南丹': { 19: { M: 7, L: 8, '2L': 95.6, '3L': 106.2, '袋': 9 } },
};

async function setupPage(browser, site) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await fixTodayTo(page, 2026, 10, 19);
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    let rows = null;
    if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + STOCK_URL_SHEET_GID)) {
      rows = [['出荷量', 'いなべ', '群馬', '南丹'], ['2026'].concat(SITES.map(s => 'https://docs.google.com/spreadsheets/d/' + STOCK_IDS[s] + '/edit?gid=0#gid=0'))];
    } else if (url.includes(STOCK_IDS['いなべ'] + '/') && url.includes('gid=0')) rows = INABE_STOCK;
    else if (url.includes(STOCK_IDS['群馬'] + '/') && url.includes('gid=0')) rows = GUNMA_STOCK;
    else if (url.includes(STOCK_IDS['南丹'] + '/') && url.includes('gid=' + NANTAN_MASTER_GID)) rows = NANTAN_MASTER;
    else if (url.includes(STOCK_IDS['南丹'] + '/') && url.includes('gid=0')) rows = NANTAN_STOCK;
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_INDEX_GID)) rows = [['年月', 'URL'], ['2026.11', 'https://docs.google.com/spreadsheets/d/' + SALES_SHEET_ID + '/edit#gid=' + NOV_MONTH_GID]];
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + NOV_MONTH_GID)) rows = salesTab(SALES);
    else if (/\/d\/FAKE_[A-Z]+_STOCK\//.test(url)) rows = [['分類キー', '含む文字列', '除外文字列', '換算係数', '加算先']]; // 転写_秀優_判別（ルールなし）
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: rows ? toCsvText(rows) : '﻿\r\n' });
  });
  await page.goto(withBaseToday(PAGE_URL + (site === 'いなべ' ? '' : '?site=' + encodeURIComponent(site)), 2026, 10, 19));
  await page.waitForSelector('#table1');
  return page;
}
// table1 の行ごとの [見出し, 製品在庫, 生在庫, 当日〜3日後の出荷予定]
async function table1Rows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#table1 tbody tr')).map(tr => {
    const th = tr.querySelector('th').textContent.trim();
    const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
    return { th, grade: tr.classList.contains('grade-row'), label: tr.dataset.rowLabel || '', product: tds[0], raw: tds[1], ship: tds.slice(2, 6) };
  }));
}
async function waitFor(page, fn, arg) {
  for (let i = 0; i < 80; i++) { if (await page.evaluate(fn, arg)) { await page.waitForTimeout(300); return true; } await page.waitForTimeout(150); }
  return false;
}
const num = t => { const v = parseFloat(String(t).replace(/,/g, '')); return isNaN(v) ? null : v; };

(async () => {
  const browser = await chromium.launch();

  console.log('=== いなべ ===');
  {
    const page = await setupPage(browser, 'いなべ');
    await waitFor(page, () => {
      const a = document.querySelector('[data-shipment="2L"][data-shipment-offset="0"]');
      const b = document.querySelector('[data-stock-product="sub3L"]');
      return a && a.textContent.trim() !== '－' && b && b.textContent.trim() !== '－';
    });
    const rows = await table1Rows(page);
    check('①パネル1の行の並び：M・L・秀・優・2L・2L・3L・袋・合計', same(rows.map(r => r.th), ['M', 'L', '秀', '優', '2L', '2L', '3L', '袋', '合計']), rows.map(r => r.th));
    check('①内訳の行（2行目の2L・3L）は秀・優と同じ grade-row、親の2Lは grade-row でない',
      rows[5].grade && rows[6].grade && rows[2].grade && !rows[4].grade && rows[5].label === '内訳2L' && rows[6].label === '内訳3L', rows.map(r => [r.th, r.grade, r.label]));
    const pad = await page.evaluate(() => {
      const ths = document.querySelectorAll('#table1 tbody tr th');
      return [2, 4, 5, 6].map(i => parseFloat(getComputedStyle(ths[i]).paddingLeft));
    });
    check('①内訳の行の見出しは秀と同じ字下げ（親の2Lより右）', pad[2] === pad[0] && pad[3] === pad[0] && pad[2] > pad[1], pad);

    const p2 = rows[4], s2 = rows[5], s3 = rows[6];
    check('②11/19 両方あり：親の2L＝2L＋3L（66.7＋50.5＝117.2）、内訳2L 66.7・内訳3L 50.5',
      p2.ship[0] === '117.2' && s2.ship[0] === '66.7' && s3.ship[0] === '50.5', [p2.ship[0], s2.ship[0], s3.ship[0]]);
    check('②11/20 3Lだけ：親の2L 5.0、内訳2L「－」・内訳3L 5.0', p2.ship[1] === '5.0' && s2.ship[1] === D && s3.ship[1] === '5.0', [p2.ship[1], s2.ship[1], s3.ship[1]]);
    check('②11/21 2Lだけ：親の2L 9.0、内訳2L 9.0・内訳3L「－」', p2.ship[2] === '9.0' && s2.ship[2] === '9.0' && s3.ship[2] === D, [p2.ship[2], s2.ship[2], s3.ship[2]]);
    check('②11/22 両方空欄：親の2L・内訳とも「－」（M・L・袋は出る）', p2.ship[3] === D && s2.ship[3] === D && s3.ship[3] === D && rows[0].ship[3] === '1.0', [p2.ship[3], s2.ship[3], s3.ship[3], rows[0].ship[3]]);

    check('③親の2Lの在庫は在庫管理表のまま（2L製品在庫 211.1・2L生在庫 113.0）', p2.product === '211.1' && p2.raw === '113.0', [p2.product, p2.raw]);
    check('③内訳の製品在庫：内訳2L＝優2L8 64箱×2.8＝179.2（秀2L8は空欄）、内訳3L＝秀3L6 4箱×3.08＋優3L6 7箱×2.8＝31.9', s2.product === '179.2' && s3.product === '31.9', [s2.product, s3.product]);
    check('③内訳の生在庫は「－」（生の段階では分けていない）', s2.raw === D && s3.raw === D, [s2.raw, s3.raw]);

    const total = rows[8];
    const parentSum = col => [0, 1, 4, 7].reduce((a, i) => a + (num(col(rows[i])) || 0), 0);
    check('⑤合計の行の製品在庫・生在庫＝M＋L＋2L（親）＋袋（内訳・秀・優は入らない）',
      Math.abs(num(total.product) - parentSum(r => r.product)) < 0.05 && Math.abs(num(total.raw) - parentSum(r => r.raw)) < 0.05, [total.product, total.raw]);
    check('⑤合計の行の出荷予定（11/19）＝10＋20＋117.2＋30＝177.2（内訳は入らない）', total.ship[0] === '177.2', total.ship[0]);

    // ⑤在庫予測（パネル3）：収穫予測を0にして計算し直すと、2Lの当日＝（親の製品在庫＋生在庫）−親の出荷予定
    const fc = await page.evaluate(async () => {
      document.querySelectorAll('[data-harvest]').forEach(el => { if (el.hasAttribute('data-harvest-offset')) el.textContent = '0.0'; });
      await window.updateStockForecast();
      const g = s => { const el = document.querySelector('[data-stock-forecast="' + s + '"][data-stock-forecast-offset="0"]'); return el ? el.textContent.trim() : null; };
      return { l2: g('2L'), sub2: g('sub2L'), sub3: g('sub3L'), rows: Array.from(document.querySelectorAll('#table3 tbody tr th')).map(th => th.textContent.trim()) };
    });
    check('⑤在庫予測の2L（当日）＝211.1＋113.0−117.2＝206.9（出荷予定は親の2L＝2L＋3L）', fc.l2 === '206.9', fc);
    check('⑤在庫予測（パネル3）に内訳の行は無い（行の見出しは今のまま）', fc.sub2 === null && fc.sub3 === null && !fc.rows.includes('3L'), fc.rows);

    // ⑥セルの範囲選択：親の2Lと内訳の行を一緒に選ぶと注意が出る
    const cell = (r, c) => `#table1 tbody tr:nth-child(${r + 1}) > :nth-child(${c + 1})`;
    await page.click(cell(4, 3));
    await page.click(cell(6, 3), { modifiers: ['Control'] });
    let warn = await page.evaluate(() => ({ w2: getComputedStyle(document.getElementById('aggWarn2L')).display !== 'none', wg: getComputedStyle(document.getElementById('aggWarnGrade')).display !== 'none' }));
    check('⑥親の2Lと内訳3Lを一緒に選ぶと「2L・3Lの行は2Lの内訳」の注意が出る（秀・優の注意は出ない）', warn.w2 && !warn.wg, warn);
    await page.click('#aggClearBtn');
    await page.click(cell(5, 3));
    await page.click(cell(6, 3), { modifiers: ['Control'] });
    warn = await page.evaluate(() => getComputedStyle(document.getElementById('aggWarn2L')).display !== 'none');
    check('⑥内訳2L・内訳3Lだけなら注意は出ない', !warn, warn);
    await page.click(cell(8, 3), { modifiers: ['Control'] });
    warn = await page.evaluate(() => getComputedStyle(document.getElementById('aggWarnTotal')).display !== 'none');
    check('⑥合計の行と内訳の行を一緒に選ぶと合計の二重計上の注意が出る', warn, warn);

    // ⑦品目の行が無いときは「－」
    const miss = await page.evaluate(() => {
      const json = { table: { rows: [{ c: [{ v: '' }, { v: '' }, { v: '11/18' }] }, { c: [{ v: '' }, { v: '秀2L8' }, { v: '3箱' }] }] } };
      return window.__test.computeProductBreakdown2L(json, 2, { '2L': [['秀2L8', 3.08], ['優2L8', 2.8]], '3L': [] });
    });
    check('⑦一覧の品目（優2L8）の行が在庫タブに無い → 内訳2Lは「－」（null）、3Lの一覧が空 → null', miss['2L'] === null && miss['3L'] === null, miss);
    await page.close();
  }

  console.log('=== 群馬（3Lの商品が無い） ===');
  {
    const page = await setupPage(browser, '群馬');
    await waitFor(page, () => {
      const a = document.querySelector('[data-shipment="2L"][data-shipment-offset="0"]');
      const b = document.querySelector('[data-stock-product="sub2L"]');
      return a && a.textContent.trim() !== '－' && b && b.textContent.trim() !== '－';
    });
    const rows = await table1Rows(page);
    check('③群馬の内訳2L＝10箱×2＋4箱×2.4＋4箱×2.8＝40.8（親の2L製品在庫 40.8 と同じ）', rows[5].product === '40.8' && rows[4].product === '40.8', [rows[4].product, rows[5].product]);
    check('③群馬は3Lの商品が無いので内訳3Lの製品在庫は「－」、生在庫は内訳2L・3Lとも「－」', rows[6].product === D && rows[5].raw === D && rows[6].raw === D, [rows[6].product, rows[5].raw, rows[6].raw]);
    check('②群馬 11/19：2Lだけ（10）→ 親 10.0・内訳2L 10.0・内訳3L「－」', rows[4].ship[0] === '10.0' && rows[5].ship[0] === '10.0' && rows[6].ship[0] === D, [rows[4].ship[0], rows[5].ship[0], rows[6].ship[0]]);
    await page.close();
  }

  console.log('=== 南丹（2L・3Lが混ざった商品） ===');
  {
    const page = await setupPage(browser, '南丹');
    await waitFor(page, () => {
      const a = document.querySelector('[data-shipment="2L"][data-shipment-offset="0"]');
      const b = document.querySelector('[data-stock-product="sub3L"]');
      return a && a.textContent.trim() !== '－' && b && b.textContent.trim() !== '－';
    });
    const rows = await table1Rows(page);
    check('④南丹の親の2L＝秀2L6 28.0＋優3L6 14.0＋優2L8/優3L6 5.6＝47.6', rows[4].product === '47.6', rows[4].product);
    check('④内訳2L＝秀2L6 28.0＋（2L・3Lが混ざった）優2L8/優3L6 5.6＝33.6（半分にしない）、内訳3L＝優3L6 14.0', rows[5].product === '33.6' && rows[6].product === '14.0', [rows[5].product, rows[6].product]);
    check('③南丹の内訳の生在庫は「－」', rows[5].raw === D && rows[6].raw === D, [rows[5].raw, rows[6].raw]);
    check('②南丹 11/19：親の2L＝95.6＋106.2＝201.8、内訳2L 95.6・内訳3L 106.2', rows[4].ship[0] === '201.8' && rows[5].ship[0] === '95.6' && rows[6].ship[0] === '106.2', [rows[4].ship[0], rows[5].ship[0], rows[6].ship[0]]);
    const total = rows[8];
    check('⑤南丹の合計の行の製品在庫＝L（秀L6 11.7）＋2L（親）47.6＝59.3（内訳は入らない）', total.product === '59.3', total.product);
    const sp = await page.evaluate(() => {
      const s = window.__test.splitStockSizes;
      return { only3: s('優', '3L'), mix: s('優', '2L・3L'), l2l: s('優', 'L・2L') };
    });
    check('④splitStockSizes：3Lだけ→sub 3L、2L・3L→どちらもsub 2L、L・2Lの2L側→sub 2L',
      sp.only3[0].sub === '3L' && sp.mix.every(p => p.sub === '2L') && sp.l2l[1].sub === '2L' && sp.l2l[0].sub === undefined, sp);
    await page.close();
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(ng === 0 ? `すべてOK (OK ${results.length} / NG 0)` : `NGあり (OK ${results.length - ng} / NG ${ng})`);
  console.log('DONE');
  process.exit(ng === 0 ? 0 : 1);
})();
