/**
 * 要員計画タブ用 GAS（Stage 2：いなべ(700g)・2026年7月分のコンテナ数算出）
 *
 * 「26/生産計画」ファイルの「いなべ(700g)」シートから、60日サイクルモデル＋
 * 菌床数重み付けで工程別の月次集計値を算出する。Stage 2ではまだ「整理済み_計画_更新」
 * シートへの書き込みは行わず、Logger.log()による確認のみを行う。
 * Apps Scriptエディタで calcInabeContainerCounts_Stage2() を選択して手動実行すること。
 *
 * ── シート構造（ダッシュボード側の調査で判明済み）─────────────────
 * 行1：タイトル、行3：ヘッダー（投入月／No./投入日／床数）、行4以降：コンテナ行
 * A列＝投入月（表示は月単位に見えるが、実体は正確な投入日を持つ日付型セル）
 * B列＝No.、C列＝投入日（多くの場合空欄）、D列＝床数（基準2520）
 * E列以降＝日ごとのセル。各コンテナ行の「サイクル1日目」はE列以降で最初に
 * 「▼」が立っている列でのみ判定できる（ヘッダー行の日付表示は月initialごとに
 * リセットされるため使わず、▼マーカーからの絶対列オフセットで60日分を数える）。
 * 「▼」は実体が数値+カスタム書式のことがあるため、getDisplayValues()の表示文字列を
 * 優先しつつ、getValues()の実値が文字列"▼"のケースもフォールバックで確認する。
 * 収穫日は実際の収穫量(kg)の数値が入っている。
 * ────────────────────────────────────────────────────────
 *
 * ── 60日サイクルモデル（確定版）─────────────────────────────
 * 1日目:菌床入れ / 2,4日目:稼働のみ(工程なし) / 3,5日目:芽かき /
 * 6〜14日目:収穫(1回目) / 15日目:注水 / 16〜29日目:収穫(1回目つづき) /
 * 30〜39日目:培養 / 40日目:注水 / 41〜45日目:培養 / 46〜59日目:収穫(2回目) / 60日目:廃棄
 * ────────────────────────────────────────────────────────
 */

const STAGE2_PLAN_SHEET_ID = '1WSCF2cXJsMRW5Y007SbhaLhimE3p8tYgAqcoJcfR_W4'; // 26/生産計画
const STAGE2_INABE_SHEET_NAME = 'いなべ(700g)';
const STAGE2_BASE_BEDS = 2520;
const STAGE2_HEADER_ROW = 3;     // 行3：投入月／No./投入日／床数
const STAGE2_DATA_START_ROW = 4; // 行4以降がコンテナ行
const STAGE2_DATA_START_COL = 5; // E列（1始まり）

// 1〜60日目のオフセットから工程を判定する（散水はいなべ(700g)では対象外のため扱わない）
function stage2_processForDayOffset(dayOffset) {
  if (dayOffset === 1) return 'kikodo';       // 菌床入れ
  if (dayOffset === 3 || dayOffset === 5) return 'mekaki'; // 芽かき
  if (dayOffset === 15 || dayOffset === 40) return 'chusui'; // 注水
  if (dayOffset === 60) return 'haiki';       // 廃棄
  if ((dayOffset >= 6 && dayOffset <= 14) || (dayOffset >= 16 && dayOffset <= 29) || (dayOffset >= 46 && dayOffset <= 59)) {
    return 'harvest'; // 収穫（1回目・2回目とも同じ扱いで合算する）
  }
  return null; // 2,4日目・培養期間(30〜39,41〜45)は工程なし（稼働のみ）
}

function calcInabeContainerCounts_Stage2() {
  stage2_calcInabeContainerCounts(2026, 7);
}

/**
 * targetYear年targetMonth月（1〜12）の いなべ(700g) 集計を行い、Logger.logに出力する。
 * まだシートへの書き込みは行わない（Stage 3で実装予定）。
 */
function stage2_calcInabeContainerCounts(targetYear, targetMonth) {
  const ss = SpreadsheetApp.openById(STAGE2_PLAN_SHEET_ID);
  const sheet = ss.getSheetByName(STAGE2_INABE_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ シートが見つかりません: ' + STAGE2_INABE_SHEET_NAME);
    return;
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < STAGE2_DATA_START_ROW) {
    Logger.log('❌ データ行が見つかりません（lastRow=' + lastRow + '）');
    return;
  }

  const numDataRows = lastRow - STAGE2_DATA_START_ROW + 1;
  const range = sheet.getRange(STAGE2_DATA_START_ROW, 1, numDataRows, lastCol);
  const values = range.getValues();               // 実際の値（▼が数値+カスタム書式の場合、数値が入る）
  const displayValues = range.getDisplayValues();  // 表示値（▼はここで文字列として見える想定）

  let totalKikodo = 0, totalMekaki = 0, totalHarvestKg = 0, totalChusui = 0, totalHaiki = 0, totalActive = 0;
  let containerCount = 0, skippedNoMarker = 0, skippedNoPlantDate = 0, skippedNoBeds = 0;
  const warnings = [];

  for (let r = 0; r < values.length; r++) {
    const rowValues = values[r];
    const rowDisplay = displayValues[r];
    const sheetRowNum = STAGE2_DATA_START_ROW + r;

    const plantDateRaw = rowValues[0]; // A列：投入月（実体は正確な投入日を持つ日付型セル）
    const beds = rowValues[3];         // D列：床数

    if (!(plantDateRaw instanceof Date) || isNaN(plantDateRaw.getTime())) {
      // 投入月が日付として読み取れない行はコンテナ行ではない（空行・注記行等）と判断してスキップ
      skippedNoPlantDate++;
      continue;
    }
    if (typeof beds !== 'number' || beds <= 0) {
      skippedNoBeds++;
      warnings.push('行' + sheetRowNum + ': 床数(D列)が数値として読み取れません(値=' + beds + ')。この行はスキップしました');
      continue;
    }

    // ▼マーカー列を探索（E列以降）。表示値を優先し、実値が文字列"▼"のケースもフォールバックで確認する
    let markerColIdx = -1; // 0始まりの配列index（rowValues/rowDisplay内でのindex）
    for (let c = STAGE2_DATA_START_COL - 1; c < lastCol; c++) {
      const disp = (rowDisplay[c] || '').toString().trim();
      const raw = rowValues[c];
      if (disp === '▼' || raw === '▼') { markerColIdx = c; break; }
    }
    if (markerColIdx === -1) {
      skippedNoMarker++;
      warnings.push('行' + sheetRowNum + ': ▼マーカーが見つかりませんでした。この行はスキップしました');
      continue;
    }

    const weight = beds / STAGE2_BASE_BEDS;
    containerCount++;

    for (let dayOffset = 1; dayOffset <= 60; dayOffset++) {
      const cellDate = new Date(plantDateRaw.getFullYear(), plantDateRaw.getMonth(), plantDateRaw.getDate() + (dayOffset - 1));
      if (cellDate.getFullYear() !== targetYear || (cellDate.getMonth() + 1) !== targetMonth) continue;

      // 稼働コンテナ数：60日サイクル中は工程の有無に関わらず常にカウントする
      totalActive += weight;

      const process = stage2_processForDayOffset(dayOffset);
      if (process === 'kikodo') {
        totalKikodo += weight;
      } else if (process === 'mekaki') {
        totalMekaki += weight;
      } else if (process === 'chusui') {
        totalChusui += weight;
      } else if (process === 'haiki') {
        totalHaiki += weight;
      } else if (process === 'harvest') {
        // 収穫日：シートに実際の収穫量(kg)の数値が入っている場合のみ加算する
        const colIdx = markerColIdx + (dayOffset - 1);
        const cellVal = colIdx < lastCol ? rowValues[colIdx] : null;
        if (typeof cellVal === 'number' && cellVal > 0) {
          totalHarvestKg += cellVal * weight;
        } else {
          warnings.push('行' + sheetRowNum + ': サイクル' + dayOffset + '日目(収穫予定日/列' + (colIdx + 1) + ')に収穫量データがありません');
        }
      }
      // それ以外(2,4日目・培養期間)は工程なし。稼働コンテナ数のみ加算済み
    }
  }

  Logger.log('【いなべ(700g) ' + targetYear + '年' + targetMonth + '月 集計結果】');
  Logger.log('菌床入れ：' + totalKikodo.toFixed(2));
  Logger.log('芽かき：' + totalMekaki.toFixed(2));
  Logger.log('収穫（kg換算）：' + totalHarvestKg.toFixed(1));
  Logger.log('注水：' + totalChusui.toFixed(2));
  Logger.log('散水：（対象外のため空欄／0）');
  Logger.log('廃棄：' + totalHaiki.toFixed(2));
  Logger.log('稼働コンテナ数：' + totalActive.toFixed(2));
  Logger.log('---');
  Logger.log('対象コンテナ行数：' + containerCount + '件（▼マーカー無しでスキップ：' + skippedNoMarker
    + '件／投入月が日付として読めずスキップ：' + skippedNoPlantDate
    + '件／床数が数値でなくスキップ：' + skippedNoBeds + '件）');
  if (warnings.length > 0) {
    Logger.log('--- 懸念点・警告（' + warnings.length + '件） ---');
    const shown = warnings.slice(0, 30);
    shown.forEach(function (w) { Logger.log(w); });
    if (warnings.length > shown.length) {
      Logger.log('...ほか' + (warnings.length - shown.length) + '件');
    }
  }
}
