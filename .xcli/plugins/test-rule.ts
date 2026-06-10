import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';

export default function (xcli: XCLIAPI) {
  const site = xcli.createSite({
    name: 'test',
    url: 'https://example.com',
  });

  site.command('bad', {
    description: 'Test rule validation command',
    parameters: z.object({}),
    result: z.object({ ok: z.boolean() }).passthrough(),
    handler: async (_params, _ctx) => {
      // test-rule: intentionally minimal for ESLint rule validation
      return { ok: true };
    },
  });
}
