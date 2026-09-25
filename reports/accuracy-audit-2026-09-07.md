2026年9月7日時点のSQL変換精度調査

現状は、基本的なSQLの変換を補助する用途には使えるものの、警告がない出力でもデータや問い合わせの意味が変わるため、無確認で実行できる精度には達していない。対応関数を増やす前に、文字列保護・問い合わせの範囲・NULLと型・日時の意味保持を改善する価値が高い。

調査では現行の変換器を実行し、実装、既存テスト、OracleとPostgreSQL 15の公式仕様を照合した。Oracle/PostgreSQLサーバーでの比較実行は行っていない。以下の変換出力は実測であり、実行結果や型エラーの説明はコードと公式仕様からの判断である。移行元Oracleの版、スキーマ、NLS、タイムゾーン、移行先の互換関数・拡張は未確認。通常のPostgreSQL 15を前提に評価した。

実務SQLの代表サンプルと正解結果がないため、「精度○%」は算出できない。問題が現れそうな境界ケース38件と対照ケース3件を記録した。境界ケースのうち36件は警告が出なかったが、意図的に選んだ入力なので、この比率を実運用の不具合率として扱ってはいけない。

| 実行した確認 | 現在の結果 | 分かること・限界 |
| --- | --- | --- |
| 単体テスト | 24/24成功 | 主に変換文字列と警告の検査。DB結果の一致は未検証 |
| E2E | 13/13成功 | 入力・表示・コピー・IME・大きな入力・8種類の画面サイズなど |
| mutation smoke | 6/6検出との報告 | 手作りの6変異のみ。下記の計測上の問題もある |
| lint / typecheck / build | 成功 | typecheckの実体はnode --checkによる構文検査 |
| coverage | 行92.78%、分岐95.35% | 対象はテストとヘルパー。HTML内の変換器本体は計測対象に含まれていない |
| 追加の調査入力 | 境界38件＋対照3件を変換 | 変換結果と警告の記録。DBの意味等価テストではない |

基本の型置換、通常の文字列・コメント保護、シーケンス、単純なNVL、MERGEの一部には実装と回帰テストがある。MONTHS_BETWEENやADD_MONTHSなどを安易に近似せず警告する方針もある。一方、変換器は独自の文字列走査と正規表現を組み合わせており、SQL全体の構文木やスキーマに基づく型解決は持っていない。PostgreSQL 15.17という設定値はDBによる構文・型検証を意味しない。

**最優先は、文字列データの破壊を止めること。** 再現IDはLIT-01〜03。

```sql
-- 入力
UPDATE t a SET a.note = 'a.id=1';

-- 実際の出力。警告は0件
UPDATE t a SET note = 'id =1';
```

更新する文字列自体が変わっている。[UPDATEの修飾子除去処理](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:2299)が文字列リテラルを保護せず置換しているため。MERGEの文字列`'INSERT (t.id)'`も`'INSERT (id)'`に変わり、ROWNUM付きSELECTの文字列`'WHERE ORDER BY'`も`'ORDER BY'`に変わる。[MERGEのINSERT列処理](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:2290)と[LIMIT追加時の整形](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:2325)にも保護を迂回する置換がある。通常のリテラル保護テストが通っても、全変換経路を保護できているわけではない。

**ROWNUMは、集計・並べ替え・内側の問い合わせを考慮する必要がある。** 再現IDはROW-01〜05。

```sql
-- 入力
SELECT COUNT(*) FROM t WHERE ROWNUM <= 2;

-- 実際の出力。警告は0件
SELECT COUNT(*) FROM t
LIMIT 2;
```

例えばtが100行なら、入力は最大2行を数えるが、出力は100行を数えた結果1行にLIMITをかける。このほか、内側のEXISTSにあるROWNUMが外側のLIMITへ移る、上限10と上限2のANDがLIMIT 10になる、ORの片側の制約が全体の制約になるケースを再現した。[変換処理](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:2336)は問い合わせブロックや論理式の範囲を扱っていない。

同一SELECTの`WHERE ROWNUM <= 2 ORDER BY id`を`ORDER BY id LIMIT 2`へ変換する処理も、同じ意味とは保証できない。OracleではこのROWNUM制限の後に並べ替えるため。現在の[単体テスト](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/tests/unit/sql-converter.test.mjs:102)はこの出力を正解として固定しており、期待値の方針から見直す必要がある。[Oracle ROWNUM](https://docs.oracle.com/en/database/oracle/oracle-database/12.2/sqlrf/ROWNUM-Pseudocolumn.html)、[PostgreSQL SELECT](https://www.postgresql.org/docs/15/sql-select.html)。

**NULLと型の推測で、条件分岐や実行可否が変わる。** 再現IDはNULL-01〜02、TYPE-01〜03。

| 入力の要点 | 現在の変換 | 問題 |
| --- | --- | --- |
| `NVL2('', 1, 0)` | `CASE WHEN '' IS NOT NULL THEN 1 ELSE 0 END` | Oracleでは0、PostgreSQLでは1になる |
| `DECODE(CAST(NULL AS NUMBER), CAST(NULL AS NUMBER), 1, 0)` | 通常の`=`で比較するCASE | Oracleでは1、出力は0になる |
| `TO_NUMBER(123)` | `TO_NUMBER(NULLIF(123, ''), '999')` | 数値に対する空文字比較を生成する |
| 数値列flagへの`NVL(flag, '0')` | `COALESCE(NULLIF(flag, ''), '0')` | 数値列に空文字比較を挿入し、型エラーになる |
| `NVL(CAST(NULL AS VARCHAR2(10)), 0)` | `COALESCE(CAST(NULL AS VARCHAR(10)), 0)` | Oracleの文字列への暗黙変換を保持していない |

これらはすべて警告0件。Oracleの空文字のNULL扱い、DECODEのNULL同士の一致、NVLの暗黙変換を、結果引数や列名による推測だけでは再現できない。PostgreSQLのCOALESCEには共通型、NULLIFには比較可能な型が必要。[型推測](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:1658)、[NULL補正の判断](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:1712)、[DECODE変換](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:1757)が該当する。[Oracle Nulls](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Nulls.html)、[DECODE](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/DECODE.html)、[NVL](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/NVL.html)、[PostgreSQL条件式](https://www.postgresql.org/docs/15/functions-conditional.html)。

DECODEの比較だけなら`IS NOT DISTINCT FROM`が候補になるが、Oracleの空文字、比較型、戻り値型、式の評価回数も併せて扱う必要がある。比較演算子の置換だけで全面的に等価になるわけではない。[PostgreSQLのNULLを考慮した比較](https://www.postgresql.org/docs/15/functions-comparison.html)。

**日時と数値の書式補完は、値を変える可能性が高い。** 再現IDはFMT-01〜02、DATE-01〜04。

`TO_DATE('2024-06-15 12:34:56', 'YYYY-MM-DD HH24:MI:SS')`がそのままPostgreSQLのTO_DATEになる。Oracle DATEは時刻を含むが、PostgreSQLのto_dateは日付を返すため、時刻を保持できない。逆にDATE型をTIMESTAMPへ置き換える処理では、`DATE '2024-06-15' + 1`が`TIMESTAMP '2024-06-15' + 1`になり、日数加算の演算子が成立しない。[Oracle DATE型](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Data-Types.html)、[TO_DATE](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/TO_DATE.html)、[PostgreSQL日時演算](https://www.postgresql.org/docs/15/functions-datetime.html)。

さらに、現在のコードはRRをYYに単純置換する。Oracleの現在年が2026の場合、`TO_DATE('50-01-01', 'RR-MM-DD')`の1950年がPostgreSQL側では2050年になる。NLS_DATE_LANGUAGEの第3引数も黙って削除する。[Oracle RRの規則](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Format-Models.html)、[PostgreSQL書式関数](https://www.postgresql.org/docs/15/functions-formatting.html)。

`TO_CHAR(12.34)`には小数のない`FM999999999`が補完される。未知の列へのTO_NUMBERにも固定の9桁整数書式を付けるため、小数・桁数・NLSを保持できる根拠がない。これらの再現例も警告0件。[書式補完](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:1667)、[TO_CHAR/TO_DATE変換](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:1863)、[Oracle TO_CHAR(number)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/TO_CHAR-number.html)、[PostgreSQL書式関数](https://www.postgresql.org/docs/15/functions-formatting.html)。

**入れ子の関数が未変換で残る。** 再現IDはFUN-01〜03。

```sql
-- 入力
SELECT NVL(NVL(a, b), c) FROM t;

-- 実際の出力。警告は0件
SELECT COALESCE(NULLIF(NVL(a, b), ''), c) FROM t;
```

[関数走査](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:1559)が外側の閉じ括弧まで読み飛ばし、同じ関数名の内側を処理しない。DECODEでも再現する。`NVL/* comment */(...)`も検出されない。残ったOracle関数を最終出力で検出する仕組みも不足している。式を内側から扱う構造的な変換と、変換後の未対応構文検査が必要。

**SQLとプログラム内の文字列を推測で混ぜて扱い、名前まで書き換える。** 再現IDはID-01、LEX-01。

```sql
-- 入力
CREATE TABLE "DATE" ("NUMBER" NUMBER);

-- 実際の出力。警告は0件
CREATE TABLE "TIMESTAMP" ("NUMERIC" NUMERIC);
```

引用されたテーブル名と列名が変わる。[二重引用符内のSQL判定](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:753)の文脈推測が原因。SQL入力とJava/JavaScript等の文字列入力を明示的に切り替え、それぞれの引用・エスケープ規則で処理する方が確実。現在はバックスラッシュを通常SQLでもエスケープとして扱い、有効なOracle文字列に未閉じ引用符の警告を出す例もある。[引用符読み取り](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:628)、[Oracleリテラル仕様](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Literals.html)。

**DDL・MERGE・未対応関数の警告にも穴がある。** 詳細はJSONのDDL、MERGE、DUAL、SUB、SEQ、WARNの各IDに記録した。

| 分類 | 確認した出力上の問題 |
| --- | --- |
| TABLESPACE | `TABLESPACE users;`の削除でセミコロンまで消え、2つのCREATE TABLEが連結される |
| 数値型 | `FLOAT(126)`が`DOUBLE PRECISION(126)`、`NUMBER(*,2)`が`NUMERIC(*,2)`になり、不正な型指定が残る |
| IDENTITY | NUMBER列がNUMERICのままIDENTITYになり、整数型の要件を満たさない |
| MERGE | INSERT後のWHERE、UPDATE後のDELETE WHEREが未変換・警告なし |
| DUAL | dummy列の参照先を消す、JOINのFROMを消す |
| SUBSTR | 長さ0・負数に対するNULLの扱いが異なる |
| シーケンス | `"MYSEQ".NEXTVAL`が未変換・警告なし |
| 未対応・依存関数 | LISTAGGやSOUNDEXに未対応・拡張依存の警告がない |
| 警告の誤判定 | 先頭にコメントがあるSELECTを「SELECT以外」と判定する |

IDENTITYが利用するシーケンスの型はsmallint/integer/bigint。MERGEのINSERTとUPDATEにOracle独自の末尾句を残してもPostgreSQL 15の構文にはならない。SUBSTRはOracleでは長さが1未満ならNULLを返す。SOUNDEXはPostgreSQLでfuzzystrmatch等の用意が必要。[PostgreSQL CREATE TABLE](https://www.postgresql.org/docs/15/sql-createtable.html)、[CREATE SEQUENCE](https://www.postgresql.org/docs/15/sql-createsequence.html)、[数値型](https://www.postgresql.org/docs/15/datatype-numeric.html)、[MERGE](https://www.postgresql.org/docs/15/sql-merge.html)、[Oracle SUBSTR](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/SUBSTR.html)、[PostgreSQL文字列関数](https://www.postgresql.org/docs/15/functions-string.html)、[fuzzystrmatch](https://www.postgresql.org/docs/15/fuzzystrmatch.html)。

テストの成功率と変換精度を分けて管理する必要がある。現在の[出力ステータス](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html:589)は文字列に差分があるかで「変換済み」を表示し、DBでの実行可否や意味の確認状態は表していない。[既存QAレポート](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/reports/qa-test-report.html)は単体10件・E2E12件という過去の状態で、TRUNCの説明なども現在の実装と一致していない。

また、[mutationスクリプト](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/scripts/mutation-smoke.mjs:73)は変異作成から検査までの例外を一括で「検出」と数える。変異を挿入できなかったエラーまで成功として数え得るため、6/6を精度の根拠にはできない。変換器をHTMLからモジュールへ分離し、本体のカバレッジを測定できるようにすることも必要。

改善は次の順で進めるのが妥当。

1. **データの破壊と無警告の誤変換を止める。** UPDATE/MERGE/LIMITの全経路で文字列を保護し、引用識別子を保持する。ROWNUMは問い合わせの範囲と評価順を扱える形だけ変換し、判断できない形は元の式を残して理由と位置を警告する。今回の具体例を回帰テストにする。
2. **構文構造と型を扱う。** 字句解析を共通化し、関数の入れ子・コメント・文境界を安定して処理する。SELECT、UPDATE、MERGEを段階的に構文木で扱う。DDLやスキーマ情報から列の型を解決し、型不明時の書式補完や空文字比較を抑制する。構文木だけでは型・NLS・評価順の違いは解決しない。
3. **意味の差を明文化する。** NVL/NVL2/DECODE、TO_DATE/TO_CHAR/TO_NUMBER、SUBSTR、日時演算ごとに境界値と戻り値型を定義する。互換関数を使う場合は、必要な拡張、導入SQL、対象バージョンを明示し、警告だけで関数定義の存在を前提にしない。
4. **実務SQLで測定する。** まず実際に使うSQLを100件程度、SELECT/DDL/DML/MERGE/埋め込みSQLに分類し、実際のOracle版とPostgreSQL 15.17で比較する。NULL・空文字・小数・桁数・月末・閏日・時刻・タイムゾーン・引用識別子を含める。SELECTは行集合と型、ORDER BYがあるものは順序、DMLは更新後データと制約まで比較する。採番や現在時刻は値をそのまま比較せず、制御可能な条件と評価回数を検証する。

継続計測では「DBで構文・型が通る割合」「結果・型・更新結果が一致する割合」「要確認箇所を正しく警告できる割合」「問題があるのに無警告で出力した件数」「自動変換できた範囲」を分ける。すべてを警告にするだけでは自動変換の有用性が分からないため、正確さと自動化できた範囲の両方を追う。

調査対象のindex.htmlのSHA-256は`56cac1b27e8108036c2cec55e24d6776db6d6bb66e6eeb7c41acbc553ca4a648`。アプリ本体・既存テストの修正は行っていない。保存した[変換出力JSON](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/reports/accuracy-audit-2026-09-07.json)には38件の入力・期待する意味・現行出力・警告と、3件の対照入力がある。[調査用スクリプト](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/reports/accuracy-audit-2026-09-07.mjs)はプロジェクトのルートから以下で再実行できる。標準出力に記録を出すだけで、SQLは実行しない。

```sh
node reports/accuracy-audit-2026-09-07.mjs
```
