// 在庫の検証画面（dashboard/stock-check.html）の「画面上部（タイトル・拠点・表示期間の枠）」の検証。
// 直近工数計画ダッシュボード（work-hours-forecast.html）と同じ作り・同じ固定の仕方であることを確かめる。
// 実際のスプレッドシートには触れず、CSVをモックする（今日は 2026-11-03）。
// 確かめること：
//  ① 構成：左に大きなタイトル「在庫検証ダッシュボード」、右に拠点の切り替え（いなべ・群馬・南丹）、
//     その下の枠に 開始月・終了月・サイクル・グラフの単位
//  ② 固定：タイトルと枠は position:sticky で画面の上に固定され、枠の下に2pxの罫線。スクロールしても
//     固定部分は動かず、罫線より下（グラフ・一覧表・日別グラフ）だけが動く。固定部分が下の内容を隠さない
//  ③ 直近工数計画と同じ見た目：固定領域・タイトル・拠点の切り替え・枠・背景の主な表示設定（色・余白・
//     罫線・角丸・文字の大きさ）が、work-hours-forecast.html の同じ部品と一致する
//     （直近工数計画の見た目が変わったときは、意図した変更か確認してください）
//  ④ スマホ：固定部分が大きくなりすぎない（画面の高さの割合）・横にはみ出さない・ラベルが部品から離れない
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/stock-check/verify_stock_check_header.js
const { chromium } = require('playwright');
const H = require('./helpers');
const { check } = H;

const REF_URL = 'http://localhost:8812/work-hours-forecast.html';
const PROPS = {
  head:    ['position', 'top', 'zIndex', 'backgroundColor', 'paddingBottom', 'borderBottomWidth', 'borderBottomStyle', 'borderBottomColor', 'marginBottom'],
  header:  ['display', 'alignItems', 'justifyContent', 'columnGap', 'marginBottom', 'flexWrap'],
  h1:      ['fontFamily', 'fontWeight', 'fontSize', 'color', 'letterSpacing', 'marginTop', 'marginBottom'],
  toggle:  ['display', 'columnGap', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderTopLeftRadius', 'paddingTop', 'paddingLeft', 'boxShadow'],
  btn:     ['paddingTop', 'paddingLeft', 'borderTopLeftRadius', 'fontSize', 'fontWeight', 'color', 'fontFamily', 'whiteSpace'],
  active:  ['backgroundColor', 'color'],
  nav:     ['display', 'alignItems', 'rowGap', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderTopLeftRadius', 'paddingTop', 'paddingLeft', 'boxShadow', 'flexWrap'],
  body:    ['backgroundColor', 'backgroundImage', 'backgroundSize', 'fontFamily', 'paddingTop', 'paddingLeft', 'paddingRight'],
  wrap:    ['maxWidth', 'marginLeft'],
};
function collect(page, sel) {
  return page.evaluate(([sel, props]) => {
    const out = {};
    Object.keys(sel).forEach(k => {
      const el = document.querySelector(sel[k]);
      if (!el) { out[k] = null; return; }
      const cs = getComputedStyle(el);
      out[k] = {};
      props[k].forEach(p => { out[k][p] = cs[p]; });
    });
    return out;
  }, [sel, PROPS]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await H.fixTodayTo(page, 2026, 10, 3);
  await H.installMocks(page, { missing: ['2026-06', '2026-07'] });
  await page.goto(H.BASE_URL);
  await page.waitForSelector('#tableWrap table.grid');

  // ① 構成
  const st = await page.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    const head = document.querySelector('.sticky-head');
    const labels = Array.from(document.querySelectorAll('.day-nav .pair > .label')).map(e => e.textContent.trim());
    return {
      title: document.querySelector('h1').textContent.trim(), docTitle: document.title,
      titleRight: r('h1').right, toggleLeft: r('#siteSeg').left, toggleRight: r('#siteSeg').right, wrapRight: r('.wrap').right,
      siteBtns: Array.from(document.querySelectorAll('#siteSeg button')).map(b => b.textContent.trim()),
      headerBottom: r('header').bottom, navTop: r('.day-nav').top,
      navInHead: !!head.querySelector('.day-nav') && !!head.querySelector('header'),
      labels, ctl: ['#startMonth', '#endMonth', '#kindSeg', '#unitSeg'].map(s => !!document.querySelector('.day-nav ' + s)),
      firstPanelTop: r('.panel').top, headBottom: head.getBoundingClientRect().bottom,
      kindBtns: Array.from(document.querySelectorAll('#kindSeg button')).map(b => b.textContent.trim()),
      unitBtns: Array.from(document.querySelectorAll('#unitSeg button')).map(b => b.textContent.trim()),
    };
  });
  check('① タイトルは「在庫検証ダッシュボード」（ページのタイトルも同じ）', st.title === '在庫検証ダッシュボード' && st.docTitle === '在庫検証ダッシュボード', [st.title, st.docTitle]);
  check('① 拠点の切り替え（いなべ・群馬・南丹）が、タイトルの右（右端そろえ）にある', JSON.stringify(st.siteBtns) === JSON.stringify(['いなべ', '群馬', '南丹']) && st.toggleLeft > st.titleRight && Math.abs(st.toggleRight - st.wrapRight) < 2, st);
  check('① その下の枠に 開始月・終了月・サイクル・グラフの単位（固定領域の中）', st.navInHead && st.navTop >= st.headerBottom && JSON.stringify(st.labels) === JSON.stringify(['開始月', '終了月', 'サイクル', 'グラフの単位']) && st.ctl.every(Boolean), st);
  check('① 枠の中の選択肢：サイクル（日・週・月・すべて）・単位（kg・%）', JSON.stringify(st.kindBtns) === JSON.stringify(['日', '週', '月', 'すべて']) && JSON.stringify(st.unitBtns) === JSON.stringify(['kg', '%']), [st.kindBtns, st.unitBtns]);

  // ② 固定
  const fx = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.sticky-head'));
    return { position: cs.position, top: cs.top, z: cs.zIndex, bw: cs.borderBottomWidth, bs: cs.borderBottomStyle, bc: cs.borderBottomColor };
  });
  check('② 固定領域は position:sticky・top:0・前面（z-index 10）', fx.position === 'sticky' && fx.top === '0px' && fx.z === '10', fx);
  check('② 枠の下に罫線（2px・実線・茶色）', fx.bw === '2px' && fx.bs === 'solid' && fx.bc === 'rgb(122, 74, 38)', fx);
  check('② スクロールする前、固定領域が最初のパネルを隠していない', st.firstPanelTop >= st.headBottom, [st.firstPanelTop, st.headBottom]);
  const before = await page.evaluate(() => ({ head: document.querySelector('.sticky-head').getBoundingClientRect().toJSON(), table: document.getElementById('tableWrap').getBoundingClientRect().top, y: scrollY }));
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const h = document.querySelector('.sticky-head').getBoundingClientRect();
    const hit = document.elementFromPoint(300, Math.round(h.bottom) + 6);
    return { head: h.toJSON(), table: document.getElementById('tableWrap').getBoundingClientRect().top, y: scrollY, hitInHead: !!(hit && hit.closest('.sticky-head')), hitTag: hit && hit.tagName };
  });
  check('② スクロールしても、固定領域は画面の上端（top=0）から動かず、高さも変わらない', after.y > 300 && after.head.top === 0 && Math.abs(after.head.height - before.head.height) < 0.5, [before.head.top, after.head.top, before.head.height, after.head.height]);
  check('② スクロールで動くのは罫線より下だけ（一覧表の位置が変わる）', after.table < before.table - 300, [before.table, after.table]);
  check('② 罫線のすぐ下には、固定領域ではなく下の内容が見える', after.hitInHead === false, after.hitTag);
  await page.evaluate(() => window.scrollTo(0, 0));

  // ③ 直近工数計画と同じ見た目
  const ref = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await ref.route('**/*', route => route.request().url().startsWith('http://localhost') ? route.continue() : route.abort());
  await ref.goto(REF_URL, { waitUntil: 'domcontentloaded' });
  await ref.waitForSelector('.sticky-head');
  const SEL_REF = { head: '.sticky-head', header: '.sticky-head header', h1: '.sticky-head h1', toggle: '#siteToggle', btn: '#siteToggle button:not(.active)', active: '#siteToggle button.active', nav: '.sticky-head .day-nav', body: 'body', wrap: '.wrap' };
  const SEL_MINE = { head: '.sticky-head', header: '.sticky-head header', h1: '.sticky-head h1', toggle: '#siteSeg', btn: '#siteSeg button:not(.active)', active: '#siteSeg button.active', nav: '.sticky-head .day-nav', body: 'body', wrap: '.wrap' };
  const a = await collect(ref, SEL_REF), b = await collect(page, SEL_MINE);
  Object.keys(PROPS).forEach(k => {
    const diff = a[k] && b[k] ? PROPS[k].filter(p => a[k][p] !== b[k][p]).map(p => p + ': 直近工数計画=' + a[k][p] + ' / 在庫検証=' + b[k][p]) : ['部品が見つからない'];
    const label = { head: '固定領域（sticky-head）', header: 'タイトル行（header）', h1: 'タイトル（h1）', toggle: '拠点の切り替え（枠）', btn: '拠点の切り替え（ボタン）', active: '拠点の切り替え（選択中）', nav: '下の枠（day-nav）', body: '背景・余白（body）', wrap: '幅（wrap）' }[k];
    check('③ ' + label + 'の表示設定が直近工数計画と一致', diff.length === 0, diff);
  });
  await ref.close();

  // ④ スマホ
  const LIMITS = [[390, 800, 0.2], [360, 640, 0.25], [320, 568, 0.3]];
  for (const [w, h, limit] of LIMITS) {
    const pm = await browser.newPage({ viewport: { width: w, height: h } }); // 最初から狭い画面で開く
    await H.fixTodayTo(pm, 2026, 10, 3);
    await H.installMocks(pm, { missing: ['2026-06', '2026-07'] });
    await pm.goto(H.BASE_URL);
    await pm.waitForSelector('#tableWrap table.grid');
    const m = await pm.evaluate(() => {
      const head = document.querySelector('.sticky-head'), hr = head.getBoundingClientRect(), iw = innerWidth;
      const pairs = Array.from(document.querySelectorAll('.day-nav .pair')).map(p => {
        const l = p.querySelector('.label').getBoundingClientRect(), c = p.children[1].getBoundingClientRect();
        return { sameRow: Math.abs((l.top + l.bottom) / 2 - (c.top + c.bottom) / 2) < 6, inView: c.right <= iw && l.left >= 0 };
      });
      return { h: hr.height, over: document.documentElement.scrollWidth - iw, headOver: head.scrollWidth - head.clientWidth, pairs };
    });
    check('④ ' + w + '×' + h + '：固定部分の高さは画面の ' + Math.round(limit * 100) + '% 以内（実測 ' + Math.round(m.h) + 'px＝' + (m.h / h * 100).toFixed(1) + '%）', m.h / h <= limit, m.h);
    check('④ ' + w + '×' + h + '：ページ・固定部分が横にはみ出さない', m.over <= 0 && m.headOver <= 0, [m.over, m.headOver]);
    check('④ ' + w + '×' + h + '：ラベルと部品（選択・切り替え）が同じ行で、画面内に収まる', m.pairs.length === 4 && m.pairs.every(p => p.sameRow && p.inView), m.pairs);
    await pm.evaluate(() => window.scrollTo(0, 700));
    await pm.waitForTimeout(150);
    const top = await pm.evaluate(() => document.querySelector('.sticky-head').getBoundingClientRect().top);
    check('④ ' + w + '×' + h + '：スクロールしても固定部分は上端に残る', top === 0, top);
    await pm.close();
  }

  await browser.close();
  H.finish();
})().catch(e => { console.error(e); process.exit(1); });
