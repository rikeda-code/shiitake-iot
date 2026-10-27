# 拠点シフト表 Firestore ルール（閲覧・編集できる人）

Firestore のルールは Firebase コンソール（Firestore Database →「ルール」）で管理している。
拠点シフト表の部分は、今の `match /shiftSites/{document=**} { ... }` を消して、下の内容に置き換える。
置く場所は `match /databases/{database}/documents { ... }` の中。ほかのデータ（@10-ff.com 限定のもの）の決まりはそのまま残す。

```
    // ── 拠点シフト表（site-shift.html） ──
    // 名簿 shiftAcl/{拠点} { admins, editors, viewers: [メール] } のある拠点は、載っている人だけ。名簿のない拠点はログインした人なら誰でも
    function shiftSignedIn() { return request.auth != null && request.auth.token.email_verified == true; }
    function shiftMe() { return request.auth.token.email.lower(); }
    function shiftHasAcl(site) { return exists(/databases/$(database)/documents/shiftAcl/$(site)); }
    function shiftAcl(site) { return get(/databases/$(database)/documents/shiftAcl/$(site)).data; }
    function shiftCanEdit(acl) { return shiftMe() in acl.get('admins', []) || shiftMe() in acl.get('editors', []); }
    function shiftCanView(acl) { return shiftCanEdit(acl) || shiftMe() in acl.get('viewers', []); }
    // 名簿のない拠点に最初の名簿を作れる人（site-shift.html の ACL_OWNER と同じ）
    function shiftAclOwner() { return shiftMe() == 'r.ikeda@10-ff.com'; }

    match /shiftSites/{site} {
      allow read: if shiftSignedIn() && (!shiftHasAcl(site) || shiftCanView(shiftAcl(site)));
      allow write: if shiftSignedIn() && (!shiftHasAcl(site) || shiftCanEdit(shiftAcl(site)));
    }
    match /shiftSites/{site}/{rest=**} {
      allow read: if shiftSignedIn() && (!shiftHasAcl(site) || shiftCanView(shiftAcl(site)));
      allow write: if shiftSignedIn() && (!shiftHasAcl(site) || shiftCanEdit(shiftAcl(site)));
    }
    match /shiftAcl/{site} {
      // 名簿がない（＝制限なし）ことは誰でも確かめられる。名簿の中身は載っている人だけ
      allow read: if shiftSignedIn() && (resource == null || shiftAclOwner() || shiftCanView(resource.data));
      allow create: if shiftSignedIn() && shiftAclOwner();
      allow update, delete: if shiftSignedIn() && (shiftAclOwner() || shiftMe() in resource.data.get('admins', []));
    }
```

## 反映の順番

1. このルールをコンソールで「公開」する（名簿はまだ無いので、この時点では今までと同じに動く）
2. site-shift.html の PR をマージする（Firebase Hosting に自動で出る）
3. GAS（gas/shift-webapp.gs）を新しいバージョンでデプロイし、エディタで `authorizeAccessCheck` を1回実行して外部への通信を許可する
4. アプリの「閲覧・編集できる人」で名簿を入れて保存すると、その拠点に制限がかかる

1 より先に 2 を出すと、名簿（shiftAcl）がルールで読めず、全員に拠点が出なくなる。
3 より先に 2 を出すのはかまわない（古い GAS は idToken を無視するだけ）。
