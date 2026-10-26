// dashboard/work-hours.html から整理済み_分析（PROD_GID）への依存をなくし、勤務実績＞生産実績の
// 表（prodData）の骨組みを整理済み_計画_更新から作るようにした変更、および予実＞生産計画の
// 過去月（実績月）を実績の値で表示するようにした変更の検証。
//
// モックは実際のシートの構成に合わせている（2026/10時点の実シートをSheets APIで確認）。
//   ・整理済み_M：見出し3行（締め日／実質月"yyyy/MM"／列種別）。実データは2025/08から
//     （整理済み_計画_更新の見出しより前の月がある）
//   ・整理済み_計画_更新：A=拠点・B=カテゴリ・C=指標、D列以降の1行目が"yyyy/M"（2025/10〜2027/2）。
//     各拠点に 生産実績（南丹は「生販実績」）3行→栽培内訳7行→出荷内訳／構成比5行→
//     出荷内訳／実数計画5行。過去月にも値（計画値の残り）が入っている
//   ・DB共有「URL_収穫管理表」：1行目「収穫管理表／いなべ／群馬／南丹」、A列に"yyyy/M"、
//     各セルに収穫管理表のURL（gid=676064999）。収穫管理表の「収獲目標値」シートは
//     A1="YY/M/D/曜"、3行目の見出しに「収穫実績値」、A列「合計」の行
//   ・DB共有「URL_売上分析」：1行目「出荷量／いなべ／群馬／南丹」、A列に年。売り上げ分析シートは
//     2行目の見出しに「出荷量(固定)」、A列「1月」〜「12月」（g単位）
//   ・菌床納品実績「菌床数集計」：1行目「(空)／拠点／菌床／2025.1…」、A列「菌床数」の欄の
//     拠点ごとの「合計」の行
//   ・DB共有「販売抽出シート(商品別)」・各拠点の実績タブ：verify_shipping_actual_auto.jsと同じ
//   ・整理済み_分析：モックは用意しない（読みに行った場合は記録して404を返す）
//   ・栽培管理シート：このテストの対象外のため空のCSV（栽培内訳は「－」＋警告。変更前と同じ扱い）
//
// 確認内容は README.md の「verify_remove_prod_sheet.js」の項を参照。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CHART_JS_VENDORED = fs.readFileSync(path.join(__dirname, 'vendor', 'chart.umd.js'), 'utf8');
const HTML_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard', 'work-hours.html'), 'utf8');
const BASE_URL = 'http://localhost:8813/work-hours.html';

const PROD_SHEET_GID = '2016642543'; // 整理済み_分析（読みに行かないことの確認用）
const PLAN_GID = '530402103';
const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const HARVEST_URL_GID = '1996914203';
const SHIPMENT_URL_GID = '1981610050';
const SALES_URL_GID = '1130067935';
const STD_SETTINGS_GID = '264266810';
const KINSHO_SHEET_ID = '1oR_Qp16haR6zccY7LZJ_OW1hqu8_dnb9k_yj1iLunzY';
const SALES_FILE_ID = '17DD5aRxc9bv8uZzEfnK_Q9IGOvQVH4ieJU1c-qu7dOc';
const SHIPMENT_FILE_ID = '1RyGT1x_qwJnjiKe5PMMn9Eb58wIxWB15XhjowmEcfQM';
const SALES_GIDS = {
  'いなべ': { '月初': '857573225', 'MRP': '1525325950', '受注': '545062393', '実績': '1095512122' },
  '群馬':   { '月初': '1752000481', 'MRP': '454579971', '受注': '1218802781', '実績': '1157026839' },
  '南丹':   { '月初': '116847058', 'MRP': '1991870263', '受注': '24647903', '実績': '502246564' },
};
const SHIPMENT_GIDS = {
  'いなべ': { '2025': '1703536953', '2026': '1140951232' },
  '群馬':   { '2025': '823389807', '2026': '1548875941' },
  '南丹':   { '2025': '1528070455', '2026': '1253700878' },
};
const SITES = ['いなべ', '群馬', '南丹'];
const SITE_CODE = { 'いなべ': 'inabe', '群馬': 'gunma', '南丹': 'nantan' };
const CULT_METRICS = ['菌床入れ', '芽かき', '収穫', '注水', '散水', '廃棄', '稼働コンテナ数'];
const SHIP_METRICS = ['パック数', '袋数', 'バラ数', '付帯作業', '合計(点数)'];
const RATIO_METRICS = ['パック数', '袋数', 'バラ数', '付帯作業'];

function ymNum(m) { const [y, mo] = String(m).split('/').map(Number); return y * 100 + mo; }
function monthsBetween(from, to) {
  const out = []; let [y, m] = from.split('/').map(Number);
  while (y * 100 + m <= ymNum(to)) { out.push(`${y}/${m}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/* ===================== 期待値の元になる値 ===================== */
// 菌床数集計（合計の行）：拠点ごとの基準値＋月の通し番号×10
const KINSHO_BASE = { 'いなべ': 30000, '群馬': 20000, '南丹': 10000 };
const KINSHO_MONTHS = monthsBetween('2025/1', '2026/12');
function kinshoValue(site, m) { return KINSHO_BASE[site] + KINSHO_MONTHS.indexOf(m) * 10; }
// 収穫管理表（合計の行の収穫実績値）。群馬の2026/3はURL_収穫管理表にURLが無い（→「－」）
const HARVEST_NO_URL = { site: '群馬', month: '2026/3' };
function harvestValue(site, m) {
  if (site === HARVEST_NO_URL.site && m === HARVEST_NO_URL.month) return null;
  if (ymNum(m) < 202510 || ymNum(m) > 202610) return null; // URL_収穫管理表は2025/10〜2026/10
  const [y, mo] = m.split('/').map(Number);
  return 10000 + SITES.indexOf(site) * 1000 + mo * 10 + (y - 2025) * 500 + 0.5;
}
// 売り上げ分析（出荷量(固定)、g単位 → 表示はkg）
// 小数（.4）を含めて、表示が整数に丸められることを確認できるようにしてある
function shipmentKg(site, m) {
  const [y, mo] = m.split('/').map(Number);
  return 8000 + SITES.indexOf(site) * 1000 + mo + (y - 2025) * 100 + 0.4;
}

// 整理済み_計画_更新
const PLAN_MONTHS = monthsBetween('2025/10', '2027/2');
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
    '合計(点数)': [89575, 117910, 118817, 152351, 142687, 134368, 106687, 124419, 121009, 99133, 86376, 0, 0, 147437, 219074, 331174, 198704],
  },
  '南丹': {
    // 2026/2 は合計(点数)が0になる月（構成比が「－」になることの確認用）
    'パック数': [37419, 39831, 65103, 46815, 0, 35462, 32234, 33500, 37921, 37427, 36967, 55003, 66003, 63345, 86547, 121158, 67848],
    '袋数':     [26213, 22884, 39782, 26410, 0, 22972, 20728, 16931, 23193, 20490, 8909, 15003, 16003, 32270, 44090, 61722, 34564],
    'バラ数':   [218, 296.5, 541, 527, 0, 408, 451, 341, 365, 323, 298, 303, 403, 1195, 1633, 2286, 1280],
    '付帯作業': [13046, 4931, 18706, 14633, 0, 18451, 14996, 12961, 13870, 10690, 295, 9003, 9903, 23904, 32659, 45720, 25603],
    '合計(点数)': [63850, 63012, 105426, 73752, 0, 58842, 53413, 50772, 61479, 58240, 46174, 0, 0, 119520, 163297, 228600, 128016],
  },
};
// 計画_更新の構成比の行（シートの値。未来月はこのまま小数2桁で表示される）
const PLAN_RATIO = { 'パック数': 0.73, '袋数': 0.26, 'バラ数': 0.01, '付帯作業': 0, '合計(点数)': 6.85 };
// 計画_更新の生産実績・栽培内訳の行（計画値。過去月には「実績を写した値の残り」として入っている想定）
const PLAN_SUMMARY = { '菌床購入数(本)': 99999, '収穫量(kg)': 88888, '出荷量(kg)': 77777 };
const PLAN_CULT = 555;

// 販売抽出シート（2026/9〜の自動計算。verify_shipping_actual_auto.jsと同じ構成）
const SALES_DATES = ['2026/08/31', '2026/09/01', '2026/09/15', '2026/09/30', '2026/10/01', '2026/10/20', '2026/11/01'];
const SALES_K = { 'いなべ': 1, '群馬': 2, '南丹': 3 };
const EXPECTED_SALES = {
  '2026/9':  { 'パック数': 1561, '袋数': 24, 'バラ数': 115 },
  '2026/10': { 'パック数': 18, '袋数': 3, 'バラ数': 2 },
};

function expectedShipping(site, m, cutoff) {
  const isAuto = ymNum(m) >= 202609 && ymNum(m) <= ymNum(cutoff);
  let pack, bag, bara, futai;
  if (isAuto) {
    const e = EXPECTED_SALES[m]; const k = SALES_K[site];
    pack = e['パック数'] * k; bag = e['袋数'] * k; bara = e['バラ数'] * k; futai = null;
  } else {
    const i = PLAN_MONTHS.indexOf(m);
    if (i < 0) return { 'パック数': null, '袋数': null, 'バラ数': null, '付帯作業': null, '合計(点数)': null };
    const a = PLAN_ACTUAL[site];
    pack = a['パック数'][i]; bag = a['袋数'][i]; bara = a['バラ数'][i]; futai = a['付帯作業'][i];
  }
  return { 'パック数': pack, '袋数': bag, 'バラ数': bara, '付帯作業': futai, '合計(点数)': pack + bag + bara };
}
// prodData（実績）の期待値。栽培内訳は栽培管理シートが空のモックのため全てnull
function expectedActual(site, metric, m, cutoff) {
  if (metric === '菌床購入数(本)') return KINSHO_MONTHS.includes(m) ? kinshoValue(site, m) : null;
  if (metric === '収穫量(kg)') return harvestValue(site, m);
  if (metric === '出荷量(kg)') return shipmentKg(site, m);
  if (CULT_METRICS.includes(metric)) return null;
  return expectedShipping(site, m, cutoff)[metric];
}
function expectedRatio(site, metric, m, cutoff) {
  if (metric === '付帯作業' || metric === '合計(点数)') return null;
  const e = expectedShipping(site, m, cutoff);
  if (!e['合計(点数)']) return null;
  return e[metric] === null ? null : e[metric] / e['合計(点数)'];
}

/* ===================== モックの組み立て ===================== */
function gvizCell(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return { v, f: v.toLocaleString('en-US') };
  return { v: String(v) };
}
function gvizText(table) {
  return `/*O_o*/\ngoogle.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"ok","sig":"1","table":${JSON.stringify(table)}});`;
}
function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) { return '﻿' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'; }

function buildPlanGviz(opts) {
  const n = PLAN_MONTHS.length;
  const cols = [{ id: 'A', label: '予測', type: 'string' }, { id: 'B', label: '', type: 'string' }, { id: 'C', label: '', type: 'string' }]
    .concat(PLAN_MONTHS.map((m, i) => ({ id: 'M' + i, label: m, type: 'number' })));
  const rows = [];
  SITES.forEach(site => {
    const r = [];
    const summaryCat = site === '南丹' ? '生販実績' : '生産実績';
    const summary = Object.keys(PLAN_SUMMARY).filter(m => !(opts.noKinshoRowSite === site && m === '菌床購入数(本)'));
    summary.forEach((metric, i) => r.push([i === 0 ? site : '', i === 0 ? summaryCat : '', metric, ...Array(n).fill(PLAN_SUMMARY[metric])]));
    if (!summary.length) r.push([site, summaryCat, '', ...Array(n).fill(null)]);
    CULT_METRICS.forEach((metric, i) => r.push(['', i === 0 ? '栽培内訳' : (i === 1 ? '(コンテナ数）' : ''), metric, ...Array(n).fill(PLAN_CULT)]));
    SHIP_METRICS.forEach((metric, i) => r.push(['', i === 0 ? '出荷内訳' : (i === 1 ? '構成比' : ''), metric, ...Array(n).fill(PLAN_RATIO[metric])]));
    SHIP_METRICS.forEach((metric, i) => r.push(['', i === 0 ? '出荷内訳' : (i === 1 ? '実数計画' : ''), metric, ...PLAN_ACTUAL[site][metric]]));
    r.forEach(x => rows.push({ c: x.map(gvizCell) }));
  });
  return gvizText({ cols, rows });
}

function buildMGviz(lastMonth) {
  const months = monthsBetween('2025/8', lastMonth).map(m => m.split('/').map(Number));
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

function buildHarvestUrlCsv() {
  const rows = [['収穫管理表', 'いなべ', '群馬', '南丹']];
  monthsBetween('2025/10', '2027/1').forEach(m => {
    const row = [m];
    SITES.forEach(site => {
      if (harvestValue(site, m) === null) { row.push(''); return; }
      const [y, mo] = m.split('/');
      row.push(`https://docs.google.com/spreadsheets/d/harv-${SITE_CODE[site]}-${y}-${mo}/edit?gid=676064999#gid=676064999`);
    });
    rows.push(row);
  });
  return toCsv(rows);
}
function buildHarvestTargetCsv(site, m) {
  const [y, mo] = m.split('/').map(Number);
  const v = harvestValue(site, m);
  return toCsv([
    [`${String(y).slice(2)}/${mo}/1/水`, '', ''],
    ['収獲目標値', '', ''],
    ['日付', '収穫目標値', '収穫実績値'],
    [`${mo}/1`, '400', '380'],
    ['合計', '12,000kg', `${v.toLocaleString('en-US')}kg`],
  ]);
}
function buildShipmentUrlCsv() {
  const rows = [['出荷量', 'いなべ', '群馬', '南丹']];
  ['2025', '2026'].forEach(y => rows.push([y, ...SITES.map(s => `https://docs.google.com/spreadsheets/d/${SHIPMENT_FILE_ID}/edit?gid=${SHIPMENT_GIDS[s][y]}#gid=${SHIPMENT_GIDS[s][y]}`)]));
  rows.push(['2027']);
  return toCsv(rows);
}
function buildShipmentYearCsv(site, year) {
  const rows = [[`${year}年 売り上げ分析`], ['月', '出荷量(実重量)', '出荷量(固定)', '売上']];
  for (let mo = 1; mo <= 12; mo++) rows.push([`${mo}月`, '1', String(Math.round(shipmentKg(site, `${year}/${mo}`) * 1000)), '1']);
  return toCsv(rows);
}
function buildKinshoCsv() {
  const header = ['', '拠点', '菌床', ...KINSHO_MONTHS.map(m => m.replace('/', '.'))];
  const rows = [header];
  SITES.forEach((site, si) => {
    rows.push([si === 0 ? '菌床数' : '', site, '千葉七河', ...KINSHO_MONTHS.map(() => '1')]);
    rows.push(['', '', '自社菌床', ...KINSHO_MONTHS.map(() => '0')]);
    rows.push(['', '', '合計', ...KINSHO_MONTHS.map(m => kinshoValue(site, m).toLocaleString('en-US'))]);
  });
  rows.push(['金額(円)', 'いなべ', '千葉七河']);
  rows.push(['', '', '合計', ...KINSHO_MONTHS.map(() => '999,999')]);
  return toCsv(rows);
}
function buildSalesUrlCsv() {
  const rows = [['拠点', '区分', 'URL']];
  SITES.forEach(site => ['月初', 'MRP', '受注', '実績'].forEach(kind => {
    const gid = SALES_GIDS[site][kind];
    rows.push([site, kind, `https://docs.google.com/spreadsheets/d/${SALES_FILE_ID}/edit?gid=${gid}#gid=${gid}`]);
  }));
  return toCsv(rows);
}
function fmtSales(n) { return n >= 1000 ? n.toLocaleString('en-US') : String(n); }
function buildSalesTabCsv(site) {
  const k = SALES_K[site];
  const items = [
    ['個数', '秀L6 130g', { '2026/08/31': 1000, '2026/09/01': 1200, '2026/09/15': 300, '2026/09/30': 5, '2026/10/01': 7, '2026/10/20': 11, '2026/11/01': 900 }],
    ['個数', '優2L袋 200g', { '2026/09/01': 20, '2026/10/01': 3 }],
    ['個数', '秀バラ1kg 1,000g', { '2026/09/15': 115, '2026/10/20': 2 }],
    ['個数', '袋入りバラ 500g', { '2026/09/01': 4 }],
    ['個数', '', { '2026/09/01': 50 }],
    ['個数', 'チビ用カップ 80g', { '2026/09/15': 6 }],
    ['重量', '秀L6 130g', { '2026/09/01': 999 }],
  ];
  const rows = [['拠点', '個数/重量(kg)', '区分', '商品', '秀・優・袋・袋２', 'サイズ', ...SALES_DATES]];
  items.forEach(([kind, product, vals]) => {
    rows.push([site, kind, '実績', product, '', '', ...SALES_DATES.map(d => (vals[d] === undefined ? '' : fmtSales(vals[d] * k)))]);
  });
  return toCsv(rows);
}
function buildStdSettingsCsv() {
  return toCsv([
    ['cs数=(合計点数-バラ数)÷P/cs+バラ数'],
    ['パック・袋P/cs', 'バラのメトリック名'],
    ['30', 'バラ数'],
    ['業務区分', '作業区分', '1コンテナ当たり', '時間当たり(kg/h)', '1cs当たり', '1個当たり', '固定時間(h)', '単位', '考え方'],
    ['栽培', '収穫', '', '20', '', '', '', 'kg/h', ''],
    ['', '注水', '3', '', '', '', '', '分', ''],
    ['出荷', 'パック並べる', '', '', '', '3', '', '秒', ''],
    ['', '袋入れ・閉じ', '', '', '', '6', '', '秒', ''],
    ['', '段ボール詰める', '', '', '30', '', '', '秒', ''],
    ['', '付帯作業', '', '', '', '2', '', '秒', ''],
  ]);
}

let prodSheetRequests = [];
async function setupRoutes(page, opts) {
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
    const csv = body => route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
    if (gid === PROD_SHEET_GID) { prodSheetRequests.push(url); return route.fulfill({ status: 404, contentType: 'text/plain', body: '' }); }
    if (url.includes('/gviz/tq')) {
      let body;
      if (sheet === '整理済み_M') body = buildMGviz(opts.lastMonth);
      else if (gid === PLAN_GID) body = buildPlanGviz(opts);
      else body = gvizText({ cols: [], rows: [] });
      return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body });
    }
    if (url.includes('/export')) {
      if (url.includes(DB_SHARE_SHEET_ID)) {
        if (gid === HARVEST_URL_GID) return csv(buildHarvestUrlCsv());
        if (gid === SHIPMENT_URL_GID) return csv(buildShipmentUrlCsv());
        if (gid === SALES_URL_GID) return csv(buildSalesUrlCsv());
        if (gid === STD_SETTINGS_GID) return csv(buildStdSettingsCsv());
      }
      const hm = url.match(/\/d\/harv-(\w+)-(\d{4})-(\d{1,2})\//);
      if (hm) {
        const site = SITES.find(s => SITE_CODE[s] === hm[1]);
        return csv(buildHarvestTargetCsv(site, `${hm[2]}/${parseInt(hm[3], 10)}`));
      }
      if (url.includes(SHIPMENT_FILE_ID)) {
        for (const site of SITES) for (const y of ['2025', '2026']) if (SHIPMENT_GIDS[site][y] === gid) return csv(buildShipmentYearCsv(site, y));
      }
      if (url.includes(KINSHO_SHEET_ID)) return csv(buildKinshoCsv());
      if (url.includes(SALES_FILE_ID)) {
        const site = SITES.find(s => SALES_GIDS[s]['実績'] === gid);
        if (site) return csv(buildSalesTabCsv(site));
      }
      return csv('﻿\r\n');
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
  });
}

let okCount = 0, ngCount = 0;
function check(name, cond, extra) {
  if (cond) { okCount++; console.log(`  ${name}: OK`); }
  else { ngCount++; console.log(`  ${name}: NG${extra !== undefined ? ' (' + JSON.stringify(extra) + ')' : ''}`); }
}

async function openPage(browser, opts) {
  prodSheetRequests = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await setupRoutes(page, opts);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof allData !== 'undefined' && allData && typeof window.__cultTest === 'object', null, { timeout: 30000 });
  // 初回の読み込み（loadAll()）が最後に既定のタブを描画するため、それが終わってから
  // テスト側で各画面を描画する（先に描画すると、後から既定のタブで上書きされることがある）
  await page.waitForFunction(() => (document.getElementById('last-updated').textContent || '').includes('最終更新'), null, { timeout: 30000 });
  await page.waitForTimeout(200);
  await page.evaluate(() => loadStdSettingsSheetOnce().catch(() => null));
  await page.evaluate(start => { periodStartMonth = start; periodMonthCount = 12; }, opts.periodStart || '2025年10月');
  return page;
}

const TABLE_GRID_FN = `
  function tableToGrid(table) {
    const grid = [];
    Array.from(table.querySelectorAll('tr')).forEach((tr, ri) => {
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
// 拠点・カテゴリ・指標の3列＋月の列の表を、行の配列 [{site, cat, metric, byMonth}] にする
async function readTableRows(page) {
  return page.evaluate(fnSrc => {
    eval(fnSrc);
    const grid = tableToGrid(document.querySelector('#main table.prod-table'));
    const header = grid[0];
    return grid.slice(1).map(row => {
      const byMonth = {};
      for (let c = 3; c < header.length; c++) if (header[c]) byMonth[normalizeMonth(header[c])] = row[c];
      return { site: row[0], cat: row[1], metric: row[2], byMonth };
    });
  }, TABLE_GRID_FN);
}
async function readStdHoursTables(page, tasks) {
  return page.evaluate(({ fnSrc, tasks }) => {
    eval(fnSrc);
    const out = {};
    Array.from(document.querySelectorAll('#main .schart-header')).forEach(h => {
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

function fmtRatio(v) { return v === null ? '—' : v.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtProdCell(metric, v) {
  if (v === null) return '—';
  if (metric === '収穫量(kg)' || metric === '出荷量(kg)') return Math.round(v).toLocaleString('ja-JP');
  return v.toLocaleString('ja-JP');
}
// 予実＞生産計画の表示。
// ・過去月（〜境目月）：勤務実績＞生産実績の表と同じ書式（構成比は小数2桁、収穫量・出荷量は整数、
//   それ以外は既定の書式、値なしは「—」）
// ・未来月（今までどおり）：「出荷内訳（実績／計画）」は整数、それ以外は小数1桁、構成比は小数2桁、値なしは空欄
function fmtPlanCell(block, metric, v, past) {
  if (past) return block === 'ratio' ? fmtRatio(v) : fmtProdCell(metric, v);
  if (v === null) return '';
  if (block === 'ratio') return fmtRatio(v);
  return v.toLocaleString('ja-JP', { maximumFractionDigits: block === 'actual' ? 0 : 1 });
}

/* ===================== 本体 ===================== */
(async () => {
  const browser = await chromium.launch();

  console.log('(A) コード中に整理済み_分析（PROD_GID）の参照が残っていない');
  check('work-hours.html に「PROD_GID」の文字列が無い', !HTML_SOURCE.includes('PROD_GID'));
  check('work-hours.html に整理済み_分析のgid（2016642543）が無い', !HTML_SOURCE.includes(PROD_SHEET_GID));
  check('work-hours.html に収穫量の補完（harvestDirectBackfilled・†）の処理が無い',
    !HTML_SOURCE.includes('harvestDirectBackfilled') && !HTML_SOURCE.includes("'†'"));

  console.log('(B) 境目月が2026/9の場合：勤務実績＞生産実績');
  let prodB;
  {
    const page = await openPage(browser, { lastMonth: '2026/9' });
    const cutoff = await page.evaluate(() => getActualCutoffMonth());
    check('境目月＝2026/9（整理済み_Mの実データ最終月）', cutoff === '2026/9', cutoff);
    prodB = await page.evaluate(async () => {
      const d = await fetchProductionSheet();
      return { months: d.months, records: d.records.map(r => ({ site: r.site, cat: r.cat, metric: r.metric, values: r.values })) };
    });
    check('整理済み_分析を読みに行かない', prodSheetRequests.length === 0, prodSheetRequests);
    check('月の一覧＝整理済み_計画_更新の見出しのうち実績月（2025/10〜2026/9）＋整理済み_Mの実績月（2025/8・9）、未来月は含まない',
      JSON.stringify(prodB.months) === JSON.stringify(monthsBetween('2025/8', '2026/9')), prodB.months);
    const expectedRowOrder = [];
    SITES.forEach(site => {
      ['菌床購入数(本)', '収穫量(kg)', '出荷量(kg)'].forEach(m => expectedRowOrder.push(`${site}/生産実績/${m}`));
      CULT_METRICS.forEach(m => expectedRowOrder.push(`${site}/栽培内訳/${m}`));
      SHIP_METRICS.forEach(m => expectedRowOrder.push(`${site}/出荷内訳/${m}`));
    });
    const gotRowOrder = prodB.records.map(r => `${r.site}/${r.cat}/${r.metric}`);
    check('prodDataの行＝拠点ごとに 生産実績3行→栽培内訳7行→出荷内訳5行（南丹の「生販実績」も「生産実績」）',
      JSON.stringify(gotRowOrder) === JSON.stringify(expectedRowOrder), gotRowOrder.slice(0, 20));
    const valBad = [];
    prodB.records.forEach(r => prodB.months.forEach((m, i) => {
      const e = expectedActual(r.site, r.metric, m, cutoff);
      if (r.values[i] !== e) valBad.push({ site: r.site, metric: r.metric, m, v: r.values[i], e });
    }));
    check('prodDataの値＝各行の実績の取得元の値（菌床数集計・収穫管理表・売り上げ分析・出荷内訳）。計画_更新の生産実績・栽培内訳の値は使わない',
      valBad.length === 0, valBad.slice(0, 5));
    check('URL_収穫管理表にURLが無い月（群馬2026/3）の収穫量はnull',
      prodB.records.find(r => r.site === '群馬' && r.metric === '収穫量(kg)').values[prodB.months.indexOf('2026/3')] === null);

    await renderAndWait(page, 'renderProductionTab');
    const rows = await readTableRows(page);
    const label = await page.evaluate(() => document.querySelector('#main .chart-section-label').textContent.trim());
    check('表の上の表示が取得元に合わせた表示（整理済み_分析ではない）',
      label === '🌱 生産実績 ／ 各実績データから自動計算（出荷内訳の2026/8までは整理済み_計画_更新）', label);
    const expectedTableRows = [];
    SITES.forEach(site => {
      ['菌床購入数(本)', '収穫量(kg)', '出荷量(kg)'].forEach(m => expectedTableRows.push(`${site}/生産実績/${m}`));
      CULT_METRICS.forEach(m => expectedTableRows.push(`${site}/栽培内訳（コンテナ数）/${m}`));
      SHIP_METRICS.forEach(m => expectedTableRows.push(`${site}/出荷内訳（実績）/${m}`));
      RATIO_METRICS.forEach(m => expectedTableRows.push(`${site}/出荷内訳（構成比）/${m}`));
    });
    const gotTableRows = rows.map(r => `${r.site}/${r.cat}/${r.metric}`);
    check('表の行＝今と同じ行（生産実績・栽培内訳（コンテナ数）・出荷内訳（実績））の下に「出荷内訳（構成比）」4行が追加',
      JSON.stringify(gotTableRows) === JSON.stringify(expectedTableRows), gotTableRows.filter((r, i) => r !== expectedTableRows[i]).slice(0, 5));
    const displayMonths = monthsBetween('2025/10', '2026/9');
    const cellBad = [];
    rows.forEach(r => displayMonths.forEach(m => {
      const isRatio = r.cat === '出荷内訳（構成比）';
      const exp = isRatio ? fmtRatio(expectedRatio(r.site, r.metric, m, cutoff)) : fmtProdCell(r.metric, expectedActual(r.site, r.metric, m, cutoff));
      if (r.byMonth[m] !== exp) cellBad.push({ site: r.site, cat: r.cat, metric: r.metric, m, got: r.byMonth[m], exp });
    }));
    check('表の値が期待値どおり（構成比はパック・袋・バラ÷合計(点数)の小数2桁、付帯作業は「—」）', cellBad.length === 0, cellBad.slice(0, 5));
    const ratioRow = rows.find(r => r.site === 'いなべ' && r.cat === '出荷内訳（構成比）' && r.metric === 'パック数');
    check('構成比の例：いなべ2025/10＝78,408÷101,403＝0.77、2026/9＝1,561÷1,700＝0.92',
      ratioRow.byMonth['2025/10'] === '0.77' && ratioRow.byMonth['2026/9'] === '0.92', [ratioRow.byMonth['2025/10'], ratioRow.byMonth['2026/9']]);
    const nantanRatio = rows.filter(r => r.site === '南丹' && r.cat === '出荷内訳（構成比）');
    check('合計(点数)が0の月（南丹2026/2）の構成比は全て「—」', nantanRatio.every(r => r.byMonth['2026/2'] === '—'), nantanRatio.map(r => r.byMonth['2026/2']));
    const gunmaHarvest = rows.find(r => r.site === '群馬' && r.metric === '収穫量(kg)');
    check('URLが無い月（群馬2026/3）の収穫量は「—」、†は表のどこにも出ない',
      gunmaHarvest.byMonth['2026/3'] === '—' && !(await page.evaluate(() => document.getElementById('main').textContent.includes('†'))),
      gunmaHarvest.byMonth['2026/3']);

    // 標準工数（勤務実績＞標準工数(h)・予実＞予定標準工数(h)の過去月）
    const tasks = ['収穫', 'パック並べる', '袋入れ・閉じ', '段ボール詰める', '付帯作業'];
    await renderAndWait(page, 'renderStdHoursTab');
    const stdTab = await readStdHoursTables(page, tasks);
    await renderAndWait(page, 'renderPlanStdHoursTab');
    const planStdTab = await readStdHoursTables(page, tasks);
    const fmtH = h => (h === null ? '—' : (h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString('ja-JP')) + ' h');
    const stdBad = [];
    SITES.forEach(site => displayMonths.forEach(m => {
      const e = expectedShipping(site, m, cutoff);
      const harvest = harvestValue(site, m);
      const expH = {
        '収穫': harvest === null ? null : harvest / 20,
        'パック並べる': e['パック数'] * 3 / 3600,
        '袋入れ・閉じ': e['袋数'] * 6 / 3600,
        '段ボール詰める': ((Math.max(0, e['合計(点数)'] - e['バラ数']) / 30) + e['バラ数']) * 30 / 3600,
        '付帯作業': (site === 'いなべ' || e['付帯作業'] === null) ? null : e['付帯作業'] * 2 / 3600,
      };
      tasks.forEach(task => {
        const exp = fmtH(expH[task]);
        if (stdTab[site][task][m] !== exp) stdBad.push({ screen: 'std', site, task, m, got: stdTab[site][task][m], exp });
        if (planStdTab[site][task][m] !== exp) stdBad.push({ screen: 'planstd', site, task, m, got: planStdTab[site][task][m], exp });
      });
    }));
    check('予実＞予定標準工数(h)の過去月・勤務実績＞標準工数(h)が実績の値から計算した工数のまま（収穫量・出荷内訳）', stdBad.length === 0, stdBad.slice(0, 4));
    const futBad = [];
    SITES.forEach(site => ['2026/10', '2026/12', '2027/2'].forEach(m => {
      const i = PLAN_MONTHS.indexOf(m);
      const a = PLAN_ACTUAL[site];
      const exp = fmtH((a['合計(点数)'][i] - a['袋数'][i] - a['バラ数'][i]) * 3 / 3600);
      const expHarvest = fmtH(PLAN_SUMMARY['収穫量(kg)'] / 20);
      if (planStdTab[site]['パック並べる'][m] !== exp) futBad.push({ site, m, got: planStdTab[site]['パック並べる'][m], exp });
      if (planStdTab[site]['収穫'][m] !== expHarvest) futBad.push({ site, m, task: '収穫', got: planStdTab[site]['収穫'][m], expHarvest });
    }));
    check('予実＞予定標準工数(h)の未来月は今までどおり計画_更新の値から計算', futBad.length === 0, futBad.slice(0, 4));

    // 予実＞生産計画
    console.log('(C) 境目月が2026/9の場合：予実＞生産計画');
    await renderAndWait(page, 'renderPlanTab');
    const planRows = await readTableRows(page);
    // カテゴリ列の見出しが行とずれない（付帯作業の行も各まとまりに入る）
    const expectedPlanRows = [];
    SITES.forEach(site => {
      const summaryCat = site === '南丹' ? '生販実績' : '生産実績';
      Object.keys(PLAN_SUMMARY).forEach(m => expectedPlanRows.push(`${site}/${summaryCat}/${m}`));
      CULT_METRICS.forEach(m => expectedPlanRows.push(`${site}/栽培内訳（コンテナ数）/${m}`));
      SHIP_METRICS.forEach(m => expectedPlanRows.push(`${site}/出荷内訳（構成比）/${m}`));
      SHIP_METRICS.forEach(m => expectedPlanRows.push(`${site}/出荷内訳（実績／計画）/${m}`));
    });
    const gotPlanRows = planRows.map(r => `${r.site}/${r.cat}/${r.metric}`);
    check('予実＞生産計画：カテゴリ列の見出しが行とずれない（構成比・計画とも付帯作業・合計(点数)まで同じまとまり）',
      JSON.stringify(gotPlanRows) === JSON.stringify(expectedPlanRows), gotPlanRows.filter((r, i) => r !== expectedPlanRows[i]).slice(0, 5));
    const catCells = await page.evaluate(() => Array.from(document.querySelectorAll('#main td.col-cat')).map(td => [td.textContent.trim(), td.getAttribute('rowspan')]));
    check('予実＞生産計画：構成比・計画のまとまりの結合セルはそれぞれ5行分',
      catCells.filter(c => c[0] === '出荷内訳（構成比）' || c[0] === '出荷内訳（実績／計画）').every(c => c[1] === '5')
      && catCells.filter(c => c[0] === '出荷内訳（構成比）').length === 3 && catCells.filter(c => c[0] === '出荷内訳（実績／計画）').length === 3, catCells);
    const pastBad = [], futureBad = [];
    planRows.forEach(r => PLAN_MONTHS.forEach((m, i) => {
      const past = ymNum(m) <= ymNum(cutoff);
      const block = r.cat === '出荷内訳（構成比）' ? 'ratio' : (r.cat === '出荷内訳（実績／計画）' ? 'actual' : 'other');
      let v;
      if (past) {
        v = block === 'ratio' ? expectedRatio(r.site, r.metric, m, cutoff) : expectedActual(r.site, r.metric, m, cutoff);
      } else if (block === 'ratio') v = PLAN_RATIO[r.metric];
      else if (block === 'actual') v = PLAN_ACTUAL[r.site][r.metric][i];
      else v = CULT_METRICS.includes(r.metric) ? PLAN_CULT : PLAN_SUMMARY[r.metric];
      const exp = fmtPlanCell(block, r.metric, v, past);
      if (r.byMonth[m] !== exp) (past ? pastBad : futureBad).push({ site: r.site, cat: r.cat, metric: r.metric, m, got: r.byMonth[m], exp });
    }));
    check('予実＞生産計画の過去月（〜2026/9）：全ての行が勤務実績＞生産実績と同じ実績の値（シートの計画値は使わない）、構成比は実績の割合（小数2桁）、構成比の付帯作業・合計(点数)は「—」',
      pastBad.length === 0, pastBad.slice(0, 5));
    check('予実＞生産計画の未来月（2026/10〜）：シートの値のまま（構成比は小数2桁の表示）', futureBad.length === 0, futureBad.slice(0, 5));
    // 過去月の各行が、勤務実績＞生産実績の同じ行・同じ月と同じ文字列で表示される
    const sameBad = [];
    let compared = 0;
    planRows.forEach(r => {
      let prodRow = null;
      if (r.cat === '出荷内訳（構成比）') prodRow = r.metric === '合計(点数)' ? null : rows.find(x => x.site === r.site && x.cat === '出荷内訳（構成比）' && x.metric === r.metric);
      else if (r.cat === '出荷内訳（実績／計画）') prodRow = rows.find(x => x.site === r.site && x.cat === '出荷内訳（実績）' && x.metric === r.metric);
      else prodRow = rows.find(x => x.site === r.site && x.cat !== '出荷内訳（実績）' && x.cat !== '出荷内訳（構成比）' && x.metric === r.metric);
      displayMonths.forEach(m => {
        const exp = prodRow ? prodRow.byMonth[m] : '—'; // 構成比のまとまりの合計(点数)は生産実績の表に無い行（「—」）
        compared++;
        if (r.byMonth[m] !== exp) sameBad.push({ site: r.site, cat: r.cat, metric: r.metric, m, plan: r.byMonth[m], prod: exp });
      });
    });
    check(`予実＞生産計画の過去月の各行が、勤務実績＞生産実績の同じ行・同じ月と同じ文字列（${compared}セル）`, sameBad.length === 0 && compared === 60 * 12, sameBad.slice(0, 5));
    const harvestPlan = planRows.find(x => x.site === 'いなべ' && x.metric === '収穫量(kg)').byMonth;
    const shipPlan = planRows.find(x => x.site === 'いなべ' && x.metric === '出荷量(kg)').byMonth;
    check('例：収穫量・出荷量の過去月は整数（いなべ2026/9：10,590.5→10,591、8,109.4→8,109）、未来月は今までどおり小数1桁まで（88,888）',
      harvestPlan['2026/9'] === '10,591' && shipPlan['2026/9'] === '8,109' && harvestPlan['2026/10'] === '88,888',
      [harvestPlan['2026/9'], shipPlan['2026/9'], harvestPlan['2026/10']]);
    const ex = r => planRows.find(x => x.site === 'いなべ' && x.metric === r.metric && x.cat === r.cat).byMonth;
    const kinshoPlan = ex({ metric: '菌床購入数(本)', cat: '生産実績' });
    const ratioPlan = ex({ metric: 'パック数', cat: '出荷内訳（構成比）' });
    check('例：いなべの菌床購入数 2026/9＝実績(30,200)・2026/10＝計画(99,999)、構成比パック数 2026/9＝0.92・2026/10＝0.73',
      kinshoPlan['2026/9'] === kinshoValue('いなべ', '2026/9').toLocaleString('ja-JP') && kinshoPlan['2026/10'] === '99,999'
      && ratioPlan['2026/9'] === '0.92' && ratioPlan['2026/10'] === '0.73', [kinshoPlan['2026/9'], kinshoPlan['2026/10'], ratioPlan['2026/9'], ratioPlan['2026/10']]);
    await page.close();
  }

  console.log('(D) 境目月が2026/10に進んだ場合（整理済み_Mに2026/10が増えた）');
  {
    const page = await openPage(browser, { lastMonth: '2026/10', periodStart: '2025年11月' });
    const cutoff = await page.evaluate(() => getActualCutoffMonth());
    check('境目月＝2026/10', cutoff === '2026/10', cutoff);
    const prod = await page.evaluate(async () => {
      const d = await fetchProductionSheet();
      const pick = (site, metric) => d.records.find(r => r.site === site && r.metric === metric).values[d.months.indexOf('2026/10')];
      return { months: d.months, inabeHarvest: pick('いなべ', '収穫量(kg)'), inabePack: pick('いなべ', 'パック数'), inabeKinsho: pick('いなべ', '菌床購入数(本)') };
    });
    check('2026/10も実績月として月の一覧に入る', prod.months[prod.months.length - 1] === '2026/10' && !prod.months.includes('2026/11'), prod.months.slice(-3));
    check('2026/10の値は実績の取得元の値（収穫管理表・販売抽出シート・菌床数集計）',
      prod.inabeHarvest === harvestValue('いなべ', '2026/10') && prod.inabePack === 18 && prod.inabeKinsho === kinshoValue('いなべ', '2026/10'), prod);
    await renderAndWait(page, 'renderPlanTab');
    const planRows = await readTableRows(page);
    const k = planRows.find(r => r.site === 'いなべ' && r.metric === '菌床購入数(本)').byMonth;
    const pack = planRows.find(r => r.site === 'いなべ' && r.cat === '出荷内訳（実績／計画）' && r.metric === 'パック数').byMonth;
    check('予実＞生産計画の2026/10も実績の値になり（菌床購入数・パック数）、2026/11は計画値のまま',
      k['2026/10'] === kinshoValue('いなべ', '2026/10').toLocaleString('ja-JP') && pack['2026/10'] === '18' && k['2026/11'] === '99,999' && pack['2026/11'] === '109,805',
      [k['2026/10'], pack['2026/10'], k['2026/11'], pack['2026/11']]);
    await page.close();
  }

  console.log('(E) 整理済み_計画_更新に菌床購入数(本)の行が無い拠点がある場合');
  {
    const page = await openPage(browser, { lastMonth: '2026/9', noKinshoRowSite: '群馬' });
    await renderAndWait(page, 'renderProductionTab');
    const rows = await readTableRows(page);
    const gunmaKinsho = rows.find(r => r.site === '群馬' && r.metric === '菌床購入数(本)');
    check('菌床購入数(本)の行は常に表示され、菌床数集計の値が入る',
      !!gunmaKinsho && gunmaKinsho.byMonth['2026/9'] === kinshoValue('群馬', '2026/9').toLocaleString('ja-JP'), gunmaKinsho);
    await page.close();
  }

  await browser.close();
  console.log(`\n${ngCount === 0 ? 'すべてOK' : 'NGあり'} (OK ${okCount} / NG ${ngCount})`);
  console.log('DONE');
  process.exit(ngCount === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
