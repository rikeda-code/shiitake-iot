// 在庫の検証画面（dashboard/stock-check.html）のテスト共通部品。
// 実際のスプレッドシートには触れず、page.route() で「2026年ファーム売上高・収穫量」のCSVを、
// 実際のシートの形（拠点・月ごとの見出し行・列の位置、「○月対見込」の移動表）に合わせてモックする。
// 値は fixtures.js（2026-11-03に読み取った実データ）。
const fs = require('fs');
const path = require('path');
const FIX = require('./fixtures');

const BASE_URL = 'http://localhost:8812/stock-check.html';
const SALES_FILE_ID = '1VtDcGx7MLKJM4gkbgP0VAdkn6EpoIfOXhZVa3u80m2c';
// 画面の SOURCES と同じ内容（食い違えば verify_stock_check_parse.js が NG にする）
const EXPECTED_SOURCES = {
  '2026-06': { anchorOnly: true, sites: { 'いなべ': '790288201', '群馬': '1365732734', '南丹': '1827976353' } },
  '2026-07': { sites: { 'いなべ': '893422909',  '群馬': '449316865',  '南丹': '2085953171' }, taimi: '2010023692' },
  '2026-08': { sites: { 'いなべ': '1717849701', '群馬': '1821704623', '南丹': '1035249366' }, taimi: '1072966250' },
  '2026-09': { sites: { 'いなべ': '889530489',  '群馬': '1980683578', '南丹': '859682596' },  taimi: '1257806650' },
  '2026-10': { sites: { 'いなべ': '131485865',  '群馬': '1913253722', '南丹': '1061657376' }, taimi: '156359832' },
  '2026-11': { sites: { 'いなべ': '140203273',  '群馬': '60188881',   '南丹': '1898984985' }, taimi: '760891261' },
};
const CHART_JS = fs.readFileSync(path.join(__dirname, '..', 'work-hours', 'vendor', 'chart.umd.js'), 'utf8');

function colIdx(letters) { return letters.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1; }
function csvCell(v) { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsvText(rows) { return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
function daysInMonth(key) { return new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 0)).getUTCDate(); }
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

// 拠点・月ごとのタブの形（実データの見出し位置）。
//   7・8月（と6月）は出荷実績・収穫量の列が違う（9月以降は2列右）。群馬の8月以前は行が1行下。
function layout(site, monthKey) {
  const old = monthKey <= '2026-08';
  if (site === '南丹') return { upHdr: 3, stHdr: 41, date: 'AE', date2: 'AD', ship: old ? 'AN' : 'AR', harv: old ? 'AP' : 'AT', total: 'BB', waste: 'AR', kik: 'AS', kikName: '規格外' };
  if (site === '群馬') { const s = old ? 1 : 0; return { upHdr: 4 + s, stHdr: 43 + s, date: 'AE', date2: 'AD', ship: old ? 'AN' : 'AR', harv: old ? 'AP' : 'AT', total: 'BC', waste: 'AR', kik: 'AS', kikName: '規格外' }; }
  return { upHdr: 10, stHdr: 51, date: 'AG', date2: 'AG', ship: old ? 'AP' : 'AT', harv: old ? 'AR' : 'AV', total: 'BF', waste: 'AU', kik: 'AV', kikName: '出荷場規格外', stray: 'BI' };
}

function fmtNum(v, plain) {
  if (v === null || v === undefined) return '';
  if (plain || Math.abs(v) < 1000) return String(v);
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }); // 実際のシートは1,000以上を「1,103.1」の形で出す
}

// 拠点・月のタブのCSV行（2次元配列）を、実際のシートの形で作る。
// overrides: { '2026-10-27': [出荷, 収穫, 在庫, 廃棄, 規格外] } で、実データの日の値を差し替える
function makeSiteRows(site, monthKey, overrides) {
  const L = layout(site, monthKey);
  const rows = Array.from({ length: 110 }, () => []);
  const set = (r, c, v) => { while (rows[r].length <= c) rows[r].push(''); rows[r][c] = v; };
  set(0, 10, 'M'); set(0, 11, 'L'); set(1, 10, '1,503.5'); set(2, 10, '16.9%'); // 先頭の作業用の表（見出しではない）
  set(L.upHdr, colIdx(L.date), '日付');
  set(L.upHdr, colIdx(L.ship), '出荷実績');
  set(L.upHdr, colIdx(L.harv), '収穫量\n（合計）');
  set(L.stHdr, colIdx(L.date2), '日付');
  set(L.stHdr, colIdx(L.total), '合計在庫');
  set(L.stHdr, colIdx(L.waste), '出荷場廃棄');
  set(L.stHdr, colIdx(L.kik), L.kikName);
  if (L.stray) set(L.stHdr, colIdx(L.stray), '出荷実績'); // いなべの在庫の表にある、別の「出荷実績」の見出し
  const m = +monthKey.slice(5, 7), n = daysInMonth(monthKey);
  for (let d = 1; d <= n; d++) {
    const iso = monthKey + '-' + String(d).padStart(2, '0');
    const arr = (overrides && overrides[iso]) || (FIX.days[site] && FIX.days[site][iso]);
    const label = String(m).padStart(2, '0') + '/' + String(d).padStart(2, '0') + '(' + DOW[new Date(Date.UTC(2026, m - 1, d)).getUTCDay()] + ')';
    set(L.upHdr + d, colIdx(L.date), label);
    set(L.stHdr + d, colIdx(L.date2), label);
    if (arr) {
      set(L.upHdr + d, colIdx(L.ship), fmtNum(arr[0]));
      set(L.upHdr + d, colIdx(L.harv), fmtNum(arr[1]));
      set(L.stHdr + d, colIdx(L.total), fmtNum(arr[2], true));
      set(L.stHdr + d, colIdx(L.waste), fmtNum(arr[3]));
      set(L.stHdr + d, colIdx(L.kik), fmtNum(arr[4]));
    } else { // データの無い日（未来の日）：シートでは 0 が入っている
      set(L.upHdr + d, colIdx(L.ship), '0.0');
      set(L.upHdr + d, colIdx(L.harv), '0');
      set(L.stHdr + d, colIdx(L.total), '0');
    }
  }
  return rows;
}

// 「○月対見込」タブ：上のほうに別の表があり、106行目あたりから移動表がある
function makeTaimiRows(monthKey, extraRows) {
  const rows = Array.from({ length: 106 }, () => []);
  rows[1] = ['', '(い)買取出荷目標', '(い)市場出荷目標', '(い)委託出荷目標'];
  rows[2] = ['10/01(木)', '365.2', '', '251.3'];
  (FIX.taimi[monthKey] || []).forEach(r => rows.push(r.slice()));
  (extraRows || []).forEach(r => rows.push(r));
  return rows;
}

// SOURCES（gid）→ モックの中身
function gidTable(taimiExtra) {
  const t = {};
  Object.keys(EXPECTED_SOURCES).forEach(key => {
    const src = EXPECTED_SOURCES[key];
    Object.keys(src.sites).forEach(site => { t[src.sites[site]] = { kind: 'site', site, key }; });
    if (src.taimi) t[src.taimi] = { kind: 'taimi', key };
  });
  return t;
}

// 全リクエストを記録しつつ、CSVとChart.jsをモックする。
// opts.missing: 返さない（404にする）月（例 ['2026-07']）／opts.overrides: { 拠点: { 日付: [値] } }／opts.taimiExtra: { 月: [行] }
async function installMocks(page, opts) {
  opts = opts || {};
  const log = { requests: [], csvGids: [] };
  const table = gidTable();
  page.on('request', req => log.requests.push({ method: req.method(), url: req.url() }));
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost')) return route.continue();
    if (url.includes('chart.umd')) return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: CHART_JS });
    const m = /\/spreadsheets\/d\/([^/]+)\/export\?format=csv&gid=(\d+)/.exec(url);
    if (m && m[1] === SALES_FILE_ID) {
      log.csvGids.push(m[2]);
      const ent = table[m[2]];
      if (!ent || (opts.missing || []).indexOf(ent.key) >= 0) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
      const rows = ent.kind === 'site'
        ? makeSiteRows(ent.site, ent.key, opts.overrides && opts.overrides[ent.site])
        : makeTaimiRows(ent.key, opts.taimiExtra && opts.taimiExtra[ent.key]);
      return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: toCsvText(rows) });
    }
    return route.abort(); // 想定外の外部通信は止める（記録には残る）
  });
  return log;
}

function fixTodayTo(page, y, m, d) { // m は 0 始まり（既存のテストと同じ）
  return page.addInitScript(([y, m, d]) => {
    const FIXED = new Date(y, m, d, 9, 0, 0).getTime();
    const OrigDate = Date;
    class FixedDate extends OrigDate {
      constructor(...args) { if (args.length === 0) return new OrigDate(FIXED); return new OrigDate(...args); }
      static now() { return FIXED; }
    }
    window.Date = FixedDate;
  }, [y, m, d]);
}

let allOk = true;
function check(name, cond, extra) {
  const ok = !!cond;
  if (!ok) allOk = false;
  console.log(name + ': ' + (ok ? 'OK' : 'NG') + (extra !== undefined && !ok ? '  ← ' + JSON.stringify(extra) : ''));
}
function near(a, b, eps) { return a != null && Math.abs(a - b) <= (eps === undefined ? 0.05 : eps); }
function finish() { console.log(allOk ? 'すべてOK' : 'NGあり'); console.log('DONE'); process.exit(allOk ? 0 : 1); }

module.exports = { BASE_URL, SALES_FILE_ID, EXPECTED_SOURCES, FIX, colIdx, toCsvText, makeSiteRows, makeTaimiRows, installMocks, fixTodayTo, check, near, finish };
