import { designStatusValue } from './labels.js';

export const ACTION_OPERATIONS = [['invoke', '不直接变更对象'], ['create', '创建对象'], ['modify', '修改对象'], ['create_or_modify', '创建或修改对象'], ['delete', '删除对象']];
export const DEFINITION_MODES = [['text', '文字规则'], ['formula', '公式'], ['api', 'API']];
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const copy = (value) => JSON.parse(JSON.stringify(value));
let rowCounter = 0;
export const parameterRow = (value = {}) => ({ key: '', name: '', type: 'string', is_required: false, default: null, description: '', ...copy(value), _rowId: `action-param-${++rowCounter}` });
export const actionCategoryCode = (value, dictionary) => dictionary.find((item) => item.code === value || item.name === value)?.code || value || '';
export const actionCategoryLabel = (value, dictionary) => dictionary.find((item) => item.code === value || item.name === value)?.name || value || '未分类';
export const operationLabel = (value) => ACTION_OPERATIONS.find(([key]) => key === value)?.[1] || value;
export const modeLabel = (value) => DEFINITION_MODES.find(([key]) => key === value)?.[1] || '文字规则';

export function actionForm(item = {}, dictionary = []) {
  const raw = item.template_raw || {};
  const config = item.definition_config || {};
  return {
    external_id: item.external_id || raw.行动ID || '', display_name: item.display_name || '', name: item.name || '',
    action_category: actionCategoryCode(item.action_category || raw.行动类型, dictionary),
    target_object_type_id: item.target_object_type_id || '', description: item.description || '',
    parameters: (item.parameters || []).map(parameterRow),
    precondition_text: item.precondition_text ?? raw.前置条件 ?? (item.preconditions || []).map((entry) => entry.expression).join('；'),
    execution_logic: item.execution_logic ?? raw.执行逻辑 ?? item.description ?? '',
    object_effect: item.object_effect ?? raw['对象/属性变化'] ?? '',
    result_text: item.result_text ?? raw.执行结果 ?? item.result_schema?.result ?? '',
    side_effects_text: item.side_effects_text ?? raw['副作用/联动'] ?? (item.side_effects || []).join('、'),
    action_type: item.action_type || 'invoke', approval_required: Boolean(item.approval_required),
    owner: item.owner || raw.责任人 || '', design_status: designStatusValue(item.design_status || raw.状态),
    definition_version: item.definition_version || 'v1.0',
    definition_config: { ...copy(config), schema_version: 1, definition_mode: config.definition_mode || 'text',
      formula: { expression_text: '', variables_text: '', example_text: '', ...config.formula },
      api: { method: 'POST', url: '', system_name: '', request_mapping_text: '', request_example_text: '', response_mapping_text: '', success_criteria_text: '', credential_ref: '', ...config.api } },
    result_schema_text: Object.keys(item.result_schema || {}).length ? JSON.stringify(item.result_schema, null, 2) : '',
  };
}

function parametersPayload(parameters) {
  return parameters.map(({ _rowId, ...parameter }) => {
    const result = { ...parameter, key: parameter.key.trim(), name: parameter.name.trim() };
    if (typeof result.default === 'string' && result.default !== '') {
      if (result.type === 'integer' || result.type === 'decimal') {
        if (!Number.isFinite(Number(result.default)) || (result.type === 'integer' && !Number.isInteger(Number(result.default)))) throw new Error(`参数 ${result.key} 的默认值应为${result.type === 'integer' ? '整数' : '数值'}`);
        result.default = Number(result.default);
      } else if (result.type === 'boolean') {
        if (!['true', 'false'].includes(result.default)) throw new Error(`参数 ${result.key} 的布尔默认值应为 true 或 false`);
        result.default = result.default === 'true';
      }
    }
    if (result.default === '') result.default = null;
    return result;
  });
}

export function actionPayload(form, original) {
  const resultSchema = form.result_schema_text.trim() ? JSON.parse(form.result_schema_text) : {};
  if (!resultSchema || Array.isArray(resultSchema) || typeof resultSchema !== 'object') throw new Error('结果结构必须为 JSON 对象');
  const parameters = parametersPayload(form.parameters);
  const payload = { name: form.name.trim(), display_name: form.display_name.trim(), external_id: form.external_id.trim(),
    target_object_type_id: form.target_object_type_id, action_category: form.action_category,
    description: form.description, action_type: form.action_type, parameters,
    precondition_text: form.precondition_text, execution_logic: form.execution_logic, object_effect: form.object_effect,
    result_text: form.result_text, result_schema: resultSchema, side_effects_text: form.side_effects_text,
    approval_required: form.approval_required, owner: form.owner.trim(), design_status: form.design_status,
    definition_config: copy(form.definition_config), definition_version: form.definition_version,
    input_parameters_text: parameters.map((p) => p.name).join('、') };
  if (original) {
    payload.expected_updated_at = original.updated_at;
    // Text descriptions never rebuild imported structured conditions or side effects.
    if (original.target_object_type_id !== form.target_object_type_id) payload.target_role = '';
    if (JSON.stringify(parameters) === JSON.stringify(original.parameters || [])) delete payload.input_parameters_text;
  }
  return payload;
}

export function validateActionForm(form, items = [], editingId = null) {
  const errors = [];
  for (const [key, title] of [['external_id', '行动编号'], ['display_name', '行动名称'], ['name', 'API 名称'], ['action_category', '行动类型'], ['target_object_type_id', '作用对象'], ['execution_logic', '执行逻辑'], ['owner', '责任人']]) {
    if (!String(form[key] || '').trim()) errors.push(`${title}不能为空`);
  }
  if (form.name && !/^[a-z][a-z0-9_]*$/.test(form.name.trim())) errors.push('API 名称须以小写字母开头，仅包含小写字母、数字和下划线');
  for (const [key, title] of [['external_id', '行动编号'], ['display_name', '行动名称'], ['name', 'API 名称']]) {
    if (items.some((item) => item.id !== editingId && item[key]?.trim() === form[key]?.trim())) errors.push(`同一本体中${title}已存在`);
  }
  const keys = new Set();
  for (const parameter of form.parameters) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(parameter.key)) errors.push('参数标识须以英文字母开头，仅包含字母、数字和下划线');
    if (keys.has(parameter.key)) errors.push(`参数标识 ${parameter.key} 重复`);
    keys.add(parameter.key);
    if (!parameter.name.trim()) errors.push('参数名称不能为空');
    if (parameter.type === 'enum' && !parameter.options?.length) errors.push(`参数 ${parameter.key} 需要枚举值`);
  }
  const config = form.definition_config;
  if (config.definition_mode === 'formula' && !config.formula.expression_text.trim()) errors.push('公式不能为空');
  if (config.definition_mode === 'api' && !config.action_mapping_code) {
    if (!config.api.url.trim()) errors.push('API 地址不能为空');
    if (!config.api.success_criteria_text.trim()) errors.push('API 成功条件说明不能为空');
  }
  try { actionPayload(form); } catch (cause) { errors.push(cause instanceof SyntaxError ? '结果结构不是合法 JSON，请检查格式' : cause.message); }
  return [...new Set(errors)];
}

// Business-only editor: the 13 workbook columns remain the user's input contract.
export const parameterNames = (value) => String(value || '').split(/[、,，;；\n]+/).map((name) => name.trim()).filter(Boolean);
export const businessApiName = (code) => `action_${String(code).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || Array.from(String(code)).map((char) => char.codePointAt(0).toString(16)).join('_') || 'new'}`;
export function nextActionCode(items) {
  let number = Math.max(0, ...items.map((item) => Number(/^A-(\d+)$/i.exec(item.external_id || item.template_raw?.行动ID || '')?.[1]) || 0)) + 1;
  while (items.some((item) => item.name === businessApiName(`A-${String(number).padStart(3, '0')}`))) number += 1;
  return `A-${String(number).padStart(3, '0')}`;
}
export function businessActionForm(item, dictionary = [], items = []) {
  const form = actionForm(item || {}, dictionary);
  return { ...form,
    external_id: form.external_id || nextActionCode(items),
    target_role: item?.target_role ?? item?.template_raw?.作用对象 ?? item?.target_display_name ?? '',
    input_parameters_text: item?.input_parameters_text ?? item?.template_raw?.输入参数 ?? form.parameters.map((p) => p.name).join('、'),
    owner: form.owner || '示例负责人',
  };
}
export function businessParameters(text, original = []) {
  const names = parameterNames(text);
  if (new Set(names).size !== names.length) throw new Error('输入参数名称不能重复');
  const reserved = new Set(original.map((item) => item.key));
  let number = 1;
  return names.map((name) => {
    const existing = original.find((item) => item.name === name);
    if (existing) return { ...existing };
    while (reserved.has(`param${number}`)) number += 1;
    const key = `param${number++}`; reserved.add(key);
    return { key, name, type: 'string', is_required: false };
  });
}
export function businessActionPayload(form, original) {
  const originalText = original?.input_parameters_text ?? original?.template_raw?.输入参数 ?? (original?.parameters || []).map((p) => p.name).join('、');
  const unchanged = Boolean(original) && form.input_parameters_text === originalText;
  const payload = {
    name: original?.name || businessApiName(form.external_id), display_name: form.display_name.trim(),
    external_id: form.external_id.trim(), action_category: form.action_category,
    target_object_type_id: form.target_object_type_id, target_role: form.target_role.trim(),
    input_parameters_text: form.input_parameters_text, precondition_text: form.precondition_text,
    execution_logic: form.execution_logic, object_effect: form.object_effect, result_text: form.result_text,
    side_effects_text: form.side_effects_text, approval_required: form.approval_required,
    owner: form.owner.trim(), design_status: form.design_status,
  };
  if (!unchanged) payload.parameters = businessParameters(form.input_parameters_text, original?.parameters || []);
  // Preserve all existing technical configuration and structured conditions on edit.
  if (original) payload.expected_updated_at = original.updated_at;
  else Object.assign(payload, { action_type: 'invoke', definition_version: 'v1.0',
    definition_config: { schema_version: 1, definition_mode: 'text' } });
  return payload;
}
export function validateBusinessAction(form, items = [], original) {
  const errors = [];
  for (const [key, label] of [['external_id', '行动ID'], ['display_name', '行动名称'], ['action_category', '行动类型'], ['target_object_type_id', '作用对象'], ['execution_logic', '执行逻辑'], ['owner', '责任人']]) {
    if (!String(form[key] || '').trim()) errors.push(`${label}不能为空`);
  }
  for (const [key, label] of [['external_id', '行动ID'], ['display_name', '行动名称']]) {
    if (items.some((item) => item.id !== original?.id && item[key]?.trim() === form[key]?.trim())) errors.push(`同一本体中${label}已存在`);
  }
  if (!['draft', 'validated'].includes(form.design_status)) errors.push('请选择有效状态');
  if (typeof form.approval_required !== 'boolean') errors.push('请选择是否需审批');
  const name = original?.name || businessApiName(form.external_id);
  if (items.some((item) => item.id !== original?.id && item.name === name)) errors.push('该行动ID生成的内部标识已存在，请更换行动ID');
  try { businessActionPayload(form, original); } catch (cause) { errors.push(cause.message); }
  return errors;
}
