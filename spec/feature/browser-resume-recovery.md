# Authenticated hub resume recovery

## SPEC-HUB-RESUME-001: retained document lifecycle

User scope: retained pages across LUDIARS must reload after stale keepalive/session state. This change implements the Corpus shell and exports a host adapter for consumers; GLab and other custom shells are not automatically covered.

The shell owns recovery listeners after authenticated rendering, disposing them before rerender/logout. History-cache restoration, a 60-second hidden interval, or a disconnected EventSource on return requests reload. Offline/hidden pages defer recovery; overlapping events reload once. Initial load and short healthy tab switches do not reload. The shared lifecycle policy is mirrored from Cernere e238819d9d0e, independent of Corpus's legacy pinned authentication SDK; no submodule upgrade is included.

Unsaved input/change events and disabled submission controls block automatic reload. A status notice offers explicit refresh, confirms draft loss and refuses refresh while a submission is pending. Form reset clears tracked edits; removed controls are pruned. Login never installs the adapter.

Acceptance: lifecycle tests from Cr plus Corpus tests for clean restore, listener disposal, draft retention/explicit discard, pending submission and saved reset. Real-browser suspension and deployed reflection are separate checks.
