# Duo Trainer

日本語例文を見て英文を入力する、バックエンドなしの暗記用PWAです。

## 使い方

`index.html` をブラウザで開くと動きます。iPhone/iPadでホーム画面追加やオフライン利用を安定させる場合は、GitHub Pagesなどの静的ホスティングにこのフォルダを置いてください。

DUO 3.0の本文は同梱していません。ご自身で用意した学習用データをCSV/TSVで取り込むか、画面から追加してください。

## CSV/TSV形式

必須列は `ja` と `en` です。

```csv
ja,en,section,tags
私は毎朝英語を音読します。,I read English aloud every morning.,Section 1,習慣|基礎
彼女は約束を守った。,She kept her promise.,Section 1,重要
```

## 学習ロジック

回答後に `Again / Hard / Good / Easy` を選ぶと、SM-2系の間隔反復で次回出題日を更新します。間違えた例文は短い間隔で再出題されやすくなります。

## 保存

データはブラウザの端末内ストレージに保存されます。別端末へ移す場合は、JSON書き出しと読み込みを使ってください。
