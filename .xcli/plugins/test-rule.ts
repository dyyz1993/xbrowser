import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';

export default function (xcli: XCLIAPI) {
  const site = xcli.createSite({
    name: 'test',
    url: 'https://example.com',
  });

  site.command('bad', {
    parameters: z.object({}),
    result: z.object({ ok: z.boolean() }).passthrough(),
    handler: async () => {
      // test-rule: intentionally minimal for ESLint rule validation
      return { ok: true } as unknown as Record<string, unknown>;
    },
  });
}
