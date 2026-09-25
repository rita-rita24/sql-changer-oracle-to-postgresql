2026年9月9日 SQL変換精度の改善結果

既存の変換方針を維持して、変換器と検証を改善した。NUMBER→NUMERIC、SYSDATE→CLOCK_TIMESTAMP()、TO系の関数名と書式補完、互換関数を保持する方針、単純なROWNUM→LIMITなどは維持している。変更前の代表20例を期待値として保存し、現在もすべて同じSQLを出力することを確認した。[変換方針と検証方法](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/CONVERSION_POLICY.md)。

前回調査の38例について、19例の出力・誤判定を修正した。残る19例は、方針上の意味差や未対応箇所を具体的に警告する、または危険な部分変換をせず元の条件を保持するようにした。この内訳は選定した再現例についての分類であり、実務SQL全体の精度を表す割合ではない。[38例の変更前後](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/reports/accuracy-improvement-2026-09-09.json)。

| 修正した内容 | 具体例 |
| --- | --- |
| 文字列データの保護 | UPDATE内の`'a.id=1'`、MERGE内の`'INSERT (t.id)'`を保持 |
| 引用名の保護 | テーブル名`"DATE"`、列名`"NUMBER"`を維持 |
| 共通の字句処理 | コメント・qリテラル・ドル引用内の括弧/カンマ/セミコロンを構文として扱わない |
| 関数の入れ子 | 内側のNVL/DECODEも変換。関数名と括弧の間のコメントにも対応 |
| 埋め込みSQL | SQLの引用名とプログラム文字列を区別。ホスト変数名を維持し、新たな改行をエスケープ |
| NULLと既知の型 | NVL2の空文字、DECODEのNULL検索式、数値リテラルへの不正な空文字比較を修正 |
| 文区切り | TABLESPACE除去でセミコロンを消さない |
| 型・シーケンス | FLOATの不正な精度指定を除去。引用されたシーケンス名に対応 |
| ROWNUM | 複数上限は最小値を採用。集計・内側の問い合わせ・ORから制限を外側へ移さない |
| 境界値・入力不備 | SUBSTRの長さ0/負数、未閉じ引用符、過大なDECODE展開を扱う |
| テスト基盤 | mutationの作成失敗を検出成功に数えない。変更前の方針と前回の再現例を回帰テスト化 |

PostgreSQL 15.17の一時DBでも確認した。例えば、UPDATEで格納した文字列、MERGE後の値、NVL2とDECODEのNULL処理、数値変換、引用名、DDLの複数文、複数ROWNUM上限の取得件数が期待どおりだった。[DB実行の記録](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/reports/postgres-verification-2026-09-09.json)。

| 最終検証 | 結果 |
| --- | --- |
| 単体テスト | 96/96成功。方針20例、前回調査38例、既存テストと追加境界値を含む |
| ブラウザーE2E | 15/15成功。新たなデータ保護・警告表示、既存操作、IME、大きな入力、8種類の画面サイズ |
| PostgreSQL 15.17 | 26項目成功。修正20項目と、維持した方針等の制約6項目を区別して検証 |
| mutation smoke | 6/6検出。元の実装では各検査が成功し、変異挿入自体も成功したものだけを評価 |
| lint / 構文検査 / build | 成功 |
| 一時DBの終了処理 | 停止・一時データ削除を確認 |

変換方針を守るために残した具体的な差もある。TO_DATEは時刻付き入力でも同じ関数名を維持し、PostgreSQLの戻り値が日付だけになることを警告する。TO_CHARの既定数値書式も維持し、小数・桁数を警告する。DATEの型置換後の加算、NUMERICのIDENTITY、列の型を確定できないNVLなどには手動確認が必要。未対応のMERGE末尾句やLISTAGG、拡張が必要なSOUNDEXも警告する。

DB検証のうち6項目は、こうした制約について値の差や想定されるDBエラーと警告を確認したテストである。26項目成功という結果を、26種類のOracle SQLを完全に自動移行できたという意味で扱ってはいけない。Oracle側での比較実行、利用先のスキーマ/NLS/互換関数を使った検証は未実施。

本体は引き続き単一の[index.html](/Users/arita-ritsuki/Documents/ドキュメント/個人開発/sql-changer-oracle-to-postgresql/index.html)。実行時依存は追加していない。PostgreSQLと追加のChromiumは検証専用の一時ディレクトリに配置した。対象index.htmlのSHA-256は`5ec5744402001fb861f154819b613bc8ac9098a722d601a21691d92e2b534f05`で、DB記録と変更前後の記録がこの版に一致することを確認した。
