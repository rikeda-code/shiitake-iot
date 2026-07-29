/**
 * 収穫実績集計表 新規タブ自動追加 Google Apps Script
 *
 * 「号機別収穫実績集計表」スプレッドシートに紐づけて設置する。
 * 号機ごとのタブ(例:「16(7/13)L3」)を新規追加・リネームすると、
 * 「収穫実績集計表1」シートの3行目(見本行)の下に1行追加し、
 * A~Q列に3行目と同じ関数を展開したうえで、F列に新規タブ名を記入する。
 * 逆に、追加されていたタブが削除されると、対応する集計行も自動的に削除する。
 *
 * セットアップ手順は docs/harvest-summary-automation-setup.md を参照。
 */

const SUMMARY_SHEET_NAME = '収穫実績集計表1';
const TEMPLATE_ROW = 3;      // 関数の見本行
const DATA_START_ROW = 4;   // 実データの先頭行
const LAST_COL = 17;         // A~Q列
const LOT_NAME_COL = 6;      // F列(号機)
const KNOWN_SHEETS_PROPERTY = 'knownSheetNames';

// ロットタブと判定する命名パターン(例:「16(7/13)L3」「32(6/29)6志摩L3」)。
// 号機番号 + (月/日) + 任意の文字列 + L数字 の形式のみを対象にする。
// これ以外の名前のタブ(管理用タブ、個人名タブ、テストタブなど)は
// EXCLUDED_SHEET_NAMES に列挙しなくても自動的に対象外になる。
const LOT_NAME_PATTERN = /^\d+\(\d{1,2}\/\d{1,2}\).*L\d+$/;

// 上記パターンに一致してしまうが除外したいシート名がある場合はここに追記する
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
 * タブ数が多く重いスプレッドシートでは "Service Spreadsheets failed" のような
 * 一時的なエラーが起きることがあるため、数回リトライする。
 */
function withRetry_(fn, attempts) {
  attempts = attempts || 3;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) Utilities.sleep(3000 * (i + 1));
    }
  }
  throw lastError;
}

function getSheetNames_(ss) {
  return withRetry_(function () {
    return ss.getSheets().map(function (sheet) { return sheet.getName(); });
  });
}

/**
 * インストール型 onChange トリガーから呼ばれる。
 * createOnChangeTrigger() を一度実行してトリガー登録しておくこと。
 */
function onChangeInstalled(e) {
  if (!e || ['INSERT_GRID', 'OTHER', 'REMOVE_GRID'].indexOf(e.changeType) === -1) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summary = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!summary) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const previousNames = JSON.parse(props.getProperty(KNOWN_SHEETS_PROPERTY) || '[]');
    const currentNames = getSheetNames_(ss);

    if (e.changeType === 'REMOVE_GRID') {
      // 削除されたタブ名 = 前回覚えていた名前のうち、今はもう存在しないもの
      previousNames
          .filter(function (name) { return currentNames.indexOf(name) === -1; })
          .forEach(function (name) { removeSummaryRowsForTab_(summary, name); });
    } else {
      // 追加対象は「前回覚えていた名前に無かった=今回新しく現れたタブ」だけに限定する。
      // 集計表のF列に載っているかどうかだけで判定すると、何らかの理由でF列に
      // 載っていない古いタブまで「未追加」と誤認識し、大量に遡って追加してしまう。
      const existingNames = getExistingLotNames_(summary);
      currentNames
          .filter(function (name) { return previousNames.indexOf(name) === -1; })
          .forEach(function (name) {
            if (!LOT_NAME_PATTERN.test(name)) return;
            if (EXCLUDED_SHEET_NAMES.indexOf(name) !== -1) return;
            if (TEMP_NAME_PATTERNS.some(function (re) { return re.test(name); })) return;
            if (existingNames.indexOf(name) !== -1) return;
            addSummaryRow_(summary, name);
            existingNames.push(name);
          });
    }

    props.setProperty(KNOWN_SHEETS_PROPERTY, JSON.stringify(currentNames));
  } finally {
    lock.releaseLock();
  }
}

function addSummaryRow_(summary, tabName) {
  summary.insertRowBefore(DATA_START_ROW);
  const templateRange = summary.getRange(TEMPLATE_ROW, 1, 1, LAST_COL);
  const newRowRange = summary.getRange(DATA_START_ROW, 1, 1, LAST_COL);
  templateRange.copyTo(newRowRange);
  summary.getRange(DATA_START_ROW, LOT_NAME_COL).setValue(tabName);
}

function removeSummaryRowsForTab_(summary, tabName) {
  const lastRow = summary.getLastRow();
  if (lastRow < DATA_START_ROW) return;
  const values = summary.getRange(DATA_START_ROW, LOT_NAME_COL, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][0] === tabName) summary.deleteRow(DATA_START_ROW + i);
  }
}

function getExistingLotNames_(summary) {
  const lastRow = summary.getLastRow();
  if (lastRow < DATA_START_ROW) return [];
  return summary.getRange(DATA_START_ROW, LOT_NAME_COL, lastRow - DATA_START_ROW + 1, 1)
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
  // 現在のタブ一覧を記録しておく(次回イベント発生時の追加/削除判定の基準にする)
  PropertiesService.getScriptProperties().setProperty(
      KNOWN_SHEETS_PROPERTY, JSON.stringify(getSheetNames_(ss)));
}

/**
 * 設定確認用。SUMMARY_SHEET_NAME に指定した名前のシートが実際に存在するかを
 * チェックする。見つからない場合は現在のタブ一覧を表示するので、
 * スクリプト冒頭の SUMMARY_SHEET_NAME をそれに合わせて修正すること。
 */
function checkSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summary = ss.getSheetByName(SUMMARY_SHEET_NAME);
  const ui = SpreadsheetApp.getUi();
  if (summary) {
    ui.alert('OK: 「' + SUMMARY_SHEET_NAME + '」という集計タブが見つかりました。設定は正しく反映されています。');
    return;
  }
  const names = getSheetNames_(ss).join('\n');
  ui.alert(
      '「' + SUMMARY_SHEET_NAME + '」という名前のシートが見つかりません。\n' +
      'スクリプト冒頭の SUMMARY_SHEET_NAME を、下の実際のタブ名に合わせて修正してください。\n\n' +
      '現在のタブ一覧:\n' + names);
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

/**
 * 自動削除が働かなかった場合の手動フォールバック。
 * 既に削除してしまったタブ名を入力して、対応する集計行を消す。
 */
function removeSummaryRowByName() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summary = ss.getSheetByName(SUMMARY_SHEET_NAME);
  const ui = SpreadsheetApp.getUi();
  if (!summary) {
    ui.alert('「' + SUMMARY_SHEET_NAME + '」シートが見つかりません。');
    return;
  }
  const response = ui.prompt('削除するタブ名を入力してください(例: 16(7/13)L3)');
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const name = response.getResponseText().trim();
  if (!name) return;
  removeSummaryRowsForTab_(summary, name);
  ui.alert('「' + name + '」の行を集計表から削除しました(該当行がなければ何も起きません)。');
}

function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('収穫実績集計 自動化')
      .addItem('設定を確認', 'checkSetup')
      .addItem('今開いているタブを集計表に追加', 'addSummaryRowForActiveSheet')
      .addItem('指定した名前の行を集計表から削除', 'removeSummaryRowByName')
      .addToUi();
}
