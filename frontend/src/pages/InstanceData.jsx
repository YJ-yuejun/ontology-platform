import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Columns3, Copy, Database, Download, KeyRound,
  LayoutList, LoaderCircle, Pencil, Plus, RefreshCw, Rows3, Search, SlidersHorizontal, Trash2, X,
} from 'lucide-react';
import { api, formatTime } from '../api';
import Modal from '../components/Modal';
import PaginationBar from '../components/PaginationBar';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import { ObjectTypeIcon } from '../components/ObjectTypeIcon';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import './InstanceData.css';

const syncLabels = { pending: '待同步', syncing: '同步中', synced: '已同步', failed: '同步失败', stale: '已过期', disabled: '已停用' };
const qualityLabels = { passed: '质量通过', warning: '质量警告', failed: '质量失败', unknown: '未评估' };
const typeLabels = { string: '文本', integer: '整数', decimal: '数值', boolean: '布尔', datetime: '日期时间', enum: '枚举' };
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

const emptyForm = () => ({
  object_type_id: '', business_key: '', title: '', properties: {}, record_status: '有效',
  sync_status: 'synced', quality_status: 'passed', source_system: '', source_pk: '', sync_error: '',
});
const emptyColumnState = () => ({ key: '', visible: [] });

const getTypeName = (type) => type?.display_name || type?.name || '未选择对象';
const getPropertyMap = (type) => Object.fromEntries((type?.properties || []).map((item) => [item.key, item]));
const defaultVisibleKeys = (type) => [
  // 主键属性由“业务主键”列承载；来源系统由系统列承载，默认避免重复列。
  ...(type?.properties || []).filter((item) => !item.is_primary_key && item.key !== 'source_system').map((item) => `prop:${item.key}`),
  'sys:record_status', 'sys:sync_status', 'sys:quality_status', 'sys:updated_at',
];

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function displayValue(value, definition) {
  if (value === null || value === undefined || value === '') return '—';
  if (definition?.type === 'decimal') {
    const number = Number(value);
    return Number.isFinite(number) ? numberFormat.format(number) : String(value);
  }
  if (definition?.type === 'integer') return String(value);
  if (definition?.type === 'boolean') return value === true || value === 'true' ? '是' : '否';
  if (definition?.type === 'datetime') {
    const text = String(value);
    return text.includes('T') ? formatTime(text) : text;
  }
  return String(value);
}

function compareValues(left, right, type) {
  if (left === right) return 0;
  if (left === null || left === undefined || left === '') return 1;
  if (right === null || right === undefined || right === '') return -1;
  if (type === 'decimal' || type === 'integer') return Number(left) - Number(right);
  if (type === 'boolean') return Number(Boolean(left)) - Number(Boolean(right));
  if (type === 'datetime') return String(left).localeCompare(String(right));
  return collator.compare(String(left), String(right));
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function statusTone(value, kind) {
  if (kind === 'quality') return value === 'passed' ? 'good' : value === 'failed' ? 'bad' : value === 'warning' ? 'warn' : 'neutral';
  if (kind === 'sync') return value === 'synced' ? 'good' : value === 'failed' ? 'bad' : value === 'pending' || value === 'syncing' || value === 'stale' ? 'warn' : 'neutral';
  return value === '有效' ? 'good' : value === '冻结' ? 'warn' : 'neutral';
}

export default function InstanceData({ activeId, refreshOntologies, notify }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [types, setTypes] = useState(null);
  const [instances, setInstances] = useState([]);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState('attributes');
  const [typeQuery, setTypeQuery] = useState('');
  const [query, setQuery] = useState('');
  const [recordStatus, setRecordStatus] = useState('');
  const [qualityStatus, setQualityStatus] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [sort, setSort] = useState({ key: '__key', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [density, setDensity] = useState('compact');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const searchRef = useRef(null);

  const selectedType = types?.find((item) => item.id === selectedTypeId) || null;
  const propertyColumns = selectedType?.properties || [];
  const typeCounts = useMemo(() => instances.reduce((result, item) => ({ ...result, [item.object_type_id]: (result[item.object_type_id] || 0) + 1 }), {}), [instances]);
  const typeInstances = useMemo(() => instances.filter((item) => item.object_type_id === selectedTypeId), [instances, selectedTypeId]);
  const detailInstance = instances.find((item) => item.id === selectedId) || null;

  const systemColumns = useMemo(() => [
    { id: '__title', key: '__title', label: '实例标题', sub: 'title', kind: 'title', width: 230, sticky: 'title' },
    { id: 'sys:record_status', key: 'record_status', label: '业务状态', sub: 'record_status', kind: 'status', width: 92 },
    { id: 'sys:quality_status', key: 'quality_status', label: '质量状态', sub: 'quality_status', kind: 'quality', width: 92 },
    { id: 'sys:sync_status', key: 'sync_status', label: '同步状态', sub: 'sync_status', kind: 'sync', width: 92 },
    { id: 'sys:source_system', key: 'source_system', label: '来源系统', sub: 'source_system', kind: 'source', width: 145 },
    { id: 'sys:updated_at', key: 'updated_at', label: '更新时间', sub: 'updated_at', kind: 'datetime', width: 150 },
  ], []);

  const allColumns = useMemo(() => [
    { id: '__key', key: '__key', label: '业务主键', sub: 'business_key', kind: 'key', width: 170, sticky: 'key' },
    ...systemColumns.slice(0, 1),
    ...propertyColumns.map((item) => ({
      id: `prop:${item.key}`, key: item.key, label: item.name, sub: item.key, kind: 'property', width: item.type === 'decimal' ? 130 : item.type === 'datetime' ? 160 : 155,
      property: item, required: item.is_required, type: item.type,
    })),
    ...systemColumns.slice(1),
  ], [propertyColumns, systemColumns]);
  const columns = useMemo(() => allColumns.filter((column) => ['__key', '__title'].includes(column.id) || visibleKeys.includes(column.id)), [allColumns, visibleKeys]);
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);

  const load = async (preferredId = '', preferredType = '') => {
    setError('');
    try {
      const [objectTypes, records] = await Promise.all([
        api(`/api/ontologies/${activeId}/object-types?include_abstract=false`),
        api(`/api/ontologies/${activeId}/instances`),
      ]);
      setTypes(objectTypes);
      setInstances(records);
      const requested = preferredType || selectedTypeId || searchParams.get('type') || localStorage.getItem(`instance-type:${activeId}`) || '';
      const dataTypes = objectTypes
        .filter((item) => records.some((record) => record.object_type_id === item.id))
        .sort((left, right) => records.filter((record) => record.object_type_id === right.id).length - records.filter((record) => record.object_type_id === left.id).length);
      const nextType = objectTypes.find((item) => item.id === requested)
        || dataTypes[0] || objectTypes[0] || null;
      setSelectedTypeId(nextType?.id || '');
      const next = records.find((item) => item.id === preferredId)
        || records.find((item) => item.id === selectedId && item.object_type_id === nextType?.id)
        || null;
      setSelectedId(next?.id || '');
      if (!next) { setDetail(null); setDrawerOpen(false); }
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => {
    setTypes(null); setSelectedTypeId(''); setSelectedId(''); setDetail(null); setDrawerOpen(false);
    load();
  }, [activeId]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return undefined; }
    let cancelled = false;
    api(`/api/instances/${selectedId}`).then((record) => { if (!cancelled) setDetail(record); }).catch((detailError) => { if (!cancelled) setError(detailError.message); });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    if (!types || !selectedTypeId) return;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('type', selectedTypeId);
      return next;
    }, { replace: true });
    localStorage.setItem(`instance-type:${activeId}`, selectedTypeId);
    const stored = localStorage.getItem(`instance-columns:${activeId}:${selectedTypeId}`);
    let next = defaultVisibleKeys(selectedType);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length) next = parsed;
      } catch { /* 使用默认列 */ }
    }
    setVisibleKeys(next);
    setPage(1);
    setSort({ key: '__key', dir: 'asc' });
    setRecordStatus(''); setQualityStatus(''); setSyncStatus(''); setQuery('');
  }, [selectedTypeId, activeId]);

  useEffect(() => {
    if (!columnsOpen) return;
    const close = () => setColumnsOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [columnsOpen]);

  const availableStatuses = useMemo(() => [...new Set(typeInstances.map((item) => item.record_status).filter(Boolean))], [typeInstances]);
  const availableQualities = useMemo(() => [...new Set(typeInstances.map((item) => item.quality_status).filter(Boolean))], [typeInstances]);
  const availableSyncs = useMemo(() => [...new Set(typeInstances.map((item) => item.sync_status).filter(Boolean))], [typeInstances]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return typeInstances.filter((item) => {
      if (recordStatus && item.record_status !== recordStatus) return false;
      if (qualityStatus && item.quality_status !== qualityStatus) return false;
      if (syncStatus && item.sync_status !== syncStatus) return false;
      if (!needle) return true;
      const propertyText = Object.values(item.properties || {}).map(normalizeValue).join(' ');
      return `${item.title} ${item.business_key} ${item.source_system || ''} ${propertyText}`.toLowerCase().includes(needle);
    });
  }, [typeInstances, query, recordStatus, qualityStatus, syncStatus]);

  const sorted = useMemo(() => {
    const column = allColumns.find((item) => item.id === sort.key);
    const value = (instance) => {
      if (!column || column.kind === 'property') return instance.properties?.[sort.key] ?? '';
      if (column.kind === 'key') return instance.business_key;
      if (column.kind === 'title') return instance.title;
      return instance[column.key] ?? '';
    };
    return [...filtered].sort((left, right) => {
      const compared = compareValues(value(left), value(right), column?.type);
      return sort.dir === 'asc' ? compared : -compared;
    });
  }, [filtered, sort, allColumns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedInstance = detailInstance || detail || null;
  const selectedPropertyGroups = useMemo(() => {
    const groups = new Map();
    propertyColumns.forEach((property) => {
      const key = property.property_category || '业务属性';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(property);
    });
    return [...groups.entries()];
  }, [propertyColumns]);

  useHistoryResourceFocus({
    resourceTypes: ['object_instance'], items: instances, visible: sorted, pageSize,
    setPage, ready: Boolean(types), onSelect: (record) => openInstance(record),
  });

  useEffect(() => { setPage(1); }, [query, recordStatus, qualityStatus, syncStatus, pageSize]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  const toggleSort = (key) => setSort((old) => old.key === key ? { key, dir: old.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const chooseType = (id) => {
    setSelectedTypeId(id);
    setSelectedId(''); setDrawerOpen(false); setDetail(null);
    setPage(1);
  };
  const openInstance = (record) => {
    if (!record) return;
    if (record.object_type_id !== selectedTypeId) setSelectedTypeId(record.object_type_id);
    setSelectedId(record.id);
    setDrawerOpen(true);
    setTab('attributes');
  };
  const selectRow = (record) => {
    setSelectedId(record.id);
    setDrawerOpen(true);
    setTab('attributes');
  };
  const copyKey = async (record) => {
    try { await navigator.clipboard.writeText(record.business_key); notify?.('已复制业务主键'); }
    catch { notify?.('浏览器未允许复制，请手动选择主键'); }
  };
  const toggleColumn = (id) => {
    const next = visibleKeys.includes(id) ? visibleKeys.filter((item) => item !== id) : [...visibleKeys, id];
    setVisibleKeys(next);
    if (sort.key === id) setSort({ key: '__key', dir: 'asc' });
    localStorage.setItem(`instance-columns:${activeId}:${selectedTypeId}`, JSON.stringify(next));
  };
  const resetColumns = () => {
    const next = defaultVisibleKeys(selectedType);
    setVisibleKeys(next);
    localStorage.setItem(`instance-columns:${activeId}:${selectedTypeId}`, JSON.stringify(next));
  };
  const clearFilters = () => { setQuery(''); setRecordStatus(''); setQualityStatus(''); setSyncStatus(''); };
  const hasFilters = Boolean(query || recordStatus || qualityStatus || syncStatus);
  const exportCsv = () => {
    if (!selectedType || !columns.length) return;
    const header = columns.map((column) => column.label);
    const lines = sorted.map((record) => columns.map((column) => {
      if (column.kind === 'key') return record.business_key;
      if (column.kind === 'title') return record.title;
      if (column.kind === 'status') return record.record_status;
      if (column.kind === 'quality') return qualityLabels[record.quality_status] || record.quality_status;
      if (column.kind === 'sync') return syncLabels[record.sync_status] || record.sync_status;
      if (column.kind === 'property') return record.properties?.[column.key] ?? '';
      return record[column.key] ?? '';
    }).map(csvCell).join(','));
    const blob = new Blob([`\uFEFF${[header.map(csvCell).join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${selectedType.display_name}-实例-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const emptyProperties = (type, source = {}) => Object.fromEntries((type?.properties || []).map((item) => [item.key, source[item.key] ?? item.default ?? '']));
  const openCreate = () => {
    if (!types?.length) return;
    const type = selectedType || types[0];
    setForm({ ...emptyForm(), object_type_id: type.id, properties: emptyProperties(type) });
    setEditing(null); setCreating(true); setFormError('');
  };
  const openEdit = () => {
    if (!detail || !selectedType) return;
    setForm({
      ...emptyForm(), object_type_id: detail.object_type_id, business_key: detail.business_key, title: detail.title,
      record_status: detail.record_status, sync_status: detail.sync_status, quality_status: detail.quality_status,
      source_system: detail.source_system || '', source_pk: detail.source_pk || '', sync_error: detail.sync_error || '',
      properties: emptyProperties(selectedType, detail.properties),
    });
    setEditing(detail); setCreating(false); setFormError('');
  };
  const closeForm = () => { if (busy) return; setCreating(false); setEditing(null); setFormError(''); };
  const changeFormType = (id) => {
    const type = types.find((item) => item.id === id);
    setForm({ ...form, object_type_id: id, business_key: '', title: '', properties: emptyProperties(type) });
    setFormError('');
  };
  const changeProperty = (key, value) => setForm((old) => ({ ...old, properties: { ...old.properties, [key]: value } }));
  const currentFormType = types?.find((item) => item.id === form.object_type_id);
  const formProperties = currentFormType?.properties || [];
  const hiddenFormProperties = formProperties.filter((item) => item.is_primary_key || item.key === 'source_system');
  const formVisibleProperties = formProperties.filter((item) => !item.is_primary_key && item.key !== 'source_system');
  const save = async (event) => {
    event.preventDefault();
    if (!form.business_key.trim()) { setFormError('请填写业务主键。'); return; }
    if (!form.title.trim()) { setFormError('请填写实例标题。'); return; }
    const missing = formVisibleProperties.filter((item) => item.is_required && (form.properties[item.key] === '' || form.properties[item.key] === undefined || form.properties[item.key] === null));
    if (missing.length) { setFormError(`请填写必填属性：${missing.map((item) => item.name).join('、')}`); return; }
    setBusy(true); setFormError('');
    try {
      const normalized = Object.fromEntries(formProperties.map((item) => {
        let raw = form.properties[item.key];
        // 主键属性由业务主键承载，来源系统属性由运行信息承载；避免用户重复填写。
        if (item.is_primary_key && (raw === '' || raw === undefined || raw === null)) raw = form.business_key;
        if (item.key === 'source_system' && (raw === '' || raw === undefined || raw === null)) raw = form.source_system;
        if (raw === '' || raw === undefined || raw === null) return [item.key, ''];
        if (item.type === 'integer') return [item.key, Number.parseInt(raw, 10)];
        if (item.type === 'decimal') return [item.key, Number(raw)];
        if (item.type === 'boolean') return [item.key, raw === true || raw === 'true'];
        return [item.key, raw];
      }));
      const payload = { ...form, properties: normalized, source_pk: form.source_pk || form.business_key };
      const saved = await api(editing ? `/api/instances/${editing.id}` : `/api/ontologies/${activeId}/instances`, {
        method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      setCreating(false); setEditing(null);
      await load(saved.id, selectedTypeId);
      refreshOntologies?.(activeId);
      notify?.(editing ? '实例已更新' : '实例已创建');
    } catch (saveError) {
      setFormError(saveError.message);
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!detail || !window.confirm(`删除实例“${detail.title}”及其关系吗？`)) return;
    try {
      await api(`/api/instances/${detail.id}`, { method: 'DELETE' });
      setDrawerOpen(false); setSelectedId(''); setDetail(null);
      await load('', selectedTypeId);
      refreshOntologies?.(activeId);
      notify?.('实例已删除');
    } catch (removeError) { notify?.(removeError.message); }
  };
  const openRelated = (related) => {
    const record = instances.find((item) => item.id === related.related_instance_id);
    if (record) openInstance(record);
  };

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!types) return <Loading />;
  const selectedTypeCount = selectedType ? typeCounts[selectedType.id] || 0 : 0;
  const qualityIssues = typeInstances.filter((item) => ['warning', 'failed'].includes(item.quality_status)).length;
  const syncIssues = typeInstances.filter((item) => ['pending', 'syncing', 'failed', 'stale'].includes(item.sync_status)).length;
  const filteredTypes = types.filter((type) => `${type.display_name} ${type.name}`.toLowerCase().includes(typeQuery.trim().toLowerCase()))
    .sort((left, right) => (typeCounts[right.id] || 0) - (typeCounts[left.id] || 0) || left.display_name.localeCompare(right.display_name, 'zh-CN'));

  return <div className="ix-page">
    <header className="ix-page-head">
      <div><small>本体数据 · 业务实例</small><h1>实例数据</h1><p>按对象类型浏览业务实例；表格列由对象属性动态生成，不同对象使用不同的表格结构。</p></div>
      <div className="ix-head-actions">
        <button type="button" onClick={() => load(selectedId, selectedTypeId)}><RefreshCw size={15} /> 刷新</button>
        <button type="button" className="primary" onClick={openCreate} disabled={!types.length}><Plus size={15} /> 新建实例</button>
      </div>
    </header>

    <div className="ix-shell">
      <aside className="ix-types">
        <header><div><LayoutList size={15} /><strong>对象类型</strong></div><span>{types.length} 类</span></header>
        <label className="ix-type-search"><Search size={14} /><input value={typeQuery} onChange={(event) => setTypeQuery(event.target.value)} placeholder="搜索对象类型" /></label>
        <div className="ix-type-list">
          {filteredTypes.map((type) => <button type="button" key={type.id} className={type.id === selectedTypeId ? 'active' : ''} onClick={() => chooseType(type.id)}>
            <i><ObjectTypeIcon value={type.icon} size={16} /></i>
            <span><b>{type.display_name}</b><small>{type.name}</small></span>
            <em className={typeCounts[type.id] ? '' : 'zero'}>{typeCounts[type.id] || 0}</em>
          </button>)}
          {!filteredTypes.length && <p className="ix-type-empty">没有匹配的对象类型</p>}
        </div>
        <footer><Database size={13} /><span>共 {instances.length} 条实例</span></footer>
      </aside>

      <main className="ix-main">
        <header className="ix-type-head">
          <div className="ix-type-title">
            <i>{selectedType ? <ObjectTypeIcon value={selectedType.icon} size={22} /> : <Database size={22} />}</i>
            <div><h2>{selectedType ? getTypeName(selectedType) : '选择对象类型'}</h2><p>{selectedType ? <><code>{selectedType.name}</code><span>{selectedType.business_domain_name || '未分类'} / {selectedType.subject_domain_name || '未分类'}</span><span>{propertyColumns.length} 个属性</span></> : '从左侧选择对象类型开始浏览'}</p></div>
            <em className="ix-type-count">{selectedTypeCount} 条实例</em>
          </div>
          <div className="ix-type-actions">
            <button type="button" className="ix-icon-button" onClick={() => load(selectedId, selectedTypeId)} title="刷新当前对象类型"><RefreshCw size={15} /></button>
            <div className="ix-columns-wrap">
              <button type="button" className={columnsOpen ? 'active' : ''} onClick={(event) => { event.stopPropagation(); setColumnsOpen((value) => !value); }}><Columns3 size={15} /> 列设置</button>
              {columnsOpen && <div className="ix-columns-popover" onClick={(event) => event.stopPropagation()}>
                <header><div><strong>显示列</strong><small>选择和排序无关，表格按对象属性顺序展示</small></div><button type="button" onClick={() => setColumnsOpen(false)}><X size={14} /></button></header>
                <div className="ix-columns-scroll">
                  <section><h4>业务属性</h4>{propertyColumns.map((item) => <label key={item.id}><input type="checkbox" checked={visibleKeys.includes(item.id)} onChange={() => toggleColumn(item.id)} /><span>{item.name}<small>{item.key}</small></span></label>)}</section>
                  <section><h4>系统信息</h4>{systemColumns.slice(1).map((column) => <label key={column.id}><input type="checkbox" checked={visibleKeys.includes(column.id)} onChange={() => toggleColumn(column.id)} /><span>{column.label}<small>{column.sub}</small></span></label>)}</section>
                </div>
                <footer><button type="button" onClick={resetColumns}>恢复默认</button><button type="button" className="primary" onClick={() => setColumnsOpen(false)}>完成</button></footer>
              </div>}
            </div>
            <button type="button" disabled={!sorted.length} onClick={exportCsv}><Download size={15} /> 导出</button>
            <button type="button" onClick={() => setDensity((value) => value === 'compact' ? 'comfortable' : 'compact')} title="切换行密度">{density === 'compact' ? <Rows3 size={15} /> : <LayoutList size={15} />}</button>
          </div>
        </header>

        <div className="ix-stat-strip">
          <div><small>当前对象实例</small><b>{selectedTypeCount}</b></div>
          <div><small>属性列</small><b>{propertyColumns.length}</b></div>
          <div className={qualityIssues ? 'warn' : ''}><small>质量异常</small><b>{qualityIssues}</b></div>
          <div className={syncIssues ? 'warn' : ''}><small>同步异常</small><b>{syncIssues}</b></div>
        </div>

        <div className="ix-toolbar">
          <label className="ix-search"><Search size={15} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主键、标题或任意属性值" /><kbd>⌘ K</kbd></label>
          <select value={recordStatus} onChange={(event) => setRecordStatus(event.target.value)} aria-label="按业务状态筛选"><option value="">全部业务状态</option>{availableStatuses.map((value) => <option key={value}>{value}</option>)}</select>
          <select value={qualityStatus} onChange={(event) => setQualityStatus(event.target.value)} aria-label="按质量状态筛选"><option value="">全部质量状态</option>{availableQualities.map((value) => <option key={value} value={value}>{qualityLabels[value] || value}</option>)}</select>
          <select value={syncStatus} onChange={(event) => setSyncStatus(event.target.value)} aria-label="按同步状态筛选"><option value="">全部同步状态</option>{availableSyncs.map((value) => <option key={value} value={value}>{syncLabels[value] || value}</option>)}</select>
          {hasFilters && <button type="button" className="ix-clear" onClick={clearFilters}>清空筛选</button>}
          <span className="ix-result-count">{sorted.length} 条{hasFilters ? ` / 全部 ${typeInstances.length}` : ''}</span>
        </div>

        <div className={`ix-table-wrap ${density}`}>
          {!selectedType ? <div className="ix-empty"><Database size={28} /><strong>选择对象类型</strong><p>不同对象类型的实例字段不同，选择后生成对应表格。</p></div>
            : !sorted.length ? <div className="ix-empty">{typeInstances.length ? <SlidersHorizontal size={28} /> : <Database size={28} />}<strong>{typeInstances.length ? '没有匹配的实例' : '这个对象类型还没有实例'}</strong><p>{typeInstances.length ? '调整搜索或筛选条件，或者清空筛选。' : '创建第一条业务实例后，表格会按对象属性自动生成列。'}</p>{typeInstances.length ? <button type="button" onClick={clearFilters}>清空筛选</button> : <button type="button" className="primary" onClick={openCreate}><Plus size={14} /> 新建实例</button>}</div>
              : <table className="ix-table" style={{ minWidth: tableWidth, width: 'max-content' }}>
                <colgroup>{columns.map((column) => <col key={column.id} style={{ width: column.width }} />)}</colgroup>
                <thead><tr>{columns.map((column) => <th key={column.id} className={`${column.sticky ? `ix-sticky ix-sticky-${column.sticky}` : ''} ix-col-${column.kind}`} scope="col"><button type="button" className="ix-th-button" onClick={() => toggleSort(column.id)} title={`按${column.label}排序`}><span>{column.label}{column.required && <em>*</em>}</span><small>{column.kind === 'property' ? `${column.sub} · ${typeLabels[column.type] || column.type}` : column.sub}</small>{sort.key === column.id ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="ix-sort-idle" />}</button></th>)}</tr></thead>
                <tbody>{pageRows.map((record) => <tr key={record.id} className={selectedId === record.id ? 'selected' : ''} onClick={() => selectRow(record)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') selectRow(record); }}>
                  {columns.map((column) => <td key={column.id} className={`${column.sticky ? `ix-sticky ix-sticky-${column.sticky}` : ''} ix-col-${column.kind}`}>
                    {column.kind === 'key' ? <span className="ix-key-cell"><code>{record.business_key}</code><button type="button" className="ix-copy" title="复制业务主键" onClick={(event) => { event.stopPropagation(); copyKey(record); }}><Copy size={12} /></button></span>
                      : column.kind === 'title' ? <span className="ix-title-cell"><b>{record.title}</b><small>{record.source_system || '手工录入'}</small></span>
                      : column.kind === 'status' ? <span className={`ix-badge ${statusTone(record.record_status)}`}>{record.record_status || '—'}</span>
                      : column.kind === 'quality' ? <span className={`ix-badge ${statusTone(record.quality_status, 'quality')}`}>{qualityLabels[record.quality_status] || record.quality_status || '—'}</span>
                      : column.kind === 'sync' ? <span className={`ix-badge ${statusTone(record.sync_status, 'sync')}`}>{syncLabels[record.sync_status] || record.sync_status || '—'}</span>
                      : column.kind === 'source' ? <code className="ix-source">{record.source_system || '—'}</code>
                      : column.kind === 'datetime' ? <span className="ix-date">{record[column.key] ? formatTime(record[column.key]) : '—'}</span>
                      : <span className={`ix-value ${column.type || ''}`} title={normalizeValue(record.properties?.[column.key])}>{displayValue(record.properties?.[column.key], column.property)}</span>}
                  </td>)}
                </tr>)}</tbody>
              </table>}
        </div>

        <footer className="ix-footer"><span>{selectedType ? `显示 ${sorted.length ? (currentPage - 1) * pageSize + 1 : 0}–${Math.min(currentPage * pageSize, sorted.length)} / 共 ${sorted.length} 条` : '—'}</span><PaginationBar page={currentPage} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></footer>
      </main>
    </div>

    {drawerOpen && selectedInstance && <aside className="ix-drawer">
      <header><div><i><ObjectTypeIcon value={selectedInstance.object_type_icon} size={20} /></i><span><strong>{selectedInstance.title}</strong><small>{selectedInstance.business_key} · {selectedInstance.object_type_display_name}</small></span></div><div><ResourceHistoryLink resourceType="object_instance" resourceId={selectedInstance.id} /><button type="button" className="ix-drawer-close" aria-label="关闭详情" onClick={() => setDrawerOpen(false)}><X size={17} /></button></div></header>
      {!detail ? <div className="ix-drawer-loading"><LoaderCircle className="spin" size={18} /> 加载实例详情…</div> : <>
        <div className="ix-drawer-status"><span className={`ix-badge ${statusTone(detail.record_status)}`}>{detail.record_status}</span><span className={`ix-badge ${statusTone(detail.quality_status, 'quality')}`}>{qualityLabels[detail.quality_status] || detail.quality_status}</span><span className={`ix-badge ${statusTone(detail.sync_status, 'sync')}`}>{syncLabels[detail.sync_status] || detail.sync_status}</span><code>{detail.source_system || '手工录入'}</code></div>
        <nav className="ix-drawer-tabs"><button type="button" className={tab === 'attributes' ? 'active' : ''} onClick={() => setTab('attributes')}>属性 <em>{propertyColumns.length}</em></button><button type="button" className={tab === 'relations' ? 'active' : ''} onClick={() => setTab('relations')}>关系 <em>{detail.related?.length || 0}</em></button><button type="button" className={tab === 'runtime' ? 'active' : ''} onClick={() => setTab('runtime')}>运行信息</button></nav>
        <div className="ix-drawer-body">
          {tab === 'attributes' && <>{selectedPropertyGroups.map(([group, properties]) => <section className="ix-attribute-group" key={group}><h4>{group}</h4>{properties.map((property) => <div className="ix-attribute-row" key={property.key}><span>{property.name}{property.is_primary_key && <em className="ix-pk">主键</em>}{property.is_required && <em className="ix-required">*</em>}</span><b>{displayValue(detail.properties?.[property.key], property)}</b><code>{property.key}</code></div>)}</section>)}{!propertyColumns.length && <p className="ix-drawer-empty">该对象类型还没有属性定义。</p>}</>}
          {tab === 'relations' && (detail.related?.length ? <div className="ix-relations">{detail.related.map((item) => <button type="button" key={item.id} onClick={() => openRelated(item)}><i><ObjectTypeIcon value={item.related_object_icon} size={16} /></i><span><b>{item.related_title}</b><small>{item.direction === 'outgoing' ? item.link_display_name : `反向 · ${item.link_display_name}`} · {item.related_object_type}</small></span><ChevronRight size={14} /></button>)}</div> : <p className="ix-drawer-empty">该实例还没有建立关系。</p>)}
          {tab === 'runtime' && <section className="ix-runtime"><div><span>业务主键</span><code>{detail.business_key}</code></div><div><span>来源系统</span><b>{detail.source_system || '手工录入'}</b></div><div><span>源系统主键</span><code>{detail.source_pk || '—'}</code></div><div><span>最近同步</span><b>{detail.last_synced_at ? formatTime(detail.last_synced_at) : '—'}</b></div><div><span>创建时间</span><b>{detail.created_at ? formatTime(detail.created_at) : '—'}</b></div><div><span>更新时间</span><b>{detail.updated_at ? formatTime(detail.updated_at) : '—'}</b></div>{detail.sync_error && <div className="ix-sync-error"><AlertTriangle size={14} /><span><b>同步错误</b><small>{detail.sync_error}</small></span></div>}</section>}
        </div>
        <footer className="ix-drawer-foot"><button type="button" className="primary" onClick={openEdit}><Pencil size={14} /> 编辑实例</button><button type="button" className="danger" onClick={remove}><Trash2 size={14} /> 删除</button><button type="button" onClick={() => copyKey(detail)}><Copy size={14} /> 复制主键</button></footer>
      </>}
    </aside>}

    {(creating || editing) && <Modal wide title={editing ? `编辑实例 · ${editing.title}` : '新建对象实例'} subtitle={editing ? '修改实例属性与运行状态' : `为「${getTypeName(currentFormType)}」创建一条业务实例`} onClose={closeForm} footer={<><button type="button" className="btn secondary" onClick={closeForm} disabled={busy}>取消</button><button type="submit" form="instance-form" className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存实例'}</button></>}>
      <form id="instance-form" className="form-sections ix-form" noValidate onSubmit={save}>
        {formError && <div className="form-error-banner" role="alert">{formError}</div>}
        <section className="form-section"><div className="form-section-heading"><div><h3>实例标识</h3><p>对象类型决定实例的字段结构；业务主键在对象类型内唯一。</p></div><span className="required-chip">必填</span></div><div className="form-grid two"><label><span>对象类型</span><select disabled={Boolean(editing)} value={form.object_type_id} onChange={(event) => changeFormType(event.target.value)}>{types.map((type) => <option key={type.id} value={type.id}>{type.display_name} · {type.name}</option>)}</select></label><label><span>业务主键</span><input className="mono" value={form.business_key} onChange={(event) => setForm({ ...form, business_key: event.target.value })} placeholder="例如：业务唯一编号" /><small>来源系统主键或业务唯一编号。</small></label><label><span>实例标题</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：2026年10月服务器扩容付款" /></label><label><span>业务状态</span><select value={form.record_status} onChange={(event) => setForm({ ...form, record_status: event.target.value })}><option>有效</option><option>冻结</option><option>历史</option></select></label></div></section>
        <section className="form-section"><div className="form-section-heading"><div><h3>业务属性</h3><p>{currentFormType ? `${formVisibleProperties.length} 个可填属性${formVisibleProperties.filter((item) => item.is_required).length ? `，其中 ${formVisibleProperties.filter((item) => item.is_required).length} 个必填` : ''}。` : '选择对象类型后生成属性字段。'}</p></div><span className="required-chip">* 必填</span></div>{hiddenFormProperties.some((item) => item.is_primary_key) && <div className="ix-form-pk-note"><KeyRound size={13} /><span>主键属性 <b>{hiddenFormProperties.filter((item) => item.is_primary_key).map((item) => `${item.name}（${item.key}）`).join('、')}</b> 自动使用业务主键，不需要重复填写。</span></div>}<div className="form-grid two ix-property-form">{formVisibleProperties.map((property) => <label key={property.key}><span>{property.name}{property.is_required && <em className="required-star"> *</em>}<em className="ix-prop-key">{property.key}</em></span>{property.type === 'enum' ? <select value={form.properties[property.key] ?? ''} onChange={(event) => changeProperty(property.key, event.target.value)}><option value="">请选择</option>{(property.options || []).map((option) => <option key={option}>{option}</option>)}</select> : property.type === 'boolean' ? <select value={String(form.properties[property.key] ?? '')} onChange={(event) => changeProperty(property.key, event.target.value)}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select> : <input type={property.type === 'decimal' || property.type === 'integer' ? 'number' : 'text'} step={property.type === 'decimal' ? 'any' : undefined} value={form.properties[property.key] ?? ''} onChange={(event) => changeProperty(property.key, event.target.value)} placeholder={property.description || ''} />}</label>)}</div></section>
        <details className="ix-form-advanced"><summary>数据来源与运行状态（可选）</summary><div className="form-grid two"><label><span>同步状态</span><select value={form.sync_status} onChange={(event) => setForm({ ...form, sync_status: event.target.value })}>{Object.entries(syncLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>数据质量</span><select value={form.quality_status} onChange={(event) => setForm({ ...form, quality_status: event.target.value })}>{Object.entries(qualityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>来源系统</span><input value={form.source_system} onChange={(event) => setForm({ ...form, source_system: event.target.value })} placeholder="例如：SRC-PO" /></label><label><span>源系统主键</span><input className="mono" value={form.source_pk} onChange={(event) => setForm({ ...form, source_pk: event.target.value })} placeholder="默认同业务主键" /></label></div><label><span>同步错误</span><input value={form.sync_error} onChange={(event) => setForm({ ...form, sync_error: event.target.value })} placeholder="正常时留空" /></label></details>
      </form>
    </Modal>}
  </div>;
}
