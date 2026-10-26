const RESOURCE_PATHS = {
  ontology: '/ontology/overview', 本体: '/ontology/overview',
  business_domain: '/ontology/model/domains', 业务域: '/ontology/model/domains',
  subject_domain: '/ontology/model/domains', 主题域: '/ontology/model/domains',
  object_type: '/ontology/model/object-types', 对象: '/ontology/model/object-types',
  link_type: '/ontology/model/link-types', 关系: '/ontology/model/link-types',
  action: '/ontology/model/actions', business_rule: '/ontology/logic/definitions',
  logic_definition: '/ontology/logic/definitions', 规则: '/ontology/logic/definitions',
  interface: '/ontology/model/interfaces',
  data_source: '/ontology/data/sources', 数据源: '/ontology/data/sources',
  data_mapping: '/ontology/data/mappings', 映射: '/ontology/data/mappings',
  governance_asset: '/ontology/data/sources',
  business_scenario: '/ontology/scenarios', object_instance: '/ontology/data/instances',
  link_instance: '/ontology/data/instances',
  capability: '/ontology/logic/execution', capabilitie: '/ontology/logic/execution',
  action_mapping: '/ontology/logic/execution',
  permission_policy: '/ontology/governance/security', permission_policie: '/ontology/governance/security',
  version: '/ontology/governance',
};

// 旧版资源（对象类型组、共享属性）和当前没有独立页面的资源（建模证据、智能构建提案、属性）
// 无法“跳回资源”，调用方据此给出说明而不是留一个点不动的按钮。
export const UNDESTINED_RESOURCE_TYPES = new Set([
  'object_type_group', 'shared_property', 'proposal', 'evidence_source', 'property',
]);

export function resourcePageUrl(item, page = 1, pageSize = 20) {
  const path = RESOURCE_PATHS[item?.mvc_res_type];
  const id = item?.mvc_chg_obj;
  if (!path || !id) return '';
  if (item.mvc_res_type === 'ontology' || item.mvc_res_type === '本体') return `${path}/${encodeURIComponent(id)}`;
  const params = new URLSearchParams({
    from_history: '1', resource_type: item.mvc_res_type, resource_id: String(id),
    history_record_id: String(item.mvc_id), history_page: String(page),
    history_page_size: String(pageSize),
  });
  return `${path}?${params}`;
}

export function historyReturnUrl(search) {
  const source = new URLSearchParams(search);
  const params = new URLSearchParams({
    resource_type: source.get('resource_type') || '',
    resource_id: source.get('resource_id') || '',
    record_id: source.get('history_record_id') || '',
    page: source.get('history_page') || '1',
    page_size: source.get('history_page_size') || '20',
  });
  return `/ontology/governance/activity?${params}`;
}
