# SPEC-HOST-ACCESS-POLICY-001: Host authorization after authentication

Hosts can pass an optional `accessPolicy` middleware to `startCorpus`.
It runs after Corpus authentication and before API, connector relay, capability,
plugin and MCP handlers. It covers `/api/*`, `/mcp`, and `/mcp/*`.
The host can return an approval-pending response or a reduced catalog, while
explicitly allowing safe status reads. Authentication cannot be bypassed by this
policy. Throwing or denying never falls through to a protected handler.

Public static assets, login, logout and health remain outside this policy.
No school-specific eligibility rules or notification delivery belong in Corpus.
Hosts that omit the option retain their existing behavior.
