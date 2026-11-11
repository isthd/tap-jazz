# Tap Jazz

**公開サイト：https://isthd.github.io/tap-jazz/** （一度開けばオフラインでも動きます。スマホはホーム画面に追加可能）

画面をタップしていくだけで、ベース、ドラム、ギター、パーカッション、ピアノが一人ずつ加わり、やがてバンドが勝手にセッションを始める Web アプリ。仕様は [SPEC.md](SPEC.md)、実装上の判断は [docs/DECISIONS.md](docs/DECISIONS.md)。

## 動かし方

```bash
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開く。本番用ビルドは `npm run build`（`dist/` を静的ホスティングにそのまま置ける）。

`main` ブランチにプッシュすると GitHub Actions がビルドして GitHub Pages に公開します（`.github/workflows/deploy.yml`）。

## 遊び方

| 操作 | 動作 |
|---|---|
| タップ / クリック / スペース | 一音鳴らす（4・8・12・16・20 回目でパートが加わり、28 回でセッション開始） |
| 長押し / Shift+スペース | 次のスタイルへ（Swing → Bossa Nova → Neo Soul） |
| 右上のメニュー | テンポ、キー、録音（WAV 保存）、リンクで共有、ミュート、リセット |

30 秒タップしないとバンドは曲を締めくくって休憩し、もう一度タップすると次の曲が始まる。

## 開発用

- `?debug=1` … 熱量・コード・フォーム位置・各奏者の状態を表示。ピアノのサンプル／合成の切り替え、同じシードで再読込。
- `?seed=12345` … 乱数のシードを固定（同じタップなら同じ演奏）。
- `?style=swing|bossa|neosoul` … 最初のスタイルを指定。

## 構成

```
src/
  audio/    engine.ts（初期化・再生）, samplers.ts（サンプラー・段階読み込み）, dsp.ts（楽器の合成）, mix.ts（ミキサー・リバーブ・アンビエンス）, recorder.ts
  music/    conductor.ts（時計・構成・熱量・タップの音）, form.ts（進行・リハーモナイズ）, theory.ts（コード・スケール・ボイシング）,
            humanizer.ts, listener.ts（タップ解析・モチーフ抽出）, players/（各奏者）, styles/（3 スタイル）
  visual/   scene.ts, effects.ts
  input/    tap.ts
  ui/       menu.ts, share.ts, debug.ts
```
