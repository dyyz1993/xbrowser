#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(import.meta.dirname, '..');
const COMMANDS_DIR = join(ROOT, 'src', 'commands');

function findTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isFile() && entry.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

function extractRegisterCommandBlocks(content) {
  const blocks = [];
  const re = /registerCommand\s*\(\s*\{/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    const start = match.index;
    let depth = 0;
    let i = start;
    let foundOpen = false;
    while (i < content.length) {
      if (content[i] === '{') {
        depth++;
        foundOpen = true;
      } else if (content[i] === '}') {
        depth--;
        if (foundOpen && depth === 0) {
          blocks.push(content.substring(start, i + 1));
          break;
        }
      }
      i++;
    }
  }
  return blocks;
}

function extractSchemaParamKeys(block) {
  const paramsMatch = block.match(/parameters\s*:\s*z\.object\s*\(\s*\{/);
  if (!paramsMatch) return [];

  const objectStart = block.indexOf('{', block.indexOf('z.object'));
  if (objectStart === -1) return [];

  let depth = 0;
  let i = objectStart;
  let objectEnd = -1;
  while (i < block.length) {
    if (block[i] === '{') depth++;
    else if (block[i] === '}') {
      depth--;
      if (depth === 0) {
        objectEnd = i;
        break;
      }
    }
    i++;
  }
  if (objectEnd === -1) return [];

  const objectBody = block.substring(objectStart + 1, objectEnd);

  const keys = [];
  const lines = objectBody.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const keyMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (keyMatch) {
      keys.push(keyMatch[1]);
    }
  }
  return keys;
}

function extractHandlerInfo(block) {
  const handlerMatch = block.match(/handler\s*:\s*async\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
  if (!handlerMatch) return null;
  return { paramName: handlerMatch[1] };
}

function extractHandlerBody(block) {
  const handlerSignatureRe = /handler\s*:\s*async\s*\([^)]*\)\s*(?::\s*[^=]*)?\s*=>\s*\{/g;
  const match = handlerSignatureRe.exec(block);
  if (!match) return '';

  const arrowStart = block.indexOf('=>', match.index);
  if (arrowStart === -1) return '';

  const bodyStart = block.indexOf('{', arrowStart);
  if (bodyStart === -1) return '';

  let depth = 0;
  let i = bodyStart;
  let bodyEnd = -1;
  while (i < block.length) {
    if (block[i] === '{') depth++;
    else if (block[i] === '}') {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
    i++;
  }
  if (bodyEnd === -1) return '';

  return block.substring(bodyStart, bodyEnd + 1);
}

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const relPath = relative(ROOT, filePath);

  const blocks = extractRegisterCommandBlocks(content);
  if (blocks.length === 0) return [];

  const results = [];

  for (const block of blocks) {
    const nameMatch = block.match(/name\s*:\s*['"]([^'"]+)['"]/);
    const cmdName = nameMatch ? nameMatch[1] : '<unknown>';

    const paramKeys = extractSchemaParamKeys(block);
    if (paramKeys.length === 0) continue;

    const handlerInfo = extractHandlerInfo(block);
    if (!handlerInfo) {
      results.push({ cmdName, relPath, unconsumed: paramKeys, hasHandler: false });
      continue;
    }

    const handlerBody = extractHandlerBody(block);
    const { paramName } = handlerInfo;

    const wholeObjectPassed = [
      `...${paramName}`,           // spread: { ...p }
      `[${paramName}]`,            // array literal: [p]
      `addCookies([${paramName}`,  // addCookies([p])
    ].some(pattern => handlerBody.includes(pattern));

    const unconsumed = [];
    if (wholeObjectPassed) {
      // skip - entire param object is spread/passed, all keys are implicitly consumed
    } else {
      for (const key of paramKeys) {
        if (key.startsWith('_')) continue;
        const accessPattern = `${paramName}.${key}`;
        if (!handlerBody.includes(accessPattern)) {
          unconsumed.push(key);
        }
      }
    }

    if (unconsumed.length > 0) {
      results.push({ cmdName, relPath, unconsumed, hasHandler: true });
    }
  }

  return results;
}

function main() {
  const files = findTsFiles(COMMANDS_DIR);
  let totalIssues = 0;
  const allResults = [];

  for (const file of files) {
    const issues = checkFile(file);
    allResults.push({ file, issues });
  }

  const filesWithCommands = allResults.filter(({ issues }) => issues.length > 0);
  const filesClean = allResults.filter(({ file, issues }) =>
    issues.length === 0 && filesWithCommands.some(f => f.file === file) === false
  );

  for (const { issues } of filesWithCommands) {
    for (const issue of issues) {
      if (issue.unconsumed.length > 0) {
        for (const param of issue.unconsumed) {
          console.log(`\x1b[31m❌ ${issue.relPath} (${issue.cmdName}): Parameter "${param}" is declared in schema but never consumed in handler.\x1b[0m`);
          console.log(`   → Either use ${issue.hasHandler ? 'the handler parameter' : 'p'}.${param} in the handler, or remove it from the Zod schema.`);
          console.log(`   → See docs/commands.md for command development guidelines.`);
          totalIssues++;
        }
      }
    }
  }

  const checkedFiles = new Set(filesWithCommands.map(f => f.file));
  for (const { file, issues } of allResults) {
    if (!checkedFiles.has(file)) continue;
    const hasUnconsumed = issues.some(i => i.unconsumed.length > 0);
    if (!hasUnconsumed && issues.length > 0) {
      const relPath = relative(ROOT, file);
      const cmdNames = issues.map(i => i.cmdName).join(', ');
      console.log(`\x1b[32m✅ ${relPath} (${cmdNames}): All parameters consumed.\x1b[0m`);
    }
  }

  if (totalIssues > 0) {
    console.log(`\n\x1b[33mFound ${totalIssues} unconsumed parameter(s) across ${filesWithCommands.length} command file(s).\x1b[0m`);
    process.exit(1);
  } else {
    console.log(`\n\x1b[32mAll command parameters are properly consumed. No issues found.\x1b[0m`);
    process.exit(0);
  }
}

main();
