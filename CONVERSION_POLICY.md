このプロジェクトの変換方針

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
