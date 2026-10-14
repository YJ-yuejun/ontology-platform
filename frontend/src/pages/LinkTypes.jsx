import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, formatTime } from '../api';
import { designStatusValue, DESIGN_STATUS_OPTIONS, statusLabel, STATUS_OPTIONS } from '../labels';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import PropertyEditor from '../components/PropertyEditor';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import useCreateIntent from '../hooks/useCreateIntent';
import { useModelingEntry } from '../components/ModelingEntry';

const cardinalities = { one_to_one: '一对一', one_to_many: '一对多', many_to_one: '多对一', many_to_many: '多对多' };
const emptyForm = () => ({ name: '', display_name: '', external_id: '', source_object_type_id: '', target_object_type_id: '', cardinality: '', description: '', status: 'experimental', design_status: 'draft', properties: [], source_system: '', source_key: '', target_key: '', is_core: false, bidirectional_display: false });

export default function LinkTypes({ activeId, refreshOntologies, notify }) {
  const { requestResource } = useModelingEntry();
  const [items, setItems] = useState(null);
  const [objects, setObjects] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

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
  const openManualCreate = () => { setForm(emptyForm()); setCreating(true); setEditing(null); };
  const openCreate = () => requestResource({ type: 'link_type', objectCount: objects.length, onManual: openManualCreate });
  const openEdit = (item) => { setForm({ ...emptyForm(), ...item, external_id: item.external_id || '', description: item.description || '', design_status: designStatusValue(item.design_status), properties: item.properties || [], source_system: item.source_system || '', source_key: item.source_key || '', target_key: item.target_key || '', is_core: Boolean(item.is_core), bidirectional_display: item.bidirectional_display !== false }); setEditing(item); setCreating(false); };
  const close = () => { setCreating(false); setEditing(null); };
  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    try { const saved = await api(editing ? `/api/link-types/${editing.id}` : `/api/ontologies/${activeId}/link-types`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(form) }); setSelected(saved); close(); load(); refreshOntologies(activeId); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(`删除关系类型“${item.display_name}”？`)) return;
    try { await api(`/api/link-types/${item.id}`, { method: 'DELETE' }); setSelected(null); load(); refreshOntologies(activeId); } catch (e) { notify(e.message); }
  };
  useCreateIntent(Boolean(items) && objects.length > 0, openManualCreate);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <Loading />;
  return <div className="page-grid">
    <div className="toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索关系、起点或终点" /></div><div className="toolbar-note">共 {items.length} 个关系类型</div><button className="btn primary" onClick={openCreate}><Plus size={17} /> 新建关系类型</button></div>
    {objects.length === 0 ? <EmptyState title="请先创建对象类型" description="关系必须连接两个已有对象类型。" /> : <div className="semantic-master-detail"><section className="semantic-records"><header><span>业务关系</span><span>起点 → 终点</span><span>基数</span><span>状态</span></header>{pageRows.map((item) => <button type="button" className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item)} key={item.id}><span><strong>{item.display_name}</strong><small>{item.external_id || item.template_id || item.name}</small></span><span>{item.source_display_name} → {item.target_display_name}</span><span>{cardinalities[item.cardinality] || item.cardinality}</span><span>{statusLabel(item.status)}</span></button>)}{!filtered.length && <EmptyState title={query ? '没有匹配的关系' : '还没有关系类型'} description={query ? '换一个关键词试试。' : '用关系把孤立的对象连接成业务语义网络。'} />}<PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></section><aside className="semantic-inspector"><header><strong>关系详情</strong>{selected && <div><ResourceHistoryLink resourceType="link_type" resourceId={selected.id} /><button onClick={() => openEdit(selected)}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={() => remove(selected)}><Trash2 size={14} /> 删除</button></div>}</header>{selected ? <div className="semantic-inspector-body"><h3>{selected.display_name}</h3><p>{selected.description || '暂无业务定义'}</p><dl>{[['关系 ID', selected.external_id || selected.template_id || selected.name], ['关系 API 名称', selected.name], ['起点对象', selected.source_display_name], ['终点对象', selected.target_display_name], ['关系基数', cardinalities[selected.cardinality] || selected.cardinality], ['来源系统', selected.source_system], ['起点键', selected.source_key], ['终点键', selected.target_key], ['核心关系', selected.is_core ? '是' : '否'], ['双向展示', selected.bidirectional_display === false ? '否' : '是'], ['关系属性', (selected.properties || []).map((item) => item.name).join('、') || '无'], ['状态', statusLabel(selected.status)], ['更新时间', formatTime(selected.updated_at)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl></div> : <EmptyState title="请选择关系" description="从左侧目录选择一条关系查看详情。" />}</aside></div>}
    {(creating || editing) && <Modal wide title={editing ? `编辑关系 · ${editing.display_name}` : '新建关系类型'} subtitle="明确关系方向、业务含义与基数，避免把关系当成普通字段" onClose={close} footer={<><button className="btn secondary" onClick={close}>取消</button><button form="link-form" className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存关系类型'}</button></>}>
      <form id="link-form" onSubmit={save} className="form-sections">
        <section className="form-section"><h3>1. 基础信息</h3><div className="form-grid two">
          <label><span>关系 ID（模板）</span><input className="mono" value={form.external_id} onChange={(e) => setForm({ ...form, external_id: e.target.value })} placeholder="例如：L-001" /></label>
          <label><span>关系名称</span><input required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="归属部门" /></label>
          <label><span>关系 API 名称</span><input required className="mono" disabled={editing?.status === 'active'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="asset_belongs_to_department" /></label>
          <label><span>业务定义</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="说明关系成立的业务条件与正式方向" /></label>
        </div></section>
        <section className="form-section"><h3>2. 关系结构</h3><div className="form-grid two">
          <label><span>起点对象</span><select required value={form.source_object_type_id} onChange={(e) => setForm({ ...form, source_object_type_id: e.target.value, source_key: '' })}><option value="">请选择起点对象</option>{objects.map((obj) => <option value={obj.id} key={obj.id}>{obj.display_name} · {obj.name}</option>)}</select></label>
          <label><span>终点对象</span><select required value={form.target_object_type_id} onChange={(e) => setForm({ ...form, target_object_type_id: e.target.value, target_key: '' })}><option value="">请选择终点对象</option>{objects.map((obj) => <option value={obj.id} key={obj.id}>{obj.display_name} · {obj.name}</option>)}</select></label>
          <label><span>关系方向</span><input disabled value={`${objects.find((obj) => obj.id === form.source_object_type_id)?.display_name || '起点'} → ${objects.find((obj) => obj.id === form.target_object_type_id)?.display_name || '终点'}`} /></label>
          <label><span>关系基数</span><select required value={form.cardinality} onChange={(e) => setForm({ ...form, cardinality: e.target.value })}><option value="">请选择关系基数</option>{Object.entries(cardinalities).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>
        </div><p className="form-hint">关系方向以起点 → 终点为事实；双向展示只影响查询，不会改变正式关系。</p></section>
        <section className="form-section"><h3>3. 来源与治理</h3><div className="form-grid two">
          <label><span>来源系统</span><input value={form.source_system || ''} onChange={(e) => setForm({ ...form, source_system: e.target.value })} placeholder="例如：调度系统 / 资产系统" /></label>
          <label><span>起点键</span><input className="mono" value={form.source_key || ''} onChange={(e) => setForm({ ...form, source_key: e.target.value })} placeholder="例如：TASK_ID" /></label>
          <label><span>终点键</span><input className="mono" value={form.target_key || ''} onChange={(e) => setForm({ ...form, target_key: e.target.value })} placeholder="例如：PIPE_ID" /></label>
          <label><span>使用状态</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label><span>模板建模状态</span><select value={form.design_status || 'draft'} onChange={(e) => setForm({ ...form, design_status: e.target.value })}>{DESIGN_STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div><div className="template-boolean-grid"><label className="check"><input type="checkbox" checked={Boolean(form.is_core)} onChange={(e) => setForm({ ...form, is_core: e.target.checked })} /> 核心关系</label><label className="check"><input type="checkbox" checked={Boolean(form.bidirectional_display)} onChange={(e) => setForm({ ...form, bidirectional_display: e.target.checked })} /> 双向展示</label></div></section>
        <section className="form-section"><h3>4. 关系属性（可选）</h3><PropertyEditor primaryKey={false} label="关系属性" value={form.properties} onChange={(properties) => setForm({ ...form, properties })} /></section>
      </form>
    </Modal>}
  </div>;
}
