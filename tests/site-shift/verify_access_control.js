// 拠点シフト表（site-shift.html）の「閲覧・編集できる人」（拠点ごとの名簿 shiftAcl/{拠点}）の検証。
// Firebase（認証・Firestore）とGASはページ内の偽物に差し替え、ネットワークには出ない。
// 名簿に載っていない人の読み取りは、本物のルールと同じく permission-denied にする（seed.__errorPaths）。
// 確かめること：
//  - 名簿に載っていない人：いなべが拠点の選択肢に出ず、群馬が開く
//  - 閲覧の人：いなべは見られるが、書き換える操作が出ず、打っても変わらない。Firestore にも GAS にも書かない
//  - 編集の人：いなべで入力でき、GAS への書き込みに idToken が付く。名簿のパネルは出ない
//  - 管理者：名簿のパネルが出て、保存できる（自分は管理者から外せない・重複は1つにまとめる）
//  - 名簿を最初に作れる人：名簿のない拠点で「保存して制限する」→確認のうえ名簿ができる
//  - どの拠点も見られない人には、その旨を出す
// 実行：python3 -m http.server 8811 --directory dashboard を起動してから node tests/site-shift/verify_access_control.js
const { chromium } = require('playwright');
const { openShiftPage } = require('./helpers');

const URL = 'http://localhost:8811/site-shift.html';
const MEMBERS = [
  { key: 'a1', name: '栽培 一郎', dept: '栽培', empType: '社員', flag: 1, row: 1, join: '2024-04-01' },
  { key: 'a2', name: '出荷 花子', dept: '出荷', empType: 'パート', flag: 1, row: 2, join: '2024-04-01' },
];
const ACL = { admins: ['r.ikeda@10-ff.com'], editors: ['kato@example.com'], viewers: ['viewer@example.com'] };

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }

function seedFor(email, { acl = ACL, denied = [] } = {}) {
  const seed = { __email: email, __errorPaths: denied };
  if (acl) seed['shiftAcl/いなべ'] = acl;
  ['いなべ', '群馬', '南丹'].forEach(site => {
    // members は古い（30分以上前）ことにして、編集できる人なら整理済み_Mから読み直す（＝Firestoreに書く）状態にする
    seed[`shiftSites/${site}/meta/members`] = { list: MEMBERS, updatedAt: 0 };
    seed[`shiftSites/${site}/months/2026-10`] = { cells: { a1: { '2026-10-12': '8:00-17:00' } } };
    seed[`shiftSites/${site}/months/2026-11`] = { cells: {} };
    seed[`shiftSites/${site}/meta/fixed`] = {};
  });
  return seed;
}
// 名簿に載っていない人には、いなべの名簿もデータも読めない
const INABE_DENIED = ['shiftAcl/いなべ', 'shiftSites/いなべ/meta/members', 'shiftSites/いなべ/months/2026-10', 'shiftSites/いなべ/months/2026-11', 'shiftSites/いなべ/meta/fixed', 'shiftSites/いなべ/meta/order', 'shiftSites/いなべ/meta/dates'];

async function open(ctx, email, opt) {
  const page = await openShiftPage(ctx, { seed: seedFor(email, opt), members: MEMBERS });
  const gas = [];
  page.on('request', r => { if (/script\.google\.com/.test(r.url())) gas.push({ method: r.method(), url: r.url(), body: r.postData() || '' }); });
  page.on('pageerror', e => check(`${email}：ページでエラーが出ない`, false, e.message));
  await page.goto(URL);
  return { page, gas };
}
const typeInCell = async (page, r, c, text) => {
  await page.click(`td.cell[data-r="${r}"][data-c="${c}"]`);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
};
const cellText = (page, r, c) => page.$eval(`td.cell[data-r="${r}"][data-c="${c}"]`, td => td.textContent.trim());
const shown = (page, sel) => page.$eval(sel, el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));

(async () => {
  const browser = await chromium.launch();

  // ── 名簿に載っていない人 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page } = await open(ctx, 'other@example.com', { denied: INABE_DENIED });
    await page.waitForSelector('#grid tbody td.name[data-r]');
    const opts = await page.$$eval('#site option', os => os.map(o => ({ v: o.value, hidden: o.hidden, disabled: o.disabled })));
    check('載っていない人：いなべは選択肢から消える', opts.find(o => o.v === 'いなべ').hidden && opts.find(o => o.v === 'いなべ').disabled, JSON.stringify(opts));
    check('載っていない人：群馬・南丹は選べる', opts.filter(o => o.v !== 'いなべ').every(o => !o.hidden && !o.disabled), JSON.stringify(opts));
    check('載っていない人：群馬が開く', await page.$eval('#site', s => s.value) === '群馬', await page.$eval('#site', s => s.value));
    check('載っていない人：群馬では編集できる（閲覧だけの表示にならない）', !(await page.$eval('body', b => b.classList.contains('readonly'))), 'readonly');
    check('載っていない人：名簿のパネルは出ない', await page.$eval('#aclPanel', el => el.hidden), 'shown');
    await ctx.close();
  }

  // ── 閲覧の人 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page, gas } = await open(ctx, 'viewer@example.com');
    await page.waitForSelector('#grid tbody td.name[data-r]');
    await page.waitForTimeout(500);
    check('閲覧の人：いなべが開く', await page.$eval('#site', s => s.value) === 'いなべ', await page.$eval('#site', s => s.value));
    check('閲覧の人：閲覧だけの表示になる', await page.$eval('body', b => b.classList.contains('readonly')), 'not readonly');
    check('閲覧の人：「この拠点は閲覧だけです」が出る', await shown(page, '#roNote'), 'hidden');
    for (const [sel, label] of [['#applyFixed', '固定シフトを反映'], ['#leaveBtns', '休みのボタン'], ['#legacyBtn', '旧シフト表から取り込む'], ['#reloadBtn', 'メンバー更新'], ['#orderBar', '並び順'], ['.panels.two', '固定シフト・メンバーの欄']]) {
      check(`閲覧の人：${label}が出ない`, !(await shown(page, sel)), 'shown');
    }
    check('閲覧の人：名簿のパネルは出ない', await page.$eval('#aclPanel', el => el.hidden), 'shown');
    const before = await cellText(page, 0, 1);
    await typeInCell(page, 0, 1, '9-15');
    check('閲覧の人：セルに打っても変わらない', await cellText(page, 0, 1) === before, await cellText(page, 0, 1));
    await page.click('td.cell[data-r="0"][data-c="1"]'); await page.keyboard.press('Delete'); await page.waitForTimeout(400);
    const c0 = await cellText(page, 0, 1);
    check('閲覧の人：Deleteでも消えない', c0 === before, c0);
    // 印刷は使える
    await page.click('#tabPrint');
    check('閲覧の人：印刷のタブは使える', await shown(page, '#ppPrint'), 'hidden');
    const writes = await page.evaluate(() => window.__writes);
    check('閲覧の人：Firestoreに何も書かない（古いメンバーの読み直しもしない）', writes.length === 0, JSON.stringify(writes));
    check('閲覧の人：GASに書き込み（POST）を送らない', !gas.some(g => g.method === 'POST'), JSON.stringify(gas));
    await ctx.close();
  }

  // ── 編集の人 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page, gas } = await open(ctx, 'kato@example.com');
    await page.waitForSelector('#grid tbody td.name[data-r]');
    check('編集の人：閲覧だけの表示にならない', !(await page.$eval('body', b => b.classList.contains('readonly'))), 'readonly');
    check('編集の人：名簿のパネルは出ない', await page.$eval('#aclPanel', el => el.hidden), 'shown');
    await typeInCell(page, 1, 2, '9-15');
    check('編集の人：セルに入力できる', /9:00/.test(await cellText(page, 1, 2)), await cellText(page, 1, 2));
    await page.waitForTimeout(3600); // スプレッドシートへの書き出しは3秒ためて送る
    const posts = gas.filter(g => g.method === 'POST').map(g => JSON.parse(g.body));
    check('編集の人：GASへの書き込みに idToken が付く', posts.some(p => p.action === 'upsertCells' && p.idToken === 'fake-id-token'), JSON.stringify(posts));
    check('編集の人：GASの読み込みにも idToken が付く', gas.filter(g => g.method === 'GET').every(g => /idToken=fake-id-token/.test(g.url)) && gas.some(g => g.method === 'GET'), JSON.stringify(gas.map(g => g.url)));
    await ctx.close();
  }

  // ── 管理者（名簿のある拠点） ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page } = await open(ctx, 'r.ikeda@10-ff.com');
    await page.waitForSelector('#grid tbody td.name[data-r]');
    check('管理者：名簿のパネルが出る', await shown(page, '#aclPanel'), 'hidden');
    check('管理者：今の名簿が入っている', await page.$eval('#aclViewers', t => t.value) === 'viewer@example.com', await page.$eval('#aclViewers', t => t.value));
    check('管理者：「制限中」と出る', /制限中/.test(await page.$eval('#aclState', p => p.textContent)), await page.$eval('#aclState', p => p.textContent));
    await page.fill('#aclAdmins', 'Kodama@Example.com');
    await page.fill('#aclEditors', 'kato@example.com\nsasai@example.com, kato@example.com');
    await page.fill('#aclViewers', 'viewer@example.com\nkodama@example.com\na@example.com；b@example.com');
    await page.click('#aclSave');
    await page.waitForTimeout(300);
    const acl = await page.evaluate(() => window.__db['shiftAcl/いなべ']);
    check('管理者：自分は管理者に残る・メールは小文字にそろう', JSON.stringify(acl.admins) === JSON.stringify(['r.ikeda@10-ff.com', 'kodama@example.com']), JSON.stringify(acl.admins));
    check('管理者：編集の重複は1つに', JSON.stringify(acl.editors) === JSON.stringify(['kato@example.com', 'sasai@example.com']), JSON.stringify(acl.editors));
    check('管理者：上の欄にいる人は閲覧から外す・；でも区切れる', JSON.stringify(acl.viewers) === JSON.stringify(['viewer@example.com', 'a@example.com', 'b@example.com']), JSON.stringify(acl.viewers));
    await page.fill('#aclViewers', 'not-an-email');
    await page.click('#aclSave');
    await page.waitForTimeout(200);
    check('管理者：メールの形でないものは保存しない', /メールアドレスの形/.test(await page.$eval('#toast', t => t.textContent)) && (await page.evaluate(() => window.__db['shiftAcl/いなべ'].viewers.length)) === 3, await page.$eval('#toast', t => t.textContent));
    await ctx.close();
  }

  // ── 名簿を最初に作る（名簿のない拠点） ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page } = await open(ctx, 'r.ikeda@10-ff.com', { acl: null });
    await page.waitForSelector('#grid tbody td.name[data-r]');
    check('最初：名簿を作れる人にはパネルが出る', await shown(page, '#aclPanel'), 'hidden');
    check('最初：「制限なし」と出る', /制限なし/.test(await page.$eval('#aclState', p => p.textContent)), await page.$eval('#aclState', p => p.textContent));
    check('最初：管理者の欄に自分が入っている', await page.$eval('#aclAdmins', t => t.value) === 'r.ikeda@10-ff.com', await page.$eval('#aclAdmins', t => t.value));
    check('最初：「制限を外す」は出ない', !(await shown(page, '#aclOff')), 'shown');
    await page.fill('#aclEditors', 'kato@example.com');
    await page.click('#aclSave');
    await page.waitForSelector('#dlgOk');
    check('最初：確認が出る（まだ名簿はできていない）', !(await page.evaluate(() => 'shiftAcl/いなべ' in window.__db)), 'already');
    await page.click('#dlgOk');
    await page.waitForTimeout(300);
    const acl = await page.evaluate(() => window.__db['shiftAcl/いなべ']);
    check('最初：名簿ができる', acl && acl.editors[0] === 'kato@example.com' && acl.admins[0] === 'r.ikeda@10-ff.com', JSON.stringify(acl));
    check('最初：保存後は「制限中」・「制限を外す」が出る', /制限中/.test(await page.$eval('#aclState', p => p.textContent)) && await shown(page, '#aclOff'), 'not');
    await page.click('#aclOff'); await page.waitForSelector('#dlgOk'); await page.click('#dlgOk'); await page.waitForTimeout(300);
    check('最初：「制限を外す」で名簿が消える', !(await page.evaluate(() => 'shiftAcl/いなべ' in window.__db)), 'still');
    // 名簿を作れない人（編集の人など）にはパネルが出ない
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p2 = (await open(ctx2, 'kato@example.com', { acl: null })).page;
    await p2.waitForSelector('#grid tbody td.name[data-r]');
    check('最初：名簿のない拠点では、ほかの人にパネルは出ない', await p2.$eval('#aclPanel', el => el.hidden), 'shown');
    await ctx2.close();
  }

  // ── どの拠点も見られない人 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const { page } = await open(ctx, 'other@example.com', { denied: ['shiftAcl/いなべ', 'shiftAcl/群馬', 'shiftAcl/南丹'] });
    await page.waitForSelector('#gridBox .notice');
    check('見られる拠点がない：その旨とアカウントを出す', /見られる拠点がありません.*other@example\.com/.test(await page.$eval('#gridBox', b => b.textContent)), await page.$eval('#gridBox', b => b.textContent));
    await ctx.close();
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})();
