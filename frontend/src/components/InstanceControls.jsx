import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, GripVertical, Plus, Search, Trash2, X } from 'lucide-react';
import Modal from './Modal';
import { editableTitleProperty, instanceDefinitions, instanceColumnValue, isReadOnlyProperty } from '../instanceView';

export function InstancePropertyInput({ property, value, onChange, disabled = false, id, invalid }) {
  const shared = { id, disabled: disabled || isReadOnlyProperty(property), 'aria-invalid': Boolean(invalid), value: value ?? '', onChange: (event) => onChange(event.target.value) };
  if (property.type === 'boolean') return <select {...shared} value={String(value ?? '')}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>;
  if (property.type === 'enum') return <select {...shared}><option value="">请选择</option>{value && !property.options?.includes(value) && <option value={value}>{value}（历史值，需确认）</option>}{(property.options || []).map((option) => <option key={option} value={option}>{property.optionLabels?.[option] || option}</option>)}</select>;
  if (property.type === 'datetime') {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    const zone = String(value || '').match(/(Z|[+-]\d{2}:\d{2})$/)?.[0] || '';
    const updateDate = (event) => { const next = event.currentTarget.value; onChange(next && zone ? `${next}${zone}` : next); };
    const inputValue = value ? String(value).replace(' ', 'T').replace(/(Z|[+-]\d{2}:\d{2})$/, '') : '';
    return <div className="ix-date-input"><input {...shared} type={dateOnly ? 'date' : 'datetime-local'} step={dateOnly ? undefined : 1} value={inputValue} onInput={updateDate} onChange={updateDate} /><small>{zone ? `保留来源时区：${zone}` : '按本地日期时间填写。'}</small></div>;
  }
  const number = property.type === 'decimal' || property.type === 'integer';
  return <input {...shared} type={number ? 'number' : 'text'} step={property.type === 'integer' ? 1 : number ? 'any' : undefined} placeholder={isReadOnlyProperty(property) ? '由计算或同步产生' : property.description || property.business_definition || ''} />;
}

export function InstanceEditor({ form, setForm, types, editing, busy, error, fieldErrors = {}, onChangeType, onChangeProperty, onClose, onSave }) {
  const type = types.find((item) => item.id === form.object_type_id);
  const properties = instanceDefinitions(type);
  const titleProperty = editableTitleProperty(type);
  const editable = properties.filter((property) => !property.is_primary_key && property.key !== 'source_system');
  const missingGenerated = !editing ? properties.filter((property) => isReadOnlyProperty(property) && property.is_required && (form.properties[property.key] === '' || form.properties[property.key] === undefined || form.properties[property.key] === null)) : [];
  const firstError = useRef(null);
  useEffect(() => { if (error) firstError.current?.focus(); }, [error]);
  return <Modal wide title={editing ? '编辑实例' : '新建实例'} subtitle={`${type?.display_name || '对象类型'} · ${editing ? '主键保持不变，修改业务属性后保存' : '字段来自对象类型定义'}`} onClose={onClose} closeOnBackdrop={false} footer={<><span className="ix-editor-shortcut">Ctrl / ⌘ + Enter 保存</span><button type="button" className="btn secondary" onClick={onClose} disabled={busy}>取消</button><button type="submit" form="instance-form" className="btn primary" disabled={busy || missingGenerated.length > 0}>{busy ? '保存中…' : '保存实例'}</button></>}>
    <form id="instance-form" className="form-sections ix-form" noValidate onSubmit={onSave} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (!missingGenerated.length) event.currentTarget.requestSubmit(); } }}>
      {error && <div ref={firstError} tabIndex={-1} className="form-error-banner" role="alert">{error}</div>}
      {missingGenerated.length > 0 && <div className="ix-form-model-warning" role="status">「{missingGenerated.map((property) => property.name).join('、')}」为必填的实时或计算属性，需由数据映射或计算能力生成。当前定义无法直接手工新建，请先配置生成来源或调整新建必填约束。</div>}
      <section className="form-section"><h3>实例标识</h3><div className="form-grid two">
        <label><span>对象类型</span><select disabled={Boolean(editing) || busy} value={form.object_type_id} onChange={(event) => onChangeType(event.target.value)}>{types.map((item) => <option key={item.id} value={item.id}>{item.display_name} · {item.name}</option>)}</select></label>
        <label><span>业务主键 <em className="required-star">*</em></span><input disabled={Boolean(editing) || busy} value={form.business_key} aria-invalid={Boolean(fieldErrors.business_key)} onChange={(event) => setForm({ ...form, business_key: event.target.value })} placeholder="对象类型内唯一的业务编号" /><small>{editing ? '主键用于关联和追溯，创建后不可在普通编辑中修改。' : '自动赋给对象类型中的主键属性。'}</small>{fieldErrors.business_key && <small className="ix-field-error">{fieldErrors.business_key}</small>}</label>
        {!titleProperty && <label><span>实例标题 <em className="required-star">*</em></span><input disabled={busy} aria-invalid={Boolean(fieldErrors.title)} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="便于识别的业务名称" />{fieldErrors.title && <small className="ix-field-error">{fieldErrors.title}</small>}</label>}
        <label><span>记录状态</span><select disabled={busy} value={form.record_status} onChange={(event) => setForm({ ...form, record_status: event.target.value })}>{[...new Set([form.record_status, '有效', '冻结', '历史'])].filter(Boolean).map((status) => <option key={status}>{status}</option>)}</select><small>用于数据管理；业务状态以对象的状态属性为准。</small></label>
      </div></section>
      <section className="form-section"><h3>业务属性</h3><p className="form-hint">标有 * 的属性必填；计算属性和实时属性由执行器产生。</p><div className="form-grid two ix-property-form">{editable.map((property) => <label key={property.key} htmlFor={`instance-field-${property.key}`}><span>{property.name}{property.is_required && <em className="required-star">*</em>}{titleProperty?.key === property.key && <em className="ix-field-tag">实例标题</em>}{isReadOnlyProperty(property) && <em className="ix-field-tag">只读</em>}{property.is_sensitive && <em className="ix-field-tag">敏感属性</em>}<code>{property.key}</code>{property.unit && !['enum', 'boolean'].includes(property.type) && <small>单位：{property.unit}</small>}</span><InstancePropertyInput property={property} id={`instance-field-${property.key}`} value={form.properties[property.key]} disabled={busy} invalid={fieldErrors[property.key]} onChange={(value) => onChangeProperty(property.key, value)} />{fieldErrors[property.key] && <small className="ix-field-error">{fieldErrors[property.key]}</small>}</label>)}</div></section>
      <section className="form-section"><h3>数据来源</h3>{editing ? <div className="ix-source-readonly"><span>来源系统</span><b>{form.source_system || '手工录入'}</b><span>源系统主键</span><code>{form.source_pk || '—'}</code><small>同步状态、质量结果和同步时间保留执行记录，不能通过表单伪造。</small></div> : <p className="form-hint">本页新建为手工录入实例，质量状态初始为“未评估”。</p>}</section>
    </form>
  </Modal>;
}

export function InstanceColumnSettings({ allColumns, columns, visibleKeys, widths, freeze, wrap, onFreeze, onWrap, onToggle, onMove, onReorder, onWidth, onReset, onClose }) {
  const [search, setSearch] = useState('');
  const [dragged, setDragged] = useState('');
  const [dropTarget, setDropTarget] = useState('');
  const dragCleanup = useRef(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const optional = allColumns.filter((column) => !['__key', '__title'].includes(column.id));
  const startDrag = (event, source) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); dragCleanup.current?.();
    setDragged(source);
    const rowAt = (point) => document.elementFromPoint(point.clientX, point.clientY)?.closest('.ix-config-order [data-column-id]');
    const move = (point) => {
      const row = rowAt(point);
      setDropTarget(row && !row.dataset.fixed ? row.dataset.columnId : '');
      const scroll = event.target.closest('.ix-config-order');
      if (scroll) {
        const rect = scroll.getBoundingClientRect();
        if (point.clientY < rect.top + 20) scroll.scrollTop -= 10;
        if (point.clientY > rect.bottom - 20) scroll.scrollTop += 10;
      }
    };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); };
    const cancel = () => { cleanup(); setDragged(''); setDropTarget(''); };
    const finish = (point) => {
      const row = rowAt(point);
      if (row && !row.dataset.fixed && row.dataset.columnId !== source) onReorder(source, row.dataset.columnId);
      cancel();
    };
    dragCleanup.current = cleanup;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true }); window.addEventListener('pointercancel', cancel, { once: true });
  };
  return <Modal wide title="配置实例表格" subtitle="配置保存在当前浏览器，按本体和对象类型独立生效" onClose={onClose} footer={<><button className="btn secondary" onClick={onReset}>恢复默认</button><button className="btn primary" onClick={onClose}><Check size={14} /> 完成</button></>}>
    <div className="ix-column-config">
      <section><label className="ix-config-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索属性名称或字段" /></label><h4>选择显示列</h4><p>业务主键与实例标题始终显示。</p><div className="ix-column-options">{optional.filter((column) => `${column.label} ${column.sub}`.toLowerCase().includes(search.toLowerCase())).map((column) => <label key={column.id}><input type="checkbox" checked={visibleKeys.includes(column.id)} onChange={() => onToggle(column.id)} /><span>{column.label}<code>{column.sub}</code></span></label>)}</div></section>
      <section><h4>显示顺序与列宽</h4><p>拖动左侧手柄，或使用上下移动按钮和方向键。</p>
        <div className="ix-config-order">{columns.map((column, index) => <div key={column.id} data-column-id={column.id} data-fixed={column.sticky ? 'true' : undefined} className={`${dragged === column.id ? 'dragging' : ''} ${dropTarget === column.id ? 'drop-target' : ''}`}>
          {column.sticky ? <GripVertical size={14} className="ix-fixed-grip" /> : <button className="ix-column-drag" aria-label={`拖动${column.label}调整顺序`} onPointerDown={(event) => startDrag(event, column.id)} onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onMove(column.id, event.key === 'ArrowUp' ? -1 : 1); } }}><GripVertical size={14} /></button>}
          <span>{column.label}</span><input type="number" min="100" max="600" aria-label={`${column.label}列宽`} key={`${column.id}:${widths[column.id] || column.width}`} defaultValue={widths[column.id] || column.width} onBlur={(event) => onWidth(column.id, Number(event.target.value))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /><small>px</small>
          {!column.sticky && <><button disabled={index <= 2} aria-label={`上移${column.label}`} onClick={() => onMove(column.id, -1)}><ArrowUp size={13} /></button><button disabled={index === columns.length - 1} aria-label={`下移${column.label}`} onClick={() => onMove(column.id, 1)}><ArrowDown size={13} /></button></>}
        </div>)}</div>
        <label className="ix-config-flag"><input type="checkbox" checked={freeze} onChange={(event) => onFreeze(event.target.checked)} /> 冻结主键和标题列（空间足够时）</label><label className="ix-config-flag"><input type="checkbox" checked={wrap} onChange={(event) => onWrap(event.target.checked)} /> 长文本自动换行</label>
      </section>
    </div>
  </Modal>;
}

const operators = [['contains', '包含'], ['equals', '等于'], ['neq', '不等于'], ['gt', '大于 / 晚于'], ['gte', '大于等于'], ['lt', '小于 / 早于'], ['lte', '小于等于'], ['is_empty', '为空'], ['not_empty', '不为空']];
export function InstanceFilterEditor({ columns, filters, onApply, onClose }) {
  const [draft, setDraft] = useState(filters.length ? filters.map((filter) => ({ ...filter })) : [{ id: crypto.randomUUID(), column: columns[0]?.id || '', operator: 'contains', value: '' }]);
  const [error, setError] = useState('');
  const change = (id, patch) => setDraft((old) => old.map((filter) => filter.id === id ? { ...filter, ...patch } : filter));
  const apply = () => {
    if (draft.some((filter) => !filter.column || (!['is_empty', 'not_empty'].includes(filter.operator) && String(filter.value).trim() === ''))) { setError('请补全筛选字段和值，或删除不需要的条件。'); return; }
    onApply(draft); onClose();
  };
  return <Modal wide title="属性筛选" subtitle="所有条件同时满足（AND）；文本条件忽略大小写" onClose={onClose} footer={<><button className="btn secondary" onClick={() => { onApply([]); onClose(); }}>清空条件</button><button className="btn primary" onClick={apply}>应用筛选</button></>}>
    {error && <p className="form-error-banner" role="alert">{error}</p>}<div className="ix-filter-editor">{draft.map((filter) => { const column = columns.find((item) => item.id === filter.column); const property = column?.property; return <div key={filter.id}><select aria-label="筛选属性" value={filter.column} onChange={(event) => change(filter.id, { column: event.target.value, value: '', operator: 'equals' })}>{columns.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><select aria-label="筛选运算符" value={filter.operator} onChange={(event) => change(filter.id, { operator: event.target.value })}>{operators.filter(([key]) => !['gt', 'gte', 'lt', 'lte'].includes(key) || ['integer', 'decimal', 'datetime'].includes(column?.type) || column?.kind === 'datetime').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{!['is_empty', 'not_empty'].includes(filter.operator) && (property?.type === 'enum' || property?.type === 'boolean' ? <InstancePropertyInput property={property} value={filter.value} onChange={(value) => change(filter.id, { value })} /> : <input aria-label="筛选值" type={['integer', 'decimal'].includes(column?.type) ? 'number' : column?.type === 'datetime' || column?.kind === 'datetime' ? 'datetime-local' : 'text'} value={filter.value} onChange={(event) => change(filter.id, { value: event.target.value })} onInput={(event) => change(filter.id, { value: event.currentTarget.value })} />)}<button aria-label="删除筛选条件" onClick={() => setDraft((old) => old.filter((item) => item.id !== filter.id))}><Trash2 size={15} /></button></div>; })}<button className="btn secondary" onClick={() => setDraft((old) => [...old, { id: crypto.randomUUID(), column: columns[0]?.id || '', operator: 'contains', value: '' }])}><Plus size={14} /> 添加条件</button></div>
  </Modal>;
}

export function InstanceComparison({ records, type, display, onClose }) {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const columns = [{ id: '__key', kind: 'key', label: '业务主键' }, { id: '__title', kind: 'title', label: '实例标题' }, ...instanceDefinitions(type).map((property) => ({ id: `prop:${property.key}`, kind: 'property', key: property.key, label: property.name, property }))];
  return <Modal extraWide title={`对比实例 · ${type.display_name}`} subtitle={`对比 ${records.length} 条实例的属性值`} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>完成</button>}><label className="ix-config-flag"><input type="checkbox" checked={differencesOnly} onChange={(event) => setDifferencesOnly(event.target.checked)} /> 只显示不同的属性</label><div className="ix-compare-scroll"><table className="ix-compare-table"><thead><tr><th>属性</th>{records.map((record) => <th key={record.id}>{record.title}<code>{record.business_key}</code></th>)}</tr></thead><tbody>{columns.filter((column) => !differencesOnly || new Set(records.map((record) => JSON.stringify(instanceColumnValue(record, column)))).size > 1).map((column) => <tr key={column.id}><th>{column.label}</th>{records.map((record) => <td key={record.id}>{display(instanceColumnValue(record, column), column.property)}</td>)}</tr>)}</tbody></table></div></Modal>;
}
