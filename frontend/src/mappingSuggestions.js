function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function affinity(property, column) {
  const key = normalize(property.key);
  const name = normalize(property.name);
  const field = normalize(column.name);
  const comment = normalize(column.comment);
  if (key && key === field) return { score: 1, reason: '属性字段名与来源字段名一致' };
  if (name && name === comment) return { score: 0.92, reason: '属性名称与字段注释一致' };
  if (key.length >= 4 && field.length >= 4 && (key.includes(field) || field.includes(key))) {
    return { score: 0.72, reason: '属性字段名与来源字段名部分一致，需人工核对' };
  }
  if (name.length >= 2 && comment.length >= 2 && (name.includes(comment) || comment.includes(name))) {
    return { score: 0.68, reason: '属性名称与字段注释部分一致，需人工核对' };
  }
  return null;
}

/** Only structural candidates: no model call, row reads, or ontology writes. */
export function suggestPropertyMappings({ object, table, sourceCode, existingMappings = [] }) {
  if (!object || !table || !sourceCode) return [];
  const used = new Set();
  const existing = new Set(existingMappings.filter((item) => item.mapping_type === 'property'
    && item.source_code === sourceCode && item.source_table?.split('.').at(-1) === table.name
    && item.target_object_type === object.name).map((item) => item.target_property));
  return (object.properties || []).flatMap((property) => {
    if (existing.has(property.key)) return [];
    const ranked = (table.columns || []).map((column) => ({ column, match: affinity(property, column) }))
      .filter(({ column, match }) => match && !used.has(column.name))
      .sort((left, right) => right.match.score - left.match.score);
    if (!ranked.length) return [];
    const best = ranked[0];
    used.add(best.column.name);
    return [{ property, column: best.column, score: best.match.score, reason: best.match.reason }];
  });
}
