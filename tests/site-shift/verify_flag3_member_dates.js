// 拠点シフト表（site-shift.html）の次の4点の検証。GASはページ内の偽物（helpers.js）に差し替え、
// ネットワークには出ない。
//  1. F列3（退職・異動予定）の人を、シフト表・固定シフトの人の一覧・メンバー欄に表示する
//     （F列9の人は出ない。F列3の人のシフトのセルに入力でき、斜線にならない）
//  2. 新人登録の雇用区分の選択肢が「社員」「パート」「技能実習生」の3つ
//  3. メンバー欄の状態の表示：F列3は「退職・異動予定」
//  4. 実際の入社日・退職日（異動日）をFirestore（shiftSites/{拠点}/meta/dates）に保存し、
//     メンバー欄に表示する（PR #532で整理済み_Mの入退社の列には「月度の1日」だけを書く
//     ようになったため）：新人登録・入社日の変更・退職/異動の確定・取消・部門変更
// 実行：python3 -m http.server 8811 --directory dashboard を起動してから
//       node tests/site-shift/verify_flag3_member_dates.js
const { chromium } = require('playwright');
const { openShiftPage, normalizeNameLike } = require('./helpers');

const URL = 'http://localhost:8811/site-shift.html';
const SITE = 'いなべ';

// 整理済み_Mのメンバー（F列1・2・3・9を含み、同じ名前で雇用区分の違う人も入れる）
const MEMBERS = [
  { key: 'k1', name: '在籍 一郎', dept: '栽培', empType: '社員', flag: 1, row: 1, join: '', leave: '' },
  // F列3：leaveが月度の1日(2026-12-01)。meta/datesに実際の日付(2026-12-20、同じ月度2026-12)がある
  { key: 'kA', name: '退職 予定子', dept: '栽培', empType: '社員', flag: 3, row: 2, join: '', leave: '2026-12-01' },
  // F列3：leaveが月度の1日だが、meta/datesに実際の日付が無い
  { key: 'kB', name: '退職 不明男', dept: '出荷', empType: 'パート', flag: 3, row: 3, join: '', leave: '2026-12-01' },
  // F列2：joinが月度の1日(2026-11-01)。meta/datesに実際の日付(2026-11-11、同じ月度2026-11)がある
  { key: 'kE', name: '入社 月初子', dept: '出荷', empType: '社員', flag: 2, row: 4, join: '2026-11-01', leave: '' },
  // F列2：joinが月度の1日だが、meta/datesに実際の日付が無い
  { key: 'kF', name: '入社 謎子', dept: '配送', empType: 'パート', flag: 2, row: 5, join: '2026-11-01', leave: '' },
  // F列2：joinが日01以外（PR #532より前に書かれた実際の日付）
  { key: 'kD', name: '入社 古参子', dept: '栽培', empType: '技能実習生', flag: 2, row: 6, join: '2026-10-11', leave: '' },
  // 同じ名前で雇用区分が違う人（F列8相当は本テストでは不要。ここでは退職済み=F列9が出ないことの確認用）
  { key: 'kG', name: '退職済 完了郎', dept: '栽培', empType: '社員', flag: 9, row: 7, join: '', leave: '2026-09-01' },
  // F列1。部門変更（meta/datesに項目が無い＝移すものが無いケース）の確認用。
  // F列3・9は「部門変更」ボタンが出ない（取消ボタンのみ）ため、この確認にはF列1・2の人を使う
  { key: 'kH', name: '部門 変更郎', dept: '出荷', empType: 'パート', flag: 1, row: 8, join: '', leave: '' },
];

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const seed = {
    [`shiftSites/${SITE}/meta/members`]: { list: MEMBERS, updatedAt: 4102444800000 },
    [`shiftSites/${SITE}/months/2026-10`]: { cells: {} },
    [`shiftSites/${SITE}/months/2026-11`]: { cells: {} },
    [`shiftSites/${SITE}/meta/fixed`]: {},
    [`shiftSites/${SITE}/meta/dates`]: {
      'kA|社員|栽培': { leave: '2026-12-20' },
      'kE|社員|出荷': { join: '2026-11-11' },
    },
  };
  const page = await openShiftPage(ctx, { seed, members: MEMBERS });
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
  // GASへ送ったPOSTの内容を記録する（既存のpage.route差し替えより後でも、requestイベントは
  // 実際に発生した通信を横から見るだけなので干渉しない）
  const gasCalls = [];
  page.on('request', req => {
    if (!/script\.google\.com/.test(req.url()) || req.method() !== 'POST') return;
    try { gasCalls.push(JSON.parse(req.postData() || '{}')); } catch (e) { /* 無視 */ }
  });
  await page.goto(URL);
  await page.waitForSelector('#grid tbody td.name[data-r]');

  /* ===================== 1. F列3の表示・F列9は出ない ===================== */
  const gridNames = await page.$$eval('#grid tbody td.name[data-r]', tds => tds.map(td => td.firstChild.textContent));
  check('シフト表：F列3(退職・異動予定)の人が出る', gridNames.includes('退職 予定子') && gridNames.includes('退職 不明男'), JSON.stringify(gridNames));
  check('シフト表：F列9(退職済み)の人は出ない', !gridNames.includes('退職済 完了郎'), JSON.stringify(gridNames));

  const fxNames = await page.$$eval('#fxPerson option', os => os.map(o => o.textContent));
  check('固定シフトの一覧：F列3の人が出る', fxNames.some(t => t.includes('退職 予定子')), JSON.stringify(fxNames));
  check('固定シフトの一覧：F列9の人は出ない', !fxNames.some(t => t.includes('退職済 完了郎')), JSON.stringify(fxNames));

  const memKeys = await page.$$eval('#memTable tr[data-key]', trs => trs.map(tr => tr.dataset.key));
  check('メンバー欄：F列3の人が出る', memKeys.includes('kA') && memKeys.includes('kB'), JSON.stringify(memKeys));
  check('メンバー欄：F列9の人は出ない', !memKeys.includes('kG'), JSON.stringify(memKeys));

  // F列3の人のシフトのセルに入力できる（斜線=class"na"にならない）
  const rIdx = gridNames.indexOf('退職 予定子');
  const naClasses = await page.$$eval(`#grid tbody td.cell[data-r="${rIdx}"]`, tds => tds.map(td => td.className));
  check('F列3の人のセルは斜線(na)にならない', naClasses.every(c => !c.includes('na')), JSON.stringify(naClasses));
  await page.click(`#grid td.cell[data-r="${rIdx}"][data-c="1"]`);
  await page.keyboard.type('8-17');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const written = await page.evaluate(site => (window.__db[`shiftSites/${site}/months/2026-10`] || {}).cells?.kA, SITE);
  check('F列3の人のセルに実際に入力できる', (written || {})['2026-10-12'] === '8:00-17:00', JSON.stringify(written));

  /* ===================== 2. 雇用区分の選択肢 ===================== */
  const empOpts = await page.$$eval('#newEmp option', os => os.map(o => o.textContent));
  check('新人登録の雇用区分は「社員」「パート」「技能実習生」の3つ', eq(empOpts, ['社員', 'パート', '技能実習生']), JSON.stringify(empOpts));

  /* ===================== 3. 状態の表示 ===================== */
  const flagText = await page.textContent('#memTable tr[data-key="kA"] td:nth-child(4)');
  check('F列3の状態表示は「退職・異動予定」', flagText.trim() === '退職・異動予定', flagText);

  /* ===================== 1(続き). F列3の取消ボタン ===================== */
  const undoBtn = await page.$('#memTable tr[data-key="kA"] button[data-act="undo"]');
  check('F列3の人に取消ボタンが出る', !!undoBtn, undoBtn);
  await page.click('#memTable tr[data-key="kA"] button[data-act="undo"]');
  await page.waitForTimeout(300);
  check('取消でundoRetireが送られる(key=kA)', gasCalls.some(c => c.action === 'undoRetire' && c.key === 'kA'), JSON.stringify(gasCalls));
  const datesAfterUndo = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/dates`], SITE);
  check('取消でkAのleaveがmeta/datesから消える', !datesAfterUndo['kA|社員|栽培']?.leave, JSON.stringify(datesAfterUndo));

  /* ===================== 4. 表示：実際の日付／年月だけ ===================== */
  const leaveA = await page.textContent('#memTable tr[data-key="kB"] td:nth-child(6)'); // kAは取消済みなので変化前のkBで確認
  // meta/dates一致なし → 年月だけ
  check('meta/datesが無いときは年月だけ表示される(2026/12)', leaveA.trim() === '2026/12', leaveA);

  // kE・kFもF列2のため入社日の列は入力欄(.join-input)になる。初期値はresolveDate()の
  // ルールどおり（実際の日付が使えるときはその日付、使えないときは整理済み_Mの値）になる
  const joinEVal = await page.inputValue('#memTable tr[data-key="kE"] input.join-input');
  check('整理済み_Mの値が月度の1日・meta/datesの月度が同じときは、入力欄の初期値が実際の日付(2026-11-11)になる', joinEVal === '2026-11-11', joinEVal);

  const joinFVal = await page.inputValue('#memTable tr[data-key="kF"] input.join-input');
  check('meta/datesが無いときは、入力欄の初期値が整理済み_Mの値のまま(2026-11-01)になる', joinFVal === '2026-11-01', joinFVal);

  // kDはF列2のため入社日の列は編集欄(.join-input)になる。整理済み_Mの値の日が01以外
  // （PR #532より前に書かれた実際の日付）なので、そのまま入力欄の初期値になる
  const joinDVal = await page.inputValue('#memTable tr[data-key="kD"] input.join-input');
  check('整理済み_Mの値の日が01以外(PR #532より前)は、そのまま入力欄の初期値になる(2026-10-11)', joinDVal === '2026-10-11', joinDVal);

  /* ===================== 4. 新人登録 ===================== */
  await page.fill('#newName', '新人 花子');
  await page.selectOption('#newRole', '栽培');
  await page.selectOption('#newEmp', 'パート');
  await page.fill('#newJoin', '2026-10-15');
  await page.click('#addForm button[type=submit]');
  await page.waitForTimeout(400);
  const newKey = normalizeNameLike('新人 花子');
  check('新人登録でaddMemberが送られる', gasCalls.some(c => c.action === 'addMember' && c.name === '新人 花子' && c.empType === 'パート' && c.dept === '栽培'), JSON.stringify(gasCalls));
  const datesAfterAdd = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/dates`], SITE);
  check('新人登録でmeta/datesにjoinが書かれる', datesAfterAdd[`${newKey}|パート|栽培`]?.join === '2026-10-15', JSON.stringify(datesAfterAdd));

  /* ===================== 4. 入社日の変更 ===================== */
  await page.fill('#memTable tr[data-key="kD"] input.join-input', '2026-10-20');
  await page.dispatchEvent('#memTable tr[data-key="kD"] input.join-input', 'change');
  await page.waitForTimeout(400);
  check('入社日の変更でsetJoinDateが送られる(key=kD)', gasCalls.some(c => c.action === 'setJoinDate' && c.key === 'kD' && c.date === '2026-10-20'), JSON.stringify(gasCalls));
  const datesAfterJoin = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/dates`], SITE);
  check('入社日の変更でmeta/datesにjoinが書かれる(kD)', datesAfterJoin['kD|技能実習生|栽培']?.join === '2026-10-20', JSON.stringify(datesAfterJoin));

  /* ===================== 4. 退職・異動の確定 ===================== */
  await page.click('#memTable tr[data-key="k1"] button[data-act="leave"]');
  await page.fill('#memTable #leaveDate', '2026-12-25');
  await page.selectOption('#memTable #leaveFlag', '9');
  await page.click('#memTable button[data-act="ok"]');
  await page.waitForTimeout(400);
  check('退職の確定でretireが送られる(key=k1, date=2026-12-25)', gasCalls.some(c => c.action === 'retire' && c.key === 'k1' && c.date === '2026-12-25'), JSON.stringify(gasCalls));
  const datesAfterRetire = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/dates`], SITE);
  check('退職の確定でmeta/datesにleaveが書かれる(k1)', datesAfterRetire['k1|社員|栽培']?.leave === '2026-12-25', JSON.stringify(datesAfterRetire));

  /* ===================== 4. 部門変更：項目（あれば）が新しいキーに移る ===================== */
  // kE（meta/datesにjoin:'2026-11-11'がある）の部門を出荷→栽培・配送に変える
  await page.click('#memTable tr[data-key="kE"] button[data-act="dept"]');
  await page.selectOption('#memTable #newDept', '栽培・配送');
  await page.click('#memTable button[data-act="deptOk"]');
  await page.waitForTimeout(400);
  check('部門変更でchangeDeptが送られる(key=kE, dept=栽培・配送)', gasCalls.some(c => c.action === 'changeDept' && c.key === 'kE' && c.dept === '栽培・配送'), JSON.stringify(gasCalls));
  const datesAfterDeptE = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/dates`], SITE);
  check('部門変更でkEの古いキー(出荷)は消える', !datesAfterDeptE['kE|社員|出荷'], JSON.stringify(datesAfterDeptE));
  check('部門変更でkEの項目(join)が新しいキー(栽培・配送)に移る', datesAfterDeptE['kE|社員|栽培・配送']?.join === '2026-11-11', JSON.stringify(datesAfterDeptE));

  // kH（F列1、meta/datesに項目が無い）の部門変更：移す項目が無いので、新しいキーも作られない
  // （F列3・9の人は「部門変更」ボタン自体が出ない＝取消のみのため、F列1のkHを使う）
  await page.click('#memTable tr[data-key="kH"] button[data-act="dept"]');
  await page.selectOption('#memTable #newDept', '配送');
  await page.click('#memTable button[data-act="deptOk"]');
  await page.waitForTimeout(400);
  check('部門変更でchangeDeptが送られる(key=kH, dept=配送)', gasCalls.some(c => c.action === 'changeDept' && c.key === 'kH' && c.dept === '配送'), JSON.stringify(gasCalls));
  const datesAfterDeptH = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/dates`], SITE);
  check('部門変更でkHの古いキー(出荷)は消える(もともと項目は無い)', !datesAfterDeptH['kH|パート|出荷'], JSON.stringify(datesAfterDeptH));
  check('部門変更でkHの新しいキー(配送)にも項目は作られない', !datesAfterDeptH['kH|パート|配送'], JSON.stringify(datesAfterDeptH));

  /* ===================== meta/datesの読み込みがエラーになっても、シフト表・固定シフトは
     そのまま動き、メンバー欄の日付は整理済み_Mの値だけ（年月）で表示される ===================== */
  {
    const seed2 = {
      [`shiftSites/${SITE}/meta/members`]: { list: MEMBERS, updatedAt: 4102444800000 },
      [`shiftSites/${SITE}/months/2026-10`]: { cells: {} },
      [`shiftSites/${SITE}/months/2026-11`]: { cells: {} },
      [`shiftSites/${SITE}/meta/fixed`]: {},
      [`shiftSites/${SITE}/meta/dates`]: { 'kA|社員|栽培': { leave: '2026-12-20' } },
      __errorPaths: [`shiftSites/${SITE}/meta/dates`],
    };
    const page2 = await openShiftPage(ctx, { seed: seed2, members: MEMBERS });
    const warnings = [];
    page2.on('console', msg => { if (msg.type() === 'warning') warnings.push(msg.text()); });
    page2.on('pageerror', e => check('meta/datesがエラーでもページでエラーが出ない', false, e.message));
    await page2.goto(URL);
    await page2.waitForSelector('#grid tbody td.name[data-r]', { timeout: 8000 }).then(() => true, () => false);
    const names2 = await page2.$$eval('#grid tbody td.name[data-r]', tds => tds.map(td => td.firstChild.textContent)).catch(() => []);
    check('meta/datesがエラーでもシフト表は表示される', names2.includes('退職 予定子'), JSON.stringify(names2));
    const fxNames2 = await page2.$$eval('#fxPerson option', os => os.map(o => o.textContent)).catch(() => []);
    check('meta/datesがエラーでも固定シフトの一覧は表示される', fxNames2.some(t => t.includes('退職 予定子')), JSON.stringify(fxNames2));
    // meta/datesにleave:'2026-12-20'があっても、読み込みに失敗しているため使われず、
    // 整理済み_Mの値(2026-12-01)から年月だけが表示される
    const leaveA2 = await page2.textContent('#memTable tr[data-key="kA"] td:nth-child(6)').catch(() => '');
    check('meta/datesがエラーのときは年月だけ表示される(2026/12)', leaveA2.trim() === '2026/12', leaveA2);
    check('console.warnでエラーが記録される', warnings.some(w => w.includes('meta/dates')), JSON.stringify(warnings));
    await page2.close();
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
