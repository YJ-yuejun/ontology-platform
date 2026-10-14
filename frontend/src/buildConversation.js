// Conversation prototypes never invoke an LLM or write ontology resources.
// Keep task state separate from ontology resources and their review lifecycle.
import { resourceKind } from './modelingFlow.js';
export const TASK_STORAGE = 'ontology-modeling-conversations-v1';
export const TASK_EVENT = 'ontology-modeling-conversations-changed';
export const MODE_LABELS = { create: '新建本体', update: '完善现有本体', inspect: '检查模型' };
export const TASK_LABELS = { ready: '待开始', planning: '待确认范围', review: '待确认变更', saved: '演示草稿已保存', checked: '检查完成' };
export const uid = () => globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const message = (role, text, extra = {}) => ({ id: uid(), role, text, ...extra });

export function readTasks() {
  const raw = localStorage.getItem(TASK_STORAGE);
  if (!raw) return [];
  const tasks = JSON.parse(raw);
  if (!Array.isArray(tasks)) throw new Error('本地任务记录格式异常，请先备份浏览器数据。');
  return tasks;
}

export function writeTask(task) {
  const next = { ...task, updatedAt: new Date().toISOString() };
  const tasks = readTasks();
  const existing = tasks.findIndex((item) => item.id === next.id);
  if (existing < 0) tasks.unshift(next); else tasks[existing] = next;
  localStorage.setItem(TASK_STORAGE, JSON.stringify(tasks));
  window.dispatchEvent(new Event(TASK_EVENT));
  return next;
}

export function createTask({ mode = 'update', purpose = '', resourceType = '', ontology, resource, returnTo } = {}) {
  const kind = resourceKind(resourceType);
  const prompt = purpose === 'initialize' ? `@本体建模助手 为刚创建的“${ontology?.name}”开始建模。业务范围：${ontology?.description || '请引导我补充业务需求'}。我也可以补充已确认治理资产及字段契约作为上下文。先给出建议，不重复创建本体。`
    : purpose === 'create_resource' ? `@本体建模助手 在“${ontology?.name}”中新建${kind?.label || '资源'}，请引导我提供业务描述、领域资料或已确认治理资产上下文，并确认定义，不修改其他资源。`
      : mode === 'create' ? '@本体建模助手 帮我探索领域知识，创建新的业务本体。'
    : mode === 'inspect' ? '@本体建模助手 检查当前本体的对象属性定义，先不要修改。'
      : resource ? `@本体建模助手 帮我完善“${resource.display_name}”的属性，先给出建议，不修改其他对象。`
        : kind ? `@本体建模助手 帮我更新“${ontology?.name}”中的${kind.label}，先确认具体内容，再给出增量建议。`
          : '@本体建模助手 根据我的资料和需求，完善当前本体，先给出增量变更建议。';
  return writeTask({
    id: uid(), mode, purpose, resourceType, title: purpose === 'initialize' ? `${ontology?.name} · 开始建模` : mode === 'create' ? '创建新的业务本体' : `${resource?.display_name || ontology?.name || '选择本体'} · ${kind?.label || MODE_LABELS[mode]}`,
    ontologyId: mode === 'create' ? '' : ontology?.id || '', ontologyName: mode === 'create' ? '' : ontology?.name || '',
    resourceId: resource?.id || '', returnTo: returnTo || (ontology ? `/ontology/overview/${ontology.id}` : '/ontology/overview'),
    composer: prompt, goal: '', status: 'ready', messages: [], attachments: [], candidates: [], snapshot: null, snapshots: [], rounds: [],
    newOntology: purpose === 'initialize' ? { name: ontology.name, namespace: ontology.namespace, description: ontology.description || '' } : { name: '', namespace: '', description: '' }, createdAt: new Date().toISOString(),
  });
}

export function launchBuild(navigate, options, notify = () => {}) {
  try { const task = createTask(options); navigate(`/chat?task=${encodeURIComponent(task.id)}`); return task; }
  catch (error) { notify(`无法保存建模任务：${error.message}`); return null; }
}

export function candidateErrors(candidate, objects = []) {
  const value = candidate.after;
  const errors = [];
  if (candidate.kind === 'property') {
    if (!value.name?.trim()) errors.push('请填写属性名称');
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value.key || '')) errors.push('属性字段名称需以英文字母开头，只能包含字母、数字或下划线');
    const target = objects.find((item) => item.id === candidate.targetId);
    if (!target) errors.push('目标对象已不存在，请重新选择范围');
    if (target?.properties.some((item) => item.key === value.key)) errors.push('该属性字段名称已存在，不能作为新增属性保存');
    if (value.type === 'enum' && !value.options?.length) errors.push('枚举属性至少需要一个枚举值');
  } else {
    if (!value.display_name?.trim()) errors.push('请填写对象显示名称');
    if (!/^[A-Z][A-Za-z0-9]*$/.test(value.name || '')) errors.push('稳定标识需以大写英文字母开头，只能包含字母和数字');
    if (objects.some((item) => item.name === value.name)) errors.push('对象稳定标识已存在，请调整或复用已有对象');
  }
  return errors;
}

export function sampleCandidate(task, objects) {
  if (task.resourceType && task.resourceType !== 'object_type') throw new Error('此类资源的智能候选生成尚未接入；不能用对象示例替代。');
  const target = objects.find((item) => item.id === task.resourceId);
  if (task.resourceId && !target) throw new Error('选中的对象已不存在，请调整任务范围。');
  return target ? {
    id: uid(), kind: 'property', targetId: target.id, targetName: target.display_name,
    decision: 'pending', before: null,
    after: { name: '巡检周期', key: 'inspectionCycleDays', type: 'integer', unit: '天', description: '演示业务定义，请按实际业务修改', options: [] },
    basis: '内置交互示例；不是从附件抽取的结论。目标对象名称及已有属性来自当前本体。',
    baseline: JSON.stringify(target),
  } : {
    id: uid(), kind: 'object', decision: 'pending', before: null,
    after: { display_name: '巡检记录', name: 'InspectionRecord', description: '记录一次巡检的业务信息（交互示例，需确认业务含义）' },
    basis: '内置交互示例；不代表已分析附件或确认需要新增该对象。', baseline: null,
  };
}

export function inspectObjects(objects) {
  const issues = [];
  const names = new Set();
  for (const item of objects) {
    if (names.has(item.name)) issues.push(`${item.display_name}：稳定标识重复`);
    names.add(item.name);
    if ((item.properties || []).filter((p) => p.is_primary_key).length !== 1) issues.push(`${item.display_name}：应有且仅有一个主键属性`);
    const keys = (item.properties || []).map((p) => p.key);
    if (new Set(keys).size !== keys.length) issues.push(`${item.display_name}：属性字段名称重复`);
    if (item.title_property && !keys.includes(item.title_property)) issues.push(`${item.display_name}：标题属性不存在`);
  }
  return issues;
}
