# SPEC-HUB-EMBEDDED-LOGIN-001: Embedded current Cernere card

## SPEC-HUB-EMBEDDED-LOGIN-001

The hub login mount uses Cernere CompositeLoginFrame in both auth UI modes. It renders the current hosted login card without top-level navigation or popup, retaining backend /auth/exchange and cookie-based hub session handling. Registration and recovery UI remain owned by Cernere.

Pin lib/cernere to reviewed merge 3439050562ea (Cernere #3219). Export the frame for derived hub branding, importing its leaf module to avoid loading unrelated native-WebAuthn SDK dependencies on the host. Preserve the exported legacy ticket client and redirect URL builder as compatibility APIs, but never mount the old password UI. Snapshot legacy wire types locally because the current SDK no longer exports that retired contract.

Validation: host bundle and adapter/embedded mount checks. GLab must update this submodule and its own login mount in a separate reviewed change; this PR alone does not update the public GLab page.
