import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Boxes, Building2, CheckCircle2, ChevronRight, CircleAlert, Clock3, Copy, GitBranch, Hammer,
  Layers3, ListChecks, Pencil, Plus, Search, Trash2, X,
} from 'lucide-react';
import { api, formatTime } from '../api';
import { actorLabel, localizeModelText, statusLabel } from '../labels';
import Modal from '../components/Modal';
import { ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import { useModelingEntry } from '../components/ModelingEntry';
import ActivityLog from './ActivityLog';

const typeMeta = {
  object_type: { label: '对象类型', icon: Boxes, route: '/ontology/model/object-types' },
  link_type: { label: '关系类型', icon: GitBranch, route: '/ontology/model/link-types' },
  action: { label: '动作类型', icon: Hammer, route: '/ontology/model/actions' },
  business_rule: { label: '业务规则', icon: ListChecks, route: '/ontology/model/business-rules' },
  interface: { label: '接口', icon: Layers3, route: '/ontology/model/interfaces' },
};
const statusMeta = { promoted: '核心推荐', active: '已启用', experimental: '试验中', deprecated: '已弃用' };
const tabs = [['all', '全部资源'], ['object_type', '业务对象'], ['interface', '接口'], ['link_type', '关系类型'], ['business_rule', '业务规则'], ['action', '动作类型']];
const actionRuleLabels = { invoke: '业务动作', create: '新建对象', modify: '修改对象', create_or_modify: '新建或修改对象', delete: '删除对象' };
const detailLabel = (item) => {
  if (item.resource_type === 'action') {
    const [target, rule] = String(item.detail || '').split(' · ');
    return `${target || '未设置目标'} · ${actionRuleLabels[rule] || rule || '未设置规则'}`;
  }
  if (item.resource_type === 'business_rule') {
    const [target, severity] = String(item.detail || '').split(' · ');
    return `${target || '未设置目标'} · ${{ blocking: '阻断', warning: '警告', info: '提示' }[severity] || severity || '未设置等级'}`;
  }
  if (['object_type', 'interface'].includes(item.resource_type)) return String(item.detail || '').replace(/(\d+) properties?/, '$1 项属性');
  return item.detail || '—';
};

export default function Overview({ activeId, active, refreshOntologies, notify }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceView = searchParams.get('tab') === 'changes' ? 'changes' : 'resources';
  const { requestResource, requestUpdate } = useModelingEntry();
  const [data, setData] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyForm, setCopyForm] = useState({ name: '', namespace: '' });
  const [copyBusy, setCopyBusy] = useState(false);
  const [form, setForm] = useState({ name: '', namespace: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [showResourceGuide, setShowResourceGuide] = useState(false);
  const searchRef = useRef(null);

  const load = () => {
    setError(''); setData(null);
    Promise.all([api(`/api/ontologies/${activeId}/overview`), api(`/api/ontologies/${activeId}/catalog`)]).then(([overview, resources]) => { setData(overview); setCatalog(resources); setSelected(resources[0] || null); }).catch((e) => setError(e.message));
  };
  useEffect(load, [activeId]);
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const filtered = useMemo(() => catalog.filter((item) => (tab === 'all' || item.resource_type === tab) && (status === 'all' || item.status === status) && `${item.display_name} ${item.name} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase())), [catalog, tab, status, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [tab, status, query, pageSize]);
  useEffect(() => {
    if (!activeId || !data || data.stats.object_types > 0) {
      setShowResourceGuide(false);
      return;
    }
    try {
      setShowResourceGuide(localStorage.getItem(`ontology-resource-guide-dismissed:${activeId}`) !== '1');
    } catch {
      // 浏览器存储不可用时仍显示一次引导，不阻塞用户进入建模。
      setShowResourceGuide(true);
    }
  }, [activeId, data?.stats.object_types]);

  const openEdit = () => { setForm({ name: active.name, namespace: active.namespace, description: active.description || '' }); setEditOpen(true); };
  const save = async (event) => { event.preventDefault(); setBusy(true); try { await api(`/api/ontologies/${activeId}`, { method: 'PUT', body: JSON.stringify(form) }); await refreshOntologies(activeId); setEditOpen(false); load(); } catch (e) { notify(e.message); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm(`确定删除“${active.name}”及其全部资源吗？`)) return; try { await api(`/api/ontologies/${activeId}`, { method: 'DELETE' }); await refreshOntologies(); } catch (e) { notify(e.message); } };
  // 整体复制本体作为新分支：产品已去掉版本概念，迭代靠复制本体 + 本体对比。
  const openCopy = () => { setCopyForm({ name: `${active.name}_copy`, namespace: `${active.namespace}.copy` }); setCopyOpen(true); };
  const submitCopy = async (event) => {
    event.preventDefault(); setCopyBusy(true);
    try {
      const created = await api(`/api/ontologies/${activeId}/copy`, { method: 'POST', body: JSON.stringify(copyForm) });
      await refreshOntologies(created.id);
      setCopyOpen(false);
      notify(`已复制为「${created.name}」：对象 ${created.copied?.object_types ?? 0} 个、关系 ${created.copied?.link_types ?? 0} 个、实例 ${created.copied?.instances ?? 0} 条。发布版本、变更流水、质检报告与数据源密码不随分支复制。`);
      navigate(`/ontology/overview/${created.id}`);
    } catch (e) { notify(e.message); } finally { setCopyBusy(false); }
  };
  const dismissResourceGuide = () => {
    setShowResourceGuide(false);
    try { localStorage.setItem(`ontology-resource-guide-dismissed:${activeId}`, '1'); } catch { /* 引导关闭不应影响建模 */ }
  };
  const openResourceEntry = () => {
    dismissResourceGuide();
    requestResource({ ontology: active, objectCount: data?.stats.object_types || 0 });
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Loading />;
  return <div className="oma-home">
    <section className="oma-commandbar">
      <button className="bc-button" onClick={() => requestUpdate({ ontology: active, objectCount: data.stats.object_types })}>更新本体</button>
      <div className="oma-search"><Search size={16} /><input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索对象、关系、规则、动作或接口" /><kbd>⌘ K</kbd></div>
      <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">全部状态</option>{Object.entries(statusMeta).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <div className="oma-resource-cta"><button className="oma-button" onClick={openResourceEntry}><Plus size={15} /> 新建资源</button>{showResourceGuide && <div className="oma-resource-guide" role="status"><button type="button" className="oma-resource-guide-close" aria-label="关闭新建资源指引" onClick={dismissResourceGuide}><X size={14} /></button><strong>从这里开始</strong><p>本体还是空的，先点击“新建资源”，创建业务域、对象类型或其他本体资源。</p><span className="oma-resource-guide-arrow" aria-hidden="true" /></div>}</div>
    </section>

    <section className="oma-overview-strip">
      <div><span>当前本体</span><strong>{active.name}</strong><code>{active.namespace}</code></div>
      <dl><div><dt>对象类型</dt><dd>{data.stats.object_types}</dd></div><div><dt>接口</dt><dd>{data.stats.interfaces}</dd></div><div><dt>关系类型</dt><dd>{data.stats.link_types}</dd></div><div><dt>规则 / 动作</dt><dd>{data.stats.business_rules + data.stats.actions}</dd></div><div><dt>业务域 / 主题域</dt><dd>{data.stats.business_domains} / {data.stats.subject_domains}</dd></div><div><dt>数据映射</dt><dd>{data.enterprise?.data_mappings?.count || 0}</dd></div><div><dt>实例数据</dt><dd>{data.stats.instances}</dd></div></dl>
      <button className="oma-review-button" onClick={() => setSearchParams({ tab: 'changes' })}><span>{data.pending_changes}</span><div><strong>待发布变更</strong><small>{data.pending_changes ? '查看当前工作状态的变更记录' : '工作状态没有待发布变更'}</small></div><ChevronRight size={16} /></button>
    </section>

    <nav className="oma-workspace-views" aria-label="本体工作台视图"><button type="button" className={workspaceView === 'resources' ? 'active' : ''} onClick={() => setSearchParams({})}>资源目录</button><button type="button" className={workspaceView === 'changes' ? 'active' : ''} onClick={() => setSearchParams({ tab: 'changes' })}>变更记录 <em>{data.pending_changes}</em></button></nav>
    {workspaceView === 'changes' ? <ActivityLog activeId={activeId} active={active} embedded /> : <div className="oma-layout">
      <section className="oma-catalog">
        <header><div><strong>本体资源目录</strong><span>显示 {filtered.length} / 共 {catalog.length} 项</span></div><div className="oma-catalog-actions"><button type="button" onClick={openCopy}><Copy size={14} /> 复制为分支</button><button onClick={openEdit}><Pencil size={14} /> 编辑本体信息</button></div></header>
        <nav className="oma-tabs">{tabs.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}<span>{key === 'all' ? catalog.length : catalog.filter((item) => item.resource_type === key).length}</span></button>)}</nav>
        <div className="oma-table">
          <div className="oma-table-head"><span>名称</span><span>资源类型</span><span>稳定标识</span><span>状态</span><span>分类 / 详情</span><span>最后编辑</span></div>
          {pageRows.map((item) => { const meta = typeMeta[item.resource_type] || typeMeta.object_type; return <button className={`oma-resource-row ${selected?.id === item.id ? 'selected' : ''}`} key={`${item.resource_type}-${item.id}`} onClick={() => setSelected(item)} onDoubleClick={() => navigate(meta.route)}><span className="oma-resource-name"><i><meta.icon size={16} /></i><b>{item.display_name}</b></span><span>{meta.label}</span><code>{item.name}</code><span><em className={`oma-status ${item.status}`}>{statusLabel(item.status)}</em></span><span className="oma-detail">{item.groups?.length ? item.groups.join(', ') : detailLabel(item)}</span><span>{formatTime(item.updated_at)}</span></button>; })}
          {!filtered.length && <div className="oma-no-results">没有符合当前筛选条件的资源。</div>}
        </div>
        <PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </section>

      <aside className="oma-inspector">
        {selected ? <><header><span>资源详情</span><button onClick={() => navigate(typeMeta[selected.resource_type]?.route || '/ontology/overview')}>打开 <ChevronRight size={14} /></button></header><div className="oma-inspector-title">{(() => { const Icon=typeMeta[selected.resource_type]?.icon || Boxes; return <i><Icon size={20} /></i>; })()}<div><h3>{selected.display_name}</h3><code>{selected.name}</code></div></div><p>{selected.description || '尚未填写该资源的说明。'}</p><dl><div><dt>资源类型</dt><dd>{typeMeta[selected.resource_type]?.label}</dd></div><div><dt>状态</dt><dd><em className={`oma-status ${selected.status}`}>{statusLabel(selected.status)}</em></dd></div><div><dt>详情</dt><dd>{detailLabel(selected)}</dd></div><div><dt>最后编辑</dt><dd>{formatTime(selected.updated_at)}</dd></div></dl></> : <div />}
        <section className="oma-quality"><header><strong>本体校验</strong><button onClick={() => navigate('/ontology/governance')}>查看全部</button></header><div className={data.quality.valid ? 'pass' : 'fail'}>{data.quality.valid ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}<span><b>{data.quality.valid ? '没有阻断错误' : `${data.quality.errors} 项阻断错误`}</b><small>{data.quality.warnings} 项警告 · 已通过 {data.quality.checks_passed}/{data.quality.checks_total} 项检查</small></span></div></section>
        <section className="oma-changes"><header><strong>最近活动</strong><button type="button" onClick={() => setSearchParams({ tab: 'changes' })}>查看全部 <ChevronRight size={13} /></button></header>{data.recent_changes.map((item) => <div key={item.id}><i className={item.pending ? 'pending' : ''} /><span><b>{localizeModelText(item.summary)}</b><small>{formatTime(item.created_at)} · {actorLabel(item.actor)}</small></span></div>)}{!data.recent_changes.length && <p className="oma-changes-empty"><Clock3 size={15} /> 暂无建模操作</p>}</section>
        <button className="oma-delete" onClick={remove}><Trash2 size={14} /> 删除本体</button>
      </aside>
    </div>}

    {copyOpen && <Modal title="复制为分支" subtitle={`以「${active.name}」为模板创建一份完整副本`} onClose={() => !copyBusy && setCopyOpen(false)} footer={<><button className="btn secondary" disabled={copyBusy} onClick={() => setCopyOpen(false)}>取消</button><button form="copy-ontology" disabled={copyBusy} className="btn primary">{copyBusy ? '复制中…' : '开始复制'}</button></>}><form id="copy-ontology" className="form-sections" onSubmit={submitCopy}><section className="form-section"><h3>新本体标识</h3><p className="form-hint">复制出来的分支直接用本体名称区分，例如“资产本体_copy”“资产本体v2”；不再使用版本号。</p><label><span>本体名称</span><input required value={copyForm.name} onChange={(e) => setCopyForm({ ...copyForm, name: e.target.value })} /></label><label><span>命名空间</span><input required className="mono" value={copyForm.namespace} onChange={(e) => setCopyForm({ ...copyForm, namespace: e.target.value })} /><small>与已有本体重复时会自动补随机后缀。</small></label></section><section className="form-section"><h3>复制范围</h3><p className="form-hint">会复制：业务域与主题域、接口、对象类型与属性、关系类型、动作类型、规则、数据源与治理资产、语义映射、系统能力与执行映射、权限策略、业务场景、实例数据，以及每个资源上的模板证据。</p><p className="form-hint">不会复制：发布版本、变更记录、质检报告、智能构建提案与会话、场景运行记录、智能体交互，以及数据源连接密码（需在分支里重新配置）。</p></section></form></Modal>}
    {editOpen && <Modal title="编辑本体信息" subtitle="更新本体标识、命名空间与业务边界" onClose={() => setEditOpen(false)} footer={<><button className="btn secondary" onClick={() => setEditOpen(false)}>取消</button><button form="edit-ontology" disabled={busy} className="btn primary">保存信息</button></>}><form id="edit-ontology" className="form-sections" onSubmit={save}><section className="form-section"><h3>基础标识</h3><label><span>本体名称</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label><span>命名空间</span><input required className="mono" value={form.namespace} onChange={(e) => setForm({ ...form, namespace: e.target.value })} /><small>修改命名空间前请确认外部引用是否依赖当前标识。</small></label></section><section className="form-section"><h3>业务范围</h3><label><span>业务说明</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label></section></form></Modal>}
  </div>;
}
