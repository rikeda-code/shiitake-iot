// gas/shift-webapp.gs の整理済み_Mへの書き込み（月度の年月・F列の自動判定・行の探し方）の検証。
// GAS の SpreadsheetApp・Utilities・CacheService などは偽物に差し替え、Node の vm で
// gs ファイルをそのまま動かす（verify_gas_legacy_mirror.js と同じやり方）。
// 「今日」は 2026-10-27（今の月度 2026-10）に固定する。
// 確かめること：
//  - 月度（monthDegreeOf_）：11日〜翌月10日、年またぎも正しく計算できること
//  - 入退社の列に、実際の日付ではなく月度の1日の日付が書かれること
//  - F列（状態）が、画面から渡された値ではなく日付から自動で決まること
//    （addMember_・setJoinDate_：今の月度以前=1／次の月度以降=2、
//      setRetire_：今の月度以降=3、前の月度以前は退職=9・異動=8）
//  - 書き込む行を探すとき、F列8・9（実績のために残している行）を対象から外し、
//    該当が0行・2行以上ならエラーで書き込まないこと（setRetire_のエラー文には行番号を含む）
//  - addMember_の重複チェックは8・9以外の行があれば登録しないこと（8だけなら登録できる）
// 実行：node tests/site-shift/verify_gas_master_write.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }

// 整理済み_Mの偽物：1〜2行目は説明、3行目が見出し、B列＝F列（状態。MASTER_FLAG_COL=2で固定）。
// 列：A(未使用) / B=F列(状態) / C=雇用区分 / D=拠点 / E=PRJ / F=部門 / G=社員番号 / H=名前 / I=入退社
const HEAD = ['', 'F列(状態)', '雇用区分', '拠点', 'PRJ', '部門', '社員番号', '名前', '入退社'];
const COL = { flag: 1, empType: 2, site: 3, prj: 4, dept: 5, empNo: 6, name: 7, date: 8 }; // 0始まりの配列index
function row(flag, empType, site, prj, dept, empNo, name, date) {
  return ['', flag, empType, site, prj, dept, empNo, name, date];
}
let grid = [['（説明1行目）'], ['（説明2行目）'], HEAD];
// データ行は常に grid[3] から（説明2行・見出し1行の次）
const DATA0 = 3;

function resetGrid(rows) { grid = [['（説明1行目）'], ['（説明2行目）'], HEAD].concat(rows); }

const RealDate = Date;
const FIXED_NOW = new RealDate('2026-10-27T09:00:00+09:00'); // 今日=2026-10-27、今の月度=2026-10

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
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => makeSheet() }), flush() {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      // 本テストでは TZ='Asia/Tokyo'・fmt='yyyy-MM-dd' のみ使用。システムのタイムゾーンに
      // 依存しないよう、UTC epochに+9hしてUTC欄をJSTの暦日として読む
      const t = new RealDate(d.getTime() + 9 * 3600 * 1000);
      const pad = n => String(n).padStart(2, '0');
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    },
  },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  LockService: {}, ContentService: {}, PropertiesService: {}, Logger: { log() {} },
  console,
};
// new Date() を2026-10-27 09:00(JST)固定にする（引数ありは通常どおりRealDateへ）
context.Date = class extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(FIXED_NOW); }
  static now() { return FIXED_NOW.getTime(); }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../gas/shift-webapp.gs'), 'utf8'), context);

const ymVal = ym => new RealDate(`${ym}-01T00:00:00+09:00`);
const sameInstant = (a, b) => a instanceof RealDate && b instanceof RealDate && a.getTime() === b.getTime();

/* ===================== 月度（monthDegreeOf_）===================== */
check('2026-10-10 → 2026-09', context.monthDegreeOf_('2026-10-10') === '2026-09', context.monthDegreeOf_('2026-10-10'));
check('2026-10-11 → 2026-10', context.monthDegreeOf_('2026-10-11') === '2026-10', context.monthDegreeOf_('2026-10-11'));
check('2026-11-10 → 2026-10', context.monthDegreeOf_('2026-11-10') === '2026-10', context.monthDegreeOf_('2026-11-10'));
check('2026-12-20 → 2026-12', context.monthDegreeOf_('2026-12-20') === '2026-12', context.monthDegreeOf_('2026-12-20'));
check('年またぎ 2027-01-05 → 2026-12', context.monthDegreeOf_('2027-01-05') === '2026-12', context.monthDegreeOf_('2027-01-05'));
check('今の月度（固定した今日=2026-10-27）は2026-10', context.currentMonthDegree_() === '2026-10', context.currentMonthDegree_());

/* ===================== addMember_（新人登録）===================== */
(() => {
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', 'E001', '在籍太郎', '2020-04-01'),
  ]);
  const res = context.addMember_({ name: '新人一郎', site: 'いなべ', dept: '栽培', empType: 'パート', joinDate: '2026-10-13' });
  const r = grid[res.row - 1];
  check('addMember_：入社日2026-10-13(月度2026-10=今の月度)→F列1', r[COL.flag] === 1, r);
  check('addMember_：入退社の列は月度の1日(2026-10-01)の日付', sameInstant(r[COL.date], ymVal('2026-10')), r[COL.date]);
})();

(() => {
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', 'E001', '在籍太郎', '2020-04-01'),
  ]);
  const res = context.addMember_({ name: '新人二郎', site: 'いなべ', dept: '栽培', empType: 'パート', joinDate: '2026-11-11' });
  const r = grid[res.row - 1];
  check('addMember_：入社日2026-11-11(月度2026-11、次の月度以降)→F列2', r[COL.flag] === 2, r);
  check('addMember_：入退社の列は月度の1日(2026-11-01)の日付', sameInstant(r[COL.date], ymVal('2026-11')), r[COL.date]);
})();

(() => {
  // 同じ拠点・同じ名前でF列8（他所属）の行だけがあれば登録できる
  resetGrid([
    row(8, 'パート', 'いなべ', 'いなべ', '出荷', '', '転籍花子', '2024-01-01'),
  ]);
  let threw = null;
  try { context.addMember_({ name: '転籍花子', site: 'いなべ', dept: '栽培', empType: '社員', joinDate: '2026-10-13' }); }
  catch (e) { threw = e; }
  check('addMember_：同じ拠点・同じ名前でF列8だけなら登録できる(エラーにならない)', !threw, threw && threw.message);
})();

(() => {
  // 同じ拠点・同じ名前でF列1（在職中）の行があれば登録できない
  resetGrid([
    row(1, 'パート', 'いなべ', 'いなべ', '栽培', '', '在籍花子', '2024-01-01'),
  ]);
  let threw = null;
  try { context.addMember_({ name: '在籍花子', site: 'いなべ', dept: '栽培', empType: '社員', joinDate: '2026-10-13' }); }
  catch (e) { threw = e; }
  check('addMember_：F列1の行があれば登録できない(エラー)', !!threw, threw);
})();

/* ===================== setJoinDate_（入社日の変更）===================== */
(() => {
  resetGrid([
    row(2, 'パート', 'いなべ', 'いなべ', '栽培', '', '入社予定子', '2026-12-01'),
  ]);
  context.setJoinDate_({ key: '入社予定子', site: 'いなべ', date: '2026-10-13' });
  const r = grid[DATA0];
  check('setJoinDate_：入社日2026-10-13(今の月度以前)→F列1に付け直される', r[COL.flag] === 1, r);
  check('setJoinDate_：入退社の列は月度の1日(2026-10-01)の日付', sameInstant(r[COL.date], ymVal('2026-10')), r[COL.date]);
})();

(() => {
  resetGrid([
    row(2, 'パート', 'いなべ', 'いなべ', '栽培', '', '入社予定子', '2026-10-01'),
  ]);
  context.setJoinDate_({ key: '入社予定子', site: 'いなべ', date: '2026-11-11' });
  const r = grid[DATA0];
  check('setJoinDate_：入社日2026-11-11(次の月度以降)→F列2のまま', r[COL.flag] === 2, r);
  check('setJoinDate_：入退社の列は月度の1日(2026-11-01)の日付', sameInstant(r[COL.date], ymVal('2026-11')), r[COL.date]);
})();

(() => {
  // 同じ拠点・同じ名前でF列2の行が2つ → エラーで書き込まない
  resetGrid([
    row(2, 'パート', 'いなべ', 'いなべ', '栽培', '', '二重子', '2026-10-01'),
    row(2, 'パート', 'いなべ', 'いなべ', '出荷', '', '二重子', '2026-10-01'),
  ]);
  const before = JSON.parse(JSON.stringify(grid));
  let threw = null;
  try { context.setJoinDate_({ key: '二重子', site: 'いなべ', date: '2026-10-13' }); }
  catch (e) { threw = e; }
  check('setJoinDate_：F列2の行が2つあるとエラー', !!threw, threw);
  check('setJoinDate_：エラー時はどの行も書き換わらない', JSON.stringify(grid) === JSON.stringify(before), grid);
})();

/* ===================== setRetire_（退職・異動）===================== */
(() => {
  // 退職：2026-11-10（月度2026-10＝今の月度）→F列3
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', 'E010', '退職予定男', '2020-04-01'),
  ]);
  context.setRetire_({ key: '退職予定男', date: '2026-11-10', flag: 9 });
  const r = grid[DATA0];
  check('setRetire_：退職日2026-11-10(月度2026-10=今の月度)→F列3', r[COL.flag] === 3, r);
  check('setRetire_：入退社の列は月度の1日(2026-10-01)の日付', sameInstant(r[COL.date], ymVal('2026-10')), r[COL.date]);
})();

(() => {
  // 退職：2026-10-10（月度2026-09、前の月度）→F列9
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', 'E010', '退職済男', '2020-04-01'),
  ]);
  context.setRetire_({ key: '退職済男', date: '2026-10-10', flag: 9 });
  const r = grid[DATA0];
  check('setRetire_：退職日2026-10-10(前の月度)→F列9', r[COL.flag] === 9, r);
  check('setRetire_：入退社の列は月度の1日(2026-09-01)の日付', sameInstant(r[COL.date], ymVal('2026-09')), r[COL.date]);
})();

(() => {
  // 異動：2026-12-20（今の月度以降）→F列3
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', 'E011', '異動予定子', '2020-04-01'),
  ]);
  context.setRetire_({ key: '異動予定子', date: '2026-12-20', flag: 3 });
  check('setRetire_：異動日2026-12-20(今の月度以降)→F列3', grid[DATA0][COL.flag] === 3, grid[DATA0]);
})();

(() => {
  // 異動：2026-09-30（前の月度）→F列8
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', 'E011', '異動済子', '2020-04-01'),
  ]);
  context.setRetire_({ key: '異動済子', date: '2026-09-30', flag: 3 });
  check('setRetire_：異動日2026-09-30(前の月度)→F列8', grid[DATA0][COL.flag] === 8, grid[DATA0]);
})();

(() => {
  // 同じ名前でF列8の行とF列1の行がある人（上にF列8の行）を退職させると、F列1の行だけが
  // 書き換わり、F列8の行は変わらない（「同じ名前」で探すため拠点は絞らない＝拠点をまたいでも見つかる）
  resetGrid([
    row(8, '社員', '津', '津', '栽培', '', '兼務太郎', '2024-01-01'),
    row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '兼務太郎', '2024-04-01'),
  ]);
  const before8 = JSON.parse(JSON.stringify(grid[DATA0]));
  context.setRetire_({ key: '兼務太郎', date: '2026-10-10', flag: 9 }); // 月度2026-09、前の月度→F列9
  check('setRetire_：F列8の行は変わらない', JSON.stringify(grid[DATA0]) === JSON.stringify(before8), grid[DATA0]);
  check('setRetire_：F列1の行がF列9に書き換わる', grid[DATA0 + 1][COL.flag] === 9, grid[DATA0 + 1]);
})();

(() => {
  // 同じ名前でF列1の行が2つ → エラーでどの行も書き換わらない
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '二重男', '2024-01-01'),
    row(1, '社員', '津', '津', '栽培', '', '二重男', '2024-01-01'),
  ]);
  const before = JSON.parse(JSON.stringify(grid));
  let threw = null;
  try { context.setRetire_({ key: '二重男', date: '2026-10-10', flag: 9 }); }
  catch (e) { threw = e; }
  check('setRetire_：F列1の行が2つあるとエラー', !!threw, threw);
  check('setRetire_：エラー文に該当の行番号(4・5行目)が入っている', !!threw && /4・5行目/.test(threw.message), threw && threw.message);
  check('setRetire_：エラー時はどの行も書き換わらない', JSON.stringify(grid) === JSON.stringify(before), grid);
})();

(() => {
  // 該当する行が無い（F列8・9だけ）→エラー
  resetGrid([
    row(9, '社員', 'いなべ', 'いなべ', '栽培', '', '退職済三郎', '2024-01-01'),
  ]);
  let threw = null;
  try { context.setRetire_({ key: '退職済三郎', date: '2026-10-10', flag: 9 }); }
  catch (e) { threw = e; }
  check('setRetire_：F列1・2・3の行が無いとエラー', !!threw, threw);
})();

/* ===================== undoRetire_（取消）===================== */
(() => {
  resetGrid([
    row(3, '社員', 'いなべ', 'いなべ', '栽培', '', '退職取消男', '2026-10-01'),
  ]);
  context.undoRetire_({ key: '退職取消男' });
  const r = grid[DATA0];
  check('undoRetire_：F列1に戻る', r[COL.flag] === 1, r);
  check('undoRetire_：入退社の列は消える', r[COL.date] === '', r[COL.date]);
})();

(() => {
  // 同じ名前でF列8の行とF列3の行がある人を取消すると、F列3の行だけがF列1に書き換わり、
  // F列8の行は変わらない
  resetGrid([
    row(8, '社員', '津', '津', '栽培', '', '兼務花子', '2024-01-01'),
    row(3, '社員', 'いなべ', 'いなべ', '栽培', '', '兼務花子', '2026-10-01'),
  ]);
  const before8 = JSON.parse(JSON.stringify(grid[DATA0]));
  context.undoRetire_({ key: '兼務花子' });
  check('undoRetire_：F列8の行は変わらない', JSON.stringify(grid[DATA0]) === JSON.stringify(before8), grid[DATA0]);
  check('undoRetire_：F列3の行がF列1に戻る', grid[DATA0 + 1][COL.flag] === 1, grid[DATA0 + 1]);
})();

(() => {
  // F列3の行が無い（F列1のみ）→エラー
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '在籍四郎', '2024-01-01'),
  ]);
  let threw = null;
  try { context.undoRetire_({ key: '在籍四郎' }); }
  catch (e) { threw = e; }
  check('undoRetire_：F列3の行が無いとエラー', !!threw, threw);
})();

(() => {
  // F列3の行が2つ→エラー
  resetGrid([
    row(3, '社員', 'いなべ', 'いなべ', '栽培', '', '二重五郎', '2026-10-01'),
    row(3, '社員', '津', '津', '栽培', '', '二重五郎', '2026-10-01'),
  ]);
  const before = JSON.parse(JSON.stringify(grid));
  let threw = null;
  try { context.undoRetire_({ key: '二重五郎' }); }
  catch (e) { threw = e; }
  check('undoRetire_：F列3の行が2つあるとエラー', !!threw, threw);
  check('undoRetire_：エラー時はどの行も書き換わらない', JSON.stringify(grid) === JSON.stringify(before), grid);
})();

/* ===================== changeDept_（部門変更）===================== */
(() => {
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '部門変更子', '2024-01-01'),
  ]);
  context.changeDept_({ key: '部門変更子', site: 'いなべ', dept: '出荷' });
  check('changeDept_：部門が書き換わる', grid[DATA0][COL.dept] === '出荷', grid[DATA0]);
})();

(() => {
  // 同じ拠点・同じ名前でF列8の行とF列1の行がある人（上にF列8の行）の部門を変えると、
  // F列1の行だけが書き換わり、F列8の行は変わらない
  resetGrid([
    row(8, '社員', 'いなべ', 'いなべ', '栽培', '', '兼務六郎', '2024-01-01'),
    row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '兼務六郎', '2024-04-01'),
  ]);
  const before8 = JSON.parse(JSON.stringify(grid[DATA0]));
  context.changeDept_({ key: '兼務六郎', site: 'いなべ', dept: '出荷' });
  check('changeDept_：F列8の行は変わらない', JSON.stringify(grid[DATA0]) === JSON.stringify(before8), grid[DATA0]);
  check('changeDept_：F列1の行の部門が書き換わる', grid[DATA0 + 1][COL.dept] === '出荷', grid[DATA0 + 1]);
})();

(() => {
  // F列1・2・3の行が無い（F列9のみ）→エラー
  resetGrid([
    row(9, '社員', 'いなべ', 'いなべ', '栽培', '', '退職七郎', '2024-01-01'),
  ]);
  let threw = null;
  try { context.changeDept_({ key: '退職七郎', site: 'いなべ', dept: '出荷' }); }
  catch (e) { threw = e; }
  check('changeDept_：F列1・2・3の行が無いとエラー', !!threw, threw);
})();

(() => {
  // 同じ拠点・同じ名前でF列1の行が2つ→エラー
  resetGrid([
    row(1, '社員', 'いなべ', 'いなべ', '栽培', '', '二重八郎', '2024-01-01'),
    row(1, '社員', 'いなべ', 'いなべ', '出荷', '', '二重八郎', '2024-01-01'),
  ]);
  const before = JSON.parse(JSON.stringify(grid));
  let threw = null;
  try { context.changeDept_({ key: '二重八郎', site: 'いなべ', dept: '配送' }); }
  catch (e) { threw = e; }
  check('changeDept_：F列1の行が2つあるとエラー', !!threw, threw);
  check('changeDept_：エラー時はどの行も書き換わらない', JSON.stringify(grid) === JSON.stringify(before), grid);
})();

const ng = results.filter(r => !r.ok).length;
console.log(`\n${results.length - ng}/${results.length} OK`);
process.exit(ng ? 1 : 0);
