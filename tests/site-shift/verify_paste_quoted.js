// 拠点シフト表（site-shift.html）の貼り付け（pasteTSV）の検証。
// 旧の勤務表（Google スプレッドシート）からコピーした値は、セルの中に改行があると " で囲まれる（中の " は ""）。
// 以前はその改行も行の区切りとして扱い、1つのセルが2行に分かれて下の人のシフトを上書きしていた。
// Firebase（認証・Firestore）とGASはページ内の偽物に差し替え、ネットワークには出ない。
// 確かめること：
//  - 改行入りのセル1つ（"8:00-（改行）17:00"）を貼ると、1セルに 8:00-17:00 が入り、下の人の行は変わらない
//  - 改行入りのセルと「休」が混ざった1行（旧の勤務表のティエンさんの行と同じ形、25日分）を貼ると、1行に横に入り、下の人の行は変わらない
//  - "" を含むセル（"" は " に戻る。" の入った値は読めない値として貼り付けをやめる／前後の " だけなら値が入る）
//  - 複数行・複数列（" で囲まれたセルが混ざる、行の区切りは \r\n）の範囲を貼る
//  - 読めない値が1つでも入っていると、1セルも書き込まれず（Firestoreにも書かない）、知らせが出る（最初の3つまで）
//  - 今までどおりの貼り付け（" で囲まれていない値・1つの値を範囲に貼る・はみ出した分は入らない）は変わらない
// 実行：python3 -m http.server 8811 --directory dashboard を起動してから node tests/site-shift/verify_paste_quoted.js
const { chromium } = require('playwright');
const { openShiftPage } = require('./helpers');

const URL = 'http://localhost:8811/site-shift.html';
const SITE = 'いなべ';

// 期間は 10/11〜11/10（今日 10/23 固定）。列 c=0 が 10/11
const MEMBERS = [
  { key: 'PHAMVANTIEN', name: 'PHAM VAN TIEN', dept: '出荷', empType: '技能実習生', flag: 1, row: 1, join: '2024-04-01' },
  { key: '高山太郎', name: '高山 太郎', dept: '出荷', empType: 'パート', flag: 1, row: 2, join: '2024-04-01' },
  { key: '武井好美', name: '武井 好美', dept: '出荷', empType: 'パート', flag: 1, row: 3, join: '2024-04-01' },
];
// 下の人（高山さん・武井さん）の今のシフト：10/11〜11/10 の全日に値を入れておく（上書きされたら分かるように）
function isoList() { const out = []; for (let d = new Date(Date.UTC(2026, 9, 11)); d <= new Date(Date.UTC(2026, 10, 10)); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; }
const ISOS = isoList();
function seedCells() {
  const m10 = { 高山太郎: {}, 武井好美: {} }, m11 = { 高山太郎: {}, 武井好美: {} };
  ISOS.forEach((iso, i) => {
    const t = iso < '2026-11-01' ? m10 : m11;
    t['高山太郎'][iso] = i % 3 === 0 ? '休' : '9:00-16:00';
    t['武井好美'][iso] = i % 4 === 0 ? '有休' : '8:00-12:00';
  });
  return { m10, m11 };
}

// 旧の勤務表のティエンさんの行と同じ形（25日分）。時間は「8:00-（改行）17:00」で " に囲まれ、休みは「休」
const TIEN_PATTERN = ['w', 'w', '休', 'w', 'w', 'w', '休', 'w', 'w', 'w', 'w', '休', 'w', 'w', 'w', '休', 'w', 'w', 'w', 'w', '休', 'w', 'w', 'w', 'w'];
const TIEN_TSV = TIEN_PATTERN.map(x => (x === 'w' ? '"8:00-\n17:00"' : x)).join('\t') + '\n';

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });

  async function open() {
    const { m10, m11 } = seedCells();
    const seed = {
      [`shiftSites/${SITE}/meta/members`]: { list: MEMBERS, updatedAt: 4102444800000 },
      [`shiftSites/${SITE}/months/2026-10`]: { cells: m10 },
      [`shiftSites/${SITE}/months/2026-11`]: { cells: m11 },
      [`shiftSites/${SITE}/meta/fixed`]: {},
    };
    const page = await openShiftPage(ctx, { seed, members: MEMBERS });
    page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
    await page.goto(URL);
    await page.waitForSelector('#grid tbody td.name[data-r]');
    // 行の順番を名前から引く
    const names = await page.$$eval('#grid tbody td.name[data-r]', tds => tds.map(td => [td.dataset.r, td.querySelector('.nm-main').textContent]));
    const rowOf = n => +names.find(([, t]) => t.startsWith(n))[0];
    const YU = await page.evaluate(() => leaveText('有休')); // 有給 → 有休 の表示
    return { page, rowOf, YU };
  }
  // 1行分のセルの文字（2段の表示は「8:00-17:00」のようにつながる）
  const rowTexts = (page, r) => page.$$eval(`#grid tbody td.cell[data-r="${r}"]`, tds => tds.map(td => td.textContent.trim()));
  const rowBad = (page, r) => page.$$eval(`#grid tbody td.cell[data-r="${r}"]`, tds => tds.filter(td => td.classList.contains('bad')).length);
  async function select(page, r0, c0, r1, c1) {
    await page.click(`#grid td.cell[data-r="${r0}"][data-c="${c0}"]`);
    if (r1 != null) await page.click(`#grid td.cell[data-r="${r1}"][data-c="${c1}"]`, { modifiers: ['Shift'] });
  }
  async function paste(page, text) {
    await page.evaluate(t => {
      const dt = new DataTransfer(); dt.setData('text/plain', t);
      document.querySelector('#grid td.cell').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    await page.waitForTimeout(150);
  }
  const toastText = page => page.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; });

  // ① 改行入りのセル1つ
  {
    const { page, rowOf, YU } = await open();
    const rT = rowOf('PHAM'), rK = rowOf('高山'), rB = rowOf('武井');
    const beforeK = await rowTexts(page, rK), beforeB = await rowTexts(page, rB);
    await select(page, rT, 2);
    await paste(page, '"8:00-\n17:00"\n');
    const t = await rowTexts(page, rT);
    check('①改行入り1セル：選んだセル（10/13）に 8:00-17:00 が入る', t[2] === '8:00-17:00', JSON.stringify(t.slice(0, 5)));
    check('①改行入り1セル：となりのセルは空のまま', t[1] === '' && t[3] === '', JSON.stringify(t.slice(0, 5)));
    check('①改行入り1セル：下の人（高山さん）の行は変わらない', eq(await rowTexts(page, rK), beforeK), JSON.stringify((await rowTexts(page, rK)).slice(0, 5)));
    check('①改行入り1セル：その下の人（武井さん）の行も変わらない', eq(await rowTexts(page, rB), beforeB), '');
    check('①改行入り1セル：赤い波線のセルは無い', (await rowBad(page, rT)) === 0, '');
    check('①改行入り1セル：「貼り付けました」と出る', (await toastText(page)) === '貼り付けました', await toastText(page));
    await page.waitForTimeout(1500);
    const v = await page.evaluate(site => (window.__db[`shiftSites/${site}/months/2026-10`].cells.PHAMVANTIEN || {})['2026-10-13'], SITE);
    check('①改行入り1セル：保存される値は 8:00-17:00', v === '8:00-17:00', v);
    await page.close();
  }

  // ② ティエンさんの行と同じ形（25日分、改行入りのセルと「休」が混ざる）
  {
    const { page, rowOf, YU } = await open();
    const rT = rowOf('PHAM'), rK = rowOf('高山'), rB = rowOf('武井');
    const beforeK = await rowTexts(page, rK), beforeB = await rowTexts(page, rB);
    await select(page, rT, 0);
    await paste(page, TIEN_TSV);
    const t = await rowTexts(page, rT);
    const want = TIEN_PATTERN.map(x => (x === 'w' ? '8:00-17:00' : '休'));
    check('②ティエンさんの行：25日分が1行に横に入る（10/11〜11/4）', eq(t.slice(0, 25), want), JSON.stringify(t.slice(0, 25)));
    check('②ティエンさんの行：26日目（11/5）から後は空のまま', t.slice(25, 31).every(x => x === ''), JSON.stringify(t.slice(25)));
    check('②ティエンさんの行：下の人（高山さん）の行は変わらない', eq(await rowTexts(page, rK), beforeK), JSON.stringify((await rowTexts(page, rK)).slice(0, 5)));
    check('②ティエンさんの行：その下の人（武井さん）の行も変わらない', eq(await rowTexts(page, rB), beforeB), '');
    check('②ティエンさんの行：赤い波線のセルは無い', (await rowBad(page, rT)) === 0, '');
    const sel = await page.evaluate(() => norm(sel));
    check('②ティエンさんの行：貼った後に選ばれているのは1行だけ（25日分）', eq(sel, { r0: rT, r1: rT, c0: 0, c1: 24 }), JSON.stringify(sel));
    await page.close();
  }

  // ③ "" を含むセル
  {
    const { page, rowOf, YU } = await open();
    const rT = rowOf('PHAM');
    // 前後の " だけ（中に "" が無い）："8:00-17:00" → 8:00-17:00
    await select(page, rT, 0);
    await paste(page, '"8:00-17:00"\t"9:00-\n16:00"');
    let t = await rowTexts(page, rT);
    check('③" で囲まれた改行の無いセルも読める（前後の " は残らない）', t[0] === '8:00-17:00' && t[1] === '9:00-16:00', JSON.stringify(t.slice(0, 3)));
    // "" は " に戻る。" が入った値はシフトとして読めないので、貼り付けをやめる（1つ目の値も入らない）
    await select(page, rT, 5);
    await paste(page, '"8:00-\n17:00"\t"8:00-""17:00"""');
    t = await rowTexts(page, rT);
    const msg = await toastText(page);
    check('③"" を含むセル：" に戻して読む（知らせに 8:00-"17:00" と出る）', msg.includes('「8:00-"17:00"」'), msg);
    check('③"" を含むセル：読めない値なので1セルも入らない', t[5] === '' && t[6] === '', JSON.stringify(t.slice(4, 8)));
    // 中の "" が改行・タブの前後にあっても、セルの区切りにならない
    await select(page, rT, 10);
    await paste(page, '"a""\tb"\t休');
    t = await rowTexts(page, rT);
    const msg2 = await toastText(page);
    check('③"" の後のタブはセルの区切りにならない（a"	b が1つの値）', msg2.includes('「a"b」') && !msg2.includes('「b') && t[10] === '' && t[11] === '', msg2 + ' ' + JSON.stringify(t.slice(10, 12)));
    await page.close();
  }

  // ④ 複数行・複数列（" で囲まれたセルが混ざる、行の区切りは \r\n）
  {
    const { page, rowOf, YU } = await open();
    const rT = rowOf('PHAM'), rK = rowOf('高山'), rB = rowOf('武井');
    const beforeB = await rowTexts(page, rB);
    const firstR = Math.min(rT, rK);
    await select(page, firstR, 3);
    await paste(page, '"8:00-\r\n17:00"\t休\t9-16\r\n有給\t"10:00-\r\n15:00"\t"8:00-\r\n12:00"\r\n');
    const t1 = await rowTexts(page, firstR), t2 = await rowTexts(page, firstR + 1);
    check('④複数行・複数列：1行目に 8:00-17:00・休・9:00-16:00 が入る', eq(t1.slice(3, 6), ['8:00-17:00', '休', '9:00-16:00']), JSON.stringify(t1.slice(3, 6)));
    check('④複数行・複数列：2行目に 有給・10:00-15:00・8:00-12:00 が入る', eq(t2.slice(3, 6), [YU, '10:00-15:00', '8:00-12:00']), JSON.stringify(t2.slice(3, 6)));
    check('④複数行・複数列：3行目（武井さん）は変わらない', eq(await rowTexts(page, rB), beforeB), '');
    const sel = await page.evaluate(() => norm(sel));
    check('④複数行・複数列：貼った範囲（2行×3列）が選ばれる', eq(sel, { r0: firstR, r1: firstR + 1, c0: 3, c1: 5 }), JSON.stringify(sel));
    await page.close();
  }

  // ⑤ 読めない値が1つでも入っていると、1セルも書き込まない
  {
    const { page, rowOf, YU } = await open();
    const rT = rowOf('PHAM'), rK = rowOf('高山');
    const beforeT = await rowTexts(page, rT), beforeK = await rowTexts(page, rK);
    await page.waitForTimeout(1500);
    const writes0 = await page.evaluate(() => window.__writes.length);
    await select(page, rT, 0);
    await paste(page, '"8:00-\n17:00"\t休\tあいう\t8:00-8:00\t17:00-8:00\tx\ty\n8:00-17:00\t\t\n');
    const msg = await toastText(page);
    check('⑤読めない値：知らせに「貼り付けをやめました」と出る', msg.includes('貼り付けをやめました'), msg);
    check('⑤読めない値：知らせに最初の3つ（あいう・8:00-8:00・17:00-8:00）が出る', msg.includes('「あいう」「8:00-8:00」「17:00-8:00」'), msg);
    check('⑤読めない値：4つ目から後は値を出さず件数だけ（ほか2件）', !msg.includes('「x」') && msg.includes('ほか2件'), msg);
    check('⑤読めない値：貼ろうとした行（ティエンさん）は1セルも変わらない', eq(await rowTexts(page, rT), beforeT), JSON.stringify((await rowTexts(page, rT)).slice(0, 5)));
    check('⑤読めない値：2行目（高山さん）も1セルも変わらない', eq(await rowTexts(page, rK), beforeK), '');
    await page.waitForTimeout(1500);
    check('⑤読めない値：Firestore にも書き込まない', (await page.evaluate(() => window.__writes.length)) === writes0, String(await page.evaluate(() => window.__writes.length)));
    // 1つの値を範囲に貼るときも同じ
    await select(page, rT, 0, rT, 3);
    await paste(page, 'あいう');
    check('⑤読めない値（1つの値を範囲に）：1セルも変わらない', eq(await rowTexts(page, rT), beforeT), JSON.stringify((await rowTexts(page, rT)).slice(0, 5)));
    check('⑤読めない値（1つの値を範囲に）：知らせが出る', (await toastText(page)).includes('「あいう」'), await toastText(page));
    // 空欄・休みの種類・印付きの時間は読める値（今の赤い波線と同じ判定）
    await select(page, rT, 0);
    await paste(page, '\t有給\t8-17配\t8:00-17:00栽4\t欠勤');
    const t = await rowTexts(page, rT);
    check('⑤空欄・有給・印付き（8-17配・栽4）・欠勤は読める値として入る', !(await toastText(page)).includes('やめました') && t[1] === YU && t[2] === '8:00-17:00' && t[3] === '8:00-17:00', (await toastText(page)) + JSON.stringify(t.slice(0, 5)));
    await page.close();
  }

  // ⑥ 今までどおりの貼り付け（" で囲まれていない値）
  {
    const { page, rowOf, YU } = await open();
    const rT = rowOf('PHAM'), rK = rowOf('高山');
    const firstR = Math.min(rT, rK);
    // タブと改行で分ける・全角や 〜 はそろえる
    await select(page, firstR, 0);
    await paste(page, '８〜１７\t休\n9-16\t有給\n');
    const t1 = await rowTexts(page, firstR), t2 = await rowTexts(page, firstR + 1);
    check('⑥" なし：タブと改行で分けて入る（全角・〜はそろえる）', eq(t1.slice(0, 2), ['8:00-17:00', '休']) && eq(t2.slice(0, 2), ['9:00-16:00', YU]), JSON.stringify([t1.slice(0, 2), t2.slice(0, 2)]));
    // 1つの値を範囲に貼ると、範囲のすべてに入る
    await select(page, firstR, 10, firstR + 1, 12);
    await paste(page, '8-12');
    const u1 = await rowTexts(page, firstR), u2 = await rowTexts(page, firstR + 1);
    check('⑥" なし：1つの値を範囲（2行×3列）に貼ると全部に入る', [...u1.slice(10, 13), ...u2.slice(10, 13)].every(x => x === '8:00-12:00'), JSON.stringify([u1.slice(10, 13), u2.slice(10, 13)]));
    // 右と下にはみ出した分は入らない（最後の日 11/10 は c=30）
    await select(page, 2, 29);
    await paste(page, '8-17\t9-16\t10-15\n8-12\t8-12\n');
    const last = await rowTexts(page, 2);
    check('⑥" なし：右にはみ出した分は入らない（11/9・11/10 だけ入る）', last[29] === '8:00-17:00' && last[30] === '9:00-16:00' && last.length === 31, JSON.stringify(last.slice(28)));
    check('⑥" なし：下にはみ出した分は入らず、エラーにならない', (await toastText(page)) === '貼り付けました', await toastText(page));
    // 途中に " があるセル（" で始まらない）は、今までどおりそのまま（読めない値として扱う）
    await select(page, firstR, 20);
    await paste(page, '8:00"-17:00\t休');
    check('⑥" なし：途中にだけ " がある値は囲みとして読まない', (await toastText(page)).includes('「8:00"-17:00」'), await toastText(page));
    await page.close();
  }

  // ⑦ 読み方の関数そのもの（閉じの " が無いときは今までどおり）
  {
    const { page } = await open();
    const p = s => page.evaluate(s => parseClipboardTSV(s), s);
    check('⑦空の文字は1セル（空）', eq(await p(''), [['']]), JSON.stringify(await p('')));
    check('⑦閉じの " が無いときは今までどおりタブ・改行で分ける', eq(await p('"8:00\n17:00\t休'), [['"8:00'], ['17:00', '休']]), JSON.stringify(await p('"8:00\n17:00\t休')));
    check('⑦最後の改行1つは行にしない', eq(await p('a\tb\n'), [['a', 'b']]), JSON.stringify(await p('a\tb\n')));
    check('⑦空のセルも数える', eq(await p('a\t\tb\n\tc'), [['a', '', 'b'], ['', 'c']]), JSON.stringify(await p('a\t\tb\n\tc')));
    check('⑦" で囲まれた中のタブ・改行・"" をそのまま1セルにする', eq(await p('"x\ty\nz""w"\tv'), [['x\ty\nz"w', 'v']]), JSON.stringify(await p('"x\ty\nz""w"\tv')));
    await page.close();
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
