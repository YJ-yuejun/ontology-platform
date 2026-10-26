// 本体对比演示数据：由算法输出直接固化为前端 mock，用于原型展示。
// 页面不把它当成“发布版本”：左侧是基线本体 100001，右侧是从它复制出来的副本 100002。
export const MOCK_ONTOLOGY_A = {
  id: 'mock-100001',
  number: '100001',
  name: '销售履约本体',
  role: '基线',
  namespace: 'enterprise.sales.fulfillment',
  status: '已启用',
  owner: '销售运营部',
  elementCount: 14,
  contentHash: '3f9c7e2a…a1b2',
  updatedAt: '2026-09-18',
};

export const MOCK_ONTOLOGY_B = {
  id: 'mock-100002',
  number: '100002',
  name: '销售履约本体（副本）',
  role: '副本',
  namespace: 'enterprise.sales.fulfillment.copy',
  status: '已启用',
  owner: '销售运营部',
  elementCount: 13,
  contentHash: '8e2d4b61…c4f1',
  updatedAt: '2026-10-22',
  copiedFrom: MOCK_ONTOLOGY_A.id,
  copiedAt: '2026-09-18',
  iterationDays: 34,
};

export const MOCK_ONTOLOGY_C = {
  id: 'mock-101001',
  number: '101001',
  name: '客户主数据本体',
  role: '手动新建',
  namespace: 'enterprise.customer.master',
  status: '已启用',
};

export const MOCK_COMPARE_META = {
  compareAt: '2026-10-22 09:40',
  durationMs: 1840,
  algorithm: 'compare-engine v0.19',
  jobId: '99001',
};

export const MOCK_COMPARE = {
  schema_version: '1.0',
  ok: true,
  ontology_id: 99001,
  left_version: 'v1.0.0',
  right_version: 'v1.1.0',
  version_available: true,
  compare_state: '成功',
  global: {
    content_hash_same: false,
    elem_counts: { left: 14, right: 13 },
  },
  summary: {
    total: 12,
    by_form: { added: 4, removed: 5, modified: 2, moved: 1 },
    by_severity: { P0: 5, P1: 5, P2: 2 },
  },
  drifts: [
    {
      drift_id: 'modified|对象类型|Cust', dimension: 'structural', form: 'modified', res_type: '对象类型', res_id: 991101, res_key: 'Cust',
      field_diffs: [{ field: 'extend_params', left: '', right: '{"fix":"ext-change"}' }],
      severity: 'P2', left_status: '已启用', right_status: '已启用', embedded_diffs: [], note: '仅扩展字段变化',
      owner: { res_id: '991101', res_key: 'Cust', name: '客户' },
    },
    {
      drift_id: 'moved|对象类型|Ord', dimension: 'structural', form: 'moved', res_type: '对象类型', res_id: 991102, res_key: 'Ord',
      field_diffs: [{ field: 'oot_biz_domain_id', left: 'fixver:BD-B', right: 'fixver:BD-A' }],
      severity: 'P1', left_status: '已启用', right_status: '已启用', embedded_diffs: [], note: '',
      owner: { res_id: '991102', res_key: 'Ord', name: '订单' },
    },
    {
      drift_id: 'removed|对象类型|Prod', dimension: 'structural', form: 'removed', res_type: '对象类型', res_id: 991003, res_key: 'Prod',
      field_diffs: [], severity: 'P0', left_status: '已启用', right_status: '', embedded_diffs: [], note: '',
      owner: { res_id: '991003', res_key: 'Prod', name: '产品' },
    },
    {
      drift_id: 'removed|对象类型|Inv', dimension: 'structural', form: 'removed', res_type: '对象类型', res_id: 991004, res_key: 'Inv',
      field_diffs: [], severity: 'P0', left_status: '已启用', right_status: '', embedded_diffs: [], note: '',
      owner: { res_id: '991004', res_key: 'Inv', name: '发票' },
    },
    {
      drift_id: 'modified|对象属性|Ord|ord_amt', dimension: 'semantic', form: 'modified', res_type: '对象属性', res_id: 992104, res_key: 'Ord|ord_amt',
      field_diffs: [{ field: 'oop_biz_def', left: '订单金额（原始定义）', right: '订单金额（改后定义）' }],
      severity: 'P2', left_status: '已启用', right_status: '已启用', embedded_diffs: [], note: '',
      owner: { res_id: 'Ord', res_key: '', name: '' },
    },
    {
      drift_id: 'removed|对象属性|Prod|prod_id', dimension: 'structural', form: 'removed', res_type: '对象属性', res_id: 992005, res_key: 'Prod|prod_id',
      field_diffs: [], severity: 'P0', left_status: '已启用', right_status: '', embedded_diffs: [], note: '',
      owner: { res_id: 'Prod', res_key: '', name: '' },
    },
    {
      drift_id: 'removed|对象属性|Inv|inv_id', dimension: 'structural', form: 'removed', res_type: '对象属性', res_id: 992006, res_key: 'Inv|inv_id',
      field_diffs: [], severity: 'P0', left_status: '已启用', right_status: '', embedded_diffs: [], note: '',
      owner: { res_id: 'Inv', res_key: '', name: '' },
    },
    {
      drift_id: 'removed|关系|Ord|containsProduct|Prod', dimension: 'structural', form: 'removed', res_type: '关系', res_id: 993002, res_key: 'Ord|containsProduct|Prod',
      field_diffs: [], severity: 'P0', left_status: '已启用', right_status: '', embedded_diffs: [], note: '', owner: null,
    },
    {
      drift_id: 'added|对象类型|Product', dimension: 'structural', form: 'added', res_type: '对象类型', res_id: 991103, res_key: 'Product',
      field_diffs: [], severity: 'P1', left_status: '', right_status: '已启用', embedded_diffs: [], note: '',
      owner: { res_id: '991103', res_key: 'Product', name: '产品' },
    },
    {
      drift_id: 'added|对象类型|Ship', dimension: 'structural', form: 'added', res_type: '对象类型', res_id: 991105, res_key: 'Ship',
      field_diffs: [], severity: 'P1', left_status: '', right_status: '已启用', embedded_diffs: [], note: '',
      owner: { res_id: '991105', res_key: 'Ship', name: '发运' },
    },
    {
      drift_id: 'added|对象属性|Product|prod_id', dimension: 'structural', form: 'added', res_type: '对象属性', res_id: 992105, res_key: 'Product|prod_id',
      field_diffs: [], severity: 'P1', left_status: '', right_status: '已启用', embedded_diffs: [], note: '',
      owner: { res_id: 'Product', res_key: '', name: '' },
    },
    {
      drift_id: 'added|关系|Ord|containsProduct|Product', dimension: 'structural', form: 'added', res_type: '关系', res_id: 993102, res_key: 'Ord|containsProduct|Product',
      field_diffs: [], severity: 'P1', left_status: '', right_status: '已停用', embedded_diffs: [], note: '', owner: null,
    },
  ],
  objects: [
    { res_id: '991001', res_key: 'Cust', name: '客户', biz_domain_id: 'fixver:BD-B', biz_domain_name: '销售域', topic_domain_id: 'fixver:TD-A1', status: '已启用' },
    { res_id: '991101', res_key: 'Cust', name: '客户', biz_domain_id: 'fixver:BD-B', biz_domain_name: '销售域', topic_domain_id: 'fixver:TD-A1', status: '已启用' },
    { res_id: '991004', res_key: 'Inv', name: '发票', biz_domain_id: 'fixver:BD-A', biz_domain_name: '生产域', topic_domain_id: 'fixver:TD-A1', status: '已启用' },
    { res_id: '991002', res_key: 'Ord', name: '订单', biz_domain_id: 'fixver:BD-B', biz_domain_name: '销售域', topic_domain_id: 'fixver:TD-A1', status: '已启用' },
    { res_id: '991102', res_key: 'Ord', name: '订单', biz_domain_id: 'fixver:BD-A', biz_domain_name: '生产域', topic_domain_id: 'fixver:TD-A1', status: '已启用' },
    { res_id: '991003', res_key: 'Prod', name: '产品', biz_domain_id: 'fixver:BD-A', biz_domain_name: '生产域', topic_domain_id: 'fixver:TD-A1', status: '已启用' },
    { res_id: '991103', res_key: 'Product', name: '产品', biz_domain_id: 'fixver:BD-A', biz_domain_name: '生产域', topic_domain_id: 'fixver:TD-A1', status: '已启用' },
    { res_id: '991105', res_key: 'Ship', name: '发运', biz_domain_id: 'fixver:BD-B', biz_domain_name: '销售域', topic_domain_id: 'fixver:TD-A1', status: '已启用' },
  ],
  domain_names: {
    'fixver:BD-A': '生产域', 'fixver:BD-B': '销售域', 'fixver:TD-A1': '生产主题',
    'sjlchat:bidding_procurement': '招标采购', 'sjlchat:campus_management': '园区管理', 'sjlchat:change_management': '变更管理',
    'sjlchat:contract_fulfillment': '合同履约', 'sjlchat:contract_performance': '合同履约', 'sjlchat:contract_risk': '合同风险',
    'sjlchat:human_resources': '人力资源', 'sjlchat:procurement_management': '采购管理', 'sjlchat:procurement_review': '采购评审',
    'sjlchat:project_finance': '项目财务', 'sjlchat:project_management': '项目管理', 'sjlchat:project_risk': '项目风险',
    'sjlchat:quality_acceptance': '质量与验收', 'sjlchat:quality_management': '质量管理', 'sjlchat:safety_production': '安全生产管理',
    'sjlchat:supply_chain_management': '供应链管理', 'sjlchat:supply_fulfillment': '供应履约',
  },
  coverage: { _note: '权限漂移一期未实现，覆盖率暂不计算（§12 二期）' },
  error: '',
  parse_warnings: [],
  contract_notes: [
    '产品层不暴露发布版本；底层对比读取平台维护的只读副本，本流程纯读、不建表、不落库',
    '匹配为单级业务键匹配（§9）：不比 id（版本副本会换 id）；res_id 仅排障用',
    'res_key 不含 id：对象类型=api_name；属性={父对象业务键}|{字段名}；关系={源业务键}|{rel_api_name}|{目标业务键}；规则=orl_api_name；行动=oact_act_id',
    'fields 已排除：PK / ontology 列 / 审计4列 / extend_params / 版本列；5 个 id 引用列已归一为业务键，因此引用改指向仍可检出',
    '形态一期产出 4 种：added / removed / modified / moved；recreated 已删除，rekeyed 不可检出（会表现为 removed+added），renamed / reordered 未实现',
    '已知局限（改名级联）：业务键改名无法与「删一个+加一个」区分，且会级联影响引用它的属性/关系；缓解方案见设计稿 §9.3',
    '范围 5 类：对象类型 / 对象属性 / 关系 / 业务规则 / 业务行动；业务域 / 主题域不参与对比，仅用于「域 id → 名称」解析',
    'rows 为本实现附加的中文扁平表；dimension 取值集：structural / semantic / permission',
  ],
};

// 编号规则：6 位 = 3 位本体族编号 + 3 位副本序号；复制时末三位自增，手动新建分配新族号。
export const NUMBERING_RULES = [
  { number: '100001', label: '销售履约本体 A', kind: '基线', note: '首次创建，族号 100，序号 001' },
  { number: '100002', label: '销售履约本体 B', kind: '复制', note: '从 100001 复制，族号 100，序号自增为 002' },
  { number: '101001', label: '客户主数据本体', kind: '手动新建', note: '新分配族号 101，序号 001' },
];
