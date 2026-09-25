# コピー側HTMLの品質改善・QA結果

対象: `index-business-ui.html` / 検証日: 2026-09-22

無条件に「有料の完全自動移行ツールとして販売できる品質」とは判定しない。文字列や識別子を壊す不具合を修正し、コピー側HTMLを継続検査できるようにした。一方、既存の変換方針による意味差、互換関数の必要性、スキーマ・NLS情報なしでは判断できない型の問題が残る。実務SQL全体への正確性を保証した結果ではない。

## 修正した内部処理

| 問題 | 修正内容 |
| --- | --- |
| ホスト言語のSQL文字列にある `$&`、`$$` 等が置換指示として解釈される | 復元をコールバックによる一度の置換に変更し、文字列データとして保持 |
| `enable`、`byte`、`nocache` 等の列名まで消える | 削除対象を認識できたDDLのオプション領域・制約末尾に限定 |
| `日本NUMBER`、`日付DATE` 等の識別子の一部分を変換する | Unicode文字・結合文字・補助平面文字を考慮して識別子の境界を判定 |
| `İ` の小文字化で文字位置がずれ、その後の関数を変換できない | 元の文字列上の位置を維持して関数名を検索。TRIMの専用処理も修正 |
| `a$tag$` をドル引用の開始と誤認する | 識別子内のドル記号とドル引用を区別。日本語の引用タグも保持 |
| 入れ子のブロックコメントの後半をSQLとして書き換える | 変換・構文検査・ハイライトの引用符／コメント判定を共通化 |
| CR改行の行コメントが後続SQLまで飲み込む | CR・LF・CRLFで行コメントを終了 |
| 改行を一括変換して文字列値の改行まで変更する | 入力の改行をそのまま扱い、診断の行数計算も各改行形式に対応 |
| STORAGE内コメントにある `)` で削除範囲が途切れる | 括弧の対応を解析し、コメントを保持しながら削除 |
| `VARCHAR2(10 CHAR)` が無効な `VARCHAR(10 CHAR)` になる | 型の長さ指定にあるCHAR/BYTE修飾子を正規化 |
| コピー拒否後、Selectionが使えないと未処理の例外になる | フォールバック全体を例外処理し、既存の失敗表示を使用 |
| クリア復元で逆方向の選択が失われる | 選択範囲と選択方向をまとめて復元 |
| 一度変換例外が発生すると同じ入力を再試行できない | 失敗時に変換済みキャッシュを無効化 |

## 検証結果

| 検査 | 結果 |
| --- | --- |
| コピー側HTMLの単体テスト | 137件成功、0件失敗 |
| 今回追加した単体回帰テスト | 38件成功。修正前HTMLでは同じ38件中25件失敗 |
| 元HTMLの既存検査＋コピー側の追加回帰テスト | 137件成功 |
| ブラウザー操作 | Chromium・Firefox・WebKitで各12件、計36件成功。スキップなし |
| 実DB比較 | 185ケース: 結果一致170件、既知の方針上の制約15件、想定外の失敗0件 |
| 静的検査 | コピー側HTMLの構文・静的lint成功、差分の空白検査成功 |
| UI維持 | メイン処理のscript以外のHTML・CSS・テーマ処理が修正前と一致。日本語文言も一致 |
| 画面比較 | PC/スマートフォン × ライト/ダーク × 空欄/変換済みの8パターンでPNGが完全一致 |

38件はテストの数であり、独立した不具合の数ではない。回帰テストには、コピーの二重実行・編集中の非同期完了・画面離脱・失敗表示・タイマーと、30通りの引用／コメント内データ保持を含む。実ブラウザーでは単一HTMLをfile URLで開き、外部HTTP通信なし、ページ例外なし、既存ボタンの高さ30pxを確認した。元の `index.html` はこの作業開始時から変更していない。

実DBは使い捨てのOracle AI Database 26ai Free 23.26.3とPostgreSQL 15.17を使用した。今回の6追加ケースでも、予約されていないキーワードを使った列名、日本語の識別子、Unicode文字後の関数、ドル記号を含む識別子、文字数修飾子、コメント付きSTORAGEを検証した。検証用コンテナは削除し、起動した専用VMは停止した。

簡易性能測定はNode 22.22.2 / macOS arm64の同一プロセスで3回ずつ実施した。単純なNVL文1,000件（31,000文字）の中央値101ms、10,000件（310,000文字）は951ms。変換関数のみの測定で、全構文・端末での応答時間やブラウザーの描画時間を保証しない。

## 残る制約と販売品質の判定

既存方針の15ケースには、TO_DATEによる時刻消失、TO_CHAR既定書式の小数差、RRとYYの世紀差、日付加算、NULL連結、NUMERICのIDENTITY非対応、未知の列型推定、列値に対するSUBSTR、集計とROWNUM、互換関数未導入時の実行エラーが含まれる。今回は既存方針と画面文言を維持し、これらのケースでは警告が出ることも検証した。

対応範囲を限定した移行補助ツールとしての信頼性は改善した。しかし、185ケースは合成データによる限定的な検査であり、任意のSQLの自動変換成功率ではない。販売可否を確定するには、対応SQL・Oracle版・文字コード・NLS・スキーマ条件を定義し、実際の利用対象SQLで意味・型・行数の一致を受け入れ検査する必要がある。未対応構文を完全に検出するSQLパーサーやスキーマに基づく型解析は、このHTMLには実装していない。

## 再実行

リポジトリのルートで実行する。

```sh
npm run test:business
SQL_CHANGER_HTML=index-business-ui.html npm run check:syntax
SQL_CHANGER_HTML=index-business-ui.html npm run lint
npx playwright test tests/e2e/business-quality.spec.mjs
```

ブラウザーテストにはPlaywrightの対応ブラウザーが必要。今回は既にあるChromium・Firefox・WebKitの実行ファイルを、一時設定で明示して実行した。

実DB検証はREADME記載の専用Colimaプロファイル起動後に実行する。

```sh
SQL_CHANGER_HTML=index-business-ui.html \
SQL_CHANGER_DATABASE_CASES=tests/fixtures/business-database-cases.mjs \
SQL_CHANGER_DOCKER_CONTEXT=colima-sql-changer-validation \
SQL_CHANGER_COMPARISON_REPORT=reports/business-database-comparison-2026-09-22.json \
npm run test:databases
```

対象HTMLのSHA-256: `727f82c4ead06b285511c32a53669edc053086d18241207198e0fb09627ffe96`

検証データ: [集計](business-quality-2026-09-22.json)、[実DB結果](business-database-comparison-2026-09-22.json)、[ブラウザー結果](business-browser-qa-2026-09-22.json)、[UI一致の証跡](business-ui-preservation-2026-09-22.json)。Node標準のカバレッジ割合を変換精度としては使用していない。

字句規則の確認には、識別子内のドル記号・非ASCII文字・ドル引用・入れ子コメントについて[PostgreSQL 15の字句構造](https://www.postgresql.org/docs/15/sql-syntax-lexical.html)、識別子に使える文字と非予約キーワードについて[Oracleのオブジェクト命名規則](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/Database-Object-Names-and-Qualifiers.html)を参照した。
