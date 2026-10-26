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

// 对象类别是业务语义分类，不替代资源状态、属性类别或本体发布状态。
// 规则模板仅用于“本身需要作为对象管理”的规则/策略；可执行规则仍在“规则”页维护。
export const OBJECT_CATEGORY_OPTIONS = [
  ['业务实体', '业务实体'],
  ['业务单据', '业务单据'],
  ['业务数据', '业务数据'],
  ['主数据', '主数据'],
  ['业务事件', '业务事件'],
  ['业务任务', '业务任务'],
  ['资产物料', '资产物料'],
  ['规则模板', '规则模板'],
];
export const OBJECT_CATEGORY_HINTS = {
  '业务实体': '有独立身份和生命周期的业务对象，如供应商、合同、项目。',
  '业务单据': '流程中产生的可流转单据或凭证，如订单、发票、付款申请、验收单。',
  '业务数据': '明细、指标、数据集或分析结果，如预算明细、供应商绩效、发票明细。',
  '主数据': '相对稳定、跨业务复用的基础数据，如组织、人员、品类、供应商、税率。',
  '业务事件': '在某个时点发生、需要被记录或触发的业务事件，如寻源事件、风险预警、审计发现。',
  '业务任务': '需要分派、处理或跟踪的工作项，如付款审查任务、合规检查。',
  '资产物料': '物资、设备、产品、资产卡片等可被管理或使用的实物对象。',
  '规则模板': '本身需要作为对象管理的规则或策略模板；可执行规则请在“规则”页维护。',
};
export const objectCategoryLabel = (value) => value || '未设置';
