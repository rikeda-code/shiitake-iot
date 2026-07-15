/**
 * 要員計画：栽培工数（いなべ(700g)）日次コンテナ数のシート内書き込み（方針転換後）
 *
 * 【方針転換の背景】
 * ダッシュボードJS側でのgviz直読み＋ブラウザ内計算をやめ、GAS側で
 * 「26/生産計画」ファイルの各拠点ガントシートに日次の工程別コンテナ数を直接書き込む方式に変更した。
 * このファイルは「いなべ(700g)」シートへの書き込みの検証（Step 1: 7/1分のみ→Step 2: 7/2分を追加）を行う。
 * 月次集計して「整理済み_計画_更新」シートへ書き込む処理は後続で実装する。
 *
 * ── シート構造（ユーザーが添付画像で実データを確認した内容。旧想定から修正）─────
 * 行1：タイトル
 * 行2：投入月の色凡例（"7月投入","8月投入"等の帯）
 * 行3：列ヘッダー（A〜D列に"投入月","No.","投入日","床数"）＋ 月ラベル（"2026/7"等、
 *      各月ブロックの最初の列にのみ記載。Date型ではなく文字列の場合がある）
 * 行4：その月の日にち（27,28,29,30,1,2,3,...という、月ブロックごとに1〜31へリセットされる
 *      単純な整数。Date型ではない）
 * 行5以降：コンテナ行
 *   A列：投入月（月初の行にのみラベルあり。日付型セル or 文字列の場合がある）
 *   B列：No.（コンテナ通し番号。全コンテナ行で連続して埋まっている前提でコンテナ行範囲を検出する）
 *   C列：投入日。型が不統一で、6月分は日付型(Date)、7月分は文字列「7/1」形式（年なし）。
 *        文字列の場合は直近のA列ラベルから年を補完する
 *   D列：床数（基準2520。異なる場合は係数=床数/2520で重み付け）
 *   E列以降：既存の収穫量ガント（今回の日次集計では読まない。投入日からのサイクル日数計算のみで判定する）
 *
 * 列→実際の日付の復元方法：行3の月ラベル（各月ブロック先頭列にのみ存在）を「現在の年月」として
 * 保持しながら列を左から右へ走査し、行4の日にち(整数)と組み合わせて各列の実際の日付を復元する
 * （Date型セルの有無で日付ヘッダー行を検出する方式は、生産計画サマリーシート調査の教訓と同じ
 * 「見た目だけで型を推測する」誤りだったため廃止した）。
 *
 * 140〜146行目：工程別の日次集計の書き込み先（B列に工程名ラベルが既に入力済み）
 *   140:菌床入れ 141:芽かき 142:収穫 143:注水 144:散水(対象外・書き込まない) 145:廃棄 146:稼働コンテナ数
 *   書き込み列は、上記で復元した列→日付マップから対象日に一致する列を探して決定する
 *   （行3・行4と同じ絶対列位置を使う）。対象日の列が既存データに無い場合、今回は自動追加を
 *   行わずエラーとして中断する（月境界での日にちリセット・月ラベル追加を伴う自動展開は複雑なため、
 *   誤った書き込みを避ける目的で今回のStepでは未実装。既存の列に対する書き込みのみ対応）。
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

const STAGE2B_HEADER_LABEL_ROW = 3; // 投入月/No./投入日/床数の列ヘッダー ＋ 月ラベル(各月ブロック先頭列のみ)
const STAGE2B_DAY_NUMBER_ROW = 4;   // その月の日にち(1〜31、月ブロックごとにリセットされる整数。Date型ではない)
const STAGE2B_CONTAINER_DATA_START_ROW = 5; // 行5以降がコンテナ行(添付画像確認により4→5に修正)
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
const STAGE2B_HEADER_SCAN_MIN_COL = 3; // C列から探索(A-D列の固定ラベルは正規表現・整数判定で自然に除外される)

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

// value(セルの値)が日付として扱えるかをinstanceof Dateではなくダックタイピングで判定する。
// Apps Scriptでは、getValues()で返るDateオブジェクトが実行コンテキストによって
// 別レルム(realm)由来になり、instanceof Dateがfalseを返すことがある既知の問題があるため、
// getFullYear/getMonth/getDate/getTimeが関数として存在するかで判定する
function stage2b_isDateLike(value) {
  if (value === null || typeof value !== 'object') return false;
  if (typeof value.getFullYear !== 'function' || typeof value.getMonth !== 'function'
    || typeof value.getDate !== 'function' || typeof value.getTime !== 'function') return false;
  const t = value.getTime();
  return typeof t === 'number' && !isNaN(t);
}

// 年月を表すセルから年・月を抽出する。Date型(実体はダックタイピングで判定) or
// "yyyy/M/d","yyyy/M"文字列を許容。コンテナ行のA列(投入月)、行3の月ラベルの両方で使う共通処理
function stage2b_parseYearMonthCell(cellValue) {
  if (stage2b_isDateLike(cellValue)) {
    // タイムゾーンによるズレを避けるため、toString()等を経由せずgetFullYear()/getMonth()を直接使う
    return { year: cellValue.getFullYear(), month: cellValue.getMonth() + 1 };
  }
  if (typeof cellValue === 'string') {
    const m = cellValue.trim().match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
  }
  return null;
}

// C列(投入日)セルを解析する。Date型(ダックタイピングで判定)はそのまま使用。
// "M/D"形式の文字列は年なしのためcarriedYear(直近のA列ラベルから引き継いだ年)で補完する
function stage2b_parsePlantDate(cellValue, carriedYear) {
  if (stage2b_isDateLike(cellValue)) {
    // タイムゾーンによるズレを避けるため、getFullYear()/getMonth()/getDate()を直接使う
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
  return { date: null, warning: '投入日(C列)を日付として解釈できません(値=' + stage2b_debugValue(cellValue) + ')' };
}

// 警告ログ用に、値をタイムゾーンの誤解を招かない形で文字列化する。
// Dateらしき値をそのまま文字列連結するとtoString()が実行環境既定のタイムゾーンで
// 展開され紛らわしいため、ここで明示的に型情報を添えて表示する
function stage2b_debugValue(value) {
  if (stage2b_isDateLike(value)) {
    return 'Date(' + value.getFullYear() + '/' + (value.getMonth() + 1) + '/' + value.getDate() + ')';
  }
  return String(value);
}

// コンテナ行(5行目〜)を読み取り、{plantDate, beds, rowNum}の配列を返す。
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

    const monthLabel = stage2b_parseYearMonthCell(aVal);
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

// targetDateにおける工程別集計を計算する（tzはログ表示専用。日付の比較自体は
// getFullYear/getMonth/getDateのコンポーネント単位で行うためタイムゾーンの影響を受けない）
function stage2b_computeDailyCounts(containers, targetDate, tz) {
  const result = { kikodo: 0, mekaki: 0, harvest: 0, chusui: 0, haiki: 0, active: 0 };
  const detail = [];
  containers.forEach(function (c) {
    const cycleDay = stage2b_daysDiff(c.plantDate, targetDate) + 1;
    if (cycleDay < 1 || cycleDay > 60) return;
    const weight = c.beds / STAGE2B_BASE_BEDS;
    result.active += weight;
    const process = stage2b_processForCycleDay(cycleDay);
    if (process) result[process] += weight;
    detail.push({ rowNum: c.rowNum, plantDate: stage2b_fmtDate(c.plantDate, tz), cycleDay: cycleDay, process: process || '(稼働のみ)' });
  });
  return { totals: result, detail: detail };
}

// 行4(日にち)セルが1〜31の整数として解釈できるか判定する
function stage2b_isDayNumberCell(cellValue) {
  const n = typeof cellValue === 'number' ? cellValue
    : (typeof cellValue === 'string' && cellValue.trim() !== '' ? Number(cellValue) : NaN);
  return Number.isInteger(n) && n >= 1 && n <= 31;
}

// 行3(月ラベル)・行4(日にち)を左から右へ走査し、列→実際の日付のマップを構築する。
// 月ラベルは各月ブロックの先頭列にのみ存在するため、直近に見つかったラベルを
// 「現在の年月」として保持しながら、行4の日にち(整数)と組み合わせて日付を復元する
function stage2b_buildColumnDateMap(sheet) {
  const lastCol = sheet.getLastColumn();
  const width = lastCol - STAGE2B_HEADER_SCAN_MIN_COL + 1;
  if (width <= 0) return { dateMap: {}, warnings: ['列範囲が不正です(lastCol=' + lastCol + ')'] };

  const monthLabels = sheet.getRange(STAGE2B_HEADER_LABEL_ROW, STAGE2B_HEADER_SCAN_MIN_COL, 1, width).getValues()[0];
  const dayNumbers = sheet.getRange(STAGE2B_DAY_NUMBER_ROW, STAGE2B_HEADER_SCAN_MIN_COL, 1, width).getValues()[0];

  const dateMap = {};
  const warnings = [];
  let currentYear = null, currentMonth = null;
  let monthLabelCount = 0, dayNumberCount = 0;
  const monthLabelHits = [];

  for (let i = 0; i < width; i++) {
    const col = STAGE2B_HEADER_SCAN_MIN_COL + i;
    const label = stage2b_parseYearMonthCell(monthLabels[i]);
    if (label) {
      currentYear = label.year; currentMonth = label.month; monthLabelCount++;
      monthLabelHits.push('列' + col + '=' + label.year + '/' + label.month);
    }

    if (!stage2b_isDayNumberCell(dayNumbers[i])) continue;
    const day = typeof dayNumbers[i] === 'number' ? dayNumbers[i] : Number(dayNumbers[i]);
    dayNumberCount++;
    if (currentYear == null) {
      warnings.push('列' + col + ': 日にち(' + day + ')はあるが、月ラベルがまだ現れていないため年月を特定できません');
      continue;
    }
    dateMap[col] = new Date(currentYear, currentMonth - 1, day);
  }

  Logger.log('行' + STAGE2B_HEADER_LABEL_ROW + '(月ラベル)検出: ' + monthLabelCount + '件 ' + JSON.stringify(monthLabelHits));
  Logger.log('行' + STAGE2B_DAY_NUMBER_ROW + '(日にち)整数セル検出: ' + dayNumberCount + '件 / 復元できた日付列数: ' + Object.keys(dateMap).length);

  return { dateMap: dateMap, warnings: warnings };
}

// dateMapからtargetDateに一致する列を探す。見つからなければnull(このStepでは自動追加しない)
function stage2b_findColumnForDate(dateMap, targetDate) {
  const cols = Object.keys(dateMap).map(Number).sort(function (a, b) { return a - b; });
  for (let i = 0; i < cols.length; i++) {
    if (stage2b_sameDate(dateMap[cols[i]], targetDate)) return cols[i];
  }
  return null;
}

function stage2b_sameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// ログ表示用の日付フォーマット。スプレッドシートのタイムゾーン(呼び出し側から明示的に渡す)を使う。
// Session.getScriptTimeZone()(スクリプト側の既定タイムゾーン)とスプレッドシートのタイムゾームが
// 食い違っていると表示がずれるため、必ずss.getSpreadsheetTimeZone()の値を渡すこと
function stage2b_fmtDate(d, tz) {
  return Utilities.formatDate(d, tz, 'yyyy/MM/dd');
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
  // ログ表示専用。Session.getScriptTimeZone()(標準スタンドアロンプロジェクトでは既定でUTC等になり
  // うる)ではなく、必ずこのスプレッドシート自体のタイムゾーンを使う(日付の比較ロジック自体には
  // 影響しない。getFullYear/getMonth/getDateのコンポーネント単位で判定しているため)
  const tz = ss.getSpreadsheetTimeZone();

  Logger.log('=== いなべ(700g) ' + stage2b_fmtDate(targetDate, tz) + ' 日次コンテナ数書き込み ===');

  const { containers, warnings: readWarnings } = stage2b_readContainers(sheet);
  Logger.log('コンテナ行読み取り件数: ' + containers.length + '件');
  readWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  const { totals, detail } = stage2b_computeDailyCounts(containers, targetDate, tz);
  Logger.log('計算結果: 菌床入れ=' + totals.kikodo + ' 芽かき=' + totals.mekaki + ' 収穫=' + totals.harvest
    + ' 注水=' + totals.chusui + ' 廃棄=' + totals.haiki + ' 稼働コンテナ数=' + totals.active);
  Logger.log('対象日に稼働中のコンテナ内訳(' + detail.length + '件): ' + JSON.stringify(detail));

  const { dateMap, warnings: mapWarnings } = stage2b_buildColumnDateMap(sheet);
  mapWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  const resolvedDates = Object.keys(dateMap).map(function (c) { return dateMap[c]; });
  if (resolvedDates.length > 0) {
    const sorted = resolvedDates.slice().sort(function (a, b) { return a - b; });
    Logger.log('復元できた日付の範囲: ' + stage2b_fmtDate(sorted[0], tz) + ' 〜 ' + stage2b_fmtDate(sorted[sorted.length - 1], tz));
  }

  const targetCol = stage2b_findColumnForDate(dateMap, targetDate);
  if (!targetCol) {
    Logger.log('❌ 対象日(' + stage2b_fmtDate(targetDate, tz) + ')に対応する列が見つかりませんでした。書き込みを中断しました'
      + '（今回のStepでは列の自動追加は行いません）');
    return;
  }
  Logger.log('対象日(' + stage2b_fmtDate(targetDate, tz) + ')の列を検出: 列' + targetCol);

  sheet.getRange(STAGE2B_SUMMARY_ROWS.kikodo, targetCol).setValue(totals.kikodo);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.mekaki, targetCol).setValue(totals.mekaki);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.harvest, targetCol).setValue(totals.harvest);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.chusui, targetCol).setValue(totals.chusui);
  // 144行目(散水)は対象外のため書き込まない
  sheet.getRange(STAGE2B_SUMMARY_ROWS.haiki, targetCol).setValue(totals.haiki);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.active, targetCol).setValue(totals.active);

  Logger.log('✅ 列' + targetCol + '（' + stage2b_fmtDate(targetDate, tz) + '）に書き込み完了');
}

// Step 1: 7/1分のみを書き込む
function writeInabeDailyCounts_Step1() {
  stage2b_writeInabeDailyCounts(2026, 7, 1);
}

// Step 2: 7/1の書き込みが期待値と一致した後、7/2分を追加で書き込む
function writeInabeDailyCounts_Step2() {
  stage2b_writeInabeDailyCounts(2026, 7, 2);
}
