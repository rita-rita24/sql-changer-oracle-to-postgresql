# 配布前検証 2026-09-11（0.2.0）

Oracleとの比較を実施し、変換方針を維持した配布版を作成した。

| 検証 | 結果 |
| --- | --- |
| 実機 | Oracle AI Database 26ai Free 23.26.3.0.0 / PostgreSQL 15.17 |
| 両DB比較 | 179件実行。164件の値・型・更新結果が一致、15件は既定方針による差・手動対応を確認。予期しない不一致0件 |
| 既存方針 | 代表20例のSQL出力を完全一致で維持 |
| 単体テスト | 99件成功（上記の方針テストを含む） |
| ブラウザー | Chromium / Firefox / WebKit、計54件成功 |
| その他 | 構文・HTML検査成功、限定した変異6件すべて検出 |
| 後始末 | 比較用コンテナ・データ削除済み |

## 実測で見つかった不一致と修正

最初の164件では15件が不一致だった。空文字を返すNVL/NVL2/DECODEと、空文字・範囲外のSUBSTRがOracleのNULLを再現していなかった。修正後に型の混在8ケースを追加すると、7件で暗黙変換・戻り値型の不一致を検出した。明示された型に必要なCASTを追加し、この22件を解消した。さらにLPADの空文字・非正長、数値のSUBSTR、書式付きTO_NUMBERの数値引数、および列値SUBSTRの既知差を加え、最終179件で検証した。

修正は従来のCOALESCE/CASE、SUBSTR/RIGHTなどの方式の中で行い、既定の変換方針20例を変更していない。

## 方針上残る15ケース

15件を「変換成功」とは数えていない。各ケースについてOracleの元SQLが成功すること、PostgreSQL側の予想した差・エラー、および画面に表示する警告の存在を検査した。

- `policy-to-char-decimal`: 従来のFM999999999補完。
- `policy-to-date-time`: TO_DATE維持に伴う時刻消失。
- `policy-rr-century`: RR→YYの世紀差（現在年2000–2049で検証）。
- `policy-date-arithmetic`: DATE→TIMESTAMP方針で日数加算は要対応。
- `policy-null-concat`: 連結式保持のNULL差。
- `policy-identity`: NUMBER→NUMERIC方針ではIDENTITY非対応。
- `policy-unknown-type`: 既存の列名による型推定。
- `policy-substr-column-forward`: 列のSUBSTR維持による範囲外NULLの差。
- `policy-substr-column-backward`: 既存のRIGHT変換による範囲外NULLの差。
- `manual-aggregate-rownum`: 集計のROWNUMは手動変換。
- `helper-add-months`: 互換関数の導入が必要。
- `helper-months-between`: 互換関数の導入が必要。
- `helper-last-day`: 互換関数の導入が必要。
- `helper-instr`: 互換関数の導入が必要。
- `helper-trunc-date`: 互換関数の導入が必要。

## 配布品質の改善

- 要確認・入力エラーを変換結果の状態として表示し、確認項目に文番号と開始行を付けた。
- 外部フォント依存を削除し、CSPで通信を抑止。単一HTMLをfile:で開いた際の通信なしの変換を3ブラウザーで検証した。
- コピー失敗を成功表示していた処理を修正し、手動コピーに移れるようにした。
- `npm run release`に両DB比較を必須化。DB未起動・予期しない差・警告漏れで失敗し、古いソース/テスト集合の比較結果を配布に使えないようにした。
- 使い捨てDB、固定イメージのダイジェスト、再実行手順、比較ログ、配布HTMLのSHA-256を用意した。

## 適用範囲

人工データで選定したケースの実測結果であり、実務SQL全体の精度を表す百分率ではない。Oracle 19c等の別バージョン、未提供のスキーマ/NLS、任意のPL/SQL・互換関数の実装は検証範囲外。型が未知の列は既存の推定を維持するため、警告を確認して移行先で検証する。

`reports/database-comparison-before-2026-09-11.json`に初回結果、`reports/database-comparison-intermediate-2026-09-11.json`に型追加時の結果、`reports/database-comparison-latest.json`に最終SQL・両DBの値・型・エラーと期待差を記録した。

配布HTML SHA-256: `5c1371f6d45c1479fa692b772a98c75013573e9bd3d57350b89683758edb9dd5`
