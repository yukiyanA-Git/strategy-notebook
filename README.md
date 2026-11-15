# STRATEGYNOTE (ストラテジーノート)

> **ゲーマー＆クリエイター向け デジタル攻略ノート＆マニュアル Web/PWA アプリケーション**

Webサイトや攻略情報のクリップ画像を貼り付け、サブモニターに常駐させながら本のようにページをめくって閲覧・編集できるリアルタイム攻略ノートツールです。PC（見開き2ページ表示/編集）とスマートフォン（1ページ全画面閲覧専用）の両方に最適化されたハイブリッドUIを提供します。

---

## 🌟 主な機能

- **見開き・単一ページ表示（レスポンシブ）**
  - **PC環境**: 本物のノートのような見開き2ページ表示、拡大縮小、全画面表示。
  - **スマートフォン環境**: 画面幅（100vw）をフル活用した1ページ閲覧専用モード。
- **ドラッグ＆ドロップ ＆ 画像クリップ貼り付け**
  - スクリーンショットや攻略チャート画像を直感的に配置。
- **ブロックシステム**
  - メモブロック（note: リッチテキスト・HTML・等幅マクロ `<pre>` 表示対応）
  - 見出しタグ（tag: ボス・フェーズ・メモ用バッジ）
  - 外部リンクボタン（link）
- **クラウド同期（Firebase Realtime Database & Auth）**
  - Googleアカウント認証により、複数デバイス間でノート・ページ・設定をリアルタイム同期。
- **リアルタイム配信・同期閲覧（ライブ連動）**
  - ルームコードによるホスト／ビューアー間のページ同期機能。
- **PWA (Progressive Web App) 対応**
  - デスクトップアプリ感覚でインストール・起動可能。オフラインキャッシュ対応。
- **豊富なテーマ切り替え**
  - ゲーマーダーク、サイバーネオン、ミニマルペーパーなど多彩なテーマ。

---

## 📁 ディレクトリ・ファイル構成

```
strategy-notebook/
├── index.html            # アプリケーションメインHTML
├── styles.css            # スタイルシート（見開き・レスポンシブ・テーマ定義）
├── app.js               # アプリケーションロジック・イベントハンドラ・UI制御
├── storage.js            # ローカルIndexedDB / クラウドデータ同期管理
├── firebase-config.js    # Firebase 接続設定 (strategy-notebook)
├── manifest.json         # PWA マニフェスト設定
├── database.rules.json   # Firebase Realtime Database セキュリティルール
├── firebase.json         # Firebase Hosting / Database デプロイ設定
├── .firebaserc           # Firebase プロジェクト定義
├── assets/               # アプリアイコン・画像アセット
│   ├── icon-192.png      # 192x192 アイコン
│   ├── icon-512.png      # 512x512 マスターアイコン
│   └── app_icon.jpg      # アプリアイコン原画
└── COMPLETE_ARCHIVE.md   # プロジェクト開発経緯・全仕様アーカイブ
```

---

## 🛠 技術スタック

- **フロントエンド**: HTML5, CSS3, Vanilla JavaScript (ES6+)
- **アイコン**: FontAwesome 6, Google Fonts (Inter, Fira Code, Noto Sans JP)
- **バックエンド / インフラ**: 
  - Firebase Authentication（Google ログイン）
  - Firebase Realtime Database（ノート・ページ・ライブ同期）
  - Firebase Hosting（Webホスティング）
- **プラットフォーム**: Webブラウザ / PWA (Windows, macOS, iOS, Android)

---

## 🚀 開発・動作確認

静的Webサーバー（VS Code Live Server、Python http.server、または Firebase Hosting）で `index.html` を開くだけで動作します。

```bash
# ローカルサーバー起動例
python -m http.server 8080
# ブラウザで http://localhost:8080 を開く
```

---

## ☁️ Firebase デプロイ運用（ターゲット分離）

本リポジトリは誤デプロイ防止のため、プロジェクトエイリアスによるターゲット分離が施されています。

- **RTDB セキュリティルール (`database.rules.json`) のデプロイ先**:
  - 対象: `strategy-notebook`（アプリ本体のデータベース・認証コア）
  - コマンド:
    ```bash
    firebase deploy --only database
    ```
- **Web Hosting (`strategy-notebook-app`) のデプロイ先**:
  - 対象: `chronos-app-d149d`（ホスティング基盤）
  - コマンド:
    ```bash
    firebase deploy --only hosting -P hosting
    ```

---

## 📄 ライセンス

Copyright (c) 2026 yukiyanArt / STRATEGYNOTE All Rights Reserved.
