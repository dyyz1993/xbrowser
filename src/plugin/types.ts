export interface XBrowserPluginMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  homepage?: string;
  commands?: string[];
  sites?: string[];
  tags?: string[];
  screenshot?: string;
  license?: string;
}

export type PluginFormWidget =
  | 'text'
  | 'textarea'
  | 'number'
  | 'checkbox'
  | 'select'
  | 'multi-select'
  | 'json'
  | 'file'
  | 'url'
  | 'password';

export type PluginCapability =
  | 'browser.page'
  | 'browser.context'
  | 'browser.cdp'
  | 'network'
  | 'storage'
  | 'filesystem'
  | 'external-api'
  | 'auth.login'
  | (string & {});

export interface PluginFormField {
  name: string;
  label: string;
  type: string;
  widget: PluginFormWidget;
  required: boolean;
  description?: string;
  default?: unknown;
  enum?: string[];
  positional?: boolean;
  placeholder?: string;
  secret?: boolean;
  multiple?: boolean;
}

export interface PluginCommandContractExtension {
  category?: string;
  capabilities?: PluginCapability[];
  positional?: string[];
  form?: {
    title?: string;
    description?: string;
    submitLabel?: string;
    fields?: Partial<PluginFormField>[];
  };
  output?: {
    schema?: unknown;
    examples?: unknown[];
  };
}

export interface PluginCommandContract {
  name: string;
  description: string;
  scope: string;
  requiresLogin: boolean;
  category?: string;
  capabilities: PluginCapability[];
  positional: string[];
  form: {
    title: string;
    description?: string;
    submitLabel: string;
    fields: PluginFormField[];
  };
  output?: PluginCommandContractExtension['output'];
}

export interface PluginContract {
  version: 2;
  plugin: {
    name: string;
    url?: string;
    description?: string;
    requiresLogin?: boolean;
  };
  commands: PluginCommandContract[];
}

export interface NPMPluginSearchResult {
  name: string;
  version: string;
  description: string;
  author?: { name: string } | string;
  homepage?: string;
  repository?: { url: string };
  keywords?: string[];
  links?: {
    npm: string;
    homepage?: string;
    repository?: string;
  };
  date: string;
  quality?: number;
  popularity?: number;
}

export interface SearchOptions {
  query?: string;
  tag?: string;
  site?: string;
  limit?: number;
}

export interface MarketplacePluginSearchResult {
  source: 'marketplace';
  slug: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  tags?: string[];
  sites?: string[];
  commands?: string[];
  downloads: number;
  license?: string;
}

export type PluginSearchResult = NPMPluginSearchResult | MarketplacePluginSearchResult;

export interface PluginListOptions {
  json?: boolean;
}
