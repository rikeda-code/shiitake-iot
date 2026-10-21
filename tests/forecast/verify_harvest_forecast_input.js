// 栽培の標準工数パネルの「収穫計画」表示・「収穫見込（入力）」の手入力と、
// 手入力した見込kgを収穫計画kgより優先して収穫工数を計算するロジックの確認。
// 収穫見込の保存先GAS(HARVEST_FORECAST_GAS_URL)はページ取得時に差し替え、GASへの
// GET/POSTはpage.route()でモックする（実際のGAS・スプレッドシートには触れない）
const { chromium } = require('playwright');

function csvCell(v) { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function csvRow(cells) { return cells.map(csvCell).join(','); }
function toCsvText(rows) { return '﻿' + rows.map(csvRow).join('\r\n') + '\r\n'; }
function fixTodayTo(page, y, m, d) {
  return page.addInitScript(([y, m, d]) => {
    const FIXED = new Date(y, m, d, 9, 0, 0).getTime();
    const OrigDate = Date;
    class FixedDate extends OrigDate {
      constructor(...args) { if (args.length === 0) return new OrigDate(FIXED); return new OrigDate(...args); }
      static now() { return FIXED; }
    }
    window.Date = FixedDate;
  }, [y, m, d]);
}

const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STD_WORK_HOURS_GID = '264266810';
const GUNMA_TRANSFER_ID = '1iZK3xgGkPhXTlnx_DGunW8YQ8bZZFE-r_5Si513r46Y';
const GUNMA_TRANSFER_GID = '1272257227';
const FAKE_GAS_URL = 'https://script.google.com/macros/s/TEST_HARVEST_FORECAST/exec';
const PAGE_URL = 'http://localhost:8811/work-hours-forecast.html?div=' + encodeURIComponent('栽培') + '&site=' + encodeURIComponent('群馬');

// 収穫：50kg/h（収穫工数 = kg ÷ 50）
function buildStdWorkHoursCsv() {
  const rows = [['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '']];
  rows.push(['栽培', '収穫', 50, '', '', '', '', 'kg/h']);
  rows.push(['', 'コンテナ点検時間', 2, '', '', '', '', 'h']);
  return toCsvText(rows);
}
// 群馬の転写シート：10/21〜10/27のうち10/23だけ収穫計画が空欄、ほかは100kg
function buildGunmaTransferCsv() {
  const rows = [['', '見込み1', '2026.10']];
  for (let d = 1; d <= 31; d++) rows.push(['', '', d === 23 ? '' : 100]);
  return toCsvText(rows);
}

async function setupPage(browser, opts) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await fixTodayTo(page, 2026, 9, 21);
  const posts = [];
  // 本番のGASに書き込まないよう、HARVEST_FORECAST_GAS_URLは必ずテスト用（または空欄）に差し替える
  await page.route('**/work-hours-forecast.html*', async route => {
    const res = await route.fetch();
    const html = await res.text();
    const re = /var HARVEST_FORECAST_GAS_URL = '[^']*';/;
    if (!re.test(html)) throw new Error('HARVEST_FORECAST_GAS_URLの定義が見つからない');
    const body = html.replace(re, "var HARVEST_FORECAST_GAS_URL = '" + (opts.injectGasUrl ? FAKE_GAS_URL : '') + "';");
    await route.fulfill({ response: res, body });
  });
  await page.route(FAKE_GAS_URL + '**', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      posts.push(JSON.parse(req.postData()));
      const body = opts.failSave ? { status: 'error', message: 'テスト用の保存エラー' } : { status: 'ok' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    const url = new URL(req.url());
    opts.loadQueries && opts.loadQueries.push(Object.fromEntries(url.searchParams));
    if (opts.loadDelayMs) await new Promise(r => setTimeout(r, opts.loadDelayMs));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', values: opts.loadValues || {} }) });
  });
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    let body = '﻿\r\n';
    if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + STD_WORK_HOURS_GID)) body = buildStdWorkHoursCsv();
    else if (url.includes(GUNMA_TRANSFER_ID) && url.includes('gid=' + GUNMA_TRANSFER_GID)) body = buildGunmaTransferCsv();
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
  });
  await page.goto(PAGE_URL);
  await page.waitForFunction(() => document.querySelector('[data-work="収穫"][data-work-offset="0"]') &&
    document.querySelector('[data-work="収穫"][data-work-offset="0"]').textContent !== '－', null, { timeout: 15000 });
  // 標準工数は収穫見込の読み込みを待たずに出るため、GASありの場合は見込が届いて入力欄が使えるまで待つ
  if (opts.injectGasUrl && !opts.noWaitManual) await page.waitForSelector('[data-harvest-input-offset="0"]:not([disabled])', { timeout: 15000 });
  return { page, posts };
}

function text(page, sel) { return page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; }, sel); }
function hasClass(page, sel, cls) { return page.evaluate(([s, c]) => { const el = document.querySelector(s); return !!el && el.classList.contains(c); }, [sel, cls]); }
const harvestWork = o => `[data-work="収穫"][data-work-offset="${o}"]`;
const planCell = o => `[data-harvest="収穫計画"][data-harvest-offset="${o}"]`;
const input = o => `[data-harvest-input-offset="${o}"]`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=OverlayScrollbar'] });
  let allOk = true;
  function check(label, ok) { console.log('  ' + label + ': ' + (ok ? 'OK' : 'NG')); if (!ok) allOk = false; }

  console.log('=== ①純粋関数：手入力の見込kgを収穫計画kgより優先する ===');
  {
    const { page } = await setupPage(browser, { injectGasUrl: false });
    const r = await page.evaluate(() => {
      const t = window.__test;
      const rows = [{ waku: '収穫', factor: 50, unit: 'kg/h' }];
      const cult = { processCounts: new Array(7).fill({}), containerCounts: new Array(7).fill(0) };
      const plan = [100, 100, null, null, 100, 100, 100];
      const manual = [null, 200, 150, null, 0, null, null];
      const perDay = t.computeStandardWorkHours(rows, cult, plan, new Date(2026, 9, 21), manual);
      const noManual = t.computeStandardWorkHours(rows, cult, plan, new Date(2026, 9, 21));
      return {
        values: perDay.map(d => d.items['収穫']),
        sources: perDay.map(d => d.harvestSource),
        missing: perDay.map(d => d.harvestMissing),
        noManual: noManual.map(d => d.items['収穫']),
        parse: ['', ' 120 ', '1,200', '１２０kg', 'abc', '-5'].map(t.parseManualHarvestInput),
      };
    });
    check('見込なし→計画、見込あり→見込で計算（0kgの見込も優先）', JSON.stringify(r.values) === JSON.stringify([2, 4, 3, null, 0, 2, 2]));
    check('使った方が記録される', JSON.stringify(r.sources) === JSON.stringify(['plan', 'manual', 'manual', null, 'manual', 'plan', 'plan']));
    check('計画・見込どちらも無い日だけ収穫を含まない扱い', JSON.stringify(r.missing) === JSON.stringify([false, false, false, true, false, false, false]));
    check('見込を渡さない呼び出しは従来どおり計画だけで計算', JSON.stringify(r.noManual) === JSON.stringify([2, 2, null, null, 2, 2, 2]));
    check('入力値の読み取り（空欄=null、全角・カンマ・kg可、数値以外・負はundefined）',
      JSON.stringify(r.parse) === JSON.stringify([null, 120, 1200, 120, undefined, undefined]));

    console.log('=== ②保存先GAS未設定：入力欄は使えず、計画kgだけで計算 ===');
    check('収穫計画の行が表示される（10/21＝100kg）', await text(page, planCell(0)) === '100.0');
    check('収穫計画が空欄の日は「－」', await text(page, planCell(2)) === '－');
    check('入力欄は無効', await page.evaluate(s => document.querySelector(s).disabled, input(0)));
    check('収穫工数は計画kgで計算（100÷50=2.0）', await text(page, harvestWork(0)) === '2.0');
    await page.close();
  }

  console.log('=== ③保存先GASあり：読み込んだ見込を優先して表示・計算 ===');
  {
    const loadQueries = [];
    const { page, posts } = await setupPage(browser, { injectGasUrl: true, loadValues: { '2026-10-22': 200 }, loadQueries });
    check('GASに拠点・期間を指定して読みに行く', loadQueries.length >= 1 && loadQueries[0].site === '群馬' && loadQueries[0].from === '2026-10-21' && loadQueries[0].to === '2026-10-27');
    check('入力欄は有効', await page.evaluate(s => !document.querySelector(s).disabled, input(0)));
    check('読み込んだ見込が入力欄に入る（10/22＝200）', await page.inputValue(input(1)) === '200');
    check('10/21は計画kgで計算（2.0、青字ではない）', await text(page, harvestWork(0)) === '2.0' && !(await hasClass(page, harvestWork(0), 'harvest-manual')));
    check('10/22は見込kgで計算（200÷50=4.0、青字）', await text(page, harvestWork(1)) === '4.0' && await hasClass(page, harvestWork(1), 'harvest-manual'));
    check('10/23は計画・見込とも無く「－」、注記が出る', await text(page, harvestWork(2)) === '－' &&
      await page.evaluate(() => document.getElementById('workHarvestNote').style.display !== 'none'));
    const subBefore = await text(page, '[data-work-subtotal-offset="2"]');

    console.log('=== ④入力→即時再計算・保存 ===');
    await page.fill(input(2), '150');
    await page.press(input(2), 'Enter');
    await page.waitForFunction(() => document.getElementById('workHarvestSaveStatus').textContent.includes('保存しました'));
    check('POSTの中身（拠点・日付・kg）', posts.length === 1 && posts[0].action === 'save' && posts[0].site === '群馬' && posts[0].date === '2026-10-23' && posts[0].kg === 150);
    check('10/23の収穫工数が見込で再計算される（3.0、青字）', await text(page, harvestWork(2)) === '3.0' && await hasClass(page, harvestWork(2), 'harvest-manual'));
    const subAfter = await text(page, '[data-work-subtotal-offset="2"]');
    check(`小計も再計算される（${subBefore} → ${subAfter}）`, subBefore.endsWith('*') && !subAfter.endsWith('*') && parseFloat(subAfter) - parseFloat(subBefore) === 3);
    check('計画・見込とも無い日が無くなったので注記が消える', await page.evaluate(() => document.getElementById('workHarvestNote').style.display === 'none'));
    check('入力した値が欄に残る', await page.inputValue(input(2)) === '150');

    console.log('=== ⑤見込を消す→計画kgに戻る ===');
    await page.fill(input(1), '');
    await page.press(input(1), 'Enter');
    await page.waitForFunction(() => document.getElementById('workHarvestSaveStatus').textContent.includes('保存しました'));
    check('kg:nullで保存（削除）', posts.length === 2 && posts[1].date === '2026-10-22' && posts[1].kg === null);
    check('10/22の収穫工数が計画kgに戻る（2.0、青字ではない）', await text(page, harvestWork(1)) === '2.0' && !(await hasClass(page, harvestWork(1), 'harvest-manual')));

    console.log('=== ⑥数値以外の入力は保存しない ===');
    await page.fill(input(3), 'abc');
    await page.press(input(3), 'Enter');
    check('保存しない', posts.length === 2);
    check('入力欄は元に戻り、エラー表示が出る', await page.inputValue(input(3)) === '' &&
      await page.evaluate(() => document.getElementById('workHarvestSaveStatus').classList.contains('error')));
    await page.close();
  }

  console.log('=== ⑦GASの応答が遅くても、標準工数は収穫計画kgで先に表示され、見込が届いたら再計算される ===');
  {
    const { page } = await setupPage(browser, { injectGasUrl: true, noWaitManual: true, loadDelayMs: 2500, loadValues: { '2026-10-21': 250 } });
    check('見込の読み込み中：収穫工数は計画kgで表示済み（2.0）', await text(page, harvestWork(0)) === '2.0');
    check('見込の読み込み中：入力欄は無効', await page.evaluate(s => document.querySelector(s).disabled, input(0)));
    await page.waitForSelector(input(0) + ':not([disabled])', { timeout: 15000 });
    check('見込が届いたら入力欄に入る（250）', await page.inputValue(input(0)) === '250');
    check('見込で再計算される（250÷50=5.0、青字）', await text(page, harvestWork(0)) === '5.0' && await hasClass(page, harvestWork(0), 'harvest-manual'));
    await page.close();
  }

  console.log('=== ⑧保存に失敗したとき ===');
  {
    const { page, posts } = await setupPage(browser, { injectGasUrl: true, failSave: true });
    await page.fill(input(0), '300');
    await page.press(input(0), 'Enter');
    await page.waitForFunction(() => document.getElementById('workHarvestSaveStatus').textContent.includes('保存できませんでした'));
    check('入力欄が赤くなる', await hasClass(page, input(0), 'save-error'));
    check('画面上は入力値で計算されたまま（300÷50=6.0）', await text(page, harvestWork(0)) === '6.0');
    await page.focus(input(0));
    await page.press(input(0), 'Enter');
    await page.waitForTimeout(300);
    check('値を変えずにEnterすると、失敗した欄は保存し直す', posts.length === 2);
    await page.focus(input(1));
    await page.press(input(1), 'Enter');
    await page.waitForTimeout(300);
    check('失敗していない欄は、値を変えずにEnterしても保存しない', posts.length === 2);
    await page.close();
  }

  await browser.close();
  console.log(allOk ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})();
