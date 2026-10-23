// dashboard/work-hours.html の「予実＞比較（繁忙期見込み）」タブ各グラフの、ツールチップ
// （mode:'index'でキャンバス内に描かれる窓）がグラフの高さに収まらず下の行が切れる問題への
// 対応（fitChartHeightForTooltip・fitSegmentLabelChartHeightと組み合わせた高さ決定）の検証。
//
// work-hours.html はトップレベル（IIFEで包まれていない）のスクリプトのため、ページを開くだけで
// fitChartHeightForTooltip・fitSegmentLabelChartHeight・computeSegmentLabelChartHeight が
// window直下の関数として使える。実際のデータ読み込み（loadAll()）は外部スプレッドシートへの
// アクセスのため、/export系リクエストは空のCSVでモックして素早く失敗させるだけにとどめ、
// この検証では「予実＞比較（繁忙期見込み）」の各グラフ生成コードが実際に使っている
// Chart.js（CDN、同じバージョン）とtooltipコールバックの形（tooltipOpts(true,true)相当）を
// 直接再現したテスト用チャートを作り、本物のChart.jsに実測させる形で確認する
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

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await setupRoutes(page);
  await page.goto('http://localhost:8813/work-hours.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.fitChartHeightForTooltip === 'function' && typeof window.fitSegmentLabelChartHeight === 'function' && typeof window.Chart === 'function');

  // ========== 準備：テスト用チャートを作るヘルパーをページ内に注入 ==========
  await page.evaluate((tooltipOptsSrc) => {
    // tooltipOptsLike をページ内関数として再構築（文字列化して渡す）
    window.__tooltipOptsLike = new Function('showStdFooter', 'showActualTotal', `return (${tooltipOptsSrc})(showStdFooter, showActualTotal);`);

    // work-hours.html自体のbodyはdisplay:flexのコンテナのため、bodyに直接追加した
    // テスト用の複数のdivがflexアイテムとして扱われ、兄弟要素の高さに応じて互いの
    // 高さが圧縮されてしまう（明示的に指定したstyle.heightどおりにならない）。
    // position:fixedの専用コンテナを作り、その中にテスト用の要素を追加することで、
    // 本体のflexレイアウトの影響を受けないようにする
    let testContainer = document.getElementById('__test_chart_container');
    if (!testContainer) {
      testContainer = document.createElement('div');
      testContainer.id = '__test_chart_container';
      testContainer.style.position = 'fixed';
      testContainer.style.top = '0';
      testContainer.style.left = '0';
      document.body.appendChild(testContainer);
    }
    window.__makeChart = function (opts) {
      const { id, heightPx, datasets, labels, tooltipOpts } = opts;
      let wrap = document.getElementById(id + '-wrap');
      if (wrap) wrap.remove();
      wrap = document.createElement('div');
      wrap.id = id + '-wrap';
      // position:fixedの専用コンテナ(__test_chart_container)の「子要素」として普通に
      // appendすると、通常のフロー(縦積み)のため、テストが増えるほど後のチャートほど
      // ビューポートの外へ押し出されてしまう。本物のマウス操作(page.mouse.move)で
      // 検証するテスト用に、各ラッパー自体もposition:fixed;top:0;left:0にして、
      // 常にビューポート原点に固定する(複数のテスト用チャートが画面上で重なっても、
      // 自動テストでは対象のキャンバスの座標だけを見るため問題ない)
      wrap.style.position = 'fixed';
      wrap.style.top = '0';
      wrap.style.left = '0';
      wrap.style.height = heightPx + 'px';
      wrap.style.width = '900px';
      const canvas = document.createElement('canvas');
      canvas.id = id;
      wrap.appendChild(canvas);
      testContainer.appendChild(wrap);
      const ctx = canvas.getContext('2d');
      const chart = new Chart(ctx, {
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          // チャート自身の初期描画アニメーションが動いている間はchart.resize()が
          // 次のdraw()まで遅延される(実ブラウザでは次フレームで自然に反映されるが、
          // テストでは明示的にdraw()を挟まない限り確定しないため、無効化して
          // 高さの変化を同期的に検証できるようにする)
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { font: { size: 10 } } },
            tooltip: tooltipOpts,
          },
          scales: {
            x: { stacked: true },
            y: { stacked: true, suggestedMin: 0 },
          },
        },
      });
      return chart;
    };

    // 指定indexのmode:'index'相当のアクティブ要素一覧（非nullのデータセットのみ）を作って
    // ツールチップを強制表示し、Chart.js自身の計算結果を読んでから非表示に戻す
    // （fitChartHeightForTooltip内部と同じ手順の、独立した検証用コピー）。
    // chart.tooltip.height自体はアニメーション経由で反映されるため、update()内で
    // アニメーション適用前に同期的に計算される目標サイズ(_size.height)を読む
    // （fitChartHeightForTooltip本体と同じ読み方。Chart.js 4.4.3固定が前提）
    window.__measureTooltipHeightAt = function (chart, index) {
      const activeElements = [];
      chart.data.datasets.forEach((ds, datasetIndex) => {
        const v = ds.data && ds.data[index];
        if (v !== null && v !== undefined) activeElements.push({ datasetIndex, index });
      });
      if (!activeElements.length) return 0;
      chart.tooltip.setActiveElements(activeElements, { x: 0, y: 0 });
      const size = chart.tooltip._size;
      const h = size ? size.height : 0;
      chart.tooltip.setActiveElements([], { x: 0, y: 0 });
      return h;
    };
  }, tooltipOptsLike.toString());

  // ========== ①長い月（約28行の業務区分）があるチャートは、そのツールチップが
  //            収まる高さまで広がること（plancmp2等の固定320px想定） ==========
  await page.evaluate((tooltipArgs) => {
    const MONTHS = 8;
    const LONG_IDX = 5;
    const datasets = [];
    datasets.push({
      type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual',
      data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 120 : (i % 2 === 0 ? 80 : null)),
    });
    for (let i = 0; i < 28; i++) {
      datasets.push({
        type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std',
        data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (10 + i) : null),
      });
    }
    window.__chartLongTooltip = window.__makeChart({
      id: 'test-long-tooltip', heightPx: 320, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`),
      datasets, tooltipOpts: window.__tooltipOptsLike(true, true),
    });
  });
  const longResult = await page.evaluate(() => {
    const chart = window.__chartLongTooltip;
    const beforeHeight = chart.height;
    const tooltipHeightAtLong = window.__measureTooltipHeightAt(chart, 5);
    window.fitChartHeightForTooltip(chart);
    const afterHeight = chart.height;
    const wrapStyleHeight = parseInt(document.getElementById('test-long-tooltip-wrap').style.height, 10);
    const activeAfter = chart.tooltip.getActiveElements().length;
    return { beforeHeight, tooltipHeightAtLong, afterHeight, wrapStyleHeight, activeAfter };
  });
  check('①長い月のツールチップが320pxを大きく超える(測定が機能している)', longResult.tooltipHeightAtLong > 320, longResult);
  check('①グラフの高さが320pxより大きくなる(ツールチップの分だけ広がる)', longResult.afterHeight > longResult.beforeHeight, longResult);
  check('①広がった高さがツールチップの高さを覆っている(余白込みで上回る)', longResult.afterHeight >= longResult.tooltipHeightAtLong, longResult);
  check('①ラッパー要素の高さも実際に書き換わっている', longResult.wrapStyleHeight === longResult.afterHeight, longResult);
  check('①測定用に表示したツールチップが残っていない(非表示に戻っている)', longResult.activeAfter === 0, longResult);

  // ========== ②すべての月が短い(行数が少ない)場合は、今の高さ(320px)のまま変わらない ==========
  await page.evaluate(() => {
    const MONTHS = 8;
    const datasets = [
      { type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, () => 80) },
      { type: 'bar', label: '工程1', _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, () => 30) },
      { type: 'bar', label: '工程2', _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, () => 20) },
    ];
    window.__chartShortTooltip = window.__makeChart({
      id: 'test-short-tooltip', heightPx: 320, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`),
      datasets, tooltipOpts: window.__tooltipOptsLike(true, true),
    });
  });
  const shortResult = await page.evaluate(() => {
    const chart = window.__chartShortTooltip;
    const beforeHeight = chart.height;
    const maxTooltipHeight = Math.max(...Array.from({ length: 8 }, (_, i) => window.__measureTooltipHeightAt(chart, i)));
    window.fitChartHeightForTooltip(chart);
    const afterHeight = chart.height;
    const wrapStyleHeight = parseInt(document.getElementById('test-short-tooltip-wrap').style.height, 10);
    return { beforeHeight, maxTooltipHeight, afterHeight, wrapStyleHeight };
  });
  check('②短い内容のツールチップは320pxの余裕の中に収まっている', shortResult.maxTooltipHeight > 0 && shortResult.maxTooltipHeight < shortResult.beforeHeight, shortResult);
  check('②グラフの高さが320pxのまま変わらない(必要ないのに広げない)', shortResult.afterHeight === shortResult.beforeHeight, shortResult);
  check('②ラッパー要素のstyle.heightも320pxのまま', shortResult.wrapStyleHeight === 320, shortResult);

  // ========== ③要員計画(業務区分別)：白い2行ラベルの高さとツールチップの高さの大きい方 ==========
  // ③-a: ツールチップの必要高さが、白いラベル基準の高さ(上限650px)を上回る場合 → 上限を超えてよい
  await page.evaluate(() => {
    const MONTHS = 8;
    const LONG_IDX = 3;
    const datasets = [];
    datasets.push({
      type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual',
      data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 200 : 80),
    });
    // 白い2行ラベル用の要員不足セグメント(_staffGapBar相当)。最小値を小さくして
    // computeSegmentLabelChartHeightの計算結果が上限650pxにクランプされる状況を作る
    datasets.push({
      type: 'bar', label: '要員不足', _staffGapBar: true, stack: 'std',
      data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 1 : 5),
    });
    for (let i = 0; i < 40; i++) {
      datasets.push({
        type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std',
        data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (5 + i) : null),
      });
    }
    window.__chartStaffplanOverCap = window.__makeChart({
      id: 'test-staffplan-overcap', heightPx: 320, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`),
      datasets, tooltipOpts: window.__tooltipOptsLike(true, true),
    });
  });
  const overCapResult = await page.evaluate(() => {
    const chart = window.__chartStaffplanOverCap;
    const labelValues = chart.data.datasets.find(d => d._staffGapBar).data;
    const axisMax = 300;
    window.fitSegmentLabelChartHeight(chart, labelValues, axisMax);
    const afterLabelFitHeight = chart.height;
    const expectedLabelFit = window.computeSegmentLabelChartHeight(labelValues, axisMax, chart.height - chart.chartArea.height);
    const tooltipHeightAtLong = window.__measureTooltipHeightAt(chart, 3);
    window.fitChartHeightForTooltip(chart);
    const finalHeight = chart.height;
    return { afterLabelFitHeight, expectedLabelFit, tooltipHeightAtLong, finalHeight };
  });
  check('③-a 白いラベル基準の高さがまず650pxの上限にクランプされている', overCapResult.afterLabelFitHeight <= 650 + 1, overCapResult);
  check('③-a ツールチップの必要高さが650pxの上限を上回る状況になっている', overCapResult.tooltipHeightAtLong + 50 > 650, overCapResult);
  check('③-a 最終的な高さが650pxの上限を超えている(ツールチップ優先)', overCapResult.finalHeight > 650, overCapResult);
  check('③-a 最終的な高さがツールチップの高さを覆っている', overCapResult.finalHeight >= overCapResult.tooltipHeightAtLong, overCapResult);

  // ③-b: 白いラベル基準の高さだけで、ツールチップの必要高さも既に満たされている場合 →
  //       ラベル基準の高さのまま(ツールチップのために余計に広げない)
  await page.evaluate(() => {
    const MONTHS = 8;
    const datasets = [
      { type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, () => 80) },
      { type: 'bar', label: '要員不足', _staffGapBar: true, stack: 'std', data: Array.from({ length: MONTHS }, () => 2) },
      { type: 'bar', label: '工程1', _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, () => 30) },
    ];
    window.__chartStaffplanSmall = window.__makeChart({
      id: 'test-staffplan-small', heightPx: 320, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`),
      datasets, tooltipOpts: window.__tooltipOptsLike(true, true),
    });
  });
  const smallCombResult = await page.evaluate(() => {
    const chart = window.__chartStaffplanSmall;
    const labelValues = chart.data.datasets.find(d => d._staffGapBar).data;
    const axisMax = 100;
    window.fitSegmentLabelChartHeight(chart, labelValues, axisMax);
    const afterLabelFitHeight = chart.height;
    window.fitChartHeightForTooltip(chart);
    const finalHeight = chart.height;
    return { afterLabelFitHeight, finalHeight };
  });
  check('③-b ツールチップが小さい内容の場合、ラベル基準の高さから変わらない', smallCombResult.finalHeight === smallCombResult.afterLabelFitHeight, smallCombResult);

  // ========== ④測定後にツールチップが表示されたまま残らないこと(③のケースでも確認) ==========
  // opacityはアニメーション経由で時間をかけて0へ戻るため、残っているかどうかは
  // アクティブ要素(_active)が空かどうか（＝今後の描画で表示されない状態）で判定する
  const lingering = await page.evaluate(() => ({
    overcap: window.__chartStaffplanOverCap.tooltip.getActiveElements().length,
    small: window.__chartStaffplanSmall.tooltip.getActiveElements().length,
  }));
  check('④③-aのグラフにも測定用ツールチップが残っていない', lingering.overcap === 0, lingering);
  check('④③-bのグラフにも測定用ツールチップが残っていない', lingering.small === 0, lingering);

  // ========== ⑤再計算：短い内容→長い内容に変わると広がり、今の高さより低くはならない ==========
  const regrowResult = await page.evaluate(() => {
    const chart = window.__chartShortTooltip; // ②で既にfit済み(320pxのまま)のチャートを再利用
    const heightBeforeChange = chart.height;
    // データを長い内容(28工程)に差し替える(拠点・月・表示月数等の切替による再描画を模擬)
    const MONTHS = 8, LONG_IDX = 2;
    const newDatasets = [{ type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 150 : 80) }];
    for (let i = 0; i < 28; i++) {
      newDatasets.push({ type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (5 + i) : null) });
    }
    chart.data.datasets = newDatasets;
    chart.update('none');
    window.fitChartHeightForTooltip(chart);
    const heightAfterChange = chart.height;
    return { heightBeforeChange, heightAfterChange };
  });
  check('⑤内容が長くなる方向に変わると、今の高さより低くならずに広がる', regrowResult.heightAfterChange >= regrowResult.heightBeforeChange && regrowResult.heightAfterChange > 320, regrowResult);

  // ========== ⑥本物のマウス操作での確認（PR #518追加修正：実際にツールチップが
  //            切れていたplansitesum2-combined/plansum2-combined相当の再現） ==========
  // キャンバス上の該当月の位置へ実際にマウスを動かしてツールチップを表示させ、
  // その窓の下端がキャンバスの下端を超えていないこと（chart.tooltip.setActiveElements()を
  // 直接呼ぶ内部的な測定ではなく、ブラウザの本物のイベント経路を通す）を確認するヘルパー
  async function hoverAndCheckFit(page, chartVar, datasetIndexForX, index) {
    await page.evaluate(({ chartVar }) => { window.__hoverChartRef = window[chartVar]; }, { chartVar });
    // マウスの目標座標は、Chart.js内部の要素位置(chart.getDatasetMeta().data[].x/y)には
    // 頼らない。resize()直後でdraw()を挟んでいない（＝本来直したい不具合がまだ残っている）
    // 状態のチャートでは、内部の要素位置も実際のキャンバスの大きさと食い違っている
    // ことがあり、その場合に内部位置ベースで座標を計算するとキャンバスの外を指して
    // しまい、本物のマウス操作が何にも当たらずホバー自体が成立しない（＝「ツールチップが
    // 表示されない」という別の失敗になってしまい、本来確認したい「表示されるが
    // 下端が切れる」ことを確認できない）。canvasのgetBoundingClientRect()（実際に
    // ブラウザが描画している大きさそのもの）だけを基準に、X座標は月の位置の比率、
    // Y座標はキャンバスの中央を使う（mode:'index',intersect:falseのためYはどこでもよい）
    const target = await page.evaluate(({ index }) => {
      const chart = window.__hoverChartRef;
      const totalPoints = chart.data.labels.length;
      const canvas = chart.canvas;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + rect.width * ((index + 0.5) / totalPoints), y: rect.top + rect.height * 0.5 };
    }, { index });
    await page.mouse.move(target.x, target.y);
    await page.mouse.move(target.x + 1, target.y); // 確実にmousemoveイベントを発火させる
    await page.waitForTimeout(250); // ツールチップのフェードインアニメーションの完了を待つ
    const result = await page.evaluate(() => {
      const chart = window.__hoverChartRef;
      const canvas = chart.canvas;
      const rect = canvas.getBoundingClientRect();
      const tt = chart.tooltip;
      // tt.height自体はアニメーション経由で遅れて反映される(fitChartHeightForTooltip本体の
      // コメントと同じ理由)ため、本物のマウス操作でも最終的な大きさはtt._size.heightを
      // 読む。位置(tt.y)はアニメーションの影響を受けないため、そのまま使う
      const finalHeight = (tt._size && tt._size.height) || tt.height || 0;
      const tooltipBottom = (tt.y || 0) + finalHeight;
      return { canvasHeight: rect.height, tooltipY: tt.y, tooltipHeight: finalHeight, tooltipBottom, opacity: tt.opacity, numLines: tt.body ? tt.body.length : 0 };
    });
    // 後片付け：マウスをどこか離れた位置に動かし、ツールチップを閉じておく
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    return result;
  }

  // ⑥-a：plansitesum2-combined/plansum2-combined相当の実際のシーケンスを再現する。
  // 初期ラッパー高さ650px（実際のchartWrapHtml('plansitesum2-combined', ..., {heightPx:650})
  // と同じ）→ fitSegmentLabelChartHeight(chart, [], axisMax)で白いラベル用データセットが
  // 無いため420pxへ縮小 → fitChartHeightForTooltip(chart)。ここで必要な高さが「420pxより
  // 大きく650pxより小さい」範囲になるよう業務区分の行数を調整したデータで、本物の
  // マウス操作でもツールチップが切れないことを確認する（この範囲でのみ、修正前は
  // chart.resize()直後のchart.heightが古い650pxのまま読まれてしまい、必要な高さ(420px超)
  // を正しく計算していても「420pxのままで足りている」と誤判定して広げられない不具合が
  // あった。650pxを超えるほど長いケースは①のテストで既に確認済みのため、ここでは
  // あえて420〜650pxの間に収まる行数にしている）
  await page.evaluate(() => {
    const MONTHS = 8;
    const LONG_IDX = 5;
    const datasets = [];
    datasets.push({ type: 'bar', label: '栽培（実績）', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 300 : 80) });
    datasets.push({ type: 'bar', label: '出荷（実績）', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 200 : 60) });
    const N = 22; // 420px超・650px未満の高さが必要になる行数（実測して選定）
    for (let i = 0; i < N; i++) {
      datasets.push({ type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (5 + i) : null) });
    }
    const wrap = document.getElementById('test-realhover-combined-wrap');
    if (wrap) wrap.remove();
    const w = document.createElement('div');
    w.id = 'test-realhover-combined-wrap';
    w.style.position = 'fixed'; w.style.top = '0'; w.style.left = '0'; // 本物のマウス操作のため常にビューポート原点に固定
    w.style.height = '650px'; // chartWrapHtml({heightPx:650, inlineHeight:true})と同じ初期値
    w.style.width = '900px';
    const canvas = document.createElement('canvas');
    canvas.id = 'test-realhover-combined';
    w.appendChild(canvas);
    document.getElementById('__test_chart_container').appendChild(w);
    const ctx = canvas.getContext('2d');
    window.__chartRealHoverCombined = new Chart(ctx, {
      data: { labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { font: { size: 10 } } }, tooltip: window.__tooltipOptsLike(true, true) },
        scales: { x: { stacked: true }, y: { stacked: true, suggestedMin: 0 } },
      },
    });
    // 実際の呼び出し順を再現：白いラベルが無いため常に420px固定(フォールバック)になる
    window.fitSegmentLabelChartHeight(window.__chartRealHoverCombined, [], 300);
    window.fitChartHeightForTooltip(window.__chartRealHoverCombined);
  });
  const combinedFinal = await page.evaluate(() => ({
    height: window.__chartRealHoverCombined.height,
    wrapStyleHeight: parseInt(document.getElementById('test-realhover-combined-wrap').style.height, 10),
  }));
  check('⑥-a 修正後、必要な高さ(420px超)まで正しく広がっている(420pxに留まっていない)', combinedFinal.height > 420, combinedFinal);
  const combinedHover = await hoverAndCheckFit(page, '__chartRealHoverCombined', 0, 5);
  check('⑥-a 本物のマウス操作でも、ツールチップの下端がキャンバスの下端を超えない', combinedHover.tooltipBottom <= combinedHover.canvasHeight, combinedHover);
  check('⑥-a ツールチップが実際に多数行表示されている(再現条件が成立している)', combinedHover.numLines >= 20, combinedHover);
  check('⑥-a 測定された窓の高さが十分大きい(見かけ上だけ収まっているのではない)', combinedHover.tooltipHeight > 200, combinedHover);

  // ⑦ 拠点・業務別(plancmp2相当、固定320px・segment-fitの前段無し)で、項目の多い月を
  //    含む場合でも、本物のマウス操作でツールチップが切れないこと
  await page.evaluate(() => {
    const MONTHS = 8;
    const LONG_IDX = 2;
    const datasets = [{ type: 'bar', label: '実績工数', _actualGroup: true, stack: 'actual', data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 150 : 80) }];
    for (let i = 0; i < 25; i++) {
      datasets.push({ type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (5 + i) : null) });
    }
    window.__chartPlancmpRealHover = window.__makeChart({
      id: 'test-plancmp-realhover', heightPx: 320, labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`),
      datasets, tooltipOpts: window.__tooltipOptsLike(true, true),
    });
    window.fitChartHeightForTooltip(window.__chartPlancmpRealHover);
  });
  const plancmpHover = await hoverAndCheckFit(page, '__chartPlancmpRealHover', 0, 2);
  check('⑦拠点・業務別相当：項目の多い月でも、本物のマウス操作でツールチップが切れない', plancmpHover.tooltipBottom <= plancmpHover.canvasHeight, plancmpHover);

  // ⑧ 要員計画(業務区分別、planstaffplan2-combined相当)で、白いラベル基準の高さが
  //    650px上限にクランプされツールチップの必要高さがそれを上回る状況でも、
  //    本物のマウス操作でツールチップが切れないこと（③-aの延長、本物のマウス操作での回帰確認）
  const staffplanHover = await hoverAndCheckFit(page, '__chartStaffplanOverCap', 0, 3);
  check('⑧要員計画(業務区分別)相当：650px上限超のケースでも、本物のマウス操作でツールチップが切れない', staffplanHover.tooltipBottom <= staffplanHover.canvasHeight, staffplanHover);

  await browser.close();

  console.log(`\n=== 総合判定 ===`);
  console.log(ngCount === 0 ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(ngCount === 0 ? 0 : 1);
})().catch(err => {
  console.error('テスト実行エラー:', err);
  console.log('DONE');
  process.exit(1);
});
