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

// extra：ほかに返すシート [{ id, gid, body }]（旧のシフト表など）
async function setupRoutes(page, body, log, extra) {
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes(SHIFT_DATA_ID) && url.includes(`gid=${SHIFT_DATA_GID}`)) {
      if (log) log.push(url);
      await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
      return;
    }
    const hit = (extra || []).find(x => url.includes(x.id) && url.includes(`gid=${x.gid}`));
    if (hit) {
      if (log) log.push(url);
      await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: hit.body });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' });
  });
  // GAS（収穫見込など）は読まない
  await page.route('https://script.google.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","items":[]}' }));
}

async function openPage(browser, query, body, log, extra, today) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const t = today || [2026, 10, 2]; // 既定は 今日＝2026/11/2(月)。基準日の初期値もこの日
  await fixTodayTo(page, t[0], t[1], t[2]);
  await setupRoutes(page, body, log, extra);
  await page.goto('http://localhost:8811/work-hours-forecast.html' + query, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  return page;
}
// いなべの切り替え日(11/11)より前の基準日で新の読み方を見るため、テストの中だけ切り替え日を外して描き直す
async function rerenderWithoutSwitchDate(page) {
  await page.evaluate(() => { window.__test.LABOR_SWITCH_DATE_BY_SITE['いなべ'] = null; });
  await page.dispatchEvent('#basisDateInput', 'change');
  await page.waitForTimeout(1500);
}
async function setBasisDate(page, iso) {
  await page.fill('#basisDateInput', iso);
  await page.dispatchEvent('#basisDateInput', 'change');
  await page.waitForTimeout(1500);
}
// 旧のいなべシフト表（栽培 出荷 シフト表）と同じ形：1行目=日付(M/D)、2行目=曜日、3〜13行目=空欄、14行目以降=人(氏名,部門,日ごとのセル)
function buildOldInabeShiftCsv(dates, people) {
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const rows = [['', ''].concat(dates.map(d => `${d.getMonth() + 1}/${d.getDate()}`)), ['', ''].concat(dates.map(d => WD[d.getDay()]))];
  for (let i = 0; i < 11; i++) rows.push(['', ''].concat(dates.map(() => '')));
  people.forEach(p => rows.push([p.name, p.dept].concat(dates.map((d, i) => p.cells[i] || ''))));
  return toCsvText(rows);
}
async function rowTexts(page, attr) {
  return page.evaluate(attr => Array.from({ length: 7 }, (_, o) => document.querySelector(`[${attr}="${o}"]`).textContent.trim()), attr);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let allOk = true;
  function check(name, cond, detail) { console.log(`  ${name}: ${cond ? 'OK' : 'NG'}${!cond && detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`); if (!cond) allOk = false; }

  console.log('=== ① 切り替えの設定は3拠点とも shiftData。切り替え日より前の基準日ではシフト_データを読まない ===');
  {
    const log = [];
    const page = await openPage(browser, '?div=' + encodeURIComponent('栽培') + '&site=' + encodeURIComponent('いなべ'), SHIFT_DATA_CSV, log);
    const src = await page.evaluate(() => window.__test.LABOR_SOURCE_BY_SITE);
    check('LABOR_SOURCE_BY_SITE が いなべ・群馬・南丹 とも shiftData', src['いなべ'] === 'shiftData' && src['群馬'] === 'shiftData' && src['南丹'] === 'shiftData', src);
    const use = await page.evaluate(() => ['いなべ', '群馬', '南丹'].map(s => window.__test.useShiftDataLabor(s)));
    check('useShiftDataLabor() が3拠点とも true', use.every(v => v === true), use);
    check('基準日 11/2 の栽培×いなべ（7日間すべて切り替え日 11/11 より前）はシフト_データのタブを読みに行かない', log.length === 0, log);
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
        dCult: f('いなべ', '配送・栽培', '8:00-17:00', 8),
        dShip: f('いなべ', '配送・出荷', '8:00-17:00', 8),
      };
    });
    check('配送・栽培・配送・出荷の人は（印が無ければ）数えない', Object.keys(s.dCult).length === 0 && Object.keys(s.dShip).length === 0, [s.dCult, s.dShip]);
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
    // 栽培：11/2 栽培一郎8＋出荷花子の栽培4h＝12（配送・栽培の配送栽培子は数えない）、11/3 一郎4＋配送専任の応援4＝8、
    // 11/4 0、11/5 一郎8−出荷4h＝4
    check('栽培の日ごとの合計 [12,8,0,4,－,－,－]', JSON.stringify(c.perDayTotal) === JSON.stringify([12, 8, 0, 4, null, null, null]), c.perDayTotal);
    check('栽培の出勤人数 [2,2,0,1,－,－,－]', JSON.stringify(c.perDayAttendance) === JSON.stringify([2, 2, 0, 1, null, null, null]), c.perDayAttendance);
    check('11/3 の「9:00-14:00」は実働h(4)をそのまま使う（5hにしない）', c.personBreakdown.find(p => p.name === '栽培 一郎').dayHours[1] === 4, c.personBreakdown.find(p => p.name === '栽培 一郎'));
    // 出荷：11/2 花子8−栽培4h=4（配送・出荷の配送出荷男は数えない）、11/3 7、11/4 8−半日配送4=4、11/5 実働h空欄→0＋一郎の出荷4h=4
    check('出荷の日ごとの合計 [4,7,4,4,－,－,－]', JSON.stringify(s.perDayTotal) === JSON.stringify([4, 7, 4, 4, null, null, null]), s.perDayTotal);
    check('出荷の出勤人数 [1,1,1,1,－,－,－]', JSON.stringify(s.perDayAttendance) === JSON.stringify([1, 1, 1, 1, null, null, null]), s.perDayAttendance);
    check('実働hが空欄の日は注意が出る（出荷 花子 11/5）', s.warnings.some(w => w.indexOf('出荷 花子') !== -1 && w.indexOf('11/5') !== -1), s.warnings);
    check('期間外の注記（11/6〜11/8）', c.periodNotices.length === 1 && c.periodNotices[0].indexOf('2026/11/6〜11/8') !== -1, c.periodNotices);
    const names = c.personBreakdown.map(p => p.name + '|' + p.dept);
    check('栽培の人別内訳：栽培の人と、応援で来た人（部門に「（応援）」）', JSON.stringify(names) === JSON.stringify(['栽培 一郎|栽培', '出荷 花子|出荷（応援）', '配送 専任|配送（応援）']), names);
    check('配送・栽培・生産部長・事務・部門空欄・別拠点の人は栽培の内訳に入らない', !names.some(n => /配送・栽培|部長|事務|空欄|群馬/.test(n)), names);
    check('休みの日も内訳では0（期間外は null）', JSON.stringify(c.personBreakdown[0].dayHours) === JSON.stringify([8, 4, 0, 4, null, null, null]), c.personBreakdown[0].dayHours);
    check('群馬×出荷：11/2 と 11/8 だけデータがあり、間の日は人がいないので0（配送・出荷は数えない）', JSON.stringify(res.gunmaShip.perDayTotal) === JSON.stringify([8, 0, 0, 0, 0, 0, 8]), res.gunmaShip.perDayTotal);
    check('南丹（データ無し）は全部「－」で「シフトがありません」の注記', res.nantan.perDayTotal.every(v => v === null) && res.nantan.periodNotices[0].indexOf('南丹') !== -1, res.nantan);
    await page.close();
  }

  console.log('=== ⑤ 部門の振り分けは拠点ごとに設定で変えられる ===');
  {
    const page = await openPage(browser, '', SHIFT_DATA_CSV);
    const r = await page.evaluate(async () => {
      const T = window.__test;
      const basis = new Date(2026, 10, 2);
      const depts = JSON.parse(JSON.stringify(T.SHIFT_DATA_DIV_DEPTS));
      const before = (await T.fetchShiftDataLabor('群馬', '出荷', basis)).perDayTotal[0];
      T.SHIFT_DATA_DIV_DEPTS['群馬']['出荷'] = ['出荷', '配送・出荷']; // 群馬だけ「配送・出荷」を足す
      const after = (await T.fetchShiftDataLabor('群馬', '出荷', basis)).perDayTotal[0];
      const inabe = (await T.fetchShiftDataLabor('いなべ', '出荷', basis)).perDayTotal[0];
      return { depts, before, after, inabe };
    });
    const onlyOwn = ['いなべ', '群馬', '南丹'].every(s => JSON.stringify(r.depts[s]) === JSON.stringify({ '栽培': ['栽培'], '出荷': ['出荷'] }));
    check('設定の初期値は3拠点とも 栽培＝栽培のみ・出荷＝出荷のみ', onlyOwn, r.depts);
    check('群馬の出荷に「配送・出荷」を足すと 8→16 になる', r.before === 8 && r.after === 16, r);
    check('いなべの出荷は変わらない（4）', r.inabe === 4, r);
    await page.close();
  }

  console.log('=== ⑥ 画面：?laborSource=shiftData で切り替えたときの栽培・出荷のパネル ===');
  {
    const page = await openPage(browser, '?laborSource=shiftData&div=' + encodeURIComponent('栽培') + '&site=' + encodeURIComponent('いなべ'), SHIFT_DATA_CSV);
    await rerenderWithoutSwitchDate(page);
    const totals = await rowTexts(page, 'data-labor-total-offset');
    const attend = await rowTexts(page, 'data-attendance-offset');
    check('栽培：標準労働時間合計 12/8/0/4/－/－/－（期間内で人がいない11/4は0.0）', JSON.stringify(totals) === JSON.stringify(['12.0', '8.0', '0.0', '4.0', '－', '－', '－']), totals);
    check('栽培：出勤人数 2/2/0/1/－/－/－', JSON.stringify(attend) === JSON.stringify(['2', '2', '0', '1', '－', '－', '－']), attend);
    const note = await page.evaluate(() => document.getElementById('laborPeriodNotices').textContent);
    check('栽培：期間外の注記が出る', note.indexOf('シフト_データにまだシフトが無い期間') !== -1, note);
    const detail = await page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => tr.querySelector('th').textContent.trim()));
    check('栽培：人別内訳に3人', detail.length === 3, detail);
    const err = await page.evaluate(() => document.getElementById('laborError').textContent.trim());
    check('栽培：エラーは出ない', err === '', err);

    await page.click('#businessToggle button[data-business="出荷"]');
    await page.waitForTimeout(1500);
    const st = await rowTexts(page, 'data-shiplabor-total-offset');
    check('出荷：標準労働時間合計 4/7/4/4/－/－/－', JSON.stringify(st) === JSON.stringify(['4.0', '7.0', '4.0', '4.0', '－', '－', '－']), st);
    const warn = await page.evaluate(() => document.getElementById('shipLaborWarningsList').textContent);
    check('出荷：実働hが空欄の注意が画面に出る', warn.indexOf('実働hが空欄') !== -1, warn);
    await page.close();
  }

  console.log('=== ⑦ 画面：シフト_データの見出しが見つからないとき、パネルに注意を出す ===');
  {
    const bad = toCsvText([['日付', '拠点', 'キー', '氏名', '部門', 'シフト', '実働時間', '更新日時']].concat(ROWS));
    const page = await openPage(browser, '?laborSource=shiftData&div=' + encodeURIComponent('栽培') + '&site=' + encodeURIComponent('いなべ'), bad);
    await rerenderWithoutSwitchDate(page);
    const err = await page.evaluate(() => document.getElementById('laborError').textContent.trim());
    check('栽培：「実働h」の見出しが見つからない旨のエラーが出る', err.indexOf('実働h') !== -1 && err.indexOf('見出し') !== -1, err);
    const totals = await rowTexts(page, 'data-labor-total-offset');
    check('栽培：合計は「－」のまま（0にしない）', totals.every(v => v === '－'), totals);
    await page.close();
  }

  console.log('=== ⑧ 切り替え日：いなべ・群馬は 2026-11-11、南丹は 2026-11-08。より前は旧、以降はシフト_データ ===');
  {
    const page = await openPage(browser, '', SHIFT_DATA_CSV);
    const r = await page.evaluate(() => {
      const T = window.__test;
      const sw = JSON.parse(JSON.stringify(T.LABOR_SWITCH_DATE_BY_SITE));
      const out = {
        sw,
        b1108: T.shiftDataStartOffset('いなべ', new Date(2026, 10, 8)),
        b1101: T.shiftDataStartOffset('いなべ', new Date(2026, 10, 1)),
        b1111: T.shiftDataStartOffset('いなべ', new Date(2026, 10, 11)),
        gunma1108: T.shiftDataStartOffset('群馬', new Date(2026, 10, 8)),
        nantan1105: T.shiftDataStartOffset('南丹', new Date(2026, 10, 5)),
        nantan1101: T.shiftDataStartOffset('南丹', new Date(2026, 10, 1)),
      };
      T.LABOR_SOURCE_BY_SITE['いなべ'] = 'old';
      out.oldMode = T.shiftDataStartOffset('いなべ', new Date(2026, 10, 11));
      T.LABOR_SOURCE_BY_SITE['いなべ'] = 'shiftData';
      T.LABOR_SWITCH_DATE_BY_SITE['群馬'] = null;
      out.noDate = T.shiftDataStartOffset('群馬', new Date(2026, 10, 2));
      T.LABOR_SWITCH_DATE_BY_SITE['群馬'] = sw['群馬'];
      return out;
    });
    check('切り替え日の設定：いなべ 2026-11-11、群馬 2026-11-11、南丹 2026-11-08', r.sw['いなべ'] === '2026-11-11' && r.sw['群馬'] === '2026-11-11' && r.sw['南丹'] === '2026-11-08', r.sw);
    check('切り替えが old の拠点は切り替え日に関係なく旧（-1）', r.oldMode === -1, r.oldMode);
    check('いなべ 基準日 11/8：11/11（4日目＝番号3）からシフト_データ', r.b1108 === 3, r.b1108);
    check('いなべ 基準日 11/1：7日間すべて切り替え日より前なので旧（-1）', r.b1101 === -1, r.b1101);
    check('いなべ 基準日 11/11：全部シフト_データ（0）', r.b1111 === 0, r.b1111);
    check('群馬 基準日 11/8：11/11（番号3）からシフト_データ', r.gunma1108 === 3, r.gunma1108);
    check('南丹 基準日 11/5：11/8（番号3）からシフト_データ', r.nantan1105 === 3, r.nantan1105);
    check('南丹 基準日 11/1：7日間（〜11/7）すべて旧（-1）', r.nantan1101 === -1, r.nantan1101);
    check('切り替え日が未定(null)の拠点は全部シフト_データ（0）', r.noDate === 0, r.noDate);

    const m = await page.evaluate(() => {
      const T = window.__test;
      const basis = new Date(2026, 10, 8);
      const oldRes = {
        perDayTotal: [8, 5, 0, 0, 0, 0, 0], rawPerDayTotal: [8, 5, 0, 0, 0, 0, 0], perDayAttendance: [1, 1, 0, 0, 0, 0, 0],
        warnings: ['未照合：A'], notices: [], periodNotices: ['シフト表に2026/11/11以降の日付がありません'],
        personBreakdown: [{ name: '山田　花子', dept: '栽培', dayHours: [8, 5, 0, 0, 0, 0, 0], rawDayHours: [8, 5, 0, 0, 0, 0, 0] }],
      };
      const newRes = {
        perDayTotal: [null, null, null, 8, 4, 0, null], rawPerDayTotal: [null, null, null, 8, 4, 0, null], perDayAttendance: [null, null, null, 1, 1, 0, null],
        warnings: [], notices: [], periodNotices: ['シフト_データにまだシフトが無い期間：2026/11/14'],
        personBreakdown: [{ name: '山田 花子', dept: '栽培', dayHours: [null, null, null, 8, 4, 0, null], rawDayHours: [null, null, null, 8, 4, 0, null] }],
      };
      const a = T.mergeLaborResults(oldRes, newRes, 3, basis);
      const oldDash = JSON.parse(JSON.stringify(oldRes)); oldDash.perDayTotal[1] = null;
      const b = T.mergeLaborResults(oldDash, newRes, 3, basis);
      const c = T.mergeLaborResults(null, newRes, 3, basis);
      return { a, b, c };
    });
    check('組み合わせ：11/8〜11/10 は旧、11/11〜は新の値', JSON.stringify(m.a.perDayTotal) === JSON.stringify([8, 5, 0, 8, 4, 0, null]) && JSON.stringify(m.a.perDayAttendance) === JSON.stringify([1, 1, 0, 1, 1, 0, null]), m.a);
    check('組み合わせ：同じ名前（空白違い）の人は人別内訳で1行にまとまる', m.a.personBreakdown.length === 1 && JSON.stringify(m.a.personBreakdown[0].dayHours) === JSON.stringify([8, 5, 0, 8, 4, 0, null]), m.a.personBreakdown);
    check('組み合わせ：旧の日に「－」が無ければ、旧の「日付がありません」の注記は出さない', m.a.periodNotices.length === 1 && m.a.periodNotices[0].indexOf('拠点シフト表（11/11〜）：') === 0, m.a.periodNotices);
    check('組み合わせ：旧の日に「－」があれば、旧の注記も出す（頭に「旧の勤務表（〜11/10）：」）', b_ok(m.b), m.b.periodNotices);
    function b_ok(b) { return b.periodNotices.length === 2 && b.periodNotices[0].indexOf('旧の勤務表（〜11/10）：') === 0; }
    check('組み合わせ：旧の注意にも頭に期間が付く', m.a.warnings[0] === '旧の勤務表（〜11/10）：未照合：A', m.a.warnings);
    check('組み合わせ：旧が失敗(null)なら旧の日は「－」', JSON.stringify(m.c.perDayTotal) === JSON.stringify([null, null, null, 8, 4, 0, null]), m.c.perDayTotal);
    await page.close();
  }
  {
    // 画面：今日＝11/8。旧のいなべシフト表（11/8〜11/10）とシフト_データ（11/11〜）を組み合わせて表示する
    const OLD_DATES = [];
    for (let d = new Date(2026, 9, 11); d <= new Date(2026, 10, 10); d.setDate(d.getDate() + 1)) OLD_DATES.push(new Date(d));
    const at = (iso, v) => OLD_DATES.map(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).map(x => (v[x] || ''));
    const OLD_CSV = buildOldInabeShiftCsv(OLD_DATES, [
      { name: '旧 栽培', dept: '栽培', cells: at(null, { '2026-11-08': '8:00-17:00', '2026-11-09': '9:00-14:00' }) }, // 旧の休憩ルール：8h・5h
      { name: '旧 出荷', dept: '出荷', cells: at(null, { '2026-11-08': '8:00-17:00', '2026-11-09': '8:00-17:00', '2026-11-10': '8:00-17:00' }) },
    ]);
    const NEW_CSV = toCsvText([HEADER].concat([
      rec('2026-11-09', 'いなべ', '新 栽培', '栽培', '8:00-17:00', '8'), // 切り替え日より前は読まない
      rec('2026-11-11', 'いなべ', '新 栽培', '栽培', '8:00-17:00', '8'),
      rec('2026-11-12', 'いなべ', '新 栽培', '栽培', '9:00-14:00', '4'),
      rec('2026-11-13', 'いなべ', '新 栽培', '栽培', '休', '0'),
      rec('2026-11-14', 'いなべ', '新 出荷', '出荷', '8:00-16:00', '7'),
    ]));
    const extra = [{ id: '12xrXyXUSbiQVUWsAC7mbrExyWrIw863Oleq_1v81vRw', gid: '872290181', body: OLD_CSV }];
    const page = await openPage(browser, '?laborSource=shiftData&div=' + encodeURIComponent('栽培') + '&site=' + encodeURIComponent('いなべ'), NEW_CSV, null, extra, [2026, 10, 8]);
    const totals = await rowTexts(page, 'data-labor-total-offset');
    check('画面 栽培：11/8〜11/10 は旧（8・5・0）、11/11〜11/14 はシフト_データ（8・4・0・0）', JSON.stringify(totals) === JSON.stringify(['8.0', '5.0', '0.0', '8.0', '4.0', '0.0', '0.0']), totals);
    const attend = await rowTexts(page, 'data-attendance-offset');
    check('画面 栽培：出勤人数 1/1/0/1/1/0/0', JSON.stringify(attend) === JSON.stringify(['1', '1', '0', '1', '1', '0', '0']), attend);
    const detail = await page.evaluate(() => Array.from(document.querySelectorAll('#table3laborDetailBody tr')).map(tr => tr.querySelector('th').textContent.trim()));
    check('画面 栽培：人別内訳に旧の人と新の人', detail.length === 2 && detail.includes('旧 栽培') && detail.includes('新 栽培'), detail);
    await page.click('#businessToggle button[data-business="出荷"]');
    await page.waitForTimeout(1500);
    const st = await rowTexts(page, 'data-shiplabor-total-offset');
    check('画面 出荷：11/8〜11/10 は旧（8・8・8）、11/11〜はシフト_データ（0・0・0・7）', JSON.stringify(st) === JSON.stringify(['8.0', '8.0', '8.0', '0.0', '0.0', '0.0', '7.0']), st);
    const pn = await page.evaluate(() => document.getElementById('shipLaborPeriodNotices').textContent);
    check('画面 出荷：旧のシフト表の「11/11以降の日付がありません」の注記は出ない', pn.indexOf('日付がありません') === -1, pn);
    const err = await page.evaluate(() => [document.getElementById('laborError').textContent.trim(), document.getElementById('shipLaborError').textContent.trim()]);
    check('画面：エラーは出ない', err.every(e => e === ''), err);
    await page.close();
  }
  {
    // 画面：今日＝11/2。7日間すべて切り替え日より前なので、laborSource=shiftData でもシフト_データを読まない
    const log = [];
    const page = await openPage(browser, '?laborSource=shiftData&div=' + encodeURIComponent('栽培') + '&site=' + encodeURIComponent('いなべ'), SHIFT_DATA_CSV, log);
    check('基準日 11/2 のいなべは切り替え日より前なのでシフト_データを読まない', !log.some(u => u.includes(`gid=${SHIFT_DATA_GID}`)), log);
    await page.close();
  }

  await browser.close();
  console.log('\n=== 総合判定 ===');
  console.log(allOk ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
