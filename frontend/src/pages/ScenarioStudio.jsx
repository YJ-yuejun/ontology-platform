import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronRight, CircleDot, Clock3, Pencil, Play, Plus, Search, ShieldAlert, Sparkles, Trash2, Workflow } from 'lucide-react';
import { api, formatTime } from '../api';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';

const STEP_TYPES = [['object_resolve', '定位对象'], ['link_traverse', '穿透关系'], ['mapping_read', '读取数据映射'], ['rule_execute', '执行规则'], ['action_propose', '提议动作'], ['approval', '人工审批'], ['verify', '验证结果']];
const STEP_LABELS = Object.fromEntries(STEP_TYPES);
const FAILURE_LABELS = { stop: '终止场景', manual: '转人工处理', continue: '记录后继续' };
const statusLabel = { active: '已发布', draft: '设计中', experimental: '试验中', proposal: '建议中', deprecated: '已废弃' };
const statusTone = { active: 'ready', draft: 'draft', experimental: 'draft', proposal: 'proposal', deprecated: 'disabled' };
const triggerLabel = { manual: '人工发起', event: '业务事件', scheduled: '定时运行', api: '接口调用' };
const emptyForm = () => ({
  code: '', name: '', category: '', status: 'draft', description: '',
  business_goal: '', trigger_type: 'manual', trigger_condition: '', entry_object: '',
  owner: '', participants: '', input_data: '', output_change: '', acceptance_criteria: '',
  related_objects: [], related_links: [], related_rules: [], related_actions: [],
  source_codes: [], related_mappings: [], steps: [],
});
const split = (value) => String(value || '').split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
const join = (value) => Array.isArray(value) ? value.join('\n') : (value || '');
const unique = (items) => [...new Set(items.filter(Boolean))];
const normalizeSteps = (steps) => steps.map((item, index) => ({ ...item, order: index + 1 }));
const isStructuredSteps = (steps) => Array.isArray(steps) && steps.some((step) => step && typeof step === 'object');

function ChoiceGrid({ title, items, value, onChange, valueKey = 'name', labelKey = 'display_name', codeKey = 'name', hint }) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (code) => onChange(selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code]);
  return <fieldset className="scenario-choice"><legend>{title}<em>{selected.length}</em></legend>{hint && <p>{hint}</p>}<div className="scenario-choice-list">{items.map((item) => {
    const code = item[valueKey];
    return <label key={item.id || code} className={selected.includes(code) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(code)} onChange={() => toggle(code)} /><span><b>{item[labelKey] || code}</b>{code && <code>{code}</code>}</span></label>;
  })}{!items.length && <em>尚无可选资源，请先在对应建模页建立定义。</em>}</div></fieldset>;
}

function PackageCard({ title, items, emptyText = '未选择', tone = '' }) {
  return <article className={`scenario-package-card ${tone}`}><header><strong>{title}</strong><span>{items.length}</span></header>{items.length ? <div className="scenario-package-chips">{items.map((item) => <span key={`${item.code}-${item.label}`} title={item.code}>{item.label}<code>{item.code}</code></span>)}</div> : <p>{emptyText}</p>}</article>;
}

function generateSteps(form, actions = []) {
  const steps = [];
  const add = (type, resourceRef, detail, extra = {}) => steps.push({ order: steps.length + 1, name: resourceRef ? `${STEP_LABELS[type]}：${resourceRef}` : STEP_LABELS[type], type, resource_ref: resourceRef || '', detail, on_failure: ['mapping_read', 'action_propose', 'verify'].includes(type) ? 'manual' : 'stop', approval_required: type === 'action_propose', ...extra });
  if (form.entry_object) add('object_resolve', form.entry_object, `以 ${form.entry_object} 作为场景入口对象`);
  form.related_links.forEach((code) => add('link_traverse', code, `沿关系 ${code} 扩展业务上下文`));
  form.related_mappings.forEach((code) => add('mapping_read', code, `通过映射 ${code} 读取受治理数据`));
  form.related_rules.forEach((code) => add('rule_execute', code, `执行确定性规则 ${code}`));
  form.related_actions.forEach((code) => add('action_propose', code, `形成动作 ${code} 的受控执行建议`, { approval_required: Boolean(actions.find((item) => item.name === code)?.approval_required) }));
  add('verify', '', form.output_change || '验证场景输出并记录审计', { state_change: true });
  return steps;
}

function scenarioReadiness(scenario) {
  const objects = scenario?.related_objects || [];
  const steps = isStructuredSteps(scenario?.steps);
  const entry = Boolean(scenario?.entry_object && objects.includes(scenario.entry_object));
  const checks = [
    ['主要对象', objects.length > 0],
    ['入口对象', entry],
    ['关键关系', (scenario?.related_links || []).length > 0],
    ['规则或动作', (scenario?.related_rules || []).length + (scenario?.related_actions || []).length > 0],
    ['执行步骤', steps],
  ];
  const passed = checks.filter(([, ok]) => ok).length;
  return { checks, missing: checks.filter(([, ok]) => !ok).map(([label]) => label), score: Math.round((passed / checks.length) * 100), canRun: entry && steps };
}

export default function ScenarioStudio({ activeId, notify }) {
  const [items, setItems] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [run, setRun] = useState(null);
  const [tab, setTab] = useState('overview');
  const [pathExpanded, setPathExpanded] = useState(false);
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

  const load = async (preferredId) => {
    setError('');
    try {
      const [scenarioRows, history, objectRows, linkRows, ruleRows, actionRows, sourceRows, mappingRows] = await Promise.all([
        api(`/api/ontologies/${activeId}/enterprise/business-scenarios`),
        api(`/api/ontologies/${activeId}/scenario-runs`),
        api(`/api/ontologies/${activeId}/object-types`),
        api(`/api/ontologies/${activeId}/link-types`),
        api(`/api/ontologies/${activeId}/business-rules`),
        api(`/api/ontologies/${activeId}/actions`),
        api(`/api/ontologies/${activeId}/enterprise/data-sources`),
        api(`/api/ontologies/${activeId}/enterprise/data-mappings`),
      ]);
      setItems(scenarioRows);
      setRuns(history);
      setObjects(objectRows);
      setLinks(linkRows);
      setRules(ruleRows);
      setActions(actionRows);
      setSources(sourceRows);
      setMappings(mappingRows);
      const next = scenarioRows.find((item) => item.id === preferredId) || scenarioRows.find((item) => item.id === selected?.id) || scenarioRows[0] || null;
      setSelected(next);
      setRun(history.find((item) => item.scenario_id === next?.id) || null);
    } catch (cause) {
      setError(cause.message);
    }
  };

  useEffect(() => { setItems(null); setRun(null); setSelected(null); setTab('overview'); load(); }, [activeId]);
  useEffect(() => { if (selected) { setRun(runs.find((item) => item.scenario_id === selected.id) || null); setTab('overview'); setPathExpanded(false); } }, [selected?.id]);

  const visible = useMemo(() => (items || []).filter((item) => `${item.code} ${item.name} ${item.category} ${item.business_goal || ''}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, pageSize]);
  useHistoryResourceFocus({ resourceTypes: ['business_scenario'], items, visible, pageSize, setPage, onSelect: (item) => { setSelected(item); setTab('overview'); }, ready: Boolean(items) });

  const selectedRuns = useMemo(() => runs.filter((item) => item.scenario_id === selected?.id), [runs, selected?.id]);
  const selectedRun = selectedRuns.find((item) => item.id === run?.id) || selectedRuns[0] || null;
  const readiness = useMemo(() => scenarioReadiness(selected), [selected]);
  const runnableCount = (items || []).filter((item) => scenarioReadiness(item).canRun).length;
  const selectedObjectIds = useMemo(() => new Set(objects.filter((item) => form.related_objects.includes(item.name)).map((item) => item.id)), [objects, form.related_objects]);
  const eligibleLinks = useMemo(() => form.related_objects.length ? links.filter((item) => selectedObjectIds.has(item.source_object_type_id) && selectedObjectIds.has(item.target_object_type_id)) : links, [links, selectedObjectIds, form.related_objects.length]);
  const sourceLabel = (code) => sources.find((item) => item.code === code)?.name || code;
  const mappingLabel = (code) => mappings.find((item) => item.code === code)?.name || code;
  const objectLabel = (code) => objects.find((item) => item.name === code)?.display_name || code;

  const packageItems = useMemo(() => ({
    objects: (selected?.related_objects || []).map((code) => ({ code, label: objectLabel(code) })),
    links: (selected?.related_links || []).map((code) => ({ code, label: links.find((item) => item.name === code)?.display_name || code })),
    rules: (selected?.related_rules || []).map((code) => ({ code, label: rules.find((item) => item.name === code)?.display_name || code })),
    actions: (selected?.related_actions || []).map((code) => ({ code, label: actions.find((item) => item.name === code)?.display_name || code })),
    mappings: (selected?.related_mappings || []).map((code) => ({ code, label: mappingLabel(code) })),
    systems: (selected?.source_codes || []).map((code) => ({ code, label: sourceLabel(code) })),
  }), [selected, objects, links, rules, actions, sources, mappings]);
  const packageCount = Object.values(packageItems).reduce((total, entries) => total + entries.length, 0);
  const pathLinks = (selected?.related_links || []).map((code) => links.find((item) => item.name === code)).filter(Boolean);

  const openCreate = () => { setEditing({ create: true }); setForm(emptyForm()); };
  const openEdit = () => {
    if (!selected) return;
    setEditing(selected);
    setForm({
      ...emptyForm(), code: selected.code || '', name: selected.name || '', category: selected.category || '', status: selected.status || 'draft', description: selected.description || '',
      business_goal: selected.business_goal || '', trigger_type: selected.trigger_type || 'manual', trigger_condition: selected.trigger_condition || selected.trigger || '', entry_object: selected.entry_object || '',
      owner: selected.owner || '', participants: join(selected.participants), input_data: selected.input_data || join(selected.input_data_items), output_change: selected.output_change || '', acceptance_criteria: join(selected.acceptance_criteria),
      related_objects: selected.related_objects || [], related_links: selected.related_links || [], related_rules: selected.related_rules || selected.related_logic || [], related_actions: selected.related_actions || [],
      source_codes: selected.source_codes || [], related_mappings: selected.related_mappings || [], steps: isStructuredSteps(selected.steps) ? selected.steps : [],
    });
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy('save');
    const payload = {
      business_goal: form.business_goal.trim(), trigger_type: form.trigger_type, trigger_condition: form.trigger_condition.trim(), trigger: form.trigger_condition.trim(),
      entry_object: form.related_objects.includes(form.entry_object) ? form.entry_object : form.related_objects[0] || '', participants: split(form.participants), owner: form.owner.trim(),
      input_data: form.input_data.trim(), output_change: form.output_change.trim(), acceptance_criteria: split(form.acceptance_criteria),
      related_objects: form.related_objects, related_links: form.related_links, related_rules: form.related_rules, related_actions: form.related_actions,
      source_codes: form.source_codes, related_mappings: form.related_mappings, steps: normalizeSteps(form.steps),
      ...Object.fromEntries(['template_external_id', 'template_sheet', 'template_row', 'template_raw'].filter((key) => editing?.[key] !== undefined).map((key) => [key, editing[key]])),
    };
    const body = { code: form.code.trim(), name: form.name.trim(), category: form.category.trim(), status: form.status, description: form.description.trim(), payload };
    try {
      const saved = await api(editing?.create ? `/api/ontologies/${activeId}/enterprise/business-scenarios` : `/api/ontologies/${activeId}/enterprise/business-scenarios/${editing.id}`, { method: editing?.create ? 'POST' : 'PUT', body: JSON.stringify(body) });
      setEditing(null);
      await load(saved.id);
      notify('业务场景已保存到工作状态');
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`确定删除业务场景“${selected.name}”吗？`)) return;
    try {
      await api(`/api/enterprise/business-scenarios/${selected.id}`, { method: 'DELETE' });
      setSelected(null);
      setEditing(null);
      await load();
    } catch (cause) {
      notify(cause.message);
    }
  };

  const execute = async () => {
    if (!selected || !isStructuredSteps(selected.steps)) return;
    setBusy('run');
    try {
      const result = await api(`/api/ontologies/${activeId}/scenarios/${selected.id}/run`, { method: 'POST', body: JSON.stringify({ sample_data: {} }) });
      setRun(result);
      setRuns((old) => [result, ...old]);
      setTab('runs');
      notify('已生成流程预览，尚未调用业务系统');
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy('');
    }
  };

  const updateObjects = (value) => {
    const nextIds = new Set(objects.filter((item) => value.includes(item.name)).map((item) => item.id));
    const nextLinks = links.filter((item) => nextIds.has(item.source_object_type_id) && nextIds.has(item.target_object_type_id)).map((item) => item.name);
    setForm((current) => ({ ...current, related_objects: value, entry_object: value.includes(current.entry_object) ? current.entry_object : value[0] || '', related_links: current.related_links.filter((code) => nextLinks.includes(code)), steps: [] }));
  };
  const updateMappings = (codes) => {
    const mappingSources = unique(codes.map((code) => mappings.find((item) => item.code === code)?.source_code));
    setForm((current) => ({ ...current, related_mappings: codes, source_codes: unique([...current.source_codes, ...mappingSources]), steps: [] }));
  };
  const suggestResources = () => {
    const haystack = `${form.name} ${form.business_goal} ${form.description} ${form.trigger_condition}`.toLowerCase();
    const matchedObjects = objects.filter((item) => haystack.includes(String(item.display_name || '').toLowerCase()) || haystack.includes(String(item.name || '').toLowerCase())).map((item) => item.name);
    if (!matchedObjects.length) {
      notify('没有从场景文本中识别到对象名称，请补充业务目标或手动选择。');
      return;
    }
    const nextObjects = unique([...form.related_objects, ...matchedObjects]);
    const nextIds = new Set(objects.filter((item) => nextObjects.includes(item.name)).map((item) => item.id));
    const suggestedLinks = links.filter((item) => nextIds.has(item.source_object_type_id) && nextIds.has(item.target_object_type_id)).map((item) => item.name);
    const suggestedRules = rules.filter((item) => haystack.includes(String(item.display_name || '').toLowerCase()) || haystack.includes(String(item.name || '').toLowerCase())).map((item) => item.name);
    const suggestedActions = actions.filter((item) => haystack.includes(String(item.display_name || '').toLowerCase()) || haystack.includes(String(item.name || '').toLowerCase())).map((item) => item.name);
    setForm((current) => ({ ...current, related_objects: nextObjects, entry_object: nextObjects.includes(current.entry_object) ? current.entry_object : nextObjects[0] || '', related_links: unique([...current.related_links, ...suggestedLinks]), related_rules: unique([...current.related_rules, ...suggestedRules]), related_actions: unique([...current.related_actions, ...suggestedActions]), steps: [] }));
    notify(`已建议 ${nextObjects.length} 个对象、${suggestedLinks.length} 条关系，请人工确认后再生成步骤。`);
  };

  const resourceOptions = (type) => {
    if (type === 'object_resolve') return objects.filter((item) => form.related_objects.includes(item.name)).map((item) => ({ code: item.name, label: item.display_name }));
    if (type === 'link_traverse') return links.filter((item) => form.related_links.includes(item.name)).map((item) => ({ code: item.name, label: item.display_name }));
    if (type === 'mapping_read') return mappings.filter((item) => form.related_mappings.includes(item.code)).map((item) => ({ code: item.code, label: item.name }));
    if (type === 'rule_execute') return rules.filter((item) => form.related_rules.includes(item.name)).map((item) => ({ code: item.name, label: item.display_name }));
    if (type === 'action_propose') return actions.filter((item) => form.related_actions.includes(item.name)).map((item) => ({ code: item.name, label: item.display_name }));
    return [];
  };
  const updateStep = (index, changes) => setForm((current) => ({ ...current, steps: current.steps.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item) }));
  const changeStepType = (index, type) => updateStep(index, { type, name: STEP_LABELS[type], resource_ref: '', approval_required: false, state_change: type === 'verify' });
  const addStep = () => setForm((current) => ({ ...current, steps: normalizeSteps([...current.steps, { order: current.steps.length + 1, name: STEP_LABELS.verify, type: 'verify', resource_ref: '', detail: '', on_failure: 'manual', approval_required: false, state_change: true }]) }));
  const moveStep = (index, direction) => setForm((current) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= current.steps.length) return current;
    const next = [...current.steps];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    return { ...current, steps: normalizeSteps(next) };
  });
  const deleteStep = (index) => setForm((current) => ({ ...current, steps: normalizeSteps(current.steps.filter((_, itemIndex) => itemIndex !== index)) }));

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!items) return <Loading />;

  return <div className="scenario-studio scenario-studio-v2">
    <section className="scenario-header"><div><span>场景驱动建模</span><h2>业务场景</h2><p>把对象、关系、规则、动作和数据映射组装成可验收的业务闭环；场景是资源包，不是单张配置表。</p></div><div className="scenario-header-actions"><div className="scenario-header-stats"><span><b>{items.length}</b> 个场景</span><span><b>{runnableCount}</b> 可试跑</span></div><button className="oma-button" onClick={openCreate}><Plus size={16} /> 新建业务场景</button></div></section>

    <div className="scenario-layout scenario-layout-v2">
      <aside className="scenario-list">
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索场景、目标或编码" /></label>
        <header><strong>场景目录</strong><span>{visible.length} 项</span></header>
        {pageRows.map((item) => { const state = scenarioReadiness(item); return <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => { setSelected(item); setTab('overview'); }}><i><Workflow size={17} /></i><span><b>{item.name}</b><code>{item.code}</code><small>{item.category || '未分类'} · {statusLabel[item.status] || item.status}</small><span className="scenario-list-meta"><em className={state.canRun ? 'ready' : 'draft'}>{state.canRun ? '可试跑' : '待补资源'}</em><span>{item.related_objects?.length || 0} 对象 · {item.related_links?.length || 0} 关系</span></span></span><ChevronRight size={15} /></button>; })}
        {!visible.length && <EmptyState title={query ? '没有匹配的场景' : '暂无业务场景'} description={query ? '换一个关键词试试。' : '从一个真实业务问题开始建立场景。'} />}
        <PaginationBar page={currentPage} pageSize={pageSize} total={visible.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </aside>

      <main className="scenario-work">{selected ? <>
        <header className="scenario-work-head"><div className="scenario-work-title"><div><span className="scenario-kicker">{selected.category || '未分类'}</span><em className={`scenario-status ${statusTone[selected.status] || 'draft'}`}>{statusLabel[selected.status] || selected.status}</em></div><h3>{selected.name}</h3><code>{selected.code}</code></div><div className="scenario-work-actions"><ResourceHistoryLink resourceType="business_scenario" resourceId={selected.id} /><button onClick={openEdit}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={remove}><Trash2 size={14} /> 删除</button><button className="oma-button" disabled={busy === 'run' || !isStructuredSteps(selected.steps)} title={isStructuredSteps(selected.steps) ? '生成流程预览，不调用真实系统' : '请先配置结构化执行步骤'} onClick={execute}><Play size={15} />{busy === 'run' ? '生成中…' : '运行预览'}</button></div></header>
        <nav className="scenario-tabs" aria-label="业务场景详情"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>场景概览</button><button className={tab === 'package' ? 'active' : ''} onClick={() => setTab('package')}>资源包 <em>{packageCount}</em></button><button className={tab === 'steps' ? 'active' : ''} onClick={() => setTab('steps')}>执行编排 <em>{selected.steps?.length || 0}</em></button><button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}>运行记录 <em>{selectedRuns.length}</em></button></nav>

        {tab === 'overview' && <div className="scenario-tab-body scenario-overview">
          <section className="scenario-goal"><CircleDot size={18} /><div><span>业务目标 / 任务</span><strong>{selected.business_goal || selected.description || '尚未定义业务目标'}</strong><small>{selected.description || '补充业务说明，帮助他人理解场景边界。'}</small></div></section>
          <div className="scenario-meta-grid"><div><span>触发方式</span><b>{triggerLabel[selected.trigger_type] || selected.trigger_type || '未定义'}</b></div><div><span>触发条件</span><b>{selected.trigger_condition || selected.trigger || '未定义'}</b></div><div><span>入口对象</span><b>{selected.entry_object ? objectLabel(selected.entry_object) : '未定义'}</b><small>{selected.entry_object || ''}</small></div><div><span>负责人 / 参与角色</span><b>{selected.owner || '未指定'}</b><small>{(selected.participants || []).join('、') || '未配置参与角色'}</small></div></div>
          <section className="scenario-path"><div className="section-caption"><strong>关键业务路径</strong><span>入口对象：{selected.entry_object ? objectLabel(selected.entry_object) : '未定义'}</span></div>{pathLinks.length ? <><div className="scenario-path-links">{(pathExpanded ? pathLinks : pathLinks.slice(0, 4)).map((link) => <div key={link.id || link.name} className="scenario-path-link"><b>{link.source_display_name || objects.find((item) => item.id === link.source_object_type_id)?.display_name || '起点'}</b><span>{link.display_name || link.name}</span><b>{link.target_display_name || objects.find((item) => item.id === link.target_object_type_id)?.display_name || '终点'}</b></div>)}</div>{pathLinks.length > 4 && <button type="button" className="scenario-path-more" onClick={() => setPathExpanded((old) => !old)}>{pathExpanded ? '收起路径' : `展开全部 ${pathLinks.length} 条关系`}</button>}</> : <div className="scenario-path-objects">{packageItems.objects.length ? packageItems.objects.map((item, index) => <span key={item.code}><b>{item.label}</b>{index < packageItems.objects.length - 1 && <ChevronRight size={18} />}</span>) : <p>请在资源包中选择主要对象和入口对象。</p>}</div>}</section>
          <div className="scenario-output-grid"><section><h4>输入数据</h4><p>{selected.input_data || '未说明输入数据。'}</p></section><section><h4>输出 / 状态变化</h4><p>{selected.output_change || '未说明输出和状态变化。'}</p></section><section><h4>验收口径</h4>{(selected.acceptance_criteria || []).length ? <div className="scenario-acceptance-list">{selected.acceptance_criteria.map((item) => <span key={item}><CheckCircle2 size={14} />{item}</span>)}</div> : <p>尚未定义可验证的验收口径。</p>}</section><section><h4>参与角色</h4><p>{(selected.participants || []).join('、') || '未配置参与角色。'}</p></section></div>
          <section className="scenario-package-preview"><header><div><strong>资源包摘要</strong><span>{packageCount} 项资源</span></div><button onClick={() => setTab('package')}>查看资源包 <ChevronRight size={14} /></button></header><div className="scenario-package-preview-grid"><span><b>{packageItems.objects.length}</b>对象</span><span><b>{packageItems.links.length}</b>关系</span><span><b>{packageItems.rules.length}</b>规则</span><span><b>{packageItems.actions.length}</b>动作</span><span><b>{packageItems.mappings.length}</b>映射</span><span><b>{packageItems.systems.length}</b>系统</span></div><div className={`scenario-readiness-line ${readiness.canRun ? 'ready' : 'draft'}`}><span>准备度 {readiness.score}%</span><i><b style={{ width: `${readiness.score}%` }} /></i>{readiness.missing.length ? <small>待补：{readiness.missing.join('、')}</small> : <small>资源与步骤已具备流程预览条件</small>}</div></section>
        </div>}

        {tab === 'package' && <div className="scenario-tab-body"><div className={`scenario-readiness-card ${readiness.canRun ? 'ready' : 'draft'}`}><div><span>场景准备度</span><b>{readiness.score}%</b></div><p>{readiness.canRun ? '入口对象与结构化执行步骤已具备，可生成流程预览。' : `还缺：${readiness.missing.join('、')}。补齐后即可试跑。`}</p><div className="scenario-readiness-checks">{readiness.checks.map(([label, ok]) => <span key={label} className={ok ? 'ok' : ''}>{ok ? <CheckCircle2 size={13} /> : <CircleDot size={13} />}{label}</span>)}</div></div><div className="scenario-package-grid"><PackageCard title="入口对象" items={selected.entry_object ? [{ code: selected.entry_object, label: objectLabel(selected.entry_object) }] : []} emptyText="未指定入口对象" tone="accent" /><PackageCard title="主要对象" items={packageItems.objects} emptyText="未选择主要对象" /><PackageCard title="关键关系" items={packageItems.links} emptyText="未选择关键关系" /><PackageCard title="业务规则" items={packageItems.rules} emptyText="未选择业务规则" /><PackageCard title="业务动作" items={packageItems.actions} emptyText="未选择业务动作" /><PackageCard title="数据映射" items={packageItems.mappings} emptyText="未关联数据映射" /><PackageCard title="关联系统" items={packageItems.systems} emptyText="未关联数据系统" /></div></div>}

        {tab === 'steps' && <div className="scenario-tab-body"><section className="scenario-plan"><div className="section-caption"><div><strong>执行编排</strong><span>用已选资源生成场景轨迹；写操作仍需人工确认。</span></div><button className="oma-button" disabled={busy === 'run' || !isStructuredSteps(selected.steps)} onClick={execute}><Play size={14} /> {busy === 'run' ? '生成中…' : '运行预览'}</button></div>{(selected.steps || []).length ? <ol>{(selected.steps || []).map((step, index) => <li key={typeof step === 'string' ? `${index}-${step}` : `${step.order}-${step.name}`}><i>{index + 1}</i><span><b>{typeof step === 'string' ? step : step.name}</b><small>{typeof step === 'string' ? '历史文本步骤，建议重新生成结构化步骤' : `${STEP_LABELS[step.type] || step.type} · ${step.detail || '未填写说明'}`}</small></span>{typeof step === 'object' && step.approval_required && <em>需人工确认</em>}</li>)}</ol> : <div className="scenario-empty-inline"><Workflow size={24} /><strong>还没有执行步骤</strong><p>在编辑场景中根据资源生成步骤，或手动添加。</p><button type="button" className="oma-button" onClick={openEdit}><Pencil size={14} /> 去编辑编排</button></div>}</section></div>}

        {tab === 'runs' && <div className="scenario-tab-body scenario-runs-view"><div className="scenario-run-list">{selectedRuns.map((item) => <button key={item.id} className={selectedRun?.id === item.id ? 'selected' : ''} onClick={() => setRun(item)}><span><b>{formatTime(item.created_at)}</b><small>{item.status === 'completed' ? '流程预览已生成' : item.status}</small></span><ChevronRight size={14} /></button>)}{!selectedRuns.length && <div className="scenario-empty-inline"><Play size={24} /><strong>还没有运行记录</strong><p>运行预览只生成拟执行轨迹，不调用真实业务系统。</p></div>}</div><div className="scenario-run-detail">{selectedRun ? <><div className="scenario-run-detail-head"><div><span>流程预览</span><b>{formatTime(selectedRun.created_at)}</b></div><em>未实际执行</em></div><div className="scenario-result"><ShieldAlert size={19} /><span><b>{selectedRun.result?.conclusion || '已生成流程轨迹'}</b><small>已配置 {selectedRun.result?.configured_rule_steps ?? '—'} 个规则步骤；实际执行结果未验证</small></span></div><ol className="scenario-run-steps">{selectedRun.steps?.map((step, index) => <li key={`${step.stage}-${index}`}><i><Clock3 size={14} /></i><span><b>{step.stage}</b><small>{step.detail}</small><code>{step.tool}</code></span></li>)}</ol><section className="scenario-action-result"><strong>拟执行动作</strong><span>{selectedRun.result?.action || '无'}</span><em>尚未执行</em></section></> : <EmptyState title="选择一条运行记录" description="查看流程预览轨迹；没有记录时先运行预览。" />}</div></div>}
      </> : <EmptyState title="选择一个业务场景" description="查看业务目标、资源包、执行编排和运行记录。" />}</main>
    </div>

    {editing && <Modal wide title={editing.create ? '新建业务场景' : `编辑场景 · ${editing.name}`} subtitle="场景是对象、关系、规则、动作和数据映射的集合包；保存的是工作状态，不会自动发布。" onClose={() => setEditing(null)} footer={<><button className="btn secondary" onClick={() => setEditing(null)}>取消</button><button className="btn primary" form="scenario-form" disabled={busy === 'save'}>{busy === 'save' ? '保存中…' : '保存场景'}</button></>}>
      <form id="scenario-form" className="form-sections scenario-form" onSubmit={save}>
        {!objects.length && <p className="scenario-form-warning">当前本体还没有对象类型。可以先把场景保存为设计稿；建立对象、关系和动作后再补充资源包并生成执行步骤。</p>}
        <section className="form-section"><h3>1. 场景定义</h3><div className="form-grid two"><label><span>场景编码</span><input required disabled={!editing.create} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="SCN-001" /><small>保存后不可修改，同本体唯一。</small></label><label><span>业务场景</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>业务分类</span><input list="scenario-categories" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="经营履约 / 安全运营 / 财务风控" /><datalist id="scenario-categories">{['经营履约', '安全运营', '运输调度', '财务风控', '供应链协同'].map((item) => <option value={item} key={item} />)}</datalist></label><label><span>状态</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="draft">设计中</option><option value="experimental">试验中</option><option value="active">已发布</option><option value="deprecated">已废弃</option></select></label><label><span>负责人</span><input value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="业务负责人或岗位" /></label></div><label><span>业务目标 / 任务</span><textarea required value={form.business_goal} onChange={(event) => setForm({ ...form, business_goal: event.target.value })} placeholder="要解决什么问题、达成什么业务结果" /></label><label><span>业务说明</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="补充场景边界、适用条件和不在范围内的内容" /></label></section>

        <section className="form-section"><h3>2. 触发与入口</h3><div className="form-grid two"><label><span>触发方式</span><select value={form.trigger_type} onChange={(event) => setForm({ ...form, trigger_type: event.target.value })}>{Object.entries(triggerLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>入口对象</span><select value={form.entry_object} onChange={(event) => setForm({ ...form, entry_object: event.target.value })}><option value="">请选择入口对象</option>{objects.filter((item) => form.related_objects.includes(item.name)).map((item) => <option key={item.id} value={item.name}>{item.display_name} · {item.name}</option>)}</select><small>入口对象必须属于下方“主要对象”。</small></label></div><label><span>触发条件</span><input required value={form.trigger_condition} onChange={(event) => setForm({ ...form, trigger_condition: event.target.value })} placeholder="例如：付款申请提交、压力越限、合同生效" /></label><div className="form-grid two"><label><span>参与角色</span><input value={form.participants} onChange={(event) => setForm({ ...form, participants: event.target.value })} placeholder="采购经办人、财务审核人（逗号分隔）" /></label><label><span>输入数据</span><input value={form.input_data} onChange={(event) => setForm({ ...form, input_data: event.target.value })} placeholder="金额、预算、合同、验收状态" /></label></div></section>

        <section className="form-section"><div className="scenario-form-heading"><div><h3>3. 本体资源包</h3><p>场景只引用当前本体中已存在的对象、关系、规则、动作和映射；保存不会修改这些资源。</p></div><button type="button" className="scenario-suggest-btn" onClick={suggestResources}><Sparkles size={14} /> 智能建议</button></div><ChoiceGrid title="主要对象" items={objects} value={form.related_objects} onChange={updateObjects} /><div className="form-grid two"><label><span>关键关系</span><select multiple value={form.related_links} onChange={(event) => setForm({ ...form, related_links: [...event.target.selectedOptions].map((option) => option.value), steps: [] })} className="scenario-multi-select">{eligibleLinks.map((item) => <option key={item.id} value={item.name}>{item.display_name} · {item.source_display_name || ''} → {item.target_display_name || ''}</option>)}</select><small>只显示两端都在主要对象中的关系。</small></label><label><span>关联数据映射</span><select multiple value={form.related_mappings} onChange={(event) => updateMappings([...event.target.selectedOptions].map((option) => option.value))} className="scenario-multi-select">{mappings.map((item) => <option key={item.id} value={item.code}>{item.name} · {item.code}</option>)}</select><small>选择映射会自动补入关联系统。</small></label></div><div className="form-grid two"><label><span>业务规则</span><select multiple value={form.related_rules} onChange={(event) => setForm({ ...form, related_rules: [...event.target.selectedOptions].map((option) => option.value), steps: [] })} className="scenario-multi-select">{rules.map((item) => <option key={item.id} value={item.name}>{item.display_name || item.name}</option>)}</select></label><label><span>业务动作</span><select multiple value={form.related_actions} onChange={(event) => setForm({ ...form, related_actions: [...event.target.selectedOptions].map((option) => option.value), steps: [] })} className="scenario-multi-select">{actions.map((item) => <option key={item.id} value={item.name}>{item.display_name || item.name}</option>)}</select></label></div><ChoiceGrid title="关联系统" items={sources} value={form.source_codes} onChange={(value) => setForm({ ...form, source_codes: value })} valueKey="code" labelKey="name" codeKey="code" hint="来自已登记数据源；选择映射时自动补入，也可手工调整。" /><div className="form-grid two"><label><span>输出 / 状态变化</span><textarea required value={form.output_change} onChange={(event) => setForm({ ...form, output_change: event.target.value })} placeholder="场景完成后产生什么结果、哪些状态发生变化" /></label><label><span>验收口径</span><textarea value={form.acceptance_criteria} onChange={(event) => setForm({ ...form, acceptance_criteria: event.target.value })} placeholder="每行一条可定量验证的通过条件" /></label></div></section>

        <details className="form-section" open={form.steps.length > 0 ? true : undefined}><summary>4. 执行编排（可选）</summary><p className="form-hint">场景语义可以先保存；配置结构化步骤后才可生成流程预览。运行预览不会调用真实系统。</p><div className="form-section-heading"><div><h3>执行步骤</h3><p>步骤引用上面已选资源；需要审批的动作请开启人工确认。</p></div><div><button type="button" disabled={!form.related_objects.length} onClick={() => setForm({ ...form, steps: generateSteps(form, actions) })}><Workflow size={14} /> 根据资源生成</button><button type="button" disabled={!form.related_objects.length} onClick={addStep}><Plus size={14} /> 添加步骤</button></div></div><div className="scenario-step-editor">{form.steps.map((step, index) => { const options = resourceOptions(step.type); return <article key={`${index}-${step.type}`}><div className="step-order"><b>{index + 1}</b><button type="button" title="上移" onClick={() => moveStep(index, -1)} disabled={index === 0}><ArrowUp size={13} /></button><button type="button" title="下移" onClick={() => moveStep(index, 1)} disabled={index === form.steps.length - 1}><ArrowDown size={13} /></button></div><div className="step-fields"><div><label><span>步骤类型</span><select value={step.type} onChange={(event) => changeStepType(index, event.target.value)}>{STEP_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>引用资源</span>{options.length ? <select required value={step.resource_ref || ''} onChange={(event) => updateStep(index, { resource_ref: event.target.value, name: `${STEP_LABELS[step.type]}：${event.target.value}`, approval_required: step.type === 'action_propose' ? Boolean(actions.find((item) => item.name === event.target.value)?.approval_required) : step.approval_required })}><option value="">请选择</option>{options.map((item) => <option key={item.code} value={item.code}>{item.label} · {item.code}</option>)}</select> : <input disabled value={['approval', 'verify'].includes(step.type) ? '无需引用资源' : '请先在上一步选择资源'} />}</label><label><span>失败策略</span><select value={step.on_failure || 'stop'} onChange={(event) => updateStep(index, { on_failure: event.target.value })}>{Object.entries(FAILURE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label><span>步骤名称</span><input required value={step.name} onChange={(event) => updateStep(index, { name: event.target.value })} /></label><label><span>执行说明</span><input value={step.detail || ''} onChange={(event) => updateStep(index, { detail: event.target.value })} /></label>{step.type === 'action_propose' && <label className="step-approval"><input type="checkbox" checked={Boolean(step.approval_required)} onChange={(event) => updateStep(index, { approval_required: event.target.checked })} /><span>执行前需要人工确认</span></label>}</div><button type="button" className="step-delete" onClick={() => deleteStep(index)} title="删除步骤"><Trash2 size={14} /></button></article>; })}{!form.steps.length && <div className="step-empty"><Workflow size={23} /><span>未配置执行步骤；可以只保存业务场景语义。</span></div>}</div></details>
      </form>
    </Modal>}
  </div>;
}
