import test from 'node:test';
import assert from 'node:assert/strict';
import { governanceFieldCandidates, objectMappingState } from '../src/objectMapping.js';

test('governance asset fields provide technical candidates without inventing business names', () => {
  const candidates = governanceFieldCandidates([
    { name: 'contract_no', data_type: 'varchar(40)', is_key: true },
    { name: 'contract_no', data_type: 'bigint' },
    { name: '启用状态', data_type: 'boolean' },
  ]);
  assert.deepEqual(candidates.map(({ sourceField, candidateType, candidateKey }) => ({ sourceField, candidateType, candidateKey })), [
    { sourceField: 'contract_no', candidateType: 'string', candidateKey: 'contract_no' },
    { sourceField: 'contract_no', candidateType: 'integer', candidateKey: 'contract_no_2' },
    { sourceField: '启用状态', candidateType: 'boolean', candidateKey: 'field3' },
  ]);
  assert.equal('name' in candidates[0], false);
});

test('object mapping state reflects saved mapping rows only', () => {
  const object = {
    name: 'PurchaseContract',
    properties: [
      { key: 'contractId', property_category: '标识属性' },
      { key: 'amount', property_category: '业务属性' },
      { key: 'displayLabel', property_category: '计算属性' },
    ],
  };
  const mapping = (target_property, extra = {}) => ({
    mapping_type: 'property', target_object_type: object.name, target_property,
    binding_mode: 'governed', design_status: '已确认', ...extra,
  });

  const unboundState = objectMappingState(object, []);
  assert.equal(unboundState.label, '未绑定');
  assert.equal(unboundState.mappedCount, 0);
  assert.equal(unboundState.requiredCount, 2);

  const partialState = objectMappingState(object, [mapping('amount')]);
  assert.equal(partialState.label, '部分映射');
  assert.equal(partialState.mappedCount, 1);
  assert.equal(partialState.requiredCount, 2);

  const completeState = objectMappingState(object, [mapping('contractId'), mapping('amount')]);
  assert.equal(completeState.label, '已确认');
  assert.equal(completeState.mappedCount, 2);
  assert.equal(completeState.requiredCount, 2);

  const conflictingState = objectMappingState(object, [mapping('amount', { design_status: '设计中', status: 'active' })]);
  assert.equal(conflictingState.label, '待确认');
  assert.equal(conflictingState.pendingCount, 1);
  assert.equal(objectMappingState(object, [mapping('amount', { design_status: '', status: 'active' })]).label, '部分映射');
  assert.equal(objectMappingState(object, [mapping('amount', { binding_mode: 'physical', status: 'active' })]).label, '待确认');
  assert.equal(objectMappingState(object, [{ mapping_type: 'relation', target_object_type: object.name }]).label, '未绑定');
  assert.equal(objectMappingState(object, [mapping('missing')]).label, '待确认');
});

test('computed properties do not require source mappings', () => {
  const object = { name: 'CalculatedView', properties: [{ key: 'summary', property_category: '计算属性' }] };
  const state = objectMappingState(object, []);
  assert.equal(state.label, '无需映射');
  assert.equal(state.mappedCount, 0);
  assert.equal(state.requiredCount, 0);
});
