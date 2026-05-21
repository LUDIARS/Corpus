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
  /** item をインライン編集フォームに切り替えて PATCH する。 */
  edit?: {
    dataId: string;
    method: 'PATCH';
    params?: Record<string, string>;
    success?: string;
    fields: FormField[];
  };
}

export interface ListComponent {
  type: 'list';
  dataSource: string;
  itemsPath?: string;
  itemKey: string;
  empty?: string;
  requires?: Requires;
  item: ListItemSpec;
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
}

export interface SectionComponent {
  type: 'section';
  title?: string;
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
  | TabsComponent
  | StatComponent
  | ActionButtonComponent
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
