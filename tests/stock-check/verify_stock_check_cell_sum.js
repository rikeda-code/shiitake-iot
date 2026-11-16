// 在庫の検証画面（dashboard/stock-check.html）の ②一覧で、セルを選んで集計する機能の検証
// （直近工数計画 work-hours-forecast.html と同じ操作：ドラッグ・Shift・Ctrl・スマホのタップ・Esc／表の外／「選択を解除」）。
// 実際のスプレッドシートには触れず、page.route() でCSVを実際のシートの形にモックする（今日は 2026-11-11 に固定）。
// いなべ 11/3〜11/10 は、fixtures.js（11/3 に保存）に無いので、2026-11-11 に今のシートから読んだ値を差し替えで入れる。
// 確かめること：
//  ① いなべ・日・11/8〜11/10 の「収穫」3セルをドラッグ：合計 2,000・平均 666.7・個数 3・最小 598・最大 750
//  ② 合計は丸める前の値（data-raw）：四角い範囲の合計が画面の計算の関数の値と同じ。調整 0.04kg×3日は表示「0.0」でも合計 0.1
//  ③ 選べない列（移動・率・要確認・期間）と「計算できません」の行は選ばれない。「－」のセル（調整合計が無い日）は数えない
//  ④ Shift＋クリックで範囲、Ctrl（⌘）＋クリック・ドラッグで追加
//  ⑤ 動かさずにクリックするとグラフ（③日別）が替わる。ドラッグ・Shift・Ctrl では替わらない
//  ⑥ 二重に数える注意：「すべて」で月と週の行を両方、日で累計の差と日次の差を両方選んだときだけ
//  ⑦ Esc・表の外のクリック・「選択を解除」、拠点・サイクル・期間・単位の切り替えで選択が消える。URL は書き換えない。F5 の後は何も選ばれていない
//  ⑧ スマホ：タップのたびに選択に足す・外し、その行のグラフも出す
//  ⑨ セルを選んで横スクロールしても、固定した期間の列が崩れない（PC・390px）
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/stock-check/verify_stock_check_cell_sum.js
const { chromium } = require('playwright');
const H = require('./helpers');
const { check } = H;

// 今のシート（2026-11-11 に読み取り）のいなべ 11/3〜11/10：[出荷, 収穫, 合計在庫, 廃棄, 規格外]（廃棄・規格外は空欄）
const INABE_NOV = {
  '2026-11-03': [248.4, 903, 2081, null, null],
  '2026-11-04': [925.7, 901, 2469, null, null],
  '2026-11-05': [700.1, 781, 2431, null, null],
  '2026-11-06': [1321, 688, 1736, null, null],
  '2026-11-07': [309.6, 750, 1986, null, null],
  '2026-11-08': [0, 652, 2638, null, null],
  '2026-11-09': [1373.9, 598, 1861, null, null],
  '2026-11-10': [190, 750, 2169, null, null],
};
const Q_INABE = '?site=inabe&kind=day&unit=kg&from=2026-11-08&to=2026-11-10';
const D8 = 'D:2026-11-08', D9 = 'D:2026-11-09', D10 = 'D:2026-11-10';
// 列：1 開始在庫 2 出荷 3 収穫 4 移動 5 廃棄+規格外 6 あるべき在庫 7 実際の在庫 8 調整前の差 9 調整合計 10 調整後の差
//     11 率（前） 12 率（後） 13 累計（前） 14 累計（後） 15 要確認（日のとき）。0 は期間
const td = (id, i) => `#tableWrap tbody tr[data-id="${id}"] > td:nth-child(${i + 1})`;

async function newPage(browser, opts, missing) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1400, height: 900 } }, opts || {}));
  const page = await ctx.newPage();
  await H.fixTodayTo(page, 2026, 10, 11);
  await H.installMocks(page, { overrides: { 'いなべ': INABE_NOV }, missing: missing || [] });
  return page;
}
const waitRows = (page, first, last) => page.waitForFunction(([a, b]) => {
  const r = document.querySelectorAll('#tableWrap tbody tr');
  return r.length && r[0].getAttribute('data-id') === a && r[r.length - 1].getAttribute('data-id') === b;
}, [first, last]);
// セルの中心（画面の中央に出してから測る。上部の固定部分の裏にならないように）
async function center(page, sel) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
}
// ドラッグの始点・終点は、始点を画面の中央に出したあと、スクロールせずに両方を測る
// （終点を測るときにスクロールすると、始点の位置がずれるため）
async function drag(page, fromSel, toSel, mods) {
  const [a, b] = await page.evaluate(([f, t]) => {
    document.querySelector(f).scrollIntoView({ block: 'center', inline: 'nearest' });
    return [f, t].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  }, [fromSel, toSel]);
  for (const m of mods || []) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  for (const m of mods || []) await page.keyboard.up(m);
}
async function clickCell(page, sel, mods) {
  const a = await center(page, sel);
  for (const m of mods || []) await page.keyboard.down(m);
  await page.mouse.click(a.x, a.y);
  for (const m of mods || []) await page.keyboard.up(m);
}
const bar = page => page.evaluate(() => {
  const t = id => document.getElementById(id).textContent, vis = id => document.getElementById(id).style.display !== 'none';
  return {
    show: document.getElementById('aggBar').classList.contains('show'),
    sum: t('aggSum'), avg: t('aggAvg'), count: t('aggCount'), min: t('aggMin'), max: t('aggMax'),
    warnUnit: vis('aggWarnUnit'), warnMW: vis('aggWarnMonthWeek'), warnCum: vis('aggWarnCum'),
  };
});
// 選ばれているセル：[行の id, 列の番号（0 始まり）]
const picked = page => page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap td.cell-selected')).map(c => [c.parentElement.getAttribute('data-id'), Array.prototype.indexOf.call(c.parentElement.children, c)]));
const selectedRow = page => page.evaluate(() => window.__stockCheck.getState().selected);
const cols = list => Array.from(new Set(list.map(p => p[1]))).sort((a, b) => a - b);
const fmt1 = v => v.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// 画面の計算の関数で、いなべの日ごとの値（丸める前）を出す
const rawOf = (page, day) => page.evaluate(day => {
  const S = window.__stockCheck, st = S.getState(), r = S.computeCycle('いなべ', st.data['いなべ'], day, day, st.moves, st.adjustments, null);
  return { S0: r.S0, ship: r.ship, harv: r.harv, wk: r.waste + r.kik, expected: r.expected, S1: r.S1, diffBefore: r.diffBefore, diffAfter: r.diffAfter, adjSum: r.adjSum };
}, day);

(async () => {
  const browser = await chromium.launch();
  let page = await newPage(browser);
  await page.goto(H.BASE_URL + Q_INABE);
  await waitRows(page, D8, D10);
  const url0 = await page.evaluate(() => location.search);

  // ① 収穫3セル
  check('① 初めは何も選ばれておらず、下の帯は出ていない', (await picked(page)).length === 0 && !(await bar(page)).show);
  await drag(page, td(D8, 3), td(D10, 3));
  let b = await bar(page), p = await picked(page);
  check('① 収穫 11/8〜11/10 をドラッグ：3セル（652・598・750）', p.length === 3 && cols(p).join() === '3', p);
  check('① 合計 2,000・平均 666.7・個数 3・最小 598・最大 750（収穫だけは整数）', b.show && b.sum === '2,000' && b.avg === '666.7' && b.count === '3' && b.min === '598' && b.max === '750', b);
  check('① 注意は出ない', !b.warnUnit && !b.warnMW && !b.warnCum, b);

  // ② 丸める前の値
  const raws = [await rawOf(page, '2026-11-08'), await rawOf(page, '2026-11-09'), await rawOf(page, '2026-11-10')];
  await drag(page, td(D8, 1), td(D10, 7));
  p = await picked(page); b = await bar(page);
  const keys = ['S0', 'ship', 'harv', 'wk', 'expected', 'S1'];
  const rectSum = raws.reduce((a, r) => a + keys.reduce((s, k) => s + r[k], 0), 0);
  check('② 開始在庫〜実際の在庫の四角：18セル（列 1・2・3・5・6・7、移動の列4は入らない）', p.length === 18 && cols(p).join() === '1,2,3,5,6,7', cols(p));
  check('② 合計 ＝ 画面の計算の関数の値（丸める前）を足したもの', b.sum === fmt1(rectSum) && b.count === '18', [b.sum, rectSum]);
  const dataRaw = await page.evaluate(sel => document.querySelector(sel).getAttribute('data-raw'), td(D9, 6));
  check('② セルには丸める前の値を持たせている（11/9 あるべき在庫 ' + raws[1].expected + '）', Number(dataRaw) === raws[1].expected, [dataRaw, raws[1].expected]);
  await drag(page, td(D8, 8), td(D10, 8));
  b = await bar(page);
  check('② 調整前の差 3日：合計 −253.1（11/10 の累計の差と同じ）・最小 −252.0', b.sum === '-253.1' && b.min === '-252.0' && b.max === '0.0' && b.count === '3', b);
  // 調整（手入力）0.04kg を3日：表示は 0.0 だが、丸める前の合計は 0.12 → 0.1
  await page.evaluate(() => window.__stockCheck.setAdjustments(['2026-11-08', '2026-11-09', '2026-11-10'].map((d, i) => ({ id: 'r' + i, date: d, site: 'いなべ', kg: 0.04, category: 'その他', reason: 'テスト', deleted: false }))));
  await waitRows(page, D8, D10);
  const shown = await page.evaluate(ids => ids.map(id => document.querySelector(`#tableWrap tbody tr[data-id="${id}"] > td:nth-child(10)`).textContent), [D8, D9, D10]);
  await drag(page, td(D8, 9), td(D10, 9));
  b = await bar(page);
  check('② 調整 0.04kg×3日：表示はどれも「0.0」でも、合計は丸める前で 0.1（表示を足すと 0.0）', shown.every(s => s === '0.0') && b.sum === '0.1' && b.count === '3', [shown, b]);
  await page.evaluate(() => window.__stockCheck.setAdjustments([]));
  await waitRows(page, D8, D10);

  // ③ 選べない列・「－」のセル
  await drag(page, td(D8, 8), td(D10, 15));
  p = await picked(page); b = await bar(page);
  check('③ 調整前の差〜要確認の四角：列 8・9・10・13・14 だけ（率 11・12、要確認 15 は入らない）', cols(p).join() === '8,9,10,13,14' && p.length === 15, cols(p));
  check('③ 調整合計の「－」（調整が無い日）は数えない：個数 12', b.count === '12', b);
  for (const [name, i] of [['期間', 0], ['移動 入/出', 4], ['率（前）', 11], ['率（後）', 12], ['要確認', 15]]) {
    await clickCell(page, td(D9, i));
    check('③ ' + name + 'の列をクリックしても選ばれない（選択は消える）', (await picked(page)).length === 0 && !(await bar(page)).show);
  }
  {
    // 「計算できません」の行：7月のタブが読めないとき、8/1 は開始在庫（7/31）が無い（verify_stock_check_daily.js と同じ形）
    const pg = await newPage(browser, null, ['2026-06', '2026-07']);
    await pg.goto(H.BASE_URL + '?site=nantan&kind=day&unit=kg&from=2026-08-01&to=2026-08-05');
    await pg.waitForSelector('#tableWrap table.grid');
    const nostart = await pg.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('#tableWrap tbody tr')).filter(t => t.textContent.indexOf('計算できません') >= 0);
      return { rows: trs.length, cells: trs.reduce((a, t) => a + t.querySelectorAll('.selectable-cell').length, 0), others: document.querySelectorAll('#tableWrap .selectable-cell').length };
    });
    check('③ 「計算できません」の行には選べるセルが無い（ほかの行にはある）', nostart.rows > 0 && nostart.cells === 0 && nostart.others > 0, nostart);
    await pg.context().close();
  }

  // ④⑤ Shift・Ctrl とグラフ
  await clickCell(page, td(D8, 3));
  check('⑤ 動かさずにクリック：グラフが 11/8 の行に替わり、そのセル1つを選ぶ', (await selectedRow(page)) === D8 && (await picked(page)).length === 1 && (await bar(page)).sum === '652');
  await clickCell(page, td(D10, 7), ['Shift']);
  p = await picked(page);
  check('④ Shift＋クリック：11/8 収穫〜11/10 実際の在庫の四角（列 3・5・6・7 × 3日 ＝ 12）', p.length === 12 && cols(p).join() === '3,5,6,7', cols(p));
  check('⑤ Shift＋クリックではグラフは替わらない（11/8 のまま）', (await selectedRow(page)) === D8);
  await clickCell(page, td(D9, 1), ['Control']);
  p = await picked(page);
  check('④ Ctrl＋クリック：11/9 開始在庫を足して 13', p.length === 13 && p.some(x => x[0] === D9 && x[1] === 1), p.length);
  check('⑤ Ctrl＋クリックではグラフは替わらない', (await selectedRow(page)) === D8);
  await drag(page, td(D9, 13), td(D10, 14), ['Control']);
  check('④ Ctrl＋ドラッグ：累計の差 2×2 を足して 17', (await picked(page)).length === 17);
  await drag(page, td(D9, 2), td(D10, 2));
  check('⑤ ドラッグではグラフは替わらない（11/8 のまま）、選択は置き換わる（2）', (await selectedRow(page)) === D8 && (await picked(page)).length === 2);
  await drag(page, td(D10, 2), td(D9, 2));
  await drag(page, td(D9, 3), td(D9, 6)); // 同じ行の中でのドラッグ
  p = await picked(page);
  check('⑤ 同じ行の中でドラッグしてもグラフは替わらない（11/9 の 収穫・廃棄+規格外・あるべき在庫 の3つ）', (await selectedRow(page)) === D8 && p.length === 3, [await selectedRow(page), p]);
  await clickCell(page, td(D10, 8));
  check('⑤ もう一度、動かさずにクリック：グラフが 11/10 に替わる', (await selectedRow(page)) === D10 && (await picked(page)).length === 1);
  check('⑤ 行を選んでも表は描き直さない（選んだセルが残る）', (await page.evaluate(() => document.querySelector('#tableWrap tr.selected').getAttribute('data-id'))) === D10 && (await bar(page)).sum === '-252.0');
  await clickCell(page, td(D9, 0));
  check('⑤ 期間の列のクリックは今までどおりグラフを替える（選択は消える）', (await selectedRow(page)) === D9 && (await picked(page)).length === 0);

  // ⑥ 二重に数える注意（日：累計と日次の差）
  await drag(page, td(D8, 8), td(D10, 8));
  check('⑥ 日：日次の差だけ → 注意なし', !(await bar(page)).warnCum);
  await drag(page, td(D8, 13), td(D10, 14));
  check('⑥ 日：累計の差だけ → 注意なし', !(await bar(page)).warnCum);
  await drag(page, td(D8, 10), td(D10, 13));
  b = await bar(page);
  check('⑥ 日：日次の差と累計の差を両方 → 「累計の差と日次の差を両方含む」', b.warnCum && !b.warnMW, b);
  await drag(page, td(D8, 1), td(D10, 7));
  check('⑥ 日：差を含まない（在庫・出荷・収穫）→ 注意なし', !(await bar(page)).warnCum);

  // ⑦ 選択を消す
  check('⑦ 選んでも URL は書き換えない', (await page.evaluate(() => location.search)) === url0);
  await page.keyboard.press('Escape');
  check('⑦ Esc で消える', (await picked(page)).length === 0 && !(await bar(page)).show);
  await drag(page, td(D8, 3), td(D10, 3));
  await page.click('#aggClearBtn');
  check('⑦ 「選択を解除」で消える', (await picked(page)).length === 0 && !(await bar(page)).show);
  await drag(page, td(D8, 3), td(D10, 3));
  await page.click('h1');
  check('⑦ 表の外（タイトル）をクリックすると消える', (await picked(page)).length === 0 && !(await bar(page)).show);
  await drag(page, td(D8, 3), td(D10, 3));
  await page.click('#unitSeg button:text-is("%")');
  check('⑦ 単位を切り替えると消える', (await picked(page)).length === 0 && !(await bar(page)).show);
  await drag(page, td(D8, 3), td(D10, 3));
  await page.evaluate(() => { const e = document.getElementById('dayFrom'); e.value = '2026-11-09'; e.dispatchEvent(new Event('change')); });
  await waitRows(page, D9, D10);
  check('⑦ 期間（開始日）を切り替えると消える', (await picked(page)).length === 0 && !(await bar(page)).show);
  await drag(page, td(D9, 3), td(D10, 3));
  await page.reload();
  await waitRows(page, D9, D10);
  check('⑦ F5 の後は何も選ばれていない', (await picked(page)).length === 0 && !(await bar(page)).show);
  await drag(page, td(D9, 3), td(D10, 3));
  await page.click('#kindSeg button:text-is("すべて")');
  await page.waitForSelector('#tableWrap table.grid');
  check('⑦ サイクルを切り替えると消える', (await picked(page)).length === 0 && !(await bar(page)).show);
  const nd = await page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap tbody tr.selectable')).map(t => t.getAttribute('data-id')));
  await drag(page, td(nd[0], 3), td(nd[1], 3));
  check('⑦ （拠点の切り替えの前に2つ選んでいる）', (await picked(page)).length === 2);
  await page.click('#siteSeg button:text-is("南丹")');
  await page.waitForSelector('#tableWrap table.grid');
  check('⑦ 拠点を切り替えると消える', (await picked(page)).length === 0 && !(await bar(page)).show);

  // ⑥ 二重に数える注意（すべて：月と週）
  const ids = await page.evaluate(() => {
    const m = document.querySelector('#tableWrap tbody tr.month.selectable'), all = Array.from(document.querySelectorAll('#tableWrap tbody tr'));
    const ws = all.slice(all.indexOf(m) + 1).filter(t => t.classList.contains('week') && t.classList.contains('selectable'));
    return { m: m.getAttribute('data-id'), w1: ws[0].getAttribute('data-id'), w2: ws[1].getAttribute('data-id') };
  });
  await drag(page, td(ids.w1, 2), td(ids.w2, 2));
  check('⑥ すべて：週の行だけ → 注意なし', !(await bar(page)).warnMW);
  await drag(page, td(ids.m, 2), td(ids.w1, 2));
  b = await bar(page);
  check('⑥ すべて：月と週の行を両方 → 「月と週の行を両方含む」', b.warnMW && !b.warnCum, [ids, b]);
  await clickCell(page, td(ids.m, 2));
  check('⑥ すべて：月の行だけ → 注意なし', !(await bar(page)).warnMW);
  await page.click('#kindSeg button:text-is("週")');
  await page.waitForSelector('#tableWrap table.grid');
  const wk = await page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap tbody tr.week.selectable')).slice(0, 2).map(t => t.getAttribute('data-id')));
  await drag(page, td(wk[0], 8), td(wk[1], 10));
  check('⑥ 週：差だけを選んでも注意なし（注意は2つの場合だけ）', !(await bar(page)).warnMW && !(await bar(page)).warnCum && !(await bar(page)).warnUnit);
  await page.context().close();

  // ⑧ スマホのタップ
  {
    const pg = await newPage(browser, { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    await pg.goto(H.BASE_URL + Q_INABE);
    await waitRows(pg, D8, D10);
    await pg.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), td(D8, 3));
    await pg.tap(td(D8, 3));
    check('⑧ タップ：11/8 収穫を選び、グラフも 11/8', (await picked(pg)).length === 1 && (await selectedRow(pg)) === D8 && (await bar(pg)).sum === '652');
    await pg.tap(td(D10, 3));
    check('⑧ 次のタップ：11/10 収穫を足して2つ（合計 1,402）、グラフは 11/10', (await picked(pg)).length === 2 && (await bar(pg)).sum === '1,402' && (await selectedRow(pg)) === D10);
    await pg.tap(td(D8, 3));
    check('⑧ 選んだセルをもう一度タップ：外れて1つ（合計 750）、グラフは 11/8', (await picked(pg)).length === 1 && (await bar(pg)).sum === '750' && (await selectedRow(pg)) === D8);
    // ⑨ 横スクロールしても期間の列が崩れない（390px）
    const st = await pg.evaluate(sel => {
      const wrap = document.getElementById('tableWrap'); wrap.scrollLeft = 400;
      const tr = document.querySelector(sel).parentElement, c0 = tr.children[0], r0 = c0.getBoundingClientRect();
      const hit = document.elementFromPoint(r0.right - 3, r0.top + r0.height / 2);
      return { scroll: wrap.scrollLeft, left: Math.round(r0.left - wrap.getBoundingClientRect().left), pos: getComputedStyle(c0).position, hitSelf: !!hit && (hit === c0 || c0.contains(hit)),
        widths: Array.from(document.querySelectorAll('#tableWrap tbody tr')).map(t => Math.round(t.children[0].getBoundingClientRect().width)) };
    }, td(D10, 3));
    check('⑨ 390px：セルを選んで横スクロールしても、期間の列は左端に固定・前に見えている・幅は同じ', st.scroll > 0 && st.left === 0 && st.pos === 'sticky' && st.hitSelf && new Set(st.widths).size === 1, st);
    await pg.context().close();
  }
  {
    // ⑨ PC：選んだセルが期間の列の下に入っても、期間の列が前に見える
    const pg = await newPage(browser, { viewport: { width: 900, height: 800 } });
    await pg.goto(H.BASE_URL + Q_INABE);
    await waitRows(pg, D8, D10);
    await drag(pg, td(D8, 1), td(D10, 7));
    const st = await pg.evaluate(() => {
      const wrap = document.getElementById('tableWrap'); wrap.scrollLeft = 150;
      const tr = document.querySelector('#tableWrap tbody tr[data-id="D:2026-11-09"]'), c0 = tr.children[0], r0 = c0.getBoundingClientRect();
      const hit = document.elementFromPoint(r0.right - 3, r0.top + r0.height / 2);
      return { scroll: wrap.scrollLeft, left: Math.round(r0.left - wrap.getBoundingClientRect().left), hitSelf: !!hit && (hit === c0 || c0.contains(hit)), bg: getComputedStyle(c0).backgroundColor, selected: document.querySelectorAll('#tableWrap td.cell-selected').length };
    });
    check('⑨ PC（900px）：選んだセルを横スクロールで期間の列の下に入れても、期間の列が前に見える（背景は不透明）', st.scroll > 0 && st.left === 0 && st.hitSelf && !/rgba\(.*, 0\)/.test(st.bg) && st.selected === 18, st);
    await pg.context().close();
  }

  await browser.close();
  H.finish();
})().catch(e => { console.error(e); process.exit(1); });
