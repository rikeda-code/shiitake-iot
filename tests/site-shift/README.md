# 拠点シフト表（site-shift.html）のテスト

Firebase（認証・Firestore）と GAS をページ内の偽物（`helpers.js`）に差し替えて、Playwright で動かします。ネットワークには出ません。

```sh
# dashboard をポート8811で配信（python が無ければ npx http-server dashboard -p 8811 など）
python3 -m http.server 8811 --directory dashboard
node tests/site-shift/verify_row_order.js      # 並び順（条件で並べ替え・手動）
node tests/site-shift/verify_print_person.js   # 個人別（1人1枚）の印刷。SHOT_DIR=フォルダ で画面を保存
```
