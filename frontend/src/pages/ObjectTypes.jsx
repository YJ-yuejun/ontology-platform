import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, KeyRound, Network, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react';
import { api } from '../api';
import { dataTypeLabel, designStatusLabel, statusLabel, STATUS_OPTIONS } from '../labels';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import { ObjectTypeIcon } from '../components/ObjectTypeIcon';
import ObjectTypeEditor from '../components/ObjectTypeEditor';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import useCreateIntent from '../hooks/useCreateIntent';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import { useModelingEntry } from '../components/ModelingEntry';
import { objectMappingState } from '../objectMapping';

export default function ObjectTypes({ activeId, refreshOntologies, notify }) {
  const navigate = useNavigate();
  const { requestResource, requestUpdate } = useModelingEntry();
  const [items, setItems] = useState(null);
  const [interfaces, setInterfaces] = useState([]);
  const [sources, setSources] = useState([]);
  const [governanceAssets, setGovernanceAssets] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [coreOnly, setCoreOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState(null);
  // editor: null | { mode: 'create' } | { mode: 'edit', item }
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState('');
  const [mappingHint, setMappingHint] = useState(null);

  const load = async (preferredId) => {
    setError('');
    try {
      const [objects, interfaceRows, sourceRows, assetRows, mappingRows] = await Promise.all([
        api(`/api/ontologies/${activeId}/object-types`), api(`/api/ontologies/${activeId}/interfaces`),
        api(`/api/ontologies/${activeId}/enterprise/data-sources`), api(`/api/ontologies/${activeId}/enterprise/governance-assets`), api(`/api/ontologies/${activeId}/enterprise/data-mappings`),
      ]);
      setItems(objects); setInterfaces(interfaceRows); setSources(sourceRows); setGovernanceAssets(assetRows); setMappings(mappingRows);
      setSelected((old) => objects.find((item) => item.id === (preferredId || old?.id)) || objects[0] || null);
    } catch (loadError) { setError(loadError.message); }
  };
  useEffect(() => { setItems(null); load(); }, [activeId]);

  const filtered = useMemo(() => (items || []).filter((item) => (
    (status === 'all' || item.status === status)
    && (!coreOnly || item.is_core)
    && `${item.display_name} ${item.name} ${item.external_id || ''} ${item.description || ''} ${item.domain || ''} ${item.subject_domain_name || ''}`.toLowerCase().includes(query.toLowerCase())
  )), [items, query, status, coreOnly]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, status, coreOnly, pageSize]);
  useEffect(() => { if (items && !filtered.some((item) => item.id === selected?.id)) setSelected(filtered[0] || null); }, [items, filtered, selected?.id]);
  useHistoryResourceFocus({ resourceTypes: ['object_type', '对象'], items, visible: filtered, pageSize, setPage, onSelect: setSelected, ready: Boolean(items) });
  const interfaceName = (id) => interfaces.find((item) => item.id === id)?.display_name || '未知接口';
  const sourceName = (code) => sources.find((item) => item.code === code)?.name || code || '未映射';
  const mappingState = (item) => objectMappingState(item, mappings);
  const mappingHintAsset = selected && mappingHint?.objectId === selected.id
    ? governanceAssets.find((item) => item.verification_status === 'confirmed' && item.code === mappingHint.assetCode) : null;

  const startManualCreate = () => setEditor({ mode: 'create' });
  const startCreate = () => requestResource({ type: 'object_type', onManual: startManualCreate });
  const startEdit = (item) => setEditor({ mode: 'edit', item });
  useCreateIntent(Boolean(items), startManualCreate);

  const onSaved = async (saved, { assetCode }) => {
    if (editor?.mode === 'create') setMappingHint({ objectId: saved.id, assetCode });
    setEditor(null); await load(saved.id); refreshOntologies(activeId); notify('对象类型已保存到工作状态');
  };
  const remove = async (item) => {
    if (!window.confirm(`确定删除对象类型“${item.display_name}”吗？`)) return;
    try { await api(`/api/object-types/${item.id}`, { method: 'DELETE' }); await load(); refreshOntologies(activeId); } catch (removeError) { notify(removeError.message); }
  };
  const openSemanticMapping = (item, assetCode = '') => {
    const params = new URLSearchParams({ object: item.name });
    if (assetCode) params.set('asset', assetCode);
    navigate(`/ontology/data/connections?${params.toString()}`);
  };
  const selectedMappingState = selected ? mappingState(selected) : null;
  const mappingCoverageText = (state) => (state.requiredCount > 0
    ? `已覆盖 ${state.mappedCount}/${state.requiredCount} 个需映射属性`
    : '当前没有需建立来源映射的属性');

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!items) return <Loading />;
  return <div className="oma-resource-page">
    <section className="oma-resource-toolbar"><div className="oma-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索对象、模板 ID、稳定标识或主题域" /></div><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">全部资源状态</option>{STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><label className="oma-toolbar-check"><input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} /> 仅核心对象</label><span>显示 {filtered.length} / 共 {items.length} 个</span><button className="bc-button" disabled={!selected} title={`更新：${selected?.display_name || '先选择对象'}`} onClick={() => requestUpdate({ type: 'object_type', resource: selected, onManual: () => startEdit(selected), returnTo: '/ontology/model/object-types' })}>更新选中对象</button><button className="oma-button" onClick={startCreate}><Plus size={15} /> 新建对象类型</button></section>
    <div className="oma-resource-layout"><section className="oma-resource-list"><header><strong>对象类型目录</strong><span>对象直接归属主题域；对象类别保留模板字段</span></header>{!filtered.length ? <EmptyState title="暂无对象类型" description="创建第一个可产生实例的业务对象。" action={<button className="oma-button" onClick={startCreate}><Plus size={15} /> 新建对象类型</button>} /> : <div className="oma-object-table simple"><div className="oma-object-head"><span>对象名称</span><span>模板 ID</span><span>资源状态</span><span>属性</span><span>对象类别 / 归属业务域</span><span>映射状态</span></div>{pageRows.map((item) => { const state = mappingState(item); return <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item)} onDoubleClick={() => startEdit(item)}><span className="oma-resource-name"><i><ObjectTypeIcon value={item.icon} /></i><b>{item.display_name}</b>{item.is_core && <em className="core-badge" title="核心对象"><Star size={10} /> 核心</em>}</span><code>{item.external_id || item.name}</code><span><em className={`oma-status ${item.status}`}>{statusLabel(item.status)}</em></span><span>{item.properties.length} 项</span><span className="oma-detail">{item.category || '未填写'} / {item.business_domain_name || '未分类'}</span><span className={`oma-mapping-state ${state.label === '已确认' || state.label === '无需映射' ? 'confirmed' : ''}`} title={`${mappingCoverageText(state)}${state.count ? `；已有 ${state.confirmedCount}/${state.count} 条映射确认` : ''}`}>{state.label} · {state.requiredCount > 0 ? `${state.mappedCount}/${state.requiredCount}` : '无需'}{state.count ? ` · ${state.confirmedCount}/${state.count} 确认` : ''}</span></button>; })}</div>}<PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></section>
      <aside className="oma-resource-inspector">{selected ? <><header><span>对象详情</span><div><ResourceHistoryLink resourceType="object_type" resourceId={selected.id} /><button onClick={() => navigate(`/ontology/graph?focus=${selected.id}`)} title="在本体图谱中定位该对象"><Network size={14} /> 图谱</button><button onClick={() => startEdit(selected)}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={() => remove(selected)}><Trash2 size={14} /> 删除</button></div></header><div className="oma-inspector-title"><i><ObjectTypeIcon value={selected.icon} size={18} /></i><div><h3>{selected.display_name}{selected.is_core && <em className="core-badge"><Star size={10} /> 核心</em>}</h3><code>{selected.name}</code></div></div><p>{selected.description || '尚未填写业务说明。'}</p><dl><div><dt>模板对象类型 ID</dt><dd><code>{selected.external_id || '未填写'}</code></dd></div><div><dt>对象类别</dt><dd>{selected.category || '未填写'}</dd></div><div><dt>归属业务域 / 主题域</dt><dd>{selected.business_domain_name || '未分类'} / {selected.subject_domain_name || '未分类'}</dd></div><div><dt>模板业务域原值</dt><dd>{selected.domain || '未填写'}</dd></div><div><dt>资源使用状态</dt><dd><em className={`oma-status ${selected.status}`}>{statusLabel(selected.status)}</em></dd></div><div><dt>模板建模状态</dt><dd>{designStatusLabel(selected.design_status)}</dd></div><div><dt>模板来源系统</dt><dd>{selected.source_system || '未填写'}</dd></div><div><dt>映射状态</dt><dd>{selectedMappingState.label} · {selectedMappingState.requiredCount > 0 ? `${selectedMappingState.mappedCount}/${selectedMappingState.requiredCount} 个需映射属性` : '无需来源映射'}{selectedMappingState.count ? ` · ${selectedMappingState.confirmedCount}/${selectedMappingState.count} 条映射已确认` : ''}</dd></div>{selected.backing_source && <div><dt>历史直接来源</dt><dd>{sourceName(selected.backing_source)}</dd></div>}<div><dt>标题属性</dt><dd><code>{selected.title_property}</code></dd></div><div><dt>实现接口</dt><dd>{(selected.interface_ids || []).map(interfaceName).join('、') || '无'}</dd></div></dl>
        <section className="oma-mapping-setup"><div><strong>语义映射</strong><em className={`oma-mapping-state ${selectedMappingState.label === '已确认' || selectedMappingState.label === '无需映射' ? 'confirmed' : ''}`}>{selectedMappingState.label}</em></div><p>{mappingCoverageText(selectedMappingState)}{selectedMappingState.count ? `；已存属性映射 ${selectedMappingState.confirmedCount}/${selectedMappingState.count} 条已确认、${selectedMappingState.pendingCount} 条待确认` : ''}。保存对象定义不会导入或读取实例数据。</p>{mappingHintAsset && <small>创建时选择的参考治理资产：{mappingHintAsset.name}（仅作为映射上下文）</small>}<button className="btn secondary" onClick={() => openSemanticMapping(selected, mappingHintAsset?.code)}>{selectedMappingState.count ? '检查或补充映射' : selectedMappingState.requiredCount > 0 ? '建立语义映射' : '配置可选映射'} <ChevronRight size={14} /></button></section>
        {selected.source_binding_issue && !selected.backing_source && <p className="template-field-note">{selected.source_binding_issue}。模板原值是“{selected.source_system}”，请通过治理资产建立新的语义映射。</p>}<div className="oma-interface-props"><strong>对象属性</strong>{selected.properties.map((prop) => <div key={prop.key}><span>{prop.name}{prop.is_primary_key && <KeyRound size={11} />}{prop.is_required && <em>必填</em>}</span><code>{prop.key} · {dataTypeLabel(prop.type)}{prop.source_field ? ` · ${prop.source_field}` : ''}</code></div>)}</div></> : <EmptyState title="请选择对象" description="从左侧目录查看对象定义。" />}</aside></div>

    {editor && <ObjectTypeEditor activeId={activeId} editing={editor.mode === 'edit' ? editor.item : null} notify={notify} onClose={() => setEditor(null)} onSaved={onSaved} />}
  </div>;
}
