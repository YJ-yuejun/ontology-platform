import test from 'node:test';
import assert from 'node:assert/strict';
import { actionForm, actionPayload, validateActionForm, actionCategoryCode } from '../src/actionDefinition.js';
const original = { id: 'act', name: 'assign_order', external_id: 'A-1', display_name: '分派工单', action_category: '业务行动', target_object_type_id: 'order', owner: '调度', execution_logic: '分派', description: '用于处理业务', updated_at: 'stamp', parameters: [{ key: 'assignee', name: '处理人', type: 'string', is_required: true, parameter_source: 'actor_context' }, { key: 'notify', name: '通知', type: 'boolean', default: false }], preconditions: [{ expression: 'x', message: 'keep' }, { expression: 'y' }], side_effects: ['notify, audit'], result_schema: { result: '原始结果' }, definition_config: { schema_version: 1, definition_mode: 'text', vendor: { keep: 1 } } };
const dictionary = [{ code: 'business', name: '业务行动' }];
test('legacy values normalize without mutating evidence or imported conditions', () => {
 const form = actionForm(original, dictionary); const payload = actionPayload(form, original);
 assert.equal(payload.action_category, 'business'); assert.equal(actionCategoryCode('未知', dictionary), '未知');
 assert.equal(payload.expected_updated_at, 'stamp'); assert.equal(payload.description, '用于处理业务');
 assert.equal(payload.execution_logic, '分派'); assert.equal(payload.preconditions, undefined); assert.equal(payload.side_effects, undefined);
 assert.equal(payload.parameters[0].parameter_source, 'actor_context'); assert.equal(payload.parameters[1].default, false);
 assert.deepEqual(payload.definition_config.vendor, { keep: 1 }); assert.deepEqual(payload.result_schema, original.result_schema);
 assert.equal(original.parameters[0]._rowId, undefined);
});
test('parameter reorder and label changes retain stable keys and UI identifiers', () => {
 const form = actionForm(original, dictionary); const id = form.parameters[0]._rowId;
 form.parameters.reverse(); form.parameters[1].name = '新处理人'; const payload = actionPayload(form, original);
 assert.deepEqual(payload.parameters.map((p) => p.key), ['notify', 'assignee']); assert.equal(form.parameters[1]._rowId, id);
 assert.equal(payload.parameters[1]._rowId, undefined); assert.equal(payload.parameters[1].is_required, true);
});
test('defaults use declared types including zero and false and reject malformed values', () => {
 const form = actionForm(original, dictionary); form.parameters[0] = { ...form.parameters[0], type: 'integer', default: '0' };
 assert.equal(actionPayload(form).parameters[0].default, 0); form.parameters[0].default = 'abc';
 assert.match(validateActionForm(form).join(), /默认值/);
});
test('result objects, uniqueness, duplicate keys and mode-specific fields are checked', () => {
 const form = actionForm(original, dictionary); form.result_schema_text = '[]'; assert.match(validateActionForm(form).join(), /JSON 对象/);
 form.result_schema_text = '{'; assert.match(validateActionForm(form).join(), /合法 JSON/);
 form.result_schema_text = ''; form.definition_config.definition_mode = 'formula'; assert.match(validateActionForm(form).join(), /公式不能为空/);
 form.definition_config.definition_mode = 'api'; assert.match(validateActionForm(form).join(), /API 地址/);
 form.definition_config.action_mapping_code = 'M-1'; assert.doesNotMatch(validateActionForm(form).join(), /API 地址/);
 assert.match(validateActionForm(form, [original]).join(), /已存在/);
 form.parameters[1].key = form.parameters[0].key; assert.match(validateActionForm(form).join(), /重复/);
});
test('switching definition modes retains inactive configuration and raw text', () => {
 const form = actionForm(original); form.definition_config.api.request_example_text = '中文、逗号\n{not JSON}';
 form.definition_config.definition_mode = 'formula'; form.definition_config.formula.expression_text = 'quantity * price';
 assert.equal(actionPayload(form).definition_config.api.request_example_text, '中文、逗号\n{not JSON}');
 assert.deepEqual(original.definition_config, { schema_version: 1, definition_mode: 'text', vendor: { keep: 1 } });
});

import { businessActionForm, businessActionPayload, businessParameters, nextActionCode, validateBusinessAction } from '../src/actionDefinition.js';
test('business editor uses the supplied table vocabulary and generates identities without technical input', () => {
 const form = businessActionForm(null, dictionary, [{ external_id: 'A-001' }, { external_id: 'A-004' }]);
 assert.equal(form.external_id, 'A-005'); assert.equal(form.owner, '示例负责人'); assert.equal(form.design_status, 'draft');
 Object.assign(form, { display_name: '暂停运输任务', action_category: 'business', target_object_type_id: 'task', target_role: '运输任务', input_parameters_text: '任务编号、原因', execution_logic: '调用调度能力暂停任务', approval_required: true });
 assert.deepEqual(validateBusinessAction(form), []);
 const payload = businessActionPayload(form);
 assert.equal(payload.name, 'action_a_005'); assert.equal(payload.definition_config.definition_mode, 'text');
 assert.equal(payload.input_parameters_text, '任务编号、原因'); assert.deepEqual(payload.parameters.map((p) => p.name), ['任务编号', '原因']);
 assert.equal(nextActionCode([{ external_id: 'A-001' }, { name: 'action_a_002' }]), 'A-003');
});
test('plain parameter names preserve metadata and never recycle reserved keys after a reorder', () => {
 const rows = businessParameters('通知、处理人、新参数', original.parameters);
 assert.equal(rows[0].key, 'notify'); assert.equal(rows[0].default, false);
 assert.equal(rows[1].key, 'assignee'); assert.equal(rows[1].is_required, true);
 assert.equal(rows[1].parameter_source, 'actor_context'); assert.equal(rows[2].key, 'param1');
 assert.equal(businessParameters('新增', [{ key: 'param1', name: '旧字段' }])[0].key, 'param2');
 assert.throws(() => businessParameters('原因、原因'), /不能重复/);
});
test('simple edits preserve all hidden configuration, imported structures and business roles', () => {
 const apiOriginal = { ...original, target_role: '调度人员/事件', definition_config: { schema_version: 1, definition_mode: 'api', api: { url: '/send', method: 'POST', success_criteria_text: 'ok' } } };
 const form = businessActionForm(apiOriginal, dictionary); form.execution_logic = '发送通知并记录审计';
 const payload = businessActionPayload(form, apiOriginal);
 assert.equal(payload.target_role, '调度人员/事件'); assert.equal(payload.name, original.name);
 for (const key of ['definition_config', 'result_schema', 'parameters', 'preconditions', 'side_effects', 'description', 'action_type']) assert.equal(payload[key], undefined, key);
 assert.equal(payload.expected_updated_at, original.updated_at);
});
