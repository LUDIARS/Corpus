import { Hono } from 'hono';

import { getIdentity } from '../auth.ts';
import {
  CapabilityNotFoundError,
  type HubRegistry,
} from '../hub/registry.ts';

export function makeCapabilitiesRouter(registry: HubRegistry): Hono {
  const router = new Hono();

  router.get('/', (context) => context.json({ capabilities: registry.listCapabilities() }));

  router.post('/:moduleId/:capabilityId/invoke', async (context) => {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return context.json({ error: 'input_must_be_object' }, 400);
    }

    try {
      const result = await registry.invokeCapability(
        context.req.param('moduleId'),
        context.req.param('capabilityId'),
        input as Record<string, unknown>,
        getIdentity(context),
      );
      return context.json({ result });
    } catch (error) {
      if (error instanceof CapabilityNotFoundError) {
        return context.json({ error: 'capability_not_found' }, 404);
      }
      return context.json(
        {
          error: 'capability_failed',
          detail: error instanceof Error ? error.message : String(error),
        },
        422,
      );
    }
  });

  return router;
}
