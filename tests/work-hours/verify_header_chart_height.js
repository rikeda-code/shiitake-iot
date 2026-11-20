// dashboard/work-hours.html の、上の固定エリア（タイトル＋操作の一式＋タブ）とグラフの高さ・縦軸の上限・
// 1か月分の幅の下限・吹き出しを、4通りの画面の大きさ（1920×950・1366×768・1536×864・390×844）で検証する。
//  [1] 固定エリアの高さが変更前より低い。1920 はタイトルと操作の一式が同じ1段、ノートPCは2段まで、
//      スマホはタイトルと「条件」ボタンだけで、押すと操作の一式が開き、もう一度押すと閉じる
//  [2] タブ（勤務実績・予実・設定と、その下のタブ）・サブタブが折り返さず1段で、横スクロールで全部選べる
//  [3] 全グラフで、いちばん高い棒・線の点・上に付く文字（計◯・◯人）が縦軸の上限の中に入る
//  [4] グラフの高さ：PC・ノートPCは凡例・横軸の見出しを含めて見える範囲に収まる高さ（最低300px）、
//      スマホは画面の高さの55%
//  [5] 1か月分の幅が44px以上で、下限の幅で入らないときは横スクロール。表は横スクロール
//  [6] 各月の見出しと棒の組の位置がそろう（verify_left_align_layout.js と同じ測り方）
//  [7] 吹き出しが、PCはマウス・スマホはタップで出て、画面の中に収まる
//  [8] 「計50」の形（2026/12 の棒 8588h、共通の上限 8600h）で、上限を上げて棒と「計50」が入る
// 対象の画面は verify_left_align_layout.js と同じ（勤務実績・サマリー・生産性・比較・比較（3拠点）・生産実績、
// 予実＞生産計画・予定標準工数(h)・比較（繁忙期見込み）の各サブタブ）。期間は 2025/11〜2027/2
// （勤務実績は実績のある12か月、予実は16か月）。
// モックは verify_left_align_layout.js と同じ（実際のシートと同じ形の gviz。生産実績だけは組み立て済みの形を
// 読み込みのキャッシュに入れる）。グラフの動き（アニメーション）が終わってから測る（時計は止めない）。

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
// 期間17か月（2025/6〜2026/10）で勤務実績・予実のどちらも17か月になるよう、実績・計画とも2025/6から置く
const M_MONTHS = monthsBetween('2025/6', '2026/10');     // 整理済み_Mの実績の月
const PLAN_MONTHS = monthsBetween('2025/6', '2027/2');   // 整理済み_計画_更新の計画の月
const MERGE_MONTHS = monthsBetween('2026/7', '2027/2');  // 標準労働時間シートの増減の月列
const ALL_OPTION_LABELS = monthsBetween('2025/6', '2027/2').map(m => { const [y, mo] = m.split('/'); return `${y}年${+mo}月`; });

/* ===================== 人（すべて群馬・PRJ=群馬） ===================== */
const ALL_PAST = Object.fromEntries(M_MONTHS.map(m => [m, 160]));
const PEOPLE = [
  { flag: 1, emp: '社員', div: '栽培', name: '既存 一郎', hours: ALL_PAST, std: { full: 173.8, part: 0, r: 173.8 } },
  { flag: 1, emp: 'パート', div: '出荷', name: '既存 花子', hours: ALL_PAST, std: { full: 0, part: 78.2, r: 78.2 } },
  { flag: 2, emp: '社員', div: '栽培', name: '新人 十一月', start: '2026/11', hours: {}, std: { full: 173.8, part: 0, r: 173.8 } },
];
// 整理済み_増減：既存 一郎の 2026/8 −32h・2026/10 −20h（どちらも 群馬→群馬、栽培）
const ADJUST = [
  { flag: 1, emp: '社員', base: '群馬', prj: '群馬', role: '研修_社内', name: '既存 一郎', ym: '2026/8', hours: 32 },
  { flag: 1, emp: '社員', base: '群馬', prj: '群馬', role: '研修_社内', name: '既存 一郎', ym: '2026/10', hours: 20 },
];

/* ===================== モックの組み立て ===================== */
function gvizText(table) {
  return `/*O_o*/\ngoogle.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"ok","sig":"1","table":${JSON.stringify(table)}});`;
}
function dateCell(m) {
  if (!m) return null;
  const [y, mo] = m.split('/').map(Number);
  return { v: `Date(${y},${mo - 1},1)`, f: `${y}/${String(mo).padStart(2, '0')}` };
}
function durationCell(h) {
  if (h == null) return null;
  const totalMin = Math.round(h * 60);
  const d = new Date(Date.UTC(1899, 11, 30) + totalMin * 60000);
  const v = `Date(${d.getUTCFullYear()},${d.getUTCMonth()},${d.getUTCDate()},${d.getUTCHours()},${d.getUTCMinutes()},0)`;
  return { v, f: `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}` };
}
function numCell(v, digits) { return v == null ? null : { v, f: digits != null ? v.toFixed(digits) : String(v) }; }
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
  const cols = [];
  'ABCDEFGHIJKLMNOPQRS'.split('').forEach(l => cols.push({ id: l, label: '', type: 'string' }));
  cols[0].label = '0：ファイルなし'; cols[9].label = 'パート労働時間'; cols[17] = { id: 'R', label: '標準労働時間', type: 'number' };
  MERGE_MONTHS.forEach((m, i) => cols.push({ id: 'M' + i, label: m, type: 'string' }));
  const width = cols.length;
  const pad = arr => { while (arr.length < width) arr.push(null); return arr; };
  const rows = [];
  rows.push({ c: pad([null, null, null, null, null, null, null, null, null, null, null, null, numCell(146, 1), null, null, null, numCell(146, 1), numCell(9999.9, 1), null, ...MERGE_MONTHS.map(() => ({ v: '#VALUE!' }))]) });
  rows.push({ c: pad([null, null, textCell('雇用区分'), textCell('拠点'), textCell('PRJ'), textCell('部門'), null, textCell('名前'), null, null, null, null, null, null, null, null, null, null, null, ...MERGE_MONTHS.map(() => textCell('時間／月'))]) });
  PEOPLE.forEach((p, i) => {
    const s = p.std;
    rows.push({ c: pad([null, numCell(p.flag), textCell(p.emp), textCell('群馬'), textCell('群馬'), textCell(p.div),
      numCell(270000 + i), textCell(p.name), dateCell(p.start),
      numCell(s.full > 0 ? 8 : 0), numCell(s.full > 0 ? 5 : 0), numCell(s.full > 0 ? 40 : 0), numCell(s.full, 1),
      numCell(s.part > 0 ? 4.5 : 0), numCell(s.part > 0 ? 4 : 0), numCell(s.part > 0 ? 18 : 0), numCell(s.part, 1),
      numCell(s.r, 1), null, ...MERGE_MONTHS.map(() => null)]) });
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

function buildAdjustGviz() {
  const cols = [
    { id: 'A', label: '', type: 'string' }, { id: 'B', label: 'F', type: 'number' },
    { id: 'C', label: '雇用区分', type: 'string' }, { id: 'D', label: '拠点', type: 'string' },
    { id: 'E', label: 'PRJ', type: 'string' }, { id: 'F', label: '部門', type: 'string' },
    { id: 'G', label: '社員番号', type: 'string' }, { id: 'H', label: '名前', type: 'string' },
    { id: 'I', label: '計上年月', type: 'date' }, { id: 'J', label: '増減時間', type: 'datetime' },
  ];
  const rows = ADJUST.map(a => ({
    c: [null, numCell(a.flag), textCell(a.emp), textCell(a.base), textCell(a.prj), textCell(a.role),
      null, textCell(a.name), dateCell(a.ym), durationCell(a.hours)],
  }));
  return gvizText({ cols, rows });
}

// 時間_過去実績（headers=0）：1行目 ["", "群馬"]、2行目 ["群馬", "2025.01", …]（拠点名の行が年月の見出しを兼ねる）、
// その下に「収穫作業時間」「出荷作業時間」の行
function buildPastYearGviz() {
  const yms = monthsBetween('2025/1', '2025/12');
  const cols = [{ id: 'A', label: '', type: 'string' }].concat(yms.map((_, i) => ({ id: 'C' + i, label: '', type: 'string' })));
  const label = m => { const [y, mo] = m.split('/'); return `${y}.${String(mo).padStart(2, '0')}`; };
  const rows = [
    { c: [null, textCell('群馬')] },
    { c: [textCell('群馬'), ...yms.map(m => textCell(label(m)))] },
    { c: [textCell('収穫量'), ...yms.map(() => textCell('12000.0'))] },
    { c: [textCell('収穫作業時間'), ...yms.map(m => textCell(String(3000 + ymNum(m) % 100) + '.0'))] },
    { c: [textCell('出荷作業時間'), ...yms.map(() => textCell('800.0'))] },
  ];
  return gvizText({ cols, rows });
}

// 生産実績（組み立て済みの形）：群馬の収穫量(kg)・出荷量(kg)を、整理済み_Mの実績の月すべてに入れる
const PROD_FAKE = {
  months: M_MONTHS.slice(),
  records: [
    { site: '群馬', cat: '生産実績', metric: '収穫量(kg)', values: M_MONTHS.map(() => 11000) },
    { site: '群馬', cat: '生産実績', metric: '出荷量(kg)', values: M_MONTHS.map(() => 9500) },
  ],
};

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
      else if (sheet === '整理済み_増減') body = buildAdjustGviz();
      else if (sheet === '時間_過去実績') body = buildPastYearGviz();
      else if (gid === PLAN_GID) body = buildPlanGviz();
      else if (gid === MERGE_GID) body = buildMergeGviz();
      return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body });
    }
    if (url.includes('/export')) return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '\r\n' });
    return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
  });
}

let okCount = 0, ngCount = 0;
function check(name, cond, extra) {
  if (cond) { okCount++; console.log(`  ${name}: OK`); }
  else { ngCount++; console.log(`  ${name}: NG${extra !== undefined ? ' (' + JSON.stringify(extra) + ')' : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function setPeriod(page, start, end) {
  await page.evaluate(([s, e]) => {
    document.getElementById('period-start-select').value = s;
    document.getElementById('period-end-select').value = e;
    onPeriodFilterChange('end');
  }, [start, end]);
  // 生産実績は組み立て済みの形を入れる（loadAll()でキャッシュが消えるため、期間を変えた後に入れ直す）
  await page.evaluate(prod => { productionDataPromise = Promise.resolve(prod); }, PROD_FAKE);
}


// 画面を描画して、月の表・グラフの幅を測る。render：描画する関数の名前と準備
const SCREENS = [
  { name: '勤務実績＞群馬', prep: "activeMode = 'site'; activeBase = '群馬'; document.getElementById('main').innerHTML = ''; renderBasePanel();", wait: 'main-chart' },
  { name: 'サマリー＞業務区分別（表）', prep: "activeMode = 'summary'; renderSummary(); switchToSummarySubtab('table');", wait: 'table' },
  { name: 'サマリー＞業務区分別（グラフ）', prep: "activeMode = 'summary'; renderSummary(); switchToSummarySubtab('work-chart');", wait: 'wc_0_h' },
  { name: 'サマリー＞標準労働時間', prep: "activeMode = 'summary'; stdHoursMetric = 'hours'; stdHoursSubtab = 'site'; renderSummary(); switchToSummarySubtab('std-hours');", wait: 'stdh_site_0_0' },
  { name: '勤務実績＞生産性', prep: "activeMode = 'productivity'; renderProductivityTab();", wait: 'prd-0' },
  { name: '勤務実績＞比較＞拠点別', prep: "activeMode = 'compare'; compareSubtab = 'site'; renderCompareTab();", wait: 'cmp-群馬-栽培' },
  { name: '勤務実績＞比較（3拠点）＞時間', prep: "activeMode = 'comparesite'; compareSiteViewMode = 'time'; renderCompareSiteTab();", wait: 'comparesite-actual' },
  { name: '勤務実績＞生産実績', prep: "activeMode = 'production'; renderProductionTab();", wait: 'table' },
  { name: '予実＞生産計画', prep: "activeMode = 'plan'; renderPlanTab();", wait: 'table' },
  { name: '予実＞予定標準工数(h)', prep: "activeMode = 'planstdhours'; renderPlanStdHoursTab();", wait: 'table' },
  { name: '比較（繁忙期見込み）＞拠点・業務別', prep: "activeMode = 'plancompare2'; planCmpSubtab = 'site'; planCmpSiteTab = '群馬'; renderPlanCompareTab2();", wait: 'plancmp2-群馬-栽培' },
  { name: '比較（繁忙期見込み）＞拠点サマリ', prep: "activeMode = 'plancompare2'; planCmpSubtab = 'sitesummary'; planCmpSiteTab = '群馬'; renderPlanCompareTab2();", wait: 'plansitesum2-combined' },
  { name: '比較（繁忙期見込み）＞3拠点サマリ', prep: "activeMode = 'plancompare2'; planCmpSubtab = 'summary'; renderPlanCompareTab2();", wait: 'plansum2-combined' },
  { name: '比較（繁忙期見込み）＞表', prep: "activeMode = 'plancompare2'; planCmpSubtab = 'table'; renderPlanCompareTab2();", wait: 'table' },
  { name: '比較（繁忙期見込み）＞要員計画', prep: "activeMode = 'plancompare2'; planCmpSubtab = 'staffplan'; planCmpSiteTab = '群馬'; renderPlanCompareTab2();", wait: 'planstaffplan2-combined' },
];


// 画面の大きさ（4通り）。mobile：スマホ（タップで操作する）
const VIEWPORTS = [
  { key: '1920x950', width: 1920, height: 950, kind: 'pc' },
  { key: '1366x768', width: 1366, height: 768, kind: 'laptop' },
  { key: '1536x864', width: 1536, height: 864, kind: 'laptop' },
  { key: '390x844', width: 390, height: 844, kind: 'mobile' },
];
// 変更前（main ad2ed8d の work-hours.html）を、このテストと同じモック・同じ画面の大きさで測った、
// 固定エリア（タイトル・操作の一式＋タブ。#main の上端の位置）の高さ
const BEFORE_FIXED_AREA_PX = { '1920x950': 236, '1366x768': 307, '1536x864': 307, '390x844': 512 };
const MIN_CHART_H = 300;
const MOBILE_RATIO = 0.55;
const MONTH_MIN = 44;

async function openPageAt(browser, baseUrl, vp) {
  const mobile = vp.kind === 'mobile';
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  const page = await context.newPage();
  page.__errors = [];
  page.on('pageerror', e => { page.__errors.push(e.message); console.log('  [pageerror]', e.message); });
  await page.clock.install({ time: new Date('2026-11-20T10:00:00+09:00') });
  await setupRoutes(page);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => (document.getElementById('last-updated')?.textContent || '').includes('最終更新'), null, { timeout: 30000 });
  return { page, context };
}

// 固定エリア（ヘッダー）を測る：段の数（縦に重ならない並びの数）、#main の上端の位置
async function measureHeader(page) {
  return page.evaluate(() => {
    const header = document.getElementById('app-header');
    const items = [...header.querySelectorAll(':scope > .header-title, :scope > .header-cond-btn, #header-controls > *')]
      .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0)
      .map(el => { const r = el.getBoundingClientRect(); return { cls: el.className || el.id, top: r.top, bottom: r.bottom }; })
      .sort((a, b) => a.top - b.top);
    const rows = [];
    items.forEach(it => {
      const row = rows[rows.length - 1];
      if (row && it.top < row.bottom - 2) { row.bottom = Math.max(row.bottom, it.bottom); row.items.push(it.cls); }
      else rows.push({ top: it.top, bottom: it.bottom, items: [it.cls] });
    });
    const controls = document.getElementById('header-controls');
    const periodSel = document.getElementById('period-start-select');
    return {
      fixedAreaPx: Math.round(document.getElementById('main').getBoundingClientRect().top),
      headerPx: Math.round(header.getBoundingClientRect().height),
      rows: rows.map(r => r.items),
      condBtnVisible: !!document.getElementById('header-cond-btn').offsetWidth,
      controlsVisible: !!periodSel.offsetWidth && getComputedStyle(controls).display !== 'none',
      pageHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}

// タブ・サブタブ：並び（同じ段＝折り返していない）と、横スクロールで全部のボタンが押せる位置に出せるか
async function measureTabs(page, selector) {
  return page.evaluate(sel => {
    const btns = [...document.querySelectorAll(sel)].filter(b => b.offsetWidth > 0);
    if (!btns.length) return { count: 0 };
    const tops = new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)));
    const box = btns[0].parentElement;
    const reachable = btns.map(b => {
      b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = b.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 1), document.documentElement.clientWidth - 1);
      const hit = document.elementFromPoint(x, r.top + r.height / 2);
      return !!hit && (hit === b || b.contains(hit));
    });
    box.scrollLeft = 0;
    return { count: btns.length, rowCount: tops.size, overflow: box.scrollWidth > box.clientWidth + 1, overflowX: getComputedStyle(box).overflowX, reachable: reachable.every(Boolean), notReachable: btns.filter((b, i) => !reachable[i]).map(b => b.textContent.trim()) };
  }, selector);
}

async function waitCharts(page) {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => [...document.querySelectorAll('#main canvas')].every(c => {
    const ch = window.Chart && Chart.getChart(c);
    if (!ch) return true;
    return ch.data.datasets.every((d, di) => (ch.getDatasetMeta(di).data || []).every(el => !Object.values(el.$animations || {}).some(a => a && a._active)));
  }), null, { timeout: 30000 });
  await page.waitForTimeout(150);
}

// 画面のグラフ・表を測る
async function measureScreen(page, screen) {
  await page.evaluate(code => { (0, eval)(code); }, screen.prep);
  if (screen.wait === 'table') {
    await page.waitForFunction(() => { const t = document.querySelector('#main table'); return t && t.dataset.monthFit; }, null, { timeout: 30000 });
  } else {
    await page.waitForFunction(id => { const el = document.getElementById(id); return el && window.Chart && Chart.getChart(el); }, screen.wait, { timeout: 30000 });
  }
  await waitCharts(page);
  return page.evaluate(() => {
    const MONTH_RE = /^\d{4}年\d{1,2}月$|^\d{4}\/\d{1,2}(\s|$)/;
    const charts = [...document.querySelectorAll('#main canvas')].filter(c => c.offsetWidth).map(c => {
      const ch = window.Chart && Chart.getChart(c);
      if (!ch || !ch.chartArea) return null;
      const labels = (ch.data.labels || []).map(String);
      if (!labels.length || !labels.every(l => MONTH_RE.test(l))) return null;
      const a = ch.chartArea;
      // 棒の上に描く文字（計◯・◯人）：fillText を記録して描き直す
      const texts = [];
      const ctx = ch.ctx, orig = ctx.fillText;
      ctx.fillText = function (t, x, y, ...rest) { texts.push({ t: String(t), y, base: ctx.textBaseline }); return orig.call(this, t, x, y, ...rest); };
      try { ch.draw(); } finally { ctx.fillText = orig; }
      const labelTops = texts.filter(t => /^計[\d.]+$|^[\d.]+人$/.test(t.t)).map(t => ({ t: t.t, top: t.base === 'bottom' ? t.y - 11 : (t.base === 'middle' ? t.y - 6 : t.y) }));
      // いちばん高い棒・線の点の上端（値のある棒・点だけ）
      let barTop = Infinity, lineTop = Infinity;
      ch.data.datasets.forEach((d, di) => {
        const m = ch.getDatasetMeta(di);
        if (!ch.isDatasetVisible(di)) return;
        (m.data || []).forEach((el, i) => {
          const v = el.$context && el.$context.parsed;
          if (!v || v.y == null || !(v.y > 0) || !Number.isFinite(el.y)) return;
          if (m.type === 'bar') barTop = Math.min(barTop, Math.min(el.y, Number.isFinite(el.base) ? el.base : el.y));
          else if (m.type === 'line') lineTop = Math.min(lineTop, el.y);
        });
      });
      // 見出しと棒の位置（verify_left_align_layout.js と同じ測り方）
      const xs = ch.scales.x;
      const slot = (a.right - a.left) / labels.length;
      let maxOff = 0, outside = 0;
      labels.forEach((l, i) => {
        const tick = xs.getPixelForValue(i);
        const els = [];
        ch.data.datasets.forEach((d, di) => {
          const m = ch.getDatasetMeta(di);
          if (m.type !== 'bar' || !ch.isDatasetVisible(di)) return;
          const el = m.data[i];
          if (!el || !isFinite(el.x)) return;
          const v = el.$context && el.$context.parsed;
          els.push({ lo: el.x - (el.width || 0) / 2, hi: el.x + (el.width || 0) / 2, has: !!(v && v.y != null) });
        });
        if (!els.length) return;
        const lo = Math.min(...els.map(e => e.lo)), hi = Math.max(...els.map(e => e.hi));
        maxOff = Math.max(maxOff, Math.abs((lo + hi) / 2 - tick));
        if (els.some(e => e.has && (e.lo < tick - slot / 2 - 0.5 || e.hi > tick + slot / 2 + 0.5))) outside++;
      });
      const inner = c.parentElement, outer = inner.parentElement;
      const spacerW = ch.scales.monthSlotSpacer ? ch.scales.monthSlotSpacer.width : 0;
      const overhead = ch.width - (a.right - a.left) - spacerW;
      const box = window.chartScrollBox(inner);
      return {
        id: c.id, n: labels.length, h: Math.round(c.getBoundingClientRect().height), visibleH: Math.floor(window.chartVisibleHeight(box)),
        areaTop: a.top, barTop, lineTop, labelTops, perMonth: slot,
        needScroll: overhead + 44 * labels.length > outer.clientWidth + 1,
        scroll: outer.scrollWidth > outer.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(outer).overflowX),
        maxOff, outside,
      };
    }).filter(Boolean);
    const tables = [...document.querySelectorAll('#main table')].filter(t => t.offsetWidth).map(t => {
      let sc = null;
      for (let p = t.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth + 1) { sc = p; break; }
      }
      return { w: t.getBoundingClientRect().width, parentW: t.parentElement.clientWidth, hscroll: !!sc };
    });
    return { charts, tables, pageHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  });
}

// 吹き出し：PCはマウス、スマホはタップで出して、画面の中に収まるかを測る
async function measureTooltip(page, canvasId, kind) {
  const p = await page.evaluate(id => {
    const c = document.getElementById(id);
    c.scrollIntoView({ block: 'nearest', inline: 'start' });
    window.scrollTo(0, 0);
    const ch = Chart.getChart(c);
    const r = c.getBoundingClientRect();
    const a = ch.chartArea;
    const x = r.left + a.left + Math.min(60, (a.right - a.left) / 4);
    return { x, y: r.top + (a.top + a.bottom) / 2 };
  }, canvasId);
  // 画面をスクロールすると吹き出しが消えるため、スクロールが終わってから出す
  await page.waitForTimeout(400);
  if (kind === 'mobile') await page.touchscreen.tap(p.x, p.y);
  else { await page.mouse.move(p.x, p.y); await page.mouse.move(p.x + 1, p.y); }
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const el = document.getElementById('chart-tip');
    if (!el) return { shown: false };
    const r = el.getBoundingClientRect();
    return { shown: el.classList.contains('on'), top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: document.documentElement.clientWidth, vh: window.innerHeight, lines: el.querySelectorAll('.tt-line').length };
  });
}

(async () => {
  const html = fs.readFileSync(HTML_PATH);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(r => server.listen(0, r));
  const BASE_URL = `http://localhost:${server.address().port}/work-hours.html`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const allErrors = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n========== 画面 ${vp.key}（${vp.kind === 'pc' ? 'PC' : vp.kind === 'laptop' ? 'ノートPC' : 'スマホ'}） ==========`);
    const { page, context } = await openPageAt(browser, BASE_URL, vp);
    await setPeriod(page, '2025年11月', '2027年2月');

    // ---- [1] 固定エリア ----
    const hd = await measureHeader(page);
    check(`[1] ${vp.key}：固定エリアの高さが変更前より低い（${BEFORE_FIXED_AREA_PX[vp.key]}px → ${hd.fixedAreaPx}px）`, hd.fixedAreaPx < BEFORE_FIXED_AREA_PX[vp.key], hd);
    if (vp.kind === 'pc') {
      check(`[1] ${vp.key}：タイトルと操作の一式（開始月〜更新）が同じ1段に並ぶ`, hd.rows.length === 1 && hd.rows[0].length >= 7 && !hd.condBtnVisible, hd.rows);
    } else if (vp.kind === 'laptop') {
      check(`[1] ${vp.key}：タイトルの右に操作が並び、折り返しても2段まで`, hd.rows.length <= 2 && hd.rows[0].includes('header-title') && hd.rows[0].length >= 2 && !hd.condBtnVisible, hd.rows);
    } else {
      check(`[1] ${vp.key}：固定エリアはタイトルと「条件」ボタンだけ（操作の一式は閉じている）`, hd.condBtnVisible && !hd.controlsVisible && hd.rows.length === 1 && hd.rows[0].length === 2, hd);
      await page.click('#header-cond-btn');
      await page.waitForTimeout(200);
      const opened = await measureHeader(page);
      check(`[1] ${vp.key}：「条件」ボタンを押すと操作の一式が開き（その間だけ場所を取る）、横にはみ出さない`, opened.controlsVisible && opened.fixedAreaPx > hd.fixedAreaPx && !opened.pageHScroll, opened);
      await page.click('#header-cond-btn');
      await page.waitForTimeout(200);
      const closed = await measureHeader(page);
      check(`[1] ${vp.key}：もう一度押すと閉じて、元の高さに戻る`, !closed.controlsVisible && closed.fixedAreaPx === hd.fixedAreaPx, closed);
    }
    check(`[1] ${vp.key}：ページ全体が横にはみ出さない`, !hd.pageHScroll, hd);

    // ---- [2] タブ・サブタブ：折り返さず、横スクロールで全部選べる ----
    for (const [label, group, prep, sel] of [
      ['グループのタブ（勤務実績・予実・設定）', null, '', '#tabs-group .group-btn'],
      ['勤務実績のタブ', '勤務実績', '', '#tabs .tab-btn'],
      ['予実のタブ', '予実', '', '#tabs .tab-btn'],
      ['サマリーのサブタブ', null, "activeMode = 'summary'; renderSummary(); switchToSummarySubtab('table');", '#summary-subtabs .summary-subtab'],
      ['比較（繁忙期見込み）のサブタブ', null, "activeMode = 'plancompare2'; planCmpSubtab = 'site'; planCmpSiteTab = '群馬'; renderPlanCompareTab2();", '#main .transfer-toggle-btn[data-tab]'],
    ]) {
      if (group) { await page.locator('#tabs-group .group-btn', { hasText: group }).first().click(); await page.waitForTimeout(500); }
      if (prep) await page.evaluate(code => { (0, eval)(code); }, prep);
      await page.waitForTimeout(300);
      const t = await measureTabs(page, sel);
      check(`[2] ${vp.key}：${label}は折り返さず1段で、横スクロールで全部のボタンが押せる位置に出せる`, t.count > 0 && t.rowCount === 1 && t.reachable && (!t.overflow || /auto|scroll/.test(t.overflowX)), t);
    }

    // ---- [3]〜[6] 全画面のグラフ・表 ----
    const results = {};
    for (const sc of SCREENS) results[sc.name] = await measureScreen(page, sc);
    for (const sc of SCREENS) {
      const r = results[sc.name];
      if (r.charts.length) {
        // [3] いちばん高い棒（と上の文字）・線が、縦軸の上限の中（描画部分の上端より下）
        check(`[3] ${vp.key} ${sc.name}：いちばん高い棒・線の点・上の文字（計◯・◯人）が縦軸の上限の中`,
          r.charts.every(c => c.barTop >= c.areaTop - 0.5 && (c.lineTop === null || c.lineTop >= c.areaTop - 0.5) && c.labelTops.every(l => l.top >= c.areaTop - 1)),
          r.charts.filter(c => !(c.barTop >= c.areaTop - 0.5 && (c.lineTop === null || c.lineTop >= c.areaTop - 0.5) && c.labelTops.every(l => l.top >= c.areaTop - 1))).map(c => [c.id, c.areaTop, c.barTop, c.lineTop, c.labelTops.filter(l => l.top < c.areaTop - 1)]));
        // [4] グラフの高さ
        if (vp.kind === 'mobile') {
          const want = Math.round(vp.height * MOBILE_RATIO);
          check(`[4] ${vp.key} ${sc.name}：グラフの高さは画面の高さの55%（${want}px）`, r.charts.every(c => Math.abs(c.h - want) <= 1), r.charts.map(c => [c.id, c.h]));
        } else {
          check(`[4] ${vp.key} ${sc.name}：グラフ全体（凡例・横軸の見出しを含む）が見える範囲に収まる高さ（最低${MIN_CHART_H}px）`,
            r.charts.every(c => c.h >= MIN_CHART_H - 1 && (c.h <= c.visibleH + 1 || c.visibleH < MIN_CHART_H + 8) && Math.abs(c.h - Math.max(MIN_CHART_H, c.visibleH - 8)) <= 2),
            r.charts.map(c => [c.id, c.h, c.visibleH]));
        }
        // [5] 1か月分の幅の下限・横スクロール
        check(`[5] ${vp.key} ${sc.name}：1か月分の幅が${MONTH_MIN}px以上で、下限の幅で入らないときは横スクロール`,
          r.charts.every(c => c.perMonth >= MONTH_MIN - 0.5 && (!c.needScroll || c.scroll)), r.charts.map(c => [c.id, c.n, +c.perMonth.toFixed(1), c.needScroll, c.scroll]));
        // [6] 見出しと棒の位置（前回のテストと同じ測り方）
        check(`[6] ${vp.key} ${sc.name}：各月の見出しと棒の組の中央の差が1.5px以内、棒が月の枠の外に出ない`,
          r.charts.every(c => c.maxOff <= 1.5 && c.outside === 0), r.charts.map(c => [c.id, +c.maxOff.toFixed(1), c.outside]));
      }
      if (r.tables.length) {
        check(`[5] ${vp.key} ${sc.name}：表は横スクロール（ページ全体ははみ出さない）`, !r.pageHScroll && r.tables.every(t => t.w <= t.parentW + 1 || t.hscroll), r.tables);
      }
    }

    // ---- [7] 吹き出し：PCはマウス、スマホはタップで出て、画面の外にはみ出さない ----
    await page.evaluate(code => { (0, eval)(code); }, SCREENS.find(s => s.name === '比較（繁忙期見込み）＞拠点サマリ').prep);
    await waitCharts(page);
    const tt = await measureTooltip(page, 'plansitesum2-combined', vp.kind);
    check(`[7] ${vp.key}：グラフの吹き出しが${vp.kind === 'mobile' ? 'タップ' : 'マウス'}で出て、画面の中に収まる`, tt.shown && tt.lines > 0 && tt.top >= 0 && tt.left >= 0 && tt.bottom <= tt.vh + 0.5 && tt.right <= tt.vw + 0.5, tt);

    // ---- [8] 「計50」の形：2026/12 の棒（8588h、縦軸の共通の上限 8600h）の上の「計50」が上限の中に入る ----
    const k50 = await page.evaluate(h => {
      const wrap = document.createElement('div');
      wrap.style.cssText = `position:fixed;left:0;top:0;width:${Math.min(900, window.innerWidth)}px;height:${h}px;z-index:900;background:#000`;
      const canvas = document.createElement('canvas');
      wrap.appendChild(canvas);
      document.body.appendChild(wrap);
      const labels = ['2026/10', '2026/11', '2026/12', '2027/1'];
      const chart = new Chart(canvas.getContext('2d'), {
        data: { labels, datasets: [
          { type: 'bar', label: '社員', stack: 'stdhours', data: [3000, 3200, 5400, 3000], _segmentHeadcount: [20, 21, 33, 20] },
          { type: 'bar', label: '新規要員（採用計画）', stack: 'stdhours', data: [500, 800, 2400, 600], _segmentHeadcount: [3, 5, 14, 4] },
          { type: 'bar', label: '増減', stack: 'stdhours', data: [100, 300, 788, 200], _segmentHeadcount: [1, 2, 3, 1], _stackTotalHeadcount: [24, 28, 50, 25] },
        ] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { font: { size: 10 } } } },
          scales: { x: { stacked: true }, y: { stacked: true, suggestedMin: 0, max: 8600 } } },
        plugins: [siteSummaryHeadcountLabelsPlugin()],
      });
      return new Promise(resolve => setTimeout(() => {
        const texts = [];
        const ctx = chart.ctx, orig = ctx.fillText;
        ctx.fillText = function (t, x, y, ...rest) { texts.push({ t: String(t), y }); return orig.call(this, t, x, y, ...rest); };
        chart.draw();
        ctx.fillText = orig;
        const k = texts.find(t => t.t === '計50');
        const out = { yMax: chart.scales.y.max, areaTop: chart.chartArea.top, barTop: chart.getDatasetMeta(2).data[2].y, k50Top: k ? k.y - 11 : null };
        chart.destroy(); wrap.remove();
        resolve(out);
      }, 50));
    }, vp.kind === 'mobile' ? Math.round(vp.height * MOBILE_RATIO) : 400);
    check(`[8] ${vp.key}：「計50」の形（8588h・共通の上限8600h）：上限を上げて、棒と「計50」が上限の中に入る`, k50.yMax > 8600 && k50.barTop >= k50.areaTop && k50.k50Top !== null && k50.k50Top >= k50.areaTop - 1, k50);

    allErrors.push(...page.__errors);
    await context.close();
  }

  check('ページのエラーなし（4通りの画面とも）', allErrors.length === 0, allErrors);
  console.log(`\nOK: ${okCount} / NG: ${ngCount}`);
  console.log(ngCount ? 'NGあり' : 'すべてOK');
  console.log('DONE');
  await browser.close();
  server.close();
  process.exit(ngCount ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
