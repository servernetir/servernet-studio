// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {readModels} from '../src/catalog.ts';

test('model hub renders input-only API operations and category filtering in all three languages', async () => {
  const server = await createServer({server: {middlewareMode: true}, appType: 'custom'});
  try {
    const {ModelCatalog} = await server.ssrLoadModule('/src/workspace.tsx');
    const {workspaceCopy} = await server.ssrLoadModule('/src/copy.ts');
    const models = readModels({data: [
      {id:'vector', name:'Vector', category:'embedding', endpoint:'/v1/embeddings',
        pricing: {unit:'tokens',quantity:1_000_000,input_irt:120}},
      {id:'rank', name:'Rank', category:'rerank', endpoint:'/v1/rerank',
        pricing: {unit:'tokens',quantity:1_000_000,input_irt:240}},
    ]});
    for (const locale of ['fa','en','tr']) {
      const html = renderToStaticMarkup(React.createElement(ModelCatalog,
        {locale,models,view:'models',busy:false,choose:()=>{},rate:120000}));
      assert.ok(html.includes(workspaceCopy[locale].embedding));
      assert.ok(html.includes(workspaceCopy[locale].rerank));
      assert.ok(html.includes(workspaceCopy[locale].modelType));
      assert.ok(html.includes('/v1/embeddings'));
      assert.ok(html.includes('/v1/rerank'));
      assert.equal((html.match(/class="catalog-row"/g) || []).length, 2);
      assert.ok(!html.includes('<button'), 'API-only entries must not offer a chat or generation action');
      assert.ok(!html.includes('/v1/chat/completions'));
    }
  } finally {
    await server.close();
  }
});
