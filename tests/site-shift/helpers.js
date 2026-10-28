// 拠点シフト表のテスト共通：Firebase（認証・Firestore）とGASをページ内の偽物に差し替えて開く

// gas/shift-webapp.gs の normalizeName_ と同じロジック（偽のaddMember応答のkey作成に使う）
function normalizeNameLike(raw) {
  let s = String(raw || '').normalize('NFKC');
  const cut = ['（', '('].map(c => s.indexOf(c)).filter(i => i >= 0).sort((a, b) => a - b)[0];
  if (cut !== undefined) s = s.slice(0, cut);
  return s.replace(/\s+/g, '').toUpperCase();
}

function fakeFirebase(seed) {
  // ページの中で動く、最低限の Firebase compat の偽物
  const DEL = { __del: true };
  // seed.__errorPaths（パスの配列）に入れたパスは、onSnapshotが常にエラーを返す
  // （Firestoreのルールで許可されていない文書の再現用。配信中のdbには含めない。getもpermission-deniedになる）
  // seed.__email：ログインした人のメール（省略時 tester@example.com）
  const errorPaths = new Set((seed && seed.__errorPaths) || []);
  const cleanSeed = Object.assign({}, seed); delete cleanSeed.__errorPaths; delete cleanSeed.__email;
  const db = JSON.parse(JSON.stringify(cleanSeed));
  const subs = {};
  window.__db = db;
  window.__writes = [];
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const snapOf = path => ({ exists: path in db, data: () => clone(db[path]), metadata: { fromCache: false, hasPendingWrites: false } });
  const notify = path => (subs[path] || []).forEach(cb => setTimeout(() => cb(snapOf(path)), 0));
  const merge = (dst, src) => {
    Object.entries(src).forEach(([k, v]) => {
      if (v && v.__del) delete dst[k];
      else if (v && typeof v === 'object' && !Array.isArray(v)) merge(dst[k] && typeof dst[k] === 'object' ? dst[k] : (dst[k] = {}), v);
      else dst[k] = v;
    });
    return dst;
  };
  const ref = path => ({
    path,
    collection: n => ({ doc: id => ref(`${path}/${n}/${id}`) }),
    onSnapshot(a, b, c) {
      const cb = typeof a === 'function' ? a : b;
      const errCb = typeof a === 'function' ? b : c;
      if (errorPaths.has(path)) {
        if (errCb) setTimeout(() => errCb(new Error('permission-denied（偽物のエラー）')), 0);
        return () => {};
      }
      (subs[path] ||= []).push(cb);
      setTimeout(() => cb(snapOf(path)), 0);
      return () => { subs[path] = subs[path].filter(x => x !== cb); };
    },
    async get() {
      if (errorPaths.has(path)) throw Object.assign(new Error('Missing or insufficient permissions.（偽物のエラー）'), { code: 'permission-denied' });
      return snapOf(path);
    },
    async delete() { window.__writes.push({ path, deleted: true }); delete db[path]; notify(path); },
    async set(data, opt) {
      window.__writes.push({ path, data: clone(data) });
      db[path] = opt && opt.merge ? merge(db[path] || {}, data) : merge({}, data);
      notify(path);
    },
  });
  window.__remoteSet = (path, data) => { db[path] = data; notify(path); };
  const firestore = () => ({
    enablePersistence: async () => {},
    collection: n => ({ doc: id => ref(`${n}/${id}`) }),
    runTransaction: async fn => fn({ get: async r => snapOf(r.path), set: (r, d) => { db[r.path] = d; notify(r.path); } }),
  });
  firestore.FieldValue = { delete: () => DEL, serverTimestamp: () => Date.now() };
  const user = { email: (seed && seed.__email) || 'tester@example.com', getIdToken: async () => 'fake-id-token' };
  const authObj = { currentUser: user, onAuthStateChanged: cb => setTimeout(() => cb(user), 0), signOut: async () => {}, signInWithPopup: async () => {} };
  const auth = () => authObj;
  auth.GoogleAuthProvider = class { setCustomParameters() {} };
  window.firebase = { initializeApp() {}, firestore, auth };
}

// 今日を 2026-10-23 に固定し、偽の Firebase・GAS で site-shift.html を開く
async function openShiftPage(ctx, { seed, members }) {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const FIXED = new Date(2026, 9, 23, 9).getTime(), D = Date;
    window.Date = class extends D { constructor(...a) { return a.length ? new D(...a) : new D(FIXED); } static now() { return FIXED; } };
  });
  // 後から登録した route が優先される
  await page.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/gstatic\.com\/firebasejs\/.*app-compat\.js/, r => r.fulfill({ contentType: 'text/javascript', body: `(${fakeFirebase})(${JSON.stringify(seed)});` }));
  await page.route(/script\.google\.com/, r => {
    const body = { status: 'ok', members, shifts: [], fixed: {} };
    // addMember だけ、本物のGAS（gas/shift-webapp.gs の normalizeName_）と同じ考え方でkeyを返す
    // （site-shift.htmlが戻り値のkeyを使ってmeta/datesに書くため）
    if (r.request().method() === 'POST') {
      let req = {}; try { req = JSON.parse(r.request().postData() || '{}'); } catch (e) { /* 無視 */ }
      if (req.action === 'addMember') { body.row = 999; body.key = normalizeNameLike(req.name); }
      // changeOrg：members（テストのシード）から該当の人のF列を見て、本物のGASと同じ考え方で
      // mode（F列2=overwrite／F列1=split）を返す（site-shift.htmlはこのmodeで書き込む内容を決める）
      // 多くのテストのメンバーはsiteを持たない（単一拠点のテストのため）。x.siteが無いときは
      // 拠点では絞らない（req.siteが無いときに絞らないのと同じ考え方）
      const sameSite = x => !req.site || !x.site || x.site === req.site;
      if (req.action === 'changeOrg') {
        const m = (members || []).find(x => x.key === req.key && sameSite(x) && x.empType === req.empType && x.dept === req.dept);
        body.mode = m && m.flag === 2 ? 'overwrite' : 'split';
        if (body.mode === 'split') { body.newRow = 999; body.oldFlag = 3; body.newFlag = 1; }
      }
      // undoRetire(orgTo)：members（テストのシード）にorgTo先の行がちょうど1つ無ければ、
      // 本物のGASと同じようにwarningを返す
      if (req.action === 'undoRetire' && req.orgTo) {
        const matches = (members || []).filter(x => x.key === req.key && sameSite(x)
          && x.empType === req.orgTo.empType && x.dept === req.orgTo.dept && (x.flag === 1 || x.flag === 2));
        if (matches.length !== 1) body.warning = 'テスト用の偽の警告：組織内の変更で作られた新しい行が見つからないか複数あります';
      }
    }
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  return page;
}

module.exports = { fakeFirebase, openShiftPage, normalizeNameLike };
