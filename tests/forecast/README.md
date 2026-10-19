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
   ```

   各行末に `: OK` / `: NG` が出力され、最後に `すべてOK` / `NGあり` と `DONE` が表示されれば実行完了です。
   終了コードは成功時 `0`、失敗時 `1` です。

## ファイルの内容

- `verify_forecast_shipping_sales.js` — 出荷パネル1（販売抽出シートの実績・受注データ接続、商品分類ルール、個数の表示形式など）の検証。
- `verify_regression_consolidated.js` — 栽培・出荷の既存機能全般の回帰確認（複数拠点のパネル表示、スティッキーヘッダー、基準日の未来選択、描画の世代チェック、URL保持など）。

両ファイルとも、CSVモックの組み立てや日付固定（`fixTodayTo`）などの補助関数をファイル内に直接含んでおり、他ファイルへの依存はありません。

## 公開対象からの除外について

`tests/forecast/` は GitHub Pages（`.github/workflows/pages.yml` の `upload-pages-artifact` が `dashboard` フォルダのみを対象にしている）および Firebase Hosting（`firebase.json` の `hosting.public` が `dashboard` のみを指している）のどちらからも、もともと対象外です。追加の除外設定は不要でした。

GitHub Actionsの `validate` ジョブ（`pages.yml`）は `dashboard/*.html` のみを対象にJS構文チェックを行うため、`tests/forecast/` 配下のファイルで失敗することはありません（テストを自動実行する設定にもなっていません）。
