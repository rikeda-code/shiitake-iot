// 拠点シフト表（site-shift.html）の「組織内の変更（changeOrg）・入社取消（cancelJoin）・
// 入社取消/組織内の変更の取消・同じ名前の行が2つあるときの見分け方」の検証。
// Firebase（認証・Firestore）とGASはページ内の偽物（helpers.js）に差し替え、ネットワークには出ない。
// 「今日」はhelpers.jsのopenShiftPageにより2026-10-23に固定される（今の月度=2026-10）。
// 確かめること：
//  - ボタン：F列1は「組織内の変更」「退職・異動」（部門変更は無い）。F列2は「組織内の変更」
//    「入社取消」「退職・異動」。F列3は「取消」のまま
//  - 組織内の変更の入力：F列1は変更日（初期値＝今日より後の最初の11日）・新しい部門・新しい
//    雇用区分。F列2は変更日なし。部門・雇用区分がどちらも今と同じなら確定を押せない。
//    F列1で変更日が11日でないときは注意書きが出る（確定は止めない）
//  - 確定でchangeOrgが送られ、mode:overwrite／mode:splitそれぞれでmeta/datesへの書き込みが
//    変わる（overwrite：古いキーを新しいキーへ移す。split：元のキーにleave+orgTo、新しいキーにjoin）
//  - 入社取消：確認ダイアログ→cancelJoinが送られ、meta/datesにcanceled:trueが付く
//  - 取消（undoRetire）：meta/datesにorgToがあればペイロードに付けて送り、成功したら新しい行の
//    キーにcanceled:trueを付ける。戻り値のwarningがあればトーストで出る
//  - 入社取消になった行（canceled:true かつ F列3・入退社が空）は、シフト表・固定シフトの人の
//    一覧・メンバー欄のどこにも出ない
//  - 同じ名前の行が2つ以上あるとき：メンバー欄・シフト表は行ごとに出す（シフト表の持ち主でない
//    日の扱いはverify_two_row_display.jsで検証）。固定シフトの一覧は実際の日付で
//    「今日が入社日〜最終在籍日」に入る行を1つだけ出す
// 実行：python3 -m http.server 8811 --directory dashboard を起動してから
//       node tests/site-shift/verify_org_change.js
const { chromium } = require('playwright');
const { openShiftPage } = require('./helpers');

const URL = 'http://localhost:8811/site-shift.html';
const SITE = 'いなべ';

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }

function baseSeed(members, dates) {
  return {
    [`shiftSites/${SITE}/meta/members`]: { list: members, updatedAt: 4102444800000 },
    [`shiftSites/${SITE}/months/2026-10`]: { cells: {} },
    [`shiftSites/${SITE}/months/2026-11`]: { cells: {} },
    [`shiftSites/${SITE}/meta/fixed`]: {},
    [`shiftSites/${SITE}/meta/dates`]: dates || {},
  };
}

(async () => {
  const browser = await chromium.launch();

  /* ===================== ボタン：F列ごとの操作 ===================== */
  {
    const MEMBERS = [
      { key: 'b1', name: '在籍 太郎', dept: '栽培', empType: '社員', flag: 1, row: 1, join: '', leave: '' },
      { key: 'b2', name: '入社 花子', dept: '出荷', empType: 'パート', flag: 2, row: 2, join: '2026-11-01', leave: '' },
      { key: 'b3', name: '予定 次郎', dept: '栽培', empType: '社員', flag: 3, row: 3, join: '', leave: '2026-12-01' },
    ];
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS), members: MEMBERS });
    page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-key]');

    const actsOf = async key => page.$$eval(`#memTable tr[data-key="${key}"] button`, bs => bs.map(b => b.dataset.act));
    check('F列1のボタンは組織内の変更・退職異動（部門変更は無い）', JSON.stringify(await actsOf('b1')) === JSON.stringify(['org', 'leave']), await actsOf('b1'));
    check('F列2のボタンは組織内の変更・入社取消・退職異動', JSON.stringify(await actsOf('b2')) === JSON.stringify(['org', 'cancelJoin', 'leave']), await actsOf('b2'));
    // F列3は「取消」に加えて「退職・異動」も出す（動きはF列1と同じ）
    check('F列3のボタンは取消・退職異動', JSON.stringify(await actsOf('b3')) === JSON.stringify(['undo', 'leave']), await actsOf('b3'));
    await page.close(); await ctx.close();
  }

  /* ===================== 組織内の変更の入力：初期値・確定の有効無効・注意書き ===================== */
  {
    const MEMBERS = [
      { key: 'c1', name: '変更 一郎', dept: '栽培', empType: '社員', flag: 1, row: 1, join: '', leave: '' },
      { key: 'c2', name: '変更 花子', dept: '出荷', empType: 'パート', flag: 2, row: 2, join: '2026-11-01', leave: '' },
    ];
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS), members: MEMBERS });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-key]');

    // F列1：変更日の初期値は今日(2026-10-23)より後の最初の11日＝2026-11-11
    await page.click('#memTable tr[data-key="c1"] button[data-act="org"]');
    const dateVal = await page.inputValue('#memTable #orgDate');
    check('F列1の組織内の変更：変更日の初期値は今日より後の最初の11日(2026-11-11)', dateVal === '2026-11-11', dateVal);
    check('F列1の組織内の変更：確定は最初は押せない(今と同じ部門・雇用区分のため)', await page.isDisabled('#memTable #orgOk'), await page.isDisabled('#memTable #orgOk'));
    check('F列1の組織内の変更：変更日が11日なので注意書きは出ない', await page.isHidden('#memTable #orgNote'), await page.isHidden('#memTable #orgNote'));
    await page.selectOption('#memTable #orgDept', '出荷');
    check('F列1の組織内の変更：部門を変えると確定が押せる', !(await page.isDisabled('#memTable #orgOk')), await page.isDisabled('#memTable #orgOk'));
    await page.selectOption('#memTable #orgDept', '栽培'); // 元に戻す
    check('F列1の組織内の変更：部門・雇用区分を元に戻すと確定がまた押せなくなる', await page.isDisabled('#memTable #orgOk'), await page.isDisabled('#memTable #orgOk'));
    await page.fill('#memTable #orgDate', '2026-11-20');
    await page.dispatchEvent('#memTable #orgDate', 'change');
    check('F列1の組織内の変更：変更日が11日でないと注意書きが出る', !(await page.isHidden('#memTable #orgNote')), await page.isHidden('#memTable #orgNote'));
    await page.selectOption('#memTable #orgEmp', 'パート');
    check('F列1の組織内の変更：雇用区分を変えても確定は押せる（注意書きは確定を止めない）', !(await page.isDisabled('#memTable #orgOk')), await page.isDisabled('#memTable #orgOk'));
    await page.click('#memTable button[data-act="cancel"]');

    // F列2：変更日の入力欄が無い
    await page.click('#memTable tr[data-key="c2"] button[data-act="org"]');
    check('F列2の組織内の変更：変更日の入力欄が無い', await page.$('#memTable #orgDate') === null, '');
    check('F列2の組織内の変更：確定は最初は押せない', await page.isDisabled('#memTable #orgOk'), await page.isDisabled('#memTable #orgOk'));
    await page.close(); await ctx.close();
  }

  /* ===================== changeOrg：mode:overwrite（F列2）の送信とmeta/dates ===================== */
  {
    const MEMBERS = [
      { key: 'd1', name: '上書 花子', dept: '出荷', empType: 'パート', flag: 2, row: 1, join: '2026-11-01', leave: '' },
    ];
    const dates = { 'd1|パート|出荷': { join: '2026-11-05' } };
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS, dates), members: MEMBERS });
    const gasCalls = [];
    page.on('request', req => {
      if (!/script\.google\.com/.test(req.url()) || req.method() !== 'POST') return;
      try { gasCalls.push(JSON.parse(req.postData() || '{}')); } catch (e) { /* 無視 */ }
    });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-key]');

    await page.click('#memTable tr[data-key="d1"] button[data-act="org"]');
    await page.selectOption('#memTable #orgDept', '栽培');
    await page.selectOption('#memTable #orgEmp', '社員');
    await page.click('#memTable button[data-act="orgOk"]');
    await page.waitForTimeout(400);
    check('changeOrgが正しい内容で送られる(overwrite)', gasCalls.some(c => c.action === 'changeOrg' && c.key === 'd1' && c.empType === 'パート' && c.dept === '出荷' && c.newEmpType === '社員' && c.newDept === '栽培'), JSON.stringify(gasCalls));
    const datesAfter = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/dates`], SITE);
    check('overwrite：古いキー(d1|パート|出荷)は消える', !datesAfter['d1|パート|出荷'], JSON.stringify(datesAfter));
    check('overwrite：項目(join)が新しいキー(d1|社員|栽培)に移る', datesAfter['d1|社員|栽培']?.join === '2026-11-05', JSON.stringify(datesAfter));
    await page.close(); await ctx.close();
  }

  /* ===================== changeOrg：mode:split（F列1）の送信とmeta/dates ===================== */
  {
    const MEMBERS = [
      { key: 'e1', name: '分割 太郎', dept: '栽培', empType: '社員', flag: 1, row: 1, join: '', leave: '' },
    ];
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS), members: MEMBERS });
    const gasCalls = [];
    page.on('request', req => {
      if (!/script\.google\.com/.test(req.url()) || req.method() !== 'POST') return;
      try { gasCalls.push(JSON.parse(req.postData() || '{}')); } catch (e) { /* 無視 */ }
    });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-key]');

    await page.click('#memTable tr[data-key="e1"] button[data-act="org"]');
    await page.fill('#memTable #orgDate', '2026-12-11');
    await page.selectOption('#memTable #orgDept', '出荷');
    await page.click('#memTable button[data-act="orgOk"]');
    await page.waitForTimeout(400);
    check('changeOrgが正しい内容で送られる(split)', gasCalls.some(c => c.action === 'changeOrg' && c.key === 'e1' && c.date === '2026-12-11' && c.newDept === '出荷' && c.newEmpType === '社員'), JSON.stringify(gasCalls));
    const datesAfter = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/dates`], SITE);
    check('split：元のキー(e1|社員|栽培)にleave(変更日の前日=2026-12-10)とorgToが付く', datesAfter['e1|社員|栽培']?.leave === '2026-12-10' && datesAfter['e1|社員|栽培']?.orgTo?.empType === '社員' && datesAfter['e1|社員|栽培']?.orgTo?.dept === '出荷', JSON.stringify(datesAfter));
    check('split：新しいキー(e1|社員|出荷)にjoin(変更日)が付く', datesAfter['e1|社員|出荷']?.join === '2026-12-11', JSON.stringify(datesAfter));
    await page.close(); await ctx.close();
  }

  /* ===================== 入社取消（cancelJoin）===================== */
  {
    const MEMBERS = [
      { key: 'f1', name: '取消 花子', dept: '栽培', empType: 'パート', flag: 2, row: 1, join: '2026-11-01', leave: '' },
    ];
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS), members: MEMBERS });
    const gasCalls = [];
    page.on('request', req => {
      if (!/script\.google\.com/.test(req.url()) || req.method() !== 'POST') return;
      try { gasCalls.push(JSON.parse(req.postData() || '{}')); } catch (e) { /* 無視 */ }
    });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-key]');

    await page.click('#memTable tr[data-key="f1"] button[data-act="cancelJoin"]');
    await page.waitForSelector('#memTable tr.mem-edit[data-id="f1|パート|栽培"]');
    const dlgText = await page.textContent('#memTable tr.mem-edit .confirm-msg');
    check('入社取消：行の下の確認の文言', /入社を取り消します/.test(dlgText) && /F列を3・入退社を空に/.test(dlgText), dlgText);
    await page.click('#memTable button[data-act="cancelJoinOk"]');
    await page.waitForTimeout(400);
    check('入社取消でcancelJoinが送られる(key=f1, empType=パート, dept=栽培)', gasCalls.some(c => c.action === 'cancelJoin' && c.key === 'f1' && c.empType === 'パート' && c.dept === '栽培'), JSON.stringify(gasCalls));
    const datesAfter = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/dates`], SITE);
    check('入社取消でmeta/datesにcanceled:trueが付く', datesAfter['f1|パート|栽培']?.canceled === true, JSON.stringify(datesAfter));
    await page.close(); await ctx.close();
  }
  // やめるを押したときはcancelJoinが送られない
  {
    const MEMBERS = [
      { key: 'f2', name: '取消 太郎', dept: '栽培', empType: 'パート', flag: 2, row: 1, join: '2026-11-01', leave: '' },
    ];
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS), members: MEMBERS });
    const gasCalls = [];
    page.on('request', req => {
      if (!/script\.google\.com/.test(req.url()) || req.method() !== 'POST') return;
      try { gasCalls.push(JSON.parse(req.postData() || '{}')); } catch (e) { /* 無視 */ }
    });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-key]');
    await page.click('#memTable tr[data-key="f2"] button[data-act="cancelJoin"]');
    await page.waitForSelector('#memTable tr.mem-edit[data-id="f2|パート|栽培"]');
    await page.click('#memTable button[data-act="cancel"]');
    await page.waitForTimeout(200);
    check('入社取消：やめるを押すとcancelJoinは送られない', !gasCalls.some(c => c.action === 'cancelJoin'), JSON.stringify(gasCalls));
    await page.close(); await ctx.close();
  }

  /* ===================== 取消（undoRetire）：orgToがある場合 ===================== */
  {
    // g1：元の行(F列3)。orgTo先はg1|パート|出荷(F列1。MEMBERSにちょうど1つ)
    const MEMBERS = [
      { key: 'g1', name: '組織 変更子', dept: '栽培', empType: '社員', flag: 3, row: 1, join: '', leave: '2026-11-10' },
      { key: 'g1', name: '組織 変更子', dept: '出荷', empType: 'パート', flag: 1, row: 2, join: '', leave: '' },
    ];
    const dates = { 'g1|社員|栽培': { leave: '2026-11-10', orgTo: { empType: 'パート', dept: '出荷' } } };
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS, dates), members: MEMBERS });
    const gasCalls = [];
    page.on('request', req => {
      if (!/script\.google\.com/.test(req.url()) || req.method() !== 'POST') return;
      try { gasCalls.push(JSON.parse(req.postData() || '{}')); } catch (e) { /* 無視 */ }
    });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-id="g1|社員|栽培"]');
    await page.click('#memTable tr[data-id="g1|社員|栽培"] button[data-act="undo"]');
    await page.waitForTimeout(400);
    check('取消でundoRetireにorgToが付いて送られる', gasCalls.some(c => c.action === 'undoRetire' && c.key === 'g1' && c.empType === '社員' && c.dept === '栽培' && c.orgTo?.empType === 'パート' && c.orgTo?.dept === '出荷'), JSON.stringify(gasCalls));
    const datesAfter = await page.evaluate(site => window.__db[`shiftSites/${site}/meta/dates`], SITE);
    check('取消で元のキー(g1|社員|栽培)のleave・orgToが消える', !datesAfter['g1|社員|栽培']?.leave && !datesAfter['g1|社員|栽培']?.orgTo, JSON.stringify(datesAfter));
    check('取消でorgTo先のキー(g1|パート|出荷)にcanceled:trueが付く', datesAfter['g1|パート|出荷']?.canceled === true, JSON.stringify(datesAfter));
    await page.close(); await ctx.close();
  }
  // orgTo先が見つからない（helpers.jsのfakeがwarningを返す）→トーストに警告が出る
  {
    const MEMBERS = [
      { key: 'g2', name: '警告 太郎', dept: '栽培', empType: '社員', flag: 3, row: 1, join: '', leave: '2026-11-10' },
    ];
    const dates = { 'g2|社員|栽培': { leave: '2026-11-10', orgTo: { empType: 'パート', dept: '出荷' } } };
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS, dates), members: MEMBERS });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-id="g2|社員|栽培"]');
    await page.click('#memTable tr[data-id="g2|社員|栽培"] button[data-act="undo"]');
    await page.waitForSelector('#toast:not([hidden])');
    const toastText = await page.textContent('#toast');
    check('orgTo先が見つからないときはwarningがトーストに出る', toastText.includes('テスト用の偽の警告'), toastText);
    await page.close(); await ctx.close();
  }

  /* ===================== 入社取消になった行を出さない ===================== */
  {
    // h1：F列3・入退社が空・meta/datesでcanceled:true → どこにも出ない
    // h2：F列3だが入退社あり（削除前・まだ管理者が直していない想定とは別）→出る（比較用）
    const MEMBERS = [
      { key: 'h1', name: '消える 花子', dept: '栽培', empType: 'パート', flag: 3, row: 1, join: '', leave: '' },
      { key: 'h2', name: '残る 次郎', dept: '栽培', empType: '社員', flag: 1, row: 2, join: '', leave: '' },
    ];
    const dates = { 'h1|パート|栽培': { canceled: true } };
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS, dates), members: MEMBERS });
    await page.goto(URL);
    await page.waitForSelector('#grid tbody td.name[data-r]');

    const gridNames = await page.$$eval('#grid tbody td.name[data-r]', tds => tds.map(td => td.firstChild.textContent));
    check('入社取消になった行はシフト表に出ない', !gridNames.includes('消える 花子'), JSON.stringify(gridNames));
    check('ほかの行はシフト表に出る', gridNames.includes('残る 次郎'), JSON.stringify(gridNames));

    const fxNames = await page.$$eval('#fxPerson option', os => os.map(o => o.textContent));
    check('入社取消になった行は固定シフトの一覧に出ない', !fxNames.some(t => t.includes('消える 花子')), JSON.stringify(fxNames));

    const memKeys = await page.$$eval('#memTable tr[data-key]', trs => trs.map(tr => tr.dataset.key));
    check('入社取消になった行はメンバー欄にも出ない', !memKeys.includes('h1'), JSON.stringify(memKeys));
    await page.close(); await ctx.close();
  }

  /* ===================== 同じ名前の行が2つ以上あるとき ===================== */
  {
    // i1：同じ名前(name/key共通)で2行。1行目は2026-11-10までの出荷(F列3=異動予定)、
    // 2行目は2026-11-11から栽培(F列1)。今日(2026-10-23)時点では1行目(出荷)が有効
    const MEMBERS = [
      { key: 'i1', name: '二重 太郎', dept: '出荷', empType: '社員', flag: 3, row: 1, join: '', leave: '' },
      { key: 'i1', name: '二重 太郎', dept: '栽培', empType: '社員', flag: 1, row: 2, join: '', leave: '' },
    ];
    const dates = {
      'i1|社員|出荷': { leave: '2026-11-10', orgTo: { empType: '社員', dept: '栽培' } },
      'i1|社員|栽培': { join: '2026-11-11' },
    };
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS, dates), members: MEMBERS });
    await page.goto(URL);
    await page.waitForSelector('#grid tbody td.name[data-r]');

    // シフト表・印刷は整理済み_Mの行ごとに2行とも出す（次回の見分け方の修正：同じ名前の
    // 行が2つ以上あるとき、持ち主でない日は斜線(na)にする）ように変わったため、
    // 「1行にまとめる」ではなく「2行とも出て、在籍期間の外は斜線になる」ことを確かめる
    const gridNames = await page.$$eval('#grid tbody td.name[data-r] .nm-main', els => els.map(e => e.childNodes[0].textContent));
    const count = gridNames.filter(n => n === '二重 太郎').length;
    check('シフト表：同じ名前の行は2行とも出す', count === 2, JSON.stringify(gridNames));
    const depts = await page.$$eval('#grid tbody tr', trs => trs.map(tr => tr.querySelector('td.name .nm-sub .chip')?.textContent).filter(Boolean));
    check('シフト表：始まりの早い元の行(出荷)が上、新しい行(栽培)が下', depts[0] === '出荷' && depts[1] === '栽培', JSON.stringify(depts));
    // 表示期間(10/11〜11/10)は新しい行(栽培、入社11/11)の在籍期間の外なので全日斜線、
    // 元の行(出荷、異動予定日11/10まで)は表示期間すべて入力できる
    const naCounts = await page.$$eval('#grid tbody tr', trs => trs.map(tr => tr.querySelectorAll('td.cell').length ? tr.querySelectorAll('td.cell.na').length : null).filter(x => x !== null));
    const cellCounts = await page.$$eval('#grid tbody tr', trs => trs.map(tr => tr.querySelectorAll('td.cell').length).filter(x => x > 0));
    check('シフト表：元の行(出荷)は表示期間すべて入力できる(斜線なし)', naCounts[0] === 0, JSON.stringify(naCounts));
    check('シフト表：新しい行(栽培)は表示期間すべて持ち主でない(全日斜線)', naCounts[1] > 0 && naCounts[1] === cellCounts[1], JSON.stringify([naCounts, cellCounts]));

    const fxNames = await page.$$eval('#fxPerson option', os => os.map(o => o.textContent));
    const fxCount = fxNames.filter(t => t.includes('二重 太郎')).length;
    check('固定シフトの一覧：同じ名前の行は1行にまとまる', fxCount === 1, JSON.stringify(fxNames));

    const memKeys = await page.$$eval('#memTable tr[data-id]', trs => trs.map(tr => tr.dataset.id));
    check('メンバー欄：同じ名前の行は2行とも出す', memKeys.includes('i1|社員|出荷') && memKeys.includes('i1|社員|栽培'), JSON.stringify(memKeys));
    await page.close(); await ctx.close();
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
