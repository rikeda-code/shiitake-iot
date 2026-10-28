// gas/shift-webapp.gs の「組織内の変更（changeOrg）・入社取消（cancelJoin）・行の見分け方」の検証。
// GAS の SpreadsheetApp・Utilities・CacheService などは偽物に差し替え、Node の vm で
// gs ファイルをそのまま動かす（verify_gas_master_write.js と同じやり方）。
// 「今日」は 2026-10-27（今の月度 2026-10）に固定する。
// 確かめること：
//  - 行の探し方：empType・deptがあれば「名前＋拠点＋雇用区分＋部門」で絞る（無ければ従来どおり）
//  - changeOrg：F列2は同じ行を上書き（mode:'overwrite'）。F列1は変更日の前日の月度で元の行を
//    F列3/8に、変更日の月度で新しい行をF列1/2に分ける（mode:'split'）。書く順番は新しい行が先
//  - changeOrg：雇用区分が不正、変更なし、F列1なのに変更日なし、はどれもエラーで何も書かない
//  - cancelJoin：F列2→F列3・入退社クリア。F列1には使えない（エラー）
//  - undoRetire：orgToがあれば、元の行を戻した後、名前＋拠点＋orgTo(雇用区分・部門)のF列1/2の
//    行もF列3・入退社クリアにする。見つからない・2行以上ならwarning付きで元の行だけ戻す
//  - doPostのtryの中でSpreadsheetApp.flush()の例外を受け取り、status:'error'で返す
//    （画面が「Failed to fetch」にならない）
// 実行：node tests/site-shift/verify_gas_org_change.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }

// 整理済み_Mの偽物：列はverify_gas_master_write.jsと同じ
// B=F列(状態) / C=雇用区分 / D=拠点 / E=PRJ / F=部門 / G=社員番号 / H=名前 / I=入退社
const HEAD = ['', 'F列(状態)', '雇用区分', '拠点', 'PRJ', '部門', '社員番号', '名前', '入退社'];
const COL = { flag: 1, empType: 2, site: 3, prj: 4, dept: 5, empNo: 6, name: 7, date: 8 };
function row(flag, empType, site, prj, dept, empNo, name, date) {
  return ['', flag, empType, site, prj, dept, empNo, name, date];
}
let grid = [['（説明1行目）'], ['（説明2行目）'], HEAD];
const DATA0 = 3;
function resetGrid(rows) { grid = [['（説明1行目）'], ['（説明2行目）'], HEAD].concat(rows); }

const RealDate = Date;
const FIXED_NOW = new RealDate('2026-10-27T09:00:00+09:00'); // 今日=2026-10-27、今の月度=2026-10

let flushShouldThrow = false;
function makeSheet() {
  return {
    getLastRow: () => grid.length,
    getLastColumn: () => HEAD.length,
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => grid.slice(r - 1, r - 1 + nr).map(rowArr => {
          const part = (rowArr || []).slice(c - 1, c - 1 + nc);
          while (part.length < nc) part.push('');
          return part;
        }),
        setValue(v) { grid[r - 1] = grid[r - 1] || []; grid[r - 1][c - 1] = v; },
        setValues(vals) { vals.forEach((rowVals, i) => { grid[r - 1 + i] = grid[r - 1 + i] || []; rowVals.forEach((v, j) => { grid[r - 1 + i][c - 1 + j] = v; }); }); },
        clearContent() { grid[r - 1] = grid[r - 1] || []; grid[r - 1][c - 1] = ''; },
        getValue() { return (grid[r - 1] || [])[c - 1]; },
      };
    },
  };
}

const context = {
  SpreadsheetApp: {
    openById: () => ({ getSheetByName: () => makeSheet() }),
    flush() { if (flushShouldThrow) throw new Error('入力規則に反しています: 雇用区分'); },
  },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const t = new RealDate(d.getTime() + 9 * 3600 * 1000);
      const pad = n => String(n).padStart(2, '0');
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    },
  },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: {
    MimeType: { JSON: 'JSON' },
    createTextOutput: text => ({ _text: text, setMimeType() { return this; } }),
  },
  PropertiesService: {}, Logger: { log() {} },
  console,
};
context.Date = class extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(FIXED_NOW); }
  static now() { return FIXED_NOW.getTime(); }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../gas/shift-webapp.gs'), 'utf8'), context);
// 閲覧・編集できる人の確認（#534）はverify_gas_access.jsで検証済みのため、ここでは素通りさせる
context.requireAccess_ = () => {};

const ymVal = ym => new RealDate(`${ym}-01T00:00:00+09:00`);
const sameInstant = (a, b) => a instanceof RealDate && b instanceof RealDate && a.getTime() === b.getTime();

/* ===================== findMemberRows_（行の探し方）===================== */
(() => {
  // 同じ名前で部門・雇用区分が違う2行がある場合、empType・deptがあれば1行に絞れる
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '見分子', '2020-01-01'),
    row(1, 'パート', 'いなべ', 'いなべ', '出荷', '', '見分子', '2024-01-01'),
  ]);
  const m = context.findMemberRows_({ key: '見分子', site: 'いなべ', empType: 'パート', dept: '出荷' }, [1, 2]);
  check('findMemberRows_：empType・deptがあれば同名2行から1行に絞れる', m.length === 1 && m[0].row === DATA0 + 2, m);
  const m2 = context.findMemberRows_({ key: '見分子', site: 'いなべ' }, [1, 2]);
  check('findMemberRows_：empType・deptが無ければ従来どおり2行とも対象', m2.length === 2, m2);
})();

/* ===================== changeOrg_：F列2（overwrite）===================== */
(() => {
  resetGrid([
    row(2, 'パート', 'いなべ', 'いなべ', '栽培', '', '上書き花子', '2026-11-01'),
  ]);
  const res = context.changeOrg_({ key: '上書き花子', site: 'いなべ', empType: 'パート', dept: '栽培', newEmpType: '社員', newDept: '出荷' });
  check('changeOrg_：F列2は同じ行を上書き(mode:overwrite)', res.mode === 'overwrite', res);
  const r = grid[DATA0];
  check('changeOrg_：F列2上書き後、雇用区分が書き換わる', r[COL.empType] === '社員', r);
  check('changeOrg_：F列2上書き後、部門が書き換わる', r[COL.dept] === '出荷', r);
  check('changeOrg_：F列2上書き後、行は増えない(1行のまま)', grid.length === DATA0 + 1, grid.length);
})();

/* ===================== changeOrg_：F列1（split）、変更日が今の月度より後 ===================== */
(() => {
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', 'E100', '分割太郎', '2020-04-01'),
  ]);
  const res = context.changeOrg_({ key: '分割太郎', site: 'いなべ', empType: '社員', dept: '栽培', date: '2026-12-11', newEmpType: 'パート', newDept: '出荷' });
  check('changeOrg_：F列1splitはmode:splitを返す', res.mode === 'split', res);
  const oldR = grid[DATA0], newR = grid[res.newRow - 1];
  // 変更日2026-12-11の前日2026-12-10の月度は2026-11。今の月度(2026-10)以降→元の行はF列3
  check('changeOrg_：変更日2026-12-11→元の行はF列3(前日の月度2026-11は今の月度以降)', oldR[COL.flag] === 3, oldR);
  check('changeOrg_：元の行の入退社は前日の月度(2026-11-01)', sameInstant(oldR[COL.date], ymVal('2026-11')), oldR[COL.date]);
  check('changeOrg_：元の行のほかの列(雇用区分・部門)は変わらない', oldR[COL.empType] === '社員' && oldR[COL.dept] === '栽培', oldR);
  // 変更日2026-12-11の月度は2026-12。今の月度(2026-10)より後→新しい行はF列2
  check('changeOrg_：新しい行はF列2(変更日の月度2026-12は今の月度より後)', newR[COL.flag] === 2, newR);
  check('changeOrg_：新しい行の雇用区分・部門は新しい値', newR[COL.empType] === 'パート' && newR[COL.dept] === '出荷', newR);
  check('changeOrg_：新しい行の拠点・PRJ・名前は元の行と同じ', newR[COL.site] === 'いなべ' && newR[COL.prj] === 'いなべ' && newR[COL.name] === '分割太郎', newR);
  check('changeOrg_：新しい行の社員番号は空欄', newR[COL.empNo] === '' || newR[COL.empNo] === undefined, newR[COL.empNo]);
  check('changeOrg_：新しい行の入退社は変更日の月度(2026-12-01)', sameInstant(newR[COL.date], ymVal('2026-12')), newR[COL.date]);
  check('changeOrg_：新しい行は名前のある最後の行の次に追加される', res.newRow === DATA0 + 2, res.newRow);
})();

/* ===================== changeOrg_：F列1（split）、変更日の月度が今の月度以前 ===================== */
(() => {
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', 'E101', '分割次郎', '2020-04-01'),
  ]);
  const res = context.changeOrg_({ key: '分割次郎', site: 'いなべ', empType: '社員', dept: '栽培', date: '2026-10-11', newEmpType: '社員', newDept: '出荷' });
  const oldR = grid[DATA0], newR = grid[res.newRow - 1];
  // 変更日2026-10-11の前日2026-10-10の月度は2026-09。今の月度(2026-10)より前→元の行はF列8
  check('changeOrg_：変更日2026-10-11→元の行はF列8(前日の月度2026-09は今の月度より前)', oldR[COL.flag] === 8, oldR);
  check('changeOrg_：元の行の入退社は前日の月度(2026-09-01)', sameInstant(oldR[COL.date], ymVal('2026-09')), oldR[COL.date]);
  // 変更日2026-10-11の月度は2026-10=今の月度→新しい行はF列1
  check('changeOrg_：新しい行はF列1(変更日の月度2026-10は今の月度以前)', newR[COL.flag] === 1, newR);
  check('changeOrg_：新しい行の入退社は変更日の月度(2026-10-01)', sameInstant(newR[COL.date], ymVal('2026-10')), newR[COL.date]);
})();

/* ===================== changeOrg_：確認（書く前にすべて確認）===================== */
(() => {
  resetGrid([row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '確認太郎', '2020-04-01')]);
  let threw = null;
  try { context.changeOrg_({ key: '確認太郎', site: 'いなべ', empType: '社員', dept: '栽培', date: '2026-12-11', newEmpType: '正社員', newDept: '出荷' }); }
  catch (e) { threw = e; }
  check('changeOrg_：雇用区分が不正な値だとエラー', !!threw, threw);
})();
(() => {
  resetGrid([row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '確認花子', '2020-04-01')]);
  let threw = null;
  try { context.changeOrg_({ key: '確認花子', site: 'いなべ', empType: '社員', dept: '栽培', date: '2026-12-11', newEmpType: '社員', newDept: '栽培' }); }
  catch (e) { threw = e; }
  check('changeOrg_：雇用区分・部門がどちらも変わらないとエラー', !!threw, threw);
})();
(() => {
  resetGrid([row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '確認三郎', '2020-04-01')]);
  let threw = null;
  try { context.changeOrg_({ key: '確認三郎', site: 'いなべ', empType: '社員', dept: '栽培', newEmpType: '社員', newDept: '出荷' }); } // dateなし
  catch (e) { threw = e; }
  check('changeOrg_：F列1で変更日が無いとエラー', !!threw, threw);
})();
(() => {
  // エラーのとき何も書かれていないこと（途中まで書かれた行を残さない）
  resetGrid([row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '確認四郎', '2020-04-01')]);
  const before = JSON.parse(JSON.stringify(grid));
  try { context.changeOrg_({ key: '確認四郎', site: 'いなべ', empType: '社員', dept: '栽培', newEmpType: '社員', newDept: '出荷' }); } catch (e) { /* 無視 */ }
  check('changeOrg_：エラー時は行が増えず、元の行も変わらない', JSON.stringify(grid) === JSON.stringify(before), grid);
})();
(() => {
  // 0行（見つからない）→エラー
  resetGrid([row(8, '社員', 'いなべ', 'いなべ', '栽培', '', '不在五郎', '2020-04-01')]);
  let threw = null;
  try { context.changeOrg_({ key: '不在五郎', site: 'いなべ', empType: '社員', dept: '栽培', date: '2026-12-11', newEmpType: '社員', newDept: '出荷' }); }
  catch (e) { threw = e; }
  check('changeOrg_：F列1/2の行が無いとエラー', !!threw, threw);
})();

/* ===================== cancelJoin_（入社取消）===================== */
(() => {
  resetGrid([row(2, 'パート', 'いなべ', 'いなべ', '栽培', '', '取消花子', '2026-11-01')]);
  context.cancelJoin_({ key: '取消花子', site: 'いなべ', empType: 'パート', dept: '栽培' });
  const r = grid[DATA0];
  check('cancelJoin_：F列3になる', r[COL.flag] === 3, r);
  check('cancelJoin_：入退社が消える', r[COL.date] === '', r[COL.date]);
})();
(() => {
  // F列1の人には使えない（エラー）
  resetGrid([row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '在職六郎', '2020-04-01')]);
  const before = JSON.parse(JSON.stringify(grid));
  let threw = null;
  try { context.cancelJoin_({ key: '在職六郎', site: 'いなべ', empType: '社員', dept: '栽培' }); }
  catch (e) { threw = e; }
  check('cancelJoin_：F列1の人には使えない(エラー)', !!threw, threw);
  check('cancelJoin_：エラー時は書き換わらない', JSON.stringify(grid) === JSON.stringify(before), grid);
})();

/* ===================== undoRetire_（orgToでの組織内の変更の取消）===================== */
(() => {
  // 成功：元の行をF列1に戻した後、orgToの行（F列1）をF列3・入退社クリアにする
  resetGrid([
    row(3, '社員', 'いなべ', 'いなべ', '栽培', 'E200', '取消対象太郎', '2026-11-01'), // 元の行
    row(1, 'パート', 'いなべ', 'いなべ', '出荷', '', '取消対象太郎', '2026-12-01'),   // orgToの行
  ]);
  const res = context.undoRetire_({ key: '取消対象太郎', site: 'いなべ', orgTo: { empType: 'パート', dept: '出荷' } });
  check('undoRetire_(orgTo)：警告なし', !res.warning, res);
  check('undoRetire_(orgTo)：元の行はF列1に戻り入退社が消える', grid[DATA0][COL.flag] === 1 && grid[DATA0][COL.date] === '', grid[DATA0]);
  check('undoRetire_(orgTo)：orgToの行はF列3になり入退社が消える', grid[DATA0 + 1][COL.flag] === 3 && grid[DATA0 + 1][COL.date] === '', grid[DATA0 + 1]);
})();
(() => {
  // orgToの行が見つからない→元の行だけ戻し、warningを返す
  resetGrid([
    row(3, '社員', 'いなべ', 'いなべ', '栽培', '', '警告太郎', '2026-11-01'),
  ]);
  const res = context.undoRetire_({ key: '警告太郎', site: 'いなべ', orgTo: { empType: 'パート', dept: '出荷' } });
  check('undoRetire_(orgTo)：行が見つからないとwarningを返す', !!res.warning, res);
  check('undoRetire_(orgTo)：それでも元の行はF列1に戻る', grid[DATA0][COL.flag] === 1, grid[DATA0]);
})();
(() => {
  // orgToの行が2行以上→元の行だけ戻し、warningを返す
  resetGrid([
    row(3, '社員', 'いなべ', 'いなべ', '栽培', '', '警告次郎', '2026-11-01'),
    row(1, 'パート', 'いなべ', 'いなべ', '出荷', '', '警告次郎', '2026-12-01'),
    row(2, 'パート', 'いなべ', 'いなべ', '出荷', '', '警告次郎', '2027-01-01'),
  ]);
  const res = context.undoRetire_({ key: '警告次郎', site: 'いなべ', orgTo: { empType: 'パート', dept: '出荷' } });
  check('undoRetire_(orgTo)：行が2つ以上でもwarningを返す', !!res.warning, res);
  check('undoRetire_(orgTo)：元の行はF列1に戻る', grid[DATA0][COL.flag] === 1, grid[DATA0]);
  check('undoRetire_(orgTo)：orgToの候補の行は変わらない', grid[DATA0 + 1][COL.flag] === 1 && grid[DATA0 + 2][COL.flag] === 2, [grid[DATA0 + 1], grid[DATA0 + 2]]);
})();
(() => {
  // orgToが無い（今までどおり）→元の行だけ戻る
  resetGrid([row(3, '社員', 'いなべ', 'いなべ', '栽培', '', '通常太郎', '2026-11-01')]);
  const res = context.undoRetire_({ key: '通常太郎', site: 'いなべ' });
  check('undoRetire_：orgTo無しは今までどおり元の行だけ戻る', !res.warning && grid[DATA0][COL.flag] === 1, [res, grid[DATA0]]);
})();

/* ===================== retire・setJoinDateの行の絞り方拡張 ===================== */
(() => {
  // 同じ名前・同じ拠点でempType・deptが違う2行があるとき、retireはempType・deptがあれば絞れる
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '絞込花子', '2020-01-01'),
    row(1, 'パート', 'いなべ', 'いなべ', '出荷', '', '絞込花子', '2024-01-01'),
  ]);
  context.setRetire_({ key: '絞込花子', site: 'いなべ', empType: 'パート', dept: '出荷', date: '2026-10-10', flag: 9 });
  check('setRetire_：empType・deptがあれば同名2行から1行に絞って書き込める', grid[DATA0][COL.flag] === 1 && grid[DATA0 + 1][COL.flag] === 9, [grid[DATA0], grid[DATA0 + 1]]);
})();
(() => {
  resetGrid([
    row(2, '社員', 'いなべ', 'いなべ', '栽培', '', '絞込次郎', '2026-11-01'),
    row(2, 'パート', 'いなべ', 'いなべ', '出荷', '', '絞込次郎', '2026-12-01'),
  ]);
  context.setJoinDate_({ key: '絞込次郎', site: 'いなべ', empType: 'パート', dept: '出荷', date: '2026-10-13' });
  check('setJoinDate_：empType・deptがあれば同名2行から1行に絞って書き込める', grid[DATA0][COL.flag] === 2 && grid[DATA0 + 1][COL.flag] === 1, [grid[DATA0], grid[DATA0 + 1]]);
})();

/* ===================== doPost：書き込み失敗時のエラー表示（flush()で受け取る）===================== */
(() => {
  resetGrid([row(1, '社員', 'いなべ', 'いなべ', '栽培', '', 'エラー太郎', '2020-04-01')]);
  flushShouldThrow = true;
  const e = { postData: { contents: JSON.stringify({ action: 'changeOrg', key: 'エラー太郎', site: 'いなべ', empType: '社員', dept: '栽培', date: '2026-12-11', newEmpType: 'パート', newDept: '出荷' }) } };
  let res;
  try { res = JSON.parse(context.doPost(e)._text); } finally { flushShouldThrow = false; }
  check('doPost：flush()の例外がtryの中で受け取られ、status:errorで返る(Failed to fetchにならない)', res.status === 'error' && !!res.message, res);
})();

const ng = results.filter(r => !r.ok).length;
console.log(`\n${results.length - ng}/${results.length} OK`);
process.exit(ng ? 1 : 0);
