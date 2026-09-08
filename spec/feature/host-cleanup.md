# Host bootstrap と終了契約

`server/bootstrap-runtime.ts` の `bootstrapCorpus(): Promise<CorpusRuntime>` はlisten完了まで待ち、
env不備・project認証・plugin pack全体失敗・listen失敗をrejectでhostへ返す。
`server/index.ts` の `startCorpus()` は内部APIで、module評価後に起動する。直接実行用はbootstrap.ts。
bootstrap.tsの既存await importもstartupを待ち、runtimeをexportする。import利用時にsignalを登録しない。

`runtime.close()` は同じPromiseを返し、Corpus自身の資源を逆順で解放する。
health実行終了を待ってからDBを閉じる。一つのcloseが失敗しても残りを試行しAggregateErrorで報告する。
起動失敗時はCorpus資源のcleanup後に元エラーを返し、cleanup失敗時は両方を保持する。
CLIはSIGINT/SIGTERMで起動完了後にcloseし、終了失敗を非zero exit codeにする。
SIGKILL・OS強制終了では非同期cleanupを保証できない。

GLAB hostはCorpus起動失敗をcatchし、Cr共有client→storeの順で自身の資源を閉じる。
通常終了はまずCorpus runtime.closeで受付を止め、その後GLAB共有client→storeを閉じる。
CorpusはGLAB所有client/storeに直接触れず、個別plugin setup失敗の隔離方針も変えない。

配備にはCorpus変更の取込みとGLABのcorpus gitlink更新が必要。API追加だけでは稼働中サーバに反映されない。
テストコードは用意するが、本Sessionではテスト・起動・再起動を実行しない。
