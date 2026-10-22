export const RESOURCE_KINDS = [
  { id: 'business_domain', label: '业务主题', route: '/ontology/model/domains', hint: '组织对象所属的业务分类' },
  { id: 'object_type', label: '对象类型', route: '/ontology/model/object-types', hint: '定义业务对象及其属性' },
  { id: 'link_type', label: '关系类型', route: '/ontology/model/link-types', hint: '关联已有对象，明确方向与基数', needsObjects: true },
  { id: 'business_rule', label: '规则', route: '/ontology/logic/definitions', hint: '描述输入、判断逻辑与输出' },
  { id: 'action', label: '动作类型', route: '/ontology/model/actions', hint: '定义业务行动，不执行真实操作', needsObjects: true },
  { id: 'interface', label: '接口', route: '/ontology/model/interfaces', hint: '定义可复用的属性契约' },
];
export const resourceKind = (id) => RESOURCE_KINDS.find((item) => item.id === id);

export function validateOntologyIdentity(form, ontologies = []) {
  if (!form.name?.trim()) return '请填写本体名称。';
  if (!/^[a-z][a-z0-9_.-]*$/.test(form.namespace?.trim() || '')) return '命名空间需以小写字母开头，可使用数字、点、横线和下划线。';
  if (ontologies.some((item) => item.namespace === form.namespace.trim())) return '命名空间已存在，请使用其他命名空间，或打开已有本体进行更新。';
  return '';
}

export function nextModelingStep(stats = {}) {
  if (!stats.business_domains) return { label: '建立业务域', hint: '先定义业务边界，再在业务域下建立主题域。', route: '/ontology/model/domains?create=1', step: 0 };
  if (!stats.subject_domains) return { label: '建立主题域', hint: '已有业务域，接下来建立对象所属的主题域。', route: '/ontology/model/domains?create=1&kind=subject', step: 0 };
  if (!stats.object_types) return { label: '创建第一个对象类型', hint: '定义对象身份、主键和业务属性，并选择所属主题域。', route: '/ontology/model/object-types?create=1', step: 1 };
  return { label: '继续完善模型', hint: '已有对象。按业务需要补充关系、规则或动作，无需逐个创建所有资源类型。', step: 2 };
}

export function manualEntry({ intent, type, ontology, objectCount = 0 }) {
  if (ontology?.status && ontology.status !== 'draft') return { route: '/ontology/governance', governance: true };
  const resource = resourceKind(type);
  if (!resource) return { route: `/ontology/overview/${ontology?.id || ''}`, chooseType: true };
  if (intent !== 'update' && objectCount === 0 && (resource.id === 'object_type' || resource.needsObjects)) {
    if (ontology?.business_domain_count === 0) return { route: '/ontology/model/domains?create=1&guide=1', prerequisite: 'classification', label: '先建立业务域' };
    if (ontology?.subject_domain_count === 0) return { route: '/ontology/model/domains?create=1&kind=subject&guide=1', prerequisite: 'classification', label: '先建立主题域' };
    if (resource.needsObjects) return { route: '/ontology/model/object-types?create=1&guide=1', prerequisite: 'object', label: '先创建对象类型' };
  }
  return { route: `${resource.route}${intent === 'update' ? '' : '?create=1'}` };
}
