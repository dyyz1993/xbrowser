import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { asJsonArray } from '../shared/json-types.js';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'dictionary',
    url: 'https://api.dictionaryapi.dev',
    description: 'Dictionary definitions, synonyms, and examples',
    requiresLogin: false,
  });
  site.command('search', {
    description: 'Look up a word definition',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      word: z.string().describe('Word to look up')
    }),
    handler: async (p, _ctx) => {
      const data = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(p.word)}`).then(r => r.json()) as JsonObject | JsonObject[];
            if (typeof data === 'object' && !Array.isArray(data) && data.title === 'No Definitions Found') return fail(`No definitions found for "${p.word}"`);
            const entry: JsonObject = Array.isArray(data) ? data[0] : data;
            const meanings = asJsonArray(entry.meanings).map((m) => ({
              partOfSpeech: String(m.partOfSpeech ?? ''),
              definitions: asJsonArray(m.definitions).slice(0, 3).map((d) => String(d.definition ?? '')).join('; '),
              synonyms: asJsonArray(m.synonyms).slice(0, 5).map((s) => String(s)).join(', '),
            }));
            return ok({
              word: String(entry.word ?? p.word),
              phonetic: String(entry.phonetic ?? ''),
              meanings,
              audio: asJsonArray(entry.phonetics).find((ph) => ph.audio)?.audio ? String(asJsonArray(entry.phonetics).find((ph) => ph.audio)?.audio) : '',
              sourceUrls: asJsonArray(entry.sourceUrls).map((s) => String(s)).join(', '),
            });
    },
  });
  site.command('synonyms', {
    description: 'Get synonyms for a word',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      word: z.string().describe('Word to find synonyms for')
    }),
    handler: async (p, _ctx) => {
      const data = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(p.word)}`).then(r => r.json()) as JsonObject | JsonObject[];
            if (typeof data === 'object' && !Array.isArray(data) && data.title === 'No Definitions Found') return fail(`No results for "${p.word}"`);
            const entry: JsonObject = Array.isArray(data) ? data[0] : data;
            const allSynonyms = new Set<string>();
            asJsonArray(entry.meanings).forEach((m) => asJsonArray(m.synonyms).forEach((s) => allSynonyms.add(String(s))));
            asJsonArray(entry.meanings).forEach((m) => asJsonArray(m.definitions).forEach((d) => asJsonArray(d.synonyms).forEach((s) => allSynonyms.add(String(s)))));
            const synonyms = [...allSynonyms];
            if (synonyms.length === 0) return fail(`No synonyms found for "${p.word}"`);
            return ok({ word: p.word, synonyms, count: synonyms.length });
    },
  });
  site.command('examples', {
    description: 'Get example sentences for a word',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      word: z.string().describe('Word to find examples for'),
            limit: z.coerce.number().optional().default(10).describe('Max examples')
    }),
    handler: async (p, _ctx) => {
      const data = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(p.word)}`).then(r => r.json()) as JsonObject | JsonObject[];
            if (typeof data === 'object' && !Array.isArray(data) && data.title === 'No Definitions Found') return fail(`No results for "${p.word}"`);
            const entry: JsonObject = Array.isArray(data) ? data[0] : data;
            const examples: string[] = [];
            asJsonArray(entry.meanings).forEach((m) => asJsonArray(m.definitions).forEach((d) => {
              if (d.example) examples.push(String(d.example));
            }));
            if (examples.length === 0) return fail(`No examples found for "${p.word}"`);
            return ok({ word: p.word, examples: examples.slice(0, p.limit || 10), count: Math.min(examples.length, p.limit || 10) });
    },
  });
}
