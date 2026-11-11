// 在庫の検証画面（dashboard/stock-check.html）の「サイクル：日」の検証。
// 実際のスプレッドシートには触れず、page.route() でCSVを実際のシートの形にモックする（今日は 2026-11-03 に固定）。
// 確かめること：
//  ① 日の一覧（毎日・見出しは「10/1（木）」）と、その日を含む週（月曜〜日曜）
//  ② サイクルのボタンは「日・週・月・すべて」。「すべて」に日は含めない
//  ③ 「日」にすると、開始月・終了月の欄が開始日・終了日（カレンダー）と「7日・14日・30日」に替わる。
//     初期表示は 終了日＝在庫の入力がある最新の日（11/2）、開始日＝そこから30日間（10/4）、単位は kg。
//     「7日」「14日」「30日」は終了日から遡って開始日を入れる。選べる範囲はデータがある月（7月〜今日）の中だけ。
//     開始日＞終了日にはならない。「週」に戻すと開始月・終了月の欄・表示期間（9〜11月）・単位（%）が戻る
//  ④ 在庫の入力が無い日（今日 11/3）は出さない。前日の在庫が空欄の日は「計算できません」。収穫0の日の率は「－」
//  ⑤ 日次の差の合計 ＝ 週・月の差（南丹・群馬・いなべの 10/26〜11/1、移動のある 10/19〜10/25、南丹10月）
//  ⑥ 累計の差は開始日から：10/1〜なら 10/31 ＝ 10月の差、10/26〜（7日）なら 11/1 ＝ 10/26〜11/1 の差
//  ⑦ 移動のある日は「移動 入/出」の列に 🚚 と移動量（南丹 10/23・10/24、群馬 10/20・10/23・10/24）。期間の列の幅は変わらない
//  ⑧ 調整（手入力）はその日の分だけ入り、調整前・調整後の差と累計に反映される
//  ⑨ 日の行をクリックすると、その日を含む週の日別のグラフが出る
//  ⑩ 横スクロール：期間の列（見出しも）だけが左に固定され、背景が塗られて後ろの列と重ならない（PC・スマホ幅）
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
const active = (page, id) => page.evaluate(id => { const b = document.querySelector('#' + id + ' button.active'); return b ? b.textContent : null; }, id);
const months = page => page.evaluate(() => [document.getElementById('startMonth').value, document.getElementById('endMonth').value]);
const range = page => page.evaluate(() => { const f = document.getElementById('dayFrom'), t = document.getElementById('dayTo'); return f && t ? [f.value, t.value] : null; });
const firstLast = page => page.evaluate(() => { const r = document.querySelectorAll('#tableWrap tbody tr'); return r.length ? [r[0].getAttribute('data-id'), r[r.length - 1].getAttribute('data-id'), r.length] : null; });
// 開始日・終了日の欄に入力する（カレンダーで選んだときと同じく change が出る）
async function setDate(page, id, v) {
  await page.fill('#' + id, v);
  await page.evaluate(id => document.getElementById(id).dispatchEvent(new Event('change')), id);
}
const waitRows = (page, first, last) => page.waitForFunction(([a, b]) => {
  const r = document.querySelectorAll('#tableWrap tbody tr');
  return r.length && r[0].getAttribute('data-id') === a && r[r.length - 1].getAttribute('data-id') === b;
}, [first, last]);

// 日次の差を足したものと、同じ期間を1サイクルとして計算した差を比べる（画面の計算の関数で）
const sumCheck = (page, site, a, b) => page.evaluate(([site, a, b]) => {
  const S = window.__stockCheck, st = S.getState(), days = st.data[site];
  const add = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let sum = 0, n = 0;
  for (let d = a; d <= b; d = add(d, 1)) { const r = S.computeCycle(site, days, d, d, st.moves, st.adjustments, null); sum += r.diffBefore; n++; }
  const w = S.computeCycle(site, days, a, b, st.moves, st.adjustments, null);
  return { sum, n, cycle: w.diffBefore, status: w.status };
}, [site, a, b]);

// 横スクロールしたときの期間の列の見え方
const stickyState = page => page.evaluate(() => {
  const wrap = document.getElementById('tableWrap');
  // 測る行を画面の中央に出す（ページ上部の固定部分の裏や画面の外では、見えている要素を取れないため）
  const dayRows = document.querySelectorAll('#tableWrap tbody tr.day');
  const tr = dayRows[Math.min(10, dayRows.length - 1)], th = document.querySelectorAll('#tableWrap thead th');
  tr.scrollIntoView({ block: 'center' });
  const td = tr.children;
  const pos = Array.from(td).map(c => getComputedStyle(c).position);
  const thPosLeft = Array.from(th).map(c => getComputedStyle(c).left);
  const rect = c => c.getBoundingClientRect();
  const r0 = rect(td[0]), r1 = rect(td[1]);
  // 期間の列の中の点（右端の少し手前）に見えているのが、期間のセル自身か
  const hit = document.elementFromPoint(r0.right - 3, r0.top + r0.height / 2);
  th[0].scrollIntoView({ block: 'center' }); // 見出しの行も画面の中央に出して確かめる
  const hitTh = document.elementFromPoint(rect(th[0]).right - 3, rect(th[0]).top + rect(th[0]).height / 2);
  return {
    scroll: wrap.scrollLeft, left0: Math.round(r0.left), left1: Math.round(r1.left), wrapLeft: Math.round(rect(wrap).left),
    stickyCols: pos.map((p, i) => p === 'sticky' ? i : -1).filter(i => i >= 0),
    thStickyLeft: thPosLeft.map((l, i) => l === '0px' ? i : -1).filter(i => i >= 0),
    bg: getComputedStyle(td[0]).backgroundColor, bgTh: getComputedStyle(th[0]).backgroundColor,
    hitSelf: !!hit && (hit === td[0] || td[0].contains(hit)), hitThSelf: !!hitTh && (hitTh === th[0] || th[0].contains(hitTh)),
    widths: Array.from(document.querySelectorAll('#tableWrap tbody tr.day')).map(r => Math.round(r.children[0].getBoundingClientRect().width)),
  };
});

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
  const dr = await page.evaluate(() => window.__stockCheck.buildDayCycles('2026-10-04', '2026-11-02').map(c => c.a));
  check('① 日付を渡すと開始日〜終了日：10/4〜11/2 の30日', dr.length === 30 && dr[0] === '2026-10-04' && dr[29] === '2026-11-02', [dr.length, dr[0], dr[29]]);
  const wks = await page.evaluate(() => ['2026-10-26', '2026-10-29', '2026-11-01'].map(d => window.__stockCheck.weekOf(d)));
  check('① その日を含む週：10/26（月）・10/29（木）・11/1（日）→ どれも 10/26〜11/1', wks.every(w => w.a === '2026-10-26' && w.b === '2026-11-01'), wks);
  const bounds = await page.evaluate(() => window.__stockCheck.dayBounds());
  check('③ 選べる日の範囲：データがある月の初日（7/1）〜今日（11/3）', bounds.min === '2026-07-01' && bounds.max === '2026-11-03', bounds);

  // ② ボタン・「すべて」
  const btns = await page.evaluate(() => Array.from(document.querySelectorAll('#kindSeg button')).map(b => b.textContent));
  check('② サイクルのボタンは「日・週・月・すべて」', JSON.stringify(btns) === JSON.stringify(['日', '週', '月', 'すべて']), btns);
  let rows = await readRows(page);
  check('② 初期表示「すべて」は月と週だけ（日の行は無い）・12行', (await active(page, 'kindSeg')) === 'すべて' && rows.length === 12 && rows.every(r => r.id[0] !== 'D'), rows.map(r => r.id));
  check('③ 「すべて」のときは開始日・終了日の欄が無い', (await range(page)) === null, await range(page));

  // ③ 「日」への切り替え：開始日・終了日
  await page.click('#kindSeg button[data-v="day"]');
  await waitRows(page, 'D:2026-10-04', 'D:2026-11-02');
  const nav = await page.evaluate(() => ({
    labels: Array.from(document.querySelectorAll('.day-nav .pair')).filter(p => p.offsetParent !== null).map(p => p.querySelector('.label').textContent.trim()),
    monthHidden: ['startMonthPair', 'endMonthPair'].map(id => getComputedStyle(document.getElementById(id)).display === 'none'),
    types: ['dayFrom', 'dayTo'].map(id => document.getElementById(id).type),
    min: document.getElementById('dayFrom').min, max: document.getElementById('dayTo').max,
    spans: Array.from(document.querySelectorAll('#spanSeg button')).map(b => b.textContent),
  }));
  check('③ 「日」：枠は 開始日・終了日・期間・サイクル・グラフの単位（開始月・終了月の欄は隠れる）', JSON.stringify(nav.labels) === JSON.stringify(['開始日', '終了日', '期間', 'サイクル', 'グラフの単位']) && nav.monthHidden.every(Boolean), nav);
  check('③ 開始日・終了日はカレンダーの欄（type=date）・選べる範囲は 7/1〜11/3', nav.types.every(t => t === 'date') && nav.min === '2026-07-01' && nav.max === '2026-11-03', nav);
  check('③ 期間のボタンは「7日・14日・30日」', JSON.stringify(nav.spans) === JSON.stringify(['7日', '14日', '30日']), nav.spans);
  check('③ 初期表示：終了日＝在庫の入力がある最新の日 11/2、開始日＝30日間の 10/4（「30日」が選ばれた状態）・単位は kg', JSON.stringify(await range(page)) === '["2026-10-04","2026-11-02"]' && (await active(page, 'spanSeg')) === '30日' && (await active(page, 'unitSeg')) === 'kg', [await range(page), await active(page, 'spanSeg')]);
  rows = await readRows(page);
  check('④ 10/4〜11/2 の30行（今日11/3は在庫の入力が無いので出さない）', rows.length === 30 && rows.every(r => r.id.indexOf('D:') === 0), rows.length);
  const heads = await page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap thead th')).map(th => th.textContent.trim()));
  check('③ 日の表の列：…率（後）｜累計の差（前）｜累計の差（後）｜要確認', heads.length === 16 && heads[13] === '累計の差（前）' && heads[14] === '累計の差（後）' && heads[15] === '要確認', heads);

  await page.click('#spanSeg button[data-v="7"]');
  await waitRows(page, 'D:2026-10-27', 'D:2026-11-02');
  check('③ 「7日」：終了日 11/2 から遡って開始日 10/27（7行）', JSON.stringify(await range(page)) === '["2026-10-27","2026-11-02"]' && (await firstLast(page))[2] === 7 && (await active(page, 'spanSeg')) === '7日', await range(page));
  await page.click('#spanSeg button[data-v="14"]');
  await waitRows(page, 'D:2026-10-20', 'D:2026-11-02');
  check('③ 「14日」：開始日 10/20（14行）', JSON.stringify(await range(page)) === '["2026-10-20","2026-11-02"]' && (await firstLast(page))[2] === 14, await range(page));
  await setDate(page, 'dayTo', '2026-11-01');
  await waitRows(page, 'D:2026-10-20', 'D:2026-11-01');
  await page.click('#spanSeg button[data-v="7"]');
  await waitRows(page, 'D:2026-10-26', 'D:2026-11-01');
  rows = await readRows(page);
  check('⑥ 10/26〜11/1（終了日を11/1にして「7日」）：累計の差は開始日から。11/1 の累計 ＝ 週の差 −824.0', byId(rows, 'D:2026-11-01').cells[13] === '−824.0' && byId(rows, 'D:2026-10-26').cells[13] === byId(rows, 'D:2026-10-26').cells[8], [byId(rows, 'D:2026-11-01').cells[13], byId(rows, 'D:2026-10-26').cells]);
  await setDate(page, 'dayFrom', '2026-06-15');
  await page.waitForFunction(() => document.getElementById('dayFrom').value === '2026-07-01');
  check('③ 範囲より前（6/15）を入れると、選べる最初の日 7/1 になる', (await range(page))[0] === '2026-07-01', await range(page));
  await setDate(page, 'dayFrom', '2026-10-05');
  await waitRows(page, 'D:2026-10-05', 'D:2026-11-01');
  await setDate(page, 'dayTo', '2026-10-01');
  await page.waitForFunction(() => document.getElementById('dayFrom').value === '2026-10-01');
  check('③ 終了日を開始日より前（10/1）にすると、開始日も 10/1 に合わせる', JSON.stringify(await range(page)) === '["2026-10-01","2026-10-01"]', await range(page));
  await page.click('#kindSeg button[data-v="week"]');
  await page.waitForFunction(() => document.getElementById('startMonth').value === '2026-09' && document.querySelectorAll('#tableWrap tbody tr').length === 9);
  const back = await page.evaluate(() => ({ shown: ['startMonthPair', 'endMonthPair'].map(id => getComputedStyle(document.getElementById(id)).display !== 'none'), dayFrom: !!document.getElementById('dayFrom') }));
  check('③ 「週」に戻すと、開始月・終了月の欄（9〜11月）と単位（%）が戻り、開始日・終了日の欄は消える', back.shown.every(Boolean) && !back.dayFrom && JSON.stringify(await months(page)) === '["2026-09","2026-11"]' && (await active(page, 'unitSeg')) === '%', [back, await months(page)]);

  // 10/1〜11/2 で以降を確かめる
  await page.click('#kindSeg button[data-v="day"]');
  await waitRows(page, 'D:2026-10-04', 'D:2026-11-02');
  check('③ もう一度「日」にすると、また初期表示（10/4〜11/2）', JSON.stringify(await range(page)) === '["2026-10-04","2026-11-02"]', await range(page));
  await setDate(page, 'dayFrom', '2026-10-01');
  await waitRows(page, 'D:2026-10-01', 'D:2026-11-02');
  rows = await readRows(page);
  check('③ 開始日を 10/1 にすると 10/1〜11/2 の33行', rows.length === 33, rows.length);

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

  // ⑥ 累計の差（開始日 10/1 から）
  const c1031 = byId(rows, 'D:2026-10-31'), c1025 = byId(rows, 'D:2026-10-25'), c1101 = byId(rows, 'D:2026-11-01');
  check('⑥ 開始日 10/1：10/31 の累計の差（前・後）は10月の差 −2,332.5', c1031.cells[13] === '−2,332.5' && c1031.cells[14] === '−2,332.5', c1031.cells);
  check('⑥ 11/1 の累計 − 10/25 の累計 ＝ 10/26〜11/1 の差 −824.0', near(num(c1101.cells[13]) - num(c1025.cells[13]), -824.0, 0.1), [c1101.cells[13], c1025.cells[13]]);
  const d1001 = byId(rows, 'D:2026-10-01');
  check('⑥ 開始日（10/1）の累計は、その日の差と同じ', d1001.cells[13] === d1001.cells[8], d1001.cells);

  // ⑦ 移動の印（「移動 入/出」の列）
  const mv = rows.filter(r => r.cells[4].indexOf('🚚') >= 0).map(r => r.id + ' ' + r.cells[4]);
  check('⑦ 南丹で 🚚 が付くのは 10/23（🚚100 / 0）と 10/24（🚚0 / 50）だけ', mv.length === 2 && byId(rows, 'D:2026-10-23').cells[4] === '🚚100 / 0' && byId(rows, 'D:2026-10-24').cells[4] === '🚚0 / 50', mv);
  check('⑦ 移動の無い日は「0 / 0」・期間の列に 🚚 は付けない', byId(rows, 'D:2026-10-22').cells[4] === '0 / 0' && rows.every(r => r.cells[0].indexOf('🚚') < 0), byId(rows, 'D:2026-10-22').cells);
  const tip = await page.evaluate(() => document.querySelector('#tableWrap tr[data-id="D:2026-10-23"] .mv').getAttribute('title'));
  check('⑦ 🚚 にマウスを乗せると内訳（群馬→南丹 L 50.0kg ／ M 50.0kg）', tip.indexOf('群馬→南丹 L 50.0kg') >= 0 && tip.indexOf('群馬→南丹 M 50.0kg') >= 0, tip);
  const st0 = await stickyState(page);
  check('⑦ 🚚 の付いた日も、期間の列の幅はすべての行で同じ', st0.widths.length === 33 && st0.widths.every(w => w === st0.widths[0]), st0.widths);
  await page.click('#siteSeg button[data-v="群馬"]');
  const g = await readRows(page);
  const gm = g.filter(r => r.cells[4].indexOf('🚚') >= 0).map(r => r.id);
  check('⑦ 群馬：10/20（🚚250 / 0）・10/23（🚚0 / 100）・10/24（🚚50 / 0）', JSON.stringify(gm) === JSON.stringify(['D:2026-10-20', 'D:2026-10-23', 'D:2026-10-24']) && byId(g, 'D:2026-10-20').cells[4] === '🚚250 / 0' && byId(g, 'D:2026-10-23').cells[4] === '🚚0 / 100' && byId(g, 'D:2026-10-24').cells[4] === '🚚50 / 0', gm);
  check('⑦ 拠点を切り替えても「日」・10/1〜11/2 のまま', (await active(page, 'kindSeg')) === '日' && JSON.stringify(await range(page)) === '["2026-10-01","2026-11-02"]', await range(page));
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

  // ⑩ 横スクロール（PC）
  const flexCells = await page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap td, #tableWrap th')).filter(c => getComputedStyle(c).display === 'flex').length);
  check('⑩ 表のセル（td・th）に display:flex を付けていない', flexCells === 0, flexCells);
  await page.evaluate(() => { document.getElementById('tableWrap').scrollLeft = 200; });
  const st1 = await stickyState(page);
  check('⑩ PC：左に固定されるのは期間の列だけ（本文・見出しとも）', JSON.stringify(st1.stickyCols) === '[0]' && JSON.stringify(st1.thStickyLeft) === '[0]', st1);
  check('⑩ PC：横にスクロールしても期間の列は左端のまま、ほかの列は動く', st1.scroll > 0 && st1.left0 === st1.wrapLeft && st1.left1 === st0.left1 - st1.scroll, [st0.left1, st1]);
  check('⑩ PC：期間の列は背景が塗られ（透明でない）、その位置には期間のセルが見える（後ろの列が重ならない）', st1.bg !== 'rgba(0, 0, 0, 0)' && st1.bgTh !== 'rgba(0, 0, 0, 0)' && st1.hitSelf && st1.hitThSelf, st1);

  // ⑩ スマホ幅
  for (const [w, h] of [[390, 800], [320, 568]]) {
    const pm = await browser.newPage({ viewport: { width: w, height: h } });
    await H.fixTodayTo(pm, 2026, 10, 3);
    await H.installMocks(pm, { missing: ['2026-06', '2026-07'] });
    await pm.goto(H.BASE_URL);
    await pm.waitForSelector('#tableWrap table.grid');
    await pm.click('#kindSeg button[data-v="day"]');
    await waitRows(pm, 'D:2026-10-04', 'D:2026-11-02');
    const a = await stickyState(pm);
    await pm.evaluate(() => { document.getElementById('tableWrap').scrollLeft = 250; });
    const b = await stickyState(pm);
    const lay = await pm.evaluate(() => ({
      over: document.documentElement.scrollWidth - window.innerWidth,
      headRatio: document.querySelector('.sticky-head').getBoundingClientRect().height / window.innerHeight,
      pairs: Array.from(document.querySelectorAll('.day-nav .pair')).filter(p => p.offsetParent !== null).map(p => {
        const l = p.querySelector('.label').getBoundingClientRect(), c = p.children[1].getBoundingClientRect();
        return { sameRow: Math.abs((l.top + l.bottom) / 2 - (c.top + c.bottom) / 2) < 6, inView: c.right <= window.innerWidth + 0.5 };
      }),
    }));
    check('⑩ ' + w + 'px：期間の列だけが固定され、横スクロールしても左端のまま・背景あり・後ろの列が重ならない', JSON.stringify(b.stickyCols) === '[0]' && b.scroll > 0 && b.left0 === b.wrapLeft && b.left1 === a.left1 - b.scroll && b.hitSelf && b.hitThSelf && b.bg !== 'rgba(0, 0, 0, 0)', [a, b]);
    check('⑩ ' + w + 'px：ページは横にはみ出さず、開始日・終了日などのラベルと欄が同じ行・画面内、固定部分は画面の高さの30%以内（' + Math.round(lay.headRatio * 1000) / 10 + '%）', lay.over <= 1 && lay.pairs.length === 5 && lay.pairs.every(p => p.sameRow && p.inView) && lay.headRatio <= 0.30, lay);
    await pm.close();
  }

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
  await waitRows(page2, 'D:2026-10-04', 'D:2026-11-02');
  await setDate(page2, 'dayFrom', '2026-10-01');
  await waitRows(page2, 'D:2026-10-01', 'D:2026-11-02');
  const r2 = await readRows(page2);
  check('④ 在庫が空欄の日（10/15）は出さない（10/1〜11/2 で32行）', !byId(r2, 'D:2026-10-15') && r2.length === 32, r2.length);
  const n16 = byId(r2, 'D:2026-10-16');
  check('④ 前日の在庫が空欄の日（10/16）は「開始在庫（10/15）が未入力のため計算できません」（列をまたいで15列）', n16 && n16.cells[1].indexOf('開始在庫（10/15）が未入力のため計算できません') >= 0 && n16.colspan === '15', n16);
  const z14 = byId(r2, 'D:2026-10-14');
  check('④ 収穫0の日（10/14）の率は「－」', z14.cells[3] === '0' && z14.cells[11] === '－' && z14.cells[12] === '－', z14.cells);
  check('④ 空欄の日をまたいでも、累計の差（10/31）は計算できる', /^[−+]?[\d,.]+$/.test(byId(r2, 'D:2026-10-31').cells[13]), byId(r2, 'D:2026-10-31').cells[13]);

  await browser.close();
  H.finish();
})().catch(e => { console.error(e); process.exit(1); });
