# SPEC-PUBLIC-READ-ROUTES-001 — Host-owned public reads

Hosts may supply `publicReadRoutes(db)` to `startCorpus`. It runs after plugin
initialization and mounts a router exclusively under `/public`. Only GET and HEAD
reach host handlers; other methods return 405. Unknown public routes return 404.
Responses are not cached, so a host can withdraw published material immediately.

The host owns publication approval and the public projection. It must never
return private drafts or private identity fields. Corpus adds no domain rules.
Authentication and host access policy remain mandatory on existing API/MCP routes.

Acceptance: public reads work anonymously, non-read requests cannot invoke host
handlers, missing public routes cannot fall through, and API authentication is
unchanged. Covered by `server/public-read-routes.test.ts`.
