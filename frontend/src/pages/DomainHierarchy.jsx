import { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronRight, Layers3, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, formatTime } from '../api';
import { usageStatusLabel, USAGE_STATUS_OPTIONS } from '../labels';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import { historyReturnUrl } from '../historyNavigation';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import { ObjectTypeIcon } from '../components/ObjectTypeIcon';
import PaginationBar from '../components/PaginationBar';
import useCreateIntent from '../hooks/useCreateIntent';

const emptyDomain = { code: '', name: '', description: '', owner: '', status: 'active' };
const emptySubject = { business_domain_id: '', code: '', name: '', description: '', owner: '', status: 'active' };

export default function DomainHierarchy({ activeId, refreshOntologies, notify }) {
  const navigate = useNavigate();
  const location = useLocation();
  const historyParams = new URLSearchParams(location.search);
  const historyType = historyParams.get('from_history') === '1' ? historyParams.get('resource_type') : '';
  const historyId = historyType === 'business_domain' || historyType === 'subject_domain' || historyType === '业务域' || historyType === '主题域'
    ? historyParams.get('resource_id') : '';
  const [domains, setDomains] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [objects, setObjects] = useState([]);
  const [links, setLinks] = useState([]);
  const [rules, setRules] = useState([]);
  const [actions, setActions] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [query, setQuery] = useState('');
  const [domainPage, setDomainPage] = useState(1);
  const [subjectPage, setSubjectPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(emptyDomain);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async (preferredDomainId, preferredSubjectId) => {
    setError('');
    try {
      const [domainRows, subjectRows, objectRows, linkRows, logicRows, businessRuleRows, actionRows, scenarioRows] = await Promise.all([
        api(`/api/ontologies/${activeId}/business-domains`),
        api(`/api/ontologies/${activeId}/subject-domains`),
        api(`/api/ontologies/${activeId}/object-types`),
        api(`/api/ontologies/${activeId}/link-types`),
        api(`/api/ontologies/${activeId}/enterprise/logic-definitions`),
        api(`/api/ontologies/${activeId}/business-rules`),
        api(`/api/ontologies/${activeId}/actions`),
        api(`/api/ontologies/${activeId}/enterprise/business-scenarios`),
      ]);
      setDomains(domainRows); setSubjects(subjectRows); setObjects(objectRows); setLinks(linkRows);
      setRules(logicRows.length ? logicRows : businessRuleRows); setActions(actionRows); setScenarios(scenarioRows);
      const focusedSubject = preferredSubjectId && subjectRows.find((item) => item.id === preferredSubjectId);
      if ((preferredDomainId && !domainRows.some((item) => item.id === preferredDomainId)) || (preferredSubjectId && !focusedSubject)) {
        navigate(`${historyReturnUrl(location.search)}&not_found=1`, { replace: true });
        return;
      }
      const domainId = preferredDomainId || focusedSubject?.business_domain_id || (domainRows.some((item) => item.id === selectedDomainId) ? selectedDomainId : domainRows[0]?.id || '');
      setSelectedDomainId(domainId);
      const domainSubjects = subjectRows.filter((item) => item.business_domain_id === domainId);
      setSelectedSubjectId(preferredSubjectId && domainSubjects.some((item) => item.id === preferredSubjectId)
        ? preferredSubjectId : domainSubjects.some((item) => item.id === selectedSubjectId) ? selectedSubjectId : domainSubjects[0]?.id || '');
    } catch (cause) { setError(cause.message); }
  };
  useEffect(() => { setDomains(null); setSelectedDomainId(''); setSelectedSubjectId(''); load(historyType === 'business_domain' || historyType === '业务域' ? historyId : undefined, historyType === 'subject_domain' || historyType === '主题域' ? historyId : undefined); }, [activeId, historyType, historyId]);

  const selectedDomain = domains?.find((item) => item.id === selectedDomainId) || null;
  const visibleDomains = useMemo(() => (domains || []).filter((item) => `${item.code} ${item.name} ${item.owner || ''}`.toLowerCase().includes(query.toLowerCase())), [domains, query]);
  const selectedSubjects = useMemo(() => subjects.filter((item) => item.business_domain_id === selectedDomainId), [subjects, selectedDomainId]);
  const domainPages = Math.max(1, Math.ceil(visibleDomains.length / pageSize));
  const currentDomainPage = Math.min(domainPage, domainPages);
  const domainRows = visibleDomains.slice((currentDomainPage - 1) * pageSize, currentDomainPage * pageSize);
  const subjectPages = Math.max(1, Math.ceil(selectedSubjects.length / pageSize));
  const currentSubjectPage = Math.min(subjectPage, subjectPages);
  const subjectRows = selectedSubjects.slice((currentSubjectPage - 1) * pageSize, currentSubjectPage * pageSize);
  useEffect(() => { setDomainPage(1); setSubjectPage(1); }, [query, selectedDomainId, pageSize]);
  useEffect(() => {
    if (!historyId || !domains) return;
    const domainIndex = visibleDomains.findIndex((item) => item.id === selectedDomainId);
    const subjectIndex = selectedSubjects.findIndex((item) => item.id === selectedSubjectId);
    if (domainIndex >= 0) setDomainPage(Math.floor(domainIndex / pageSize) + 1);
    if (subjectIndex >= 0) setSubjectPage(Math.floor(subjectIndex / pageSize) + 1);
  }, [historyId, domains, visibleDomains, selectedDomainId, selectedSubjects, selectedSubjectId, pageSize]);
  const selectedSubject = selectedSubjects.find((item) => item.id === selectedSubjectId) || null;
  const subjectObjects = useMemo(() => objects.filter((item) => item.subject_domain_id === selectedSubjectId), [objects, selectedSubjectId]);
  const subjectObjectIds = useMemo(() => new Set(subjectObjects.map((item) => item.id)), [subjectObjects]);
  const subjectObjectNames = useMemo(() => new Set(subjectObjects.map((item) => item.name)), [subjectObjects]);
  const subjectLinks = useMemo(() => links.filter((item) => subjectObjectIds.has(item.source_object_type_id) || subjectObjectIds.has(item.target_object_type_id)), [links, subjectObjectIds]);
  const subjectImpact = useMemo(() => ({
    objects: subjectObjects.length,
    links: subjectLinks.length,
    crossLinks: subjectLinks.filter((item) => !(subjectObjectIds.has(item.source_object_type_id) && subjectObjectIds.has(item.target_object_type_id))).length,
    rules: rules.filter((item) => subjectObjectIds.has(item.target_object_type_id)
      || [...(item.applicable_objects || []), ...(item.input_objects || []), item.target_object_type].some((name) => subjectObjectNames.has(name))).length,
    actions: actions.filter((item) => subjectObjectIds.has(item.target_object_type_id)).length,
    scenarios: scenarios.filter((item) => (item.related_objects || []).some((name) => subjectObjectNames.has(name))).length,
  }), [subjectObjects, subjectLinks, subjectObjectIds, subjectObjectNames, rules, actions, scenarios]);

  const selectDomain = (domainId) => {
    setSelectedDomainId(domainId);
    setSelectedSubjectId(subjects.find((item) => item.business_domain_id === domainId)?.id || '');
  };
  const beginDomain = (item = null) => {
    setEditor({ kind: 'domain', item });
    setForm(item ? { code: item.code, name: item.name, description: item.description || '', owner: item.owner || '', status: item.status } : { ...emptyDomain });
  };
  const beginSubject = (item = null) => {
    setEditor({ kind: 'subject', item });
    setForm(item ? { business_domain_id: item.business_domain_id, code: item.code, name: item.name, description: item.description || '', owner: item.owner || '', status: item.status } : { ...emptySubject, business_domain_id: selectedDomainId });
  };
  useCreateIntent(Boolean(domains), () => {
    const subjectRequested = new URLSearchParams(location.search).get('kind') === 'subject';
    if (subjectRequested && selectedDomainId) beginSubject(); else beginDomain();
  });
  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    const isDomain = editor.kind === 'domain';
    const path = editor.item
      ? `/api/${isDomain ? 'business-domains' : 'subject-domains'}/${editor.item.id}`
      : `/api/ontologies/${activeId}/${isDomain ? 'business-domains' : 'subject-domains'}`;
    try {
      const saved = await api(path, { method: editor.item ? 'PUT' : 'POST', body: JSON.stringify(form) });
      setEditor(null); await load(isDomain ? saved.id : saved.business_domain_id, isDomain ? undefined : saved.id); refreshOntologies(activeId);
      notify(`${isDomain ? '业务域' : '主题域'}已保存到工作状态`);
    } catch (cause) { notify(cause.message); } finally { setBusy(false); }
  };
  const remove = async (kind, item) => {
    const domainSubjects = kind === 'domain' ? subjects.filter((subject) => subject.business_domain_id === item.id) : [];
    const affectedObjects = kind === 'domain' ? domainSubjects.reduce((sum, subject) => sum + (subject.object_count || 0), 0) : item.object_count || 0;
    const effect = kind === 'domain'
      ? `将同时删除其下 ${domainSubjects.length} 个主题域分类，并让 ${affectedObjects} 个对象类型变为“未分类”`
      : `将让 ${affectedObjects} 个对象类型变为“未分类”`;
    if (!window.confirm(`确定删除${kind === 'domain' ? '业务域' : '主题域'}“${item.name}”吗？\n\n${effect}。对象类型及其属性、关系、规则和行动不会被删除，之后仍可重新绑定其他主题域。历史版本和变更日志仍然保留。`)) return;
    try {
      await api(`/api/${kind === 'domain' ? 'business-domains' : 'subject-domains'}/${item.id}`, { method: 'DELETE' });
      await load(kind === 'domain' ? undefined : selectedDomainId); refreshOntologies(activeId);
    } catch (cause) { notify(cause.message); }
  };

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!domains) return <Loading />;
  return <div className="domain-page domain-page-v2">
    <div className="domain-layout domain-layout-v2">
      <section className="domain-list">
        <header><div><strong>业务域</strong><span>{domains.length} 个治理边界</span></div><button className="domain-add-button" onClick={() => beginDomain()} title="新建业务域"><Plus size={15} /> 新建</button></header>
        <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、编码或负责人" /></label>
        {domainRows.map((item) => <div key={item.id} className={`domain-row ${selectedDomainId === item.id ? 'selected' : ''}`}><button className="domain-row-main" onClick={() => selectDomain(item.id)}><i><Building2 size={16} /></i><span><b>{item.name}</b><code>{item.code}</code><small>{item.owner || '未设置负责人'} · {item.subject_count} 个主题域</small></span><em className={`oma-status ${item.status}`}>{usageStatusLabel(item.status)}</em></button><div className="domain-row-actions"><ResourceHistoryLink resourceType="business_domain" resourceId={item.id} label="" /><button title={`编辑${item.name}`} onClick={() => beginDomain(item)}><Pencil size={14} /></button><button title={`删除${item.name}并移除分类关联`} className="danger-link" onClick={() => remove('domain', item)}><Trash2 size={14} /></button></div></div>)}
        {!visibleDomains.length && <EmptyState title="还没有业务域" description="新建业务域后，再在其中定义主题域。" />}<PaginationBar page={currentDomainPage} pageSize={pageSize} total={visibleDomains.length} onPageChange={setDomainPage} onPageSizeChange={(size) => { setPageSize(size); setDomainPage(1); setSubjectPage(1); }} />
      </section>

      <section className="subject-list-panel">
        <header><div><strong>{selectedDomain?.name || '主题域'}</strong><span>{selectedDomain ? `${selectedSubjects.length} 个主题域` : '请先选择业务域'}</span></div>{selectedDomain && <div><button className="oma-button" onClick={() => beginSubject()}><Plus size={14} /> 新建主题域</button></div>}</header>
        {selectedSubjects.length ? <><div className="subject-table"><div className="subject-table-head"><span>主题域</span><span>对象类型</span><span>负责人</span><span>状态</span></div>{subjectRows.map((item) => <button key={item.id} className={selectedSubjectId === item.id ? 'selected' : ''} onClick={() => setSelectedSubjectId(item.id)}><span className="subject-name-cell"><i><Layers3 size={15} /></i><span><b>{item.name}</b><code>{item.code}</code></span></span><span>{item.object_count} 个</span><span>{item.owner || '未设置'}</span><span><em className={`oma-status ${item.status}`}>{usageStatusLabel(item.status)}</em></span></button>)}</div><PaginationBar page={currentSubjectPage} pageSize={pageSize} total={selectedSubjects.length} onPageChange={setSubjectPage} onPageSizeChange={(size) => { setPageSize(size); setDomainPage(1); setSubjectPage(1); }} /></> : selectedDomain ? <EmptyState title="该业务域还没有主题域" description="主题域用于直接组织对象类型。" action={<button className="oma-button" onClick={() => beginSubject()}><Plus size={15} /> 新建主题域</button>} /> : <EmptyState title="请选择业务域" description="从左侧选择业务域查看主题域。" />}
      </section>

      <aside className="subject-inspector">
        <header><strong>主题域详情</strong>{selectedSubject && <div><ResourceHistoryLink resourceType="subject_domain" resourceId={selectedSubject.id} /><button onClick={() => beginSubject(selectedSubject)} title={`编辑${selectedSubject.name}`}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={() => remove('subject', selectedSubject)} title={`删除${selectedSubject.name}并移除对象分类`}><Trash2 size={14} /> 删除</button></div>}</header>
        {selectedSubject ? <div className="subject-inspector-body"><div className="subject-title"><i><Layers3 size={18} /></i><div><h3>{selectedSubject.name}</h3><code>{selectedSubject.code}</code></div></div><p>{selectedSubject.description || '尚未填写主题域说明。'}</p>
          <dl><div><dt>所属业务域</dt><dd>{selectedDomain?.name || '—'}</dd></div><div><dt>负责人</dt><dd>{selectedSubject.owner || '未设置'}</dd></div><div><dt>使用状态</dt><dd><em className={`oma-status ${selectedSubject.status}`}>{usageStatusLabel(selectedSubject.status)}</em></dd></div><div><dt>对象类型</dt><dd>{subjectObjects.length} 个</dd></div><div><dt>最近修改</dt><dd>{formatTime(selectedSubject.updated_at)}</dd></div></dl>
          <section className="subject-detail-section"><header><strong>下属对象类型</strong><span>{subjectObjects.length}</span></header>{subjectObjects.length ? <div>{subjectObjects.map((object) => <button key={object.id} onClick={() => navigate('/ontology/model/object-types')}><i><ObjectTypeIcon value={object.icon} size={13} /></i><span><b>{object.display_name}</b><code>{object.name}</code></span><em>{object.properties.length} 项属性</em><ChevronRight size={13} /></button>)}</div> : <p>尚未归类对象。</p>}</section>
          <section className="subject-impact"><header><strong>引用影响</strong><button onClick={() => navigate(`/ontology/graph?domain=${selectedDomainId}&subject=${selectedSubjectId}`)}>在本体图谱中查看 <ChevronRight size={13} /></button></header><div>{[['下属对象', subjectImpact.objects], ['涉及关系', subjectImpact.links], ['跨主题关系', subjectImpact.crossLinks], ['关联规则', subjectImpact.rules], ['关联行动', subjectImpact.actions], ['关联场景', subjectImpact.scenarios]].map(([label, value]) => <span key={label}><b>{value}</b><small>{label}</small></span>)}</div></section>
          {selectedSubject.object_count > 0 && <p className="delete-constraint-note">删除该主题域只会移除分类关联，并让 {selectedSubject.object_count} 个对象类型变为“未分类”；不会删除对象、属性、关系、规则或行动。</p>}
        </div> : <EmptyState title="请选择主题域" description="从中间列表选择主题域查看对象和依赖详情。" />}
      </aside>
    </div>

    {editor && <Modal title={`${editor.item ? '编辑' : '新建'}${editor.kind === 'domain' ? '业务域' : '主题域'}`} subtitle="分类变更进入当前工作状态，并由统一变更日志留痕" onClose={() => setEditor(null)} footer={<><button className="btn secondary" onClick={() => setEditor(null)}>取消</button><button form="domain-form" className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存到工作状态'}</button></>}><form id="domain-form" className="form-sections" onSubmit={save}>
      <section className="form-section"><h3>1. 分类定义</h3>
        {editor.kind === 'subject' && <label><span>所属业务域</span><select required value={form.business_domain_id} onChange={(event) => setForm({ ...form, business_domain_id: event.target.value })}>{domains.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <div className="form-grid two"><label><span>{editor.kind === 'domain' ? '业务域' : '主题域'}名称</span><input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>稳定编码</span><input required disabled={Boolean(editor.item)} className="mono" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder={editor.kind === 'domain' ? 'procurement' : 'procurement.sourcing'} /><small>编码用于稳定引用，创建后不可修改。</small></label></div>
        <label><span>业务说明</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      </section>
      <section className="form-section"><h3>2. 责任与使用状态</h3><div className="form-grid two"><label><span>负责人</span><input value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} /></label><label><span>使用状态</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{USAGE_STATUS_OPTIONS.filter(([key]) => key !== 'experimental' || editor?.item?.status === 'experimental').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>只表示这个分类还能否用于归类，不等同本体的设计、评审或发布状态。</small></label></div>
        {form.status === 'deprecated' && <div className="template-field-note">停用分类不会静默修改下属资源。保存后请到“治理与发布”查看主题域、对象类型和业务场景影响，再提交评审。</div>}
      </section>
    </form></Modal>}
  </div>;
}
