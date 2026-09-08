# 宣言的レンダラの責務境界

描画契約の正本は `DESIGN.md` §13。本書はその実装配置を定義する。
製品固有の処理を持たず、PanelDescriptor と RenderContext からDOMを生成する。

## 公開入口と振り分け

`public/src/render/renderer.ts` の `renderPanel` は対象コンテナを空にし、タイトル、節、
component を順に描く。`dispatch.ts` は component の admin 条件を評価して種類別描画へ渡す。
`internal/render-child.ts` は子描画の注入型を定義する。部品は振り分けを逆importしない。

## 部品の描画

各パスの基準は `public/src/render/components/`。

| ファイル | 維持する振る舞い |
|---|---|
| `list.ts` | 一覧の取得・空状態・カード・行内編集と再読込 |
| `table.ts` | 列定義による表と行ごとの操作 |
| `form.ts` | 入力項目の配置・送信・結果表示 |
| `detail.ts` | 対象レコードの詳細表示 |
| `stat.ts` | 値の取得と統計表示 |
| `custom.ts` | descriptorで指定されたカスタム表示 |
| `text.ts` | 静的テキストの値とtoneに対応する表示 |
| `unresolved-ref.ts` | 未展開の共通UI参照をその位置でエラー表示し周囲の描画を継続 |
| `modal.ts` | dialogの生成・開閉・閉じた際の除去 |
| `layout.ts` | grid / stack の子配置とレスポンシブCSS変数 |
| `dock.ts` | dockviewの生成、レイアウト組立・保存復元・破棄 |
| `section.ts` | 見出しと子componentの順次描画 |
| `tabs.ts` | タブ選択と選択先の子描画。最初のタブを初期選択 |
| `action-button.ts` | 独立した操作部品と結果表示の配置 |

## 共通処理

各パスの基準は `public/src/render/internal/`。

- `dom.ts`: DOM要素と操作結果の表示要素を生成する。
- `template.ts`: レコードの値の参照、書式変換、テンプレートとパラメータの展開、配列の抽出。
- `actions.ts`: 操作の権限・確認、送信、結果、ボタンとtoggleの状態を扱う。
- `fields.ts`: フォーム入力の種類と選択肢、値の読取・設定を扱う。
- `pagination.ts`: ページ番号・件数のパラメータ、取得結果からの終端判定と移動UI。
  listとtableは同じ終端判定を用いる。

公開関数・descriptorの型・既存CSSクラスは維持する。この責務分割で新しい認証方式、
依存パッケージ、画面操作を導入しない。既存のrenderer関連テストは公開入口からの
互換性を確認する。レイアウトの実表示は実行環境の別検証を要する。
