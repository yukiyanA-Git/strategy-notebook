# アプリ管理・保存・公開ガイドライン（GitHub & Firebase）

このドキュメントでは、作成したアプリを「パターン①：全体公開」と「パターン②：社内限定公開（Firebase Auth制限付き）」の2つに大別し、管理およびデプロイの手順を整理します。

---

## 1. アプリ仕分け一覧

| アプリ名 | パターン分類 | 優先度・ステータス | コード保存 (GitHub) | 公開方法 (Firebase) |
| :--- | :--- | :--- | :--- | :--- |
| **Chronos** (`calendar-scheduler`) | **パターン① (全体公開)** | **✅ 公開完了** | [GitHub Repository](https://github.com/yukiyanA-Git/chronos-app.git) | [Firebase Hosting URL](https://chronos-app-d149d.web.app) |
| **micro-chat** (`micro-office-chat`) | **パターン① (全体公開)** | **✅ 公開完了** | [GitHub Repository](https://github.com/yukiyanA-Git/micro-office-chat.git) | [Firebase Hosting URL](https://micro-office-chat-app.web.app) |
| **password-manager-app** (`LoginManager`) | **パターン① (全体公開)** | **✅ 保存・検証完了** | [GitHub Repository](https://github.com/yukiyanA-Git/login-manager.git) | Windows Desktop (.exe) / Firebase Sync |
| **device-controller-app** | **パターン① (全体公開)** | **一時保留 (ブラッシュアップ後実施)** | Public / Private | Firebase Hosting |
| **schedule-app** | **パターン① (全体公開)** | **一時保留 (ブラッシュアップ後実施)** | Public / Private | Firebase Hosting |
| **SubMonitorManager** | **パターン① (全体公開)** | **一時保留 (ブラッシュアップ後実施)** | Public / Private | Firebase Hosting |
| **shiftApp** (`shift_board_project`) | **パターン② (社内限定公開)** | **一時保留 (一時停止)** | Private | Firebase Hosting |

---

## 2. パターン①【全体公開モデル】の設定・運用フロー

不特定多数や一般ユーザーに広く公開するアプリの手順です。

### 2-1. GitHubへの保存
1. **GitHubでリポジトリを作成**（Public または Private）
2. **ローカルからPush**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <GitHubのURL>
   git push -u origin main
   ```

### 2-2. Firebase Hostingへの公開
1. **Firebaseコンソールでプロジェクト作成**
2. **ローカルでFirebase初期設定**
   ```bash
   firebase login
   firebase init hosting
   ```
   * Public directory: `dist` または `build` （ビルド出力フォルダ）
   * Configure as a single-page app: `Yes`
3. **ビルド & デプロイ**
   ```bash
   npm run build
   firebase deploy --only hosting
   ```

---

## 3. パターン②【社内限定公開モデル】の設定・運用フロー

会社の数人のみが利用する、低運用コストな安全アプリの手順です。

### 3-1. GitHubへの保存
* **重要**: **必ず Private リポジトリ（非公開）** として作成・管理します。社外へのコード漏洩を防止します。

### 3-2. 簡易アクセス制限 & 操作ログ（Audit Log）方式
面倒なユーザー個別登録や複雑なOAuthログインを排し、以下のハイブリッド方式で運用コストをゼロ化しています。

1. **初回パスワード（合言葉）＋ お名前入力・自動記憶**
   * 初回ログイン時に「共通の合言葉」と「お名前（識別名）」を入力。
   * 入力されたお名前はブラウザ（`localStorage`）に記憶され、**2回目以降は入力不要**で自動通過。
2. **改ざん不可の操作ログ（Audit Log）自動記録**
   * 主要な操作（データ保存、生成、変更等）時に、**【日時・入力者名・操作内容】** を Firebase Firestore およびローカルに自動保存。
   * ユーザー側での編集・削除は不可能な「閲覧専用（Read-only）」仕様。
3. **ログのテキスト（.txt）/ CSV出力機能**
   * 画面上の「📋 操作ログ」ボタンからいつでもログ履歴をモーダルで閲覧でき、ワンクリックで `.txt` や `.csv` ファイルとして出力可能。

---

## 4. サポート完了状況

* [x] `shiftApp` (`shift_board_project`) に初回名前自動記憶機能および改ざん不可の操作ログ（LOG）機能・テキスト/CSV出力機能を組み込み完了。
* [ ] 各アプリの GitHub / Firebase への順次保存・デプロイ作業

