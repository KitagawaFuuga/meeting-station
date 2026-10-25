# fare-map を次のアプリに流用するための手引き

fare-map（予算で電車でどこまで行けるかを地図に出すアプリ）を作る中で決めたこと・作った部品・ハマったことのまとめ。
新しいアプリを始めるときに、このファイルを新しいリポジトリへコピーするか、Claude に「fare-map の docs/reuse-guide.md を読んで」と頼む。
Claude のメモ（`~/.claude/projects/<プロジェクト>/memory/`）はプロジェクトごとに分かれていて新しいリポジトリからは読めないので、
引き継ぎたい知見はここに書いてある。

2026-10-25 時点の内容。

---

## 1. 構成と、それを選んだ理由

| 役割 | 使っているもの | 理由・メモ |
|---|---|---|
| フレームワーク | Next.js 16（App Router、`output: "standalone"`） | API とページを1つにまとめられる。standalone は Docker イメージを小さくするため |
| 言語 | TypeScript strict | 型検査は TS 7（`@typescript/native`）、lint 用は TS 6（下の「ハマりどころ」参照） |
| UI | React 19 + Tailwind CSS 4 | |
| 地図 | MapLibre GL JS 6 + OpenFreeMap（`liberty` スタイル） | API キー不要・無料。タイルは外部配信なので CSP に許可が要る |
| 入力検証 | zod 4 | API のクエリと、外部データ（JSON）の読み込みの両方で使う |
| 曖昧検索 | fuse.js | 駅名の候補表示 |
| 単体テスト | Vitest 5 | |
| E2E | Playwright（デスクトップと Pixel 7 の2つ） | 本番ビルドに対して走らせる（`next start`） |
| TDD の強制 | Probity（PreToolUse フック、`probity.config.ts`） | `lib/` `app/` `components/` は赤のテストなしに書けない |
| 整形・lint | Prettier 3 / ESLint 10 + typescript-eslint | CI で `format:check` まで見る |
| 書体 | BIZ UDPゴシック（`next/font/google`、`preload: false`） | 数字・カナが読み分けやすい UD 書体。日本語サブセットが無く重いので先読みしない |
| 実行環境 | Azure Container Apps（従量課金） | 使われないと0台に縮み、課金も止まる |
| イメージ置き場 | Docker Hub の public リポジトリ | Azure Container Registry は月額がかかるので使わない |
| CI/CD | GitHub Actions（`ci.yml`・`deploy.yml`） | main への Merge で自動デプロイ |

---

## 2. 流用できる部品

### そのまま持っていけるもの

| ファイル | 何をするか | 流用するときの注意 |
|---|---|---|
| `lib/server/rate-limit.ts` | トークンバケットのレート制限（キー数の上限つき LRU） | プロセス内メモリ。レプリカを増やすと台ごとに別々に数える（最大1台にする） |
| `lib/server/result-cache.ts` | 件数上限つきの結果キャッシュ | 同上 |
| `lib/security-headers.ts` + `next.config.ts` の `headers` | CSP・X-Frame-Options などを全パスに付ける | 地図タイルなど外部の取得先を `TILE_ORIGIN` のように足す。`'unsafe-inline'` が要る理由はファイル内のコメント |
| `lib/geo.ts` の `boundsOf` | 座標の集合を囲む範囲（MapLibre の `fitBounds` にそのまま渡せる形） | |
| `lib/sheet.ts` + `components/BottomSheet.tsx` | モバイルのボトムシート（つまみのタップ・スワイプで3段階） | 40px 未満の指ブレは無視する |
| `components/MapView.tsx` | MapLibre の初期化・GeoJSON の点・吹き出し・出発点の印 | ワーカーの扱い（下の「ハマりどころ」）とセットで持っていく |
| `scripts/copy-maplibre-worker.mjs` | MapLibre のワーカーを `public/` にコピー | `dev` と `build` の前に必ず走らせる（`package.json` の scripts） |
| `lib/server/route-url.ts` | 外部 API から得た URL を http/https か確かめてから返す | `javascript:` スキームの混入対策 |
| `app/api/reachable/query.ts` | zod でのクエリ検証とエラー応答の型 | IP の取り方に既知の課題あり（7章） |
| `e2e/smoke.spec.ts` の `stubTiles` | E2E で地図のスタイルとタイルを空の応答に差し替える | 外部配信の障害・レート制限で CI が落ちないようにするため |
| `Dockerfile` | builder → runner の2段構成、standalone を `node server.js` で起動 | 実行時に読むデータは個別に COPY する。漏れると起動後に落ちる |
| `.github/workflows/ci.yml` | lint → format:check → typecheck → test、E2E（デスクトップ・モバイル） | |
| `.github/workflows/deploy.yml` | テスト → イメージ作成 → **起動して API を叩く確認** → Docker Hub へ push → Azure のイメージ差し替え | 名前（`fare-map`・`fare-map-rg`）を新しいアプリに合わせる |
| `.github/dependabot.yml` | npm と Actions の更新を月1回まとめて PR にする | |
| `probity.config.ts` + `.claude/settings.json` | TDD を強制するフック | |

### 考え方だけ持っていくもの

- **入力欄を文の形にする**（`components/SearchPanel.tsx`・`BudgetInput.tsx`）: 「〇〇から □□円で行ける駅」。見出しを並べるより何を入れると何が出るかが伝わる。見出しは消して、入力欄の名前は `aria-label` に残す。
- **一覧の見出しを凡例にする**（`components/StationList.tsx`・`lib/brackets.ts` の `groupByBracket`）: 色の凡例を別に置かず、段階ごとの見出しに色の点を付ける。
- **順序のある量は1色相の濃淡で塗る**（`lib/brackets.ts`）: 虹色だと順序が読めない。背景地図の色（liberty は水域が青、公園が緑、主要道路が橙〜黄）と色相をずらし、いちばん淡い色でも地色に対して 2:1 を超えるか dataviz の検証スクリプトで確かめる。
- **アイコン**（`app/icon.svg`・`app/apple-icon.png`・`components/Logo.tsx`）: アプリが答えていることをそのまま図にした（出発点から輪が広がる）。茶色でいびつな輪にすると年輪に見えたので、整った円で中心をずらした。ホーム画面用は iOS が透過部分を黒く塗るので地色で塗り、角丸で欠けないよう 76% に縮める。

---

## 3. 新しいアプリの立ち上げ手順

### 開発環境
1. `create-next-app` の後、`AGENTS.md`（Next 16 は手元の `node_modules/next/dist/docs/` を読めという注意）が入っていることを確かめる。
2. `typescript` を TS 6、型検査を `@typescript/native`（TS 7）にする（4章）。
3. Probity を入れ、`probity.config.ts` で対象のパスを決める。
4. Playwright の `webServer` は本番ビルド（`npm run build && npx next start -p <ポート>`）にする。MapLibre のワーカーは dev と本番で挙動が違う。

### GitHub
5. 既定ブランチを `main` にする。作業ブランチを既定にすると、push がそのまま公開になる経路が見えなくなる。
6. `main` にルールセットを付ける: PR 必須・CI（test と e2e）必須・削除と強制上書きの禁止。
7. Dependabot の警告と修正 PR、CodeQL（default setup）、脆弱性の非公開報告を有効にする（公開リポジトリなら無料）。

### 公開（Azure Container Apps）
8. Docker Hub に public のリポジトリを作り、アクセストークン（Read & Write）を発行する。
9. Azure ポータルでコンテナー アプリを作る。
   - リソースグループ・環境・アプリは新規作成。リージョンは Japan East。
   - 環境の「監視」でログの宛先を「ログを保存しない」にする（Log Analytics の課金を避ける）。
   - 「クイックスタート イメージを使用する」にチェック（まだ自分のイメージが無いので仮置き）。**レジストリは作らない**。
   - CPU とメモリは実測で決める（fare-map は 0.5 vCPU / 1Gi。0.5Gi では予算1万円の検索を重ねると約640MBで足りなかった）。
10. 作成後に直す: **ターゲット ポート**（クイックスタートで作ると 80 になる。Next の standalone は 3000）、**スケール**（最小0・最大1）。
11. GitHub の Secrets に3つ登録する: `DOCKERHUB_USERNAME`・`DOCKERHUB_TOKEN`・`AZURE_CREDENTIALS`。`AZURE_CREDENTIALS` は PowerShell 5.1 だと壊れやすい（4章の手順を使う）。
12. main に Merge → デプロイが走る → ポータルの「アプリケーション URL」で確認。
13. Azure の予算アラート（月 500円など）、コストの異常アラート、サービス正常性アラートを設定する（どれも無料）。

---

## 4. ハマりどころ

### Windows・PowerShell
- **`AZURE_CREDENTIALS` の登録**: Windows PowerShell 5.1 でパイプ（`|`）で `gh` に渡すと JSON として読めず、`--body $json` で渡すと中の `"` が落ちる。症状は azure/login の「Not all values are present」「Expected property name … at position 5」。通った形:
  ```powershell
  $sub = az account show --query id -o tsv
  $creds = az ad sp create-for-rbac --name <名前> --role contributor --scopes "/subscriptions/$sub/resourceGroups/<RG>" --json-auth | Out-String | ConvertFrom-Json
  $creds | Select-Object clientId, tenantId, subscriptionId   # 3つに値が出れば正常
  gh secret set AZURE_CREDENTIALS --repo <owner>/<repo> --body (($creds | ConvertTo-Json -Compress) -replace '"', '\"')
  Remove-Variable creds
  ```
- **cmd と PowerShell の取り違え**: `$sub = …` が「内部コマンドまたは外部コマンド…」と言われたら cmd で開いている。`powershell` と打って切り替える。
- **Python のヒアドキュメントで TS を編集しない**: `\u0000` が生の NUL バイトになって混入した。
- **バックグラウンドで起動した `npx next start` は止めても本体が残る**: E2E が古いビルドを再利用する。ポートが空いたか確かめる。

### Next.js 16
- `middleware` は `proxy` に改名されている。proxy に共有状態を置くと、台数が増えたとき制限が素通りする。
- 手元の `node_modules/next/dist/docs/` が正。学習データの知識は古いことがある。
- アイコンは `app/icon.svg` と `app/apple-icon.png` を置くだけで `<link>` が入る。
- `output: "standalone"` と `next start` は組み合わせられない（警告が出る）。本番と同じ起動は `node .next/standalone/server.js`（既定ポート 3000、`PORT` で変更）。

### MapLibre
- Turbopack がバンドルするとワーカーの URL が 404 になり、地図が読み込み中のまま止まる。`public/` にワーカーをコピーして `setWorkerUrl()` する（`scripts/copy-maplibre-worker.mjs`）。
- 地図に描いた点は DOM に出ないので、E2E では canvas のスクリーンショットの画素を数えて確かめる（`e2e/smoke.spec.ts` の `cheapestPixels`）。

### TypeScript
- `typescript` を直接 7 に上げると typescript-eslint が TS 6 の API を前提にしていて throw する。`typescript` を TS 6（`npm:@typescript/typescript6`）、型検査を `@typescript/native`（TS 7）に分けている。

### Probity（TDD の強制）
- 新しい関数は ①関数が無いことを示す → ②import とテストを**1回の書き込みで**足して TypeError を見る → ③何もしないスタブでアサーション失敗を見る → ④実装、の順だと通る。import とテストを別々の編集にすると、間の「passed」を見て止められる。
- 判定は AI なので揺れる。止められたらテストからやり直す。フックを外したり Bash で書き換えたりしない。
- 会話記録が 100MB を超えると全部の書き込みが止まる。長いセッションは区切る。

### テスト・CI
- `.gitignore` しているデータ（`data/raw/` のような手元の取得物）を読むテストは、CI では `skipIf(!existsSync(...))` で飛ばす。`describe.skipIf` でも中身は実行されるので、読み込み自体もファイルの有無で分ける。
- E2E のテストデータを初期表示の範囲内の駅だけにしない（地図が動かない不具合を見逃した）。
- 検証用のテストは、書いた時点では緑なので、わざと壊して落ちることを確かめてからコミットする。

### Azure
- クイックスタート イメージで作るとターゲット ポートが 80 になる。自分のアプリのポートに直さないと、差し替え後にアクセスが届かない。
- 作成画面では最大レプリカ数を決められず、既定は10台。作成後に「スケール」で直す。
- 外部の死活監視（5分ごとにアクセスするもの）は入れない。0台に縮む暇がなく、ずっと課金される。
- Defender for Cloud の有料プラン、Application Insights も入れない（基本機能は無料で有効）。

---

## 5. データとライセンス

| データ | ライセンス | 扱い |
|---|---|---|
| 駅データ.jp | 加工・再配布可、出典の明記は義務ではない | 本家の会員ダウンロードで更新（ミラーは2021年で停止） |
| 全国鉄道運行本数データ（gtfs-gis.jp） | 「CC-BY 4.0、ODbL」と併記 | 両方に従う。画面に出典と「加工して使用」、派生データを ODbL でも提供と README に明記 |
| ODPT（公共交通オープンデータセンター） | 都営だけ CC BY 4.0。ほかの12社は基本ライセンスで**再配布禁止** | リポジトリやイメージに焼き込めるのは CC BY のものだけ。API は1000件で黙って切れる |
| 各社の公開 GTFS（琴電・ゆいレール・札幌市） | CC BY 4.0 | 画面に出典 |
| 地図（OpenStreetMap / OpenFreeMap） | OSM は ODbL。OpenFreeMap は無料・予告なく終了しうる | 地図右下の表示で OSM の条件を満たす |
| BIZ UDPゴシック | SIL OFL | 自前配信なので表示義務なし |
| 取り込んだ外部スキル（`.claude/skills/`） | MIT / Apache-2.0 | 取得元の LICENSE を各フォルダに同梱（`SOURCES.md`） |

公開前の点検は「目立つデータ」ではなく、`data/` のファイルを1つずつ出所まで遡る。加工して別ファイルに溶かしたデータほど見落とす。

---

## 6. 費用とアカウント（2026-10 時点）

- **Azure Container Apps**: 0.5 vCPU / 1Gi で、動いている間は約8.6円/時間。毎月の無料枠（18万 vCPU秒・36万 GiB秒・200万リクエスト）で月100時間ぶん賄える。最大1台なので、最悪でも月 約5,300円で頭打ち。
- **Docker Hub**（public）・**GitHub Actions**（公開リポジトリ）: 無料。
- **独自ドメイン**: 買い切りは無い（毎年更新、最長10年分の先払いは可）。.com は年 1,200〜1,800円程度。初年度の安さより更新料で選ぶ。無料の is-a.dev は「ソフトウェア開発に関するサイト」に限られる。
- アカウント: GitHub `KitagawaFuuga`、Docker Hub `nimaha`、Azure は個人のサブスクリプション。

---

## 7. 既知の課題（fare-map に残っているもの）

- **レート制限の IP の取り方**: `app/api/reachable/query.ts` の `clientIp` は `x-forwarded-for` の**先頭**を使っている。先頭は利用者が自由に書けるので、偽装すると制限をすり抜けられる。Azure Container Apps の前段が付け足す値（末尾側）を使うよう直す必要がある。流用するときは直してから持っていく。
- **CodeQL の指摘5件**: ワークフローの `permissions` 未指定が4件（`permissions: contents: read` を足す）、`scripts/fare/ingest/html-table.ts` のタグ除去が不完全なのが1件（開発時だけ使うスクリプトで、出力は React がエスケープするので実害は薄い）。
- **lint の警告1件**: 使われていない `eslint-disable`。
- **GitHub Actions の Node.js 20 廃止の警告**: `actions/checkout@v4` などを新しい版に上げる（Dependabot が PR を出す）。
