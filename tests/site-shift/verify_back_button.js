// 拠点シフト表（site-shift.html）の「◀ 戻る」の検証。
// Firebase（認証・Firestore）とGASはページ内の偽物に差し替え、ネットワークには出ない。
// 確かめること：
//  - 最初は押せない。タブ・期間を変えると押せるようになり、1つ前の画面（タブ・期間）に戻る
//  - 履歴は拠点ごとに別：拠点を切り替えた操作は記録せず、戻るでほかの拠点へ移らない
//  - ほかの拠点で操作しても、元の拠点の履歴は動かない（戻ると元の拠点の画面に戻る）
// 実行：python3 -m http.server 8811 --directory dashboard を起動してから node tests/site-shift/verify_back_button.js
const { chromium } = require('playwright');
const { openShiftPage } = require('./helpers');

const URL = 'http://localhost:8811/site-shift.html';

const MEMBERS = [
  { key: 'a1', name: '栽培 太郎', dept: '栽培', empType: '社員', flag: 1, row: 1, join: '2020-04-01' },
];

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const seed = {};
  for (const site of ['いなべ', '群馬', '南丹']) {
    seed[`shiftSites/${site}/meta/members`] = { list: MEMBERS, updatedAt: 4102444800000 };
    seed[`shiftSites/${site}/meta/fixed`] = {};
  }
  const page = await openShiftPage(ctx, { seed, members: MEMBERS });
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
  await page.goto(URL);
  await page.waitForSelector('#grid tbody td.name[data-r]');

  const state = () => page.evaluate(() => ({
    site: document.getElementById('site').value,
    month: document.getElementById('month').value,
    view: document.body.dataset.view || 'edit',
    back: !document.getElementById('backBtn').disabled,
  }));
  const months = await page.$$eval('#month option', os => os.map(o => o.value));
  const pickMonth = v => page.selectOption('#month', v);
  const pickSite = v => page.selectOption('#site', v);
  const back = () => page.click('#backBtn');

  const s0 = await state();
  const m0 = s0.month, i0 = months.indexOf(m0), m1 = months[i0 + 1], m2 = months[i0 - 1];
  check('最初は戻るを押せない', !s0.back, JSON.stringify(s0));

  // いなべ：シフト入力(m0) → 印刷(m0) → 印刷(m1)
  await page.click('#tabPrint');
  await pickMonth(m1);
  let s = await state();
  check('いなべで操作すると戻るを押せる', s.back && s.view === 'print' && s.month === m1, JSON.stringify(s));

  // 群馬へ：拠点の切り替えは記録しない。群馬はまだ履歴がない
  await pickSite('群馬');
  s = await state();
  check('群馬に切り替えると戻るは押せない（いなべの履歴を使わない）', s.site === '群馬' && !s.back, JSON.stringify(s));

  // 群馬：印刷(m1) → シフト入力(m1) → シフト入力(m2)
  await page.click('#tabEdit');
  await pickMonth(m2);
  await back();
  s = await state();
  check('群馬で戻る → 群馬のシフト入力・m1', s.site === '群馬' && s.view === 'edit' && s.month === m1, JSON.stringify(s));
  await back();
  s = await state();
  check('群馬でもう一度戻る → 群馬の印刷・m1（いなべへは移らない）', s.site === '群馬' && s.view === 'print' && s.month === m1, JSON.stringify(s));
  check('群馬の履歴が尽きたら押せない', !s.back, JSON.stringify(s));

  // いなべへ戻る：いなべの履歴は群馬の操作で動いていない
  await pickSite('いなべ');
  s = await state();
  check('いなべに戻ると戻るを押せる', s.site === 'いなべ' && s.back, JSON.stringify(s));
  await back();
  s = await state();
  check('いなべで戻る → 印刷・m0', s.site === 'いなべ' && s.view === 'print' && s.month === m0, JSON.stringify(s));
  await back();
  s = await state();
  check('いなべでもう一度戻る → シフト入力・m0', s.site === 'いなべ' && s.view === 'edit' && s.month === m0, JSON.stringify(s));
  check('いなべの履歴が尽きたら押せない', !s.back, JSON.stringify(s));

  // 戻る操作そのものは履歴に積まない
  await page.click('#tabPrint');
  await back();
  s = await state();
  check('戻った後は進んだ分を積み直さない', s.view === 'edit' && !s.back, JSON.stringify(s));

  // 南丹は一度も触っていないので押せない
  await pickSite('南丹');
  s = await state();
  check('南丹は履歴なし', s.site === '南丹' && !s.back, JSON.stringify(s));

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
