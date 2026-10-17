/** Compatibility types for the exported legacy ticket client, not the mounted login UI. */
export interface MachineInfo {
  os: string;
  platform: string;
  arch?: string;
  screen: string;
  timezone: string;
  language: string;
}

export interface BrowserInfo {
  ua: string;
  vendor: string;
  browser: string;
  version: string;
}

export interface DeviceFingerprint {
  machine: MachineInfo;
  browser: BrowserInfo;
}

export type DeviceAnomaly =
  | "new_device"
  | "new_os"
  | "new_browser"
  | "new_ip"
  | "missing_fingerprint";

export interface CompositeAuthResponse {
  authCode?: string;
  mfaRequired?: boolean;
  mfaMethods?: string[];
  mfaToken?: string;
  /** 本人確認 (デバイス検証) が必要 */
  deviceVerificationRequired?: boolean;
  deviceToken?: string;
  /** 確認コード送信先のマスクされたメール (例: u***@example.com) */
  emailMasked?: string;
  /** 検出された差分の一覧 */
  anomalies?: DeviceAnomaly[];
  /** 確認コードの送信チャネル */
  codeChannel?: "email" | "console";
  /** デバイスラベル (例: "macOS · Chrome 124 · Tokyo, JP") */
  deviceLabel?: string;
  /** 残り試行回数 (失敗応答時) */
  remainingAttempts?: number;
  error?: string;
}

export interface CompositeAuthApi {
  /** Email / パスワードでログイン (device は本人確認用フィンガープリント) */
  login(params: { email: string; password: string; device?: DeviceFingerprint }): Promise<CompositeAuthResponse>;
  /** 新規ユーザー登録 */
  register(params: { name: string; email: string; password: string; device?: DeviceFingerprint }): Promise<CompositeAuthResponse>;
  /** MFA チャレンジ応答 (任意) */
  mfaVerify?(params: { mfaToken: string; method: string; code: string; device?: DeviceFingerprint }): Promise<CompositeAuthResponse>;
  /** デバイス本人確認: 確認コードを検証し authCode を取得する */
  deviceVerify?(params: { deviceToken: string; code: string }): Promise<CompositeAuthResponse>;
  /** 確認コードを再送する */
  deviceResend?(params: { deviceToken: string }): Promise<CompositeAuthResponse>;
}
