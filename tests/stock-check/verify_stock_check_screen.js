// 在庫の検証画面（dashboard/stock-check.html）の「画面」の検証。
// 実際のスプレッドシートには触れず、page.route() でCSVを実際のシートの形にモックする（今日は 2026-11-03 に固定）。
// 確かめること：
//  ① 初期表示：南丹・直近3か月（9〜11月）・サイクル「両方」・グラフは%。表の列（調整前の差｜調整合計｜
//     調整後の差｜率（前）｜率（後））と、行の並び（月→その月の週。まだ始まっていない週は出さない）
//  ② 数字：南丹10月・10/26〜11/1（-2,332.5・-824.0・率）。調整が無いので調整合計は「－」、調整後の差・率（後）は調整前と同じ
//  ③ 暫定：最終日の在庫が未入力の南丹11月・11/2〜11/8は、最新の入力日（11/2）までで計算して薄く表示（バッジ「暫定〜11/2」）
//  ④ グラフ：差のグラフ（調整前・調整後の2本、%／kg切替、暫定の棒は薄い色）と、行クリックで出る日別のグラフ
//  ⑤ 切り替え：週／月／両方、拠点（群馬の10/26〜11/1は +15.8）
//  ⑥ 表示期間：開始月・終了月（終了月＜開始月にならない）。登録の無い月のタブが読めないときは警告を出し、
//     読めた分は表示する（開始在庫が無い月は「計算できません」）
//  ⑦ 今日が SOURCES に無い月（12月）のときは注意を出し、11月までを表示する
//  ⑧ 表のセル（td・th）に display:flex を付けていない／スマホ幅で横にはみ出さない
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/stock-check/verify_stock_check_screen.js
const { chromium } = require('playwright');
const H = require('./helpers');
const { check } = H;

const readRows = page => page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap tbody tr')).map(tr => ({
  id: tr.getAttribute('data-id'), cls: tr.className, cells: Array.from(tr.children).map(td => td.textContent.trim()), colspan: tr.children[1] ? tr.children[1].getAttribute('colspan') : null
})));
const byId = (rows, id) => rows.filter(r => r.id === id)[0];
const chartData = (page, id) => page.evaluate(id => { const c = Chart.getChart(id); return c ? { labels: c.data.labels, sets: c.data.datasets.map(d => ({ label: d.label, data: d.data, bg: d.backgroundColor })) } : null; }, id);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await H.fixTodayTo(page, 2026, 10, 3);
  await H.installMocks(page, { missing: ['2026-06', '2026-07'] });
  await page.goto(H.BASE_URL);
  await page.waitForSelector('#tableWrap table.grid');

  // ① 初期表示
  const init = await page.evaluate(() => ({
    site: document.querySelector('#siteSeg button.active').textContent, kind: document.querySelector('#kindSeg button.active').textContent,
    unit: document.querySelector('#unitSeg button.active').textContent,
    start: document.getElementById('startMonth').value, end: document.getElementById('endMonth').value,
    startOpts: Array.from(document.querySelectorAll('#startMonth option')).map(o => o.value),
    heads: Array.from(document.querySelectorAll('#tableWrap thead th')).map(th => th.textContent.trim()),
  }));
  check('① 初期表示：南丹・サイクル「両方」・グラフは%', init.site === '南丹' && init.kind === '両方' && init.unit === '%', init);
  check('① 初期の表示期間は直近3か月（2026年9月〜11月）', init.start === '2026-09' && init.end === '2026-11', [init.start, init.end]);
  check('① 選べる月は 7〜11月だけ', JSON.stringify(init.startOpts) === JSON.stringify(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']), init.startOpts);
  check('① 表の列：調整前の差｜調整合計｜調整後の差｜率（前）｜率（後）が並ぶ', ['調整前の差', '調整合計', '調整後の差', '率（前）', '率（後）'].every((t, i) => init.heads[8 + i] === t), init.heads);
  let rows = await readRows(page);
  check('① 行：月3＋週（9月4・10月4・11月は今日までに始まる11/2の1週）＝12行', rows.length === 12, rows.map(r => r.id));
  check('① 並びは「月→その月の週」。11/9以降の週は出さない', rows[0].id === 'M:2026-09' && rows[1].id === 'W:2026-09-07' && rows[5].id === 'M:2026-10' && rows[10].id === 'M:2026-11' && rows[11].id === 'W:2026-11-02', rows.map(r => r.id));

  // ② 数字
  const oct = byId(rows, 'M:2026-10'), wk = byId(rows, 'W:2026-10-26');
  check('② 南丹10月：開始在庫1,314.7・出荷15,533.8・収穫17,708・移動100/50', oct.cells[1] === '1,314.7' && oct.cells[2] === '15,533.8' && oct.cells[3] === '17,708' && oct.cells[4] === '100 / 50', oct.cells);
  check('② 南丹10月：あるべき3,538.9・実際1,206.4・差−2,332.5・率−13.2%', oct.cells[6] === '3,538.9' && oct.cells[7] === '1,206.4' && oct.cells[8] === '−2,332.5' && oct.cells[11] === '−13.2%', oct.cells);
  check('② 南丹10/26〜11/1：出荷3,910.3・収穫4,504・差−824.0・率−18.3%', wk.cells[2] === '3,910.3' && wk.cells[3] === '4,504' && wk.cells[8] === '−824.0' && wk.cells[11] === '−18.3%', wk.cells);
  const complete = rows.filter(r => r.cls.indexOf('prov') < 0);
  check('② 調整が無いので、確定の行は調整合計「－」・調整後の差＝調整前の差・率（後）＝率（前）', complete.length === 10 && complete.every(r => r.cells[9] === '－' && r.cells[10] === r.cells[8] && r.cells[12] === r.cells[11]), complete.map(r => r.cells.slice(8, 13)));

  // ③ 暫定
  const nov = byId(rows, 'M:2026-11'), wkNow = byId(rows, 'W:2026-11-02');
  check('③ 南丹11月は暫定（薄く表示・バッジ「暫定〜11/2」）。出荷1,070.0・収穫962・差−50.8', nov.cls.indexOf('prov') >= 0 && nov.cells[0].indexOf('暫定〜11/2') >= 0 && nov.cells[2] === '1,070.0' && nov.cells[3] === '962' && nov.cells[8] === '−50.8', nov);
  check('③ 南丹11/2〜11/8も暫定。開始在庫907.3・差+62.0', wkNow.cls.indexOf('prov') >= 0 && wkNow.cells[0].indexOf('暫定〜11/2') >= 0 && wkNow.cells[1] === '907.3' && wkNow.cells[8] === '+62.0', wkNow);
  check('③ 確定の行には「暫定」を付けない', complete.every(r => r.cells[0].indexOf('暫定') < 0));

  // ④ グラフ
  const mc = await chartData(page, 'mainChart');
  check('④ 差のグラフ：「調整前の差」「調整後の差」の2本・12サイクル分', mc && mc.sets.length === 2 && mc.sets[0].label === '調整前の差' && mc.sets[1].label === '調整後の差' && mc.labels.length === 12, mc && mc.labels);
  const iOct = mc.labels.indexOf('【月】2026年10月'), iNov = mc.labels.indexOf('【月】2026年11月（暫定）');
  check('④ %表示：10月は調整前・調整後とも -13.2', mc.sets[0].data[iOct] === -13.2 && mc.sets[1].data[iOct] === -13.2, [mc.sets[0].data[iOct], mc.sets[1].data[iOct]]);
  check('④ 暫定の棒は薄い色（rgba）・確定の棒は濃い色', iNov >= 0 && String(mc.sets[0].bg[iNov]).indexOf('rgba') === 0 && mc.sets[1].bg[iOct] === '#7a4a26', [mc.sets[0].bg[iNov], mc.sets[1].bg[iOct]]);
  await page.click('#unitSeg button[data-v="kg"]');
  const mcKg = await chartData(page, 'mainChart');
  check('④ kg表示に切り替えると、10月は -2332.5', mcKg.sets[0].data[iOct] === -2332.5, mcKg.sets[0].data[iOct]);
  await page.click('#unitSeg button[data-v="pct"]');
  await page.click('#tableWrap tr[data-id="W:2026-10-26"]');
  const dt = await page.textContent('#dailyTitle');
  const dc = await chartData(page, 'dailyChart');
  check('④ 行をクリックすると日別のタイトルが出る（南丹 10/26〜11/1（週））', dt.indexOf('南丹 10/26〜11/1（週）') >= 0, dt);
  check('④ 日別のグラフ：「あるべき在庫」と「実際の在庫」の2本・7日分・最終日 1731.3 / 907.3', dc && dc.sets.length === 2 && dc.labels.length === 7 && dc.sets[0].label === 'あるべき在庫' && dc.sets[0].data[6] === 1731.3 && dc.sets[1].data[6] === 907.3, dc);
  const sel = await page.evaluate(() => document.querySelector('#tableWrap tr.selected').getAttribute('data-id'));
  check('④ 選んだ行が強調される', sel === 'W:2026-10-26', sel);
  const flagsTxt = await page.textContent('#dailyFlags');
  check('④ 日別の下に要確認の日の欄が出る（このサイクルは要確認なし）', flagsTxt.indexOf('要確認の日はありません') >= 0, flagsTxt);
  await page.click('#tableWrap tr[data-id="W:2026-10-19"]');
  const flagsTxt2 = await page.textContent('#dailyFlags');
  check('④ 要確認のある週（南丹10/19〜10/25：10/21の出荷）は、日付と理由が出る', flagsTxt2.indexOf('10/21') >= 0 && flagsTxt2.indexOf('出荷：1103.1') >= 0, flagsTxt2);

  // ⑤ 切り替え
  await page.click('#kindSeg button[data-v="week"]');
  rows = await readRows(page);
  check('⑤ サイクル「週」：週だけ9行（9月4・10月4・11月1）', rows.length === 9 && rows.every(r => r.id[0] === 'W'), rows.map(r => r.id));
  await page.click('#kindSeg button[data-v="month"]');
  rows = await readRows(page);
  check('⑤ サイクル「月」：月だけ3行', rows.length === 3 && rows.every(r => r.id[0] === 'M'), rows.map(r => r.id));
  await page.click('#kindSeg button[data-v="both"]');
  await page.click('#siteSeg button[data-v="群馬"]');
  rows = await readRows(page);
  const gwk = byId(rows, 'W:2026-10-26');
  check('⑤ 拠点を群馬に切り替え：10/26〜11/1 は差+15.8・率+0.4%', gwk.cells[8] === '+15.8' && gwk.cells[11] === '+0.4%', gwk.cells);
  await page.click('#siteSeg button[data-v="いなべ"]');
  rows = await readRows(page);
  check('⑤ いなべ：10/26〜11/1 は差−1,332.4', byId(rows, 'W:2026-10-26').cells[8] === '−1,332.4', byId(rows, 'W:2026-10-26').cells);
  await page.click('#siteSeg button[data-v="南丹"]');

  // ⑥ 表示期間
  await page.selectOption('#startMonth', '2026-10');
  await page.selectOption('#endMonth', '2026-09');
  const vals = await page.evaluate(() => [document.getElementById('startMonth').value, document.getElementById('endMonth').value]);
  check('⑥ 終了月を開始月より前にすると、開始月も合わせて動く（9月〜9月）', vals[0] === '2026-09' && vals[1] === '2026-09', vals);
  await page.waitForFunction(() => document.querySelectorAll('#tableWrap tbody tr').length === 5);
  rows = await readRows(page);
  check('⑥ 9月だけ：月1＋週4＝5行', rows.length === 5 && rows[0].id === 'M:2026-09' && rows[4].id === 'W:2026-09-28', rows.map(r => r.id));
  await page.selectOption('#startMonth', '2026-08');
  await page.waitForSelector('.warn');
  await page.waitForFunction(() => document.querySelectorAll('#tableWrap tbody tr').length > 5);
  const warn = await page.textContent('#msg');
  rows = await readRows(page);
  const aug = byId(rows, 'M:2026-08'), augWk = byId(rows, 'W:2026-08-03');
  check('⑥ 7月のタブが読めないときは警告を出す（拠点3つ＋対見込）', warn.indexOf('読み込めなかったタブ') >= 0 && warn.indexOf('南丹 2026年7月') >= 0 && warn.indexOf('2026年7月対見込') >= 0, warn);
  check('⑥ 開始在庫（7/31）が無い8月は「計算できません」。8/3〜の週は計算できる', aug.cells[1].indexOf('開始在庫（7/31）が未入力のため計算できません') >= 0 && augWk.cells[1] !== undefined && /^[\d,.]+$/.test(augWk.cells[1]), [aug.cells, augWk.cells]);
  check('⑥ 読めた月（9月）は表示を続ける', rows.some(r => r.id === 'M:2026-09' && /^[\d,.]+$/.test(r.cells[1])), rows.map(r => r.id));

  // ⑧ 表のセル・スマホ幅
  const flexCells = await page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap td, #tableWrap th')).filter(c => getComputedStyle(c).display === 'flex').length);
  check('⑧ 表のセル（td・th）に display:flex を付けていない', flexCells === 0, flexCells);
  const pageM = await browser.newPage({ viewport: { width: 390, height: 800 } }); // 最初から狭い画面で開く（描画後に縮めるとグラフの再描画が間に合わない）
  await H.fixTodayTo(pageM, 2026, 10, 3);
  await H.installMocks(pageM, { missing: ['2026-06', '2026-07'] });
  await pageM.goto(H.BASE_URL);
  await pageM.waitForSelector('#tableWrap table.grid');
  const overflow = await pageM.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const tableScroll = await pageM.evaluate(() => { const w = document.getElementById('tableWrap'); return w.scrollWidth > w.clientWidth; });
  check('⑧ スマホ幅（390px）でページ全体が横にはみ出さない', overflow <= 1, overflow);
  check('⑧ スマホ幅では表が表の中で横スクロールできる', tableScroll === true, tableScroll);

  // ⑦ 今日が登録の無い月（12月）
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await H.fixTodayTo(page2, 2026, 11, 5);
  await H.installMocks(page2, { missing: ['2026-06', '2026-07'] });
  await page2.goto(H.BASE_URL);
  await page2.waitForSelector('#tableWrap table.grid');
  const msg2 = await page2.textContent('#msg');
  const rows2 = await readRows(page2);
  const e2 = await page2.evaluate(() => document.getElementById('endMonth').value);
  check('⑦ 12月のタブが SOURCES に無いときは注意を出し、11月までを表示する', msg2.indexOf('2026年12月のタブが SOURCES に登録されていない') >= 0 && e2 === '2026-11' && rows2.some(r => r.id === 'M:2026-11'), [msg2, e2]);
  const w1109 = byId(rows2, 'W:2026-11-09');
  check('⑦ 入力が全く無い週は「データなし」', w1109 && w1109.cells[1].indexOf('データなし') >= 0, w1109);

  await browser.close();
  H.finish();
})().catch(e => { console.error(e); process.exit(1); });
