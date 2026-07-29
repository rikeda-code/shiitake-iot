/**
 * 芽の太さ データ保存用 Google Apps Script
 *
 * 【セットアップ手順】
 * 1. 対象スプレッドシートを開く
 * 2. 拡張機能 → Apps Script
 * 3. このファイルの内容をコピーして貼り付け（SHEET_IDは変更不要）
 * 4. 「デプロイ」→「既存のデプロイを管理」→ 鉛筆アイコン
 *    → バージョン「新しいバージョン」→「デプロイ」
 */

const SHEET_ID = '1xD3RJ3NaxFPERZGBNEL3gwn3Zg8hIsh7nyM-ekgwHUI';
const SHEET_NAME = '芽の太さ';

function getOrCreateSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 2).setValues([['キー', '芽の太さ']]);
  }
  return sheet;
}

function doGet(e) {
  const sheet = getOrCreateSheet();

  // action=save のとき書き込み
  if (e.parameter.action === 'save') {
    const key = e.parameter.key || '';
    const value = e.parameter.value || '';
    if (key) {
      const data = sheet.getDataRange().getValues();
      let found = false;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === key) {
          value ? sheet.getRange(i + 1, 2).setValue(value) : sheet.deleteRow(i + 1);
          found = true;
          break;
        }
      }
      if (!found && value) sheet.appendRow([key, value]);
    }
  }

  // 全データ取得（JSONP対応）
  const data = sheet.getDataRange().getValues();
  const result = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][1]) result[String(data[i][0])] = String(data[i][1]);
  }

  const json = JSON.stringify(result);
  const callback = e.parameter.callback;
  // callbackパラメータがあればJSONP形式で返す
  const output = callback ? `${callback}(${json})` : json;
  const mime = callback
    ? ContentService.MimeType.JAVASCRIPT
    : ContentService.MimeType.JSON;

  return ContentService.createTextOutput(output).setMimeType(mime);
}
