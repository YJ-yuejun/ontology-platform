import { useEffect, useMemo, useState } from 'react';
import {
  Boxes, CheckCircle2, ChevronRight, Layers3, Pencil, Plus, Search, ShieldCheck, Trash2, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, formatTime } from '../api';
import { dataTypeLabel, statusLabel, STATUS_OPTIONS } from '../labels';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import { ObjectTypeIcon } from '../components/ObjectTypeIcon';
import PropertyEditor from '../components/PropertyEditor';
import useDetailPanel from '../hooks/useDetailPanel';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import useCreateIntent from '../hooks/useCreateIntent';
import { useModelingEntry } from '../components/ModelingEntry';

const emptyForm = () => ({
  name: '', display_name: '', description: '', status: 'experimental', properties: [],
});

export default function Interfaces({ activeId, refreshOntologies, notify }) {
  const { requestResource } = useModelingEntry();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [objects, setObjects] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState(null);
  const { detailOpen, openDetail, closeDetail } = useDetailPanel();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

  const load = async (preferredId) => {
    setError('');
    try {
      const [interfaces, objectTypes] = await Promise.all([
        api(`/api/ontologies/${activeId}/interfaces`),
        api(`/api/ontologies/${activeId}/object-types`),
      ]);
      setItems(interfaces);
      setObjects(objectTypes);
      const next = interfaces.find((item) => item.id === preferredId) || null;
      setSelected(next);
      if (next) openDetail();
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { setItems(null); load(); }, [activeId]);

  const filtered = useMemo(() => (items || []).filter((item) => (
    (status === 'all' || item.status === status)
    && `${item.display_name} ${item.name} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase())
  )), [items, query, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, status, pageSize]);
  useEffect(() => { if (items && selected && !filtered.some((item) => item.id === selected?.id)) setSelected(null); }, [items, filtered, selected?.id]);
  useHistoryResourceFocus({ resourceTypes: ['interface'], items, visible: filtered, pageSize, setPage, onSelect: (item) => { setSelected(item); openDetail(); }, ready: Boolean(items) });

  const implementedBy = (interfaceId) => objects.filter((item) => (item.interface_ids || []).includes(interfaceId));
  const openManualCreate = () => { setForm(emptyForm()); setCreating(true); setEditing(null); };
  const openCreate = () => requestResource({ type: 'interface', onManual: openManualCreate });
  const openEdit = (item) => {
    setForm({
      name: item.name,
      display_name: item.display_name,
      description: item.description || '',
      status: item.status,
      properties: item.properties || [],
    });
    setEditing(item);
    setCreating(false);
  };
  const close = () => { setEditing(null); setCreating(false); };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await api(
        editing ? `/api/interfaces/${editing.id}` : `/api/ontologies/${activeId}/interfaces`,
        { method: editing ? 'PUT' : 'POST', body: JSON.stringify(form) },
      );
      close();
      await load(saved.id);
      openDetail();
      refreshOntologies(activeId);
    } catch (saveError) {
      notify(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`确定删除接口“${item.display_name}”吗？已经实现该接口的对象类型将需要重新检查。`)) return;
    try {
      await api(`/api/interfaces/${item.id}`, { method: 'DELETE' });
      await load();
      refreshOntologies(activeId);
    } catch (removeError) {
      notify(removeError.message);
    }
  };
  useCreateIntent(Boolean(items), openManualCreate);

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!items) return <Loading />;

  const selectedImplementations = selected ? implementedBy(selected.id) : [];

  return <div className="oma-resource-page oma-interface-page">
    <section className="oma-resource-toolbar">
      <div className="oma-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索接口名称、稳定标识或说明" /></div>
      <select value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="all">全部状态</option>
        {STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <span>显示 {filtered.length} / 共 {items.length} 个</span>
      <button className="oma-button" onClick={openCreate}><Plus size={15} /> 新建接口</button>
    </section>

    <section className="oma-interface-guide">
      <Layers3 size={19} />
      <div><strong>接口是对象类型的统一结构契约</strong><span>它用于声明对象必须实现的属性；不是 REST API。外部系统调用在“系统能力与执行映射”管理。</span></div>
      <button onClick={() => navigate('/ontology/model/object-types')}>管理对象类型 <ChevronRight size={14} /></button>
    </section>

    <div className={`oma-resource-layout oma-interface-layout ${detailOpen ? 'detail-open' : 'detail-collapsed'}`}>
      <section className="oma-resource-list">
        <header><strong>接口目录</strong><span>用于复用跨对象类型的字段规范与业务能力</span></header>
        {!filtered.length ? <EmptyState
          title={query || status !== 'all' ? '没有符合条件的接口' : '还没有接口'}
          description={query || status !== 'all' ? '请调整搜索词或状态筛选。' : '创建接口，为多个对象类型声明一致的必需属性。'}
          action={!query && status === 'all' && <button className="oma-button" onClick={openCreate}><Plus size={15} /> 新建接口</button>}
        /> : <div className="oma-interface-table">
          <div className="oma-interface-head"><span>接口名称</span><span>稳定标识</span><span>必需属性</span><span>实现对象</span><span>状态</span><span>最后编辑</span></div>
          {pageRows.map((item) => <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => { setSelected(item); openDetail(); }}>
            <span className="oma-resource-name"><i><Layers3 size={16} /></i><b>{item.display_name}</b></span>
            <code>{item.name}</code>
            <span>{item.properties?.length || 0} 项</span>
            <span>{implementedBy(item.id).length} 个</span>
            <span><em className={`oma-status ${item.status}`}>{statusLabel(item.status)}</em></span>
            <span>{formatTime(item.updated_at)}</span>
          </button>)}
        </div>}<PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </section>

      <aside className="oma-resource-inspector oma-interface-inspector">
        {selected ? <>
          <header><span>接口定义</span><div><ResourceHistoryLink resourceType="interface" resourceId={selected.id} /><button onClick={() => openEdit(selected)}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={() => remove(selected)} title="删除接口"><Trash2 size={14} /></button></div><button className="detail-close-btn" title="收起详情" aria-label="收起详情" onClick={closeDetail}><X size={14} /></button></header>
          <div className="oma-inspector-title"><i><Layers3 size={20} /></i><div><h3>{selected.display_name}</h3><code>{selected.name}</code></div></div>
          <p>{selected.description || '尚未填写接口说明。'}</p>
          <dl>
            <div><dt>状态</dt><dd><em className={`oma-status ${selected.status}`}>{statusLabel(selected.status)}</em></dd></div>
            <div><dt>必需属性</dt><dd>{selected.properties.length} 项</dd></div>
            <div><dt>实现对象</dt><dd>{selectedImplementations.length} 个</dd></div>
            <div><dt>最后编辑</dt><dd>{formatTime(selected.updated_at)}</dd></div>
          </dl>

          <div className="oma-interface-props">
            <strong>属性契约</strong>
            {selected.properties.length ? selected.properties.map((property) => <div key={property.key}>
              <span>{property.name}<em>{property.is_required ? '必填' : '可选'}</em></span>
              <code>{property.key} · {dataTypeLabel(property.type)}</code>
            </div>) : <div className="oma-interface-empty">当前接口没有定义属性</div>}
          </div>

          <div className="oma-interface-implementations">
            <strong>实现此接口的对象类型</strong>
            {selectedImplementations.length ? selectedImplementations.map((item) => <button key={item.id} onClick={() => navigate('/ontology/model/object-types')}>
              <i><ObjectTypeIcon value={item.icon} size={15} /></i><span><b>{item.display_name}</b><code>{item.name}</code></span><CheckCircle2 size={15} />
            </button>) : <div className="oma-interface-empty"><ShieldCheck size={16} /> 暂无对象类型实现此接口</div>}
          </div>
        </> : <EmptyState title="请选择一个接口" description="从左侧目录查看接口定义与实现情况。" />}
      </aside>
    </div>

    {(creating || editing) && <Modal
      wide
      title={editing ? '编辑接口' : '新建接口'}
      subtitle="定义可被多个对象类型实现的统一属性契约"
      onClose={close}
      footer={<><button className="btn secondary" onClick={close}>取消</button><button className="btn primary" form="interface-form" disabled={busy}>{busy ? '保存中…' : '保存到工作状态'}</button></>}
    >
      <form id="interface-form" className="form-sections" onSubmit={save}>
        <div className="form-section">
          <h3>基本信息</h3>
          <div className="form-grid two">
            <label><span>显示名称</span><input required value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} placeholder="例如：工作项" /></label>
            <label><span>稳定标识</span><input required className="mono" disabled={editing && ['active', 'promoted'].includes(editing.status)} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="WorkItem" /><small>供对象实现与程序引用，发布后不可直接修改。</small></label>
            <label><span>生命周期状态</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          </div>
          <label><span>业务说明</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="说明哪些对象应该实现这个接口，以及接口表达的业务含义" /></label>
        </div>
        <PropertyEditor primaryKey={false} label="必需属性契约" value={form.properties} onChange={(properties) => setForm({ ...form, properties })} />
        <div className="oma-contract-note"><ShieldCheck size={17} /><span><strong>发布校验规则</strong>对象类型实现接口后，必须拥有相同稳定标识、相同数据类型的全部接口属性；新增接口属性会影响所有实现对象。</span></div>
      </form>
    </Modal>}
  </div>;
}
