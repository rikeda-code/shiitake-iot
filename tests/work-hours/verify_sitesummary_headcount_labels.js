// dashboard/work-hours.html の「予実＞比較（繁忙期見込み）」タブ、拠点サマリ
// 「実績工数（業務区分別）」グラフ（plansitesum2-combined）に追加した、各棒の
// セグメントへの「◯人」人数ラベル表示（siteSummaryHeadcountLabelsPlugin()）の検証。
//
// 検証は二部構成：
//  (A) ラベルの描画自体（siteSummaryHeadcountLabelsPlugin()はトップレベル関数のため
//      window直下から直接呼べる）を、手組みのデータセット（_segmentHeadcount /
//      _stdHoursCombinedHeadcountを明示的に持たせたもの）に対して本物のChart.jsで
//      描画させ、CanvasRenderingContext2D.fillText呼び出しを記録して確認する。
//  (B) 人数の集計ルール自体（実績棒・標準労働時間棒・新規要員・増減の4つ）は
//      renderSiteSummaryView()内のローカル関数のため直接呼べない。
//      verify_plancompare_tooltip_height.js のtooltipOptsLike()と同じ方針で、
//      対象ロジックをテスト側に複製しつつ、個々の判定（isPartTimeEmployment・
//      workTypeClass・applyEmpTypeFilter・stdHoursMergeDivForWorkType・
//      normalizeMonth・normalizeName、いずれもトップレベル関数）とgetActiveData()
//      自体は本物を呼び出すことで、再現の正しさを担保する。
// さらに、PR #518で対応したツールチップの高さ調整（fitChartHeightForTooltip等）が、
// 今回追加したプラグイン（plugins配列に追加）と共存しても引き続き機能することを、
// 同じ実マウスホバー方式で再確認する。
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

    // CanvasRenderingContext2D.fillText呼び出しのうち、末尾が「人」で終わるもの
    // （siteSummaryHeadcountLabelsPluginが描画するラベルのみに一致。Chart.js自身の
    // 軸目盛り・凡例等の文字列は単位「人」を含まないため混ざらない）を記録する
    window.__capturedTexts = [];
    const origFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
      if (typeof text === 'string' && /人$/.test(text)) {
        window.__capturedTexts.push({ text, x, y, fillStyle: this.fillStyle, textAlign: this.textAlign });
      }
      return origFillText.apply(this, arguments);
    };
  });

  // ========== (A-1) セグメントに収まる高さの棒：中央・白・「◯人」で1回だけ描画 ==========
  await page.evaluate(() => {
    window.__capturedTexts.length = 0;
    window.__chartA1 = window.__makeChart({
      id: 'test-a1-inside', heightPx: 400,
      labels: ['月0', '月1', '月2'],
      datasets: [{
        type: 'bar', label: '栽培（実績）', stack: 'actual',
        data: [50, 80, null],
        _segmentHeadcount: [5, 8, null],
      }],
      plugins: [window.siteSummaryHeadcountLabelsPlugin()],
    });
  });
  const a1 = await page.evaluate(() => window.__capturedTexts.slice());
  check('(A-1) 収まる月の分だけ描画される(2件：月0と月1、月2はdataがnullのため無し)', a1.length === 2, a1);
  check('(A-1) テキストが「◯人」形式になっている', a1.every(c => c.text === '5人' || c.text === '8人'), a1);
  check('(A-1) 中央揃えで描画されている(セグメント内に収まっている)', a1.every(c => c.textAlign === 'center'), a1);
  check('(A-1) 白文字で描画されている', a1.every(c => c.fillStyle === '#ffffff'), a1);

  // ========== (A-2) セグメントに収まらない小さい棒：棒の右側・薄い色、0/nullは描画しない ==========
  await page.evaluate(() => {
    window.__capturedTexts.length = 0;
    window.__chartA2 = window.__makeChart({
      id: 'test-a2-outside', heightPx: 400, yMax: 100000,
      labels: ['月0', '月1', '月2'],
      datasets: [{
        type: 'bar', label: '栽培（実績）', stack: 'actual',
        data: [1, 1, 1],
        _segmentHeadcount: [3, null, 0],
      }],
      plugins: [window.siteSummaryHeadcountLabelsPlugin()],
    });
  });
  const a2 = await page.evaluate(() => window.__capturedTexts.slice());
  check('(A-2) 月0(3人)だけ描画される。月1(null)・月2(0)は非表示', a2.length === 1 && a2[0].text === '3人', a2);
  check('(A-2) 棒に収まらないため左揃え(棒の右側)で描画されている', a2.length === 1 && a2[0].textAlign === 'left', a2);
  check('(A-2) 収まらない場合は薄い色(#e2e8f0)で描画されている', a2.length === 1 && a2[0].fillStyle === '#e2e8f0', a2);

  // ========== (A-3) 標準労働時間棒(3段：lower/fulltime/parttime)の合計ラベルは
  //            lowerデータセットの位置に1つだけ描画される(3つに分かれない) ==========
  await page.evaluate(() => {
    window.__capturedTexts.length = 0;
    window.__chartA3 = window.__makeChart({
      id: 'test-a3-combined', heightPx: 400,
      labels: ['月0', '月1'],
      datasets: [
        {
          type: 'bar', label: '標準労働時間（社員）', stack: 'stdhours',
          data: [10, 10], _threeSiteMergeStdHoursTier: 'lower',
          _stdHoursCombinedHeadcount: [7, null],
        },
        {
          type: 'bar', label: '標準労働時間（契約社員）', stack: 'stdhours',
          data: [20, 20], _threeSiteMergeStdHoursTier: 'fulltime',
        },
        {
          type: 'bar', label: '標準労働時間（パート）', stack: 'stdhours',
          data: [5, 5], _threeSiteMergeStdHoursTier: 'parttime',
        },
      ],
      plugins: [window.siteSummaryHeadcountLabelsPlugin()],
    });
  });
  const a3 = await page.evaluate(() => window.__capturedTexts.slice());
  check('(A-3) 3段分の重複なしで、月0に1件だけ描画される(月1はnullのため無し)', a3.length === 1 && a3[0].text === '7人', a3);

  // ========== (B) 人数集計ルールの再現テスト ==========
  // renderSiteSummaryView()内のローカル関数（headcountByEmpForPlanMonths()・
  // stdHoursCombinedHeadcountForMi()・newStaffHeadcountForMi()・deltaHeadcountForMi()の
  // 考え方）を、本物のトップレベル関数（getActiveData・normalizeMonth・normalizeName・
  // isPartTimeEmployment・workTypeClass・applyEmpTypeFilter・stdHoursMergeDivForWorkType）
  // を呼び出す形でテスト側に再現する
  await page.evaluate(() => {
    window.__mnum = m => { const [y, mo] = m.split('/').map(Number); return y * 100 + mo; };

    // dashboard/work-hours.html 8476行目 headcountByEmpForPlanMonths() と同じロジック
    // （filterDivsは常に指定して呼ぶため、未指定時のdivs分岐は再現していない）
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

    // work-hours.html 9610-9617行目の actualHeadcountByDiv 組み立てループと同じロジック
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

    // dashboard/work-hours.html 7933行目 findStdHoursMergeRowInDiv() と同じロジック
    window.__findStdHoursMergeRowInDivLike = function (mergeRows, div, e) {
      if (!mergeRows) return null;
      const key = normalizeName(e.name);
      const wantsPartTime = isPartTimeEmployment(e.employment);
      return mergeRows.find(r => r.div === div && r.site === e.base && normalizeName(r.name) === key
        && isPartTimeEmployment(r.employment) === wantsPartTime) || null;
    };

    // work-hours.html 9622-9652行目 stdHoursCombinedHeadcountForMi() と同じロジック
    window.__stdHoursCombinedHeadcountForMiLike = function (mi, ctx) {
      const { mergeData, divs, sitesToShow, planMonths, actualCutoff, allData } = ctx;
      if (!mergeData) return null;
      const ym = window.__mnum(planMonths[mi]);
      if (ym <= actualCutoff) {
        const { employees, months: activeMonths } = getActiveData();
        const ami = activeMonths.findIndex(m => normalizeMonth(m) === planMonths[mi]);
        if (ami < 0) return null;
        let count = 0;
        divs.forEach(div => {
          const typeFilter = div === '栽培' ? wt => workTypeClass(wt) === 'wt-栽培'
            : div === '配送' ? wt => workTypeClass(wt) === 'wt-配送'
              : wt => workTypeClass(wt) === 'wt-出荷';
          sitesToShow.forEach(site => {
            const emps = employees.filter(e => e.base === site && e.workType && typeFilter(e.workType));
            count += emps.filter(e => (e.hours[ami] ?? 0) > 0 && !e.isTransferVirtual
              && window.__findStdHoursMergeRowInDivLike(mergeData.rows, div, e)).length;
          });
        });
        return count > 0 ? count : null;
      }
      let count = 0;
      divs.forEach(div => {
        sitesToShow.forEach(site => {
          const emps = applyEmpTypeFilter(allData.employees.filter(e =>
            stdHoursMergeDivForWorkType(e.workType) === div && e.base === site && (e.prj || '').trim() !== ''));
          count += emps.filter(e => (e.flag === 1 || e.flag === 3)
            && !(e.flag === 3 && e.startYm != null && e.startYm < ym)).length;
        });
      });
      return count > 0 ? count : null;
    };

    // work-hours.html 9656-9669行目 newStaffHeadcountForMi() と同じロジック
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

    // work-hours.html 9674-9683行目 deltaHeadcountForMi() と同じロジック
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
  });

  // ---------- (B-1) 実績棒の人数：絞り込み(拠点・業務区分・雇用区分)に連動し、過去月のみ ----------
  const b1 = await page.evaluate(() => {
    // allData.months は「整理済み_M」の実在月(過去の実データ)のみを模す(3ヶ月分)。
    // planMonthsはそれより先の計画範囲(5ヶ月)を持ち、過去の3ヶ月だけ実績データがある
    const PAST_MONTHS = ['2026/1', '2026/2', '2026/3'];
    const PLAN_MONTHS = ['2026/1', '2026/2', '2026/3', '2026/4', '2026/5'];
    allData = {
      months: PAST_MONTHS, monthYms: PAST_MONTHS.map(() => 1),
      employees: [
        { name: '山田太郎', base: 'いなべ', workType: '栽培', employment: '社員', hours: [10, 0, 8] },
        { name: '佐藤花子', base: 'いなべ', workType: '栽培', employment: '社員', hours: [5, 5, 0] },
        { name: '鈴木一郎', base: 'いなべ', workType: '出荷', employment: '社員', hours: [20, 20, 20] },
        { name: '高橋次郎', base: '津', workType: '栽培', employment: '社員', hours: [7, 7, 7] },
        { name: '田中三郎', base: 'いなべ', workType: '栽培', employment: 'パート', hours: [3, 3, 3] },
      ],
    };
    transferMode = false;
    transferAdjusted = null;
    periodStartMonth = null;
    empTypeFilter = null;

    const singleSite栽培 = window.__actualHeadcountByDivLike(['栽培'], ['いなべ'], PLAN_MONTHS);
    const singleSite出荷 = window.__actualHeadcountByDivLike(['出荷'], ['いなべ'], PLAN_MONTHS);
    const twoSite栽培 = window.__actualHeadcountByDivLike(['栽培'], ['いなべ', '津'], PLAN_MONTHS);

    empTypeFilter = new Set(['社員']);
    const filteredByEmpType = window.__actualHeadcountByDivLike(['栽培'], ['いなべ'], PLAN_MONTHS);
    empTypeFilter = null;

    return { singleSite栽培, singleSite出荷, twoSite栽培, filteredByEmpType };
  });
  check('(B-1) 拠点いなべ・栽培：実績時間>0の人数(月0=3人、月1=2人、月2=2人)', JSON.stringify(b1.singleSite栽培['栽培']) === JSON.stringify([3, 2, 2, null, null]), b1.singleSite栽培);
  check('(B-1) 拠点いなべ・出荷：業務区分が違えばカウントされない(常に1人)', JSON.stringify(b1.singleSite出荷['出荷']) === JSON.stringify([1, 1, 1, null, null]), b1.singleSite出荷);
  check('(B-1) 未来月(計画はあるが実績データ無し)はnull(実績棒は過去月のみ)', b1.singleSite栽培['栽培'][3] === null && b1.singleSite栽培['栽培'][4] === null, b1.singleSite栽培);
  check('(B-1) 拠点トグル(全拠点合計)に連動：いなべ+津の合算になる(月0=4人、月1=3人、月2=3人)', JSON.stringify(b1.twoSite栽培['栽培']) === JSON.stringify([4, 3, 3, null, null]), b1.twoSite栽培);
  check('(B-1) 雇用区分の絞り込みに連動：パート(田中三郎)を除外すると人数が減る(月0=2人、月1=1人、月2=1人)', JSON.stringify(b1.filteredByEmpType['栽培']) === JSON.stringify([2, 1, 1, null, null]), b1.filteredByEmpType);

  // ---------- (B-2) 過去月の標準労働時間棒の人数：実績があり、かつ標準労働時間シートと照合できた人のみ ----------
  const b2 = await page.evaluate(() => {
    const PAST_MONTHS = ['2026/1', '2026/2', '2026/3'];
    const PLAN_MONTHS = ['2026/1', '2026/2', '2026/3', '2026/4', '2026/5'];
    allData = {
      months: PAST_MONTHS, monthYms: PAST_MONTHS.map(() => 1),
      employees: [
        { name: '佐藤一郎', base: 'いなべ', workType: '栽培', employment: '社員', hours: [10, 10, 10], isTransferVirtual: false },
        { name: '鈴木次郎', base: 'いなべ', workType: '栽培', employment: '社員', hours: [5, 0, 5], isTransferVirtual: false },
        { name: '高橋三郎', base: 'いなべ', workType: '栽培', employment: '社員', hours: [8, 8, 8], isTransferVirtual: false }, // 標準労働時間シートに対応行なし(照合不可)
        { name: '田中四郎', base: 'いなべ', workType: '栽培', employment: '社員', hours: [6, 6, 6], isTransferVirtual: true }, // 振替仮想行(除外対象)
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
        { div: '栽培', site: 'いなべ', name: '田中四郎', employment: '社員', stdHours: 60 },
      ],
      monthYms: [1, 2, 3],
    };
    const ctx = { mergeData, divs: ['栽培'], sitesToShow: ['いなべ'], planMonths: PLAN_MONTHS, actualCutoff: window.__mnum('2026/3'), allData: allData };
    return [0, 1, 2].map(mi => window.__stdHoursCombinedHeadcountForMiLike(mi, ctx));
  });
  check('(B-2) 過去月：実績かつ照合できた人数のみ(月0=2人：佐藤+鈴木、高橋は照合不可で除外、田中は振替仮想で除外)', b2[0] === 2, b2);
  check('(B-2) 過去月：実績0時間の人はカウントされない(月1=1人：鈴木が実績0のため佐藤のみ)', b2[1] === 1, b2);
  check('(B-2) 過去月：月2も月0と同条件で2人', b2[2] === 2, b2);

  // ---------- (B-3) 未来月の標準労働時間棒の人数：在籍者(flag1/3)、退職予定月以降は除く ----------
  const b3 = await page.evaluate(() => {
    const PLAN_MONTHS = ['2026/1', '2026/2', '2026/3', '2026/4', '2026/5'];
    allData = {
      months: [], monthYms: [],
      employees: [
        { name: '在籍A', base: 'いなべ', workType: '栽培', employment: '社員', flag: 1, startYm: null, prj: 'A' },
        { name: '退職予定B', base: 'いなべ', workType: '栽培', employment: '社員', flag: 3, startYm: 202604, prj: 'A' }, // 2026/4が退職予定月
        { name: '新規C', base: 'いなべ', workType: '栽培', employment: '社員', flag: 2, startYm: 202605, prj: 'A' }, // flag2は新規要員側、ここではカウント対象外
        { name: '計上外D', base: 'いなべ', workType: '栽培', employment: '社員', flag: 1, startYm: null, prj: '' }, // PRJ空欄は計上外
        { name: '別区分E', base: 'いなべ', workType: '出荷', employment: '社員', flag: 1, startYm: null, prj: 'A' }, // 業務区分が違う
      ],
    };
    const mergeData = { rows: [], monthYms: [] };
    const ctx = { mergeData, divs: ['栽培'], sitesToShow: ['いなべ'], planMonths: PLAN_MONTHS, actualCutoff: window.__mnum('2026/3'), allData: allData };
    return {
      mi3: window.__stdHoursCombinedHeadcountForMiLike(3, ctx), // 2026/4(退職予定月そのもの、まだ除かれない)
      mi4: window.__stdHoursCombinedHeadcountForMiLike(4, ctx), // 2026/5(退職予定月の翌月、除かれる)
    };
  });
  check('(B-3) 退職予定月(2026/4)自身はまだ在籍者としてカウントされる(在籍A+退職予定B=2人、threeSiteMergeAgg()のretiredByYmと同じ条件)', b3.mi3 === 2, b3);
  check('(B-3) 退職予定月の翌月(2026/5)からは除かれる(在籍Aのみ=1人)', b3.mi4 === 1, b3);

  // ---------- (B-4) 新規要員(黄)の人数：未来月のみ、開始月が未設定または月以前 ----------
  const b4 = await page.evaluate(() => {
    const PLAN_MONTHS = ['2026/1', '2026/2', '2026/3', '2026/4', '2026/5'];
    allData = {
      months: [], monthYms: [],
      employees: [
        { name: '新規H1', base: 'いなべ', workType: '栽培', employment: '社員', flag: 2, startYm: null, prj: 'A' },
        { name: '新規H2', base: 'いなべ', workType: '栽培', employment: '社員', flag: 2, startYm: 202604, prj: 'A' },
        { name: '新規H3', base: 'いなべ', workType: '栽培', employment: '社員', flag: 2, startYm: 202605, prj: 'A' },
        { name: '在籍H4', base: 'いなべ', workType: '栽培', employment: '社員', flag: 1, startYm: null, prj: 'A' },
      ],
    };
    const mergeData = { rows: [], monthYms: [] };
    const ctx = { mergeData, divs: ['栽培'], sitesToShow: ['いなべ'], planMonths: PLAN_MONTHS, actualCutoff: window.__mnum('2026/3'), allData: allData };
    return {
      pastMi0: window.__newStaffHeadcountForMiLike(0, ctx),
      mi3: window.__newStaffHeadcountForMiLike(3, ctx),
      mi4: window.__newStaffHeadcountForMiLike(4, ctx),
    };
  });
  check('(B-4) 過去月は常にnull(新規要員は未来月のみ)', b4.pastMi0 === null, b4);
  check('(B-4) 2026/4：開始月未設定(H1)+開始済み(H2)=2人(H3は開始前のため除外)', b4.mi3 === 2, b4);
  check('(B-4) 2026/5：H1+H2+H3の3人(H3もこの月から開始済み)', b4.mi4 === 3, b4);

  // ---------- (B-5) 増減(緑)の人数：時間÷(8h×その月の暦日数)、小数1桁。0/nullは非表示 ----------
  const b5 = await page.evaluate(() => {
    // 2026/1=31日、2026/2=28日(2026年はうるう年ではない)、2026/3=31日、2026/4=30日、2026/5=31日
    const PLAN_MONTHS = ['2026/1', '2026/2', '2026/3', '2026/4', '2026/5'];
    const deltaHoursDs = { label: '増減（残業）', data: [99.2, 44.8, 0, 48, null] };
    return PLAN_MONTHS.map((_, mi) => window.__deltaHeadcountForMiLike(mi, deltaHoursDs, PLAN_MONTHS));
  });
  check('(B-5) 31日の月(2026/1)：99.2h÷(8×31)=0.4人', b5[0] === 0.4, b5);
  check('(B-5) 28日の月(2026/2)：44.8h÷(8×28)=0.2人', b5[1] === 0.2, b5);
  check('(B-5) 時間が0の月はnull(非表示)', b5[2] === null, b5);
  check('(B-5) 30日の月(2026/4)：48h÷(8×30)=0.2人', b5[3] === 0.2, b5);
  check('(B-5) データが無い月(null)はnull(非表示)', b5[4] === null, b5);

  // ========== (C) PR #518のツールチップ高さ調整が、新しいプラグイン追加後も引き続き機能する
  //            (実マウスホバー方式での回帰確認。拠点サマリ「実績工数」グラフの実際のシーケンス：
  //            初期650px → fitSegmentLabelChartHeight(白ラベル無しのため420pxへ) →
  //            fitChartHeightForTooltip。verify_plancompare_tooltip_height.js ⑥-aと同じ
  //            再現条件に、本タスクで追加したplugins([siteSummaryHeadcountLabelsPlugin()])と
  //            実績棒への_segmentHeadcountを付けて再現する) ==========
  await page.evaluate(() => {
    const MONTHS = 8;
    const LONG_IDX = 5;
    const datasets = [];
    datasets.push({
      type: 'bar', label: '栽培（実績）', _actualGroup: true, stack: 'actual',
      data: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 300 : 80),
      _segmentHeadcount: Array.from({ length: MONTHS }, (_, i) => i === LONG_IDX ? 12 : 3),
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
    const wrap = document.getElementById('test-headcount-realhover-combined-wrap');
    if (wrap) wrap.remove();
    const w = document.createElement('div');
    w.id = 'test-headcount-realhover-combined-wrap';
    w.style.position = 'fixed'; w.style.top = '0'; w.style.left = '0';
    w.style.height = '650px';
    w.style.width = '900px';
    const canvas = document.createElement('canvas');
    canvas.id = 'test-headcount-realhover-combined';
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
    window.__chartHeadcountRealHoverCombined = new Chart(ctx, {
      data: { labels: Array.from({ length: MONTHS }, (_, i) => `月${i}`), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { font: { size: 10 } } }, tooltip: window.__tooltipOptsForC },
        scales: { x: { stacked: true }, y: { stacked: true, suggestedMin: 0 } },
      },
      plugins: [window.siteSummaryHeadcountLabelsPlugin()],
    });
    window.fitSegmentLabelChartHeight(window.__chartHeadcountRealHoverCombined, [], 300);
    window.fitChartHeightForTooltip(window.__chartHeadcountRealHoverCombined);
  });
  const cFinal = await page.evaluate(() => ({
    height: window.__chartHeadcountRealHoverCombined.height,
    wrapStyleHeight: parseInt(document.getElementById('test-headcount-realhover-combined-wrap').style.height, 10),
  }));
  check('(C) 人数ラベル用プラグイン追加後も、必要な高さ(420px超)まで正しく広がる', cFinal.height > 420, cFinal);
  const cHover = await hoverAndCheckFit(page, '__chartHeadcountRealHoverCombined', 5);
  check('(C) 本物のマウス操作でも、ツールチップの下端がキャンバスの下端を超えない(PR #518の保証が継続)', cHover.tooltipBottom <= cHover.canvasHeight, cHover);
  check('(C) ツールチップが実際に多数行表示されている(再現条件が成立している)', cHover.numLines >= 20, cHover);
  const cTexts = await page.evaluate(() => {
    window.__capturedTexts.length = 0;
    window.__chartHeadcountRealHoverCombined.draw();
    return window.__capturedTexts.slice();
  });
  check('(C) 人数ラベル自体も実際に描画されている(プラグインが無効化されていない)', cTexts.some(t => t.text === '12人') && cTexts.some(t => t.text === '7人'), cTexts);

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
