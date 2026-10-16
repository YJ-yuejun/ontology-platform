export const STATUS_LABELS = {
  promoted: '核心推荐',
  active: '已启用',
  experimental: '试验中',
  deprecated: '已弃用',
  // 兼容早期快照；新建资源不再把“示例”当作生命周期状态。
  example: '演示标记（旧）',
  draft: '草稿',
  published: '已发布',
};

export const STATUS_OPTIONS = [
  ['experimental', STATUS_LABELS.experimental],
  ['active', STATUS_LABELS.active],
  ['promoted', STATUS_LABELS.promoted],
  ['deprecated', STATUS_LABELS.deprecated],
];

// 模板里的“建模状态”是来源状态，不能和本体资源的启用/弃用混用。
// 后端历史数据使用 validated/draft，这里同时兼容模板中文值。
export const DESIGN_STATUS_LABELS = {
  validated: '已确认',
  confirmed: '已确认',
  draft: '设计中',
  designing: '设计中',
  '已确认': '已确认',
  '设计中': '设计中',
};
export const DESIGN_STATUS_OPTIONS = [
  ['validated', '已确认'],
  ['draft', '设计中'],
];

// 业务域/主题域是分类资源，一期只把它当作“可否继续用于归类”的状态。
// 保留 experimental 仅为了兼容已经导入的模板快照，不再新增示例状态。
export const USAGE_STATUS_OPTIONS = [
  ['active', '启用'],
  ['experimental', '试验中（历史）'],
  ['deprecated', '停用'],
];
export const usageStatusLabel = (value) => Object.fromEntries(USAGE_STATUS_OPTIONS)[value] || value || '未设置';

export const DATA_TYPE_LABELS = {
  string: '文本',
  integer: '整数',
  decimal: '数值',
  boolean: '布尔',
  datetime: '日期时间',
  enum: '枚举',
};

export const CHANGE_OPERATION_LABELS = {
  create: '新建',
  update: '修改',
  delete: '删除',
  publish: '发布',
  import: '导入',
  derive: '派生工作状态',
  review_submit: '提交评审',
  review_approve: '评审通过',
};

export const statusLabel = (value) => STATUS_LABELS[value] || value || '未设置';
export const designStatusLabel = (value) => DESIGN_STATUS_LABELS[value] || value || '未设置';
export const designStatusValue = (value) => ['validated', 'confirmed', '已确认'].includes(value) ? 'validated' : 'draft';
export const dataTypeLabel = (value) => DATA_TYPE_LABELS[value] || value || '未设置';
export const operationLabel = (value) => CHANGE_OPERATION_LABELS[value] || value || '变更';
export const localizeModelText = (value) => String(value || '')
  .replace(/\bOntology\b/g, '本体')
  .replace(/\bAction\b/g, '动作类型')
  .replace(/\bActive\b/g, '已启用')
  .replace(/\bedits\b/gi, '变更');
export const actorLabel = (value) => ({
  'manual-admin': '手工建模管理员',
  'manual-user': '手工建模用户',
  system: '系统',
  'system-bootstrap': '系统初始化',
  'system-migration': '系统迁移',
  'ontology-builder': '建模服务',
  admin: '管理员',
}[value] || value || '未知用户');
