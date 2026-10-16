import test from 'node:test';
import assert from 'node:assert/strict';
import { manualEntry, nextModelingStep, RESOURCE_KINDS, validateOntologyIdentity } from '../src/modelingFlow.js';
import { createTask, sampleCandidate } from '../src/buildConversation.js';

test('ontology identity validation rejects whitespace and duplicate namespace before creation', () => {
  assert.match(validateOntologyIdentity({ name: '  ', namespace: 'enterprise.new' }), /名称/);
  assert.match(validateOntologyIdentity({ name: '示例', namespace: '错误' }), /命名空间/);
  assert.match(validateOntologyIdentity({ name: '示例', namespace: ' enterprise.same ' }, [{ namespace: 'enterprise.same' }]), /已存在/);
  assert.equal(validateOntologyIdentity({ name: '示例', namespace: 'enterprise.new' }), '');
});
test('new manual model progresses through domain, subject and object without forcing every resource', () => {
  assert.match(nextModelingStep({}).route, /domains\?create=1$/);
  assert.match(nextModelingStep({ business_domains: 1 }).route, /kind=subject/);
  assert.match(nextModelingStep({ business_domains: 1, subject_domains: 1 }).route, /object-types\?create=1/);
  assert.equal(nextModelingStep({ business_domains: 1, subject_domains: 1, object_types: 1 }).route, undefined);
});
test('manual create opens editor, manual update opens catalog', () => {
  for (const { id, route } of RESOURCE_KINDS) {
    assert.equal(manualEntry({ intent: 'create_resource', type: id, ontology: { id: 'a', status: 'draft' }, objectCount: 5 }).route, route + '?create=1');
    assert.equal(manualEntry({ intent: 'update', type: id, ontology: { id: 'a', status: 'draft' }, objectCount: 5 }).route, route);
  }
});
test('missing objects and classifications give actionable destinations, not disabled dead ends', () => {
  const ontology = { id: 'a', status: 'draft', business_domain_count: 0, subject_domain_count: 0 };
  assert.equal(manualEntry({ intent: 'create_resource', type: 'link_type', ontology }).prerequisite, 'classification');
  assert.match(manualEntry({ intent: 'create_resource', type: 'object_type', ontology }).route, /domains/);
  const configured = { ...ontology, business_domain_count: 1, subject_domain_count: 1 };
  assert.match(manualEntry({ intent: 'create_resource', type: 'action', ontology: configured }).route, /object-types/);
});
test('frozen and published ontologies go to governance before manual writes', () => {
  for (const status of ['published', 'in_review', 'reviewed']) {
    const result = manualEntry({ intent: 'create_resource', type: 'object_type', ontology: { id: 'a', status } });
    assert.equal(result.governance, true);
    assert.equal(result.route, '/ontology/governance');
  }
});
test('initial AI conversation binds to the ontology just created, never creates another', () => {
  let saved = '[]';
  globalThis.localStorage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  globalThis.window = { dispatchEvent: () => {} };
  const ontology = { id: 'fresh', name: '巡检', namespace: 'enterprise.inspection', description: '设备巡检业务范围' };
  const task = createTask({ mode: 'update', purpose: 'initialize', ontology });
  assert.equal(task.ontologyId, ontology.id);
  assert.equal(task.newOntology.description, ontology.description);
  assert.match(task.composer, /不重复创建本体/);
  assert.match(task.composer, /设备巡检业务范围/);
  assert.deepEqual(task.messages, []);
});
test('new relationship request retains resource type and does not emit an unrelated object proposal', () => {
  const task = createTask({ mode: 'update', purpose: 'create_resource', resourceType: 'link_type', ontology: { id: 'a', name: '管网' } });
  assert.equal(task.resourceType, 'link_type');
  assert.match(task.composer, /新建关系类型/);
  assert.throws(() => sampleCandidate(task, []), /不能用对象示例替代/);
});
