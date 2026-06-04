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
    .map(command => buildCommandContract(site.getCommand?.(command.name) || command));
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

export function buildCommandContract(command: CommandLike): PluginCommandContract {
  const extension = command.xbrowser || {};
  const inferredFields = fieldsFromZodObject(command.parameters);
  const fields = mergeFields(inferredFields, extension.form?.fields || []);
  const positional = extension.positional || fields.filter(field => field.positional).map(field => field.name);
  const capabilities = extension.capabilities || inferCapabilities(command.scope || 'project', command.requiresLogin);
  const outputSchema = command.result ? summarizeZod(command.result) : undefined;

  return {
    name: command.name,
    description: command.description || '',
    scope: command.scope || 'project',
    requiresLogin: command.requiresLogin === true,
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
  const shape = getShape(schema);
  if (!shape) return [];
  return Object.entries(shape).map(([name, field]) => fieldFromZod(name, field));
}

function fieldFromZod(name: string, schema: unknown): PluginFormField {
  const unwrapped = unwrapZod(schema);
  const type = zodTypeToContractType(unwrapped.typeName);
  const enumValues = extractEnumValues(unwrapped.schema);
  return {
    name,
    label: toLabel(name),
    type,
    widget: widgetFor(type, enumValues, unwrapped.schema),
    required: !unwrapped.optional,
    ...(unwrapped.description ? { description: unwrapped.description } : {}),
    ...(unwrapped.defaultValue !== undefined ? { default: unwrapped.defaultValue } : {}),
    ...(enumValues ? { enum: enumValues } : {}),
    ...(type === 'array' ? { multiple: true } : {}),
  };
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

function getShape(schema: unknown): Record<string, unknown> | undefined {
  const zod = schema as ZodLike | undefined;
  const shapeOrFn = zod?.shape ?? zod?._def?.shape;
  if (!shapeOrFn) return undefined;
  return typeof shapeOrFn === 'function' ? shapeOrFn() : shapeOrFn;
}

function unwrapZod(schema: unknown): {
  schema: unknown;
  typeName: string;
  optional: boolean;
  description?: string;
  defaultValue?: unknown;
} {
  let current = schema as ZodLike;
  let optional = typeof current?.isOptional === 'function' ? current.isOptional() : false;
  let description = current?._def?.description;
  let defaultValue: unknown;

  for (let i = 0; i < 8; i++) {
    const def = current?._def;
    const typeName = def?.typeName || 'unknown';
    if (def?.description) description = def.description;
    if (!def) return { schema: current, typeName, optional, description, defaultValue };

    if (typeName === 'ZodDefault') {
      optional = true;
      defaultValue = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue;
      current = (def.innerType || def.type) as ZodLike;
      continue;
    }

    if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
      optional = true;
      current = (def.innerType || def.type) as ZodLike;
      continue;
    }

    return { schema: current, typeName, optional, description, defaultValue };
  }

  return { schema: current, typeName: current?._def?.typeName || 'unknown', optional, description, defaultValue };
}

function zodTypeToContractType(typeName: string): string {
  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodEnum':
    case 'ZodNativeEnum':
      return 'enum';
    case 'ZodArray':
      return 'array';
    case 'ZodObject':
      return 'object';
    default:
      return typeName.replace(/^Zod/, '').toLowerCase() || 'unknown';
  }
}

function widgetFor(type: string, enumValues: string[] | undefined, schema: unknown): PluginFormWidget {
  if (enumValues) return 'select';
  if (type === 'boolean') return 'checkbox';
  if (type === 'number') return 'number';
  if (type === 'array') return 'multi-select';
  if (type === 'object') return 'json';

  const checks = ((schema as ZodLike)?._def as Record<string, unknown> | undefined)?.checks as Array<Record<string, unknown>> | undefined;
  if (checks?.some(check => check.kind === 'url')) return 'url';
  return 'text';
}

function extractEnumValues(schema: unknown): string[] | undefined {
  const def = (schema as ZodLike | undefined)?._def;
  const values = def?.values;
  if (Array.isArray(values)) return values.map(String);
  return undefined;
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

  const shape = getShape(schema);
  if (!shape) {
    return {
      type: zodTypeToContractType(unwrapped.typeName),
      required: !unwrapped.optional,
      ...(unwrapped.description ? { description: unwrapped.description } : {}),
    };
  }
  return Object.fromEntries(
    Object.entries(shape).map(([name, field]) => {
      const unwrapped = unwrapZod(field);
      return [name, {
        type: zodTypeToContractType(unwrapped.typeName),
        required: !unwrapped.optional,
        ...(unwrapped.description ? { description: unwrapped.description } : {}),
      }];
    }),
  );
}

function toLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, char => char.toUpperCase());
}
