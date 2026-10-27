// gas/shift-webapp.gs の「旧シフト表へのバックアップ書き込み」（mirrorLegacy_・legacyValue_）の検証。
// GAS の SpreadsheetApp などは偽物に差し替え、Node の vm で gs ファイルをそのまま動かす。
// 確かめること：
//  - 期間（11/11〜12/10）の分だけ、同じ人（呼び名・全角空白の名前も照合）・同じ日のセルに書く
//  - 書き方：時間は 08:00-17:00 の0埋め、社員・技能実習生の 8:00-17:00 は「1」、休みの種類は「休」（有休・欠勤はそのまま）、印は外す、空は消す
//  - 期間外の日・旧シフト表にいない人・ほかのセルは変えない
// 実行：node tests/site-shift/verify_gas_legacy_mirror.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }

// 旧シフト表（2026.4.11~ タブ）の偽物。1行目＝日付、A列＝名前
const HEAD = ['', '', '11/10', '11/11', '11/12', '12/10'];
const grid = [
  HEAD,
  ['', '', '火', '水', '木', '木'],
  ['栽培パート合計時間', '', '', '', '', ''],
  ['林　さとみ', '栽培', '09:00-12:00', '', '', ''],
  ['ハイ', '栽培', '1', '', '', ''],
  ['伊藤　可琳', '栽培', '１', '', 'メモ', ''],
  ['左右田　耀子', '栽培', '', '', '', ''],
];
const gridBefore = JSON.parse(JSON.stringify(grid));
let setCalls = 0;
const sheet = {
  getSheetId: () => 872290181,
  getLastRow: () => grid.length,
  getLastColumn: () => HEAD.length,
  getRange(r, c, nr, nc) {
    return {
      getDisplayValues: () => grid.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc).map(String)),
      getValues: () => grid.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
      setValues(vals) { setCalls++; vals.forEach((row, i) => row.forEach((v, j) => { grid[r - 1 + i][c - 1 + j] = v; })); },
    };
  },
};
const context = {
  SpreadsheetApp: { openById: () => ({ getSheets: () => [sheet] }) },
  Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
  LockService: {}, ContentService: {}, CacheService: {}, PropertiesService: {}, Logger: { log() {} },
  console,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../gas/shift-webapp.gs'), 'utf8'), context);
// 整理済み_Mの偽物（いなべ）
const MEMBERS = [
  { key: '林さとみ', name: '林さとみ', site: 'いなべ', flag: 1, empType: 'パート' },
  { key: 'NGUYENVANHAI', name: 'NGUYEN  VAN HAI', site: 'いなべ', flag: 1, empType: '技能実習生' },
  { key: '伊藤可琳', name: '伊藤 可琳', site: 'いなべ', flag: 1, empType: '社員' },
  { key: '左右田煬子', name: '左右田 煬子', site: 'いなべ', flag: 1, empType: '社員' },
  { key: '出口香', name: '出口 香', site: 'いなべ', flag: 2, empType: 'パート' },
];
vm.runInContext(`readMembers_ = () => ${JSON.stringify(MEMBERS)};`, context);

// 書き方
const lv = (v, emp) => context.legacyValue_(v, { empType: emp });
check('パートの時間は0埋め', lv('8:30-14:00', 'パート') === '08:30-14:00', lv('8:30-14:00', 'パート'));
check('実習生の 8:00-17:00 は「1」', lv('8:00-17:00', '技能実習生') === '1', lv('8:00-17:00', '技能実習生'));
check('社員の 8:00-17:00 は「1」', lv('8:00-17:00', '社員') === '1', lv('8:00-17:00', '社員'));
check('社員でも 8:00-17:00 以外は時間', lv('9:00-15:00', '社員') === '09:00-15:00', lv('9:00-15:00', '社員'));
check('パートの 8:00-17:00 は時間のまま', lv('8:00-17:00', 'パート') === '08:00-17:00', lv('8:00-17:00', 'パート'));
check('希望休・代休は「休」', lv('希望休', 'パート') === '休' && lv('代休', 'パート') === '休', lv('希望休', 'パート'));
check('有休・欠勤はそのまま', lv('有休', 'パート') === '有休' && lv('欠勤', 'パート') === '欠勤', lv('有休', 'パート'));
check('配送の印は外す', lv('8:00-17:00半日配送', 'パート') === '08:00-17:00', lv('8:00-17:00半日配送', 'パート'));
check('空は空', lv('', 'パート') === '', lv('', 'パート'));

// 書き込み
const res = context.mirrorLegacy_([
  { key: '林さとみ', date: '2026-11-11', value: '9:30-12:30' },
  { key: 'NGUYENVANHAI', date: '2026-11-12', value: '8:00-17:00' },
  { key: '伊藤可琳', date: '2026-11-12', value: '' },              // 消す
  { key: '左右田煬子', date: '2026-12-10', value: '希望休' },
  { key: '林さとみ', date: '2026-11-10', value: '8:00-17:00' },     // 期間外
  { key: '林さとみ', date: '2026-12-11', value: '8:00-17:00' },     // 期間外
  { key: '出口香', date: '2026-11-11', value: '8:00-17:00' },       // 旧シフト表にいない
]);
check('期間内の4セルを書く', res.written === 4, JSON.stringify(res));
check('旧シフト表にいない人を返す', JSON.stringify(res.notFound) === '["出口香"]', JSON.stringify(res));
check('林 11/11 ＝ 09:30-12:30', grid[3][3] === '09:30-12:30', grid[3][3]);
check('ハイ（呼び名）11/12 ＝ 1', grid[4][4] === '1', grid[4][4]);
check('伊藤可琳 11/12 は消える', grid[5][4] === '', grid[5][4]);
check('左右田 耀子（表記違い）12/10 ＝ 休', grid[6][5] === '休', grid[6][5]);
check('期間外の 11/10 は変えない', grid[3][2] === '09:00-12:00', grid[3][2]);
const others = grid.every((row, r) => row.every((v, c) => {
  const touched = (r === 3 && c === 3) || (r === 4 && c === 4) || (r === 5 && c === 4) || (r === 6 && c === 5);
  return touched || v === gridBefore[r][c];
}));
check('ほかのセルは変えない', others, JSON.stringify(grid));
check('書き込みは1回（まとめて）', setCalls === 1, setCalls);

// 期間外だけなら何もしない
setCalls = 0;
const none = context.mirrorLegacy_([{ key: '林さとみ', date: '2026-10-30', value: '8:00-17:00' }]);
check('期間外だけなら開きもしない', none.written === 0 && setCalls === 0, JSON.stringify(none));

const ng = results.filter(r => !r.ok).length;
console.log(`\n${results.length - ng}/${results.length} OK`);
process.exit(ng ? 1 : 0);
