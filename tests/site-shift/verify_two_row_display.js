// 拠点シフト表（site-shift.html）の「シフト表・印刷の2段・2行表示、退職日経過の表示ほか（2回目）」の検証。
// Firebase（認証・Firestore）とGASはページ内の偽物（helpers.js）に差し替え、ネットワークには出ない。
// 「今日」はhelpers.jsのopenShiftPageにより2026-10-23に固定される（今の月度=2026-10）。
// 確かめること：
//  - シフト表：部門の列（th.role）が無く、氏名欄が2段（上：氏名、下：部門・雇用区分）
//  - 同じ名前の行が2つ以上あるとき、整理済み_Mの行ごとに2行とも出す（元の行が上）。それぞれの
//    在籍期間の外の日は斜線(td.cell.na)になり、クリック・入力・貼り付け・固定シフトの反映の
//    対象にならない。持ち主の行の値（data[key][iso]）はその行にだけ出る
//  - 部門別の時間・出勤人数は、日ごとに持ち主の行の部門で1回だけ数える（二重に数えない）
//  - 同じkeyの行が1つだけの人は、退職日を過ぎてもずっと入力できる（斜線にならない）
//  - 固定シフトの人の一覧は今までどおりkeyごとに1人
//  - 印刷（一覧）：部門の列が無く氏名欄が2段、同じ名前の行は2行、持ち主でない日は斜線、
//    出勤人数が正しく、1枚に収まる
//  - B1：F列3の人に「取消」と「退職・異動」の両方が出て、「退職・異動」の動きはF列1と同じ
//    （tr.mem-edit・action:'retire'）
//  - B2：退職日を過ぎたF列3の人は、メンバー欄の日付が赤字(.m-date.past)、シフト表の氏名欄に
//    「退職日経過」のバッジが付く。過ぎていない人には出ない
//  - 入社取消：ask()のダイアログではなく、行の下のtr.mem-editに確認を出す。「取り消す」で
//    cancelJoinが送られ、「やめる」で何も送られない
//  - 「今日」は日本時間で判断する（世界標準時では前日になる時刻でも、日本時間の日付で持ち主が
//    選ばれる）
//  - 1400・1024・390pxのどの幅でもメンバー欄に横スクロールが出ない（入社取消の確認の行を
//    出した状態でも）
// 実行：python3 -m http.server 8811 --directory dashboard を起動してから
//       node tests/site-shift/verify_two_row_display.js
const { chromium } = require('playwright');
const { openShiftPage } = require('./helpers');

const URL = 'http://localhost:8811/site-shift.html';
const SITE = 'いなべ';

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }

function baseSeed(members, dates, cells) {
  return {
    [`shiftSites/${SITE}/meta/members`]: { list: members, updatedAt: 4102444800000 },
    [`shiftSites/${SITE}/months/2026-10`]: { cells: cells || {} },
    [`shiftSites/${SITE}/months/2026-11`]: { cells: {} },
    [`shiftSites/${SITE}/meta/fixed`]: {},
    [`shiftSites/${SITE}/meta/dates`]: dates || {},
  };
}

// 表示期間は今日(2026-10-23)を含む 2026-10-11〜2026-11-10。
// 組織内の変更の人(d1)：元の行(F列3・出荷・異動予定日2026-10-20)が10/11〜10/20を持ち、
// 新しい行(F列2・配送・入社日2026-10-21)が10/21〜11/10を持つ
const MEMBERS = [
  { key: 'n1', name: '通常 一郎', dept: '栽培', empType: '社員', flag: 1, row: 1, join: '', leave: '' },
  { key: 'd1', name: '組織 変更子', dept: '出荷', empType: '社員', flag: 3, row: 2, join: '', leave: '2026-10-20' },
  { key: 'd1', name: '組織 変更子', dept: '配送', empType: '社員', flag: 2, row: 3, join: '2026-10-21', leave: '' },
  // 1行だけで退職日(2026-10-15)を過ぎているF列3の人
  { key: 'p1', name: '退職 過ぎ子', dept: '栽培', empType: 'パート', flag: 3, row: 4, join: '', leave: '2026-10-15' },
  // 1行だけでまだ退職日(2026-12-01)を過ぎていないF列3の人
  { key: 'p2', name: '退職 予定男', dept: '出荷', empType: '社員', flag: 3, row: 5, join: '', leave: '2026-12-01' },
];
const CELLS = {
  // d1：owner-key(d1)は共通。10/15は元の行(出荷)が持ち主、10/25は新しい行(配送)が持ち主
  d1: { '2026-10-15': '8:00-17:00', '2026-10-25': '9:00-18:00' },
};

(async () => {
  const browser = await chromium.launch();

  /* ===================== シフト表：部門の列が無く、氏名欄が2段 ===================== */
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS, {}, CELLS), members: MEMBERS });
    page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
    await page.goto(URL);
    await page.waitForSelector('#grid tbody td.name[data-r]');

    const roleTh = await page.$('#grid thead th.role');
    check('部門の列（th.role）がない', roleTh === null, roleTh);
    const heads = await page.$$eval('#grid thead th', ths => ths.map(t => t.textContent.trim()));
    check('見出しの1列目は氏名のみ（部門の列を挟まず日付が続く）', heads[0] === '氏名' && /^\d+$/.test(heads[1]?.replace(/\D/g, '') || ''), JSON.stringify(heads));

    const subText = await page.$eval('#grid tbody td.name .nm-sub', el => el.textContent.trim());
    check('氏名欄の下段に部門・雇用区分が出る', /栽培/.test(subText) && /社員|パート|技能実習生/.test(subText), subText);

    /* ===================== 同じ名前の行が2つ：元の行が上、2行とも出る ===================== */
    const names = await page.$$eval('#grid tbody td.name[data-r] .nm-main', els => els.map(e => e.childNodes[0].textContent));
    const idx = names.map((n, i) => n === '組織 変更子' ? i : -1).filter(i => i >= 0);
    check('同じ名前の行が2行とも出る', idx.length === 2, JSON.stringify(names));
    const depts = await page.$$eval('#grid tbody tr', trs => trs.map(tr => tr.querySelector('td.name .nm-sub .chip')?.textContent));
    check('元の行(出荷)が上、新しい行(配送)が下', depts[idx[0]] === '出荷' && depts[idx[1]] === '配送', JSON.stringify(depts));

    // 日付列の見出しから、10/15・10/20・10/21・10/25の列番号(0始まり)を調べる
    const days = await page.$$eval('#grid thead th .d', els => els.map(e => +e.textContent));
    const colOf = d => days.indexOf(d);
    const classesOf = r => page.$$eval(`#grid tbody tr:nth-child(${r + 1}) td.cell`, tds => tds.map(td => td.className));
    const oldCls = await classesOf(idx[0]), newCls = await classesOf(idx[1]);
    check('元の行(出荷)：10/15(在籍期間内)は斜線でない', !oldCls[colOf(15)].includes('na'), oldCls[colOf(15)]);
    check('元の行(出荷)：10/21(在籍期間の外)は斜線', oldCls[colOf(21)].includes('na'), oldCls[colOf(21)]);
    check('新しい行(配送)：10/21(在籍期間内)は斜線でない', !newCls[colOf(21)].includes('na'), newCls[colOf(21)]);
    check('新しい行(配送)：10/15(在籍期間の外)は斜線', newCls[colOf(15)].includes('na'), newCls[colOf(15)]);

    // 持ち主の行のセルにだけ値が出る（10/15は元の行、10/25は新しい行）
    const textOf = (r, c) => page.$eval(`#grid tbody tr:nth-child(${r + 1}) td.cell[data-c="${c}"]`, td => td.textContent.trim());
    check('10/15の値は元の行(出荷)にだけ出る', (await textOf(idx[0], colOf(15))) !== '' && (await textOf(idx[1], colOf(15))) === '', [await textOf(idx[0], colOf(15)), await textOf(idx[1], colOf(15))]);
    check('10/25の値は新しい行(配送)にだけ出る', (await textOf(idx[1], colOf(25))) !== '' && (await textOf(idx[0], colOf(25))) === '', [await textOf(idx[1], colOf(25)), await textOf(idx[0], colOf(25))]);

    /* ===================== 持ち主でない日はクリック・入力・貼り付けできない ===================== */
    const naCellSel = `#grid tbody tr:nth-child(${idx[1] + 1}) td.cell[data-c="${colOf(15)}"]`; // 新しい行の10/15(在籍期間の外)
    await page.click(naCellSel);
    await page.keyboard.type('9-18');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const naVal = await page.$eval(naCellSel, td => td.textContent.trim());
    check('持ち主でない日はクリック・入力しても書き込まれない', naVal === '', naVal);
    // 貼り付け（pasteTSV。setVal→canEditで同じように弾かれる）も持ち主でない日には書き込まれない
    await page.click(naCellSel);
    await page.evaluate(() => window.pasteTSV('9:00-18:00'));
    await page.waitForTimeout(100);
    const naValAfterPaste = await page.$eval(naCellSel, td => td.textContent.trim());
    check('持ち主でない日は貼り付けても書き込まれない', naValAfterPaste === '', naValAfterPaste);

    /* ===================== 部門別の時間・出勤人数は日ごとに1回だけ ===================== */
    const cnt15 = await page.$eval(`#grid tbody tr.total td.day:nth-child(${colOf(15) + 2})`, td => td.textContent.trim()).catch(() => null);
    // 出勤人数の行は最後から2番目のtr
    const dayCntRow = await page.$$eval('#grid tfoot tr', trs => trs[trs.length - 1].querySelectorAll('td.day').length ? [...trs[trs.length - 1].querySelectorAll('td.day')].map(td => td.textContent.trim()) : []);
    check('10/15の出勤人数は1人（元の行だけ、二重に数えない）', dayCntRow[colOf(15)] === '1', JSON.stringify(dayCntRow));
    check('10/25の出勤人数は1人（新しい行だけ、二重に数えない）', dayCntRow[colOf(25)] === '1', JSON.stringify(dayCntRow));
    const shukkaRow = await page.$$eval('#grid tfoot tr', trs => {
      const r = [...trs].find(tr => tr.querySelector('th .chip')?.textContent === '出荷');
      return r ? [...r.querySelectorAll('td.day')].map(td => td.textContent.trim()) : null;
    });
    check('10/15は出荷の時間に数えられる(元の行の部門)', shukkaRow && shukkaRow[colOf(15)] !== '–' && shukkaRow[colOf(15)] !== '0', JSON.stringify(shukkaRow));
    const haisoRow = await page.$$eval('#grid tfoot tr', trs => {
      const r = [...trs].find(tr => tr.querySelector('th .chip')?.textContent === '配送');
      return r ? [...r.querySelectorAll('td.day')].map(td => td.textContent.trim()) : null;
    });
    check('10/25は配送の時間に数えられる(新しい行の部門)', haisoRow && haisoRow[colOf(25)] !== '–' && haisoRow[colOf(25)] !== '0', JSON.stringify(haisoRow));

    /* ===================== 1行だけの人は退職日を過ぎても斜線にならない ===================== */
    const p1Idx = names.indexOf('退職 過ぎ子');
    const p1Cls = await classesOf(p1Idx);
    check('1行だけの人(退職日を過ぎたF列3)は全日斜線にならない', p1Cls.every(c => !c.includes('na')), JSON.stringify(p1Cls));

    /* ===================== B2：退職日経過のバッジ ===================== */
    const p1Badge = await page.$(`#grid tbody tr:nth-child(${p1Idx + 1}) td.name .badge.past`);
    check('B2：退職日を過ぎたF列3の人には「退職日経過」バッジが出る', !!p1Badge, p1Badge);
    const p1BadgeText = p1Badge ? await p1Badge.textContent() : '';
    check('B2：バッジの文言は「退職日経過」', p1BadgeText.trim() === '退職日経過', p1BadgeText);
    const p2Idx = names.indexOf('退職 予定男');
    const p2Badge = await page.$(`#grid tbody tr:nth-child(${p2Idx + 1}) td.name .badge.past`);
    check('B2：退職日をまだ過ぎていないF列3の人にはバッジが出ない', p2Badge === null, p2Badge);

    await page.close(); await ctx.close();
  }

  /* ===================== 氏名欄(td.name)はdisplay:flexにせず、中身(div.nm-box)だけflexにする =====================
     （表のセルにdisplay:flexを付けると、行の高さ・sticky・見出しとの幅がずれるおそれがあるため。
     #535のtr.mem-editと同じ問題） */
  for (const width of [1400, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS, {}, CELLS), members: MEMBERS });
    await page.goto(URL);
    await page.waitForSelector('#grid tbody td.name[data-r]');

    const displayOf = await page.$eval('#grid tbody td.name', td => getComputedStyle(td).display);
    check(`[${width}px] td.nameの計算されたdisplayはtable-cell`, displayOf === 'table-cell', displayOf);

    const diffs = await page.$$eval('#grid tbody tr', trs => trs.map(tr => {
      const name = tr.querySelector('td.name'), cell = tr.querySelector('td.cell');
      if (!name || !cell) return null;
      return Math.abs(name.getBoundingClientRect().height - cell.getBoundingClientRect().height);
    }).filter(d => d !== null));
    check(`[${width}px] 本体の各行でtd.nameの高さがtd.cellの高さと同じ(差1px以内)`, diffs.every(d => d <= 1), JSON.stringify(diffs));

    const rects = await page.evaluate(() => {
      const head = document.querySelector('#grid thead th.name').getBoundingClientRect();
      const body = document.querySelector('#grid tbody td.name').getBoundingClientRect();
      const foot = document.querySelector('#grid tfoot th.name').getBoundingClientRect();
      return { head: { left: head.left, width: head.width }, body: { left: body.left, width: body.width }, foot: { left: foot.left, width: foot.width } };
    });
    check(`[${width}px] thead/tbody/tfootのname列の左端が同じ(差1px以内)`, Math.abs(rects.head.left - rects.body.left) <= 1 && Math.abs(rects.body.left - rects.foot.left) <= 1, JSON.stringify(rects));
    check(`[${width}px] thead/tbody/tfootのname列の幅が同じ(差1px以内)`, Math.abs(rects.head.width - rects.body.width) <= 1 && Math.abs(rects.body.width - rects.foot.width) <= 1, JSON.stringify(rects));

    // 横にスクロールしても、td.name(sticky)の左端は表の囲みの左端から動かない
    const before = await page.$eval('#grid tbody td.name', td => td.getBoundingClientRect().left);
    await page.$eval('#gridBox', el => { el.scrollLeft = 200; });
    await page.waitForTimeout(100);
    const after = await page.$eval('#grid tbody td.name', td => td.getBoundingClientRect().left);
    const scrolled = await page.$eval('#gridBox', el => el.scrollLeft);
    check(`[${width}px] 横スクロール後もtd.nameの左端が動かない(stickyが効いている、scrollLeft=${scrolled})`, scrolled > 0 && Math.abs(after - before) <= 1, JSON.stringify({ before, after, scrolled }));

    await page.close(); await ctx.close();
  }

  /* ===================== 固定シフト：固定シフトの反映は持ち主でない日に入らない ===================== */
  {
    const seed = baseSeed(MEMBERS, {}, CELLS);
    seed[`shiftSites/${SITE}/meta/fixed`] = { d1: Array(7).fill('8:00-17:00') };
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed, members: MEMBERS });
    await page.goto(URL);
    await page.waitForSelector('#grid tbody td.name[data-r]');

    // 固定シフトの人の一覧はkeyごとに1人（同じ名前(d1)は1つだけ）
    const fxNames = await page.$$eval('#fxPerson option', os => os.map(o => o.textContent));
    const fxCount = fxNames.filter(t => t.includes('組織 変更子')).length;
    check('固定シフトの人の一覧は同じ名前の人が1人', fxCount === 1, JSON.stringify(fxNames));

    await page.click('#applyFixed');
    await page.click('#dlgOk'); // 空いている日だけ
    await page.waitForTimeout(300);
    const names = await page.$$eval('#grid tbody td.name[data-r] .nm-main', els => els.map(e => e.childNodes[0].textContent));
    const idx = names.map((n, i) => n === '組織 変更子' ? i : -1).filter(i => i >= 0);
    const days = await page.$$eval('#grid thead th .d', els => els.map(e => +e.textContent));
    const colOf = d => days.indexOf(d);
    const textAt = (r, c) => page.$eval(`#grid tbody tr:nth-child(${r + 1}) td.cell[data-c="${c}"]`, td => td.textContent.trim());
    // 新しい行(配送)の10/15は持ち主でないため、固定シフトを反映しても空のまま
    check('固定シフトの反映：持ち主でない日(新しい行の10/15)には入らない', (await textAt(idx[1], colOf(15))) === '', await textAt(idx[1], colOf(15)));
    // 元の行(出荷)の10/12（持ち主・空欄）には反映される
    check('固定シフトの反映：持ち主の日(元の行の10/12)には入る', (await textAt(idx[0], colOf(12))) !== '', await textAt(idx[0], colOf(12)));
    await page.close(); await ctx.close();
  }

  /* ===================== 印刷（一覧）：部門の列なし・2段・2行・斜線・出勤人数・1枚に収まる ===================== */
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS, {}, CELLS), members: MEMBERS });
    await page.goto(URL);
    await page.waitForSelector('#grid tbody td.name[data-r]');
    await page.click('#tabPrint');
    await page.waitForTimeout(400);

    const headRoleTh = await page.$$eval('#printPage thead th', ths => ths.map(t => t.textContent.trim()));
    check('印刷：見出しに部門の列がない（氏名の次が日付）', headRoleTh[0] === '氏名' && headRoleTh[1] !== '部門', JSON.stringify(headRoleTh));
    const nmCellHtml = await page.$eval('#printPage tbody td.nm', el => el.innerHTML);
    check('印刷：氏名欄が2段（氏名＋部門・雇用区分のspan.dp）', /class="dp"/.test(nmCellHtml), nmCellHtml);
    const nmNames = await page.$$eval('#printPage tbody td.nm', els => els.map(e => e.childNodes[0].textContent));
    const dupCount = nmNames.filter(n => n === '組織 変更子').length;
    check('印刷：同じ名前の行は2行とも出る', dupCount === 2, JSON.stringify(nmNames));

    const naTds = await page.$$eval('#printPage tbody tr', trs => trs.map(tr => tr.querySelectorAll('td.na').length));
    check('印刷：持ち主でない日は斜線(td.na)になる行がある', naTds.some(n => n > 0), JSON.stringify(naTds));

    await page.check('#ppCount');
    await page.waitForTimeout(300);
    const cntRow = await page.$$eval('#printPage tfoot td', tds => tds.map(td => td.textContent.trim()));
    check('印刷：出勤人数の行が出る(空でない値を含む)', cntRow.some(v => v !== ''), JSON.stringify(cntRow));

    const info = await page.evaluate(() => {
      const pg = document.getElementById('printPage');
      const table = pg.querySelector('.pp-table');
      const room = pg.clientHeight - pg.querySelector('.pp-head').offsetHeight - 6;
      return { tableHeight: table.offsetHeight, room };
    });
    check('印刷：1枚に収まる（表の高さが収まる範囲内）', info.tableHeight <= info.room + 1, JSON.stringify(info));
    await page.close(); await ctx.close();
  }

  /* ===================== B1：F列3に「取消」と「退職・異動」の両方 ===================== */
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS, {}, CELLS), members: MEMBERS });
    const gasCalls = [];
    page.on('request', req => {
      if (!/script\.google\.com/.test(req.url()) || req.method() !== 'POST') return;
      try { gasCalls.push(JSON.parse(req.postData() || '{}')); } catch (e) { /* 無視 */ }
    });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-id="p2|社員|出荷"]');
    const acts = await page.$$eval('#memTable tr[data-id="p2|社員|出荷"] button', bs => bs.map(b => b.dataset.act));
    check('B1：F列3のボタンは取消・退職異動の両方', JSON.stringify(acts) === JSON.stringify(['undo', 'leave']), JSON.stringify(acts));

    await page.click('#memTable tr[data-id="p2|社員|出荷"] button[data-act="leave"]');
    await page.waitForSelector('#memTable tr.mem-edit[data-id="p2|社員|出荷"]');
    await page.fill('#memTable #leaveDate', '2026-12-25');
    await page.selectOption('#memTable #leaveFlag', '9');
    await page.click('#memTable button[data-act="ok"]');
    await page.waitForTimeout(400);
    check('B1：F列3から「退職・異動」の確定でretireが送られる(F列1と同じ動き)', gasCalls.some(c => c.action === 'retire' && c.key === 'p2' && c.date === '2026-12-25' && c.flag === 9 && c.empType === '社員' && c.dept === '出荷'), JSON.stringify(gasCalls));
    await page.close(); await ctx.close();
  }

  /* ===================== B2：メンバー欄の日付が赤字 ===================== */
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS, {}, CELLS), members: MEMBERS });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-id="p1|パート|栽培"]');
    const pastClass = await page.$eval('#memTable tr[data-id="p1|パート|栽培"] .m-date', el => el.className);
    check('B2：退職日を過ぎたF列3のメンバー欄の日付に.pastが付く(赤字)', pastClass.includes('past'), pastClass);
    const okClass = await page.$eval('#memTable tr[data-id="p2|社員|出荷"] .m-date', el => el.className);
    check('B2：退職日をまだ過ぎていない人には.pastが付かない', !okClass.includes('past'), okClass);
    await page.close(); await ctx.close();
  }

  /* ===================== 入社取消：行の下に確認（ask()ではない） ===================== */
  {
    const MEMBERS2 = [
      { key: 'c1', name: '取消 花子', dept: '栽培', empType: 'パート', flag: 2, row: 1, join: '2026-11-01', leave: '' },
    ];
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await openShiftPage(ctx, { seed: baseSeed(MEMBERS2), members: MEMBERS2 });
    const gasCalls = [];
    page.on('request', req => {
      if (!/script\.google\.com/.test(req.url()) || req.method() !== 'POST') return;
      try { gasCalls.push(JSON.parse(req.postData() || '{}')); } catch (e) { /* 無視 */ }
    });
    await page.goto(URL);
    await page.waitForSelector('#memTable tr[data-key]');

    await page.click('#memTable tr[data-key="c1"] button[data-act="cancelJoin"]');
    const topDialog = await page.$('body > .dialog, #dialogSlot .dialog');
    check('入社取消：ページ上部のask()ダイアログは出ない', topDialog === null, topDialog);
    await page.waitForSelector('#memTable tr.mem-edit[data-id="c1|パート|栽培"]');
    const msg = await page.textContent('#memTable tr.mem-edit .confirm-msg');
    check('入社取消：行の下に確認の文言が出る', /入社を取り消します/.test(msg), msg);

    await page.click('#memTable button[data-act="cancel"]');
    await page.waitForTimeout(200);
    check('入社取消：やめるを押すとcancelJoinは送られない', !gasCalls.some(c => c.action === 'cancelJoin'), JSON.stringify(gasCalls));

    await page.click('#memTable tr[data-key="c1"] button[data-act="cancelJoin"]');
    await page.waitForSelector('#memTable tr.mem-edit[data-id="c1|パート|栽培"]');
    await page.click('#memTable button[data-act="cancelJoinOk"]');
    await page.waitForTimeout(400);
    check('入社取消：取り消すを押すとcancelJoinが送られる', gasCalls.some(c => c.action === 'cancelJoin' && c.key === 'c1'), JSON.stringify(gasCalls));
    await page.close(); await ctx.close();
  }

  /* ===================== 「今日」は日本時間で判断する ===================== */
  {
    // UTCでは前日（2026-10-22）になる時刻でも、日本時間では2026-10-23（今日）になる状況を再現：
    // helpers.jsは2026-10-23 09:00 JST固定だが、同じ考え方で「UTCでは前日」のケースを
    // 直接関数を呼んで確かめる（todayJSTがtoLocaleDateStringでAsia/Tokyoを使っていることの確認）
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    // 2026-10-23 02:00 UTC = 2026-10-23 11:00 JST（同じ日）。
    // 2026-10-22 16:00 UTC = 2026-10-23 01:00 JST（UTCでは前日22日・JSTでは23日）
    await page.addInitScript(() => {
      const FIXED = Date.UTC(2026, 9, 22, 16, 0, 0), D = Date;
      window.Date = class extends D { constructor(...a) { return a.length ? new D(...a) : new D(FIXED); } static now() { return FIXED; } };
    });
    await page.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    const { fakeFirebase } = require('./helpers');
    const seed = baseSeed(MEMBERS, {}, CELLS);
    await page.route(/gstatic\.com\/firebasejs\/.*app-compat\.js/, r => r.fulfill({ contentType: 'text/javascript', body: `(${fakeFirebase})(${JSON.stringify(seed)});` }));
    await page.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok', members: MEMBERS, shifts: [], fixed: {} }) }));
    await page.goto(URL);
    await page.waitForSelector('#grid tbody td.name[data-r]');
    // d1の元の行(出荷)は10/20まで有効、新しい行(配送)は10/21から。UTCの時計のまま
    // (new Date().toISOString()==='2026-10-22...')だと持ち主判定が1日ずれるはずだが、
    // 日本時間(2026-10-23)で正しく新しい行(配送)側に判定が移っていることを確かめる
    const todayJstVal = await page.evaluate(() => typeof todayJST === 'function' ? todayJST() : null);
    check('「今日」が日本時間(2026-10-23)で判断される(toISOStringの世界標準時=10-22ではない)', todayJstVal === '2026-10-23', todayJstVal);
    await page.close(); await ctx.close();
  }

  /* ===================== メンバー欄：3つの幅で横スクロールが出ない（入社取消の確認の行を含む） ===================== */
  {
    const seed = baseSeed(MEMBERS, {}, CELLS); // d1の新しい行(F列2)で入社取消の確認を出す
    for (const width of [1400, 1024, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await openShiftPage(ctx, { seed, members: MEMBERS });
      await page.goto(URL);
      await page.waitForSelector('#memTable tr[data-id]');
      const widths = () => page.$eval('#memTable', el => ({ tableScrollWidth: el.scrollWidth, wrapClientWidth: el.parentElement.clientWidth }));
      const fits = w => w.tableScrollWidth <= w.wrapClientWidth;

      const w0 = await widths();
      check(`[${width}px] 通常の状態で#memTableが囲みの幅を超えない`, fits(w0), JSON.stringify(w0));

      await page.click('#memTable tr[data-id="d1|社員|配送"] button[data-act="cancelJoin"]');
      await page.waitForSelector('#memTable tr.mem-edit[data-id="d1|社員|配送"]');
      const w1 = await widths();
      check(`[${width}px] 入社取消の確認の行を出した状態でも#memTableが囲みの幅を超えない`, fits(w1), JSON.stringify(w1));

      await page.close(); await ctx.close();
    }
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
