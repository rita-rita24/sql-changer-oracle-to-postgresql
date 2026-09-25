このプロジェクトの変換方針

2026-09-23のコメント境界改善は、UI・固定文言・ボタンを増やさずに適用した。

- 行コメントの終端改行を、関数引数・CAST・MERGEの組み立て時に保持する。
- 通常コメントを含む対応範囲のROWNUM上限は、フィルター・件数制限・ソートの順序を維持する。削除した上限条件のコメントはLIMITの直前へ保持する。ヒント付き・複雑な条件は自動変換を広げない。
- `nq'...'` とUnicodeの引用区切りを字句として保護する。代替引用の自動移行は行わず、既存の警告を使う。
- 警告判定の字句範囲は1回の判定内で再利用する。SQLの永続保存は追加しない。

独立した期待値を使う109件の実DB回帰例と4件の専用データ準備を既定集合に追加した。詳細は[コメント境界の品質改善](reports/comment-quality-2026-09-23.md)を参照。

2026-09-23の誤変換探索では、画面を変えずに実DBの差分検証と内部変換を強化した。

- 期待値はOracleの実行結果とし、値・NULL・行数・数値精度・列型の分類を比較する。警告の追加で不一致を合格にはしない。
- 空文字、文字列関数、REPLACE/TRANSLATE、NVL2の戻り値型、CHARの空白、MODの除数0、数値引数と小数桁、入れ子のDATE演算を補正する。
- LPAD/RPADはOracle 26ai・AL32UTF8で実測した表示幅を使う。動的引数は1回だけ評価する。CHARリテラルの長さ補正は同じ文字セットとBYTEセマンティクスを対象とする。
- 生成テストに新しい許容差・例外を加えない。追加シードで未知の組み合わせを探索でき、元SQL・両DB結果・再現情報を保存する。

現行の実DB検証集合は `tests/fixtures/semantic-database-cases.mjs`。[誤変換の検証記録](reports/silent-quality-2026-09-23.md)を参照する。以下は過去の検証記録として保持する。

2026-09-23の追加改善も、画面のHTML・CSS・固定文言・ボタンを変更せず、現行HTMLへ適用した。

- DECODEの型付きNULLと空文字になる検索式を、NULLを考慮して比較する。
- 型が明示された数値関数の結果、NVL/NVL2/DECODEの数値から文字列への変換でも、小数とOracleの先頭小数点表記を保持する。
- Oracle DATE同士の差は数値の日数へ変換する。TIMESTAMP同士の差と、型が不明な列はこの補正の対象にしない。
- 型が明示された数値・文字列・NULLの連結、および文字列数値を含む算術式はOracleの演算順を保持する。NLS依存の型推定は新たに行わない。
- 同一文の結果再利用は1回の変換内に限定し、128件・入力16,000文字/件・出力64,000文字/件までとする。文番号と診断行は個別に保持する。
- 編集・クリア・画面離脱後に古いコピー待機を解放する。コピー失敗時の新しい選択範囲、成功した代替コピー前の選択方向、日本語入力中の既存ステータスを保護する。

この段階の実DB検証集合は `tests/fixtures/boundary-database-cases.mjs`。詳細は[境界条件の品質検証記録](reports/boundary-quality-2026-09-23.md)を参照する。

2026-09-22の追加改善は、統合後の `sql-changer-oracle-to-postgresql.html` を対象とする。下記の原版・業務UI版の記載は履歴であり、現行の参照ファイル名・再実行方法はREADMEに従う。

- 型が明示された算術式のTO_CHARでも小数を保持する。未知の列型は数値と断定しない。
- LPADの数値・小数長・空文字、数値TRUNCの浮動小数点と小数桁指定を補正する。
- 対応する固定日時書式では、Oracleが拒否する24時・60分・60秒を正常な日時へ補正しない。
- コメントを除いたSQLの開始行を診断に用いる。入力・リテラル・コメントは引き続き保持する。
- IME途中の文字表示、末尾改行のスクロール同期、コピーの選択位置保護、Undo／Redo、大量入力イベント、Workerの通信エラー復帰を改善する。HTML要素・表示文言・ボタンは追加しない。

実DB検証集合は `tests/fixtures/quality-database-cases.mjs`。詳細と実測結果は [追加品質検証記録](reports/quality-hardening-2026-09-22.md) を参照する。

2026-09-22の業務UI版 `index-business-ui.html` は、利用者の「UI・文言・ボタンを増やさず、内部ロジックで改善できることは全て行う」という指示に基づき、次の意味互換性の改善を適用した。以下の2026-09-09／09-11の既存方針は原版 `index.html` の記録として保持し、業務UI版の対応範囲と区別する。

- 明示された数値のTO_CHARと書式省略TO_NUMBERで、従来の9桁マスクによる小数・大きな数の損失を防ぐ。NaN/Infinity等のOracleで無効な数値入力はエラーを維持する。
- 対応する数値日付書式のTO_DATEは時刻を保持する。リテラルのRR年は実行時の世紀規則で解釈し、タイムゾーンによる夏時間の補正を避ける。
- SYSDATE/CURRENT_DATEは秒精度を保ち、現在日時関数は文単位で固定する。OracleサーバーとPostgreSQLセッションのタイムゾーン差は運用側で確認する。
- SUBSTRの負数・小数・NULL・範囲外を補正し、動的引数を繰り返し評価しない。Unicode文字位置を保つ。
- 数値除算、型が明示された日数演算とNULL文字列連結、対応するINSTR/TRUNCを補正する。スキーマ不明の型やNLS依存の意味は断定しない。
- 単一テーブルの対応範囲では、ROWNUMの上限をソート・集約より先に適用する。複雑な結合・OR等は従来の警告を使い保持する。
- シーケンス・整数IDENTITYの対応する採番オプションを保持する。無制限NUMBERのIDENTITYを勝手に整数へ狭めない。DISABLE制約を黙って有効化しない。
- 修飾された利用者定義関数、実在のDUEL/DUAL、引用名、埋め込み文字列の値を保護する。
- 60,000文字以上はHTML内コードから作ったWorkerで変換し、編集・クリアで旧処理を中断する。Workerが使えない環境では同じ変換器を同期実行する。外部依存・通信・UI要素は追加しない。

業務UI版の期待値は `tests/fixtures/business-conversion-policy.json` と `business-audit-expectations.json`、実DB検証は `business-extended-database-cases.mjs` で管理する。ADD_MONTHS/MONTHS_BETWEEN/LAST_DAY、未確定の列型・NLS、PL/SQL、すべてのDDL式文脈等の完全自動移行は保証しない。詳細は `reports/business-extended-quality-2026-09-22.md` を参照。

2026-09-09の改善では、既存実装・既存テストが定める通常の変換結果を維持した。以下の方針を別の変換方式へ変更する場合は、利用者の明示的な指示を確認する。

| 対象 | 維持する方針 |
| --- | --- |
| 移行先 | PostgreSQL 15.17 |
| 型 | NUMBER→NUMERIC、VARCHAR2/NVARCHAR2→VARCHAR、DATE→TIMESTAMP、CLOB→TEXT、BLOB→BYTEAなどの既存対応 |
| 現在日時 | SYSDATE/SYSTIMESTAMP→CLOCK_TIMESTAMP()、対応するSYSDATEの定数日数加減算→INTERVAL |
| NVL/NVL2 | COALESCE/CASEに変換し、既存の空文字→NULL補正を適用する |
| DECODE | CASEに変換する。NULLリテラルの比較はIS NULL。NULLになり得る検索式にはNULLを考慮した比較を使う |
| TO_NUMBER | 関数名を維持して書式を補完する。未知の引数は既存の999999999書式 |
| TO_CHAR | 関数名と既存の書式補完を維持する。数値の既定書式はFM999999999 |
| TO_DATE | TO_DATEを維持する。従来の入力形式推測、YYYYMMDD等の補完、RR/RRRR→YY/YYYYを維持する |
| 互換関数 | TRUNCの日付処理、ADD_MONTHS、MONTHS_BETWEEN、INSTR、LAST_DAY等は既存どおり保持し、互換関数や手動対応を警告する |
| SUBSTR | SUBSTRを維持し、開始位置0→1、定数の負数開始位置→RIGHTを使う既存対応を維持する |
| LPAD | 既存の数値→文字列変換を維持する |
| 文字列連結 | 演算子とオペランドを保持し、NULLの意味差を警告する |
| シーケンス | NEXTVAL/CURRVAL→nextval()/currval()。引用識別子は名前・大文字小文字を保持する |
| UPDATE/MERGE | 既存の代入先修飾子除去、MERGE USING DUAL→VALUES、UPDATE後WHERE→WHEN MATCHED条件を維持する |
| ROWNUM | 対応する単純な上限はLIMITへ変換する。ORDER BY付きも従来の出力を維持し、評価順の違いを警告する |
| 埋め込みSQL | 二重引用符内のSQLや対応するSQL断片の変換を維持する。SQLの引用識別子・ホスト側の変数名と区別する |
| 提供形態 | 単一のindex.htmlをブラウザーで使える形を維持する。実行時の外部ライブラリは追加しない |

精度改善として、リテラル・コメント・引用名・文区切りを壊す処理、入れ子の変換漏れ、明白な型エラー、NULLの境界値を修正する。例えば、文字列`'a.id=1'`を保持することや、数値リテラルに空文字比較を付けないことは、上記の方針を正しく適用するための修正である。

方針を保ったまま自動変換の妥当性を判断できない場合は、理由を警告する。集計・OR・サブクエリ等のROWNUMや参照先が必要なDUALは、条件や参照先を壊さず残す。従来方針が明示されている日時・書式・型の置換については、その出力を維持して差を警告する。警告のない出力についても、全Oracle構文の対応や実務データでの意味一致を保証するものではない。

スキーマやNLSが未提供の場合、列の型・既定の日付書式・小数点・言語は確定できない。互換関数はこのHTMLからインストールしない。利用先DBでの定義・設定確認が必要。2026-09-09のPostgreSQL単独テストに加え、2026-09-11からOracle 26ai Free 23.26.3とPostgreSQL 15.17の実測比較を追加した。再実行方法と対象範囲はREADME.mdを参照。

2026-09-11の修正も方針を変更しない。空文字リテラルの結果をNULLへ補正し、文字列リテラルの範囲外SUBSTRをNULLにする。型がリテラルやCASTから明示されているNVL/NVL2/DECODEの引数・戻り値は、既存のCOALESCE/CASE方式の中で必要なCASTを補い、文字列と数値をそろえる。未知の列型は従来の推測を維持して警告する。

既存方針の代表20例は[方針の期待値](tests/fixtures/conversion-policy.json)に修正前の出力として保存している。[回帰テスト](tests/unit/accuracy-regression.test.mjs)は、この20例に加えて前回調査の38例と追加の境界値を検査する。

プロジェクトのルートで検証できる。

```sh
npm run test:unit
npm run test:e2e
npm run test:mutation
npm run lint
npm run typecheck
npm run build
```

E2E用ブラウザーがない場合は`npx playwright install chromium --only-shell`で用意する。今回の検証用ブラウザーは一時ディレクトリに置いたため、現在の環境で使う場合は`PLAYWRIGHT_BROWSERS_PATH=/tmp/sql-changer-playwright npm run test:e2e`で実行できる。

任意のPostgreSQL実行検証は、実行時依存にDBを追加せず、別ディレクトリに[embedded-postgres](https://github.com/leinelissen/embedded-postgres)の15.17用パッケージを用意する。検証スクリプトは毎回127.0.0.1の一時ポートに新規DBを作成し、終了時に停止・削除する。既存DBへの接続設定は受け付けない。

```sh
npm install --prefix /tmp/sql-changer-pg15-validation --no-audit --no-fund embedded-postgres@15.17.0-beta.17
SQL_CHANGER_PG_MODULE=/tmp/sql-changer-pg15-validation/node_modules/embedded-postgres/dist/index.js npm run test:postgres
```

`test:postgres`の結果には、修正が正しく動く検証と、維持した方針の制約が適切に警告される検証を分けて表示する。SQLの失敗を期待する制約テストも含むため、全項目成功を自動変換成功率と解釈しない。

現在の`test:coverage`はNode標準の計測であり、HTML内の変換器本体を対象に含まない。出力される割合を変換精度や変換器のカバレッジとして扱わない。`test:mutation`は限定した6変異の検査で、変異挿入エラーや構文エラーを検出成功に含めない。
