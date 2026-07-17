// ============================================================
// しいたけ農園 菌床数ダッシュボード — GAS データ配信スクリプト
// スプレッドシートID: 1oR_Qp16haR6zccY7LZJ_OW1hqu8_dnb9k_yj1iLunzY
// ============================================================

const SPREADSHEET_ID = '1oR_Qp16haR6zccY7LZJ_OW1hqu8_dnb9k_yj1iLunzY';
const LOCS           = ['いなべ', '群馬', '南丹'];

// ── エントリポイント ──────────────────────────────────────────
function doGet() {
  const data   = buildData();
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ── メインビルド ──────────────────────────────────────────────
function buildData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return {
    chiba:     getChibaData(ss),
    jisha:     getJishaData(ss),
    updatedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
  };
}

// ── 千葉七河菌床（（ファ）千葉菌床納品 タブ）────────────────
//   C列(index 2): 注文日  D列(index 3): 納品先  H列(index 7): 菌床本数
function getChibaData(ss) {
  const sheet = ss.getSheetByName('（ファ）千葉菌床納品');
  if (!sheet) return null;

  const rows   = sheet.getDataRange().getValues();
  const result = { 2025: makeEmpty(12), 2026: makeEmpty(6) };

  for (let i = 1; i < rows.length; i++) {
    const row   = rows[i];
    const loc   = String(row[3]).trim();
    const count = Number(row[7]);
    if (!LOCS.includes(loc) || !count || count <= 0) continue;

    const date = toDate(row[2]);
    if (!date) continue;

    const yr = date.getFullYear();
    const mo = date.getMonth(); // 0-based

    if (yr === 2025 && mo < 12) result[2025][loc][mo] += count;
    if (yr === 2026 && mo < 6)  result[2026][loc][mo] += count;
  }

  return result;
}

// ── 自社菌床（（培）志摩工場 タブ — 月別サマリー行）──────────
//   col[0]: 期間(2025/1形式)  col[10]: いなべ  col[12]: 群馬  col[14]: 南丹
function getJishaData(ss) {
  const sheet = ss.getSheetByName('（培）志摩工場');
  if (!sheet) return null;

  const rows   = sheet.getDataRange().getValues();
  const result = { 2025: makeEmpty(12), 2026: makeEmpty(6) };

  for (const row of rows) {
    // 期間セルを文字列に変換（Dateオブジェクトの場合も対応）
    let period = '';
    if (row[0] instanceof Date) {
      period = Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy/M');
    } else {
      period = String(row[0]).trim();
    }

    const m = period.match(/^(2025|2026)\/(\d{1,2})$/);
    if (!m) continue;

    const yr = parseInt(m[1]);
    const mo = parseInt(m[2]) - 1; // 0-based

    if (yr === 2025 && mo < 12) {
      result[2025]['いなべ'][mo] = Number(row[10]) || 0;
      result[2025]['群馬'][mo]   = Number(row[12]) || 0;
      result[2025]['南丹'][mo]   = Number(row[14]) || 0;
    }
    if (yr === 2026 && mo < 6) {
      result[2026]['いなべ'][mo] = Number(row[10]) || 0;
      result[2026]['群馬'][mo]   = Number(row[12]) || 0;
      result[2026]['南丹'][mo]   = Number(row[14]) || 0;
    }
  }

  return result;
}

// ── ユーティリティ ────────────────────────────────────────────
function makeEmpty(n) {
  const obj = {};
  LOCS.forEach(l => { obj[l] = new Array(n).fill(0); });
  return obj;
}

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// ── デバッグ用（Apps Script エディタから実行して確認） ────────
function debugData() {
  const data = buildData();
  Logger.log(JSON.stringify(data, null, 2));
}
