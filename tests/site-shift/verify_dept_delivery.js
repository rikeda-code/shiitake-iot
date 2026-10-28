// 拠点シフト表（site-shift.html）の「栽培・配送／出荷・配送」と、固定シフトの応援・配送の印の検証。
// Firebase（認証・Firestore）とGASはページ内の偽物に差し替え、ネットワークには出ない。
// 確かめること：
//  - 栽培・配送／出荷・配送は栽培／出荷の色・集計になり、配送・栽培はこれまで通り配送
//  - 栽培・配送の人の時間は栽培に数え、配送の日は全部、半日配送の日は半分を配送に回す
//  - 新人登録・部門変更の選択肢に栽培・配送／出荷・配送が出る
//  - 固定シフトで曜日ごとに応援・配送の印を選んで保存でき（自分の部門への応援は出ない）、反映すると月の表に印付きで入る
// 実行：python3 -m http.server 8811 --directory dashboard を起動してから node tests/site-shift/verify_dept_delivery.js
const { chromium } = require('playwright');
const { openShiftPage } = require('./helpers');

const URL = 'http://localhost:8811/site-shift.html';
const SITE = 'いなべ';

const MEMBERS = [
  { key: 'a1', name: '栽培 配子', dept: '栽培・配送', empType: 'アルバイト', flag: 1, row: 1, join: '2024-04-01' },
  { key: 'a2', name: '出荷 配男', dept: '出荷・配送', empType: 'アルバイト', flag: 1, row: 2, join: '2024-04-01' },
  { key: 'a3', name: '配送 栽太', dept: '配送・栽培', empType: '社員', flag: 1, row: 3, join: '2020-04-01' },
];
// 期間 10/11〜11/10。a1：10/12 通常・10/13 半日配送・10/14 配送（各8h）、a2：10/12 通常、a3：10/12 通常
function cells() {
  return {
    a1: { '2026-10-12': '8:00-17:00', '2026-10-13': '8:00-17:00半日配送', '2026-10-14': '8:00-17:00配送' },
    a2: { '2026-10-12': '8:00-17:00' },
    a3: { '2026-10-12': '8:00-17:00' },
  };
}

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const seed = {
    [`shiftSites/${SITE}/meta/members`]: { list: MEMBERS, updatedAt: 4102444800000 },
    [`shiftSites/${SITE}/months/2026-10`]: { cells: cells() },
    [`shiftSites/${SITE}/months/2026-11`]: { cells: {} },
    [`shiftSites/${SITE}/meta/fixed`]: {},
  };
  const page = await openShiftPage(ctx, { seed, members: MEMBERS });
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
  await page.goto(URL);
  await page.waitForSelector('#grid tbody td.name[data-r]');

  // 部門の色（chip のクラス）
  const chips = await page.$$eval('#grid tbody td.role .chip', els => els.map(e => [e.textContent, e.className]));
  check('栽培・配送は栽培の色', chips.some(([t, c]) => t === '栽培・配送' && c.includes('栽培')), JSON.stringify(chips));
  check('出荷・配送は出荷の色', chips.some(([t, c]) => t === '出荷・配送' && c.includes('出荷')), JSON.stringify(chips));
  check('配送・栽培はこれまで通り配送の色', chips.some(([t, c]) => t === '配送・栽培' && c.includes('配送')), JSON.stringify(chips));

  // 部門別の時間（期間計）。a1：栽培 8+4=12、配送 4+8=12。a2：出荷 8。a3：配送 8
  const totals = () => page.$$eval('#grid tfoot tr', trs => Object.fromEntries(trs.map(tr => [tr.querySelector('th').textContent.trim(), tr.querySelector('td.tot')?.textContent])));
  const t = await totals();
  check('栽培 時間＝12h（通常8h＋半日配送の残り4h）', t['栽培 時間'] === '12h', JSON.stringify(t));
  check('出荷 時間＝8h', t['出荷 時間'] === '8h', JSON.stringify(t));
  check('配送 時間＝20h（半日配送4h＋配送8h＋配送・栽培の人8h）', t['配送 時間'] === '20h', JSON.stringify(t));
  check('合計 時間＝40h', t['合計 時間'] === '40h', JSON.stringify(t));

  // 入力パネルの応援ボタン：栽培・配送の人には配送・出荷への応援が出て、栽培への応援は出ない
  const btns = await page.$$eval('#leaveBtns button[data-tag]', bs => bs.map(b => b.dataset.tag));
  check('ツールバーの応援・配送ボタンは6種類', btns.length === 6, JSON.stringify(btns));

  // 新人登録・部門変更の選択肢
  const roles = await page.$$eval('#newRole option', os => os.map(o => o.textContent));
  check('新人登録の部門に栽培・配送／出荷・配送がある', roles.includes('栽培・配送') && roles.includes('出荷・配送'), JSON.stringify(roles));
  await page.click('#memTable tr[data-key="a1"] button[data-act="org"]'); // 旧:部門変更(data-act="dept")は組織内の変更に置き換わった
  const opts = await page.$$eval('#orgDept option', os => os.map(o => o.textContent));
  check('組織内の変更の部門の選択肢に出荷・配送がある', opts.includes('出荷・配送'), JSON.stringify(opts));
  await page.click('#memTable button[data-act="cancel"]');

  // 固定シフト：a1（栽培・配送）の月曜に半日配送、水曜に出荷4h
  await page.selectOption('#fxPerson', 'a1');
  const tagOpts = await page.$$eval('#fx-t-0 option', os => os.map(o => o.value));
  check('固定シフトの印の選択肢に栽培への応援は出ない', !tagOpts.includes('栽培8h') && !tagOpts.includes('栽培4h') && tagOpts.includes('半日配送') && tagOpts.includes('出荷4h'), JSON.stringify(tagOpts));
  await page.selectOption('#fx-t-0', '半日配送');
  await page.selectOption('#fx-t-2', '出荷4h');
  const work0 = await page.textContent('#fxTable tr[data-i="0"] td.work');
  check('印を付けても実働は8h', work0.trim() === '8h', work0);
  const brk = await page.textContent('#fxTable tr[data-i="0"] td:nth-child(6)');
  check('印を付けても休憩は60分', brk.trim() === '60分', brk);
  // 時刻を変えても印は残る
  await page.selectOption('#fx-e-0-h', '16');
  check('時刻を変えても印が残る', await page.inputValue('#fx-t-0') === '半日配送', await page.inputValue('#fx-t-0'));
  await page.selectOption('#fx-e-0-h', '17');
  await page.click('#fxSave');
  await page.waitForTimeout(200);
  const fx = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/fixed`].a1, SITE);
  check('固定シフトが印付きで保存される', eq(fx, ['8:00-17:00半日配送', '8:00-17:00', '8:00-17:00出荷4h', '8:00-17:00', '8:00-17:00', '休', '休']), JSON.stringify(fx));
  // 印を「なし」に戻せる
  await page.selectOption('#fxPerson', 'a1');
  check('保存した印が編集画面に出る', await page.inputValue('#fx-t-2') === '出荷4h', await page.inputValue('#fx-t-2'));

  // 反映：空いている日だけ。10/19（月）は半日配送、10/21（水）は出荷4h、10/13（火）の既存の値はそのまま
  await page.click('#applyFixed');
  await page.click('#dlgOk');
  await page.waitForTimeout(200);
  const cellsNow = await page.$$eval('#grid tbody tr:first-child td.cell', tds => tds.map(td => ({ tl: td.dataset.tl || '', title: td.title })));
  const cols = await page.$$eval('#grid thead th', ths => ths.slice(2, -1).map(th => th.querySelector('.d').textContent));
  const at = d => cellsNow[cols.indexOf(String(d))];
  check('反映で10/19（月）に半日配送の印', at(19)?.tl === '半配', JSON.stringify(at(19)));
  check('反映で10/21（水）に出荷4hの印', at(21)?.tl === '出4', JSON.stringify(at(21)));
  check('反映で10/20（火）は印なし', at(20)?.tl === '', JSON.stringify(at(20)));

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
