import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { api, formatTime } from '../api';
import { actorLabel, designStatusLabel, statusLabel, usageStatusLabel, USAGE_STATUS_OPTIONS } from '../labels';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import useCreateIntent from '../hooks/useCreateIntent';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import useDetailPanel from '../hooks/useDetailPanel';
import { DictionaryField, useModelDictionary } from '../components/DictionaryManager';
import { actionCategoryCode, actionCategoryLabel, businessActionForm, businessActionPayload, validateBusinessAction } from '../actionDefinition';
import './Actions.css';

function Field({ label, value, onChange, multiline = false, limit, required = false, placeholder = '', disabled = false, readOnly = false, hint }) {
  const Tag = multiline ? 'textarea' : 'input';
  return <label><span>{label}{required && ' *'}</span><Tag value={value ?? ''} onChange={(event) => onChange?.(event.target.value)} required={required} maxLength={limit} placeholder={placeholder} disabled={disabled} readOnly={readOnly} rows={multiline ? 2 : undefined} />{hint && <small>{hint}</small>}</label>;
}

function DetailSection({ title, entries }) {
  return <section className="action-detail-section"><h4>{title}</h4><dl>{entries.map(([entryTitle, value]) => <div key={entryTitle}><dt>{entryTitle}</dt><dd>{value === false ? '否' : value === true ? '是' : value || '—'}</dd></div>)}</dl></section>;
}

function CompactMultiSelect({ values, options, onChange, hint }) {
  const selected = options.filter((option) => values.includes(option.value));
  return <details className="action-resource-select">
    <summary>{selected.length ? selected.map((option) => option.label).join('、') : '请选择触发规则'}</summary>
    <div className="action-resource-options" role="listbox" aria-label="触发规则">
      {options.length ? options.map((option) => <label key={option.value} className="action-resource-option"><input type="checkbox" checked={values.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...values, option.value] : values.filter((value) => value !== option.value))} /><span>{option.label}</span></label>) : <span className="action-resource-empty">当前本体暂无可用规则</span>}
    </div>
    {hint && <small>{hint}</small>}
  </details>;
}

const inputText = (item) => item.input_parameters_text ?? item.template_raw?.输入参数 ?? (item.parameters || []).map((param) => param.name).join('、');
const ruleName = (rule) => rule.name || rule.display_name || rule.code;
const ruleCode = (rule) => rule.code || rule.id;
const isFunction = (rule) => ['函数', 'function'].includes(rule.category);

export default function Actions({ activeId, refreshOntologies, notify }) {
  const { items: dictionary } = useModelDictionary('action_type');
  const { detailOpen, openDetail, closeDetail } = useDetailPanel();
  const [items, setItems] = useState(null);
  const [objects, setObjects] = useState([]);
  const [rules, setRules] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [objectId, setObjectId] = useState('');
  const [resourceStatus, setResourceStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(() => businessActionForm());
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const initialForm = useRef('');
  const requestSequence = useRef(0);

  const load = async (preferredId) => {
    const sequence = ++requestSequence.current;
    setError('');
    try {
      const [actions, types, logicDefinitions] = await Promise.all([
        api(`/api/ontologies/${activeId}/actions`),
        api(`/api/ontologies/${activeId}/object-types`),
        api(`/api/ontologies/${activeId}/enterprise/logic-definitions`),
      ]);
      if (sequence !== requestSequence.current) return;
      const availableRules = (logicDefinitions || []).filter((rule) => !isFunction(rule));
      setItems([...actions].sort((a, b) => (a.external_id || 'ZZZ').localeCompare(b.external_id || 'ZZZ', 'zh-CN', { numeric: true }) || a.display_name.localeCompare(b.display_name, 'zh-CN')));
      setObjects(types);
      setRules(availableRules);
      setSelected((old) => actions.find((item) => item.id === (preferredId || old?.id)) || null);
    } catch (cause) { if (sequence === requestSequence.current) setError(cause.message); }
  };

  useEffect(() => {
    closeDetail(); setItems(null); setSelected(null); setPage(1); setQuery(''); setCategory(''); setObjectId(''); setResourceStatus(''); setEditing(null); setCreating(false); load();
    return () => { requestSequence.current += 1; };
  }, [activeId]);

  const objectName = (item) => objects.find((object) => object.id === item?.target_object_type_id)?.display_name || item?.target_display_name || '对象已失效';
  const objectBusinessId = (item) => objects.find((object) => object.id === item?.target_object_type_id)?.external_id || item?.target_object_type_id || '—';
  const ruleMap = useMemo(() => new Map(rules.map((rule) => [ruleCode(rule), rule])), [rules]);
  const objectLabel = (item) => `${objectName(item)} · ${objectBusinessId(item)}`;
  const ruleLabels = (item) => (item?.trigger_rule_codes || []).map((code) => { const rule = ruleMap.get(code); return `${rule ? ruleName(rule) : (item?.trigger_rules || []).find((name) => name === code) || code} · ${code}`; }).join('、') || (item?.trigger_rules || []).join('、');
  const filtered = useMemo(() => (items || []).filter((item) =>
    (!category || actionCategoryCode(item.action_category, dictionary) === category)
    && (!objectId || item.target_object_type_id === objectId)
    && (!resourceStatus || item.status === resourceStatus)
    && `${item.external_id || ''} ${item.display_name} ${item.name} ${objectLabel(item)} ${ruleLabels(item)}`.toLowerCase().includes(query.toLowerCase())), [items, category, objectId, resourceStatus, query, dictionary, objects, ruleMap]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { if (selected && items && !filtered.some((item) => item.id === selected.id)) { setSelected(null); closeDetail(); } }, [items, filtered, selected?.id]);
  const select = (item) => { setSelected(item); openDetail(); };
  useHistoryResourceFocus({ resourceTypes: ['action'], items, visible: filtered, pageSize, setPage, onSelect: select, ready: Boolean(items) });

  const begin = (item = null) => {
    const next = businessActionForm(item, dictionary, items || [], rules);
    initialForm.current = JSON.stringify(next);
    setForm(next); setEditing(item); setCreating(!item); setMessages([]);
  };
  const close = () => {
    if (busy) return;
    if (JSON.stringify(form) !== initialForm.current && !window.confirm('当前修改尚未保存，确定关闭？')) return;
    setEditing(null); setCreating(false);
  };
  const change = (key, value) => { setForm((old) => ({ ...old, [key]: value })); setMessages([]); };
  const changeObject = (value) => { setForm((old) => ({ ...old, target_object_type_id: value, target_role: '' })); setMessages([]); };
  const changeRules = (codes) => {
    const names = codes.map((code) => ruleName(ruleMap.get(code) || { code }));
    setForm((old) => ({ ...old, trigger_rule_codes: codes, trigger_rule_names: names })); setMessages([]);
  };
  const save = async (event) => {
    event.preventDefault();
    const errors = validateBusinessAction(form, items || [], editing);
    if (errors.length) { setMessages(errors); return; }
    setBusy(true);
    try {
      const saved = await api(editing ? `/api/actions/${editing.id}` : `/api/ontologies/${activeId}/actions`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(businessActionPayload(form, editing)) });
      setEditing(null); setCreating(false); await load(saved.id); refreshOntologies(activeId); notify('动作已保存');
    } catch (cause) { setMessages([cause.message]); } finally { setBusy(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(`删除动作“${item.display_name}”？被场景或执行映射引用的动作不能删除。`)) return;
    try { await api(`/api/actions/${item.id}`, { method: 'DELETE' }); setSelected(null); closeDetail(); await load(); refreshOntologies(activeId); notify('动作已删除'); }
    catch (cause) { notify(cause.message); }
  };
  useCreateIntent(Boolean(items) && objects.length > 0, () => begin());
  const selectedForm = selected ? businessActionForm(selected, dictionary, items || [], rules) : null;
  const categoryOptions = [...new Set([...dictionary.filter((row) => row.status).map((row) => row.code), ...(items || []).map((row) => actionCategoryCode(row.action_category, dictionary)).filter(Boolean)])];
  const selectedRuleCodes = form.trigger_rule_codes || [];
  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!items) return <Loading />;
  return <div className="page-grid action-v1">
    <div className="toolbar action-toolbar"><div className="search-box"><Search size={17} /><input aria-label="搜索动作" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索动作ID、名称、规则" /></div>
      <select aria-label="筛选动作类型" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">全部动作类型</option>{categoryOptions.map((value) => <option key={value} value={value}>{actionCategoryLabel(value, dictionary)}</option>)}</select>
      <select aria-label="筛选作用对象" value={objectId} onChange={(event) => { setObjectId(event.target.value); setPage(1); }}><option value="">全部作用对象</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.display_name}</option>)}</select>
      <select aria-label="筛选资源使用状态" value={resourceStatus} onChange={(event) => { setResourceStatus(event.target.value); setPage(1); }}><option value="">全部资源状态</option>{USAGE_STATUS_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      {(query || category || objectId || resourceStatus) && <button className="btn secondary small" onClick={() => { setQuery(''); setCategory(''); setObjectId(''); setResourceStatus(''); setPage(1); }}>清空筛选</button>}
      <div className="toolbar-note">{filtered.length} / {items.length} 个动作</div><button className="btn primary" disabled={!objects.length} onClick={() => begin()}><Plus size={17} /> 新建动作</button>
    </div>
    {!objects.length ? <EmptyState title="请先创建对象类型" description="动作需要关联当前本体的对象类型。" /> : <div className={`semantic-master-detail ${detailOpen && selected ? 'detail-open' : 'detail-collapsed'}`}>
      <section className="semantic-records action-records"><header><span>动作名称／ID</span><span>动作类型</span><span>作用对象</span><span>触发规则</span><span>资源使用状态</span><span>更新时间</span></header>
        {pageRows.map((item) => <button type="button" aria-expanded={detailOpen && selected?.id === item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => select(item)} key={item.id}>
          <span><strong>{item.display_name}</strong><small>{item.external_id || '保存后自动生成'}</small></span><span>{actionCategoryLabel(item.action_category, dictionary)}</span><span title={objectLabel(item)}>{objectLabel(item)}</span><span title={ruleLabels(item)}>{ruleLabels(item) || '—'}</span><span>{usageStatusLabel(item.status)}</span><span>{formatTime(item.updated_at)}</span>
        </button>)}
        {!filtered.length && <EmptyState title={items.length ? '没有匹配的动作' : '还没有动作'} description={items.length ? '调整筛选条件后再试。' : '新建动作并填写动作定义。'} />}
        <PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </section>
      {detailOpen && selected && <aside className="semantic-inspector" aria-label="动作详情"><header><strong>动作详情</strong><div><ResourceHistoryLink resourceType="action" resourceId={selected.id} /><button onClick={() => begin(selected)}><Pencil size={14} /> 编辑</button>{selected.status !== 'active' && <button className="danger-link" onClick={() => remove(selected)}><Trash2 size={14} /> 删除</button>}<button className="detail-close-btn" onClick={closeDetail} aria-label="关闭动作详情" title="收起详情"><X size={16} /></button></div></header>
        <div className="semantic-inspector-body"><h3>{selected.display_name}</h3>
          <DetailSection title="基础信息" entries={[[ '动作ID', selectedForm.external_id ], ['动作名称', selectedForm.display_name], ['动作类型', actionCategoryLabel(selected.action_category, dictionary)], ['作用对象', objectLabel(selected)]]} />
          <DetailSection title="触发与输入" entries={[[ '输入参数', selectedForm.input_parameters_text ], ['触发条件', selectedForm.precondition_text], ['触发规则', ruleLabels(selected)]]} />
          <DetailSection title="执行定义" entries={[[ '执行逻辑', selectedForm.execution_logic], ['对象/属性变化', selectedForm.object_effect], ['执行结果', selectedForm.result_text], ['副作用/联动', selectedForm.side_effects_text]]} />
          <DetailSection title="管理信息" entries={[[ '需审批', selected.approval_required ], ['责任人', selected.owner], ['资源使用状态', usageStatusLabel(selected.status)], ['建模状态', designStatusLabel(selected.design_status || 'draft')]]} />
          <details className="action-extra"><summary>更多记录信息</summary><DetailSection title="记录信息" entries={[[ 'API 名称', selected.name], ['创建人', actorLabel(selected.created_by)], ['创建时间', formatTime(selected.created_at)], ['修改人', actorLabel(selected.updated_by)], ['修改时间', formatTime(selected.updated_at)]]} /></details>
          {selected.status === 'active' && <p className="action-note">该动作已启用，不能直接删除。</p>}
        </div>
      </aside>}
    </div>}
    {(creating || editing) && <Modal wide closeOnBackdrop={false} title={editing ? `编辑动作 · ${editing.display_name}` : '新建动作'} onClose={close} footer={<><button className="btn secondary" disabled={busy} onClick={close}>取消</button><button form="action-form" className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button></>}>
      <form id="action-form" onSubmit={save} className="action-definition-form action-simple-form"><fieldset disabled={busy}>
        {messages.length > 0 && <div className="action-form-errors" role="alert"><strong>请检查以下内容</strong><ul>{messages.map((message) => <li key={message}>{message}</li>)}</ul></div>}
        <p className="action-required-note">带 * 为必填项；关联 ID 由系统自动保存，不需要手工填写。</p>
        <section className="action-form-group"><h3>1. 基础信息</h3><div className="form-grid two">
          <Field label="动作ID" value={editing ? form.external_id : '保存后由系统自动生成'} readOnly hint="系统生成，创建后不可修改。" />
          <Field label="动作名称" value={form.display_name} onChange={(value) => change('display_name', value)} limit={100} required placeholder="例如：发布负载预警" />
          <DictionaryField kind="action_type" label="动作类型" required value={form.action_category} onChange={(value) => change('action_category', value)} />
          <label><span>作用对象 *</span><select required value={form.target_object_type_id} onChange={(event) => changeObject(event.target.value)}><option value="">请选择对象</option>{objects.map((object) => <option value={object.id} key={object.id}>{object.display_name} · {object.external_id || object.id}</option>)}</select><small>选择后系统自动保存对象关联 ID。</small></label>
        </div></section>
        <section className="action-form-group"><h3>2. 触发与输入</h3><div className="form-grid two">
          <Field label="输入参数" value={form.input_parameters_text} onChange={(value) => change('input_parameters_text', value)} multiline placeholder="例如：设备、故障、优先级" hint="填写参数名称，用顿号或逗号分隔。" />
          <Field label="触发条件" value={form.precondition_text} onChange={(value) => change('precondition_text', value)} limit={500} multiline placeholder="例如：异常需要维护处置" hint="原“前置条件”字段。" />
          <div className="action-resource-field"><span>触发规则</span><CompactMultiSelect values={selectedRuleCodes} options={rules.map((rule) => ({ value: ruleCode(rule), label: `${ruleName(rule)} · ${ruleCode(rule)}` }))} onChange={(codes) => changeRules(codes)} hint="从当前本体规则资源中选择，可多选。" /></div>
        </div></section>
        <section className="action-form-group"><h3>3. 执行定义</h3><div className="form-grid two">
          <Field label="执行逻辑" value={form.execution_logic} onChange={(value) => change('execution_logic', value)} required multiline placeholder="例如：调用调度能力生成排班调整建议" />
          <Field label="对象/属性变化" value={form.object_effect} onChange={(value) => change('object_effect', value)} limit={255} multiline placeholder="例如：预警事件状态→已发布" />
          <Field label="执行结果" value={form.result_text} onChange={(value) => change('result_text', value)} limit={255} placeholder="例如：预警通知" />
          <Field label="副作用/联动" value={form.side_effects_text} onChange={(value) => change('side_effects_text', value)} limit={255} placeholder="例如：通知调度、审计" />
        </div></section>
        <section className="action-form-group"><h3>4. 管理信息</h3><div className="form-grid two">
          <label><span>需审批 *</span><select required value={form.approval_required ? 'yes' : 'no'} onChange={(event) => change('approval_required', event.target.value === 'yes')}><option value="no">否</option><option value="yes">是</option></select></label>
          <Field label="责任人" value={form.owner} onChange={(value) => change('owner', value)} limit={50} required placeholder="填写业务负责人" />
          <label><span>资源使用状态 *</span><select required value={form.status} onChange={(event) => change('status', event.target.value)}>{USAGE_STATUS_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><small>资源生命周期状态，与建模状态分开管理。</small></label>
        </div></section>
      </fieldset></form>
    </Modal>}
  </div>;
}
