// 在庫の検証画面（dashboard/stock-check.html）の「シートの読み取り」の検証。
// 実際のスプレッドシートには触れず、実際のシートの形（拠点・月で見出しの位置が違う）に合わせた
// モックのCSVを読ませる。
// 確かめること：
//  ① SOURCES が 2026年7〜11月（と、開始在庫を読むための6月）の gid を持ち、選べる月が7〜11月だけであること
//  ② 見出し名で列を探すこと：7・8月の列（出荷実績=AN/AP・いなべはAP/AR）と9月以降の列（AR/AT・いなべはAT/AV）、
//     群馬の8月以前（行が1行下）、いなべの在庫の表にある別の「出荷実績」の見出し（BI列）に惑わされないこと
//     → 3拠点×8月・10月の全日の出荷・収穫・合計在庫が、元の値と一致する
//  ③ セルの読み方：「1,103.1」「170.20kg」・空欄・数値でない値（#REF!）
//  ④ 見出しが見つからないタブは、分かるエラーにすること
//  ⑤ 移動表：規格ごとの重量、加工状況が空欄の規格は規格1と同じ、「直接出荷」は在庫を動かさない側に分けること
//  ⑥ 表示する月と週の一覧（月曜〜日曜。月をまたぐ週は開始日の月の下）
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/stock-check/verify_stock_check_parse.js
const { chromium } = require('playwright');
const H = require('./helpers');
const { check, near } = H;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await H.fixTodayTo(page, 2026, 10, 3);
  await H.installMocks(page, { missing: ['2026-06', '2026-07'] });
  await page.goto(H.BASE_URL);
  await page.waitForSelector('#tableWrap table.grid');

  // ① SOURCES
  const src = await page.evaluate(() => ({ sources: window.__stockCheck.SOURCES, months: window.__stockCheck.selectableMonths() }));
  check('① SOURCES が期待どおり（6月は開始在庫用、7〜11月に拠点3つのgidと対見込のgid）', JSON.stringify(src.sources) === JSON.stringify(H.EXPECTED_SOURCES), src.sources);
  check('① 選べる月は 7〜11月だけ（6月は選べない）', JSON.stringify(src.months) === JSON.stringify(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']), src.months);

  // ② 見出し名で列を探す（拠点×8月・10月の全日の値を、元の値と突き合わせる）
  const SITES = ['いなべ', '群馬', '南丹'];
  const cases = [];
  SITES.forEach(s => ['2026-08', '2026-10'].forEach(k => cases.push({ s, k, rows: H.makeSiteRows(s, k) })));
  const parsed = await page.evaluate((cases) => cases.map(c => ({ s: c.s, k: c.k, days: window.__stockCheck.parseSiteMonthTab(c.rows, c.k) })), cases);
  cases.forEach((c, idx) => {
    const days = parsed[idx].days; let bad = [], n = 0;
    Object.keys(H.FIX.days[c.s]).filter(d => d.slice(0, 7) === c.k).forEach(d => {
      n++;
      const f = H.FIX.days[c.s][d], p = days[d] || {};
      const eq = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-9);
      if (!eq(f[0], p.ship && p.ship.v) || !eq(f[1], p.harv && p.harv.v) || !eq(f[2], p.stock && p.stock.v)) bad.push([d, f.slice(0, 3), p.ship && p.ship.v, p.harv && p.harv.v, p.stock && p.stock.v]);
    });
    check('② ' + c.s + ' ' + c.k + '：全' + n + '日の出荷・収穫・合計在庫が元の値と一致', n > 20 && bad.length === 0, bad.slice(0, 3));
  });
  const nanOct = parsed[SITES.indexOf('南丹') * 2 + 1].days;
  check('② 月の日数ぶんだけ日を読む（10月は31日、翌月の行を読まない）', Object.keys(nanOct).length === 31 && nanOct['2026-10-31'] && !nanOct['2026-11-01'], Object.keys(nanOct).length);
  check('② 「合計在庫」の「0」は数値の0として読む（未入力の扱いは計算側）', (await page.evaluate((rows) => window.__stockCheck.parseSiteMonthTab(rows, '2026-11'), H.makeSiteRows('南丹', '2026-11')))['2026-11-20'].stock.v === 0);

  // ③ セルの読み方（南丹10月に、いろいろな書き方の値を入れる）
  const odd = {
    '2026-10-05': ['1,103.1', '170.20kg', '#REF!', null, null],
    '2026-10-06': [null, '', ' 12 ', '0', null],
  };
  const rowsOdd = H.makeSiteRows('南丹', '2026-10', odd);
  const pOdd = await page.evaluate((rows) => window.__stockCheck.parseSiteMonthTab(rows, '2026-10'), rowsOdd);
  check('③ 「1,103.1」→1103.1・「170.20kg」→170.2', near(pOdd['2026-10-05'].ship.v, 1103.1, 1e-9) && near(pOdd['2026-10-05'].harv.v, 170.2, 1e-9), pOdd['2026-10-05']);
  check('③ 数値でない値（#REF!）は v=null・err に元の文字', pOdd['2026-10-05'].stock.v === null && pOdd['2026-10-05'].stock.err === '#REF!', pOdd['2026-10-05'].stock);
  check('③ 空欄は v=null・blank=true', pOdd['2026-10-06'].ship.v === null && pOdd['2026-10-06'].ship.blank === true && pOdd['2026-10-06'].harv.blank === true, pOdd['2026-10-06']);
  check('③ 前後の空白は無視（" 12 "→12）', pOdd['2026-10-06'].stock.v === 12, pOdd['2026-10-06'].stock);

  // ④ 見出しが無いタブ
  const err = await page.evaluate(() => { try { window.__stockCheck.parseSiteMonthTab([['x', 'y'], ['1', '2']], '2026-10'); return null; } catch (e) { return String(e.message); } });
  check('④ 見出しが見つからないタブは「見出しが見つかりません（月）」のエラー', err && err.indexOf('見出しが見つかりません') === 0 && err.indexOf('2026-10') > 0, err);

  // ⑤ 移動表
  const tm = {};
  ['2026-08', '2026-09', '2026-10', '2026-11'].forEach(k => { tm[k] = H.makeTaimiRows(k); });
  const mv = await page.evaluate((tm) => {
    const o = {}; Object.keys(tm).forEach(k => { o[k] = window.__stockCheck.parseMovementTable(tm[k], k); });
    o.none = window.__stockCheck.parseMovementTable([['日付', '出荷先'], ['1/1', 'x']], '2026-10');
    return o;
  }, tm);
  const sum = a => a.reduce((x, m) => x + m.kg, 0);
  check('⑤ 8月：直接出荷は4件・計393kg（群馬→いなべ・袋）', mv['2026-08'].direct.length === 4 && near(sum(mv['2026-08'].direct), 393, 1e-9) && mv['2026-08'].direct.every(m => m.from === '群馬' && m.to === 'いなべ' && m.spec === '袋'), mv['2026-08'].direct);
  const aug6 = mv['2026-08'].moves.filter(m => m.date === '2026-08-06');
  check('⑤ 8/6：規格1・規格2の2行（148.2kg・40kg）。規格2の加工状況は空欄なので規格1の「製品」を引き継ぐ', aug6.length === 2 && near(aug6[0].kg, 148.2, 1e-9) && near(aug6[1].kg, 40, 1e-9) && aug6.every(m => m.status === '製品'), aug6);
  check('⑤ 9月：在庫を動かす移動は12件・計1080kg', mv['2026-09'].moves.length === 12 && near(sum(mv['2026-09'].moves), 1080, 1e-9), [mv['2026-09'].moves.length, sum(mv['2026-09'].moves)]);
  check('⑤ 10月：3行（10/23 群馬→南丹 L・M、10/24 南丹→群馬、10/20 いなべ→群馬）で4件・計400kg', mv['2026-10'].moves.length === 4 && near(sum(mv['2026-10'].moves), 400, 1e-9), [mv['2026-10'].moves.length, sum(mv['2026-10'].moves)]);
  check('⑤ 11月：移動なし', mv['2026-11'].moves.length === 0 && mv['2026-11'].direct.length === 0);
  check('⑤ 移動表が無いタブは空の結果', mv.none.moves.length === 0 && mv.none.direct.length === 0);

  // ⑥ 月と週
  const cy = await page.evaluate(() => window.__stockCheck.buildCycles('2026-09', '2026-11'));
  const ids = cy.map(c => c.id);
  check('⑥ 9〜11月：月3つ＋週13（9月4・10月4・11月5）', cy.filter(c => c.kind === 'month').length === 3 && cy.filter(c => c.kind === 'week').length === 13, ids);
  check('⑥ 並びは「月の行→その月の週」', ids[0] === 'M:2026-09' && ids[1] === 'W:2026-09-07' && ids[5] === 'M:2026-10' && ids[6] === 'W:2026-10-05', ids);
  const w928 = cy.filter(c => c.id === 'W:2026-09-28')[0], w1026 = cy.filter(c => c.id === 'W:2026-10-26')[0];
  check('⑥ 月をまたぐ週は開始日の月の下（9/28〜10/4は9月、10/26〜11/1は10月）', w928.monthKey === '2026-09' && w928.label === '9/28〜10/4' && w928.b === '2026-10-04' && w1026.monthKey === '2026-10' && w1026.label === '10/26〜11/1', [w928, w1026]);
  check('⑥ 週の開始日はすべて月曜、期間は7日', cy.filter(c => c.kind === 'week').every(c => new Date(c.a + 'T00:00:00Z').getUTCDay() === 1 && new Date(c.b + 'T00:00:00Z').getUTCDay() === 0), ids);
  const one = await page.evaluate(() => window.__stockCheck.buildCycles('2026-11', '2026-11').map(c => c.id));
  check('⑥ 11月だけ：11/2・9・16・23・30の5週', JSON.stringify(one) === JSON.stringify(['M:2026-11', 'W:2026-11-02', 'W:2026-11-09', 'W:2026-11-16', 'W:2026-11-23', 'W:2026-11-30']), one);

  await browser.close();
  H.finish();
})().catch(e => { console.error(e); process.exit(1); });
