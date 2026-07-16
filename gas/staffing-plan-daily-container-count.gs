/**
 * 要員計画：栽培工数（いなべ(700g)）日次コンテナ数のシート内書き込み（方針転換後）
 *
 * 【方針転換の背景】
 * ダッシュボードJS側でのgviz直読み＋ブラウザ内計算をやめ、GAS側で
 * 「26/生産計画」ファイルの各拠点ガントシートに日次の工程別コンテナ数を直接書き込む方式に変更した。
 * このファイルは「いなべ(700g)」シートへの書き込みの検証（Step 1: 7/1分→Step 2: 7/2分を追加）に加え、
 * 「ファーム勤務時間」ファイルの「整理済み_計画_更新」シートへの書き込みテストも行う。
 * Step 1はいなべ(700g)への書き込みのみ。Step 2はいなべ(700g)に7/2分を追記した後、
 * いなべ(700g)の140〜146行目から7/1・7/2の値を読み戻して合算し、その合計値で
 * 「整理済み_計画_更新」M列(2026/7)の5〜11行目を上書きする。
 *
 * さらに、任意の日付範囲（複数月にまたがってもよい）をまとめて処理する日付範囲版として
 * stage2b_writeInabeDailyCountsRange()（いなべ(700g)への日次書き込みをループで実行）と
 * stage2b_writeSeiriAggregate()（対象日を暦月ごとにグループ化して合算し、各月に対応する列
 * (2026/6→L, 2026/7→M, 2026/8→N, ...stage2b_seiriColumnForMonth参照)へそれぞれ書き込む）
 * を用意した。writeInabeDailyCounts_Range_test()はこの2つを6/30〜8/1（月境界2箇所）で
 * 通しで実行するテストエントリーポイント。
 *
 * ただし月次集計（月末締めでの合算）は「範囲内に明示的に指定された日のみを対象月の実績として
 * 合算する」簡易実装であり、当該月の残り日数を自動的に含める仕組みはまだ実装していない
 * (範囲に含まれない日付・月の列は一切変更しない)。月が変わっても自動で対象範囲が
 * 広がっていく本格的な月次集計ロジックの実装は後続のStepで行う。
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

// 「ファーム勤務時間」ファイル内「整理済み_計画_更新」シートへの書き込み先。
// 月ごとの列は、基準点(2026/7=M列=13)からの月差で算出する(stage2b_seiriColumnForMonth参照)
const STAGE2B_FARM_HOURS_FILE_ID = '1LtYb1feXR6jtIEfxaADLiTEWpPabKJDDlwoS1V-yuG0'; // ファーム勤務時間
const STAGE2B_SEIRI_SHEET_NAME = '整理済み_計画_更新';
const STAGE2B_SEIRI_ANCHOR_YEAR = 2026;
const STAGE2B_SEIRI_ANCHOR_MONTH = 7;
const STAGE2B_SEIRI_ANCHOR_COL = 13; // M列(2026/7)
const STAGE2B_SEIRI_ROWS = {
  kikodo: 5,   // 菌床入れ
  mekaki: 6,   // 芽かき
  harvest: 7,  // 収穫
  chusui: 8,   // 注水
  // 9: 散水は対象外のため書き込まない
  haiki: 10,   // 廃棄
  active: 11,  // 稼働コンテナ数
};

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

// Dateらしき値(セルの実際の値)から、対象スプレッドシートのタイムゾーンにおける年/月/日を取り出す。
// cellValue.getFullYear()等を直接呼ぶと、Apps Scriptプロジェクトの実行タイムゾーン(スプレッドシートの
// タイムゾーンとは限らない)で解釈されてしまい、両者が食い違う場合に日付が1日ずれることがある
// (実際に「行3の月ラベルが本来7/1のはずが6/30として読まれる」という不具合の原因だった)。
// そのため、必ずUtilities.formatDate()でtzを明示して年月日を取り出す
function stage2b_extractYmd(cellValue, tz) {
  const parts = Utilities.formatDate(cellValue, tz, 'yyyy,M,d').split(',');
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

// 年月を表すセルから年・月を抽出する。Date型(実体はダックタイピングで判定) or
// "yyyy/M/d","yyyy/M"文字列を許容。コンテナ行のA列(投入月)、行3の月ラベルの両方で使う共通処理
// 全角数字・全角スラッシュを半角に変換する(全角入力された月ラベル等でも正しくパースできるようにするため)
function stage2b_normalizeDigits(str) {
  return str.replace(/[０-９]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30);
  }).replace(/／/g, '/');
}

function stage2b_parseYearMonthCell(cellValue, tz) {
  if (stage2b_isDateLike(cellValue)) {
    const ymd = stage2b_extractYmd(cellValue, tz);
    return { year: ymd.year, month: ymd.month };
  }
  if (typeof cellValue === 'string') {
    const normalized = stage2b_normalizeDigits(cellValue.trim());
    let m = normalized.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
    // "2026年8月"のような表記にも対応する(月によって表記が異なっているケースへの保険)
    m = normalized.match(/^(\d{4})年(\d{1,2})月$/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
  }
  return null;
}

// C列(投入日)セルを解析する。Date型(ダックタイピングで判定)は対象スプレッドシートのタイムゾーンで
// 年月日を取り出す。"M/D"形式の文字列は年なしのためcarriedYear(直近のA列ラベルから引き継いだ年)で補完する
function stage2b_parsePlantDate(cellValue, tz, carriedYear) {
  if (stage2b_isDateLike(cellValue)) {
    const ymd = stage2b_extractYmd(cellValue, tz);
    return { date: new Date(ymd.year, ymd.month - 1, ymd.day), warning: null };
  }
  if (typeof cellValue === 'string') {
    const m = cellValue.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) {
      if (!carriedYear) return { date: null, warning: '投入日が"M/D"形式だが、年を補完するための投入月ラベルがまだ現れていません' };
      const month = Number(m[1]), day = Number(m[2]);
      return { date: new Date(carriedYear, month - 1, day), warning: null };
    }
  }
  return { date: null, warning: '投入日(C列)を日付として解釈できません(値=' + stage2b_debugValue(cellValue, tz) + ')' };
}

// 警告ログ用に、値をタイムゾーンの誤解を招かない形で文字列化する
function stage2b_debugValue(value, tz) {
  if (stage2b_isDateLike(value)) {
    const ymd = stage2b_extractYmd(value, tz);
    return 'Date(' + ymd.year + '/' + ymd.month + '/' + ymd.day + ')';
  }
  return String(value);
}

// コンテナ行(5行目〜)を読み取り、{plantDate, beds, rowNum}の配列を返す。
// B列(No.)が連続して埋まっている範囲をコンテナ行とみなし、空白で打ち切る
function stage2b_readContainers(sheet, tz) {
  const lastCol = Math.max(sheet.getLastColumn(), STAGE2B_COL_D_BEDS);
  const maxScanRow = Math.min(sheet.getLastRow(), STAGE2B_CONTAINER_MAX_SCAN_ROW);
  if (maxScanRow < STAGE2B_CONTAINER_DATA_START_ROW) return { containers: [], warnings: ['コンテナ行が見つかりません'] };

  const numRows = maxScanRow - STAGE2B_CONTAINER_DATA_START_ROW + 1;
  const values = sheet.getRange(STAGE2B_CONTAINER_DATA_START_ROW, 1, numRows, Math.min(lastCol, STAGE2B_COL_D_BEDS)).getValues();

  const containers = [];
  const warnings = [];
  let carriedYear = null;
  let blankRowCount = 0;

  for (let i = 0; i < values.length; i++) {
    const rowNum = STAGE2B_CONTAINER_DATA_START_ROW + i;
    const aVal = values[i][STAGE2B_COL_A_PLANT_MONTH - 1];
    const bVal = values[i][STAGE2B_COL_B_NO - 1];
    const cVal = values[i][STAGE2B_COL_C_PLANT_DATE - 1];
    const dVal = values[i][STAGE2B_COL_D_BEDS - 1];

    // B列(No.)が空白の行は、月ブロック間の区切り行等でありうる(コンテナ行の終端とは限らない)。
    // 以前はここで走査を打ち切っていたが、それだと区切り行より下の全コンテナが読み落とされる
    // 不具合があったため、この行だけスキップして以降の行も引き続き読み進めるようにした。
    // 走査範囲自体はSTAGE2B_CONTAINER_MAX_SCAN_ROW(集計行の手前)で区切られる
    if (bVal === '' || bVal === null) {
      blankRowCount++;
      continue;
    }

    const monthLabel = stage2b_parseYearMonthCell(aVal, tz);
    if (monthLabel) carriedYear = monthLabel.year;

    const beds = typeof dVal === 'number' ? dVal : Number(dVal);
    if (!beds || beds <= 0) {
      warnings.push('行' + rowNum + ': 床数(D列)が数値として読み取れません(値=' + dVal + ')。この行はスキップしました');
      continue;
    }

    const parsed = stage2b_parsePlantDate(cVal, tz, carriedYear);
    if (!parsed.date) {
      warnings.push('行' + rowNum + ': ' + parsed.warning);
      continue;
    }

    containers.push({ rowNum: rowNum, plantDate: parsed.date, beds: beds });
  }

  Logger.log('コンテナ行スキャン範囲: ' + STAGE2B_CONTAINER_DATA_START_ROW + '〜' + maxScanRow + '行目'
    + '（B列空白でスキップした行: ' + blankRowCount + '件）');

  return { containers: containers, warnings: warnings };
}

// targetDateにおける工程別集計を計算する
function stage2b_computeDailyCounts(containers, targetDate) {
  const result = { kikodo: 0, mekaki: 0, harvest: 0, chusui: 0, haiki: 0, active: 0 };
  const detail = [];
  containers.forEach(function (c) {
    const cycleDay = stage2b_daysDiff(c.plantDate, targetDate) + 1;
    if (cycleDay < 1 || cycleDay > 60) return;
    const weight = c.beds / STAGE2B_BASE_BEDS;
    // 稼働コンテナ数は実績側の既存GAS(工程カウント.gs)と同じ考え方で、床数係数を掛けない
    // 単純な+1カウントとする(工程別カウントのみ床数/基準床数の係数で重み付けする)
    result.active += 1;
    const process = stage2b_processForCycleDay(cycleDay);
    if (process) result[process] += weight;
    detail.push({ rowNum: c.rowNum, plantDate: stage2b_fmtDate(c.plantDate), cycleDay: cycleDay, process: process || '(稼働のみ)' });
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
function stage2b_buildColumnDateMap(sheet, tz) {
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
    const label = stage2b_parseYearMonthCell(monthLabels[i], tz);
    if (label) {
      currentYear = label.year; currentMonth = label.month; monthLabelCount++;
      monthLabelHits.push('列' + stage2b_colLabel(col) + '=' + label.year + '/' + label.month);
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

// 列番号(1始まり) → A1記法の列文字(A, B, ..., Z, AA, ...)。ログでスプレッドシート上の
// 実際の列と目視で突き合わせやすくするために使う
function stage2b_columnToLetter(col) {
  let result = '';
  let n = col;
  while (n > 0) {
    const r = (n - 1) % 26;
    result = String.fromCharCode(65 + r) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}
function stage2b_colLabel(col) {
  return col + '(' + stage2b_columnToLetter(col) + ')';
}
// 日付を"yyyy/MM/dd"形式で表示する。dはすべてnew Date(year, month-1, day)のように
// 年月日のコンポーネントから組み立てた値であり、実在の一瞬(タイムスタンプ)を表すものではない。
// そのため、Utilities.formatDate()でタイムゾーンを指定して再解釈すると、組み立てに使った
// タイムゾーンと表示用タイムゾーンが食い違う場合にかえって日付がずれてしまう
// (実際に「6/30を指定したのに6/29と表示される」不具合の原因だった)。
// ここではgetFullYear/getMonth/getDateを直接使い、タイムゾーン変換を一切行わない
function stage2b_fmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '/' + mm + '/' + dd;
}

// 小数点1桁に丸める(実績側の既存GAS「工程カウント.gs」のround1()と同じ考え方)
function stage2b_round1(value) {
  return Math.round(value * 10) / 10;
}

// 暦年月から「整理済み_計画_更新」シートの対象列を算出する。
// 基準点(2026/7=M列=13)からの月差で求めるため、年をまたいでも正しく計算できる
function stage2b_seiriColumnForMonth(year, month) {
  const monthDiff = (year - STAGE2B_SEIRI_ANCHOR_YEAR) * 12 + (month - STAGE2B_SEIRI_ANCHOR_MONTH);
  return STAGE2B_SEIRI_ANCHOR_COL + monthDiff;
}

// 「ファーム勤務時間」ファイルの「整理済み_計画_更新」シートの指定列(targetCol)5〜11行目に、
// いなべ(700g)から読み戻して合算した値を書き込む(テスト用。月次集計ロジックは未実装のため、
// 本来は月内全日の合計が入るべき列に、明示的に指定した日数分の合計だけが入る)。
// labelはログ表示用(例:"7/1+7/2の合計(2日分)")
function stage2b_writeToSeiriSheet(roundedTotals, label, targetCol) {
  const ss2 = SpreadsheetApp.openById(STAGE2B_FARM_HOURS_FILE_ID);
  const sheet2 = ss2.getSheetByName(STAGE2B_SEIRI_SHEET_NAME);
  if (!sheet2) {
    Logger.log('❌ 「ファーム勤務時間」ファイル内にシートが見つかりません: ' + STAGE2B_SEIRI_SHEET_NAME);
    return;
  }

  sheet2.getRange(STAGE2B_SEIRI_ROWS.kikodo, targetCol).setValue(roundedTotals.kikodo);
  sheet2.getRange(STAGE2B_SEIRI_ROWS.mekaki, targetCol).setValue(roundedTotals.mekaki);
  sheet2.getRange(STAGE2B_SEIRI_ROWS.harvest, targetCol).setValue(roundedTotals.harvest);
  sheet2.getRange(STAGE2B_SEIRI_ROWS.chusui, targetCol).setValue(roundedTotals.chusui);
  // 9行目(散水)は対象外のため書き込まない
  sheet2.getRange(STAGE2B_SEIRI_ROWS.haiki, targetCol).setValue(roundedTotals.haiki);
  sheet2.getRange(STAGE2B_SEIRI_ROWS.active, targetCol).setValue(roundedTotals.active);

  Logger.log('✅ 「整理済み_計画_更新」列' + stage2b_colLabel(targetCol) + 'の5〜11行目を上書き完了'
    + '（いなべ(700g) ' + label + '。月次集計ロジック未実装のため、'
    + '本来は当該月全日の合計が入るべき列にテストとして一部日数分のみ書き込んでいる点に注意）');
}

// いなべ(700g)の140〜146行目(指定列)から、丸め済みの値をそのまま読み戻す
function stage2b_readInabeSummaryColumn(sheet, col) {
  return {
    kikodo: sheet.getRange(STAGE2B_SUMMARY_ROWS.kikodo, col).getValue(),
    mekaki: sheet.getRange(STAGE2B_SUMMARY_ROWS.mekaki, col).getValue(),
    harvest: sheet.getRange(STAGE2B_SUMMARY_ROWS.harvest, col).getValue(),
    chusui: sheet.getRange(STAGE2B_SUMMARY_ROWS.chusui, col).getValue(),
    haiki: sheet.getRange(STAGE2B_SUMMARY_ROWS.haiki, col).getValue(),
    active: sheet.getRange(STAGE2B_SUMMARY_ROWS.active, col).getValue(),
  };
}

// 複数日分の集計値(オブジェクトの配列)を項目ごとに合算する
function stage2b_sumDayTotals(dayTotalsList) {
  const sum = { kikodo: 0, mekaki: 0, harvest: 0, chusui: 0, haiki: 0, active: 0 };
  dayTotalsList.forEach(function (t) {
    Object.keys(sum).forEach(function (k) {
      sum[k] += (typeof t[k] === 'number' ? t[k] : 0);
    });
  });
  return sum;
}

// {year,month,day}の配列を暦月ごとにグループ化する(初出順を保った月のグループ配列を返す)
function stage2b_groupDatesByMonth(dates) {
  const groups = [];
  const indexByKey = {};
  dates.forEach(function (d) {
    const key = d.year + '-' + d.month;
    if (!(key in indexByKey)) {
      indexByKey[key] = groups.length;
      groups.push({ year: d.year, month: d.month, dates: [] });
    }
    groups[indexByKey[key]].dates.push(d);
  });
  return groups;
}

/**
 * いなべ(700g)の140〜146行目から、targetDates(複数日、それぞれ{year,month,day})の値を
 * 読み戻し、暦月ごとにグループ化して合算した上で、「整理済み_計画_更新」シートの対応する列
 * (2026/6→L列, 2026/7→M列, 2026/8→N列, ...stage2b_seiriColumnForMonth参照)にそれぞれ
 * 上書きする(累積・複数月対応版)。各日の値は事前にstage2b_writeInabeDailyCounts()で
 * いなべ(700g)に書き込み済みである必要がある。targetDatesに含まれない月の列は一切変更しない。
 */
function stage2b_writeSeiriAggregate(targetDates) {
  const ss = SpreadsheetApp.openById(STAGE2B_PLAN_SHEET_ID);
  const sheet = ss.getSheetByName(STAGE2B_INABE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ シートが見つかりません: ' + STAGE2B_INABE_SHEET_NAME);
    return;
  }
  const tz = ss.getSpreadsheetTimeZone();

  const { dateMap, warnings: mapWarnings } = stage2b_buildColumnDateMap(sheet, tz);
  mapWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  const monthGroups = stage2b_groupDatesByMonth(targetDates);
  Logger.log('対象' + targetDates.length + '日分を' + monthGroups.length + 'ヶ月分にグループ化しました');

  monthGroups.forEach(function (group) {
    const dayTotalsList = [];
    const dayLabels = [];
    let missingCol = false;

    group.dates.forEach(function (d) {
      const targetDate = new Date(d.year, d.month - 1, d.day);
      const col = stage2b_findColumnForDate(dateMap, targetDate);
      if (!col) {
        Logger.log('❌ ' + stage2b_fmtDate(targetDate) + 'の列が見つからないため、' + group.year + '/' + group.month
          + '分の集計を中断しました(先にstage2b_writeInabeDailyCounts()でこの日をいなべ(700g)に書き込んでください)');
        missingCol = true;
        return;
      }
      const dayTotals = stage2b_readInabeSummaryColumn(sheet, col);
      Logger.log(stage2b_fmtDate(targetDate) + '(列' + stage2b_colLabel(col) + ')の値: ' + JSON.stringify(dayTotals));
      dayTotalsList.push(dayTotals);
      dayLabels.push(d.month + '/' + d.day);
    });
    if (missingCol) return;

    const sum = stage2b_sumDayTotals(dayTotalsList);
    const roundedSum = {
      kikodo: stage2b_round1(sum.kikodo),
      mekaki: stage2b_round1(sum.mekaki),
      harvest: stage2b_round1(sum.harvest),
      chusui: stage2b_round1(sum.chusui),
      haiki: stage2b_round1(sum.haiki),
      active: stage2b_round1(sum.active),
    };
    const seiriCol = stage2b_seiriColumnForMonth(group.year, group.month);
    Logger.log(group.year + '/' + group.month + '分(' + dayLabels.join('+') + ')の合計(丸め後): ' + JSON.stringify(roundedSum));
    stage2b_writeToSeiriSheet(roundedSum, dayLabels.join('+') + 'の合計(' + group.dates.length + '日分, ' + group.year + '/' + group.month + ')', seiriCol);
  });
}

/**
 * targetDateの工程別集計を計算し、140〜146行目の該当列に書き込む。
 * 散水(144行目)は対象外のため書き込まない。
 */
function stage2b_writeInabeDailyCounts(targetYear, targetMonth, targetDay) {
  // 呼び出し時の生の引数をそのままログに残す。ここが意図した値(例:2026,7,2)になっているかを
  // まず確認できるようにする(デプロイされたコードが最新かどうかの切り分けにも使う)
  Logger.log('[入力パラメータ] targetYear=' + targetYear + ' targetMonth=' + targetMonth + ' targetDay=' + targetDay);
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

  Logger.log('=== いなべ(700g) ' + stage2b_fmtDate(targetDate) + ' 日次コンテナ数書き込み ===');

  const { containers, warnings: readWarnings } = stage2b_readContainers(sheet, tz);
  Logger.log('コンテナ行読み取り件数: ' + containers.length + '件');
  readWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  const { totals, detail } = stage2b_computeDailyCounts(containers, targetDate);
  Logger.log('計算結果: 菌床入れ=' + totals.kikodo + ' 芽かき=' + totals.mekaki + ' 収穫=' + totals.harvest
    + ' 注水=' + totals.chusui + ' 廃棄=' + totals.haiki + ' 稼働コンテナ数=' + totals.active);
  Logger.log('対象日に稼働中のコンテナ内訳(' + detail.length + '件): ' + JSON.stringify(detail));

  const { dateMap, warnings: mapWarnings } = stage2b_buildColumnDateMap(sheet, tz);
  mapWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  const resolvedDates = Object.keys(dateMap).map(function (c) { return dateMap[c]; });
  if (resolvedDates.length > 0) {
    const sorted = resolvedDates.slice().sort(function (a, b) { return a - b; });
    Logger.log('復元できた日付の範囲: ' + stage2b_fmtDate(sorted[0]) + ' 〜 ' + stage2b_fmtDate(sorted[sorted.length - 1]));
  }

  const targetCol = stage2b_findColumnForDate(dateMap, targetDate);
  if (!targetCol) {
    Logger.log('❌ 対象日(' + stage2b_fmtDate(targetDate) + ')に対応する列が見つかりませんでした。書き込みを中断しました'
      + '（今回のStepでは列の自動追加は行いません）');
    return;
  }
  Logger.log('対象日(' + stage2b_fmtDate(targetDate) + ')の列を検出: 列' + stage2b_colLabel(targetCol));

  // 安全のための二重チェック：dateMap[targetCol]がtargetDateと本当に一致しているかを
  // 書き込み直前に再確認する。一致しなければ内部矛盾なので書き込まずに中断する
  if (!stage2b_sameDate(dateMap[targetCol], targetDate)) {
    Logger.log('❌ 内部矛盾を検出したため書き込みを中断しました: dateMap[列' + stage2b_colLabel(targetCol) + ']='
      + stage2b_fmtDate(dateMap[targetCol]) + ' だが対象日は' + stage2b_fmtDate(targetDate) + 'です');
    return;
  }

  // 書き込み時は小数点1桁に丸める(実績側の既存GASのround1()と同じ考え方)
  const roundedTotals = {
    kikodo: stage2b_round1(totals.kikodo),
    mekaki: stage2b_round1(totals.mekaki),
    harvest: stage2b_round1(totals.harvest),
    chusui: stage2b_round1(totals.chusui),
    haiki: stage2b_round1(totals.haiki),
    active: stage2b_round1(totals.active),
  };
  Logger.log('丸め後(小数点1桁): 菌床入れ=' + roundedTotals.kikodo + ' 芽かき=' + roundedTotals.mekaki + ' 収穫=' + roundedTotals.harvest
    + ' 注水=' + roundedTotals.chusui + ' 廃棄=' + roundedTotals.haiki + ' 稼働コンテナ数=' + roundedTotals.active);

  sheet.getRange(STAGE2B_SUMMARY_ROWS.kikodo, targetCol).setValue(roundedTotals.kikodo);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.mekaki, targetCol).setValue(roundedTotals.mekaki);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.harvest, targetCol).setValue(roundedTotals.harvest);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.chusui, targetCol).setValue(roundedTotals.chusui);
  // 144行目(散水)は対象外のため書き込まない
  sheet.getRange(STAGE2B_SUMMARY_ROWS.haiki, targetCol).setValue(roundedTotals.haiki);
  sheet.getRange(STAGE2B_SUMMARY_ROWS.active, targetCol).setValue(roundedTotals.active);

  Logger.log('✅ 列' + stage2b_colLabel(targetCol) + '（' + stage2b_fmtDate(targetDate) + '）に書き込み完了');
}

/**
 * 誤って別の日付の列に書き込んでしまった値を取り消すための汎用関数。
 * targetDateに対応する列を(いなべ(700g)への書き込み時と同じ列→日付マップ検索ロジックで)
 * 動的に特定し、140〜146行目(散水を除く)を空欄に戻す。列番号を直接指定するのではなく、
 * 必ずこの検索ロジック経由にすることで、書き込み時と全く同じ基準で対象列を特定する。
 */
function stage2b_clearInabeColumnForDate(targetYear, targetMonth, targetDay) {
  const targetDate = new Date(targetYear, targetMonth - 1, targetDay);
  const ss = SpreadsheetApp.openById(STAGE2B_PLAN_SHEET_ID);
  const sheet = ss.getSheetByName(STAGE2B_INABE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ シートが見つかりません: ' + STAGE2B_INABE_SHEET_NAME);
    return;
  }
  const tz = ss.getSpreadsheetTimeZone();

  const { dateMap, warnings: mapWarnings } = stage2b_buildColumnDateMap(sheet, tz);
  mapWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  const col = stage2b_findColumnForDate(dateMap, targetDate);
  if (!col) {
    Logger.log('❌ ' + stage2b_fmtDate(targetDate) + 'の列が見つからないため、クリアできませんでした');
    return;
  }

  const before = stage2b_readInabeSummaryColumn(sheet, col);
  Logger.log('クリア前の値(列' + stage2b_colLabel(col) + '=' + stage2b_fmtDate(targetDate) + '): ' + JSON.stringify(before));

  [STAGE2B_SUMMARY_ROWS.kikodo, STAGE2B_SUMMARY_ROWS.mekaki, STAGE2B_SUMMARY_ROWS.harvest,
    STAGE2B_SUMMARY_ROWS.chusui, STAGE2B_SUMMARY_ROWS.haiki, STAGE2B_SUMMARY_ROWS.active]
    .forEach(function (row) { sheet.getRange(row, col).clearContent(); });

  Logger.log('✅ 列' + stage2b_colLabel(col) + '（' + stage2b_fmtDate(targetDate) + '）の140〜146行目をクリアしました');
}

// 今回の不具合報告で、誤って2026/6/30の列に書き込まれてしまった値を取り消す
function clearMistakenWrite_20260630() {
  stage2b_clearInabeColumnForDate(2026, 6, 30);
}

// Step 1: 7/1分をいなべ(700g)に書き込む
function writeInabeDailyCounts_Step1() {
  stage2b_writeInabeDailyCounts(2026, 7, 1);
}

// Step 2: 7/2分をいなべ(700g)に追記し(7/1列はそのまま残る)、7/1+7/2の2日分を合算して
// 「整理済み_計画_更新」M列(2026/7)を上書きする
function writeInabeDailyCounts_Step2() {
  stage2b_writeInabeDailyCounts(2026, 7, 2);
  stage2b_writeSeiriAggregate([
    { year: 2026, month: 7, day: 1 },
    { year: 2026, month: 7, day: 2 },
  ]);
}

// 開始日から終了日まで(両端含む)の{year,month,day}配列を生成する
function stage2b_dateRange(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const end = new Date(endYear, endMonth - 1, endDay);
  const dates = [];
  let cur = new Date(startYear, startMonth - 1, startDay);
  while (cur <= end) {
    dates.push({ year: cur.getFullYear(), month: cur.getMonth() + 1, day: cur.getDate() });
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return dates;
}

/**
 * 開始日〜終了日(両端含む)の範囲について、各日を1日ずつstage2b_writeInabeDailyCounts()で
 * いなべ(700g)の140〜146行目に書き込む(範囲外の日付・列は一切変更しない)。
 * 戻り値として書き込んだ日付({year,month,day})の配列を返す(月次集計に流用するため)。
 */
function stage2b_writeInabeDailyCountsRange(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const dates = stage2b_dateRange(startYear, startMonth, startDay, endYear, endMonth, endDay);
  Logger.log('=== いなべ(700g) 日付範囲書き込み: ' + stage2b_fmtDate(new Date(startYear, startMonth - 1, startDay))
    + ' 〜 ' + stage2b_fmtDate(new Date(endYear, endMonth - 1, endDay)) + '（' + dates.length + '日分） ===');
  dates.forEach(function (d) {
    stage2b_writeInabeDailyCounts(d.year, d.month, d.day);
  });
  Logger.log('✅ いなべ(700g)への日次書き込みが完了しました（' + dates.length + '日分）');
  return dates;
}

// 日付範囲版のテスト: 6/30〜8/1(6月→7月、7月→8月の2つの月境界を含む)の33日分を
// いなべ(700g)に書き込んだ後、暦月ごとに集計して「整理済み_計画_更新」のL/M/N列
// (2026/6・7・8)へそれぞれ振り分け書き込みまで一括実行する
function writeInabeDailyCounts_Range_test() {
  const dates = stage2b_writeInabeDailyCountsRange(2026, 6, 30, 2026, 8, 1);
  stage2b_writeSeiriAggregate(dates);
}

/**
 * 高速一括版：開始日〜終了日(両端含む)の範囲について、コンテナ行・日付ヘッダーの読み込みを
 * それぞれ1回だけ行い、全対象日の集計をメモリ上で計算した上で、いなべ(700g)への書き込みも
 * 行ごとに1回の setValues() へまとめて実行する。
 *
 * stage2b_writeInabeDailyCountsRange()（1日ずつ読み書きを繰り返す方式）は、対象日数が
 * 増えるとシートAPI呼び出し回数が日数に比例して増大し(214日分だと読み込み約428回＋
 * 書き込み約1284回)、GASの実行時間制限(6分程度)に抵触するおそれがある。
 * この関数はシートへのアクセスを合計でも十数回程度に抑えることで、数百日規模でも
 * 現実的な時間で完走できるようにしたもの。
 *
 * 「整理済み_計画_更新」への月次振り分けも、いなべ(700g)から読み戻すのではなく、
 * ここで計算済みのメモリ上の値をそのまま使って行う(stage2b_writeSeiriAggregateFromTotals参照)。
 */
function stage2b_writeInabeAndSeiriRangeFast(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const startTime = new Date().getTime();
  const dates = stage2b_dateRange(startYear, startMonth, startDay, endYear, endMonth, endDay);
  Logger.log('=== いなべ(700g) 高速一括書き込み: ' + stage2b_fmtDate(new Date(startYear, startMonth - 1, startDay))
    + ' 〜 ' + stage2b_fmtDate(new Date(endYear, endMonth - 1, endDay)) + '（' + dates.length + '日分） ===');

  const ss = SpreadsheetApp.openById(STAGE2B_PLAN_SHEET_ID);
  const sheet = ss.getSheetByName(STAGE2B_INABE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ シートが見つかりません: ' + STAGE2B_INABE_SHEET_NAME);
    return;
  }
  const tz = ss.getSpreadsheetTimeZone();

  // 1. コンテナ行・日付ヘッダーは、対象日数に関わらずそれぞれ1回だけ読み込む
  const { containers, warnings: readWarnings } = stage2b_readContainers(sheet, tz);
  Logger.log('コンテナ行読み取り件数: ' + containers.length + '件');
  readWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  const { dateMap, warnings: mapWarnings } = stage2b_buildColumnDateMap(sheet, tz);
  mapWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  // 2. 対象日ごとに書き込み列を特定する(見つからない日はスキップし、まとめて警告する)
  const resolved = []; // { d:{year,month,day}, col, totals }
  const missingDates = [];
  dates.forEach(function (d) {
    const targetDate = new Date(d.year, d.month - 1, d.day);
    const col = stage2b_findColumnForDate(dateMap, targetDate);
    if (col == null) { missingDates.push(d); return; }
    const { totals } = stage2b_computeDailyCounts(containers, targetDate);
    const roundedTotals = {
      kikodo: stage2b_round1(totals.kikodo),
      mekaki: stage2b_round1(totals.mekaki),
      harvest: stage2b_round1(totals.harvest),
      chusui: stage2b_round1(totals.chusui),
      haiki: stage2b_round1(totals.haiki),
      active: stage2b_round1(totals.active),
    };
    resolved.push({ d: d, col: col, totals: roundedTotals });
  });
  if (missingDates.length > 0) {
    Logger.log('⚠ 列が見つからず書き込みをスキップした日付: ' + missingDates.length + '件（先頭10件: '
      + JSON.stringify(missingDates.slice(0, 10).map(function (d) { return d.year + '/' + d.month + '/' + d.day; })) + '）');
    // 特定の月が丸ごと見つからない場合、行3の月ラベルがその月だけパースできていない
    // (表記ゆれ・全角文字等)可能性が高いため、月単位で集計してひときわ目立つ形で警告する
    const missingByMonth = {};
    missingDates.forEach(function (d) {
      const key = d.year + '/' + d.month;
      missingByMonth[key] = (missingByMonth[key] || 0) + 1;
    });
    Object.keys(missingByMonth).forEach(function (key) {
      const parts = key.split('/');
      const daysInThatMonth = new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
      if (missingByMonth[key] >= daysInThatMonth - 1) {
        Logger.log('❌❌❌ ' + key + '分がほぼ丸ごと(' + missingByMonth[key] + '/' + daysInThatMonth
          + '日)見つかりませんでした。行3の月ラベルがこの月だけ想定外の表記(全角文字・"年月"表記の混在等)に'
          + 'なっている可能性が高いです。stage2b_dumpMonthLabels()でこの月のラベルの実際の値・型を確認してください');
      }
    });
  }
  if (resolved.length === 0) {
    Logger.log('❌ 書き込み対象の列が1つも見つかりませんでした');
    return;
  }

  // 3. 140〜143行目・145〜146行目(散水=144行目は触らない)を、それぞれ1回の
  //    getValues()/setValues()にまとめて書き込む。範囲内に対象外の列(月ラベル専用の
  //    スペーサー列等)が含まれていても、既存値をそのまま読み戻して書き戻すため上書きされない
  const cols = resolved.map(function (r) { return r.col; });
  const minCol = Math.min.apply(null, cols);
  const maxCol = Math.max.apply(null, cols);
  const numCols = maxCol - minCol + 1;
  const totalsByCol = {};
  resolved.forEach(function (r) { totalsByCol[r.col] = r.totals; });

  const rowGroups = [
    { rows: [STAGE2B_SUMMARY_ROWS.kikodo, STAGE2B_SUMMARY_ROWS.mekaki, STAGE2B_SUMMARY_ROWS.harvest, STAGE2B_SUMMARY_ROWS.chusui], keys: ['kikodo', 'mekaki', 'harvest', 'chusui'] },
    { rows: [STAGE2B_SUMMARY_ROWS.haiki, STAGE2B_SUMMARY_ROWS.active], keys: ['haiki', 'active'] },
  ];
  rowGroups.forEach(function (group) {
    const range = sheet.getRange(group.rows[0], minCol, group.rows.length, numCols);
    const existing = range.getValues();
    for (let c = 0; c < numCols; c++) {
      const dayTotals = totalsByCol[minCol + c];
      if (!dayTotals) continue; // 対象外の列は既存値のまま変更しない
      for (let r = 0; r < group.rows.length; r++) {
        existing[r][c] = dayTotals[group.keys[r]];
      }
    }
    range.setValues(existing);
  });

  const elapsedSec = ((new Date().getTime() - startTime) / 1000).toFixed(1);
  Logger.log('✅ いなべ(700g)への一括書き込み完了（' + resolved.length + '日分 / 列'
    + stage2b_colLabel(minCol) + '〜' + stage2b_colLabel(maxCol) + ' / 所要時間 約' + elapsedSec + '秒）');

  // 4. 「整理済み_計画_更新」への月次振り分けも、いなべ(700g)から読み戻さず、
  //    ここで計算済みのメモリ上の値をそのまま使って行う
  stage2b_writeSeiriAggregateFromTotals(resolved.map(function (r) { return { d: r.d, totals: r.totals }; }));
}

// メモリ上の日次集計値(dateEntries: [{d:{year,month,day}, totals}])を暦月ごとに合算し、
// 「整理済み_計画_更新」の対応列(2026/6→L, 2026/7→M, ...)へ書き込む。
// stage2b_writeSeiriAggregate()と異なり、いなべ(700g)への読み戻しを行わない高速版
function stage2b_writeSeiriAggregateFromTotals(dateEntries) {
  const groups = {}; // "year-month" -> { year, month, list: [totals,...] }
  const order = [];
  dateEntries.forEach(function (e) {
    const key = e.d.year + '-' + e.d.month;
    if (!groups[key]) { groups[key] = { year: e.d.year, month: e.d.month, list: [] }; order.push(key); }
    groups[key].list.push(e.totals);
  });

  order.forEach(function (key) {
    const group = groups[key];
    const sum = stage2b_sumDayTotals(group.list);
    const roundedSum = {
      kikodo: stage2b_round1(sum.kikodo),
      mekaki: stage2b_round1(sum.mekaki),
      harvest: stage2b_round1(sum.harvest),
      chusui: stage2b_round1(sum.chusui),
      haiki: stage2b_round1(sum.haiki),
      active: stage2b_round1(sum.active),
    };
    const seiriCol = stage2b_seiriColumnForMonth(group.year, group.month);
    Logger.log(group.year + '/' + group.month + '分(' + group.list.length + '日分)の合計(丸め後): ' + JSON.stringify(roundedSum));

    // 診断用: 菌床入れ・芽かきが0件になる不具合の切り分けのため、この月の対象日のうち
    // 菌床入れ・芽かきが非ゼロだった日を個別に列挙する。合計が0なのに他の指標は非ゼロという
    // 矛盾が起きた場合、ここで「非ゼロの日が実際に何件あるか」が直接分かる
    const nonZeroKikodo = group.list.filter(function (t) { return typeof t.kikodo === 'number' && t.kikodo !== 0; });
    const nonZeroMekaki = group.list.filter(function (t) { return typeof t.mekaki === 'number' && t.mekaki !== 0; });
    Logger.log(group.year + '/' + group.month + '分: 菌床入れが非ゼロの日=' + nonZeroKikodo.length + '件, 芽かきが非ゼロの日=' + nonZeroMekaki.length + '件'
      + '（合計が0なのにこれらが1件以上ある場合、集計ロジックに矛盾があります）');
    if (roundedSum.kikodo === 0 && nonZeroKikodo.length > 0) {
      Logger.log('❌❌❌ 矛盾検出: ' + group.year + '/' + group.month + 'の菌床入れ合計は0だが、非ゼロの日が' + nonZeroKikodo.length
        + '件存在します。個別の値: ' + JSON.stringify(nonZeroKikodo.map(function (t) { return t.kikodo; })));
    }
    if (roundedSum.mekaki === 0 && nonZeroMekaki.length > 0) {
      Logger.log('❌❌❌ 矛盾検出: ' + group.year + '/' + group.month + 'の芽かき合計は0だが、非ゼロの日が' + nonZeroMekaki.length
        + '件存在します。個別の値: ' + JSON.stringify(nonZeroMekaki.map(function (t) { return t.mekaki; })));
    }

    stage2b_writeToSeiriSheet(roundedSum, group.list.length + '日分の合計(' + group.year + '/' + group.month + ')', seiriCol);
  });
}

// 指定した年月(1ヶ月分)を高速一括版で処理する便利関数
function stage2b_writeInabeAndSeiriForMonthFast(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  stage2b_writeInabeAndSeiriRangeFast(year, month, 1, year, month, daysInMonth);
}

// 6/1〜12/31を一括実行するエントリーポイント(高速一括版)。まずはこちらを試す
function writeInabeDailyCounts_FullRange_2026H2_fast() {
  stage2b_writeInabeAndSeiriRangeFast(2026, 6, 1, 2026, 12, 31);
}

// 上記が実行時間制限等で完走しない場合の代替：月ごとに手動実行するためのエントリーポイント群
function writeInabeDailyCounts_Month_2026_06() { stage2b_writeInabeAndSeiriForMonthFast(2026, 6); }
function writeInabeDailyCounts_Month_2026_07() { stage2b_writeInabeAndSeiriForMonthFast(2026, 7); }
function writeInabeDailyCounts_Month_2026_08() { stage2b_writeInabeAndSeiriForMonthFast(2026, 8); }
function writeInabeDailyCounts_Month_2026_09() { stage2b_writeInabeAndSeiriForMonthFast(2026, 9); }
function writeInabeDailyCounts_Month_2026_10() { stage2b_writeInabeAndSeiriForMonthFast(2026, 10); }
function writeInabeDailyCounts_Month_2026_11() { stage2b_writeInabeAndSeiriForMonthFast(2026, 11); }
function writeInabeDailyCounts_Month_2026_12() { stage2b_writeInabeAndSeiriForMonthFast(2026, 12); }

// dateにn日加えた日付を返す(コンポーネント単位。タイムゾーンの影響を受けない)
function stage2b_addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/**
 * 「いなべ(700g)」の全コンテナ行の投入日を一覧化する(依頼#1)。
 * stage2b_readContainers()が読み取れた投入日に加え、パースに失敗して除外された行も
 * 警告として併せて表示する（除外されたコンテナがあると、その投入日の菌床入れ・芽かき
 * (該当コンテナ単独でしか値が立たないことが多い)が0のまま欠落する一方、収穫・稼働
 * コンテナ数は他の同時期のコンテナに埋もれて見た目上は目立ちにくい、という非対称な
 * 見え方になりうる）。
 */
function stage2b_listInabeContainers() {
  const ss = SpreadsheetApp.openById(STAGE2B_PLAN_SHEET_ID);
  const sheet = ss.getSheetByName(STAGE2B_INABE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ シートが見つかりません: ' + STAGE2B_INABE_SHEET_NAME);
    return;
  }
  const tz = ss.getSpreadsheetTimeZone();

  const { containers, warnings } = stage2b_readContainers(sheet, tz);
  Logger.log('=== いなべ(700g) 全コンテナ一覧（' + containers.length + '件、正常に読み取れたもののみ）===');
  containers.forEach(function (c) {
    Logger.log('行' + c.rowNum + ': 投入日=' + stage2b_fmtDate(c.plantDate) + ' 床数=' + c.beds
      + '（菌床入れ日=' + stage2b_fmtDate(c.plantDate)
      + ' / 芽かき日=' + stage2b_fmtDate(stage2b_addDays(c.plantDate, 2)) + ',' + stage2b_fmtDate(stage2b_addDays(c.plantDate, 4)) + '）');
  });

  // 投入月ごとの件数サマリー（9〜12月等、特定の月の投入コンテナがそもそも存在するかを
  // 一目で確認できるようにするため）
  const countByMonth = {};
  containers.forEach(function (c) {
    const key = c.plantDate.getFullYear() + '/' + (c.plantDate.getMonth() + 1);
    countByMonth[key] = (countByMonth[key] || 0) + 1;
  });
  Logger.log('=== 投入月ごとの件数サマリー ===');
  Object.keys(countByMonth).sort().forEach(function (key) {
    Logger.log(key + ': ' + countByMonth[key] + '件');
  });

  if (warnings.length > 0) {
    Logger.log('=== 読み取り中の警告・除外された行（' + warnings.length + '件）===');
    Logger.log('⚠ これらの行のコンテナは集計から完全に除外されている点に注意（菌床入れ・芽かきが');
    Logger.log('⚠ 単独でしか値が立たない日付の場合、その日の値が0になって欠落して見える原因になりうる）');
    warnings.forEach(function (w) { Logger.log('⚠ ' + w); });
  } else {
    Logger.log('✅ 読み取り警告なし（全コンテナ行が正常にパースできた）');
  }
}

/**
 * 依頼#2〜#4：投入日を起点に、菌床入れ(投入日当日)・芽かき(投入日+2日/+4日)が
 * 実際にいなべ(700g)シートの140・141行目に正しく反映されているかを、コンテナごとに
 * 機械的に検証する。startDate〜endDateの範囲内にある投入日・芽かき日のみを対象とする。
 *
 * 菌床入れは基本的にその投入日のコンテナ単独でしか値が立たない前提で、
 * シート実値が「そのコンテナの重み(床数/2520)」と一致するかを厳密にチェックする。
 * 芽かきは近接する投入日のコンテナ同士で日付が重なることがありうる（例：2日おきに
 * 投入されるコンテナが多いと、あるコンテナの芽かき(day5)と別コンテナの菌床入れ/芽かき(day1,3)が
 * 同じ日になるケースがある）ため、厳密な一致は求めず、実値とログを両方出力するに留める。
 */
function stage2b_verifyKikodoMekaki(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const rangeStart = new Date(startYear, startMonth - 1, startDay);
  const rangeEnd = new Date(endYear, endMonth - 1, endDay);

  const ss = SpreadsheetApp.openById(STAGE2B_PLAN_SHEET_ID);
  const sheet = ss.getSheetByName(STAGE2B_INABE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ シートが見つかりません: ' + STAGE2B_INABE_SHEET_NAME);
    return;
  }
  const tz = ss.getSpreadsheetTimeZone();

  const { containers, warnings: readWarnings } = stage2b_readContainers(sheet, tz);
  Logger.log('=== 菌床入れ・芽かき検証: ' + stage2b_fmtDate(rangeStart) + ' 〜 ' + stage2b_fmtDate(rangeEnd)
    + '（コンテナ' + containers.length + '件） ===');
  if (readWarnings.length > 0) {
    Logger.log('⚠ コンテナ読み取り時の警告（' + readWarnings.length + '件。以下の行は集計から除外されている）:');
    readWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });
  }

  const { dateMap, warnings: mapWarnings } = stage2b_buildColumnDateMap(sheet, tz);
  mapWarnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  const mismatches = [];
  containers.forEach(function (c) {
    if (c.plantDate < rangeStart || c.plantDate > rangeEnd) return; // 範囲外の投入日は対象外
    const weight = stage2b_round1(c.beds / STAGE2B_BASE_BEDS);

    // 菌床入れ(投入日当日) : 基本的にこのコンテナ単独の値のはずなので厳密に照合する
    const kikodoCol = stage2b_findColumnForDate(dateMap, c.plantDate);
    if (kikodoCol == null) {
      mismatches.push('行' + c.rowNum + '（投入日' + stage2b_fmtDate(c.plantDate) + '）: 菌床入れ日の列が見つかりません');
    } else {
      const actual = sheet.getRange(STAGE2B_SUMMARY_ROWS.kikodo, kikodoCol).getValue();
      const line = '行' + c.rowNum + ' 菌床入れ(' + stage2b_fmtDate(c.plantDate) + '/列' + stage2b_colLabel(kikodoCol) + '): シート実値=' + actual + ' 期待値(単独なら)=' + weight;
      Logger.log(line);
      if (actual !== weight) mismatches.push('❌ ' + line);
    }

    // 芽かき(投入日+2日, +4日) : 他コンテナと重なりうるため実値のログのみ(厳密な不一致判定はしない)
    [2, 4].forEach(function (offset) {
      const mekakiDate = stage2b_addDays(c.plantDate, offset);
      if (mekakiDate < rangeStart || mekakiDate > rangeEnd) return;
      const col = stage2b_findColumnForDate(dateMap, mekakiDate);
      if (col == null) {
        mismatches.push('行' + c.rowNum + '（投入日' + stage2b_fmtDate(c.plantDate) + '）: 芽かき日(+' + offset + '日/' + stage2b_fmtDate(mekakiDate) + ')の列が見つかりません');
        return;
      }
      const actual = sheet.getRange(STAGE2B_SUMMARY_ROWS.mekaki, col).getValue();
      Logger.log('行' + c.rowNum + ' 芽かき(+' + offset + '日=' + stage2b_fmtDate(mekakiDate) + '/列' + stage2b_colLabel(col) + '): シート実値=' + actual
        + '（このコンテナの寄与分=' + weight + '。他コンテナと重複している場合はこれより大きい値になりうる）');
      if (actual === 0 || actual === '') mismatches.push('❌ 行' + c.rowNum + ' 芽かき(+' + offset + '日=' + stage2b_fmtDate(mekakiDate) + '/列' + stage2b_colLabel(col) + ')が0または空欄（このコンテナの寄与分が反映されていない可能性）');
    });
  });

  Logger.log('=== 検証結果: 不一致・要確認 ' + mismatches.length + '件 ===');
  mismatches.forEach(function (m) { Logger.log(m); });
  if (mismatches.length === 0) Logger.log('✅ 範囲内のコンテナについて、菌床入れ・芽かきの疑わしい不一致は見つかりませんでした');
}

// 8月・9月分の菌床入れ・芽かき検証（今回の報告範囲）
function verifyKikodoMekaki_Aug_Sep_test() {
  stage2b_verifyKikodoMekaki(2026, 8, 1, 2026, 9, 30);
}

/**
 * 指定範囲内の各日について、収穫(harvest)判定されたコンテナを1件ずつログ出力する。
 * ユーザーがガントチャート上で目視カウントした結果と、1日ずつ・1コンテナずつ突き合わせる
 * ための診断関数。同じ日に複数コンテナが収穫中の場合、それぞれの投入日・サイクル日数が
 * わかるので、想定外のコンテナが含まれていないか(または想定していたコンテナが漏れて
 * いないか)を直接確認できる。
 */
function stage2b_dumpHarvestDetail(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const ss = SpreadsheetApp.openById(STAGE2B_PLAN_SHEET_ID);
  const sheet = ss.getSheetByName(STAGE2B_INABE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ シートが見つかりません: ' + STAGE2B_INABE_SHEET_NAME);
    return;
  }
  const tz = ss.getSpreadsheetTimeZone();
  const { containers, warnings } = stage2b_readContainers(sheet, tz);
  warnings.forEach(function (w) { Logger.log('⚠ ' + w); });

  const dates = stage2b_dateRange(startYear, startMonth, startDay, endYear, endMonth, endDay);
  Logger.log('=== 収穫判定の詳細ダンプ: ' + stage2b_fmtDate(new Date(startYear, startMonth - 1, startDay))
    + ' 〜 ' + stage2b_fmtDate(new Date(endYear, endMonth - 1, endDay)) + '（コンテナ' + containers.length + '件中）===');

  dates.forEach(function (d) {
    const targetDate = new Date(d.year, d.month - 1, d.day);
    const { totals, detail } = stage2b_computeDailyCounts(containers, targetDate);
    const harvestDetail = detail.filter(function (x) { return x.process === 'harvest'; });
    Logger.log(stage2b_fmtDate(targetDate) + ': 収穫コンテナ数=' + harvestDetail.length
      + '（重み付き収穫合計=' + stage2b_round1(totals.harvest) + '） '
      + JSON.stringify(harvestDetail.map(function (x) { return { 行: x.rowNum, 投入日: x.plantDate, サイクル日: x.cycleDay }; })));
  });
}

// 8月分の収穫詳細ダンプ（今回の報告範囲）
function dumpHarvestDetail_Aug_test() {
  stage2b_dumpHarvestDetail(2026, 8, 1, 2026, 8, 31);
}

/**
 * 全コンテナ候補行(B列が空白でない行)について、C列(投入日)の生の値・型・
 * ダックタイピング判定結果・パース結果を1行ずつダンプする。「表示形式は同じ(自動)なのに
 * 実際の値の型が違う」ケースや、特定の行だけパースに失敗しているケースを直接確認できる。
 */
function stage2b_dumpContainerRawValues() {
  const ss = SpreadsheetApp.openById(STAGE2B_PLAN_SHEET_ID);
  const sheet = ss.getSheetByName(STAGE2B_INABE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ シートが見つかりません: ' + STAGE2B_INABE_SHEET_NAME);
    return;
  }
  const tz = ss.getSpreadsheetTimeZone();

  const maxScanRow = Math.min(sheet.getLastRow(), STAGE2B_CONTAINER_MAX_SCAN_ROW);
  const numRows = maxScanRow - STAGE2B_CONTAINER_DATA_START_ROW + 1;
  const values = sheet.getRange(STAGE2B_CONTAINER_DATA_START_ROW, 1, numRows, STAGE2B_COL_D_BEDS).getValues();

  Logger.log('=== 全コンテナ候補行(' + STAGE2B_CONTAINER_DATA_START_ROW + '〜' + maxScanRow + '行目)のC列(投入日) 生データ一覧 ===');
  let carriedYear = null;
  for (let i = 0; i < values.length; i++) {
    const rowNum = STAGE2B_CONTAINER_DATA_START_ROW + i;
    const aVal = values[i][STAGE2B_COL_A_PLANT_MONTH - 1];
    const bVal = values[i][STAGE2B_COL_B_NO - 1];
    const cVal = values[i][STAGE2B_COL_C_PLANT_DATE - 1];
    const dVal = values[i][STAGE2B_COL_D_BEDS - 1];

    const monthLabel = stage2b_parseYearMonthCell(aVal, tz);
    if (monthLabel) carriedYear = monthLabel.year;

    if (bVal === '' || bVal === null) {
      Logger.log('行' + rowNum + ': B列(No.)が空白（区切り行等とみなしスキップ）');
      continue;
    }

    const parsed = stage2b_parsePlantDate(cVal, tz, carriedYear);
    Logger.log('行' + rowNum + ': A列=' + stage2b_debugValue(aVal, tz) + ' B列=' + bVal + ' D列=' + dVal
      + ' / C列: typeof=' + (typeof cVal) + ' isDateLike(ダックタイピング)=' + stage2b_isDateLike(cVal)
      + ' 生値=' + stage2b_debugValue(cVal, tz)
      + ' → パース結果=' + (parsed.date ? stage2b_fmtDate(parsed.date) : ('❌解析失敗: ' + parsed.warning)));
  }
}

/**
 * 行3(月ラベル)の生の値・型・パース結果を、月ラベルが見つかった列すべてについて出力する。
 * 「8月以降だけ菌床入れ・芽かきが0になる」といった、特定の月だけ日付ヘッダーの復元に
 * 失敗する不具合の切り分け用。全角数字や"年月"表記など、想定外のフォーマットが
 * 混ざっていないかをこのログで直接確認できる。
 */
function stage2b_dumpMonthLabels() {
  const ss = SpreadsheetApp.openById(STAGE2B_PLAN_SHEET_ID);
  const sheet = ss.getSheetByName(STAGE2B_INABE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ シートが見つかりません: ' + STAGE2B_INABE_SHEET_NAME);
    return;
  }
  const tz = ss.getSpreadsheetTimeZone();
  const lastCol = sheet.getLastColumn();
  const width = lastCol - STAGE2B_HEADER_SCAN_MIN_COL + 1;
  const monthLabels = sheet.getRange(STAGE2B_HEADER_LABEL_ROW, STAGE2B_HEADER_SCAN_MIN_COL, 1, width).getValues()[0];

  Logger.log('=== 行' + STAGE2B_HEADER_LABEL_ROW + '(月ラベル)の生データ一覧 ===');
  let foundCount = 0;
  for (let i = 0; i < width; i++) {
    const raw = monthLabels[i];
    if (raw === '' || raw === null) continue;
    const col = STAGE2B_HEADER_SCAN_MIN_COL + i;
    const parsed = stage2b_parseYearMonthCell(raw, tz);
    const typeInfo = stage2b_isDateLike(raw) ? 'Date型' : (typeof raw === 'string' ? '文字列' : typeof raw);
    Logger.log('列' + stage2b_colLabel(col) + ': 生値=' + stage2b_debugValue(raw, tz) + '（型=' + typeInfo + '） → パース結果='
      + (parsed ? parsed.year + '/' + parsed.month : '❌解析失敗'));
    if (parsed) foundCount++;
  }
  Logger.log('=== 空白でないラベルセル総数のうち、正しく解析できたもの: ' + foundCount + '件 ===');
}
