// 標準労働時間を拠点シフト表の「シフト_データ」タブ（ファーム勤務時間）から読む機能の検証。
// モックは実際のシフト_データと同じ形にする：1行目＝見出し「日付,拠点,キー,氏名,部門,シフト,実働h,更新日時」、
// 日付は '2026-11-02'、キーは氏名から空白を除いたもの、シフトは '8:00-17:00'・'休'・'8:00-17:00栽培4h' など、
// 実働hは拠点シフト表のルール（拘束5時間以上で休憩1時間）で計算済みの数字の文字列
const { chromium } = require('playwright');

function csvCell(v) { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsvText(rows) { return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }

function fixTodayTo(page, y, m, d) {
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

const SHIFT_DATA_ID = '1LtYb1feXR6jtIEfxaADLiTEWpPabKJDDlwoS1V-yuG0';
const SHIFT_DATA_GID = '889947728';
const HEADER = ['日付', '拠点', 'キー', '氏名', '部門', 'シフト', '実働h', '更新日時'];

// 1人1日1行。[日付, 拠点, 氏名, 部門, シフト, 実働h]
function rec(date, site, name, dept, shift, hours) {
  return [date, site, name.replace(/\s/g, ''), name, dept, shift, hours, '2026/11/01'];
}
// いなべ：11/2〜11/5 だけデータがある（11/6〜11/8 は期間外＝「－」）。11/4 は栽培の人がいない（＝0）
const ROWS = [
  // 栽培
  rec('2026-11-02', 'いなべ', '栽培 一郎', '栽培', '8:00-17:00', '8'),
  rec('2026-11-03', 'いなべ', '栽培 一郎', '栽培', '9:00-14:00', '4'),      // 拘束5h→実働4h（こちらで計算し直さない）
  rec('2026-11-04', 'いなべ', '栽培 一郎', '栽培', '休', '0'),
  rec('2026-11-05', 'いなべ', '栽培 一郎', '栽培', '8:00-17:00出荷4h', '8'), // 4hは出荷へ
  rec('2026-11-02', 'いなべ', '配送 栽培子', '配送・栽培', '8:00-12:00', '4'), // 配送・栽培は栽培に入れる
  rec('2026-11-03', 'いなべ', '配送 栽培子', '配送・栽培', '8:00-17:00配送', '8'), // 全部配送へ（栽培0）
  rec('2026-11-04', 'いなべ', '配送 栽培子', '配送・栽培', '希望休', '0'),
  // 出荷
  rec('2026-11-02', 'いなべ', '出荷 花子', '出荷', '8:00-17:00栽培4h', '8'), // 4hは栽培へ
  rec('2026-11-03', 'いなべ', '出荷 花子', '出荷', '8:00-16:00', '7'),
  rec('2026-11-04', 'いなべ', '出荷 花子', '出荷', '8:00-17:00半日配送', '8'), // 半分(4h)は配送へ
  rec('2026-11-05', 'いなべ', '出荷 花子', '出荷', '8:00-17:00', ''),     // 実働hが空欄→0h＋注意
  rec('2026-11-02', 'いなべ', '配送 出荷男', '配送・出荷', '6:00-15:00', '8'),
  // 数えない部門
  rec('2026-11-02', 'いなべ', '部長 太郎', '生産部長', '8:00-17:00栽培8h', '8'), // 生産部長は応援の印でも数えない
  rec('2026-11-02', 'いなべ', '配送 専任', '配送', '8:00-17:00', '8'),
  rec('2026-11-03', 'いなべ', '配送 専任', '配送', '8:00-17:00栽培4h', '8'), // 配送の人の応援は栽培に4h
  rec('2026-11-02', 'いなべ', '事務 さん', '事務', '9:00-18:00', '8'),
  rec('2026-11-02', 'いなべ', '空欄 さん', '', '8:00-17:00', '8'),
  // 別の拠点（いなべの計算に混ざらない）
  rec('2026-11-02', '群馬', '群馬 出荷', '出荷', '8:00-17:00', '8'),
  rec('2026-11-02', '群馬', '群馬 配送出荷', '配送・出荷', '6:00-15:00', '8'),
  rec('2026-11-08', '群馬', '群馬 出荷', '出荷', '8:00-17:00', '8'),
];
const SHIFT_DATA_CSV = toCsvText([HEADER].concat(ROWS));

async function setupRoutes(page, body, log) {
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes(SHIFT_DATA_ID) && url.includes(`gid=${SHIFT_DATA_GID}`)) {
      if (log) log.push(url);
      await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' });
  });
  // GAS（収穫見込など）は読まない
  await page.route('https://script.google.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","items":[]}' }));
}

async function openPage(browser, query, body, log) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await fixTodayTo(page, 2026, 10, 2); // 今日＝2026/11/2(月)。基準日の初期値もこの日
  await setupRoutes(page, body, log);
  await page.goto('http://localhost:8811/work-hours-forecast.html' + query, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  return page;
}
async function rowTexts(page, attr) {
  return page.evaluate(attr => Array.from({ length: 7 }, (_, o) => document.querySelector(`[${attr}="${o}"]`).textContent.trim()), attr);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let allOk = true;
  function check(name, cond, detail) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}${!cond && detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`); if (!cond) allOk = false; }

  console.log('=== ① 切り替えの設定は3拠点とも「旧」のまま。旧のままならシフト_データを読まない ===');
  {
    const log = [];
    const page = await openPage(browser, '?div=' + encodeURIComponent('栽培') + '&site=' + encodeURIComponent('いなべ'), SHIFT_DATA_CSV, log);
    const src = await page.evaluate(() => window.__test.LABOR_SOURCE_BY_SITE);
    check('LABOR_SOURCE_BY_SITE が いなべ・群馬・南丹 とも old', src['いなべ'] === 'old' && src['群馬'] === 'old' && src['南丹'] === 'old', src);
    const use = await page.evaluate(() => ['いなべ', '群馬', '南丹'].map(s => window.__test.useShiftDataLabor(s)));
    check('useShiftDataLabor() が3拠点とも false', use.every(v => v === false), use);
    check('栽培×いなべを開いてもシフト_データのタブを読みに行かない', log.length === 0, log);
    await page.close();
  }

  console.log('=== ② 見出しの名前で列を探す（列の順番が違っても読める。キーの列は無くてもよい） ===');
  {
    const page = await openPage(browser, '', SHIFT_DATA_CSV);
    const r = await page.evaluate(() => {
      const T = window.__test;
      const rows = [['更新日時', '実働h', 'シフト', '部門', '氏名', '拠点', '日付'], ['2026/11/01', '7.5', '8:30-17:00', '出荷', '出荷 花子', 'いなべ', '2026-11-02'], ['', '', '', '', '', '', '']]
        .map(r => ({ c: r.map(v => ({ v })) }));
      return T.parseShiftDataRows(rows);
    });
    check('列の順番を入れ替えても日付・拠点・氏名・部門・シフト・実働hを読める', r.length === 1 && r[0].date === '2026-11-02' && r[0].site === 'いなべ' && r[0].name === '出荷 花子' && r[0].dept === '出荷' && r[0].shift === '8:30-17:00' && r[0].hours === 7.5, r);
    check('キーの列が無いときは氏名から空白を除いたものを使う', r[0] && r[0].key === '出荷花子', r[0] && r[0].key);
    const err = await page.evaluate(() => {
      try { window.__test.parseShiftDataRows([{ c: ['日付', '拠点', 'キー', '氏名', '部門', 'シフト', '更新日時'].map(v => ({ v })) }]); return null; }
      catch (e) { return e.message; }
    });
    check('「実働h」の見出しが無いとエラーになり、見出しの名前がメッセージに入る', !!err && err.indexOf('実働h') !== -1, err);
    const dateAlt = await page.evaluate(() => window.__test.parseShiftDataRows([
      { c: ['日付', '拠点', '氏名', '部門', 'シフト', '実働h'].map(v => ({ v })) },
      { c: ['2026/11/2', 'いなべ', 'A', '栽培', '8:00-17:00', '8'].map(v => ({ v })) },
    ])[0].date);
    check('日付が 2026/11/2 の書き方でも 2026-11-02 として読む', dateAlt === '2026-11-02', dateAlt);
    await page.close();
  }

  console.log('=== ③ 応援の印で行き先の部門に時間を移す（拠点シフト表と同じ決まり） ===');
  {
    const page = await openPage(browser, '', SHIFT_DATA_CSV);
    const s = await page.evaluate(() => {
      const f = window.__test.splitShiftDataHours;
      return {
        ship4: f('いなべ', '出荷', '8:00-17:00栽培4h', 8),
        cult8: f('いなべ', '栽培', '8:00-17:00出荷8h', 8),
        short: f('いなべ', '出荷', '8:00-12:00栽培4h', 3),
        half: f('いなべ', '出荷', '8:00-17:00半日配送', 8),
        deliv: f('いなべ', '配送・栽培', '8:00-17:00配送', 8),
        self: f('いなべ', '栽培', '8:00-17:00栽培4h', 8),
        boss: f('いなべ', '生産部長', '8:00-17:00栽培8h', 8),
        other: f('いなべ', '配送', '8:00-17:00出荷4h', 8),
        plain: f('いなべ', '営業', '8:00-17:00', 8),
      };
    });
    check('出荷の人の「栽培4h」→ 出荷4h・栽培4h', s.ship4['出荷'] === 4 && s.ship4['栽培'] === 4, s.ship4);
    check('栽培の人の「出荷8h」→ 出荷8h（栽培0）', s.cult8['出荷'] === 8 && !s.cult8['栽培'], s.cult8);
    check('実働が4hより短い日の「栽培4h」は実働まで（3h）', s.short['栽培'] === 3 && !s.short['出荷'], s.short);
    check('「半日配送」は実働の半分を配送へ（出荷4h）', s.half['出荷'] === 4 && s.half['配送'] === 4, s.half);
    check('配送・栽培の人の「配送」は全部配送へ（栽培0）', s.deliv['配送'] === 8 && !s.deliv['栽培'], s.deliv);
    check('行き先が自分の部門なら全部そのまま（栽培8h）', s.self['栽培'] === 8 && Object.keys(s.self).length === 1, s.self);
    check('生産部長は応援の印でも数えない', Object.keys(s.boss).length === 0, s.boss);
    check('配送の人の「出荷4h」は出荷に4hだけ数える', s.other['出荷'] === 4 && Object.keys(s.other).length === 1, s.other);
    check('振り分けに無い部門（営業）で印が無ければ数えない', Object.keys(s.plain).length === 0, s.plain);
    await page.close();
  }

  console.log('=== ④ 計算（純粋関数）：期間外は「－」、期間内で人がいない日は0、実働hをそのまま使う ===');
  {
    const page = await openPage(browser, '', SHIFT_DATA_CSV);
    const res = await page.evaluate(async () => {
      const T = window.__test;
      const basis = new Date(2026, 10, 2);
      const cult = await T.fetchShiftDataLabor('いなべ', '栽培', basis);
      const ship = await T.fetchShiftDataLabor('いなべ', '出荷', basis);
      const gunmaShip = await T.fetchShiftDataLabor('群馬', '出荷', basis);
      const nantan = await T.fetchShiftDataLabor('南丹', '栽培', basis);
      return { cult, ship, gunmaShip, nantan };
    });
    const c = res.cult, s = res.ship;
    // 栽培：11/2 栽培一郎8＋配送栽培子4＝12、11/3 一郎4＋配送専任の応援4＝8（配送栽培子は全部配送）、11/4 0、11/5 一郎8−出荷4h＝4＋出荷花子なし
    // 11/2 は出荷花子の栽培4h も入る → 16
    check('栽培の日ごとの合計 [16,8,0,4,－,－,－]', JSON.stringify(c.perDayTotal) === JSON.stringify([16, 8, 0, 4, null, null, null]), c.perDayTotal);
    check('栽培の出勤人数 [3,2,0,1,－,－,－]', JSON.stringify(c.perDayAttendance) === JSON.stringify([3, 2, 0, 1, null, null, null]), c.perDayAttendance);
    check('11/3 の「9:00-14:00」は実働h(4)をそのまま使う（5hにしない）', c.personBreakdown.find(p => p.name === '栽培 一郎').dayHours[1] === 4, c.personBreakdown.find(p => p.name === '栽培 一郎'));
    // 出荷：11/2 花子8−栽培4h=4＋配送出荷男8=12、11/3 7、11/4 8−半日配送4=4、11/5 実働h空欄→0＋一郎の出荷4h=4
    check('出荷の日ごとの合計 [12,7,4,4,－,－,－]', JSON.stringify(s.perDayTotal) === JSON.stringify([12, 7, 4, 4, null, null, null]), s.perDayTotal);
    check('出荷の出勤人数 [2,1,1,1,－,－,－]', JSON.stringify(s.perDayAttendance) === JSON.stringify([2, 1, 1, 1, null, null, null]), s.perDayAttendance);
    check('実働hが空欄の日は注意が出る（出荷 花子 11/5）', s.warnings.some(w => w.indexOf('出荷 花子') !== -1 && w.indexOf('11/5') !== -1), s.warnings);
    check('期間外の注記（11/6〜11/8）', c.periodNotices.length === 1 && c.periodNotices[0].indexOf('2026/11/6〜11/8') !== -1, c.periodNotices);
    const names = c.personBreakdown.map(p => p.name + '|' + p.dept);
    check('栽培の人別内訳：栽培・配送・栽培の人と、応援で来た人（部門に「（応援）」）', JSON.stringify(names) === JSON.stringify(['栽培 一郎|栽培', '配送 栽培子|配送・栽培', '出荷 花子|出荷（応援）', '配送 専任|配送（応援）']), names);
    check('生産部長・事務・部門空欄・別拠点の人は栽培の内訳に入らない', !names.some(n => /部長|事務|空欄|群馬/.test(n)), names);
    check('休みの日も内訳では0（期間外は null）', JSON.stringify(c.personBreakdown[0].dayHours) === JSON.stringify([8, 4, 0, 4, null, null, null]), c.personBreakdown[0].dayHours);
    check('群馬×出荷：11/2 と 11/8 だけデータがあり、間の日は人がいないので0', JSON.stringify(res.gunmaShip.perDayTotal) === JSON.stringify([16, 0, 0, 0, 0, 0, 8]), res.gunmaShip.perDayTotal);
    check('南丹（データ無し）は全部「－」で「シフトがありません」の注記', res.nantan.perDayTotal.every(v => v === null) && res.nantan.periodNotices[0].indexOf('南丹') !== -1, res.nantan);
    await page.close();
  }

  console.log('=== ⑤ 部門の振り分けは拠点ごとに設定で変えられる ===');
  {
    const page = await openPage(browser, '', SHIFT_DATA_CSV);
    const r = await page.evaluate(async () => {
      const T = window.__test;
      const basis = new Date(2026, 10, 2);
      const before = (await T.fetchShiftDataLabor('群馬', '出荷', basis)).perDayTotal[0];
      T.SHIFT_DATA_DIV_DEPTS['群馬']['出荷'] = ['出荷']; // 群馬だけ「配送・出荷」を外す
      const after = (await T.fetchShiftDataLabor('群馬', '出荷', basis)).perDayTotal[0];
      const inabe = (await T.fetchShiftDataLabor('いなべ', '出荷', basis)).perDayTotal[0];
      return { before, after, inabe };
    });
    check('群馬の出荷から「配送・出荷」を外すと 16→8 になる', r.before === 16 && r.after === 8, r);
    check('いなべの出荷は変わらない（12）', r.inabe === 12, r);
    await page.close();
  }

  console.log('=== ⑥ 画面：?laborSource=shiftData で切り替えたときの栽培・出荷のパネル ===');
  {
    const page = await openPage(browser, '?laborSource=shiftData&div=' + encodeURIComponent('栽培') + '&site=' + encodeURIComponent('いなべ'), SHIFT_DATA_CSV);
    const totals = await rowTexts(page, 'data-labor-total-offset');
    const attend = await rowTexts(page, 'data-attendance-offset');
    check('栽培：標準労働時間合計 16/8/0/4/－/－/－（期間内で人がいない11/4は0.0）', JSON.stringify(totals) === JSON.stringify(['16.0', '8.0', '0.0', '4.0', '－', '－', '－']), totals);
    check('栽培：出勤人数 3/2/0/1/－/－/－', JSON.stringify(attend) === JSON.stringify(['3', '2', '0', '1', '－', '－', '－']), attend);
    const note = await page.evaluate(() => document.getElementById('laborPeriodNotices').textContent);
    check('栽培：期間外の注記が出る', note.indexOf('シフト_データにまだシフトが無い期間') !== -1, note);
    const detail = await page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => tr.querySelector('th').textContent.trim()));
    check('栽培：人別内訳に4人', detail.length === 4, detail);
    const err = await page.evaluate(() => document.getElementById('laborError').textContent.trim());
    check('栽培：エラーは出ない', err === '', err);

    await page.click('#businessToggle button[data-business="出荷"]');
    await page.waitForTimeout(1500);
    const st = await rowTexts(page, 'data-shiplabor-total-offset');
    check('出荷：標準労働時間合計 12/7/4/4/－/－/－', JSON.stringify(st) === JSON.stringify(['12.0', '7.0', '4.0', '4.0', '－', '－', '－']), st);
    const warn = await page.evaluate(() => document.getElementById('shipLaborWarningsList').textContent);
    check('出荷：実働hが空欄の注意が画面に出る', warn.indexOf('実働hが空欄') !== -1, warn);
    await page.close();
  }

  console.log('=== ⑦ 画面：シフト_データの見出しが見つからないとき、パネルに注意を出す ===');
  {
    const bad = toCsvText([['日付', '拠点', 'キー', '氏名', '部門', 'シフト', '実働時間', '更新日時']].concat(ROWS));
    const page = await openPage(browser, '?laborSource=shiftData&div=' + encodeURIComponent('栽培') + '&site=' + encodeURIComponent('いなべ'), bad);
    const err = await page.evaluate(() => document.getElementById('laborError').textContent.trim());
    check('栽培：「実働h」の見出しが見つからない旨のエラーが出る', err.indexOf('実働h') !== -1 && err.indexOf('見出し') !== -1, err);
    const totals = await rowTexts(page, 'data-labor-total-offset');
    check('栽培：合計は「－」のまま（0にしない）', totals.every(v => v === '－'), totals);
    await page.close();
  }

  await browser.close();
  console.log('\n=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
