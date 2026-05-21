/**
 * env-cli.config — Cernere env-cli (Infisical) が参照する secret 一覧。
 * `npm run env:setup` 等で使う想定 (Bibliotheca / Aedilis と同パターン)。
 */
export default {
  service: 'corpus',
  keys: [
    { key: 'CERNERE_BASE_URL', required: true },
    { key: 'CORPUS_PUBLIC_URL', required: true },
    { key: 'CORPUS_ADMIN_IDS', required: false },
    { key: 'CORPUS_PLUGIN_DIR', required: false },
    { key: 'CORPUS_REMOTE_URL', required: false },
  ],
};
