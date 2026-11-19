// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）の出荷予定で、「販売予実抽出シート」の
// 月タブの列を、列番号の決め打ちではなく1〜3行目の見出し（拠点・版・販売形態/サイズ）から探す対応の検証。
// 実際のスプレッドシートには触れず、page.route()でCSV（/export?format=csv）を実際のシートの形に合わせてモックする
// （他ファイルへの依存なし）。モックの形（1拠点あたり）：
//   24列＝販売形態の側（月初・修正・受注 × 買取・市場・委託・全体）＋サイズの側（月初・修正・受注 × M・L・2L・袋）
//         （出荷実績なし。2026.12タブの見出しの形）
//   28列＝24列＋出荷実績（買取・市場・委託・全体）（2026.8〜11タブの形）
//   31列＝28列のサイズの側を M・L・2L・3L・袋 にしたもの（3L追加後の形）
//   見出しの1行目・2行目は「全部埋まっている形」（2026.11タブ）と「結合で左端以外が空欄の形」（2026.10タブ）の2通り
//   4行目以降＝日別（B列＝1〜31）、最後に「合計」行
// 数字を読まない列（月初計画・販売形態の側・出荷実績）には、読み違えるとすぐ分かるよう 900 番台の値を置く。
// 確かめること：
//  ①（ページの関数を直接呼ぶ）24列・28列・31列 × 見出しが埋まっている形・結合の形の6通りで、3拠点の
//    受注計画・修正計画が同じ数字で読めること／3Lだけ入力がある日を「受注計画が空欄」と判定しないこと／
//    カンマ付きの値（"1,012.1"）を数字として読むこと／「合計」行を日付として読まないこと／
//    見出しが見つからないとき（拠点・版・サイズ・日付の行）は列番号で読まずに理由を返すこと
//  ②（画面）基準日2026-11-28（当日〜8日後＝11/28〜12/6）で、11月＝31列（3L入り・結合の形）・
//    12月＝24列（出荷実績なし・埋まっている形）のとき、群馬・南丹・いなべの出荷予定が正しい数字になること
//  ③（画面）12月タブで群馬の受注計画の「袋」の見出しが無いとき、12月の日は M・L・2L・袋 が「－」になり、
//    出荷予定の注意が出ること（11月の日はそのまま表示）。見出しがそろっていれば注意は出ないこと
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/shipment-plan/verify_shipment_plan_sales_plan_columns.js
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

const SALES_SHEET_ID = '18zyC0JwVyaW3i18LQdvHQeDpEcfzM8iolhclgNocrnM';
const SALES_INDEX_GID = '538861653'; // 「シート判別」タブ
const NOV_MONTH_GID = '333333331';
const DEC_MONTH_GID = '333333332';
const PAGE_URL = 'http://localhost:8812/shiitake-shipment-plan.html';
const SITES = ['いなべ', '群馬', '南丹'];

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`); }

// 月タブを作る。opts.form：24 / 28 / 31（1拠点の列数）、opts.merged：見出しの1・2行目を結合の形（左端以外空欄）にする、
// opts.maxDay：日数、opts.values：{ 拠点: { 日: { order: {M,L,2L,3L,袋}, revised: {…} } } }、
// opts.headerPatch(head)：見出しを書き換える（見出しが見つからないときの確認用）
function buildSalesTab(opts) {
  const FORMS = ['買取', '市場', '委託', '全体'];
  const SIZES = opts.form === 31 ? ['M', 'L', '2L', '3L', '袋'] : ['M', 'L', '2L', '袋'];
  const groups = [['月初計画', FORMS], ['修正計画', FORMS], ['受注計画', FORMS], ['月初計画', SIZES], ['修正計画', SIZES], ['受注計画', SIZES]];
  if (opts.form !== 24) groups.push(['出荷実績', FORMS]);
  const head = [['', '拠点'], ['', '版'], ['', '販売形態/サイズ']];
  const pos = {}; // pos[拠点][版|サイズ側][サイズ] = 列番号
  SITES.forEach(site => {
    pos[site] = {};
    let firstOfSite = true;
    groups.forEach(([ver, names], gi) => {
      const sizeSide = gi >= 3 && gi <= 5;
      names.forEach((n, k) => {
        const col = head[0].length;
        head[0].push(opts.merged && !firstOfSite && !(ver === '出荷実績') ? '' : site);
        head[1].push(k === 0 ? ver : '');
        head[2].push(n);
        firstOfSite = false;
        if (sizeSide) { pos[site][ver] = pos[site][ver] || {}; pos[site][ver][n] = col; }
      });
    });
  });
  if (opts.headerPatch) opts.headerPatch(head, pos);
  const width = head[0].length;
  const rows = head.map(r => r.slice());
  for (let day = 1; day <= opts.maxDay; day++) {
    // 読まない列には 900 番台の値（読み違えたらすぐ分かる）
    const r = new Array(width).fill('');
    r[0] = day === 1 ? '日付' : ''; r[1] = String(day);
    for (let c = 2; c < width; c++) r[c] = String(900 + (c % 90));
    SITES.forEach(site => ['修正計画', '受注計画'].forEach(ver => SIZES.forEach(sz => { r[pos[site][ver][sz]] = ''; })));
    const v = (opts.values || {});
    SITES.forEach(site => {
      const dv = v[site] && v[site][day];
      if (!dv) return;
      ['order', 'revised'].forEach(key => {
        const ver = key === 'order' ? '受注計画' : '修正計画';
        Object.keys(dv[key] || {}).forEach(sz => { if (pos[site][ver][sz] !== undefined) r[pos[site][ver][sz]] = dv[key][sz]; });
      });
    });
    rows.push(r);
  }
  const total = new Array(width).fill(''); total[1] = '合計';
  for (let c = 2; c < width; c++) total[c] = '12,345.6';
  rows.push(total);
  return rows;
}
// CSVエクスポートを読んだときと同じ形（セルの値はすべて文字列）にする
function toJson(rows) { return { table: { rows: rows.map(r => ({ c: r.map(v => ({ v: String(v) })) })) } }; }

// ①で使う日別の値（3拠点で別々の数字にして、拠点の取り違えも分かるようにする）
function unitValues(with3L) {
  const v = {};
  SITES.forEach((site, si) => {
    const b = (si + 1) * 10;
    v[site] = {
      1: { order: { M: b + 1, L: '1,012.1', '2L': b + 3, '袋': b + 4 }, revised: { M: 1, L: 2, '2L': 3, '袋': 4 } },
      2: { revised: { M: b + 5, L: b + 6, '2L': b + 7, '袋': b + 8 } },
      3: with3L ? { order: { '3L': b + 9 }, revised: { M: 1, L: 2, '2L': 3, '袋': 4 } } : {},
      4: with3L ? { order: { M: b, L: b, '2L': b, '3L': '2,000.5', '袋': b } } : {},
    };
    if (with3L) v[site][1].order['3L'] = b + 2;
  });
  return v;
}

function buildSalesIndexCsv() {
  return toCsvText([
    ['年月', 'URL'],
    ['2026.11', 'https://docs.google.com/spreadsheets/d/' + SALES_SHEET_ID + '/edit#gid=' + NOV_MONTH_GID],
    ['2026.12', 'https://docs.google.com/spreadsheets/d/' + SALES_SHEET_ID + '/edit#gid=' + DEC_MONTH_GID],
  ]);
}

// ②③の画面で使う値。11/28〜11/30は11月タブ（31列・結合）、12/1〜12/6は12月タブ（24列・埋まっている形）
const PAGE_NOV = {
  'いなべ': { 28: { order: { M: 1, L: 2, '2L': 3, '3L': 4, '袋': 5 } } },
  '群馬': {
    28: { order: { M: 11, L: '1,012.1', '2L': 13, '3L': 14, '袋': 15 } },
    29: { order: { '3L': 7 }, revised: { M: 91, L: 92, '2L': 93, '袋': 94 } }, // 3Lだけ入力 → 受注計画のまま
    30: { revised: { M: 21, L: 22, '2L': 23, '3L': 24, '袋': 25 } },            // 受注計画が全部空欄 → 修正計画
  },
  '南丹': { 28: { order: { M: 31, L: 32, '2L': 33, '3L': 34, '袋': 35 } } },
};
const PAGE_DEC = {
  'いなべ': { 1: { order: { M: 101, L: 102, '2L': 103, '袋': 104 } } },
  '群馬': {
    1: { order: { M: 41, L: 42, '2L': 43, '袋': 44 } },
    2: { revised: { M: 51, L: 52, '2L': 53, '袋': 54 } },
    6: { order: { M: 61, L: 62, '2L': 63, '袋': 64 } },
  },
  '南丹': {
    1: { order: { M: 71, L: 72, '2L': 73, '袋': 74 } },
    2: { revised: { M: 81, L: 82, '2L': 83, '袋': 84 } },
  },
};

async function setupPage(browser, site, decHeaderPatch) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await fixTodayTo(page, 2026, 10, 28);
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    let body = '﻿\r\n';
    if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_INDEX_GID)) body = buildSalesIndexCsv();
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + NOV_MONTH_GID)) body = toCsvText(buildSalesTab({ form: 31, merged: true, maxDay: 30, values: PAGE_NOV }));
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + DEC_MONTH_GID)) body = toCsvText(buildSalesTab({ form: 24, merged: false, maxDay: 31, values: PAGE_DEC, headerPatch: decHeaderPatch }));
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
  });
  await page.goto(PAGE_URL + (site === 'いなべ' ? '' : '?site=' + encodeURIComponent(site)));
  await page.waitForSelector('#table1');
  return page;
}
async function shipmentRow(page, offset) {
  return page.evaluate(o => ['M', 'L', '2L', '袋'].map(s => {
    const el = document.querySelector('[data-shipment="' + s + '"][data-shipment-offset="' + o + '"]');
    return el ? el.textContent.trim() : null;
  }), offset);
}
async function waitShipment(page, expectedFirst) {
  for (let i = 0; i < 60; i++) {
    const v = (await shipmentRow(page, 0))[0];
    if (v === expectedFirst) { await page.waitForTimeout(400); return; }
    await page.waitForTimeout(150);
  }
}
async function shipmentNote(page) {
  return page.evaluate(() => { const el = document.getElementById('table1ShipmentNote'); return el ? { hidden: el.hidden, text: el.textContent } : null; });
}
const D = '－';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await chromium.launch();

  console.log('=== ①見出しから列を探す（24列・28列・31列 × 見出しが埋まっている形・結合の形） ===');
  {
    const page = await browser.newPage();
    await page.goto(PAGE_URL);
    await page.waitForFunction(() => window.__test && window.__test.readSalesPlan);
    const read = (rows, site, day) => page.evaluate(([json, s, d]) => window.__test.readSalesPlan(json, s, d), [toJson(rows), site, day]);
    const strip = p => { const o = {}; ['M', 'L', '2L', '3L', '袋', 'revised', 'error'].forEach(k => { if (p[k] !== undefined) o[k] = p[k]; }); return o; };

    for (const form of [24, 28, 31]) {
      const with3L = form === 31;
      const values = unitValues(with3L);
      const filled = buildSalesTab({ form, merged: false, maxDay: 30, values });
      const merged = buildSalesTab({ form, merged: true, maxDay: 30, values });
      for (let si = 0; si < SITES.length; si++) {
        const site = SITES[si];
        const b = (si + 1) * 10;
        const d1 = strip(await read(filled, site, 1));
        const exp1 = { M: b + 1, L: 1012.1, '2L': b + 3, '3L': with3L ? b + 2 : null, '袋': b + 4 };
        check(`${form}列 ${site} 1日：受注計画（カンマ付き "1,012.1" も数字）`, same(d1, exp1), d1);
        const d2 = strip(await read(filled, site, 2));
        check(`${form}列 ${site} 2日：受注計画が空欄 → 修正計画`, same(d2, { M: b + 5, L: b + 6, '2L': b + 7, '3L': null, '袋': b + 8, revised: true }), d2);
        for (const day of [1, 2, 3, 4]) {
          const a = strip(await read(filled, site, day));
          const m = strip(await read(merged, site, day));
          if (!same(a, m)) check(`${form}列 ${site} ${day}日：結合の形でも同じ数字`, false, { filled: a, merged: m });
        }
        check(`${form}列 ${site}：見出しの1・2行目が結合で空欄の形でも、埋まっている形と同じ数字（1〜4日）`, true);
        if (with3L) {
          const d3 = strip(await read(filled, site, 3));
          check(`31列 ${site} 3日：3Lだけ入力がある日は「受注計画が空欄」と判定しない（修正計画に替えない）`,
            same(d3, { M: null, L: null, '2L': null, '3L': b + 9, '袋': null }), d3);
          const d4 = strip(await read(filled, site, 4));
          check(`31列 ${site} 4日：3Lのカンマ付き "2,000.5" を数字として読む`, d4['3L'] === 2000.5 && d4.M === b, d4);
        }
      }
    }

    // 「合計」行を日付として読まない：30日までの月で31日を読むと「行が見つかりません」になる（合計の 12,345.6 を読まない）
    {
      const rows = buildSalesTab({ form: 28, merged: false, maxDay: 30, values: unitValues(false) });
      const layout = await page.evaluate(json => window.__test.buildSalesPlanLayout(json), toJson(rows));
      const days = Object.keys(layout.dayRows).map(Number);
      check('「合計」行は日付の行に入らない（日付の行は1〜30日の30行）', days.length === 30 && Math.max(...days) === 30 && !Object.values(layout.dayRows).includes(rows.length - 1), days);
      const p31 = strip(await read(rows, '群馬', 31));
      check('30日までの月で31日を読むと、合計行の値ではなく「31日の行が見つかりません」', p31.error === '31日の行が見つかりません' && p31.M === undefined, p31);
    }

    // 見出しが見つからないとき：列番号で読まずに理由を返す
    {
      const v = unitValues(true);
      const noBag = buildSalesTab({ form: 31, merged: false, maxDay: 30, values: v, headerPatch: (head, pos) => { head[2][pos['群馬']['受注計画']['袋']] = '袋品'; } });
      const e1 = strip(await read(noBag, '群馬', 1));
      check('群馬の受注計画の「袋」の見出しが無い → 「群馬の受注計画（袋）の見出しが見つかりません」', e1.error === '群馬の受注計画（袋）の見出しが見つかりません' && e1.M === undefined, e1);
      const okOther = strip(await read(noBag, 'いなべ', 1));
      check('同じタブでも見出しがそろっている拠点（いなべ）はそのまま読める', okOther.M === 11 && !okOther.error, okOther);
      const noRevised = buildSalesTab({ form: 28, merged: true, maxDay: 30, values: v, headerPatch: (head, pos) => { head[1][pos['南丹']['修正計画']['M']] = '修正'; } });
      const e2 = strip(await read(noRevised, '南丹', 1));
      check('南丹の「修正計画」の見出しが無い → 「南丹の修正計画の見出しが見つかりません」', e2.error === '南丹の修正計画の見出しが見つかりません', e2);
      const noSite = buildSalesTab({ form: 24, merged: false, maxDay: 30, values: v, headerPatch: head => { head[0] = head[0].map(x => x === '南丹' ? '' : x); } });
      const e3 = strip(await read(noSite, '南丹', 1));
      // 南丹の拠点名が無いと南丹の列は左の「群馬」を引き継ぐが、群馬の版・サイズは先に見つかった列を使うので群馬は変わらない
      check('拠点名「南丹」の見出しが無い → 「南丹の見出しが見つかりません」', e3.error === '南丹の見出しが見つかりません', e3);
      const g3 = strip(await read(noSite, '群馬', 1));
      check('拠点名「南丹」の見出しが無くても、群馬は群馬の列から読む', g3.M === 21 && g3['袋'] === 24, g3);
      const noDays = buildSalesTab({ form: 28, merged: false, maxDay: 30, values: v });
      noDays.slice(3).forEach(r => { if (r[1] === '5') r[1] = ''; });
      const e4 = strip(await read(noDays, 'いなべ', 5));
      check('B列に日付（5）が無い → 「5日の行が見つかりません」', e4.error === '5日の行が見つかりません', e4);
    }
    await page.close();
  }

  console.log('=== ②画面：11月＝31列（3L入り・結合の形）、12月＝24列（出荷実績なし） ===');
  {
    const expect = {
      '群馬': [
        ['11.0', '1012.1', '27.0', '15.0'], // 11/28 受注計画（カンマ付き）。2Lの行は2L＋3L（13＋14）
        [D, D, '7.0', D],                   // 11/29 3Lだけ入力 → 受注計画のまま。2Lの行は3Lの7だけ
        ['21.0', '22.0', '47.0', '25.0'],   // 11/30 修正計画（2L＋3L＝23＋24）
        ['41.0', '42.0', '43.0', '44.0'],   // 12/1 受注計画（24列）
        ['51.0', '52.0', '53.0', '54.0'],   // 12/2 修正計画（24列）
        [D, D, D, D], [D, D, D, D], [D, D, D, D],
        ['61.0', '62.0', '63.0', '64.0'],   // 12/6
      ],
      '南丹': [
        ['31.0', '32.0', '67.0', '35.0'], [D, D, D, D], [D, D, D, D], // 11/28 2L＋3L＝33＋34
        ['71.0', '72.0', '73.0', '74.0'], ['81.0', '82.0', '83.0', '84.0'],
        [D, D, D, D], [D, D, D, D], [D, D, D, D], [D, D, D, D],
      ],
      'いなべ': [
        ['1.0', '2.0', '7.0', '5.0'], [D, D, D, D], [D, D, D, D], // 11/28 2L＋3L＝3＋4
        ['101.0', '102.0', '103.0', '104.0'],
        [D, D, D, D], [D, D, D, D], [D, D, D, D], [D, D, D, D], [D, D, D, D],
      ],
    };
    for (const site of ['群馬', '南丹', 'いなべ']) {
      const page = await setupPage(browser, site);
      await waitShipment(page, expect[site][0][0]);
      const got = [];
      for (let o = 0; o <= 8; o++) got.push(await shipmentRow(page, o));
      // 1012.1 は画面では "1012.1"（fmtStockNumberは桁区切りを付けない）
      const ok = same(got, expect[site]);
      check(`${site}：11/28〜12/6 の出荷予定（M・L・2L・袋）が見出しどおりの列の値`, ok, got);
      if (site === '群馬') {
        check('群馬 11/29：3Lだけ入力がある日は修正計画（91〜94）に替えない（2Lの行は3Lの7.0、ほかは「－」）', same(got[1], [D, D, '7.0', D]), got[1]);
        // 3Lは2Lの内訳の行（sub3L）に出る（11/28：内訳2L＝13.0・内訳3L＝14.0）
        const sub = await page.evaluate(() => ['sub2L', 'sub3L'].map(k => document.querySelector('[data-shipment="' + k + '"][data-shipment-offset="0"]').textContent.trim()));
        check('3Lは2Lの内訳の行に出る（11/28：内訳2L 13.0・内訳3L 14.0）', same(sub, ['13.0', '14.0']), sub);
      }
      const note = await shipmentNote(page);
      check(`${site}：見出しがそろっているので出荷予定の注意は出ない`, note && note.hidden && note.text === '', note);
      await page.close();
    }
  }

  console.log('=== ③画面：12月タブの群馬の受注計画「袋」の見出しが無い ===');
  {
    const patch = (head, pos) => { head[2][pos['群馬']['受注計画']['袋']] = ''; };
    const page = await setupPage(browser, '群馬', patch);
    await waitShipment(page, '11.0');
    const got = [];
    for (let o = 0; o <= 8; o++) got.push(await shipmentRow(page, o));
    check('11月の日（11/28）はそのまま表示（2Lの行は2L＋3L）', same(got[0], ['11.0', '1012.1', '27.0', '15.0']), got[0]);
    check('12月の日（12/1〜12/6）は M・L・2L・袋 が「－」（列番号で読まない）', got.slice(3).every(r => same(r, [D, D, D, D])), got.slice(3));
    const note = await shipmentNote(page);
    check('出荷予定の注意が出る（2026.12・群馬の受注計画（袋）の見出しが見つからない）', note && !note.hidden &&
      note.text.includes('2026.12：群馬の受注計画（袋）の見出しが見つかりません') && note.text.includes('「－」'), note);
    // 拠点を切り替えると注意は消える（南丹は見出しがそろっている）
    await page.click('#siteToggle button[data-site="南丹"]');
    await waitShipment(page, '31.0');
    const note2 = await shipmentNote(page);
    check('南丹に切り替えると注意は消える', note2 && note2.hidden && note2.text === '', note2);
    await page.close();
  }

  await browser.close();
  const ng = results.filter(r => !r.ok).length;
  console.log(ng === 0 ? `すべてOK (OK ${results.length} / NG 0)` : `NGあり (OK ${results.length - ng} / NG ${ng})`);
  console.log('DONE');
  process.exit(ng === 0 ? 0 : 1);
})();
