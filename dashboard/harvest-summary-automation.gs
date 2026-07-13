/**
 * 収穫実績集計表 新規タブ自動追加 Google Apps Script
 *
 * 「号機別収穫実績集計表」スプレッドシートに紐づけて設置する。
 * 号機ごとのタブ(例:「16(7/13)L3」)を新規追加・リネームすると、
 * 「収穫実績集計表1」シートの3行目(見本行)の下に1行追加し、
 * A~Q列に3行目と同じ関数を展開したうえで、F列に新規タブ名を記入する。
 *
 * セットアップ手順は docs/harvest-summary-automation-setup.md を参照。
 */

const SUMMARY_SHEET_NAME = '収穫実績集計表1';
const TEMPLATE_ROW = 3;            // 関数の見本行
const NEW_ROW = TEMPLATE_ROW + 1;  // 追加される行(4行目)
const LAST_COL = 17;               // A~Q列
const LOT_NAME_COL = 6;            // F列(号機)

// 新規ロットタブとして扱わないシート名(必要に応じて追記してください)
const EXCLUDED_SHEET_NAMES = [
  SUMMARY_SHEET_NAME,
  'ファーム号機別収穫実績',
  '転写（いなべ収穫管理表）保管用',
  '転写（いなべ収穫管理表）',
  'コンテナー一覧',
  'いなべ原本',
];

// シート複製直後の仮の名前(例:「いなべ原本のコピー」「シート2」)はまだ最終的な
// タブ名ではないため無視し、ユーザーがリネームした時点(OTHERイベント)で処理する
const TEMP_NAME_PATTERNS = [/のコピー(\s*\d+)?$/, /^シート\d+$/, /^Copy of /];

/**
 * インストール型 onChange トリガーから呼ばれる。
 * createOnChangeTrigger() を一度実行してトリガー登録しておくこと。
 */
function onChangeInstalled(e) {
  if (!e || (e.changeType !== 'INSERT_GRID' && e.changeType !== 'OTHER')) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summary = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!summary) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existingNames = getExistingLotNames_(summary);
    ss.getSheets().forEach(function (sheet) {
      const name = sheet.getName();
      if (EXCLUDED_SHEET_NAMES.indexOf(name) !== -1) return;
      if (TEMP_NAME_PATTERNS.some(function (re) { return re.test(name); })) return;
      if (existingNames.indexOf(name) !== -1) return;
      addSummaryRow_(summary, name);
      existingNames.push(name);
    });
  } finally {
    lock.releaseLock();
  }
}

function addSummaryRow_(summary, tabName) {
  summary.insertRowAfter(TEMPLATE_ROW);
  const templateRange = summary.getRange(TEMPLATE_ROW, 1, 1, LAST_COL);
  const newRowRange = summary.getRange(NEW_ROW, 1, 1, LAST_COL);
  templateRange.copyTo(newRowRange);
  summary.getRange(NEW_ROW, LOT_NAME_COL).setValue(tabName);
}

function getExistingLotNames_(summary) {
  const lastRow = summary.getLastRow();
  if (lastRow < NEW_ROW) return [];
  return summary.getRange(NEW_ROW, LOT_NAME_COL, lastRow - TEMPLATE_ROW, 1)
      .getValues()
      .map(function (row) { return row[0]; })
      .filter(function (v) { return v !== ''; });
}

/**
 * 初回セットアップ時に一度だけ実行する(Apps Scriptエディタの実行ボタンから)。
 * onChange のインストール型トリガーを作成する。
 */
function createOnChangeTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onChangeInstalled') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onChangeInstalled').forSpreadsheet(ss).onChange().create();
}

/**
 * 自動検知が働かなかった場合の手動フォールバック。
 * 追加したいタブを開いた状態でメニューから実行する。
 */
function addSummaryRowForActiveSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const active = ss.getActiveSheet();
  const name = active.getName();
  const summary = ss.getSheetByName(SUMMARY_SHEET_NAME);
  const ui = SpreadsheetApp.getUi();
  if (!summary) {
    ui.alert('「' + SUMMARY_SHEET_NAME + '」シートが見つかりません。');
    return;
  }
  if (EXCLUDED_SHEET_NAMES.indexOf(name) !== -1) {
    ui.alert('「' + name + '」は集計対象外のシートです。');
    return;
  }
  const existingNames = getExistingLotNames_(summary);
  if (existingNames.indexOf(name) !== -1) {
    ui.alert('「' + name + '」は既に集計表に追加済みです。');
    return;
  }
  addSummaryRow_(summary, name);
  ui.alert('「' + name + '」を集計表に追加しました。');
}

function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('収穫実績集計 自動化')
      .addItem('今開いているタブを集計表に追加', 'addSummaryRowForActiveSheet')
      .addToUi();
}
