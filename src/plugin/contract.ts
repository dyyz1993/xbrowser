import {
  unwrapZod,
  fieldsFromZodObjectReflected,
  zodTypeToContractType,
} from '@dyyz1993/xcli-core';
import type {
  PluginCapability,
  PluginCommandContract,
  PluginCommandContractExtension,
  PluginContract,
  PluginFormField,
  PluginFormWidget,
} from './types.js';

type ZodLike = {
  _def?: {
    typeName?: string;
    description?: string;
    defaultValue?: (() => unknown) | unknown;
    innerType?: unknown;
    type?: unknown;
    values?: unknown[];
    valueType?: unknown;
    element?: unknown;
    shape?: (() => Record<string, unknown>) | Record<string, unknown>;
  };
  shape?: Record<string, unknown> | (() => Record<string, unknown>);
  isOptional?: () => boolean;
  isNullable?: () => boolean;
};

type CommandLike = {
  name: string;
  description?: string;
  scope?: string;
  requiresLogin?: boolean;
  parameters?: unknown;
  result?: unknown;
  xbrowser?: PluginCommandContractExtension;
};

type SiteLike = {
  name: string;
  url?: string;
  config?: {
    description?: string;
    requiresLogin?: boolean;
  };
  getAllCommands(): CommandLike[];
  getCommand?(name: string): CommandLike | null | undefined;
};

export function buildPluginContract(site: SiteLike): PluginContract {
  const commands = site
    .getAllCommands()
    .map(command => buildCommandContract(site.getCommand?.(command.name) || command, {
      siteRequiresLogin: site.config?.requiresLogin,
    }));
  return {
    version: 2,
    plugin: {
      name: site.name,
      url: site.url,
      description: site.config?.description,
      requiresLogin: site.config?.requiresLogin,
    },
    commands,
  };
}

export function buildCommandContract(command: CommandLike, options: { siteRequiresLogin?: boolean } = {}): PluginCommandContract {
  const extension = command.xbrowser || {};
  const inferredFields = fieldsFromZodObject(command.parameters);
  const fields = mergeFields(inferredFields, extension.form?.fields || []);
  const positional = extension.positional || fields.filter(field => field.positional).map(field => field.name);
  const requiresLogin = command.requiresLogin === true
    || (options.siteRequiresLogin === true && command.name !== 'login' && command.name !== 'logout');
  const capabilities = extension.capabilities || inferCapabilities(command.scope || 'project', requiresLogin);
  const outputSchema = command.result ? summarizeZod(command.result) : undefined;

  return {
    name: command.name,
    description: command.description || '',
    scope: command.scope || 'project',
    requiresLogin,
    category: extension.category,
    capabilities,
    positional,
    form: {
      title: extension.form?.title || command.description || command.name,
      description: extension.form?.description,
      submitLabel: extension.form?.submitLabel || 'Run',
      fields,
    },
    output: extension.output || (outputSchema ? { schema: outputSchema } : undefined),
  };
}

export function fieldsFromZodObject(schema: unknown): PluginFormField[] {
  const reflected = fieldsFromZodObjectReflected(schema);
  return reflected.map(field => {
    const widget = widgetFor(field.type, field.enum);
    return {
      name: field.name,
      label: toLabel(field.name),
      type: field.type,
      widget,
      required: field.required,
      ...(field.description ? { description: field.description } : {}),
      ...(field.default !== undefined ? { default: field.default } : {}),
      ...(field.enum ? { enum: field.enum } : {}),
      ...(field.type === 'array' ? { multiple: true } : {}),
    };
  });
}

function mergeFields(inferred: PluginFormField[], overrides: Partial<PluginFormField>[]): PluginFormField[] {
  if (overrides.length === 0) return inferred;
  const byName = new Map(inferred.map(field => [field.name, field]));
  const seen = new Set<string>();
  const merged: PluginFormField[] = [];

  for (const override of overrides) {
    if (!override.name) continue;
    const base = byName.get(override.name) || {
      name: override.name,
      label: toLabel(override.name),
      type: 'string',
      widget: 'text' as PluginFormWidget,
      required: false,
    };
    merged.push({ ...base, ...override, name: override.name });
    seen.add(override.name);
  }

  for (const field of inferred) {
    if (!seen.has(field.name)) merged.push(field);
  }

  return merged;
}

function inferCapabilities(scope: string, requiresLogin?: boolean): PluginCapability[] {
  const caps: PluginCapability[] = [];
  if (scope === 'page') caps.push('browser.page');
  if (scope === 'browser') caps.push('browser.context');
  if (requiresLogin) caps.push('auth.login');
  return caps;
}

function widgetFor(type: string, enumValues: string[] | undefined): PluginFormWidget {
  if (enumValues) return 'select';
  if (type === 'boolean') return 'checkbox';
  if (type === 'number') return 'number';
  if (type === 'array') return 'multi-select';
  if (type === 'object') return 'json';
  return 'text';
}

function summarizeZod(schema: unknown): unknown {
  const unwrapped = unwrapZod(schema);
  if (unwrapped.typeName === 'ZodArray') {
    const def = (unwrapped.schema as ZodLike)?._def;
    return {
      type: 'array',
      items: summarizeZod(def?.type || def?.innerType),
    };
  }

  const shape = getObjectShape(schema);
  if (!shape) {
    return {
      type: zodTypeToContractType(unwrapped.typeName),
      required: !unwrapped.optional,
      ...(unwrapped.description ? { description: unwrapped.description } : {}),
    };
  }
  return Object.fromEntries(
    Object.entries(shape).map(([name, field]) => {
      const inner = unwrapZod(field);
      return [name, {
        type: zodTypeToContractType(inner.typeName),
        required: !inner.optional,
        ...(inner.description ? { description: inner.description } : {}),
      }];
    }),
  );
}

function getObjectShape(schema: unknown): Record<string, unknown> | undefined {
  const zod = schema as ZodLike | undefined;
  const shapeOrFn = zod?.shape ?? zod?._def?.shape;
  if (!shapeOrFn) return undefined;
  return typeof shapeOrFn === 'function' ? shapeOrFn() : shapeOrFn;
}

function toLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, char => char.toUpperCase());
}
