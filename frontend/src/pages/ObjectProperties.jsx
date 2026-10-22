import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Download, KeyRound, Network, Pencil, Plus, Search, Sparkles, Star } from 'lucide-react';
import { api } from '../api';
import { dataTypeLabel } from '../labels';
import { ObjectTypeIcon } from '../components/ObjectTypeIcon';
import ObjectTypeEditor from '../components/ObjectTypeEditor';
import PropertyCreateDialog from '../components/PropertyCreateDialog';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import { flattenProperties, MAPPING_STATUS_LABELS, propertyPeers } from '../propertyCatalog';
import { useAssistant } from '../assistant/AssistantContext';

const CONSTRAINTS = [['primary', '主键'], ['required', '必填'], ['unique', '唯一'], ['searchable', '可搜索']];
const hasConstraint = (property, key) => ({ primary: property.is_primary_key, required: property.is_required, unique: property.is_unique, searchable: property.is_searchable })[key];

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export default function ObjectProperties({ activeId, active, refreshOntologies, notify }) {
  const navigate = useNavigate();
  const [objects, setObjects] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [objectId, setObjectId] = useState('');
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [constraint, setConstraint] = useState('');
  const [mapping, setMapping] = useState('');
  const [onlyShared, setOnlyShared] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(null);
  const [addProperty, setAddProperty] = useState(null);
  const assistant = useAssistant();

  const load = async () => {
    setError('');
    try {
      const [objectRows, mappingRows] = await Promise.all([api(`/api/ontologies/${activeId}/object-types`), api(`/api/ontologies/${activeId}/enterprise/data-mappings`)]);
      setObjects(objectRows); setMappings(mappingRows);
    } catch (loadError) { setError(loadError.message); }
  };
  useEffect(() => { setObjects(null); load(); }, [activeId]);

  const rows = useMemo(() => flattenProperties(objects || [], mappings), [objects, mappings]);
  const domainOptions = useMemo(() => [...new Map((objects || []).filter((item) => item.business_domain_id).map((item) => [item.business_domain_id, item.business_domain_name])).entries()], [objects]);
  const objectOptions = useMemo(() => (objects || []).filter((item) => !domain || item.business_domain_id === domain), [objects, domain]);
  const typeOptions = useMemo(() => [...new Set(rows.map((row) => row.property.type).filter(Boolean))], [rows]);
  const categoryOptions = useMemo(() => [...new Set(rows.map((row) => row.property.property_category).filter(Boolean))], [rows]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return rows.filter(({ object, property, mapping: state, sharedCount }) => (
      (!domain || object.business_domain_id === domain)
      && (!objectId || object.id === objectId)
      && (!type || property.type === type)
      && (!category || property.property_category === category)
      && (!constraint || hasConstraint(property, constraint))
      && (!mapping || state === mapping)
      && (!onlyShared || sharedCount > 1)
      && (!keyword || `${property.name} ${property.key} ${property.description || ''} ${property.source_field || ''} ${object.display_name} ${object.name}`.toLowerCase().includes(keyword))
    ));
  }, [rows, query, domain, objectId, type, category, constraint, mapping, onlyShared]);
  useEffect(() => { setPage(1); }, [query, domain, objectId, type, category, constraint, mapping, onlyShared, pageSize]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selected = filtered.find((row) => row.id === selectedId) || pageRows[0] || null;
  const peers = selected ? propertyPeers(rows, selected) : [];
  const stats = useMemo(() => ({
    total: rows.length,
    objects: new Set(rows.map((row) => row.object.id)).size,
    unmapped: rows.filter((row) => row.mapping === 'unmapped').length,
    conflicts: new Set(rows.filter((row) => row.typeConflict).map((row) => row.property.key)).size,
  }), [rows]);
  const filtering = Boolean(query || domain || objectId || type || category || constraint || mapping || onlyShared);
  const reset = () => { setQuery(''); setDomain(''); setObjectId(''); setType(''); setCategory(''); setConstraint(''); setMapping(''); setOnlyShared(false); };

  const exportCsv = () => {
    const header = ['所属对象', '对象 API 名称', '业务域', '主题域', '属性名称', '字段名称', '数据类型', '属性类别', '主键', '必填', '唯一', '映射状态', '业务定义'];
    const lines = filtered.map(({ object, property, mapping: state }) => [object.display_name, object.name, object.business_domain_name, object.subject_domain_name, property.name, property.key, dataTypeLabel(property.type), property.property_category, property.is_primary_key ? '是' : '', property.is_required ? '是' : '', property.is_unique ? '是' : '', MAPPING_STATUS_LABELS[state], property.description || property.business_definition].map(csvCell).join(','));
    const blob = new Blob([`\uFEFF${[header.map(csvCell).join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = href; anchor.download = `${active?.name || '本体'}-对象属性.csv`; anchor.click();
    URL.revokeObjectURL(href);
  };
  const onSaved = async () => { setEditing(null); await load(); refreshOntologies(activeId); notify('对象类型已保存到工作状态'); };
  const onPropertySaved = async (objectId, key) => {
    setAddProperty(null);
    await load();
    refreshOntologies(activeId);
    reset();
    setSelectedId(`${objectId}:${key}`);
    notify('对象属性已新增到工作状态');
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!objects) return <Loading />;
  return <div className="oma-resource-page property-catalog">
    <section className="property-catalog-stats">
      {[['属性总数', stats.total], ['涉及对象', stats.objects], ['未映射属性', stats.unmapped, 'unmapped'], ['同名类型冲突', stats.conflicts, 'conflict']].map(([label, value, filter]) => <button type="button" key={label} disabled={!filter} className={(filter === 'unmapped' && mapping === 'unmapped') ? 'active' : ''} onClick={() => { if (filter === 'unmapped') setMapping(mapping === 'unmapped' ? '' : 'unmapped'); if (filter === 'conflict') { setOnlyShared(true); setQuery(''); } }}><b>{value}</b><small>{label}</small></button>)}
    </section>
    <section className="oma-resource-toolbar property-catalog-toolbar">
      <div className="oma-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索属性名称、字段名称、来源字段或所属对象" /></div>
      <select value={domain} onChange={(e) => { setDomain(e.target.value); setObjectId(''); }} aria-label="业务域"><option value="">全部业务域</option>{domainOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <select value={objectId} onChange={(e) => setObjectId(e.target.value)} aria-label="所属对象"><option value="">全部对象</option>{objectOptions.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select>
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="数据类型"><option value="">全部数据类型</option>{typeOptions.map((item) => <option key={item} value={item}>{dataTypeLabel(item)}</option>)}</select>
      <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="属性类别"><option value="">全部属性类别</option>{categoryOptions.map((item) => <option key={item}>{item}</option>)}</select>
      <select value={constraint} onChange={(e) => setConstraint(e.target.value)} aria-label="约束"><option value="">全部约束</option>{CONSTRAINTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select value={mapping} onChange={(e) => setMapping(e.target.value)} aria-label="映射状态"><option value="">全部映射状态</option>{Object.entries(MAPPING_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <label className="oma-toolbar-check"><input type="checkbox" checked={onlyShared} onChange={(e) => setOnlyShared(e.target.checked)} /> 仅同名字段</label>
      {filtering && <button type="button" className="oma-secondary" onClick={reset}>清空筛选</button>}
      <span>显示 {filtered.length} / 共 {rows.length} 项</span>
      <button type="button" className="oma-secondary" disabled={!filtered.length} onClick={exportCsv}><Download size={14} /> 导出</button>
    </section>
    <div className="oma-resource-layout"><section className="oma-resource-list"><header><strong>对象属性目录</strong><span>汇总全部对象类型的属性；可在此新增属性，修改仍请编辑所属对象</span><button type="button" className="oma-button property-add-button" onClick={() => setAddProperty({ defaultObjectId: selected?.object.id || '' })}><Plus size={14} /> 新增属性</button></header>
      {!filtered.length ? <EmptyState title={rows.length ? '没有匹配的属性' : '暂无对象属性'} description={rows.length ? '调整筛选条件后再试。' : '创建对象类型并定义属性后，会在这里汇总展示。'} action={filtering ? <button className="oma-secondary" onClick={reset}>清空筛选</button> : null} /> : <div className="property-catalog-table">
        <div className="property-catalog-head"><span>属性名称</span><span>字段名称</span><span>数据类型</span><span>属性类别</span><span>所属对象</span><span>约束</span><span>映射状态</span></div>
        {pageRows.map((row) => { const { object, property } = row; return <button type="button" key={row.id} className={selected?.id === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)} onDoubleClick={() => setEditing(object)} data-ai-resource={JSON.stringify({ type: 'attribute', id: `${object.id}:${property.key}`, label: property.name, parent: object.display_name, detail: { objectId: object.id, key: property.key, dataType: dataTypeLabel(property.type), mapping: row.mapping } })}>
          <span className="property-catalog-name"><b>{property.name}</b>{property.is_primary_key && <KeyRound size={12} aria-label="主键" />}</span>
          <code>{property.key}{row.sharedCount > 1 && <em className={row.typeConflict ? 'conflict' : ''} title={row.typeConflict ? '同名字段在其他对象中数据类型不同' : `${row.sharedCount} 个对象使用该字段`}>{row.typeConflict && <AlertTriangle size={10} />}×{row.sharedCount}</em>}</code>
          <span>{dataTypeLabel(property.type)}{property.type === 'enum' && property.options?.length ? <small> · {property.options.length} 项</small> : null}</span>
          <span>{property.property_category || '—'}</span>
          <span className="oma-resource-name"><i><ObjectTypeIcon value={object.icon} size={13} /></i><b>{object.display_name}</b>{object.is_core && <Star size={11} className="core-star" aria-label="核心对象" />}</span>
          <span className="property-flags-cell">{CONSTRAINTS.filter(([key]) => key !== 'searchable' && hasConstraint(property, key)).map(([key, label]) => <em key={key} className={key}>{label}</em>)}</span>
          <span className={`property-mapping ${row.mapping}`}>{MAPPING_STATUS_LABELS[row.mapping]}</span>
        </button>; })}
      </div>}
      <PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
    </section>
    <aside className="oma-resource-inspector">{selected ? <>
      <header><span>属性详情</span><div><button onClick={() => assistant.openWith({ type: 'attribute', id: `${selected.object.id}:${selected.property.key}`, label: selected.property.name, parent: selected.object.display_name, detail: { objectId: selected.object.id, key: selected.property.key } })} title="把该属性交给本体智能"><Sparkles size={14} /> 问 AI</button><button onClick={() => navigate(`/ontology/graph?focus=${selected.object.id}`)} title="在本体图谱中定位所属对象"><Network size={14} /> 图谱</button><button onClick={() => setEditing(selected.object)}><Pencil size={14} /> 编辑所属对象</button></div></header>
      <div className="oma-inspector-title"><i><KeyRound size={16} /></i><div><h3>{selected.property.name}</h3><code>{selected.property.key}</code></div></div>
      <p>{selected.property.description || selected.property.business_definition || '尚未填写业务定义。'}</p>
      <dl>{[
        ['所属对象', <button type="button" className="link-button" onClick={() => setObjectId(selected.object.id)}>{selected.object.display_name}</button>],
        ['业务域 / 主题域', `${selected.object.business_domain_name || '未分类'} / ${selected.object.subject_domain_name || '未分类'}`],
        ['数据类型', dataTypeLabel(selected.property.type)],
        ['属性类别', selected.property.property_category || '未设置'],
        ['枚举值', selected.property.type === 'enum' ? (selected.property.options || []).join('、') || '未设置' : null],
        ['单位', selected.property.unit],
        ['约束', CONSTRAINTS.filter(([key]) => hasConstraint(selected.property, key)).map(([, label]) => label).join('、') || '无'],
        ['标题属性', selected.object.title_property === selected.property.key ? '是' : '否'],
        ['来源字段（模板）', selected.property.source_field],
        ['来源系统（模板）', selected.property.source_system],
        ['映射状态', MAPPING_STATUS_LABELS[selected.mapping]],
      ].filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="oma-interface-props"><strong>同名字段 · {peers.length ? `另有 ${peers.length} 个对象使用` : '仅此对象使用'}</strong>{peers.map((peer) => <div key={peer.id}><span>{peer.object.display_name}{peer.property.type !== selected.property.type && <em className="conflict">类型不同</em>}</span><code>{peer.property.name} · {dataTypeLabel(peer.property.type)}</code></div>)}{!peers.length && <p className="form-hint">该字段名没有在其他对象中出现。</p>}</div>
    </> : <EmptyState title="请选择属性" description="从左侧目录查看属性定义与使用情况。" />}</aside></div>
    {editing && <ObjectTypeEditor activeId={activeId} editing={editing} notify={notify} onClose={() => setEditing(null)} onSaved={onSaved} />}
    {addProperty && <PropertyCreateDialog objects={objects} activeId={activeId} defaultObjectId={addProperty.defaultObjectId} notify={notify} onClose={() => setAddProperty(null)} onSaved={onPropertySaved} />}
  </div>;
}
