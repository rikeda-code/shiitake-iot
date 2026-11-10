// dashboard/work-hours.html の「予実＞比較（繁忙期見込み）」タブの、未来月「標準労働時間」棒の検証。
//  (1) B列=2（入社予定）の新しいルール：I列の月が締まっていない人は、I列の月から未来月を黄色
//      （新規要員）、I列の月が締まった人は、未来月を青（既存の要員）にする。実績の有無は見ない
//      （拠点・業務別／3拠点サマリ／拠点サマリ／要員計画のすべて）
//  (2) 緑の「増減」は在籍期間（入社の月〜最後に在籍する月）だけを合計する
//  (3) 拠点サマリ・要員計画だけ、黄色を「新規要員（入社決定）」（濃い黄・下）と
//      「新規要員（採用計画）」（薄い黄・上。H列の名前の先頭2文字が「予定」）の2本に分ける。
//      拠点サマリは2本それぞれに「◯人」、「計◯人」は合計。要員計画は人数なし。
//      他のタブは1本（1色）のまま
//  (4) B=2で標準労働時間シートに見つからない人・R列が空欄の人は、拠点サマリ・要員計画の
//      注意の欄に名前を出し、「◯人」には数える
//
// 実際のシートと同じ形のモックを使う：
//  - 整理済み_M（gviz、headers=3）：A〜I列（B=フラグ数値、I=入退社年月の日付セル）と、
//    「M/10締 YYYY/MM 総勤務時間」「有給取得時間」「実質勤務時間」の3列×月（時間は
//    "Date(1899,11,30,…)"＋"H:MM"表示の日時セル）。実績の最終月は2026/9（＝締まった月）
//  - 標準労働時間（gviz、gid=1404355975、headers=1）：R1「標準労働時間」、T1〜AA1に
//    "2026/7"〜"2027/2"（増減の月列）。2・3行目は見出し行で、4行目からデータ
//  - 整理済み_計画_更新（gviz）：拠点・月の並びだけを使う最小限の形
// 画面は実際に描画させ（Chart.js本体はvendor版）、Chart.getChart()でデータセットを読む。
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHART_JS_VENDORED = fs.readFileSync(path.join(__dirname, 'vendor', 'chart.umd.js'), 'utf8');
const HTML_PATH = path.join(__dirname, '..', '..', 'dashboard', 'work-hours.html');
const PLAN_GID = '530402103';
const MERGE_GID = '1404355975';
const SITES = ['いなべ', '群馬', '南丹'];

function ymNum(m) { const [y, mo] = String(m).split('/').map(Number); return y * 100 + mo; }
function monthsBetween(from, to) {
  const out = []; let [y, m] = from.split('/').map(Number);
  while (y * 100 + m <= ymNum(to)) { out.push(`${y}/${m}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const M_MONTHS = monthsBetween('2025/8', '2026/9');      // 整理済み_Mの実績月（最終月＝締まった月）
const PLAN_MONTHS = monthsBetween('2025/10', '2027/2');  // 比較タブの表示月
const MERGE_MONTHS = monthsBetween('2026/7', '2027/2');  // 標準労働時間シートの増減の月列

/* ===================== 人（すべて群馬・PRJ=群馬） ===================== */
// hours: 実績のある月→実質勤務時間。std: 標準労働時間シートの行（nullなら行なし）
//   std.full / std.part：M列（時間/月・社保あり）/ Q列（社保なし）。std.r：R列（nullなら空欄）
//   std.delta：増減の月列 { 'YYYY/M': 値 }
const ALL_PAST = Object.fromEntries(M_MONTHS.map(m => [m, 160]));
const PEOPLE = [
  { flag: 1, emp: '社員', div: '栽培', name: '既存 一郎', start: null, hours: ALL_PAST, std: { full: 173.8, part: 0, r: 173.8 } },
  { flag: 1, emp: 'パート', div: '出荷', name: '既存 花子', start: null, hours: ALL_PAST, std: { full: 0, part: 78.2, r: 78.2 } },
  // B=2・I列の月が締まった（2026/9）：実績あり → 未来月は青
  { flag: 2, emp: '社員', div: '栽培', name: '新人 締済', start: '2026/9', hours: { '2026/9': 69.8 }, std: { full: 173.8, part: 0, r: 173.8, delta: { '2026/12': 30 } } },
  // B=2・I列の月が締まった（2026/8）：実績なし → 実績の有無は見ないので未来月は青
  { flag: 2, emp: 'パート', div: '栽培', name: '新人 実績無', start: '2026/8', hours: {}, std: { full: 152.1, part: 0, r: 152.1 } },
  // B=2・I列の月がまだ締まっていない → I列の月から黄（入社決定）
  { flag: 2, emp: 'パート', div: '出荷', name: '新人 十月', start: '2026/10', hours: {}, std: { full: 173.8, part: 0, r: 173.8 } },
  { flag: 2, emp: '社員', div: '栽培', name: '新人 十一月', start: '2026/11', hours: {}, std: { full: 173.8, part: 0, r: 173.8 } },
  // B=2・名前の先頭が「予定」→ 採用計画。増減は入社前（2026/11）を除き、2026/12だけ足す
  { flag: 2, emp: '社員', div: '出荷', name: '予定　群馬正Ｃ', start: '2026/12', hours: {}, std: { full: 173.8, part: 0, r: 173.8, delta: { '2026/11': 30, '2026/12': 30 } } },
  { flag: 2, emp: 'パート', div: '出荷', name: '予定　群馬パ出A', start: '2026/12', hours: {}, std: { full: 173.8, part: 0, r: 173.8 } },
  // B=2・標準労働時間シートに見つからない → 注意・人数には数える
  { flag: 2, emp: 'パート', div: '出荷', name: '未登録 太郎', start: '2026/11', hours: {}, std: null },
  // B=2・R列が空欄 → 注意・人数には数える（0h）
  { flag: 2, emp: 'パート', div: '栽培', name: '空欄 次郎', start: '2026/10', hours: {}, std: { full: 152.1, part: 0, r: null } },
  // B=2・I列が空欄 → 今のまま：全未来月で黄（入社決定）
  { flag: 2, emp: 'パート', div: '出荷', name: '開始月なし 五郎', start: null, hours: {}, std: { full: 173.8, part: 0, r: 173.8 } },
  // B=3・I列＝最後に在籍する月（2026/11）：11月までは青、12月から出さない。増減も11月まで
  { flag: 3, emp: 'パート', div: '栽培', name: '退職 三郎', start: '2026/11', hours: ALL_PAST, std: { full: 173.8, part: 0, r: 173.8, delta: { '2026/11': 20, '2026/12': 20 } } },
  // B=9（退職）：棒に出さない
  { flag: 9, emp: '社員', div: '栽培', name: '退職済 四郎', start: '2026/8', hours: { '2026/8': 100 }, std: { full: 173.8, part: 0, r: 173.8, delta: { '2026/12': 99 } } },
];

/* ===================== モックの組み立て ===================== */
function gvizText(table) {
  return `/*O_o*/\ngoogle.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"ok","sig":"1","table":${JSON.stringify(table)}});`;
}
function dateCell(m) {
  if (!m) return null;
  const [y, mo] = m.split('/').map(Number);
  return { v: `Date(${y},${mo - 1},1)`, f: `${y}/${mo}` };
}
// 整理済み_Mの時間セル（実データ同様、1899/12/30起点の日時＋"H:MM"表示）
function durationCell(h) {
  if (h == null) return null;
  const totalMin = Math.round(h * 60);
  const base = Date.UTC(1899, 11, 30) + totalMin * 60000;
  const d = new Date(base);
  const v = `Date(${d.getUTCFullYear()},${d.getUTCMonth()},${d.getUTCDate()},${d.getUTCHours()},${d.getUTCMinutes()},0)`;
  return { v, f: `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}` };
}
function numCell(v, digits) {
  if (v == null) return null;
  return { v, f: digits != null ? v.toFixed(digits) : String(v) };
}
function textCell(v) { return v == null || v === '' ? null : { v: String(v) }; }

function buildMGviz() {
  const cols = [
    { id: 'A', label: '0：ファイルなし ', type: 'number' },
    { id: 'B', label: '1：在職中、2：入社予定、3：退職/異動予定、8：他所属、9：退職 F', type: 'number' },
    { id: 'C', label: '雇用区分', type: 'string' }, { id: 'D', label: '拠点', type: 'string' },
    { id: 'E', label: 'PRJ', type: 'string' }, { id: 'F', label: '部門', type: 'string' },
    { id: 'G', label: '社員番号', type: 'number' }, { id: 'H', label: '名前', type: 'string' },
    { id: 'I', label: '入退社年月', type: 'date' },
  ];
  M_MONTHS.forEach((m, i) => {
    const [y, mo] = m.split('/').map(Number);
    const closeM = mo === 12 ? 1 : mo + 1;
    cols.push({ id: `T${i}`, label: `${closeM}/10締 ${y}/${String(mo).padStart(2, '0')} 総勤務時間`, type: 'datetime' });
    cols.push({ id: `P${i}`, label: '有給取得時間', type: 'datetime' });
    cols.push({ id: `J${i}`, label: '実質勤務時間', type: 'datetime' });
  });
  const rows = PEOPLE.map((p, i) => {
    const c = [null, numCell(p.flag), textCell(p.emp), textCell('群馬'), textCell('群馬'), textCell(p.div),
      numCell(270000 + i), textCell(p.name), dateCell(p.start)];
    M_MONTHS.forEach(m => {
      const h = p.hours[m];
      c.push(durationCell(h)); c.push(h == null ? null : durationCell(0)); c.push(durationCell(h));
    });
    return { c };
  });
  return gvizText({ cols, rows });
}

function buildMergeGviz() {
  // 列：A〜I（整理済み_Mと同じ）、J〜M（社保あり：時間/日・日数/週・時間/週・時間/月）、
  // N〜Q（社保なし：同）、R（標準労働時間）、S（空）、T〜AA（増減の月列）
  const cols = [];
  const letters = 'ABCDEFGHIJKLMNOPQRS'.split('');
  letters.forEach(l => cols.push({ id: l, label: '', type: 'string' }));
  cols[0].label = '0：ファイルなし'; cols[9].label = 'パート労働時間'; cols[17] = { id: 'R', label: '標準労働時間', type: 'number' };
  MERGE_MONTHS.forEach((m, i) => cols.push({ id: ['T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA'][i], label: m, type: 'string' }));
  const width = cols.length;
  const pad = arr => { while (arr.length < width) arr.push(null); return arr; };
  const rows = [];
  // 2行目（合計行）・3行目（見出し行）：パーサーはこの2行を読み飛ばす
  rows.push({ c: pad([null, null, null, null, null, null, null, null, null, null, null, null, numCell(146, 1), null, null, null, numCell(146, 1), numCell(9999.9, 1), null, ...MERGE_MONTHS.map(() => ({ v: '#VALUE!' }))]) });
  rows.push({ c: pad([null, null, textCell('雇用区分'), textCell('拠点'), textCell('PRJ'), textCell('部門'), null, textCell('名前'), null, null, null, null, null, null, null, null, null, null, null, ...MERGE_MONTHS.map(() => textCell('時間／月'))]) });
  PEOPLE.forEach((p, i) => {
    if (!p.std) return;
    const s = p.std;
    const c = [null, numCell(p.flag), textCell(p.emp), textCell('群馬'), textCell('群馬'), textCell(p.div),
      numCell(270000 + i), textCell(p.name), dateCell(p.start),
      numCell(s.full > 0 ? 8 : 0), numCell(s.full > 0 ? 5 : 0), numCell(s.full > 0 ? 40 : 0), numCell(s.full, 1),
      numCell(s.part > 0 ? 4.5 : 0), numCell(s.part > 0 ? 4 : 0), numCell(s.part > 0 ? 18 : 0), numCell(s.part, 1),
      s.r == null ? null : numCell(s.r, 1), null,
      ...MERGE_MONTHS.map(m => (s.delta && s.delta[m] != null ? numCell(s.delta[m], 1) : null))];
    rows.push({ c: pad(c) });
  });
  return gvizText({ cols, rows });
}

function buildPlanGviz() {
  const cols = [{ id: 'A', label: '予測', type: 'string' }, { id: 'B', label: '', type: 'string' }, { id: 'C', label: '', type: 'string' }]
    .concat(PLAN_MONTHS.map((m, i) => ({ id: 'M' + i, label: m, type: 'number' })));
  const rows = [];
  SITES.forEach(site => {
    rows.push({ c: [textCell(site), textCell('生産実績'), textCell('収穫量(kg)'), ...PLAN_MONTHS.map(() => numCell(10000))] });
    rows.push({ c: [null, null, textCell('出荷量(kg)'), ...PLAN_MONTHS.map(() => numCell(9000))] });
  });
  return gvizText({ cols, rows });
}

async function setupRoutes(page) {
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost')) return route.continue();
    if (url.includes('chart.umd')) return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: CHART_JS_VENDORED });
    if (!url.includes('docs.google.com')) return route.abort();
    const u = new URL(url);
    const gid = u.searchParams.get('gid');
    const sheet = u.searchParams.get('sheet');
    if (url.includes('/gviz/tq')) {
      let body = gvizText({ cols: [], rows: [] });
      if (sheet === '整理済み_M') body = buildMGviz();
      else if (gid === PLAN_GID) body = buildPlanGviz();
      else if (gid === MERGE_GID) body = buildMergeGviz();
      return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body });
    }
    if (url.includes('/export')) return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' });
    return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
  });
}

let okCount = 0, ngCount = 0;
function check(name, cond, extra) {
  if (cond) { okCount++; console.log(`  ${name}: OK`); }
  else { ngCount++; console.log(`  ${name}: NG${extra !== undefined ? ' (' + JSON.stringify(extra) + ')' : ''}`); }
}
const near = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.05);
const sameSeries = (actual, expected) => actual.length === expected.length && actual.every((v, i) => near(v, expected[i]));

// 表示月のうち確認する月（2026/9＝締まった月、2026/10〜2027/2＝未来月）
const CHECK_MONTHS = ['2026/9', '2026/10', '2026/11', '2026/12', '2027/1'];

async function renderAndRead(page, subtab, canvasId) {
  await page.evaluate(sub => { planCmpSubtab = sub; planCmpSiteTab = '群馬'; renderPlanCompareTab2(); }, subtab);
  await page.waitForFunction(id => {
    const el = document.getElementById(id);
    return el && window.Chart && Chart.getChart(el);
  }, canvasId, { timeout: 30000 });
  return page.evaluate(({ id, months }) => {
    const ch = Chart.getChart(document.getElementById(id));
    const idx = months.map(m => ch.data.labels.indexOf(m));
    const pick = arr => (arr ? idx.map(i => (i >= 0 ? arr[i] : 'missing')) : null);
    return {
      labels: ch.data.labels,
      alerts: (document.getElementById('plancmp2-newstaffalerts') || {}).innerText || '',
      ds: ch.data.datasets.filter(d => d.stack === 'stdhours').map(d => ({
        label: d.label, color: d.backgroundColor, data: pick(d.data),
        headcount: pick(d._segmentHeadcount), total: pick(d._stackTotalHeadcount),
      })),
    };
  }, { id: canvasId, months: CHECK_MONTHS });
}

(async () => {
  const html = fs.readFileSync(HTML_PATH);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(r => server.listen(0, r));
  const BASE_URL = `http://localhost:${server.address().port}/work-hours.html`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.log('  [pageerror]', e.message); });
  await setupRoutes(page);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => (document.getElementById('last-updated')?.textContent || '').includes('最終更新'), null, { timeout: 30000 });
  await page.evaluate(() => { periodStartMonth = '2025年10月'; periodMonthCount = 12; });

  console.log('\n[1] 判定の部品（トップレベル関数）');
  const unit = await page.evaluate(() => {
    const e = (flag, startYm, name) => ({ flag, startYm, name });
    return {
      roles: [
        futureStaffRole(e(1, null), 202609), futureStaffRole(e(3, 202611), 202609),
        futureStaffRole(e(2, 202609), 202609), futureStaffRole(e(2, 202608), 202609),
        futureStaffRole(e(2, 202610), 202609), futureStaffRole(e(2, null), 202609),
        futureStaffRole(e(9, null), 202609), futureStaffRole(e(8, 202610), 202609), futureStaffRole(e(null, null), 202609),
      ],
      kinds: ['予定　群馬正Ｃ', '  予定パ出A', '予定', '新人 予定', '小林 憲正', '', null].map(newStaffKindByName),
      tenure: [
        isInFutureTenure(e(2, 202612), 202611, 202609), isInFutureTenure(e(2, 202612), 202612, 202609),
        isInFutureTenure(e(3, 202611), 202611, 202609), isInFutureTenure(e(3, 202611), 202612, 202609),
        isInFutureTenure(e(2, 202609), 202610, 202609), isInFutureTenure(e(1, null), 202702, 202609),
        isInFutureTenure(e(9, null), 202610, 202609),
      ],
    };
  });
  check('B=1・B=3・締まったB=2は既存の要員、締まっていない／I列空欄のB=2は新規要員、他は対象外',
    JSON.stringify(unit.roles) === JSON.stringify(['existing', 'existing', 'existing', 'existing', 'newStaff', 'newStaff', null, null, null]), unit.roles);
  check('名前の先頭2文字（前後の空白を除く）が「予定」なら採用計画',
    JSON.stringify(unit.kinds) === JSON.stringify(['planned', 'planned', 'planned', 'decided', 'decided', 'decided', 'decided']), unit.kinds);
  check('在籍期間：新規要員はI列の月から、B=3はI列の月まで',
    JSON.stringify(unit.tenure) === JSON.stringify([false, true, true, false, true, true, false]), unit.tenure);

  console.log('\n[2] 拠点サマリ（群馬）');
  const ss = await renderAndRead(page, 'sitesummary', 'plansitesum2-combined');
  const byLabel = (r, label) => r.ds.find(d => d.label === label);
  const labelsSS = ss.ds.map(d => d.label);
  check('データセットの並び（下から：青3段→入社決定→採用計画→増減）',
    JSON.stringify(labelsSS) === JSON.stringify(['社員+実習生', 'アルバイト・フルタイム', 'アルバイト・パートタイム', '新規要員（入社決定）', '新規要員（採用計画）', '増減']), labelsSS);
  const decided = byLabel(ss, '新規要員（入社決定）');
  const planned = byLabel(ss, '新規要員（採用計画）');
  const delta = byLabel(ss, '増減');
  check('入社決定は濃い黄色（#fbbf24）', decided && decided.color === '#fbbf24', decided && decided.color);
  check('採用計画は薄い黄色（#fde68a）', planned && planned.color === '#fde68a', planned && planned.color);
  // 入社決定：10月＝新人十月173.8＋空欄次郎0＋開始月なし173.8／11月〜＝＋新人十一月173.8（未登録太郎は0h）
  check('入社決定の時間（9月なし／10月347.6／11月〜521.4）', decided && sameSeries(decided.data, [null, 347.6, 521.4, 521.4, 521.4]), decided && decided.data);
  check('入社決定の人数（10月3人／11月〜5人。見つからない人・R列空欄の人も数える）', decided && sameSeries(decided.headcount, [null, 3, 5, 5, 5]), decided && decided.headcount);
  check('採用計画の時間（12月〜347.6）', planned && sameSeries(planned.data, [null, null, null, 347.6, 347.6]), planned && planned.data);
  check('採用計画の人数（12月〜2人）', planned && sameSeries(planned.headcount, [null, null, null, 2, 2]), planned && planned.headcount);
  const lower = byLabel(ss, '社員+実習生');
  const full = byLabel(ss, 'アルバイト・フルタイム');
  const part = byLabel(ss, 'アルバイト・パートタイム');
  // 締まった月（9月）は実績で表示：既存一郎・新人締済（実績あり）。未来月：既存一郎＋新人締済（青に移る）
  check('社員+実習生：I列の月が締まったB=2（新人 締済）が未来月で青に入る（347.6）', lower && sameSeries(lower.data, [347.6, 347.6, 347.6, 347.6, 347.6]), lower && lower.data);
  check('社員+実習生の人数（未来月2人）', lower && sameSeries(lower.headcount.slice(1), [2, 2, 2, 2]), lower && lower.headcount);
  // フルタイム未来月：新人実績無152.1（実績が無くても締まったので青）＋退職三郎173.8（11月まで）
  check('フルタイム：実績の無い締まったB=2も青、B=3は最後に在籍する月の翌月から外れる', full && sameSeries(full.data.slice(1), [325.9, 325.9, 152.1, 152.1]), full && full.data);
  check('フルタイムの人数（10・11月2人／12月〜1人）', full && sameSeries(full.headcount.slice(1), [2, 2, 1, 1]), full && full.headcount);
  check('パートタイム（既存 花子 78.2）', part && sameSeries(part.data.slice(1), [78.2, 78.2, 78.2, 78.2]), part && part.data);
  // 増減：11月＝退職三郎20（予定正Cの入社前30は除く）／12月＝新人締済30＋予定正C30（退職三郎・B=9は除く）
  check('増減は在籍期間だけ（11月20／12月60）', delta && sameSeries(delta.data, [null, null, 20, 60, null]), delta && delta.data);
  const totalDs = ss.ds[0];
  // 計：10月＝青5＋黄3／11月＝青5＋黄5＋増減20/(8×30)=0.1／12月＝青4＋黄7＋増減60/(8×31)=0.2
  check('「計◯人」は入社決定・採用計画の合計を含む（10月8／11月10.1／12月11.2／1月11）', totalDs && sameSeries(totalDs.total.slice(1), [8, 10.1, 11.2, 11]), totalDs && totalDs.total);
  check('注意の欄：見つからない人（未登録 太郎）', ss.alerts.includes('未登録 太郎さん') && ss.alerts.includes('見つかりません'), ss.alerts);
  check('注意の欄：R列が空欄の人（空欄 次郎）', ss.alerts.includes('空欄 次郎さん') && ss.alerts.includes('R列（標準労働時間）が空欄'), ss.alerts);
  check('注意の欄：対象は2件だけ', /（2件）/.test(ss.alerts), ss.alerts);

  console.log('\n[3] 要員計画（群馬）');
  const sp = await renderAndRead(page, 'staffplan', 'planstaffplan2-combined');
  const spDecided = byLabel(sp, '新規要員（入社決定）');
  const spPlanned = byLabel(sp, '新規要員（採用計画）');
  check('2本に分かれる（入社決定→採用計画の順）',
    sp.ds.findIndex(d => d.label === '新規要員（入社決定）') >= 0 && sp.ds.findIndex(d => d.label === '新規要員（入社決定）') + 1 === sp.ds.findIndex(d => d.label === '新規要員（採用計画）'),
    sp.ds.map(d => d.label));
  check('時間は拠点サマリと同じ', spDecided && spPlanned && sameSeries(spDecided.data, decided.data) && sameSeries(spPlanned.data, planned.data), [spDecided && spDecided.data, spPlanned && spPlanned.data]);
  check('人数は表示しない（今どおり）', sp.ds.every(d => d.headcount === null), sp.ds.map(d => d.headcount));
  check('社員+実習生に締まったB=2が入る', sameSeries(byLabel(sp, '社員+実習生').data, [347.6, 347.6, 347.6, 347.6, 347.6]), byLabel(sp, '社員+実習生').data);
  check('注意の欄が出る（2件）', /（2件）/.test(sp.alerts) && sp.alerts.includes('未登録 太郎さん') && sp.alerts.includes('空欄 次郎さん'), sp.alerts);

  console.log('\n[4] 拠点・業務別（群馬・栽培）');
  const site = await renderAndRead(page, 'site', 'plancmp2-群馬-栽培');
  const siteNew = site.ds.filter(d => d.label.startsWith('新規要員'));
  check('黄色は1本のまま（新規要員（開始済み）・#fbbf24）', siteNew.length === 1 && siteNew[0].label === '新規要員（開始済み）' && siteNew[0].color === '#fbbf24', siteNew.map(d => [d.label, d.color]));
  // 栽培の新規要員：新人十一月173.8（11月〜）。空欄次郎は0hのため10月はなし
  check('栽培の新規要員（11月〜173.8）', siteNew[0] && sameSeries(siteNew[0].data, [null, null, 173.8, 173.8, 173.8]), siteNew[0] && siteNew[0].data);
  check('栽培の社員+実習生に締まったB=2が入る（347.6）', sameSeries(byLabel(site, '社員+実習生').data, [347.6, 347.6, 347.6, 347.6, 347.6]), byLabel(site, '社員+実習生').data);
  check('栽培のフルタイム（新人実績無152.1＋退職三郎は11月まで）', sameSeries(byLabel(site, 'アルバイト・フルタイム').data.slice(1), [325.9, 325.9, 152.1, 152.1]), byLabel(site, 'アルバイト・フルタイム').data);
  check('栽培の増減（11月20／12月30）', sameSeries(byLabel(site, '増減').data, [null, null, 20, 30, null]), byLabel(site, '増減').data);
  check('注意の欄（新規要員）は出さない', site.alerts === '', site.alerts);

  console.log('\n[5] 3拠点サマリ');
  const sum = await renderAndRead(page, 'summary', 'plansum2-combined');
  const sumNew = sum.ds.filter(d => d.label.startsWith('新規要員'));
  check('黄色は1本のまま（新規要員（開始済み）（3拠点合計））', sumNew.length === 1 && sumNew[0].label === '新規要員（開始済み）（3拠点合計）' && sumNew[0].color === '#fbbf24', sumNew.map(d => [d.label, d.color]));
  check('新規要員の時間（10月347.6／11月521.4／12月〜869.0）', sumNew[0] && sameSeries(sumNew[0].data, [null, 347.6, 521.4, 869.0, 869.0]), sumNew[0] && sumNew[0].data);
  check('社員+実習生に締まったB=2が入る（347.6）', sameSeries(byLabel(sum, '社員+実習生（3拠点合計）') ? byLabel(sum, '社員+実習生（3拠点合計）').data : byLabel(sum, '社員+実習生').data, [347.6, 347.6, 347.6, 347.6, 347.6]), sum.ds.map(d => [d.label, d.data]));
  check('増減（11月20／12月60）', sameSeries(sum.ds.find(d => d.label.startsWith('増減')).data, [null, null, 20, 60, null]), sum.ds.find(d => d.label.startsWith('増減')).data);

  check('ページのエラーなし', pageErrors.length === 0, pageErrors);
  console.log(`\nOK: ${okCount} / NG: ${ngCount}`);
  await browser.close();
  server.close();
  process.exit(ngCount ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
