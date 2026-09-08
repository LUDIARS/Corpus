# Bootstrap失敗が埋込みhostへ伝播しない

- 原因: index.tsの直接process.exit(1)が5箇所。bootstrap.tsとindex.tsがvoid main()で
  起動Promiseを切り離すため、GLABのawait import/catchを通らない。
- 対応: bootstrapCorpus/startCorpus API、awaitする互換entrypoint、逆順・単一実行cleanup、
  listen失敗のPromise化。standaloneだけsignalを所有し、埋込み時はhostが所有する。
- 資源: Corpus DB、認証timer/client、HMR timer、discovery timer、HTTP接続、health loop、
  bootstrapのVestigium。初期化失敗とclose失敗の両方を保持する。
- 検査: 変更/追加TypeScript10ファイルのstrict/noEmit診断0。既存Corpus本体のnode_modules/libと
  既存Node22型をread-only参照した静的検査であり、clean install全体buildや動作テストではない。
  git diff --check成功。テストコードは追加したが実行していない。
- 未実施: テスト、起動、再起動、配備、merge、main更新。SIGKILL/OS強制終了のcleanup保証は対象外。
- 引継ぎ: 本変更のマージ後、GLABのcorpus gitlink更新と通常終了runtime.close接続が必要。
  `spec/tasks/2026-09-09-glab-consume-bootstrap-cleanup.md`に条件を保存した。
- 作業環境: 専用worktreeのGit所有者相違を確認し、この絶対パスだけsafe.directoryへ登録。
  共有Corpus checkoutの既存差分には触れていない。
