// 在庫の検証画面（dashboard/stock-check.html）の「サイクル：日」の検証。
// 実際のスプレッドシートには触れず、page.route() でCSVを実際のシートの形にモックする（今日は 2026-11-03 に固定）。
// 確かめること：
//  ① 日の一覧（毎日・見出しは「10/1（木）」）と、その日を含む週（月曜〜日曜）
//  ② サイクルのボタンは「日・週・月・すべて」。「すべて」に日は含めない
//  ③ 「日」に切り替えると、表示期間が直近1か月（終了月だけ）・グラフの単位が kg になる。開始月を変えれば広げられる。
//     「日」から戻すと単位と表示期間が戻る
//  ④ 在庫の入力が無い日（今日 11/3）は出さない。前日の在庫が空欄の日は「計算できません」。収穫0の日の率は「－」
//  ⑤ 日次の差の合計 ＝ 週・月の差（南丹・群馬・いなべの 10/26〜11/1、移動のある 10/19〜10/25、南丹10月）
//  ⑥ 累計の差（開始月の初日から）：10/31 ＝ 10月の差、11/1 − 10/25 ＝ 10/26〜11/1 の差
//  ⑦ 移動のある日に 🚚 と移動量（南丹 10/23 入100・10/24 出50、群馬 10/20 入250・10/23 出100・10/24 入50）
//  ⑧ 調整（手入力）はその日の分だけ入り、調整前・調整後の差と累計に反映される
//  ⑨ 日の行をクリックすると、その日を含む週の日別のグラフが出る
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/stock-check/verify_stock_check_daily.js
const { chromium } = require('playwright');
const H = require('./helpers');
const { check, near } = H;

const readRows = page => page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap tbody tr')).map(tr => ({
  id: tr.getAttribute('data-id'), cls: tr.className, cells: Array.from(tr.children).map(td => td.textContent.trim()), colspan: tr.children[1] ? tr.children[1].getAttribute('colspan') : null
})));
const byId = (rows, id) => rows.filter(r => r.id === id)[0];
const num = s => s === '－' ? null : Number(String(s).replace(/,/g, '').replace('−', '-').replace('+', ''));
const chartData = (page, id) => page.evaluate(id => { const c = Chart.getChart(id); return c ? { labels: c.data.labels, sets: c.data.datasets.map(d => ({ label: d.label, data: d.data, r: d.pointRadius })) } : null; }, id);
const active = (page, id) => page.evaluate(id => document.querySelector('#' + id + ' button.active').textContent, id);
const months = page => page.evaluate(() => [document.getElementById('startMonth').value, document.getElementById('endMonth').value]);

// 日次の差を足したものと、同じ期間を1サイクルとして計算した差を比べる（画面の計算の関数で）
const sumCheck = (page, site, a, b) => page.evaluate(([site, a, b]) => {
  const S = window.__stockCheck, st = S.getState(), days = st.data[site];
  const add = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let sum = 0, n = 0;
  for (let d = a; d <= b; d = add(d, 1)) { const r = S.computeCycle(site, days, d, d, st.moves, st.adjustments, null); sum += r.diffBefore; n++; }
  const w = S.computeCycle(site, days, a, b, st.moves, st.adjustments, null);
  return { sum, n, cycle: w.diffBefore, status: w.status };
}, [site, a, b]);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await H.fixTodayTo(page, 2026, 10, 3);
  await H.installMocks(page, { missing: ['2026-06', '2026-07'] });
  await page.goto(H.BASE_URL);
  await page.waitForSelector('#tableWrap table.grid');

  // ① 日の一覧・週
  const dc = await page.evaluate(() => window.__stockCheck.buildDayCycles('2026-10', '2026-11'));
  check('① 10〜11月の日：61日（10/1〜11/30）', dc.length === 61 && dc[0].id === 'D:2026-10-01' && dc[60].id === 'D:2026-11-30' && dc.every(c => c.kind === 'day' && c.a === c.b), [dc.length, dc[0], dc[60]]);
  check('① 見出しは「10/1（木）」「11/1（日）」', dc[0].label === '10/1（木）' && dc[31].label === '11/1（日）', [dc[0].label, dc[31].label]);
  const wks = await page.evaluate(() => ['2026-10-26', '2026-10-29', '2026-11-01'].map(d => window.__stockCheck.weekOf(d)));
  check('① その日を含む週：10/26（月）・10/29（木）・11/1（日）→ どれも 10/26〜11/1', wks.every(w => w.a === '2026-10-26' && w.b === '2026-11-01'), wks);

  // ② ボタン・「すべて」
  const btns = await page.evaluate(() => Array.from(document.querySelectorAll('#kindSeg button')).map(b => b.textContent));
  check('② サイクルのボタンは「日・週・月・すべて」', JSON.stringify(btns) === JSON.stringify(['日', '週', '月', 'すべて']), btns);
  let rows = await readRows(page);
  check('② 初期表示「すべて」は月と週だけ（日の行は無い）・12行', (await active(page, 'kindSeg')) === 'すべて' && rows.length === 12 && rows.every(r => r.id[0] !== 'D'), rows.map(r => r.id));

  // ③ 「日」への切り替え
  await page.click('#kindSeg button[data-v="day"]');
  await page.waitForFunction(() => document.querySelector('#tableWrap tbody tr') && document.querySelector('#tableWrap tbody tr').getAttribute('data-id').indexOf('D:') === 0);
  rows = await readRows(page);
  check('③ 「日」：表示期間は直近1か月（11月〜11月）・単位は kg', JSON.stringify(await months(page)) === '["2026-11","2026-11"]' && (await active(page, 'unitSeg')) === 'kg', [await months(page), await active(page, 'unitSeg')]);
  check('④ 11月は 11/1・11/2 の2行（今日11/3は在庫の入力が無いので出さない）', rows.length === 2 && rows[0].id === 'D:2026-11-01' && rows[1].id === 'D:2026-11-02', rows.map(r => r.id));
  const heads = await page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap thead th')).map(th => th.textContent.trim()));
  check('③ 日の表の列：…率（後）｜累計の差（前）｜累計の差（後）｜要確認', heads.length === 16 && heads[13] === '累計の差（前）' && heads[14] === '累計の差（後）' && heads[15] === '要確認', heads);
  await page.click('#kindSeg button[data-v="week"]');
  await page.waitForFunction(() => document.getElementById('startMonth').value === '2026-09' && document.querySelectorAll('#tableWrap tbody tr').length === 9);
  check('③ 「週」に戻すと、表示期間（9〜11月）と単位（%）が戻る', JSON.stringify(await months(page)) === '["2026-09","2026-11"]' && (await active(page, 'unitSeg')) === '%', [await months(page), await active(page, 'unitSeg')]);
  await page.click('#kindSeg button[data-v="day"]');
  await page.waitForFunction(() => document.querySelectorAll('#tableWrap tbody tr').length === 2);
  await page.selectOption('#startMonth', '2026-10');
  await page.waitForFunction(() => document.querySelectorAll('#tableWrap tbody tr').length === 33);
  rows = await readRows(page);
  check('③ 開始月を10月にすると広げられる：10/1〜11/2 の33行・すべて日の行', rows.length === 33 && rows.every(r => r.id.indexOf('D:') === 0) && rows[0].id === 'D:2026-10-01', rows.length);

  // ⑤ 日次の差の合計 ＝ 週・月の差
  const cases = [
    ['南丹', '2026-10-26', '2026-11-01', -824.0], ['群馬', '2026-10-26', '2026-11-01', 15.8], ['いなべ', '2026-10-26', '2026-11-01', -1332.4],
    ['南丹', '2026-10-19', '2026-10-25', null], ['群馬', '2026-10-19', '2026-10-25', null], ['南丹', '2026-10-01', '2026-10-31', -2332.5],
  ];
  for (const [site, a, b, exp] of cases) {
    const s = await sumCheck(page, site, a, b);
    check('⑤ ' + site + ' ' + a.slice(5) + '〜' + b.slice(5) + '：日次の差の合計（' + s.n + '日）＝ 期間の差' + (exp != null ? '（' + exp + '）' : ''),
      s.status === 'complete' && Math.abs(s.sum - s.cycle) < 1e-6 && (exp == null || near(s.cycle, exp)), s);
  }
  const wkRows = rows.filter(r => r.id >= 'D:2026-10-26' && r.id <= 'D:2026-11-01');
  const wkSum = wkRows.reduce((t, r) => t + num(r.cells[8]), 0);
  check('⑤ 画面の表でも、南丹 10/26〜11/1 の7行の「調整前の差」の合計が −824.0（表示の丸めの誤差 ±0.4 以内）', wkRows.length === 7 && near(wkSum, -824.0, 0.4), [wkRows.length, wkSum]);
  const d1029 = byId(rows, 'D:2026-10-29');
  check('⑤ 日の行：開始在庫＝前日の在庫、実際の在庫＝その日の在庫（10/29：' + d1029.cells[1] + ' → ' + d1029.cells[7] + '）', num(d1029.cells[1]) === H.FIX.days['南丹']['2026-10-28'][2] && num(d1029.cells[7]) === H.FIX.days['南丹']['2026-10-29'][2], d1029.cells);

  // ⑥ 累計の差
  const c1031 = byId(rows, 'D:2026-10-31'), c1025 = byId(rows, 'D:2026-10-25'), c1101 = byId(rows, 'D:2026-11-01');
  check('⑥ 10/31 の累計の差（前・後）は10月の差 −2,332.5', c1031.cells[13] === '−2,332.5' && c1031.cells[14] === '−2,332.5', c1031.cells);
  check('⑥ 11/1 の累計 − 10/25 の累計 ＝ 10/26〜11/1 の差 −824.0', near(num(c1101.cells[13]) - num(c1025.cells[13]), -824.0, 0.1), [c1101.cells[13], c1025.cells[13]]);
  const d1001 = byId(rows, 'D:2026-10-01');
  check('⑥ 初日（10/1）の累計は、その日の差と同じ', d1001.cells[13] === d1001.cells[8], d1001.cells);

  // ⑦ 移動の印
  const mv = rows.filter(r => r.cells[0].indexOf('🚚') >= 0).map(r => r.id + ' ' + r.cells[0]);
  check('⑦ 南丹10月で 🚚 が付くのは 10/23（入100）と 10/24（出50）だけ', mv.length === 2 && byId(rows, 'D:2026-10-23').cells[0].indexOf('🚚 入100') >= 0 && byId(rows, 'D:2026-10-24').cells[0].indexOf('🚚 出50') >= 0, mv);
  check('⑦ 移動の列：10/23 は「100 / 0」、10/24 は「0 / 50」', byId(rows, 'D:2026-10-23').cells[4] === '100 / 0' && byId(rows, 'D:2026-10-24').cells[4] === '0 / 50', [byId(rows, 'D:2026-10-23').cells[4], byId(rows, 'D:2026-10-24').cells[4]]);
  const tip = await page.evaluate(() => document.querySelector('#tableWrap tr[data-id="D:2026-10-23"] .badge.mv').getAttribute('title'));
  check('⑦ 🚚 にマウスを乗せると内訳（群馬→南丹 L 50.0kg ／ M 50.0kg）', tip.indexOf('群馬→南丹 L 50.0kg') >= 0 && tip.indexOf('群馬→南丹 M 50.0kg') >= 0, tip);
  await page.click('#siteSeg button[data-v="群馬"]');
  let g = await readRows(page);
  check('⑦ 群馬：10/20 入250・10/23 出100・10/24 入50', byId(g, 'D:2026-10-20').cells[0].indexOf('🚚 入250') >= 0 && byId(g, 'D:2026-10-23').cells[0].indexOf('🚚 出100') >= 0 && byId(g, 'D:2026-10-24').cells[0].indexOf('🚚 入50') >= 0 && g.filter(r => r.cells[0].indexOf('🚚') >= 0).length === 3, g.filter(r => r.cells[0].indexOf('🚚') >= 0).map(r => r.cells[0]));
  check('⑦ 拠点を切り替えても「日」・10月〜11月のまま', (await active(page, 'kindSeg')) === '日' && JSON.stringify(await months(page)) === '["2026-10","2026-11"]', await months(page));
  await page.click('#siteSeg button[data-v="南丹"]');

  // ⑧ 調整
  await page.evaluate(() => window.__stockCheck.setAdjustments([
    { id: 't1', date: '2026-10-27', site: '南丹', kg: 10, category: 'その他', reason: 'テスト', deleted: false },
    { id: 't2', date: '2026-10-27', site: '群馬', kg: 99, category: 'その他', reason: '他拠点', deleted: false },
  ]));
  rows = await readRows(page);
  const a27 = byId(rows, 'D:2026-10-27'), a26 = byId(rows, 'D:2026-10-26'), a31 = byId(rows, 'D:2026-10-31');
  check('⑧ 10/27 の調整合計 +10.0・調整後の差 ＝ 調整前の差 − 10', a27.cells[9] === '+10.0' && near(num(a27.cells[10]), num(a27.cells[8]) - 10), a27.cells);
  check('⑧ 調整の無い日（10/26）は調整合計「－」・調整後＝調整前', a26.cells[9] === '－' && a26.cells[10] === a26.cells[8], a26.cells);
  check('⑧ 累計（10/31）：調整前 −2,332.5・調整後 −2,342.5', a31.cells[13] === '−2,332.5' && a31.cells[14] === '−2,342.5', a31.cells);
  await page.evaluate(() => window.__stockCheck.setAdjustments([]));

  // 差のグラフ
  const mc = await chartData(page, 'mainChart');
  const i29 = mc.labels.indexOf('10/29（木）');
  check('差のグラフ：日ごと33本・kg（10/29 の棒が表の調整前の差と同じ）', mc.labels.length === 33 && i29 >= 0 && near(mc.sets[0].data[i29], num(d1029.cells[8])), [mc.labels.length, mc.sets[0].data[i29], d1029.cells[8]]);

  // ⑨ 日の行をクリック → その日を含む週
  await page.click('#tableWrap tr[data-id="D:2026-10-29"]');
  const title = await page.textContent('#dailyTitle');
  const dch = await chartData(page, 'dailyChart');
  check('⑨ 10/29 をクリック：タイトル「南丹 10/29（木）を含む週 10/26〜11/1」', title.indexOf('南丹 10/29（木）を含む週 10/26〜11/1') >= 0, title);
  check('⑨ 日別のグラフは週の7日分（最終日 1731.3 / 907.3。週の行と同じ）', dch.labels.length === 7 && dch.labels[0] === '10/26（月）' && dch.sets[0].data[6] === 1731.3 && dch.sets[1].data[6] === 907.3, dch);
  check('⑨ クリックした日（10/29）の点を大きくする', dch.sets[1].r[3] > dch.sets[1].r[0], dch.sets[1].r);
  const sel = await page.evaluate(() => document.querySelector('#tableWrap tr.selected').getAttribute('data-id'));
  check('⑨ 選んだ日の行が強調される', sel === 'D:2026-10-29', sel);
  await page.click('#tableWrap tr[data-id="D:2026-11-02"]');
  const dch2 = await chartData(page, 'dailyChart');
  check('⑨ 11/2 をクリック：週 11/2〜11/8 のうち在庫のある 11/2 まで（1日分）', dch2.labels.length === 1 && (await page.textContent('#dailyTitle')).indexOf('11/2〜11/8') >= 0, dch2.labels);

  const flexCells = await page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap td, #tableWrap th')).filter(c => getComputedStyle(c).display === 'flex').length);
  check('表のセル（td・th）に display:flex を付けていない', flexCells === 0, flexCells);

  // ④ 前日の在庫が空欄の日・収穫0の日（南丹 10/14 収穫0、10/15 在庫空欄）
  const F = H.FIX.days['南丹'];
  const ov = { '2026-10-14': F['2026-10-14'].slice(), '2026-10-15': F['2026-10-15'].slice() };
  ov['2026-10-14'][1] = 0; ov['2026-10-15'][2] = null;
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await H.fixTodayTo(page2, 2026, 10, 3);
  await H.installMocks(page2, { missing: ['2026-06', '2026-07'], overrides: { '南丹': ov } });
  await page2.goto(H.BASE_URL);
  await page2.waitForSelector('#tableWrap table.grid');
  await page2.click('#kindSeg button[data-v="day"]');
  await page2.waitForFunction(() => document.querySelectorAll('#tableWrap tbody tr').length === 2);
  await page2.selectOption('#startMonth', '2026-10');
  await page2.waitForFunction(() => document.querySelectorAll('#tableWrap tbody tr').length > 2);
  const r2 = await readRows(page2);
  check('④ 在庫が空欄の日（10/15）は出さない（10月〜11/2 で32行）', !byId(r2, 'D:2026-10-15') && r2.length === 32, r2.length);
  const n16 = byId(r2, 'D:2026-10-16');
  check('④ 前日の在庫が空欄の日（10/16）は「開始在庫（10/15）が未入力のため計算できません」（列をまたいで15列）', n16 && n16.cells[1].indexOf('開始在庫（10/15）が未入力のため計算できません') >= 0 && n16.colspan === '15', n16);
  const z14 = byId(r2, 'D:2026-10-14');
  check('④ 収穫0の日（10/14）の率は「－」', z14.cells[3] === '0' && z14.cells[11] === '－' && z14.cells[12] === '－', z14.cells);
  check('④ 空欄の日をまたいでも、累計の差（10/31）は計算できる', /^[−+]?[\d,.]+$/.test(byId(r2, 'D:2026-10-31').cells[13]), byId(r2, 'D:2026-10-31').cells[13]);

  await browser.close();
  H.finish();
})().catch(e => { console.error(e); process.exit(1); });
