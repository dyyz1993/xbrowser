import type { CommandScope } from '@dyyz1993/xcli-core';

/**
 * Describes a single scope level in the browser automation hierarchy.
 */
export interface ScopeLevel {
  name: CommandScope;
  description: string;
  order: number;
}

/**
 * A named scope definition with a description and ordered levels.
 */
export interface ScopeDefinition {
  name: string;
  description: string;
  levels: ScopeLevel[];
}

/**
 * Built-in browser automation scope hierarchy.
 *
 * Defines four levels: project, browser, page, and element,
 * ordered from coarsest to finest granularity.
 */
export const BROWSER_SCOPE: ScopeDefinition = {
  name: 'browser',
  description: 'Browser automation scope hierarchy',
  levels: [
    { name: 'project', description: 'Project-level (config, daemon)', order: 0 },
    { name: 'browser', description: 'Browser-level (launch, connect)', order: 1 },
    { name: 'page', description: 'Page-level (navigate, query)', order: 2 },
    { name: 'element', description: 'Element-level (click, fill)', order: 3 },
  ],
};
