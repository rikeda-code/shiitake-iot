# 椎茸 在庫の検証（stock-check.html）のテスト

`dashboard/stock-check.html` の動作確認用 Playwright テストです。
実際のスプレッドシートへのネットワークアクセスは行わず、`page.route()` で
「2026年ファーム売上高・収穫量」のCSV（`/export?format=csv&gid=`）を、実際のシートの形
（拠点・月ごとの見出しの位置、「○月対見込」の移動表）に合わせてモックして検証します。
外部への書き込み（POSTなど）が出ないことも、通信を記録して確かめます。

- `fixtures.js` … 2026-11-03 に読み取った実データ（8〜11/2の出荷・収穫・合計在庫・廃棄・規格外と、8〜11月の移動表）
- `helpers.js` … モックCSVの組み立て（`makeSiteRows`・`makeTaimiRows`）、通信の記録、今日の日付の固定、`check()`

## 必要なパッケージ

- Node.js
- [Playwright](https://playwright.dev/)（`playwright` パッケージと Chromium 本体）
- Chart.js は `tests/work-hours/vendor/chart.umd.js`（同梱）を使います（ネットワークに左右されないため）

リポジトリに `playwright` が未インストールの場合は、リポジトリの外のフォルダに入れて `NODE_PATH` で指定する方法もあります。

```sh
npm install -D playwright
npx playwright install chromium
```

## テストの実行方法

1. `dashboard` フォルダを 8812 番ポートで配信する（別ターミナル、またはバックグラウンド実行）。

   ```sh
   python3 -m http.server 8812 --directory dashboard
   ```

   `python3` が使えない環境では、`dashboard` フォルダを 8812 番で配信できるものなら何でも構いません（Node の簡単な静的サーバーなど）。

2. テストを実行する（テストは `http://localhost:8812/stock-check.html` にアクセスします）。

   ```sh
   node tests/stock-check/verify_stock_check_calc.js
   node tests/stock-check/verify_stock_check_parse.js
   node tests/stock-check/verify_stock_check_screen.js
   node tests/stock-check/verify_stock_check_adjust_prep.js
   node tests/stock-check/verify_stock_check_header.js
   ```

   各行末に `: OK` / `: NG` が出力され、最後に `すべてOK` / `NGあり` と `DONE` が表示されれば実行完了です（NGがあると終了コード1）。

## テストの内容

| ファイル | 確かめること |
|---|---|
| `verify_stock_check_calc.js`（31件） | 計算：サイクルの開始在庫・出荷・収穫・移動・あるべき在庫・調整前の差・率（差÷収穫量）が、2026-11-03 に報告した数字（南丹10月・南丹/群馬/いなべの10/26〜11/1）と一致。最終日の在庫が未入力のサイクルは最新の入力日までの暫定値。調整の一覧を渡したときの調整合計・調整後の差（削除済み・他拠点・期間外は無視。空の一覧では調整合計が null で、調整後の差は調整前と同じ）。要確認の判定（中央値の3倍超・空欄・0・数値でない値。いなべの日曜の出荷0は除く。今日以降は対象外） |
| `verify_stock_check_parse.js`（26件） | シートの読み取り：SOURCES（7〜11月＋開始在庫用の6月）・選べる月、見出し名で列を探すこと（7・8月と9月以降で列が違う／群馬の8月以前は行が1行下／いなべの在庫の表の別の「出荷実績」）→3拠点×8月・10月の全日の値が一致、セルの読み方（`1,103.1`・`170.20kg`・空欄・`#REF!`）、見出しが無いタブのエラー、移動表（規格ごとの重量・加工状況の引き継ぎ・「直接出荷」は在庫を動かさない側）、月と週の一覧（月をまたぐ週は開始日の月の下） |
| `verify_stock_check_screen.js`（36件） | 画面：初期表示（南丹・直近3か月・両方・%）、表の列と行の並び、数字、暫定の行（薄く表示・バッジ）、差のグラフ（調整前・調整後の2本、kg/%切替、暫定は薄い色）と日別のグラフ、週/月/両方・拠点の切り替え、開始月・終了月、読めないタブの警告（読めた分は表示）、今日がSOURCESに無い月（12月）の注意、表のセルに `display:flex` を付けていないこと、スマホ幅で横にはみ出さないこと |
| `verify_stock_check_adjust_prep.js`（19件） | 調整の入力は準備中：入力欄がすべて disabled、保存の通信（POSTなど）が1回も出ない・通信先はCSV取得とChart.jsだけ・HTMLに保存先GASのURLが無い、調整の一覧が空（0件・調整合計「－」）、調整の一覧を渡す口（`setAdjustments`）に値を渡すと表・日別・グラフが変わる（画面上の一時的な差し替えで、保存はしない） |
| `verify_stock_check_header.js`（31件） | 画面上部：左にタイトル「在庫検証ダッシュボード」・右に拠点の切り替え・その下の枠に開始月/終了月/サイクル/グラフの単位。固定領域が position:sticky で画面の上に固定され、枠の下に2pxの罫線、スクロールで動くのは罫線より下だけ。**直近工数計画（work-hours-forecast.html）の同じ部品と、主な表示設定（色・余白・罫線・角丸・文字の大きさ・背景）が一致**すること（直近工数計画の見た目を変えたときは、このテストが NG になるので意図した変更か確認する）。スマホ（390×800・360×640・320×568）で固定部分が画面の高さの20〜30%以内・横にはみ出さない・ラベルが部品から離れない |

## 数字の根拠

`fixtures.js` の値から計算した結果が、2026-11-03 に実際のシートから別の方法（CSVを読んで集計）で出した数字と一致することを、
`verify_stock_check_calc.js` で確かめています（例：南丹10月 差 -2,332.5、南丹10/26〜11/1 差 -824.0、群馬 +15.8、いなべ -1,332.4）。
