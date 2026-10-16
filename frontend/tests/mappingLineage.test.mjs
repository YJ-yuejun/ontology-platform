import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMappingLineage } from '../src/mappingLineage.js';

test('governed lineage uses a real middle asset and legacy rows stay dashed direct edges', () => {
  const graph = buildMappingLineage({
    sources: [{ code: 'DS-001', name: '调度系统' }],
    assets: [{ id: 'asset-1', code: 'GOV-TASK', name: '治理运输任务', upstream_source_code: 'DS-001', upstream_object: 'TASK', fields: [{ name: 'task_id' }] }],
    objects: [{ name: 'TransportTask', display_name: '运输任务' }], links: [],
    mappings: [
      { id: 'map-new', code: 'M-010', mapping_type: 'property', binding_mode: 'governed', governance_asset_code: 'GOV-TASK', governance_field: 'task_id', target_object_type: 'TransportTask' },
      { id: 'map-old', code: 'M-001', mapping_type: 'property', source_code: 'DS-001', source_table: 'TASK', source_field: 'TASK_ID', target_object_type: 'TransportTask' },
    ],
  });
  assert.equal(graph.nodes.length, 3);
  assert.deepEqual(new Set(graph.edges.map((edge) => edge.kind)), new Set(['upstream', 'governed', 'legacy']));
  assert.equal(graph.edges.find((edge) => edge.kind === 'governed').from, 'asset:GOV-TASK');
  assert.equal(graph.edges.find((edge) => edge.kind === 'legacy').from, 'physical:DS-001:TASK');
});

test('an enterprise-catalog asset without recorded physical lineage does not invent an upstream edge', () => {
  const graph = buildMappingLineage({ assets: [{ id: 'asset-2', code: 'GOV-C', name: '治理合同' }],
    objects: [{ name: 'Contract', display_name: '合同' }],
    mappings: [{ id: 'map-2', code: 'M-011', binding_mode: 'governed', mapping_type: 'property', governance_asset_code: 'GOV-C', governance_field: 'id', target_object_type: 'Contract' }] });
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].kind, 'governed');
  assert.equal(graph.nodes.some((node) => node.layer === 'physical'), false);
});
