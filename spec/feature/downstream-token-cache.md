# Downstream token issuance lifetime

Actio: a59a46f8-c919-4966-838f-81bcf075125c. Implements the existing GLAB
`spec/plan/2026-09-08-corpus-token-cache-contract.md` contract within Corpus.

The hub-federation boundary owns process-local tokens and pending issuance.
No secrets or fingerprints are persisted. Keys retain the incoming-token fingerprint,
project key and audience with trailing slashes removed. Concurrent callers for one
key share issuance; other keys remain independent. Pending promises are removed
on all settlement paths, so failed requests can retry.

The lifetime policy removes entries at expiry minus 30 seconds on get/set. Capacity
is 1024, evicting earliest expiry after removing expired entries. There is no timer.
The provider accepts an injected clock. Issuance uses a 10-second AbortSignal timeout
covering fetch and response-body consumption. Empty tokens and nonpositive/nonfinite
TTL values return the existing explicit unavailable result (`null`), never a cached
credential. Callers must retain their existing fail-closed treatment of null.

Ownership: tokens.ts handles issuance/in-flight state; token-cache.ts handles expiry
and capacity. Existing hub-federation membership covers both source and colocated
tests. No route, plugin, database or GLAB submodule changes.

Verification: token-cache.test.ts and tokens-concurrency.test.ts cover the safety
boundary, capacity/eviction, 100 parallel callers, key isolation, retry, TTL validation
and timeout cleanup. Tests have been authored but not executed pending permission.
Existing tokens.test.ts remains part of regression scope. Rollback: revert this
change as a unit; no persisted data migration is involved.
