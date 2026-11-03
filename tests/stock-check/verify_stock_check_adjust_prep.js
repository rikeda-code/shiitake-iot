// 在庫の検証画面（dashboard/stock-check.html）の「調整の入力は準備中」の検証。
// 今回の範囲は「画面と計算だけ」で、調整の保存・保存先GASへの通信は作らない。
// 実際のスプレッドシートには触れず、page.route() でCSVをモックし、すべての通信を記録して確かめる（今日は 2026-11-03）。
// 確かめること：
//  ① 調整の入力欄は全部押せない（disabled）で「準備中」と表示される
//  ② 保存の通信が無い：POST などの書き込み系リクエストが1回も出ない。通信先は
//     スプレッドシートのCSV取得（docs.google.com の export）とChart.jsだけ（GASなどには行かない）
//     画面のHTMLにも、保存先GASのURL・POSTの処理が書かれていない
//  ③ 今は調整の一覧が空（getAdjustments() が []）で、「登録済みの調整：0件」・調整合計は「－」
//  ④ 調整の一覧を渡す口（setAdjustments）に値を渡すと、表と日別・グラフの調整合計・調整後の差・率（後）が変わる
//     （削除済み・他拠点・期間外は無視）。空に戻すと「－」に戻る。これは画面上の一時的な差し替えで、保存はしない
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/stock-check/verify_stock_check_adjust_prep.js
const { chromium } = require('playwright');
const H = require('./helpers');
const { check } = H;

const readRows = page => page.evaluate(() => Array.from(document.querySelectorAll('#tableWrap tbody tr')).map(tr => ({
  id: tr.getAttribute('data-id'), cells: Array.from(tr.children).map(td => td.textContent.trim())
})));
const byId = (rows, id) => rows.filter(r => r.id === id)[0];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await H.fixTodayTo(page, 2026, 10, 3);
  const log = await H.installMocks(page, { missing: ['2026-06', '2026-07'] });
  await page.goto(H.BASE_URL);
  await page.waitForSelector('#tableWrap table.grid');

  // ① 入力欄
  const form = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.form-grid input, .form-grid select, .disabled-btn'));
    return { n: els.length, enabled: els.filter(e => !e.disabled).length, title: Array.from(document.querySelectorAll('h2')).map(h => h.textContent).filter(t => t.indexOf('調整の入力') >= 0)[0] };
  });
  check('① 調整の入力欄（日付・拠点・調整kg・区分・理由・入力者・追加ボタン）の7つが全部 disabled', form.n === 7 && form.enabled === 0, form);
  check('① 「調整の入力」の見出しに「準備中」が付く', form.title && form.title.indexOf('準備中') >= 0, form.title);
  const catOpts = await page.evaluate(() => Array.from(document.querySelectorAll('.form-grid select')[1].options).map(o => o.textContent));
  check('① 区分の選択肢：サンプル・試食／廃棄の記録漏れ／棚卸修正／移動の記録漏れ／その他', JSON.stringify(catOpts) === JSON.stringify(['サンプル・試食', '廃棄の記録漏れ', '棚卸修正', '移動の記録漏れ', 'その他']), catOpts);

  // ② 通信
  const before = log.requests.length;
  await page.click('.disabled-btn', { force: true });
  await page.waitForTimeout(400);
  check('② 追加ボタンを押しても（無効なので）通信は増えない', log.requests.length === before, log.requests.slice(before));
  const nonGet = log.requests.filter(r => r.method !== 'GET');
  check('② GET以外のリクエスト（POSTなど）が1回も無い', nonGet.length === 0, nonGet);
  const ext = log.requests.filter(r => r.url.indexOf('http://localhost') !== 0);
  const hosts = Array.from(new Set(ext.map(r => new URL(r.url).host)));
  check('② 外部の通信先は docs.google.com（CSVのexport）と cdn.jsdelivr.net（Chart.js）だけ', hosts.every(h => h === 'docs.google.com' || h === 'cdn.jsdelivr.net') && hosts.length === 2, hosts);
  check('② docs.google.com へのリクエストは、すべて export?format=csv（読み取り）', ext.filter(r => r.url.indexOf('docs.google.com') >= 0).every(r => /\/export\?format=csv&gid=\d+$/.test(r.url)), ext.filter(r => r.url.indexOf('docs.google.com') >= 0).slice(0, 3));
  const html = await (await page.request.get(H.BASE_URL)).text();
  check('② 画面のHTMLに、保存先GASのURL（script.google.com）・POSTの処理が書かれていない', html.indexOf('script.google.com') < 0 && html.indexOf('script.googleusercontent.com') < 0 && !/method\s*:\s*['"]POST/i.test(html) && html.indexOf('sendBeacon') < 0 && html.indexOf('XMLHttpRequest') < 0);

  // ③ 空の一覧
  const empty = await page.evaluate(() => ({ list: window.__stockCheck.getAdjustments(), n: document.getElementById('adjCount').textContent }));
  let rows = await readRows(page);
  check('③ getAdjustments() は空の一覧、「登録済みの調整：0件」', Array.isArray(empty.list) && empty.list.length === 0 && empty.n === '登録済みの調整：0件', empty);
  check('③ 調整合計はすべて「－」', rows.filter(r => r.cells[8] !== undefined && r.cells.length > 5).every(r => r.cells[9] === '－'), rows.map(r => r.cells[9]));

  // ④ 調整の一覧を渡す
  await page.evaluate(() => window.__stockCheck.setAdjustments([
    { id: 'a1', date: '2026-10-27', site: '南丹', kg: -100, category: 'サンプル・試食', reason: 't', deleted: false },
    { id: 'a2', date: '2026-10-28', site: '南丹', kg: 30, category: 'その他', reason: 't', deleted: true },
    { id: 'a3', date: '2026-10-28', site: '群馬', kg: 999, category: 'その他', reason: 't', deleted: false },
    { id: 'a4', date: '2026-11-02', site: '南丹', kg: 50, category: '棚卸修正', reason: 't', deleted: false },
  ]));
  rows = await readRows(page);
  const wk = byId(rows, 'W:2026-10-26'), oct = byId(rows, 'M:2026-10'), nov = byId(rows, 'M:2026-11'), wkNow = byId(rows, 'W:2026-11-02'), sep = byId(rows, 'M:2026-09');
  check('④ 10/26〜11/1：調整合計 −100.0・調整後の差 −724.0（調整前は −824.0 のまま）・率（後）−16.1%（前は −18.3%）', wk.cells[8] === '−824.0' && wk.cells[9] === '−100.0' && wk.cells[10] === '−724.0' && wk.cells[11] === '−18.3%' && wk.cells[12] === '−16.1%', wk.cells);
  check('④ 10月：調整合計 −100.0・調整後の差 −2,232.5（削除済み・群馬・11月分は入らない）', oct.cells[9] === '−100.0' && oct.cells[10] === '−2,232.5', oct.cells);
  check('④ 11月（暫定）：調整合計 +50.0・調整後の差 −100.8。11/2〜11/8：+50.0・+12.0', nov.cells[9] === '+50.0' && nov.cells[10] === '−100.8' && wkNow.cells[9] === '+50.0' && wkNow.cells[10] === '+12.0', [nov.cells, wkNow.cells]);
  check('④ 調整の無い9月は「－」のまま・調整後の差＝調整前の差', sep.cells[9] === '－' && sep.cells[10] === sep.cells[8], sep.cells);
  const cnt = await page.textContent('#adjCount');
  check('④ 「登録済みの調整」は削除済みを除いた3件', cnt === '登録済みの調整：3件', cnt);
  const mc = await page.evaluate(() => { const c = Chart.getChart('mainChart'); const i = c.data.labels.indexOf('10/26〜11/1'); return { b: c.data.datasets[0].data[i], a: c.data.datasets[1].data[i] }; });
  check('④ 差のグラフにも反映（10/26〜11/1：前 -18.3・後 -16.1）', mc.b === -18.3 && mc.a === -16.1, mc);
  await page.click('#tableWrap tr[data-id="W:2026-10-26"]');
  const dc = await page.evaluate(() => { const c = Chart.getChart('dailyChart'); return { exp: c.data.datasets[0].data, act: c.data.datasets[1].data }; });
  check('④ 日別のグラフ：10/27の調整（−100）から「あるべき在庫」が下がり、最終日は 1631.3', dc.exp[6] === 1631.3 && dc.act[6] === 907.3, dc);
  const html2 = await page.evaluate(() => { window.__stockCheck.setAdjustments([]); return document.getElementById('adjCount').textContent; });
  rows = await readRows(page);
  check('④ 空の一覧に戻すと、調整合計は「－」・0件に戻る', html2 === '登録済みの調整：0件' && byId(rows, 'W:2026-10-26').cells[9] === '－' && byId(rows, 'W:2026-10-26').cells[10] === '−824.0', [html2, byId(rows, 'W:2026-10-26').cells]);
  check('④ 調整の差し替えでは通信が増えていない（保存しない）', log.requests.filter(r => r.method !== 'GET').length === 0);

  await browser.close();
  H.finish();
})().catch(e => { console.error(e); process.exit(1); });
