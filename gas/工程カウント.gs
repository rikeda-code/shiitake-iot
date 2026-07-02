/**
 * 栽培スケジュール分析
 * ・TOTAL_CONTAINER_CELLの行（例：C58〜）に日付行（行1）を数式で反映（手入力不要、右方向に自動展開）
 * ①作業工程の発生回数カウント（キーワード行 × 日付列）
 *    A列が1の工程のみ作業量係数（菌床数÷基準菌床数）で重み付け、それ以外は+1の単純カウント
 *    基準菌床数はTOTAL_CONTAINER_CELLと同じ行のA列セル（例：A58）から都度取得する
 * ②日別稼働コンテナ数カウント
 * ②-2 コンテナ稼働率数式セット（稼働コンテナ数 ÷ 総コンテナ数）
 * ③月度サマリ（毎月10日締め。前月11日〜当月10日を1期間とする）
 *
 * ※ 非表示・グループ化で折りたたまれた行は集計対象外
 *
 * 行・列番号はシートごとにズレる可能性があるため、固定値としてハードコードせず、
 * シート上の実際のラベル（キーワード列挙・「稼働コンテナ数」「コンテナ稼働率」
 * 「月次サマリ」等の見出し文言）を毎回スキャンして検出する。
 */

// ── 拠点（シート名）リスト ──────────────────────────────
// シートを追加するときはここに1行足すだけ
const SHEETS = [
  "いなべ",
  //  "拠点B",
  // "拠点C",  ← 追加時はここに1行追加
];

// ── 固定できる位置関係 ───────────────────────────────────
const HEADER_DATE_ROW    = 1;  // 日付行
const HEADER_WEEKDAY_ROW = 2;  // 曜日行
const DATA_START_ROW     = HEADER_WEEKDAY_ROW + 1; // コンテナデータ開始行
const DATA_START_COL     = 3;  // C列（B列はコンテナ番号、A列は集計式）
const CONTAINER_NO_COL   = 2;  // B列：コンテナ番号 / キーワード / ラベル
const TALLY_LABEL        = "稼働コンテナ数";
const SUMMARY_HEADER_KEYWORD = "月次サマリ";
const TOTAL_CONTAINER_ROW_DATE_FORMAT = "yyyy/MM/dd"; // C58〜に反映する日付の表示形式
const WEIGHT_FLAG_COL    = 1;  // A列：キーワード行のうち値が1の工程のみ重み付けを適用
const BASE_BEDS_COL      = 1;  // A列：TOTAL_CONTAINER_CELLと同じ行に基準菌床数（係数1.0）を入力
const BEDS_IN_PATTERN  = /菌床入れ(\d{4})/; // 「xx菌床入れxxxx」のxxxx（拠点記号prefixは無視）
const BEDS_OUT_PATTERN = /廃棄(\d{4})/;     // 「xx廃棄xxxx」のxxxx

// ── 全拠点を一括集計 ────────────────────────────────────
function analyzeAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const errors = [];

  for (const sheetName of SHEETS) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      errors.push(`「${sheetName}」シートが見つかりません`);
      continue;
    }
    try {
      analyzeSchedule(sheet);
    } catch (e) {
      errors.push(`「${sheetName}」: ${e.message}`);
    }
  }

  if (errors.length > 0) {
    SpreadsheetApp.getUi().alert("⚠️ 以下のエラーがありました：\n" + errors.join("\n"));
  } else {
    SpreadsheetApp.getUi().alert("✅ 全拠点の集計が完了しました！");
  }
}

// ── 共通集計ロジック（シートを引数で受け取る）────────────
function analyzeSchedule(sheet) {

  // ── 引数チェック ──────────────────────────────────────
  if (!sheet) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const allSheetNames = ss.getSheets().map(s => s.getName()).join("\n");
    SpreadsheetApp.getUi().alert(
      "⚠️ シートが見つかりません。\n\n" +
      "SHEETS リストのシート名と一致しているか確認してください。\n\n" +
      "【このファイルに存在するシート名】\n" + allSheetNames
    );
    return;
  }

  // ── ステップ0：シート構造の自動検出 ─────────────────────
  const dataEndCol = detectDataEndCol(sheet);
  const dataEndRow = detectDataEndRow(sheet);

  const keywordSection = detectKeywordSection(sheet, dataEndRow);
  const keywords          = keywordSection.keywords;
  const keywordStartRow   = keywordSection.startRow;
  const tallyRow          = keywordSection.tallyRow;
  const rateRow           = tallyRow + 1;
  const totalContainerRow = keywordStartRow - 1; // TOTAL_CONTAINER_CELL の行
  const totalContainerCell = `${columnToLetter(CONTAINER_NO_COL)}${totalContainerRow}`;

  const summaryHeaderRow = detectSummaryHeaderRow(sheet, rateRow);
  const summaryStartRow  = summaryHeaderRow + 1;

  const numCols = dataEndCol - DATA_START_COL + 1;

  // TOTAL_CONTAINER_CELLの行（例：C58〜）に日付行（行1）を都度反映する。
  // 手入力ではなく、行1の日付に追従して右方向に自動展開する
  const dateMirrorFormulas = [];
  for (let col = DATA_START_COL; col <= dataEndCol; col++) {
    dateMirrorFormulas.push(`=${columnToLetter(col)}${HEADER_DATE_ROW}`);
  }
  sheet.getRange(totalContainerRow, DATA_START_COL, 1, numCols)
       .setFormulas([dateMirrorFormulas])
       .setNumberFormat(TOTAL_CONTAINER_ROW_DATE_FORMAT);

  // A列（キーワード行と同じ行）が 1 の工程のみ重み付けカウントを適用する
  const weightFlags = sheet.getRange(keywordStartRow, WEIGHT_FLAG_COL, keywords.length, 1)
    .getValues().map(r => r[0] === 1);
  const needsWeighting = weightFlags.some(Boolean);

  // 基準菌床数（係数1.0となる菌床数）はTOTAL_CONTAINER_CELLと同じ行のA列から取得する
  let baseBeds = null;
  if (needsWeighting) {
    baseBeds = Number(sheet.getRange(totalContainerRow, BASE_BEDS_COL).getValue());
    if (!baseBeds || baseBeds <= 0) {
      throw new Error(`基準菌床数セル（${columnToLetter(BASE_BEDS_COL)}${totalContainerRow}）に有効な数値がありません`);
    }
  }

  // ── 可視行のみ抽出 ────────────────────────────────────
  const visibleRowOffsets = [];
  for (let row = DATA_START_ROW; row <= dataEndRow; row++) {
    if (!sheet.isRowHiddenByUser(row) && !sheet.isRowHiddenByFilter(row)) {
      visibleRowOffsets.push(row - DATA_START_ROW);
    }
  }

  // ── データ取得 ─────────────────────────────────────────
  const allData = sheet.getRange(
    DATA_START_ROW, DATA_START_COL,
    dataEndRow - DATA_START_ROW + 1, numCols
  ).getValues();

  const headerDates = sheet.getRange(HEADER_DATE_ROW, DATA_START_COL, 1, numCols)
    .getValues()[0];

  // ── ① 作業工程の発生回数（可視行のみ、優先順位マッチ＋1セル1カウント）──
  // A列が1の工程のみ、+1ではなく+該当コンテナの作業量係数（菌床数÷基準菌床数）で加算する。
  // A列が空白／1以外の工程は従来通り単純に+1する
  const countResult = keywords.map(() => new Array(numCols).fill(0));

  for (const rowOffset of visibleRowOffsets) {
    const rowCoeffs = needsWeighting ? computeRowCoefficients(allData[rowOffset], baseBeds) : null;
    for (let c = 0; c < numCols; c++) {
      const cell = String(allData[rowOffset][c]);
      if (cell === "" || cell === "undefined") continue;
      for (let k = 0; k < keywords.length; k++) {
        if (keywords[k] !== "" && cell.includes(keywords[k])) {
          countResult[k][c] += weightFlags[k] ? rowCoeffs[c] : 1;
          break;
        }
      }
    }
  }

  // 書き込みは日付×工程セル単位で小数第1位に四捨五入
  const roundedCountResult = countResult.map(row => row.map(round1));
  sheet.getRange(keywordStartRow, DATA_START_COL, keywords.length, numCols)
       .setValues(roundedCountResult)
       .setNumberFormat("0.#"); // 整数値は小数点以下を表示しない（以前の書式が残らないよう毎回上書き）

  // ── ② 日別稼働コンテナ数（可視行のみ）──────────────────
  const activeCount = new Array(numCols).fill(0);

  for (let c = 0; c < numCols; c++) {
    for (const rowOffset of visibleRowOffsets) {
      const cell = String(allData[rowOffset][c]).trim();
      if (cell !== "" && cell !== "undefined") {
        activeCount[c]++;
      }
    }
  }

  sheet.getRange(tallyRow, DATA_START_COL, 1, numCols)
       .setValues([activeCount]);

  // ── ②-2 コンテナ稼働率 ────────────────────────────────
  const rateFormulas = [];
  for (let col = DATA_START_COL; col <= dataEndCol; col++) {
    rateFormulas.push(`=${columnToLetter(col)}${tallyRow}/$${totalContainerCell}`);
  }
  sheet.getRange(rateRow, DATA_START_COL, 1, numCols)
       .setFormulas([rateFormulas])
       .setNumberFormat("0.0%");

  // ── ③ 月度サマリ（毎月10日締め。前月11日〜当月10日）──────
  const totalContainers = Number(sheet.getRange(totalContainerCell).getValue());

  // 日付列を「締め日（当月10日 or 翌月10日）」でグルーピング
  const periodMap = new Map();
  for (let c = 0; c < numCols; c++) {
    const d = headerDates[c];
    if (!(d instanceof Date)) continue;
    const periodEnd = getPeriodEndDate(d);
    const key = periodEnd.getTime();
    if (!periodMap.has(key)) periodMap.set(key, { end: periodEnd, cols: [] });
    periodMap.get(key).cols.push(c);
  }
  const periods = Array.from(periodMap.values()).sort((a, b) => a.end - b.end);

  periods.forEach((period, i) => {
    const summaryCol = DATA_START_COL + i; // 期間ごとに右方向へ列を積む

    // 11工程それぞれの期間合計（重み付き値の合計。日付×工程セルと同様に小数第1位で四捨五入）
    const workSums = keywords.map((_, k) => {
      let sum = 0;
      for (const c of period.cols) sum += countResult[k][c];
      return round1(sum);
    });

    // 稼働コンテナ数合計
    let containerSum = 0;
    for (const c of period.cols) containerSum += activeCount[c];

    // 稼働日数（データが存在する日数。カレンダー日数ではない）
    let activeDays = 0;
    for (const c of period.cols) {
      if (activeCount[c] > 0) activeDays++;
    }

    // コンテナ稼働率 = 稼働コンテナ数合計 / (総コンテナ数 × 稼働日数)
    const containerRate = (totalContainers > 0 && activeDays > 0)
      ? containerSum / (totalContainers * activeDays)
      : 0;

    // 見出し行（締め日）：C列はC1（データ開始日）を参照して10日締め日を算出する数式、
    // それ以降は直前の列の締め日から1ヶ月後（=EDATE）を辿る数式にし、右方向に自動展開する
    const dataStartCell = `${columnToLetter(DATA_START_COL)}${HEADER_DATE_ROW}`;
    const headerFormula = (i === 0)
      ? `=DATE(YEAR(${dataStartCell}), MONTH(${dataStartCell}) + IF(DAY(${dataStartCell})<=10, 0, 1), 10)`
      : `=EDATE(${columnToLetter(summaryCol - 1)}${summaryHeaderRow}, 1)`;
    sheet.getRange(summaryHeaderRow, summaryCol)
         .setFormula(headerFormula)
         .setNumberFormat(TOTAL_CONTAINER_ROW_DATE_FORMAT);

    const summaryData = [
      ...workSums.map(v => [v]),   // 工程ごとの合計
      [containerSum],               // 稼働コンテナ数合計
      [containerRate],              // コンテナ稼働率
      [activeDays],                 // 稼働日数
    ];

    sheet.getRange(summaryStartRow, summaryCol, summaryData.length, 1)
         .setValues(summaryData);

    // 工程ごとの合計行も整数値は小数点以下を表示しない（以前の書式が残らないよう毎回上書き）
    sheet.getRange(summaryStartRow, summaryCol, keywords.length, 1)
         .setNumberFormat("0.#");

    // コンテナ稼働率の行だけパーセント書式
    sheet.getRange(summaryStartRow + keywords.length + 1, summaryCol)
         .setNumberFormat("0.0%");
  });
}

// ── ステップ0：構造検出ヘルパー群 ──────────────────────────

// 日付行（HEADER_DATE_ROW）を右方向にスキャンし、日付が入っている最後の列を返す
function detectDataEndCol(sheet) {
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(HEADER_DATE_ROW, DATA_START_COL, 1, lastCol - DATA_START_COL + 1)
    .getValues()[0];
  let endCol = DATA_START_COL - 1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] instanceof Date) endCol = DATA_START_COL + i;
  }
  if (endCol < DATA_START_COL) {
    throw new Error(`${HEADER_DATE_ROW}行目に日付データが見つかりません`);
  }
  return endCol;
}

// B列（コンテナ番号）を下方向にスキャンし、データが続く最後の行を返す
function detectDataEndRow(sheet) {
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(DATA_START_ROW, CONTAINER_NO_COL, lastRow - DATA_START_ROW + 1, 1)
    .getValues();
  let endRow = DATA_START_ROW - 1;
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === "" || values[i][0] === null) break;
    endRow = DATA_START_ROW + i;
  }
  if (endRow < DATA_START_ROW) {
    throw new Error(`${CONTAINER_NO_COL}列目にコンテナ番号データが見つかりません`);
  }
  return endRow;
}

// コンテナデータの直後からB列を下方向にスキャンし、
// 工程キーワード列（「稼働コンテナ数」の手前まで）を検出する
// ※ キーワード開始行の手前には「総コンテナ数」の数値セル（TOTAL_CONTAINER_CELL）が
//    存在することがあるため、空白行だけでなく数値セルもキーワード開始前としてスキップする
function detectKeywordSection(sheet, dataEndRow) {
  const lastRow = sheet.getLastRow();
  const raw = sheet.getRange(dataEndRow + 1, CONTAINER_NO_COL, lastRow - dataEndRow, 1)
    .getValues();

  let startRow = -1;
  const keywords = [];
  for (let i = 0; i < raw.length; i++) {
    const cellValue = raw[i][0];
    const isBlank = (cellValue === "" || cellValue === null);
    const isNumeric = (typeof cellValue === "number");
    const v = String(cellValue).trim();

    if (startRow === -1) {
      if (isBlank || isNumeric) continue; // 空白・総コンテナ数セルはスキップ
      startRow = dataEndRow + 1 + i;
      keywords.push(v);
      continue;
    }

    if (v === TALLY_LABEL) {
      return { startRow, keywords, tallyRow: dataEndRow + 1 + i };
    }
    if (isBlank) {
      throw new Error(`工程キーワード列挙中に空白行があります（${dataEndRow + 1 + i}行目）`);
    }
    keywords.push(v);
  }
  throw new Error(`「${TALLY_LABEL}」の行が見つかりません（工程キーワード検出に失敗）`);
}

// コンテナ稼働率行より下をB列でスキャンし、「月次サマリ」見出し行を検出する
function detectSummaryHeaderRow(sheet, rateRow) {
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(rateRow + 1, CONTAINER_NO_COL, Math.max(lastRow - rateRow, 1), 1)
    .getValues();
  for (let i = 0; i < values.length; i++) {
    const v = String(values[i][0]).trim();
    if (v.includes(SUMMARY_HEADER_KEYWORD)) {
      return rateRow + 1 + i;
    }
  }
  throw new Error(`「${SUMMARY_HEADER_KEYWORD}」の見出し行が見つかりません`);
}

// 日付から締め日（当月10日 or 翌月10日）を計算する
// 毎月10日締め：前月11日〜当月10日を1期間とする
function getPeriodEndDate(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  if (d <= 10) {
    return new Date(y, m, 10);
  }
  return new Date(y, m + 1, 10);
}

// ── 作業量係数（重み付け）────────────────────────────────
// 1行（1コンテナ）分のセル配列から、各列（日付）の係数を算出する。
// 係数 ＝ そのセルが属する栽培サイクルの菌床数 ÷ baseBeds（基準菌床数セルの値）
//   1. 自セルから左方向に遡り、途中で別サイクルの「廃棄」を挟まずに
//      最初に見つかる「菌床入れ」の菌床数を採用する
//   2. 見つからない場合は、右方向で最初に見つかる「廃棄」の菌床数を採用する
//   3. どちらも見つからない場合は係数 1.0
function computeRowCoefficients(rowValues, baseBeds) {
  const n = rowValues.length;
  const markers = []; // { col, type: "in" | "out", beds }
  for (let c = 0; c < n; c++) {
    const text = rowValues[c] === null ? "" : String(rowValues[c]);
    const inMatch = text.match(BEDS_IN_PATTERN);
    if (inMatch) { markers.push({ col: c, type: "in", beds: Number(inMatch[1]) }); continue; }
    const outMatch = text.match(BEDS_OUT_PATTERN);
    if (outMatch) { markers.push({ col: c, type: "out", beds: Number(outMatch[1]) }); }
  }

  const coeffs = new Array(n).fill(1.0);
  for (let c = 0; c < n; c++) {
    let beds = leftScanForBeds(markers, c);
    if (beds === null) beds = rightScanForBeds(markers, c);
    coeffs[c] = (beds === null) ? 1.0 : beds / baseBeds;
  }
  return coeffs;
}

// 自セル(col=c)を含めて左方向に遡り、別サイクルの「廃棄」を跨がずに
// 見つかる直近の「菌床入れ」の菌床数を返す。見つからなければ null
function leftScanForBeds(markers, c) {
  let idx = -1;
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].col > c) break;
    idx = i;
  }
  if (idx === -1) return null; // c以前にマーカーが一つもない

  const m = markers[idx];
  if (m.type === "in") return m.beds; // 自セルが菌床入れ、または既に見つかっている

  // m.type === "out"：自セルがちょうど廃棄セルの場合は「跨いだ」扱いにせず、
  // そのサイクルを開始した直前の菌床入れを見る
  if (m.col === c) {
    const prev = markers[idx - 1];
    return (prev && prev.type === "in") ? prev.beds : null;
  }
  return null; // 自セルより前で別サイクルの廃棄を跨いでいる
}

// 自セル(col=c)を含めて右方向に、最初に見つかる「廃棄」の菌床数を返す。
// 見つからなければ null
function rightScanForBeds(markers, c) {
  for (const m of markers) {
    if (m.col >= c && m.type === "out") return m.beds;
  }
  return null;
}

// 小数第1位に四捨五入
function round1(value) {
  return Math.round(value * 10) / 10;
}

// ── ユーティリティ：列番号 → A1記法の列文字 ──────────────
function columnToLetter(col) {
  let result = "";
  while (col > 0) {
    const r = (col - 1) % 26;
    result = String.fromCharCode(65 + r) + result;
    col = Math.floor((col - 1) / 26);
  }
  return result;
}

// ── メニュー設定 ─────────────────────────────────────────
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu("📊 スケジュール分析")
    .addItem("全拠点を集計", "analyzeAll");

  // 拠点ごとに個別実行メニューを追加
  // ※ GASのメニューから直接引数付き関数は呼べないため
  //   シート名でシートを取得するラッパー関数を動的生成
  SHEETS.forEach((name, i) => {
    menu.addItem(`${name}のみ集計`, `analyzeSheet${i}`);
  });

  menu.addToUi();
}

// ── 個別実行ラッパー（SHEETSの順番に対応）────────────────
// SHEETSに拠点を追加した場合はこちらも同数追加する
function analyzeSheet0() {
  _analyzeSingle(SHEETS[0]);
}
function analyzeSheet1() {
  _analyzeSingle(SHEETS[1]);
}
// function analyzeSheet2() { _analyzeSingle(SHEETS[2]); }  ← 拠点追加時はコメント解除

function _analyzeSingle(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(`⚠️ 「${sheetName}」シートが見つかりません`);
    return;
  }
  analyzeSchedule(sheet);
  SpreadsheetApp.getUi().alert(`✅ 「${sheetName}」の集計が完了しました！`);
}
