// ============================================================
// 出荷実績 抽出シート — g換算 → kg換算 修正スクリプト
// スプレッドシートID: 18zyC0JwVyaW3i18LQdvHQeDpEcfzM8iolhclgNocrnM
//
// 対象タブの C〜N列・AE〜AP列・BG〜BR列（出荷量／販売形態別出荷量／
// サイズ別出荷量）は誤ってg換算のまま入力されている（例: C4 83,400.0）。
// 数値の大小で判定すると誤判定の危険があるため、対象列の数値セルは
// 無条件に1/1000し、kg換算（例: 83.4）に修正する。
// ============================================================

const SHIPMENT_SHEET_ID = '18zyC0JwVyaW3i18LQdvHQeDpEcfzM8iolhclgNocrnM';

// g換算になっている列ブロック（開始列・終了列は1始まりの列番号）
//   C〜N列   : 3〜14
//   AE〜AP列 : 31〜42
//   BG〜BR列 : 59〜70
const GRAM_COLUMN_RANGES = [
  { start: 3,  end: 14 },
  { start: 31, end: 42 },
  { start: 59, end: 70 }
];

const DATA_START_ROW = 4; // ヘッダーを除くデータ開始行

/**
 * 「2026.9」タブを対象に g換算 → kg換算 の修正を実行する。
 */
function fixGramToKilogram_202609() {
  fixGramToKilogramOnSheet('2026.9');
}

/**
 * 複数タブをまとめて修正したい場合に利用する（例: 今後の月次タブ追加時）。
 *   fixGramToKilogramOnSheets(['2026.9', '2026.10']);
 */
function fixGramToKilogramOnSheets(sheetNames) {
  sheetNames.forEach(fixGramToKilogramOnSheet);
}

/**
 * 指定タブの C〜N列・AE〜AP列・BG〜BR列にある数値セルを
 * すべて1000で割ってg換算からkg換算に直す（大小判定は行わない）。
 *
 * 注意: このスクリプトは対象範囲の数値を無条件に1/1000するため、
 * 既にkg換算済みのデータに対して実行すると値が壊れる。
 * 1回限りの実行を想定し、実行後は再実行しないこと。
 */
function fixGramToKilogramOnSheet(sheetName) {
  const ss = SpreadsheetApp.openById(SHIPMENT_SHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log(`シートが見つかりません: ${sheetName}`);
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return;

  let fixedCount = 0;

  GRAM_COLUMN_RANGES.forEach(({ start, end }) => {
    const numCols = end - start + 1;
    const range = sheet.getRange(DATA_START_ROW, start, lastRow - DATA_START_ROW + 1, numCols);
    const values = range.getValues();

    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const value = values[r][c];
        if (typeof value !== 'number') continue;

        values[r][c] = value / 1000;
        fixedCount++;
      }
    }

    range.setValues(values);
  });

  Logger.log(`[${sheetName}] g→kg 変換完了: ${fixedCount}件`);
}
