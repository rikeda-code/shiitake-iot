// dashboard/work-hours.html の集計期間（開始月〜終了月）の検証。
//  (1) 開始月・終了月の選択肢＝整理済み_Mの実績の月＋整理済み_計画_更新の計画の月。
//      終了月が開始月より前にならない（開始月を変えたら終了月を、終了月を変えたら開始月をそろえる）
//  (2) 初めて開いたときの期間：開始月＝今日の年の前年の10月（選択肢に無ければいちばん古い月）、
//      終了月＝整理済み_計画_更新の最後の月。古い「表示月数」の保存値があってもエラーにならない
//  (3) 期間 2026/4〜2026/6：予実（生産計画・予定標準工数(h)・比較（繁忙期見込み）の5サブタブ）の
//      横軸・列が4〜6月だけ。期間の外（2026/8・2026/10）に振替の増減が出ない。
//      「表示月」の選択が無い
//  (4) 期間 2026/4〜2026/6：サマリーの標準工数・収穫量・出荷量（業務区分別／雇用形態別（グラフ））、
//      前年実績・振替の増減（標準労働時間）が、期間の外の枠に出ない
//  (5) 期間 2026/10〜2027/2：予実で 2026/10 は実績、2026/11〜2027/2 は計画・予想が出る
//
// 実際のシートと同じ形のモックを使う：
//  - 整理済み_M（gviz、headers=3）：A〜I列と「M/10締 YYYY/MM 総勤務時間」「有給取得時間」
//    「実質勤務時間」の3列×月（時間は日時セル）。実績の月は 2025/8〜2026/10
//  - 整理済み_計画_更新（gviz、gid=530402103、headers=1）：A=拠点、B=カテゴリ、C=指標、
//    D列以降の見出しが "2025/10"〜"2027/2"
//  - 標準労働時間（gviz、gid=1404355975、headers=1）：R1「標準労働時間」、T1〜の月見出し、
//    2・3行目は見出し行、4行目からデータ
//  - 整理済み_増減（gviz、headers=3）：A〜J列、データは4行目から（計上年月は日付セル、増減時間は日時セル）
//  - 時間_過去実績（gviz、headers=0）：拠点名の行がそのまま年月の見出し（"2025.01" の形）を兼ね、
//    その下に「収穫作業時間」「出荷作業時間」の行
//  - 生産実績（勤務実績＞生産実績と同じ {months, records} の形）は、複数のシート（菌床数集計・
//    収穫管理表・販売抽出シートなど）を組み合わせて作るため、組み立て済みの形をページの
//    読み込みのキャッシュ（productionDataPromise）に直接入れる（組み立て自体は
//    verify_remove_prod_sheet.js で確認している）
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
const M_MONTHS = monthsBetween('2025/8', '2026/10');     // 整理済み_Mの実績の月
const PLAN_MONTHS = monthsBetween('2025/10', '2027/2');  // 整理済み_計画_更新の計画の月
const MERGE_MONTHS = monthsBetween('2026/7', '2027/2');  // 標準労働時間シートの増減の月列
const ALL_OPTION_LABELS = monthsBetween('2025/8', '2027/2').map(m => { const [y, mo] = m.split('/'); return `${y}年${+mo}月`; });

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
  if (opts.now) await page.clock.setFixedTime(opts.now);
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

// 予実＞比較（繁忙期見込み）のサブタブを描画して、グラフの横軸・データ、表の見出しを読む
async function readPlanCompare(page, subtab, canvasId) {
  await page.evaluate(sub => { activeMode = 'plancompare2'; planCmpSubtab = sub; planCmpSiteTab = '群馬'; renderPlanCompareTab2(); }, subtab);
  if (canvasId) {
    await page.waitForFunction(id => { const el = document.getElementById(id); return el && window.Chart && Chart.getChart(el); }, canvasId, { timeout: 30000 });
  } else {
    await page.waitForFunction(() => document.querySelector('#compare2-content table'), null, { timeout: 30000 });
  }
  return page.evaluate(id => {
    const ch = id ? Chart.getChart(document.getElementById(id)) : null;
    const ymOf = s => { const m = String(s).match(/^(\d{4})\/(\d{1,2})$/); return m ? m[0] : null; };
    return {
      labels: ch ? ch.data.labels.map(String) : null,
      datasets: ch ? ch.data.datasets.map(d => ({ label: d.label, data: d.data.map(v => (v && typeof v === 'object') ? v.y : v) })) : null,
      tableMonths: [...document.querySelectorAll('#compare2-content table')].map(t => [...(t.querySelector('thead tr') || t.querySelector('tr')).children].map(c => ymOf(c.innerText.trim())).filter(Boolean)),
      hasMonthDropdown: !!document.getElementById('plancmp2-dd-btn'),
      text: document.getElementById('main').innerText,
    };
  }, canvasId);
}

async function readTableMonths(page, render) {
  await page.evaluate(r => { window[r](); }, render);
  await page.waitForFunction(() => document.querySelector('#main table'), null, { timeout: 30000 });
  return page.evaluate(() => [...document.querySelectorAll('#main table')].map(t =>
    [...(t.querySelector('thead tr') || t.querySelector('tr')).children].map(c => c.innerText.replace(/\s+/g, ' ').trim()).filter(x => /^\d{4}\/\d{1,2}/.test(x))));
}

async function readSummaryChart(page, subtab, canvasId, prep) {
  await page.evaluate(([sub, p]) => {
    // stdHoursMetric・stdHoursSubtab はページ側の let 変数のため、名前で直接代入する
    if (p) { stdHoursMetric = p.stdHoursMetric; stdHoursSubtab = p.stdHoursSubtab; }
    activeMode = 'summary'; renderSummary(); switchToSummarySubtab(sub);
  }, [subtab, prep || null]);
  await page.waitForFunction(id => { const el = document.getElementById(id); return el && window.Chart && Chart.getChart(el); }, canvasId, { timeout: 30000 });
  return page.evaluate(id => {
    const ch = Chart.getChart(document.getElementById(id));
    return { labels: ch.data.labels.map(String), datasets: ch.data.datasets.map(d => ({ label: d.label, data: d.data.slice() })) };
  }, canvasId);
}

(async () => {
  const html = fs.readFileSync(HTML_PATH);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(r => server.listen(0, r));
  const BASE_URL = `http://localhost:${server.address().port}/work-hours.html`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const allErrors = [];

  console.log('\n[1] 選択肢と、終了月が開始月より前にならないこと');
  const page = await openPage(browser, BASE_URL, { now: new Date('2026-11-20T10:00:00+09:00') });
  const opts = await page.evaluate(() => ({
    start: [...document.getElementById('period-start-select').options].map(o => o.value),
    end: [...document.getElementById('period-end-select').options].map(o => o.value),
    hasCount: !!document.getElementById('period-count-select'),
  }));
  check('開始月の選択肢＝実績の月（2025/8〜2026/10）＋計画の月（2025/10〜2027/2）＝2025年8月〜2027年2月', same(opts.start, ALL_OPTION_LABELS), opts.start);
  check('終了月の選択肢も同じ', same(opts.end, ALL_OPTION_LABELS), opts.end);
  check('「表示月数」のプルダウンは無い', !opts.hasCount);
  const order = await page.evaluate(() => {
    const st = document.getElementById('period-start-select'), en = document.getElementById('period-end-select');
    st.value = '2026年4月'; en.value = '2026年6月'; onPeriodFilterChange('end');
    st.value = '2026年12月'; onPeriodFilterChange('start');
    const a = [periodStartMonth, periodEndMonth, st.value, en.value];
    en.value = '2026年2月'; onPeriodFilterChange('end');
    const b = [periodStartMonth, periodEndMonth, st.value, en.value];
    return { a, b };
  });
  check('開始月を終了月より後にしたら、終了月を開始月にそろえる（2026年12月〜2026年12月）', same(order.a, ['2026年12月', '2026年12月', '2026年12月', '2026年12月']), order.a);
  check('終了月を開始月より前にしたら、開始月を終了月にそろえる（2026年2月〜2026年2月）', same(order.b, ['2026年2月', '2026年2月', '2026年2月', '2026年2月']), order.b);

  console.log('\n[2] 初めて開いたときの期間');
  const def1 = await page.evaluate(() => [periodStartMonth, periodEndMonth]);
  // ↑ 期間を変えた後なので、デフォルトは新しいページで読む
  await page.close();
  const readDefault = async (now, session) => {
    const p = await openPage(browser, BASE_URL, { now, session });
    const r = await p.evaluate(() => [periodStartMonth, periodEndMonth, document.getElementById('period-start-select').value, document.getElementById('period-end-select').value]);
    allErrors.push(...p.__errors);
    await p.close();
    return r;
  };
  const d1 = await readDefault(new Date('2026-11-20T10:00:00+09:00'));
  check('今日が 2026/11/20 → 2025年10月〜2027年2月（計画の最後の月）', same(d1, ['2025年10月', '2027年2月', '2025年10月', '2027年2月']), d1);
  const d2 = await readDefault(new Date('2027-01-15T10:00:00+09:00'));
  check('今日が 2027/1/15 → 2026年10月〜2027年2月', same(d2, ['2026年10月', '2027年2月', '2026年10月', '2027年2月']), d2);
  const d3 = await readDefault(new Date('2025-06-01T10:00:00+09:00'));
  check('開始月（2024年10月）が選択肢に無い → いちばん古い月（2025年8月）', same(d3, ['2025年8月', '2027年2月', '2025年8月', '2027年2月']), d3);
  const d4 = await readDefault(new Date('2026-11-20T10:00:00+09:00'), { periodStartMonth: '2026年4月', periodMonthCount: 3 });
  check('古い「表示月数」の保存値があってもエラーにならず、開始月は保存値・終了月はデフォルト', same(d4, ['2026年4月', '2027年2月', '2026年4月', '2027年2月']), d4);
  const d5 = await readDefault(new Date('2026-11-20T10:00:00+09:00'), { periodStartMonth: '2026年4月', periodEndMonth: '2026年6月' });
  check('保存した開始月・終了月はそのまま使う', same(d5, ['2026年4月', '2026年6月', '2026年4月', '2026年6月']), d5);
  void def1;

  const p2 = await openPage(browser, BASE_URL, { now: new Date('2026-11-20T10:00:00+09:00') });

  console.log('\n[3] 期間 2026/4〜2026/6：予実のタブ');
  await setPeriod(p2, '2026年4月', '2026年6月');
  const AMJ = ['2026/4', '2026/5', '2026/6'];
  const planTab = await readTableMonths(p2, 'renderPlanTab');
  check('予実＞生産計画：表の列が 2026/4〜6 だけ', planTab.length > 0 && planTab.every(t => same(t, AMJ)), planTab);
  const planStd = await readTableMonths(p2, 'renderPlanStdHoursTab');
  check('予実＞予定標準工数(h)：表の列が 2026/4〜6 だけ', planStd.length > 0 && planStd.every(t => same(t.map(x => x.split(' ')[0]), AMJ)), planStd);
  const cmpSite = await readPlanCompare(p2, 'site', 'plancmp2-群馬-栽培');
  check('比較（繁忙期見込み）＞拠点・業務別：横軸が 2026/4〜6 だけ', same(cmpSite.labels, AMJ), cmpSite.labels);
  check('比較（繁忙期見込み）＞拠点・業務別：「表示月」の選択が無い', !cmpSite.hasMonthDropdown && !/全月選択中/.test(cmpSite.text));
  check('拠点・業務別：どの系列も3か月分だけ（期間の外の 2026/8・2026/10 の振替の増減は無い）',
    cmpSite.datasets.every(d => d.data.length === 3), cmpSite.datasets.map(d => [d.label, d.data.length]));
  const std46 = cmpSite.datasets.find(d => d.label === '社員+実習生');
  check('拠点・業務別：期間の中の標準労働時間（社員+実習生）は出る', std46 && std46.data.every(v => typeof v === 'number' && v > 0), std46);
  for (const [sub, cid, name] of [['sitesummary', 'plansitesum2-combined', '拠点サマリ'], ['summary', 'plansum2-combined', '3拠点サマリ'], ['staffplan', 'planstaffplan2-combined', '要員計画']]) {
    const r = await readPlanCompare(p2, sub, cid);
    check(`比較（繁忙期見込み）＞${name}：横軸が 2026/4〜6 だけ、どの系列も3か月分`, same(r.labels, AMJ) && r.datasets.every(d => d.data.length === 3), [r.labels, r.datasets.filter(d => d.data.length !== 3).map(d => d.label)]);
  }
  const cmpTable = await readPlanCompare(p2, 'table', null);
  check('比較（繁忙期見込み）＞表：列が 2026/4〜6 だけ', cmpTable.tableMonths.length > 0 && cmpTable.tableMonths.every(t => same(t, AMJ)), cmpTable.tableMonths);

  console.log('\n[4] 期間 2026/4〜2026/6：サマリー（期間の外の枠に値を出さない）');
  const inP = (labels, data) => labels.map((l, i) => ({ l, v: data[i] }));
  const outside = (labels, data) => inP(labels, data).filter(x => !/^2026年[456]月$/.test(x.l) && x.v !== null && x.v !== undefined);
  const inside = (labels, data) => inP(labels, data).filter(x => /^2026年[456]月$/.test(x.l)).map(x => x.v);
  const stdh = await readSummaryChart(p2, 'std-hours', 'stdh_site_0_0', { stdHoursMetric: 'hours', stdHoursSubtab: 'site' });
  const prev = stdh.datasets.find(d => d.label === '前年実績');
  const line = stdh.datasets.find(d => d.label === '標準労働時間');
  check('標準労働時間＞時間＞拠点別：横軸に期間の外の枠（2026年7月〜）がある（見た目は今回変えない）', stdh.labels.includes('2026年7月') && stdh.labels.includes('2026年10月'), stdh.labels);
  check('前年実績：期間の中（4〜6月）は出る', prev && inside(stdh.labels, prev.data).every(v => typeof v === 'number' && v > 0), prev && inside(stdh.labels, prev.data));
  check('前年実績：期間の外（2026年7月〜）は出ない', prev && outside(stdh.labels, prev.data).length === 0, prev && outside(stdh.labels, prev.data));
  check('標準労働時間の線：期間の外（2026年8月・10月の振替の増減）は出ない', line && outside(stdh.labels, line.data).length === 0, line && outside(stdh.labels, line.data));
  check('標準労働時間の線：期間の中は出る', line && inside(stdh.labels, line.data).every(v => typeof v === 'number' && v > 0), line && inside(stdh.labels, line.data));
  const stdhSum = await readSummaryChart(p2, 'std-hours', 'stdh_summary', { stdHoursMetric: 'hours', stdHoursSubtab: 'summary' });
  const prevS = stdhSum.datasets.find(d => d.label === '前年実績');
  const lineS = stdhSum.datasets.find(d => d.label === '標準労働時間');
  check('標準労働時間＞時間＞拠点サマリ：前年実績・振替の増減が期間の外に出ない',
    prevS && lineS && outside(stdhSum.labels, prevS.data).length === 0 && outside(stdhSum.labels, lineS.data).length === 0,
    [prevS && outside(stdhSum.labels, prevS.data), lineS && outside(stdhSum.labels, lineS.data)]);
  check('標準労働時間＞時間＞拠点サマリ：期間の中の前年実績は出る', prevS && inside(stdhSum.labels, prevS.data).every(v => typeof v === 'number' && v > 0), prevS && inside(stdhSum.labels, prevS.data));
  const dev = await readSummaryChart(p2, 'emp-chart-dev', 'ecdev_0_0_h');
  const devStd = dev.datasets.find(d => d.label === '標準工数');
  const devKg = dev.datasets.find(d => d.label === '収穫量(kg)');
  check('業務区分別／雇用形態別（グラフ）栽培：収穫量(kg) は期間の中だけ', devKg && outside(dev.labels, devKg.data).length === 0 && inside(dev.labels, devKg.data).every(v => v === 11000), devKg && inP(dev.labels, devKg.data));
  check('業務区分別／雇用形態別（グラフ）栽培：標準工数は期間の外に出ない', !devStd || outside(dev.labels, devStd.data).length === 0, devStd && outside(dev.labels, devStd.data));
  const dev2 = await readSummaryChart(p2, 'emp-chart-dev', 'ecdev_0_1_h');
  const devKg2 = dev2.datasets.find(d => d.label === '出荷量(kg)');
  check('業務区分別／雇用形態別（グラフ）出荷：出荷量(kg) は期間の中だけ', devKg2 && outside(dev2.labels, devKg2.data).length === 0 && inside(dev2.labels, devKg2.data).every(v => v === 9500), devKg2 && inP(dev2.labels, devKg2.data));

  console.log('\n[5] 期間 2026/10〜2027/2：予実（2026/10 は実績、2026/11〜 は計画・予想）');
  await setPeriod(p2, '2026年10月', '2027年2月');
  const OCT_FEB = ['2026/10', '2026/11', '2026/12', '2027/1', '2027/2'];
  const s2 = await readPlanCompare(p2, 'site', 'plancmp2-群馬-栽培');
  check('拠点・業務別：横軸が 2026/10〜2027/2', same(s2.labels, OCT_FEB), s2.labels);
  const act = s2.datasets.find(d => d.label === '実績工数');
  check('拠点・業務別：実績工数は 2026/10 だけ（振替後 160−20＝140）', act && act.data[0] === 140 && act.data.slice(1).every(v => v === null || v === undefined), act && act.data);
  const lower = s2.datasets.find(d => d.label === '社員+実習生');
  check('拠点・業務別：2026/11〜 は標準労働時間（計画）が出る', lower && lower.data.slice(1).every(v => typeof v === 'number' && v > 0), lower && lower.data);
  const sum2 = await readPlanCompare(p2, 'sitesummary', 'plansitesum2-combined');
  check('拠点サマリ：横軸が 2026/10〜2027/2', same(sum2.labels, OCT_FEB), sum2.labels);
  const ecEmp = await p2.evaluate(() => {
    const ch = Chart.getChart(document.getElementById('plansitesum2-群馬-emp'));
    return ch ? { labels: ch.data.labels.map(String), ds: ch.data.datasets.map(d => ({ label: d.label, data: d.data.slice() })) } : null;
  });
  const shainAct = ecEmp && ecEmp.ds.find(d => d.label === '社員（実績）');
  const shainFc = ecEmp && ecEmp.ds.find(d => d.label === '社員（予想）');
  check('拠点サマリ（雇用形態別）：社員は 2026/10 が実績、2026/11〜 が予想',
    shainAct && shainFc && typeof shainAct.data[0] === 'number' && shainAct.data.slice(1).every(v => v === null)
      && shainFc.data[0] === null && shainFc.data.slice(1).every(v => typeof v === 'number' && v > 0),
    ecEmp && [shainAct, shainFc]);
  const planTab2 = await readTableMonths(p2, 'renderPlanTab');
  check('予実＞生産計画：表の列が 2026/10〜2027/2', planTab2.length > 0 && planTab2.every(t => same(t, OCT_FEB)), planTab2);
  const planStd2 = await readTableMonths(p2, 'renderPlanStdHoursTab');
  check('予実＞予定標準工数(h)：2026/10 は「実績」、2026/11〜 は「計画」',
    planStd2.length > 0 && planStd2.every(t => same(t, ['2026/10 実績', '2026/11 計画', '2026/12 計画', '2027/1 計画', '2027/2 計画'])), planStd2);

  allErrors.push(...p2.__errors);
  check('ページのエラーなし', allErrors.length === 0, allErrors);
  console.log(`\nOK: ${okCount} / NG: ${ngCount}`);
  console.log(ngCount ? 'NGあり' : 'すべてOK');
  console.log('DONE');
  await browser.close();
  server.close();
  process.exit(ngCount ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
