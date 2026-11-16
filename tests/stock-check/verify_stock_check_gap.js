// 在庫の検証画面（dashboard/stock-check.html）の「ギャップの内訳」タブの検証。
// 実際のスプレッドシートには触れず、page.route() でCSVをモックする（今日は 2026-11-03 に固定）。
// 確かめること：
//  ① 係数：1日あたりの水分減少率（3日累計÷3）と過積載率（いなべ・群馬は出荷重量計測表で加重、南丹はパック重量測定表の単純平均）
//  ② 計算：水分減少 ＝ 前日の実際の在庫 × 1日あたりの率 の合計、過積載 ＝ 出荷 × 過積載率、
//     残り ＝ ギャップ − 水分 − 過積載。割合はギャップがマイナスのときだけ（合計100%）
//  ③ 画面：タブの切り替え（差の検証は今まで通り）、拠点比較のカード・グラフ、サイクルごとのグラフ（kg/%）、一覧表
//  ④ 係数を書きかえると、その場で表が変わる。「測定値に戻す」で戻る
//  ⑤ URLの指定（?site=gunma&kind=both&unit=pct&start=2026-09&end=2026-11&tab=gap）で開ける
//  ⑥ スマホ幅で横にはみ出さない／外部への書き込み（POSTなど）が出ない
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/stock-check/verify_stock_check_gap.js
const { chromium } = require('playwright');
const H = require('./helpers');
const { check, near } = H;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await H.fixTodayTo(page, 2026, 10, 3);
  const log = await H.installMocks(page, { missing: ['2026-06', '2026-07'] });
  await page.goto(H.BASE_URL);
  await page.waitForSelector('#tableWrap table.grid');

  // ① 係数
  const coef = await page.evaluate(() => {
    const sc = window.__stockCheck;
    return { i: sc.measuredCoef('いなべ'), g: sc.measuredCoef('群馬'), n: sc.measuredCoef('南丹') };
  });
  check('① いなべ 水分 8.351%÷3 ＝ 2.784%/日', near(coef.i.moist, 0.02784, 0.00002), coef.i.moist);
  check('① 群馬 水分 9.003%÷3 ＝ 3.001%/日', near(coef.g.moist, 0.03001, 0.00002), coef.g.moist);
  check('① 南丹 水分 7.468%÷3 ＝ 2.489%/日', near(coef.n.moist, 0.02489, 0.00002), coef.n.moist);
  check('① いなべ 過積載 ≒ +4.3%（出荷重量計測表 11/12〜11/14、出荷重量で加重。マイナスの規格込み）', near(coef.i.over, 0.04344, 0.0001), coef.i.over);
  check('① 群馬 過積載 ≒ +6.1%（出荷重量計測表 11/1〜11/15、出荷重量で加重）', near(coef.g.over, 0.06129, 0.0001), coef.g.over);
  check('① 南丹 過積載 ≒ +13.2%', near(coef.n.over, 0.1321, 0.0005), coef.n.over);

  // ② 計算（南丹10月で、内訳を手で計算した値と比べる）
  const calc = await page.evaluate(() => {
    const sc = window.__stockCheck, st = sc.getState();
    const days = st.data['南丹'];
    const r = sc.computeCycle('南丹', days, '2026-10-01', '2026-10-31', st.moves, [], {});
    const c = sc.measuredCoef('南丹');
    const g = sc.computeGap(days, r, c);
    // 手計算：前日の在庫（未入力は直前の値）× 率
    const stock = d => { const o = days[d]; const v = o && o.stock && o.stock.v; return v != null && v > 0 ? v : null; };
    let base = stock('2026-09-30'), m = 0;
    for (let i = 1; i <= 31; i++){ const d = '2026-10-' + String(i).padStart(2, '0'); if (base != null) m += base * c.moist; const s = stock(d); if (s != null) base = s; }
    const gr = sc.computeCycle('群馬', st.data['群馬'], '2026-10-26', '2026-11-01', st.moves, [], {});
    const gg = sc.computeGap(st.data['群馬'], gr, sc.measuredCoef('群馬'));
    const none = sc.computeGap(days, { status: 'none' }, c);
    return { r, g, m, over: r.ship * c.over, gg, none };
  });
  check('② 南丹10月 ギャップ ＝ 調整後の差（-2,332.5）', near(calc.g.gap, -2332.5, 0.05), calc.g.gap);
  check('② 水分減少 ＝ 前日在庫×率 の合計（マイナス）', near(calc.g.water, -calc.m, 0.001), [calc.g.water, calc.m]);
  check('② 過積載 ＝ 出荷 × 過積載率（マイナス）', near(calc.g.over, -calc.over, 0.001), [calc.g.over, calc.over]);
  check('② 水分 + 過積載 + 残り ＝ ギャップ', near(calc.g.water + calc.g.over + calc.g.rest, calc.g.gap, 0.001));
  check('② 割合の合計 ＝ 100%', near(calc.g.shareWater + calc.g.shareOver + calc.g.shareRest, 1, 1e-9));
  check('② 群馬10/26〜11/1（ギャップ +15.8）は割合を出さない', calc.gg.shareWater === null && calc.gg.shareRest === null && near(calc.gg.gap, 15.8, 0.05), calc.gg);
  check('② 計算できないサイクルは null', calc.none === null);

  // ③ 画面：タブ
  check('③ 初期表示は「差の検証」タブ', await page.evaluate(() => !document.getElementById('viewDiff').hidden && document.getElementById('viewGap').hidden));
  await page.click('#viewTabs button[data-v="gap"]');
  await page.waitForSelector('#gapTableWrap table.grid');
  check('③ 「ギャップの内訳」に切り替わる', await page.evaluate(() => document.getElementById('viewDiff').hidden && !document.getElementById('viewGap').hidden));
  check('③ URLに tab=gap が付く', (await page.evaluate(() => location.search)).includes('tab=gap'));
  const cards = await page.evaluate(() => Array.from(document.querySelectorAll('#gapCards .gap-card')).map(c => c.textContent));
  check('③ 拠点比較のカードが3拠点分', cards.length === 3 && cards[0].includes('いなべ') && cards[2].includes('南丹'), cards.length);
  check('③ カードに 水分減少・過積載・説明できない残り', cards.every(t => t.includes('水分減少') && t.includes('過積載') && t.includes('説明できない残り')) || cards.some(t => t.includes('計算できる')));
  const siteChart = await page.evaluate(() => { const c = Chart.getChart('gapSiteChart'); return c && { labels: c.data.labels, sets: c.data.datasets.map(d => d.label), axis: c.options.indexAxis, sums: c.data.labels.map((_, i) => c.data.datasets.reduce((s, d) => s + (d.data[i] || 0), 0)) }; });
  check('③ 拠点比較グラフ：横棒・3系列', siteChart && siteChart.axis === 'y' && siteChart.sets.join() === '水分減少,過積載,説明できない残り', siteChart);
  check('③ 拠点比較グラフ：各拠点の合計が100%', siteChart && siteChart.sums.every(s => Math.abs(s - 100) < 0.5), siteChart && siteChart.sums);
  const cyc = await page.evaluate(() => { const c = Chart.getChart('gapCycleChart'); return c && { n: c.data.labels.length, sets: c.data.datasets.map(d => d.label), y: c.options.scales.y.title.text }; });
  check('③ サイクルのグラフ（%）：3系列・軸は割合', cyc && cyc.sets.length === 3 && cyc.y.includes('%'), cyc);
  await page.click('#unitSeg button[data-v="kg"]');
  const cycKg = await page.evaluate(() => { const c = Chart.getChart('gapCycleChart'); return c && { sets: c.data.datasets.map(d => d.label), y: c.options.scales.y.title.text }; });
  check('③ kgに切り替えると、ギャップの点が加わる', cycKg && cycKg.sets.length === 4 && cycKg.sets[3].startsWith('ギャップ') && cycKg.y.includes('kg'), cycKg);
  const tbl = await page.evaluate(() => Array.from(document.querySelectorAll('#gapTableWrap tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
  const oct = tbl.filter(r => r[0].startsWith('2026年10月'))[0];
  check('③ 一覧表：南丹10月のギャップ −2,332.5', oct && oct[2] === '−2,332.5', oct);
  check('③ 一覧表：割合の列（水分 % ・過積載 % ・残り %）', oct && /%$/.test(oct[6]) && /%$/.test(oct[7]) && /%$/.test(oct[8]), oct);

  // ④ 係数の書きかえ
  const before = oct[4];
  await page.fill('#coefGrid input[data-site="南丹"][data-k="over"]', '0');
  await page.dispatchEvent('#coefGrid input[data-site="南丹"][data-k="over"]', 'change');
  const oct2 = await page.evaluate(() => Array.from(document.querySelectorAll('#gapTableWrap tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())).filter(r => r[0].startsWith('2026年10月'))[0]);
  check('④ 過積載率を0にすると、過積載が 0 になる', oct2 && oct2[4] === '0.0' && before !== '0.0', [before, oct2 && oct2[4]]);
  await page.click('#coefReset');
  const oct3 = await page.evaluate(() => Array.from(document.querySelectorAll('#gapTableWrap tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())).filter(r => r[0].startsWith('2026年10月'))[0]);
  check('④ 「測定値に戻す」で元に戻る', oct3 && oct3[4] === before, [before, oct3 && oct3[4]]);

  // 差の検証タブに戻っても、今まで通り表示される
  await page.click('#viewTabs button[data-v="diff"]');
  check('③ 差の検証に戻ると、差のグラフがある', await page.evaluate(() => !!Chart.getChart('mainChart') && document.getElementById('mainChart').clientHeight > 0));

  // ⑤ URLの指定
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await H.fixTodayTo(page2, 2026, 10, 3);
  await H.installMocks(page2, { missing: ['2026-06', '2026-07'] });
  await page2.goto(H.BASE_URL + '?site=gunma&kind=month&unit=kg&start=2026-09&end=2026-10&tab=gap');
  await page2.waitForSelector('#gapTableWrap table.grid');
  const st2 = await page2.evaluate(() => { const s = window.__stockCheck.getState(); return { site: s.site, kind: s.kind, unit: s.unit, start: s.startKey, end: s.endKey, tab: s.tab }; });
  check('⑤ URLで 群馬・月・kg・9〜10月・内訳タブ が開く', st2.site === '群馬' && st2.kind === 'month' && st2.unit === 'kg' && st2.start === '2026-09' && st2.end === '2026-10' && st2.tab === 'gap', st2);
  check('⑤ タイトルに拠点名', (await page2.textContent('#gapCycleTitle')).includes('群馬'));
  await page2.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/gap_pc.png' : 'gap_pc.png', fullPage: true });

  // ⑥ スマホ幅・書き込みなし
  const pageM = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await H.fixTodayTo(pageM, 2026, 10, 3);
  await H.installMocks(pageM, { missing: ['2026-06', '2026-07'] });
  await pageM.goto(H.BASE_URL + '?tab=gap');
  await pageM.waitForSelector('#gapTableWrap table.grid');
  const overflow = await pageM.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('⑥ スマホ幅（390px）で横にはみ出さない', overflow <= 1, overflow);
  await pageM.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/gap_sp.png' : 'gap_sp.png', fullPage: true });
  const posts = (log && log.requests ? log.requests : []).filter(r => r.method && r.method !== 'GET');
  check('⑥ 外部への書き込み（GET以外の通信）が無い', posts.length === 0, posts);

  await browser.close();
  H.finish();
})();
