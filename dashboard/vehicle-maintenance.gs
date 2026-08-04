/**
 * 社用車管理アプリ 書き込み用 Google Apps Script
 *
 * この「安中ファーム 走行日報」スプレッドシートに紐づけて設置する。
 * dashboard/vehicles.html からのPOSTを受け取り、「車両マスタ」シート
 * (車検満了日・オイル交換・タイヤ交換の記録)を作成/更新する。
 *
 * セットアップ手順は docs/vehicle-app-setup.md を参照。
 */

const SHEET_NAME = '車両マスタ';
const HEADERS = [
  '管理番号', '登録番号', '車名', '拠点',
  '車検満了日',
  '前回オイル交換日', 'オイル交換時走行距離(km)',
  '前回タイヤ交換日', 'タイヤ交換時走行距離(km)',
  '更新者', '更新日時',
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data.vehicleId) {
      throw new Error('vehicleId is required');
    }
    const sheet = getOrCreateSheet_();
    const rowIndex = findOrCreateRow_(sheet, data.vehicleId);

    setIfProvided_(sheet, rowIndex, 2, data.registrationNumber);
    setIfProvided_(sheet, rowIndex, 3, data.vehicleName);
    setIfProvided_(sheet, rowIndex, 4, data.site);
    setIfProvided_(sheet, rowIndex, 5, data.shakenDate ? new Date(data.shakenDate) : undefined);
    setIfProvided_(sheet, rowIndex, 6, data.oilChangeDate ? new Date(data.oilChangeDate) : undefined);
    setIfProvided_(sheet, rowIndex, 7, data.oilChangeOdo);
    setIfProvided_(sheet, rowIndex, 8, data.tireChangeDate ? new Date(data.tireChangeDate) : undefined);
    setIfProvided_(sheet, rowIndex, 9, data.tireChangeOdo);
    sheet.getRange(rowIndex, 10).setValue(data.updatedBy || '');
    sheet.getRange(rowIndex, 11).setValue(new Date());

    return jsonResponse_({ ok: true });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return jsonResponse_({ ok: true, message: '社用車管理アプリ用Web Appは起動しています。書き込みはPOSTで行ってください。' });
}

function setIfProvided_(sheet, rowIndex, col, value) {
  if (value === undefined || value === null || value === '') return;
  sheet.getRange(rowIndex, col).setValue(value);
}

function findOrCreateRow_(sheet, vehicleId) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(vehicleId)) return i + 1;
  }
  const rowIndex = sheet.getLastRow() + 1;
  sheet.getRange(rowIndex, 1).setValue(vehicleId);
  return rowIndex;
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
