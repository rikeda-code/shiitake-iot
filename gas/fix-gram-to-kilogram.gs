// ============================================================
// 出荷実績 抽出シート — g換算 → kg換算 修正スクリプト
// スプレッドシートID: 18zyC0JwVyaW3i18LQdvHQeDpEcfzM8iolhclgNocrnM
//
// 対象タブの C〜N列・AE〜AP列・BG〜BR列（出荷量／販売形態別出荷量／
// サイズ別出荷量）は誤ってg換算のまま入力されている（例: C4 83,400.0）。
// これを kg 換算（例: 83.4）に修正する。
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

// 1セルあたりの出荷量として現実的にありえる上限（kg）。
// 「1000kgはあり得るが10000kgはあり得ない」という前提で、
// この値を超える数値は g 換算のまま残っている値とみなし kg に変換する。
// 既に1000kg以下（＝kg換算済みとみなせる値）は変更しないため、
// このスクリプトは複数回実行しても安全（冪等）。
const PLAUSIBLE_MAX_KG = 1000;

// 変換後もこの値を超える場合、単純な桁（g/kg）のずれとは考えにくいため
// 自動修正せずログに出力して手動確認を促す（データ異常の見逃し防止）。
const SANITY_MAX_KG = 10000;

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
 * 指定タブの C〜N列・AE〜AP列・BG〜BR列について、
 * PLAUSIBLE_MAX_KG（1000）を超える値（＝g換算のまま残っている値）だけを
 * 1000で割ってkg換算に直す。1000以下の値には触れない。
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
  const flagged = [];

  GRAM_COLUMN_RANGES.forEach(({ start, end }) => {
    const numCols = end - start + 1;
    const range = sheet.getRange(DATA_START_ROW, start, lastRow - DATA_START_ROW + 1, numCols);
    const values = range.getValues();

    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const value = values[r][c];
        if (typeof value !== 'number' || value <= PLAUSIBLE_MAX_KG) continue;

        const converted = value / 1000;

        if (converted > SANITY_MAX_KG) {
          // 1000で割ってもなお非現実的な値 → g/kgの単純な取り違えと断定できないため
          // 自動修正はせず、確認用にログへ記録するのみ。
          flagged.push({
            cell: sheet.getRange(DATA_START_ROW + r, start + c).getA1Notation(),
            original: value
          });
          continue;
        }

        values[r][c] = converted;
        fixedCount++;
      }
    }

    range.setValues(values);
  });

  Logger.log(`[${sheetName}] g→kg 変換完了: ${fixedCount}件`);
  if (flagged.length > 0) {
    Logger.log(`[${sheetName}] 要確認（変換後も${SANITY_MAX_KG}kg超のため未修正）: ${JSON.stringify(flagged)}`);
  }
}
