import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { api, formatTime } from '../api';
import { designStatusLabel, actorLabel, designStatusValue } from '../labels';
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

function Field({ label, value, onChange, multiline = false, limit, required = false, placeholder = '', disabled = false, hint }) {
  const Tag = multiline ? 'textarea' : 'input';
  return <label><span>{label}{required && ' *'}</span><Tag value={value ?? ''} onChange={(event) => onChange(event.target.value)} required={required} maxLength={limit} placeholder={placeholder} disabled={disabled} rows={multiline ? 2 : undefined} />{hint && <small>{hint}</small>}</label>;
}
function DetailSection({ title, entries }) {
  return <section className="action-detail-section"><h4>{title}</h4><dl>{entries.map(([title, value]) => <div key={title}><dt>{title}</dt><dd>{value === false ? '否' : value === true ? '是' : value || '—'}</dd></div>)}</dl></section>;
}
const inputText = (item) => item.input_parameters_text ?? item.template_raw?.输入参数 ?? (item.parameters || []).map((param) => param.name).join('、');

export default function Actions({ activeId, refreshOntologies, notify }) {
  const { items: dictionary } = useModelDictionary('action_type');
  const { detailOpen, openDetail, closeDetail } = useDetailPanel();
  const [items, setItems] = useState(null);
  const [objects, setObjects] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [objectId, setObjectId] = useState('');
  const [status, setStatus] = useState('');
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
      const [actions, types] = await Promise.all([api(`/api/ontologies/${activeId}/actions`), api(`/api/ontologies/${activeId}/object-types`)]);
      if (sequence !== requestSequence.current) return;
      setItems([...actions].sort((a, b) => (a.external_id || 'ZZZ').localeCompare(b.external_id || 'ZZZ', 'zh-CN', { numeric: true }) || a.display_name.localeCompare(b.display_name, 'zh-CN'))); setObjects(types);
      setSelected((old) => actions.find((item) => item.id === (preferredId || old?.id)) || null);
    } catch (cause) { if (sequence === requestSequence.current) setError(cause.message); }
  };
  useEffect(() => {
    closeDetail(); setItems(null); setSelected(null); setPage(1); setQuery(''); setCategory(''); setObjectId(''); setStatus(''); setEditing(null); setCreating(false); load();
    return () => { requestSequence.current += 1; };
  }, [activeId]);
  const objectName = (item) => objects.find((object) => object.id === item.target_object_type_id)?.display_name || item.target_display_name || '对象已失效';
  const roleName = (item) => item.target_role || item.template_raw?.作用对象 || objectName(item);
  const filtered = useMemo(() => (items || []).filter((item) =>
    (!category || actionCategoryCode(item.action_category, dictionary) === category)
    && (!objectId || item.target_object_type_id === objectId)
    && (!status || designStatusValue(item.design_status) === status)
    && `${item.external_id || ''} ${item.display_name} ${item.name}`.toLowerCase().includes(query.toLowerCase())), [items, category, objectId, status, query, dictionary]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { if (selected && items && !filtered.some((item) => item.id === selected.id)) { setSelected(null); closeDetail(); } }, [items, filtered, selected?.id]);
  const select = (item) => { setSelected(item); openDetail(); };
  useHistoryResourceFocus({ resourceTypes: ['action'], items, visible: filtered, pageSize, setPage, onSelect: select, ready: Boolean(items) });
  const begin = (item = null) => {
    const next = businessActionForm(item, dictionary, items || []);
    if (item && !next.target_role) next.target_role = objectName(item);
    initialForm.current = JSON.stringify(next);
    setForm(next); setEditing(item); setCreating(!item); setMessages([]);
  };
  const openCreate = () => begin();
  const close = () => {
    if (busy) return;
    if (JSON.stringify(form) !== initialForm.current && !window.confirm('当前修改尚未保存，确定关闭？')) return;
    setEditing(null); setCreating(false);
  };
  const change = (key, value) => { setForm((old) => ({ ...old, [key]: value })); setMessages([]); };
  const changeObject = (value) => {
    const [target_object_type_id, target_role] = value ? JSON.parse(value) : ['', ''];
    setForm((old) => ({ ...old, target_object_type_id, target_role })); setMessages([]);
  };
  const targetOptions = objects.flatMap((object) => {
    const roles = new Set([object.display_name, ...(items || []).filter((item) => item.target_object_type_id === object.id).map(roleName)]);
    if (form.target_object_type_id === object.id && form.target_role) roles.add(form.target_role);
    return [...roles].map((role) => ({ value: JSON.stringify([object.id, role]), label: role === object.display_name ? role : `${role}（${object.display_name}）` }));
  });
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
  const selectedForm = selected ? businessActionForm(selected, dictionary) : null;
  const categoryOptions = [...new Set([...dictionary.filter((row) => row.status).map((row) => row.code), ...(items || []).map((row) => actionCategoryCode(row.action_category, dictionary)).filter(Boolean)])];
  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!items) return <Loading />;
  return <div className="page-grid action-v1">
    <div className="toolbar action-toolbar"><div className="search-box"><Search size={17} /><input aria-label="搜索动作" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索行动ID、名称" /></div>
      <select aria-label="筛选行动类型" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">全部行动类型</option>{categoryOptions.map((value) => <option key={value} value={value}>{actionCategoryLabel(value, dictionary)}</option>)}</select>
      <select aria-label="筛选作用对象" value={objectId} onChange={(event) => { setObjectId(event.target.value); setPage(1); }}><option value="">全部作用对象</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.display_name}</option>)}</select>
      <select aria-label="筛选建模状态" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option><option value="draft">设计中</option><option value="validated">已确认</option></select>
      {(query || category || objectId || status) && <button className="btn secondary small" onClick={() => { setQuery(''); setCategory(''); setObjectId(''); setStatus(''); setPage(1); }}>清空筛选</button>}
      <div className="toolbar-note">{filtered.length} / {items.length} 个动作</div><button className="btn primary" disabled={!objects.length} onClick={openCreate}><Plus size={17} /> 新建动作</button>
    </div>
    {!objects.length ? <EmptyState title="请先创建对象类型" description="动作需要关联当前本体的对象类型。" /> : <div className={`semantic-master-detail ${detailOpen && selected ? 'detail-open' : 'detail-collapsed'}`}>
      <section className="semantic-records action-records"><header><span>行动名称／ID</span><span>行动类型</span><span>作用对象</span><span>输入参数</span><span>需审批</span><span>状态</span><span>更新时间</span></header>
        {pageRows.map((item) => <button type="button" aria-expanded={detailOpen && selected?.id === item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => select(item)} key={item.id}>
          <span><strong>{item.display_name}</strong><small>{item.external_id || '未设置编号'}</small></span><span>{actionCategoryLabel(item.action_category, dictionary)}</span><span title={roleName(item)}>{roleName(item)}</span><span title={inputText(item)}>{inputText(item) || '—'}</span><span>{item.approval_required ? '是' : '否'}</span><span>{designStatusLabel(item.design_status || 'draft')}</span><span>{formatTime(item.updated_at)}</span>
        </button>)}
        {!filtered.length && <EmptyState title={items.length ? '没有匹配的动作' : '还没有动作'} description={items.length ? '调整筛选条件后再试。' : '新建动作并填写业务操作说明。'} />}
        <PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </section>
      {detailOpen && selected && <aside className="semantic-inspector" aria-label="动作详情"><header><strong>动作详情</strong><div><ResourceHistoryLink resourceType="action" resourceId={selected.id} /><button onClick={() => begin(selected)}><Pencil size={14} /> 编辑</button>{selected.status !== 'active' && <button className="danger-link" onClick={() => remove(selected)}><Trash2 size={14} /> 删除</button>}<button className="detail-close-btn" onClick={closeDetail} aria-label="关闭动作详情" title="收起详情"><X size={16} /></button></div></header>
        <div className="semantic-inspector-body"><h3>{selected.display_name}</h3>
          <DetailSection title="基础信息" entries={[[ '行动ID', selectedForm.external_id ], ['行动类型', actionCategoryLabel(selected.action_category, dictionary)], ['作用对象', roleName(selected)]]} />
          <DetailSection title="操作说明" entries={[[ '输入参数', selectedForm.input_parameters_text ], ['前置条件', selectedForm.precondition_text], ['执行逻辑', selectedForm.execution_logic], ['对象/属性变化', selectedForm.object_effect], ['执行结果', selectedForm.result_text], ['副作用/联动', selectedForm.side_effects_text]]} />
          <DetailSection title="审批与维护" entries={[[ '需审批', selected.approval_required ], ['责任人', selected.owner], ['状态', designStatusLabel(selected.design_status || 'draft')]]} />
          <details className="action-extra"><summary>更多记录信息</summary><DetailSection title="记录信息" entries={[[ '关联对象类型', objectName(selected) ], ['API 名称', selected.name], ['创建人', actorLabel(selected.created_by)], ['创建时间', formatTime(selected.created_at)], ['修改人', actorLabel(selected.updated_by)], ['修改时间', formatTime(selected.updated_at)]]} /></details>
          {selected.status === 'active' && <p className="action-note">该动作已启用，不能直接删除。</p>}
        </div>
      </aside>}
    </div>}
    {(creating || editing) && <Modal wide closeOnBackdrop={false} title={editing ? `编辑动作 · ${editing.display_name}` : '新建动作'} onClose={close} footer={<><button className="btn secondary" disabled={busy} onClick={close}>取消</button><button form="action-form" className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button></>}>
      <form id="action-form" onSubmit={save} className="action-definition-form action-simple-form"><fieldset disabled={busy}>
        {messages.length > 0 && <div className="action-form-errors" role="alert"><strong>请检查以下内容</strong><ul>{messages.map((message) => <li key={message}>{message}</li>)}</ul></div>}
        <p className="action-required-note">带 * 为必填项，其余可选填。</p>
        <section className="action-form-group"><h3>1. 基础信息</h3><div className="form-grid two">
          <Field label="行动ID" value={form.external_id} onChange={(value) => change('external_id', value)} limit={80} required disabled={Boolean(editing?.external_id)} hint="自动生成，创建时可调整；保存后不可修改。" />
          <Field label="行动名称" value={form.display_name} onChange={(value) => change('display_name', value)} limit={100} required placeholder="例如：暂停运输任务" />
          <DictionaryField kind="action_type" label="行动类型 *" required value={form.action_category} onChange={(value) => change('action_category', value)} />
          <label><span>作用对象 *</span><select required value={form.target_object_type_id ? JSON.stringify([form.target_object_type_id, form.target_role || objectName(form)]) : ''} onChange={(event) => changeObject(event.target.value)}><option value="">请选择对象</option>{targetOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        </div></section>
        <section className="action-form-group"><h3>2. 操作定义</h3><div className="form-grid two">
          <Field label="输入参数" value={form.input_parameters_text} onChange={(value) => change('input_parameters_text', value)} multiline placeholder="任务编号、原因" hint="选填；填写参数名称，用顿号或逗号分隔。" />
          <Field label="前置条件" value={form.precondition_text} onChange={(value) => change('precondition_text', value)} limit={500} multiline placeholder="任务执行中且满足暂停条件" />
          <Field label="执行逻辑" value={form.execution_logic} onChange={(value) => change('execution_logic', value)} required multiline placeholder="例如：调用调度能力暂停任务" />
          <Field label="对象/属性变化" value={form.object_effect} onChange={(value) => change('object_effect', value)} limit={255} multiline placeholder="任务状态→暂停" />
          <Field label="执行结果" value={form.result_text} onChange={(value) => change('result_text', value)} limit={255} placeholder="成功/失败，或返回工单编号" />
          <Field label="副作用/联动" value={form.side_effects_text} onChange={(value) => change('side_effects_text', value)} limit={255} placeholder="通知调度、审计" />
        </div></section>
        <section className="action-form-group"><h3>3. 审批与维护</h3><div className="form-grid two">
          <label><span>需审批 *</span><select required value={form.approval_required ? 'yes' : 'no'} onChange={(event) => change('approval_required', event.target.value === 'yes')}><option value="no">否</option><option value="yes">是</option></select></label>
          <Field label="责任人" value={form.owner} onChange={(value) => change('owner', value)} limit={50} required placeholder="填写业务负责人" />
          <label><span>状态 *</span><select required value={form.design_status} onChange={(event) => change('design_status', event.target.value)}><option value="draft">设计中</option><option value="validated">已确认</option></select></label>
        </div></section>
      </fieldset></form>
    </Modal>}
  </div>;
}
