// 拠点シフト表（site-shift.html）の「並び順」機能の検証。
// Firebase（認証・Firestore）とGASはページ内の偽物に差し替え、ネットワークには出ない。
// 確かめること：
//  - 並び順を保存していないときは今まで通り「部門 → 整理済み_Mの行の順」
//  - 条件で並べ替え（部門・出勤時刻・勤務時間の3段、向きの切り替え、値のない人は下）
//  - Alt+↑↓ / ▲▼ボタン / 氏名のドラッグで手動で動かせ、選択が動かした人について行く
//  - 部門の絞り込み中は、隠れている人をとばして動く
//  - 並び順は meta/order に保存され、印刷・固定シフトの人選びにも同じ順で出る
//  - ほかの人が並び順を変えると画面に届く／元の並びに戻せる
//  - スマホの入力パネルの「人を上へ／下へ」
// 実行：python3 -m http.server 8811 --directory dashboard を起動してから node tests/site-shift/verify_row_order.js
const { chromium } = require('playwright');

const URL = 'http://localhost:8811/site-shift.html';
const SITE = 'いなべ';

// 整理済み_Mのメンバー（row＝整理済み_Mの行）
const MEMBERS = [
  { key: 'k1', name: '栽培 一郎', dept: '栽培', empType: 'アルバイト', flag: 1, row: 5, join: '2024-04-01' },
  { key: 'k2', name: '栽培 二郎', dept: '栽培', empType: '社員', flag: 1, row: 3, join: '2020-04-01' },
  { key: 'k3', name: '出荷 三子', dept: '出荷', empType: 'アルバイト', flag: 1, row: 2, join: '2023-01-10' },
  { key: 'k4', name: '出荷 四子', dept: '出荷', empType: '技能実習生', flag: 1, row: 7, join: '2025-06-01' },
  { key: 'k5', name: '配送 五郎', dept: '配送', empType: '社員', flag: 1, row: 1, join: '2019-09-01' },
  { key: 'k6', name: '栽培 六美', dept: '栽培', empType: 'アルバイト', flag: 2, row: 9, join: '2026-10-01' },
];
// 期間 10/11〜11/10 のシフト
function cells() {
  const c = {};
  const put = (key, days, v) => days.forEach(d => { (c[key] ||= {})[`2026-10-${String(d).padStart(2, '0')}`] = v; });
  put('k1', [12, 13, 14, 15], '8:00-17:00');          // 栽培 8時 32h
  put('k2', [12, 13], '9:00-15:00');                  // 栽培 9時 10h
  put('k6', [12, 13, 14, 15, 16], '8:00-17:00');      // 栽培 8時 40h
  put('k3', [12, 13, 14], '13:00-17:00');             // 出荷 13時 12h
  put('k4', [12, 13], '8:00-12:00');                  // 出荷 8時 8h
  // k5（配送）はシフトなし → 出勤時刻・勤務時間は「値なし」
  return c;
}

function fakeFirebase(seed) {
  // ページの中で動く、最低限の Firebase compat の偽物
  const DEL = { __del: true };
  const db = JSON.parse(JSON.stringify(seed));
  const subs = {};
  window.__db = db;
  window.__writes = [];
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const snapOf = path => ({ exists: path in db, data: () => clone(db[path]), metadata: { fromCache: false, hasPendingWrites: false } });
  const notify = path => (subs[path] || []).forEach(cb => setTimeout(() => cb(snapOf(path)), 0));
  const merge = (dst, src) => {
    Object.entries(src).forEach(([k, v]) => {
      if (v && v.__del) delete dst[k];
      else if (v && typeof v === 'object' && !Array.isArray(v)) merge(dst[k] && typeof dst[k] === 'object' ? dst[k] : (dst[k] = {}), v);
      else dst[k] = v;
    });
    return dst;
  };
  const ref = path => ({
    path,
    collection: n => ({ doc: id => ref(`${path}/${n}/${id}`) }),
    onSnapshot(a, b, c) {
      const cb = typeof a === 'function' ? a : b;
      (subs[path] ||= []).push(cb);
      setTimeout(() => cb(snapOf(path)), 0);
      return () => { subs[path] = subs[path].filter(x => x !== cb); };
    },
    get: async () => snapOf(path),
    async set(data, opt) {
      window.__writes.push({ path, data: clone(data) });
      db[path] = opt && opt.merge ? merge(db[path] || {}, data) : merge({}, data);
      notify(path);
    },
  });
  window.__remoteSet = (path, data) => { db[path] = data; notify(path); };
  const firestore = () => ({
    enablePersistence: async () => {},
    collection: n => ({ doc: id => ref(`${n}/${id}`) }),
    runTransaction: async fn => fn({ get: async r => snapOf(r.path), set: (r, d) => { db[r.path] = d; notify(r.path); } }),
  });
  firestore.FieldValue = { delete: () => DEL, serverTimestamp: () => Date.now() };
  const user = { email: 'tester@example.com' };
  const authObj = { currentUser: user, onAuthStateChanged: cb => setTimeout(() => cb(user), 0), signOut: async () => {}, signInWithPopup: async () => {} };
  const auth = () => authObj;
  auth.GoogleAuthProvider = class { setCustomParameters() {} };
  window.firebase = { initializeApp() {}, firestore, auth };
}

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
  const seed = {
    [`shiftSites/${SITE}/meta/members`]: { list: MEMBERS, updatedAt: 4102444800000 },
    [`shiftSites/${SITE}/months/2026-10`]: { cells: cells() },
    [`shiftSites/${SITE}/months/2026-11`]: { cells: {} },
    [`shiftSites/${SITE}/meta/fixed`]: {},
  };
  await page.addInitScript(() => {
    const FIXED = new Date(2026, 9, 23, 9).getTime(), D = Date;
    window.Date = class extends D { constructor(...a) { return a.length ? new D(...a) : new D(FIXED); } static now() { return FIXED; } };
  });
  // 後から登録した route が優先される
  await page.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/gstatic\.com\/firebasejs\/.*app-compat\.js/, r => r.fulfill({ contentType: 'text/javascript', body: `(${fakeFirebase})(${JSON.stringify(seed)});` }));
  await page.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok', members: MEMBERS, shifts: [], fixed: {} }) }));
  await page.goto(URL);
  await page.waitForSelector('#grid tbody td.name[data-r]');

  const names = () => page.$$eval('#grid tbody td.name[data-r]', tds => tds.map(td => td.firstChild.textContent));
  const saved = () => page.evaluate(site => (window.__db[`shiftSites/${site}/meta/order`] || {}).keys || null, SITE);
  const wait = ms => page.waitForTimeout(ms);
  const nm = keys => keys.map(k => MEMBERS.find(m => m.key === k).name);

  // 1) 並び順なし：部門 → 整理済み_Mの行
  check('並び順なしは部門→整理済み_Mの行の順', eq(await names(), ['栽培 二郎', '栽培 一郎', '栽培 六美', '出荷 三子', '出荷 四子', '配送 五郎']), await names());

  // 2) 条件で並べ替え：部門 → 出勤時刻（早い順）→ 勤務時間（多い順）（既定の条件）
  await page.click('#sortBtn');
  check('並べ替えの条件欄が3段出る', (await page.$$('.sort-row')).length === 3, '');
  await page.click('#srtGo');
  await wait(500);
  const s1 = ['栽培 六美', '栽培 一郎', '栽培 二郎', '出荷 四子', '出荷 三子', '配送 五郎'];
  check('部門→出勤時刻→勤務時間で並ぶ', eq(await names(), s1), await names());
  check('並び順と条件が meta/order に保存される', eq(nm(await saved() || []), s1)
    && eq(await page.evaluate(s => window.__db[`shiftSites/${s}/meta/order`].rules, SITE), [{ key: 'dept', dir: 0 }, { key: 'start', dir: 0 }, { key: 'hours', dir: 0 }]), await saved());

  // 3) 勤務時間（少ない順）だけ：値のない人（配送 五郎）は下
  await page.click('#sortBtn');
  await page.selectOption('.sort-row[data-i="0"] [data-f=key]', 'hours');
  check('条件を変えると向きの選択肢が変わる', eq(await page.$$eval('.sort-row[data-i="0"] [data-f=dir] option', o => o.map(x => x.textContent)), ['多い順', '少ない順']), '');
  await page.selectOption('.sort-row[data-i="0"] [data-f=dir]', '1');
  await page.selectOption('.sort-row[data-i="1"] [data-f=key]', '');
  await page.selectOption('.sort-row[data-i="2"] [data-f=key]', '');
  await page.click('#srtGo');
  await wait(500);
  check('勤務時間の少ない順、シフトのない人は下', eq(await names(), ['出荷 四子', '栽培 二郎', '出荷 三子', '栽培 一郎', '栽培 六美', '配送 五郎']), await names());
  check('前回の条件がダイアログに残る', await (async () => { await page.click('#sortBtn'); const v = await page.$eval('.sort-row[data-i="0"] [data-f=key]', s => s.value); await page.click('#dlgNo'); return v === 'hours'; })(), '');

  // 雇用区分・入社日
  await page.click('#sortBtn');
  await page.selectOption('.sort-row[data-i="0"] [data-f=key]', 'emp');
  await page.selectOption('.sort-row[data-i="1"] [data-f=key]', 'join');
  await page.click('#srtGo');
  await wait(500);
  check('雇用区分→入社日（古い順）', eq(await names(), ['配送 五郎', '栽培 二郎', '出荷 三子', '栽培 一郎', '栽培 六美', '出荷 四子']), await names());

  // 4) Alt+↓：セルを選んで1つ下へ。選択がついて行く
  await page.click('#grid td.cell[data-r="1"][data-c="2"]');
  await page.keyboard.press('Alt+ArrowDown');
  await wait(500);
  check('Alt+↓で1つ下へ', eq(await names(), ['配送 五郎', '出荷 三子', '栽培 二郎', '栽培 一郎', '栽培 六美', '出荷 四子']), await names());
  check('カーソルが動かした人について行く', await page.$eval('td.cell.cursor', td => td.dataset.r + ',' + td.dataset.c) === '2,2', '');
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  await wait(500);
  check('Alt+↑を2回で先頭へ', eq((await names()).slice(0, 3), ['栽培 二郎', '配送 五郎', '出荷 三子']), await names());
  check('先頭でさらに↑しても変わらない', await (async () => { await page.keyboard.press('Alt+ArrowUp'); await wait(400); return (await names())[0] === '栽培 二郎'; })(), await names());
  check('手動の並びも保存される', eq(nm(await saved()), await names()), await saved());

  // 5) ▲▼ボタン（押しても選択が外れない）
  await page.click('#grid td.cell[data-r="5"][data-c="0"]'); // 出荷 四子
  await page.click('#rowUp');
  await wait(400);
  check('▲ボタンで1つ上へ', (await names())[4] === '出荷 四子' && await page.$eval('td.cell.cursor', td => td.dataset.r) === '4', await names());

  // 6) 複数人：氏名クリック → Shift+氏名クリックで2人選び、▼で動かす
  const before = await names();
  await page.click('#grid td.name[data-r="0"]');
  await page.click('#grid td.name[data-r="1"]', { modifiers: ['Shift'] });
  check('氏名クリックで行全体を選ぶ', await page.$$eval('td.cell.in-sel', t => t.length) === 2 * 31, await page.$$eval('td.cell.in-sel', t => t.length));
  await page.click('#rowDown');
  await wait(400);
  check('2人まとめて1つ下へ', eq(await names(), [before[2], before[0], before[1], ...before.slice(3)]), await names());

  // 7) 氏名のドラッグ：先頭の人を最後の人の下へ
  const b2 = await names();
  const src = await page.$('#grid td.name[data-r="0"]'), dst = await page.$('#grid td.name[data-r="5"]');
  const sb = await src.boundingBox(), db = await dst.boundingBox();
  await page.mouse.move(sb.x + 20, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(db.x + 20, db.y + db.height / 2, { steps: 8 });
  check('ドラッグ中は落とす位置に線が出る', !!(await page.$('#grid tr.drop-after')), '');
  await page.mouse.up();
  await wait(400);
  check('氏名のドラッグで最後へ', eq(await names(), [...b2.slice(1), b2[0]]), await names());
  check('ドラッグした人が選ばれたまま', await page.$eval('td.name.row-sel', td => td.firstChild.textContent) === b2[0], '');

  // 8) 部門の絞り込み中：隠れている人をとばす
  const full = await names();
  await page.uncheck('#edd-出荷');
  await wait(200);
  const vis = await names();
  await page.click('#grid td.cell[data-r="1"][data-c="0"]');
  await page.keyboard.press('Alt+ArrowUp');
  await wait(400);
  const vis2 = await names();
  check('絞り込み中は見えている人の間で動く', eq(vis2, [vis[1], vis[0], ...vis.slice(2)]), vis2);
  await page.check('#edd-出荷');
  await wait(200);
  const full2 = await names();
  check('隠れていた人も含めて全員が残る', eq([...full2].sort(), [...full].sort()) && full2.length === 6, full2);

  // 9) 印刷と固定シフトの人選びも同じ順
  await page.click('#tabPrint');
  await wait(300);
  const pp = await page.$$eval('#printPage tbody td.nm', t => t.map(x => x.textContent));
  check('印刷の表も同じ並び', eq(pp, full2), pp);
  await page.click('#tabEdit');
  const fx = await page.$$eval('#fxPerson option', o => o.map(x => x.textContent.replace(/（.*$/, '')));
  check('固定シフトの人選びも同じ並び', eq(fx, full2), fx);

  // 10) ほかの人が並び順を変えたら届く
  const remote = ['k5', 'k4', 'k3', 'k2', 'k1', 'k6'];
  await page.evaluate(([s, keys]) => window.__remoteSet(`shiftSites/${s}/meta/order`, { keys, rules: null }), [SITE, remote]);
  await wait(300);
  check('ほかの人の並べ替えが画面に届く', eq(await names(), nm(remote)), await names());

  // 11) 元の並びに戻す
  await page.click('#sortBtn');
  await page.click('#srtReset');
  await wait(500);
  check('元の並び（部門→整理済み_Mの順）に戻る', eq(await names(), ['栽培 二郎', '栽培 一郎', '栽培 六美', '出荷 三子', '出荷 四子', '配送 五郎']), await names());
  check('戻すと保存した並びが空になる', eq(await saved(), []), await saved());

  // 12) スマホ：入力パネルの「人を下へ」
  const mob = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const mp = await mob.newPage();
  mp.on('pageerror', e => check('スマホでエラーが出ない', false, e.message));
  await mp.addInitScript(() => {
    const FIXED = new Date(2026, 9, 23, 9).getTime(), D = Date;
    window.Date = class extends D { constructor(...a) { return a.length ? new D(...a) : new D(FIXED); } static now() { return FIXED; } };
  });
  await mp.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await mp.route(/gstatic\.com\/firebasejs\/.*app-compat\.js/, r => r.fulfill({ contentType: 'text/javascript', body: `(${fakeFirebase})(${JSON.stringify(seed)});` }));
  await mp.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok', members: MEMBERS, shifts: [], fixed: {} }) }));
  await mp.goto(URL);
  await mp.waitForSelector('#grid tbody td.name[data-r]');
  await mp.tap('#grid td.cell[data-r="0"][data-c="1"]');
  await mp.waitForSelector('#mbar:not([hidden])');
  await mp.tap('.mbar-nav [data-row="1"]');
  await mp.waitForTimeout(400);
  const mn = await mp.$$eval('#grid tbody td.name[data-r]', tds => tds.map(td => td.firstChild.textContent));
  check('スマホの「人を下へ」で1つ下へ', mn[0] === '栽培 一郎' && mn[1] === '栽培 二郎', mn);
  check('スマホでパネルの人も動かした人のまま', await mp.$eval('#mbWho', e => e.textContent) === '栽培 二郎', await mp.$eval('#mbWho', e => e.textContent));
  const over = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('スマホ幅で横にはみ出さない（ページ全体）', over <= 0, over);

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} 件OK`);
  process.exit(ng ? 1 : 0);
})();
