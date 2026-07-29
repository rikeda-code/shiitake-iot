/**
 * 芽の太さ データ保存用 Google Apps Script
 *
 * 【セットアップ手順】
 * 1. 対象スプレッドシートを開く
 * 2. 拡張機能 → Apps Script
 * 3. このファイルの内容をコピーして貼り付け
 * 4. 上部の SHEET_ID を対象スプレッドシートのIDに変更
 *    (URLの /d/XXXXXXX/edit の XXXXXXX 部分)
 * 5. 「デプロイ」→「新しいデプロイ」
 * 6. 種類：「ウェブアプリ」を選択
 * 7. 次のユーザーとして実行：「自分」
 * 8. アクセスできるユーザー：「全員」
 * 9. 「デプロイ」→ 表示されたURLをコピー
 * 10. ダッシュボードのまとめタブ「芽の太さ保存先(GAS URL)」欄に貼り付け
 */

const SHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ← スプレッドシートIDに変更
const SHEET_NAME = '芽の太さ';

function getOrCreateSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 2).setValues([['キー', '芽の太さ']]);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  return sheet;
}

function doGet(e) {
  const callback = e.parameter.callback; // JSONP用（不要な場合は無視）
  const sheet = getOrCreateSheet();

  // action=save のとき書き込みモード
  if (e.parameter.action === 'save') {
    const key = e.parameter.key || '';
    const value = e.parameter.value || '';
    if (key) {
      const data = sheet.getDataRange().getValues();
      let found = false;
      for (let i = 1; i < data.length; i++) { // 1行目はヘッダー
        if (String(data[i][0]) === key) {
          if (value) {
            sheet.getRange(i + 1, 2).setValue(value);
          } else {
            sheet.deleteRow(i + 1); // 値が空なら行削除
          }
          found = true;
          break;
        }
      }
      if (!found && value) {
        sheet.appendRow([key, value]);
      }
    }
    const result = JSON.stringify({ ok: true });
    return ContentService.createTextOutput(result)
      .setMimeType(ContentService.MimeType.JSON);
  }

  // デフォルト: 全データ取得
  const data = sheet.getDataRange().getValues();
  const result = {};
  for (let i = 1; i < data.length; i++) {
    const k = String(data[i][0]);
    const v = String(data[i][1]);
    if (k && v) result[k] = v;
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
