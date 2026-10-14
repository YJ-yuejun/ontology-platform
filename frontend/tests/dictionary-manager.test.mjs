import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';

const source = readFileSync(new URL('../src/components/DictionaryManager.jsx', import.meta.url), 'utf8');
const traverse = typeof traverseModule === 'function' ? traverseModule : traverseModule.default;

test('dictionary form has no unbound runtime identifiers', () => {
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const browserAndLanguageGlobals = new Set([
    'window', 'document', 'CustomEvent', 'Set', 'Map', 'Promise', 'JSON', 'Boolean', 'Number',
  ]);
  const missing = [];
  traverse(ast, {
    ReferencedIdentifier(path) {
      if (!browserAndLanguageGlobals.has(path.node.name) && !path.scope.hasBinding(path.node.name)) {
        missing.push(path.node.name);
      }
    },
  });
  assert.deepEqual(missing, []);
});
