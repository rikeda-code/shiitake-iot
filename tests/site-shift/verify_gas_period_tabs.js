// gas/shift-webapp.gs の保存先を、DB共有_拠点シフト_データの期間ごとのタブ（SD_YYYYMM）にしたことの検証。
// SpreadsheetApp（2つのファイル）・UrlFetchApp（Firestore）・PropertiesService などを偽物に差し替え、Node の vm で gs をそのまま動かす。
// 偽物のシートは実際の形に合わせる：
//   ・SD タブ・古いシフト_データ：8列（日付・拠点・キー・氏名・部門・シフト・実働h・更新日時）。日付は yyyy-MM-dd の文字列
//   ・整理済み_M：3行目が見出し（B列「F」・雇用区分・拠点・PRJ・部門・社員番号・名前・入退社年月）
//   ・拠点シフト_データのファイル：memo・シフト_固定・シフト_データ_旧保存・試し_SD_…（前日に名前を変えた試しのタブ）
// 確かめること：
//  - setup：期間一覧（見出し：タブ名・開始日・終了日・gid）を作り、シフト_データは作らない
//  - 保存（upsertCells_）が期間ごとのタブに振り分けられる。2つの期間にまたがる保存。古いシフト_データは変わらない
//  - 新しいタブは、いちばん新しい SD タブの左に作られ、期間一覧に1行足される。2回目は作られない
//  - 同じ名前のタブが期間一覧に無いとき・期間一覧のタブの名前が変わっているときはエラー（書き込まない）
//  - loadMonth_ が2つのタブを読む。hoursRange_ が期間をまたいで読める。mirrorLegacyAll_ も2つのタブから読む
//  - saveShifts_（旧シフト表の取り込み）が期間ごとに分けて書く
//  - exportToSD：整理済み_Mにいない人を書かずに一覧に出す、読めない値の一覧、照らし合わせの4つの数、
//    dryRun で書き込まない、トークンが無いと止まる、期限切れの知らせ、更新日時の決め方、2回目の dryRun で SD タブと一致
//  - copyBackToOld：fromIso 以降を古いシフト_データに上書き・追加し、それより前と古い方にだけある行は残す
// 実行：node tests/site-shift/verify_gas_period_tabs.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SRC = fs.readFileSync(path.join(__dirname, '../../gas/shift-webapp.gs'), 'utf8');

const MASTER_ID = '1LtYb1feXR6jtIEfxaADLiTEWpPabKJDDlwoS1V-yuG0';
const DATA_ID = '1h71qF-SAp8VJZl4TimbFrikmXAbMod4w_iEA_Yziaq8';
const HEADERS = ['日付', '拠点', 'キー', '氏名', '部門', 'シフト', '実働h', '更新日時'];
const OLD_TIME = new Date('2026-11-01T09:00:00+09:00');

/* ── 偽のシート・ファイル ── */
let gidSeq = 100000;
function makeSheet(name, rows, gid) {
  const sh = {
    name, gid: gid || gidSeq++, grid: (rows || []).map(r => r.slice()), frozen: 0, formats: [], ss: null,
    getName: () => sh.name, setName: n => { sh.name = n; return sh; }, getSheetId: () => sh.gid,
    getIndex: () => sh.ss.sheets.indexOf(sh) + 1,
    getLastRow() { for (let i = sh.grid.length; i > 0; i--) if (sh.grid[i - 1].some(v => v !== '' && v != null)) return i; return 0; },
    getLastColumn: () => Math.max(0, ...sh.grid.map(r => r.length)),
    setFrozenRows(n) { sh.frozen = n; },
    appendRow(row) { sh.grid.splice(sh.getLastRow(), 0, row.slice()); },
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') return { setNumberFormat: f => { sh.formats.push(`${r}=${f}`); } };
      nr = nr || 1; nc = nc || 1;
      const ensure = () => { while (sh.grid.length < r - 1 + nr) sh.grid.push([]); };
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const row = sh.grid[r - 1 + i] || []; const v = row[c - 1 + j]; return v === undefined ? '' : v; })),
        setValues(vals) { ensure(); vals.forEach((row, i) => row.forEach((v, j) => { sh.grid[r - 1 + i][c - 1 + j] = v; })); },
        clearContent() { for (let i = r - 1; i < r - 1 + nr && i < sh.grid.length; i++) for (let j = c - 1; j < c - 1 + nc; j++) sh.grid[i][j] = ''; },
        setNumberFormat: f => { sh.formats.push(`R${r}C${c}=${f}`); },
      };
    },
  };
  return sh;
}
function makeSs(sheets) {
  const ss = {
    sheets: [],
    getSheets: () => ss.sheets.slice(),
    getSheetByName: n => ss.sheets.filter(s => s.name === n)[0] || null,
    insertSheet(name, index) {
      if (ss.getSheetByName(name)) throw new Error(`「${name}」という名前のシートはすでに存在します。`);
      const sh = makeSheet(name, []); sh.ss = ss;
      ss.sheets.splice(index === undefined ? ss.sheets.length : index, 0, sh);
      return sh;
    },
  };
  sheets.forEach(s => { s.ss = ss; ss.sheets.push(s); });
  return ss;
}
// データ行（ヘッダーの下）を「日付|拠点|キー|シフト」の並びで返す
const dataRows = sh => sh.grid.slice(1).filter(r => r.some(v => v !== '' && v != null));
const ids = sh => dataRows(sh).map(r => `${r[0]}|${r[1]}|${r[2]}|${r[5]}`);

/* ── 整理済み_M（実際の形：1〜2行目は表題など、3行目が見出し） ── */
function masterSheet() {
  const head = ['No', 'F', '雇用区分', '拠点', 'PRJ', '部門', '社員番号', '名前', '入退社年月', '2026/10', '2026/11'];
  const row = (f, emp, site, dept, name, ym) => ['', f, emp, site, 'しいたけ', dept, '', name, ym || '', 160, 160];
  return makeSheet('整理済み_M', [
    ['ファーム勤務時間', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', ''],
    head,
    row(1, 'パート', 'いなべ', '栽培', '林 さとみ'),
    row(1, 'パート', 'いなべ', '出荷', '伊藤 花子'),
    row(9, 'パート', 'いなべ', '出荷', '退職 済子', '2026/11'),   // B列9（退職済み）でも書く
    row(1, '社員', '群馬', '栽培', '熊谷 寛'),
    row(3, '技能実習生', '群馬', '出荷', 'PHAM VAN TIEN', '2026/12'), // 2行の人：元の行（B列3）
    row(1, '技能実習生', '群馬', '栽培', 'PHAM VAN TIEN', '2026/12'), // 新しい行（B列1）→ 部門は栽培
    row(1, 'パート', '南丹', '出荷', '南 一郎'),
  ]);
}

/* ── 環境を作る（場面ごとに作り直す） ── */
function makeEnv(opt) {
  opt = opt || {};
  const oldData = makeSheet('シフト_データ', [HEADERS].concat(opt.oldRows || []), 889947728);
  const fixed = makeSheet('シフト_固定', [['拠点', 'キー', '氏名', '月', '火', '水', '木', '金', '土', '日', '更新日時'],
    ['いなべ', '林さとみ', '林 さとみ', '8:00-17:00', '8:00-17:00', '休', '8:00-17:00', '8:00-17:00', '休', '休', OLD_TIME]], 1);
  const master = makeSs([masterSheet(), oldData, fixed]);
  // 拠点シフト_データのファイル：今の形（試しの SD タブは前日に「試し_」に名前を変えた状態）
  const data = makeSs([
    makeSheet('memo', [['メモ']], 1595256060),
    makeSheet('シフト_固定', [['拠点', 'キー']], 1990068215),
    makeSheet('シフト_データ_旧保存', [HEADERS], 1220061497),
    makeSheet('試し_SD_202612', [HEADERS, ['2026-12-11', 'いなべ', '林さとみ', '林 さとみ', '栽培', '1:00-2:00', 1, OLD_TIME]], 1495784418),
    makeSheet('試し_SD_202611', [HEADERS], 1138634192),
  ]);
  const logs = [], fetches = [], mirrored = [];
  const props = Object.assign({}, opt.props || {});
  const firestore = opt.firestore || {};
  let fsStatus = opt.fsStatus || 200;
  const context = {
    SpreadsheetApp: {
      openById: id => { if (id === MASTER_ID) return master; if (id === DATA_ID) return data; throw new Error('知らないファイル ' + id); },
      flush() {},
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    UrlFetchApp: {
      fetch(url, o) {
        fetches.push({ url, auth: o && o.headers && o.headers.Authorization });
        if (fsStatus !== 200) return { getResponseCode: () => fsStatus, getContentText: () => '{"error":{"status":"UNAUTHENTICATED"}}' };
        // .../documents/shiftSites/{拠点}/months?pageSize=300[&pageToken=…]
        const m = decodeURIComponent(url).match(/shiftSites\/([^/]+)\/months\?pageSize=\d+(?:&pageToken=(.+))?$/);
        const pages = firestore[m[1]] || [[]];
        const pi = m[2] ? Number(m[2]) : 0;
        const docs = pages[pi].map(([month, cells]) => ({
          name: `projects/shiitake-iot/databases/(default)/documents/shiftSites/${m[1]}/months/${month}`,
          fields: { cells: { mapValue: { fields: Object.fromEntries(Object.entries(cells).map(([k, days]) => [k, { mapValue: { fields: Object.fromEntries(Object.entries(days).map(([d, v]) => [d, { stringValue: v }])) } }])) } }, updatedAt: { integerValue: '1' } },
        }));
        const body = { documents: docs }; if (pi + 1 < pages.length) body.nextPageToken = String(pi + 1);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
      },
    },
    Logger: { log: s => logs.push(String(s)) },
    console,
  };
  vm.createContext(context);
  vm.runInContext(SRC, context);
  // 旧シフト表（いなべ）への書き込みは、届いたセルを記録するだけにする（ここで確かめたいのは保存先）
  context.__mirrored = mirrored;
  vm.runInContext('mirrorLegacy_ = cells => { __mirrored.push(cells); return { written: 0 }; };', context);
  return { context, master, data, oldData, logs, fetches, props, setStatus: s => { fsStatus = s; } };
}
const snapshot = ss => JSON.stringify(ss.sheets.map(s => [s.name, s.gid, s.grid, s.frozen]));
const tabNames = ss => ss.sheets.map(s => s.name);
const listRows = env => dataRows(env.data.getSheetByName('期間一覧'));
const errOf = fn => { try { fn(); return null; } catch (e) { return String(e.message || e); } };

/* ① setup */
{
  const env = makeEnv();
  env.context.setup();
  const list = env.data.getSheetByName('期間一覧');
  check('setup：拠点シフト_データのファイルに「期間一覧」ができる', !!list, tabNames(env.data).join(','));
  check('setup：期間一覧の見出しは タブ名・開始日・終了日・gid', list && eq(list.grid[0], ['タブ名', '開始日', '終了日', 'gid']), list && JSON.stringify(list.grid[0]));
  check('setup：期間一覧の1行目を固定・A〜C列は文字の書式', list && list.frozen === 1 && list.formats.includes('A:C=@'), list && JSON.stringify([list.frozen, list.formats]));
  check('setup：gid をログに出す', env.logs.some(l => l === `期間一覧: gid=${list.gid}`), env.logs.join(' / '));
  check('setup：シフト_データはどちらのファイルにも作らない', !env.data.getSheetByName('シフト_データ') && env.master.sheets.filter(s => s.name === 'シフト_データ').length === 1, tabNames(env.data).join(','));
  check('setup：シフト_固定はファーム勤務時間のまま（増やさない）', env.master.sheets.filter(s => s.name === 'シフト_固定').length === 1, tabNames(env.master).join(','));
  const before = snapshot(env.data);
  env.context.setup();
  check('setup：2回目は何も変えない', snapshot(env.data) === before, '');
  // 期間一覧が無いときの保存はエラー（setup を促す）
  const env2 = makeEnv();
  const e = errOf(() => env2.context.upsertCells_({ site: 'いなべ', cells: [{ key: '林さとみ', date: '2026-12-11', value: '8-17' }] }));
  check('setup 前：保存は「setup を実行してください」のエラー', /setup を実行してください/.test(e || ''), e);
}

/* ② 保存の振り分け・タブの作り方 */
{
  const env = makeEnv({ oldRows: [['2026-11-20', 'いなべ', '林さとみ', '林 さとみ', '栽培', '8:00-12:00', 4, OLD_TIME]] });
  env.context.setup();
  const oldBefore = JSON.stringify(env.oldData.grid);
  let r = env.context.upsertCells_({ site: 'いなべ', cells: [{ key: '林さとみ', date: '2026-11-20', value: '8〜17' }] });
  const t11 = env.data.getSheetByName('SD_202611');
  check('保存：11/20 は SD_202611 タブに入る', t11 && eq(ids(t11), ['2026-11-20|いなべ|林さとみ|8:00-17:00']), t11 && JSON.stringify(ids(t11)));
  check('保存：新しいタブの見出しは8列・1行目を固定・A列は文字の書式', t11 && eq(t11.grid[0], HEADERS) && t11.frozen === 1 && t11.formats.includes('A:A=@'), t11 && JSON.stringify([t11.grid[0], t11.frozen, t11.formats]));
  check('保存：氏名・部門・実働h は今までどおり（整理済み_M から）', t11 && eq(dataRows(t11)[0].slice(3, 7), ['林 さとみ', '栽培', '8:00-17:00', 8]), t11 && JSON.stringify(dataRows(t11)[0]));
  check('保存：SD タブが1つも無いときは、いちばん右に作る', eq(tabNames(env.data).slice(-1), ['SD_202611']), tabNames(env.data).join(','));
  check('保存：期間一覧に SD_202611・2026-11-11・2026-12-10・gid の1行が足される', eq(listRows(env), [['SD_202611', '2026-11-11', '2026-12-10', t11.gid]]), JSON.stringify(listRows(env)));
  check('保存：changed は1', r.changed === 1, JSON.stringify(r));

  // 2つの期間にまたがる保存（12/9・12/10 → SD_202611、12/11・12/12 → SD_202612）
  r = env.context.upsertCells_({ site: 'いなべ', cells: [
    { key: '林さとみ', date: '2026-12-09', value: '8-17' }, { key: '林さとみ', date: '2026-12-10', value: '休' },
    { key: '林さとみ', date: '2026-12-11', value: '9-16' }, { key: '伊藤花子', date: '2026-12-12', value: '8-12配' },
  ] });
  const t12 = env.data.getSheetByName('SD_202612');
  check('またがる保存：12/9・12/10 は SD_202611 に入る', eq(ids(t11), ['2026-11-20|いなべ|林さとみ|8:00-17:00', '2026-12-09|いなべ|林さとみ|8:00-17:00', '2026-12-10|いなべ|林さとみ|休']), JSON.stringify(ids(t11)));
  check('またがる保存：12/11・12/12 は SD_202612 に入る', t12 && eq(ids(t12), ['2026-12-11|いなべ|林さとみ|9:00-16:00', '2026-12-12|いなべ|伊藤花子|8:00-12:00配送']), t12 && JSON.stringify(ids(t12)));
  check('またがる保存：changed は4', r.changed === 4, JSON.stringify(r));
  const names = tabNames(env.data);
  check('新しいタブ SD_202612 は、いちばん新しい SD タブ（SD_202611）の左に作られる', names.indexOf('SD_202612') === names.indexOf('SD_202611') - 1, names.join(','));
  check('期間一覧に SD_202612・2026-12-11・2027-01-10・gid の1行が足される（2行になる）', eq(listRows(env), [['SD_202611', '2026-11-11', '2026-12-10', t11.gid], ['SD_202612', '2026-12-11', '2027-01-10', t12.gid]]), JSON.stringify(listRows(env)));
  check('試しのタブ（試し_SD_202612）には書かない', eq(ids(env.data.getSheetByName('試し_SD_202612')), ['2026-12-11|いなべ|林さとみ|1:00-2:00']), JSON.stringify(ids(env.data.getSheetByName('試し_SD_202612'))));

  // 2回目：タブも期間一覧の行も増えない。上書き・削除・ほかの拠点の行は残る
  const tabsBefore = env.data.sheets.length;
  env.context.upsertCells_({ site: '群馬', cells: [{ key: '熊谷寛', date: '2026-12-12', value: '8-17' }] });
  env.context.upsertCells_({ site: 'いなべ', cells: [{ key: '林さとみ', date: '2026-12-11', value: '' }, { key: '伊藤花子', date: '2026-12-12', value: '10-15' }] });
  check('2回目：タブは作られない', env.data.sheets.length === tabsBefore, tabNames(env.data).join(','));
  check('2回目：期間一覧は2行のまま', listRows(env).length === 2, JSON.stringify(listRows(env)));
  check('2回目：上書き・削除が SD_202612 に入り、ほかの拠点（群馬）の行は残る', eq(ids(t12), ['2026-12-12|いなべ|伊藤花子|10:00-15:00', '2026-12-12|群馬|熊谷寛|8:00-17:00']), JSON.stringify(ids(t12)));
  // 消すだけのセルで、タブの無い期間はタブを作らない
  env.context.upsertCells_({ site: 'いなべ', cells: [{ key: '林さとみ', date: '2027-01-20', value: '' }] });
  check('消すだけのセル：タブの無い期間（SD_202701）は作らない', !env.data.getSheetByName('SD_202701') && listRows(env).length === 2, tabNames(env.data).join(','));
  check('保存：古いシフト_データは変わらない', JSON.stringify(env.oldData.grid) === oldBefore, JSON.stringify(env.oldData.grid));
  const e = errOf(() => env.context.upsertCells_({ site: 'いなべ', cells: [{ key: '林さとみ', date: '12/11', value: '8-17' }] }));
  check('保存：日付の形がおかしいセルはエラー', /日付の形式/.test(e || ''), e);
  // doPost を通しても同じ（flush は呼ばれたまま）
  vm.runInContext("requireAccess_ = () => {};", env.context);
  const res = env.context.doPost({ postData: { contents: JSON.stringify({ action: 'upsertCells', site: '南丹', idToken: 'x', cells: [{ key: '南一郎', date: '2026-12-13', value: '8-17' }] }) } });
  check('doPost：upsertCells が SD_202612 に入る', res.status === 'ok' && ids(t12).includes('2026-12-13|南丹|南一郎|8:00-17:00'), JSON.stringify(res));

  // 新しい期間のタブは、いちばん新しい SD タブ（SD_202612）の左
  env.context.upsertCells_({ site: 'いなべ', cells: [{ key: '林さとみ', date: '2027-01-11', value: '8-17' }] });
  const n2 = tabNames(env.data);
  check('次の期間（SD_202701）も、いちばん新しい SD タブ（SD_202612）の左に作られる', n2.indexOf('SD_202701') === n2.indexOf('SD_202612') - 1 && n2.indexOf('SD_202612') === n2.indexOf('SD_202611') - 1, n2.join(','));
}

/* ③ 期間一覧に無い同じ名前のタブ・名前が変わったタブ */
{
  const env = makeEnv();
  env.context.setup();
  env.context.upsertCells_({ site: 'いなべ', cells: [{ key: '林さとみ', date: '2026-11-20', value: '8-17' }] });
  // 手で作った SD_202612（期間一覧に無い）
  const manual = env.data.insertSheet('SD_202612', 0);
  manual.grid = [HEADERS.slice(), ['2026-12-11', 'いなべ', '林さとみ', '林 さとみ', '栽培', '7:00-8:00', 1, OLD_TIME]];
  const before = snapshot(env.data);
  let e = errOf(() => env.context.upsertCells_({ site: 'いなべ', cells: [{ key: '林さとみ', date: '2026-12-11', value: '8-17' }] }));
  check('期間一覧に無い同じ名前のタブ：保存はエラー', /期間一覧に載っていません/.test(e || ''), e);
  check('期間一覧に無い同じ名前のタブ：何も書き込まない（タブ・期間一覧とも）', snapshot(env.data) === before, '');
  e = errOf(() => env.context.upsertCells_({ site: 'いなべ', cells: [{ key: '林さとみ', date: '2026-12-01', value: '8-17' }, { key: '林さとみ', date: '2026-12-11', value: '8-17' }] }));
  check('またがる保存で片方だけ期間一覧に無いとき：エラーで、もう片方の期間も書かない', /期間一覧に載っていません/.test(e || '') && snapshot(env.data) === before, e);
  e = errOf(() => env.context.hoursRange_('いなべ', '2026-12-08', '2026-12-14'));
  check('期間一覧に無い同じ名前のタブ：読み取りもエラー（黙って使わない）', /期間一覧に載っていません/.test(e || ''), e);
  // 期間一覧のタブの名前を変えたとき
  env.data.getSheetByName('SD_202611').setName('SD_202611_写し');
  e = errOf(() => env.context.hoursRange_('いなべ', '2026-11-20', '2026-11-20'));
  check('期間一覧のタブの名前が変わっている：エラー', /名前が「SD_202611_写し」に変わっています/.test(e || ''), e);
}

/* ④ 読み取り：loadMonth_・hoursRange_・readData_・mirrorLegacyAll_ */
{
  const env = makeEnv();
  env.context.setup();
  env.context.upsertCells_({ site: 'いなべ', cells: [
    { key: '林さとみ', date: '2026-11-30', value: '8-17' }, { key: '林さとみ', date: '2026-12-01', value: '8-12' },
    { key: '林さとみ', date: '2026-12-10', value: '休' }, { key: '林さとみ', date: '2026-12-11', value: '9-16' },
    { key: '林さとみ', date: '2026-12-31', value: '8-17' }, { key: '林さとみ', date: '2027-01-05', value: '8-17' },
  ] });
  env.context.upsertCells_({ site: '群馬', cells: [{ key: '熊谷寛', date: '2026-12-02', value: '8-17' }] });
  const lm = env.context.loadMonth_('いなべ', '2026-12', false);
  const dates = lm.shifts.map(s => s.date).sort();
  check('loadMonth_：12月は SD_202611（12/1〜12/10）と SD_202612（12/11〜12/31）の2つから読む', eq(dates, ['2026-12-01', '2026-12-10', '2026-12-11', '2026-12-31']), JSON.stringify(dates));
  check('loadMonth_：ほかの拠点の行・月の外（11/30・1/5）は入らない', !lm.shifts.some(s => s.key === '熊谷寛'), JSON.stringify(lm.shifts));
  check('loadMonth_：固定シフトはファーム勤務時間のシフト_固定から読む', eq(lm.fixed['林さとみ'], ['8:00-17:00', '8:00-17:00', '休', '8:00-17:00', '8:00-17:00', '休', '休']), JSON.stringify(lm.fixed));
  check('loadMonth_：メンバーは整理済み_Mから（いなべの3人）', lm.members.length === 3, JSON.stringify(lm.members.map(m => m.name)));
  const hr = env.context.hoursRange_('いなべ', '2026-12-08', '2026-12-14');
  check('hoursRange_：期間をまたいで読める（12/10 は SD_202611、12/11 は SD_202612）', hr.persons.length === 1 && eq(hr.persons[0].days, { '2026-12-10': 0, '2026-12-11': 6 }), JSON.stringify(hr));
  const hr2 = env.context.hoursRange_('いなべ', '2027-02-11', '2027-02-20');
  check('hoursRange_：タブが無い期間は空', eq(hr2, { persons: [] }), JSON.stringify(hr2));
  const e = errOf(() => env.context.hoursRange_('いなべ', '', '2026-12-10'));
  check('hoursRange_：from が無いときはエラー', /期間の指定が正しくありません/.test(e || ''), e);
  check('periodsBetween_：11/30〜1/12 は 2026-11・2026-12・2027-01', eq(Array.from(env.context.periodsBetween_('2026-11-30', '2027-01-12')), ['2026-11', '2026-12', '2027-01']), '');
  check('periodsBetween_：年をまたぐ 12/11〜1/10 は 2026-12 の1つ', eq(Array.from(env.context.periodsBetween_('2026-12-11', '2027-01-10')), ['2026-12']), '');
  check('periodTabName_：2026-11 → SD_202611', env.context.periodTabName_('2026-11') === 'SD_202611', '');
  // mirrorLegacyAll_：LEGACY_MIRROR の期間（11/11〜12/10）の いなべ の分
  env.context.__mirrored.length = 0;
  env.context.mirrorLegacyAll_();
  const m = (env.context.__mirrored[0] || []).map(c => c.date).sort();
  check('mirrorLegacyAll_：11/11〜12/10 のいなべの行を SD_202611 から読む（12/11 以降は入らない）', eq(m, ['2026-11-30', '2026-12-01', '2026-12-10']), JSON.stringify(m));
}

/* ⑤ saveShifts_（旧シフト表の取り込み） */
{
  const env = makeEnv();
  env.context.setup();
  env.context.upsertCells_({ site: 'いなべ', cells: [
    { key: '林さとみ', date: '2026-11-30', value: '8-17' }, { key: '林さとみ', date: '2026-12-05', value: '8-17' }, { key: '林さとみ', date: '2026-12-20', value: '8-17' },
  ] });
  env.context.upsertCells_({ site: '群馬', cells: [{ key: '熊谷寛', date: '2026-12-05', value: '8-17' }] });
  const r = env.context.saveShifts_({ site: 'いなべ', month: '2026-12', cells: [
    { key: '伊藤花子', date: '2026-12-03', value: '8-12' }, { key: '伊藤花子', date: '2026-12-15', value: '9-16' },
    { key: '伊藤花子', date: '2026-11-29', value: '9-16' }, { key: '伊藤花子', date: '2026-12-16', value: 'あいう' },
  ] });
  const t11 = env.data.getSheetByName('SD_202611'), t12 = env.data.getSheetByName('SD_202612');
  check('saveShifts_：12/1〜12/10 の分は SD_202611 に書き、いなべの12月の行は置き換え・11/30 と群馬は残る', eq(ids(t11), ['2026-11-30|いなべ|林さとみ|8:00-17:00', '2026-12-03|いなべ|伊藤花子|8:00-12:00', '2026-12-05|群馬|熊谷寛|8:00-17:00']), JSON.stringify(ids(t11)));
  check('saveShifts_：12/11〜12/31 の分は SD_202612 に書く（12/20 の行は置き換わる）', eq(ids(t12), ['2026-12-15|いなべ|伊藤花子|9:00-16:00']), JSON.stringify(ids(t12)));
  check('saveShifts_：月の外（11/29）は書かず、読めない値は skipped に出る', r.saved === 2 && eq(Array.from(r.skipped), ['2026-12-16 あいう']), JSON.stringify(r));
}

/* ⑥ exportToSD */
const OLD_ROWS = [
  // 同じ値（更新日時は古い方のまま）
  ['2026-11-20', 'いなべ', '林さとみ', '林 さとみ', '栽培', '8:00-17:00', 8, OLD_TIME],
  // ③値が違う
  ['2026-12-11', 'いなべ', '林さとみ', '林 さとみ', '栽培', '8:00-12:00', 4, OLD_TIME],
  // ①古い方にだけある
  ['2026-11-21', 'いなべ', '林さとみ', '林 さとみ', '栽培', '8:00-17:00', 8, OLD_TIME],
  // ④古い方の重複行（下の行がデータベースと同じ）
  ['2026-11-22', '群馬', '熊谷寛', '熊谷 寛', '配送・栽培', '8:00-12:00', 4, OLD_TIME],
  ['2026-11-22', '群馬', '熊谷寛', '熊谷 寛', '配送・栽培', '8:00-17:00', 8, OLD_TIME],
  // 整理済み_Mにいない人の古い行（①に数える）
  ['2026-11-20', 'いなべ', 'ゆうれい', 'ゆうれい', '出荷', '8:00-17:00', 8, OLD_TIME],
];
const FIRESTORE = {
  // いなべは2ページに分かれて返る
  'いなべ': [
    [['2026-11', { '林さとみ': { '2026-11-20': '8:00-17:00', '2026-11-25': '' }, 'ゆうれい': { '2026-11-20': '8:00-17:00', '2026-11-23': '休' } }]],
    [['2026-12', { '林さとみ': { '2026-12-11': '8-17', '2026-12-05': 'あいう' }, '退職済子': { '2026-12-01': '8-12配' } }]],
  ],
  '群馬': [[['2026-11', { '熊谷寛': { '2026-11-22': '8:00-17:00' }, 'PHAMVANTIEN': { '2026-11-16': '8:00-17:00', '2026-11-17': '有給' } }],
            ['2026-12', { '林さとみ': { '2026-12-02': '8-17' } }]]], // 林さんは群馬には整理済み_Mにいない
  '南丹': [[]],
};
{
  // トークンが無いとき
  const env = makeEnv({ oldRows: OLD_ROWS, firestore: FIRESTORE });
  env.context.setup();
  const before = snapshot(env.data);
  const e = errOf(() => env.context.exportToSD({ dryRun: true }));
  check('exportToSD：トークンが無いと止まる', /EXPORT_ID_TOKEN/.test(e || '') && env.fetches.length === 0, e);
  check('exportToSD：止まったとき、トークンの取り方（getIdToken）とスクリプト プロパティへの貼り方を知らせる', /getIdToken\(true\)/.test(e || '') && /スクリプト プロパティ/.test(e || ''), e);
  check('exportToSD：トークンが無いとき、何も書き込まない', snapshot(env.data) === before, '');
  // 期限切れ（401）
  env.props.EXPORT_ID_TOKEN = 'tok';
  env.setStatus(401);
  const e2 = errOf(() => env.context.exportToSD({ dryRun: true }));
  check('exportToSD：トークンの期限切れ（401）は取り直しを知らせる', /期限が切れています/.test(e2 || ''), e2);
}
{
  const env = makeEnv({ oldRows: OLD_ROWS, firestore: FIRESTORE, props: { EXPORT_ID_TOKEN: 'tok-123' } });
  env.context.setup();
  const before = snapshot(env.data), oldBefore = JSON.stringify(env.oldData.grid);
  const r = env.context.exportToSDDryRun();
  check('dryRun：データベースを3拠点分読む（IDトークンを付ける・いなべは2ページ目も読む）', env.fetches.length === 4 && env.fetches.every(f => f.auth === 'Bearer tok-123') && env.fetches.some(f => /pageToken=1/.test(f.url)), JSON.stringify(env.fetches));
  check('dryRun：何も書き込まない（拠点シフト_データのファイル）', snapshot(env.data) === before, tabNames(env.data).join(','));
  check('dryRun：古いシフト_データも変えない', JSON.stringify(env.oldData.grid) === oldBefore, '');
  check('dryRun：整理済み_Mにいない人は、キー・拠点・件数の一覧に出る（空欄は数えない）', eq(r.notInMaster, [{ site: 'いなべ', key: 'ゆうれい', count: 2 }, { site: '群馬', key: '林さとみ', count: 1 }]), JSON.stringify(r.notInMaster));
  check('dryRun：シフトとして読めない値の一覧', r.bad.count === 1 && /いなべ｜林 さとみ｜2026-12-05「あいう」/.test(r.bad.first[0]), JSON.stringify(r.bad));
  check('dryRun：期間ごとの行数（SD_202611 5行・SD_202612 1行）', eq(r.periods, [{ tab: 'SD_202611', rows: 5 }, { tab: 'SD_202612', rows: 1 }]), JSON.stringify(r.periods));
  const c = r.compare;
  check('照らし合わせ①古い方にだけある：2件（11/21 林さん・整理済み_Mにいないゆうれいさん）', c.oldOnly.count === 2 && c.oldOnly.first.some(x => x.indexOf('2026-11-21|いなべ|林さとみ') === 0) && c.oldOnly.first.some(x => x.indexOf('2026-11-20|いなべ|ゆうれい') === 0), JSON.stringify(c.oldOnly));
  check('照らし合わせ②データベースにだけある：3件（12/1 退職済子さん・11/16・11/17 ティエンさん）', c.dbOnly.count === 3 && eq(c.dbOnly.first.map(x => x.split('「')[0]).sort(), ['2026-11-16|群馬|PHAMVANTIEN', '2026-11-17|群馬|PHAMVANTIEN', '2026-12-01|いなべ|退職済子']), JSON.stringify(c.dbOnly));
  check('照らし合わせ③値が違う：1件（12/11 林さん 8:00-12:00 → 8:00-17:00）', c.valueDiff.count === 1 && c.valueDiff.first[0] === '2026-12-11|いなべ|林さとみ「8:00-12:00」→「8:00-17:00」', JSON.stringify(c.valueDiff));
  check('照らし合わせ④古い方の重複行：1件（11/22 熊谷さん 2行）', c.oldDuplicates.count === 1 && /^2026-11-22\|群馬\|熊谷寛（2行/.test(c.oldDuplicates.first[0]), JSON.stringify(c.oldDuplicates));
  check('照らし合わせ：重複の下の行がデータベースと同じなら③には数えない', !c.valueDiff.first.some(x => x.indexOf('熊谷寛') >= 0), '');
  check('照らし合わせ：SD タブとの違い（書き出す前なので6件）', c.sdTabs.count === 6, JSON.stringify(c.sdTabs));
  check('ログに4つの件数が出る', ['①古い方にだけある：2件', '②データベースにだけある：3件', '③値が違う：1件', '④古い方の重複行：1件'].every(s => env.logs.some(l => l.indexOf(s) === 0)), env.logs.join('\n'));
  check('ログに整理済み_Mにいない人の一覧が出る', env.logs.some(l => /整理済み_Mにいないため書かない人：2人/.test(l) && /いなべ｜ゆうれい：2件/.test(l)), env.logs.join('\n'));

  // 本番：書き出す
  const r2 = env.context.exportToSD();
  const t11 = env.data.getSheetByName('SD_202611'), t12 = env.data.getSheetByName('SD_202612');
  check('書き出し：dryRun でないときは書き込む（r.dryRun=false）', r2.dryRun === false && !!t11 && !!t12, JSON.stringify(r2.periods));
  check('書き出し：SD_202611 に整理済み_Mにいる人の分だけが入る（ゆうれいさん・群馬の林さんは入らない）', eq(ids(t11), ['2026-11-16|群馬|PHAMVANTIEN|8:00-17:00', '2026-11-17|群馬|PHAMVANTIEN|有休', '2026-11-20|いなべ|林さとみ|8:00-17:00', '2026-11-22|群馬|熊谷寛|8:00-17:00', '2026-12-01|いなべ|退職済子|8:00-12:00配送']), JSON.stringify(ids(t11)));
  check('書き出し：SD_202612 には 12/11 の行だけ', eq(ids(t12), ['2026-12-11|いなべ|林さとみ|8:00-17:00']), JSON.stringify(ids(t12)));
  check('書き出し：12/1（B列9の退職済子さん）も書く（B列の値は問わない）。期間は 2026-11 なので SD_202611', ids(t11).includes('2026-12-01|いなべ|退職済子|8:00-12:00配送'), JSON.stringify(ids(t11)));
  const rowOf = (sh, id) => dataRows(sh).filter(r => `${r[0]}|${r[1]}|${r[2]}` === id)[0];
  const tien = rowOf(t11, '2026-11-16|群馬|PHAMVANTIEN');
  check('書き出し：氏名・部門は整理済み_Mの B列1・2 の行から（ティエンさんは栽培）', tien && tien[3] === 'PHAM VAN TIEN' && tien[4] === '栽培' && tien[6] === 8, JSON.stringify(tien));
  const same = rowOf(t11, '2026-11-20|いなべ|林さとみ'), changed = rowOf(t12, '2026-12-11|いなべ|林さとみ');
  check('書き出し：古い方に同じ値があれば、更新日時は古い方の日時', same && same[7] === OLD_TIME, JSON.stringify(same));
  check('書き出し：古い方と値が違えば、更新日時は書き出した時刻', changed && Object.prototype.toString.call(changed[7]) === '[object Date]' && changed[7].getTime() !== OLD_TIME.getTime() && Date.now() - changed[7].getTime() < 60000, JSON.stringify(changed));
  check('書き出し：値は今の保存と同じくそろえる（8-17 → 8:00-17:00・有給 → 有休）', changed[5] === '8:00-17:00' && rowOf(t11, '2026-11-17|群馬|PHAMVANTIEN')[5] === '有休', '');
  check('書き出し：期間一覧に2行足され、SD_202612 は SD_202611 の左', listRows(env).length === 2 && tabNames(env.data).indexOf('SD_202612') === tabNames(env.data).indexOf('SD_202611') - 1, tabNames(env.data).join(','));
  check('書き出し：古いシフト_データは変えない', JSON.stringify(env.oldData.grid) === oldBefore, '');
  // もう一度 dryRun：SD タブと一致
  const r3 = env.context.exportToSD({ dryRun: true });
  check('2回目の dryRun：SD タブとの違いは0件', r3.compare.sdTabs.count === 0, JSON.stringify(r3.compare.sdTabs));
  check('2回目の dryRun：古いシフト_データとの照らし合わせは1回目と同じ', eq(r3.compare.oldOnly, r.compare.oldOnly) && eq(r3.compare.dbOnly, r.compare.dbOnly) && eq(r3.compare.valueDiff, r.compare.valueDiff), '');

  // 書き出しは中身ごと書き直す：SD タブに余計な行があっても消える
  t12.grid.push(['2026-12-20', 'いなべ', '林さとみ', '林 さとみ', '栽培', '1:00-2:00', 1, OLD_TIME]);
  const r4 = env.context.exportToSD({ dryRun: true });
  check('dryRun：SD タブにだけある行は SD タブとの違いに出る', r4.compare.sdTabs.count === 1 && /2026-12-20\|いなべ\|林さとみ/.test(r4.compare.sdTabs.first[0]), JSON.stringify(r4.compare.sdTabs));
  env.context.exportToSD();
  check('書き出し：期間のタブを中身ごと書き直す（余計な行は消える）', eq(ids(t12), ['2026-12-11|いなべ|林さとみ|8:00-17:00']), JSON.stringify(ids(t12)));
}

/* ⑦ copyBackToOld */
{
  const env = makeEnv({ oldRows: [
    ['2026-12-10', 'いなべ', '林さとみ', '林 さとみ', '栽培', '8:00-12:00', 4, OLD_TIME],  // fromIso より前：そのまま
    ['2026-12-11', 'いなべ', '林さとみ', '林 さとみ', '栽培', '8:00-12:00', 4, OLD_TIME],  // 上書き
    ['2026-12-11', 'いなべ', '林さとみ', '林 さとみ', '栽培', '9:00-12:00', 3, OLD_TIME],  // 重複も上書き
    ['2026-12-12', '群馬', '熊谷寛', '熊谷 寛', '栽培', '8:00-17:00', 8, OLD_TIME],        // 古い方にだけある：残す
  ] });
  env.context.setup();
  env.context.upsertCells_({ site: 'いなべ', cells: [
    { key: '林さとみ', date: '2026-12-10', value: '8-17' }, { key: '林さとみ', date: '2026-12-11', value: '8-17' }, { key: '伊藤花子', date: '2027-01-12', value: '9-16' },
  ] });
  let e = errOf(() => env.context.copyBackToOld());
  check('copyBackToOld：日付も COPY_BACK_FROM も無いときはエラー', /COPY_BACK_FROM/.test(e || ''), e);
  const r = env.context.copyBackToOld('2026-12-11');
  const rows = dataRows(env.oldData).map(x => `${x[0]}|${x[1]}|${x[2]}|${x[5]}`);
  check('copyBackToOld：fromIso 以降の SD の行で、古いシフト_データの同じ「日付｜拠点｜キー」を上書き（重複の2行とも）', rows.filter(x => x.indexOf('2026-12-11|いなべ|林さとみ') === 0).every(x => x.endsWith('|8:00-17:00')) && rows.filter(x => x.indexOf('2026-12-11|いなべ|林さとみ') === 0).length === 2, JSON.stringify(rows));
  check('copyBackToOld：古い方に無い行は足す（次の期間のタブ SD_202701 からも）', rows.includes('2027-01-12|いなべ|伊藤花子|9:00-16:00'), JSON.stringify(rows));
  check('copyBackToOld：fromIso より前（12/10）は変えない', rows.includes('2026-12-10|いなべ|林さとみ|8:00-12:00'), JSON.stringify(rows));
  check('copyBackToOld：古い方にだけある行は消さずに件数を返す', rows.includes('2026-12-12|群馬|熊谷寛|8:00-17:00') && r.oldOnly.count === 1, JSON.stringify(r));
  check('copyBackToOld：上書き1件・追加1件', r.replaced === 1 && r.added === 1, JSON.stringify(r));
  check('copyBackToOld：古いシフト_データの見出しはそのまま', eq(env.oldData.grid[0], HEADERS), JSON.stringify(env.oldData.grid[0]));
  env.props.COPY_BACK_FROM = '2027-01-11';
  const r2 = env.context.copyBackToOld();
  check('copyBackToOld：エディタから実行したとき（引数なし）は COPY_BACK_FROM の日から', r2.from === '2027-01-11' && r2.replaced === 1 && r2.added === 0, JSON.stringify(r2));
}

const ng = results.filter(r => !r.ok).length;
console.log(`\n${results.length - ng}/${results.length} OK`);
process.exit(ng ? 1 : 0);
