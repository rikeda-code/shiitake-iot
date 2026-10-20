# 直近工数計画ダッシュボード（work-hours-forecast.html）のテスト

`dashboard/work-hours-forecast.html` の動作確認用 Playwright テストです。
DB共有シート等への実際のネットワークアクセスは行わず、`page.route()` でCSV/gvizレスポンスをモックして検証します。

## 必要なパッケージ

- Node.js
- [Playwright](https://playwright.dev/)（`playwright` パッケージと Chromium 本体）

リポジトリに `playwright` が未インストールの場合は以下でインストールしてください。

```sh
npm install -D playwright
npx playwright install chromium
```

## テストの実行方法

1. リポジトリのルートで、`dashboard` フォルダをカレントにしたローカルサーバーを起動する（別ターミナル、またはバックグラウンド実行）。

   ```sh
   python3 -m http.server 8811 --directory dashboard
   ```

2. テストを実行する（テストは `http://localhost:8811/work-hours-forecast.html` にアクセスします）。

   ```sh
   node tests/forecast/verify_forecast_shipping_sales.js
   node tests/forecast/verify_regression_consolidated.js
   node tests/forecast/verify_forecast_shipping_labor_inabe.js
   node tests/forecast/verify_forecast_shipping_labor_gunma.js
   ```

   各行末に `: OK` / `: NG` が出力され、最後に `すべてOK` / `NGあり` と `DONE` が表示されれば実行完了です。
   終了コードは成功時 `0`、失敗時 `1` です。

## ファイルの内容

- `verify_forecast_shipping_sales.js` — 出荷パネル1（販売抽出シートの実績・受注データ接続、商品分類ルール、個数の表示形式など）の検証。あわせて、基準日〜6日後の7日分＋合計列になったこと（見出しの期間表示を含む）、パック数・cs数・合計の7日分の合計、1日分欠けたときの部分合計＋「（6日分）」表示、7日分そろうと日数の注記が付かないこと、合計は丸める前の値を足してから1回だけ丸めること（0.04×7→0.3になる例）を確認する。
- `verify_regression_consolidated.js` — 栽培・出荷の既存機能全般の回帰確認（複数拠点のパネル表示、スティッキーヘッダー、基準日の未来選択、描画の世代チェック、URL保持など）。あわせて、栽培の各パネル（工程件数・稼働コンテナ数、標準工数、標準労働時間）で合計列の見出し（期間表示）・7日分の合計（件数系）・収穫見込みが一部の日しか無い場合の部分合計＋「（1日分）」・収穫見込みが全く無い場合の合計「－」を確認し、出荷側で合計列の出荷数量の部分合計＋「（◯日分）」、標準労働時間合計・出勤人数（延べ人数）・過不足（標準労働時間と標準工数それぞれの合計どうしの差）・人別内訳の合計を確認する。
- `verify_forecast_shipping_labor_inabe.js` — 出荷×いなべのパネル3（標準労働時間）をシフト表の実データに接続した機能の検証（部門「出荷」「配送・出荷」での絞り込み、シフトの値の扱い、標準労働時間シートとの照合・エイリアス・部門不一致時の未照合警告、拠点シフト表GAS経由での絞り込み、過不足の計算、シフト表の日付範囲外の扱い、南丹は引き続きサンプルであること、栽培/出荷の切替で部門が混ざらないこと）。あわせて、人別内訳の合計列が7日分の合計になること、シフト表の日付範囲外の日を含む場合に合計列が範囲内日数だけの部分合計＋「（◯日分）」になることを確認する。
- `verify_forecast_shipping_labor_gunma.js` — 出荷×群馬のパネル3（標準労働時間）を勤務表「出荷場」シートの実データに接続した機能、および出荷場での空欄の判断ルール（先頭の空欄は`classifyGunmaLeadingBlankPolicy()`、先頭より後の空欄は休みの印を手がかりにした`classifyGunmaMiddleBlankPolicy()`）の検証。休みの印（休・有休・夏・振休等。「入社」は含まない）の間の空欄が出勤になること、同じ月度の残りに休みの印が無い場合は次の月度（`gids`のみ対象）のシートを見て休みの印の有無で出勤／休み扱いを判断すること、次の月度が未設定・読めない場合や行が全部空欄の場合に計上せずアラートを出すこと（全部空欄の場合は既存の人かどうかより優先されること）、先頭の空欄の扱い（既存の人／新しい人／前の月度未設定）が従来どおりであること、不要なときは次の月度のシートを読み込まないこと、配送担当（吉村(出)・高橋(出)）の除外、栽培（収穫班シート）は従来どおり空行の位置で空欄を判断し影響を受けないこと、いなべ・南丹は今までどおりであることを確認。あわせて、休み・次の月度未設定などで0時間と確定した日は「判断できない(－)」とは区別され合計列が7日分の合計になる（日数の注記が付かない）ことを、具体的な数値（人別内訳の合計列）で確認する。

いずれのファイルも、CSVモックの組み立てや日付固定（`fixTodayTo`）などの補助関数をファイル内に直接含んでおり、他ファイルへの依存はありません。

## 公開対象からの除外について

`tests/forecast/` は GitHub Pages（`.github/workflows/pages.yml` の `upload-pages-artifact` が `dashboard` フォルダのみを対象にしている）および Firebase Hosting（`firebase.json` の `hosting.public` が `dashboard` のみを指している）のどちらからも、もともと対象外です。追加の除外設定は不要でした。

GitHub Actionsの `validate` ジョブ（`pages.yml`）は `dashboard/*.html` のみを対象にJS構文チェックを行うため、`tests/forecast/` 配下のファイルで失敗することはありません（テストを自動実行する設定にもなっていません）。
