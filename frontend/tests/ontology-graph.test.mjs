import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeVisual, escapeLabel, graphScope, nodeVisual, subjectColorMap, SUBJECT_PALETTE, UNCLASSIFIED } from '../src/ontologyGraph.js';
import { flattenProperties, propertyMappingStatus, propertyPeers } from '../src/propertyCatalog.js';

const objects = [
  { id: 'a', name: 'Contract', display_name: '合同', business_domain_id: 'd1', subject_domain_id: 's1', is_core: true, properties: [{ key: 'id', name: '编号', type: 'string', is_primary_key: true }, { key: 'amount', name: '金额', type: 'decimal' }] },
  { id: 'b', name: 'Supplier', display_name: '供应商', business_domain_id: 'd1', subject_domain_id: 's2', properties: [{ key: 'id', name: '编号', type: 'integer', is_primary_key: true }] },
  { id: 'c', name: 'Invoice', display_name: '发票', business_domain_id: 'd2', subject_domain_id: 's3', properties: [{ key: 'label', name: '展示名', type: 'string', property_category: '计算属性' }] },
  { id: 'd', name: 'Loose', display_name: '未分类对象', properties: [] },
];
const links = [
  { id: 'ab', source_object_type_id: 'a', target_object_type_id: 'b', display_name: '签约', cardinality: 'many_to_one' },
  { id: 'ac', source_object_type_id: 'a', target_object_type_id: 'c', display_name: '开票', cardinality: 'one_to_many' },
];

test('business domain filter keeps internal links and shows cross-domain neighbours as context', () => {
  const scope = graphScope({ objects, links, domainIds: new Set(['d1']), showCross: true });
  assert.deepEqual([...scope.inScope].sort(), ['a', 'b']);
  assert.deepEqual([...scope.context], ['c']);
  assert.equal(scope.edges.get('ab'), 'internal');
  assert.equal(scope.edges.get('ac'), 'cross');

  const isolated = graphScope({ objects, links, domainIds: new Set(['d1']), showCross: false });
  assert.equal(isolated.context.size, 0);
  assert.equal(isolated.edges.get('ac'), 'hidden');
});

test('unclassified objects can be filtered as their own domain', () => {
  const scope = graphScope({ objects, links, domainIds: new Set([UNCLASSIFIED]) });
  assert.deepEqual([...scope.inScope], ['d']);
});

test('core-only and neighbour focus narrow the scope', () => {
  assert.deepEqual([...graphScope({ objects, links, coreOnly: true }).inScope], ['a']);
  const focus = graphScope({ objects, links, focusId: 'b', showCross: true });
  assert.deepEqual([...focus.inScope].sort(), ['a', 'b']);
  assert.equal(focus.context.size, 0, '关联聚焦时不再额外展开跨域上下文');
});

test('subject colours are stable per subject and core objects are emphasised', () => {
  const colors = subjectColorMap([{ id: 's1' }, { id: 's2' }]);
  assert.equal(colors.get('s1'), SUBJECT_PALETTE[0]);
  assert.equal(colors.get('s2'), SUBJECT_PALETTE[1]);
  const core = nodeVisual(objects[0], { color: colors.get('s1') });
  const plain = nodeVisual(objects[1], { color: colors.get('s2') });
  assert.ok(core.borderWidth > plain.borderWidth);
  assert.ok(core.font.bold.size > plain.font.bold.size);
  assert.match(core.label, /★/);
  const dim = nodeVisual(objects[1], { color: colors.get('s2'), emphasis: 'dim' });
  assert.match(dim.color.background, /^rgba\(.+0\.3\)$/);
  assert.equal(nodeVisual(objects[1], { hidden: true }).physics, false);
});

test('labels escape html markup and hidden relation names keep a placeholder', () => {
  assert.equal(escapeLabel('<b>A&B</b>'), '&lt;b>A&amp;B&lt;/b>');
  assert.equal(edgeVisual(links[0], { showLabels: false }).label, ' ');
  assert.equal(edgeVisual(links[0]).label, '签约  N:1');
  assert.equal(edgeVisual(links[1], { state: 'cross' }).dashes, true);
});

test('property catalog flattens properties with mapping state and shared-key conflicts', () => {
  const mappings = [
    { mapping_type: 'property', target_object_type: 'Contract', target_property: 'amount', binding_mode: 'governed', design_status: '已确认' },
    { mapping_type: 'property', target_object_type: 'Contract', target_property: 'id', binding_mode: 'governed', design_status: '设计中' },
  ];
  const rows = flattenProperties(objects, mappings);
  assert.equal(rows.length, 4);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId['a:amount'].mapping, 'confirmed');
  assert.equal(byId['a:id'].mapping, 'pending');
  assert.equal(byId['b:id'].mapping, 'unmapped');
  assert.equal(byId['c:label'].mapping, 'not_required');
  assert.equal(byId['a:id'].sharedCount, 2);
  assert.equal(byId['a:id'].typeConflict, true);
  assert.equal(byId['a:amount'].typeConflict, false);
  assert.deepEqual(propertyPeers(rows, byId['a:id']).map((row) => row.object.id), ['b']);
  assert.equal(propertyMappingStatus(objects[2], objects[2].properties[0], []), 'not_required');
});
