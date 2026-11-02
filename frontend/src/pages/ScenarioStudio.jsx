import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Pencil, Plus, Search, Sparkles, Trash2, Workflow, X } from 'lucide-react';
import { api } from '../api';
import Modal from '../components/Modal';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import useDetailPanel from '../hooks/useDetailPanel';

const emptyForm = () => ({
  code: '', name: '', business_goal: '', trigger_condition: '',
  related_objects: [], related_links: [], related_rules: [], related_actions: [], source_codes: [],
});
const statusLabel = { active: '已发布', draft: '设计中', experimental: '试验中', proposal: '建议中', deprecated: '已废弃' };

function ResourceCell({ codes, items, codeKey = 'name' }) {
  const values = (codes || []).map((code) => {
    const item = items.find((entry) => entry[codeKey] === code);
    return item ? (item.display_name || item.name || code) : code;
  }).filter(Boolean);
  if (!values.length) return <span className="scenario-table-empty">—</span>;
  return <span className="scenario-table-ids" title={values.join('、')}>{values.join('、')}</span>;
}

function ResourceChips({ codes, items, codeKey = 'name' }) {
  const selected = (codes || []).map((code) => items.find((item) => item[codeKey] === code)).filter(Boolean);
  if (!selected.length) return <span className="scenario-detail-empty">—</span>;
  return <div className="scenario-detail-chips">{selected.map((item) => <span key={item.id || item[codeKey]} title={item[codeKey]}>{item.display_name || item.name || item[codeKey]}</span>)}</div>;
}

function ResourcePicker({ label, items, value, onChange, codeKey = 'name', labelKey = 'display_name', detail, multiple = true }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(value || []);
  useEffect(() => { if (open) { setDraft(value || []); setSearch(''); } }, [open, value]);
  const selected = value || [];
  const selectedItems = selected.map((code) => items.find((item) => item[codeKey] === code)).filter(Boolean);
  const needle = search.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const text = `${item[labelKey] || ''} ${item[codeKey] || ''} ${detail ? detail(item) : ''}`.toLowerCase();
    return !needle || text.includes(needle);
  });
  const toggle = (code) => setDraft((current) => multiple ? (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]) : [code]);
  const apply = () => { onChange(draft); setOpen(false); };
  return <>
    <div className="scenario-picker-field">
      <div className="scenario-picker-head"><span>{label}<em>{selected.length}</em></span><button type="button" onClick={() => setOpen(true)}>{selected.length ? '修改选择' : '选择资源'}</button></div>
      {selectedItems.length ? <div className="scenario-picker-chips">{selectedItems.map((item) => <span key={item.id || item[codeKey]} title={item[codeKey]}>{item[labelKey] || item[codeKey]}<button type="button" aria-label={`移除 ${item[labelKey] || item[codeKey]}`} onClick={() => onChange(selected.filter((code) => code !== item[codeKey]))}>×</button></span>)}</div> : <p className="scenario-picker-empty">未选择</p>}
    </div>
    {open && <Modal wide title={`选择${label}`} subtitle={multiple ? '可多选；确认后写入当前场景草稿。' : '单选；确认后写入当前场景草稿。'} onClose={() => setOpen(false)} footer={<><span className="scenario-picker-foot-count">已选 {draft.length} 项</span><button type="button" className="btn secondary" onClick={() => setDraft([])}>清空</button><button type="button" className="btn secondary" onClick={() => setOpen(false)}>取消</button><button type="button" className="btn primary" onClick={apply}>应用选择</button></>}>
      <div className="scenario-picker-modal-body">
        <label className="scenario-picker-search"><Search size={15} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${label}`} /></label>
        <div className="scenario-picker-options">{filtered.map((item) => {
          const code = item[codeKey];
          return <label key={item.id || code} className={draft.includes(code) ? 'selected' : ''}><input type={multiple ? 'checkbox' : 'radio'} checked={draft.includes(code)} onChange={() => toggle(code)} /><span><b>{item[labelKey] || code}</b><code>{code}</code>{detail && detail(item) && <small>{detail(item)}</small>}</span></label>;
        })}{!filtered.length && <div className="scenario-picker-no-result">没有匹配的资源</div>}</div>
      </div>
    </Modal>}
  </>;
}

export default function ScenarioStudio({ activeId, notify }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [objects, setObjects] = useState([]);
  const [links, setLinks] = useState([]);
  const [rules, setRules] = useState([]);
  const [actions, setActions] = useState([]);
  const [sources, setSources] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResult, setAiResult] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const { detailOpen, openDetail, closeDetail } = useDetailPanel();

  const load = async () => {
    setError('');
    try {
      const [scenarioRows, objectRows, linkRows, ruleRows, actionRows, sourceRows, mappingRows] = await Promise.all([
        api(`/api/ontologies/${activeId}/enterprise/business-scenarios`),
        api(`/api/ontologies/${activeId}/object-types`),
        api(`/api/ontologies/${activeId}/link-types`),
        api(`/api/ontologies/${activeId}/business-rules`),
        api(`/api/ontologies/${activeId}/actions`),
        api(`/api/ontologies/${activeId}/enterprise/data-sources`),
        api(`/api/ontologies/${activeId}/enterprise/data-mappings`),
      ]);
      setItems(scenarioRows);
      setObjects(objectRows);
      setLinks(linkRows);
      setRules(ruleRows);
      setActions(actionRows);
      setSources(sourceRows);
      setMappings(mappingRows);
    } catch (cause) {
      setError(cause.message);
    }
  };

  useEffect(() => { setItems(null); load(); }, [activeId]);

  useEffect(() => {
    const draft = location.state?.scenarioDraft;
    if (!draft) return;
    setSelected(null);
    closeDetail();
    setEditing({ create: true, item: null });
    setForm({
      ...emptyForm(), name: draft.name || '', business_goal: draft.business_goal || '', trigger_condition: draft.trigger_condition || '',
      related_objects: draft.objects || [], related_links: draft.links || [], related_rules: draft.rules || [],
      related_actions: draft.actions || [], source_codes: draft.sources || [],
    });
    navigate(location.pathname, { replace: true });
  }, [location.state]);

  const filtered = useMemo(() => (items || []).filter((item) => `${item.code} ${item.name} ${item.business_goal || ''} ${item.trigger_condition || ''}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, pageSize]);

  const openCreate = () => { setEditing({ create: true, item: null }); setForm(emptyForm()); closeDetail(); };
  const openEdit = (item) => {
    setSelected(item);
    openDetail();
    setEditing({ create: false, item });
    setForm({
      code: item.code || '', name: item.name || '', business_goal: item.business_goal || '',
      trigger_condition: item.trigger_condition || item.trigger || '',
      related_objects: item.related_objects || [], related_links: item.related_links || [],
      related_rules: item.related_rules || item.related_logic || [], related_actions: item.related_actions || [],
      source_codes: item.source_codes || [],
    });
  };

  const resourcesChanged = (item) => !item || ['related_objects', 'related_links', 'related_rules', 'related_actions', 'source_codes']
    .some((key) => JSON.stringify([...(item[key] || [])].sort()) !== JSON.stringify([...(form[key] || [])].sort()));

  const save = async (event) => {
    event.preventDefault();
    if (!form.related_objects.length) { notify('请至少选择一个主要对象。'); return; }
    setBusy('save');
    const old = editing?.item;
    const previousMappings = old?.related_mappings || [];
    const retainedMappings = previousMappings.filter((code) => {
      const mapping = mappings.find((item) => item.code === code);
      return !mapping?.source_code || form.source_codes.includes(mapping.source_code);
    });
    const changed = resourcesChanged(old);
    const payload = {
      business_goal: form.business_goal.trim(),
      trigger_condition: form.trigger_condition.trim(),
      trigger: form.trigger_condition.trim(),
      entry_object: form.related_objects.includes(old?.entry_object) ? old.entry_object : form.related_objects[0] || '',
      related_objects: form.related_objects,
      related_links: form.related_links,
      related_rules: form.related_rules,
      related_actions: form.related_actions,
      source_codes: form.source_codes,
      related_mappings: retainedMappings,
      steps: changed ? [] : (old?.steps || []),
      trigger_type: old?.trigger_type || 'manual',
      input_data: old?.input_data || '',
      output_change: old?.output_change || '',
      participants: old?.participants || [],
      acceptance_criteria: old?.acceptance_criteria || [],
      owner: old?.owner || '',
      category: old?.category || '',
      description: old?.description || '',
      ...Object.fromEntries(['template_external_id', 'template_sheet', 'template_row', 'template_raw', 'design_status'].filter((key) => old?.[key] !== undefined).map((key) => [key, old[key]])),
    };
    const body = {
      code: form.code.trim(), name: form.name.trim(), category: old?.category || '', status: old?.status || 'draft',
      description: old?.description || '', payload,
    };
    try {
      await api(editing.create ? `/api/ontologies/${activeId}/enterprise/business-scenarios` : `/api/ontologies/${activeId}/enterprise/business-scenarios/${old.id}`, { method: editing.create ? 'POST' : 'PUT', body: JSON.stringify(body) });
      setEditing(null);
      await load();
      notify('业务场景已保存');
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy('');
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`确定删除业务场景“${item.name}”吗？`)) return;
    try {
      await api(`/api/enterprise/business-scenarios/${item.id}`, { method: 'DELETE' });
      if (editing?.item?.id === item.id) setEditing(null);
      if (selected?.id === item.id) { setSelected(null); closeDetail(); }
      await load();
    } catch (cause) {
      notify(cause.message);
    }
  };

  const runAiDiscovery = () => {
    const text = aiPrompt.trim();
    if (!text) { notify('请先描述业务问题或业务目标。'); return; }
    setAiBusy(true);
    setAiResult(null);
    window.setTimeout(() => {
      const haystack = text.toLowerCase();
      const matchedObjects = objects.filter((item) => [item.display_name, item.name, item.description].some((value) => value && haystack.includes(String(value).toLowerCase())));
      const objectNames = new Set(matchedObjects.map((item) => item.name));
      const objectIds = new Set(matchedObjects.map((item) => item.id));
      const matchedLinks = links.filter((item) => (objectIds.has(item.source_object_type_id) && objectIds.has(item.target_object_type_id)) || [item.display_name, item.name, item.description].some((value) => value && haystack.includes(String(value).toLowerCase())));
      const matchedRules = rules.filter((item) => objectIds.has(item.target_object_type_id) || [item.display_name, item.name, item.description].some((value) => value && haystack.includes(String(value).toLowerCase())));
      const matchedActions = actions.filter((item) => objectIds.has(item.target_object_type_id) || [item.display_name, item.name, item.description].some((value) => value && haystack.includes(String(value).toLowerCase())));
      const matchedSources = sources.filter((item) => [item.name, item.code, item.physical_object, item.category].some((value) => value && haystack.includes(String(value).toLowerCase())));
      setAiResult({ objects: matchedObjects, links: matchedLinks, rules: matchedRules, actions: matchedActions, sources: matchedSources });
      setAiBusy(false);
    }, 450);
  };

  const applyAiDraft = () => {
    if (!aiResult?.objects?.length) return;
    setAiOpen(false);
    closeDetail();
    setSelected(null);
    setEditing({ create: true, item: null });
    setForm({
      ...emptyForm(), name: aiPrompt.trim().slice(0, 40), business_goal: aiPrompt.trim(),
      related_objects: aiResult.objects.map((item) => item.name),
      related_links: aiResult.links.map((item) => item.name),
      related_rules: aiResult.rules.map((item) => item.name),
      related_actions: aiResult.actions.map((item) => item.name),
      source_codes: aiResult.sources.map((item) => item.code),
    });
    notify('已把 AI 候选资源填入新场景，请补充场景ID和触发条件后人工保存。');
  };

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!items) return <Loading />;

  return <div className="scenario-simple-page">
    <div className="scenario-crumb-bar">
      <div className="ontology-breadcrumb"><Workflow size={15} /><span>本体工作台</span><ChevronRight size={13} /><strong>业务场景</strong></div>
      <div className="scenario-crumb-actions"><button type="button" className="scenario-ai-button" onClick={() => { setAiOpen(true); setAiResult(null); }}><Sparkles size={15} /> AI 发现资源</button><button type="button" className="oma-button" onClick={openCreate}><Plus size={16} /> 新建业务场景</button></div>
    </div>

    <div className={`scenario-simple-layout ${detailOpen && selected ? 'detail-open' : 'detail-collapsed'}`}>
      <div className="scenario-simple-main">
        <div className="scenario-simple-toolbar"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索场景ID、业务场景、业务目标" /></label><span>共 {filtered.length} 个场景</span></div>
        <div className="scenario-simple-table-wrap">
          <table className="scenario-simple-table scenario-core-table">
            <thead><tr><th>场景ID</th><th>业务场景</th><th>业务目标 / 任务</th><th>主要对象</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{pageRows.map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => { setSelected(item); openDetail(); }}>
              <td><code>{item.code}</code></td>
              <td><strong>{item.name}</strong><small>{item.related_objects?.length || 0} 对象 · {item.related_links?.length || 0} 关系 · {item.related_rules?.length || 0} 规则</small></td>
              <td><span className="scenario-table-text" title={item.business_goal || ''}>{item.business_goal || '—'}</span></td>
              <td><ResourceCell codes={item.related_objects} items={objects} /></td>
              <td><span className={`scenario-list-status ${item.status || 'draft'}`}>{statusLabel[item.status] || item.status || '设计中'}</span></td>
              <td className="scenario-simple-actions"><button type="button" title="编辑" onClick={(event) => { event.stopPropagation(); openEdit(item); }}><Pencil size={14} /></button><button type="button" title="删除" onClick={(event) => { event.stopPropagation(); remove(item); }}><Trash2 size={14} /></button></td>
            </tr>)}{!pageRows.length && <tr><td colSpan={6}><EmptyState title={query ? '没有匹配的场景' : '还没有业务场景'} description={query ? '换一个关键词试试。' : '从业务对象和关键流程开始登记一个场景。'} /></td></tr>}</tbody>
          </table>
        </div>
        <PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </div>

      {selected && <aside className="scenario-simple-detail">
        <header><div><span>场景详情</span><strong>{selected.name}</strong><code>{selected.code}</code></div><button type="button" className="detail-close-btn" title="收起详情" aria-label="收起详情" onClick={closeDetail}><X size={14} /></button></header>
        <div className="scenario-simple-detail-body">
          <div className="scenario-detail-status"><span className={`scenario-list-status ${selected.status || 'draft'}`}>{statusLabel[selected.status] || selected.status || '设计中'}</span><small>{selected.category || '未分类'}</small></div>
          <section><h4>业务目标 / 任务</h4><p>{selected.business_goal || '未填写'}</p></section>
          <section><h4>触发条件</h4><p>{selected.trigger_condition || selected.trigger || '未填写'}</p></section>
          <section><h4>主要对象<em>{selected.related_objects?.length || 0}</em></h4><ResourceChips codes={selected.related_objects} items={objects} /></section>
          <section><h4>关键关系<em>{selected.related_links?.length || 0}</em></h4><ResourceChips codes={selected.related_links} items={links} /></section>
          <section><h4>规则<em>{selected.related_rules?.length || 0}</em></h4><ResourceChips codes={selected.related_rules || selected.related_logic} items={rules} /></section>
          <section><h4>行动<em>{selected.related_actions?.length || 0}</em></h4><ResourceChips codes={selected.related_actions} items={actions} /></section>
          <section><h4>关联公司系统<em>{selected.source_codes?.length || 0}</em></h4>{selected.source_codes?.length ? <ResourceChips codes={selected.source_codes} items={sources} codeKey="code" /> : <p>{selected.connected_systems || '未关联系统'}</p>}</section>
          {selected.description && <section><h4>业务说明</h4><p>{selected.description}</p></section>}
        </div>
        <footer><button type="button" onClick={() => openEdit(selected)}><Pencil size={14} /> 编辑</button><button type="button" className="scenario-detail-ai" onClick={() => { setAiOpen(true); setAiResult(null); }}><Sparkles size={14} /> AI 发现资源</button><button type="button" className="danger-link" onClick={() => remove(selected)}><Trash2 size={14} /> 删除</button></footer>
      </aside>}
    </div>

    {aiOpen && <Modal wide title="AI 发现场景资源" subtitle="描述业务问题，AI 从当前本体检索对象、关系、规则、行动和系统；结果只进入草稿，不自动发布。" onClose={() => setAiOpen(false)} footer={<><span className="scenario-ai-footnote">AI 结果需人工确认；应用后仍需保存</span><button type="button" className="btn secondary" onClick={() => setAiOpen(false)}>取消</button><button type="button" className="btn primary" disabled={!aiResult?.objects?.length} onClick={applyAiDraft}>应用到新场景</button></>}>
      <div className="scenario-ai-dialog">
        <label className="scenario-ai-prompt"><span>业务问题 / 业务目标</span><textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="例如：从业务量、负载和预警事件出发，提前识别容量风险并生成调度建议。" /><small>原型使用当前本体资源做本地匹配；正式环境替换为模型服务，返回候选资源和证据。</small></label>
        <button type="button" className="scenario-ai-run" disabled={aiBusy || !aiPrompt.trim()} onClick={runAiDiscovery}><Sparkles size={15} /> {aiBusy ? '正在发现…' : '开始发现资源'}</button>
        {aiBusy && <div className="scenario-ai-loading">正在当前本体中检索候选资源…</div>}
        {aiResult && !aiResult.objects.length && <div className="scenario-ai-empty">没有从描述中匹配到对象。请补充对象名称，或手动新建场景。</div>}
        {aiResult && aiResult.objects.length > 0 && <div className="scenario-ai-results"><div className="scenario-ai-summary">发现 <b>{aiResult.objects.length}</b> 个对象、<b>{aiResult.links.length}</b> 条关系、<b>{aiResult.rules.length}</b> 条规则、<b>{aiResult.actions.length}</b> 个行动、<b>{aiResult.sources.length}</b> 个系统。请人工确认后应用。</div><div className="scenario-ai-groups"><section><h4>主要对象 <em>{aiResult.objects.length}</em></h4><ResourceChips codes={aiResult.objects.map((item) => item.name)} items={objects} /></section><section><h4>关键关系 <em>{aiResult.links.length}</em></h4><ResourceChips codes={aiResult.links.map((item) => item.name)} items={links} /></section><section><h4>规则 <em>{aiResult.rules.length}</em></h4><ResourceChips codes={aiResult.rules.map((item) => item.name)} items={rules} /></section><section><h4>行动 <em>{aiResult.actions.length}</em></h4><ResourceChips codes={aiResult.actions.map((item) => item.name)} items={actions} /></section><section><h4>关联系统 <em>{aiResult.sources.length}</em></h4><ResourceChips codes={aiResult.sources.map((item) => item.code)} items={sources} codeKey="code" /></section></div></div>}
      </div>
    </Modal>}

    {editing && <Modal wide title={editing.create ? '新建业务场景' : `编辑业务场景 · ${editing.item.name}`} subtitle="只维护业务场景与资源引用；执行编排、运行记录等能力不在本表展开。" onClose={() => setEditing(null)} footer={<><button className="btn secondary" onClick={() => setEditing(null)}>取消</button><button className="btn primary" form="scenario-simple-form" disabled={busy === 'save'}>{busy === 'save' ? '保存中…' : '保存场景'}</button></>}>
      <form id="scenario-simple-form" className="form-sections scenario-simple-form" onSubmit={save}>
        <div className="form-grid two"><label><span>场景ID</span><input required disabled={!editing.create} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="SCN-001" /><small>保存后不可修改，同本体唯一。</small></label><label><span>业务场景</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label></div>
        <label><span>业务目标 / 任务</span><textarea required value={form.business_goal} onChange={(event) => setForm({ ...form, business_goal: event.target.value })} placeholder="用一句话说明场景要完成的业务任务" /></label>
        <label><span>触发条件</span><textarea required value={form.trigger_condition} onChange={(event) => setForm({ ...form, trigger_condition: event.target.value })} placeholder="什么事件、时间或数据变化触发这个场景" /></label>
        <div className="form-grid two"><ResourcePicker label="主要对象ID" items={objects} value={form.related_objects} onChange={(value) => setForm({ ...form, related_objects: value })} /><ResourcePicker label="关键关系ID" items={links} value={form.related_links} onChange={(value) => setForm({ ...form, related_links: value })} detail={(item) => [item.source_display_name, item.target_display_name].filter(Boolean).join(" -> ")} /></div>
        <div className="form-grid two"><ResourcePicker label="规则ID" items={rules} value={form.related_rules} onChange={(value) => setForm({ ...form, related_rules: value })} detail={(item) => item.description || ""} /><ResourcePicker label="行动ID" items={actions} value={form.related_actions} onChange={(value) => setForm({ ...form, related_actions: value })} detail={(item) => item.description || ""} /></div>
        <ResourcePicker label="关联的公司系统" items={sources} value={form.source_codes} onChange={(value) => setForm({ ...form, source_codes: value })} codeKey="code" labelKey="name" detail={(item) => item.physical_object || item.category || ""} />{!form.source_codes.length && editing?.item?.connected_systems && <p className="scenario-simple-legacy">历史关联系统文本：{editing.item.connected_systems}。重新选择后将以数据源 code 保存。</p>}
        <p className="scenario-simple-note">主要对象、关键关系、规则、行动、关联系统均是多选，因为对应存储字段都是列表；入口对象由主要对象第一项派生，不在表单中单独选择。场景状态、执行步骤、验收口径、数据映射等字段仍保留在存储中，本表不展示。</p>
      </form>
    </Modal>}
  </div>;
}
