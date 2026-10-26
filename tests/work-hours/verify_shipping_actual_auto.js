// dashboard/work-hours.html の出荷内訳（パック数・袋数・バラ数・付帯作業・合計(点数)）の
// 実績を、整理済み_分析（PROD_GID）から次の取得元に切り替えた変更の検証。
//   ・〜2026/8（SHIPPING_AUTO_FROMより前）：整理済み_計画_更新（PLAN_GID）の「出荷内訳／実数計画」の行
//   ・2026/9〜境目月（getActualCutoffMonth()）：販売抽出シート(商品別)の「実績」タブから自動計算
//     （付帯作業は「－」、計画_更新に値があっても使わない）
//   ・境目月より後：整理済み_計画_更新の「実数計画」の行（今までどおり）
//   ・合計(点数)は全ての月で パック数＋袋数＋バラ数（付帯作業は含めない）
//
// モックは実際のシートの構成に合わせている（2026/10時点の実シートをSheets APIで確認）。
//   ・整理済み_計画_更新：A=拠点・B=カテゴリ・C=指標、D列以降の1行目が"yyyy/M"。各拠点に
//     生産実績(3行)→栽培内訳(7行)→出荷内訳／構成比(5行)→出荷内訳／実数計画(5行)。カテゴリ列の
//     文言は各まとまりの1・2行目に「出荷内訳」「構成比」／「出荷内訳」「実数計画」と分かれて入る
//   ・整理済み_分析：同じ並びで、出荷内訳（実績）の5行だけ値が入っている（このテストでは
//     「使われていないこと」を確かめるため、計画_更新とは異なる値にしてある）
//   ・DB共有「販売抽出シート(商品別)」：1行目の見出し「拠点／区分／URL」、拠点ごとに
//     月初・MRP・受注・実績の4行
//   ・販売抽出シートの実績タブ：見出し「拠点／個数/重量(kg)／区分／商品／秀・優・袋・袋２／
//     サイズ／yyyy/MM/dd…」、個数の行のあとに重量の行が並ぶ
//
// 確認内容は README.md の「verify_shipping_actual_auto.js」の項を参照。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CHART_JS_VENDORED = fs.readFileSync(path.join(__dirname, 'vendor', 'chart.umd.js'), 'utf8');
const BASE_URL = 'http://localhost:8813/work-hours.html';

const SHEET_ID = '1LtYb1feXR6jtIEfxaADLiTEWpPabKJDDlwoS1V-yuG0';
const PROD_GID = '2016642543';
const PLAN_GID = '530402103';
const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const SALES_URL_GID = '1130067935';
const STD_SETTINGS_GID = '264266810';
const SALES_FILE_ID = '17DD5aRxc9bv8uZzEfnK_Q9IGOvQVH4ieJU1c-qu7dOc';
const SALES_GIDS = {
  'いなべ': { '月初': '857573225', 'MRP': '1525325950', '受注': '545062393', '実績': '1095512122' },
  '群馬':   { '月初': '1752000481', 'MRP': '454579971', '受注': '1218802781', '実績': '1157026839' },
  '南丹':   { '月初': '116847058', 'MRP': '1991870263', '受注': '24647903', '実績': '502246564' },
};
const SITES = ['いなべ', '群馬', '南丹'];

/* ===================== モック：整理済み_計画_更新 ===================== */
const PLAN_MONTHS = ['2025/10', '2025/11', '2025/12', '2026/1', '2026/2', '2026/3', '2026/4', '2026/5',
  '2026/6', '2026/7', '2026/8', '2026/9', '2026/10', '2026/11', '2026/12', '2027/1', '2027/2'];
// 実数計画の行（実シートの値。2026/9・2026/10は実シートでは空欄・0だが、「自動計算の月は
// 計画_更新に値があっても使わない」ことを確かめるため、あえて値を入れてある）。
// 合計(点数)は、「シートの合計(点数)の行の値は使わない」ことを確かめるため、
// パック＋袋＋バラとは異なる値（＋付帯作業や0）を含めてある
const PLAN_ACTUAL = {
  'いなべ': {
    'パック数': [78408, 72057, 116763, 77213, 79873, 63006, 63600, 66295, 65584, 60584, 50627, 88001, 99001, 109805, 131782, 192037, 115222],
    '袋数':     [22227, 35239, 41437, 22847, 28802, 24230, 22591, 23452, 27749, 23656, 13716, 30001, 31001, 38844, 46618, 67933, 40760],
    'バラ数':   [768, 868, 2375, 1876, 1550, 1503, 1739, 1278, 1165, 1037, 1295, 1001, 1101, 2117, 2540, 3702, 2221],
    '付帯作業': [null, null, null, null, null, null, null, null, null, null, null, 501, 601, 0, 0, 0, 0],
    '合計(点数)': [101403, 108164, 160575, 101936, 110225, 88739, 87930, 91025, 94498, 85277, 65638, 0, 0, 150766, 180941, 263672, 158203],
  },
  '群馬': {
    'パック数': [45781, 59782, 65077, 79385, 87178, 68204, 63250, 82824, 81555, 66833, 52234, 77002, 88002, 108177, 160738, 242987, 145792],
    '袋数':     [31464, 36330, 37690, 45970, 34050, 41340, 33140, 29940, 27417, 23392, 26304, 20002, 21002, 39105, 58105, 87837, 52702],
    'バラ数':   [326, 408, 351, 375, 179, 104, 97, 85, 97, 128, 198, 202, 302, 155, 231, 349, 209],
    '付帯作業': [12004, 21390, 15699, 26621, 21280, 24720, 10200, 11570, 11940, 8780, 7640, 7002, 8002, 0, 0, 0, 0],
    // 群馬の合計はシート上で付帯作業を足した値になっている月がある想定（使わないことの確認用）
    '合計(点数)': [89575, 117910, 118817, 152351, 142687, 134368, 106687, 124419, 121009, 99133, 86376, 0, 0, 147437, 219074, 331174, 198704],
  },
  '南丹': {
    'パック数': [37419, 39831, 65103, 46815, 43572, 35462, 32234, 33500, 37921, 37427, 36967, 55003, 66003, 63345, 86547, 121158, 67848],
    '袋数':     [26213, 22884, 39782, 26410, 23772, 22972, 20728, 16931, 23193, 20490, 8909, 15003, 16003, 32270, 44090, 61722, 34564],
    'バラ数':   [218, 296.5, 541, 527, 422, 408, 451, 341, 365, 323, 298, 303, 403, 1195, 1633, 2286, 1280],
    '付帯作業': [13046, 4931, 18706, 14633, 16016, 18451, 14996, 12961, 13870, 10690, 295, 9003, 9903, 23904, 32659, 45720, 25603],
    '合計(点数)': [63850, 63012, 105426, 73752, 67766, 58842, 53413, 50772, 61479, 58240, 46174, 0, 0, 119520, 163297, 228600, 128016],
  },
};
// 構成比の行（割合値。実数計画と取り違えると明らかに小さい値になる）
const PLAN_RATIO = { 'パック数': 0.73, '袋数': 0.26, 'バラ数': 0.01, '付帯作業': 0, '合計(点数)': 6.85 };

function gvizCell(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return { v, f: v.toLocaleString('en-US') };
  return { v: String(v) };
}
function gvizText(table) {
  return `/*O_o*/\ngoogle.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"ok","sig":"1","table":${JSON.stringify(table)}});`;
}

// 1拠点分の行（A〜C列＋月の値）。siteLabelは拠点の先頭行にだけ入る
function planSiteRows(site, months, actualBySite) {
  const n = months.length;
  const blank = () => Array(n).fill(null);
  const rows = [];
  const push = (a, b, c, values) => rows.push([a, b, c, ...values]);
  push(site, '生産実績', '菌床購入数(本)', Array(n).fill(30000));
  push('', '', '収穫量(kg)', Array(n).fill(20000));
  push('', '', '出荷量(kg)', Array(n).fill(18000));
  push('', '栽培内訳', '菌床入れ', Array(n).fill(10));
  push('', '(コンテナ数）', '芽かき', Array(n).fill(20));
  ['収穫', '注水', '散水', '廃棄', '稼働コンテナ数'].forEach(m => push('', '', m, Array(n).fill(100)));
  push('', '出荷内訳', 'パック数', Array(n).fill(PLAN_RATIO['パック数']));
  push('', '構成比', '袋数', Array(n).fill(PLAN_RATIO['袋数']));
  push('', '', 'バラ数', Array(n).fill(PLAN_RATIO['バラ数']));
  push('', '', '付帯作業', Array(n).fill(PLAN_RATIO['付帯作業']));
  push('', '', '合計(点数)', Array(n).fill(PLAN_RATIO['合計(点数)']));
  const a = actualBySite || blank();
  push('', '出荷内訳', 'パック数', a['パック数']);
  push('', '実数計画', '袋数', a['袋数']);
  push('', '', 'バラ数', a['バラ数']);
  push('', '', '付帯作業', a['付帯作業']);
  push('', '', '合計(点数)', a['合計(点数)']);
  return rows;
}

function buildPlanGviz() {
  const cols = [{ id: 'A', label: '予測', type: 'string' }, { id: 'B', label: '', type: 'string' }, { id: 'C', label: '', type: 'string' }]
    .concat(PLAN_MONTHS.map((m, i) => ({ id: 'M' + i, label: m, type: 'number' })));
  const rows = [];
  SITES.forEach(site => planSiteRows(site, PLAN_MONTHS, PLAN_ACTUAL[site]).forEach(r => rows.push({ c: r.map(gvizCell) })));
  return gvizText({ cols, rows });
}

/* ===================== モック：整理済み_分析 ===================== */
// 実シートは 2025/10〜2026/8 の列に出荷内訳の5行だけ値がある。ここでは「整理済み_分析の
// 値が使われていないこと」を確かめるため、全て 777777（＋拠点ごとの差）にしてある。
// 2026/10 の列は「境目月より後の月（prodDataに含まれる月）は計画_更新の値になること」を
// 確かめるために追加した列（整理済み_Mに無い月でも整理済み_分析の見出しにあれば
// prodDataの月一覧に入る）
const PROD_MONTHS = ['2025/10', '2025/11', '2025/12', '2026/1', '2026/2', '2026/3', '2026/4', '2026/5', '2026/6', '2026/7', '2026/8', '2026/10'];
function buildProdGviz() {
  const cols = [{ id: 'A', label: '作業実績', type: 'string' }, { id: 'B', label: '', type: 'string' }, { id: 'C', label: '', type: 'string' }]
    .concat(PROD_MONTHS.map((m, i) => ({ id: 'M' + i, label: m, type: 'number' })));
  const rows = [];
  SITES.forEach((site, si) => {
    const n = PROD_MONTHS.length;
    const junk = Array(n).fill(777777 + si);
    const empty = Array(n).fill(null);
    const r = [];
    r.push([site, '生産実績', '菌床購入数(本)', ...empty]);
    r.push(['', '', '収穫量(kg)', ...empty]);
    r.push(['', '', '出荷量(kg)', ...empty]);
    r.push(['', '栽培内訳', '菌床入れ', ...empty]);
    r.push(['', '(コンテナ数）', '芽かき', ...empty]);
    ['収穫', '注水', '散水', '廃棄', '稼働コンテナ数'].forEach(m => r.push(['', '', m, ...empty]));
    r.push(['', '出荷内訳', 'パック数', ...junk]);
    r.push(['', '', '袋数', ...junk]);
    r.push(['', '', 'バラ数', ...junk]);
    r.push(['', '', '付帯作業', ...junk]);
    r.push(['', '', '合計(点数)', ...junk]);
    r.forEach(x => rows.push({ c: x.map(gvizCell) }));
  });
  return gvizText({ cols, rows });
}

/* ===================== モック：整理済み_M（勤務時間） ===================== */
function buildMGviz(lastMonth) {
  // 2025/10〜lastMonthの実データ月。見出しは「N/10締 yyyy/MM 総勤務時間」「有給取得時間」「実質勤務時間」
  const months = [];
  let y = 2025, m = 10;
  while (y * 100 + m <= lastMonth) { months.push([y, m]); m++; if (m > 12) { m = 1; y++; } }
  const staticLabels = ['No', 'フラグ', '雇用区分', '拠点', 'PRJ', '業務区分', '社員番号', '氏名', '開始月'];
  const cols = staticLabels.map((l, i) => ({ id: 'S' + i, label: l, type: 'string' }));
  months.forEach(([yy, mm]) => {
    const closeM = mm === 12 ? 1 : mm + 1;
    cols.push({ id: `T${yy}${mm}`, label: `${closeM}/10締 ${yy}/${String(mm).padStart(2, '0')} 総勤務時間`, type: 'number' });
    cols.push({ id: `P${yy}${mm}`, label: '有給取得時間', type: 'number' });
    cols.push({ id: `J${yy}${mm}`, label: '実質勤務時間', type: 'number' });
  });
  const rows = [];
  let no = 1;
  SITES.forEach(site => {
    [['出荷', '社員'], ['出荷', 'パート'], ['栽培', '社員']].forEach(([work, emp], k) => {
      const cells = [no++, 1, emp, site, site, work, `E${no}`, `${site}${work}${k}`, null].map(gvizCell);
      months.forEach(() => { cells.push(gvizCell(160 / 24)); cells.push(null); cells.push(gvizCell(160 / 24)); });
      rows.push({ c: cells });
    });
  });
  return gvizText({ cols, rows });
}

/* ===================== モック：販売抽出シート ===================== */
function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) { return '﻿' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'; }

function buildSalesUrlCsv() {
  const rows = [['拠点', '区分', 'URL']];
  SITES.forEach(site => ['月初', 'MRP', '受注', '実績'].forEach(kind => {
    const gid = SALES_GIDS[site][kind];
    rows.push([site, kind, `https://docs.google.com/spreadsheets/d/${SALES_FILE_ID}/edit?gid=${gid}#gid=${gid}`]);
  }));
  return toCsv(rows);
}

const SALES_DATES = ['2026/08/31', '2026/09/01', '2026/09/15', '2026/09/30', '2026/10/01', '2026/10/20', '2026/11/01'];
// 拠点ごとの倍率kで値を変える。1,000以上はカンマ付き文字列（実シートの表示どおり）
function fmtSales(n) { return n >= 1000 ? n.toLocaleString('en-US') : String(n); }
function salesRowsFor(site, k) {
  // [個数/重量, 商品, 区分(秀・優…), サイズ, {日付: 値}]
  const items = [
    ['個数', '秀L6 130g', '秀', 'L', { '2026/08/31': 1000, '2026/09/01': 1200, '2026/09/15': 300, '2026/09/30': 5, '2026/10/01': 7, '2026/10/20': 11, '2026/11/01': 900 }],
    ['個数', '秀3L 250g', '秀', '3L', {}], // 全て空欄の行
    ['個数', '優2L袋 200g', '優', '2L', { '2026/09/01': 20, '2026/09/30': 'abc', '2026/10/01': 3 }],
    ['個数', '秀バラ1kg 1,000g', '秀', 'L', { '2026/09/15': 115, '2026/10/20': 2 }],
    ['個数', '袋入りバラ 500g', '袋①', '袋', { '2026/09/01': 4 }],
    ['個数', '', '', '', { '2026/09/01': 50 }], // 商品名が空欄の行（パックとして数える）
    ['個数', 'チビ用カップ 80g', '袋①', '袋', { '2026/09/15': 6, '2026/09/30': '-' }],
    ['重量', '秀L6 130g', '秀', 'L', { '2026/09/01': 999, '2026/09/15': 888, '2026/10/01': 777 }], // 重量の行は使わない
    ['重量', '優2L袋 200g', '優', '2L', { '2026/09/01': 4 }],
  ];
  const header = ['拠点', '個数/重量(kg)', '区分', '商品', '秀・優・袋・袋２', 'サイズ', ...SALES_DATES];
  const rows = [header];
  items.forEach(([kind, product, grade, size, vals]) => {
    rows.push([site, kind, '実績', product, grade, size, ...SALES_DATES.map(d => {
      const v = vals[d];
      if (v === undefined) return '';
      return typeof v === 'number' ? fmtSales(v * k) : v;
    })]);
  });
  return toCsv(rows);
}
const SALES_K = { 'いなべ': 1, '群馬': 2, '南丹': 3 };
// 期待値（倍率k=1あたり）。2026/9：パック=1200+300+5+50+6、袋=20+4、バラ=115。
// 2026/10：パック=7+11、袋=3、バラ=2。2026/08/31・2026/11/01の列は月が違うため含まない
const EXPECTED_SALES = {
  '2026/9':  { 'パック数': 1561, '袋数': 24, 'バラ数': 115 },
  '2026/10': { 'パック数': 18, '袋数': 3, 'バラ数': 2 },
};

/* ===================== モック：標準工数設定 ===================== */
function buildStdSettingsCsv() {
  return toCsv([
    ['cs数=(合計点数-バラ数)÷P/cs+バラ数'],
    ['パック・袋P/cs', 'バラのメトリック名'],
    ['30', 'バラ数'],
    ['業務区分', '作業区分', '1コンテナ当たり', '時間当たり(kg/h)', '1cs当たり', '1個当たり', '固定時間(h)', '単位', '考え方'],
    ['出荷', 'パック並べる', '', '', '', '3', '', '秒', ''],
    ['', '袋入れ・閉じ', '', '', '', '6', '', '秒', ''],
    ['', '段ボール詰める', '', '', '30', '', '', '秒', ''],
    ['', '付帯作業', '', '', '', '2', '', '秒', ''],
  ]);
}

/* ===================== ルーティング ===================== */
async function setupRoutes(page, opts) {
  const { lastMonth, salesUrlFail, salesFailSites } = opts;
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost')) return route.continue();
    if (url.includes('chart.umd')) {
      return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: CHART_JS_VENDORED });
    }
    if (!url.includes('docs.google.com')) return route.abort();
    const u = new URL(url);
    const gid = u.searchParams.get('gid');
    const sheet = u.searchParams.get('sheet');
    if (url.includes('/gviz/tq')) {
      let body;
      if (sheet === '整理済み_M') body = buildMGviz(lastMonth);
      else if (gid === PROD_GID) body = buildProdGviz();
      else if (gid === PLAN_GID) body = buildPlanGviz();
      else body = gvizText({ cols: [], rows: [] });
      return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body });
    }
    if (url.includes('/export')) {
      if (url.includes(DB_SHARE_SHEET_ID) && gid === SALES_URL_GID) {
        if (salesUrlFail) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'error' });
        return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: buildSalesUrlCsv() });
      }
      if (url.includes(DB_SHARE_SHEET_ID) && gid === STD_SETTINGS_GID) {
        return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: buildStdSettingsCsv() });
      }
      if (url.includes(SALES_FILE_ID)) {
        const site = SITES.find(s => SALES_GIDS[s]['実績'] === gid);
        salesTabRequests.push(gid);
        if (!site) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
        if (salesFailSites && salesFailSites.includes(site)) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'error' });
        return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: salesRowsFor(site, SALES_K[site]) });
      }
      return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' });
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
  });
}
let salesTabRequests = [];

/* ===================== 期待値 ===================== */
function planIdx(m) { return PLAN_MONTHS.indexOf(m); }
function expectedShipping(site, m, cutoff, salesOk) {
  const n = ym => { const [y, mo] = ym.split('/').map(Number); return y * 100 + mo; };
  const isAuto = n(m) >= 202609 && n(m) <= n(cutoff);
  let pack, bag, bara, futai;
  if (isAuto) {
    const e = EXPECTED_SALES[m];
    if (!salesOk || !e) return { 'パック数': null, '袋数': null, 'バラ数': null, '付帯作業': null, '合計(点数)': null };
    const k = SALES_K[site];
    pack = e['パック数'] * k; bag = e['袋数'] * k; bara = e['バラ数'] * k; futai = null;
  } else {
    const i = planIdx(m);
    const a = PLAN_ACTUAL[site];
    pack = a['パック数'][i]; bag = a['袋数'][i]; bara = a['バラ数'][i]; futai = a['付帯作業'][i];
  }
  return { 'パック数': pack, '袋数': bag, 'バラ数': bara, '付帯作業': futai, '合計(点数)': pack + bag + bara };
}

let okCount = 0, ngCount = 0;
function check(name, cond, extra) {
  if (cond) { okCount++; console.log(`  ${name}: OK`); }
  else { ngCount++; console.log(`  ${name}: NG${extra !== undefined ? ' (' + JSON.stringify(extra) + ')' : ''}`); }
}

/* ===================== ページ操作ヘルパー ===================== */
async function openPage(browser, opts) {
  salesTabRequests = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await setupRoutes(page, opts);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof allData !== 'undefined' && allData && typeof window.__cultTest === 'object', null, { timeout: 30000 });
  await page.evaluate(() => loadStdSettingsSheetOnce().catch(() => null));
  // 表示期間は2025年10月から12ヵ月（境目月が2026/10になる場合も同じ範囲を見る）
  await page.evaluate(() => { periodStartMonth = '2025年10月'; periodMonthCount = 12; });
  return page;
}

// prodData（fetchProductionSheet()の結果）から拠点・指標・月の値を取り出す
async function getProdValues(page) {
  return page.evaluate(async () => {
    const d = await fetchProductionSheet();
    const out = {};
    d.records.forEach(r => {
      if (!['パック数', '袋数', 'バラ数', '付帯作業', '合計(点数)'].includes(r.metric)) return;
      if (!out[r.site]) out[r.site] = {};
      out[r.site][r.metric] = {};
      d.months.forEach((m, i) => { out[r.site][r.metric][m] = r.values[i]; });
    });
    return { months: d.months, values: out, counts: d.records.filter(r => r.metric === 'パック数').map(r => r.site) };
  });
}

// rowspanを考慮して表を2次元配列（テキスト）に展開する
const TABLE_GRID_FN = `
  function tableToGrid(table) {
    const grid = [];
    const rows = Array.from(table.querySelectorAll('tr'));
    rows.forEach((tr, ri) => {
      if (!grid[ri]) grid[ri] = [];
      let ci = 0;
      Array.from(tr.children).forEach(cell => {
        while (grid[ri][ci] !== undefined) ci++;
        const rs = parseInt(cell.getAttribute('rowspan') || '1', 10);
        for (let k = 0; k < rs; k++) {
          if (!grid[ri + k]) grid[ri + k] = [];
          grid[ri + k][ci] = cell.textContent.trim();
        }
        ci++;
      });
    });
    return grid;
  }
`;

// 表（拠点・カテゴリ・指標の3列＋月の列）から { site: { metric: { 月(yyyy/M): テキスト } } } を作る。
// blockLabelが文字列ならカテゴリ列がその文言の行、数値なら拠点内でその指標が何回目に
// 出てくる行か（1始まり）で選ぶ。予実＞生産計画の表は、付帯作業の行のカテゴリの割り当てが
// 既存の仕様上「出荷内訳（構成比）」「出荷内訳（計画）」の文言と一致しないことがあるため、
// 何回目の行か（1回目＝構成比、2回目＝実数計画）で選ぶ
async function readSiteMetricTable(page, metrics, blockLabel) {
  return page.evaluate(({ fnSrc, metrics, blockLabel }) => {
    eval(fnSrc);
    const table = document.querySelector('#main table.prod-table');
    const grid = tableToGrid(table);
    const header = grid[0];
    const out = {};
    const seen = {};
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];
      const site = row[0], cat = row[1], metric = row[2];
      if (!metrics.includes(metric)) continue;
      const key = site + '/' + metric;
      seen[key] = (seen[key] || 0) + 1;
      if (typeof blockLabel === 'string' && cat !== blockLabel) continue;
      if (typeof blockLabel === 'number' && seen[key] !== blockLabel) continue;
      if (!out[site]) out[site] = {};
      out[site][metric] = {};
      for (let c = 3; c < header.length; c++) {
        const h = normalizeMonth(header[c]);
        if (h) out[site][metric][h] = row[c];
      }
    }
    return out;
  }, { fnSrc: TABLE_GRID_FN, metrics, blockLabel });
}

// 標準工数(h)・予定標準工数(h)の表（拠点ごと、作業区分の行）から { site: { task: { 月: テキスト } } }
async function readStdHoursTables(page, tasks) {
  return page.evaluate(({ fnSrc, tasks }) => {
    eval(fnSrc);
    const out = {};
    const headers = Array.from(document.querySelectorAll('#main .schart-header'));
    headers.forEach(h => {
      const site = h.textContent.replace('📍', '').trim();
      const table = h.parentElement.querySelector('table.prod-table');
      if (!table) return;
      const grid = tableToGrid(table);
      const header = grid[0];
      out[site] = {};
      for (let r = 1; r < grid.length; r++) {
        const task = grid[r][1];
        if (!tasks.includes(task)) continue;
        out[site][task] = {};
        for (let c = 3; c < header.length; c++) {
          // 予定標準工数(h)の見出しは「2026/9実績」のように月の後ろに実績／計画の注記が付く
          const hm = String(header[c]).match(/^(\d{4}\/\d{1,2}|\d{4}年\d{1,2}月)/);
          if (hm) out[site][task][normalizeMonth(hm[1])] = grid[r][c];
        }
      }
    });
    return out;
  }, { fnSrc: TABLE_GRID_FN, tasks });
}

async function renderAndWait(page, fnName) {
  await page.evaluate(fn => { window[fn](); }, fnName);
  await page.waitForFunction(() => !document.querySelector('#main .loading'), null, { timeout: 30000 });
  await page.waitForTimeout(100);
}

function fmtProd(v) { return v === null ? '—' : v.toLocaleString('ja-JP'); }
function fmtPlan(v) { return v === null ? '' : v.toLocaleString('ja-JP', { maximumFractionDigits: 0 }); }
function fmtH(h) { return h === null ? '—' : (h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString('ja-JP')) + ' h'; }

/* ===================== 本体 ===================== */
(async () => {
  const browser = await chromium.launch();

  // ---------- (A) 純粋関数 ----------
  console.log('(A) 純粋関数（区分判定・暦月の集計・実数計画の行の選び方）');
  {
    const page = await openPage(browser, { lastMonth: 202609 });
    const r = await page.evaluate(({ salesCsv, urlCsv }) => {
      const t = window.__cultTest;
      const cls = ['秀袋 200g', '優2L袋 200g', '袋入りバラ 500g', '秀バラ1kg 1,000g', 'バラ1kg 1,000g', '秀L6 130g', 'チビ用カップ 80g', '', null, '  ']
        .map(n => t.classifyShippingProductMetric(n));
      const agg = t.aggregateShippingSalesMonthly(parseCsv(salesCsv.replace(/^﻿/, '')));
      const urls = t.parseShippingSalesUrlSheet(parseCsv(urlCsv.replace(/^﻿/, '')));
      let noHeaderError = null;
      try { t.aggregateShippingSalesMonthly([['拠点', '区分', '2026/09/01'], ['いなべ', '実績', '5']]); } catch (e) { noHeaderError = e.message; }
      const emptyMonth = t.aggregateShippingSalesMonthly([['個数/重量(kg)', '商品', '2026/12/01'], ['個数', 'x', '']]);
      return {
        rules: t.SHIPPING_PRODUCT_CLASSIFICATION_RULES.map(x => x.label),
        cls, agg, urls, noHeaderError, emptyMonth,
        autoFrom: t.SHIPPING_AUTO_FROM,
        src: ['2026/8', '2026/9', '2026/10', '2026/11'].map(m => t.shippingActualSourceForMonth(m, '2026/10')),
      };
    }, { salesCsv: salesRowsFor('いなべ', 1), urlCsv: buildSalesUrlCsv() });
    check('自動計算を始める月の設定値が2026/09', r.autoFrom === '2026/09', r.autoFrom);
    check('区分判定の順が 袋→バラ→パック（直近工数計画と同じ）', JSON.stringify(r.rules) === JSON.stringify(['袋', 'バラ', 'パック']), r.rules);
    check('区分判定：「袋」を含む→袋数（袋とバラの両方を含む場合も袋）', r.cls[0] === '袋数' && r.cls[1] === '袋数' && r.cls[2] === '袋数', r.cls);
    check('区分判定：「バラ」を含む→バラ数', r.cls[3] === 'バラ数' && r.cls[4] === 'バラ数', r.cls);
    check('区分判定：それ以外→パック数（チビ用カップ含む）', r.cls[5] === 'パック数' && r.cls[6] === 'パック数', r.cls);
    check('区分判定：商品名が空欄→パック数', r.cls[7] === 'パック数' && r.cls[8] === 'パック数' && r.cls[9] === 'パック数', r.cls);
    check('暦月の集計：2026/9＝09/01〜09/30の列の合計（個数の行のみ・カンマ除去・数字でない値は読み飛ばし）',
      JSON.stringify(r.agg.byMonth['2026/9']) === JSON.stringify(EXPECTED_SALES['2026/9']), r.agg.byMonth['2026/9']);
    check('暦月の集計：2026/10＝10/01〜10/31の列', JSON.stringify(r.agg.byMonth['2026/10']) === JSON.stringify(EXPECTED_SALES['2026/10']), r.agg.byMonth['2026/10']);
    check('暦月の集計：08/31の列は2026/8、11/01の列は2026/11に入る（2026/9・10に混ざらない）',
      r.agg.byMonth['2026/8']['パック数'] === 1000 && r.agg.byMonth['2026/11']['パック数'] === 900, [r.agg.byMonth['2026/8'], r.agg.byMonth['2026/11']]);
    check('日付の列があり値が空欄だけの月は0', JSON.stringify(r.emptyMonth.byMonth['2026/12']) === JSON.stringify({ 'パック数': 0, '袋数': 0, 'バラ数': 0 }), r.emptyMonth);
    check('「個数/重量(kg)」「商品」の見出しが無い場合は読み込み失敗（例外）', !!r.noHeaderError, r.noHeaderError);
    check('参照先一覧：区分「実績」のURLから拠点ごとのID・gidを取得',
      SITES.every(s => r.urls[s]['実績'] && r.urls[s]['実績'].id === SALES_FILE_ID && r.urls[s]['実績'].gid === SALES_GIDS[s]['実績']), r.urls);
    check('取得元：2026/8=計画、2026/9・10=自動（境目月2026/10）、2026/11=計画', JSON.stringify(r.src) === JSON.stringify(['plan', 'auto', 'auto', 'plan']), r.src);

    const pick = await page.evaluate(async () => {
      const plan = await fetchPlanSheet();
      const rows = window.__cultTest.findPlanShippingActualRows(plan.records, '群馬');
      const i = plan.months.indexOf('2026/5');
      const o = {};
      Object.keys(rows).forEach(k => { o[k] = rows[k].values[i]; });
      return o;
    });
    check('整理済み_計画_更新から「実数計画」のまとまり（構成比ではない）の行を選ぶ',
      pick['パック数'] === 82824 && pick['袋数'] === 29940 && pick['バラ数'] === 85 && pick['付帯作業'] === 11570, pick);
    await page.close();
  }

  // ---------- (B) 境目月 2026/9 ----------
  console.log('(B) 境目月が2026/9の場合（整理済み_Mの実データが2026/9まで）');
  let prodB;
  {
    const page = await openPage(browser, { lastMonth: 202609 });
    const cutoff = await page.evaluate(() => getActualCutoffMonth());
    check('境目月＝2026/9', cutoff === '2026/9', cutoff);
    prodB = await getProdValues(page);
    const metrics = ['パック数', '袋数', 'バラ数', '付帯作業', '合計(点数)'];
    let planOk = true, autoOk = true, afterOk = true, sumOk = true, notProdOk = true;
    const bad = [];
    SITES.forEach(site => {
      prodB.months.forEach(m => {
        const exp = expectedShipping(site, m, cutoff, true);
        metrics.forEach(metric => {
          const v = prodB.values[site][metric][m];
          const e = exp[metric];
          const same = v === e;
          if (!same) bad.push({ site, m, metric, v, e });
          if (m === '2026/9') { if (!same) autoOk = false; }
          else if (m === '2026/10') { if (!same) afterOk = false; }
          else if (!same) planOk = false;
          if (v === 777777 || v === 777778 || v === 777779) notProdOk = false;
        });
        const s = ['パック数', '袋数', 'バラ数'].map(k => prodB.values[site][k][m]);
        const tot = prodB.values[site]['合計(点数)'][m];
        if (s.some(x => x !== null) && tot !== s.reduce((a, b) => a + (b || 0), 0)) sumOk = false;
      });
    });
    check('〜2026/8 は整理済み_計画_更新の実数計画の値（パック・袋・バラ・付帯作業）', planOk, bad.filter(b => b.m !== '2026/9' && b.m !== '2026/10').slice(0, 3));
    check('2026/9 は販売抽出シートから自動計算（計画_更新の値は使わない）・付帯作業は「－」', autoOk, bad.filter(b => b.m === '2026/9').slice(0, 3));
    check('境目月より後（2026/10）は計画_更新の実数計画の値のまま（付帯作業含む）', afterOk, bad.filter(b => b.m === '2026/10').slice(0, 3));
    check('合計(点数)＝パック＋袋＋バラ（全ての月、付帯作業・シートの合計は使わない）', sumOk);
    check('整理済み_分析の出荷内訳の値は使われていない', notProdOk);
    check('2026/9 の付帯作業は全拠点 null（「－」）', SITES.every(s => prodB.values[s]['付帯作業']['2026/9'] === null));
    check('出荷内訳の行は拠点ごとに1つずつ（重複・欠落なし）', JSON.stringify(prodB.counts) === JSON.stringify(SITES), prodB.counts);
    check('販売抽出シートは実績タブだけを読む（3拠点分）',
      salesTabRequests.length === 3 && SITES.every(s => salesTabRequests.includes(SALES_GIDS[s]['実績'])), salesTabRequests);

    // 生産実績タブ
    await renderAndWait(page, 'renderProductionTab');
    const prodTable = await readSiteMetricTable(page, metrics, '出荷内訳（実績）');
    let domOk = true; const domBad = [];
    SITES.forEach(site => metrics.forEach(metric => ['2025/10', '2026/5', '2026/8', '2026/9'].forEach(m => {
      const exp = fmtProd(expectedShipping(site, m, cutoff, true)[metric]);
      const got = prodTable[site] && prodTable[site][metric] && prodTable[site][metric][m];
      if (got !== exp) { domOk = false; domBad.push({ site, metric, m, got, exp }); }
    })));
    check('勤務実績＞生産実績：出荷内訳（実績）の表示が期待値どおり（2026/9の付帯作業は「—」）', domOk, domBad.slice(0, 4));
    const alertHtml = await page.evaluate(() => document.getElementById('shipping-actual-alerts').textContent.trim());
    check('販売抽出シートを読めた場合は出荷内訳のアラートを出さない', alertHtml === '', alertHtml);

    // 勤務実績＞標準工数(h)
    const tasks = ['パック並べる', '袋入れ・閉じ', '段ボール詰める', '付帯作業'];
    await renderAndWait(page, 'renderStdHoursTab');
    const stdTab = await readStdHoursTables(page, tasks);
    // 予実＞予定標準工数(h)
    await renderAndWait(page, 'renderPlanStdHoursTab');
    const planStdTab = await readStdHoursTables(page, tasks);
    let stdOk = true, sameOk = true; const stdBad = [];
    const pastMonths = ['2025/10', '2026/3', '2026/8', '2026/9'];
    SITES.forEach(site => pastMonths.forEach(m => {
      const e = expectedShipping(site, m, cutoff, true);
      const expH = {
        'パック並べる': e['パック数'] * 3 / 3600,
        '袋入れ・閉じ': e['袋数'] * 6 / 3600,
        '段ボール詰める': ((Math.max(0, e['合計(点数)'] - e['バラ数']) / 30) + e['バラ数']) * 30 / 3600,
        '付帯作業': (site === 'いなべ' || e['付帯作業'] === null) ? null : e['付帯作業'] * 2 / 3600,
      };
      tasks.forEach(task => {
        const got = stdTab[site] && stdTab[site][task] && stdTab[site][task][m];
        const exp = fmtH(expH[task]);
        if (got !== exp) { stdOk = false; stdBad.push({ site, task, m, got, exp }); }
        const got2 = planStdTab[site] && planStdTab[site][task] && planStdTab[site][task][m];
        if (got2 !== got) { sameOk = false; stdBad.push({ screen: 'planstd', site, task, m, got2, got }); }
      });
    }));
    check('勤務実績＞標準工数(h)：パック・袋・合計・付帯作業から計算した工数が期待値どおり（2026/9の付帯作業は「—」）', stdOk, stdBad.slice(0, 4));
    check('予実＞予定標準工数(h)の過去月（〜2026/9）が勤務実績＞標準工数(h)と同じ値', sameOk, stdBad.filter(b => b.screen).slice(0, 4));
    // 未来月（2026/11以降）は計画データ（実数計画）の値のまま
    let futureOk = true; const futBad = [];
    SITES.forEach(site => ['2026/11', '2026/12', '2027/1'].forEach(m => {
      const i = planIdx(m);
      const a = PLAN_ACTUAL[site];
      // 未来月の読み方は変えていない（既存の createStdHoursEngine の preferredCat='実数計画' の
      // 読み方：パック数＝シートの合計(点数)−袋数−バラ数）
      const expPack = fmtH((a['合計(点数)'][i] - a['袋数'][i] - a['バラ数'][i]) * 3 / 3600);
      const got = planStdTab[site]['パック並べる'][m];
      if (got !== expPack) { futureOk = false; futBad.push({ site, m, got, expPack }); }
    }));
    check('予実＞予定標準工数(h)の未来月は今までどおり計画_更新の実数計画から計算', futureOk, futBad.slice(0, 3));

    // 予実＞生産計画
    await renderAndWait(page, 'renderPlanTab');
    const planTable = await readSiteMetricTable(page, metrics, 2);
    let planTabOk = true, planFutureOk = true; const ptBad = [];
    SITES.forEach(site => metrics.forEach(metric => PLAN_MONTHS.forEach(m => {
      const got = planTable[site][metric][m];
      const n = Number(m.split('/')[0]) * 100 + Number(m.split('/')[1]);
      if (n <= 202609) {
        const pv = prodB.values[site][metric][m];
        const exp = fmtPlan(pv);
        if (got !== exp) { planTabOk = false; ptBad.push({ site, metric, m, got, exp }); }
      } else {
        const exp = fmtPlan(PLAN_ACTUAL[site][metric][planIdx(m)]);
        if (got !== exp) { planFutureOk = false; ptBad.push({ site, metric, m, got, exp, future: true }); }
      }
    })));
    check('予実＞生産計画：出荷内訳／実数計画の行の過去月（〜境目月）が生産実績と同じ値', planTabOk, ptBad.filter(b => !b.future).slice(0, 4));
    check('予実＞生産計画：境目月より後の月はシートの値のまま', planFutureOk, ptBad.filter(b => b.future).slice(0, 4));
    const ratioRow = await readSiteMetricTable(page, ['パック数'], 1);
    check('予実＞生産計画：出荷内訳／構成比の行は変わらない', ratioRow['いなべ']['パック数']['2026/9'] === '0.7', ratioRow['いなべ']['パック数']['2026/9']);
    await page.close();
  }

  // ---------- (C) 境目月が2026/10に進んだ場合 ----------
  console.log('(C) 境目月が2026/10に進んだ場合（整理済み_Mの実データが2026/10まで）');
  {
    const page = await openPage(browser, { lastMonth: 202610 });
    const cutoff = await page.evaluate(() => getActualCutoffMonth());
    check('境目月＝2026/10', cutoff === '2026/10', cutoff);
    const prod = await getProdValues(page);
    const bad = [];
    SITES.forEach(site => ['2026/8', '2026/9', '2026/10'].forEach(m => {
      const exp = expectedShipping(site, m, cutoff, true);
      Object.keys(exp).forEach(metric => {
        if (prod.values[site][metric][m] !== exp[metric]) bad.push({ site, m, metric, v: prod.values[site][metric][m], e: exp[metric] });
      });
    }));
    check('2026/10 も販売抽出シートから自動計算（付帯作業「－」）、2026/9 も自動・2026/8 は計画_更新', bad.length === 0, bad.slice(0, 4));
    // 予定標準工数(h)の2026/10（境目月以前＝実績側）も自動計算の値
    await renderAndWait(page, 'renderPlanStdHoursTab');
    const planStd = await readStdHoursTables(page, ['パック並べる', '付帯作業']);
    check('予実＞予定標準工数(h)の2026/10も自動計算の値から計算（群馬：パック並べる・付帯作業「—」）',
      planStd['群馬']['パック並べる']['2026/10'] === fmtH(18 * 2 * 3 / 3600) && planStd['群馬']['付帯作業']['2026/10'] === '—',
      [planStd['群馬']['パック並べる']['2026/10'], planStd['群馬']['付帯作業']['2026/10']]);
    await page.close();
  }

  // ---------- (D) 販売抽出シートの読み込みに失敗した場合 ----------
  console.log('(D) 販売抽出シートの読み込みに失敗した場合');
  {
    const page = await openPage(browser, { lastMonth: 202609, salesUrlFail: true });
    const prod = await getProdValues(page);
    const cutoff = '2026/9';
    let autoNull = true, othersOk = true;
    SITES.forEach(site => {
      ['パック数', '袋数', 'バラ数', '付帯作業', '合計(点数)'].forEach(metric => {
        if (prod.values[site][metric]['2026/9'] !== null) autoNull = false;
        ['2025/10', '2026/8', '2026/10'].forEach(m => {
          if (prod.values[site][metric][m] !== expectedShipping(site, m, cutoff, true)[metric]) othersOk = false;
        });
      });
    });
    check('参照先一覧の読み込み失敗：自動計算の月（2026/9）だけ「－」', autoNull);
    check('参照先一覧の読み込み失敗：他の月（計画_更新の月）は表示される', othersOk);
    await renderAndWait(page, 'renderProductionTab');
    const prodTable = await readSiteMetricTable(page, ['パック数', '合計(点数)'], '出荷内訳（実績）');
    check('生産実績タブは表示が止まらず、2026/9は「—」・2026/8は値',
      prodTable['いなべ']['パック数']['2026/9'] === '—' && prodTable['いなべ']['パック数']['2026/8'] === fmtProd(50627)
      && prodTable['南丹']['合計(点数)']['2026/9'] === '—',
      [prodTable['いなべ']['パック数']['2026/9'], prodTable['いなべ']['パック数']['2026/8']]);
    const alert = await page.evaluate(() => ({
      text: document.getElementById('shipping-actual-alerts').textContent,
      box: !!document.querySelector('#shipping-actual-alerts .transfer-alert-box'),
      top: (() => { const a = document.getElementById('shipping-actual-alerts'); const m = document.getElementById('main'); return a.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING; })(),
    }));
    check('画面上部に既存のアラート（transfer-alert-box）の仕組みで知らせる',
      alert.box && !!alert.top && alert.text.includes('販売抽出シート') && alert.text.includes('2026/9'), alert.text);
    // 他のタブも止まらない
    await renderAndWait(page, 'renderStdHoursTab');
    const std = await readStdHoursTables(page, ['パック並べる']);
    check('勤務実績＞標準工数(h)も表示され、2026/9は「—」・2026/8は値',
      std['いなべ']['パック並べる']['2026/9'] === '—' && std['いなべ']['パック並べる']['2026/8'] === fmtH(50627 * 3 / 3600),
      std['いなべ']['パック並べる']);
    await page.close();
  }
  {
    const page = await openPage(browser, { lastMonth: 202609, salesFailSites: ['群馬'] });
    const prod = await getProdValues(page);
    check('1拠点（群馬）の実績タブだけ読み込み失敗：群馬の2026/9だけ「－」、他の拠点は自動計算',
      prod.values['群馬']['パック数']['2026/9'] === null && prod.values['群馬']['パック数']['2026/8'] === 52234
      && prod.values['いなべ']['パック数']['2026/9'] === 1561 && prod.values['南丹']['パック数']['2026/9'] === 1561 * 3,
      [prod.values['群馬']['パック数']['2026/9'], prod.values['いなべ']['パック数']['2026/9']]);
    const warn = await page.evaluate(() => window.__cultTest.getShippingActualWarningMessages());
    check('1拠点の失敗もアラートに出る', warn.some(w => w.includes('群馬')), warn);
    await page.close();
  }

  await browser.close();
  console.log(`\n${ngCount === 0 ? 'すべてOK' : 'NGあり'} (OK ${okCount} / NG ${ngCount})`);
  console.log('DONE');
  process.exit(ngCount === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
