/**
 * 要員計画タブ用 GAS Webアプリ（Stage 1：疎通確認のみ）
 *
 * 「26/生産計画」「ファーム勤務時間」どちらのスプレッドシートにも紐づかない、
 * 新規のスタンドアロンGASプロジェクトとして作成する。
 * 60日サイクルモデルによるコンテナ数算出・「整理済み_計画_更新」シートへの
 * 書き込みは後続のStageで実装する。Stage 1では、ダッシュボードの更新ボタン→
 * このWebアプリ→固定の応答が返る、という一連の流れが技術的に動くことのみを確認する。
 *
 * ── リクエストの受け取り方（CORSプリフライト回避のため）──────────────
 * ダッシュボード側はContent-Type: text/plain;charset=utf-8でPOSTする
 * （Content-Type: application/jsonだとブラウザがCORSプリフライト(OPTIONS)を送るが、
 * GAS WebアプリはOPTIONSに応答できずCORSエラーになるため）。
 * ボディの中身自体はJSON文字列なので、このdoPost側でe.postData.contentsを
 * JSON.parse()して読み取る。Stage 1時点ではボディの中身は使わないが、
 * 今後のStageで実データを送る前提として、正しく受け取れる形にしてある。
 *
 * ── デプロイ手順（Apps Scriptエディタで実施）──────────────────────
 * 1. 新規スタンドアロンのApps Scriptプロジェクトを作成し、このファイルの内容を貼り付ける
 * 2. 「デプロイ」→「新しいデプロイ」を選択
 * 3. 種類の選択で「ウェブアプリ」を選ぶ
 * 4. 「次のユーザーとして実行」→「自分」
 * 5. 「アクセスできるユーザー」→「全員」
 * 6. デプロイ後に発行されるURLを、dashboard/work-hours.html内の
 *    STAFFING_PLAN_GAS_URL定数に設定する
 *
 * コードを更新した場合、既存デプロイの公開URLには自動反映されない。
 * 「デプロイを管理」から新バージョンとして再デプロイする必要がある。
 * ────────────────────────────────────────────────────────
 */

function doPost(e) {
  // ボディはtext/plainで届くため、テキストとして読み取ってからJSON.parse()する
  // （Stage 1時点ではrequestDataの中身は未使用。今後のStageで利用する）
  const requestData = JSON.parse(e.postData.contents);

  const response = {
    status: "ok",
    message: "GAS Webアプリ疎通確認：テスト応答です",
    receivedAt: new Date().toISOString()
  };
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}
