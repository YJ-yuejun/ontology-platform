const declaredTypeToCandidate = (value = '') => {
  const type = String(value).toLowerCase();
  if (/bool/.test(type)) return 'boolean';
  if (/int|serial/.test(type)) return 'integer';
  if (/decimal|numeric|number|float|double|real|money/.test(type)) return 'decimal';
  if (/date|time/.test(type)) return 'datetime';
  return 'string';
};

const candidateKey = (value, index, used) => {
  const base = String(value || '').trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  let key = /^[A-Za-z]/.test(base) ? base : `field${index + 1}`;
  let suffix = 2;
  while (used.has(key)) { key = `${/^[A-Za-z]/.test(base) ? base : `field${index + 1}`}_${suffix}`; suffix += 1; }
  used.add(key);
  return key;
};

// Asset metadata can suggest technical property keys and broad types, but it does
// not establish a business meaning or create a semantic mapping.
export function governanceFieldCandidates(fields = []) {
  const used = new Set();
  return fields.map((field, index) => ({
    sourceField: field.name || `未命名字段 ${index + 1}`,
    declaredType: field.data_type || '',
    candidateType: declaredTypeToCandidate(field.data_type),
    candidateKey: candidateKey(field.name, index, used),
  }));
}

export const isConfirmedMapping = (mapping) => {
  if (mapping.binding_mode !== 'governed') return false;
  if (mapping.design_status != null && String(mapping.design_status).trim()) {
    return ['已确认', 'validated', 'confirmed'].includes(mapping.design_status);
  }
  return mapping.status === 'active';
};

export function objectMappingState(object, mappings = []) {
  const properties = Array.isArray(object?.properties) ? object.properties : [];
  const requiredProperties = properties.filter((property) => property?.key
    && property.property_category !== '计算属性');
  const propertyKeys = new Set(properties.map((property) => property?.key).filter(Boolean));
  const requiredPropertyKeys = new Set(requiredProperties.map((property) => property.key));
  const rows = mappings.filter((mapping) => mapping.mapping_type === 'property'
    && mapping.target_object_type === object?.name);
  const validRows = rows.filter((mapping) => propertyKeys.has(mapping.target_property));
  const confirmedCount = rows.filter((mapping) => isConfirmedMapping(mapping)
    && propertyKeys.has(mapping.target_property)).length;
  const pendingCount = rows.length - confirmedCount;
  const mappedPropertyKeys = new Set(validRows
    .map((mapping) => mapping.target_property)
    .filter((key) => requiredPropertyKeys.has(key)));
  const mappedCount = mappedPropertyKeys.size;
  const requiredCount = requiredPropertyKeys.size;
  let label;
  if (pendingCount > 0) label = '待确认';
  else if (requiredCount === 0) label = '无需映射';
  else if (mappedCount === 0) label = '未绑定';
  else if (mappedCount < requiredCount) label = '部分映射';
  else label = '已确认';
  return {
    count: rows.length,
    confirmedCount,
    pendingCount,
    mappedCount,
    requiredCount,
    label,
  };
}
