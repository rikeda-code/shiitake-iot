# 拠点シフト表（site-shift.html）のテスト

Firebase（認証・Firestore）と GAS をページ内の偽物（`helpers.js`）に差し替えて、Playwright で動かします。ネットワークには出ません。

```sh
# dashboard をポート8811で配信（python が無ければ npx http-server dashboard -p 8811 など）
python3 -m http.server 8811 --directory dashboard
node tests/site-shift/verify_row_order.js      # 並び順（条件で並べ替え・手動）
node tests/site-shift/verify_print_person.js   # 個人別（1人1枚）の印刷。SHOT_DIR=フォルダ で画面を保存
node tests/site-shift/verify_flag3_member_dates.js  # F列3の表示・実際の入社日/退職日(meta/dates)・雇用区分の選択肢
node tests/site-shift/verify_access_control.js  # 閲覧・編集できる人（拠点ごとの名簿 shiftAcl）
node tests/site-shift/verify_member_table_fit.js  # メンバー欄(#memTable)を4列・横スクロールなしで表示
node tests/site-shift/verify_org_change.js      # 組織内の変更・入社取消・取消(orgTo)・同名2行の見分け方
```

`verify_gas_legacy_mirror.js`・`verify_gas_master_write.js` は gas/shift-webapp.gs 自体（整理済み_Mへの
書き込みロジック）の検証で、SpreadsheetApp などを偽物に差し替えて Node の vm で直接動かすため、
上記のダッシュボードサーバーは不要です。

```sh
node tests/site-shift/verify_gas_legacy_mirror.js   # 旧シフト表へのバックアップ書き込み
node tests/site-shift/verify_gas_master_write.js    # 整理済み_Mへの書き込み（月度・F列の自動判定・行の探し方）
node tests/site-shift/verify_gas_access.js          # 閲覧・編集できる人（idToken と Firestore の名簿で判定）
node tests/site-shift/verify_gas_org_change.js      # 組織内の変更(changeOrg)・入社取消(cancelJoin)・行の見分け方・書き込み失敗時のエラー表示
```
