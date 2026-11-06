# SPEC-HUB-EMBEDDED-LOGIN-001: Embedded current Cernere card

## SPEC-HUB-EMBEDDED-LOGIN-001

The hub login mount uses Cernere CompositeLoginFrame in both auth UI modes. It renders the current hosted login card without top-level navigation or popup, retaining backend /auth/exchange and cookie-based hub session handling. Registration and recovery UI remain owned by Cernere.

The coordinated project/PKCE migration supersedes the old 3439050562ea pin. Export the frame for derived hub branding, importing its leaf module to avoid loading unrelated native-WebAuthn SDK dependencies on the host. Require the configured cernereClientId and forward both code and browser verifier to the same-origin backend. Remove the retired ticket client, redirect builder and legacy wire types; there is no global-token compatibility path. See SPEC-HUB-BOUND-SERVICE-SESSION for the pending coordinated cutover.

Validation: host bundle and adapter/embedded mount checks. GLab must update this submodule and its own login mount in a separate reviewed change; this PR alone does not update the public GLab page.
