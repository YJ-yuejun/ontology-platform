import { Fragment, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, HelpCircle, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { designStatusLabel, statusLabel } from '../labels';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import useCreateIntent from '../hooks/useCreateIntent';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import { useModelingEntry } from '../components/ModelingEntry';
import useDetailPanel from '../hooks/useDetailPanel';

const baseForm = () => ({ code: '', type: '规则', name: '', applicable_objects: [], input_objects: [],
  input_properties: [], input_data_description: '', input_property_notes: '', logic: '', output: '', trigger_mode: '调用',
  realtime_requirement: '按需', reusable: true, owner: '', design_status: '设计中', version: '' });
const splitNames = (value) => String(value || '').split(/[、/,，；;\n]/).map((part) => part.trim()).filter(Boolean);
const splitNotes = (value) => String(value || '').split(/[、,，；;\n]/).map((part) => part.trim()).filter(Boolean);
const ruleStatus = (item) => item.design_status ? designStatusLabel(item.design_status)
  : item.template_raw?.['状态'] || (item.status === 'draft' ? '设计中' : statusLabel(item.status));
const ruleVersion = (item) => item.version || item.template_version || '未填写';
const getObjectName = (objects, apiName) => objects.find((item) => item.name === apiName)?.display_name || apiName;
const inputDataLabel = (item, objects) => [...new Set([
  ...(item.input_objects || []).map((name) => getObjectName(objects, name)),
  ...splitNotes(item.input_data_description),
])].join('、');
const propertyLabel = (value, objects) => {
  const [objectName, propertyKey] = String(value).split('.');
  const object = objects.find((item) => item.name === objectName);
  const property = (object?.effective_properties || object?.properties || []).find((item) => item.key === propertyKey);
  return object && property ? `${object.display_name} · ${property.name}` : value;
};

function SearchableMultiSelect({ label, options, values, onChange, hint, placeholder, grouped = false, helpText = '', notes = [], onChangeNotes }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(40);
  const [showAll, setShowAll] = useState(false);
  const selectedOptions = values.map((value) => options.find((option) => option.value === value) || { value, label: value });
  const matched = useMemo(() => options.filter((option) => `${option.label} ${option.group || ''} ${option.meta || ''} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase())), [options, query]);
  const visible = matched.slice(0, limit);
  const selectedTags = [
    ...selectedOptions.map((option) => ({ key: `ref:${option.value}`, label: option.selectedLabel || option.label, remove: () => toggle(option.value) })),
    ...notes.map((note) => ({ key: `text:${note}`, label: note, isText: true, remove: () => onChangeNotes(notes.filter((item) => item !== note)) })),
  ];
  const toggle = (value) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const exactOption = options.find((option) => [option.value, option.label, option.selectedLabel].some((value) => value?.toLowerCase() === query.trim().toLowerCase()));
  const addQuery = () => {
    const value = query.trim();
    if (!value) return;
    if (exactOption) {
      if (!values.includes(exactOption.value)) onChange([...values, exactOption.value]);
    } else if (onChangeNotes) {
      onChangeNotes([...new Set([...notes, ...splitNotes(value)])]);
    }
    setQuery('');
  };
  return <div className="logic-multi-field"><div className="logic-multi-label"><strong>{label}</strong><span>已选 {selectedTags.length} 项</span></div>
    <div className="logic-multi-selection">{selectedTags.length ? <div className="logic-selected-tags">{selectedTags.slice(0, showAll ? undefined : 8).map((item) => <button type="button" key={item.key} className={item.isText ? 'logic-note-chip' : ''} title={`移除 ${item.label}`} onClick={item.remove}>{item.label}<X size={13} /></button>)}{selectedTags.length > 8 && <button type="button" className="logic-show-all" onClick={() => setShowAll(!showAll)}>{showAll ? '收起' : `另有 ${selectedTags.length - 8} 项 · 展开`}</button>}</div> : <span className="logic-empty-choice">{hint}</span>}<button type="button" className="logic-picker-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起' : '搜索添加'} <ChevronDown size={14} /></button></div>
    {helpText && <p className="logic-multi-help">{helpText}</p>}
    {open && <div className="logic-picker"><label className="logic-picker-search"><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(40); }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'Enter') { event.preventDefault(); addQuery(); } }} placeholder={placeholder} autoFocus /></label><div className="logic-picker-options">{query.trim() && onChangeNotes && !exactOption && <button type="button" className="logic-add-text" onClick={addQuery}>保留文字“{query.trim()}”</button>}{visible.map((option, index) => <Fragment key={option.value}>{grouped && option.group !== visible[index - 1]?.group && <div className="logic-picker-group">{option.group}</div>}<button type="button" className={values.includes(option.value) ? 'selected' : ''} onClick={() => toggle(option.value)}><span className="logic-picker-check">{values.includes(option.value) && <Check size={13} />}</span><span><strong>{option.label}</strong>{option.meta && <small>{option.meta}</small>}</span></button></Fragment>)}{!matched.length && <p>{onChangeNotes ? '没有匹配的已建资源；可将搜索内容保留为文字。' : options.length ? '没有匹配项，请换个关键词。' : '暂无可选项，请先建立对应对象。'}</p>}</div><footer><span>显示 {visible.length} / {matched.length} 项</span>{matched.length > limit && <button type="button" onClick={() => setLimit(limit + 40)}>加载更多</button>}</footer></div>}
  </div>;
}

function normalize(item, objects) {
  const form = baseForm();
  const byLabel = (text) => objects.filter((object) => splitNames(text).some((part) => part === object.name || part === object.display_name)).map((object) => object.name);
  const applicable = item.applicable_objects || byLabel(item.template_raw?.['适用对象']) || [];
  const inputObjects = item.input_objects || byLabel(item.input_object_data || item.template_raw?.['输入对象/数据']) || [];
  const inputProperties = item.input_properties || [];
  const resolvedInputObjects = [...new Set([...inputObjects, ...inputProperties.map((field) => field.split('.')[0])])];
  const inputText = item.input_data_description || item.input_object_data || item.template_raw?.['输入对象/数据'] || '';
  const inputNotes = splitNotes(inputText).filter((part) => !resolvedInputObjects.some((name) => part === name || part === getObjectName(objects, name))).join('、');
  return { ...form, code: item.code,
    type: item.category === '函数' || item.category === 'function' ? '函数' : '规则', name: item.name,
    applicable_objects: applicable.length ? applicable : item.target_object_type ? [item.target_object_type] : [],
    input_objects: resolvedInputObjects,
    input_properties: inputProperties,
    input_data_description: inputNotes,
    input_property_notes: item.input_fields_display || (item.input_properties?.length ? '' : item.template_raw?.['输入属性'] || ''),
    logic: item.logic || item.description || '', output: item.output || item.template_raw?.['输出'] || '',
    trigger_mode: item.trigger_mode_display || item.trigger_mode || '调用',
    realtime_requirement: item.realtime_requirement || '按需', reusable: item.reusable !== false,
    owner: item.owner || '',
    design_status: ['设计中', '已确认'].includes(designStatusLabel(item.design_status))
      ? designStatusLabel(item.design_status) : item.template_raw?.['状态'] || '设计中',
    version: item.version || item.template_version || item.template_raw?.['版本'] || '' };
}

export default function BusinessRules({ activeId, notify }) {
  const { requestResource } = useModelingEntry();
  const [items, setItems] = useState(null);
  const [objects, setObjects] = useState([]);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState(null);
  const { detailOpen, openDetail, closeDetail } = useDetailPanel();
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(baseForm());
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [logic, types] = await Promise.all([
        api(`/api/ontologies/${activeId}/enterprise/logic-definitions`),
        api(`/api/ontologies/${activeId}/object-types`),
      ]);
      setItems(logic); setObjects(types);
      setSelected((old) => logic.find((item) => item.id === old?.id) || null);
    } catch (cause) { setError(cause.message); }
  };
  useEffect(() => { setItems(null); setSelected(null); load(); }, [activeId]);
  const visible = useMemo(() => (items || []).filter((item) => {
    const logicType = item.category === '函数' || item.category === 'function' ? '函数' : '规则';
    const objectText = (item.applicable_objects || []).map((name) => getObjectName(objects, name)).join(' ');
    const normalized = normalize(item, objects);
    const searchText = [item.code, item.name, item.description, item.logic, item.output,
      item.owner, objectText, item.template_raw?.['适用对象'], item.template_raw?.['输入对象/数据'],
      item.template_raw?.['输入属性'], item.input_object_data, item.input_fields_display,
      item.trigger_mode_display, inputDataLabel(normalized, objects), normalized.input_property_notes,
      normalized.input_properties.map((value) => propertyLabel(value, objects)).join(' ')].filter(Boolean).join(' ');
    return (type === 'all' || type === logicType) && (statusFilter === 'all' || statusFilter === ruleStatus(item))
      && searchText.toLowerCase().includes(query.trim().toLowerCase());
  }), [items, objects, type, statusFilter, query]);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = useMemo(() => visible.slice((currentPage - 1) * pageSize, currentPage * pageSize), [visible, currentPage, pageSize]);
  useEffect(() => { if (items && selected && !pageRows.some((item) => item.id === selected?.id)) setSelected(null); }, [items, pageRows, selected?.id]);
  useHistoryResourceFocus({ resourceTypes: ['business_rule', 'logic_definition', '规则'], items, visible, pageSize, setPage, onSelect: (item) => { setSelected(item); openDetail(); }, ready: Boolean(items) });
  const objectName = (apiName) => getObjectName(objects, apiName);
  const objectOptions = useMemo(() => objects.map((object) => ({ value: object.name, label: object.display_name,
    meta: [object.business_domain_name, object.subject_domain_name].filter(Boolean).join(' / ') || object.name })), [objects]);
  const propertyOptions = useMemo(() => {
    const preferred = new Set([...form.input_objects, ...form.applicable_objects]);
    return [...objects].sort((left, right) => Number(preferred.has(right.name)) - Number(preferred.has(left.name))
      || left.display_name.localeCompare(right.display_name, 'zh-CN')).flatMap((object) =>
      (object.effective_properties || object.properties || []).map((property) => ({
        value: `${object.name}.${property.key}`, label: property.name,
        selectedLabel: `${object.display_name} · ${property.name}`, group: object.display_name,
        meta: `${property.key} · ${object.name}`,
      })));
  }, [objects, form.input_objects, form.applicable_objects]);
  const updateInputObjects = (inputObjects) => {
    const removed = form.input_objects.filter((name) => !inputObjects.includes(name));
    const dependentProperties = form.input_properties.filter((field) => removed.some((name) => field.startsWith(`${name}.`)));
    if (dependentProperties.length && !window.confirm(`移除输入对象会同时移除 ${dependentProperties.length} 个已选输入属性：${dependentProperties.map((field) => propertyLabel(field, objects)).join('、')}。确定继续吗？`)) return;
    setForm((old) => ({ ...old, input_objects: inputObjects,
      input_properties: old.input_properties.filter((field) => !removed.some((name) => field.startsWith(`${name}.`))) }));
  };
  const updateInputProperties = (inputProperties) => setForm((old) => ({ ...old,
    input_properties: inputProperties,
    input_objects: [...new Set([...old.input_objects, ...inputProperties.map((field) => field.split('.')[0])])],
  }));
  const nextCode = (kind) => {
    const prefix = kind === '函数' ? 'F' : 'R';
    const max = Math.max(0, ...(items || []).map((item) => Number(new RegExp(`^${prefix}-(\\d+)$`).exec(item.code)?.[1]) || 0));
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  };
  const openManualCreate = () => { setEditing({ create: true }); setForm({ ...baseForm(), code: nextCode('规则') }); };
  const openCreate = () => requestResource({ type: 'business_rule', onManual: openManualCreate });
  const openEdit = (item) => { setEditing(item); setForm(normalize(item, objects)); };
  const save = async (event) => {
    event.preventDefault();
    if (!form.applicable_objects.length) { notify('请至少选择一个适用对象'); return; }
    if (!form.version.trim()) { notify('请填写模板版本，例如 V1.0'); return; }
    setBusy(true);
    const preserved = {};
    if (!editing.create) ['template_external_id', 'template_sheet', 'template_row', 'template_raw', 'test_case'].forEach((key) => {
      if (editing[key] !== undefined) preserved[key] = editing[key];
    });
    const payload = { ...preserved, authoring_version: 2, logic_type: form.type,
      applicable_objects: form.applicable_objects, input_objects: form.input_objects,
      input_properties: form.input_properties,
      input_data_description: [...new Set([...form.input_objects.map(objectName), ...splitNotes(form.input_data_description)])].join('、'),
      input_fields_display: form.input_property_notes,
      logic: form.logic, output: form.output, trigger_mode_display: form.trigger_mode,
      realtime_requirement: form.realtime_requirement, reusable: form.reusable, owner: form.owner,
      design_status: form.design_status, version: form.version.trim() };
    const path = editing.create ? `/api/ontologies/${activeId}/enterprise/logic-definitions`
      : `/api/ontologies/${activeId}/enterprise/logic-definitions/${editing.id}`;
    try {
      const saved = await api(path, { method: editing.create ? 'POST' : 'PUT',
        body: JSON.stringify({ code: form.code, name: form.name, category: form.type,
          status: editing.create ? 'draft' : editing.status, description: editing.create ? form.logic : editing.description || form.logic, payload }) });
      setEditing(null); await load(); setSelected(saved); openDetail(); notify('规则／函数定义已保存到工作状态');
    } catch (cause) { notify(cause.message); } finally { setBusy(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(`确定删除“${item.name}”吗？`)) return;
    try { await api(`/api/enterprise/logic-definitions/${item.id}`, { method: 'DELETE' }); setSelected(null); await load(); }
    catch (cause) { notify(cause.message); }
  };
  useCreateIntent(Boolean(items), openManualCreate);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <Loading />;
  return <div className="rule-v2 mapping-v2">
    <div className="mapping-topbar"><div className="rule-top-title"><strong>规则</strong><span>{items.length} 条</span></div><label className="rule-top-search"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索规则名称、逻辑ID、适用对象、输入对象/属性或逻辑" /></label><div className="mapping-top-actions"><div className="mapping-help-wrap"><button className="mapping-icon-button" aria-label="规则说明" onClick={() => setHelp(!help)}><HelpCircle size={17} /></button>{help && <div className="mapping-help"><button aria-label="关闭说明" onClick={() => setHelp(false)}><X size={14} /></button><strong>规则</strong><p>按模板定义规则或函数的适用对象、输入、逻辑和输出。版本保留在详情中，列表只展示便于筛选和定位的核心字段。</p></div>}</div><button className="mapping-primary" onClick={openCreate}><Plus size={16} />新建规则／函数</button></div></div>
    <div className="mapping-controls"><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="all">全部状态</option>{[...new Set(items.map(ruleStatus))].map((value) => <option key={value} value={value}>{value}</option>)}</select><select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option value="all">全部类型</option><option value="规则">规则</option><option value="函数">函数</option></select><span className="rule-result-count">当前筛选 {visible.length} 条</span></div>
    <div className={`mapping-v2-layout ${detailOpen ? 'detail-open' : 'detail-collapsed'}`}><div className="mapping-v2-list-pane"><div className="mapping-v2-pane-heading"><strong>规则目录</strong><span>列表展示核心字段；版本保留在右侧详情</span></div><section className="mapping-v2-table rule-list"><header><span>逻辑 ID／名称</span><span>类型</span><span>适用对象</span><span>输入对象/数据</span><span>输入属性</span><span>触发方式</span><span>实时性</span><span>状态</span></header>{pageRows.map((item) => {
      const normalized = normalize(item, objects);
      const inputProperties = [...normalized.input_properties.map((value) => propertyLabel(value, objects)), ...splitNotes(normalized.input_property_notes).map((value) => `${value}（原文）`)].filter((value, index, all) => all.indexOf(value) === index).join('、');
      return <button type="button" key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => { setSelected(item); openDetail(); }}><span><strong>{item.name}</strong><small>{item.code}</small></span><span>{normalized.type}</span><span title={normalized.applicable_objects.map(objectName).join('、') || item.template_raw?.['适用对象']}>{normalized.applicable_objects.map(objectName).join('、') || item.template_raw?.['适用对象'] || '待确认'}</span><span title={inputDataLabel(normalized, objects)}>{inputDataLabel(normalized, objects) || '待确认'}</span><span title={inputProperties}>{inputProperties || '待确认'}</span><span>{normalized.trigger_mode}</span><span>{normalized.realtime_requirement}</span><span><em className="oma-status rule-status">{ruleStatus(item)}</em></span></button>;
    })}{!visible.length && <EmptyState title="没有匹配的规则或函数" description="可按模板定义规则判断或可复用计算函数。" />}</section><PaginationBar page={currentPage} pageSize={pageSize} total={visible.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></div>
    <aside className="mapping-v2-inspector"><header><strong>规则详情</strong>{selected && <div><ResourceHistoryLink resourceType="logic_definition" resourceId={selected.id} /><button onClick={() => openEdit(selected)}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={() => remove(selected)}><Trash2 size={14} /> 删除</button></div>}<button className="detail-close-btn" title="收起详情" aria-label="收起详情" onClick={closeDetail}><X size={14} /></button></header><div className="mapping-drawer-body">{selected ? <><h3>{selected.name}</h3><dl>{[
      ['逻辑ID', selected.code], ['类型', normalize(selected, objects).type], ['适用对象', normalize(selected, objects).applicable_objects.map(objectName).join('、') || selected.template_raw?.['适用对象']],
      ['输入对象/数据', inputDataLabel(normalize(selected, objects), objects)],
      ['输入属性', [...normalize(selected, objects).input_properties.map((value) => propertyLabel(value, objects)), ...splitNotes(normalize(selected, objects).input_property_notes).map((value) => `${value}（原文）`)].filter((value, index, all) => all.indexOf(value) === index).join('、')],
      ['判断/计算逻辑', normalize(selected, objects).logic], ['输出', normalize(selected, objects).output],
      ['触发方式', normalize(selected, objects).trigger_mode], ['实时性', normalize(selected, objects).realtime_requirement],
      ['可复用', normalize(selected, objects).reusable ? '是' : '否'], ['负责人', normalize(selected, objects).owner],
      ['状态', ruleStatus(selected)], ['版本', ruleVersion(selected)],
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '待确认'}</dd></div>)}</dl></> : <EmptyState title="请选择规则" description="从左侧目录选择一条规则查看详情。" />}</div></aside></div>
    {editing && <Modal wide title={editing.create ? '新建规则／函数' : `编辑 · ${editing.name}`} onClose={() => setEditing(null)} footer={<><button className="btn secondary" onClick={() => setEditing(null)}>取消</button><button className="btn primary" form="logic-definition-form" disabled={busy}>{busy ? '保存中…' : '保存到工作状态'}</button></>}><form id="logic-definition-form" className="form-sections rule-editor" onSubmit={save}>
      <div className="form-section"><h3>规则／函数定义</h3><div className="form-grid two"><label><span>逻辑ID</span><input readOnly value={form.code} /></label><label><span>类型</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value, code: editing.create ? nextCode(event.target.value) : form.code })} disabled={!editing.create}><option>规则</option><option>函数</option></select></label></div><label><span>名称</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><SearchableMultiSelect label="适用对象" options={objectOptions} values={form.applicable_objects} onChange={(applicable_objects) => setForm((old) => ({ ...old, applicable_objects }))} hint="尚未选择适用对象（必选）" placeholder="搜索对象名称、业务域或主题域" /></div>
      <div className="form-section"><h3>输入与计算</h3><SearchableMultiSelect label="输入对象/数据" options={objectOptions} values={form.input_objects} onChange={updateInputObjects} notes={splitNotes(form.input_data_description)} onChangeNotes={(notes) => setForm((old) => ({ ...old, input_data_description: notes.join('、') }))} hint="选择已有对象，或输入数据描述" placeholder="搜索对象；输入文字后按回车保留" helpText="可选已有对象，也可在同一字段内保留模板中的数据描述。" /><SearchableMultiSelect label="输入属性" options={propertyOptions} values={form.input_properties} onChange={updateInputProperties} notes={splitNotes(form.input_property_notes)} onChangeNotes={(notes) => setForm((old) => ({ ...old, input_property_notes: notes.join('、') }))} grouped hint="选择已有属性，或输入属性原文" placeholder="搜索属性；输入文字后按回车保留" helpText="选择属性会自动补入所属输入对象；文字条目保留原文，不视为已绑定属性。" /><label><span>判断/计算逻辑</span><textarea required value={form.logic} onChange={(event) => setForm({ ...form, logic: event.target.value })} placeholder="描述可落地的判断条件或计算口径；未确定的阈值明确写为待确认" /></label><label><span>输出</span><textarea required value={form.output} onChange={(event) => setForm({ ...form, output: event.target.value })} placeholder="例如：压力异常=是；风险等级、原因、影响范围" /></label></div>
      <div className="form-section"><h3>触发与维护</h3><div className="form-grid two"><label><span>触发方式</span><select value={form.trigger_mode} onChange={(event) => setForm({ ...form, trigger_mode: event.target.value })}><option>调用</option><option>事件触发</option><option>定时</option><option>手工触发</option></select></label><label><span>实时性</span><select value={form.realtime_requirement} onChange={(event) => setForm({ ...form, realtime_requirement: event.target.value })}><option>按需</option><option>实时</option><option>准实时</option><option>批量</option></select></label><label><span>可复用</span><select value={form.reusable ? 'yes' : 'no'} onChange={(event) => setForm({ ...form, reusable: event.target.value === 'yes' })}><option value="yes">是</option><option value="no">否</option></select></label><label><span>负责人</span><input required value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} /></label><label><span>状态</span><select value={form.design_status} onChange={(event) => setForm({ ...form, design_status: event.target.value })}><option>设计中</option><option>已确认</option></select></label><label><span>版本</span><input required maxLength={32} value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} placeholder="例如 V1.0" /></label></div></div>
    </form></Modal>}
  </div>;
}
