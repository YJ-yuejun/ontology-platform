import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import { designStatusLabel } from '../labels';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import useCreateIntent from '../hooks/useCreateIntent';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import { useModelingEntry } from '../components/ModelingEntry';
import { DictionaryField, useModelDictionary } from '../components/DictionaryManager';

const FIELDS = ['行动ID', '行动名称', '行动类型', '作用对象', '输入参数', '前置条件', '执行逻辑', '对象/属性变化', '执行结果', '副作用/联动', '需审批', '责任人', '状态'];
const emptyForm = () => Object.fromEntries(FIELDS.map((field) => [field, field === '需审批' ? '否' : field === '状态' ? '设计中' : '']));
const ACTION_STATUSES = ['设计中', '已确认'];
const splitParameters = (value) => String(value || '').split(/[、,，；;\n]/).map((part) => part.trim()).filter(Boolean);
const original = (item, field) => item?.template_raw?.[field];
const detail = (item) => ({
  行动ID: item.external_id || original(item, '行动ID') || '',
  行动名称: item.display_name || '',
  行动类型: item.action_category || original(item, '行动类型') || '',
  作用对象: item.target_role ?? original(item, '作用对象') ?? item.target_display_name ?? '',
  输入参数: item.input_parameters_text ?? original(item, '输入参数') ?? (item.parameters || []).map((param) => param.name).join('、'),
  前置条件: item.precondition_text ?? original(item, '前置条件') ?? (item.preconditions || []).map((condition) => condition.expression).join('；'),
  执行逻辑: item.execution_logic ?? original(item, '执行逻辑') ?? item.description ?? '',
  '对象/属性变化': item.object_effect ?? original(item, '对象/属性变化') ?? '',
  执行结果: item.result_text ?? original(item, '执行结果') ?? item.result_schema?.result ?? '',
  '副作用/联动': item.side_effects_text ?? original(item, '副作用/联动') ?? (item.side_effects || []).join('、'),
  需审批: item.approval_required ? '是' : '否',
  责任人: item.owner || original(item, '责任人') || '',
  状态: item.design_status ? designStatusLabel(item.design_status) : original(item, '状态') || '设计中',
});

export default function Actions({ activeId, refreshOntologies, notify }) {
  const { requestResource } = useModelingEntry();
  const { items: actionTypeItems } = useModelDictionary('action_type');
  const [items, setItems] = useState(null);
  const [objects, setObjects] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('全部');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

  const load = async (preferredId) => {
    setError('');
    try {
      const [actions, types] = await Promise.all([api(`/api/ontologies/${activeId}/actions`), api(`/api/ontologies/${activeId}/object-types`)]);
      setItems(actions); setObjects(types);
      setSelected((old) => actions.find((item) => item.id === (preferredId || old?.id)) || actions[0] || null);
    } catch (cause) { setError(cause.message); }
  };
  useEffect(() => { setItems(null); setSelected(null); setPage(1); load(); }, [activeId]);
  const filtered = useMemo(() => (items || []).filter((item) => {
    const row = detail(item);
    return (type === '全部' || row['行动类型'] === type)
      && `${row['行动ID']} ${row['行动名称']} ${row['行动类型']} ${row['作用对象']}`.toLowerCase().includes(query.toLowerCase());
  }), [items, query, type]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { if (items && !filtered.some((item) => item.id === selected?.id)) setSelected(filtered[0] || null); }, [items, filtered, selected?.id]);
  useHistoryResourceFocus({ resourceTypes: ['action'], items, visible: filtered, pageSize, setPage, onSelect: setSelected, ready: Boolean(items) });
  const openManualCreate = () => { setForm(emptyForm()); setEditing(null); setCreating(true); };
  const openCreate = () => requestResource({ type: 'action', objectCount: objects.length, onManual: openManualCreate });
  const openEdit = (item) => { setForm(detail(item)); setEditing(item); setCreating(false); };
  const close = () => { setEditing(null); setCreating(false); };
  const change = (field) => (event) => setForm((old) => ({ ...old, [field]: event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    const code = form['行动ID'].trim();
    const role = form['作用对象'].trim();
    if (items.some((item) => item.id !== editing?.id && detail(item)['行动ID'] === code)) { notify('行动ID已存在'); return; }
    const matchingObject = objects.find((object) => object.display_name === role || object.name === role)
      || objects.find((object) => role.split(/[/／、,，]/).some((part) => part.trim() === object.display_name || part.trim() === object.name));
    const targetId = role === (editing ? detail(editing)['作用对象'] : '') ? editing?.target_object_type_id : matchingObject?.id;
    if (!targetId) { notify('作用对象尚未建立对象类型，请先建对象类型；已有模板中的原始作用对象可保留。'); return; }
    const parts = splitParameters(form['输入参数']);
    const existing = editing?.parameters || [];
    const parameters = parts.map((name, index) => ({
      ...(existing[index]?.name === name ? existing[index] : {}),
      key: existing[index]?.name === name ? existing[index].key : `param${index + 1}`,
      name, type: existing[index]?.name === name ? existing[index].type : 'string',
    }));
    const condition = form['前置条件'].trim();
    const previousCondition = editing?.preconditions?.[0];
    const preconditions = condition ? [previousCondition?.expression === condition ? previousCondition : { expression: condition, message: '行动前置条件未满足' }] : [];
    const payload = {
      ...(editing || {}),
      name: editing?.name || `action_${code.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
      external_id: code, display_name: form['行动名称'].trim(), action_category: form['行动类型'].trim(),
      target_object_type_id: targetId, target_role: role,
      action_type: editing?.action_type || 'invoke',
      status: editing?.status || 'experimental', design_status: form['状态'],
      input_parameters_text: form['输入参数'].trim(), parameters,
      precondition_text: condition, preconditions,
      execution_logic: form['执行逻辑'].trim(), description: form['执行逻辑'].trim(), object_effect: form['对象/属性变化'].trim(),
      result_text: form['执行结果'].trim(), result_schema: { ...(editing?.result_schema || {}), result: form['执行结果'].trim() },
      side_effects_text: form['副作用/联动'].trim(), side_effects: splitParameters(form['副作用/联动']),
      approval_required: form['需审批'] === '是', owner: form['责任人'].trim(),
    };
    setBusy(true);
    try {
      const saved = await api(editing ? `/api/actions/${editing.id}` : `/api/ontologies/${activeId}/actions`, {
        method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      close(); await load(saved.id); refreshOntologies(activeId);
    } catch (cause) { notify(cause.message); } finally { setBusy(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(`删除行动“${item.display_name}”？`)) return;
    try { await api(`/api/actions/${item.id}`, { method: 'DELETE' }); setSelected(null); await load(); refreshOntologies(activeId); }
    catch (cause) { notify(cause.message); }
  };
  useCreateIntent(Boolean(items) && objects.length > 0, openManualCreate);

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!items) return <Loading />;
  return <div className="page-grid action-v2">
    <div className="toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索行动ID、名称、类型或作用对象" /></div><select aria-label="筛选行动类型" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option>全部</option>{[...new Set([...actionTypeItems.filter((item) => item.status).map((item) => item.name), ...(items || []).map((item) => detail(item)['行动类型']).filter(Boolean)])].map((category) => <option key={category}>{category}</option>)}</select><div className="toolbar-note">共 {filtered.length} 个行动</div><button className="btn primary" onClick={openCreate}><Plus size={17} /> 新建行动</button></div>
    {!objects.length ? <EmptyState title="请先创建对象类型" description="作用对象需要对应已建对象类型。" /> : <div className="semantic-master-detail">
      <section className="semantic-records action-records">
        <header><span>行动名称／ID</span><span>行动类型</span><span>作用对象</span><span>输入参数</span><span>前置条件</span><span>需审批</span><span>状态</span></header>
        {pageRows.map((item) => { const row = detail(item); return <button type="button" className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item)} key={item.id}>
          <span><strong>{row['行动名称']}</strong><small>{row['行动ID']}</small></span>
          <span>{row['行动类型']}</span><span title={row['作用对象']}>{row['作用对象']}</span><span title={row['输入参数']}>{row['输入参数'] || '—'}</span><span title={row['前置条件']}>{row['前置条件'] || '—'}</span><span>{row['需审批']}</span><span>{row['状态']}</span>
        </button>; })}
        {!filtered.length && <EmptyState title={query ? '没有匹配的行动' : '还没有行动'} description={query ? '换一个关键词试试。' : '从新建行动开始。'} />}
        <PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </section>
      <aside className="semantic-inspector"><header><strong>行动详情</strong>{selected && <div><ResourceHistoryLink resourceType="action" resourceId={selected.id} /><button onClick={() => openEdit(selected)}><Pencil size={14} /> 编辑</button>{selected.status !== 'active' && <button className="danger-link" onClick={() => remove(selected)}><Trash2 size={14} /> 删除</button>}</div>}</header>{selected ? <div className="semantic-inspector-body"><h3>{selected.display_name}</h3><dl>{FIELDS.map((field) => <div key={field}><dt>{field}</dt><dd>{detail(selected)[field] || '—'}</dd></div>)}</dl></div> : <EmptyState title="请选择行动" description="从左侧选择一条行动查看详情。" />}</aside>
    </div>}
    {(creating || editing) && <Modal wide title={editing ? `编辑行动 · ${editing.display_name}` : '新建行动'} onClose={close} footer={<><button className="btn secondary" onClick={close}>取消</button><button form="action-form" className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存到工作状态'}</button></>}><form id="action-form" onSubmit={save} className="form-sections action-form-v2">
      <section className="form-section"><h3>1. 基础信息</h3><div className="form-grid two">
        <label><span>行动ID</span><input required disabled={Boolean(editing)} value={form['行动ID']} onChange={change('行动ID')} placeholder="A-001" /><small>稳定引用编号，创建后不可修改。</small></label>
        <label><span>行动名称</span><input required value={form['行动名称']} onChange={change('行动名称')} placeholder="暂停运输任务" /></label>
        {/* 行动类型沿用模板口径按显示名存储（业务行动/控制行动/通知行动），
            与 system_type 等一起待后续统一收敛为 code。 */}
        <DictionaryField kind="action_type" label="行动类型" required value={form['行动类型']} valueMode="name" onChange={(value) => setForm((old) => ({ ...old, 行动类型: value }))} />
        <label><span>作用对象</span><input required list="action-object-options" value={form['作用对象']} onChange={change('作用对象')} placeholder="选择或填写作用对象" /><datalist id="action-object-options">{objects.map((object) => <option value={object.display_name} key={object.id} />)}</datalist></label>
      </div></section>
      <section className="form-section"><h3>2. 输入与执行逻辑</h3><div className="form-grid two">
        <label><span>输入参数</span><textarea value={form['输入参数']} onChange={change('输入参数')} placeholder="任务编号、原因" /></label>
        <label><span>前置条件</span><textarea value={form['前置条件']} onChange={change('前置条件')} placeholder="任务执行中且满足暂停条件" /></label>
        <label><span>执行逻辑</span><textarea value={form['执行逻辑']} onChange={change('执行逻辑')} placeholder="调用调度能力暂停任务" /></label>
        <label><span>对象/属性变化</span><textarea value={form['对象/属性变化']} onChange={change('对象/属性变化')} placeholder="任务状态→暂停" /></label>
        <label><span>执行结果</span><input value={form['执行结果']} onChange={change('执行结果')} placeholder="成功/失败" /></label>
        <label><span>副作用/联动</span><textarea value={form['副作用/联动']} onChange={change('副作用/联动')} placeholder="通知调度、审计" /></label>
      </div></section>
      <section className="form-section"><h3>3. 审批与维护</h3><div className="form-grid two">
        <label><span>需审批</span><select value={form['需审批']} onChange={change('需审批')}><option>否</option><option>是</option></select></label>
        <label><span>责任人</span><input value={form['责任人']} onChange={change('责任人')} placeholder="示例负责人" /></label>
        <label><span>状态</span><select value={form['状态']} onChange={change('状态')}>{ACTION_STATUSES.map((status) => <option key={status}>{status}</option>)}{form['状态'] && !ACTION_STATUSES.includes(form['状态']) && <option>{form['状态']}</option>}</select></label>
      </div></section>
    </form></Modal>}
  </div>;
}
