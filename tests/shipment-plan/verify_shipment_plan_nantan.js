// 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）の南丹対応の検証。
// 実際のスプレッドシートには触れず、page.route()でCSV（/export?format=csv）を実際のシートの形
// （南丹の在庫ファイル・マスターシート・販売予実抽出シート・南丹_受注・南丹収穫管理表・
// 月ごとの「南丹11月売上高＆収穫量」）に合わせてモックする（他ファイルへの依存なし）。
// 実データは2026-11-02に読み取った値（10/31・11/1の製品在庫、11/2の受注計画など）。
// 確かめること：
//  ① 製品在庫の計算（computeNantanProductStock）：品目ごとの「箱数×1cs重量」で、10/31・11/1の
//     M・L・2L・袋と、Lの内訳の秀・優が目安どおりになること（3Lは2L、袋②は袋、L・Mは50/50、
//     秀袋200gは優のL、パック端数はどこにも入れない、受注タブと分け方が違う品目の上書き）
//  ② 数量の読み取り（"9箱"・"80袋"・"12 パック"・"1.00kg"・空欄）と、サイズの振り分け（splitStockSizes）
//  ③ 同じ名前の品目は出てくる順にマスターシートと対応させ、在庫タブとマスターシートで同じ名前の行の
//     数が違うときはmismatchesに残ること（気づけるようにするテスト）
//  ④ ?site=南丹 で開いたパネル1〜3：製品在庫・生在庫（秀・優の生在庫は「－」）、出荷予定（受注計画が
//     いなべのW〜Z列より+56列＝CA〜CD列、受注計画が全部空欄の日は修正計画で秀・優は「－」、秀・優は
//     南丹_受注）、収穫実績・比率（南丹収穫管理表の8区分）、日別の収穫予測（月ごとのシートの収穫見込）、
//     在庫予測。収穫予測・在庫予測の秀・優は「－」（収穫時点では分けていないため）
//  ⑤ 詳細（収穫見込：手入力）が南丹でも使えること（入力欄が有効・収穫見込GASへ site=南丹 で読み込み）
//  ⑥ URL_在庫管理表の南丹の欄が空のとき、全サイズが「－」＋「在庫管理表がありません」の注記
// 実行：dashboard フォルダを 8812 番で配信してから
//       node tests/shipment-plan/verify_shipment_plan_nantan.js
const { chromium } = require('playwright');

function csvCell(v) { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsvText(rows) { return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
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

let allOk = true;
function check(name, cond, extra) {
  const ok = !!cond;
  if (!ok) allOk = false;
  console.log((ok ? 'OK   ' : 'NG   ') + name + (ok ? '' : '  → ' + (extra === undefined ? '' : JSON.stringify(extra))));
}

const PAGE_URL = 'http://localhost:8812/shiitake-shipment-plan.html';
const DB_SHARE_SHEET_ID = '1Hy74BTGp25GwOiomNeYCFQWD3jkdFKDa5aJ6FETP9Tg';
const STOCK_URL_SHEET_GID = '717295394';
const HARVEST_URL_SHEET_GID = '1996914203';
const NANTAN_STOCK_SHEET_ID = '1hjwEeWmR9EmweQur1ZtNe5q4zWVaak2lurFXLoJTr5c';
const NANTAN_STOCK_GID = '0';
const NANTAN_MASTER_GID = '1337213550';
const NANTAN_HARVEST_SHEET_ID = '1tgwohUlhAtUdZbenHmMZk9WM7YyDgWyNqB5eX-If7m4'; // 11月南丹収穫管理表
const HARVEST_TARGET_GID = '676064999';
const MONTHLY_SHEET_ID = '1VtDcGx7MLKJM4gkbgP0VAdkn6EpoIfOXhZVa3u80m2c';
const MONTHLY_NOV_GID = '1898984985';
const SALES_SHEET_ID = '18zyC0JwVyaW3i18LQdvHQeDpEcfzM8iolhclgNocrnM';
const SALES_INDEX_GID = '538861653';
const NOV_MONTH_GID = '2057323187';
const SALES_RAW_SHEET_ID = '17DD5aRxc9bv8uZzEfnK_Q9IGOvQVH4ieJU1c-qu7dOc';
const NANTAN_ORDER_GID = '24647903';
const FAKE_GAS = 'https://script.google.com/macros/s/AKfycbwZ3RlwF2Gh3aMLesUl6AOq5y5p7rbLF5OILYSmkGQ_2d-XExCoPTknJdBm7bOX7B8bNg/exec';

// ===== マスターシート（実際の南丹の在庫ファイルの内容。列＝品目名・表記ゆれ・等級・サイズ・梱包・入数・既定g・1cs重量）=====
const MASTER_ROWS = [
  ['秀パック端数', '', '秀', '―', 'パック', '1', '120', '0.12'],
  ['優パック端数', '', '優', '―', 'パック', '1', '110', '0.11'],
  ['宝珠3L6', '宝珠3L6 / 宝珠3L6', '宝珠', '3L', 'パック', '14', '300', '4.2'],
  ['宝珠3L8', '宝珠3L8 / 宝珠3L8', '宝珠', '3L', 'パック', '14', '400', '5.6'],
  ['秀3L', '秀3L', '秀', '3L', 'パック', '14', '250', '3.5'],
  ['優3L6 14入', '優2L8/優3L6', '優', '3L', 'パック', '14', '200', '2.8'],
  ['優3L6 20入', '優2L8/優3L6', '優', '3L', 'パック', '20', '200', '4'],
  ['秀2L4', '秀2L4', '秀', '2L', 'パック', '30', '130', '3.9'],
  ['秀2L6', '秀2L6', '秀', '2L', 'パック', '14', '200', '2.8'],
  ['秀2L6', '秀2L6', '秀', '2L', 'パック', '20', '200', '4'],
  ['秀2L8', '秀2L8 / 秀2L8', '秀', '2L', 'パック', '14', '200', '2.8'],
  ['優2L4', '優2L4', '優', '2L', 'パック', '30', '110', '3.3'],
  ['優2L6', '優2L6', '優', '2L', 'パック', '14', '200', '2.8'],
  ['優2L8', '優2L8', '優', '2L', 'パック', '14', '200', '2.8'],
  ['優2L袋', '優2L袋 / 優2L袋', '優', '2L', '袋', '20', '200', '4'],
  ['優2L8/優3L6', '優2L8/優3L6', '優', '2L・3L', 'パック', '14', '200', '2.8'],
  ['秀2L6 / 秀2L8', '秀2L6 / 秀2L8', '秀', '2L', 'パック', '14', '200', '2.8'],
  ['秀2L6 / 秀2L8 20入', '', '秀', '2L', 'パック', '20', '200', '4'],
  ['秀L6', '秀L6 / 秀L6', '秀', 'L', 'パック', '30', '130', '3.9'],
  ['秀L6(シール有)', '秀L6 / 秀L6', '秀', 'L', 'パック', '30', '130', '3.9'],
  ['秀L5', '秀L5', '秀', 'L', 'パック', '30', '100', '3'],
  ['秀L3', '秀L3', '秀', 'L', 'パック', '30', '70', '2.1'],
  ['優L5', '優L5', '優', 'L', 'パック', '30', '80', '2.4'],
  ['優L6', '優L6', '優', 'L', 'パック', '30', '110', '3.3'],
  ['優L6 40入', '優L6', '優', 'L', 'パック', '40', '110', '4.4'],
  ['優L6/優M8', '優L6/優M8', '優', 'L・M', 'パック', '30', '110', '3.3'],
  ['秀M8', '秀M8 / 秀M8', '秀', 'M', 'パック', '30', '130', '3.9'],
  ['優M8', '優M8', '優', 'M', 'パック', '30', '110', '3.3'],
  ['良品小パック', '', '袋①', '―', 'パック', '35', '80', '2.8'],
  ['秀袋200g(B-L)', '秀袋 / 秀袋200g', '優', 'L', '袋', '25', '200', '5'],
  ['秀袋200g(B-2L)', '秀袋 / 秀袋200g', '優', 'L', '袋', '25', '200', '5'],
  ['秀袋200g(B-L、B-2L)', '秀袋 / 秀袋200g', '優', 'L・2L', '袋', '25', '200', '5'],
  ['袋100g', '袋100g', '袋①', '―', '袋', '40', '100', '4'],
  ['ビック優バラパック', '', '袋①', '―', 'パック', '20', '', '3'],
  ['ビック秀バラパック', '', '秀', 'L', 'パック', '20', '', '3'],
  ['袋150g(40入り)(シール有)', '袋150g', '袋①', '―', '袋', '40', '150', '6'],
  ['袋150g(30入り)(シール有)', '袋150g', '袋①', '―', '袋', '30', '150', '4.5'],
  ['袋150g(30入り)', '袋150g', '袋①', '―', '袋', '30', '150', '4.5'],
  ['袋150g(20入り)', '袋150g', '袋①', '―', '袋', '20', '150', '3'],
  ['袋150g(25入り)', '袋150g', '袋①', '―', '袋', '25', '150', '3.75'],
  ['袋大パック150g(20入り)', '袋150g', '袋①', '―', 'パック', '20', '150', '3'],
  ['袋150g(シール無)', '', '袋①', '―', '袋', '1', '150', '0.15'],
  ['袋200g', '袋200g', '袋①', '―', '袋', '20', '200', '4'],
  ['袋220g', '袋220g', '袋①', '―', '袋', '20', '220', '4.4'],
  ['袋250g', '袋250g', '袋①', '―', '袋', '20', '250', '5'],
  ['袋150g(シール有)', '', '袋①', '―', '袋', '1', '150', '0.15'],
  ['秀袋200g単品', '', '優', 'L', '袋', '1', '200', '0.2'],
  ['袋300g(シール有)', '袋300g', '袋②', '―', '袋', '1', '300', '0.3'],
  ['袋350g(シール有)', '', '袋①', '―', '袋', '1', '350', '0.35'],
  ['袋500g(シール有)', '袋500g', '袋①', '―', '袋', '1', '500', '0.5'],
  ['D袋500g(シール有)', '', '袋②', '―', '袋', '1', '500', '0.5'],
  ['D袋300g(シール有)', '', '袋②', '―', '袋', '1', '300', '0.3'],
  ['スタンドパック150g', '', '袋①', '', '袋', '1', '150', '0.15'],
  ['優2L8(シール有)', '', '優', '2L', 'パック', '1', '200', '0.2'],
  ['3L袋200g', '', '優', '3L', '袋', '1', '200', '0.2'],
  ['3L袋500g', '3L大袋 / 3L大袋', '優', '3L', '袋', '1', '500', '0.5'],
  ['外パック', '', '袋②', '―', 'パック', '1', '250', '0.25'],
  ['L4', 'L4', '無印', 'L', 'パック', '30', '70', '2.1'],
  ['バラ1kg', 'バラ1kg', '無印', '―', 'バラ', '', '1000', '0'],
  ['バラ', 'バラ', '無印', '―', 'バラ', '', '9000', '0'],
  ['チビ用カップ', 'チビ用カップ', '無印', 'S', 'パック', '', '80', '0'],
  ['秀バラ1kg', '秀バラ1kg', '秀', 'L', 'バラ', '1', '1000', '1'],
  ['秀L バラ5kg', '秀L バラ5kg', '無印', 'L', 'バラ', '1', '5000', '5'],
  ['優Mバラ6kg', '秀L バラ5kg', '無印', 'M', 'バラ', '1', '6000', '6'],
  ['2Lバラ3kg', '秀L バラ5kg', '無印', '2L', 'バラ', '1', '3000', '3'],
  ['規格外 バラ5キロ', '規格外 バラ5キロ', '袋②', '―', 'バラ', '1', '5000', '5'],
  ['規格外バラ3キロ', '規格外バラ3キロ', '袋②', '―', 'バラ', '1', '3000', '3'],
  ['優バラ1kg', '優バラ1kg', '袋①', '―', 'バラ', '1', '1000', '1'],
  ['優バラ2kg', '優バラ5kg / 優バラ5kg', '袋①', '―', 'バラ', '1', '2000', '2'],
  ['優バラ3kg', '優バラ5kg / 優バラ5kg', '袋①', '―', 'バラ', '1', '3000', '3'],
  ['優バラ5kg', '優バラ5kg / 優バラ5kg', '袋①', '―', 'バラ', '1', '5000', '5'],
  ['芽かきバラ5kg', '優バラ5kg / 優バラ5kg', '袋②', '―', 'バラ', '1', '5000', '5'],
];
const MASTER_HEADER = ['', '表記ゆれ（ / 区切り）', '等級', 'サイズ', '梱包', '入数', '既定g', '1cs重量'];

// ===== 椎茸在庫タブの製品在庫の品目（並びは実際の在庫ファイルのとおり。名前が重複するものを含む）と数量[10/31, 11/1] =====
// 数量の書き方（"29箱"・"80袋"・"12パック"・"13 箱"・"160 パック"）も実際のセルの表示のまま
const STOCK_ITEMS = [
  ['宝珠3L6', '', ''], ['宝珠3L8', '', ''], ['秀3L', '', ''],
  ['優3L6 14入', '15箱', '3箱'], ['優3L6 20入', '', ''],
  ['秀2L4', '', '6箱'], ['秀2L6', '', ''], ['秀2L6', '', ''], ['秀2L8', '', ''],
  ['優2L4', '10箱', ''], ['優2L6', '', ''], ['優2L8', '14箱', ''], ['優2L袋', '', ''],
  ['優2L8/優3L6', '', ''], ['秀2L6 / 秀2L8', '', ''], ['秀2L6 / 秀2L8 20入', '', ''],
  ['秀L6', '29箱', '12箱'], ['秀L6(シール有)', '', ''], ['秀L5', '', ''], ['秀L3', '', ''],
  ['優L5', '', ''], ['優L6', '40箱', '1箱'], ['優L6 40入', '', ''], ['優L6/優M8', '', ''],
  ['秀M8', '12箱', '1箱'], ['優M8', '34箱', '5箱'],
  ['良品小パック', '', '5箱'],
  ['秀袋200g(B-L)', '2箱', ''], ['秀袋200g(B-2L)', '', '32箱'], ['秀袋200g(B-L、B-2L)', '', ''],
  ['袋100g', '', ''], ['ビック優バラパック', '', ''], ['ビック秀バラパック', '', ''],
  ['袋150g(40入り)(シール有)', '', ''], ['袋150g(30入り)(シール有)', '', ''], ['袋150g(30入り)', '', '9箱'],
  ['袋150g(20入り)', '', ''], ['袋150g(25入り)', '', ''], ['袋大パック150g(20入り)', '', ''],
  ['袋200g', '', ''], ['袋220g', '', ''], ['袋250g', '', ''],
  ['袋300g(シール有)', '', ''], ['袋150g(シール無)', '', ''], ['袋150g(シール有)', '', '80袋'],
  ['秀袋200g単品', '', ''], ['袋300g(シール有)', '', ''], ['袋350g(シール有)', '', '80袋'],
  ['袋500g(シール有)', '', ''], ['D袋500g(シール有)', '', '5袋'], ['D袋300g(シール有)', '', ''],
  ['スタンドパック150g', '', ''], ['優2L8(シール有)', '', '12パック'], ['外パック', '', ''],
  ['3L袋200g', '', ''], ['3L袋500g', '', ''], ['L4', '', ''], ['バラ1kg', '', ''], ['バラ', '', ''],
  ['チビ用カップ', '', ''], ['秀バラ1kg', '', ''], ['秀L バラ5kg', '', ''], ['規格外 バラ5キロ', '', ''],
  ['規格外バラ3キロ', '13 箱', ''], ['芽かきバラ5kg', '', ''], ['優バラ1kg', '', ''], ['優Mバラ6kg', '', '1箱'],
  ['優バラ2kg', '', ''], ['優バラ3kg', '', ''], ['優バラ5kg', '', '3 箱'],
  ['秀パック端数', '', '160 パック'], ['優パック端数', '', '119 パック'], ['秀大パック端数', '', ''], ['優大パック端数', '', ''],
];
// 10/31・11/1 の目安（箱数×1cs重量。パック端数は入れない）
const EXPECTED = {
  '10/31': { M: 159.0, L: 255.1, '2L': 114.2, '袋': 39.0, 秀: 113.1, 優: 142.0 },
  '11/1':  { M: 26.4, L: 210.1, '2L': 34.2, '袋': 112.0, 秀: 46.8, 優: 163.3 },
};

// 「椎茸在庫」タブ：1行目=日付(m/d)、製品在庫の品目（A列に「製品在庫」、B列が品目名）、空行、生在庫(kg)の行
function buildStockCsv(opts) {
  opts = opts || {};
  const rows = [];
  rows.push(['', '', '10/31', '11/1', '11/2']);
  rows.push(['', '', '土', '日', '月']);
  rows.push(['生在庫\n(箱数)', 'M(緑)', '1箱']); // 箱数の生在庫の行（製品在庫の品目と取り違えないことの確認）
  STOCK_ITEMS.forEach((it, i) => {
    rows.push([i === 0 ? '製品在庫\n(箱数)' : '', it[0], it[1], it[2]]);
  });
  rows.push([]);
  rows.push([]);
  rows.push(['', '2L生在庫', '233.7', '33.1']);
  rows.push(['', 'L生在庫', '96.9', '153.1']);
  rows.push(['', 'M生在庫', '70.5', '131.2']);
  rows.push(['', '袋生在庫', '186.4', '209.6']);
  return toCsvText(rows);
}
function buildMasterCsv() { return toCsvText([MASTER_HEADER].concat(MASTER_ROWS)); }

function buildStockUrlCsv(opts) {
  const nantan = opts && opts.noStockUrl ? '' : 'https://docs.google.com/spreadsheets/d/' + NANTAN_STOCK_SHEET_ID + '/edit?gid=' + NANTAN_STOCK_GID + '#gid=' + NANTAN_STOCK_GID;
  return toCsvText([['出荷量', 'いなべ', '群馬', '南丹'], ['2025'], ['2026', '', '', nantan], ['2027']]);
}
function buildHarvestUrlCsv() {
  return toCsvText([
    ['収穫管理表', 'いなべ', '群馬', '南丹'],
    ['2026/10', '', '', ''],
    ['2026/11', '', '', 'https://docs.google.com/spreadsheets/d/' + NANTAN_HARVEST_SHEET_ID + '/edit?gid=' + HARVEST_TARGET_GID + '#gid=' + HARVEST_TARGET_GID],
  ]);
}
// 南丹収穫管理表の「収獲目標値(合計)」：3回目収穫の列があり、サイズは8区分（秀M・優M・秀L・優L・秀2L・優2L・袋1・袋2）
function buildHarvestTargetCsv() {
  return toCsvText([
    ['26/11/1/日', '←ここから入力年月を選択'],
    [],
    ['日付', '目標値', '収穫実績値', '1回目収穫', '2回目収穫', '3回目収穫', '日別総収量', '累計値', '出荷場廃棄', '秀M', '優M', '秀L', '優L', '秀2L', '優2L', '袋1', '袋2', '累積目標値'],
    ['26/11/1/日', '220', '495.25kg', '446.35', '0', '0', '275.25kg', '495.25kg', '0', '91.65kg', '0.00kg', '208.00kg', '0.00kg', '110.90kg', '0.00kg', '84.70kg', '0.00kg', '220'],
    ['26/11/2/月', '220', '0.00kg', '0', '0', '0', '-220.00kg', '', '0', '0.00kg', '0.00kg', '0.00kg', '0.00kg', '0.00kg', '0.00kg', '0.00kg', '0.00kg', '440'],
  ]);
}
// 「南丹11月売上高＆収穫量」：4行目が見出し（日付=AE列(30)・収穫見込=AP列(41)）、5行目以降が11/01〜
const NOV_HARVEST_PLAN = [490, 510, 550, 500, 440, 520, 480, 470, 460, 450]; // 11/1〜11/10
function buildMonthlyCsv() {
  const width = 44;
  const blank = () => new Array(width).fill('');
  const rows = [blank(), blank(), blank()];
  rows[0][0] = 'i'; rows[0][10] = 'M'; rows[0][11] = 'L'; rows[0][12] = '2L'; rows[0][13] = '袋';
  const header = blank(); header[30] = '日付'; header[31] = '出荷目標'; header[41] = '収穫見込'; header[42] = '収穫見込累計';
  rows.push(header);
  NOV_HARVEST_PLAN.forEach((kg, i) => {
    const r = blank();
    r[30] = '11/' + String(i + 1).padStart(2, '0') + '(' + '日月火水木金土'[(0 + i) % 7] + ')';
    r[41] = String(kg);
    rows.push(r);
  });
  return toCsvText(rows);
}
function buildSalesIndexCsv() {
  return toCsvText([['年月', 'URL'], ['2026.11', 'https://docs.google.com/spreadsheets/d/' + SALES_SHEET_ID + '/edit#gid=' + NOV_MONTH_GID]]);
}
// 販売予実抽出シートの月シート：南丹の受注計画（M・L・2L・袋）はCA〜CD列（78〜81）、修正計画はBW〜BZ列（74〜77）。
// 11/2：受注計画あり（実データ 3.9・205.4・34.8・118.5）／11/3：受注計画が全部空欄で修正計画あり（55.0・221.0・82.7・203.3）
function buildOrderMonthCsv() {
  const width = 86;
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(new Array(width).fill(''));
  const set = (day, startCol, vals) => vals.forEach((v, k) => { rows[(day + 3) - 1][startCol + k] = v; });
  set(2, 78, [3.9, 205.4, 34.8, 118.5]);
  set(3, 74, [55.0, 221.0, 82.7, 203.3]);
  return toCsvText(rows);
}
// 南丹_受注：B列=重量・E列=等級・F列=サイズ・日付はG列以降
function buildNantanRawOrderCsv() {
  const dates = ['2026/11/01', '2026/11/02', '2026/11/03'];
  const header = ['拠点', '個数/重量(kg)', '区分', '商品', '秀・優・袋・袋２', 'サイズ'].concat(dates);
  const mk = (grade, size, vals) => ['南丹', '重量', '受注', grade + size, grade, size].concat(vals);
  return toCsvText([
    header,
    mk('秀', 'L', ['', 40, 6]),
    mk('秀', 'L・M', ['', 10, '']),
    mk('優', 'L', ['', 20, 8]),
    mk('優', '3L', ['', 99, '']), // 3Lは秀・優（Lの内訳）に入れない
    ['南丹', '個数', '受注', '秀L6', '秀', 'L', '', 7777, ''], // 個数の行は数えない
  ]);
}

const baseline = new Date(2026, 10, 2); // 2026-11-02（在庫は前日の11/1の列を読む）

async function setupPage(browser, opts) {
  opts = opts || {};
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const today = opts.today || [2026, 10, 2];
  await fixTodayTo(page, today[0], today[1], today[2]);
  const loadQueries = [];
  page.on('pageerror', e => check('ページでエラーが出ない', false, e.message));
  await page.route(/script\.google\.com/, async route => {
    const req = route.request();
    if (req.method() === 'POST') { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }); return; }
    loadQueries.push(Object.fromEntries(new URL(req.url()).searchParams));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', values: {} }) });
  });
  await page.route('**/export**', async route => {
    const url = decodeURIComponent(route.request().url());
    let body = '﻿\r\n';
    if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + STOCK_URL_SHEET_GID)) body = buildStockUrlCsv(opts);
    else if (url.includes(DB_SHARE_SHEET_ID) && url.includes('gid=' + HARVEST_URL_SHEET_GID)) body = buildHarvestUrlCsv();
    else if (url.includes(NANTAN_STOCK_SHEET_ID) && url.includes('gid=' + NANTAN_STOCK_GID)) body = buildStockCsv(opts);
    else if (url.includes(NANTAN_STOCK_SHEET_ID) && url.includes('gid=' + NANTAN_MASTER_GID)) body = buildMasterCsv();
    else if (url.includes(NANTAN_HARVEST_SHEET_ID) && url.includes('gid=' + HARVEST_TARGET_GID)) body = buildHarvestTargetCsv();
    else if (url.includes(MONTHLY_SHEET_ID) && url.includes('gid=' + MONTHLY_NOV_GID)) body = buildMonthlyCsv();
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + SALES_INDEX_GID)) body = buildSalesIndexCsv();
    else if (url.includes(SALES_SHEET_ID) && url.includes('gid=' + NOV_MONTH_GID)) body = buildOrderMonthCsv();
    else if (url.includes(SALES_RAW_SHEET_ID) && url.includes('gid=' + NANTAN_ORDER_GID)) body = buildNantanRawOrderCsv();
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body });
  });
  await page.goto(PAGE_URL + (opts.query || ''));
  await page.waitForSelector('#table1');
  return { page, loadQueries };
}

function text(page, sel) { return page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; }, sel); }
async function waitStable(page, sel, ms) {
  ms = ms || 2500;
  let prev = null;
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await text(page, sel);
    if (v === prev && v !== null && v !== '－') { await page.waitForTimeout(200); if ((await text(page, sel)) === v) return v; }
    prev = v;
    await page.waitForTimeout(150);
  }
  return text(page, sel);
}
const f1 = v => (Math.round(v * 10) / 10).toFixed(1); // ページのfmtStockNumberと同じ丸め
const SITE = '?site=' + encodeURIComponent('南丹');
const prod = s => '[data-stock-product="' + s + '"]';
const raw = s => '[data-stock-raw="' + s + '"]';
const ship = (s, o) => '[data-shipment="' + s + '"][data-shipment-offset="' + o + '"]';
const harv = (s, o) => '[data-harvest="' + s + '"][data-harvest-offset="' + o + '"]';
const stk = (s, o) => '[data-stock-forecast="' + s + '"][data-stock-forecast-offset="' + o + '"]';

// CSV行（配列の配列）→ ページが使うgviz形式（table.rows[].c[].v）
function toJson(rows) { return { table: { rows: rows.map(cells => ({ c: cells.map(v => ({ v })) })) } }; }

(async () => {
  const browser = await chromium.launch();

  // ---------- ①②③ 純粋関数 ----------
  console.log('=== ①製品在庫の計算（箱数×1cs重量）：10/31・11/1 が目安どおり ===');
  {
    const { page } = await setupPage(browser, { query: SITE });
    const stockJson = toJson(parseCsvForTest(buildStockCsv()));
    const masterJson = toJson(parseCsvForTest(buildMasterCsv()));
    for (const [label, col] of [['10/31', 2], ['11/1', 3]]) {
      // 列の位置：A=0（見出し）・B=1（品目名）・C=2（10/31）・D=3（11/1）
      const r = await page.evaluate(([s, m, c]) => window.__test.computeNantanProductStock(s, m, c), [stockJson, masterJson, col]);
      const e = EXPECTED[label];
      check(label + '：M・L・2L・袋のサイズ別が目安どおり（' + JSON.stringify(e) + '）',
        r && r.sizes.M === e.M && r.sizes.L === e.L && r.sizes['2L'] === e['2L'] && r.sizes['袋'] === e['袋'], r && r.sizes);
      check(label + '：Lの内訳（秀・優）が目安どおり（秀' + e.秀 + '・優' + e.優 + '）', r && r.grades['秀'] === e.秀 && r.grades['優'] === e.優, r && r.grades);
      check(label + '：読み取れない数量・マスターシートに無い品目が無い', r && r.unparsed.length === 0 && r.unknown.length === 0, r && { unparsed: r.unparsed, unknown: r.unknown });
    }
    // パック端数（秀160パック・優119パック）はどこにも入らない：11/1の合計＝4つのサイズの合計と同じ
    const r11 = await page.evaluate(([s, m]) => window.__test.computeNantanProductStock(s, m, 3), [stockJson, masterJson]);
    const sum = r11.sizes.M + r11.sizes.L + r11.sizes['2L'] + r11.sizes['袋'];
    check('11/1：パック端数（秀160パック＝19.2kg・優119パック＝13.1kg）はどのサイズにも入っていない（合計382.7）', Math.abs(sum - 382.7) < 0.05, sum);
    await page.close();
  }

  console.log('=== ②数量の読み取りとサイズの振り分け ===');
  {
    const { page } = await setupPage(browser, { query: SITE });
    const q = await page.evaluate(() => ['9箱', '80袋', '12 パック', '22 箱', '1.00kg', '', '１２箱', 'abc'].map(window.__test.parseStockQuantity));
    check('"9箱"→9・箱', q[0].qty === 9 && q[0].unit === '箱', q[0]);
    check('"80袋"→80・袋', q[1].qty === 80 && q[1].unit === '袋', q[1]);
    check('"12 パック"→12・パック', q[2].qty === 12 && q[2].unit === 'パック', q[2]);
    check('"22 箱"（空白あり）→22・箱', q[3].qty === 22 && q[3].unit === '箱', q[3]);
    check('"1.00kg"→1・kg', q[4].qty === 1 && q[4].unit === 'kg', q[4]);
    check('空欄→null', q[5] === null, q[5]);
    check('全角数字"１２箱"も読める', q[6].qty === 12, q[6]);
    check('読めない文字は error になる', q[7] && q[7].error === true, q[7]);

    const sp = await page.evaluate(() => {
      const s = window.__test.splitStockSizes;
      return {
        l3: s('優', '3L'), lm: s('優', 'L・M'), l2l: s('優', 'L・2L'), two3: s('優', '2L・3L'),
        bag2: s('袋②', '―'), bag1: s('袋①', ''), frac: s('秀', '―'), none: s('無印', '―'), small: s('無印', 'S'),
        ovr: s('優', 'L・2L', { grade: '優', size: 'L' }), syuL: s('秀', 'L'), noGrade: s('無印', 'L'), hoju: s('宝珠', '3L'),
      };
    });
    check('3L→2L（受注計画の2L列に入っているため）。秀・優の内訳には入れない', sp.l3.length === 1 && sp.l3[0].size === '2L' && sp.l3[0].gradeL === false, sp.l3);
    check('L・M→L 0.5＋M 0.5（Lの半分だけ秀・優の内訳）', sp.lm.length === 2 && sp.lm[0].size === 'L' && sp.lm[0].share === 0.5 && sp.lm[0].gradeL === true && sp.lm[1].size === 'M' && sp.lm[1].share === 0.5 && sp.lm[1].gradeL === false, sp.lm);
    check('L・2L→L 0.5＋2L 0.5', sp.l2l.length === 2 && sp.l2l[0].size === 'L' && sp.l2l[1].size === '2L' && sp.l2l[1].gradeL === false, sp.l2l);
    check('2L・3L→どちらも2L（合わせて1.0）', sp.two3.length === 2 && sp.two3.every(p => p.size === '2L') && sp.two3.reduce((a, p) => a + p.share, 0) === 1, sp.two3);
    check('袋②・袋①でサイズが「―」（空欄）→袋', sp.bag2.length === 1 && sp.bag2[0].size === '袋' && sp.bag1.length === 1 && sp.bag1[0].size === '袋', { b2: sp.bag2, b1: sp.bag1 });
    check('秀・無印でサイズが「―」（パック端数など）→どこにも入れない', sp.frac.length === 0 && sp.none.length === 0, { frac: sp.frac, none: sp.none });
    check('サイズS（チビ用カップ）→どこにも入れない', sp.small.length === 0, sp.small);
    check('上書き（秀袋200g(B-L、B-2L)＝優のL）：Lだけ・秀優はLの内訳', sp.ovr.length === 1 && sp.ovr[0].size === 'L' && sp.ovr[0].gradeL === true, sp.ovr);
    check('秀のL→Lの内訳に入る。無印のL・宝珠3Lは内訳に入らない', sp.syuL[0].gradeL === true && sp.noGrade[0].gradeL === false && sp.hoju[0].gradeL === false, { syuL: sp.syuL, noGrade: sp.noGrade, hoju: sp.hoju });
    await page.close();
  }

  console.log('=== ③同じ名前の品目：出てくる順にマスターシートと対応・行の数が違えば気づける ===');
  {
    const { page } = await setupPage(browser, { query: SITE });
    const masterJson = toJson(parseCsvForTest(buildMasterCsv()));
    const stockJson = toJson(parseCsvForTest(buildStockCsv()));
    // 実際のファイル：在庫タブの「袋300g(シール有)」は2行、マスターシートは1行 → 食い違いとして残る
    const r = await page.evaluate(([s, m]) => window.__test.computeNantanProductStock(s, m, 3), [stockJson, masterJson]);
    check('在庫タブ2行・マスターシート1行の「袋300g(シール有)」が mismatches に残る', r.mismatches.some(x => x.name === '袋300g(シール有)' && x.stockCount === 2 && x.masterCount === 1), r.mismatches);
    check('名前が重複していても行の数が合う「秀2L6」（2行・2行）は mismatches に出ない', !r.mismatches.some(x => x.name === '秀2L6'), r.mismatches);
    // 秀2L6が2行：1行目＝14入(2.8)・2行目＝20入(4)に、出てくる順で対応する
    const mk = (v1, v2) => ({
      stock: toJson([['', '', '', '11/1'], ['製品在庫\n(箱数)', '秀2L6', '', v1], ['', '秀2L6', '', v2]]),
      master: toJson([MASTER_HEADER, MASTER_ROWS[8], MASTER_ROWS[9]]),
    });
    const a = mk('10箱', ''), b = mk('', '10箱');
    const ra = await page.evaluate(([s, m]) => window.__test.computeNantanProductStock(s, m, 3), [a.stock, a.master]);
    const rb = await page.evaluate(([s, m]) => window.__test.computeNantanProductStock(s, m, 3), [b.stock, b.master]);
    check('1行目の秀2L6 10箱＝10×2.8＝28.0kg（14入の行と対応）', ra.sizes['2L'] === 28.0 && ra.mismatches.length === 0, ra);
    check('2行目の秀2L6 10箱＝10×4＝40.0kg（20入の行と対応）', rb.sizes['2L'] === 40.0 && rb.mismatches.length === 0, rb);
    // 在庫タブに同じ名前の行が増えた（マスターシートは2行のまま）→ 気づける。重さは最後のマスターシートの行を使う
    const c = { stock: toJson([['', '', '', '11/1'], ['製品在庫\n(箱数)', '秀2L6', '', '1箱'], ['', '秀2L6', '', ''], ['', '秀2L6', '', '1箱']]), master: a.master };
    const rc = await page.evaluate(([s, m]) => window.__test.computeNantanProductStock(s, m, 3), [c.stock, c.master]);
    check('在庫タブが3行・マスターシートが2行なら mismatches に残り、3行目は最後のマスターシートの行（4kg）で計算', rc.mismatches.length === 1 && rc.mismatches[0].stockCount === 3 && rc.mismatches[0].masterCount === 2 && rc.sizes['2L'] === 6.8, rc);
    // マスターシートに無い品目（数量あり）は unknown に残り、サイズ別には入らない
    const d = { stock: toJson([['', '', '', '11/1'], ['製品在庫\n(箱数)', '新商品', '', '5箱']]), master: a.master };
    const rd = await page.evaluate(([s, m]) => window.__test.computeNantanProductStock(s, m, 3), [d.stock, d.master]);
    check('マスターシートに無い品目は unknown に残り、どのサイズにも入らない', rd.unknown.length === 1 && rd.unknown[0] === '新商品' && rd.sizes.M + rd.sizes.L + rd.sizes['2L'] + rd.sizes['袋'] === 0, rd);
    // 製品在庫の品目の並びが見つからない場合はnull
    const e = await page.evaluate(([s, m]) => window.__test.computeNantanProductStock(s, m, 3), [toJson([['', '', '', '11/1'], ['', 'M生在庫', '', '5']]), a.master]);
    check('製品在庫の品目の並びが無いときはnull（画面は「－」にする）', e === null, e);
    await page.close();
  }

  // ---------- ④ パネル1〜3 ----------
  console.log('=== ④?site=南丹 で開いたパネル1〜3（今日=2026-11-02、在庫は11/1の列）===');
  {
    const { page } = await setupPage(browser, { query: SITE });
    await waitStable(page, prod('M'));
    await waitStable(page, harv('M', 0));
    await waitStable(page, stk('M', 0));
    const e = EXPECTED['11/1'];
    check('製品在庫 M・L・2L・袋が目安どおり（26.4・210.1・34.2・112.0）',
      (await text(page, prod('M'))) === f1(e.M) && (await text(page, prod('L'))) === f1(e.L) && (await text(page, prod('2L'))) === f1(e['2L']) && (await text(page, prod('袋'))) === f1(e['袋']),
      [await text(page, prod('M')), await text(page, prod('L')), await text(page, prod('2L')), await text(page, prod('袋'))]);
    check('製品在庫 秀46.8・優163.3（Lの内訳）', (await text(page, prod('秀'))) === f1(e.秀) && (await text(page, prod('優'))) === f1(e.優), [await text(page, prod('秀')), await text(page, prod('優'))]);
    check('生在庫 M・L・2L・袋は在庫タブの生在庫(kg)の行から読む（131.2・153.1・33.1・209.6）',
      (await text(page, raw('M'))) === '131.2' && (await text(page, raw('L'))) === '153.1' && (await text(page, raw('2L'))) === '33.1' && (await text(page, raw('袋'))) === '209.6');
    check('生在庫 秀・優は「－」（L生在庫の行名に比率が無く、収穫時点では分けていない）', (await text(page, raw('秀'))) === '－' && (await text(page, raw('優'))) === '－');
    check('table1に「準備中」「在庫管理表がありません」の注記は出ない', (await text(page, '#table1SiteNote')) === '', await text(page, '#table1SiteNote'));

    // 出荷予定：11/2＝受注計画あり（CA〜CD列）、11/3＝受注計画が全部空欄→修正計画（秀・優は「－」）
    check('出荷予定 11/2 M・L・2L・袋＝受注計画（CA〜CD列）3.9・205.4・34.8・118.5',
      (await text(page, ship('M', 0))) === '3.9' && (await text(page, ship('L', 0))) === '205.4' && (await text(page, ship('2L', 0))) === '34.8' && (await text(page, ship('袋', 0))) === '118.5',
      [await text(page, ship('M', 0)), await text(page, ship('L', 0)), await text(page, ship('2L', 0)), await text(page, ship('袋', 0))]);
    check('出荷予定 11/2 秀45.0（L40＋L・M10の半分）・優20.0（3Lと個数の行は数えない）', (await text(page, ship('秀', 0))) === '45.0' && (await text(page, ship('優', 0))) === '20.0', [await text(page, ship('秀', 0)), await text(page, ship('優', 0))]);
    check('出荷予定 11/3 受注計画が空欄なので修正計画（BW〜BZ列）55.0・221.0・82.7・203.3',
      (await text(page, ship('M', 1))) === '55.0' && (await text(page, ship('L', 1))) === '221.0' && (await text(page, ship('2L', 1))) === '82.7' && (await text(page, ship('袋', 1))) === '203.3');
    check('出荷予定 11/3 修正計画の日は秀・優が「－」', (await text(page, ship('秀', 1))) === '－' && (await text(page, ship('優', 1))) === '－');

    // 収穫予測：実績日11/1（収穫実績495.25）。サイズ別＝8区分の合算（M=秀M+優M…）、比率
    const act = { M: 91.65, L: 208.0, '2L': 110.9, '袋': 84.7 }, total = 495.25;
    check('収穫実績 M・L・2L・袋（秀M+優M など8区分の合算）が目安どおり',
      (await text(page, '[data-harvest-actual="M"]')) === f1(act.M) && (await text(page, '[data-harvest-actual="L"]')) === f1(act.L) && (await text(page, '[data-harvest-actual="2L"]')) === f1(act['2L']) && (await text(page, '[data-harvest-actual="袋"]')) === f1(act['袋']),
      [await text(page, '[data-harvest-actual="M"]'), await text(page, '[data-harvest-actual="L"]')]);
    const ratioText = v => (Math.round(v / total * 10000) / 100) + '%';
    check('収穫比率が実績÷合計', (await text(page, '[data-harvest-ratio="M"]')) === ratioText(act.M) && (await text(page, '[data-harvest-ratio="L"]')) === ratioText(act.L), [await text(page, '[data-harvest-ratio="M"]'), ratioText(act.M)]);
    // 日別：月ごとのシートの収穫見込（11/2=510、11/3=550）× 比率
    const h0 = Math.round(510 * act.M / total * 10) / 10, h1 = Math.round(550 * act.L / total * 10) / 10;
    check('日別の収穫予測 11/2のM＝510×Mの比率、11/3のL＝550×Lの比率（月ごとのシートの収穫見込）', (await text(page, harv('M', 0))) === f1(h0) && (await text(page, harv('L', 1))) === f1(h1), [await text(page, harv('M', 0)), f1(h0), await text(page, harv('L', 1)), f1(h1)]);
    check('日別の収穫合計の行（11/2）＝510.0', (await text(page, '[data-harvest-total-offset="0"]')) === '510.0', await text(page, '[data-harvest-total-offset="0"]'));
    check('収穫予測の秀・優は実績も日別も「－」（収穫時点では分けていない）',
      (await text(page, '[data-harvest-actual="秀"]')) === '－' && (await text(page, '[data-harvest-actual="優"]')) === '－' && (await text(page, harv('秀', 0))) === '－' && (await text(page, harv('優', 3))) === '－');
    check('秀・優の見出しは比率（秀_40）の表記ではなく「秀」「優」のまま', (await text(page, '[data-harvest-grade-label="秀"]')) === '秀' && (await text(page, '[data-harvest-grade-label="優"]')) === '優');
    check('table2に「準備中」の注記は出ない', (await text(page, '#table2SiteNote')) === '');

    // 在庫予測：在庫実績＝製品在庫＋生在庫、11/2＝実績＋収穫予測－出荷予定
    const stockM = Number(f1(e.M)) + 131.2;
    const expectM0 = Math.round((stockM + Number(f1(h0)) - 3.9) * 10) / 10;
    check('在庫予測 実績M＝製品在庫＋生在庫（26.4＋131.2）', (await text(page, '[data-stock-forecast-actual="M"]')) === f1(stockM), await text(page, '[data-stock-forecast-actual="M"]'));
    check('在庫予測 11/2のM＝実績＋収穫予測－出荷予定', (await text(page, stk('M', 0))) === expectM0.toFixed(1), [await text(page, stk('M', 0)), expectM0]);
    check('在庫予測の秀・優は実績も日別も「－」', (await text(page, '[data-stock-forecast-actual="秀"]')) === '－' && (await text(page, stk('秀', 0))) === '－' && (await text(page, stk('優', 4))) === '－');
    check('table3に「準備中」の注記は出ない', (await text(page, '#table3SiteNote')) === '');
    await page.close();
  }

  console.log('=== 10/31の製品在庫（今日=2026-11-01）===');
  {
    const { page } = await setupPage(browser, { query: SITE, today: [2026, 10, 1] });
    await waitStable(page, prod('M'));
    const e = EXPECTED['10/31'];
    check('10/31：M・L・2L・袋が目安どおり（159.0・255.1・114.2・39.0）',
      (await text(page, prod('M'))) === f1(e.M) && (await text(page, prod('L'))) === f1(e.L) && (await text(page, prod('2L'))) === f1(e['2L']) && (await text(page, prod('袋'))) === f1(e['袋']),
      [await text(page, prod('M')), await text(page, prod('L')), await text(page, prod('2L')), await text(page, prod('袋'))]);
    check('10/31：秀113.1・優142.0', (await text(page, prod('秀'))) === f1(e.秀) && (await text(page, prod('優'))) === f1(e.優), [await text(page, prod('秀')), await text(page, prod('優'))]);
    await page.close();
  }

  // ---------- ⑤ 詳細 ----------
  console.log('=== ⑤詳細（収穫見込：手入力）が南丹でも使える ===');
  {
    const { page, loadQueries } = await setupPage(browser, { query: SITE + '&harvestDetail=open' });
    await waitStable(page, prod('M'));
    await page.waitForTimeout(800);
    const disabled = await page.evaluate(() => { const el = document.querySelector('[data-harvest-input-offset="0"]'); return el ? el.disabled : null; });
    check('入力欄が有効（未対応の拠点の安全策が南丹には働かない）', disabled === false, disabled);
    check('収穫見込GASへ action=load&site=南丹 で読み込みが送られる', loadQueries.some(q => q.action === 'load' && q.site === '南丹'), loadQueries);
    const note = await text(page, '#harvestDetailNote');
    check('「未対応」の注記は出ない', !(note || '').includes('未対応'), note);
    await page.close();
  }

  // ---------- ⑥ URL無し ----------
  console.log('=== ⑥URL_在庫管理表の南丹の欄が空のとき ===');
  {
    const { page } = await setupPage(browser, { query: SITE, noStockUrl: true });
    await page.waitForTimeout(1200);
    check('製品在庫・生在庫が「－」', (await text(page, prod('M'))) === '－' && (await text(page, raw('L'))) === '－');
    check('注記「URL_在庫管理表に南丹の在庫管理表がありません」', (await text(page, '#table1SiteNote')) === 'URL_在庫管理表に南丹の在庫管理表がありません', await text(page, '#table1SiteNote'));
    await page.close();
  }

  await browser.close();
  console.log(allOk ? 'すべてOK' : 'NGあり');
  console.log('DONE');
  process.exit(allOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

// テスト用の簡易CSVパーサー（ページ側のparseCsvと同じ仕様。ダブルクォート内の改行・カンマ・""に対応）
function parseCsvForTest(textIn) {
  let t = textIn; if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; continue; }
    if (ch === '"') { q = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
