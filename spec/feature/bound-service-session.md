# SPEC-HUB-BOUND-SERVICE-SESSION: Corpus owns the service session

## SPEC-HUB-BOUND-SERVICE-SESSION

Adopts Cernere's 2026-10-30 project/PKCE contract and the shared Composite operation guard.
The service exchanges the browser's code and verifier with its own project credential, then binds the
scoped Cr grant to a freshly generated 32-byte opaque Corpus session. Browser/native clients receive
only that session; global Cr user tokens, refresh cookies and locally extended JWTs are not supported.
The backend retains the scoped grant in memory, keyed by a full SHA-256 fingerprint of the random token.
Session capacity is bounded, shutdown clears local credentials, and a service restart requires sign-in.

Every protected request performs a live shared-SDK check. No five-minute positive cache or stale-result
fallback is permitted. The session's maximum lifetime is the original grant's remaining lifetime (at most
15 minutes); checking a session can shorten that lifetime but never extend it. Logout deletes local state
before asking Cr for revocation, so a concurrent check cannot resurrect the session or authorize a mutation.
An exchange/bind failure does not establish a session and must never be transparently retried.

Important operations and sensitive reads, including GET, additionally require a classified action,
resource, exact request body digest and one-use Cr permit through the shared SDK. Unclassified operations
are denied. The host's current target-resource authorization remains mandatory immediately before execution;
Cr's grant or operation permit cannot replace the host's own data permissions. Local logout/expiry is
rechecked immediately before resource authorization and execution. Cookie exchange requires the configured
Origin, JSON and a bounded body; the cookie is host-only, Secure/HttpOnly/SameSite=Lax (loopback HTTP dev
uses an explicitly separate cookie name). Browser responses expose no credential. Native exchange/logout
use dedicated routes and an explicit opaque bearer, never ambient cookies. Rotation establishes the new
grant first, then deletes/revokes the prior session. Unconfirmed rotation leaves neither local credential
usable; a prior session survives a failure before the replacement is bound. The Cr permit and the service database
are not one distributed transaction: failures/unknown outcomes use an explicit endpoint idempotency contract,
not automatic retries.

The prepared auth routes/cookies/native handlers are wired into index/auth. Authenticated startup requires
a host-owned operationPolicy. It must classify every permitted path/method and provide a current data
authorization callback; unknown paths, including GET, are denied. The ordinary gate reads bounded bytes (route-owned
maximum, hard ceiling 32 MiB, 15-second read deadline) and reconstructs the request using those same bytes
so JSON/form/multipart parsing cannot authorize a different body. The host must retain row-level checks
inside the actual database transaction. Exceptions after endpoint execution begins remain endpoint failures,
not an invitation to transparently retry the operation.

Explicit `Cernere-Delegation` authentication consumes the incoming one-operation capability with the actual
path/query/method/body/semantic headers. It never falls back to cookies or reusable local sessions and never
creates a session usable for further delegation. Existing explicitly enabled machine external routes retain
their separate principal and scope checks; they do not become user sessions under this contract.

Implementation remains incomplete until host operation classifications and resource ACLs, downstream
consumer contracts and all consumers are migrated. The current submodule pin references
accepted Cr main71d6c368dc188bbb95f9af323d347060425d99d6 (Revisor PR3627/3629/3634, registered checks passed).
This is source integration, not deployment or end-to-end cutover evidence.
Do not deploy this partial migration or deploy the breaking Cr contract before every consumer is ready.

The optional plugin identityProvider exposes only the local bound session's own Cr organization
memberships and face-consent operations, with the fixed scoped-identity permission/one-use contract.
It is absent in explicit no-auth mode. There is no arbitrary user/module/URL API or global-credential
escape. It resolves the opaque token through the current local store and supplies an owner-lifetime
callback, including after asynchronous permit preparation and before the actual Cr data request.
Neither a delegated actor nor a machine actor obtains a reusable local user session from this facade.

Investigation: Pf project Corpus 01M3FVMF96FT1CPXX93R1P715X exists (UX revision 1), with no specs returned
by its specs API. Local feature files remain the contract source. Anatomia corpus plan 4df9a39a738f10e0
identified existing hub-auth, hub-federation and client-shell domains with no duplicate candidate.
Its registered canonical checkout is older than the approved host-policy dependencies in this feature;
those dependencies were inspected at 90de907. Cache persistence failed EPERM; no permissions were changed.
The approved Corpus baseline includes all five Revisor commits through 90de907; root main stays 16a430f.

Static validation now uses a real worktree dependency directory. Seven reviewed core packages were
restored to exact lock versions (including Hono4.13.7 and React/ReactDOM19.2.8); unchanged leaf packages
are isolated references to already installed dependencies. Remaining lock mismatches, including native
SQLite, are still unverified and must not be represented as a complete clean install. No package lifecycle
scripts or native modules were executed. TypeScript5.9.3 and Vitest2.1.9 match. Runtime test execution
belongs to Revisor; no launch, restart, local PR or deployment has occurred for this consumer migration.

## Explicit bounded upload capture

The2GiB capture/quota correction now pins accepted Cr PR3634. The prior200MiB
spectator-policy reference was incorrect for GLAB profile videos, whose actual
MEDIA_RULES allow2GiB. This source integration does not claim2GiB runtime success;
GLAB/real target adoption and coordinated administrator settings remain required.

Only a host-classified important mutation with an explicit `upload` policy can exceed the ordinary body
ceiling. Route limits cap bytes at2GiB and capture time at300seconds. Standard Node streams and a private
temporary spool preserve exact binary bytes; captures above1MiB spill to a private exclusive file. The
process permits at most8 retained captures and4GiB total reserved/received bytes. The expected size is
reserved before an incoming delegated body is read, and actual bytes are checked independently of the
Content-Length hint. Capacity exhaustion fails closed. Disconnect, elapsed deadline, over/under-size or
read failure cancels the reader, unlinks only that capture's file and removes only its empty directory.
Successful captures retain their budget until their idempotent disposal completes. Failed cleanup does
not falsely return capacity. No browser path or arbitrary disk path is accepted.

The source's own captured operation uses the shared SDK's exact Blob digest and one-use permit before
latest host ACL. Only that same backend-owned Blob is available to the downstream provider. The provider
hashes it through the reviewed SDK and issues a `Cernere-Upload` arrival credential, never a global token
or an ordinary small-body delegation fallback. Transfer cancellation must finish before capture disposal;
upload callers consume a bounded small result and await asynchronous transfer disposal before releasing
their capture. An owned stream holds the Blob reader, cancels it on abort and waits for outstanding pulls
and cancellation before releasing its lock. This remains possible when an HTTP consumer holds the output
stream lock. Replay requests use the same managed-reader ownership and the reserved deadline signal;
checking only an unlocked Request body or firing AbortController is not teardown completion. Large download
and Range responses keep the ordinary streaming path.

An incoming upload explicitly reserves Cr authority before private body capture. The SDK checks the
source-fixed digest/size, atomically finalizes the reservation and only then consults the latest host
operation classification and current resource ACL. Failure cannot create a reusable session or retry the
operation. HTTP execution and Cr consumption are not one distributed transaction. The handler must keep
transaction-local row permissions and explicit endpoint idempotency; an unknown outcome is never retried
automatically. Capture disposal follows every endpoint result, including endpoint failure. No slow-body
permit extension or new signature scheme is introduced.

## Explicit downstream audience configuration

Authenticated `cernere-service-delegation` hosts must provide the administrator
setting `CORPUS_DELEGATION_AUDIENCES`, a JSON object from exact Cr project key to
expected canonical HTTP(S) origin. Missing/empty/malformed configuration fails
startup before database/session/socket owners are opened. An explicit `{}` means no authorized destination; an unknown project
is refused before preparing a request or consulting Cr. This map is an expected
identifier, not the authority: Cr's administrator-owned `schema_definition.hub_url`
remains the sole canonical audience and is rechecked with current source/target
permissions and consent. Cr's environment/project-specific HTTPS policy remains
in force. No scheme/loopback exception is granted by parsing an identifier here.

The transport `baseUrl` remains independently validated HTTPS or loopback HTTP;
it may reach a local proxy while the registered audience is a public HTTPS
origin. Its origin is never an audience fallback. Neither manifest claims,
browser input, Host/forwarded headers nor an advertised target audience can
choose this setting. Snapshot the project/audience, actor token and action
before request serialization yields. Ordinary and upload delegation use the
same exact configured pair, preserving bound bytes/path/headers and no retry.

The configuration accepts Cr project-key syntax and canonical origin strings
only. Paths (including a trailing slash), credentials, query, fragment and
noncanonical URL spelling are rejected. Standard JSON parse/stringify with
whitespace-free validated keys/origins detects duplicate keys (even identical
values or escaped duplicate spellings); noncanonical string escapes are also
rejected. Pretty JSON whitespace is allowed. Errors name the setting without
echoing its contents. There is no second JSON/URL parser, dependency or crypto.

Before any host is switched, its owner must add this startup setting explicitly,
compare every destination pair to current Cr administrator registration, retain
the host/target action/risk/consent declarations and resource ACLs, and verify
the real network/TLS path. GLAB and other Corpus hosts require catalog/deployment
configuration and the accepted Corpus pin before restart; an absent map must
not be worked around by a transport-origin/legacy credential fallback. This
source-only change does not apply configuration, start services or prove live
deployment. Existing consumer/target/settings/runtime cutover gates remain.

| Startup owner | Required preparation | Current acceptance state |
| --- | --- | --- |
| Corpus standalone `server/index.ts` | Inject an explicit administrator map with the selected mode; compare values to current Cr registration | Parser/wiring/contracts implemented; live map and runtime not verified |
| Corpus example host | Supply the same map when authenticated startup is selected; explicit `{}` only when no destination is intended | Documentation only; no example service started |
| GLAB embedding `startCorpus` | Follow the accepted Corpus pin, add this required startup setting to deployment/catalog preparation, provide every reviewed target pair without changing canonical Cr origin policy | Host follow-up and actual administrator values pending; no restart/deploy |
| Other hosts adopting this Corpus revision | Inventory their actual startup/configuration owner before adopting the pin and supply the explicit map | Not assumed configured; adoption/cutover remains blocked until evidenced |

This table is configuration readiness, not permission to alter an existing
project registration, secret store, deployment or service process. No actual
administrator values or credentials are printed in this change.

## Private query binding for own-session callbacks

A host may explicitly classify an OAuth callback as `privateQuery: true` only
with an own service session, `risk: important`, method GET and a zero-byte body
limit. The ordinary live Cr permit/consumption and latest host ACL remain
mandatory. The resource sent to Cr is the actual URL pathname followed by
`#query-sha256=` and the standard SHA-256 hex digest of the UTF-8 `URL.search`
string, including its leading question mark when present. Neither code nor
state values leave the host in this operation identifier. No query parser,
sorting, decoding or reconstruction is used: duplicate values, ordering and
percent-encoded spelling changes bind a different resource. The endpoint sees
the original URL and must independently enforce exactly one state/code (or the
documented provider-error shape), state expiry, source, redirect and same-user
binding before any OAuth exchange. Hashing does not validate an OAuth response.

An incoming delegation/upload, upload policy, other method/risk/body limit or
invalid flag is refused before authority/data execution. The digest identifier
cannot be used as a transport path or silently substituted into a delegation's
exact path contract. Existing ordinary and upload operation contracts remain
unchanged. Cookie SameSite=Lax permits a normal top-level cross-site GET return;
state validation remains its CSRF boundary, with no general GET exemption from
important-operation classification. Host request logs and error responses must
also avoid callback query secrets; this change does not change logging policy.

This framework option alone enables no route. Hosts must adopt the accepted
Corpus pin and provide their explicit callback classification, provider-state
validation and current domain authorization. Managed Meet host/target wiring,
administrator settings, real provider roundtrip and coordinated cutover remain
pending; no service is started or deployed by this change.
