// dashboard/work-hours.html の「予実＞比較（繁忙期見込み）」タブ、拠点サマリ
// 「実績工数（業務区分別）」グラフ（plansitesum2-combined）に追加した、棒ごとの
// 総合計人数ラベル（「計◯」。内訳の「◯人」と異なり「人」を付けない）の検証。
//
// 検証は三部構成：
//  (A) ラベルの描画自体（siteSummaryHeadcountLabelsPlugin()・
//      fitChartHeightForHeadcountTotals()・siteSummaryTotalLabelNeededPx()・
//      siteSummaryFormatHeadcount()はいずれもトップレベル関数のためwindow直下から
//      直接呼べる）を、手組みのデータセット（_segmentHeadcount・
//      _stackTotalHeadcountを明示的に持たせたもの）に対して本物のChart.jsで
//      描画させ、CanvasRenderingContext2D.fillText呼び出しを記録して確認する。
//      一番上のセグメントのさらに上に太字で描かれること、そのセグメントの内訳
//      ラベルが棒の上側に出ている場合はさらに1行分あけること、0・nullは描画しない
//      こと、小数は小数1桁・整数は整数のまま表示されること、グラフの高さが足りない
//      場合はfitChartHeightForHeadcountTotals()が広げて上端で切れない・凡例と
//      重ならないことを確認する。
//  (B) 総合計の数え方自体（実績棒：内訳(div別)の縦計と一致すること、絞り込みとの
//      連動／標準労働時間棒：過去月は青系3段の合計、未来月は3段＋新規要員＋増減の
//      合計）は
//      renderPlanCompareCharts2()内のローカル関数のため直接呼べない。
//      verify_sitesummary_headcount_labels.jsと同じ方針で、対象ロジックをテスト側に
//      複製しつつ、個々の判定（isPartTimeEmployment・workTypeClass・
//      applyEmpTypeFilter・stdHoursMergeDivForWorkType・normalizeMonth・
//      normalizeName、いずれもトップレベル関数）とgetActiveData()自体は本物を
//      呼び出すことで、再現の正しさを担保する。
//  (C) PR #518で対応したツールチップの高さ調整（fitChartHeightForTooltip等）が、
//      今回追加した総合計ラベル用の高さ調整（fitChartHeightForHeadcountTotals）と
//      共存しても引き続き機能することを、実マウスホバー方式で再確認する。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CHART_JS_VENDORED = fs.readFileSync(path.join(__dirname, 'vendor', 'chart.umd.js'), 'utf8');

async function setupRoutes(page) {
  await page.route('**/chart.umd.min.js', async route => {
    await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: CHART_JS_VENDORED });
  });
  await page.route('**/export**', async route => {
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '﻿\r\n' });
  });
}

let okCount = 0, ngCount = 0;
function check(name, cond, extra) {
  if (cond) { okCount++; console.log(`  ${name}: OK`); }
  else { ngCount++; console.log(`  ${name}: NG${extra !== undefined ? ' (' + JSON.stringify(extra) + ')' : ''}`); }
}

async function hoverAndCheckFit(page, chartVar, index) {
  await page.evaluate(({ chartVar }) => { window.__hoverChartRef = window[chartVar]; }, { chartVar });
  const target = await page.evaluate(({ index }) => {
    const chart = window.__hoverChartRef;
    const totalPoints = chart.data.labels.length;
    const canvas = chart.canvas;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + rect.width * ((index + 0.5) / totalPoints), y: rect.top + rect.height * 0.5 };
  }, { index });
  await page.mouse.move(target.x, target.y);
  await page.mouse.move(target.x + 1, target.y);
  await page.waitForTimeout(250);
  const result = await page.evaluate(() => {
    const chart = window.__hoverChartRef;
    const canvas = chart.canvas;
    const rect = canvas.getBoundingClientRect();
    const tt = chart.tooltip;
    const finalHeight = (tt._size && tt._size.height) || tt.height || 0;
    const tooltipBottom = (tt.y || 0) + finalHeight;
    return { canvasHeight: rect.height, tooltipY: tt.y, tooltipHeight: finalHeight, tooltipBottom, opacity: tt.opacity, numLines: tt.body ? tt.body.length : 0 };
  });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  return result;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await setupRoutes(page);
  await page.goto('http://localhost:8813/work-hours.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.siteSummaryHeadcountLabelsPlugin === 'function'
    && typeof window.fitChartHeightForHeadcountTotals === 'function'
    && typeof window.siteSummaryTotalLabelNeededPx === 'function'
    && typeof window.siteSummaryFormatHeadcount === 'function'
    && typeof window.fitChartHeightForTooltip === 'function' && typeof window.fitSegmentLabelChartHeight === 'function'
    && typeof window.getActiveData === 'function' && typeof window.Chart === 'function');

  // ========== 準備：テスト用チャート生成ヘルパーと、fillText呼び出しの記録フックを注入 ==========
  await page.evaluate(() => {
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
      const { id, heightPx, widthPx, datasets, labels, yMax, plugins } = opts;
      let wrap = document.getElementById(id + '-wrap');
      if (wrap) wrap.remove();
      wrap = document.createElement('div');
      wrap.id = id + '-wrap';
      wrap.style.position = 'fixed';
      wrap.style.top = '0';
      wrap.style.left = '0';
      wrap.style.height = heightPx + 'px';
      wrap.style.width = (widthPx || 900) + 'px';
      const canvas = document.createElement('canvas');
      canvas.id = id;
      wrap.appendChild(canvas);
      testContainer.appendChild(wrap);
      const ctx = canvas.getContext('2d');
      const chart = new Chart(ctx, {
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { font: { size: 10 } } } },
          scales: {
            x: { stacked: true },
            y: { stacked: true, suggestedMin: 0, max: yMax },
          },
        },
        plugins: plugins || [],
      });
      return chart;
    };

    // CanvasRenderingContext2D.fillText呼び出しのうち、末尾が「人」で終わるもの（内訳）
    // または「計」で始まるもの（総合計。「人」を付けない「計◯」形式）を記録する
    // （siteSummaryHeadcountLabelsPluginが描画するラベルのみに一致）。
    // fontも記録し、総合計（太字）と内訳（通常文字）を区別できるようにする
    window.__capturedTexts = [];
    const origFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
      if (typeof text === 'string' && (/人$/.test(text) || /^計/.test(text))) {
        window.__capturedTexts.push({ text, x, y, fillStyle: this.fillStyle, textAlign: this.textAlign, font: this.font });
      }
      return origFillText.apply(this, arguments);
    };
  });

  // ========== (A-1) 総合計：内訳が棒の内側に収まる場合は、棒の上端から1行分あけて
  //            太字で描画される（「計◯」。内訳の合計と一致） ==========
  await page.evaluate(() => {
    window.__capturedTexts.length = 0;
    window.__chartA1 = window.__makeChart({
      id: 'test-a1-fit', heightPx: 400,
      labels: ['月0'],
      datasets: [
        { type: 'bar', label: '栽培（実績）', stack: 'actual', data: [80], _segmentHeadcount: [5], _stackTotalHeadcount: [8] },
        { type: 'bar', label: '出荷（実績）', stack: 'actual', data: [70], _segmentHeadcount: [3] },
      ],
      plugins: [window.siteSummaryHeadcountLabelsPlugin()],
    });
  });
  const a1 = await page.evaluate(() => window.__capturedTexts.slice());
  const a1total = a1.find(c => c.text === '計8');
  const a1bar = await page.evaluate(() => {
    const meta = window.__chartA1.getDatasetMeta(1); // 出荷（栽培の後に積み上げられる側＝一番上）
    return { y: meta.data[0].y, areaTop: window.__chartA1.chartArea.top };
  });
  const a1expectedY = Math.max(a1bar.y - 11, a1bar.areaTop + 11); // drawTotal()と同じ式(areaTop+LINE_Hでクランプ)
  check('(A-1) 内訳(5人・3人)と総合計(計8)の両方が描画される', a1.filter(c => c.text === '5人' || c.text === '3人').length === 2 && !!a1total, a1);
  check('(A-1) 総合計は太字(bold)で描画される', !!a1total && /bold/.test(a1total.font), a1total);
  check('(A-1) 総合計は中央揃え・薄い色(内訳の上側表示と同じ系統)で描画される', !!a1total && a1total.textAlign === 'center' && a1total.fillStyle === '#e2e8f0', a1total);
  check('(A-1) 総合計は一番上のセグメント(出荷)の上端(bar.y)から1行分(11px)あけた位置に描かれる(内訳が内側に収まるため、内訳の上側表示は無い)', !!a1total && Math.abs(a1total.y - a1expectedY) < 0.01, { a1total, a1bar, a1expectedY });

  // ========== (A-2) 総合計：一番上のセグメントが棒の内側に収まらず上側に内訳ラベルを
  //            描いている場合、その内訳ラベルのさらに上に1行分あけて描かれる ==========
  await page.evaluate(() => {
    window.__capturedTexts.length = 0;
    window.__chartA2 = window.__makeChart({
      id: 'test-a2-outside', heightPx: 400, yMax: 100000,
      labels: ['月0'],
      datasets: [
        { type: 'bar', label: '栽培（実績）', stack: 'actual', data: [1], _segmentHeadcount: [9], _stackTotalHeadcount: [12] },
        { type: 'bar', label: '出荷（実績）', stack: 'actual', data: [1], _segmentHeadcount: [3] },
      ],
      plugins: [window.siteSummaryHeadcountLabelsPlugin()],
    });
  });
  const a2 = await page.evaluate(() => window.__capturedTexts.slice());
  const a2breakdown = a2.find(c => c.text === '3人'); // 出荷(一番上)：内側に収まらず上側に描画される
  const a2total = a2.find(c => c.text === '計12');
  const a2bar = await page.evaluate(() => {
    const meta = window.__chartA2.getDatasetMeta(1); // 出荷（一番上）
    return { y: meta.data[0].y, areaTop: window.__chartA2.chartArea.top };
  });
  // drawTotal()と同じ式：bar.yから1行(11px)＋内訳が上側にある場合はさらに(2+11)px
  const a2expectedY = Math.max(a2bar.y - 11 - (2 + 11), a2bar.areaTop + 11);
  check('(A-2) 一番上(出荷)の内訳ラベルが棒の上側(収まらない)に描画されている(前提の成立確認)', !!a2breakdown && a2breakdown.textAlign === 'center', a2);
  check('(A-2) 総合計(計12)も描画されている', !!a2total, a2);
  check('(A-2) 総合計は内訳ラベル(出荷の「3人」)より、さらに上(yが小さい)に描かれる', !!a2total && !!a2breakdown && a2total.y < a2breakdown.y, { a2total, a2breakdown });
  check('(A-2) 総合計の位置は、一番上のセグメントの上端(bar.y)から、内訳ラベルの分も含めて計算どおりの位置に描かれる', !!a2total && Math.abs(a2total.y - a2expectedY) < 0.01, { a2total, a2bar, a2expectedY });

  // ========== (A-3) 0人・nullの総合計は描画されない ==========
  await page.evaluate(() => {
    window.__capturedTexts.length = 0;
    window.__chartA3 = window.__makeChart({
      id: 'test-a3-zero', heightPx: 400,
      labels: ['月0', '月1'],
      datasets: [
        { type: 'bar', label: '栽培（実績）', stack: 'actual', data: [80, 80], _segmentHeadcount: [5, 5], _stackTotalHeadcount: [0, null] },
      ],
      plugins: [window.siteSummaryHeadcountLabelsPlugin()],
    });
  });
  const a3 = await page.evaluate(() => window.__capturedTexts.slice());
  check('(A-3) 内訳(5人)は描画されるが、総合計(0人・null)は描画されない(「計」で始まる文字列が無い)', a3.filter(c => c.text === '5人').length === 2 && !a3.some(c => c.text.startsWith('計')), a3);

  // ========== (A-4) 小数の書式：小数がある場合だけ小数1桁、整数ならそのまま ==========
  const a4fmt = await page.evaluate(() => ({
    dec: window.siteSummaryFormatHeadcount(49.3),
    dec2: window.siteSummaryFormatHeadcount(49.34), // 小数2桁以上は1桁に丸める
    int: window.siteSummaryFormatHeadcount(34),
    intFromFloat: window.siteSummaryFormatHeadcount(34.0),
  }));
  check('(A-4) 小数がある場合は小数1桁で表示される(49.3)', a4fmt.dec === '49.3', a4fmt);
  check('(A-4) 小数2桁以上は1桁に丸められる(49.34→49.3)', a4fmt.dec2 === '49.3', a4fmt);
  check('(A-4) 小数が無い場合は整数のまま表示される(34、34.0ではない)', a4fmt.int === '34', a4fmt);
  check('(A-4) 丸めた結果ちょうど整数になる場合も整数表示になる(34.0→34)', a4fmt.intFromFloat === '34', a4fmt);
  await page.evaluate(() => {
    window.__capturedTexts.length = 0;
    window.__chartA4 = window.__makeChart({
      id: 'test-a4-fmt', heightPx: 400,
      labels: ['月0', '月1'],
      datasets: [
        { type: 'bar', label: '栽培（実績）', stack: 'actual', data: [80, 80], _segmentHeadcount: [5, 5], _stackTotalHeadcount: [49.3, 34] },
      ],
      plugins: [window.siteSummaryHeadcountLabelsPlugin()],
    });
  });
  const a4 = await page.evaluate(() => window.__capturedTexts.slice());
  check('(A-4) グラフ上でも小数は「計49.3」、整数は「計34」(「計34.0」ではない)と表示される', a4.some(c => c.text === '計49.3') && a4.some(c => c.text === '計34') && !a4.some(c => c.text === '計34.0'), a4);

  // ========== (A-5) fitChartHeightForHeadcountTotals：総合計(＋内訳)が収まる高さが
  //            足りない場合、必要な高さまでグラフを広げ、グラフ上端(キャンバス上端)で
  //            切れず、凡例(chart.chartArea.top＝凡例の下端)とも重ならないこと ==========
  const a5 = await page.evaluate(() => {
    const axisMax = 100;
    const wrap = document.getElementById('test-a5-wrap');
    if (wrap) wrap.remove();
    const w = document.createElement('div');
    w.id = 'test-a5-wrap';
    w.style.position = 'fixed'; w.style.top = '0'; w.style.left = '0';
    w.style.height = '150px'; w.style.width = '300px';
    const canvas = document.createElement('canvas');
    canvas.id = 'test-a5-canvas';
    w.appendChild(canvas);
    document.getElementById('__test_chart_container').appendChild(w);
    const ctx = canvas.getContext('2d');
    // 栽培(90)+出荷(3)=93(軸の最大100に近い、つまり初期の高さではヘッドルームが
    // ほぼ無い)。出荷(一番上)は値が小さいため棒自体の高さは低く、内訳ラベルが
    // 内側に収まらず上側に出る(hasBreakdownAbove=trueのケースを再現)
    window.__chartA5 = new Chart(ctx, {
      data: {
        labels: ['月0'],
        datasets: [
          { type: 'bar', label: '栽培（実績）', stack: 's', data: [90], _segmentHeadcount: [9] },
          { type: 'bar', label: '出荷（実績）', stack: 's', data: [3], _segmentHeadcount: [3], _stackTotalHeadcount: [12] },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { labels: { font: { size: 10 } } } },
        scales: { x: { stacked: true }, y: { stacked: true, suggestedMin: 0, max: axisMax } },
      },
      plugins: [window.siteSummaryHeadcountLabelsPlugin()],
    });
    const heightBefore = window.__chartA5.height;
    window.fitChartHeightForHeadcountTotals(window.__chartA5, axisMax);
    const heightAfter = window.__chartA5.height;
    window.__capturedTexts.length = 0;
    window.__chartA5.draw();
    const texts = window.__capturedTexts.slice();
    const total = texts.find(c => c.text === '計12');
    const breakdown = texts.find(c => c.text === '3人');
    return {
      heightBefore, heightAfter,
      areaTop: window.__chartA5.chartArea.top,
      legendBottom: window.__chartA5.legend ? window.__chartA5.legend.bottom : null,
      total, breakdown,
    };
  });
  check('(A-5) ヘッドルームが不足する初期状態から、必要な高さまでグラフが広がる', a5.heightAfter > a5.heightBefore, a5);
  check('(A-5) 凡例の下端とグラフ描画領域の上端が一致している(この構成の前提確認)', a5.legendBottom === a5.areaTop, a5);
  check('(A-5) 広げた後、総合計の文字の推定上端(y-11px)が、グラフ描画領域の上端(＝凡例の下端)より上に出ない(凡例と重ならない・上端で切れない)', !!a5.total && (a5.total.y - 11) >= a5.areaTop - 1, a5);
  check('(A-5) 内訳ラベルも描画されている(無効化されていない)', !!a5.breakdown, a5);

  // ========== (B) 人数集計ルールの再現テスト ==========
  // renderPlanCompareCharts2()内のローカル関数（headcountByEmpForPlanMonths()・
  // stdHoursHeadcountByTierForMi()・newStaffHeadcountForMi()・deltaHeadcountForMi()の
  // 考え方）を、本物のトップレベル関数（getActiveData・normalizeMonth・normalizeName・
  // isPartTimeEmployment・workTypeClass・applyEmpTypeFilter・stdHoursMergeDivForWorkType）
  // を呼び出す形でテスト側に再現する（verify_sitesummary_headcount_labels.jsと同じ方針）
  await page.evaluate(() => {
    window.__mnum = m => { const [y, mo] = m.split('/').map(Number); return y * 100 + mo; };

    // dashboard/work-hours.html headcountByEmpForPlanMonths() と同じロジック
    window.__headcountByEmpForPlanMonthsLike = function (site, empMatcher, filterDivs, planMonths) {
      const { employees, months: activeMonths } = getActiveData();
      const allowedDivs = filterDivs.flatMap(d => d === '配送' ? ['配送・栽培', '配送・出荷'] : [d]);
      const emps = employees.filter(e => e.base === site && allowedDivs.includes(e.workType) && empMatcher(e));
      return planMonths.map(planMonth => {
        const ami = activeMonths.findIndex(m => normalizeMonth(m) === planMonth);
        if (ami < 0) return null;
        const count = emps.filter(e => (e.hours[ami] ?? 0) > 0).length;
        return count > 0 ? count : null;
      });
    };

    // work-hours.html actualHeadcountByDiv 組み立てループと同じロジック(div別の内訳)
    window.__actualHeadcountByDivLike = function (divs, sitesToShow, planMonths) {
      const result = {};
      divs.forEach(div => {
        const headcountBySite = sitesToShow.map(site => window.__headcountByEmpForPlanMonthsLike(site, () => true, [div], planMonths));
        result[div] = planMonths.map((_, mi) => {
          const total = headcountBySite.reduce((s, arr) => s + (arr[mi] || 0), 0);
          return total > 0 ? total : null;
        });
      });
      return result;
    };

    // work-hours.html actualTotalHeadcount と同じロジック(div別の内訳の合算ではなく、
    // 選択中のdivsをまとめて一度に渡して重複排除した人数)
    window.__actualTotalHeadcountLike = function (divs, sitesToShow, planMonths) {
      const bySite = sitesToShow.map(site => window.__headcountByEmpForPlanMonthsLike(site, () => true, divs, planMonths));
      return planMonths.map((_, mi) => {
        const total = bySite.reduce((s, arr) => s + (arr[mi] || 0), 0);
        return total > 0 ? total : null;
      });
    };

    // dashboard/work-hours.html findStdHoursMergeRowInDiv() と同じロジック
    window.__findStdHoursMergeRowInDivLike = function (mergeRows, div, e) {
      if (!mergeRows) return null;
      const key = normalizeName(e.name);
      const wantsPartTime = isPartTimeEmployment(e.employment);
      return mergeRows.find(r => r.div === div && r.site === e.base && normalizeName(r.name) === key
        && isPartTimeEmployment(r.employment) === wantsPartTime) || null;
    };

    // dashboard/work-hours.html tierForMergeRow() と同じロジック
    window.__tierForMergeRowLike = function (r) {
      if (!isPartTimeEmployment(r.employment)) return 'lower';
      if (r.fulltimeHours > 0) return 'fulltime';
      if (r.parttimeHours > 0) return 'parttime';
      return null;
    };

    // work-hours.html stdHoursHeadcountByTierForMi() と同じロジック。戻り値は
    // {lower, fulltime, parttime}
    window.__stdHoursHeadcountByTierForMiLike = function (mi, ctx) {
      const { mergeData, divs, sitesToShow, planMonths, actualCutoff, allData } = ctx;
      if (!mergeData) return null;
      const ym = window.__mnum(planMonths[mi]);
      const counts = { lower: 0, fulltime: 0, parttime: 0 };
      const addTierFor = (e, row) => {
        if (!row) return;
        const tier = isPartTimeEmployment(e.employment) ? window.__tierForMergeRowLike(row) : 'lower';
        if (tier) counts[tier]++;
      };
      if (ym <= actualCutoff) {
        const { employees, months: activeMonths } = getActiveData();
        const ami = activeMonths.findIndex(m => normalizeMonth(m) === planMonths[mi]);
        if (ami < 0) return null;
        divs.forEach(div => {
          const typeFilter = div === '栽培' ? wt => workTypeClass(wt) === 'wt-栽培'
            : div === '配送' ? wt => workTypeClass(wt) === 'wt-配送'
              : wt => workTypeClass(wt) === 'wt-出荷';
          sitesToShow.forEach(site => {
            const emps = employees.filter(e => e.base === site && e.workType && typeFilter(e.workType));
            emps.forEach(e => {
              if (!((e.hours[ami] ?? 0) > 0) || e.isTransferVirtual) return;
              addTierFor(e, window.__findStdHoursMergeRowInDivLike(mergeData.rows, div, e));
            });
          });
        });
      } else {
        divs.forEach(div => {
          sitesToShow.forEach(site => {
            const emps = applyEmpTypeFilter(allData.employees.filter(e =>
              stdHoursMergeDivForWorkType(e.workType) === div && e.base === site && (e.prj || '').trim() !== ''));
            emps.forEach(e => {
              if (!(e.flag === 1 || e.flag === 3)) return;
              if (e.flag === 3 && e.startYm != null && e.startYm < ym) return;
              addTierFor(e, window.__findStdHoursMergeRowInDivLike(mergeData.rows, div, e));
            });
          });
        });
      }
      return counts;
    };

    // work-hours.html newStaffHeadcountForMi() と同じロジック
    window.__newStaffHeadcountForMiLike = function (mi, ctx) {
      const { mergeData, divs, sitesToShow, planMonths, actualCutoff, allData } = ctx;
      if (!mergeData) return null;
      const ym = window.__mnum(planMonths[mi]);
      if (ym <= actualCutoff) return null;
      let count = 0;
      divs.forEach(div => {
        sitesToShow.forEach(site => {
          const emps = applyEmpTypeFilter(allData.employees.filter(e =>
            stdHoursMergeDivForWorkType(e.workType) === div && e.base === site && (e.prj || '').trim() !== ''));
          count += emps.filter(e => e.flag === 2 && (e.startYm == null || e.startYm <= ym)).length;
        });
      });
      return count > 0 ? count : null;
    };

    // work-hours.html deltaHeadcountForMi() と同じロジック
    window.__deltaHeadcountForMiLike = function (mi, deltaHoursDs, planMonths) {
      if (!deltaHoursDs) return null;
      const hours = deltaHoursDs.data[mi];
      if (hours == null) return null;
      const [y, mo] = planMonths[mi].split('/').map(Number);
      const days = new Date(y, mo, 0).getDate();
      if (!(days > 0)) return null;
      const count = Math.round((hours / (8 * days)) * 10) / 10;
      return count !== 0 ? count : null;
    };

    // work-hours.html stdHoursTotalHeadcount と同じロジック：過去月は3段の合計、
    // 未来月は3段＋新規要員＋増減の合計(小数1桁に丸める)
    window.__stdHoursTotalHeadcountLike = function (planMonths, ctx) {
      const { actualCutoff, deltaHoursDs } = ctx;
      return planMonths.map((month, mi) => {
        const tier = window.__stdHoursHeadcountByTierForMiLike(mi, ctx);
        const tierTotal = tier ? (tier.lower + tier.fulltime + tier.parttime) : 0;
        const ym = window.__mnum(month);
        const total = ym <= actualCutoff
          ? tierTotal
          : tierTotal + (window.__newStaffHeadcountForMiLike(mi, ctx) || 0) + (window.__deltaHeadcountForMiLike(mi, deltaHoursDs, planMonths) || 0);
        const rounded = Math.round(total * 10) / 10;
        return rounded > 0 ? rounded : null;
      });
    };
  });

  // ---------- (B-1) 実績棒の総合計：通常は内訳(div別)の縦計と一致する(「1人が複数の
  //            区分にまたがる場合は1人と数える」という方針で実装しているが、実データの
  //            従業員1人につきworkTypeは1つに固定されるため、区分をまたいで二重計上
  //            される余地自体が無く、常に内訳の縦計と一致する)。絞り込みにも連動する ----------
  const b1 = await page.evaluate(() => {
    const PAST_MONTHS = ['2026/1', '2026/2', '2026/3'];
    const PLAN_MONTHS = ['2026/1', '2026/2', '2026/3', '2026/4', '2026/5'];
    allData = {
      months: PAST_MONTHS, monthYms: PAST_MONTHS.map(() => 1),
      employees: [
        { name: '山田太郎', base: 'いなべ', workType: '栽培', employment: '社員', hours: [10, 0, 8] },
        { name: '佐藤花子', base: 'いなべ', workType: '出荷', employment: '社員', hours: [5, 5, 0] },
        { name: '鈴木一郎', base: 'いなべ', workType: '出荷', employment: '社員', hours: [20, 20, 20] },
        { name: '高橋次郎', base: '津', workType: '栽培', employment: '社員', hours: [7, 7, 7] },
        { name: '田中三郎', base: 'いなべ', workType: '栽培', employment: 'パート', hours: [3, 3, 3] },
      ],
    };
    transferMode = false;
    transferAdjusted = null;
    periodStartMonth = null;
    empTypeFilter = null;

    const breakdown = window.__actualHeadcountByDivLike(['栽培', '出荷'], ['いなべ', '津'], PLAN_MONTHS);
    const total = window.__actualTotalHeadcountLike(['栽培', '出荷'], ['いなべ', '津'], PLAN_MONTHS);
    const breakdownSum = PLAN_MONTHS.map((_, mi) => (breakdown['栽培'][mi] || 0) + (breakdown['出荷'][mi] || 0));

    empTypeFilter = new Set(['社員']);
    const filteredTotal = window.__actualTotalHeadcountLike(['栽培', '出荷'], ['いなべ', '津'], PLAN_MONTHS);
    empTypeFilter = null;

    return { breakdown, total, breakdownSum, filteredTotal };
  });
  check('(B-1) 月0：総合計(5人：山田+佐藤+鈴木+高橋+田中、雇用区分の絞り込み前は全員含む)', b1.total[0] === 5, b1);
  check('(B-1) 総合計は、通常は内訳(div別)の縦計と一致する(複数区分にまたがる人がいないため。0人はnull表記のため、比較時のみ0とみなす)', b1.total.every((v, mi) => (v || 0) === b1.breakdownSum[mi]), b1);
  check('(B-1) 未来月(計画はあるが実績データ無し)はnull(実績棒は過去月のみ)', b1.total[3] === null && b1.total[4] === null, b1);
  check('(B-1) 雇用区分の絞り込みに連動：パート(田中三郎)を除外すると総合計も減る(月0=4人)', b1.filteredTotal[0] === 4, b1);

  // ---------- (B-2) 標準労働時間棒の総合計(過去月)：青系3段の合計と一致する ----------
  const b3 = await page.evaluate(() => {
    const PAST_MONTHS = ['2026/1', '2026/2', '2026/3'];
    const PLAN_MONTHS = ['2026/1', '2026/2', '2026/3', '2026/4', '2026/5'];
    allData = {
      months: PAST_MONTHS, monthYms: PAST_MONTHS.map(() => 1),
      employees: [
        { name: '佐藤一郎', base: 'いなべ', workType: '栽培', employment: '社員', hours: [10, 10, 10], isTransferVirtual: false },
        { name: '鈴木次郎', base: 'いなべ', workType: '栽培', employment: '社員', hours: [5, 0, 5], isTransferVirtual: false },
        { name: '渡辺五郎', base: 'いなべ', workType: '栽培', employment: 'パート', hours: [4, 4, 4], isTransferVirtual: false },
        { name: '伊藤六郎', base: 'いなべ', workType: '栽培', employment: 'パート', hours: [3, 3, 3], isTransferVirtual: false },
      ],
    };
    transferMode = false;
    transferAdjusted = null;
    periodStartMonth = null;
    empTypeFilter = null;
    const mergeData = {
      rows: [
        { div: '栽培', site: 'いなべ', name: '佐藤一郎', employment: '社員', stdHours: 100 },
        { div: '栽培', site: 'いなべ', name: '鈴木次郎', employment: '社員', stdHours: 80 },
        { div: '栽培', site: 'いなべ', name: '渡辺五郎', employment: 'パート', fulltimeHours: 5, parttimeHours: 0, stdHours: 40 },
        { div: '栽培', site: 'いなべ', name: '伊藤六郎', employment: 'パート', fulltimeHours: 0, parttimeHours: 3, stdHours: 20 },
      ],
      monthYms: [1, 2, 3],
    };
    const ctx = {
      mergeData, divs: ['栽培'], sitesToShow: ['いなべ'], planMonths: PLAN_MONTHS,
      actualCutoff: window.__mnum('2026/3'), allData: allData, deltaHoursDs: null,
    };
    const tiers = [0, 1, 2].map(mi => window.__stdHoursHeadcountByTierForMiLike(mi, ctx));
    const total = window.__stdHoursTotalHeadcountLike(PLAN_MONTHS, ctx);
    return { tiers, total };
  });
  check('(B-2) 過去月・月0：3段(佐藤+鈴木+渡辺+伊藤=4人)の合計と総合計が一致する', b3.total[0] === 4 && (b3.tiers[0].lower + b3.tiers[0].fulltime + b3.tiers[0].parttime) === 4, b3);
  check('(B-2) 過去月・月1：鈴木が実績0のため3段合計=3人、総合計も3人', b3.total[1] === 3, b3);
  check('(B-2) 過去月・月2：月0と同条件で総合計も4人', b3.total[2] === 4, b3);
  check('(B-2) 未来月(計画はあるが対象者無し)はnull', b3.total[3] === null && b3.total[4] === null, b3);

  // ---------- (B-3) 標準労働時間棒の総合計(未来月)：3段＋新規要員＋増減の合計
  //            (小数を含む増減も正しく合算され、小数1桁に丸められる) ----------
  const b4 = await page.evaluate(() => {
    const PLAN_MONTHS = ['2026/1', '2026/2', '2026/3', '2026/4', '2026/5'];
    allData = {
      months: [], monthYms: [],
      employees: [
        { name: '在籍A', base: 'いなべ', workType: '栽培', employment: '社員', flag: 1, startYm: null, prj: 'A' },
        { name: '在籍B', base: 'いなべ', workType: '栽培', employment: '社員', flag: 1, startYm: null, prj: 'A' },
        { name: '新規C', base: 'いなべ', workType: '栽培', employment: '社員', flag: 2, startYm: null, prj: 'A' },
      ],
    };
    const mergeData = {
      rows: [
        { div: '栽培', site: 'いなべ', name: '在籍A', employment: '社員', stdHours: 100 },
        { div: '栽培', site: 'いなべ', name: '在籍B', employment: '社員', stdHours: 90 },
      ],
      monthYms: [],
    };
    // 増減（残業）：2026/4は31日×8h換算で0.4人分、小数のまま合算されること
    const deltaHoursDs = { label: '増減（残業）', data: [null, null, null, 99.2, null] };
    const ctx = {
      mergeData, divs: ['栽培'], sitesToShow: ['いなべ'], planMonths: PLAN_MONTHS,
      actualCutoff: window.__mnum('2026/3'), allData: allData, deltaHoursDs,
    };
    const tiers3 = window.__stdHoursHeadcountByTierForMiLike(3, ctx);
    const newStaff3 = window.__newStaffHeadcountForMiLike(3, ctx);
    const total = window.__stdHoursTotalHeadcountLike(PLAN_MONTHS, ctx);
    return { tiers3, newStaff3, total };
  });
  check('(B-3) 未来月(2026/4)：3段(在籍A+B=2人)＋新規要員(新規C=1人)＋増減(0.4人)＝3.4人', b4.total[3] === 3.4, b4);
  check('(B-3) 内訳の3段(lower=2人)・新規要員(1人)がそれぞれ正しく数えられている(前提の成立確認)', b4.tiers3.lower === 2 && b4.newStaff3 === 1, b4);
  check('(B-3) 増減データが無い月(2026/5)は、3段＋新規要員のみの合計になる', b4.total[4] === b4.tiers3.lower + b4.newStaff3, b4);

  // ========== (C) PR #518のツールチップ高さ調整が、総合計ラベル用の高さ調整
  //            (fitChartHeightForHeadcountTotals)を追加した後も引き続き機能する
  //            (実マウスホバー方式での回帰確認。verify_sitesummary_headcount_labels.js
  //            の(C)と同じ再現条件に、総合計ラベル(_stackTotalHeadcount)を追加して
  //            再現する) ==========
  await page.evaluate(() => {
    const MONTHS = 8;
    const LONG_IDX = 5;
    const datasets = [];
    datasets.push({
      type: 'bar', label: '栽培（実績）', _actualGroup: true, stack: 'actual',
      data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 300 : 80),
      _segmentHeadcount: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 12 : 3),
      _stackTotalHeadcount: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 19 : 5),
    });
    datasets.push({
      type: 'bar', label: '出荷（実績）', _actualGroup: true, stack: 'actual',
      data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 200 : 60),
      _segmentHeadcount: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 7 : 2),
    });
    const N = 22;
    for (let i = 0; i < N; i++) {
      datasets.push({ type: 'bar', label: `工程${i + 1}`, _stdGroup: true, stack: 'std', data: Array.from({ length: MONTHS }, (_, mi) => mi === LONG_IDX ? (5 + i) : null) });
    }
    const wrap = document.getElementById('test-total-realhover-combined-wrap');
    if (wrap) wrap.remove();
    const w = document.createElement('div');
    w.id = 'test-total-realhover-combined-wrap';
    w.style.position = 'fixed'; w.style.top = '0'; w.style.left = '0';
    w.style.height = '650px';
    w.style.width = '900px';
    const canvas = document.createElement('canvas');
    canvas.id = 'test-total-realhover-combined';
    w.appendChild(canvas);
    document.getElementById('__test_chart_container').appendChild(w);
    const ctx = canvas.getContext('2d');
    window.__tooltipOptsForC = {
      callbacks: {
        label: c => { const v = c.parsed.y; if (v === null || v === undefined) return null; return `${c.dataset.label}: ${v} h`; },
        footer: items => {
          const stdTotal = items.filter(i => i.dataset._stdGroup && i.parsed.y != null).reduce((s, i) => s + i.parsed.y, 0);
          if (stdTotal === 0) return;
          return `標準工数合計: ${Math.round(stdTotal)} h`;
        },
      },
    };
    const axisMax = 100000;
    window.__chartTotalRealHoverCombined = new Chart(ctx, {
      data: { labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { font: { size: 10 } } }, tooltip: window.__tooltipOptsForC },
        scales: { x: { stacked: true }, y: { stacked: true, suggestedMin: 0, max: axisMax } },
      },
      plugins: [window.siteSummaryHeadcountLabelsPlugin()],
    });
    window.fitSegmentLabelChartHeight(window.__chartTotalRealHoverCombined, [], axisMax);
    window.fitChartHeightForTooltip(window.__chartTotalRealHoverCombined);
    window.fitChartHeightForHeadcountTotals(window.__chartTotalRealHoverCombined, axisMax);
  });
  const cFinal = await page.evaluate(() => ({
    height: window.__chartTotalRealHoverCombined.height,
    wrapStyleHeight: parseInt(document.getElementById('test-total-realhover-combined-wrap').style.height, 10),
  }));
  check('(C) 総合計ラベル用の高さ調整を追加後も、必要な高さ(420px超)まで正しく広がる', cFinal.height > 420, cFinal);
  const cHover = await hoverAndCheckFit(page, '__chartTotalRealHoverCombined', 5);
  check('(C) 本物のマウス操作でも、ツールチップの下端がキャンバスの下端を超えない(PR #518の保証が継続)', cHover.tooltipBottom <= cHover.canvasHeight, cHover);
  check('(C) ツールチップが実際に多数行表示されている(再現条件が成立している)', cHover.numLines >= 20, cHover);
  const cTexts = await page.evaluate(() => {
    window.__capturedTexts.length = 0;
    window.__chartTotalRealHoverCombined.draw();
    return window.__capturedTexts.slice();
  });
  check('(C) 総合計ラベル自体も実際に描画されている(プラグインが無効化されていない)', cTexts.some(t => t.text === '計19'), cTexts);
  const cAreaTop = await page.evaluate(() => window.__chartTotalRealHoverCombined.chartArea.top);
  const cTotalText = cTexts.find(t => t.text === '計19');
  check('(C) 総合計ラベルの推定上端が、グラフ描画領域の上端より上に出ない(凡例と重ならない・上端で切れない)', !!cTotalText && (cTotalText.y - 11) >= cAreaTop - 1, { cTotalText, cAreaTop });

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
