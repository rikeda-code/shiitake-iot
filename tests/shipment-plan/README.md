# 椎茸 日々の過不足確認シート（shiitake-shipment-plan.html）のテスト

`dashboard/shiitake-shipment-plan.html` の動作確認用 Playwright テストです。
実際のスプレッドシート・保存先GASへのネットワークアクセスは行わず、`page.route()` で
CSV（`/export?format=csv`）・GASの応答をモックして検証します。

## 必要なパッケージ

- Node.js
- [Playwright](https://playwright.dev/)（`playwright` パッケージと Chromium 本体）

リポジトリに `playwright` が未インストールの場合は以下でインストールしてください。

```sh
npm install -D playwright
npx playwright install chromium
```

## テストの実行方法

1. リポジトリのルートで、`dashboard` フォルダをカレントにしたローカルサーバーを起動する（別ターミナル、またはバックグラウンド実行）。`tests/forecast/` のテストが同時に使う8811番とは別のポートを使う。

   ```sh
   python3 -m http.server 8812 --directory dashboard
   ```

2. テストを実行する（テストは `http://localhost:8812/shiitake-shipment-plan.html` にアクセスします）。

   ```sh
   node tests/shipment-plan/verify_shipment_plan_harvest_detail.js
   node tests/shipment-plan/verify_shipment_plan_detail_inabe_only.js
   ```

   各行末に `: OK` / `: NG` が出力され、最後に `すべてOK` / `NGあり` と `DONE` が表示されれば実行完了です。
   終了コードは成功時 `0`、失敗時 `1` です。

## ファイルの内容

- `verify_shipment_plan_harvest_detail.js` — 収穫予測パネル（table2）・在庫予測パネル（table3）に追加した「詳細」（収穫見込の手入力）の検証。収穫見込×収穫比率でのサイズ別按分（秀・優はLの按分）、手入力が無い日は本体の表示値へのフォールバック、飛び飛びの入力（一部の日だけ手入力）・0kgの手入力の扱い、入力の確定（Enter・フォーカス移動）→即時再計算→保存、保存失敗時の赤枠・再送、全角数字・カンマ・kg付き入力の読み取りと不正値のエラー表示、在庫予測の詳細（収穫予測の詳細の値を使った当日〜8日後の積み上げ計算。収穫予測の詳細が「－」の日も0として最後まで計算を続ける点が本体とは異なる）、詳細パネルが最初は閉じていること、基準日・実績日・拠点の切替で古い読み込み結果を破棄すること（世代チェック）、本体（table1・table2・table3）の表示・計算がこの機能追加によって変わっていないことを確認します。拠点切替の確認は、いなべのまま切り替え直すケースのみ（群馬・南丹への切替時の挙動は `verify_shipment_plan_detail_inabe_only.js` が担当）。
- `verify_shipment_plan_detail_inabe_only.js` — 本体（table1〜3）は拠点トグルを切り替えても常にいなべのデータを表示する作り（見た目のみのトグル）である一方、詳細は拠点を見て収穫見込GASに読み書きするため、群馬・南丹を選んだまま入力すると、本体の表示と食い違う拠点の実データ（直近工数計画・PR #503が使う収穫見込）を書き換えてしまう問題への対応を検証します。群馬・南丹を選んだときに、収穫見込GASへの読み込み・保存が一切発行されないこと、詳細の入力欄が無効になること、収穫予測・在庫予測の詳細の数値（実績・比率・日別・合計）がすべて「－」になること、「この画面は現在いなべのみ対応です。群馬・南丹の収穫見込は直近工数計画で入力してください。」の注記が表示されること、いなべに戻すと読み込み・入力・表示（手入力した値の復元を含む）が元どおりになること、本体（table1・table2・table3）の表示・計算が拠点切替の影響を受けないことを確認します。

いずれのファイルも、CSVモックの組み立てや日付固定（`fixTodayTo`）などの補助関数をファイル内に直接含んでおり、他ファイルへの依存はありません。

## 公開対象からの除外について

`tests/shipment-plan/` は、GitHub Pages（`.github/workflows/pages.yml` の `upload-pages-artifact` が `dashboard` フォルダのみを対象にしている）および Firebase Hosting（`firebase.json` の `hosting.public` が `dashboard` のみを指している）のどちらからも、もともと対象外です。追加の除外設定は不要でした。

GitHub Actionsの `validate` ジョブ（`pages.yml`）は `dashboard/*.html` のみを対象にJS構文チェックを行うため、`tests/shipment-plan/` 配下のファイルで失敗することはありません（テストを自動実行する設定にもなっていません）。
