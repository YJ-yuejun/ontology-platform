import { isConfirmedMapping } from './objectMapping.js';

export const MAPPING_STATUS_LABELS = {
  confirmed: '已确认', pending: '待确认', unmapped: '未映射', not_required: '无需映射',
};

// 单个属性的映射状态，口径与 objectMappingState 一致：计算属性无需来源映射；
// 只要有一条映射未确认就算“待确认”。
export function propertyMappingStatus(object, property, mappings = []) {
  const rows = mappings.filter((mapping) => mapping.mapping_type === 'property'
    && mapping.target_object_type === object?.name && mapping.target_property === property?.key);
  if (!rows.length) return property?.property_category === '计算属性' ? 'not_required' : 'unmapped';
  return rows.every(isConfirmedMapping) ? 'confirmed' : 'pending';
}

/**
 * 把所有对象的属性摊平成一张目录。
 * sharedCount：同一字段名出现在几个对象中；typeConflict：同名字段在不同对象里数据类型不一致。
 */
export function flattenProperties(objects = [], mappings = []) {
  const byKey = new Map();
  objects.forEach((object) => (object.properties || []).forEach((property) => {
    if (!property?.key) return;
    if (!byKey.has(property.key)) byKey.set(property.key, []);
    byKey.get(property.key).push({ object, property });
  }));
  const rows = [];
  objects.forEach((object) => (object.properties || []).forEach((property, index) => {
    const peers = byKey.get(property.key) || [];
    rows.push({
      id: `${object.id}:${property.key || index}`,
      object, property,
      mapping: propertyMappingStatus(object, property, mappings),
      sharedCount: peers.length,
      typeConflict: new Set(peers.map((peer) => peer.property.type)).size > 1,
    });
  }));
  return rows;
}

export const propertyPeers = (rows, row) => rows.filter((item) => item.property.key === row.property.key && item.id !== row.id);
