// dashboard/work-hours.html の工数振替（整理済み_増減）の照合を、3拠点以外の人にも広げた件の検証。
//  (1) 整理済み_増減の人は、まず3拠点（いなべ・群馬・南丹）の人から名前で探す。
//      同じ名前が1件も無いときだけ、3拠点以外で拠点の欄が入っている人（志摩・鹿沼・事務など）から探す
//  (2) 3拠点以外から見つかった人は、元の拠点から引かず、PRJ の拠点に「（応援）」として足す。
//      アラートは出ない
//  (3) 同じ名前が3拠点の行と拠点空欄の行にある人（PHAM　QUOC VIET さんの形）は、今までどおり
//      3拠点の行に当たる
//  (4) 拠点空欄の行にしかいない人・どこにもいない人は、今までどおりアラートが出る
//  (5) 「比較（3拠点）＞標準労働時間」タブの照合も同じ順番・同じ決まり。見つからない人には
//      勤務実績タブと同じ文言のアラートが出る
//  (6) 通常の集計（allData.employees）には3拠点以外の人が入らない
//  (7) 探す順番は buildTransferLookup() の1か所で決まり、比較（3拠点）＞時間の●印
//      （computeStdTransferDeltaBuckets）・勤務実績＞サマリー＞標準労働時間
//      （computeStdHoursSiteTransferDeltaBuckets）も同じ順番・同じ扱いになる
//
// 実際のシートと同じ形のモックを使う：
//  - 整理済み_M（gviz、headers=3）：A〜I列（B=フラグ数値、D=拠点、H=名前、I=入退社年月）と、
//    「M/10締 YYYY/MM 総勤務時間」「有給取得時間」「実質勤務時間」の3列×月（時間は
//    "Date(1899,11,30,…)"＋"H:MM"表示の日時セル）。実際のシートの下の方と同じく、拠点の欄が
//    空欄でC〜F列も空欄の行（ベトナム名の一覧）を含む
//  - 整理済み_増減（gviz、headers=3）：A〜J列（B=F、C=雇用区分、D=拠点、E=PRJ、F=部門、
//    G=社員番号、H=名前、I=計上年月の日付セル、J=増減時間の日時セル）。データは4行目から
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHART_JS_VENDORED = fs.readFileSync(path.join(__dirname, 'vendor', 'chart.umd.js'), 'utf8');
const HTML_PATH = path.join(__dirname, '..', '..', 'dashboard', 'work-hours.html');

function ymNum(m) { const [y, mo] = String(m).split('/').map(Number); return y * 100 + mo; }
function monthsBetween(from, to) {
  const out = []; let [y, m] = from.split('/').map(Number);
  while (y * 100 + m <= ymNum(to)) { out.push(`${y}/${m}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const M_MONTHS = monthsBetween('2025/8', '2026/10');
const hm = (h, m) => h + m / 60;

/* ===================== 整理済み_M の人 ===================== */
// base: D列（空欄なら null）。emp/prj/div が null の行は、実際のシートの下の方の一覧と同じ形
const PEOPLE = [
  { flag: 1, emp: '社員', base: 'いなべ', prj: 'いなべ', div: '栽培', no: '240035', name: '濱島 蓮', hours: { '2026/8': 160, '2026/9': 160, '2026/10': 160 } },
  { flag: 8, emp: '技能実習生', base: 'いなべ', prj: 'いなべ', div: '栽培', no: '230130', name: 'PHAM　QUOC VIET', start: '2026/8', hours: { '2026/8': 100 } },
  { flag: 1, emp: '社員', base: '南丹', prj: '南丹', div: '栽培', no: '240084', name: '谷口 一真', hours: { '2026/9': 150, '2026/10': 150 } },
  // 3拠点以外（拠点の欄あり）
  { flag: 1, emp: '技能実習生', base: '志摩', prj: '志摩', div: '栽培', no: '240003', name: 'TRUONG CONG THAI', hours: { '2026/9': hm(138, 55), '2026/10': hm(190, 31) } },
  { flag: 8, emp: '社員', base: '志摩', prj: null, div: null, no: null, name: '西 友広', hours: {} },
  { flag: 8, emp: 'パート', base: '事務', prj: null, div: '事務', no: null, name: '松井 千沙', hours: {} },
  // 拠点の欄が空欄（ベトナム名の一覧）
  { flag: 1, emp: null, base: null, prj: null, div: null, no: '230130', name: 'PHAM　QUOC VIET', start: '2026/9', hours: { '2026/9': 120, '2026/10': 120 } },
  { flag: 1, emp: null, base: null, prj: null, div: null, no: '240104', name: 'NGUYEN　SY TRUONG', hours: { '2026/10': 170 } },
];

/* ===================== 整理済み_増減 の行（データは4行目から） ===================== */
const ADJUST = [
  // 4行目：3拠点の人（同じ名前が拠点空欄の行にもある）→ いなべの行に当たる（今のまま）
  { flag: 8, emp: '技能実習生', base: 'いなべ', prj: 'いなべ', role: '栽培', name: 'PHAM　QUOC VIET', ym: '2026/8', hours: 32 },
  // 5行目：3拠点以外（志摩）→ いなべに「（応援）」として足す
  { flag: 1, emp: '技能実習生', base: '志摩', prj: 'いなべ', role: '栽培', no: '240003', name: 'TRUONG CONG THAI', ym: '2026/10', hours: hm(190, 31) },
  // 6行目：拠点空欄の行にしかいない → アラート
  { flag: 1, emp: '技能実習生', base: '群馬', prj: '群馬', role: '栽培', name: 'NGUYEN　SY TRUONG', ym: '2026/10', hours: 10 },
  // 7行目：3拠点の人の応援（南丹→いなべ）→ 今のまま
  { flag: 1, emp: '社員', base: '南丹', prj: 'いなべ', role: '栽培', name: '谷口 一真', ym: '2026/9', hours: hm(32, 38) },
  // 8行目：どこにもいない → アラート
  { flag: 1, emp: 'パート', base: 'いなべ', prj: 'いなべ', role: '栽培', name: '不明 太郎', ym: '2026/10', hours: 5 },
  // 9行目：整理済み_Mの月の範囲外（2024/4）でどこにもいない → どちらのタブもアラートなし（今のまま）
  { flag: 1, emp: 'パート', base: 'いなべ', prj: 'いなべ', role: '栽培', name: '昔の 人', ym: '2024/4', hours: 5 },
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
function numCell(v) { return v == null ? null : { v, f: String(v) }; }
function textCell(v) { return v == null || v === '' ? null : { v: String(v) }; }

function buildMGviz() {
  const cols = [
    { id: 'A', label: '0：ファイルなし ', type: 'string' },
    { id: 'B', label: '1：在職中、2：入社予定、3：退職/異動予定、8：他所属、9：退職 F', type: 'number' },
    { id: 'C', label: '雇用区分', type: 'string' }, { id: 'D', label: '拠点', type: 'string' },
    { id: 'E', label: 'PRJ', type: 'string' }, { id: 'F', label: '部門', type: 'string' },
    { id: 'G', label: '社員番号', type: 'string' }, { id: 'H', label: '名前', type: 'string' },
    { id: 'I', label: '入退社年月', type: 'date' },
  ];
  M_MONTHS.forEach((m, i) => {
    const [y, mo] = m.split('/').map(Number);
    const closeM = mo === 12 ? 1 : mo + 1;
    cols.push({ id: `T${i}`, label: `${closeM}/10締 ${y}/${String(mo).padStart(2, '0')} 総勤務時間`, type: 'datetime' });
    cols.push({ id: `P${i}`, label: '有給取得時間', type: 'datetime' });
    cols.push({ id: `J${i}`, label: '実質勤務時間', type: 'datetime' });
  });
  const rows = PEOPLE.map(p => {
    const c = [null, numCell(p.flag), textCell(p.emp), textCell(p.base), textCell(p.prj), textCell(p.div),
      textCell(p.no), textCell(p.name), dateCell(p.start)];
    M_MONTHS.forEach(m => {
      const h = p.hours[m];
      c.push(durationCell(h)); c.push(h == null ? null : durationCell(0)); c.push(durationCell(h));
    });
    return { c };
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
      textCell(a.no), textCell(a.name), dateCell(a.ym), durationCell(a.hours)],
  }));
  return gvizText({ cols, rows });
}

async function setupRoutes(page) {
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost')) return route.continue();
    if (url.includes('chart.umd')) return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: CHART_JS_VENDORED });
    if (!url.includes('docs.google.com')) return route.abort();
    const sheet = new URL(url).searchParams.get('sheet');
    if (url.includes('/gviz/tq')) {
      let body = gvizText({ cols: [], rows: [] });
      if (sheet === '整理済み_M') body = buildMGviz();
      else if (sheet === '整理済み_増減') body = buildAdjustGviz();
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
// 画面は時間を0.1h単位に丸めて読む（parseDuration()）ため、190:31 は 190.5 になる
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.06;

const ALERT_NGUYEN = '氏名不一致：整理済み_増減シート6行目「NGUYEN　SY TRUONG」に一致する従業員が整理済み_Mシートで見つかりません';
const ALERT_FUMEI = '氏名不一致：整理済み_増減シート8行目「不明 太郎」に一致する従業員が整理済み_Mシートで見つかりません';

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

  const r = await page.evaluate(() => {
    const ymIdx = ym => allData.monthYms.indexOf(ym);
    const pick = e => e && { name: e.name, base: e.base, workType: e.workType, employment: e.employment, virtual: !!e.isTransferVirtual,
      h202608: e.hours[ymIdx(202608)], h202609: e.hours[ymIdx(202609)], h202610: e.hours[ymIdx(202610)] };
    const tierDelta = computeStdHoursTierTransferDeltaBuckets(stdTransferAdjustRecords, allData.employees);
    const tierCount = computeStdHoursTierTransferCountDeltaBuckets(stdTransferAdjustRecords, allData.employees);
    const timeDelta = computeStdTransferDeltaBuckets(stdTransferAdjustRecords, allData.employees);
    const siteDelta = computeStdHoursSiteTransferDeltaBuckets(stdTransferAdjustRecords, allData.employees);
    // 照合の決まりが1か所（buildTransferLookup）で決まっていること：4か所とも同じ人に当たる
    const lookup = buildTransferLookup(allData.employees, allData.otherSiteEmployees);
    const lookups = stdTransferAdjustRecords.map(rec => {
      const { candidates, fromOtherSite } = lookup(rec);
      return { row: rec.rowNum, found: candidates.map(e => `${e.base}:${e.name}`), fromOtherSite };
    });
    renderTransferAlerts();
    return {
      baseNames: allData.employees.map(e => `${e.base}:${e.name}`),
      otherNames: (allData.otherSiteEmployees || []).map(e => `${e.base}:${e.name}`),
      adjusted: transferAdjusted.employees.map(pick),
      alerts: transferAdjusted.alerts,
      alertBox: (document.getElementById('summary-transfer-alerts') || document.getElementById('transfer-alerts') || {}).innerText || '',
      tierDelta: Array.from(tierDelta.entries()),
      tierCount: Array.from(tierCount.entries()),
      tierAlerts: collectStdHoursTierTransferAlerts(stdTransferAdjustRecords, allData.employees),
      timeDelta: Array.from(timeDelta.entries()),
      siteDelta: Array.from(siteDelta.entries()),
      lookups,
    };
  });
  const adj = name => r.adjusted.find(e => e.name === name);
  const adjAt = (name, base) => r.adjusted.find(e => e.name === name && e.base === base);
  const delta = k => (r.tierDelta.find(([key]) => key === k) || [])[1];
  const count = k => (r.tierCount.find(([key]) => key === k) || [])[1];

  console.log('\n[1] 整理済み_M の読み込み');
  check('通常の集計は3拠点の人だけ（濱島 蓮・PHAM　QUOC VIET（いなべ）・谷口 一真）',
    JSON.stringify(r.baseNames) === JSON.stringify(['いなべ:濱島 蓮', 'いなべ:PHAM　QUOC VIET', '南丹:谷口 一真']), r.baseNames);
  check('3拠点以外は拠点の欄が入っている人だけ（志摩2人・事務1人。拠点空欄の行は入らない）',
    JSON.stringify(r.otherNames) === JSON.stringify(['志摩:TRUONG CONG THAI', '志摩:西 友広', '事務:松井 千沙']), r.otherNames);

  console.log('\n[2] 勤務実績（振替あり）');
  const truong = adj('TRUONG CONG THAI（応援）');
  check('TRUONG CONG THAI がいなべに「（応援）」として足される（2026/10 190:31、栽培・技能実習生）',
    truong && truong.virtual && truong.base === 'いなべ' && truong.workType === '栽培' && truong.employment === '技能実習生' && near(truong.h202610, hm(190, 31)) && truong.h202609 == null, truong);
  check('志摩の人は振替後の一覧にも入らない（元の拠点から引く処理は画面に出ない）',
    !r.adjusted.some(e => e.base === '志摩' || e.name === 'TRUONG CONG THAI'), r.adjusted.map(e => `${e.base}:${e.name}`));
  check('TRUONG CONG THAI のアラートは出ない', !r.alerts.some(a => a.includes('TRUONG CONG THAI')), r.alerts);
  const pham = adjAt('PHAM　QUOC VIET', 'いなべ');
  check('PHAM　QUOC VIET は今までどおりいなべの行に当たる（2026/8 100→68）', pham && !pham.virtual && near(pham.h202608, 68), pham);
  check('PHAM　QUOC VIET に「（応援）」は作られない（拠点＝PRJ）', !adj('PHAM　QUOC VIET（応援）'), r.adjusted.map(e => e.name));
  const taniguchi = adjAt('谷口 一真', '南丹');
  const taniguchiSup = adj('谷口 一真（応援）');
  check('3拠点の人の応援は今のまま（南丹 2026/9 150→117:22、いなべに（応援）32:38）',
    taniguchi && near(taniguchi.h202609, 150 - hm(32, 38)) && taniguchiSup && taniguchiSup.base === 'いなべ' && near(taniguchiSup.h202609, hm(32, 38)), [taniguchi, taniguchiSup]);
  check('拠点空欄の行にしかいない人・どこにもいない人はアラート（2件ちょうど）',
    JSON.stringify(r.alerts) === JSON.stringify([ALERT_NGUYEN, ALERT_FUMEI]), r.alerts);
  check('画面の工数振替アラートが2件', /工数振替アラート（2件）/.test(r.alertBox) && r.alertBox.includes('NGUYEN　SY TRUONG') && !r.alertBox.includes('TRUONG CONG THAI'), r.alertBox);

  console.log('\n[3] 比較（3拠点）＞標準労働時間');
  check('TRUONG CONG THAI：いなべ・栽培・社員+実習生の段に 2026/10 190:31 を足す', near(delta('いなべ|栽培|lower|202610'), hm(190, 31)), r.tierDelta);
  check('TRUONG CONG THAI：人数もいなべに＋1', count('いなべ|栽培|lower|202610') === 1, r.tierCount);
  check('志摩から引く処理は無い（志摩のキーが無い）', !r.tierDelta.some(([k]) => k.startsWith('志摩|')) && !r.tierCount.some(([k]) => k.startsWith('志摩|')), r.tierDelta);
  check('PHAM　QUOC VIET は今までどおりいなべから引く（2026/8 −32）', near(delta('いなべ|栽培|lower|202608'), -32), r.tierDelta);
  check('3拠点の人の応援は今のまま（南丹 −32:38／いなべ ＋32:38）',
    near(delta('南丹|栽培|lower|202609'), -hm(32, 38)) && near(delta('いなべ|栽培|lower|202609'), hm(32, 38)), r.tierDelta);
  check('見つからない2人の分は数字に入らない（群馬のキーなし、キーは4つだけ）',
    !r.tierDelta.some(([k]) => k.startsWith('群馬|')) && r.tierDelta.length === 4, r.tierDelta);
  check('見つからない人に勤務実績タブと同じ文言のアラート（2件ちょうど、範囲外の月の人は出ない）',
    JSON.stringify(r.tierAlerts) === JSON.stringify([ALERT_NGUYEN, ALERT_FUMEI]), r.tierAlerts);

  console.log('\n[4] 照合の決まり（buildTransferLookup、4か所で共通）');
  const lk = row => r.lookups.find(x => x.row === row);
  check('4行目 PHAM　QUOC VIET：3拠点の行（いなべ）だけが候補（拠点空欄の行は候補にならない）',
    JSON.stringify(lk(4)) === JSON.stringify({ row: 4, found: ['いなべ:PHAM　QUOC VIET'], fromOtherSite: false }), lk(4));
  check('5行目 TRUONG CONG THAI：3拠点以外（志摩）から見つかる',
    JSON.stringify(lk(5)) === JSON.stringify({ row: 5, found: ['志摩:TRUONG CONG THAI'], fromOtherSite: true }), lk(5));
  check('6行目 NGUYEN　SY TRUONG（拠点空欄の行だけ）・8行目 不明 太郎：見つからない',
    lk(6).found.length === 0 && lk(8).found.length === 0, [lk(6), lk(8)]);
  check('7行目 谷口 一真：3拠点（南丹）から見つかる',
    JSON.stringify(lk(7)) === JSON.stringify({ row: 7, found: ['南丹:谷口 一真'], fromOtherSite: false }), lk(7));

  for (const [title, entries] of [['[5] 比較（3拠点）＞時間の●印（computeStdTransferDeltaBuckets）', r.timeDelta],
    ['[6] 勤務実績＞サマリー＞標準労働時間（computeStdHoursSiteTransferDeltaBuckets）', r.siteDelta]]) {
    console.log('\n' + title);
    const d = k => (entries.find(([key]) => key === k) || [])[1];
    check('TRUONG CONG THAI：いなべ・栽培 2026/10 に 190:31 を足す', near(d('いなべ|栽培|202610'), hm(190, 31)), entries);
    check('志摩から引く処理は無い（志摩のキーが無い）', !entries.some(([k]) => k.startsWith('志摩|')), entries);
    check('PHAM　QUOC VIET は今までどおりいなべから引く（2026/8 −32）', near(d('いなべ|栽培|202608'), -32), entries);
    check('3拠点の人の応援は今のまま（南丹 −32:38／いなべ ＋32:38）',
      near(d('南丹|栽培|202609'), -hm(32, 38)) && near(d('いなべ|栽培|202609'), hm(32, 38)), entries);
    check('見つからない2人の分は入らない（群馬のキーなし、キーは4つだけ）',
      !entries.some(([k]) => k.startsWith('群馬|')) && entries.length === 4, entries);
  }

  check('ページのエラーなし', pageErrors.length === 0, pageErrors);
  console.log(`\nOK: ${okCount} / NG: ${ngCount}`);
  console.log(ngCount ? 'NGあり' : 'すべてOK');
  console.log('DONE');
  await browser.close();
  server.close();
  process.exit(ngCount ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
