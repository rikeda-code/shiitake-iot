/**
 * 拠点シフト表 GAS Webアプリ（dashboard/site-shift.html のバックエンド）
 *
 * ── 役割 ──────────────────────────────────────────────
 * ・整理済み_M（手書きの従業員マスタ）から拠点ごとのメンバーを読み込む
 * ・シフト（日付×人×時間）を「シフト_データ」シートに保存する
 * ・固定シフト（曜日ごとの基本パターン）を「シフト_固定」シートに保存する
 * ・新人登録／退職を整理済み_Mへ直接書き込む
 * ・work-hours-forecast.html の標準労働時間に、日別・人別の実働時間を返す
 * ・旧シフト表（期間ごとのシート）から一度だけ取り込む importLegacyShift()
 *
 * ── 休憩ルール（実働時間の計算）───────────────────────
 *   拘束5時間未満：休憩なし ／ 5時間以上：1時間
 *
 * ── デプロイ手順（Apps Scriptエディタで実施）──────────
 * 1. 新規スタンドアロンのApps Scriptプロジェクトを作成し、このファイルを貼り付ける
 * 2. 関数「setup」を1回実行（権限を許可）→ シフト_データ／シフト_固定シートが作られる
 * 3. 関数「importLegacyShift」を1回実行 → 旧シフト表の10/1以降を取り込む
 *    （実行ログに取り込めなかったセル・照合できなかった氏名が出る）
 * 4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *    実行ユーザー「自分」／アクセスできるユーザー「全員」
 * 5. 発行されたURLを dashboard/site-shift.html の SHIFT_GAS_URL と
 *    dashboard/work-hours-forecast.html の SHIFT_GAS_URL に設定する
 * コード更新時は「デプロイを管理」から新バージョンとして再デプロイすること。
 *
 * ── リクエスト ────────────────────────────────────────
 * GET  ?action=load&site=いなべ&month=2026-11      … メンバー・シフト・固定シフト
 * GET  ?action=members&site=いなべ                 … メンバーだけ
 * GET  ?action=legacy&site=いなべ&from=2026-10-11&to=2026-11-10 … 旧シフト表の内容（アプリの「旧シフト表から取り込む」用）
 * GET  ?action=hours&site=いなべ&from=2026-10-11&to=2026-10-18 … 日別・人別の実働時間
 * POST (Content-Type: text/plain, 本文はJSON。CORSプリフライト回避のため)
 *   { action:'saveShifts', site, month, cells:[{key,date,value}] }
 *   { action:'upsertCells', site, cells:[{key,date,value}] }   // 変わったセルだけ（valueが空なら削除）。アプリ版が保存のたびに送る
 *   { action:'saveFixed',  site, key, name, pattern:[月..日 の '8:00-17:00' or '休'] }
 *   { action:'addMember',  site, name, dept, empType, joinDate }
 *   { action:'retire',     key, date, flag }   // flag: 9=退職 / 3=退職・異動
 *   { action:'undoRetire', key }
 */

const MASTER_SHEET_ID = '1LtYb1feXR6jtIEfxaADLiTEWpPabKJDDlwoS1V-yuG0';
const MASTER_SHEET_NAME = '整理済み_M';
const MASTER_HEADER_ROW = 3;   // 3行目が列見出し
const MASTER_FLAG_COL = 2;     // B列：1在職中 2入社 3退職/異動 8他所属 9退職
const DATA_SHEET_NAME = 'シフト_データ';
const FIXED_SHEET_NAME = 'シフト_固定';

// 旧シフト表（いなべ）。期間ごとにシートが作られていたもの。取り込み元としてのみ使う
const LEGACY_SHEET_ID = '12xrXyXUSbiQVUWsAC7mbrExyWrIw863Oleq_1v81vRw';
const LEGACY_SHEET_GID = 872290181;
const LEGACY_SITE = 'いなべ';
// 拠点ごとの旧シフト表。gid指定のシートか、期間の始まりの日（例：10/11）を名前に含むタブをすべて読む
//   nameCol：名前の列（0始まり）。日付の行・シフトの始まりの列は自動で見つける
const LEGACY_SOURCES = {
  'いなべ': [{ id: LEGACY_SHEET_ID, gid: LEGACY_SHEET_GID, nameCol: 0 }],
  // 群馬は社員の空欄が「8:00-17:00」の意味（blankAs：雇用区分に含まれる文字 → 空欄のときの値）
  '群馬':   [{ id: '1eqN5kfymPPvOOi9UbTg7ZxLn04YE7YnjrJw-jADySUM', byPeriodName: true, nameCol: 0, blankAs: { '社員': '8:00-17:00' } }], // 「26.10/11~11/10 収穫班」「…出荷場」
};
const LEGACY_FROM = '2026-10-01';
// 旧シフト表の呼び名 → 整理済み_Mの氏名（work-hours-forecast.html と同じ対応表）
const LEGACY_NAME_ALIASES = {
  'ハイ': 'NGUYEN VAN HAI', 'ヴィン': 'HOANG VAN VINH', 'タム': 'DAO VAN TAM',
  'ギエム': 'NGUYEN THANH NGHIEM', 'ハオ': 'NGUYEN VAN HAO', 'エガ': 'EGA ADITIYA KURNIAWAN',
  'アユブ': 'MUHAMAD AYUB FAYYUQI', 'イマム': 'IMAM ADI SAPUTRA', '左右田 耀子': '左右田 煬子',
  '森さん': '森 郁美',
};
// 拠点ごとの呼び名の対応（旧シフト表の書き方 → 整理済み_Mの氏名）。名字だけで1人に決まる人は書かなくてよい
const LEGACY_SITE_ALIASES = {
  '群馬': { 'ソー': 'SAW MIN HTET', 'SAW': 'SAW MIN HTET' },
};

const DATA_HEADERS = ['日付', '拠点', 'キー', '氏名', '部門', 'シフト', '実働h', '更新日時'];
const FIXED_HEADERS = ['拠点', 'キー', '氏名', '月', '火', '水', '木', '金', '土', '日', '更新日時'];
const TZ = 'Asia/Tokyo';

/* ===================== 入口 ===================== */

function doGet(e) {
  const p = e.parameter || {};
  try {
    if (p.action === 'load') return json_(loadMonth_(p.site, p.month, p.fresh === '1'));
    if (p.action === 'hours') return json_(hoursRange_(p.site, p.from, p.to));
    if (p.action === 'legacy') {
      const r = readLegacy_(p.site, p.from, p.to);
      return json_({ cells: [].concat(...Object.keys(r.cellsByMonth).map(k => r.cellsByMonth[k])), keys: r.keys, unmatched: r.unmatched, skipped: r.skipped.slice(0, 50), from: r.from, to: r.to });
    }
    if (p.action === 'members') return json_({ members: readMembers_(p.fresh === '1').filter(m => m.site === p.site && m.flag !== 8) });
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
    switch (req.action) {
      case 'saveShifts': return json_(saveShifts_(req));
      case 'upsertCells': return json_(upsertCells_(req));
      case 'saveFixed':  return json_(saveFixed_(req));
      case 'addMember':  clearMemberCache_(); return json_(addMember_(req));
      case 'retire':     clearMemberCache_(); return json_(setRetire_(req.key, req.date, req.flag || 9));
      case 'undoRetire': clearMemberCache_(); return json_(undoRetire_(req.key));
      default: return json_({ status: 'error', message: '不明なactionです' });
    }
  } catch (err) {
    return json_({ status: 'error', message: String(err && err.message || err) });
  } finally {
    if (['addMember', 'retire', 'undoRetire'].indexOf(req.action) >= 0) clearMemberCache_();
    lock.releaseLock();
  }
}

function json_(obj) {
  if (!obj.status) obj.status = 'ok';
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== 共通 ===================== */

function ss_() { return SpreadsheetApp.openById(MASTER_SHEET_ID); }

function setup() {
  const ss = ss_();
  [[DATA_SHEET_NAME, DATA_HEADERS], [FIXED_SHEET_NAME, FIXED_HEADERS]].forEach(([name, headers]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); }
    sh.getRange('A:A').setNumberFormat('@'); // 日付は文字列 yyyy-MM-dd で持つ
    Logger.log(`${name}: gid=${sh.getSheetId()}`);
  });
}

function fmtDate_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }

function cellDate_(v) {
  if (v instanceof Date) return fmtDate_(v);
  const s = String(v || '').trim().normalize('NFKC');
  const m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  return m ? `${m[1]}-${('0' + m[2]).slice(-2)}-${('0' + m[3]).slice(-2)}` : '';
}

function normalizeName_(raw) {
  let s = String(raw || '').normalize('NFKC');
  const cut = ['（', '('].map(c => s.indexOf(c)).filter(i => i >= 0).sort((a, b) => a - b)[0];
  if (cut !== undefined) s = s.slice(0, cut);
  return s.replace(/\s+/g, '').toUpperCase();
}

// 休みの種類（実働0時間）と、よくある書き方のそろえ先
const LEAVE_TYPES = ['休', '代休', '有休', '季節休', '欠勤'];
const LEAVE_ALIASES = { 'やす': '休', '公休': '休', '有': '有休', '有給': '有休', '有給休暇': '有休', '季休': '季節休', '欠': '欠勤' };

// '8:00-17:00' 等 → 実働時間。休みの種類・空欄は0、形式不正はnull
function workHours_(value) {
  const s = String(value || '').normalize('NFKC').trim();
  if (!s || LEAVE_TYPES.indexOf(s) >= 0) return 0;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const span = (+m[3] + (+m[4] || 0) / 60) - (+m[1] + (+m[2] || 0) / 60);
  if (span <= 0) return null;
  return Math.round((span >= 5 ? span - 1 : span) * 100) / 100;
}

// 表記をそろえる：8:00〜17:00 → 8:00-17:00
function normalizeShift_(value) {
  let s = String(value || '').normalize('NFKC').trim().replace(/[〜~ー―−]/g, '-').replace(/\s/g, '');
  if (LEAVE_ALIASES[s]) s = LEAVE_ALIASES[s];
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?$/);
  if (m) s = `${+m[1]}:${m[2] || '00'}-${+m[3]}:${m[4] || '00'}`;
  return s;
}

/* ===================== 整理済み_M ===================== */

// 見出し行から列番号（1始まり）を探す
function masterCols_(sh) {
  const head = sh.getRange(MASTER_HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim());
  const find = label => { const i = head.findIndex(h => h.indexOf(label) === 0); return i >= 0 ? i + 1 : -1; };
  const cols = { flag: MASTER_FLAG_COL, empType: find('雇用区分'), site: find('拠点'), prj: find('PRJ'),
    dept: find('部門'), empNo: find('社員番号'), name: find('名前'), date: find('入退社') };
  ['site', 'dept', 'name'].forEach(k => { if (cols[k] < 0) throw new Error(`整理済み_Mに「${k}」の列が見つかりません`); });
  return cols;
}

// メンバーは5分間キャッシュする（整理済み_Mへの書き込み時と、画面の「更新」ボタンでは読み直す）
const MEMBER_CACHE_KEY = 'members_v1';
function readMembers_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get(MEMBER_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  }
  const list = readMembersFromSheet_();
  try { cache.put(MEMBER_CACHE_KEY, JSON.stringify(list), 300); } catch (e) { /* 100KBを超えたらキャッシュしない */ }
  return list;
}
function clearMemberCache_() { CacheService.getScriptCache().remove(MEMBER_CACHE_KEY); }

function readMembersFromSheet_() {
  const sh = ss_().getSheetByName(MASTER_SHEET_NAME);
  const cols = masterCols_(sh);
  const last = sh.getLastRow();
  if (last <= MASTER_HEADER_ROW) return [];
  // 月ごとの勤務時間の列は読まず、必要な列（B〜入退社）だけを読む
  const width = Math.max(cols.flag, cols.empType, cols.site, cols.prj, cols.dept, cols.empNo, cols.name, cols.date);
  const vals = sh.getRange(MASTER_HEADER_ROW + 1, 1, last - MASTER_HEADER_ROW, width).getValues();
  const g = (row, c) => c > 0 ? row[c - 1] : '';
  const out = [];
  vals.forEach((row, i) => {
    const name = String(g(row, cols.name)).trim();
    if (!name) return;
    const flag = Number(g(row, cols.flag)) || 0;
    const date = cellDate_(g(row, cols.date));
    const empNo = String(g(row, cols.empNo) || '').trim();
    out.push({
      row: MASTER_HEADER_ROW + 1 + i,
      key: normalizeName_(name), // 氏名で1人を特定（新人に後から社員番号が付いても変わらない）
      name, empNo, flag,
      site: String(g(row, cols.site)).trim(),
      dept: String(g(row, cols.dept)).trim(),
      empType: String(g(row, cols.empType) || '').trim(),
      join: flag === 2 ? date : '',
      leave: (flag === 3 || flag === 9) ? date : '',
    });
  });
  return out;
}

function addMember_(req) {
  if (!req.name || !req.site || !req.dept || !req.joinDate) throw new Error('氏名・拠点・部門・入社日は必須です');
  const sh = ss_().getSheetByName(MASTER_SHEET_NAME);
  const cols = masterCols_(sh);
  const dup = readMembers_(true).find(m => m.site === req.site && normalizeName_(m.name) === normalizeName_(req.name) && m.flag !== 9);
  if (dup) throw new Error(`${req.name}さんはすでに${req.site}に登録されています`);
  // 名前が入っている最後の行の次に書く
  const names = sh.getRange(1, cols.name, sh.getLastRow(), 1).getValues();
  let lastRow = names.length;
  while (lastRow > MASTER_HEADER_ROW && !String(names[lastRow - 1][0]).trim()) lastRow--;
  const r = lastRow + 1;
  const set = (c, v) => { if (c > 0) sh.getRange(r, c).setValue(v); };
  set(cols.flag, 2);
  set(cols.empType, req.empType || '');
  set(cols.site, req.site);
  set(cols.prj, req.site);
  set(cols.dept, req.dept);
  set(cols.name, req.name);
  if (cols.date > 0) sh.getRange(r, cols.date).setValue(new Date(req.joinDate + 'T00:00:00+09:00'));
  return { row: r, key: normalizeName_(req.name) };
}

function findMemberRow_(key) {
  const m = readMembers_(true).find(x => x.key === key);
  if (!m) throw new Error('整理済み_Mに該当する人が見つかりません');
  return m;
}

function setRetire_(key, date, flag) {
  if (!date) throw new Error('退職日を入れてください');
  const m = findMemberRow_(key);
  const sh = ss_().getSheetByName(MASTER_SHEET_NAME);
  const cols = masterCols_(sh);
  sh.getRange(m.row, cols.flag).setValue(flag === 3 ? 3 : 9);
  if (cols.date > 0) sh.getRange(m.row, cols.date).setValue(new Date(date + 'T00:00:00+09:00'));
  return {};
}

function undoRetire_(key) {
  const m = findMemberRow_(key);
  const sh = ss_().getSheetByName(MASTER_SHEET_NAME);
  const cols = masterCols_(sh);
  sh.getRange(m.row, cols.flag).setValue(1);
  if (cols.date > 0) sh.getRange(m.row, cols.date).clearContent();
  return {};
}

/* ===================== シフト ===================== */

function sheet_(name, headers) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); sh.getRange('A:A').setNumberFormat('@'); }
  return sh;
}

function readData_() {
  const sh = sheet_(DATA_SHEET_NAME, DATA_HEADERS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, DATA_HEADERS.length).getValues().map(r => ({
    date: cellDate_(r[0]), site: String(r[1]), key: String(r[2]), name: String(r[3]),
    dept: String(r[4]), value: String(r[5]), hours: Number(r[6]) || 0,
  }));
}

function loadMonth_(site, month, fresh) {
  const members = readMembers_(fresh).filter(m => m.site === site && m.flag !== 8);
  const prefix = month; // 'yyyy-MM'
  const shifts = readData_().filter(r => r.site === site && r.date.indexOf(prefix) === 0)
    .map(r => ({ key: r.key, date: r.date, value: r.value }));
  const fsh = sheet_(FIXED_SHEET_NAME, FIXED_HEADERS);
  const fixed = {};
  if (fsh.getLastRow() >= 2) {
    fsh.getRange(2, 1, fsh.getLastRow() - 1, FIXED_HEADERS.length).getValues().forEach(r => {
      if (String(r[0]) === site) fixed[String(r[1])] = r.slice(3, 10).map(v => String(v || '休'));
    });
  }
  return { members, shifts, fixed };
}

// 指定月・拠点の行を置き換える（他の月・拠点の行には触れない）
function saveShifts_(req) {
  const { site, month, cells } = req;
  if (!site || !/^\d{4}-\d{2}$/.test(month || '')) throw new Error('拠点と月を指定してください');
  const members = readMembers_();
  const byKey = {};
  members.forEach(m => byKey[m.key] = m);
  const sh = sheet_(DATA_SHEET_NAME, DATA_HEADERS);
  const last = sh.getLastRow();
  const keep = last >= 2
    ? sh.getRange(2, 1, last - 1, DATA_HEADERS.length).getValues()
        .filter(r => !(String(r[1]) === site && cellDate_(r[0]).indexOf(month) === 0))
    : [];
  const now = new Date();
  const bad = [];
  const add = [];
  (cells || []).forEach(c => {
    const value = normalizeShift_(c.value);
    if (!value || c.date.indexOf(month) !== 0) return;
    const h = workHours_(value);
    if (h === null) { bad.push(`${c.date} ${value}`); return; }
    const m = byKey[c.key] || {};
    add.push([c.date, site, c.key, m.name || c.name || '', m.dept || c.dept || '', value, h, now]);
  });
  const rows = keep.map(r => [cellDate_(r[0])].concat(r.slice(1))).concat(add)
    .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  if (last >= 2) sh.getRange(2, 1, last - 1, DATA_HEADERS.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, DATA_HEADERS.length).setValues(rows);
  return { saved: add.length, skipped: bad };
}

// 変わったセルだけをシフト_データに反映する（Firestore版のアプリが保存のたびに送る）
function upsertCells_(req) {
  const { site, cells } = req;
  if (!site || !Array.isArray(cells)) throw new Error('拠点とセルを指定してください');
  const byKey = {};
  readMembers_().forEach(m => byKey[m.key] = m);
  const sh = sheet_(DATA_SHEET_NAME, DATA_HEADERS);
  const last = sh.getLastRow();
  const rows = last >= 2 ? sh.getRange(2, 1, last - 1, DATA_HEADERS.length).getValues().map(r => [cellDate_(r[0])].concat(r.slice(1))) : [];
  const index = {};
  rows.forEach((r, i) => { index[`${r[0]}|${r[1]}|${r[2]}`] = i; });
  const now = new Date();
  const remove = {};
  let changed = 0;
  cells.forEach(c => {
    const id = `${c.date}|${site}|${c.key}`;
    const value = normalizeShift_(c.value);
    const i = index[id];
    if (!value) { if (i !== undefined) { remove[i] = true; changed++; } return; }
    const h = workHours_(value);
    if (h === null) return;
    const m = byKey[c.key] || {};
    const row = [c.date, site, c.key, m.name || (i !== undefined ? rows[i][3] : ''), m.dept || (i !== undefined ? rows[i][4] : ''), value, h, now];
    if (i !== undefined) { rows[i] = row; delete remove[i]; } else { index[id] = rows.length; rows.push(row); }
    changed++;
  });
  const out = rows.filter((r, i) => !remove[i]).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  if (last >= 2) sh.getRange(2, 1, last - 1, DATA_HEADERS.length).clearContent();
  if (out.length) sh.getRange(2, 1, out.length, DATA_HEADERS.length).setValues(out);
  return { changed };
}

function saveFixed_(req) {
  const { site, key, name, pattern } = req;
  if (!site || !key || !Array.isArray(pattern) || pattern.length !== 7) throw new Error('固定シフトの形式が正しくありません');
  const norm = pattern.map(v => normalizeShift_(v) || '休');
  norm.forEach(v => { if (workHours_(v) === null) throw new Error(`時間の形式が正しくありません：${v}`); });
  const sh = sheet_(FIXED_SHEET_NAME, FIXED_HEADERS);
  const last = sh.getLastRow();
  const rowVals = [site, key, name || ''].concat(norm, [new Date()]);
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 2).getValues();
    const i = ids.findIndex(r => String(r[0]) === site && String(r[1]) === key);
    if (i >= 0) { sh.getRange(i + 2, 1, 1, FIXED_HEADERS.length).setValues([rowVals]); return {}; }
  }
  sh.appendRow(rowVals);
  return {};
}

// work-hours-forecast.html 用：期間内の人別・日別の実働時間
function hoursRange_(site, from, to) {
  const members = {};
  readMembers_().forEach(m => members[m.key] = m);
  const persons = {};
  readData_().forEach(r => {
    if (r.site !== site || r.date < from || r.date > to) return;
    const p = persons[r.key] || (persons[r.key] = { name: r.name, dept: (members[r.key] || {}).dept || r.dept, days: {} });
    p.days[r.date] = r.hours;
  });
  return { persons: Object.keys(persons).map(k => persons[k]) };
}

/* ===================== 旧シフト表の取り込み（1回だけ実行） ===================== */

// 旧シフト表の fromIso〜toIso の時間・休みを読み、整理済み_Mの人に照合して返す
function readLegacy_(site, fromIso, toIso) {
  const sources = LEGACY_SOURCES[site];
  if (!sources) throw new Error(`${site}の旧シフト表は登録されていません`);
  // 日付は時差の影響を受けないよう、文字列の年・月・日から作る
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const pad2 = n => ('0' + n).slice(-2);
  const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

  // 照合：整理済み_Mの氏名・呼び名の対応表・名字（その拠点で1人に決まるとき）の順に探す
  const members = readMembers_().filter(m => m.site === site);
  const aliases = Object.assign({}, LEGACY_NAME_ALIASES, LEGACY_SITE_ALIASES[site] || {});
  const pick = hits => hits.sort((a, b) => (a.flag === 9) - (b.flag === 9) || (a.flag === 3) - (b.flag === 3))[0] || null;
  const findMember = rawName => {
    const k = normalizeName_(rawName);
    const aliasKey = Object.keys(aliases).find(a => normalizeName_(a) === k);
    const target = aliasKey ? normalizeName_(aliases[aliasKey]) : k;
    const exact = members.filter(m => normalizeName_(m.name) === target);
    if (exact.length) return pick(exact);
    // 名字の照合：氏名がその文字で始まる人（「小林弘和」のように空白のない氏名も拾う）
    const starts = m => target.length >= 2 && normalizeName_(m.name).indexOf(target) === 0;
    const active = members.filter(m => starts(m) && [1, 2].indexOf(m.flag) >= 0);
    if (active.length === 1) return active[0];
    if (active.length > 1) { reasons[rawName] = `同じ名字が${active.length}人（${active.map(m => m.name).join('・')}）`; return null; }
    const others = members.filter(starts);
    reasons[rawName] = others.length ? `整理済み_MのB列が在職中・入社ではない（${others.map(m => m.name + '：B列' + m.flag).join('・')}）` : `整理済み_Mの${site}に見つからない`;
    return null;
  };
  const reasons = {};

  // シートを選ぶ
  const sheets = [];
  sources.forEach(src => {
    const all = SpreadsheetApp.openById(src.id).getSheets();
    const key = `${fm}/${fd}`;
    const found = src.gid ? all.filter(sh => sh.getSheetId() === src.gid)
      : all.filter(sh => String(sh.getName()).normalize('NFKC').indexOf(key) >= 0);
    found.forEach(sh => sheets.push({ sh, src }));
  });
  if (!sheets.length) throw new Error(`${site}の旧シフト表に、${fm}/${fd}から始まる期間のタブが見つかりません`);

  const cellsByMonth = {};
  const unmatched = [], skipped = [];
  let firstDate = '', lastDate = '';
  const seen = {};
  sheets.forEach(({ sh, src }) => {
    const vals = sh.getDataRange().getValues();
    const disp = sh.getDataRange().getDisplayValues();
    // 日付の読み方：日付・「M/D」・日だけ（11、12…）のどれでもよい
    const asDate = (v, d) => {
      if (v instanceof Date) return fmtDate_(v);
      const t = String(d || '').normalize('NFKC').trim();
      const m = t.match(/^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})/);
      if (m) {
        if (m[1]) return iso(m[1], m[2], m[3]);
        let best = '', gap = Infinity;
        [-1, 0, 1].forEach(dy => { const y = fy + dy; const g = Math.abs(new Date(y, +m[2] - 1, +m[3]) - from); if (g < gap) { gap = g; best = iso(y, m[2], m[3]); } });
        return best;
      }
      return /^\d{1,2}$/.test(t) && +t >= 1 && +t <= 31 ? 'D' + t : '';
    };
    let dateRow = 0, best = -1;
    for (let r = 0; r < Math.min(12, vals.length); r++) {
      const n = vals[r].filter((v, c) => c > src.nameCol && asDate(v, disp[r][c])).length;
      if (n > best) { best = n; dateRow = r; }
    }
    // 日だけの列は、期間の始まりの日から順に月をたどって日付にする
    let y = fy, mo = fm, prev = 0;
    const dates = vals[dateRow].map((v, c) => {
      if (c <= src.nameCol) return '';
      const d = asDate(v, disp[dateRow][c]);
      if (!d || d[0] !== 'D') return d;
      const day = +d.slice(1);
      if (prev && day < prev) { mo++; if (mo > 12) { mo = 1; y++; } }
      prev = day;
      return iso(y, mo, day);
    });
    const targetCols = dates.map((d, c) => d && d >= fromIso && (!toIso || d <= toIso) ? c : -1).filter(c => c >= 0);
    Logger.log(`${sh.getName()}：日付の行 ${dateRow + 1}行目／対象 ${targetCols.length}列（${dates[targetCols[0]] || 'なし'}〜${dates[targetCols[targetCols.length - 1]] || 'なし'}）`);
    if (!targetCols.length) return;
    if (!firstDate || dates[targetCols[0]] < firstDate) firstDate = dates[targetCols[0]];
    if (dates[targetCols[targetCols.length - 1]] > lastDate) lastDate = dates[targetCols[targetCols.length - 1]];

    for (let r = dateRow + 1; r < vals.length; r++) {
      const rawName = String(disp[r][src.nameCol] || '').trim();
      if (!rawName) continue;
      const m = findMember(rawName);
      // 空欄に意味がある人（群馬の社員＝8:00-17:00）
      const blankType = m && src.blankAs && Object.keys(src.blankAs).find(t => String(m.empType || '').indexOf(t) >= 0);
      const cells = [], bad = [];
      targetCols.forEach(c => {
        let raw = String(disp[r][c] || '').trim();
        if (!raw) { if (!blankType) return; raw = src.blankAs[blankType]; }
        const value = normalizeShift_(raw);
        if (workHours_(value) === null) { bad.push(`${rawName} ${dates[c]}「${raw}」`); return; }
        cells.push({ date: dates[c], value });
      });
      if (m) skipped.push(...bad); // 集計行の数字などは報告しない
      if (!cells.length) continue; // 時間の入っていない行は無視
      if (!m) { unmatched.push(`${rawName}（${sh.getName()}・${cells.length}日分／${reasons[rawName] || '見つからない'}）`); continue; }
      cells.forEach(x => {
        const id = `${m.key}|${x.date}`;
        if (seen[id]) return; // 同じ人が2つのタブにいるときは先のタブを使う
        seen[id] = true;
        const month = x.date.slice(0, 7);
        (cellsByMonth[month] = cellsByMonth[month] || []).push({ key: m.key, date: x.date, value: x.value });
      });
    }
  });
  if (!firstDate) throw new Error('旧シフト表に、その期間の日付が見つかりませんでした');
  const keys = {};
  Object.keys(cellsByMonth).forEach(mo2 => cellsByMonth[mo2].forEach(c => { keys[c.key] = true; }));
  return { cellsByMonth, keys: Object.keys(keys), unmatched, skipped, from: firstDate, to: lastDate };
}

// 旧シフト表（いなべ）の10/1以降をシフト_データに取り込む（手動で1回だけ実行。アプリ版では画面の「旧シフト表から取り込む」を使う）
function importLegacyShift() {
  const { cellsByMonth, unmatched, skipped } = readLegacy_(LEGACY_SITE, LEGACY_FROM, '');
  Object.keys(cellsByMonth).sort().forEach(month => {
    const res = saveShifts_({ site: LEGACY_SITE, month, cells: cellsByMonth[month] });
    Logger.log(`${month}: ${res.saved}件を取り込みました`);
  });
  if (unmatched.length) Logger.log('整理済み_Mで見つからず取り込まなかった人：' + unmatched.join('、'));
  if (skipped.length) Logger.log('時間として読めず取り込まなかったセル（先頭50件）：\n' + skipped.slice(0, 50).join('\n'));
}
