// Corpus 宣言的レンダリング — UI descriptor 型 (Corpus DESIGN.md §13)。
//
// このモジュールは描画先サービスに依存しない。 RenderContext (data 取得関数 +
// identity) だけを注入境界とする = §13.7「自己完結パッケージ」 の中核。

export type Requires = 'admin';

export interface ActionDescriptor {
  label: string;
  dataId: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  params?: Record<string, string>;
  body?: Record<string, string>;
  confirm?: string;
  success?: string;
  requires?: Requires;
  /** 'toggle' で on/off スイッチ。 既定は単発。 */
  kind?: 'toggle';
  /** kind='toggle' のとき現在値の束縛 (boolean)。 */
  state?: string;
}

export type FieldInput =
  | 'text' | 'textarea' | 'number' | 'select' | 'datetime' | 'date' | 'checkbox';

export interface FormField {
  name: string;
  label: string;
  input: FieldInput;
  required?: boolean;
  maxLength?: number;
  /** input='select' の静的選択肢 (data 不要の固定 enum 用)。 */
  options?: { label: string; value: string }[];
  /** input='select' のとき選択肢を引く data id (options の代替)。 */
  optionsSource?: string;
  /** 選択肢レスポンス内の配列パス。 */
  optionsPath?: string;
  optionLabel?: string;
  optionValue?: string;
  /** 選択中オプションのレコードから表示する詳細フィールド (optionsSource 時)。 */
  optionDetail?: { label: string; value: string }[];
}

export interface ListItemSpec {
  title: string;
  subtitle?: string;
  body?: string;
  meta?: string;
  actions?: ActionDescriptor[];
  /** item をインライン編集フォームに切り替えて更新する。 */
  edit?: {
    dataId: string;
    method: 'PUT' | 'PATCH';
    params?: Record<string, string>;
    success?: string;
    fields: FormField[];
  };
}

/** list / table のページネーション設定。 ctx.data の params 経由でサーバへ伝える。 */
export interface PaginationSpec {
  /** 1 ページの件数。 */
  pageSize: number;
  /** params の page key 名 (既定: 'page')。 _cp_<key>=N が ctx.data 経由でサーバ query に乗る。 */
  pageParam?: string;
  /** params の limit key 名 (既定: 'limit')。 省略時は送信しない。 */
  limitParam?: string;
  /** 1-based 開始 page (既定: 1)。 */
  startPage?: number;
  /** レスポンスから総件数を読むパス (例: 'meta.total')。 あれば total / 最終 page を表示。 */
  totalPath?: string;
  /** total が無い場合に「次ページが空なら最終」 判定 (既定: true)。 */
  stopWhenEmpty?: boolean;
}

export interface ListComponent {
  type: 'list';
  dataSource: string;
  itemsPath?: string;
  itemKey: string;
  empty?: string;
  requires?: Requires;
  item: ListItemSpec;
  pagination?: PaginationSpec;
}

export interface FormComponent {
  type: 'form';
  requires?: Requires;
  submit: { dataId: string; method: 'POST' | 'PATCH'; success?: string };
  fields: FormField[];
}

export interface DetailComponent {
  type: 'detail';
  dataSource: string;
  recordPath?: string;
  requires?: Requires;
  fields: { label: string; value: string }[];
}

export interface TableComponent {
  type: 'table';
  dataSource: string;
  itemsPath?: string;
  requires?: Requires;
  columns: { header: string; value: string }[];
  rowActions?: ActionDescriptor[];
  pagination?: PaginationSpec;
}

/**
 * Modal — trigger button を 1 つ持ち、 クリックで <dialog> を開いて
 * 内部 components を描画する。 confirm より複雑な分岐入力に用いる。
 */
export interface ModalComponent {
  type: 'modal';
  /** trigger button のラベル。 */
  label: string;
  /** modal 内の見出し (省略時はラベルを使う)。 */
  title?: string;
  requires?: Requires;
  /** trigger ボタンのスタイル指定 (既定: 'ghost')。 */
  variant?: 'primary' | 'ghost';
  /** modal 内部に描く子 component 群。 */
  components: ComponentDescriptor[];
}

export interface SectionComponent {
  type: 'section';
  title?: string;
  requires?: Requires;
  components: ComponentDescriptor[];
}

/**
 * Grid layouter — CSS Grid でレスポンシブな多列レイアウト。
 * スマホ (< 640px) と PC (>= 640px) で列数を切替.
 *
 * 業務 (descriptor) と並べ方 (layouter) を分離する設計の一環。 サービス側は
 * UI パーツ (list / form / table 等) だけ宣言し、 PC/スマホ向け配置は Corpus が担う.
 */
export interface GridComponent {
  type: 'grid';
  /** PC (>= 640px) 時の列数。 */
  columns: number;
  /** スマホ (< 640px) 時の列数 (既定 1)。 */
  mobileColumns?: number;
  /** セル間 gap (rem 単位、 既定 0.6)。 */
  gap?: number;
  requires?: Requires;
  components: ComponentDescriptor[];
}

/**
 * Stack layouter — flex で 1 軸に並べる. スマホで自動的に縦並びへ反転 (responsive=既定 true)。
 */
export interface StackComponent {
  type: 'stack';
  /** PC 時の並び方向 (既定 'row')。 */
  direction?: 'row' | 'column';
  /** スマホで自動的に縦並び (= column) へ反転するか (既定 true)。 */
  responsive?: boolean;
  /** wrap 可能か (既定 true)。 */
  wrap?: boolean;
  /** gap (rem、 既定 0.6)。 */
  gap?: number;
  requires?: Requires;
  components: ComponentDescriptor[];
}

export interface TabsComponent {
  type: 'tabs';
  requires?: Requires;
  tabs: { label: string; components: ComponentDescriptor[] }[];
}

export interface StatComponent {
  type: 'stat';
  label: string;
  dataSource: string;
  itemsPath?: string;
  /** 省略時は dataSource 配列の件数。 */
  value?: string;
  requires?: Requires;
}

export interface ActionButtonComponent {
  type: 'action-button';
  label: string;
  requires?: Requires;
  action: ActionDescriptor;
}

export interface CustomComponent {
  type: 'custom';
  tag: string;
  url: string;
  requires?: Requires;
}

export type ComponentDescriptor =
  | ListComponent
  | FormComponent
  | DetailComponent
  | TableComponent
  | SectionComponent
  | GridComponent
  | StackComponent
  | TabsComponent
  | StatComponent
  | ActionButtonComponent
  | ModalComponent
  | CustomComponent;

export interface SectionDescriptor {
  title?: string;
  components: ComponentDescriptor[];
}

export interface PanelDescriptor {
  descriptorVersion: 1;
  title: string;
  sections: SectionDescriptor[];
}

/** レンダラの実行コンテキスト — 描画先サービスに依存しない注入境界。 */
export interface RenderContext {
  identity: { userId: string; displayName: string | null; isAdmin: boolean };
  /**
   * manifest data id を叩く。 params は path の :param 埋め、 body は POST/PATCH 用。
   * 実装は統合側 (app.ts) が `/api/hub/data/<svc>/<dataId>` に橋渡しする。
   */
  data(
    dataId: string,
    opts?: { method?: string; params?: Record<string, string>; body?: unknown },
  ): Promise<Response>;
}
