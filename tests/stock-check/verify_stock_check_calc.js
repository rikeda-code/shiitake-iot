// 在庫の検証画面（dashboard/stock-check.html）の「計算」の検証。
// 実際のスプレッドシートには触れず、実データ（fixtures.js）を実際のシートの形に直したCSVを
// 計算関数（window.__stockCheck）に読ませて、2026-11-03 に報告した数字と一致するかを確かめる。
// 確かめること：
//  ① サイクルの計算（開始在庫・出荷・収穫・移動・あるべき在庫・調整前の差・率＝差÷収穫量）
//     南丹10月・南丹10/26〜11/1・群馬10/26〜11/1・いなべ10/26〜11/1
//  ② 最終日の在庫が未入力のサイクルは、最新の入力日までの暫定値（南丹11月・11/2〜11/8）
//  ③ 調整の一覧を渡したときの調整合計・調整後の差（削除済み・他拠点・期間外は無視）。空の一覧では
//     調整合計が null（画面では「－」）で、調整後の差は調整前と同じ
//  ④ 要確認の判定（中央値の3倍超・空欄・0・数値でない値。いなべの日曜の出荷0は除く。今日以降は対象外）
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/stock-check/verify_stock_check_calc.js
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

  const SITES = ['いなべ', '群馬', '南丹'];
  const payload = { sites: {}, taimi: {} };
  SITES.forEach(s => { payload.sites[s] = {}; ['2026-08', '2026-09', '2026-10', '2026-11'].forEach(k => { payload.sites[s][k] = H.makeSiteRows(s, k); }); });
  ['2026-08', '2026-09', '2026-10', '2026-11'].forEach(k => { payload.taimi[k] = H.makeTaimiRows(k); });

  const R = await page.evaluate((payload) => {
    const sc = window.__stockCheck;
    const today = '2026-11-03';
    const days = {}, flags = {};
    Object.keys(payload.sites).forEach(s => {
      days[s] = {};
      Object.keys(payload.sites[s]).forEach(k => { Object.assign(days[s], sc.parseSiteMonthTab(payload.sites[s][k], k)); });
      flags[s] = sc.computeFlags(s, days[s], today);
    });
    let moves = [];
    Object.keys(payload.taimi).forEach(k => { moves = moves.concat(sc.parseMovementTable(payload.taimi[k], k).moves); });
    const cyc = (s, a, b, adj) => sc.computeCycle(s, days[s], a, b, moves, adj || [], flags[s]);
    const out = {};
    out.nantanOct = cyc('南丹', '2026-10-01', '2026-10-31');
    out.nantanWk = cyc('南丹', '2026-10-26', '2026-11-01');
    out.gunmaWk = cyc('群馬', '2026-10-26', '2026-11-01');
    out.inabeWk = cyc('いなべ', '2026-10-26', '2026-11-01');
    out.nantanNov = cyc('南丹', '2026-11-01', '2026-11-30');
    out.nantanWkNow = cyc('南丹', '2026-11-02', '2026-11-08');
    out.nantanWkFuture = cyc('南丹', '2026-11-09', '2026-11-15');
    // 調整
    const ADJ = [
      { id: 'a1', date: '2026-10-27', site: '南丹', kg: -100, deleted: false },
      { id: 'a2', date: '2026-10-28', site: '南丹', kg: 30, deleted: true },        // 削除済み → 無視
      { id: 'a3', date: '2026-10-28', site: '南丹', kg: 7, deleted: 'TRUE' },        // 文字列のTRUEも削除済み
      { id: 'a4', date: '2026-10-28', site: '群馬', kg: 999, deleted: false },       // 他拠点 → 無視
      { id: 'a5', date: '2026-11-02', site: '南丹', kg: 50, deleted: false },        // 期間外 → 無視
    ];
    out.nantanWkAdj = cyc('南丹', '2026-10-26', '2026-11-01', ADJ);
    out.sumNone = sc.sumAdjustments([], '南丹', '2026-10-26', '2026-11-01');
    out.sumSome = sc.sumAdjustments(ADJ, '南丹', '2026-10-01', '2026-11-30');
    out.sumNull = sc.sumAdjustments(null, '南丹', '2026-10-01', '2026-11-30');
    // 日別
    out.daily = sc.computeDaily('南丹', days['南丹'], '2026-10-26', '2026-11-01', moves, []);
    out.dailyAdj = sc.computeDaily('南丹', days['南丹'], '2026-10-26', '2026-11-01', moves, ADJ);
    // 要確認
    out.flagNantan = flags['南丹'];
    out.flagInabe = flags['いなべ'];
    out.flagKeys = { nantanToday: flags['南丹']['2026-11-03'], inabeSun: flags['いなべ']['2026-11-01'] };
    // 要確認（合成）：月曜の出荷0・火曜の在庫0・数値でない値・3倍超
    const syn = JSON.parse(JSON.stringify(days['群馬']));
    syn['2026-10-12'].ship = { v: 0 };                 // 月曜
    syn['2026-10-13'].stock = { v: 0 };                // 火曜
    syn['2026-10-14'].harv = { v: null, err: '#REF!' };
    syn['2026-10-15'].ship = { v: 5000 };
    syn['2026-10-18'].ship = { v: 0 };                 // 日曜（群馬は除外されない）
    out.flagSyn = sc.computeFlags('群馬', syn, today);
    const synI = JSON.parse(JSON.stringify(days['いなべ']));
    synI['2026-10-18'].ship = { v: 0 };                // いなべの日曜 → 除外
    synI['2026-10-19'].ship = { v: 0 };                // いなべの月曜 → 要確認
    out.flagSynInabe = sc.computeFlags('いなべ', synI, today);
    return out;
  }, payload);

  // ① 計算
  const o = R.nantanOct;
  check('① 南丹10月：status=complete・最終日=10/31', o.status === 'complete' && o.e === '2026-10-31', o.status);
  check('① 南丹10月：開始在庫1314.7（9/30の在庫）', near(o.S0, 1314.7), o.S0);
  check('① 南丹10月：出荷15533.8・収穫17708', near(o.ship, 15533.8) && near(o.harv, 17708), [o.ship, o.harv]);
  check('① 南丹10月：移動 入100・出50', near(o.movIn, 100) && near(o.movOut, 50), [o.movIn, o.movOut]);
  check('① 南丹10月：あるべき在庫3538.9・実際1206.4', near(o.expected, 3538.9) && near(o.S1, 1206.4), [o.expected, o.S1]);
  check('① 南丹10月：調整前の差 -2332.5・率＝差÷収穫量', near(o.diffBefore, -2332.5) && near(o.rateBefore, -2332.5 / 17708, 1e-6), [o.diffBefore, o.rateBefore]);
  check('① 調整が無いとき：調整合計 null・調整後の差＝調整前の差・率（後）＝率（前）', o.adjSum === null && o.diffAfter === o.diffBefore && o.rateAfter === o.rateBefore, [o.adjSum, o.diffAfter]);
  const w = R.nantanWk;
  check('① 南丹10/26〜11/1：開始在庫1137.6・出荷3910.3・収穫4504', near(w.S0, 1137.6) && near(w.ship, 3910.3) && near(w.harv, 4504), [w.S0, w.ship, w.harv]);
  check('① 南丹10/26〜11/1：あるべき1731.3・実際907.3・差 -824.0・率 -18.3%', near(w.expected, 1731.3) && near(w.S1, 907.3) && near(w.diffBefore, -824.0) && near(w.rateBefore, -824.0 / 4504, 1e-6), w);
  const g = R.gunmaWk;
  check('① 群馬10/26〜11/1：開始在庫1484.4・出荷4138.1・収穫4114・差 +15.8', near(g.S0, 1484.4) && near(g.ship, 4138.1) && near(g.harv, 4114) && near(g.diffBefore, 15.8), g);
  const i = R.inabeWk;
  check('① いなべ10/26〜11/1：出荷4916.6・収穫5637・差 -1332.4', near(i.ship, 4916.6) && near(i.harv, 5637) && near(i.diffBefore, -1332.4), i);

  // ② 暫定
  const n = R.nantanNov;
  check('② 南丹11月：暫定（最終日11/30の在庫は未入力 → 11/2まで）', n.status === 'provisional' && n.e === '2026-11-02', [n.status, n.e]);
  check('② 南丹11月：出荷1070.0・収穫962・差 -50.8', near(n.ship, 1070.0) && near(n.harv, 962) && near(n.diffBefore, -50.8), n);
  const nw = R.nantanWkNow;
  check('② 南丹11/2〜11/8：暫定（11/2まで）・開始在庫907.3・差 +62.0', nw.status === 'provisional' && nw.e === '2026-11-02' && near(nw.S0, 907.3) && near(nw.diffBefore, 62.0), nw);
  check('② 在庫の入力が全く無いサイクルは status=none', R.nantanWkFuture.status === 'none', R.nantanWkFuture.status);

  // ③ 調整
  const wa = R.nantanWkAdj;
  check('③ 調整合計：該当する1件（-100）だけ（削除済み・TRUE文字列・他拠点・期間外は無視）', wa.adjSum === -100 && wa.adjCount === 1, [wa.adjSum, wa.adjCount]);
  check('③ 調整後の差 = 調整前の差 - 調整合計（-824.0 → -724.0）', near(wa.diffBefore, -824.0) && near(wa.diffAfter, -724.0), [wa.diffBefore, wa.diffAfter]);
  check('③ 率（後）＝調整後の差÷収穫量（調整前の率は変わらない）', near(wa.rateAfter, -724.0 / 4504, 1e-6) && near(wa.rateBefore, -824.0 / 4504, 1e-6), [wa.rateBefore, wa.rateAfter]);
  check('③ sumAdjustments：空の一覧・nullは sum=null', R.sumNone.sum === null && R.sumNone.count === 0 && R.sumNull.sum === null, [R.sumNone, R.sumNull]);
  check('③ sumAdjustments：月内の有効分は -100 + 50 = -50', R.sumSome.sum === -50 && R.sumSome.count === 2, R.sumSome);
  const dEnd = R.daily[R.daily.length - 1], dEndAdj = R.dailyAdj[R.dailyAdj.length - 1];
  check('③ 日別：最終日の「あるべき在庫」は1731.3・実際907.3、7日分', R.daily.length === 7 && near(dEnd.expected, 1731.3) && near(dEnd.actual, 907.3), dEnd);
  check('③ 日別：調整を渡すと、調整日以降の「あるべき在庫」が調整分だけ動く（-100）', near(dEndAdj.expected, 1631.3), dEndAdj);

  // ④ 要確認
  const fN = R.flagNantan, fI = R.flagInabe;
  check('④ 南丹10/21の出荷1103.1は要確認（中央値の3倍超）', (fN['2026-10-21'] || []).some(t => t.indexOf('出荷') === 0), fN['2026-10-21']);
  check('④ 今日（11/3）以降は要確認にしない', R.flagKeys.nantanToday === undefined, R.flagKeys.nantanToday);
  const inabeSunZero = Object.keys(fI).filter(d => new Date(d + 'T00:00:00Z').getUTCDay() === 0 && (fI[d] || []).some(t => t === '出荷：0'));
  check('④ いなべの日曜の出荷0は要確認にしない（実データ）', inabeSunZero.length === 0 && R.flagKeys.inabeSun === undefined, inabeSunZero);
  const s = R.flagSyn;
  check('④ 月曜の出荷0＝「出荷：0」', (s['2026-10-12'] || []).indexOf('出荷：0') >= 0, s['2026-10-12']);
  check('④ 火曜の在庫0＝「在庫：0」', (s['2026-10-13'] || []).indexOf('在庫：0') >= 0, s['2026-10-13']);
  check('④ 数値でない値（#REF!）は要確認', (s['2026-10-14'] || []).some(t => t.indexOf('収穫：数値ではない値') === 0), s['2026-10-14']);
  check('④ 中央値の3倍超（出荷5000）は要確認', (s['2026-10-15'] || []).some(t => t.indexOf('出荷：5000（中央値') === 0), s['2026-10-15']);
  check('④ 群馬の日曜の出荷0は除外されない', (s['2026-10-18'] || []).indexOf('出荷：0') >= 0, s['2026-10-18']);
  const si = R.flagSynInabe;
  check('④ いなべの日曜の出荷0は除外・月曜の出荷0は要確認', si['2026-10-18'] === undefined && (si['2026-10-19'] || []).indexOf('出荷：0') >= 0, [si['2026-10-18'], si['2026-10-19']]);

  await browser.close();
  H.finish();
})().catch(e => { console.error(e); process.exit(1); });
