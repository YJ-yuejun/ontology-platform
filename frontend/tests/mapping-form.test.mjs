import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { changeMappingType, mappingKeyLabel, mappingSourceKind, mappingTargetPayload, relationDefaultKey, relationKeyMode, resetMappingSource, selectMappingRelation, setMappingSourceField, sourceKindForLocation, suggestObjectKey } from '../src/mappingForm.js';

const objects = [
  { id: 'task', name: 'Task', display_name: '运输任务', properties: [{ key: 'taskId', name: '任务编号', is_primary_key: true }, { key: 'status', name: '状态' }] },
  { id: 'pipe', name: 'Pipe', display_name: '管段', properties: [{ key: 'pressure', name: '当前压力' }] },
];
const relation = { id: 'link', name: 'passes_through', display_name: '经过', source_object_type_id: 'task', target_object_type_id: 'pipe', source_key: 'TASK_ID', target_key: 'PIPE_ID' };

test('source carrier is independent of mapping type, including both workbook counterexamples', () => {
  assert.equal(mappingSourceKind({ mapping_type: 'property', source_table: '实时接口' }, { interface_type: '实时接口' }), 'api');
  assert.equal(mappingSourceKind({ mapping_type: 'relation', source_table: '任务线路明细' }, { interface_type: '接口/数据库' }), 'table');
  assert.equal(mappingSourceKind({ mapping_type: 'relation', source_kind: 'api' }, { driver: 'mysql' }), 'api');
  assert.equal(sourceKindForLocation('任务线路明细', { interface_type: '接口/数据库' }, [{ name: '任务线路明细' }], 'api'), 'table');
  assert.equal(sourceKindForLocation('实时接口', { interface_type: '接口/数据库' }, [], 'table'), 'api');
});

test('selecting a relation fills its declared keys and source-field edits preserve them', () => {
  const selected = selectMappingRelation({ mapping_type: 'relation' }, relation);
  assert.equal(selected.target_relation, relation.name);
  assert.equal(selected.source_key, 'TASK_ID+PIPE_ID');
  assert.equal(selected.source_field, '');
  const form = setMappingSourceField(selected, 'TASK_ID/PIPE_ID');
  assert.equal(form.source_field, 'TASK_ID/PIPE_ID');
  assert.equal(form.source_key, 'TASK_ID+PIPE_ID');
  const payload = mappingTargetPayload(form);
  assert.equal(payload.target_property, '');
  assert.equal(payload.source_key, 'TASK_ID+PIPE_ID');
  assert.deepEqual(payload.relation_field_bindings, []);
  assert.equal(setMappingSourceField(form, 'TASK_ID/SEGMENT_ID').source_key, 'TASK_ID+PIPE_ID');
  assert.equal(setMappingSourceField({ ...form, source_key: 'CUSTOM_KEY' }, 'TASK_ID/SEGMENT_ID').source_key, 'CUSTOM_KEY');
  const edited = { ...form, source_key: 'CUSTOM_KEY' };
  assert.equal(selectMappingRelation(edited, relation), edited);
  assert.equal(relation.source_key, 'TASK_ID');
  assert.equal(relation.target_key, 'PIPE_ID');
});

test('a different relation replaces old mapping dependencies and incomplete keys are not invented', () => {
  const old = { mapping_type: 'relation', target_relation: relation.name, source_key: 'CUSTOM_KEY', source_field: 'TASK_ID/PIPE_ID', quality_rule: 'old', transform_rule: 'old', design_status: '已确认' };
  const next = selectMappingRelation(old, { ...relation, name: 'starts_at', target_key: 'STATION_ID' });
  assert.equal(next.source_key, 'TASK_ID+STATION_ID');
  assert.equal(next.source_field, '');
  assert.equal(next.quality_rule, '');
  assert.equal(next.design_status, '设计中');
  assert.equal(relationDefaultKey({ source_key: 'TASK_ID', target_key: '-' }), '');
  assert.equal(selectMappingRelation(old, { ...relation, name: 'incomplete', target_key: '' }).source_key, '');
  const sourceChanged = resetMappingSource(old, { source_table: '新来源' }, relation);
  assert.equal(sourceChanged.source_key, 'TASK_ID+PIPE_ID');
  assert.equal(sourceChanged.source_field, '');
});

test('type and source changes cannot retain stale relation keys or targets', () => {
  const relationForm = { code: 'M-004', owner: '示例负责人', update_method: 'realtime', quality_rule: '两端对象均存在', transform_rule: 'old', design_status: '已确认', mapping_type: 'relation', target_relation: 'passes_through', source_code: 'DS-001', source_table: '任务线路明细', source_kind: 'table', source_field: 'TASK_ID/PIPE_ID', source_key: 'TASK_ID+PIPE_ID', target_key: 'old', relation_field_bindings: [{ field: 'TASK_ID' }] };
  const property = changeMappingType(relationForm, 'property');
  assert.equal(property.target_relation, '');
  assert.equal(property.source_key, '');
  for (const key of ['source_table', 'source_field', 'transform_rule', 'quality_rule']) assert.equal(property[key], '');
  for (const key of ['code', 'owner', 'update_method', 'source_code']) assert.equal(property[key], relationForm[key]);
  assert.equal(property.map_way, 'direct');
  assert.equal(property.design_status, '设计中');
  assert.equal(changeMappingType({ ...property, target_object_type: 'Task', target_property: 'status' }, 'relation').target_property, '');
  assert.equal(changeMappingType(property, 'relation').map_way, 'link');
  assert.deepEqual(property.relation_field_bindings, []);
  assert.equal(property.source_kind, 'table');
  assert.equal(resetMappingSource(relationForm, { source_table: 'new' }).target_key, '');
});

test('existing cross-table joins preserve both keys and do not become composite-key mappings', () => {
  const old = { mapping_type: 'relation', source_field: 'contract_id', source_key: 'payment.contract_id', target_key: 'contract.contract_id' };
  assert.equal(relationKeyMode(old), 'join');
  const form = { ...old, source_key: mappingKeyLabel(old), target_key: '' };
  assert.equal(form.source_field, 'contract_id');
  assert.equal(form.source_key, 'payment.contract_id = contract.contract_id');
  assert.equal(mappingTargetPayload(form).source_key, old.source_key);
  assert.equal(mappingTargetPayload(form).target_key, old.target_key);
});

test('object identity never defaults to the mapped non-key field or an unrelated table PK', () => {
  const form = { mapping_type: 'property', target_object_type: 'Task', target_property: 'status', source_code: 'DS-001', source_table: '任务表', source_field: 'STATUS' };
  assert.equal(suggestObjectKey(form, objects[0], []), '');
  const known = { ...form, target_property: 'taskId', source_field: 'TASK_ID', map_way: 'direct' };
  assert.equal(suggestObjectKey(form, objects[0], [known]), 'TASK_ID');
  assert.equal(suggestObjectKey({ ...form, source_table: 'other' }, objects[0], [known]), '');
  assert.equal(suggestObjectKey(form, objects[0], [known, { ...known, source_field: 'OTHER_ID' }]), '');
});

test('relation form follows the provided fields without endpoint subforms', async () => {
  const compiled = await build({ stdin: { contents: `import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { MappingTargetFields, MappingSourceFields } from './src/components/MappingFields.jsx';
    export function render(props) { return renderToStaticMarkup(<><MappingTargetFields {...props}/><div><MappingSourceFields {...props}/></div></>); }`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' }, write: false,
    bundle: true, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic', logLevel: 'silent' });
  const context = { module: { exports: {} }, require: createRequire(import.meta.url) };
  vm.runInNewContext(compiled.outputFiles[0].text, context);
  const props = { objects, links: [relation], relation, tables: [], sources: [{ id: 'source', code: 'DS-001', name: '调度系统' }], setForm() {} };
  const property = context.module.exports.render({ ...props, form: { mapping_type: 'property', source_kind: 'api', source_table: '实时接口', target_object_type: 'Task', target_property: 'status' } });
  assert.match(property, /<span>本体对象<\/span>/);
  assert.match(property, /<span>本体属性<\/span>/);
  assert.match(property, /<span>主键<\/span>/);
  assert.match(property, /<label[^>]*>来源表<\/label>/);
  assert.doesNotMatch(property, /选择实际数据来源|aria-pressed/);
  assert.doesNotMatch(property, /本体对象\/关系|主键\/关联键|<span>本体关系<\/span>/);
  const link = context.module.exports.render({ ...props, form: { mapping_type: 'relation', source_kind: 'table', source_table: '任务线路明细', target_relation: relation.name, source_key: 'TASK_ID+PIPE_ID' } });
  assert.match(link, /<span>本体关系<\/span>/);
  assert.match(link, /<span>关联键<\/span>/);
  assert.match(link, /<label[^>]*>接口<\/label>/);
  assert.doesNotMatch(link, /选择实际数据来源|aria-pressed/);
  assert.match(link, /<span>本体属性<\/span><input readonly="" value="-"/);
  assert.doesNotMatch(link, /起点|终点|<span>主键<\/span>|来源表|来源接口/);
  const apiLink = context.module.exports.render({ ...props, form: { mapping_type: 'relation', source_kind: 'api', source_table: '线路查询接口', target_relation: relation.name } });
  assert.match(apiLink, /<label[^>]*>接口<\/label>/);
  assert.doesNotMatch(apiLink, /<span>主键<\/span>|起点|终点/);
});
