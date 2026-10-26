const splitFields = (value) => String(value || '')
  .split(/[\/+;,，、]/)
  .map((item) => item.trim())
  .filter(Boolean);

const nodeId = {
  source: (code) => `physical:source:${code}`,
  table: (sourceCode, table) => `physical:table:${sourceCode}:${table}`,
  column: (sourceCode, table, field) => `physical:column:${sourceCode}:${table}:${field}`,
  property: (objectName, key) => `semantic:property:${objectName}:${key}`,
  object: (objectName) => `semantic:object:${objectName}`,
  relation: (name) => `semantic:relation:${name}`,
};

const entityName = (record, fallback) => record?.display_name || record?.name || fallback || '未命名';

/**
 * Resolve the physical lineage of one mapping.
 *
 * New records bind a source table/column directly. Old governed records still
 * resolve through their referenced governance asset, but the asset itself is
 * *not* rendered as a node: its upstream source/table/field is lifted into the
 * physical layer so the graph always reads "physical column → object property".
 */
function physicalOf(mapping, { sourceByCode, assetByCode }) {
  if (mapping.binding_mode === 'governed') {
    const asset = assetByCode.get(mapping.governance_asset_code);
    if (!asset) return null;
    const sourceCode = asset.upstream_source_code || `asset:${asset.code}`;
    const source = sourceByCode.get(sourceCode) || {
      code: sourceCode,
      name: asset.upstream_source_name || `治理资产 · ${asset.name}`,
      physical_object: asset.upstream_object || '未登记上游对象',
      synthetic: true,
    };
    const table = asset.upstream_object || '未登记上游表';
    const fields = mapping.mapping_type === 'relation'
      ? (mapping.governance_relation_fields || [])
      : [mapping.governance_field].filter(Boolean);
    return { source, table, fields, governed: true, asset };
  }
  const sourceCode = mapping.source_code;
  if (!sourceCode) return null;
  const source = sourceByCode.get(sourceCode) || {
    code: sourceCode,
    name: mapping.source_system_display || sourceCode,
    physical_object: mapping.source_table || '未登记物理来源',
    synthetic: true,
  };
  const table = mapping.source_table || source.physical_object || '未登记来源表';
  const fields = mapping.mapping_type === 'relation'
    ? splitFields(mapping.source_field || mapping.source_key)
    : splitFields(mapping.source_field);
  return { source, table, fields, governed: false, asset: null };
}

function targetOf(mapping, { objectByName, linkByName, objectById }) {
  if (mapping.mapping_type === 'relation') {
    const relation = linkByName.get(mapping.target_relation);
    if (!mapping.target_relation) return null;
    const sourceObject = relation ? objectById.get(relation.source_object_type_id) : null;
    const targetObject = relation ? objectById.get(relation.target_object_type_id) : null;
    return {
      kind: 'relation',
      name: mapping.target_relation,
      record: relation || { name: mapping.target_relation, display_name: mapping.target_relation },
      sourceObject,
      targetObject,
      domainCode: sourceObject?.business_domain_code || targetObject?.business_domain_code || '',
      domainName: sourceObject?.business_domain_name || targetObject?.business_domain_name || '',
    };
  }
  const object = objectByName.get(mapping.target_object_type);
  if (!mapping.target_object_type || !mapping.target_property) return null;
  const property = (object?.properties || []).find((item) => item.key === mapping.target_property);
  return {
    kind: 'property',
    name: mapping.target_property,
    objectName: mapping.target_object_type,
    record: property || { key: mapping.target_property, name: mapping.target_property },
    object,
    domainCode: object?.business_domain_code || '',
    domainName: object?.business_domain_name || '',
  };
}

function focusMatches(entry, focus) {
  if (!focus) return true;
  if (focus.startsWith('source:')) {
    return entry.source.code === focus.slice(7) || `asset:${entry.asset?.code}` === focus;
  }
  if (focus.startsWith('table:')) {
    const [, sourceCode, ...rest] = focus.split(':');
    return entry.source.code === sourceCode && entry.table === rest.join(':');
  }
  if (focus.startsWith('object:')) {
    const name = focus.slice(7);
    return entry.target.kind === 'property' ? entry.target.objectName === name
      : (entry.sourceObject?.name === name || entry.targetObject?.name === name);
  }
  if (focus.startsWith('property:')) {
    return entry.target.kind === 'property' && `${entry.target.objectName}.${entry.target.name}` === focus.slice(9);
  }
  if (focus.startsWith('relation:')) {
    return entry.target.kind === 'relation' && entry.target.name === focus.slice(9);
  }
  const needle = focus.toLowerCase();
  return [entry.mapping.code, entry.mapping.name, entry.source.code, entry.source.name,
    entry.table, ...entry.fields, entry.target.name, entry.target.objectName,
    entry.target.domainName].join(' ').toLowerCase().includes(needle);
}

function filterMatches(entry, filter) {
  if (filter.source && entry.source.code !== filter.source) return false;
  if (filter.table && entry.table !== filter.table) return false;
  if (filter.domain && entry.target.domainCode !== filter.domain) return false;
  if (filter.object) {
    // 对象筛选只匹配“属性映射的目标对象”，关系映射只按关系名匹配。
    // 否则按某对象展开字段时，会把以该对象为端点的关系映射也带进来。
    const matches = entry.target.kind === 'property'
      ? entry.target.objectName === filter.object
      : entry.target.name === filter.object;
    if (!matches) return false;
  }
  if (filter.text) {
    const needle = String(filter.text).toLowerCase();
    const haystack = [entry.mapping.code, entry.mapping.name, entry.source.code, entry.source.name,
      entry.table, ...entry.fields, entry.target.name, entry.target.objectName, entry.target.record?.name,
      entry.target.record?.display_name, entry.target.domainName].join(' ').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function collectEntries({ sources, assets, mappings, objects, links, filter = {} }) {
  const sourceByCode = new Map(sources.map((item) => [item.code, item]));
  const assetByCode = new Map(assets.map((item) => [item.code, item]));
  const objectByName = new Map(objects.map((item) => [item.name, item]));
  const objectById = new Map(objects.map((item) => [item.id, item]));
  const linkByName = new Map(links.map((item) => [item.name, item]));
  return mappings.map((mapping) => {
    const physical = physicalOf(mapping, { sourceByCode, assetByCode });
    const target = targetOf(mapping, { objectByName, linkByName, objectById });
    if (!physical || !target || !physical.fields.length) return null;
    return {
      mapping,
      source: physical.source,
      table: physical.table,
      fields: physical.fields,
      asset: physical.asset,
      governed: physical.governed,
      target,
      objectName: target.kind === 'property' ? target.objectName : '',
      sourceObject: target.sourceObject,
      targetObject: target.targetObject,
    };
  }).filter(Boolean).filter((entry) => filterMatches(entry, filter));
}

export function buildMappingLineage({ sources = [], assets = [], mappings = [], objects = [], links = [], focus = '', filter = {} } = {}) {
  const entries = collectEntries({ sources, assets, mappings, objects, links, filter })
    .filter((entry) => focusMatches(entry, focus));

  const nodes = new Map();
  const edges = [];
  const addNode = (id, label, layer, kind, record, extra = {}) => {
    const existing = nodes.get(id);
    if (existing) {
      existing.count = (existing.count || 0) + 1;
      return existing;
    }
    const node = { id, label, layer, kind, record, count: 1, ...extra };
    nodes.set(id, node);
    return node;
  };

  entries.forEach((entry) => {
    const sourceId = nodeId.source(entry.source.code);
    addNode(sourceId, `${entry.source.name}\n${entry.source.physical_object || entry.source.code}`, 'physical', 'source',
      entry.source, { synthetic: Boolean(entry.source.synthetic) });
    const targetId = entry.target.kind === 'relation'
      ? nodeId.relation(entry.target.name)
      : nodeId.property(entry.target.objectName, entry.target.name);
    if (entry.target.kind === 'relation') {
      const start = entry.target.sourceObject?.display_name || '起点对象';
      const end = entry.target.targetObject?.display_name || '终点对象';
      addNode(targetId, `${entityName(entry.target.record)}\n${start} → ${end}`, 'semantic', 'relation',
        entry.target.record, { domain: entry.target.domainName });
    } else {
      addNode(targetId, `${entityName(entry.target.record)}\n${entry.target.object?.display_name || entry.target.objectName} · ${entry.target.name}`,
        'semantic', 'property', entry.target.record,
        { objectName: entry.target.objectName, objectDisplay: entry.target.object?.display_name || entry.target.objectName,
          key: entry.target.name, domain: entry.target.domainName });
    }
    entry.fields.forEach((field, index) => {
      const columnId = nodeId.column(entry.source.code, entry.table, field);
      addNode(columnId, `${entry.table}.${field}`, 'physical', 'column',
        { source: entry.source, table: entry.table, name: field }, { synthetic: Boolean(entry.source.synthetic) });
      edges.push({
        id: `mapping:${entry.mapping.id}:${index}`,
        from: columnId,
        to: targetId,
        kind: entry.target.kind,
        label: '',
        title: `${entry.mapping.code} · ${entry.mapping.name || ''}\n${entry.table}.${field} → ${entry.target.kind === 'property' ? `${entry.target.objectName}.${entry.target.name}` : entry.target.name}`,
        record: entry.mapping,
        sourceCode: entry.source.code,
        table: entry.table,
        field,
        target: entry.target,
      });
    });
  });

  // A selected source stays visible even when it has no direct mapping yet.
  if (filter.source || focus.startsWith('source:')) {
    const code = filter.source || focus.slice(7);
    const source = sources.find((item) => item.code === code);
    if (source && ![...nodes.keys()].some((id) => id.startsWith(`physical:source:${code}`))) {
      addNode(nodeId.source(code), `${source.name}\n${source.physical_object || source.code}`, 'physical', 'source', source);
    }
  }

  return { nodes: [...nodes.values()], edges, entries };
}


const fieldCount = (entries) => new Set(entries.flatMap((entry) => entry.fields.map((field) => `${entry.table}.${field}`))).size;

const aggregateTitle = (edge) => edge.entries.flatMap((entry) => entry.fields.map((field) => {
  const target = entry.target.kind === 'property'
    ? `${entry.target.objectName}.${entry.target.name}`
    : entry.target.name;
  return `${entry.table}.${field} → ${target}`;
})).slice(0, 12).join('\n');

/**
 * Aggregated overview used as the default graph: source system → physical table
 * → object type. Each table→object edge carries the number of mapped fields.
 * Selecting an object/table/edge and expanding it switches the same canvas to
 * the field-level lineage (buildMappingLineage), so the page keeps one mental
 * model while offering two levels of detail.
 */
export function buildAggregateLineage({ sources = [], assets = [], mappings = [], objects = [], links = [], filter = {} } = {}) {
  const entries = collectEntries({ sources, assets, mappings, objects, links, filter });
  const nodes = new Map();
  const edges = new Map();

  const addNode = (id, label, kind, record, extra = {}) => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const node = { id, label, layer: kind === 'source' ? 'physical' : kind === 'table' ? 'physical' : 'semantic',
      kind, record, count: 0, ...extra };
    nodes.set(id, node);
    return node;
  };

  entries.forEach((entry) => {
    const sourceId = nodeId.source(entry.source.code);
    addNode(sourceId, `${entry.source.name}\n${entry.source.physical_object || entry.source.code}`,
      'source', entry.source, { synthetic: Boolean(entry.source.synthetic) });
    const tableId = nodeId.table(entry.source.code, entry.table);
    addNode(tableId, entry.table, 'table', { source: entry.source, name: entry.table });
    let targetId;
    if (entry.target.kind === 'relation') {
      targetId = nodeId.relation(entry.target.name);
      const start = entry.target.sourceObject?.display_name || '起点对象';
      const end = entry.target.targetObject?.display_name || '终点对象';
      addNode(targetId, `关系 · ${entityName(entry.target.record)}\n${start} → ${end}`, 'relation',
        entry.target.record, { domain: entry.target.domainName, target: entry.target });
    } else {
      targetId = nodeId.object(entry.target.objectName);
      addNode(targetId, entry.target.object?.display_name || entry.target.objectName, 'object',
        entry.target.object || { name: entry.target.objectName, display_name: entry.target.objectName },
        { objectName: entry.target.objectName, domain: entry.target.domainName,
          objectDisplay: entry.target.object?.display_name || entry.target.objectName });
    }
    const edgeId = `aggregate:${tableId}->${targetId}`;
    if (!edges.has(edgeId)) {
      edges.set(edgeId, {
        id: edgeId, from: tableId, to: targetId,
        kind: entry.target.kind === 'relation' ? 'aggregateRelation' : 'aggregate',
        sourceCode: entry.source.code, table: entry.table, target: entry.target,
        entries: [], record: [], label: '',
      });
    }
    edges.get(edgeId).entries.push(entry);
    edges.get(edgeId).record.push(entry.mapping);
  });

  edges.forEach((edge) => {
    const count = fieldCount(edge.entries);
    edge.fieldCount = count;
    edge.mappingCount = edge.entries.length;
    edge.label = `${count} 个字段`;
    edge.title = aggregateTitle(edge);
    const table = nodes.get(edge.from);
    const target = nodes.get(edge.to);
    if (table) { table.count += edge.mappingCount; table.objectCount = (table.objectCount || 0) + 1; }
    if (target) { target.count += edge.mappingCount; target.tableCount = (target.tableCount || 0) + 1; }
    const source = nodes.get(`physical:source:${edge.sourceCode}`);
    if (source) source.tableCount = new Set([...nodes.values()].filter((node) => node.kind === 'table'
      && node.id.startsWith(`physical:table:${edge.sourceCode}:`)).map((node) => node.id)).size;
  });

  nodes.forEach((node) => {
    if (node.kind === 'source') {
      node.label = `${node.record?.name || node.record?.code}\n${node.tableCount || 0} 张表`;
    } else if (node.kind === 'table') {
      node.label = `${node.record?.name}\n${node.count} 条字段映射`;
    } else if (node.kind === 'object') {
      node.label = `${node.objectDisplay}\n${node.count} 条映射 · ${node.tableCount || 0} 张表`;
    } else if (node.kind === 'relation') {
      node.label = `关系 · ${entityName(node.record)}\n${node.count} 条关系映射`;
    }
    node.count = node.count || 0;
  });

  // Keep a selected source visible even if it currently has no aggregate edge.
  const focusSource = filter.source;
  if (focusSource && ![...nodes.keys()].some((id) => id.startsWith(`physical:source:${focusSource}`))) {
    const source = sources.find((item) => item.code === focusSource);
    if (source) addNode(nodeId.source(focusSource), `${source.name}\n0 张表`, 'source', source);
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], entries, view: 'object',
    mappingCount: entries.length, fieldCount: fieldCount(entries) };
}
