export const sourceKinds = [['table', '来源表'], ['api', '来源接口'], ['file', '来源文件']];

// The source carrier is independent of the ontology mapping type.
export function mappingSourceKind(mapping = {}, source = {}) {
  if (sourceKinds.some(([value]) => value === mapping.source_kind)) return mapping.source_kind;
  const location = mapping.source_table || '';
  if (/接口|^https?:\/\//i.test(location)) return 'api';
  if (/\.(csv|xlsx?|json|parquet)$/i.test(location)) return 'file';
  const access = source?.interface_type || '';
  if (/接口|API/i.test(access) && !/数据库|文件/.test(access)) return 'api';
  if (/文件/.test(access) && !/接口|API|数据库/i.test(access)) return 'file';
  return 'table';
}

// The workbook's 来源表/接口 describes the actual carrier, not the mapping type.
// Prefer a captured table name over a heuristic so relation mappings such as M-004
// remain table-backed even when the registered source also exposes APIs.
export function sourceKindForLocation(location, source = {}, tables = [], previousKind = '') {
  const value = String(location || '').trim();
  if (tables.some((table) => table.name === value || table.name === value.split('.').at(-1))) return 'table';
  if (/接口|\bapi\b|^https?:\/\//i.test(value)) return 'api';
  if (/\.(csv|xlsx?|json|parquet)$/i.test(value)) return 'file';
  if (value && sourceKinds.some(([kind]) => kind === previousKind)) return previousKind;
  return mappingSourceKind({}, source);
}

// Display names follow the user's mapping template; the physical carrier remains metadata.
export const sourceLocationLabel = (mapping) => mapping.mapping_type === 'relation' ? '接口' : '来源表';

export const relationKeyMode = (mapping) => mapping.relation_key_mode
  || (mapping.target_key && mapping.target_key !== mapping.source_key ? 'join' : 'link_table');

export const mappingKeyLabel = (mapping) => mapping.mapping_type === 'relation' && relationKeyMode(mapping) === 'join'
  ? `${mapping.source_key || '待填写'} = ${mapping.target_key || '待填写'}` : mapping.source_key || '—';

export function relationDefaultKey(relation) {
  const keys = [relation?.source_key, relation?.target_key].map((key) => String(key || '').trim());
  return keys.every((key) => key && !['-', '—'].includes(key)) ? keys.join('+') : '';
}

export function setMappingSourceField(form, value) {
  return { ...form, source_field: value };
}

export function resetMappingSource(form, changes, relation) {
  return { ...form, ...changes, source_field: '',
    source_key: form.mapping_type === 'relation' ? relationDefaultKey(relation) : '',
    target_key: '', relation_field_bindings: [], relation_key_mode: 'link_table',
    map_way: form.mapping_type === 'relation' ? '关联映射' : '直接映射',
    transform_rule: '', lookup_dictionary: '', quality_rule: '', design_status: '设计中' };
}

export function selectMappingRelation(form, relation) {
  if (form.target_relation === (relation?.name || '')) return form;
  return resetMappingSource(form, { target_relation: relation?.name || '', target_object_type: '', target_property: '',
    map_way: '关联映射', governance_relation_fields: ['', ''] }, relation);
}

export function changeMappingType(form, mappingType) {
  if (form.mapping_type === mappingType) return form;
  return { ...resetMappingSource(form, { source_table: '' }), mapping_type: mappingType,
    relation_key_mode: 'link_table',
    governance_field: '', governance_relation_fields: ['', ''],
    target_object_type: '', target_property: '', target_relation: '', relation_field_bindings: [],
    map_way: mappingType === 'relation' ? '关联映射' : '直接映射', transform_rule: '', lookup_dictionary: '' };
}

export function suggestObjectKey(form, object, mappings = []) {
  if (!object || form.mapping_type !== 'property') return '';
  const primary = object.properties?.find((property) => property.is_primary_key);
  if (!primary) return '';
  if (form.target_property === primary.key && ['直接映射', 'direct'].includes(form.map_way)) return form.source_field || '';
  const candidates = mappings.filter((item) => item.mapping_type === 'property'
    && item.target_object_type === object.name && item.target_property === primary.key
    && item.source_code === form.source_code && item.source_table === form.source_table
    && ['直接映射', 'direct'].includes(item.map_way) && item.source_field);
  const keys = [...new Set(candidates.map((item) => item.source_field))];
  return keys.length === 1 ? keys[0] : '';
}

export function mappingTargetPayload(form) {
  if (form.mapping_type === 'property') return { target_object_type: form.target_object_type,
    target_property: form.target_property, target_relation: '', target_key: '', relation_field_bindings: [] };
  const key = String(form.source_key || '').trim();
  const join = key.match(/^([^=]+)\s*=\s*([^=]+)$/);
  return { target_object_type: '', target_property: '', target_relation: form.target_relation,
    source_key: join ? join[1].trim() : key, target_key: join ? join[2].trim() : '',
    relation_key_mode: join ? 'join' : 'link_table', relation_field_bindings: [] };
}
