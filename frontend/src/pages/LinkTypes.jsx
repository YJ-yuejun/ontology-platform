import { useEffect, useMemo, useState } from 'react';
import { Network, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, formatTime } from '../api';
import { statusLabel } from '../labels';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import LinkTypeEditor, { LINK_CARDINALITIES as cardinalities } from '../components/LinkTypeEditor';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import useCreateIntent from '../hooks/useCreateIntent';
import { useModelingEntry } from '../components/ModelingEntry';

export default function LinkTypes({ activeId, refreshOntologies, notify }) {
  const navigate = useNavigate();
  const { requestResource } = useModelingEntry();
  const [items, setItems] = useState(null);
  const [objects, setObjects] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState(null);
  // editor: null | { mode: 'create' } | { mode: 'edit', item }
  const [editor, setEditor] = useState(null);

  const load = () => {
    setItems(null); setError('');
    Promise.all([api(`/api/ontologies/${activeId}/link-types`), api(`/api/ontologies/${activeId}/object-types?include_abstract=false`)]).then(([links, types]) => { setItems(links); setObjects(types); setSelected((old) => links.find((item) => item.id === old?.id) || links[0] || null); }).catch((e) => setError(e.message));
  };
  useEffect(load, [activeId]);
  const filtered = useMemo(() => (items || []).filter((item) => `${item.display_name} ${item.name} ${item.template_id || ''} ${item.external_id || ''} ${item.source_display_name} ${item.target_display_name}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, pageSize]);
  useEffect(() => { if (items && !filtered.some((item) => item.id === selected?.id)) setSelected(filtered[0] || null); }, [items, filtered, selected?.id]);
  useHistoryResourceFocus({ resourceTypes: ['link_type', '关系'], items, visible: filtered, pageSize, setPage, onSelect: setSelected, ready: Boolean(items) });
  const openManualCreate = () => setEditor({ mode: 'create' });
  const openCreate = () => requestResource({ type: 'link_type', objectCount: objects.length, onManual: openManualCreate });
  const openEdit = (item) => setEditor({ mode: 'edit', item });
  const onSaved = (saved) => { setSelected(saved); setEditor(null); load(); refreshOntologies(activeId); };
  const remove = async (item) => {
    if (!window.confirm(`删除关系类型“${item.display_name}”？`)) return;
    try { await api(`/api/link-types/${item.id}`, { method: 'DELETE' }); setSelected(null); load(); refreshOntologies(activeId); } catch (e) { notify(e.message); }
  };
  useCreateIntent(Boolean(items) && objects.length > 0, openManualCreate);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <Loading />;
  return <div className="page-grid">
    <div className="toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索关系、起点或终点" /></div><div className="toolbar-note">共 {items.length} 个关系类型</div><button className="btn primary" onClick={openCreate}><Plus size={17} /> 新建关系类型</button></div>
    {objects.length === 0 ? <EmptyState title="请先创建对象类型" description="关系必须连接两个已有对象类型。" /> : <div className="semantic-master-detail"><section className="semantic-records"><header><span>业务关系</span><span>起点 → 终点</span><span>基数</span><span>状态</span></header>{pageRows.map((item) => <button type="button" className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item)} onDoubleClick={() => openEdit(item)} key={item.id}><span><strong>{item.display_name}</strong><small>{item.external_id || item.template_id || item.name}</small></span><span>{item.source_display_name} → {item.target_display_name}</span><span>{cardinalities[item.cardinality] || item.cardinality}</span><span>{statusLabel(item.status)}</span></button>)}{!filtered.length && <EmptyState title={query ? '没有匹配的关系' : '还没有关系类型'} description={query ? '换一个关键词试试。' : '用关系把孤立的对象连接成业务语义网络。'} />}<PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></section><aside className="semantic-inspector"><header><strong>关系详情</strong>{selected && <div><ResourceHistoryLink resourceType="link_type" resourceId={selected.id} /><button onClick={() => navigate(`/ontology/graph?focus=${selected.source_object_type_id}`)} title="在本体图谱中查看起点对象及其关联"><Network size={14} /> 图谱</button><button onClick={() => openEdit(selected)}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={() => remove(selected)}><Trash2 size={14} /> 删除</button></div>}</header>{selected ? <div className="semantic-inspector-body"><h3>{selected.display_name}</h3><p>{selected.description || '暂无业务定义'}</p><dl>{[['关系 ID', selected.external_id || selected.template_id || selected.name], ['关系 API 名称', selected.name], ['起点对象', selected.source_display_name], ['终点对象', selected.target_display_name], ['反向名称', selected.reverse_display_name], ['反向 API 名称', selected.reverse_name], ['关系基数', cardinalities[selected.cardinality] || selected.cardinality], ['来源系统', selected.source_system], ['起点键', selected.source_key], ['终点键', selected.target_key], ['核心关系', selected.is_core ? '是' : '否'], ['双向展示', selected.bidirectional_display === false ? '否' : '是'], ['关系属性', (selected.properties || []).map((item) => item.name).join('、') || '无'], ['状态', statusLabel(selected.status)], ['更新时间', formatTime(selected.updated_at)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl></div> : <EmptyState title="请选择关系" description="从左侧目录选择一条关系查看详情。" />}</aside></div>}
    {editor && <LinkTypeEditor activeId={activeId} objects={objects} editing={editor.mode === 'edit' ? editor.item : null} notify={notify} onClose={() => setEditor(null)} onSaved={onSaved} />}
  </div>;
}
