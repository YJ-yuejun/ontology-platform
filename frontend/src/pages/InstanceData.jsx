import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Database, Pencil, Plus, Search, Trash2, Waypoints } from 'lucide-react';
import { api } from '../api';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import { ObjectTypeIcon } from '../components/ObjectTypeIcon';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';

const emptyForm = () => ({ object_type_id: '', business_key: '', title: '', properties: {}, record_status: '有效', sync_status: 'synced', source_system: '', source_pk: '', last_synced_at: '', sync_error: '', quality_status: 'passed' });
const syncLabels = { pending: '待同步', syncing: '同步中', synced: '已同步', failed: '同步失败', stale: '已过期', disabled: '已停用' };
const qualityLabels = { passed: '质量通过', warning: '质量警告', failed: '质量失败', unknown: '未评估' };
const money = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

function renderValue(value, definition) {
  if (value === null || value === undefined || value === '') return '—';
  if (definition?.type === 'decimal' || definition?.type === 'integer') return money.format(Number(value));
  if (definition?.type === 'boolean') return value ? '是' : '否';
  return String(value);
}

export default function InstanceData({ activeId, refreshOntologies, notify }) {
  const [types, setTypes] = useState(null);
  const [instances, setInstances] = useState([]);
  const [selectedType, setSelectedType] = useState('all');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async (preferredId) => {
    setError('');
    try {
      const [objectTypes, records] = await Promise.all([api(`/api/ontologies/${activeId}/object-types?include_abstract=false`), api(`/api/ontologies/${activeId}/instances`)]);
      setTypes(objectTypes); setInstances(records);
      const next = records.find((item) => item.id === (preferredId || selected?.id)) || records.find((item) => item.object_type_name === 'PaymentRequest') || records[0] || null;
      setSelected(next);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { setTypes(null); setSelected(null); setDetail(null); load(); }, [activeId]);
  useEffect(() => { if (!selected) { setDetail(null); return; } api(`/api/instances/${selected.id}`).then(setDetail).catch((e) => setError(e.message)); }, [selected?.id]);

  const counts = useMemo(() => instances.reduce((result, item) => ({ ...result, [item.object_type_id]: (result[item.object_type_id] || 0) + 1 }), {}), [instances]);
  const filtered = useMemo(() => instances.filter((item) => (selectedType === 'all' || item.object_type_id === selectedType) && `${item.title} ${item.business_key} ${item.object_type_display_name}`.toLowerCase().includes(query.toLowerCase())), [instances, selectedType, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, selectedType, pageSize]);
  useEffect(() => { if (instances.length && !filtered.some((item) => item.id === selected?.id)) setSelected(filtered[0] || null); }, [instances, filtered, selected?.id]);
  useHistoryResourceFocus({ resourceTypes: ['object_instance'], items: instances, visible: filtered, pageSize, setPage, onSelect: setSelected, ready: Boolean(types) });
  const currentType = types?.find((item) => item.id === form.object_type_id);
  const selectedDefinition = types?.find((item) => item.id === detail?.object_type_id);
  const propertyDefinition = (key) => selectedDefinition?.properties.find((item) => item.key === key);

  const selectRecord = (id) => { const item = instances.find((record) => record.id === id); if (item) { setSelectedType('all'); setQuery(''); setPage(1); setSelected(item); } };
  const initializeProperties = (type, source = {}) => Object.fromEntries((type?.properties || []).map((item) => [item.key, source[item.key] ?? item.default ?? '']));
  const openCreate = () => { const type = types[0]; setForm({ ...emptyForm(), object_type_id: type?.id || '', properties: initializeProperties(type) }); setCreating(true); setEditing(null); };
  const openEdit = () => { if (!detail) return; setForm({ ...emptyForm(), object_type_id: detail.object_type_id, business_key: detail.business_key, title: detail.title, record_status: detail.record_status, sync_status: detail.sync_status, source_system: detail.source_system || '', source_pk: detail.source_pk || '', last_synced_at: detail.last_synced_at || '', sync_error: detail.sync_error || '', quality_status: detail.quality_status || 'unknown', properties: initializeProperties(selectedDefinition, detail.properties) }); setEditing(detail); setCreating(false); };
  const close = () => { setCreating(false); setEditing(null); };
  const changeType = (id) => { const type = types.find((item) => item.id === id); setForm({ ...form, object_type_id: id, business_key: '', title: '', properties: initializeProperties(type) }); };
  const updateProperty = (key, value) => setForm({ ...form, properties: { ...form.properties, [key]: value } });
  const normalize = () => ({ ...form, properties: Object.fromEntries((currentType?.properties || []).map((item) => { const raw = form.properties[item.key]; if (raw === '') return [item.key, '']; if (item.type === 'integer') return [item.key, Number.parseInt(raw, 10)]; if (item.type === 'decimal') return [item.key, Number(raw)]; if (item.type === 'boolean') return [item.key, raw === true || raw === 'true']; return [item.key, raw]; })) });
  const save = async (event) => { event.preventDefault(); setBusy(true); try { const saved = await api(editing ? `/api/instances/${editing.id}` : `/api/ontologies/${activeId}/instances`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(normalize()) }); close(); await load(saved.id); refreshOntologies(activeId); } catch (e) { notify(e.message); } finally { setBusy(false); } };
  const remove = async () => { if (!detail || !window.confirm(`删除实例“${detail.title}”及其关系吗？`)) return; try { await api(`/api/instances/${detail.id}`, { method: 'DELETE' }); setSelected(null); await load(); refreshOntologies(activeId); } catch (e) { notify(e.message); } };

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!types) return <Loading />;
  return <div className="instance-page">
    <section className="instance-toolbar"><div><Database size={18} /><span><strong>实例数据浏览器</strong><small>从业务对象出发穿透采购链路；当前为内置脱敏样例，可手工增删改查。</small></span></div><label><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索实例名称、主键或对象类型" /></label><button className="oma-button" disabled={!types.length} onClick={openCreate}><Plus size={15} /> 新建实例</button></section>
    <div className="instance-layout">
      <aside className="instance-types"><header><strong>对象类型</strong><span>{types.length} 类 · {instances.length} 条实例</span></header><button className={selectedType === 'all' ? 'active' : ''} onClick={() => setSelectedType('all')}><i><Waypoints size={16} /></i><span>全部对象</span><b>{instances.length}</b></button>{types.filter((type) => counts[type.id]).map((type) => <button key={type.id} className={selectedType === type.id ? 'active' : ''} onClick={() => setSelectedType(type.id)}><i><ObjectTypeIcon value={type.icon} size={16} /></i><span>{type.display_name}</span><b>{counts[type.id]}</b></button>)}</aside>
      <section className="instance-list"><header><strong>{selectedType === 'all' ? '全部业务实例' : types.find((item) => item.id === selectedType)?.display_name}</strong><span>显示 {filtered.length} 条记录</span></header>{!filtered.length ? <EmptyState title="没有匹配的实例" description="调整对象类型或搜索条件，也可以手工创建新实例。" /> : pageRows.map((item) => <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item)}><i><ObjectTypeIcon value={item.object_type_icon} size={18} /></i><span><b>{item.title}</b><code>{item.business_key}</code></span><em>{item.object_type_display_name}</em><small>{item.record_status} · {syncLabels[item.sync_status]}</small></button>)}<PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></section>
      <aside className="instance-inspector">{detail ? <><header><span>实例详情</span><div><ResourceHistoryLink resourceType="object_instance" resourceId={detail.id} /><button onClick={openEdit}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={remove} title="删除实例"><Trash2 size={14} /></button></div></header><div className="instance-title"><i><ObjectTypeIcon value={detail.object_type_icon} size={22} /></i><span><h2>{detail.title}</h2><code>{detail.business_key} · {detail.object_type_display_name}</code></span><em>{detail.record_status}</em></div><section className="instance-runtime-state"><div><span>业务状态</span><b>{detail.record_status}</b></div><div><span>同步状态</span><b className={detail.sync_status}>{syncLabels[detail.sync_status] || detail.sync_status}</b></div><div><span>数据质量</span><b className={detail.quality_status}>{qualityLabels[detail.quality_status] || detail.quality_status}</b></div><div><span>来源定位</span><code>{detail.source_system || '手工录入'} · {detail.source_pk || detail.business_key}</code></div></section>{detail.sync_error && <div className="instance-sync-error"><AlertTriangle size={15} />{detail.sync_error}</div>}{detail.properties.risk_level && <div className={`instance-risk ${detail.properties.risk_level === '高' || detail.properties.risk_level === '重大' ? 'high' : ''}`}><AlertTriangle size={17} /><span><b>{detail.properties.risk_level}风险</b><small>{detail.properties.review_result || detail.properties.reason || '该对象已标记风险等级'}</small></span></div>}<section className="instance-properties"><strong>对象属性</strong>{Object.entries(detail.properties).map(([key, value]) => <div key={key}><span>{propertyDefinition(key)?.name || key}</span><b>{renderValue(value, propertyDefinition(key))}</b><code>{key}</code></div>)}</section><section className="instance-relations"><strong>关联业务对象 <em>{detail.related.length}</em></strong>{detail.related.length ? detail.related.map((item) => <button key={item.id} onClick={() => selectRecord(item.related_instance_id)}><i><ObjectTypeIcon value={item.related_object_icon} size={16} /></i><span><b>{item.related_title}</b><small>{item.direction === 'outgoing' ? item.link_display_name : `反向 · ${item.link_display_name}`} · {item.related_object_type}</small></span>{item.direction === 'outgoing' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}</button>) : <p>该实例尚未建立关系。</p>}</section></> : <EmptyState title="选择一个实例" description="查看它的属性和关联业务对象。" />}</aside>
    </div>
    {(creating || editing) && <Modal wide title={editing ? `编辑实例 · ${editing.title}` : '新建对象实例'} subtitle="业务状态与数据同步状态分开管理" onClose={close} footer={<><button className="btn secondary" onClick={close}>取消</button><button className="btn primary" form="instance-form" disabled={busy}>{busy ? '保存中…' : '保存实例'}</button></>}><form id="instance-form" className="form-sections" onSubmit={save}><section className="form-section"><h3>实例标识</h3><div className="form-grid two"><label><span>对象类型</span><select disabled={Boolean(editing)} required value={form.object_type_id} onChange={(e) => changeType(e.target.value)}>{types.map((item) => <option key={item.id} value={item.id}>{item.display_name} · {item.name}</option>)}</select></label><label><span>业务主键</span><input required className="mono" value={form.business_key} onChange={(e) => setForm({ ...form, business_key: e.target.value })} /></label><label><span>实例标题</span><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label></div></section><section className="form-section"><h3>运行与质量状态</h3><div className="form-grid two"><label><span>业务状态</span><select value={form.record_status} onChange={(e) => setForm({ ...form, record_status: e.target.value })}><option>有效</option><option>冻结</option><option>历史</option></select></label><label><span>同步状态</span><select value={form.sync_status} onChange={(e) => setForm({ ...form, sync_status: e.target.value })}>{Object.entries(syncLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>数据质量</span><select value={form.quality_status} onChange={(e) => setForm({ ...form, quality_status: e.target.value })}>{Object.entries(qualityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div></section><section className="form-section"><h3>数据来源与同步</h3><div className="form-grid two"><label><span>来源系统</span><input value={form.source_system} onChange={(e) => setForm({ ...form, source_system: e.target.value })} /></label><label><span>源系统主键</span><input className="mono" value={form.source_pk} onChange={(e) => setForm({ ...form, source_pk: e.target.value })} /></label></div><label><span>同步错误</span><input value={form.sync_error} onChange={(e) => setForm({ ...form, sync_error: e.target.value })} placeholder="正常时留空" /></label></section><div className="form-section"><h3>{currentType?.display_name || '对象'}属性</h3><div className="form-grid two">{(currentType?.properties || []).map((item) => <label key={item.key}><span>{item.name}{item.is_required && <em className="required-star"> *</em>}</span>{item.type === 'enum' ? <select required={item.is_required} value={form.properties[item.key] ?? ''} onChange={(e) => updateProperty(item.key, e.target.value)}><option value="">请选择</option>{(item.options || []).map((value) => <option key={value}>{value}</option>)}</select> : item.type === 'boolean' ? <select value={String(form.properties[item.key] ?? '')} onChange={(e) => updateProperty(item.key, e.target.value)}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select> : <input required={item.is_required} type={['decimal', 'integer'].includes(item.type) ? 'number' : 'text'} step={item.type === 'decimal' ? 'any' : undefined} value={form.properties[item.key] ?? ''} onChange={(e) => updateProperty(item.key, e.target.value)} />}</label>)}</div></div></form></Modal>}
  </div>;
}
