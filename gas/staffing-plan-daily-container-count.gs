/**
 * 要員計画：栽培工数（いなべ(700g)）日次コンテナ数のシート内書き込み（方針転換後）
 *
 * 【方針転換の背景】
 * ダッシュボードJS側でのgviz直読み＋ブラウザ内計算をやめ、GAS側で
 * 「26/生産計画」ファイルの各拠点ガントシートに日次の工程別コンテナ数を直接書き込む方式に変更した。
 * このファイルは「いなべ(700g)」シートへの書き込みの検証（Step 1: 7/1分のみ→Step 2: 7/2分を追加）を行う。
 * 月次集計して「整理済み_計画_更新」シートへ書き込む処理は後続で実装する。
 *
 * ── シート構造（今回ユーザーが実データを直接確認した内容）─────────────
 * A列：投入月（月初の行にのみラベルあり。例：2026/6/1、2026/7/1。日付型セル or 文字列の場合がある）
 * B列：No.（コンテナ通し番号。全コンテナ行で連続して埋まっている前提でコンテナ行範囲を検出する）
 * C列：投入日。型が不統一で、6月分は日付型(Date)、7月分は文字列「7/1」形式（年なし）。
 *       文字列の場合は直近のA列ラベルから年を補完する
 * D列：床数（基準2520。異なる場合は係数=床数/2520で重み付け）
 * E列以降：既存の収穫量ガント（今回の日次集計では読まない。投入日からのサイクル日数計算のみで判定する）
 *
 * 140〜146行目：工程別の日次集計の書き込み先（B列に工程名ラベルが既に入力済み）
 *   140:菌床入れ 141:芽かき 142:収穫 143:注水 144:散水(対象外・書き込まない) 145:廃棄 146:稼働コンテナ数
 *   C列以降が日次データの書き込み列。どの列がどの日付に対応するかは、シート内の日付ヘッダー行
 *   （実際の日付型セルが横に並んでいる行）を自動検出して判定する（行番号をハードコードしない）。
 *   既存の実績側GAS（工程カウント.gs）と同様、日付ヘッダー行に応じて右方向に自動展開する設計とし、
 *   対象日の列が無い場合は「直前の日付列の翌日」であることを確認した上で新しい列を追加する。
 *
 * ── 60日サイクルモデル（確定済み仕様）─────────────────────────
 * サイクル日目 = (対象日 − 投入日).days + 1。1〜60の範囲内のみ「稼働中」として扱う。
 * 1日目:菌床入れ / 2,4日目:稼働のみ(工程なし) / 3,5日目:芽かき /
 * 6〜14日目:収穫(1回目) / 15日目:注水 / 16〜29日目:収穫(1回目つづき) /
 * 30〜39日目:培養(工程なし・稼働のみ) / 40日目:注水 / 41〜45日目:培養(工程なし・稼働のみ) /
 * 46〜59日目:収穫(2回目) / 60日目:廃棄
 * 散水は今回対象外（将来別途検討）。
 * ────────────────────────────────────────────────────────
 */

const STAGE2B_PLAN_SHEET_ID = '1WSCF2cXJsMRW5Y007SbhaLhimE3p8tYgAqcoJcfR_W4'; // 26/生産計画
const STAGE2B_INABE_SHEET_NAME = 'いなべ(700g)';
const STAGE2B_BASE_BEDS = 2520;

const STAGE2B_CONTAINER_DATA_START_ROW = 4; // 行4以降がコンテナ行
const STAGE2B_CONTAINER_MAX_SCAN_ROW = 139;  // 140行目(集計行)の手前まで
const STAGE2B_COL_A_PLANT_MONTH = 1; // A列
const STAGE2B_COL_B_NO = 2;          // B列
const STAGE2B_COL_C_PLANT_DATE = 3;  // C列
const STAGE2B_COL_D_BEDS = 4;        // D列

const STAGE2B_SUMMARY_ROWS = {
  kikodo: 140,  // 菌床入れ
  mekaki: 141,  // 芽かき
  harvest: 142, // 収穫
  chusui: 143,  // 注水
  // 144: 散水は対象外のため書き込まない
  haiki: 145,   // 廃棄
  active: 146,  // 稼働コンテナ数
};
const STAGE2B_DATE_HEADER_SEARCH_MIN_ROW = 1;
const STAGE2B_DATE_HEADER_SEARCH_MAX_ROW = 139; // 集計行より上を探索
const STAGE2B_DATE_HEADER_SEARCH_MIN_COL = 3;   // C列以降を探索
const STAGE2B_DATE_HEADER_MIN_DATE_CELLS = 20;  // これ未満のDateセル数の行は日付ヘッダーとみなさない

// サイクル日目(1-60)から工程キーを返す。null=工程なし(稼働のみ)
function stage2b_processForCycleDay(cycleDay) {
  if (cycleDay === 1) return 'kikodo';
  if (cycleDay === 3 || cycleDay === 5) return 'mekaki';
  if (cycleDay === 15 || cycleDay === 40) return 'chusui';
  if (cycleDay === 60) return 'haiki';
  if ((cycleDay >= 6 && cycleDay <= 14) || (cycleDay >= 16 && cycleDay <= 29) || (cycleDay >= 46 && cycleDay <= 59)) return 'harvest';
  return null;
}

function stage2b_daysDiff(from, to) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

// A列(投入月)セルから年(・可能なら月)を抽出する。Date型 or "yyyy/M/d","yyyy/M"文字列を許容
function stage2b_parsePlantMonthLabel(cellValue) {
  if (cellValue instanceof Date && !isNaN(cellValue.getTime())) {
    return { year: cellValue.getFullYear(), month: cellValue.getMonth() + 1 };
  }
  if (typeof cellValue === 'string') {
    const m = cellValue.trim().match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
  }
  return null;
}

// C列(投入日)セルを解析する。Date型はそのまま使用。"M/D"形式の文字列は年なしのため
// carriedYear(直近のA列ラベルから引き継いだ年)で補完する
function stage2b_parsePlantDate(cellValue, carriedYear) {
  if (cellValue instanceof Date && !isNaN(cellValue.getTime())) {
    return { date: new Date(cellValue.getFullYear(), cellValue.getMonth(), cellValue.getDate()), warning: null };
  }
  if (typeof cellValue === 'string') {
    const m = cellValue.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) {
      if (!carriedYear) return { date: null, warning: '投入日が"M/D"形式だが、年を補完するための投入月ラベルがまだ現れていません' };
      const month = Number(m[1]), day = Number(m[2]);
      return { date: new Date(carriedYear, month - 1, day), warning: null };
    }
  }
  return { date: null, warning: '投入日(C列)を日付として解釈できません(値=' + cellValue + ')' };
}

// コンテナ行(4行目〜)を読み取り、{plantDate, beds, rowNum}の配列を返す。
// B列(No.)が連続して埋まっている範囲をコンテナ行とみなし、空白で打ち切る
function stage2b_readContainers(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), STAGE2B_COL_D_BEDS);
  const maxScanRow = Math.min(sheet.getLastRow(), STAGE2B_CONTAINER_MAX_SCAN_ROW);
  if (maxScanRow < STAGE2B_CONTAINER_DATA_START_ROW) return { containers: [], warnings: ['コンテナ行が見つかりません'] };

  const numRows = maxScanRow - STAGE2B_CONTAINER_DATA_START_ROW + 1;
  const values = sheet.getRange(STAGE2B_CONTAINER_DATA_START_ROW, 1, numRows, Math.min(lastCol, STAGE2B_COL_D_BEDS)).getValues();

  const containers = [];
  const warnings = [];
  let carriedYear = null;
  let reachedEnd = false;

  for (let i = 0; i < values.length; i++) {
    const rowNum = STAGE2B_CONTAINER_DATA_START_ROW + i;
    const aVal = values[i][STAGE2B_COL_A_PLANT_MONTH - 1];
    const bVal = values[i][STAGE2B_COL_B_NO - 1];
    const cVal = values[i][STAGE2B_COL_C_PLANT_DATE - 1];
    const dVal = values[i][STAGE2B_COL_D_BEDS - 1];

    if (bVal === '' || bVal === null) {
      reachedEnd = true;
      break; // No.が空白＝コンテナ行の終端
    }

    const monthLabel = stage2b_parsePlantMonthLabel(aVal);
    if (monthLabel) carriedYear = monthLabel.year;

    const beds = typeof dVal === 'number' ? dVal : Number(dVal);
    if (!beds || beds <= 0) {
      warnings.push('行' + rowNum + ': 床数(D列)が数値として読み取れません(値=' + dVal + ')。この行はスキップしました');
      continue;
    }

    const parsed = stage2b_parsePlantDate(cVal, carriedYear);
    if (!parsed.date) {
      warnings.push('行' + rowNum + ': ' + parsed.warning);
      continue;
    }

    containers.push({ rowNum: rowNum, plantDate: parsed.date, beds: beds });
  }

  if (!reachedEnd) {
    warnings.push('警告: コンテナ行の終端(B列空白)が見つからないまま集計行付近(' + STAGE2B_CONTAINER_MAX_SCAN_ROW + '行目)に達しました。範囲設定を見直してください');
  }

  return { containers: containers, warnings: warnings };
}

// targetDateにおける工程別集計を計算する（純粋関数。シートを読まない）
function stage2b_computeDailyCounts(containers, targetDate) {
  const result = { kikodo: 0, mekaki: 0, harvest: 0, chusui: 0, haiki: 0, active: 0 };
  const detail = [];
  containers.forEach(function (c) {
    const cycleDay = stage2b_daysDiff(c.plantDate, targetDate) + 1;
    if (cycleDay < 1 || cycleDay > 60) return;
    const weight = c.beds / STAGE2B_BASE_BEDS;
    result.active += weight;
    const process = stage2b_processForCycleDay(cycleDay);
    if (process) result[process] += weight;
    detail.push({ rowNum: c.rowNum, plantDate: Utilities.formatDate(c.plantDate, Session.getScriptTimeZone(), 'yyyy/MM/dd'), cycleDay: cycleDay, process: process || '(稼働のみ)' });
  });
  return { totals: result, detail: detail };
}

// 日付ヘッダー行を自動検出する（Date型セルが最も多く並んでいる行を採用）
function stage2b_findDateHeaderRow(sheet) {
  const lastCol = sheet.getLastColumn();
  const numCols = lastCol - STAGE2B_DATE_HEADER_SEARCH_MIN_COL + 1;
  if (numCols <= 0) return null;

  const numRows = STAGE2B_DATE_HEADER_SEARCH_MAX_ROW - STAGE2B_DATE_HEADER_SEARCH_MIN_ROW + 1;
  const values = sheet.getRange(STAGE2B_DATE_HEADER_SEARCH_MIN_ROW, STAGE2B_DATE_HEADER_SEARCH_MIN_COL, numRows, numCols).getValues();

  let bestRow = -1, bestCount = 0;
  const candidates = [];
  for (let i = 0; i < values.length; i++) {
    const count = values[i].filter(function (v) { return v instanceof Date && !isNaN(v.getTime()); }).length;
    if (count > 0) candidates.push({ row: STAGE2B_DATE_HEADER_SEARCH_MIN_ROW + i, count: count });
    if (count > bestCount) { bestCount = count; bestRow = STAGE2B_DATE_HEADER_SEARCH_MIN_ROW + i; }
  }

  Logger.log('日付ヘッダー行の候補: ' + JSON.stringify(candidates));
  if (bestCount < STAGE2B_DATE_HEADER_MIN_DATE_CELLS) {
    Logger.log('❌ 日付ヘッダー行を確定できませんでした(最大候補: 行' + bestRow + ' Date型セル数=' + bestCount + ')');
    return null;
  }
  Logger.log('✅ 日付ヘッダー行を検出: 行' + bestRow + '（Date型セル数=' + bestCount + '）');
  return bestRow;
}

// 日付ヘッダー行の中からtargetDateに一致する列を探す。無ければ「直前列の翌日」である場合のみ
// 新しい列を1つ追加する（自動展開）。それ以外は例外を投げて処理を中断する（安全のため推測はしない）
function stage2b_findOrAppendDateColumn(sheet, dateHeaderRow, targetDate) {
  const lastCol = sheet.getLastColumn();
  const numCols = lastCol - STAGE2B_DATE_HEADER_SEARCH_MIN_COL + 1;
  const rowRange = sheet.getRange(dateHeaderRow, STAGE2B_DATE_HEADER_SEARCH_MIN_COL, 1, numCols);
  const values = rowRange.getValues()[0];

  let lastDateCol = -1, lastDateVal = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!(v instanceof Date) || isNaN(v.getTime())) continue;
    const col = STAGE2B_DATE_HEADER_SEARCH_MIN_COL + i;
    if (stage2b_sameDate(v, targetDate)) {
      Logger.log('対象日(' + stage2b_fmtDate(targetDate) + ')の列を発見: 列' + col);
      return col;
    }
    lastDateCol = col;
    lastDateVal = v;
  }

  if (lastDateCol === -1) {
    throw new Error('日付ヘッダー行(行' + dateHeaderRow + ')にDate型セルが1つも見つかりませんでした');
  }
  if (stage2b_daysDiff(lastDateVal, targetDate) !== 1) {
    throw new Error('対象日(' + stage2b_fmtDate(targetDate) + ')の列が見つからず、また既存の最終日付列(' + stage2b_fmtDate(lastDateVal)
      + ' / 列' + lastDateCol + ')の翌日でもないため、自動追加を中断しました（想定外のギャップの可能性）');
  }

  const newCol = lastDateCol + 1;
  const newDateCell = sheet.getRange(dateHeaderRow, newCol);
  newDateCell.setValue(targetDate).setNumberFormat('yyyy/MM/dd');
  Logger.log('日付ヘッダー行に新しい列を追加: 列' + newCol + ' = ' + stage2b_fmtDate(targetDate));
  return newCol;
}

function stage2b_sameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function stage2b_fmtDate(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy/MM/dd');
}

/**
 * targetDateの工程別集計を計算し、140〜146行目の該当列に書き込む。
 * 散水(144行目)は対象外のため書き込まない。
 */
function stage2b_writeInabeDailyCounts(targetYear, targetMonth, targetDay) {
  const targetDate = new Date(targetYear, targetMonth - 1, targetDay);
  const ss = SpreadsheetApp.openById(STAGE2B_PLAN_SHEET_ID);
  const sheet = ss.getSheetByName(STAGE2B_INABE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ シートが見つかりません: ' + STAGE2B_INABE_SHEET_NAME);
    return;
  }

  Logger.log('=== いなべ(700g) ' + stage2b_fmtDate(targetDate) + ' 日次コンテナ数書き込み ===');

  const { containers, warnings: readWarnings } = stage2b_readContainers(sheet);
  Logger.log('コンテナ行読み取り件数: ' + containers.length + '件');
  readWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  const { totals, detail } = stage2b_computeDailyCounts(containers, targetDate);
  Logger.log('計算結果: 菌床入れ=' + totals.kikodo + ' 芽かき=' + totals.mekaki + ' 収穫=' + totals.harvest
    + ' 注水=' + totals.chusui + ' 廃棄=' + totals.haiki + ' 稼働コンテナ数=' + totals.active);
  Logger.log('対象日に稼働中のコンテナ内訳(' + detail.length + '件): ' + JSON.stringify(detail));

  const dateHeaderRow = stage2b_findDateHeaderRow(sheet);
  if (!dateHeaderRow) {
    Logger.log('❌ 日付ヘッダー行が特定できなかったため、書き込みを中断しました');
    return;
  }

  let targetCol;
  try {
    targetCol = stage2b_findOrAppendDateColumn(sheet, dateHeaderRow, targetDate);
  } catch (e) {
    Logger.log('❌ 書き込み列の特定に失敗したため中断しました: ' + e.message);
    return;
  }

  sheet.getRange(STAGE2B_SUMMARY_ROWS.kikodo, targetCol).setValue(totals.kikodo);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.mekaki, targetCol).setValue(totals.mekaki);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.harvest, targetCol).setValue(totals.harvest);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.chusui, targetCol).setValue(totals.chusui);
  // 144行目(散水)は対象外のため書き込まない
  sheet.getRange(STAGE2B_SUMMARY_ROWS.haiki, targetCol).setValue(totals.haiki);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.active, targetCol).setValue(totals.active);

  Logger.log('✅ 列' + targetCol + '（' + stage2b_fmtDate(targetDate) + '）に書き込み完了');
}

// Step 1: 7/1分のみを書き込む
function writeInabeDailyCounts_Step1() {
  stage2b_writeInabeDailyCounts(2026, 7, 1);
}

// Step 2: 7/1の書き込みが期待値と一致した後、7/2分を追加で書き込む
function writeInabeDailyCounts_Step2() {
  stage2b_writeInabeDailyCounts(2026, 7, 2);
}
