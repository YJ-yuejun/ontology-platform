export const FORM_LABELS = { added: '新增', removed: '删除', modified: '修改', moved: '迁移' };
export const SEVERITY_LABELS = { P0: 'P0 阻断', P1: 'P1 关注', P2: 'P2 提示' };
export const DIMENSION_LABELS = { structural: '结构', semantic: '语义', permission: '权限' };
export const RESOURCE_ORDER = ['对象类型', '对象属性', '关系', '业务规则', '业务行动'];
export const RESOURCE_SHORT = { 对象类型: '对象', 对象属性: '属性', 关系: '关系', 业务规则: '规则', 业务行动: '行动' };

export const FIELD_LABELS = {
  extend_params: '扩展参数',
  oot_biz_domain_id: '所属业务域',
  oop_biz_def: '业务定义',
  oop_name: '属性名称',
  oop_data_type: '数据类型',
  oop_is_pk: '主键',
  oop_is_required: '必填',
  orel_src_oot_id: '起点对象',
  orel_tgt_oot_id: '目标对象',
  orel_name: '关系名称',
  orl_expression: '规则表达式',
  orl_apply_obj: '适用对象',
  oact_tgt_obj: '作用对象',
  oact_act_id: '行动标识',
  ont_name: '对象名称',
  ont_desc: '对象定义',
};
const FIELD_NAMES = { ord_amt: '订单金额', prod_id: '产品ID', inv_id: '发票ID' };
const RELATION_NAMES = { containsProduct: '包含产品' };
const SEVERITY_ORDER = { P0: 0, P1: 1, P2: 2 };

export const formLabel = (form) => FORM_LABELS[form] || form;
export const severityLabel = (severity) => SEVERITY_LABELS[severity] || severity;
export const dimensionLabel = (dimension) => DIMENSION_LABELS[dimension] || dimension;

export function prettyValue(field, value, domainNames = {}) {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string' && field.endsWith('_id') && domainNames[value]) return `${domainNames[value]}（${value}）`;
  if (field === 'extend_params' && typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function objectName(drifts, key) {
  const object = drifts.find((drift) => drift.res_type === '对象类型' && drift.res_key === key);
  return object?.owner?.name || object?.res_key || key;
}

export function relationParts(drift) {
  const [source, relation, target] = String(drift.res_key || '').split('|');
  return { source, relation, target };
}

export function driftTitle(drift, drifts = []) {
  if (drift.res_type === '对象类型') return drift.owner?.name || drift.res_key;
  if (drift.res_type === '对象属性') {
    const [parent, field] = String(drift.res_key || '').split('|');
    return `${objectName(drifts, parent)} · ${FIELD_NAMES[field] || field || '属性'}`;
  }
  if (drift.res_type === '关系') {
    const { source, relation, target } = relationParts(drift);
    return `${objectName(drifts, source)} ${RELATION_NAMES[relation] || relation || '关系'} ${objectName(drifts, target)}`;
  }
  return drift.owner?.name || drift.res_key || drift.drift_id;
}

export function ownerLabel(drift, drifts = []) {
  if (drift.res_type === '对象类型') return drift.owner?.name || drift.res_key;
  if (drift.res_type === '对象属性') {
    const parent = String(drift.res_key || '').split('|')[0];
    return objectName(drifts, parent);
  }
  if (drift.res_type === '关系') {
    const { source, target } = relationParts(drift);
    return `${objectName(drifts, source)} → ${objectName(drifts, target)}`;
  }
  return drift.owner?.name || '—';
}

export function severityReason(drift) {
  if (drift.severity === 'P0') return drift.form === 'removed'
    ? '删除会使基线中的资源在副本中不存在，可能破坏属性、关系、映射、规则和下游引用。'
    : '该差异被算法标记为阻断，需先确认存在性和引用链。';
  if (drift.severity === 'P1') return drift.form === 'moved'
    ? '资源仍然存在，但业务域归属发生迁移，会影响目录、权限范围和责任边界，需要核对下游。'
    : '新增资源需要确认属性、映射、权限和引用是否补齐；若右状态异常，还需先核对启用状态。';
  return drift.dimension === 'semantic'
    ? '只修改了业务定义等语义字段，不改变资源存在性，但可能影响口径理解和下游解释。'
    : '只修改了扩展参数或轻量字段，不改变对象结构，建议确认是否被程序读取。';
}

export function relatedDrifts(drift, drifts = []) {
  const linked = new Set();
  if (drift.res_type === '对象类型') linked.add(drift.res_key);
  if (drift.res_type === '对象属性') linked.add(String(drift.res_key || '').split('|')[0]);
  if (drift.res_type === '关系') {
    const { source, target } = relationParts(drift);
    if (source) linked.add(source);
    if (target) linked.add(target);
  }
  return drifts.filter((item) => {
    if (item.drift_id === drift.drift_id) return false;
    if (item.res_type === '对象类型') return linked.has(item.res_key);
    if (item.res_type === '对象属性') return linked.has(String(item.res_key || '').split('|')[0]);
    if (item.res_type === '关系') {
      const { source, target } = relationParts(item);
      return linked.has(source) || linked.has(target);
    }
    return false;
  }).sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
}

// 算法明确不做 renamed/rekeyed 识别；这里在展示层补一层“疑似改名/重建”提示，
// 帮助评审人把 removed + added 重新串成一条业务链，但不改变原始严重级别。
export function detectRenameSuggestions(drifts = []) {
  const suggestions = [];
  const removedObjects = drifts.filter((item) => item.res_type === '对象类型' && item.form === 'removed');
  const addedObjects = drifts.filter((item) => item.res_type === '对象类型' && item.form === 'added');
  const objectPairs = [];
  removedObjects.forEach((removed) => {
    addedObjects.forEach((added) => {
      const sameName = removed.owner?.name && removed.owner.name === added.owner?.name;
      if (!sameName || removed.res_key === added.res_key) return;
      const pair = { kind: 'object', from: removed.res_key, to: added.res_key, label: removed.owner.name, fromDrift: removed, toDrift: added, reason: '同名对象，业务键从旧键变为新键' };
      objectPairs.push(pair); suggestions.push(pair);
    });
  });
  const removedAttrs = drifts.filter((item) => item.res_type === '对象属性' && item.form === 'removed');
  const addedAttrs = drifts.filter((item) => item.res_type === '对象属性' && item.form === 'added');
  removedAttrs.forEach((removed) => {
    const [fromParent, fromField] = String(removed.res_key || '').split('|');
    addedAttrs.forEach((added) => {
      const [toParent, toField] = String(added.res_key || '').split('|');
      if (fromField !== toField || fromParent === toParent) return;
      const objectPair = objectPairs.find((pair) => pair.from === fromParent && pair.to === toParent);
      if (!objectPair) return;
      suggestions.push({ kind: 'attribute', from: removed.res_key, to: added.res_key, label: `${objectPair.label} · ${FIELD_NAMES[fromField] || fromField}`, fromDrift: removed, toDrift: added, reason: `父对象疑似从 ${fromParent} 改为 ${toParent}，字段名保持不变` });
    });
  });
  const removedRelations = drifts.filter((item) => item.res_type === '关系' && item.form === 'removed');
  const addedRelations = drifts.filter((item) => item.res_type === '关系' && item.form === 'added');
  removedRelations.forEach((removed) => {
    const from = relationParts(removed);
    addedRelations.forEach((added) => {
      const to = relationParts(added);
      if (from.relation !== to.relation) return;
      const sourcePair = objectPairs.find((pair) => pair.from === from.source && pair.to === to.source);
      const targetPair = objectPairs.find((pair) => pair.from === from.target && pair.to === to.target);
      if (!sourcePair && !targetPair) return;
      suggestions.push({ kind: 'relation', from: removed.res_key, to: added.res_key, label: `${objectName(drifts, from.source)} ${RELATION_NAMES[from.relation] || from.relation} ${objectName(drifts, from.target)}`, fromDrift: removed, toDrift: added, reason: `关系名保持不变，${sourcePair ? '起点对象' : '目标对象'}业务键发生变化` });
    });
  });
  return suggestions;
}

export function renameForDrift(drift, suggestions = []) {
  return suggestions.find((item) => item.fromDrift?.drift_id === drift.drift_id || item.toDrift?.drift_id === drift.drift_id) || null;
}

export function groupDrifts(drifts = []) {
  return RESOURCE_ORDER.map((type) => {
    const items = drifts.filter((item) => item.res_type === type);
    return {
      type, label: type, items,
      counts: { total: items.length, P0: items.filter((item) => item.severity === 'P0').length, P1: items.filter((item) => item.severity === 'P1').length, P2: items.filter((item) => item.severity === 'P2').length },
    };
  }).filter((group) => group.items.length);
}

export function groupSource(drifts = []) {
  return groupDrifts(drifts).map((group) => ({
    ...group,
    items: group.items.map((drift) => ({ ...drift, displayName: driftTitle(drift, drifts), ownerName: ownerLabel(drift, drifts), related: relatedDrifts(drift, drifts) })),
  }));
}

export function summaryText(compare, drifts, renames = []) {
  const summary = compare.summary;
  const p0 = drifts.filter((item) => item.severity === 'P0').map((item) => driftTitle(item, drifts));
  return [
    `本次共 ${summary.total} 项差异：P0 ${summary.by_severity.P0} / P1 ${summary.by_severity.P1} / P2 ${summary.by_severity.P2}。`,
    `形态上：新增 ${summary.by_form.added}、删除 ${summary.by_form.removed}、修改 ${summary.by_form.modified}、迁移 ${summary.by_form.moved}。`,
    `优先核对：${p0.slice(0, 5).join('、')}${p0.length > 5 ? ' 等' : ''}。`,
    renames.length ? `另外检测到 ${renames.length} 组疑似改名/重建（如 ${renames[0].from} → ${renames[0].to}），算法按删除+新增呈现，需人工确认是否同一业务对象。` : '',
  ].filter(Boolean).join('\n');
}

function detailAnswer(drift, drifts, domainNames) {
  const lines = [
    `${drift.res_type}「${driftTitle(drift, drifts)}」：${formLabel(drift.form)}，${severityLabel(drift.severity)}，维度 ${dimensionLabel(drift.dimension)}。`,
    `业务键：${drift.res_key}；左状态 ${drift.left_status || '不存在'}，右状态 ${drift.right_status || '不存在'}。`,
  ];
  if (drift.field_diffs?.length) {
    lines.push('字段差异：');
    drift.field_diffs.forEach((item) => lines.push(`- ${FIELD_LABELS[item.field] || item.field}：${prettyValue(item.field, item.left, domainNames)} → ${prettyValue(item.field, item.right, domainNames)}`));
  }
  if (drift.note) lines.push(`备注：${drift.note}`);
  const related = relatedDrifts(drift, drifts);
  if (related.length) lines.push(`关联差异 ${related.length} 项：${related.map((item) => `${driftTitle(item, drifts)}（${formLabel(item.form)}）`).join('、')}。`);
  return lines.join('\n');
}

export function answerCompareQuestion(question, { compare, drifts, renames = [], domainNames = {} }) {
  const text = String(question || '').trim();
  const lower = text.toLowerCase();
  const removed = drifts.filter((item) => item.form === 'removed');
  const added = drifts.filter((item) => item.form === 'added');
  const p0 = drifts.filter((item) => item.severity === 'P0');
  const p1 = drifts.filter((item) => item.severity === 'P1');
  const moved = drifts.filter((item) => item.form === 'moved');
  const byName = (keywords) => drifts.filter((item) => keywords.some((keyword) => `${driftTitle(item, drifts)} ${item.res_key}`.toLowerCase().includes(keyword)));
  if (!text) return summaryText(compare, drifts, renames);
  const direct = drifts.find((item) => {
    const title = driftTitle(item, drifts).toLowerCase();
    const key = String(item.res_key || '').toLowerCase();
    return lower.includes(key) || title.split(/[\s·|]+/).filter(Boolean).some((part) => lower.includes(part));
  });
  const asksDetail = direct && /(为什么|解释|详情|字段|变化|影响|风险)/.test(text) && !/(有哪些|哪些|总结|概览|全部|所有)/.test(text);
  if (/(改名|重命名|重建|rekey|rename)/i.test(text)) {
    if (!renames.length) return '当前差异表没有发现同名的删除/新增组合，因此没有给出疑似改名提示。改名仍需人工确认业务键与下游引用。';
    return [`检测到 ${renames.length} 组疑似改名/重建：`, ...renames.map((item) => `- ${item.kind === 'object' ? '对象' : item.kind === 'attribute' ? '属性' : '关系'}：${item.from} → ${item.to}（${item.reason}）`), '算法本身只输出 removed + added，不自动判定改名；建议先确认是否同一业务对象，再决定 P0 是否降级。'].join('\n');
  }
  if (asksDetail) return `${detailAnswer(direct, drifts, domainNames)}\n\n${severityReason(direct)}`;
  if (/(p0|阻断|最严重|严重)/i.test(text)) {
    return [`P0 共 ${p0.length} 项：`, ...p0.map((item) => `- ${driftTitle(item, drifts)}（${item.res_type} · ${formLabel(item.form)}）`), renames.length ? '注意：产品对象链存在疑似改名，若确认是同一对象，部分 P0 可按改名迁移处理。' : ''].filter(Boolean).join('\n');
  }
  if (/(p1|关注)/i.test(text)) return [`P1 共 ${p1.length} 项：`, ...p1.map((item) => `- ${driftTitle(item, drifts)}（${item.res_type} · ${formLabel(item.form)}）`)].join('\n');
  if (/(删除|移除|removed)/i.test(text)) return [`删除共 ${removed.length} 项：`, ...removed.map((item) => `- ${driftTitle(item, drifts)}（${item.res_type}，${item.severity}）`), '其中 Prod / Product 与属性、关系形成了疑似改名链，建议先确认真实意图；Inv 发票删除暂时没有新增对应。'].join('\n');
  if (/(新增|added)/i.test(text)) return [`新增共 ${added.length} 项：`, ...added.map((item) => `- ${driftTitle(item, drifts)}（${item.res_type}，${item.severity}）`)].join('\n');
  if (/(迁移|移动|moved|订单|ord)/i.test(text)) {
    if (moved.length) {
      return moved.map((item) => detailAnswer(item, drifts, domainNames)).join('\n\n') + '\n\n订单从销售域迁到生产域，属于归属调整；同时订单金额的业务定义也有修改，建议一起核对使用订单金额的报表、规则和下游接口。';
    }
  }
  if (/(产品|prod|product)/i.test(text)) {
    const chain = byName(['产品', 'prod', 'product']);
    const rename = renames.filter((item) => /产品|prod/i.test(`${item.label} ${item.from} ${item.to}`));
    return [
      `产品链路共命中 ${chain.length} 项差异：`,
      ...chain.map((item) => `- ${driftTitle(item, drifts)}：${formLabel(item.form)}，${severityLabel(item.severity)}`),
      rename.length ? `疑似改名 ${rename.length} 组：${rename.map((item) => `${item.from} → ${item.to}`).join('、')}。` : '',
      '如果确认是改名，需要同步迁移对象属性、关系、映射、规则和实例中的业务键引用；在确认前不要直接把 P0 当作纯新增处理。',
    ].filter(Boolean).join('\n');
  }
  if (/(发票|inv)/i.test(text)) {
    const chain = byName(['发票', 'inv']);
    return [`发票链路共命中 ${chain.length} 项差异：`, ...chain.map((item) => `- ${driftTitle(item, drifts)}：${formLabel(item.form)}，${severityLabel(item.severity)}`), '这是当前差异中没有对应新增项的删除，建议优先核对发票对象的下游映射、凭证和结算依赖。'].join('\n');
  }
  if (/(关系|relation|contains)/i.test(text)) {
    const chain = drifts.filter((item) => item.res_type === '关系');
    return [`关系差异 ${chain.length} 项：`, ...chain.map((item) => `- ${driftTitle(item, drifts)}：${formLabel(item.form)}，${severityLabel(item.severity)}${item.form === 'added' && item.right_status === '已停用' ? '（新增但右状态为停用）' : ''}`)].join('\n');
  }
  if (/(影响|下游|依赖|风险|兼容)/i.test(text)) {
    return ['建议按三条链路核对：', '1. 产品链：Prod 删除、Product 新增、产品ID 和「订单包含产品」关系同时变化，先确认是否改名/重建。', '2. 发票链：Inv 与 Inv|inv_id 删除，没有新增对应项，需核对结算、凭证和映射依赖。', '3. 订单链：业务域从销售域迁到生产域，订单金额定义也变化，需核对报表口径与规则。', '本页只展示差异表和关联关系，不能直接断言生产运行影响；请结合映射、规则、接口和实例再确认。'].join('\n');
  }
  if (/(总结|概览|主要|总体|summary)/i.test(text)) return summaryText(compare, drifts, renames);
  if (direct) return detailAnswer(direct, drifts, domainNames);
  return `${summaryText(compare, drifts, renames)}\n\n你还可以问：P0 风险、产品/发票/订单链路、疑似改名、关系变化，或某一项差异的具体字段。`;
}
