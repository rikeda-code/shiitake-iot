// 拠点シフト表（site-shift.html）の「個人別（1人1枚）」印刷の検証。
// 確かめること：
//  - 「印刷の形」の切り替えで、一覧用の設定（部門・表示）と個人別の設定（印刷する人）が入れ替わる
//  - 個人別：選んだ人数だけページができ、1人1ページ・月曜始まりのカレンダーで、期間外の日は空欄
//  - 時間・休み・配送の印・実働、下の集計（出勤日数・勤務時間・休みの内訳・配送日数）が正しい
//  - 全員／全部外す／表で選んだ人／シフトがある人、部門名でまとめて、Shift+クリックの範囲選択
//  - 期間の変更（11日〜25日）で週の数が変わる。拠点を変えると選び直しになる
//  - 印刷（print メディア）で1人ずつ改ページされ、ページが A4横の印刷範囲に収まる
//  - 一覧（部門ごと）の印刷は今まで通り1枚
// 実行：dashboard をポート8811で配信してから node tests/site-shift/verify_print_person.js
//   スクリーンショットを残すときは SHOT_DIR=フォルダ を付ける
const { chromium } = require('playwright');
const { openShiftPage } = require('./helpers');

const URL = 'http://localhost:8811/site-shift.html';
const SITE = 'いなべ';
const SHOT_DIR = process.env.SHOT_DIR;

const MEMBERS = [
  { key: 'k1', name: '栽培 一郎', dept: '栽培', empType: 'アルバイト', flag: 1, row: 1, join: '2024-04-01' },
  { key: 'k2', name: '栽培 二郎', dept: '栽培', empType: '社員', flag: 1, row: 2, join: '2020-04-01' },
  { key: 'k3', name: '出荷 三子', dept: '出荷', empType: 'アルバイト', flag: 1, row: 3, join: '2023-01-10' },
  { key: 'k4', name: '出荷 四子', dept: '出荷', empType: '技能実習生', flag: 1, row: 4, join: '2025-06-01' },
  { key: 'k5', name: '配送 五郎', dept: '配送', empType: '社員', flag: 1, row: 5, join: '2019-09-01' },
];
const iso = (m, d) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function months() {
  const oct = {}, nov = {};
  const put = (key, m, d, v) => { ((m === 10 ? oct : nov)[key] ||= {})[iso(m, d)] = v; };
  // 栽培 一郎：平日 8-17、土日 休、10/20 有休、10/22 配送、10/27 半日配送、11/2〜 8:30-15:00
  for (let d = 11; d <= 31; d++) { const wd = new Date(2026, 9, d).getDay(); put('k1', 10, d, wd === 0 || wd === 6 ? '休' : '8:00-17:00'); }
  put('k1', 10, 20, '有休'); put('k1', 10, 22, '8:00-17:00配送'); put('k1', 10, 27, '8:00-17:00半日配送');
  for (let d = 2; d <= 6; d++) put('k1', 11, d, '8:30-15:00');
  // 出荷 三子：週3日 13-17、10/28 欠勤
  [12, 14, 16, 19, 21, 23, 26, 30].forEach(d => put('k3', 10, d, '13:00-17:00'));
  put('k3', 10, 28, '欠勤');
  // 出荷 四子：2日だけ
  put('k4', 10, 13, '8:00-12:00'); put('k4', 10, 14, '8:00-12:00');
  return { oct, nov };
}

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const { oct, nov } = months();
  const seed = {
    [`shiftSites/${SITE}/meta/members`]: { list: MEMBERS, updatedAt: 4102444800000 },
    [`shiftSites/${SITE}/months/2026-10`]: { cells: oct },
    [`shiftSites/${SITE}/months/2026-11`]: { cells: nov },
    [`shiftSites/${SITE}/meta/fixed`]: {},
    [`shiftSites/群馬/meta/members`]: { list: [{ key: 'g1', name: '群馬 太郎', dept: '栽培', empType: '社員', flag: 1, row: 1 }], updatedAt: 4102444800000 },
    [`shiftSites/群馬/months/2026-10`]: { cells: {} },
    [`shiftSites/群馬/months/2026-11`]: { cells: {} },
  };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await openShiftPage(ctx, { seed, members: MEMBERS });
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
  await page.goto(URL);
  await page.waitForSelector('#grid tbody td.name[data-r]');
  const wait = ms => page.waitForTimeout(ms);
  const shown = sel => page.$eval(sel, el => !!(el.offsetWidth || el.offsetHeight));
  const pageCount = () => page.$$eval('#previewScale .print-page', p => p.length);
  const who = () => page.$$eval('#previewScale .pc-head .who', w => w.map(x => x.textContent));

  // シフト入力の表で 出荷 三子〜出荷 四子 を範囲選択してから印刷タブへ
  await page.click('#grid td.name[data-r="2"]');
  await page.click('#grid td.name[data-r="3"]', { modifiers: ['Shift'] });
  await page.click('#tabPrint');
  await wait(300);
  check('最初は一覧（部門ごと）で1枚', await pageCount() === 1 && !!(await page.$('#printPage .pp-table')), await pageCount());
  check('一覧のときは部門の設定が出て、印刷する人の欄は出ない', await shown('#ppDepts') && !(await shown('.pp-people-box')), '');
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/print-list.png` });

  // 個人別に切り替え：表で選んだ2人が最初から選ばれる
  await page.click('.mode-btns [data-mode="person"]');
  await wait(300);
  check('個人別に切り替えると印刷する人の欄が出て、部門・表示の設定は隠れる', await shown('.pp-people-box') && !(await shown('#ppDepts')) && !(await shown('#ppCount')), '');
  check('表で範囲選択していた人が選ばれている', eq(await who(), ['出荷 三子', '出荷 四子']), await who());
  check('選んだ人数と枚数の表示', (await page.textContent('#ppPeopleCount')).includes('2人を選択 → 2枚'), await page.textContent('#ppPeopleCount'));

  // 全員
  await page.click('.pp-people-box [data-pick="all"]');
  await wait(300);
  check('「全員」で5人5枚', await pageCount() === 5 && eq(await who(), MEMBERS.map(m => m.name)), await who());

  // 1ページ目（栽培 一郎）を詳しく
  const p1 = await page.$eval('#previewScale .print-page', pg => {
    const cells = [...pg.querySelectorAll('.pc-cal tbody td')];
    return {
      heads: [...pg.querySelectorAll('.pc-cal thead th')].map(th => th.textContent),
      weeks: pg.querySelectorAll('.pc-cal tbody tr').length,
      first: cells[0].querySelector('.dd').textContent,
      outCount: cells.filter(td => td.classList.contains('out')).length,
      outHasBody: cells.filter(td => td.classList.contains('out')).some(td => td.querySelector('.tm')),
      d11: cells.find(td => !td.classList.contains('out')).innerText,
      ttl: pg.querySelector('.pc-head .ttl').textContent,
      dp: pg.querySelector('.pc-head .dp').textContent,
      sum: pg.querySelector('.pc-sum').innerText.replace(/\s+/g, ' '),
      byDay: Object.fromEntries(cells.filter(td => !td.classList.contains('out')).map(td => [td.querySelector('.dd').textContent, { tm: td.querySelector('.tm')?.textContent || '', hr: td.querySelector('.hr')?.textContent || '', tag: td.querySelector('.tag')?.textContent || '', cls: td.className }])),
    };
  });
  check('曜日は月曜始まり', eq(p1.heads, ['月', '火', '水', '木', '金', '土', '日']), p1.heads);
  // 10/11（日）〜11/10（火）：10/5（月）の週〜11/15（日）の週 = 6週
  check('期間を含む週がすべて並ぶ（6週）', p1.weeks === 6, p1.weeks);
  check('期間外の日は灰色で中身なし（前6日＋後5日）', p1.outCount === 11 && !p1.outHasBody, p1.outCount);
  check('期間の最初の日は「月/日」', p1.d11.startsWith('10/11'), p1.d11);
  check('見出しに氏名・部門・拠点と期間', p1.dp === '栽培' && p1.ttl.includes('いなべ') && p1.ttl.includes('2026年10月11日〜11月10日'), p1.ttl);
  const overflow = await page.$$eval('#previewScale .pc-cal td .tm', tms => tms.filter(tm => tm.scrollWidth > tm.parentElement.clientWidth + 1).map(tm => tm.textContent));
  check('時刻・休みの文字がマスの幅からはみ出さない', !overflow.length, overflow.slice(0, 3));
  check('平日は時間と実働', p1.byDay['12'].tm === '8:00〜17:00' && p1.byDay['12'].hr === '実働8h', p1.byDay['12']);
  check('土日の休み', p1.byDay['17'].tm === '休' && p1.byDay['17'].cls.includes('off'), p1.byDay['17']);
  check('有休', p1.byDay['20'].tm === '有休', p1.byDay['20']);
  check('配送の印', p1.byDay['22'].tag === '配送' && p1.byDay['22'].cls.includes('dv'), p1.byDay['22']);
  check('半日配送の印', p1.byDay['27'].tag === '半日配送' && p1.byDay['27'].cls.includes('dvh'), p1.byDay['27']);
  check('11月1日は「11/1」、11月の時間も出る', '11/1' in p1.byDay && p1.byDay['2'].tm === '8:30〜15:00' && p1.byDay['2'].hr === '実働5.5h', Object.keys(p1.byDay).slice(-12));
  // 10月平日15日（うち有休1）→ 出勤14日×8h、11/2〜6 5日×5.5h → 出勤19日 139.5h、休み：休6日（10月の土日）・有休1日、配送2日
  check('集計（出勤日数・勤務時間・休みの内訳・配送）', p1.sum.includes('出勤 19日') && p1.sum.includes('勤務時間 139.5h') && p1.sum.includes('休み 休 6日・有休 1日') && p1.sum.includes('配送 2日'), p1.sum);
  const p3 = await page.$eval('#previewScale .print-page:nth-child(3)', pg => ({ who: pg.querySelector('.who').textContent, sum: pg.querySelector('.pc-sum').innerText.replace(/\s+/g, ' '), absent: !!pg.querySelector('td.absent') }));
  check('欠勤は赤字・休みの内訳に入る', p3.who === '出荷 三子' && p3.absent && p3.sum.includes('出勤 8日') && p3.sum.includes('勤務時間 32h') && p3.sum.includes('欠勤 1日'), p3);
  const p5 = await page.$eval('#previewScale .print-page:nth-child(5)', pg => pg.querySelector('.pc-sum').innerText.replace(/\s+/g, ' '));
  check('シフトのない人は 出勤0日・0h', p5.includes('出勤 0日') && p5.includes('勤務時間 0h'), p5);
  if (SHOT_DIR) {
    await page.screenshot({ path: `${SHOT_DIR}/print-person-controls.png` });
    await (await page.$('#previewScale .print-page')).screenshot({ path: `${SHOT_DIR}/print-person-page1.png` });
  }

  // 選び方
  await page.click('.pp-people-box [data-pick="none"]');
  await wait(200);
  check('「全部外す」で0人・案内が出る', (await page.textContent('#previewScale')).includes('印刷する人を選んでください'), await page.textContent('#previewScale'));
  await page.click('.pp-people-box [data-pick="worked"]');
  await wait(200);
  check('「この期間にシフトがある人」', eq(await who(), ['栽培 一郎', '出荷 三子', '出荷 四子']), await who());
  await page.click('.pp-people button[data-div="出荷"]');
  await wait(200);
  check('部門名を押す（全員選ばれている部門）→ 外れる', eq(await who(), ['栽培 一郎']), await who());
  await page.click('.pp-people button[data-div="出荷"]');
  await wait(200);
  check('もう一度押すと部門の全員が入る', eq(await who(), ['栽培 一郎', '出荷 三子', '出荷 四子']), await who());
  await page.click('.pp-people-box [data-pick="none"]');
  await page.click('.pp-people input[data-key="k2"]');
  await page.click('.pp-people input[data-key="k5"]', { modifiers: ['Shift'] });
  await wait(200);
  check('Shift+クリックでその間の人をまとめて選ぶ', eq(await who(), ['栽培 二郎', '出荷 三子', '出荷 四子', '配送 五郎']), await who());
  await page.click('.pp-people input[data-key="k3"]');
  await page.click('.pp-people input[data-key="k4"]', { modifiers: ['Shift'] });
  await wait(200);
  check('Shift+クリックで外すこともできる', eq(await who(), ['栽培 二郎', '配送 五郎']), await who());

  // 期間を 11日〜25日 に：10/5の週〜10/19の週 = 3週
  await page.click('.print-controls [data-range="h1"]');
  await wait(300);
  const w2 = await page.$eval('#previewScale .print-page .pc-cal tbody', tb => tb.querySelectorAll('tr').length);
  check('期間を11日〜25日にすると3週', w2 === 3, w2);
  check('期間を変えても選んだ人はそのまま', eq(await who(), ['栽培 二郎', '配送 五郎']), await who());

  // 印刷：1人ずつ改ページ・A4横の印刷範囲（277×190mm）に収まる
  await page.click('.print-controls [data-range="all"]');
  await page.click('.pp-people-box [data-pick="all"]');
  await wait(300);
  await page.emulateMedia({ media: 'print' });
  const pr = await page.$$eval('#previewScale .print-page', ps => ps.map(p => ({ w: p.getBoundingClientRect().width, h: p.getBoundingClientRect().height, sh: p.scrollHeight, ch: p.clientHeight, br: getComputedStyle(p).breakBefore })));
  const mm = 96 / 25.4;
  check('印刷では1人ずつ改ページ', pr.slice(1).every(p => p.br === 'page') && pr[0].br !== 'page', pr.map(p => p.br));
  check('ページが印刷範囲（277×190mm）に収まり、中身がはみ出さない', pr.every(p => p.w <= 277 * mm + 1 && p.h <= 190 * mm + 1 && p.sh <= p.ch + 1), pr);
  const pdf = await page.pdf({ format: 'A4', landscape: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
  const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check('PDFにすると5人で5ページ', pdfPages === 5, pdfPages);
  await page.emulateMedia({ media: 'screen' });

  // 一覧に戻すと今まで通り1枚
  await page.click('.mode-btns [data-mode="list"]');
  await wait(300);
  check('一覧に戻すと1枚の表', await pageCount() === 1 && !!(await page.$('#printPage .pp-table')), await pageCount());
  await page.emulateMedia({ media: 'print' });
  const pdf2 = await page.pdf({ format: 'A4', landscape: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
  check('一覧のPDFは1ページ', (pdf2.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length === 1, '');
  await page.emulateMedia({ media: 'screen' });

  // 拠点を変えると、個人別の選択はその拠点の全員から
  await page.click('.mode-btns [data-mode="person"]');
  await page.selectOption('#site', '群馬');
  await page.waitForFunction(() => document.querySelector('#grid tbody td.name')?.textContent.includes('群馬'));
  await page.click('#tabPrint');
  await wait(300);
  check('拠点を変えると、その拠点の全員が選ばれる', eq(await who(), ['群馬 太郎']), await who());

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} 件OK`);
  process.exit(ng ? 1 : 0);
})();
