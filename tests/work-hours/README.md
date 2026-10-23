# 勤務時間ダッシュボード（work-hours.html）のテスト

`dashboard/work-hours.html` の動作確認用 Playwright テストです。
実際のスプレッドシートへのネットワークアクセスは行わず、`page.route()` で `/export` 系リクエストを
空のCSVで応答させるだけにとどめ、ページの読み込み自体は素早く失敗させます（`tests/forecast/`・
`tests/shipment-plan/` のように実データ構成に合わせたCSVモックは組みません）。

work-hours.html はIIFEで包まれていないトップレベルのスクリプトのため、ページを開くだけで
`fitChartHeightForTooltip`・`fitSegmentLabelChartHeight`・`computeSegmentLabelChartHeight` が
`window` 直下の関数として使えます。この性質を利用し、「予実＞比較（繁忙期見込み）」タブの各グラフが
実際に使っているのと同じ形（Chart.js 4.4.3、`interaction:{mode:'index',intersect:false}`、
積み上げ棒＋行ごとの label/afterLabel/footer コールバック）のテスト用チャートを直接作り、
本物のChart.jsに実測させる形で確認します（画面上の拠点・月・トグル操作を実際にクリックして辿る
E2Eテストではなく、新設した高さ決定ロジックを本物のChart.jsに対して直接検証するテストです）。

Chart.js本体（CDN: `cdn.jsdelivr.net`）はテスト実行環境のネットワーク事情に左右されないよう、
`vendor/chart.umd.js`（npmの `chart.js@4.4.3` から複製。work-hours.html が読み込むバージョンと
同じ）に差し替えます。

## 必要なパッケージ

- Node.js
- [Playwright](https://playwright.dev/)（`playwright` パッケージと Chromium 本体）

リポジトリに `playwright` が未インストールの場合は以下でインストールしてください。

```sh
npm install -D playwright
npx playwright install chromium
```

## テストの実行方法

1. リポジトリのルートで、`dashboard` フォルダをカレントにしたローカルサーバーを起動する（別ターミナル、
   またはバックグラウンド実行）。`tests/forecast/`（8811番）・`tests/shipment-plan/`（8812番）が
   同時に使うポートとは別の8813番を使う。

   ```sh
   python3 -m http.server 8813 --directory dashboard
   ```

2. テストを実行する（テストは `http://localhost:8813/work-hours.html` にアクセスします）。

   ```sh
   node tests/work-hours/verify_plancompare_tooltip_height.js
   ```

   各行末に `: OK` / `: NG` が出力され、最後に `すべてOK` / `NGあり` と `DONE` が表示されれば実行完了です。
   終了コードは成功時 `0`、失敗時 `1` です。

   ```sh
   node tests/work-hours/verify_sitesummary_headcount_labels.js
   ```

## ファイルの内容

- `verify_plancompare_tooltip_height.js` — 「予実＞比較（繁忙期見込み）」タブの各グラフ
  （拠点・業務別 `plancmp2-*`、拠点サマリ `plansitesum2-*`、3拠点サマリ `plansum2-*`、
  要員計画 `planstaffplan2-*`。「表」サブタブはグラフが無いため対象外）に適用した、
  ツールチップ（`mode:'index'` でキャンバス内に描かれる窓）が高さに収まらず下の行が
  切れないようにする仕組み（`fitChartHeightForTooltip()`）の検証。表示中の各月のうち
  最も内容が多い月のツールチップの高さ（Chart.js自身の計算結果を実測。行数や1行の高さを
  決め打ちで見積もっていないこと）がグラフの高さを上回る場合だけ高さが広がり、収まって
  いる場合は今の高さ（固定320px・420px、または要員計画の業務区分別の白い2行ラベル基準
  320〜650px）のまま変わらないこと、要員計画の業務区分別では白いラベル基準の高さとの
  大きい方になり既存の650px上限をツールチップの必要高さが上回る場合は上限を超えてよい
  こと、測定用に一時的に表示したツールチップが残らないこと（アクティブ要素が空に戻って
  いること）、拠点・月・表示月数・振替・雇用区分の切替等で内容が変わったときに再計算され、
  今の高さより低くならないことを確認します。
- `verify_sitesummary_headcount_labels.js` — 拠点サマリ「実績工数（業務区分別）」グラフ
  （`plansitesum2-combined`）の棒に「◯人」の人数ラベルを描画する
  `siteSummaryHeadcountLabelsPlugin()` の検証。(A) ラベルの描画自体
  （トップレベル関数のため`window`から直接呼べる）を手組みのデータセットに対して
  本物のChart.jsで描画させ、セグメントに収まる場合は中央・白文字、収まらない場合は
  棒の右側・薄い色になること、標準労働時間棒（3段）の合計ラベルが3段分まとめて1つだけ
  描画されること、0・無しの値は描画されないことを確認します。(B) 4種類の人数（実績棒・
  過去月／未来月の標準労働時間棒・新規要員・増減）の集計ルール自体
  （`renderSiteSummaryView()`内のローカル関数のため直接呼べず、`getActiveData()`等の
  本物のトップレベル関数を呼び出す形でテスト側に再現）を、拠点・雇用区分の絞り込みとの
  連動、実績はあるが標準労働時間シートと照合できない人の除外、退職予定者・新規要員の
  開始月条件、31・30・28日の月での人数換算（時間÷(8h×暦日数)、小数1桁）について確認
  します。(C) 人数ラベル用プラグインを追加した状態でも、`verify_plancompare_tooltip_height.js`
  ⑥-aと同じ再現条件・実マウスホバー方式で、PR #518のツールチップ切れ防止が引き続き
  機能することを確認します。

## vendor/ フォルダについて

`vendor/chart.umd.js` は、work-hours.html が `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/...">`
で読み込むのと同じバージョン（npmの `chart.js@4.4.3` の `dist/chart.umd.js`）を複製したものです。
テストはCDNへのリクエストをこのファイルの内容で差し替えて実行します。本体のバージョンを
更新した場合は、このファイルも合わせて更新してください。

## 公開対象からの除外について

`tests/work-hours/` は GitHub Pages（`.github/workflows/pages.yml` の `upload-pages-artifact` が
`dashboard` フォルダのみを対象にしている）および Firebase Hosting（`firebase.json` の
`hosting.public` が `dashboard` のみを指している）のどちらからも、もともと対象外です。
