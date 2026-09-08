---
task: glab-consume-bootstrap-cleanup
project: GLAB
kind: 実装
created: 2026-09-09
memory_links:
  - spec/feature/host-cleanup.md
  - GLAB:server.ts
---
# Corpus終了契約のGLAB取り込み

Corpusの本変更がマージされた後、そのマージ済みcommitへGLABのcorpus gitlinkを更新する。
未マージfeature commitやsibling path依存を配備の正本にしない。

GLAB server.tsからbootstrap-runtime.tsのbootstrapCorpus()を呼び、返るruntimeをhostが保持する。
signal受信時はGLAB store初期化とCorpus起動の完了・失敗を待ち、runtime.closeを先に呼ぶ。
Corpus close失敗でもCr共有client、全storeのcloseを継続する。同時signal、起動失敗、close失敗の
全経路でcleanupを一度だけ実行し、元の起動エラーを保持する。個別pluginの隔離失敗は全体終了にしない。

実装済みの旧await importも依存更新後は起動失敗をcatchできるが、通常signalでruntime.closeを
呼ぶGLAB host接続はこのtaskで行う。更新前の稼働版へ修正済みとは報告しない。
動作確認は明示指示後、本体フォルダ/Excubitor/Concordia claim-release/TestWorkflow記録で行う。
