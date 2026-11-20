// dashboard/work-hours.html の、月を横に並べる表・グラフの見た目（左詰め・1か月分の幅・見出しと棒の位置）の検証。
// 1か月分の幅の基準は「画面の幅に14か月がちょうど入る幅」（MONTH_COLUMN_TARGET＝14）。
//  (1) 期間 3か月（2026/8〜2026/10）：対象の全画面で、表の列・グラフの1か月分の幅が「14か月表示のときの幅」
//      以下で、左詰め（表・グラフの描画部分の右側が空いている）。横スクロールは出ない
//  (2) 期間 14か月（2025/9〜2026/10）：横スクロールが出ず、14か月が1画面に入る（グラフは右に足す幅が0。表は画面に
//      収まれば自動の幅のまま、収まらなければ月の列を狭めて収める）
//  (2b) 期間 12か月（2025/11〜2026/10）：左詰めで、1か月分の幅が14か月のときと同じ
//  (3) 期間 17か月（2025/6〜2026/10）：横スクロールが出て、1か月分の幅が14か月のときと同じ
//  (4) 勤務実績で、期間の外の空の枠（月名だけ・月名も無い）や空の列が出ない
//  (5) 期間 3・12・14・17か月の全グラフで、各月の見出しの位置とその月の棒（棒の組）の中央がそろい、
//      値のある棒がその月の枠の外（いちばん右の月なら見出しの右）にはみ出さない
// 対象：勤務実績＞拠点（群馬）・サマリー（業務区分別（表）・業務区分別（グラフ）・標準労働時間）・生産性・比較（拠点別）・
//       比較（3拠点）＞時間・生産実績、
//       予実＞生産計画・予定標準工数(h)・比較（繁忙期見込み）（拠点・業務別／拠点サマリ／3拠点サマリ／表／要員計画）
//
// モックは verify_period_from_to.js と同じ形（実際のシートと同じ形の gviz。生産実績だけは組み立て済みの形を
// 読み込みのキャッシュに入れる）。実績・計画の月だけ 2025/6 からに広げている。画面の幅は 1600×1000 で測る。
// グラフの動き（アニメーション）が終わってから測る（時計は止めない）。

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

async function openPage(browser, baseUrl, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.__errors = [];
  page.on('pageerror', e => { page.__errors.push(e.message); console.log('  [pageerror]', e.message); });
  // 時計は止めずに進める（install）：Chart.js のグラフの動き（アニメーション）は Date.now() で進むため、
  // setFixedTime で止めると動きが終わらず、棒の位置を正しく測れない
  if (opts.now) await page.clock.install({ time: opts.now });
  if (opts.session) {
    await page.addInitScript(s => { try { sessionStorage.setItem('shiitake_wh_session_state', s); } catch (e) {} }, JSON.stringify(opts.session));
  }
  await setupRoutes(page);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => (document.getElementById('last-updated')?.textContent || '').includes('最終更新'), null, { timeout: 30000 });
  return page;
}

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

async function measure(page, screen) {
  await page.evaluate(code => { (0, eval)(code); }, screen.prep);
  if (screen.wait === 'table') {
    await page.waitForFunction(() => {
      const t = document.querySelector('#main table'); return t && t.dataset.monthFit;
    }, null, { timeout: 30000 });
  } else {
    await page.waitForFunction(id => { const el = document.getElementById(id); return el && window.Chart && Chart.getChart(el); }, screen.wait, { timeout: 30000 });
  }
  // 1か月分の幅をそろえる処理（グラフの描き直し・表の幅合わせ）が終わり、グラフの動き（アニメーション）が止まるのを待つ
  await page.waitForTimeout(300);
  await page.waitForFunction(() => [...document.querySelectorAll('#main canvas')].every(c => {
    const ch = window.Chart && Chart.getChart(c);
    if (!ch) return true;
    return ch.data.datasets.every((d, di) => (ch.getDatasetMeta(di).data || []).every(el => !Object.values(el.$animations || {}).some(a => a && a._active)));
  }), null, { timeout: 30000 });
  await page.waitForTimeout(100);
  return page.evaluate(() => {
    const MONTH_RE = /^\d{4}年\d{1,2}月$|^\d{4}\/\d{1,2}(\s|$)/;
    const scroller = el => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    const charts = [...document.querySelectorAll('#main canvas')].map(c => {
      const ch = window.Chart && Chart.getChart(c);
      if (!ch || !ch.chartArea || !c.offsetWidth) return null; // 隠れているグラフ（別の表示モード）は測らない
      const labels = (ch.data.labels || []).map(String);
      if (!labels.length || !labels.every(l => MONTH_RE.test(l))) return null;
      const a = ch.chartArea;
      const slot = (a.right - a.left) / labels.length;
      // 見出しと棒の位置：月ごとに、見出しの位置（横軸の目盛り）と、その月の棒の組（値の無い棒の場所も含む）の
      // 中央との差。値のある棒が、その月の枠（見出しの位置±1か月分の幅の半分）の外に出ていないか
      const xs = ch.scales.x;
      let maxOff = 0, outside = 0, bars = 0;
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
        bars++;
        const lo = Math.min(...els.map(e => e.lo)), hi = Math.max(...els.map(e => e.hi));
        maxOff = Math.max(maxOff, Math.abs((lo + hi) / 2 - tick));
        if (els.some(e => e.has && (e.lo < tick - slot / 2 - 0.5 || e.hi > tick + slot / 2 + 0.5))) outside++;
      });
      const lastTick = xs.getPixelForValue(labels.length - 1);
      return { id: c.id, n: labels.length, labels, perMonth: slot, canvasW: c.getBoundingClientRect().width,
        areaRight: a.right, spacer: ch.scales.monthSlotSpacer ? ch.scales.monthSlotSpacer.width : 0, scroll: scroller(c), legendH: ch.legend ? ch.legend.height : 0,
        align: { bars, maxOff, outside, lastIn: lastTick > a.left && lastTick < a.right } };
    }).filter(Boolean);
    const tables = [...document.querySelectorAll('#main table')].map(t => {
      const r = t.querySelector('thead tr') || t.querySelector('tr');
      const cells = r ? [...r.children] : [];
      const mc = cells.filter(c => MONTH_RE.test(c.innerText.replace(/\s+/g, ' ').trim()));
      if (!mc.length) return null;
      const tw = t.getBoundingClientRect().width, pw = t.parentElement.clientWidth;
      return { months: mc.length, emptyHeads: cells.filter(c => c.innerText.trim() === '').length,
        monthW: mc.map(c => c.getBoundingClientRect().width), tableW: tw, parentW: pw, fit: t.dataset.monthFit, scroll: scroller(t) };
    }).filter(Boolean);
    return { charts, tables };
  });
}

const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const maxOf = a => Math.max(...a);

(async () => {
  const html = fs.readFileSync(HTML_PATH);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(r => server.listen(0, r));
  const BASE_URL = `http://localhost:${server.address().port}/work-hours.html`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await openPage(browser, BASE_URL, { now: new Date('2026-11-20T10:00:00+09:00') });

  const runAll = async (start, end) => {
    await setPeriod(page, start, end);
    const out = {};
    for (const sc of SCREENS) out[sc.name] = await measure(page, sc);
    return out;
  };
  const PERIODS = {
    14: ['2025年9月', '2026年10月'],
    3: ['2026年8月', '2026年10月'],
    12: ['2025年11月', '2026年10月'],
    17: ['2025年6月', '2026年10月'],
  };
  const R = {};
  for (const p of [14, 3, 12, 17]) R[p] = await runAll(...PERIODS[p]);
  const r14 = R[14], r3 = R[3], r12 = R[12], r17 = R[17];
  const baseChart = (sc, c) => r14[sc.name].charts.find(x => x.id === c.id);

  console.log('\n[1] 期間 3か月（2026/8〜2026/10）：1か月分の幅が14か月のとき以下で、左詰め');
  for (const sc of SCREENS) {
    const a = r3[sc.name], b = r14[sc.name];
    if (a.charts.length) {
      const ok = a.charts.every(c => {
        const base = baseChart(sc, c);
        return base && c.n === 3 && c.perMonth <= base.perMonth + 0.5 && c.perMonth >= base.perMonth - 2
          && c.areaRight < c.canvasW * 0.5 && !c.scroll && Math.abs(c.legendH - base.legendH) < 1;
      });
      check(`${sc.name}：グラフの1か月分の幅は14か月のときと同じ（以下）、描画部分は左半分に収まり右が空く、凡例の高さも同じ`, ok,
        a.charts.map(c => { const base = baseChart(sc, c); return [c.id, c.n, +c.perMonth.toFixed(1), base && +base.perMonth.toFixed(1), Math.round(c.areaRight), Math.round(c.canvasW), c.legendH, base && base.legendH]; }));
    }
    if (a.tables.length) {
      const ok = a.tables.every((t, i) => {
        const base = b.tables[i];
        return base && t.months === 3 && maxOf(t.monthW) <= maxOf(base.monthW) + 1 && t.tableW < t.parentW - 50 && !t.scroll && t.fit === 'fitted';
      });
      check(`${sc.name}：表の月の列の幅は14か月のとき以下、表は左詰めで右が空く`, ok,
        a.tables.map((t, i) => [t.months, t.monthW.map(Math.round), b.tables[i] && maxOf(b.tables[i].monthW).toFixed(0), Math.round(t.tableW), t.parentW, t.fit]));
    }
  }

  console.log('\n[2] 期間 14か月（2025/9〜2026/10）：横スクロールが出ず、14か月が1画面に入る');
  for (const sc of SCREENS) {
    const a = r14[sc.name];
    if (a.charts.length) check(`${sc.name}：グラフは14本で、右に足す幅は0、横スクロールなし`, a.charts.every(c => c.n === 14 && c.spacer === 0 && !c.scroll), a.charts.map(c => [c.id, c.n, c.spacer, c.scroll]));
    if (a.tables.length) check(`${sc.name}：表は14列で、横スクロールなし（画面に収まる表は自動の幅のまま、収まらない表は月の列を狭めて収める）`, a.tables.every(t => t.months === 14 && (t.fit === 'same' || t.fit === 'fitted') && !t.scroll && t.tableW <= t.parentW + 1), a.tables.map(t => [t.months, t.fit, t.scroll, Math.round(t.tableW), t.parentW]));
  }

  console.log('\n[2b] 期間 12か月（2025/11〜2026/10）：左詰めで、1か月分の幅が14か月のときと同じ');
  for (const sc of SCREENS) {
    const a = r12[sc.name], b = r14[sc.name];
    if (a.charts.length) check(`${sc.name}：グラフは12本・右に幅を足して左詰め・1か月分の幅は14か月のときと同じ・横スクロールなし`,
      a.charts.every(c => { const base = baseChart(sc, c); return base && c.n === 12 && c.spacer > 0 && !c.scroll && c.perMonth <= base.perMonth + 0.5 && c.perMonth >= base.perMonth - 2; }),
      a.charts.map(c => { const base = baseChart(sc, c); return [c.id, c.n, c.spacer, +c.perMonth.toFixed(1), base && +base.perMonth.toFixed(1), c.scroll]; }));
    if (a.tables.length) check(`${sc.name}：表は12列・左詰め・月の列の幅は14か月のときの平均と同じ`,
      a.tables.every((t, i) => { const base = b.tables[i]; return base && t.months === 12 && t.fit === 'fitted' && !t.scroll && Math.abs(avg(t.monthW) - avg(base.monthW)) <= 1.5; }),
      a.tables.map((t, i) => [t.months, t.fit, avg(t.monthW).toFixed(1), b.tables[i] && avg(b.tables[i].monthW).toFixed(1)]));
  }

  console.log('\n[3] 期間 17か月（2025/6〜2026/10）：横スクロールが出て、1か月分の幅が14か月のときと同じ');
  for (const sc of SCREENS) {
    const a = r17[sc.name], b = r14[sc.name];
    if (a.charts.length) {
      const ok = a.charts.every(c => {
        const base = baseChart(sc, c);
        return base && c.n === 17 && Math.abs(c.perMonth - base.perMonth) <= 1.5 && c.scroll;
      });
      check(`${sc.name}：グラフは17本・横スクロールあり・1か月分の幅は14か月のときと同じ`, ok,
        a.charts.map(c => { const base = baseChart(sc, c); return [c.id, c.n, +c.perMonth.toFixed(1), base && +base.perMonth.toFixed(1), c.scroll]; }));
    }
    if (a.tables.length) {
      const ok = a.tables.every((t, i) => {
        const base = b.tables[i];
        return base && t.months === 17 && Math.abs(avg(t.monthW) - avg(base.monthW)) <= 1.5 && t.scroll && t.fit === 'fitted';
      });
      check(`${sc.name}：表は17列・横スクロールあり・月の列の幅は14か月のときの平均と同じ`, ok,
        a.tables.map((t, i) => [t.months, avg(t.monthW).toFixed(1), b.tables[i] && avg(b.tables[i].monthW).toFixed(1), t.scroll, t.fit]));
    }
  }

  console.log('\n[4] 勤務実績：期間の外の空の枠・空の列が出ない');
  for (const sc of SCREENS.filter(x => !/^(予実|比較（繁忙期)/.test(x.name))) {
    const a = r3[sc.name];
    const okC = a.charts.every(c => c.n === 3 && c.labels.every(l => /^2026年(8|9|10)月$/.test(l)));
    const okT = a.tables.every(t => t.months === 3 && t.emptyHeads === 0);
    check(`${sc.name}：横軸・列は 2026年8月〜10月の3つだけ（空の枠・空の列なし）`, okC && okT, [a.charts.map(c => c.labels), a.tables.map(t => [t.months, t.emptyHeads])]);
  }

  console.log('\n[5] 全グラフ：各月の見出しの位置と、その月の棒（棒の組）の位置がそろい、いちばん右の月の棒が見出しの外にはみ出さない');
  for (const p of [3, 12, 14, 17]) {
    for (const sc of SCREENS) {
      const cs = R[p][sc.name].charts.filter(c => c.align.bars > 0);
      if (!cs.length) continue;
      check(`期間${p}か月 ${sc.name}：棒の組の中央と見出しの位置の差が1.5px以内`, cs.every(c => c.align.maxOff <= 1.5),
        cs.map(c => [c.id, +c.align.maxOff.toFixed(1)]));
      check(`期間${p}か月 ${sc.name}：値のある棒はその月の枠の中、いちばん右の月の見出しも描画部分の中`, cs.every(c => c.align.outside === 0 && c.align.lastIn),
        cs.map(c => [c.id, c.align.outside, c.align.lastIn]));
    }
  }

  check('ページのエラーなし', page.__errors.length === 0, page.__errors);
  console.log(`\nOK: ${okCount} / NG: ${ngCount}`);
  console.log(ngCount ? 'NGあり' : 'すべてOK');
  console.log('DONE');
  await browser.close();
  server.close();
  process.exit(ngCount ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
