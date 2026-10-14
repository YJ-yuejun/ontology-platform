export function buildMappingLineage({ sources = [], assets = [], mappings = [], objects = [], links = [], focus = '' }) {
  const nodes = new Map();
  const edges = [];
  const sourceByCode = new Map(sources.map((item) => [item.code, item]));
  const assetByCode = new Map(assets.map((item) => [item.code, item]));
  const objectByName = new Map(objects.map((item) => [item.name, item]));
  const linkByName = new Map(links.map((item) => [item.name, item]));
  const addNode = (id, label, layer, record = null) => nodes.set(id, { id, label, layer, record });
  const physicalId = (source, location) => `physical:${source.code}:${location || 'unbound'}`;
  const physicalLabel = (source, location) => `${source.name} / ${location || '来源未细分'}`;
  const filtered = mappings.filter((item) => !focus || item.code === focus || item.governance_asset_code === focus
    || item.source_code === focus || item.target_object_type === focus || item.target_relation === focus);
  filtered.forEach((mapping) => {
    const isRelation = mapping.mapping_type === 'relation';
    const semantic = isRelation ? linkByName.get(mapping.target_relation) : objectByName.get(mapping.target_object_type);
    const semanticCode = isRelation ? mapping.target_relation : mapping.target_object_type;
    if (!semanticCode) return;
    const targetId = `semantic:${isRelation ? 'relation' : 'object'}:${semanticCode}`;
    addNode(targetId, `${semantic?.display_name || semanticCode}${isRelation ? ' · 关系' : ' · 对象'}`, 'semantic', semantic || null);
    if (mapping.binding_mode === 'governed') {
      const asset = assetByCode.get(mapping.governance_asset_code);
      if (!asset) return;
      const assetId = `asset:${asset.code}`;
      addNode(assetId, `${asset.name} · 治理资产`, 'governance', asset);
      edges.push({ id: `semantic-map:${mapping.id}`, from: assetId, to: targetId,
        label: isRelation ? (mapping.governance_relation_fields || []).join(' + ') : mapping.governance_field || '', kind: 'governed', record: mapping });
      const source = sourceByCode.get(asset.upstream_source_code);
      if (source) {
        const sourceId = physicalId(source, asset.upstream_object);
        addNode(sourceId, physicalLabel(source, asset.upstream_object), 'physical', source);
        if (!edges.some((edge) => edge.id === `upstream:${asset.id}`)) {
          edges.push({ id: `upstream:${asset.id}`, from: sourceId, to: assetId,
            label: asset.upstream_object || '上游血缘', kind: 'upstream', record: asset });
        }
      }
    } else {
      const source = sourceByCode.get(mapping.source_code);
      if (!source) return;
      const sourceId = physicalId(source, mapping.source_table);
      addNode(sourceId, physicalLabel(source, mapping.source_table), 'physical', source);
      edges.push({ id: `legacy:${mapping.id}`, from: sourceId, to: targetId,
        label: `${mapping.code} · 待适配`, kind: 'legacy', record: mapping });
    }
  });
  assets.filter((asset) => !focus || focus === asset.code || focus === asset.upstream_source_code).forEach((asset) => {
    const assetId = `asset:${asset.code}`;
    addNode(assetId, `${asset.name} · 治理资产`, 'governance', asset);
    const source = sourceByCode.get(asset.upstream_source_code);
    if (!source) return;
    const sourceId = physicalId(source, asset.upstream_object);
    addNode(sourceId, physicalLabel(source, asset.upstream_object), 'physical', source);
    if (!edges.some((edge) => edge.id === `upstream:${asset.id}`)) {
      edges.push({ id: `upstream:${asset.id}`, from: sourceId, to: assetId,
        label: asset.upstream_object || '上游血缘', kind: 'upstream', record: asset });
    }
  });
  sources.filter((source) => !focus || source.code === focus).forEach((source) => {
    const hasPhysicalNode = [...nodes.keys()].some((id) => id.startsWith(`physical:${source.code}:`));
    if (!hasPhysicalNode) {
      const id = physicalId(source, source.physical_object);
      addNode(id, physicalLabel(source, source.physical_object), 'physical', source);
    }
  });
  return { nodes: [...nodes.values()], edges };
}
