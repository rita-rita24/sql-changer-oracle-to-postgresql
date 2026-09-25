# Oracle → PostgreSQL SQL変換 0.2.1

Oracle SQLをPostgreSQL 15.17向けに変換する、単一HTMLの変換補助ツールです。

## 使い方

プロジェクト直下の `sql-changer-oracle-to-postgresql.html` をブラウザーで開き、左側にSQLを入力・貼り付けます。右側に変換結果が表示され、「コピー」で取り出せます。配布するときも、この1ファイルをそのまま渡してください。ネットワーク接続やインストールは不要です。SQLを外部送信・保存せず、タブを閉じると入力は失われます。

- 「変換済み」は変換処理の完了を表します。入力SQLの実行やスキーマ検証は行いません。
- 「要確認」は、型推定、互換関数、意味の差、未対応構文などに確認事項がある状態です。画面下部に文番号・SQL開始行と理由を表示します。
- 「入力に不備あり」は、閉じていない引用符や括弧などを検出した状態です。
- コピーがブラウザーに拒否された場合は、既存ボタンに失敗を表示します。操作位置が変わっていなければ結果を選択するため、キーボードでもコピーできます。
- 右上の日食ボタンでライト／ダークモードを切り替えます。初回はOS設定に従い、手動で選んだテーマだけを保存します。保存が禁止されている環境でも、そのタブでは切り替えられます。
- 「クリア」後は、新しく入力するまで「元に戻す」で直前のSQL・選択範囲・スクロール位置を復元できます。復元用の内容もメモリーだけに保持します。
- Tabで2文字のインデントを挿入します。対応ブラウザーでは通常のUndo／Redoで戻せます。Escを押してからTabで次の操作へ、Shift+Tabで前の操作へ移動できます。
- 日本語入力中も編集中の文字を表示し、確定時に変換します。60,000文字以上はHTML内コードから作るWorkerで処理し、編集・クリア時に古い処理を中断します。Workerが使えない場合は同期処理へ戻ります。

## 対応範囲

変換は決定的なルールに基づき、すべてのOracle構文を解析するパーサーではありません。[変換方針](CONVERSION_POLICY.md)と[警告なしの誤変換の検証記録](reports/silent-quality-2026-09-23.md)を参照してください。過去の記録に登場する `index.html`／`index-business-ui.html` は当時の名前です。現在の検証・配布対象は上記HTMLに統一しています。

NUMBER→NUMERIC、DATE→TIMESTAMP、NVL→COALESCE、NVL2/DECODE→CASEなどを扱います。型が明示された数値の書式なしTO_CHARでは小数・桁数を保持し、対応する数値書式のTO_DATEでは時刻を保持します。SUBSTRの境界値、数値除算、対応する日付演算・文字列連結・ROWNUM・採番オプションにも補正を行います。

型が明示されたNULLのDECODE比較、数値関数の結果やNVL等の小数文字列化、Oracle DATE同士の差（日数）、型が明示された数値・文字列の連結と算術の評価順も補正します。同じSQL文を含む大量入力では、その1回の変換中だけ件数・サイズを制限して変換結果を再利用します。

関数引数・CAST・MERGEの行コメントは、生成したカンマ・括弧・条件がコメントに巻き込まれないように改行を保持します。通常コメントを含む単純なROWNUM上限も、絞り込み→件数制限→ソートの順序を維持します。ヒントや複雑な条件は従来どおり手動確認です。`nq'...'` とUnicodeの引用区切りを保護し、中のSQL風テキストを書き換えません。代替引用構文自体は保持し、既存の警告を表示します。[今回の改善と検証記録](reports/comment-quality-2026-09-23.md)を参照してください。

空文字になる文字列関数、REPLACEのNULL引数、NVL2の戻り値型、CHARの空白、MODの除数0、文字列数値・小数桁指定、入れ子の日付演算を補正します。LPAD/RPADの表示幅は検証用Oracle 26ai・AL32UTF8から実測した規則を使います。ASCIIと判定できない入力では、引数を1回だけ評価する補助式を生成するため、出力SQLが長くなります。日本語CHARリテラルのバイト長補正はAL32UTF8・NLS_LENGTH_SEMANTICS=BYTEが対象です。別の文字セット・長さセマンティクスは検証範囲に含みません。

列型やNLS設定が不明な場合の推定、未対応の日付書式、互換関数が必要なADD_MONTHS／MONTHS_BETWEEN／LAST_DAY等、複雑なROWNUM、PL/SQLには制約があります。すべてのDDL式文脈にも対応していません。入力SQLを実行する機能はないため、実データ・スキーマ・NLS設定を含む移行先の検証環境で確認してください。テスト件数を任意のSQLの変換成功率としては扱いません。

## 開発・検証

Node.js 22以降とnpmを使用します。HTMLの利用自体には開発依存は不要です。

```sh
npm ci
npx playwright install chromium firefox webkit
npm test
npm run lint
npm run check:syntax
npm run test:mutation
```

`npm run test:business`、`test:business:e2e`、`test:business:mutation` も同じ現行HTMLを対象にします。E2EはChromium・Firefox・WebKitで実行します。ブラウザーの実行ファイルを指定する場合は `SQL_CHANGER_CHROMIUM_EXECUTABLE`、`SQL_CHANGER_FIREFOX_EXECUTABLE`、`SQL_CHANGER_WEBKIT_EXECUTABLE` を使用できます。

`node scripts/serve-static.mjs` でローカルプレビューを起動できます。`/`、`/index.html`、`/sql-changer-oracle-to-postgresql.html` は同じHTMLを返し、開発用ファイルは公開しません。`SQL_CHANGER_HTML` を指定すると、プレビュー・単体テスト・E2E・実DB検証・配布処理すべてが指定したHTMLを使います。

`check:syntax` は構文検査です。`typecheck` は互換用の別名で、静的型検査ではありません。`build` 単独も構文確認のみです。`test:coverage` はHTML内の変換器本体を計測しません。`test:mutation` は限定した13変異の検査です。

## OracleとPostgreSQLの実測比較

Docker互換の実行環境を起動してから実行します。Oracle 26ai Free 23.26.3とPostgreSQL 15.17のイメージをダイジェスト固定で使用し、毎回新しいDBに人工データだけを用意します。既存DBの接続情報は不要です。ローカルホストのランダムポートだけに公開し、終了時に専用コンテナとデータを削除します。

```sh
npm run test:databases
```

Apple Siliconで用意済みの専用Colimaプロファイルを使う例です。初回はイメージのダウンロードと約4GBのメモリーが必要です。

```sh
colima start sql-changer-validation --cpus 2 --memory 4 --disk 20 --vm-type vz --mount none --activate=false --ssh-config=false --binfmt=false
SQL_CHANGER_DOCKER_CONTEXT=colima-sql-changer-validation npm run test:databases
colima stop sql-changer-validation
```

既定の検証集合は `tests/fixtures/semantic-database-cases.mjs`、結果は `reports/database-comparison-latest.json` です。既存の回帰例、境界値の直積、固定シードで生成する式、別シードの深い入れ子、多行・0行の検索、日本語の表示幅を含みます。期待結果は変換器から作らず、元SQLをOracleで実行して取得します。`SQL_CHANGER_DATABASE_CASES`／`SQL_CHANGER_COMPARISON_REPORT` で対象と保存先を変更できます。

NULL・空文字・文字列・数値・行数・更新件数を区別し、数値の比較で桁を失わないようにしています。全列の型の分類も比較するため、全値NULLや0行でも数値→文字列等の変化を検出します。NUMBER→NUMERIC、DATE→TIMESTAMPは許容する型の対応です。文字列の最大長・数値の宣言精度・全タイムゾーン設定の一致を保証する検査ではありません。

警告が出ても、予期しない結果差は失敗です。以前からの4件の明示的な制約と11件の不正入力は別集計にし、生成例に新たな例外は設定していません。DB未起動、元SQLのエラー、比較失敗、後片付け失敗も検証失敗になります。

別の入力を探索するには、任意の符号なし32ビット整数をシードとして追加します。固定の回帰例は置き換えません。シード・元SQL・変換SQL・両DBの結果・警告・ソースと検証集合のハッシュをレポートに保存します。

```sh
SQL_CHANGER_DISCOVERY_SEEDS=17,99 SQL_CHANGER_DOCKER_CONTEXT=colima-sql-changer-validation npm run test:discovery
```

## 配布前の検証

```sh
SQL_CHANGER_DOCKER_CONTEXT=colima-sql-changer-validation npm run release
```

構文・静的検査、単体テスト、3ブラウザーのE2E、限定した変異テスト、両DB比較を毎回実行します。すべてが成功した場合だけ、検証済みソースと検証集合のハッシュを確認し、検証記録を `reports/` に更新します。結果は [検証記録](reports/release-verification.md)、機械可読な記録は `reports/release-validation.json`、チェックサムは `reports/release-SHA256SUMS` に保存します。アプリはプロジェクト直下の `sql-changer-oracle-to-postgresql.html` の1ファイルをそのまま利用・配布します。`dist/` は使用・生成しません。

任意のPostgreSQL単独検証は `SQL_CHANGER_PG_MODULE` に別途用意した `embedded-postgres@15.17.0-beta.17/dist/index.js` を指定して `npm run test:postgres` を実行します。これも既存DBへ接続せず、一時クラスタを作成・削除します。
