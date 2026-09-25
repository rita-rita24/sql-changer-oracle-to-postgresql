# UIを追加しない境界条件の品質改善

対象: `sql-changer-oracle-to-postgresql.html` / 2026-09-23

既存の作業途中の変更を引き継ぎ、画面のHTML・CSS・固定文言・ボタンを増やさずに改善した。単一HTML・オフライン動作・SQLを外部送信または永続保存しない構成を維持している。

## 改善内容

| 対象 | 修正と効果 |
| --- | --- |
| DECODE | 文字列・日付の型付きNULLも一致判定する。TRIM等で空文字になる検索式をNULLへ補正 |
| 小数の文字列化 | NVL/NVL2/DECODEの戻り値や連結でも、`.5`・`-.5`というOracleの表記を保持 |
| 数値関数 | 型が明示されたTRUNC・ROUND・ABS・MOD・POWER等の結果を数値として扱い、TO_CHARで小数を落とさない |
| 日付の差 | Oracle DATE同士の差を数値の日数へ補正。型が不明な列とTIMESTAMP同士の差は対象外 |
| 連結と算術 | 型が明示された数値・文字列・NULLの連結を補正。`'2'\|\|3+4`をOracleと同じ数値27にする |
| 大量入力 | 同一文の変換を1回の呼び出し内で再利用。128件・入力16,000文字/件・出力64,000文字/件に制限し、入力を呼び出し間でキャッシュしない |
| 診断位置 | 再利用した文でも全件の文番号・行番号を保持。複数行の埋め込みSQL文字列の後も元の行番号を保持 |
| コピー待機 | 編集・クリア・画面離脱後に古いコピー待機を解放し、新しい結果をすぐコピーできる |
| 選択範囲 | コピー拒否までの間に選び直した出力を上書きしない。代替コピー成功時は元の選択範囲と選択方向を復元 |
| 日本語入力 | 入力途中も既存の行数・状態を更新。クリア後に変換待ちや処理中の属性が残る問題を解消 |
| 配布 | 新しい37件のDBケースを既定検証に追加。検証記録を更新・同梱し、旧名の生成HTMLが残らないようにする |

DECODEのNULL一致は[Oracle公式仕様](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/DECODE.html)を確認し、PostgreSQLではNULLを考慮した比較を利用した。算術と連結の順序は[Oracleの演算子優先順位](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/About-SQL-Operators.html)を確認した。いずれも下記の実DB比較で結果を確認している。

## 検証結果

| 検査 | 結果 |
| --- | --- |
| 単体テスト | 219件成功、失敗・スキップなし |
| 今回の回帰テスト | 17件。修正前では全件失敗、修正後では全件成功 |
| ブラウザー | Chromium・Firefox・WebKit各68件、計204件成功 |
| Oracle / PostgreSQL | 345ケース。結果一致330件・既知の制約4件・不正入力の拒否11件 |
| PostgreSQL単独 | 27件成功（修正26件・既知の制約1件） |
| 改善の実測 | 修正前で結果が違っていた29ケースが修正後は一致。ほかのケースも維持 |
| 変異テスト | 限定した11変異をすべて検出 |
| 静的検査 | lint・JavaScript構文・差分の空白検査が成功 |
| 配布工程 | `npm run release` の全6工程が成功。配布HTMLと検証済みソースが同一 |

DBは使い捨てのOracle 26ai Free 23.26.3とPostgreSQL 15.17を使用。数値・文字列・NULL・行数を区別して比較した。夏時間切替をまたぐ日付差も含む。既存DBへ接続していない。検証用コンテナの削除も確認した。

追加ケースは `tests/fixtures/boundary-database-cases.mjs`、追加回帰テストは `tests/unit/boundary-quality.test.mjs` と `tests/e2e/boundary-quality.spec.mjs` にある。両DBの入力・変換SQL・実測値は `reports/database-comparison-latest.json` に記録し、配布版では `database-comparison.json` に同梱する。配布工程の結果は配布版の `validation.json` に記録する。

## 画面と性能

HTMLのhead全体（CSS・テーマ初期化を含む）とbody内の画面構造は変更前と完全一致する。PC 1280×800とスマートフォン390×844、ライト／ダーク、空欄／変換済みの8パターンで、ボタンの文言・名前・表示状態が一致。画像は7パターンがピクセル完全一致、残る1パターンは3ピクセルのRGB各成分に最大1/255の差だけだった。[画面比較記録](boundary-ui-preservation-2026-09-23.json)

同じ環境で変換器を各1回測定した参考値:

| 入力 | 修正前 | 修正後 | 出力・警告・診断 |
| --- | ---: | ---: | --- |
| 同じSQL 6,500文・195,000文字 | 2,188.60 ms | 211.73 ms | 完全一致 |
| 異なるSQL 1,500文・48,389文字 | 393.40 ms | 362.12 ms | 完全一致 |

反復SQLでは約10.3倍の改善を確認した。ブラウザーの描画や入力時間を含まない1回の測定であり、任意のSQL・端末での速度を保証する値ではない。

## 制約と再実行

任意のOracle SQLの完全自動移行を保証するものではない。型が不明な列、NLS依存の書式、互換関数が必要な構文、複雑なROWNUM、PL/SQL、DDLのすべての式文脈には既存の制約がある。数値演算の精度・丸め、浮動小数点の扱いも実データに合わせて検証する必要がある。

コピー待機の解放は画面側の状態管理であり、ブラウザーへ渡したクリップボード書き込み自体を取り消すAPIではない。既存の失敗表示・コピーの代替処理を使い、新しい案内やボタンは追加していない。

```sh
npm run test:unit
npm run test:e2e
npm run lint
npm run check:syntax
npm run test:mutation
SQL_CHANGER_DOCKER_CONTEXT=colima-sql-changer-validation npm run release
```

今回のブラウザー実行ファイルは `PLAYWRIGHT_BROWSERS_PATH=/tmp/sql-quality-20260922/browsers` を指定して利用した。再利用できない環境ではREADMEのブラウザーインストール手順を使う。

最終HTMLのSHA-256: `55f0dea94391b313cc280569e4567f32b5f0778f4c539be00957db78905e546c`。
