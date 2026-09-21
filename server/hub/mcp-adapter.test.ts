import { describe, expect, it, vi } from 'vitest';

import type { AuthIdentity } from '../auth.ts';
import type { HubRegistry } from './registry.ts';
import { callMcpTool, listMcpTools } from './mcp-adapter.ts';

const identity: AuthIdentity = {
  userId: 'user-1',
  externalId: 'employee-1',
  role: 'member',
  displayName: 'Test User',
  projectKey: null,
  isAdmin: false,
};

describe('MCP capability adapter', () => {
  it('maps registered capabilities to stable MCP tool names', () => {
    const registry = {
      listCapabilities: () => [{
        id: 'announcements.list_announcements',
        moduleId: 'announcements',
        capabilityId: 'list_announcements',
        title: 'お知らせ一覧',
        description: '一覧を取得',
        inputSchema: { type: 'object' as const, additionalProperties: false },
        readOnly: true,
      }],
    } as HubRegistry;

    expect(listMcpTools(registry)).toEqual([expect.objectContaining({
      name: 'announcements__list_announcements',
      annotations: expect.objectContaining({
        readOnlyHint: true,
        destructiveHint: false,
      }),
    })]);
  });

  it('invokes the shared registry handler', async () => {
    const invokeCapability = vi.fn().mockResolvedValue({ items: [] });
    const registry = { invokeCapability } as unknown as HubRegistry;

    await expect(callMcpTool(
      registry,
      'announcements__list_announcements',
      {},
      identity,
    )).resolves.toEqual({ items: [] });
    expect(invokeCapability).toHaveBeenCalledWith(
      'announcements',
      'list_announcements',
      {},
      identity,
    );
  });
});
