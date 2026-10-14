import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestPropertyMappings } from '../src/mappingSuggestions.js';

const object = { name: 'TransportTask', properties: [
  { key: 'taskId', name: '任务编号', is_primary_key: true },
  { key: 'status', name: '当前状态' },
  { key: 'riskLevel', name: '风险等级' },
] };
const table = { name: 'transport_task', columns: [
  { name: 'TASK_ID', data_type: 'varchar', key: 'PRI' },
  { name: 'STATUS', data_type: 'varchar' },
  { name: 'unknown', data_type: 'varchar' },
] };

test('suggestions use only structural name evidence and leave unmatched properties out', () => {
  const result = suggestPropertyMappings({ object, table, sourceCode: 'DS-001' });
  assert.deepEqual(result.map((item) => [item.property.key, item.column.name]), [
    ['taskId', 'TASK_ID'], ['status', 'STATUS'],
  ]);
  assert.ok(result.every((item) => item.score === 1));
});

test('existing mappings are not suggested again', () => {
  const result = suggestPropertyMappings({ object, table, sourceCode: 'DS-001', existingMappings: [
    { mapping_type: 'property', source_code: 'DS-001', source_table: 'transport_task',
      target_object_type: 'TransportTask', target_property: 'taskId' },
  ] });
  assert.deepEqual(result.map((item) => item.property.key), ['status']);
});

test('without a selected source and table there are no guessed mappings', () => {
  assert.deepEqual(suggestPropertyMappings({ object, table, sourceCode: '' }), []);
  assert.deepEqual(suggestPropertyMappings({ object, table: null, sourceCode: 'DS-001' }), []);
});
