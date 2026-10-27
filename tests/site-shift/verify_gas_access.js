// gas/shift-webapp.gs の「閲覧・編集できる人」（拠点ごとの名簿 shiftAcl/{拠点}）の検証。
// UrlFetchApp（Firestore の REST）・Utilities・CacheService などは偽物に差し替え、Node の vm で gs をそのまま動かす。
// 確かめること：
//  - idToken がないリクエストは、どの拠点でも断る
//  - 名簿のない拠点（Firestore が 404）は、ログインした人なら読み書きできる
//  - 名簿のある拠点：admins・editors は読み書き、viewers は読むだけ、載っていない人（Firestore が 403）は読むのも断る
//  - Firestore が 401（トークンの期限切れ）なら、読み込み直しを促す
//  - 人（key）だけで指定する操作（退職など）は、整理済み_Mでその人がいる拠点の編集権限を見る
//  - 同じトークン・拠点の判定はキャッシュし、Firestore を毎回は呼ばない
// 実行：node tests/site-shift/verify_gas_access.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${ok ? '' : '  → ' + detail}`); }

const b64u = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenOf = email => `${b64u('{"alg":"RS256"}')}.${b64u(JSON.stringify({ email, email_verified: true }))}.sig`;
const T = {
  owner: tokenOf('R.Ikeda@10-ff.com'), // 大文字が混じっていても同じ人
  admin: tokenOf('kodama@example.com'),
  editor: tokenOf('kato@example.com'),
  viewer: tokenOf('viewer@example.com'),
  other: tokenOf('other@example.com'),
  expired: tokenOf('kato@example.com') + 'x',
};
// Firestore の名簿（いなべだけ）。ルールで読めない人には 403 を返す（本物のルールと同じ）
const ACL = { 'いなべ': { admins: ['r.ikeda@10-ff.com', 'kodama@example.com'], editors: ['kato@example.com'], viewers: ['viewer@example.com'] } };
let fetches = 0;
const UrlFetchApp = {
  fetch(url, opt) {
    fetches++;
    const site = decodeURIComponent(url.split('/shiftAcl/')[1] || '');
    const tok = String(opt.headers.Authorization).replace('Bearer ', '');
    const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body || {}) });
    if (tok === T.expired) return res(401);
    const acl = ACL[site];
    if (!acl) return res(404);
    const email = JSON.parse(Buffer.from(tok.split('.')[1], 'base64').toString()).email.toLowerCase();
    if (![].concat(acl.admins, acl.editors, acl.viewers).includes(email)) return res(403);
    const arr = xs => ({ arrayValue: { values: xs.map(x => ({ stringValue: x })) } });
    return res(200, { fields: { admins: arr(acl.admins), editors: arr(acl.editors), viewers: arr(acl.viewers) } });
  },
};
const store = {};
const context = {
  UrlFetchApp,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s).digest()],
    base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: s => [...Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')],
    newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    formatDate: () => '2026-10-27',
  },
  CacheService: { getScriptCache: () => ({ get: k => store[k] || null, put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
  SpreadsheetApp: {}, PropertiesService: {}, Logger: { log() {} },
  console,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../gas/shift-webapp.gs'), 'utf8'), context);
// 整理済み_Mの代わり（postSites_ が人のいる拠点を調べるのに使う）
vm.runInContext(`readMembers_ = () => [
  { key: 'INABE1', site: 'いなべ', flag: 1 },
  { key: 'GUNMA1', site: '群馬', flag: 1 },
];`, context);

// 'nope' は不明な action。権限の確認を通れば「不明なactionです」、通らなければ権限のエラーになる
const get = (site, idToken) => context.doGet({ parameter: { action: 'nope', site, idToken } }).message;
const post = req => context.doPost({ postData: { contents: JSON.stringify(Object.assign({ action: 'nope' }, req)) } }).message;
const PASS = '不明なactionです';

check('idTokenなし：名簿のない拠点でも断る', /ログインの確認/.test(get('群馬')), get('群馬'));
check('idTokenなし：書き込みも断る', /ログインの確認/.test(post({ site: '群馬' })), post({ site: '群馬' }));
check('名簿のない拠点：載っていない人も読める', get('群馬', T.other) === PASS, get('群馬', T.other));
check('名簿のない拠点：載っていない人も書ける', post({ site: '群馬', idToken: T.other }) === PASS, post({ site: '群馬', idToken: T.other }));

check('いなべ：名簿を作った人（大文字のメール）は書ける', post({ site: 'いなべ', idToken: T.owner }) === PASS, post({ site: 'いなべ', idToken: T.owner }));
check('いなべ：管理者は書ける', post({ site: 'いなべ', idToken: T.admin }) === PASS, post({ site: 'いなべ', idToken: T.admin }));
check('いなべ：編集の人は読める', get('いなべ', T.editor) === PASS, get('いなべ', T.editor));
check('いなべ：編集の人は書ける', post({ site: 'いなべ', idToken: T.editor }) === PASS, post({ site: 'いなべ', idToken: T.editor }));
check('いなべ：閲覧の人は読める', get('いなべ', T.viewer) === PASS, get('いなべ', T.viewer));
check('いなべ：閲覧の人は書けない', /いなべのシフトを変える権限がありません/.test(post({ site: 'いなべ', idToken: T.viewer })), post({ site: 'いなべ', idToken: T.viewer }));
check('いなべ：載っていない人は読めない', /いなべのシフトを見る権限がありません/.test(get('いなべ', T.other)), get('いなべ', T.other));
check('いなべ：載っていない人は書けない', /権限がありません/.test(post({ site: 'いなべ', idToken: T.other })), post({ site: 'いなべ', idToken: T.other }));
check('トークンの期限切れは読み込み直しを促す', /期限が切れました/.test(get('いなべ', T.expired)), get('いなべ', T.expired));

// 人（key）だけで指定する操作
const retire = (key, idToken) => post({ action: 'retire', key, date: '', idToken });
check('退職：いなべの人を、閲覧の人は操作できない', /権限がありません/.test(retire('INABE1', T.viewer)), retire('INABE1', T.viewer));
check('退職：いなべの人を、載っていない人は操作できない', /権限がありません/.test(retire('INABE1', T.other)), retire('INABE1', T.other));
check('退職：群馬の人は、名簿がないので誰でも操作に進める', !/権限|ログイン/.test(retire('GUNMA1', T.other)), retire('GUNMA1', T.other));
check('退職：いなべの人を、編集の人は操作に進める', !/権限|ログイン/.test(retire('INABE1', T.editor)), retire('INABE1', T.editor));
const cd = post({ action: 'changeDept', key: 'INABE1', site: '群馬', dept: '栽培', idToken: T.other });
check('部門変更：拠点を群馬と書いても、いなべの人は変えられない（群馬にいない人は見つからない扱い）', /見つかりません/.test(cd), cd);
const ml = post({ action: 'mirrorLegacyAll', idToken: T.other });
check('旧シフト表への一括書き込みは、いなべの編集権限が要る', /いなべのシフトを変える権限がありません/.test(ml), ml);

// キャッシュ
const before = fetches;
get('いなべ', T.editor); get('いなべ', T.editor); post({ site: 'いなべ', idToken: T.editor });
check('同じ人・同じ拠点の判定はキャッシュから（Firestoreを呼ばない）', fetches === before, `${fetches - before}回呼んだ`);

const ng = results.filter(r => !r.ok).length;
console.log(`\n${results.length - ng}/${results.length} OK`);
process.exit(ng ? 1 : 0);
