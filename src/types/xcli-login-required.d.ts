import type { ZodSchema, CommandContext, CommandScope } from '@dyyz1993/xcli-core';
import type { z } from 'zod';

declare module '@dyyz1993/xcli-core' {
  interface SiteInstance {
    command<P extends ZodSchema = ZodSchema, R extends ZodSchema = ZodSchema>(name: string, config: {
      description: string;
      scope?: CommandScope;
      override?: boolean;
      parameters?: P;
      result?: R;
      requiresLogin?: boolean;
      loginRequired?: 'required' | 'optional' | 'none';
      examples?: Array<{ cmd: string; description: string }>;
      tips?: string[];
      handler: (params: z.infer<P>, ctx: CommandContext) => Promise<z.infer<R>>;
    }): SiteInstance;
  }

  interface CommandEntry {
    loginRequired?: 'required' | 'optional' | 'none';
  }
}
