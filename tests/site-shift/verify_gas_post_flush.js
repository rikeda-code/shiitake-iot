// gas/shift-webapp.gs の doPost で、順番待ち（ScriptLock）を解く前に SpreadsheetApp.flush() を呼ぶことの検証。
// 書き込みをシートに確定させてから次の人に順番を渡し、次の人が書き込み前の内容を読んで行が重複するのを防ぐため。
// SpreadsheetApp・LockService などは偽物に差し替え、Node の vm で gs をそのまま動かす。
// 確かめること：
//  - 保存が成功したとき：waitLock → flush → releaseLock の順に呼ばれる（flush は1回）
//  - 保存の途中でエラーになったとき（シートへの書き込みで失敗）：同じく flush → releaseLock の順で、エラーは画面に返る
//  - 権限のエラー・不明な action のときも flush → releaseLock の順
//  - releaseLock の後に flush が呼ばれていない
//  - flush 自体が失敗しても releaseLock は呼ばれ、doPost は例外で落ちずにエラーを返す
//    （成功のはずだったときは flush のエラー、すでにエラーのときは元のエラー）
// 実行：node tests/site-shift/verify_gas_post_flush.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }

// 呼ばれた順番の記録
let calls = [];

// 保存先の偽物：DB共有_拠点シフト_データ の SD_202612（2026/12/11〜2027/1/10）タブ。
// 実際のタブと同じ8列の見出し・日付は yyyy-MM-dd の文字列（保存先が期間ごとのタブになったため。期間一覧に SD_202612 が載っている状態）
const HEADERS = ['日付', '拠点', 'キー', '氏名', '部門', 'シフト', '実働h', '更新日時'];
let grid, failOnWrite;
function resetSheet() {
  grid = [
    HEADERS,
    ['2026-12-12', 'いなべ', '林さとみ', '林 さとみ', '栽培', '8:00-17:00', 8, new Date('2026-12-10T09:00:00+09:00')],
    ['2026-12-12', '群馬', '高山太郎', '高山 太郎', '出荷', '8:00-12:00', 4, new Date('2026-12-10T09:00:00+09:00')],
  ];
  failOnWrite = false;
}
const SD_GID = 1495784418;
const dataSheet = {
  getName: () => 'SD_202612',
  getSheetId: () => SD_GID,
  getLastRow: () => grid.length,
  getRange(r, c, nr, nc) {
    return {
      getValues: () => grid.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
      clearContent() {
        calls.push('clearContent');
        for (let i = r - 1; i < r - 1 + nr; i++) grid[i] = grid[i].map(() => '');
      },
      setValues(vals) {
        if (failOnWrite) throw new Error('サービスに接続できませんでした: Spreadsheets（偽物のエラー）');
        calls.push('setValues');
        vals.forEach((row, i) => { grid[r - 1 + i] = row.slice(); });
      },
      setNumberFormat() {},
    };
  },
};
// 期間一覧（見出し：タブ名・開始日・終了日・gid）
const listGrid = [['タブ名', '開始日', '終了日', 'gid'], ['SD_202612', '2026-12-11', '2027-01-10', SD_GID]];
const listSheet = {
  getName: () => '期間一覧', getSheetId: () => 1, getLastRow: () => listGrid.length,
  getRange: (r, c, nr, nc) => ({ getValues: () => listGrid.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)) }),
  appendRow(row) { listGrid.push(row); },
};
const DATA_SS_ID = '1h71qF-SAp8VJZl4TimbFrikmXAbMod4w_iEA_Yziaq8';
const dataSs = { getSheetByName: name => ({ 'SD_202612': dataSheet, '期間一覧': listSheet })[name] || null, getSheets: () => [listSheet, dataSheet] };
const masterSs = { getSheetByName: () => null, getSheets: () => [] };

const context = {
  SpreadsheetApp: {
    openById: id => (id === DATA_SS_ID ? dataSs : masterSs),
    flush() { calls.push('flush'); },
  },
  LockService: {
    getScriptLock: () => ({
      waitLock() { calls.push('waitLock'); },
      releaseLock() { calls.push('releaseLock'); },
    }),
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
  Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  UrlFetchApp: {}, PropertiesService: {}, Logger: { log() {} },
  console,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../gas/shift-webapp.gs'), 'utf8'), context);
// 整理済み_Mと権限の確認は偽物にする（ここで確かめたいのは flush と順番待ちの順番だけ）
// 権限：'ng-token' のときだけ断る
vm.runInContext(`
  readMembers_ = () => [{ key: '林さとみ', name: '林 さとみ', site: 'いなべ', dept: '栽培', flag: 1, empType: 'パート' }];
  requireAccess_ = (sites, idToken, edit) => { if (idToken === 'ng-token') throw new Error('いなべのシフトを変える権限がありません'); };
`, context);

const post = req => context.doPost({ postData: { contents: JSON.stringify(Object.assign({ idToken: 'ok-token' }, req)) } });
const idx = name => calls.indexOf(name);
const count = name => calls.filter(x => x === name).length;
// いなべの旧シフト表への書き込み（mirrorLegacy_）は期間（11/11〜12/10）の外なら何もしないので、12/11 を使う
const CELLS = [{ key: '林さとみ', date: '2026-12-11', value: '8:00-17:00' }];

// ① 成功
resetSheet(); calls = [];
let res = post({ action: 'upsertCells', site: 'いなべ', cells: CELLS });
check('成功：保存は成功として返る', res.status === 'ok' && res.changed === 1, JSON.stringify(res));
check('成功：シートに書き込んだ（setValues が呼ばれた）', count('setValues') === 1, calls.join(' → '));
check('成功：flush は1回だけ呼ばれる', count('flush') === 1, calls.join(' → '));
check('成功：書き込み → flush → releaseLock の順', idx('setValues') < idx('flush') && idx('flush') < idx('releaseLock'), calls.join(' → '));
check('成功：最後に呼ばれたのは releaseLock（解いた後に flush しない）', calls[calls.length - 1] === 'releaseLock', calls.join(' → '));
check('成功：waitLock が最初', calls[0] === 'waitLock', calls.join(' → '));
check('成功：書いた行が SD_202612 タブにある（8列）', grid.some(r => r[0] === '2026-12-11' && r[2] === '林さとみ' && r[5] === '8:00-17:00' && r.length === 8), JSON.stringify(grid));

// ② シートへの書き込みでエラー
resetSheet(); calls = []; failOnWrite = true;
res = post({ action: 'upsertCells', site: 'いなべ', cells: CELLS });
check('書き込みエラー：エラーとして返る', res.status === 'error' && /サービスに接続できませんでした/.test(res.message), JSON.stringify(res));
check('書き込みエラー：flush は1回だけ呼ばれる', count('flush') === 1, calls.join(' → '));
check('書き込みエラー：flush → releaseLock の順', idx('flush') >= 0 && idx('flush') < idx('releaseLock'), calls.join(' → '));
check('書き込みエラー：最後に呼ばれたのは releaseLock', calls[calls.length - 1] === 'releaseLock', calls.join(' → '));

// ③ 権限のエラー（書き込みの前に止まる）
resetSheet(); calls = [];
res = post({ action: 'upsertCells', site: 'いなべ', cells: CELLS, idToken: 'ng-token' });
check('権限エラー：エラーとして返る', res.status === 'error' && /権限がありません/.test(res.message), JSON.stringify(res));
check('権限エラー：シートには書かない', count('setValues') === 0 && count('clearContent') === 0, calls.join(' → '));
check('権限エラー：flush → releaseLock の順', idx('flush') >= 0 && idx('flush') < idx('releaseLock') && calls[calls.length - 1] === 'releaseLock', calls.join(' → '));

// ④ 不明な action
resetSheet(); calls = [];
res = post({ action: 'nope', site: 'いなべ' });
check('不明な action：エラーとして返る', res.status === 'error' && res.message === '不明なactionです', JSON.stringify(res));
check('不明な action：flush → releaseLock の順', idx('flush') >= 0 && idx('flush') < idx('releaseLock') && calls[calls.length - 1] === 'releaseLock', calls.join(' → '));

// ⑤ flush 自体が失敗したとき（入力規則に反する値などは flush の時点でエラーになる）
//    順番待ちは必ず解く。成功のはずだったときはエラーとして返し（画面が1分後にもう一度送る）、
//    すでにエラーのときは元のエラーのまま返す
let flushThrows = false;
context.SpreadsheetApp.flush = () => { calls.push('flush'); if (flushThrows) throw new Error('入力規則に反しています（偽物のエラー）'); };
resetSheet(); calls = []; flushThrows = true;
let thrown = null;
try { res = post({ action: 'upsertCells', site: 'いなべ', cells: CELLS }); } catch (e) { thrown = e; }
check('flush失敗（成功のはずだったとき）：doPost が例外で落ちない', thrown === null, thrown && thrown.message);
check('flush失敗（成功のはずだったとき）：flush のエラーとして返る', res && res.status === 'error' && /入力規則に反しています/.test(res.message), JSON.stringify(res));
check('flush失敗（成功のはずだったとき）：releaseLock は呼ばれ、flush の後', idx('flush') >= 0 && idx('flush') < idx('releaseLock') && calls[calls.length - 1] === 'releaseLock', calls.join(' → '));

resetSheet(); calls = []; failOnWrite = true; thrown = null;
try { res = post({ action: 'upsertCells', site: 'いなべ', cells: CELLS }); } catch (e) { thrown = e; }
check('flush失敗（すでにエラーのとき）：doPost が例外で落ちない', thrown === null, thrown && thrown.message);
check('flush失敗（すでにエラーのとき）：元のエラー（書き込みの失敗）のまま返る', res && res.status === 'error' && /サービスに接続できませんでした/.test(res.message), JSON.stringify(res));
check('flush失敗（すでにエラーのとき）：releaseLock は呼ばれる', calls[calls.length - 1] === 'releaseLock', calls.join(' → '));
flushThrows = false;

const ng = results.filter(r => !r.ok).length;
console.log(`\n${results.length - ng}/${results.length} OK`);
process.exit(ng ? 1 : 0);
