---
name: enterprise-corpus
description: Use when a user wants to inspect or invoke enterprise functions exposed by a running Corpus desktop app. The same capability handlers serve the Electron UI, Skill CLI, and MCP.
---

# Enterprise Corpus

Use the running Corpus application as the source of truth. Do not reproduce
enterprise business logic in the skill.

## Requirements

- `CORPUS_BASE_URL` must contain the URL shown by the running desktop app.
- Set `CORPUS_ACCESS_TOKEN` when the Corpus instance requires Cernere auth.

## Workflow

1. List available capabilities:

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/capability.mjs" list`

2. Choose the capability whose description matches the request. Treat
   `readOnly: false` as a state-changing action.

3. Invoke it with a JSON object:

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/capability.mjs" invoke <module.capability> '<json>'`

4. Report the returned structured result. If the server rejects the operation,
   report its error without substituting a guessed result.

Prefer the MCP tools when they are connected. Use the CLI workflow as the
equivalent fallback; both routes execute the same server-side handler.
