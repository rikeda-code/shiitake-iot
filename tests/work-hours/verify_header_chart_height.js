// dashboard/work-hours.html の、上の固定エリア（タイトル＋操作の一式＋タブ）とグラフの高さ・縦軸の上限・
// 1か月分の幅の下限・吹き出しを、いろいろな窓の大きさで検証する。決まった画面の大きさは持たず、開いている
// 窓の見える範囲をその場で測って合わせる作りのため、窓の大きさは 1607×905・1920×1040・1440×800・1280×720・
// 1100×900（縦長）・1700×600（横長で低い）・800×600・390×844（狭い窓。タップでも操作する）の8通りで測る。
//  [1] 固定エリアの高さが変更前（main ad2ed8d を同じモック・同じ大きさで測った値）より低い。窓の幅に応じて
//      自然に折り返し（横 1280 以上は2段まで）、段と段の間に余分な高さが無い。狭い窓（横 768 未満。端末では
//      なく窓の幅で決まる）はタイトルと「条件」ボタンだけで、押すと操作の一式が開き、もう一度押すと閉じる
//  [2] タブ（勤務実績・予実・設定と、その下のタブ）・サブタブが折り返さず1段で、横スクロールで全部選べる
//  [3] 全グラフで、いちばん高い棒・線の点・上に付く文字（計◯・◯人）が縦軸の上限の中に入る
//  [4] 全グラフで、グラフの見出し・凡例・グラフ・横軸の見出し（・横スクロールのバー）の全体が、固定エリアと
//      上に貼り付く行（拠点の切替・サブタブ）の下の見える範囲に収まる（実際にその位置までスクロールして測る）。
//      いちばん上のグラフ（グラフが1つだけの画面はそのグラフ、複数並ぶ画面は1つ目）は、開いた直後（スクロール
//      していない状態）にも、上の見出しの行（「📊 比較（3拠点）」と切替の行、比較（繁忙期見込み）の説明文と切替の
//      行など）の下で全体が見えること。
//      最低の高さ（300px）でも収まらない小さい窓は、最低の高さを優先していること。狭い窓は画面の高さの55%以下
//  [5] 1か月分の幅が44px以上で、下限の幅で入らないときは横スクロール。表は横スクロール
//  [6] 各月の見出しと棒の組の位置がそろう（verify_left_align_layout.js と同じ測り方）
//  [7] 吹き出しが、マウス（狭い窓はタップ）で出て、画面の中に収まる
//  [8] 「計50」の形（2026/12 の棒 8588h、共通の上限 8600h）で、上限を上げて棒と「計50」が入る
//  [9] 窓の大きさを途中で変えたとき（大→小、小→大）と、固定エリアの段数が変わる幅の前後で、グラフの高さが
//      合わせ直され、全体が見える範囲に収まる
//  [1]（案4）振替・更新・最終更新の一式が、広い窓ではタブの段（勤務実績・予実・設定）の右にあり、狭い窓は「条件」の
//      中に残る。固定エリアが案4の前（e72ad1a を同じモック・同じ大きさで測った値）より、1607 は低く、ほかは高くならない
//  [11] グラフが複数並ぶ画面で、いちばん上のグラフは開いた直後の状態で見出しから横軸まで収まり、2つ目以降は
//      今までどおりスクロールしたときに収まる（最低の高さを優先する窓を除く）
//  [12] 予実＞比較（繁忙期見込み）・比較（週間）で、拠点の切替・表示の切替が、説明文（2行）と同じ段の右に右寄せで
//      並ぶ（左から拠点の切替、表示の切替）。説明文の右に入りきらない窓では説明文の下に回り、はみ出し・重なりが
//      無い。上に貼り付く行の高さが、説明文と切替の高い方＋上下の余白だけになる（切替だけの段が無い）
//  [13] 勤務実績＞生産性の上の、最新月の生産性の表：3行（①②③のグラフの見出しと同じ指標名＋単位）×3列（いなべ・
//      群馬・南丹、拠点の色）で、9つの数字が変更前の枠（main 570e3e0 を同じモックで測った値）と同じ。窓の幅を変えても
//      （1920・1607・1280・1100・390）行が増えず高さが変わらず、変更前の枠1段より高くない。左寄せで横いっぱいに広げず、
//      入らない窓では表の中で横スクロール。いちばん上のグラフが開いた直後に収まり、表の高さが変わるとグラフの高さが
//      合わせ直される
//  [10] 窓の幅を 1920→390→1920 と変えても固定エリアにはみ出し・重なりが無い。タブの段の右に入りきらないとき
//      （タブのボタンを広げて再現）はヘッダーの中（チェックの右）に戻り、入るようになると戻る。置き場所が変わって
//      固定エリアの高さが変わると、グラフの高さが合わせ直される
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

// mSites：同じ人たちを置く拠点（ふだんは群馬だけ。[13] の生産性の表だけ3拠点にする。群馬の行は今までと同じ）
function buildMGviz(mSites = ['群馬']) {
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
  const rows = mSites.flatMap((site, si) => PEOPLE.map((p, i) => {
    const c = [null, numCell(p.flag), textCell(p.emp), textCell(site), textCell(site), textCell(p.div),
      numCell(270000 + si * 1000 + i), textCell(si ? `${p.name}${si}` : p.name), dateCell(p.start)];
    M_MONTHS.forEach(m => {
      const h = p.hours[m];
      c.push(durationCell(h)); c.push(h == null ? null : durationCell(0)); c.push(durationCell(h));
    });
    return { c };
  }));
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
// [13]（生産性の表）だけで使う、3拠点分の生産実績（実際の生産実績シートを組み立てたものと同じ形。
// 指標の名前も実際と同じ：収穫量(kg)・出荷量(kg)・合計(点数)）。拠点ごとに値を変えて、表の列の取り違えを見分ける
const PROD_FAKE_3SITES = {
  months: M_MONTHS.slice(),
  records: [
    ['いなべ', 12000, 10500, 8200], ['群馬', 11000, 9500, 6100], ['南丹', 7000, 6400, 3300],
  ].flatMap(([site, harvest, ship, pcs]) => [
    { site, cat: '生産実績', metric: '収穫量(kg)', values: M_MONTHS.map((_, i) => harvest + i * 37) },
    { site, cat: '生産実績', metric: '出荷量(kg)', values: M_MONTHS.map((_, i) => ship + i * 29) },
    { site, cat: '生産実績', metric: '合計(点数)', values: M_MONTHS.map((_, i) => pcs + i * 11) },
  ]),
};

async function setupRoutes(page, opts = {}) {
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
      if (sheet === '整理済み_M') body = buildMGviz(opts.mSites);
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
  { name: '勤務実績＞比較（3拠点）＞人数', prep: "activeMode = 'comparesite'; compareSiteViewMode = 'count'; renderCompareSiteTab();", wait: 'comparesite-count' },
  { name: '勤務実績＞比較（3拠点）＞標準労働時間', prep: "activeMode = 'comparesite'; compareSiteViewMode = 'stdhours'; renderCompareSiteTab();", wait: 'comparesite-stdhours' },
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
  ['1607x905', 1607, 905], ['1920x1040', 1920, 1040], ['1440x800', 1440, 800], ['1280x720', 1280, 720],
  ['1100x900', 1100, 900], ['1700x600', 1700, 600], ['800x600', 800, 600], ['390x844', 390, 844],
].map(([key, width, height]) => ({ key, width, height, narrow: width < 768 }));
// 変更前（main ad2ed8d の work-hours.html）を、このテストと同じモック・同じ窓の大きさで測った、
// 固定エリア（タイトル・操作の一式＋タブ。#main の上端の位置）の高さ
const BEFORE_FIXED_AREA_PX = { '1607x905': 236, '1920x1040': 236, '1440x800': 307, '1280x720': 343, '1100x900': 379, '1700x600': 236, '800x600': 429, '390x844': 512 };
// 案4（振替・更新・最終更新をタブの段の右へ）の前（e72ad1a）を、このテストと同じモック・同じ窓の大きさで測った
// 固定エリアの高さ。1607 はこれより低く、ほかの大きさはこれより高くならないこと
const CURRENT_FIXED_AREA_PX = { '1607x905': 222, '1920x1040': 165, '1440x800': 222, '1280x720': 225, '1100x900': 225, '1700x600': 165, '800x600': 284, '390x844': 136 };
const MIN_CHART_H = 300;
// 勤務実績＞生産性の上の数字の枠（変更前、main 570e3e0）を、このテストと同じモックで測った値：
// 9つの数字（①②③の順に いなべ・群馬・南丹）と、枠1段の高さ
const BEFORE_KPI_VALUES = ['78.7 kg/h', '82.8 kg/h', '47.5 kg/h', '68.5 kg/h', '62.3 kg/h', '42.9 kg/h', '52 点/h', '39 点/h', '22 点/h'];
const BEFORE_KPI_ROW_PX = 81;
const MOBILE_RATIO = 0.55;
const MONTH_MIN = 44;

async function openPageAt(browser, baseUrl, vp, opts = {}) {
  // 端末（スマホ）の扱いにはしない（isMobile なし）。狭い窓はタップでも操作できるようにする
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.narrow });
  const page = await context.newPage();
  page.__errors = [];
  page.on('pageerror', e => { page.__errors.push(e.message); console.log('  [pageerror]', e.message); });
  await page.clock.install({ time: new Date('2026-11-20T10:00:00+09:00') });
  await setupRoutes(page, opts);
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
    const hcs = getComputedStyle(header);
    // 段の高さの合計＋段の間＋上下の余白（これより高ければ、余分な高さがある）
    const minHeaderPx = rows.reduce((a, r) => a + (r.bottom - r.top), 0) + Math.max(0, rows.length - 1) * (parseFloat(hcs.rowGap) || 0) + (parseFloat(hcs.paddingTop) || 0) + (parseFloat(hcs.paddingBottom) || 0) + (parseFloat(hcs.borderBottomWidth) || 0);
    const controls = document.getElementById('header-controls');
    const periodSel = document.getElementById('period-start-select');
    return {
      fixedAreaPx: Math.round(document.getElementById('main').getBoundingClientRect().top),
      headerPx: Math.round(header.getBoundingClientRect().height),
      rows: rows.map(r => r.items),
      minHeaderPx: Math.round(minHeaderPx),
      condBtnVisible: !!document.getElementById('header-cond-btn').offsetWidth,
      controlsVisible: !!periodSel.offsetWidth && getComputedStyle(controls).display !== 'none',
      pageHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}

// 振替・更新・最終更新の一式の置き場所と、固定エリア（ヘッダー・タブの段）のはみ出し・重なり
async function measureActions(page) {
  return page.evaluate(() => {
    const actions = document.getElementById('header-actions');
    const r = el => { const b = el.getBoundingClientRect(); return { id: el.id || el.className || el.textContent.trim(), left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
    const visible = el => el.offsetWidth > 0 && el.offsetHeight > 0;
    const header = document.getElementById('app-header');
    const headerItems = [...header.querySelectorAll(':scope > .header-title, :scope > .header-cond-btn, #header-controls > *')].filter(visible).map(r);
    const groupBtns = [...document.querySelectorAll('#tabs-group .group-btn')].filter(visible).map(r);
    const act = visible(actions) ? r(actions) : null;
    const items = [...headerItems, ...groupBtns, ...(act && !headerItems.some(h => h.id === act.id) ? [act] : [])];
    const overlaps = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push(a.id + ' × ' + b.id);
    }
    const vw = document.documentElement.clientWidth;
    const outside = items.filter(it => it.left < -1 || it.right > vw + 1).map(it => it.id);
    const bar = document.querySelector('.tabs-group-bar').getBoundingClientRect();
    const lastBtn = groupBtns[groupBtns.length - 1];
    return {
      parent: actions.parentElement.id, act, overlaps, outside,
      // タブの段の中（勤務実績・予実・設定の右で、下の線より上）にあるか
      inTabRow: !!(act && lastBtn && act.left > lastBtn.right && act.bottom <= bar.top + 1 && act.top >= lastBtn.top - 20),
      lastUpdated: document.getElementById('last-updated').textContent,
      pageHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}

// 比較（繁忙期見込み）の上の行：説明文（2行）と、拠点の切替・表示の切替の位置
async function measurePlanCmpHeader(page) {
  return page.evaluate(() => {
    const row = document.getElementById('plancmp2-header-row');
    const desc = row.querySelector('.plancmp2-header-desc');
    const sw = document.getElementById('plancmp2-header-switches');
    const siteBar = document.getElementById('plancmp2-site-tabbar-fixed');
    const subt = document.getElementById('plancmp2-subtabs');
    const r = el => el.getBoundingClientRect();
    const rr = r(row), dr = r(desc), sr = r(sw);
    const cs = getComputedStyle(row);
    const parts = [siteBar, subt].filter(e => e.offsetWidth > 0);
    const vw = document.documentElement.clientWidth;
    const overlap = parts.some(e => { const b = r(e); return dr.left < b.right - 1 && b.left < dr.right - 1 && dr.top < b.bottom - 1 && b.top < dr.bottom - 1; });
    const outside = [dr, sr, ...parts.map(r)].some(b => b.left < rr.left - 1 || b.right > rr.right + 1 || b.right > vw + 1);
    const sb = siteBar.offsetWidth ? r(siteBar) : null, tb = subt.offsetWidth ? r(subt) : null;
    const order = !sb || !tb || sb.right <= tb.left + 1 || sb.bottom <= tb.top + 1;
    const swNatural = parts.reduce((a, e) => a + e.scrollWidth, 0) + Math.max(0, parts.length - 1) * (parseFloat(getComputedStyle(sw).columnGap) || 0);
    return {
      rowH: rr.height, descH: dr.height, swH: sr.height,
      sameRow: sr.top < dr.bottom - 1 && sr.left >= dr.right - 1,
      below: sr.top >= dr.bottom - 1,
      rightAligned: Math.abs(sr.right - rr.right) <= 1.5,
      fitsOneRow: dr.width + (parseFloat(cs.columnGap) || 0) + swNatural <= rr.width,
      overlap, outside, order,
      siteTabs: !!sb, subtabs: !!tb,
      pad: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0),
      rowGap: parseFloat(cs.rowGap) || 0,
      sticky: cs.position,
      descText: desc.textContent.replace(/\s+/g, ' ').trim(),
      pageHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}

// 勤務実績＞生産性の上の、最新月の生産性の表
async function measureProdKpi(page) {
  return page.evaluate(() => {
    const t = document.getElementById('prod-kpi-table');
    if (!t) return null;
    const wrap = t.closest('.prod-kpi-scroll');
    const panel = t.closest('.prod-panel');
    const pcs = getComputedStyle(panel);
    const tr = t.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const contentLeft = pr.left + (parseFloat(pcs.borderLeftWidth) || 0) + (parseFloat(pcs.paddingLeft) || 0);
    const contentW = panel.clientWidth - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
    const text = el => el.textContent.replace(/\s+/g, ' ').trim();
    const toHex = c => { const m = c.match(/\d+/g); return m ? '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('') : c; };
    const heads = [...t.tHead.rows[0].cells];
    const body = [...t.tBodies[0].rows];
    return {
      h: wr.height, tableH: tr.height, tableW: tr.width,
      bodyRows: body.length, cols: [...t.rows].map(r => r.cells.length),
      colHeads: heads.slice(1).map(text),
      colColors: heads.slice(1).map(c => toHex(getComputedStyle(c).color)),
      siteColors: heads.slice(1).map(c => (typeof SITE_COLORS !== 'undefined' ? SITE_COLORS : {})[text(c)] || null),
      rowHeads: body.map(r => text(r.cells[0])),
      chartTitles: [...document.querySelectorAll('#main .schart-header')].map(h => h.firstChild.textContent.trim()),
      values: body.flatMap(r => [...r.cells].slice(1).map(text)),
      // 1行ずつの高さ（文字が折り返していれば高くなる）
      rowHs: [...t.rows].map(r => Math.round(r.getBoundingClientRect().height * 10) / 10),
      leftAligned: Math.abs(wr.left - contentLeft) <= 1,
      notFull: wr.width < contentW - 1 || t.scrollWidth > wrap.clientWidth + 1,
      tableOverflow: t.scrollWidth > wrap.clientWidth + 1,
      wrapScrolls: /auto|scroll/.test(getComputedStyle(wrap).overflowX),
      label: text(document.querySelector('#main .prod-panel > .chart-section-label')),
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
// グラフ1つずつについて、見出し（グラフ1つだけを入れているかたまり）からグラフの下端までを、固定エリアと
// 上に貼り付く行の下に来るようにスクロールして、全体が見える範囲に入るかを測る
async function measureChartFits(page) {
  return page.evaluate(() => {
    const main = document.getElementById('main');
    const out = [];
    const canvases = [...main.querySelectorAll('.month-scroll-inner > canvas')].filter(c => c.offsetWidth);
    for (const c of canvases) {
      const inner = c.parentElement, outer = inner.parentElement;
      const parent = outer.parentElement;
      const block = parent && parent.querySelectorAll('.month-scroll-outer').length === 1 ? parent : outer;
      let box = main;
      for (let p = outer.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(p).overflowY)) { box = p; break; }
      }
      const stickies = [...box.querySelectorAll('*')].filter(e => !e.closest('table') && e.offsetHeight && getComputedStyle(e).position === 'sticky' && getComputedStyle(e).top !== 'auto');
      const visTop = () => Math.max(box.getBoundingClientRect().top, main.getBoundingClientRect().top, 0, ...stickies.map(e => e.getBoundingClientRect().bottom));
      const visBottom = () => Math.min(box.getBoundingClientRect().bottom, main.getBoundingClientRect().bottom, window.innerHeight);
      // いちばん上のグラフ（グラフが1つだけの画面はそのグラフ、複数並ぶ画面は1つ目）は、開いた直後（スクロール
      // していない状態）にも、上の見出しの行（上に貼り付かないもの）の下で全体が見えること。スクロールして測る
      // だけでは、上の行をスクロールで隠した状態で「収まる」と判定してしまうため
      const outersInBox = [...box.querySelectorAll('.month-scroll-outer')].filter(o => o.offsetParent);
      const single = outersInBox.length === 1;
      const first = outersInBox[0] === outer;
      let fits0 = true, available0 = Infinity, blockBottom0 = null;
      if (first) {
        main.scrollTop = 0; box.scrollTop = 0;
        const b0 = block.getBoundingClientRect();
        const bottom0 = visBottom();
        available0 = Math.round(bottom0 - b0.top);
        blockBottom0 = Math.round(b0.bottom);
        fits0 = b0.top >= visTop() - 1 && b0.bottom <= bottom0 + 1;
      }
      block.scrollIntoView({ block: 'start' });
      for (let k = 0; k < 2; k++) {
        const d = block.getBoundingClientRect().top - visTop();
        if (Math.abs(d) > 0.5) box.scrollTop += d;
      }
      const br = block.getBoundingClientRect();
      const top = visTop(), bottom = visBottom();
      const h = Math.round(c.getBoundingClientRect().height);
      out.push({
        id: c.id, h, blockH: Math.round(br.height), available: Math.min(Math.round(bottom - top), available0),
        fits: br.top >= top - 1 && br.bottom <= bottom + 1 && fits0,
        single, first, fits0, blockBottom0, fitsScrolled: br.top >= top - 1 && br.bottom <= bottom + 1,
        headTop: Math.round(br.top), visTop: Math.round(top), blockBottom: Math.round(br.bottom), visBottom: Math.round(bottom),
      });
    }
    main.scrollTop = 0;
    return out;
  });
}
const MIN_PRIORITY = [];
// 収まっている、または最低の高さ（300px）でも収まらない小さい窓で最低の高さを優先している
const fitOrMin = c => c.fits || (Math.abs(c.h - MIN_CHART_H) <= 1 && c.available - (c.blockH - c.h) < MIN_CHART_H + 8);

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
      // 文字の横の位置は、描くときの座標変換（縦軸の目盛りは移動して描く）を含めて測る（画面の倍率で割る）
      ctx.fillText = function (t, x, y, ...rest) { const m = ctx.getTransform(); const dpr = ch.currentDevicePixelRatio || 1; texts.push({ t: String(t), y, base: ctx.textBaseline, cx: (m.a * x + m.c * y + m.e) / dpr }); return orig.call(this, t, x, y, ...rest); };
      try { ch.draw(); } finally { ctx.fillText = orig; }
      // 縦軸の目盛り（「0人」「0.5人」など。描画部分の外の左右に描く）は棒の上の文字ではないので除く
      const labelTops = texts.filter(t => /^計[\d.]+$|^[\d.]+人$/.test(t.t) && t.cx >= a.left - 1 && t.cx <= a.right + 1).map(t => ({ t: t.t, top: t.base === 'bottom' ? t.y - 11 : (t.base === 'middle' ? t.y - 6 : t.y) }));
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
  }).then(async r => ({ ...r, fit: await measureChartFits(page) }));
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
    console.log(`\n========== 窓 ${vp.key}${vp.narrow ? '（狭い窓）' : ''} ==========`);
    const { page, context } = await openPageAt(browser, BASE_URL, vp);
    await setPeriod(page, '2025年11月', '2027年2月');

    // ---- [1] 固定エリア ----
    const hd = await measureHeader(page);
    check(`[1] ${vp.key}：固定エリアの高さが変更前より低い（${BEFORE_FIXED_AREA_PX[vp.key]}px → ${hd.fixedAreaPx}px）`, hd.fixedAreaPx < BEFORE_FIXED_AREA_PX[vp.key], hd);
    if (!vp.narrow) {
      const maxRows = vp.width >= 1280 ? 2 : 4;
      check(`[1] ${vp.key}：タイトルの右に操作の一式が並び、窓の幅に応じて折り返す（${hd.rows.length}段、横1280以上は2段まで）`, hd.rows.length <= maxRows && hd.rows[0].includes('header-title') && hd.rows[0].length >= 2 && !hd.condBtnVisible && hd.controlsVisible, hd.rows);
      check(`[1] ${vp.key}：固定エリアに段の高さ以外の余分な高さが無い（${hd.headerPx}px ≦ 段の高さの合計＋段の間・上下の余白 ${hd.minHeaderPx}px）`, hd.headerPx <= hd.minHeaderPx + 1, hd);
    } else {
      check(`[1] ${vp.key}：狭い窓は、固定エリアがタイトルと「条件」ボタンだけ（操作の一式は閉じている）`, hd.condBtnVisible && !hd.controlsVisible && hd.rows.length === 1 && hd.rows[0].length === 2, hd);
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
    console.log(`  固定エリア：${hd.fixedAreaPx}px、${hd.rows.length}段`);
    // 案4：振替・更新・最終更新の一式
    const CUR = CURRENT_FIXED_AREA_PX[vp.key];
    if (vp.key === '1607x905') check(`[1] ${vp.key}：固定エリアが案4の前（${CUR}px）より低い（${hd.fixedAreaPx}px）`, hd.fixedAreaPx < CUR, hd);
    else check(`[1] ${vp.key}：固定エリアが案4の前（${CUR}px）より高くならない（${hd.fixedAreaPx}px）`, hd.fixedAreaPx <= CUR, hd);
    const ac = await measureActions(page);
    if (!vp.narrow) {
      check(`[1] ${vp.key}：振替・更新・最終更新が、タブの段（勤務実績・予実・設定）の右にある`, ac.parent === 'tabs-actions-slot' && ac.inTabRow, ac);
      check(`[1] ${vp.key}：最終更新の文字は「最終更新: 日時」のまま`, /^最終更新: \S/.test(ac.lastUpdated), ac.lastUpdated);
    } else {
      check(`[1] ${vp.key}：狭い窓は、振替・更新・最終更新が「条件」の中に残る`, ac.parent === 'header-controls', ac);
      await page.click('#header-cond-btn');
      await page.waitForTimeout(200);
      const acOpen = await measureActions(page);
      check(`[1] ${vp.key}：「条件」を開くと、振替・更新・最終更新が見え、はみ出し・重なりが無い`, !!acOpen.act && acOpen.overlaps.length === 0 && acOpen.outside.length === 0 && !acOpen.pageHScroll, acOpen);
      await page.click('#header-cond-btn');
      await page.waitForTimeout(200);
    }
    check(`[1] ${vp.key}：固定エリア（ヘッダー・タブの段）に、はみ出し・重なりが無い`, ac.overlaps.length === 0 && ac.outside.length === 0 && !ac.pageHScroll, ac);

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
        // [4] グラフの全体（見出し・凡例・横軸の見出し）が見える範囲に収まる（小さい窓は最低の高さを優先）
        check(`[4] ${vp.key} ${sc.name}：見出し・凡例・グラフ・横軸の見出しの全体が、固定エリアと上に貼り付く行の下の見える範囲に収まる（最低${MIN_CHART_H}pxでも収まらない窓は最低の高さ）`,
          r.fit.every(fitOrMin) && (!vp.narrow || r.fit.every(c => c.h <= Math.round(vp.height * MOBILE_RATIO) + 1)),
          r.fit.filter(c => !fitOrMin(c)).concat(vp.narrow ? r.fit.filter(c => c.h > Math.round(vp.height * MOBILE_RATIO) + 1) : []));
        r.fit.filter(c => !c.fits && fitOrMin(c)).forEach(c => MIN_PRIORITY.push(`${vp.key} ${sc.name} ${c.id}（全体${c.blockH}px／見える範囲${c.available}px）`));
        // [5] 1か月分の幅の下限・横スクロール
        check(`[5] ${vp.key} ${sc.name}：1か月分の幅が${MONTH_MIN}px以上で、下限の幅で入らないときは横スクロール`,
          r.charts.every(c => c.perMonth >= MONTH_MIN - 0.5 && (!c.needScroll || c.scroll)), r.charts.map(c => [c.id, c.n, +c.perMonth.toFixed(1), c.needScroll, c.scroll]));
        // [6] 見出しと棒の位置（前回のテストと同じ測り方）
        check(`[6] ${vp.key} ${sc.name}：各月の見出しと棒の組の中央の差が1.5px以内、棒が月の枠の外に出ない`,
          r.charts.every(c => c.maxOff <= 1.5 && c.outside === 0), r.charts.map(c => [c.id, +c.maxOff.toFixed(1), c.outside]));
      }
      if (r.fit.length > 1) {
        // [11] グラフが複数並ぶ画面：いちばん上は開いた直後に、2つ目以降はスクロールしたときに収まる
        const f0 = r.fit[0];
        const minCase = c => Math.abs(c.h - MIN_CHART_H) <= 1 && c.available - (c.blockH - c.h) < MIN_CHART_H + 8;
        check(`[11] ${vp.key} ${sc.name}：いちばん上のグラフ（${f0.id}）が、開いた直後の状態で見出しから横軸まで見える範囲に収まる（最低の高さを優先する窓を除く）`,
          f0.first && (f0.fits0 || minCase(f0)), f0);
        check(`[11] ${vp.key} ${sc.name}：2つ目以降のグラフは、スクロールしたときに収まる（最低の高さを優先する窓を除く）`,
          r.fit.slice(1).every(c => !c.first && (c.fitsScrolled || minCase(c))), r.fit.slice(1).filter(c => !(c.fitsScrolled || minCase(c))));
      }
      if (r.tables.length) {
        check(`[5] ${vp.key} ${sc.name}：表は横スクロール（ページ全体ははみ出さない）`, !r.pageHScroll && r.tables.every(t => t.w <= t.parentW + 1 || t.hscroll), r.tables);
      }
    }

    // ---- [12] 比較（繁忙期見込み）・比較（週間）：説明文の右に切替を並べる ----
    for (const [label, prep] of [
      ['拠点・業務別', "activeMode = 'plancompare2'; planCmpSubtab = 'site'; planCmpSiteTab = '群馬'; renderPlanCompareTab2();"],
      ['拠点サマリ', "activeMode = 'plancompare2'; planCmpSubtab = 'sitesummary'; planCmpSiteTab = '群馬'; renderPlanCompareTab2();"],
      ['3拠点サマリ', "activeMode = 'plancompare2'; planCmpSubtab = 'summary'; renderPlanCompareTab2();"],
      ['表', "activeMode = 'plancompare2'; planCmpSubtab = 'table'; renderPlanCompareTab2();"],
      ['要員計画', "activeMode = 'plancompare2'; planCmpSubtab = 'staffplan'; planCmpSiteTab = '群馬'; renderPlanCompareTab2();"],
      ['比較（週間）', "activeMode = 'plancompareweek'; planCmpSiteTab = '群馬'; renderPlanCompareTab2({ weekly: true });"],
    ]) {
      await page.evaluate(code => { (0, eval)(code); }, prep);
      await page.waitForTimeout(300);
      const ph = await measurePlanCmpHeader(page);
      const name = `[12] ${vp.key} 比較（繁忙期見込み）＞${label}`.replace('比較（繁忙期見込み）＞比較（週間）', '比較（週間）');
      check(`${name}：説明文の文言がそのまま`, ph.descText.includes('ファーム勤務時間 > 標準労働時間') && ph.descText.includes('①実績工数(左棒)＞整理済み_M / 整理済み_増減') && ph.descText.includes('③標準工数(右棒)＞標準工数設定'), ph.descText);
      check(`${name}：切替（${ph.siteTabs ? '拠点・' : ''}${ph.subtabs ? '表示' : ''}）が、説明文と重ならず、はみ出さない。左から拠点の切替、表示の切替の順`, !ph.overlap && !ph.outside && ph.order && !ph.pageHScroll, ph);
      if (!vp.narrow && vp.width >= 1440) {
        check(`${name}：広い窓では、切替が説明文と同じ段の右に右寄せで並ぶ`, ph.sameRow && ph.rightAligned, ph);
      } else {
        check(`${name}：説明文の右に入るときは同じ段の右、入りきらないときは説明文の下に回る（${ph.sameRow ? '同じ段' : '説明文の下'}）`,
          (ph.sameRow && ph.rightAligned) || (ph.below && !ph.fitsOneRow), ph);
      }
      check(`${name}：上に貼り付く行の高さが、${ph.sameRow ? '説明文と切替の高い方' : '説明文＋切替'}＋上下の余白だけ（${Math.round(ph.rowH)}px）`,
        ph.sticky === 'sticky' && ph.rowH <= (ph.sameRow ? Math.max(ph.descH, ph.swH) : ph.descH + ph.swH + ph.rowGap) + ph.pad + 1, ph);
    }

    // ---- [7] 吹き出し：PCはマウス、スマホはタップで出て、画面の外にはみ出さない ----
    await page.evaluate(code => { (0, eval)(code); }, SCREENS.find(s => s.name === '比較（繁忙期見込み）＞拠点サマリ').prep);
    await waitCharts(page);
    const tt = await measureTooltip(page, 'plansitesum2-combined', vp.narrow ? 'mobile' : 'pc');
    check(`[7] ${vp.key}：グラフの吹き出しが${vp.narrow ? 'タップ' : 'マウス'}で出て、画面の中に収まる`, tt.shown && tt.lines > 0 && tt.top >= 0 && tt.left >= 0 && tt.bottom <= tt.vh + 0.5 && tt.right <= tt.vw + 0.5, tt);

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
    }, vp.narrow ? Math.round(vp.height * MOBILE_RATIO) : 400);
    check(`[8] ${vp.key}：「計50」の形（8588h・共通の上限8600h）：上限を上げて、棒と「計50」が上限の中に入る`, k50.yMax > 8600 && k50.barTop >= k50.areaTop && k50.k50Top !== null && k50.k50Top >= k50.areaTop - 1, k50);

    allErrors.push(...page.__errors);
    await context.close();
  }

  // ---- [9] 窓の大きさを途中で変えたとき・固定エリアの段数が変わる幅の前後 ----
  console.log('\n========== [9] 窓の大きさの変更 ==========');
  {
    const { page, context } = await openPageAt(browser, BASE_URL, { width: 1920, height: 1040 });
    await setPeriod(page, '2025年11月', '2027年2月');
    const target = SCREENS.find(s => s.name === '比較（繁忙期見込み）＞要員計画');
    const fitAt = async (w, h) => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(600);
      await waitCharts(page);
      const fit = await measureChartFits(page);
      const hd = await measureHeader(page);
      return { w, h, rows: hd.rows.length, fixedAreaPx: hd.fixedAreaPx, fit };
    };
    await page.evaluate(code => { (0, eval)(code); }, target.prep);
    await waitCharts(page);
    const big1 = await fitAt(1920, 1040);
    const small = await fitAt(1280, 720);
    const big2 = await fitAt(1920, 1040);
    const hOf = r => r.fit.map(c => c.h);
    check('[9] 大きい窓（1920×1040）：全体が見える範囲に収まる', big1.fit.length > 0 && big1.fit.every(fitOrMin), big1);
    check('[9] 大→小（1280×720）に変えると、グラフが低く合わせ直され、全体が収まる', small.fit.every(fitOrMin) && small.fit.every((c, i) => c.h < big1.fit[i].h), { big: hOf(big1), small: hOf(small), fit: small.fit });
    check('[9] 小→大（1920×1040）に戻すと、グラフが高く合わせ直され、元の高さに戻る', big2.fit.every(fitOrMin) && big2.fit.every((c, i) => Math.abs(c.h - big1.fit[i].h) <= 1), { first: hOf(big1), back: hOf(big2) });
    // 固定エリアの段数が変わる幅を探す（幅を狭めながら、段数が増えるところ）
    let prev = null, boundary = null;
    for (let w = 1920; w >= 1000; w -= 20) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(80);
      const rows = (await measureHeader(page)).rows.length;
      if (prev && rows > prev.rows) { boundary = { wide: prev.w, narrow: w }; break; }
      prev = { w, rows };
    }
    check('[9] 固定エリアの段数が変わる幅が見つかる（前提の確認）', !!boundary, boundary);
    if (boundary) {
      const wide = await fitAt(boundary.wide, 900);
      const narrow = await fitAt(boundary.narrow, 900);
      check(`[9] 段数が変わる幅の前後（${boundary.wide}px：${wide.rows}段 → ${boundary.narrow}px：${narrow.rows}段）で、固定エリアが高くなった分グラフが低く合わせ直され、どちらも全体が収まる`,
        narrow.fixedAreaPx > wide.fixedAreaPx && wide.fit.every(fitOrMin) && narrow.fit.every(fitOrMin) && narrow.fit.every((c, i) => c.h < wide.fit[i].h),
        { wide: { rows: wide.rows, fixed: wide.fixedAreaPx, h: hOf(wide) }, narrow: { rows: narrow.rows, fixed: narrow.fixedAreaPx, h: hOf(narrow) } });
      const wideBack = await fitAt(boundary.wide, 900);
      check('[9] 段数が戻る幅に広げると、グラフも元の高さに合わせ直される', wideBack.rows === wide.rows && wideBack.fit.every((c, i) => Math.abs(c.h - wide.fit[i].h) <= 1), { wide: hOf(wide), back: hOf(wideBack) });
    }
    allErrors.push(...page.__errors);
    await context.close();
  }

  // ---- [10] 案4：窓の幅を変えたときの振替・更新・最終更新の置き場所と、はみ出し・重なり ----
  console.log('\n========== [10] 振替・更新・最終更新の置き場所 ==========');
  {
    const { page, context } = await openPageAt(browser, BASE_URL, { width: 1920, height: 900 });
    await setPeriod(page, '2025年11月', '2027年2月');
    const bad = [], places = [];
    // 狭めながら（1920→390）60px おき＋狭い窓との境目の前後、広げながら（390→1920）は主な幅で確かめる
    const widths = []; for (let w = 1920; w >= 780; w -= 60) widths.push(w); widths.push(770, 768, 767, 600, 390);
    const backWidths = [600, 767, 768, 800, 1100, 1280, 1440, 1607, 1920];
    for (const w of [...widths, ...backWidths]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(60);
      const ac = await measureActions(page);
      places.push(`${w}:${ac.parent === 'tabs-actions-slot' ? 'タブ' : 'ヘッダー'}`);
      const okPlace = w <= 767 ? ac.parent === 'header-controls' : true;
      if (!okPlace || ac.overlaps.length || ac.outside.length || ac.pageHScroll || (ac.parent === 'tabs-actions-slot' && !ac.inTabRow)) bad.push({ w, ac });
    }
    check('[10] 窓の幅を 1920→390→1920 と変えても、固定エリアにはみ出し・重なりが無く、狭い窓では「条件」の中に戻る', bad.length === 0, bad.slice(0, 3));
    console.log('  置き場所：' + places.slice(0, widths.length).join(' '));
    // タブの段の右に入りきらないとき（タブのボタンを広げて再現）は、ヘッダーの中（チェックの右）に戻り、崩れない
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.waitForTimeout(200);
    const before = await measureHeader(page);
    await page.addStyleTag({ content: '#tabs-group .group-btn { padding-left: 140px !important; padding-right: 140px !important; }' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(400);
    const fb = await measureActions(page);
    const fbHd = await measureHeader(page);
    check('[10] タブの段の右に入りきらないときは、ヘッダーの中（チェックの右）に戻り、はみ出し・重なりが無い', fb.parent === 'header-controls' && !!fb.act && fb.overlaps.length === 0 && fb.outside.length === 0, { fb, rows: fbHd.rows });
    check('[10] ヘッダーの中に戻したときも、固定エリアに余分な高さが無い', fbHd.headerPx <= fbHd.minHeaderPx + 1, fbHd);
    await page.evaluate(() => { document.querySelectorAll('style').forEach(st => { if (st.textContent.includes('padding-left: 140px')) st.remove(); }); window.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(400);
    const back = await measureActions(page);
    const backHd = await measureHeader(page);
    check('[10] 入るようになると、タブの段の右に戻り、固定エリアの高さも元に戻る', back.parent === 'tabs-actions-slot' && back.inTabRow && backHd.fixedAreaPx === before.fixedAreaPx, { back, before: before.fixedAreaPx, after: backHd.fixedAreaPx });
    // 置き場所が変わって固定エリアの高さが変わると、グラフの高さが合わせ直される（1607：タブの段へ移すと1段になる）
    const target = SCREENS.find(sc => sc.name === '比較（繁忙期見込み）＞要員計画');
    await page.setViewportSize({ width: 1607, height: 905 });
    await page.evaluate(code => { (0, eval)(code); }, target.prep);
    await page.waitForTimeout(400);
    await waitCharts(page);
    const inTabs = { hd: await measureHeader(page), fit: await measureChartFits(page) };
    await page.addStyleTag({ content: '#tabs-group .group-btn { padding-left: 260px !important; padding-right: 260px !important; }' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(600);
    await waitCharts(page);
    const inHeader = { ac: await measureActions(page), hd: await measureHeader(page), fit: await measureChartFits(page) };
    check(`[10] 1607×905 で一式をヘッダーに戻すと固定エリアが高くなり（${inTabs.hd.fixedAreaPx}px → ${inHeader.hd.fixedAreaPx}px）、グラフが低く合わせ直されて全体が収まる`,
      inHeader.ac.parent === 'header-controls' && inHeader.hd.fixedAreaPx > inTabs.hd.fixedAreaPx && inTabs.fit.length > 0 && inTabs.fit.every(fitOrMin) && inHeader.fit.every(fitOrMin) && inHeader.fit.every((c, i) => c.h < inTabs.fit[i].h),
      { tabs: inTabs.fit.map(c => c.h), header: inHeader.fit.map(c => c.h) });
    allErrors.push(...page.__errors);
    await context.close();
  }

  // ---- [13] 勤務実績＞生産性：最新月の生産性の表 ----
  console.log('\n========== [13] 生産性の表 ==========');
  {
    // 3拠点の表にするため、この場面だけ整理済み_Mの人たちを3拠点に置き、生産実績も3拠点分にする
    const { page, context } = await openPageAt(browser, BASE_URL, { width: 1920, height: 1040 }, { mSites: ['群馬', 'いなべ', '南丹'] });
    await setPeriod(page, '2025年11月', '2027年2月');
    const target = SCREENS.find(sc => sc.name === '勤務実績＞生産性');
    await page.evaluate(prod => { productionDataPromise = Promise.resolve(prod); }, PROD_FAKE_3SITES);
    await page.evaluate(code => { (0, eval)(code); }, target.prep);
    await page.waitForFunction(() => !!document.querySelector('#main .prod-panel') && !!document.getElementById('prd-0') && window.Chart && Chart.getChart(document.getElementById('prd-0')), null, { timeout: 30000 });
    await waitCharts(page);
    const minCase = c => Math.abs(c.h - MIN_CHART_H) <= 1 && c.available - (c.blockH - c.h) < MIN_CHART_H + 8;
    let firstH = null;
    for (const [w, h] of [[1920, 1040], [1607, 905], [1280, 720], [1100, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(600);
      await waitCharts(page);
      const k = await measureProdKpi(page);
      const fit = await measureChartFits(page);
      const key = `${w}x${h}`;
      if (!k) { check(`[13] ${key}：生産性の表がある`, false, null); continue; }
      console.log(`  表の高さ：${k.h.toFixed(1)}px（変更前の枠1段 ${BEFORE_KPI_ROW_PX}px）、行の高さ ${k.rowHs.join('/')}`);
      check(`[13] ${key}：表が3行×3列（左に指標の名前、上に拠点の名前）`, k.bodyRows === 3 && k.cols.length === 4 && k.cols.every(c => c === 4) && k.colHeads.join('|') === 'いなべ|群馬|南丹', k);
      check(`[13] ${key}：指標の名前が①②③のグラフの見出しと同じで、単位（kg/h・点/h）が付く`,
        k.rowHeads.length === 3 && k.rowHeads.every((rh, i) => rh === `${k.chartTitles[i]}（${['kg/h', 'kg/h', '点/h'][i]}）`), { rowHeads: k.rowHeads, chartTitles: k.chartTitles });
      check(`[13] ${key}：拠点の名前の色が、今までの枠と同じ拠点の色`, k.colColors.every((c, i) => k.siteColors[i] && c.toLowerCase() === k.siteColors[i].toLowerCase()), k);
      check(`[13] ${key}：9つの数字（小数の桁・単位も）が変更前の枠と同じ`, k.values.join('|') === BEFORE_KPI_VALUES.join('|'), { got: k.values, before: BEFORE_KPI_VALUES });
      check(`[13] ${key}：「最新月」の表示が今までどおり`, /^📈 生産性 ／ 最新月: \d{4}年\d{1,2}月/.test(k.label), k.label);
      check(`[13] ${key}：表の高さ（${k.h.toFixed(1)}px）が変更前の枠1段（${BEFORE_KPI_ROW_PX}px）より高くない`, k.h <= BEFORE_KPI_ROW_PX + 0.5, k);
      if (firstH === null) firstH = k.h;
      check(`[13] ${key}：窓の幅を変えても表の行が増えず、高さが変わらない（${firstH.toFixed(1)}px → ${k.h.toFixed(1)}px）`, k.cols.length === 4 && Math.abs(k.h - firstH) <= 0.5 && Math.max(...k.rowHs) - Math.min(...k.rowHs) <= 4, k.rowHs);
      check(`[13] ${key}：表は左寄せで横いっぱいに広げず、入らないときだけ表の中で横スクロール（ページははみ出さない）`, k.leftAligned && k.notFull && (!k.tableOverflow || k.wrapScrolls) && !k.pageHScroll, k);
      const f0 = fit[0];
      check(`[13] ${key}：いちばん上のグラフ（${f0 && f0.id}）が、開いた直後の状態で見出しから横軸まで収まる（最低の高さを優先する窓を除く）`, !!f0 && f0.first && (f0.fits0 || minCase(f0)), f0);
    }
    // 表の高さが変わったら、下のグラフの高さが合わせ直される（表の行を一時的に高くして確かめる）
    await page.setViewportSize({ width: 1607, height: 905 });
    await page.waitForTimeout(600);
    await waitCharts(page);
    const before = await measureChartFits(page);
    await page.addStyleTag({ content: '.prod-kpi-table td { padding-top: 15px !important; }' });
    await page.waitForTimeout(600);
    await waitCharts(page);
    const taller = await measureProdKpi(page);
    const after = await measureChartFits(page);
    check(`[13] 1607x905：表が高くなると（${taller.h.toFixed(1)}px）、いちばん上のグラフが低く合わせ直され（${before[0].h}px → ${after[0].h}px）、開いた直後に収まる`,
      after[0].h < before[0].h && after[0].fits0, { before: before[0], after: after[0] });
    allErrors.push(...page.__errors);
    await context.close();
  }

  console.log('\n最低の高さ（300px）を優先したグラフ：' + (MIN_PRIORITY.length ? '\n  ' + MIN_PRIORITY.join('\n  ') : 'なし'));
  check('ページのエラーなし（すべての窓の大きさで）', allErrors.length === 0, allErrors);
  console.log(`\nOK: ${okCount} / NG: ${ngCount}`);
  console.log(ngCount ? 'NGあり' : 'すべてOK');
  console.log('DONE');
  await browser.close();
  server.close();
  process.exit(ngCount ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
