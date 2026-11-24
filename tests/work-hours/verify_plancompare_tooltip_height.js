// dashboard/work-hours.html の「予実＞比較（繁忙期見込み）」タブ各グラフの、吹き出し（ツールチップ。
// mode:'index' で、月によっては業務区分の行が20〜30行以上並ぶ）が切れずに見えることの検証。
//
// 以前（#518）は、吹き出しをキャンバスの中に描いていたため、グラフの高さを吹き出しの高さまで広げて
// 切れないようにしていた（fitChartHeightForTooltip・fitSegmentLabelChartHeight）。今は、グラフの高さを
// 画面の見える範囲に合わせて決め、吹き出しはページの上（#chart-tip、externalChartTooltip）に出して
// 画面の中に収める形に変えた。このテストは、同じ①〜⑧の場面で、ねらい（吹き出しの全部の行が切れずに
// 見えること）を「グラフが広がること」ではなく「吹き出しが画面の中に収まること」で確かめる：
//  - グラフの高さは吹き出しのために変えない
//  - 吹き出しの上下左右が画面（ビューポート）の中にある
//  - 画面の高さに入らないときは2列以上に並べ、それでも入らないときは吹き出しの中でスクロールできる
//  - 吹き出しの行がすべて出ている・マウスを離すと消える
//
// work-hours.html はトップレベル（IIFEで包まれていない）のスクリプトのため、ページを開くだけで
// externalChartTooltip（Chart.js の既定の吹き出しとして登録済み）が使える。実際のデータ読み込み
// （loadAll()）は外部スプレッドシートへのアクセスのため、/export系リクエストは空のCSVでモックして
// 素早く失敗させるだけにとどめ、「予実＞比較（繁忙期見込み）」の各グラフ生成コードが実際に使っている
// Chart.js（同じバージョン）と吹き出しのコールバックの形（tooltipOpts(true,true)相当）を直接再現した
// テスト用チャートを作り、本物のマウス操作で吹き出しを出して、ブラウザが描いた大きさ・位置を測る
// （行数や1行の高さを見積もりで決め打ちしていないことの確認を兼ねる）。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// work-hours.htmlはChart.js本体をCDN(cdn.jsdelivr.net)から読み込む。テスト実行環境の
// ネットワーク事情に左右されず確実に動くよう、リポジトリに同梱したvendor/chart.umd.js
// （npm の chart.js@4.4.3 から複製。work-hours.html が読み込むバージョンと同じ）に
// 差し替える。実際のGoogleスプレッドシート等へのアクセスは行わない
const CHART_JS_VENDORED = fs.readFileSync(path.join(__dirname, 'vendor', 'chart.umd.js'), 'utf8');

async function setupRoutes(page) {
  await page.route('**/chart.umd.min.js', async route => {
    await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: CHART_JS_VENDORED });
  });
  await page.route('**/export**', async route => {
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' });
  });
}

function tooltipOptsLike(showStdFooter, showActualTotal) {
  // dashboard/work-hours.html の tooltipOpts(true, true) と同じ内容（文言・判定条件とも）。
  // 関数自体はファイル内のローカル関数のため直接呼べないが、中身は複製してテストで使う
  return {
    callbacks: {
      label: ctx => {
        const v = ctx.parsed.y;
        if (v === null || v === undefined) return null;
        return `${ctx.dataset.label}: ${v} h`;
      },
      afterLabel: showActualTotal ? function (ctx) {
        const actualItems = (this.dataPoints || []).filter(i => i.dataset._actualGroup && i.parsed.y != null);
        if (!actualItems.length) return;
        const last = actualItems[actualItems.length - 1];
        if (ctx.datasetIndex !== last.datasetIndex || ctx.dataIndex !== last.dataIndex) return;
        const actualTotal = actualItems.reduce((s, i) => s + i.parsed.y, 0);
        if (actualTotal === 0) return;
        return `実績合計: ${Math.round(actualTotal)} h`;
      } : undefined,
      footer: showStdFooter ? items => {
        const stdTotal = items.filter(i => i.dataset._stdGroup && i.parsed.y != null).reduce((s, i) => s + i.parsed.y, 0);
        if (stdTotal === 0) return;
        return `標準工数合計: ${Math.round(stdTotal)} h`;
      } : undefined,
    },
  };
}

let okCount = 0, ngCount = 0;
function check(name, cond, extra) {
  if (cond) { okCount++; console.log(`  ${name}: OK`); }
  else { ngCount++; console.log(`  ${name}: NG${extra !== undefined ? ' (' + JSON.stringify(extra) + ')' : ''}`); }
}


// 本物のマウス操作で、指定のチャートの指定の月に吹き出しを出し、ページの上の吹き出し（#chart-tip）の
// 大きさ・位置・行数を測る。leave：測ったあとにマウスを離して、吹き出しが消えるかも測る
async function hoverAndMeasure(page, chartVar, index, opts = {}) {
  await page.evaluate(({ chartVar }) => { window.__hoverChartRef = window[chartVar]; }, { chartVar });
  const target = await page.evaluate(({ index }) => {
    const chart = window.__hoverChartRef;
    const rect = chart.canvas.getBoundingClientRect();
    return { x: rect.left + rect.width * ((index + 0.5) / chart.data.labels.length), y: rect.top + rect.height * 0.5 };
  }, { index });
  await page.mouse.move(target.x, target.y);
  await page.mouse.move(target.x + 1, target.y);
  await page.waitForTimeout(250);
  const result = await page.evaluate(() => {
    const chart = window.__hoverChartRef;
    const el = document.getElementById('chart-tip');
    const r = el ? el.getBoundingClientRect() : null;
    const body = el && el.querySelector('.tt-body');
    return {
      shown: !!el && el.classList.contains('on') && getComputedStyle(el).visibility === 'visible',
      top: r && r.top, bottom: r && r.bottom, left: r && r.left, right: r && r.right, height: r && r.height,
      vw: document.documentElement.clientWidth, vh: window.innerHeight,
      cols: body ? (parseInt(body.style.columnCount, 10) || 1) : 0,
      scroll: !!el && el.classList.contains('scroll'),
      scrollH: el ? el.scrollHeight : 0, clientH: el ? el.clientHeight : 0,
      numLines: el ? el.querySelectorAll('.tt-line').length : 0,
      chartHeight: chart.height, wrapStyleHeight: parseInt(chart.canvas.parentElement.style.height, 10),
    };
  });
  if (opts.leave !== false) {
    // グラフ（幅900px、画面の左上に固定）の外へマウスを動かす
    const vp = page.viewportSize();
    await page.mouse.move(vp.width - 5, vp.height - 5);
    await page.mouse.move(vp.width - 4, vp.height - 4);
    await page.waitForTimeout(300);
    result.shownAfterLeave = await page.evaluate(() => { const el = document.getElementById('chart-tip'); return !!el && el.classList.contains('on'); });
  }
  return result;
}
const inViewport = r => r.shown && r.top >= 0 && r.left >= 0 && r.bottom <= r.vh + 0.5 && r.right <= r.vw + 0.5;

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await setupRoutes(page);
  await page.goto('http://localhost:8813/work-hours.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.externalChartTooltip === 'function' && typeof window.Chart === 'function');

  // ========== 準備：テスト用チャートを作るヘルパーをページ内に注入 ==========
  await page.evaluate((tooltipOptsSrc) => {
    window.__tooltipOptsLike = new Function('showStdFooter', 'showActualTotal', `return (${tooltipOptsSrc})(showStdFooter, showActualTotal);`);
    // work-hours.html の body は display:flex のため、テスト用の要素は position:fixed の専用コンテナに入れる
    let testContainer = document.getElementById('__test_chart_container');
    if (!testContainer) {
      testContainer = document.createElement('div');
      testContainer.id = '__test_chart_container';
      testContainer.style.position = 'fixed';
      testContainer.style.top = '0';
      testContainer.style.left = '0';
      testContainer.style.zIndex = '500';
      document.body.appendChild(testContainer);
    }
    // 各チャートは画面の原点に固定する（本物のマウス操作で、対象のキャンバスの座標だけを見るため。
    // 前のチャートは作るときに外す）
    window.__makeChart = function (opts) {
      const { id, heightPx, datasets, labels, tooltipOpts } = opts;
      testContainer.querySelectorAll(':scope > div').forEach(d => { const c = d.querySelector('canvas'); if (c && window.Chart.getChart(c) && d.id !== id + '-wrap') d.style.display = 'none'; });
      let wrap = document.getElementById(id + '-wrap');
      if (wrap) wrap.remove();
      wrap = document.createElement('div');
      wrap.id = id + '-wrap';
      wrap.style.position = 'fixed';
      wrap.style.top = '0';
      wrap.style.left = '0';
      wrap.style.height = heightPx + 'px';
      wrap.style.width = '900px';
      const canvas = document.createElement('canvas');
      canvas.id = id;
      wrap.appendChild(canvas);
      testContainer.appendChild(wrap);
      return new Chart(canvas.getContext('2d'), {
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { font: { size: 10 } } }, tooltip: tooltipOpts },
          scales: { x: { stacked: true }, y: { stacked: true, suggestedMin: 0 } },
        },
      });
    };
    window.__showOnly = function (id) {
      testContainer.querySelectorAll(':scope > div').forEach(d => { d.style.display = d.id === id + '-wrap' ? '' : 'none'; });
    };
  }, tooltipOptsLike.toString());

  // ========== ①長い月（約28行の業務区分）があるチャート：吹き出しのためにグラフを広げず、
  //            吹き出しは画面の中に全部の行が収まる ==========
  await page.evaluate(() => {
    const MONTHS = 8, LONG_IDX = 5;
    const datasets = [{ type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 120 : (i % 2 === 0 ? 80 : null)) }];
    for (let i = 0; i < 28; i++) {
      datasets.push({ type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (10 + i) : null) });
    }
    window.__chartLongTooltip = window.__makeChart({ id: 'test-long-tooltip', heightPx: 320, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`), datasets, tooltipOpts: window.__tooltipOptsLike(true, true) });
  });
  const longResult = await hoverAndMeasure(page, '__chartLongTooltip', 5);
  check('①長い月の吹き出しが320pxを大きく超える(グラフの高さより高い＝以前は広げていた場面になっている)', longResult.height > 320, longResult);
  check('①グラフの高さは320pxのまま(吹き出しのために広げない)', longResult.chartHeight === 320 && longResult.wrapStyleHeight === 320, longResult);
  check('①吹き出しの上下左右が画面の中に収まっている', inViewport(longResult), longResult);
  check('①吹き出しの行がすべて出ている(29行：実績1＋工程28)、切れていない', longResult.numLines === 29 && (!longResult.scroll || longResult.scrollH > longResult.clientH), longResult);
  check('①マウスを離すと吹き出しが消える(出たまま残らない)', longResult.shownAfterLeave === false, longResult);

  // ========== ②すべての月が短い場合：1列のまま、グラフの高さも320pxのまま ==========
  await page.evaluate(() => {
    const MONTHS = 8;
    const datasets = [
      { type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, () => 80) },
      { type: 'bar', label: '工程1', _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, () => 30) },
      { type: 'bar', label: '工程2', _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, () => 20) },
    ];
    window.__chartShortTooltip = window.__makeChart({ id: 'test-short-tooltip', heightPx: 320, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`), datasets, tooltipOpts: window.__tooltipOptsLike(true, true) });
  });
  const shortResult = await hoverAndMeasure(page, '__chartShortTooltip', 3);
  check('②短い内容の吹き出しは1列のまま(必要ないのに列を増やさない)', shortResult.shown && shortResult.cols === 1 && !shortResult.scroll && shortResult.height < 320, shortResult);
  check('②グラフの高さが320pxのまま変わらない', shortResult.chartHeight === 320, shortResult);
  check('②ラッパー要素のstyle.heightも320pxのまま、吹き出しは画面の中', shortResult.wrapStyleHeight === 320 && inViewport(shortResult), shortResult);

  // ========== ③画面の高さより長い吹き出し（ノートPC 1366×768） ==========
  await page.setViewportSize({ width: 1366, height: 768 });
  // ③-a：60行（1列では画面の高さに入らない）→ 2列以上に並べて画面に収める
  await page.evaluate(() => {
    const MONTHS = 8, LONG_IDX = 3;
    const datasets = [{ type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 200 : 80) }];
    datasets.push({ type: 'bar', label: '要員不足', _staffGapBar: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 1 : 5) });
    for (let i = 0; i < 60; i++) {
      datasets.push({ type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (5 + i) : null) });
    }
    window.__chartStaffplanOverCap = window.__makeChart({ id: 'test-staffplan-overcap', heightPx: 320, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`), datasets, tooltipOpts: window.__tooltipOptsLike(true, true) });
  });
  const overCapResult = await hoverAndMeasure(page, '__chartStaffplanOverCap', 3, { leave: false });
  const oneColHeight = await page.evaluate(() => {
    // 同じ内容を1列にしたときの高さ（画面の高さより高いことの確認用）
    const el = document.getElementById('chart-tip');
    const clone = el.cloneNode(true);
    clone.id = '__tip_clone';
    clone.style.maxHeight = ''; clone.style.width = ''; clone.classList.remove('scroll');
    clone.querySelector('.tt-body').style.columnCount = '';
    clone.style.visibility = 'hidden';
    document.body.appendChild(clone);
    const h = clone.getBoundingClientRect().height;
    clone.remove();
    return h;
  });
  overCapResult.oneColHeight = oneColHeight;
  check('③-a 1列では吹き出しが画面の高さ(768px)より高い状況になっている', oneColHeight > overCapResult.vh, overCapResult);
  check('③-a 2列以上に並べて、画面の中に収まっている', overCapResult.cols >= 2 && inViewport(overCapResult), overCapResult);
  check('③-a 列に並べても全部の行が出ている(62行：実績1＋要員不足1＋工程60)', overCapResult.numLines === 62, overCapResult);
  check('③-a グラフの高さは変えない(320pxのまま)', overCapResult.chartHeight === 320, overCapResult);

  // ③-b：列に並べても入らない長さ（250行）→ 吹き出しの中でスクロールでき、画面の外に出ない
  await page.mouse.move(1360, 760);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const MONTHS = 8, LONG_IDX = 2;
    const datasets = [{ type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 200 : 80) }];
    for (let i = 0; i < 250; i++) {
      datasets.push({ type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? 1 : null) });
    }
    window.__chartStaffplanSmall = window.__makeChart({ id: 'test-staffplan-small', heightPx: 320, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`), datasets, tooltipOpts: window.__tooltipOptsLike(true, true) });
  });
  const hugeResult = await hoverAndMeasure(page, '__chartStaffplanSmall', 2, { leave: false });
  check('③-b 列に並べても入らない長さのときは、吹き出しの中でスクロールでき(全部の行がスクロールの中にある)、画面の外に出ない', hugeResult.scroll && hugeResult.scrollH > hugeResult.clientH && hugeResult.numLines === 251 && inViewport(hugeResult), hugeResult);

  // ========== ④吹き出しが出たまま残らないこと ==========
  // ④-1：マウスがグラフから離れると消える（③-a のグラフ）
  await page.evaluate(() => window.__showOnly('test-staffplan-overcap'));
  await hoverAndMeasure(page, '__chartStaffplanOverCap', 3, { leave: false });
  await page.mouse.move(1300, 740);
  await page.waitForTimeout(300);
  const lingerMouse = await page.evaluate(() => document.getElementById('chart-tip').classList.contains('on'));
  check('④③-aのグラフ：マウスがグラフから離れると吹き出しが消える', lingerMouse === false, { lingerMouse });
  // ④-2：画面（グラフを入れたスクロール）がスクロールすると消える
  await hoverAndMeasure(page, '__chartStaffplanOverCap', 3, { leave: false });
  const lingerScroll = await page.evaluate(async () => {
    const before = document.getElementById('chart-tip').classList.contains('on');
    document.getElementById('main').dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 50));
    return { before, after: document.getElementById('chart-tip').classList.contains('on') };
  });
  check('④③-bの場面と同じ吹き出し：画面をスクロールすると消える', lingerScroll.before === true && lingerScroll.after === false, lingerScroll);

  // ========== ⑤再計算：短い内容→長い内容に変わっても、グラフの高さは変えず、吹き出しは画面の中 ==========
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(() => {
    window.__showOnly('test-short-tooltip');
    const chart = window.__chartShortTooltip;
    const MONTHS = 8, LONG_IDX = 2;
    const newDatasets = [{ type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 150 : 80) }];
    for (let i = 0; i < 28; i++) newDatasets.push({ type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (5 + i) : null) });
    chart.data.datasets = newDatasets;
    chart.update('none');
  });
  const regrowResult = await hoverAndMeasure(page, '__chartShortTooltip', 2);
  check('⑤内容が長くなる方向に変わっても、グラフの高さは320pxのままで、吹き出しは全部の行(29行)が画面の中', regrowResult.chartHeight === 320 && regrowResult.numLines === 29 && inViewport(regrowResult), regrowResult);

  // ========== ⑥本物のマウス操作での確認（plansitesum2-combined/plansum2-combined 相当） ==========
  // ⑥-a：初期の高さ650px相当のラッパー（ノートPC 1366×768 では画面の見える範囲より高いため、
  //       画面の下の方で吹き出しを出す場面になる）。22工程＋実績2の長い月で、吹き出しが切れない
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => {
    const MONTHS = 8, LONG_IDX = 5;
    const datasets = [];
    datasets.push({ type: 'bar', label: '栽培（実績）', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 300 : 80) });
    datasets.push({ type: 'bar', label: '出荷（実績）', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 200 : 60) });
    for (let i = 0; i < 22; i++) datasets.push({ type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (5 + i) : null) });
    window.__chartRealHoverCombined = window.__makeChart({ id: 'test-realhover-combined', heightPx: 650, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`), datasets, tooltipOpts: window.__tooltipOptsLike(true, true) });
  });
  const combinedHover = await hoverAndMeasure(page, '__chartRealHoverCombined', 5);
  check('⑥-a グラフの高さはラッパーの高さ(650px)のまま(吹き出しのために変えない)', combinedHover.chartHeight === 650, combinedHover);
  check('⑥-a 本物のマウス操作でも、吹き出しの下端が画面の下端を超えない(上下左右とも画面の中)', inViewport(combinedHover), combinedHover);
  check('⑥-a 吹き出しが実際に多数行表示されている(再現条件が成立している)', combinedHover.numLines >= 20, combinedHover);
  check('⑥-a 吹き出しの高さが十分大きい(見かけ上だけ収まっているのではない)', combinedHover.height > 200, combinedHover);

  // ⑦ 拠点・業務別(plancmp2相当、320px)で、項目の多い月でも本物のマウス操作で吹き出しが切れない
  await page.evaluate(() => {
    const MONTHS = 8, LONG_IDX = 2;
    const datasets = [{ type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 150 : 80) }];
    for (let i = 0; i < 25; i++) datasets.push({ type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (5 + i) : null) });
    window.__chartPlancmpRealHover = window.__makeChart({ id: 'test-plancmp-realhover', heightPx: 320, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`), datasets, tooltipOpts: window.__tooltipOptsLike(true, true) });
  });
  const plancmpHover = await hoverAndMeasure(page, '__chartPlancmpRealHover', 2);
  check('⑦拠点・業務別相当：項目の多い月でも、本物のマウス操作で吹き出しが画面の中に収まり、全部の行(26行)が出ている', inViewport(plancmpHover) && plancmpHover.numLines === 26, plancmpHover);

  // ⑧ 要員計画(業務区分別、planstaffplan2-combined相当)：1列では画面に入らない長さでも、
  //    本物のマウス操作で吹き出しが画面の中に収まる（③-aの、いちばん右の月に近い位置での確認）
  await page.evaluate(() => window.__showOnly('test-staffplan-overcap'));
  const staffplanHover = await hoverAndMeasure(page, '__chartStaffplanOverCap', 3);
  check('⑧要員計画(業務区分別)相当：長い吹き出しでも、本物のマウス操作で画面の中に収まる', inViewport(staffplanHover) && staffplanHover.numLines === 62, staffplanHover);

  await browser.close();

  console.log(`\n=== 総合判定 ===`);
  console.log(`OK: ${okCount} / NG: ${ngCount}`);
  console.log(ngCount === 0 ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(ngCount === 0 ? 0 : 1);
})().catch(err => {
  console.error('テスト実行エラー:', err);
  console.log('DONE');
  process.exit(1);
});
