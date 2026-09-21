import type { AuthIdentity } from '../auth.ts';
import type { HubRegistry } from './registry.ts';
import type { CapabilitySchema } from './types.ts';

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: CapabilitySchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export function listMcpTools(registry: HubRegistry): McpTool[] {
  return registry.listCapabilities().map((capability) => ({
    name: `${capability.moduleId}__${capability.capabilityId}`,
    title: capability.title,
    description: capability.description,
    inputSchema: capability.inputSchema,
    annotations: {
      readOnlyHint: capability.readOnly,
      destructiveHint: false,
      idempotentHint: capability.readOnly,
      openWorldHint: false,
    },
  }));
}

export async function callMcpTool(
  registry: HubRegistry,
  name: string,
  argumentsValue: unknown,
  identity: AuthIdentity,
): Promise<unknown> {
  const separator = name.indexOf('__');
  if (separator < 1 || separator === name.length - 2) {
    throw new Error(`invalid_tool_name: ${name}`);
  }
  const input =
    argumentsValue && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)
      ? argumentsValue as Record<string, unknown>
      : {};
  return registry.invokeCapability(
    name.slice(0, separator),
    name.slice(separator + 2),
    input,
    identity,
  );
}
