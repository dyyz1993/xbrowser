import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';


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
    handler: async (p, ctx) => {
      const data = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(p.word)}`).then(r => r.json()) as any;
            if (data.title === 'No Definitions Found') return fail(`No definitions found for "${p.word}"`);
            const entry = Array.isArray(data) ? data[0] : data;
            const meanings = (entry.meanings ?? []).map((m: any) => ({
              partOfSpeech: m.partOfSpeech ?? '',
              definitions: (m.definitions ?? []).slice(0, 3).map((d: any) => d.definition ?? '').join('; '),
              synonyms: (m.synonyms ?? []).slice(0, 5).join(', '),
            }));
            return ok({
              word: entry.word ?? p.word,
              phonetic: entry.phonetic ?? '',
              meanings,
              audio: (entry.phonetics ?? []).find((ph: any) => ph.audio)?.audio ?? '',
              sourceUrls: (entry.sourceUrls ?? []).join(', '),
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
    handler: async (p, ctx) => {
      const data = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(p.word)}`).then(r => r.json()) as any;
            if (data.title === 'No Definitions Found') return fail(`No results for "${p.word}"`);
            const entry = Array.isArray(data) ? data[0] : data;
            const allSynonyms = new Set<string>();
            (entry.meanings ?? []).forEach((m: any) => (m.synonyms ?? []).forEach((s: string) => allSynonyms.add(s)));
            (entry.meanings ?? []).forEach((m: any) => (m.definitions ?? []).forEach((d: any) => (d.synonyms ?? []).forEach((s: string) => allSynonyms.add(s))));
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
    handler: async (p, ctx) => {
      const data = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(p.word)}`).then(r => r.json()) as any;
            if (data.title === 'No Definitions Found') return fail(`No results for "${p.word}"`);
            const entry = Array.isArray(data) ? data[0] : data;
            const examples: string[] = [];
            (entry.meanings ?? []).forEach((m: any) => (m.definitions ?? []).forEach((d: any) => {
              if (d.example) examples.push(d.example);
            }));
            if (examples.length === 0) return fail(`No examples found for "${p.word}"`);
            return ok({ word: p.word, examples: examples.slice(0, p.limit || 10), count: Math.min(examples.length, p.limit || 10) });
    },
  });
}
