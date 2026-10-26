export const RESOURCE_TYPE_LABELS = {
  object_type: '对象',
  attribute: '属性',
  link_type: '关系',
  action: '动作',
  rule: '规则',
  mapping: '映射',
  instance: '实例',
  page: '页面',
};

export const resourceKey = (item) => `${item.type}:${item.id}`;

export const resourceLabel = (item) => {
  const type = RESOURCE_TYPE_LABELS[item.type] || '资源';
  return `${type} · ${item.label || item.id}`;
};

export const quickActions = (input) => {
  const list = Array.isArray(input) ? input : [input];
  const item = list[0];
  if (!item) return [];
  if (list.length > 1) {
    const names = list.map((entry) => `“${entry.label}”`).join('、');
    return [
      { label: `逐个解释 ${list.length} 项`, prompt: `分别解释选中的 ${list.length} 个资源：${names}，说明每个资源的定义、所属对象与映射状态。` },
      { label: '检查一致性', prompt: `检查以下选中资源之间是否存在命名、类型或口径冲突：${names}。` },
      { label: '起草修改', prompt: `为以下选中资源起草修改建议：${names}。` },
    ];
  }
  if (item.type === 'attribute') {
    return [
      { label: '解释口径', prompt: `解释属性“${item.label}”的业务定义与计算口径，并指出它属于哪个对象。` },
      { label: '查映射', prompt: `属性“${item.label}”当前映射到哪个源字段？没有映射的话，给出候选映射建议。` },
      { label: '起草修改', prompt: `为属性“${item.label}”起草一份修改建议，说明改什么、为什么改。` },
    ];
  }
  if (item.type === 'link_type') {
    return [
      { label: '解释关系', prompt: `解释关系“${item.label}”的方向、基数和业务含义。` },
      { label: '查孤儿', prompt: `关系“${item.label}”有没有孤儿实例或断链风险？给出检查思路。` },
      { label: '起草修改', prompt: `为关系“${item.label}”起草修改建议。` },
    ];
  }
  if (item.type === 'object_type') {
    return [
      { label: '解释定义', prompt: `解释对象“${item.label}”的业务定义、主键和它承担的业务职责。` },
      { label: '查完整性', prompt: `检查对象“${item.label}”的建模完整性：主键、关系、属性定义是否齐全。` },
      { label: '起草修改', prompt: `为对象“${item.label}”起草一份修改建议。` },
    ];
  }
  return [
    { label: '这个资源有什么问题', prompt: `检查“${item.label}”是否存在建模或映射问题。` },
    { label: '起草修改', prompt: `为“${item.label}”起草修改建议。` },
  ];
};
