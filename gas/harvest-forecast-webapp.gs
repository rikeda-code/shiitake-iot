/**
 * 収穫見込（手入力）GAS Webアプリ（dashboard/work-hours-forecast.html のバックエンド）
 *
 * ── 役割 ──────────────────────────────────────────────
 * ・直近工数計画（栽培）の標準工数パネルで手入力した「収穫見込kg」を、日付×拠点ごとに保存する
 * ・ダッシュボードは、収穫見込が入っている日は見込kg、空欄の日は収穫計画kgで収穫工数を計算する
 * ・拠点シフト表GAS（shift-webapp.gs）とは別のスタンドアロンプロジェクトとして作る
 *   （シフト表の運用に影響を出さないため）
 *
 * ── デプロイ手順（Apps Scriptエディタで実施）──────────
 * 1. 新規スタンドアロンのApps Scriptプロジェクトを作成し、このファイルを貼り付ける
 * 2. 関数「setup」を1回実行（権限を許可）
 *    → 保存用スプレッドシート「収穫見込_手入力」がマイドライブに作られ、IDがスクリプトプロパティに入る
 *    （実行ログにスプレッドシートのURLが出る）
 * 3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *    実行ユーザー「自分」／アクセスできるユーザー「全員」
 * 4. 発行されたURLを dashboard/work-hours-forecast.html の HARVEST_FORECAST_GAS_URL に設定する
 * コード更新時は「デプロイを管理」から新バージョンとして再デプロイすること。
 *
 * ── リクエスト ────────────────────────────────────────
 * GET  ?action=load&site=いなべ&from=2026-10-21&to=2026-10-27 … { values: { '2026-10-21': 130, ... } }
 * POST (Content-Type: text/plain, 本文はJSON。CORSプリフライト回避のため)
 *   { action:'save', site, date:'2026-10-21', kg:130 }   // kgがnull・空なら、その日の見込を削除する
 */

const SPREADSHEET_NAME = '収穫見込_手入力';
const DATA_SHEET_NAME = '収穫見込';
const DATA_HEADERS = ['日付', '拠点', '収穫見込kg', '更新日時'];
const PROP_SPREADSHEET_ID = 'HARVEST_FORECAST_SPREADSHEET_ID';
const VALID_SITES = ['いなべ', '群馬', '南丹'];

function doGet(e) {
  const p = e.parameter || {};
  try {
    if (p.action === 'load') return json_(load_(p.site, p.from, p.to));
    return json_({ status: 'error', message: '不明なactionです' });
  } catch (err) {
    return json_({ status: 'error', message: String(err && err.message || err) });
  }
}

function doPost(e) {
  const req = JSON.parse(e.postData.contents);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (req.action === 'save') return json_(save_(req));
    return json_({ status: 'error', message: '不明なactionです' });
  } catch (err) {
    return json_({ status: 'error', message: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  if (!obj.status) obj.status = 'ok';
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== 共通 ===================== */

function setup() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(PROP_SPREADSHEET_ID);
  let ss = id ? SpreadsheetApp.openById(id) : null;
  if (!ss) {
    ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    props.setProperty(PROP_SPREADSHEET_ID, ss.getId());
  }
  let sh = ss.getSheetByName(DATA_SHEET_NAME);
  if (!sh) {
    sh = ss.getSheets()[0];
    sh.setName(DATA_SHEET_NAME);
  }
  sh.getRange(1, 1, 1, DATA_HEADERS.length).setValues([DATA_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  // 日付は「2026-10-21」の文字列のまま保存する（日付型に変換されると読み戻しで時差がずれるため）
  sh.getRange('A:A').setNumberFormat('@');
  Logger.log('保存先: ' + ss.getUrl());
}

function sheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!id) throw new Error('保存先が未作成です。setupを実行してください');
  const sh = SpreadsheetApp.openById(id).getSheetByName(DATA_SHEET_NAME);
  if (!sh) throw new Error('「' + DATA_SHEET_NAME + '」シートがありません。setupを実行してください');
  return sh;
}

function checkSite_(site) {
  if (VALID_SITES.indexOf(site) === -1) throw new Error('拠点が正しくありません: ' + site);
}

function checkISODate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) throw new Error('日付が正しくありません: ' + s);
}

// 2行目以降を [日付, 拠点, kg] の表示値で読む（日付は文字列のまま比較するため）
function readRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 3).getDisplayValues();
}

/* ===================== 読み込み・保存 ===================== */

function load_(site, from, to) {
  checkSite_(site);
  checkISODate_(from);
  checkISODate_(to);
  const values = {};
  readRows_(sheet_()).forEach(function(r) {
    if (r[1] !== site || r[0] < from || r[0] > to) return;
    const kg = parseFloat(String(r[2]).replace(/,/g, ''));
    if (!isNaN(kg)) values[r[0]] = kg;
  });
  return { values: values };
}

function save_(req) {
  checkSite_(req.site);
  checkISODate_(req.date);
  const kg = (req.kg === null || req.kg === undefined || req.kg === '') ? null : Number(req.kg);
  if (kg !== null && (isNaN(kg) || kg < 0)) throw new Error('収穫見込kgが正しくありません: ' + req.kg);

  const sh = sheet_();
  const rows = readRows_(sh);
  let rowNo = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === req.date && rows[i][1] === req.site) { rowNo = i + 2; break; }
  }
  if (kg === null) {
    if (rowNo > 0) sh.deleteRow(rowNo);
    return { date: req.date, kg: null };
  }
  const record = [req.date, req.site, kg, new Date()];
  if (rowNo > 0) sh.getRange(rowNo, 1, 1, record.length).setValues([record]);
  else sh.appendRow(record);
  return { date: req.date, kg: kg };
}
