import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

test('chat route renders capability, scope entry and disabled unbound composer without a browser', async () => {
  const compiled = await build({
    stdin: {
      contents: `import React from 'react';
        import { renderToString } from 'react-dom/server';
        import { StaticRouter } from 'react-router-dom/server';
        import BuildChat from './src/pages/BuildChat.jsx';
        export const html = renderToString(<StaticRouter location="/chat"><BuildChat active={{id:'pipe', name:'管网本体'}} ontologies={[]} chooseOntology={()=>{}} notify={()=>{}} /></StaticRouter>);`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx',
    },
    write: false, bundle: true, format: 'cjs', platform: 'node', packages: 'external',
    jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const context = { module: { exports: {} }, require: createRequire(import.meta.url), window: { innerWidth: 1440 }, URLSearchParams, console };
  vm.runInNewContext(compiled.outputFiles[0].text, context);
  const html = context.module.exports.html;
  assert.match(html, /本体建模助手/);
  assert.match(html, /ontology-creator/);
  assert.match(html, /从资料创建本体/);
  assert.match(html, /管网本体/);
  assert.match(html, /文件内容未上传/);
  assert.match(html, /<textarea[^>]*disabled/);
});
