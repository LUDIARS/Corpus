import { Hono } from 'hono';

import { getIdentity } from '../auth.ts';
import { callMcpTool, listMcpTools } from '../hub/mcp-adapter.ts';
import type { HubRegistry } from '../hub/registry.ts';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

export function makeMcpRouter(registry: HubRegistry): Hono {
  const router = new Hono();

  router.post('/', async (context) => {
    let request: JsonRpcRequest;
    try {
      request = await context.req.json<JsonRpcRequest>();
    } catch {
      return context.json(jsonRpcError(null, -32700, 'Parse error'), 400);
    }
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return context.json(jsonRpcError(request.id ?? null, -32600, 'Invalid Request'), 400);
    }

    if (request.method === 'notifications/initialized') {
      return context.body(null, 202);
    }
    if (request.method === 'initialize') {
      const requestedVersion =
        typeof request.params?.protocolVersion === 'string'
          ? request.params.protocolVersion
          : DEFAULT_PROTOCOL_VERSION;
      return context.json(jsonRpcResult(request.id ?? null, {
        protocolVersion: requestedVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'corpus', version: '1.0.0' },
      }));
    }
    if (request.method === 'ping') {
      return context.json(jsonRpcResult(request.id ?? null, {}));
    }
    if (request.method === 'tools/list') {
      return context.json(jsonRpcResult(request.id ?? null, {
        tools: listMcpTools(registry),
      }));
    }
    if (request.method === 'tools/call') {
      const name = request.params?.name;
      if (typeof name !== 'string') {
        return context.json(jsonRpcError(request.id ?? null, -32602, 'Tool name is required'), 400);
      }
      try {
        const result = await callMcpTool(
          registry,
          name,
          request.params?.arguments,
          getIdentity(context),
        );
        const structuredContent =
          result && typeof result === 'object' && !Array.isArray(result)
            ? result
            : { result };
        return context.json(jsonRpcResult(request.id ?? null, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent,
        }));
      } catch (error) {
        return context.json(jsonRpcResult(request.id ?? null, {
          content: [{
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          }],
          isError: true,
        }));
      }
    }

    return context.json(jsonRpcError(request.id ?? null, -32601, 'Method not found'), 404);
  });

  return router;
}

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
