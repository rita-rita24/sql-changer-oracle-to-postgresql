# Oracle → PostgreSQL SQL変換 0.2.1

Oracle SQLを既定の変換方針に沿ってPostgreSQL 15.17向けに変換する、単一HTMLの変換補助ツールです。

## 使い方

`index.html`をブラウザーで開き、左側にSQLを入力・貼り付けます。変換結果は右側へ即時表示され、「コピー」で取り出せます。ネットワーク接続やインストールは不要です。SQLを外部送信・保存せず、タブを閉じると入力は失われます。

- 「変換済み」は変換処理の完了を表します。入力SQLの実行やスキーマ検証は行いません。
- 「要確認」は、型推定、互換関数、意味の差、未対応構文などの確認事項がある状態です。画面下部に対象の文番号・開始行と理由を表示します。
- 「入力に不備あり」は、閉じていない引用符や括弧などを検出した状態です。入力を修正してください。
- コピーがブラウザーに拒否された場合は、結果を選択した状態で案内します。キーボード操作でコピーしてください。
- 右上の日食ボタンでライト／ダークモードを切り替えます。初回はOS設定に従い、手動で選んだテーマだけをブラウザーに保存します。保存が禁止されている環境でも、そのタブでは切り替えられます。SQLはブラウザーのストレージに保存しません。
- 未入力時の「サンプルを試す」で操作を確認できます。「クリア」後は、新しく入力するまで「元に戻す」で直前のSQLを復元できます。復元用の内容もタブ内のメモリーだけに保持します。
- 入力欄ではTabで2文字のインデントを挿入します。Escを押してからTabで次の操作へ、Shift+Tabで前の操作へ移動できます。変換結果と確認事項はキーボードでもスクロールできます。

変換は決定的なルールによります。全Oracle構文を解析するパーサーではありません。実データ・スキーマ・NLS設定を含めた移行可否は、移行先の検証環境で確認してください。Oracle 19cなど、比較対象以外のバージョンとの互換性は今回の実測範囲に含みません。

## 維持する方針と対象範囲

変換方針は`CONVERSION_POLICY.md`に記載しています。NUMBER→NUMERIC、DATE→TIMESTAMP、NVL→COALESCE、NVL2/DECODE→CASE、TO_DATE維持、書式補完、SUBSTR/RIGHT、MERGE、ROWNUM/LIMITなど、既存の方式を維持します。代表20例の出力は固定テストで保護しています。

次の差は方針上残ります。確認事項として通知し、自動変換の成功件数には含めません。

- TO_CHARの既定数値書式による小数・桁数の差、TO_DATEの時刻消失、RR→YYの世紀の差。
- DATE→TIMESTAMP後の日数演算、NUMBER→NUMERICとIDENTITYの組み合わせ。
- 列名に基づく従来の型推定、NULLを含む連結、列値のSUBSTR/RIGHTの範囲外処理。
- 日付TRUNC、ADD_MONTHS、MONTHS_BETWEEN、LAST_DAY、INSTRに必要な互換関数。
- 集計・複雑な条件のROWNUM、PL/SQL、階層問い合わせ、外部結合(+)などの手動対応。

## 開発・検証

Node.js 22以降とnpmを使用します。ブラウザーの実行に開発依存は不要です。

```sh
npm ci
npx playwright install chromium firefox webkit
npm test
npm run lint
npm run check:syntax
npm run test:mutation
```

`check:syntax`は構文検査です。`typecheck`は互換用の別名で、静的型検査ではありません。`test:coverage`は変換器本体のカバレッジを計測しません。カバレッジ率を変換精度として扱わないでください。

## OracleとPostgreSQLの実測比較

Docker互換の実行環境を起動してから実行します。スクリプトはバージョンとダイジェストを固定したOracle 26ai Free 23.26.3とPostgreSQL 15.17を用意し、毎回新しいDBで人工データだけを使用します。既存DBの接続情報は不要です。ローカルホストのランダムポートだけに公開し、終了時に専用コンテナとデータを削除します。初回はイメージのダウンロードと、合計約4GBのメモリーを使う検証環境が必要です。

```sh
npm run test:databases
```

Apple Siliconの今回の検証環境では、専用Colimaプロファイルを使っています。

```sh
colima start sql-changer-validation --cpus 2 --memory 4 --disk 20 --vm-type vz --mount none --activate=false --ssh-config=false --binfmt=false
SQL_CHANGER_DOCKER_CONTEXT=colima-sql-changer-validation npm run test:databases
colima stop sql-changer-validation
```

結果は`reports/database-comparison-latest.json`へ出力します。入力SQL、変換SQL、両DBの実測値・型・実行エラー、警告、例外の理由、ソースとテスト集合のSHA-256を保存します。NULLと空文字、文字列と数値を区別して照合します。既知の差はケースごとに期待する差と警告の存在を検査します。Oracle未起動、予期しない差、警告漏れは失敗になり、スキップで成功扱いにはなりません。

## 配布版の作成

```sh
npm run release
```

構文・静的検査、単体テスト、Chromium/Firefox/WebKitの画面テスト、限定した変異テスト、両DB比較のすべてが成功した場合だけ`dist/`へ配布版を作成します。過去の比較結果で代用せず、毎回実行します。配布対象は`dist/index.html`で、検証記録と方針・説明書も同梱します。`npm run build`単独は構文の確認のみです。

今回の一時ブラウザーを使う場合は、次のように実行できます。

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/sql-changer-playwright SQL_CHANGER_DOCKER_CONTEXT=colima-sql-changer-validation npm run release
```

## 検証環境の出典

- OracleのARM対応：[Oracle公式案内](https://blogs.oracle.com/database/announcing-oracle-database-23ai-free-container-images-for-armbased-apple-macbook-computers)
- Oracleコンテナの設定：[gvenzl/oci-oracle-free](https://github.com/gvenzl/oci-oracle-free)
- Oracle接続ドライバ：[node-oracledb](https://node-oracledb.readthedocs.io/en/latest/)

配布HTMLには、これらのDB・ドライバや外部フォントを含みません。
