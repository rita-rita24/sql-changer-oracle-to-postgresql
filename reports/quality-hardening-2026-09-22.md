# UIを追加しない品質改善の検証記録

対象: `sql-changer-oracle-to-postgresql.html` / 2026-09-22

作業開始時に存在した変更と、統合済みのHTMLを引き継いだ。画面のHTML要素・固定文言・ボタンは追加していない。CSSの変更は入力末尾の空行の位置合わせと、低い画面で確認事項を読める高さの確保だけである。

## 修正内容

| 対象 | 修正と効果 |
| --- | --- |
| 数値書式 | `TO_CHAR(1/2)`など、型が明示された算術式の小数を保持。コメント内の演算記号や未知の列型を数値と誤認しない |
| LPAD / SUBSTR | 数値の文字列化でOracleの先頭小数点表記を保持。LPADの数値引数・小数の長さ・空文字・指数表記の埋め文字を補正 |
| 数値TRUNC | PostgreSQLが受け付けない浮動小数点の2引数呼び出しを補正。小数の桁指定は整数部分を使用 |
| 不正日時 | 固定書式の24時・60分・60秒を正常な日時に丸めない。数字だけの日時も含め、TIMESTAMP型の実行エラーを維持 |
| 診断行 | SQLの前に複数行コメントがあっても、実際のSQL開始行を示す。CR・LF・CRLFを考慮 |
| IME | 未確定の日本語も入力側に表示し、空欄の案内を隠す。確定前の変換と古いWorker結果の反映を抑止 |
| コピー | 非同期コピーの失敗時、利用者が移動したフォーカス・選択位置を奪わない。同じ結果の再描画を省き、出力の選択を保持 |
| キーボード | Tab挿入を対応ブラウザーのUndo／Redo履歴へ記録。Ctrl・Command・Alt付きTabを横取りしない |
| 表示 | 入力の末尾が改行でもハイライトとスクロール位置がずれない。低い画面で確認事項が1行未満になる問題を修正 |
| 処理の復帰 | Worker通信エラーから同期処理へ復帰。処理中の状態をアクセシビリティ属性に反映し、画面離脱時にタイマーを片付ける |
| 連続入力 | 大きいSQLの連続inputイベントを集約し、最後の内容を反映。同一文字列のハイライトDOM更新を省く |
| 検証・配布 | 存在しない旧HTML名を参照していた起動・テスト・検証・配布処理を統一。実DB比較と配布の検証集合ハッシュの算出方式を統一 |

数値TRUNCの型・桁指定は[PostgreSQL 15の数学関数](https://www.postgresql.org/docs/15/functions-math.html)と[Oracle TRUNC](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/TRUNC-number.html)を確認した。不正な24時は[Oracle ORA-01850](https://docs.oracle.com/en/error-help/db/ora-01850/)と実DBで確認した。

## 検証結果

| 検査 | 最終結果 |
| --- | --- |
| 単体テスト | 202件成功、失敗・スキップなし |
| 追加回帰テスト | 15件。修正前HTMLでは15件失敗、修正後は全件成功 |
| ブラウザー | Chromium・Firefox・WebKit各62件、合計186件成功。失敗・スキップ・不安定判定なし |
| Oracle / PostgreSQL | 308ケース中、結果一致293件・既知の制約4件・不正入力の拒否11件。想定外の失敗なし |
| PostgreSQL単独 | 27件成功（修正26件、既知の制約1件） |
| 変異テスト | 限定した11変異をすべて検出 |
| 静的検査 | lint・JavaScript構文・差分の空白検査が成功 |
| 配布手順 | `npm run release` の全6工程が成功。配布HTMLと検証済みソースが同一 |

実DBはOracle 26ai Free 23.26.3／PostgreSQL 15.17。使い捨てコンテナの削除を確認し、専用Colima環境は作業前の停止状態へ戻した。

最終HTMLのSHA-256: `acf03ab69c9261a0546a6e4dea7df422be44771381b5317bd555909919d5d872`。

HTMLのbodyから処理用scriptを除いた構造は修正前と完全一致する。画面比較はPC 1280×800／スマートフォン390×844、ライト／ダーク、空欄／変換済みの8パターンで実施した。7パターンはピクセル完全一致。残る1パターンはボタン周辺27ピクセルでRGB各成分の差が最大1/255で、ラスタライズの微小差として記録した。全8パターンでボタンの名前・文言・表示状態は一致している。結果はUI比較JSONに記録している。低い画面の確認事項と末尾空行は意図した修正のため、専用のブラウザーテストで検証した。

## 検証の範囲と制約

実DB比較は人工データによる限定的な検査である。型・値・NULL・行数の一致、既知の制約の警告、不正入力の拒否を区別し、想定外の差を失敗とする。全Oracle SQLの変換成功率や本番移行の保証を表すものではない。

列型やNLS設定が不明な入力、未対応の日付書式、互換関数が必要な構文、PL/SQL、複雑なROWNUM、DDLのすべての式文脈には制約が残る。今回の日時の拒否補正は認識できる固定リテラル書式が対象である。詳細は[変換方針](../CONVERSION_POLICY.md)を参照。

大容量のE2Eは、一括貼り付け相当のinputイベントとWorker完了後の全文を検証した。Playwrightの`fill`はChromium／WebKitで改行ごとにネイティブ編集イベントを発生させ、空のtextareaでも6,500行で12,999イベント・約22秒かかった。このテストツール固有の入力時間を変換器の性能として扱わず、一括入力イベントで検証した。任意の端末・SQL量での応答時間は保証していない。

## 再実行と証跡

```sh
npm run test:unit
npm run test:e2e
npm run lint
npm run check:syntax
npm run test:mutation
SQL_CHANGER_DOCKER_CONTEXT=colima-sql-changer-validation npm run release
```

今回の一時ブラウザーを使う場合は `PLAYWRIGHT_BROWSERS_PATH=/tmp/sql-quality-20260922/browsers` を指定する。PostgreSQL単独検証はREADME記載の `SQL_CHANGER_PG_MODULE` を指定して `npm run test:postgres` を実行する。

- [集計・最終ソースハッシュ](quality-hardening-2026-09-22.json)
- [入力・変換SQL・両DBの実測値](quality-database-comparison-2026-09-22.json)
- [3ブラウザーの結果](quality-browser-qa-2026-09-22.json)
- [HTML・ボタン・画像の比較](quality-ui-preservation-2026-09-22.json)
- [PostgreSQL単独検証](quality-postgres-verification-2026-09-22.json)
