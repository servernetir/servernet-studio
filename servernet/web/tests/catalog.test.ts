// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import {filterModels, readModels, supportsStudio} from '../src/catalog.ts';

test('shared catalogue retains input-only operations and exact variant IDs in name order', () => {
  const models = readModels({data: [
    {id:'or-z', name:'Zeta', category:'chat'},
    {id:'di-v2', name:'Vector 2', category:'embedding'},
    {id:'or-v10', name:'Vector 10', category:'embedding'},
    {id:'rank', name:'Alpha', category:'rerank'},
    {id:'di-z', name:'Zeta', category:'chat'},
  ]});
  assert.deepEqual(models.map(model => model.id), ['rank','di-v2','or-v10','di-z','or-z']);
  assert.equal(models.filter(model => model.label === 'Zeta').length, 2);
  assert.deepEqual(filterModels(models, ' VECTOR ', 'embedding').map(model => model.id), ['di-v2','or-v10']);
  assert.deepEqual(filterModels(models, 'di-v2').map(model => model.id), ['di-v2']);
  assert.equal(filterModels(models, '', 'rerank').length, 1);
  assert.equal(supportsStudio(models[0]), false);
  assert.equal(supportsStudio(models[1]), false);
  assert.equal(supportsStudio(models[3]), true);
});
