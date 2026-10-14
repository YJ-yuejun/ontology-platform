import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { candidateErrors, createTask, inspectObjects, launchBuild, readTasks, sampleCandidate, TASK_STORAGE, writeTask } from '../src/buildConversation.js';

const ontology = { id: 'pipeline', name: '管网本体', version: '1.1.0' };
const object = { id: 'segment', display_name: '管段', name: 'PipeSegment', title_property: 'id', properties: [{ key: 'id', name: '管段编号', is_primary_key: true }] };
let memory;
beforeEach(() => {
  memory = new Map();
  globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  globalThis.window = { dispatchEvent: () => {} };
  globalThis.fetch = () => { throw new Error('Prototype helpers must not make network writes or LLM calls'); };
});

test('new ontology tasks do not inherit the active ontology', () => {
  const t = createTask({ mode: 'create', ontology });
  assert.equal(t.ontologyId, '');
  assert.equal(t.status, 'ready');
  assert.deepEqual(t.candidates, []);
  assert.match(t.composer, /^@本体建模助手/);
});
test('object entry carries exact ontology, resource and return path', () => {
  const t = createTask({ ontology, resource: object, returnTo: '/ontology/model/object-types' });
  assert.equal(t.ontologyId, ontology.id);
  assert.equal(t.resourceId, object.id);
  assert.match(t.composer, /不修改其他对象/);
  assert.equal(t.returnTo, '/ontology/model/object-types');
});
test('jump does not send the prefilled instruction', () => {
  let route;
  launchBuild((value) => { route = value; }, { ontology });
  assert.match(route, /^\/chat\?task=/);
  assert.deepEqual(readTasks()[0].messages, []);
});
test('task updates preserve the other ontology sessions', () => {
  const first = createTask({ ontology });
  const second = createTask({ ontology: { id: 'procurement', name: '采购财务' } });
  writeTask({ ...first, goal: '仅修改管段' });
  assert.equal(readTasks().length, 2);
  assert.equal(readTasks().find((t) => t.id === second.id).ontologyId, 'procurement');
  assert.equal(readTasks().find((t) => t.id === first.id).goal, '仅修改管段');
});
test('sample property proposal has provenance disclaimer and no source mutation', () => {
  const before = JSON.stringify(object);
  const t = createTask({ ontology, resource: object });
  const c = sampleCandidate(t, [object]);
  assert.equal(c.kind, 'property');
  assert.equal(c.baseline, before);
  assert.match(c.basis, /不是从附件抽取/);
  assert.deepEqual(candidateErrors(c, [object]), []);
  assert.equal(JSON.stringify(object), before);
});
test('deleted target never silently becomes a new object', () => {
  const t = createTask({ ontology, resource: object });
  assert.throws(() => sampleCandidate(t, []), /不存在/);
});
test('duplicate keys, missing names and invalid enum choices are blocked', () => {
  const c = sampleCandidate(createTask({ ontology, resource: object }), [object]);
  c.after = { key: 'id', name: '', type: 'enum', options: [] };
  const errors = candidateErrors(c, [object]);
  assert.equal(errors.length, 3);
  assert.match(errors.join(' '), /已存在/);
  c.after.key = '错误字段';
  assert.match(candidateErrors(c, [object]).join(' '), /英文字母/);
});
test('new object identifiers must be valid and non-duplicated', () => {
  const c = sampleCandidate(createTask({ mode: 'create' }), []);
  c.after.name = object.name;
  assert.match(candidateErrors(c, [object]).join(' '), /已存在/);
  c.after.name = 'lowercase';
  assert.match(candidateErrors(c).join(' '), /大写/);
});
test('checks are deterministic, read-only and flag actual structural issues', () => {
  assert.deepEqual(inspectObjects([object]), []);
  const invalid = { ...object, title_property: 'missing', properties: [{ key: 'id' }, { key: 'id' }] };
  const before = JSON.stringify(invalid);
  const issues = inspectObjects([invalid]);
  assert.equal(issues.length, 3);
  assert.equal(JSON.stringify(invalid), before);
});
test('storage failure prevents a false successful navigation', () => {
  localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  let route = ''; let error = '';
  launchBuild((v) => { route = v; }, { ontology }, (v) => { error = v; });
  assert.equal(route, '');
  assert.match(error, /无法保存/);
});
test('corrupted history is reported, not silently overwritten', () => {
  memory.set(TASK_STORAGE, '{bad json');
  assert.throws(readTasks);
  assert.throws(() => createTask({ ontology }));
  assert.equal(memory.get(TASK_STORAGE), '{bad json');
});
