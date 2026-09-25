# 業務UI版の追加品質改善・検証記録

対象: `index-business-ui.html` / 2026-09-22

利用者の追加依頼に基づき、画面・CSS・固定文言・ボタンを追加せず、変換の意味と操作の安定性を改善した。原版 `index.html` は作業開始時の内容を保持した。前回は制約としていた実DB検証15ケースのうち11ケースを修正し、今回の274ケースでは想定外の失敗がなかった。任意のOracle SQLを完全自動移行できるという判定ではない。

## 改善内容

| 対象 | 修正と効果 |
| --- | --- |
| 数値変換 | 明示された数値のTO_CHARで小数・大きな値・先頭小数点を保持。書式省略TO_NUMBERを数値CASTへ変換し、空文字と不正な数値を区別。NaN・Infinity・空白だけの文字列などを正常値として通さない |
| 日付変換 | 対応するTO_DATE書式で時刻を保持。リテラルのRR年を実行時の世紀で解釈。明示書式の動的日付では夏時間のない壁時計時刻として処理 |
| 現在日時 | SYSDATE/CURRENT_DATEの秒精度を保持し、現在日時を文単位で固定。CURRENT_TIMESTAMP/LOCALTIMESTAMPの対応する精度指定を保持 |
| 式 | 整数同士の除算で小数部が失われる問題、明示された日数加減算、型が確定したNULL文字列連結を補正 |
| SUBSTR・LPAD・INSTR・TRUNC | SUBSTRの負数・小数・巨大値・範囲外・NULLを補正し、動的引数の重複評価を防止。LPADの空パディング、対応するINSTRのUnicode文字位置、日付TRUNCの対応単位を補正 |
| ROWNUM | 単一テーブルの対応範囲で、並べ替え・集約・DISTINCTより先に行数を制限。ORや複雑な結合等では危険な書き換えを避けて既存の警告を使う |
| シーケンス・IDENTITY | START/INCREMENT/CACHE/CYCLE等の対応する採番設定を保持。NOCYCLEを失って循環が有効になる問題を修正。制約のDISABLEを消して黙って有効化しない |
| 名前とSQL構造 | コメント付き・Unicodeのシーケンス名、修飾された利用者定義関数、実在のDUEL/DUAL、引用名、複合フィールド参照を保護。MERGEの暗黙別名と埋め込み文字列の境界を修正 |
| 埋め込みSQL | Unicode・16進・制御文字等の対応するエスケープを正しく復元。不明なエスケープを部分的に解釈して文字列値を壊さない |
| 入力とコピー | IME変換途中の不要なSQL処理を抑制。クリップボードAPIが応答しない場合も8秒で既存のフォールバックへ進み、ボタンが待機状態に残らない |
| 大量入力 | 60,000文字以上をHTML内コードから作るWorkerで処理。再編集・クリア・画面離脱で旧処理を終了し、古い結果の上書きを防止。復元・履歴復帰で再実行。Worker作成不可時は同じ変換器を同期実行 |

WorkerのためにCSPへ `worker-src blob:` を追加した。外部スクリプト・外部通信は許可していない。入力SQLはコードとして評価せず、Workerへデータとして渡す。CSS・JavaScriptは単一HTMLに内包する。

## 検証結果

| 検査 | 結果 |
| --- | --- |
| 業務UI版の単体テスト | 187件成功、失敗・スキップなし |
| 原版の既存検査と業務UI版の追加回帰テスト | 187件成功 |
| 今回追加した単体テスト | 50件成功。修正前の比較可能な49件では42件失敗、7件成功。残る1件は旧コピー処理が完了しないため比較実行から除外 |
| Chromium・Firefox・WebKit | 各20件、合計60件成功。スキップ・不安定な再試行成功なし |
| 実DB比較 | 274ケース: 結果一致264件、不正入力の拒否6件、既知の制約4件、想定外の失敗0件 |
| 限定した変異テスト | 11個の故意の不具合をすべて検出。構文エラーや変異挿入失敗を検出成功に数えない |
| 構文・静的検査 | インラインJSとテストJSの構文、HTML lint、差分の空白検査が成功 |
| UI維持 | CSPとメインscriptを除くHTML・CSS・テーマ処理が修正前と一致。日本語メッセージの追加なし。PC/モバイル × ライト/ダーク × 空欄/変換済みの8画像が完全一致 |

単一HTMLをfile URLで開き、外部HTTP通信なし・ページ例外なしを各操作テストで確認した。既存ボタンは30pxを維持。コピー成功・失敗・待機・古い完了通知、クリア・選択方向付き復元、IME、Worker処理・中断・フォールバック・履歴復帰を検証した。Worker処理ではメインスレッドの変換関数が呼ばれないことも確認した。

実DBは使い捨てのOracle AI Database 26ai Free 23.26.3とPostgreSQL 15.17を使用。NULL・型・行数・高精度数値を区別し、数値比較はJavaScriptの浮動小数点へ丸めない。夏時間の境界はAmerica/New_YorkとAsia/Tokyoでも照合した。コンテナを削除し、検証用に起動した専用VMを停止した。

Node 22.22.2 / macOS arm64で、単純なNVL文1,000件（34,000文字）の変換中央値は123ms、10,000件（340,000文字）は1,245msだった。各3回の変換関数だけの測定で、全構文や端末の上限を保証しない。ブラウザーの大量入力はWorkerで処理し、利用できない環境の同期フォールバックでは処理中に画面が待機する。

## 残る適用条件

今回の検証集合に残る4ケースは、無制限NUMBERを使うIDENTITY、およびADD_MONTHS・MONTHS_BETWEEN・LAST_DAYの互換関数である。前者を無断で整数型へ狭めると範囲が変わり、後者はOracleの暦設定等の確認が必要になるため、既存の警告を維持している。

4ケース以外の未対応がないという意味ではない。列スキーマ、NLSの小数点・書式・言語・暦、OracleサーバーとPostgreSQLセッションのタイムゾーン、数値の型・精度範囲、PL/SQL、複雑な結合やROWNUM、DDL式文脈等は個別検証が必要。動的SUBSTRで生成するスカラーサブクエリは、サブクエリを許さないCHECK・索引式等へそのまま利用できない。完全なOracle構文解析器やスキーマに基づく型解析器は備えていない。

この結果は、検証した範囲での品質向上の証拠である。販売品質を一律に保証するものではなく、対応条件を決めた実務SQLでの受け入れ検査が必要になる。テスト件数やNodeのコードカバレッジを、任意のSQLの変換成功率とは扱わない。

## 証跡と再実行

[集計・ソースハッシュ](business-extended-quality-2026-09-22.json)、[入力と両DBの実測値](business-extended-database-comparison-2026-09-22.json)、[ブラウザー結果](business-extended-browser-qa-2026-09-22.json)、[UI比較](business-extended-ui-preservation-2026-09-22.json)を保存した。前回のQA記録は変更していない。

`npm run test:business`、`npm run test:business:e2e`、`npm run test:business:mutation` で再実行できる。実DBの起動と環境変数は [README](../README.md)、対応範囲の区別は [変換方針](../CONVERSION_POLICY.md)を参照。

仕様の確認にはOracleの [SUBSTR](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/SUBSTR.html)、[数値TO_CHAR](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/TO_CHAR-number.html)、[INSTR](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/INSTR.html)、[書式モデルとRR年](https://docs.oracle.com/en/database/oracle/oracle-database/12.2/sqlrf/Format-Models.html)、およびPostgreSQL 15の[書式関数](https://www.postgresql.org/docs/15/functions-formatting.html)を使用した。
