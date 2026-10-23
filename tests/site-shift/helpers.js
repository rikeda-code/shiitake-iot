// 拠点シフト表のテスト共通：Firebase（認証・Firestore）とGASをページ内の偽物に差し替えて開く
function fakeFirebase(seed) {
  // ページの中で動く、最低限の Firebase compat の偽物
  const DEL = { __del: true };
  const db = JSON.parse(JSON.stringify(seed));
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
      (subs[path] ||= []).push(cb);
      setTimeout(() => cb(snapOf(path)), 0);
      return () => { subs[path] = subs[path].filter(x => x !== cb); };
    },
    get: async () => snapOf(path),
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
  const user = { email: 'tester@example.com' };
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
  await page.route(/script\.google\.com/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok', members, shifts: [], fixed: {} }) }));
  return page;
}

module.exports = { fakeFirebase, openShiftPage };
