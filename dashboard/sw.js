// SW は登録のみ。キャッシュは使用しない（常にネットワーク取得）
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  // 古いキャッシュをすべて削除
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});
// fetch イベントは登録しない → ブラウザのデフォルト動作（ネットワーク直取り）に委ねる
