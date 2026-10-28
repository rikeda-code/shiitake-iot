// 拠点シフト表（site-shift.html）のメンバー欄（#memTable）を4列にまとめ、横スクロール
// なしで収まるようにした変更の検証。Firebase（認証・Firestore）とGASはページ内の偽物
// （helpers.js）に差し替え、ネットワークには出ない。
// 確かめること（画面の幅 1400px・1024px・390px のそれぞれで）：
//  - 通常の状態で、#memTableの横幅（scrollWidth）が囲み（.scroll-x）の幅（clientWidth）を
//    超えない。退職・異動の入力中、部門変更の入力中も超えない
//  - 4列で、見出しが「氏名」「部門・雇用区分」「状態・日付」「操作」の順になっている
//  - F列2の人は3列目(状態・日付)に入社日の入力欄、F列3の人は3列目に退職日、F列1の人は
//    日付なし
//  - 退職・異動を押すと、その人の行の下に入力の行（tr.mem-edit、同じdata-key）が出て、
//    確定で今までと同じ内容（action:'retire', key, date, flag）がGASに送られる
// 実行：python3 -m http.server 8811 --directory dashboard を起動してから
//       node tests/site-shift/verify_member_table_fit.js
const { chromium } = require('playwright');
const { openShiftPage } = require('./helpers');

const URL = 'http://localhost:8811/site-shift.html';
const SITE = 'いなべ';

// 長い名前（MUHAMAD AYUB FAYYUQI）・技能実習生・F列1/2/3を含む
const MEMBERS = [
  { key: 'k1', name: '在籍 一郎', dept: '栽培', empType: '社員', flag: 1, row: 1, join: '', leave: '' },
  { key: 'k2', name: 'MUHAMAD AYUB FAYYUQI', dept: '出荷・配送', empType: '技能実習生', flag: 2, row: 2, join: '2026-11-01', leave: '' },
  { key: 'k3', name: '退職 予定子', dept: '栽培', empType: 'パート', flag: 3, row: 3, join: '', leave: '2026-12-01' },
];

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const widths = page => page.$eval('#memTable', el => {
  const wrap = el.parentElement;
  return { tableScrollWidth: el.scrollWidth, wrapClientWidth: wrap.clientWidth };
});
const fits = w => w.tableScrollWidth <= w.wrapClientWidth;
// 入力中の行（tr.mem-edit）のtdの横幅と#memTable自体の横幅（colspan="4"で4列分に
// 広がっているか＝1列目の幅に押し込まれていないかの確認）
const memEditWidths = page => page.$eval('#memTable', el => {
  const td = el.querySelector('tr.mem-edit td');
  return { tdWidth: td ? td.getBoundingClientRect().width : null, tableWidth: el.getBoundingClientRect().width };
});

(async () => {
  const browser = await chromium.launch();
  const seed = {
    [`shiftSites/${SITE}/meta/members`]: { list: MEMBERS, updatedAt: 4102444800000 },
    [`shiftSites/${SITE}/months/2026-10`]: { cells: {} },
    [`shiftSites/${SITE}/months/2026-11`]: { cells: {} },
    [`shiftSites/${SITE}/meta/fixed`]: {},
    [`shiftSites/${SITE}/meta/dates`]: {},
  };

  for (const width of [1400, 1024, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await openShiftPage(ctx, { seed, members: MEMBERS });
    page.on('pageerror', e => check(`[${width}px] ページでエラーが出ない`, false, e.message));
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-key]');

    const w0 = await widths(page);
    check(`[${width}px] 通常の状態で#memTableが囲みの幅を超えない`, fits(w0), JSON.stringify(w0));

    // 退職・異動の入力中
    await page.click('#memTable tr[data-key="k1"] button[data-act="leave"]');
    await page.waitForSelector('#memTable tr.mem-edit[data-key="k1"]');
    const w1 = await widths(page);
    check(`[${width}px] 退職・異動の入力中も#memTableが囲みの幅を超えない`, fits(w1), JSON.stringify(w1));
    const me1 = await memEditWidths(page);
    check(`[${width}px] 退職・異動の入力中、tr.mem-editのtdの横幅が#memTableの横幅とほぼ同じ(差4px以内＝4列分に広がっている)`, Math.abs(me1.tdWidth - me1.tableWidth) <= 4, JSON.stringify(me1));
    if (width === 1400) {
      const tops = await page.$$eval('#leaveDate, #leaveFlag, button[data-act="ok"], button[data-act="cancel"]', els => els.map(e => e.getBoundingClientRect().top));
      check('[1400px] 退職日・区分・確定・やめるが1行に並んでいる(上端の差10px以内)', Math.max(...tops) - Math.min(...tops) <= 10, JSON.stringify(tops));
    }
    await page.click('#memTable button[data-act="cancel"]');

    // 部門変更の入力中
    await page.click('#memTable tr[data-key="k1"] button[data-act="dept"]');
    await page.waitForSelector('#memTable tr.mem-edit[data-key="k1"]');
    const w2 = await widths(page);
    check(`[${width}px] 部門変更の入力中も#memTableが囲みの幅を超えない`, fits(w2), JSON.stringify(w2));
    const me2 = await memEditWidths(page);
    check(`[${width}px] 部門変更の入力中、tr.mem-editのtdの横幅が#memTableの横幅とほぼ同じ(差4px以内＝4列分に広がっている)`, Math.abs(me2.tdWidth - me2.tableWidth) <= 4, JSON.stringify(me2));
    await page.click('#memTable button[data-act="cancel"]');

    if (width === 1400) {
      // 見出し・列構成・日付表示の確認は1回だけでよい
      const heads = await page.$$eval('#memTable tr:first-child th', ths => ths.map(t => t.textContent));
      check('4列で、見出しが氏名・部門雇用区分・状態日付・操作の順', eq(heads, ['氏名', '部門・雇用区分', '状態・日付', '操作']), JSON.stringify(heads));

      const cellCount = await page.$eval('#memTable tr[data-key="k1"]', tr => tr.children.length);
      check('1人の行は4セル', cellCount === 4, cellCount);

      const joinInput = await page.$('#memTable tr[data-key="k2"] td.m-status input.join-input');
      check('F列2の人は3列目(状態・日付)に入社日の入力欄がある', !!joinInput, joinInput);
      const joinVal = await page.inputValue('#memTable tr[data-key="k2"] td.m-status input.join-input');
      check('F列2の人の入社日の入力欄の初期値はresolveDate(m,\'join\')どおり(2026-11-01)', joinVal === '2026-11-01', joinVal);

      const leaveSpan = await page.textContent('#memTable tr[data-key="k3"] td.m-status .m-date');
      check('F列3の人は3列目(状態・日付)に退職日(dispDate(m,\'leave\'))がある(2026/12)', leaveSpan.trim() === '2026/12', leaveSpan);

      const k1DateEls = await page.$$('#memTable tr[data-key="k1"] td.m-status input.join-input, #memTable tr[data-key="k1"] td.m-status .m-date');
      check('F列1の人は3列目(状態・日付)に日付が無い', k1DateEls.length === 0, k1DateEls.length);

      const longName = await page.textContent('#memTable tr[data-key="k2"] td.m-name');
      check('長い名前がそのまま表示される(MUHAMAD AYUB FAYYUQI)', longName.trim() === 'MUHAMAD AYUB FAYYUQI', longName);
      const empText = await page.textContent('#memTable tr[data-key="k2"] td.m-dept .m-emp');
      check('部門・雇用区分の列に雇用区分(技能実習生)が出る', empText.trim() === '技能実習生', empText);
    }

    await page.close();
    await ctx.close();
  }

  // 退職・異動の確定で、今までと同じ内容（action, key, date, flag）がGASに送られることの確認
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed, members: MEMBERS });
    const gasCalls = [];
    page.on('request', req => {
      if (!/script\.google\.com/.test(req.url()) || req.method() !== 'POST') return;
      try { gasCalls.push(JSON.parse(req.postData() || '{}')); } catch (e) { /* 無視 */ }
    });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-key]');

    await page.click('#memTable tr[data-key="k1"] button[data-act="leave"]');
    const editRow = await page.waitForSelector('#memTable tr.mem-edit[data-key="k1"]');
    check('退職・異動を押すと、その人の行の下にtr.mem-editが出て、同じdata-keyを持つ', !!editRow, editRow);
    await page.fill('#memTable #leaveDate', '2026-12-25');
    await page.selectOption('#memTable #leaveFlag', '9');
    await page.click('#memTable button[data-act="ok"]');
    await page.waitForTimeout(400);
    check('確定で今までと同じ内容(action, key, date, flag)がGASに送られる',
      gasCalls.some(c => c.action === 'retire' && c.key === 'k1' && c.date === '2026-12-25' && c.flag === 9),
      JSON.stringify(gasCalls));

    await page.close();
    await ctx.close();
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
