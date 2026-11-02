import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import Modal from '../components/Modal';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';

const emptyForm = () => ({
  code: '', name: '', business_goal: '', trigger_condition: '',
  related_objects: [], related_links: [], related_rules: [], related_actions: [], source_codes: [],
});
const statusLabel = { active: '已发布', draft: '设计中', experimental: '试验中', proposal: '建议中', deprecated: '已废弃' };
const selectedValues = (event) => [...event.target.selectedOptions].map((option) => option.value);

function ResourceCell({ codes, items, codeKey = 'name' }) {
  const values = (codes || []).map((code) => {
    const item = items.find((entry) => entry[codeKey] === code);
    return item ? (item.display_name || item.name || code) : code;
  }).filter(Boolean);
  if (!values.length) return <span className="scenario-table-empty">—</span>;
  return <span className="scenario-table-ids" title={values.join('、')}>{values.join('、')}</span>;
}

function MultiSelect({ label, items, value, onChange, codeKey = 'name', labelKey = 'display_name' }) {
  return <label className="scenario-simple-field"><span>{label}<em>{value.length}</em></span><select multiple value={value} onChange={(event) => onChange(selectedValues(event))} className="scenario-simple-multi">{items.map((item) => <option key={item.id || item[codeKey]} value={item[codeKey]}>{(item[labelKey] || item.name || item[codeKey])} · {item[codeKey]}</option>)}</select><small>按住 Ctrl / Command 多选；保存的是资源 code 列表。</small></label>;
}

export default function ScenarioStudio({ activeId, notify }) {
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

  const filtered = useMemo(() => (items || []).filter((item) => `${item.code} ${item.name} ${item.business_goal || ''} ${item.trigger_condition || ''}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, pageSize]);

  const openCreate = () => { setEditing({ create: true, item: null }); setForm(emptyForm()); };
  const openEdit = (item) => {
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
      await load();
    } catch (cause) {
      notify(cause.message);
    }
  };

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!items) return <Loading />;

  return <div className="scenario-simple-page">
    <header className="scenario-simple-header">
      <div><span>业务场景</span><h2>业务场景</h2><p>按场景登记主要对象、关键关系、规则、行动和关联公司系统；只维护场景索引，不在这里展开执行编排。</p></div>
      <button className="oma-button" onClick={openCreate}><Plus size={16} /> 新建业务场景</button>
    </header>
    <div className="scenario-simple-toolbar">
      <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索场景ID、业务场景、业务目标" /></label>
      <span>共 {filtered.length} 个场景</span>
    </div>
    <div className="scenario-simple-table-wrap">
      <table className="scenario-simple-table">
        <thead><tr><th>场景ID</th><th>业务场景</th><th>业务目标 / 任务</th><th>触发条件</th><th>主要对象ID</th><th>关键关系ID</th><th>规则ID</th><th>行动ID</th><th>关联的公司系统</th><th>操作</th></tr></thead>
        <tbody>{pageRows.map((item) => <tr key={item.id} onClick={() => openEdit(item)}>
          <td><code>{item.code}</code></td>
          <td><strong>{item.name}</strong><small>{statusLabel[item.status] || item.status || ''}</small></td>
          <td><span className="scenario-table-text" title={item.business_goal || ''}>{item.business_goal || '—'}</span></td>
          <td><span className="scenario-table-text" title={item.trigger_condition || item.trigger || ''}>{item.trigger_condition || item.trigger || '—'}</span></td>
          <td><ResourceCell codes={item.related_objects} items={objects} /></td>
          <td><ResourceCell codes={item.related_links} items={links} /></td>
          <td><ResourceCell codes={item.related_rules || item.related_logic} items={rules} /></td>
          <td><ResourceCell codes={item.related_actions} items={actions} /></td>
          <td>{item.source_codes?.length ? <ResourceCell codes={item.source_codes} items={sources} codeKey="code" /> : <span className="scenario-table-text" title={item.connected_systems || ''}>{item.connected_systems || '—'}</span>}</td>
          <td className="scenario-simple-actions"><button type="button" title="编辑" onClick={(event) => { event.stopPropagation(); openEdit(item); }}><Pencil size={14} /></button><button type="button" title="删除" onClick={(event) => { event.stopPropagation(); remove(item); }}><Trash2 size={14} /></button></td>
        </tr>)}{!pageRows.length && <tr><td colSpan={10}><EmptyState title={query ? '没有匹配的场景' : '还没有业务场景'} description={query ? '换一个关键词试试。' : '从业务对象和关键流程开始登记一个场景。'} /></td></tr>}</tbody>
      </table>
    </div>
    <PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />

    {editing && <Modal wide title={editing.create ? '新建业务场景' : `编辑业务场景 · ${editing.item.name}`} subtitle="只维护业务场景与资源引用；执行编排、运行记录等能力不在本表展开。" onClose={() => setEditing(null)} footer={<><button className="btn secondary" onClick={() => setEditing(null)}>取消</button><button className="btn primary" form="scenario-simple-form" disabled={busy === 'save'}>{busy === 'save' ? '保存中…' : '保存场景'}</button></>}>
      <form id="scenario-simple-form" className="form-sections scenario-simple-form" onSubmit={save}>
        <div className="form-grid two"><label><span>场景ID</span><input required disabled={!editing.create} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="SCN-001" /><small>保存后不可修改，同本体唯一。</small></label><label><span>业务场景</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label></div>
        <label><span>业务目标 / 任务</span><textarea required value={form.business_goal} onChange={(event) => setForm({ ...form, business_goal: event.target.value })} placeholder="用一句话说明场景要完成的业务任务" /></label>
        <label><span>触发条件</span><textarea required value={form.trigger_condition} onChange={(event) => setForm({ ...form, trigger_condition: event.target.value })} placeholder="什么事件、时间或数据变化触发这个场景" /></label>
        <div className="form-grid two"><MultiSelect label="主要对象ID" items={objects} value={form.related_objects} onChange={(value) => setForm({ ...form, related_objects: value })} /><MultiSelect label="关键关系ID" items={links} value={form.related_links} onChange={(value) => setForm({ ...form, related_links: value })} /></div>
        <div className="form-grid two"><MultiSelect label="规则ID" items={rules} value={form.related_rules} onChange={(value) => setForm({ ...form, related_rules: value })} /><MultiSelect label="行动ID" items={actions} value={form.related_actions} onChange={(value) => setForm({ ...form, related_actions: value })} /></div>
        <MultiSelect label="关联的公司系统" items={sources} value={form.source_codes} onChange={(value) => setForm({ ...form, source_codes: value })} codeKey="code" labelKey="name" />{!form.source_codes.length && editing?.item?.connected_systems && <p className="scenario-simple-legacy">历史关联系统文本：{editing.item.connected_systems}。重新选择后将以数据源 code 保存。</p>}
        <p className="scenario-simple-note">场景状态、执行步骤、验收口径、数据映射等字段仍保留在存储中；本表不展示，避免把场景登记表做成流程编排器。</p>
      </form>
    </Modal>}
  </div>;
}
