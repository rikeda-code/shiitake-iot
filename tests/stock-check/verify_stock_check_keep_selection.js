// 在庫の検証画面（dashboard/stock-check.html）で、選んだ内容が F5（再読み込み）の後も残ることの検証。
// 選びなおすたびに URL の後ろ（?site=inabe&kind=day&unit=kg&from=…&to=…）を履歴を増やさずに書き換え、開くときにそこから戻す。
// 実際のスプレッドシートには触れず、page.route() でCSVを実際のシートの形にモックする（今日は 2026-11-11 に固定）。
// いなべ 11/3〜11/10 は、fixtures.js（11/3 に保存）に無いので、2026-11-11 に今のシートから読んだ値を差し替えで入れる。
// 確かめること：
//  ① 何も付けない URL で開くと最初の設定（南丹・すべて・%・9〜11月）。開いた時点で URL に状態が書かれる
//  ② 「いなべ・日・2026-11-08〜2026-11-10・kg」を選んで再読み込みすると、同じ表示（一覧の数字も同じ）。クリックした行は残さない
//  ③ 「7日」を押した結果（開始日・終了日）も残り、再読み込み後も「7日」が選ばれた状態になる
//  ④ 再読み込みの後に「週」へ戻すと、「日」に入る前の開始月・終了月・単位に戻る
//  ⑤ 週・月・すべてのときは、開始月・終了月・拠点・単位が残る
//  ⑥ おかしな値の URL で開くと、その項目だけ最初の設定になる。日付は選べる範囲（7/1〜今日）の端に合わせる
//  ⑦ 選びなおしても履歴は増えず、「戻る」で前のページに戻る
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/stock-check/verify_stock_check_keep_selection.js
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

const active = (page, id) => page.evaluate(id => { const b = document.querySelector('#' + id + ' button.active'); return b ? b.textContent : null; }, id);
const view = page => page.evaluate(() => {
  const a = id => { const b = document.querySelector('#' + id + ' button.active'); return b ? b.textContent : null; };
  const v = id => { const e = document.getElementById(id); return e ? e.value : null; };
  const shown = id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
  return {
    site: a('siteSeg'), kind: a('kindSeg'), unit: a('unitSeg'), span: a('spanSeg'),
    from: v('dayFrom'), to: v('dayTo'), start: shown('startMonthPair') ? v('startMonth') : null, end: shown('endMonthPair') ? v('endMonth') : null,
    search: location.search,
  };
});
const rowsText = page => page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
const params = search => Object.fromEntries(new URLSearchParams(search));
async function setDate(page, id, v) {
  await page.fill('#' + id, v);
  await page.evaluate(id => document.getElementById(id).dispatchEvent(new Event('change')), id);
}
const waitRows = (page, first, last) => page.waitForFunction(([a, b]) => {
  const r = document.querySelectorAll('#tableWrap tbody tr');
  return r.length && r[0].getAttribute('data-id') === a && r[r.length - 1].getAttribute('data-id') === b;
}, [first, last]);
const waitTable = page => page.waitForSelector('#tableWrap table.grid');
const clickSeg = (page, id, text) => page.click('#' + id + ' button:text-is("' + text + '")');

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await H.fixTodayTo(page, 2026, 10, 11);
  await H.installMocks(page, { overrides: { 'いなべ': INABE_NOV } });
  return page;
}

(async () => {
  const browser = await chromium.launch();
  const page = await newPage(browser);

  // ① 最初の設定
  await page.goto(H.BASE_URL);
  await waitTable(page);
  let v = await view(page);
  check('① 何も付けないと 南丹・すべて・%・2026-09〜2026-11', v.site === '南丹' && v.kind === 'すべて' && v.unit === '%' && v.start === '2026-09' && v.end === '2026-11' && v.from === null, v);
  check('① 開いた時点で URL に状態が書かれる', v.search === '?site=nantan&kind=both&unit=pct&start=2026-09&end=2026-11', v.search);

  // ② いなべ・日・11/8〜11/10・kg
  await clickSeg(page, 'siteSeg', 'いなべ');
  await clickSeg(page, 'kindSeg', '日');
  await waitRows(page, 'D:2026-10-12', 'D:2026-11-10'); // 「日」の初期表示：在庫の入力がある最新の日（11/10）まで30日間
  await setDate(page, 'dayFrom', '2026-11-08');
  await waitRows(page, 'D:2026-11-08', 'D:2026-11-10');
  await page.click('#tableWrap tbody tr[data-id="D:2026-11-09"]'); // 行をクリックしてから再読み込み（行は残さない）
  const before = await rowsText(page);
  v = await view(page);
  check('② 選んだ状態：いなべ・日・kg・2026-11-08〜2026-11-10', v.site === 'いなべ' && v.kind === '日' && v.unit === 'kg' && v.from === '2026-11-08' && v.to === '2026-11-10', v);
  const p = params(v.search);
  check('② URL：site=inabe kind=day unit=kg from=2026-11-08 to=2026-11-10（日に入る前 pstart=2026-09 pend=2026-11 punit=pct）',
    p.site === 'inabe' && p.kind === 'day' && p.unit === 'kg' && p.from === '2026-11-08' && p.to === '2026-11-10' && p.pstart === '2026-09' && p.pend === '2026-11' && p.punit === 'pct' && !p.start && !p.end, p);
  check('② 再読み込み前の一覧：11/8 0.0・11/9 −1.1・11/10 −252.0、累計 −253.1',
    before.length === 3 && before[0][0] === '11/8（日）' && before[0][8] === '0.0' && before[1][8] === '−1.1' && before[2][8] === '−252.0' && before[2][13] === '−253.1', before);

  await page.reload();
  await waitRows(page, 'D:2026-11-08', 'D:2026-11-10');
  const after = await rowsText(page);
  const v2 = await view(page);
  check('② 再読み込み後も いなべ・日・kg・2026-11-08〜2026-11-10', v2.site === 'いなべ' && v2.kind === '日' && v2.unit === 'kg' && v2.from === '2026-11-08' && v2.to === '2026-11-10' && v2.start === null, v2);
  check('② 再読み込み後の URL は前と同じ', v2.search === v.search, [v.search, v2.search]);
  check('② 一覧の数字が再読み込みの前と同じ（在庫の差・累計を含む全列）', JSON.stringify(after) === JSON.stringify(before), after);
  check('② グラフの単位も kg のまま', await page.evaluate(() => window.__stockCheck.getState().unit === 'kg'));
  check('② クリックした行は残さない', await page.evaluate(() => window.__stockCheck.getState().selected === null && !document.querySelector('#tableWrap tr.selected')));

  // ③ 「7日」を押した結果
  await clickSeg(page, 'spanSeg', '7日');
  await waitRows(page, 'D:2026-11-04', 'D:2026-11-10');
  check('③ 「7日」：2026-11-04〜2026-11-10 が URL に入る', params(await page.evaluate(() => location.search)).from === '2026-11-04');
  await page.reload();
  await waitRows(page, 'D:2026-11-04', 'D:2026-11-10');
  v = await view(page);
  check('③ 再読み込み後も 2026-11-04〜2026-11-10 で「7日」が選ばれた状態', v.from === '2026-11-04' && v.to === '2026-11-10' && v.span === '7日', v);

  // ④ 「週」に戻すと、日に入る前の開始月・終了月・単位
  await clickSeg(page, 'kindSeg', '週');
  await waitTable(page);
  v = await view(page);
  check('④ 再読み込みの後に「週」へ：2026-09〜2026-11・%・開始日の欄は無し', v.kind === '週' && v.start === '2026-09' && v.end === '2026-11' && v.unit === '%' && v.from === null, v);
  check('④ URL は start・end に戻り、from・to・pstart は消える', (() => { const q = params(v.search); return q.kind === 'week' && q.start === '2026-09' && q.end === '2026-11' && !q.from && !q.to && !q.pstart; })(), v.search);

  // ⑤ 週・月・すべて：開始月・終了月・拠点・単位
  await clickSeg(page, 'siteSeg', '群馬');
  await clickSeg(page, 'kindSeg', '月');
  await clickSeg(page, 'unitSeg', 'kg');
  await page.selectOption('#startMonth', '2026-08');
  await page.selectOption('#endMonth', '2026-10');
  await waitTable(page);
  const mBefore = await view(page);
  await page.reload();
  await waitTable(page);
  const mAfter = await view(page);
  check('⑤ 群馬・月・kg・2026-08〜2026-10 が再読み込み後も残る', mAfter.site === '群馬' && mAfter.kind === '月' && mAfter.unit === 'kg' && mAfter.start === '2026-08' && mAfter.end === '2026-10', mAfter);
  check('⑤ URL も同じ', mAfter.search === mBefore.search && mAfter.search === '?site=gunma&kind=month&unit=kg&start=2026-08&end=2026-10', [mBefore.search, mAfter.search]);
  await page.close();

  // ⑥ おかしな値
  const cases = [
    ['知らない拠点・サイクル・単位、範囲外の月', '?site=tokyo&kind=year&unit=ton&start=2025-01&end=2026-10',
      { site: '南丹', kind: 'すべて', unit: '%', start: '2026-09', end: '2026-10', from: null }],
    ['開始月＞終了月は終了月に合わせる', '?site=gunma&kind=week&unit=kg&start=2026-11&end=2026-08',
      { site: '群馬', kind: '週', unit: 'kg', start: '2026-08', end: '2026-08', from: null }],
    ['日：知らない拠点だけ南丹、ありえない開始日は終了日から30日間', '?site=tokyo&kind=day&unit=kg&from=2026-13-01&to=2026-11-10',
      { site: '南丹', kind: '日', unit: 'kg', from: '2026-10-12', to: '2026-11-10', start: null }],
    ['日：範囲の外の日付は端（7/1・今日 11/11）に合わせる。単位が無ければ kg', '?site=inabe&kind=day&from=2026-06-15&to=2026-12-31',
      { site: 'いなべ', kind: '日', unit: 'kg', from: '2026-07-01', to: '2026-11-11' }],
    ['日：2/30 のような無い日は使わない（終了日は在庫の入力がある最新の日）', '?site=inabe&kind=day&unit=pct&from=2026-11-01&to=2026-02-30',
      { site: 'いなべ', kind: '日', unit: '%', from: '2026-11-01', to: '2026-11-10' }],
    ['日：開始日＞終了日は終了日に合わせる', '?site=inabe&kind=day&unit=kg&from=2026-11-10&to=2026-11-08',
      { site: 'いなべ', kind: '日', unit: 'kg', from: '2026-11-08', to: '2026-11-08' }],
    ['日：日付が無ければ最初の設定（最新の日まで30日間）', '?site=inabe&kind=day',
      { site: 'いなべ', kind: '日', unit: 'kg', from: '2026-10-12', to: '2026-11-10' }],
  ];
  for (const [name, q, want] of cases) {
    const pg = await newPage(browser);
    await pg.goto(H.BASE_URL + q);
    await waitTable(pg);
    if (want.to) await pg.waitForFunction(t => { const e = document.getElementById('dayTo'); return e && e.value === t; }, want.to);
    const got = await view(pg);
    const ok = Object.keys(want).every(k => got[k] === want[k]);
    check('⑥ ' + name, ok, got);
    await pg.close();
  }
  {
    // 「日」に入る前の月・単位がおかしいときは、その項目だけ最初の設定。ほかの URL の項目はそのまま残す
    const pg = await newPage(browser);
    await pg.goto(H.BASE_URL + '?foo=1&site=inabe&kind=day&unit=kg&from=2026-11-08&to=2026-11-10&pstart=2026-01&pend=2026-10&punit=kg');
    await waitRows(pg, 'D:2026-11-08', 'D:2026-11-10');
    check('⑥ 関係ない項目（foo=1）は URL に残す', params(await pg.evaluate(() => location.search)).foo === '1');
    await clickSeg(pg, 'kindSeg', '週');
    await waitTable(pg);
    const got = await view(pg);
    check('⑥ 日に入る前の開始月だけおかしい：週に戻すと 2026-09（最初の設定）〜2026-10・kg', got.start === '2026-09' && got.end === '2026-10' && got.unit === 'kg', got);
    await pg.close();
  }

  // ⑦ 履歴を増やさない・「戻る」で前のページへ
  {
    const pg = await newPage(browser);
    await pg.goto(H.BASE_URL.replace('stock-check.html', 'no-such-page.html')); // 前のページ（このサーバーの別の URL）
    const prevUrl = pg.url();
    await pg.goto(H.BASE_URL);
    await waitTable(pg);
    const len0 = await pg.evaluate(() => history.length);
    await clickSeg(pg, 'siteSeg', 'いなべ');
    await clickSeg(pg, 'kindSeg', '日');
    await waitRows(pg, 'D:2026-10-12', 'D:2026-11-10');
    await setDate(pg, 'dayFrom', '2026-11-08');
    await waitRows(pg, 'D:2026-11-08', 'D:2026-11-10');
    await clickSeg(pg, 'unitSeg', '%');
    await clickSeg(pg, 'unitSeg', 'kg');
    await pg.reload();
    await waitRows(pg, 'D:2026-11-08', 'D:2026-11-10');
    const len1 = await pg.evaluate(() => history.length);
    check('⑦ 選びなおし・再読み込みをしても履歴の数は増えない', len1 === len0, [len0, len1]);
    await pg.goBack();
    check('⑦ 「戻る」で前のページに戻る（選びなおしの途中に戻らない）', pg.url() === prevUrl, [prevUrl, pg.url()]);
    await pg.goForward();
    await waitRows(pg, 'D:2026-11-08', 'D:2026-11-10');
    const got = await view(pg);
    check('⑦ 「進む」で戻ると、最後に選んだ状態（いなべ・日・kg・11/8〜11/10）', got.site === 'いなべ' && got.kind === '日' && got.unit === 'kg' && got.from === '2026-11-08' && got.to === '2026-11-10', got);
    await pg.close();
  }

  await browser.close();
  H.finish();
})().catch(e => { console.error(e); process.exit(1); });
