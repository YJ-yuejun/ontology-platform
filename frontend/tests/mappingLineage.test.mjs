import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAggregateLineage, buildMappingLineage } from '../src/mappingLineage.js';

test('direct mapping links a physical table column to the object property without a governance node', () => {
  const graph = buildMappingLineage({
    sources: [{ code: 'SRC-PAY', name: '财务共享平台', physical_object: 'finance.payment_request' }],
    objects: [{ name: 'PaymentRequest', display_name: '付款申请', business_domain_code: 'finance', business_domain_name: '财务管理域',
      properties: [{ key: 'amount', name: '申请金额', type: 'decimal' }] }],
    links: [],
    mappings: [{ id: 'map-1', code: 'MAP-DIR-1', name: '付款金额', mapping_type: 'property', binding_mode: 'direct',
      source_code: 'SRC-PAY', source_table: 'payment_request', source_field: 'AMOUNT', target_object_type: 'PaymentRequest', target_property: 'amount' }],
  });
  assert.equal(graph.nodes.length, 3);
  assert.deepEqual(new Set(graph.nodes.map((node) => node.layer)), new Set(['physical', 'semantic']));
  assert.equal(graph.nodes.some((node) => node.id.startsWith('asset:')), false);
  assert.equal(graph.nodes.find((node) => node.kind === 'column').label, 'payment_request.AMOUNT');
  assert.equal(graph.nodes.find((node) => node.kind === 'property').label, '申请金额\n付款申请 · amount');
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].kind, 'property');
  assert.equal(graph.edges[0].from, 'physical:column:SRC-PAY:payment_request:AMOUNT');
  assert.equal(graph.edges[0].to, 'semantic:property:PaymentRequest:amount');
});

test('a legacy governed mapping is expanded to its upstream physical field and never renders the governance asset', () => {
  const graph = buildMappingLineage({
    sources: [{ code: 'DS-001', name: '调度系统', physical_object: '运输任务接口/表' }],
    assets: [{ id: 'asset-1', code: 'GOV-TASK', name: '治理运输任务', upstream_source_code: 'DS-001', upstream_object: 'TASK', fields: [{ name: 'TASK_ID' }] }],
    objects: [{ name: 'TransportTask', display_name: '运输任务', properties: [{ key: 'taskId', name: '任务编号' }] }], links: [],
    mappings: [{ id: 'map-old', code: 'M-010', mapping_type: 'property', binding_mode: 'governed', governance_asset_code: 'GOV-TASK', governance_field: 'TASK_ID', target_object_type: 'TransportTask', target_property: 'taskId' }],
  });
  assert.equal(graph.nodes.some((node) => node.id.startsWith('asset:')), false);
  assert.equal(graph.nodes.filter((node) => node.layer === 'physical').length, 2);
  assert.equal(graph.nodes.find((node) => node.kind === 'column').label, 'TASK.TASK_ID');
  assert.equal(graph.edges[0].from, 'physical:column:DS-001:TASK:TASK_ID');
  assert.equal(graph.edges[0].to, 'semantic:property:TransportTask:taskId');
});

test('relation mappings connect every registered source column to the relation target', () => {
  const graph = buildMappingLineage({
    sources: [{ code: 'SRC-WAREHOUSE', name: '仓储与收货系统' }],
    objects: [
      { id: 'o1', name: 'PurchaseOrder', display_name: '采购订单', properties: [] },
      { id: 'o2', name: 'GoodsReceipt', display_name: '收货单', properties: [] },
    ],
    links: [{ id: 'l1', name: 'order_receives_goods', display_name: '收货记录', source_object_type_id: 'o1', target_object_type_id: 'o2' }],
    mappings: [{ id: 'map-rel', code: 'MAP-REL-1', mapping_type: 'relation', binding_mode: 'direct',
      source_code: 'SRC-WAREHOUSE', source_table: 'goods_receipt', source_field: 'ORDER_ID/RECEIPT_ID',
      target_relation: 'order_receives_goods' }],
  });
  assert.equal(graph.nodes.filter((node) => node.kind === 'column').length, 2);
  assert.equal(graph.nodes.filter((node) => node.kind === 'relation').length, 1);
  assert.equal(graph.edges.length, 2);
  assert.deepEqual(new Set(graph.edges.map((edge) => edge.to)), new Set(['semantic:relation:order_receives_goods']));
});

test('domain and source filters narrow the graph before nodes are created', () => {
  const objects = [
    { name: 'PaymentRequest', display_name: '付款申请', business_domain_code: 'finance', properties: [{ key: 'amount', name: '金额' }] },
    { name: 'GoodsReceipt', display_name: '收货单', business_domain_code: 'procurement', properties: [{ key: 'receiptId', name: '收货单号' }] },
  ];
  const mappings = [
    { id: 'm1', code: 'M1', mapping_type: 'property', binding_mode: 'direct', source_code: 'SRC-PAY', source_table: 'payment_request', source_field: 'AMOUNT', target_object_type: 'PaymentRequest', target_property: 'amount' },
    { id: 'm2', code: 'M2', mapping_type: 'property', binding_mode: 'direct', source_code: 'SRC-WH', source_table: 'goods_receipt', source_field: 'RECEIPT_ID', target_object_type: 'GoodsReceipt', target_property: 'receiptId' },
  ];
  const graph = buildMappingLineage({ sources: [], objects, mappings, filter: { domain: 'finance' } });
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].record.code, 'M1');
});


test('object view aggregates fields into table→object edges and keeps relations distinct', () => {
  const graph = buildAggregateLineage({
    sources: [{ code: 'SRC-PAY', name: '财务共享平台' }],
    objects: [{ id: 'pay', name: 'PaymentRequest', display_name: '付款申请', business_domain_name: '财务管理域',
      properties: [{ key: 'payment_no', name: '付款单号' }, { key: 'status', name: '付款状态' }] },
    { id: 'contract', name: 'Contract', display_name: '采购合同', properties: [] }],
    links: [{ id: 'l1', name: 'payment_based_on_contract', display_name: '基于合同付款',
      source_object_type_id: 'pay', target_object_type_id: 'contract', source_display_name: '付款申请', target_display_name: '采购合同' }],
    mappings: [
      { id: 'm1', code: 'M1', mapping_type: 'property', binding_mode: 'direct', source_code: 'SRC-PAY', source_table: 'payment_request', source_field: 'PAYMENT_NO', target_object_type: 'PaymentRequest', target_property: 'payment_no' },
      { id: 'm2', code: 'M2', mapping_type: 'property', binding_mode: 'direct', source_code: 'SRC-PAY', source_table: 'payment_request', source_field: 'STATUS', target_object_type: 'PaymentRequest', target_property: 'status' },
      { id: 'm3', code: 'M3', mapping_type: 'relation', binding_mode: 'direct', source_code: 'SRC-PAY', source_table: 'payment_request', source_field: 'CONTRACT_ID', target_relation: 'payment_based_on_contract' },
    ],
  });
  assert.equal(graph.nodes.filter((node) => node.kind === 'column').length, 0);
  assert.equal(graph.nodes.filter((node) => node.kind === 'property').length, 0);
  assert.equal(graph.nodes.filter((node) => node.kind === 'object').length, 1);
  assert.equal(graph.nodes.filter((node) => node.kind === 'relation').length, 1);
  const propertyEdge = graph.edges.find((edge) => edge.target.kind === 'property');
  assert.equal(propertyEdge.label, '2 个字段');
  assert.equal(propertyEdge.fieldCount, 2);
  assert.equal(propertyEdge.mappingCount, 2);
  assert.equal(propertyEdge.entries.length, 2);
  const relationEdge = graph.edges.find((edge) => edge.target.kind === 'relation');
  assert.equal(relationEdge.kind, 'aggregateRelation');
  assert.match(graph.nodes.find((node) => node.kind === 'relation').label, /^关系 · /);
  assert.equal(graph.mappingCount, 3);
});

test('object view respects table filters before grouping', () => {
  const objects = [{ name: 'PaymentRequest', display_name: '付款申请', properties: [{ key: 'amount', name: '金额' }] }];
  const mappings = [
    { id: 'm1', code: 'M1', mapping_type: 'property', binding_mode: 'direct', source_code: 'SRC-PAY', source_table: 'payment_request', source_field: 'AMOUNT', target_object_type: 'PaymentRequest', target_property: 'amount' },
    { id: 'm2', code: 'M2', mapping_type: 'property', binding_mode: 'direct', source_code: 'SRC-PAY', source_table: 'payment_plan', source_field: 'PLAN_AMOUNT', target_object_type: 'PaymentRequest', target_property: 'amount' },
  ];
  const graph = buildAggregateLineage({ sources: [], objects, mappings, filter: { table: 'payment_plan' } });
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].table, 'payment_plan');
});
