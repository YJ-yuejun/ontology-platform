import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, BarChart3, ChevronLeft,
  ChevronRight, Columns3, Copy, Database, Download, KeyRound, LayoutGrid, Link2, LoaderCircle,
  Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Sparkles, Star, Table2, Trash2, X,
} from 'lucide-react';
import { api, formatTime } from '../api';
import Modal from '../components/Modal';
import PaginationBar from '../components/PaginationBar';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import { ObjectTypeIcon } from '../components/ObjectTypeIcon';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import './InstanceData.css';
import './ObjectExplorer.css';

const syncLabels = { pending: '待同步', syncing: '同步中', synced: '已同步', failed: '同步失败', stale: '已过期', disabled: '已停用' };
const qualityLabels = { passed: '质量通过', warning: '质量警告', failed: '质量失败', unknown: '未评估' };
const typeLabels = { string: '文本', integer: '整数', decimal: '数值', boolean: '布尔', datetime: '日期时间', enum: '枚举' };
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 0 });
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const emptyForm = () => ({ object_type_id: '', business_key: '', title: '', properties: {}, record_status: '有效', sync_status: 'synced', quality_status: 'passed', source_system: '', source_pk: '', sync_error: '' });

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
  if (definition?.type === 'datetime') return String(value).includes('T') ? formatTime(value) : String(value);
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
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const statusTone = (value, kind) => {
  if (kind === 'quality') return value === 'passed' ? 'good' : value === 'failed' ? 'bad' : value === 'warning' ? 'warn' : 'neutral';
  if (kind === 'sync') return value === 'synced' ? 'good' : value === 'failed' ? 'bad' : ['pending', 'syncing', 'stale'].includes(value) ? 'warn' : 'neutral';
  return value === '有效' ? 'good' : value === '冻结' ? 'warn' : 'neutral';
};
const displayLevel = (type, property) => {
  if (!property) return 'normal';
  if (property.key === 'source_system') return 'hidden';
  if (property.is_primary_key) return 'hidden';
  if (property.key === type?.title_property) return 'prominent';
  if (['status', 'amount', 'risk_level', 'rating', 'apply_date', 'issue_date', 'sign_date', 'request_date'].includes(property.key)) return 'prominent';
  return 'normal';
};
const randomId = () => globalThis.crypto?.randomUUID?.() || `view-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 忽略浏览器存储限制 */ } };

function TypeCard({ type, count, favorite, onOpen, onFavorite }) {
  return <article className="ox-type-card">
    <header><i><ObjectTypeIcon value={type.icon} size={22} /></i><button type="button" className={favorite ? 'starred' : ''} onClick={() => onFavorite(type)} aria-label={favorite ? '取消收藏' : '收藏对象类型'}><Star size={15} fill={favorite ? 'currentColor' : 'none'} /></button></header>
    <button type="button" className="ox-type-card-main" onClick={() => onOpen(type)}>
      <h3>{type.display_name}</h3><code>{type.name}</code>
      <p>{type.subject_domain_name || type.business_domain_name || '未分类'} · {type.properties?.length || 0} 个属性</p>
      <footer><span>{count} 个对象</span><em>开始探索 <ArrowUpRight size={13} /></em></footer>
    </button>
  </article>;
}

export default function ObjectExplorer({ activeId, refreshOntologies, notify }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const typeId = searchParams.get('type') || '';
  const objectId = searchParams.get('object') || '';
  const viewId = searchParams.get('view') || '';
  const [types, setTypes] = useState(null);
  const [instances, setInstances] = useState([]);
  const [error, setError] = useState('');
  const [typeSearch, setTypeSearch] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [recent, setRecent] = useState([]);
  const [savedViews, setSavedViews] = useState([]);
  const [query, setQuery] = useState('');
  const [recordStatus, setRecordStatus] = useState('');
  const [quality, setQuality] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [chartFilter, setChartFilter] = useState(null);
  const [rangeFilter, setRangeFilter] = useState(null);
  const [sort, setSort] = useState({ key: '__key', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [density, setDensity] = useState('compact');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState([]);
  const [previewId, setPreviewId] = useState('');
  const [previewDetail, setPreviewDetail] = useState(null);
  const [objectDetail, setObjectDetail] = useState(null);
  const [objectTab, setObjectTab] = useState('overview');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const appliedView = useRef('');
  const typeResetRef = useRef('');

  const updateParams = (patch, replace = false) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      Object.entries(patch).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key); });
      return next;
    }, { replace });
  };
  const enterType = (type) => {
    typeResetRef.current = '';
    setPreviewId(''); setColumnsOpen(false);
    updateParams({ type: type.id, object: '', view: '' });
  };
  const openObject = (record) => {
    if (!record) return;
    updateParams({ type: record.object_type_id, object: record.id });
  };
  const backToExplore = () => updateParams({ object: '' });
  const backToHome = () => updateParams({ type: '', object: '', view: '' });

  useEffect(() => {
    setTypes(null); setInstances([]); setError(''); setObjectDetail(null); setPreviewId(''); setPreviewDetail(null);
    typeResetRef.current = '';
    setTypeSearch(''); setQuery(''); setRecordStatus(''); setQuality(''); setSyncStatus(''); setChartFilter(null); setRangeFilter(null);
    const load = async () => {
      try {
        const [objectTypes, records] = await Promise.all([api(`/api/ontologies/${activeId}/object-types?include_abstract=false`), api(`/api/ontologies/${activeId}/instances`)]);
        setTypes(objectTypes); setInstances(records);
      } catch (cause) { setError(cause.message); }
    };
    load();
    setFavorites(readJson(`object-explorer-favorites:${activeId}`, []));
    setRecent(readJson(`object-explorer-recent:${activeId}`, []));
    setSavedViews(readJson(`object-explorer-views:${activeId}`, []));
    appliedView.current = '';
  }, [activeId]);

  useEffect(() => {
    if (!previewId) { setPreviewDetail(null); return undefined; }
    let cancelled = false;
    api(`/api/instances/${previewId}`).then((record) => { if (!cancelled) setPreviewDetail(record); }).catch((cause) => { if (!cancelled) notify?.(cause.message); });
    return () => { cancelled = true; };
  }, [previewId]);

  useEffect(() => {
    if (!objectId) { setObjectDetail(null); return undefined; }
    let cancelled = false;
    setObjectDetail(null);
    api(`/api/instances/${objectId}`).then((record) => { if (!cancelled) setObjectDetail(record); }).catch((cause) => { if (!cancelled) { notify?.(cause.message); backToExplore(); } });
    return () => { cancelled = true; };
  }, [objectId]);

  useEffect(() => {
    if (!types || !typeId) return;
    if (!types.some((item) => item.id === typeId)) { backToHome(); return; }
    const resetKey = `${activeId}:${typeId}`;
    if (typeResetRef.current === resetKey) return;
    typeResetRef.current = resetKey;
    const next = [...new Set([typeId, ...recent])].slice(0, 6);
    setRecent(next); writeJson(`object-explorer-recent:${activeId}`, next);
    setPreviewId(''); setPage(1); setQuery(''); setRecordStatus(''); setQuality(''); setSyncStatus(''); setChartFilter(null); setRangeFilter(null);
    setSort({ key: '__key', dir: 'asc' });
  }, [typeId, activeId, types]);

  useEffect(() => {
    if (!types) return;
    const params = new URLSearchParams(location.search);
    if (params.get('from_history') !== '1' || params.get('resource_type') !== 'object_instance') return;
    const target = instances.find((item) => String(item.id) === String(params.get('resource_id')));
    if (target) updateParams({ type: target.object_type_id, object: target.id });
  }, [instances, location.search, types]);

  const selectedType = types?.find((item) => item.id === typeId) || null;
  const propertyMap = useMemo(() => Object.fromEntries((selectedType?.properties || []).map((item) => [item.key, item])), [selectedType]);
  const typeInstances = useMemo(() => instances.filter((item) => item.object_type_id === typeId), [instances, typeId]);
  const typeCounts = useMemo(() => instances.reduce((result, item) => ({ ...result, [item.object_type_id]: (result[item.object_type_id] || 0) + 1 }), {}), [instances]);
  const systemColumns = useMemo(() => [
    { id: '__title', key: '__title', label: '对象标题', sub: 'title', kind: 'title', width: 230, sticky: 'title' },
    { id: 'sys:record_status', key: 'record_status', label: '业务状态', sub: 'record_status', kind: 'status', width: 92 },
    { id: 'sys:quality_status', key: 'quality_status', label: '质量状态', sub: 'quality_status', kind: 'quality', width: 92 },
    { id: 'sys:sync_status', key: 'sync_status', label: '同步状态', sub: 'sync_status', kind: 'sync', width: 92 },
    { id: 'sys:source_system', key: 'source_system', label: '来源系统', sub: 'source_system', kind: 'source', width: 145 },
    { id: 'sys:updated_at', key: 'updated_at', label: '更新时间', sub: 'updated_at', kind: 'datetime', width: 150 },
  ], []);
  const allColumns = useMemo(() => [
    { id: '__key', key: '__key', label: '业务主键', sub: 'business_key', kind: 'key', width: 170, sticky: 'key' },
    ...systemColumns.slice(0, 1),
    ...(selectedType?.properties || []).map((item) => ({ id: `prop:${item.key}`, key: item.key, label: item.name, sub: item.key, kind: 'property', width: item.type === 'decimal' ? 130 : item.type === 'datetime' ? 160 : 155, property: item, required: item.is_required, type: item.type, level: displayLevel(selectedType, item) })),
    ...systemColumns.slice(1),
  ], [selectedType, systemColumns]);
  const defaultVisibleKeys = useMemo(() => [
    ...(selectedType?.properties || []).filter((item) => displayLevel(selectedType, item) !== 'hidden').map((item) => `prop:${item.key}`),
    'sys:record_status', 'sys:quality_status', 'sys:sync_status', 'sys:updated_at',
  ], [selectedType]);
  const columns = useMemo(() => allColumns.filter((column) => ['__key', '__title'].includes(column.id) || visibleKeys.includes(column.id)), [allColumns, visibleKeys]);
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);

  useEffect(() => {
    if (!selectedType) { setVisibleKeys([]); return; }
    const stored = readJson(`object-explorer-columns:${activeId}:${selectedType.id}`, null);
    setVisibleKeys(Array.isArray(stored) && stored.length ? stored : defaultVisibleKeys);
    setPage(1); setSort({ key: '__key', dir: 'asc' });
  }, [selectedType?.id, activeId]);

  useEffect(() => {
    if (!viewId || !selectedType || !savedViews.length) return;
    const view = savedViews.find((item) => item.id === viewId && item.typeId === selectedType.id);
    if (!view || appliedView.current === viewId) return;
    setQuery(view.query || ''); setRecordStatus(view.recordStatus || ''); setQuality(view.quality || ''); setSyncStatus(view.syncStatus || '');
    setChartFilter(view.chartFilter || null); setRangeFilter(view.rangeFilter || null); setSort(view.sort || { key: '__key', dir: 'asc' });
    if (Array.isArray(view.visibleKeys) && view.visibleKeys.length) setVisibleKeys(view.visibleKeys);
    appliedView.current = viewId;
  }, [viewId, selectedType?.id, savedViews]);

  useEffect(() => {
    if (!columnsOpen) return undefined;
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
      if (quality && item.quality_status !== quality) return false;
      if (syncStatus && item.sync_status !== syncStatus) return false;
      if (chartFilter && normalizeValue(item.properties?.[chartFilter.key]) !== normalizeValue(chartFilter.value)) return false;
      if (rangeFilter) {
        const value = Number(item.properties?.[rangeFilter.key]);
        if (!Number.isFinite(value) || value < rangeFilter.min || value > rangeFilter.max) return false;
      }
      if (!needle) return true;
      const text = Object.values(item.properties || {}).map(normalizeValue).join(' ');
      return `${item.title} ${item.business_key} ${item.source_system || ''} ${text}`.toLowerCase().includes(needle);
    });
  }, [typeInstances, query, recordStatus, quality, syncStatus, chartFilter, rangeFilter]);

  const sorted = useMemo(() => {
    const column = allColumns.find((item) => item.id === sort.key);
    const value = (instance) => {
      if (!column || column.kind === 'property') return instance.properties?.[column?.key] ?? '';
      if (column.kind === 'key') return instance.business_key;
      if (column.kind === 'title') return instance.title;
      return instance[column.key] ?? '';
    };
    return [...filtered].sort((left, right) => {
      const result = compareValues(value(left), value(right), column?.type);
      return sort.dir === 'asc' ? result : -result;
    });
  }, [filtered, sort, allColumns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, recordStatus, quality, syncStatus, chartFilter, rangeFilter, pageSize]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  const chartEnums = useMemo(() => (selectedType?.properties || []).filter((item) => item.type === 'enum' && item.options?.length).slice(0, 2), [selectedType]);
  const chartNumeric = useMemo(() => (selectedType?.properties || []).find((item) => item.type === 'decimal'), [selectedType]);
  const enumCharts = useMemo(() => chartEnums.map((property) => {
    const counts = typeInstances.reduce((result, instance) => {
      const value = normalizeValue(instance.properties?.[property.key]) || '空值';
      result[value] = (result[value] || 0) + 1;
      return result;
    }, {});
    return { property, options: Object.entries(counts).sort((a, b) => b[1] - a[1]) };
  }), [chartEnums, typeInstances]);
  const numericChart = useMemo(() => {
    if (!chartNumeric) return null;
    const values = typeInstances.map((item) => Number(item.properties?.[chartNumeric.key])).filter(Number.isFinite);
    if (!values.length) return null;
    const min = Math.min(...values); const max = Math.max(...values);
    const step = (max - min) / 4 || 1;
    return { property: chartNumeric, buckets: [0, 1, 2, 3, 4].map((index) => ({ min: min + index * step, max: index === 4 ? max : min + (index + 1) * step, count: values.filter((value) => value >= min + index * step && (index === 4 ? value <= max : value < min + (index + 1) * step)).length })) };
  }, [chartNumeric, typeInstances]);

  const selectedPreview = previewDetail || instances.find((item) => item.id === previewId) || null;
  const previewProperties = useMemo(() => {
    if (!selectedType) return [];
    const prominent = selectedType.properties.filter((item) => displayLevel(selectedType, item) === 'prominent');
    return (prominent.length ? prominent : selectedType.properties.filter((item) => displayLevel(selectedType, item) !== 'hidden')).slice(0, 4);
  }, [selectedType]);

  const setColumn = (id) => {
    const next = visibleKeys.includes(id) ? visibleKeys.filter((item) => item !== id) : [...visibleKeys, id];
    setVisibleKeys(next); writeJson(`object-explorer-columns:${activeId}:${typeId}`, next);
    if (sort.key === id) setSort({ key: '__key', dir: 'asc' });
  };
  const copyKey = async (record) => { try { await navigator.clipboard.writeText(record.business_key); notify?.('已复制业务主键'); } catch { notify?.('浏览器未允许复制'); } };
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
    const href = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = href; anchor.download = `${selectedType.display_name}-对象-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(href);
  };
  const saveView = () => {
    if (!selectedType) return;
    const name = window.prompt('给这个探索视图命名', `${selectedType.display_name} · ${new Date().toLocaleDateString('zh-CN')}`);
    if (!name) return;
    const view = { id: randomId(), name, typeId: selectedType.id, query, recordStatus, quality, syncStatus, chartFilter, rangeFilter, sort, visibleKeys, createdAt: new Date().toISOString() };
    const next = [view, ...savedViews].slice(0, 20); setSavedViews(next); writeJson(`object-explorer-views:${activeId}`, next); notify?.('探索视图已保存');
  };
  const toggleFavorite = (type) => { const next = favorites.includes(type.id) ? favorites.filter((id) => id !== type.id) : [...favorites, type.id]; setFavorites(next); writeJson(`object-explorer-favorites:${activeId}`, next); };

  const emptyProperties = (type, source = {}) => Object.fromEntries((type?.properties || []).map((item) => [item.key, source[item.key] ?? item.default ?? '']));
  const openCreate = () => { if (!selectedType) return; setForm({ ...emptyForm(), object_type_id: selectedType.id, properties: emptyProperties(selectedType) }); setEditing(null); setCreating(true); setFormError(''); };
  const openEdit = (record = objectDetail || previewDetail) => {
    if (!record || !selectedType) return;
    setForm({ ...emptyForm(), object_type_id: record.object_type_id, business_key: record.business_key, title: record.title, record_status: record.record_status, sync_status: record.sync_status, quality_status: record.quality_status, source_system: record.source_system || '', source_pk: record.source_pk || '', sync_error: record.sync_error || '', properties: emptyProperties(selectedType, record.properties) });
    setEditing(record); setCreating(false); setFormError('');
  };
  const closeForm = () => { if (busy) return; setCreating(false); setEditing(null); setFormError(''); };
  const changeFormType = (id) => { const type = types.find((item) => item.id === id); setForm({ ...form, object_type_id: id, business_key: '', title: '', properties: emptyProperties(type) }); };
  const changeProperty = (key, value) => setForm((old) => ({ ...old, properties: { ...old.properties, [key]: value } }));
  const formType = types?.find((item) => item.id === form.object_type_id);
  const formProperties = formType?.properties || [];
  const formVisibleProperties = formProperties.filter((item) => !item.is_primary_key && item.key !== 'source_system');
  const saveInstance = async (event) => {
    event.preventDefault();
    if (!form.business_key.trim()) { setFormError('请填写业务主键。'); return; }
    if (!form.title.trim()) { setFormError('请填写对象标题。'); return; }
    const missing = formVisibleProperties.filter((item) => item.is_required && (form.properties[item.key] === '' || form.properties[item.key] === undefined || form.properties[item.key] === null));
    if (missing.length) { setFormError(`请填写必填属性：${missing.map((item) => item.name).join('、')}`); return; }
    setBusy(true); setFormError('');
    try {
      const normalized = Object.fromEntries(formProperties.map((item) => {
        let raw = form.properties[item.key];
        if (item.is_primary_key && (raw === '' || raw === undefined || raw === null)) raw = form.business_key;
        if (item.key === 'source_system' && (raw === '' || raw === undefined || raw === null)) raw = form.source_system;
        if (raw === '' || raw === undefined || raw === null) return [item.key, ''];
        if (item.type === 'integer') return [item.key, Number.parseInt(raw, 10)];
        if (item.type === 'decimal') return [item.key, Number(raw)];
        if (item.type === 'boolean') return [item.key, raw === true || raw === 'true'];
        return [item.key, raw];
      }));
      const saved = await api(editing ? `/api/instances/${editing.id}` : `/api/ontologies/${activeId}/instances`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ ...form, properties: normalized, source_pk: form.source_pk || form.business_key }) });
      setBusy(false);
      setCreating(false); setEditing(null); setFormError('');
      const [objectTypes, records] = await Promise.all([api(`/api/ontologies/${activeId}/object-types?include_abstract=false`), api(`/api/ontologies/${activeId}/instances`)]);
      setTypes(objectTypes); setInstances(records); setPreviewId(saved.id); setPreviewDetail(saved);
      if (objectId) { const detail = await api(`/api/instances/${saved.id}`); setObjectDetail(detail); }
      refreshOntologies?.(activeId); notify?.(editing ? '对象已更新' : '对象已创建');
    } catch (cause) { setFormError(cause.message); } finally { setBusy(false); }
  };
  const removeInstance = async (record = objectDetail || previewDetail) => {
    if (!record || !window.confirm(`删除对象“${record.title}”及其关系吗？`)) return;
    try {
      await api(`/api/instances/${record.id}`, { method: 'DELETE' });
      setPreviewId(''); setPreviewDetail(null); setObjectDetail(null);
      const records = await api(`/api/ontologies/${activeId}/instances`); setInstances(records);
      if (objectId) backToExplore();
      refreshOntologies?.(activeId); notify?.('对象已删除');
    } catch (cause) { notify?.(cause.message); }
  };

  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!types) return <Loading />;

  if (objectId) {
    const record = objectDetail;
    const detailType = record ? types.find((item) => item.id === record.object_type_id) || selectedType : selectedType;
    if (!record) return <div className="ox-page"><div className="ox-empty"><LoaderCircle className="spin" size={22} /> 正在加载对象视图…</div></div>;
    return <ObjectView record={record} type={detailType} instances={instances} tab={objectTab} setTab={setObjectTab} onBack={backToExplore} onEdit={() => openEdit(record)} onDelete={() => removeInstance(record)} onOpen={(related) => { const target = instances.find((item) => item.id === related.related_instance_id); if (target) openObject(target); }} onCopy={copyKey} form={creating || editing ? <InstanceFormModal form={form} setForm={setForm} editing={editing} formType={formType} formVisibleProperties={formVisibleProperties} formProperties={formProperties} formError={formError} busy={busy} onChangeType={changeFormType} onChangeProperty={changeProperty} onClose={closeForm} onSubmit={saveInstance} /> : null} />;
  }

  if (!typeId) return <Home types={types} instances={instances} favorites={favorites} recent={recent} savedViews={savedViews} typeSearch={typeSearch} setTypeSearch={setTypeSearch} onOpenType={enterType} onToggleFavorite={toggleFavorite} onOpenView={(view) => updateParams({ type: view.typeId, view: view.id })} />;

  if (!selectedType) return <div className="ox-page"><div className="ox-empty"><Database size={26} /><strong>对象类型不存在</strong><button type="button" onClick={backToHome}>返回对象探索</button></div></div>;

  const preview = previewId ? (previewDetail || selectedPreview) : null;
  const hasFilters = Boolean(query || recordStatus || quality || syncStatus || chartFilter || rangeFilter);
  const clearFilters = () => { setQuery(''); setRecordStatus(''); setQuality(''); setSyncStatus(''); setChartFilter(null); setRangeFilter(null); };

  return <div className="ox-page ox-explore-page">
    <header className="ox-explore-head">
      <div className="ox-explore-title"><button type="button" className="ox-back" onClick={backToHome}><ChevronLeft size={16} /> 对象探索</button><i><ObjectTypeIcon value={selectedType.icon} size={22} /></i><div><h1>{selectedType.display_name}</h1><p><code>{selectedType.name}</code><span>{selectedType.business_domain_name || '未分类'} / {selectedType.subject_domain_name || '未分类'}</span><span>{selectedType.properties?.length || 0} 个属性</span><span>{typeInstances.length} 个对象</span></p></div></div>
      <div className="ox-explore-actions"><button type="button" onClick={saveView}><Sparkles size={14} /> 保存视图</button><div className="ix-columns-wrap"><button type="button" className={columnsOpen ? 'active' : ''} onClick={(event) => { event.stopPropagation(); setColumnsOpen((value) => !value); }}><Columns3 size={14} /> 列设置</button>{columnsOpen && <div className="ix-columns-popover" onClick={(event) => event.stopPropagation()}><header><div><strong>显示列</strong><small>按对象属性生成；隐藏属性可在探索中打开</small></div><button type="button" onClick={() => setColumnsOpen(false)}><X size={14} /></button></header><div className="ix-columns-scroll">{(selectedType.properties || []).map((item) => <label key={item.id || item.key}><input type="checkbox" checked={visibleKeys.includes(`prop:${item.key}`)} onChange={() => setColumn(`prop:${item.key}`)} /><span>{item.name}<small>{item.key}{displayLevel(selectedType, item) === 'hidden' ? ' · 隐藏' : ''}</small></span></label>)}<section><h4>系统信息</h4>{systemColumns.slice(1).map((column) => <label key={column.id}><input type="checkbox" checked={visibleKeys.includes(column.id)} onChange={() => setColumn(column.id)} /><span>{column.label}<small>{column.sub}</small></span></label>)}</section></div><footer><button type="button" onClick={() => { setVisibleKeys(defaultVisibleKeys); writeJson(`object-explorer-columns:${activeId}:${typeId}`, defaultVisibleKeys); }}>恢复默认</button><button type="button" className="primary" onClick={() => setColumnsOpen(false)}>完成</button></footer></div>}</div><button type="button" onClick={exportCsv} disabled={!sorted.length}><Download size={14} /> 导出</button><button type="button" className="primary" onClick={openCreate}><Plus size={14} /> 新建对象</button></div>
    </header>
    <div className="ox-explore-body">
      <aside className="ox-chart-rail">
        <header><div><BarChart3 size={15} /><strong>探索</strong></div><span>对象集 {filtered.length}</span></header>
        <div className="ox-chart-scroll">
          <section className="ox-single-stat"><small>当前对象集</small><b>{filtered.length}</b><span>共 {typeInstances.length} 个对象</span></section>
          {enumCharts.map(({ property, options }) => <section className="ox-chart" key={property.key}><header><span>{property.name}</span><small>{typeLabels[property.type] || property.type}</small></header>{options.map(([value, count]) => <button type="button" key={value} className={chartFilter?.key === property.key && chartFilter?.value === value ? 'active' : ''} onClick={() => setChartFilter((old) => old?.key === property.key && old?.value === value ? null : { key: property.key, value })}><span>{value}</span><i><b style={{ width: `${Math.max(4, (count / Math.max(...options.map(([, n]) => n), 1)) * 100)}%` }} /></i><em>{count}</em></button>)}</section>)}
          {numericChart && <section className="ox-chart"><header><span>{numericChart.property.name}</span><small>数值分布</small></header>{numericChart.buckets.map((bucket, bucketIndex) => <button type="button" key={`${bucket.min}-${bucket.max}`} className={rangeFilter?.key === numericChart.property.key && rangeFilter?.min === bucket.min ? 'active' : ''} onClick={() => setRangeFilter((old) => old?.key === numericChart.property.key && old?.min === bucket.min ? null : { key: numericChart.property.key, min: bucket.min, max: bucket.max })}><span>{bucketIndex === numericChart.buckets.length - 1 ? `≥ ${compactFormat.format(bucket.min)}` : `${compactFormat.format(bucket.min)}–${compactFormat.format(bucket.max)}`}</span><i><b style={{ width: `${Math.max(4, (bucket.count / Math.max(...numericChart.buckets.map((item) => item.count), 1)) * 100)}%` }} /></i><em>{bucket.count}</em></button>)}</section>}
          {!enumCharts.length && !numericChart && <p className="ox-chart-empty">当前对象没有可聚合的枚举或数值属性。</p>}
          {hasFilters && <button type="button" className="ox-clear" onClick={clearFilters}>清除全部筛选</button>}
        </div>
      </aside>
      <main className="ox-results">
        <div className="ox-explore-toolbar"><label className="ix-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主键、标题或任意属性值" /></label><select value={recordStatus} onChange={(event) => setRecordStatus(event.target.value)}><option value="">全部业务状态</option>{availableStatuses.map((value) => <option key={value}>{value}</option>)}</select><select value={quality} onChange={(event) => setQuality(event.target.value)}><option value="">全部质量状态</option>{availableQualities.map((value) => <option key={value} value={value}>{qualityLabels[value] || value}</option>)}</select><select value={syncStatus} onChange={(event) => setSyncStatus(event.target.value)}><option value="">全部同步状态</option>{availableSyncs.map((value) => <option key={value} value={value}>{syncLabels[value] || value}</option>)}</select><span className="ox-result-count">{sorted.length} 个对象</span></div>
        <div className="ox-results-table-wrap"><div className={`ix-table-wrap ${density}`}>
          {!sorted.length ? <div className="ix-empty"><SlidersHorizontal size={28} /><strong>{typeInstances.length ? '没有匹配的对象' : '这个对象类型还没有对象'}</strong><p>{typeInstances.length ? '调整搜索或探索筛选。' : '创建第一条对象后，结果表会按对象属性生成列。'}</p>{typeInstances.length ? <button type="button" onClick={clearFilters}>清除筛选</button> : <button type="button" className="primary" onClick={openCreate}><Plus size={14} /> 新建对象</button>}</div>
            : <table className="ix-table" style={{ minWidth: tableWidth, width: 'max-content' }}><colgroup>{columns.map((column) => <col key={column.id} style={{ width: column.width }} />)}</colgroup><thead><tr>{columns.map((column) => <th key={column.id} className={`${column.sticky ? `ix-sticky ix-sticky-${column.sticky}` : ''} ix-col-${column.kind}`}><button type="button" className="ix-th-button" onClick={() => setSort((old) => old.key === column.id ? { key: column.id, dir: old.dir === 'asc' ? 'desc' : 'asc' } : { key: column.id, dir: 'asc' })}><span>{column.label}{column.required && <em>*</em>}</span><small>{column.kind === 'property' ? `${column.sub} · ${typeLabels[column.type] || column.type}` : column.sub}</small>{sort.key === column.id ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="ix-sort-idle" />}</button></th>)}</tr></thead><tbody>{pageRows.map((record) => <tr key={record.id} className={previewId === record.id ? 'selected' : ''} onClick={() => { setPreviewId(record.id); setPreviewDetail(null); }} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') { setPreviewId(record.id); } }}>{columns.map((column) => <td key={column.id} className={`${column.sticky ? `ix-sticky ix-sticky-${column.sticky}` : ''} ix-col-${column.kind}`}>{column.kind === 'key' ? <span className="ix-key-cell"><code>{record.business_key}</code><button type="button" className="ix-copy" onClick={(event) => { event.stopPropagation(); copyKey(record); }}><Copy size={12} /></button></span> : column.kind === 'title' ? <button type="button" className="ox-object-link" onClick={(event) => { event.stopPropagation(); openObject(record); }}>{record.title}</button> : column.kind === 'status' ? <span className={`ix-badge ${statusTone(record.record_status)}`}>{record.record_status}</span> : column.kind === 'quality' ? <span className={`ix-badge ${statusTone(record.quality_status, 'quality')}`}>{qualityLabels[record.quality_status] || record.quality_status}</span> : column.kind === 'sync' ? <span className={`ix-badge ${statusTone(record.sync_status, 'sync')}`}>{syncLabels[record.sync_status] || record.sync_status}</span> : column.kind === 'source' ? <code className="ix-source">{record.source_system || '—'}</code> : column.kind === 'datetime' ? <span className="ix-date">{record[column.key] ? formatTime(record[column.key]) : '—'}</span> : <span className={`ix-value ${column.type || ''}`} title={normalizeValue(record.properties?.[column.key])}>{displayValue(record.properties?.[column.key], column.property)}</span>}</td>)}</tr>)}</tbody></table>}
        </div></div>
        <footer className="ix-footer"><span>{sorted.length ? `显示 ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, sorted.length)} / 共 ${sorted.length} 个对象` : '—'}</span><PaginationBar page={currentPage} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></footer>
      </main>
      {preview && <ObjectPreview record={preview} type={selectedType} properties={previewProperties} onClose={() => setPreviewId('')} onOpen={() => openObject(preview)} onEdit={() => openEdit(preview)} />}
    </div>
    {(creating || editing) && <InstanceFormModal form={form} setForm={setForm} editing={editing} formType={formType} formVisibleProperties={formVisibleProperties} formProperties={formProperties} formError={formError} busy={busy} onChangeType={changeFormType} onChangeProperty={changeProperty} onClose={closeForm} onSubmit={saveInstance} />}
  </div>;
}

function Home({ types, instances, favorites, recent, savedViews, typeSearch, setTypeSearch, onOpenType, onToggleFavorite, onOpenView }) {
  const query = typeSearch.trim().toLowerCase();
  const filtered = types.filter((type) => `${type.display_name} ${type.name} ${type.business_domain_name || ''} ${type.subject_domain_name || ''}`.toLowerCase().includes(query));
  const counts = instances.reduce((result, item) => ({ ...result, [item.object_type_id]: (result[item.object_type_id] || 0) + 1 }), {});
  const grouped = filtered.reduce((result, type) => { const group = type.business_domain_name || '未分类'; if (!result[group]) result[group] = []; result[group].push(type); return result; }, {});
  const favoriteTypes = types.filter((type) => favorites.includes(type.id));
  const recentTypes = recent.map((id) => types.find((type) => type.id === id)).filter(Boolean);
  return <div className="ox-page ox-home">
    <header className="ox-home-head"><div><small>本体数据 · 对象探索</small><h1>对象探索</h1><p>从对象类型出发，探索对象集，再进入单个对象视图。</p></div><label className="ox-home-search"><Search size={16} /><input value={typeSearch} onChange={(event) => setTypeSearch(event.target.value)} placeholder="搜索对象类型、业务域或主题域" /></label></header>
    <div className="ox-home-stats"><div><small>对象类型</small><b>{types.length}</b></div><div><small>对象总数</small><b>{instances.length}</b></div><div><small>已收藏</small><b>{favoriteTypes.length}</b></div><div><small>已保存探索</small><b>{savedViews.length}</b></div></div>
    {savedViews.length > 0 && <section className="ox-home-section"><header><div><Sparkles size={16} /><strong>已保存探索</strong></div><span>回到之前保存的筛选与列配置</span></header><div className="ox-saved-grid">{savedViews.map((view) => { const type = types.find((item) => item.id === view.typeId); return <button type="button" key={view.id} onClick={() => onOpenView(view)}><Sparkles size={15} /><span><b>{view.name}</b><small>{type?.display_name || '对象类型'} · {view.createdAt ? formatTime(view.createdAt) : ''}</small></span><ChevronRight size={14} /></button>; })}</div></section>}
    {recentTypes.length > 0 && <section className="ox-home-section"><header><div><RefreshCw size={16} /><strong>最近探索</strong></div></header><div className="ox-recent-row">{recentTypes.map((type) => <button type="button" key={type.id} onClick={() => onOpenType(type)}><i><ObjectTypeIcon value={type.icon} size={16} /></i><span>{type.display_name}</span><small>{counts[type.id] || 0}</small></button>)}</div></section>}
    {favoriteTypes.length > 0 && <section className="ox-home-section"><header><div><Star size={16} /><strong>收藏的对象类型</strong></div></header><div className="ox-type-grid ox-favorite-grid">{favoriteTypes.map((type) => <TypeCard key={type.id} type={type} count={counts[type.id] || 0} favorite onOpen={onOpenType} onFavorite={onToggleFavorite} />)}</div></section>}
    <div className="ox-home-groups">{Object.entries(grouped).map(([domain, items]) => <section className="ox-domain-group" key={domain}><header><div><span className="ox-domain-dot" /><h2>{domain}</h2><em>{items.length} 个对象类型</em></div></header><div className="ox-type-grid">{items.map((type) => <TypeCard key={type.id} type={type} count={counts[type.id] || 0} favorite={favorites.includes(type.id)} onOpen={onOpenType} onFavorite={onToggleFavorite} />)}</div></section>)}</div>
    {!filtered.length && <div className="ox-empty"><Search size={26} /><strong>没有匹配的对象类型</strong><p>换一个关键词试试。</p></div>}
  </div>;
}

function ObjectPreview({ record, type, properties, onClose, onOpen, onEdit }) {
  return <aside className="ox-preview"><header><div><i><ObjectTypeIcon value={record.object_type_icon} size={18} /></i><span><strong>{record.title}</strong><small>{record.business_key} · {record.object_type_display_name}</small></span></div><button type="button" onClick={onClose} aria-label="关闭预览"><X size={15} /></button></header><div className="ox-preview-body"><div className="ox-preview-status"><span className={`ix-badge ${statusTone(record.record_status)}`}>{record.record_status}</span><span className={`ix-badge ${statusTone(record.quality_status, 'quality')}`}>{qualityLabels[record.quality_status] || record.quality_status}</span><span className={`ix-badge ${statusTone(record.sync_status, 'sync')}`}>{syncLabels[record.sync_status] || record.sync_status}</span></div><div className="ox-prominent-grid">{properties.map((property) => <div key={property.key}><small>{property.name}</small><b>{displayValue(record.properties?.[property.key], property)}</b></div>)}</div><section className="ox-preview-props"><header><strong>属性</strong><span>{type.properties?.length || 0}</span></header>{type.properties.filter((property) => displayLevel(type, property) !== 'hidden').slice(0, 7).map((property) => <div key={property.key}><span>{property.name}</span><b>{displayValue(record.properties?.[property.key], property)}</b></div>)}</section>{record.related?.length > 0 && <section className="ox-preview-links"><header><strong>关联对象</strong><span>{record.related.length}</span></header>{record.related.slice(0, 4).map((item) => <div key={item.id}><i><ObjectTypeIcon value={item.related_object_icon} size={14} /></i><span>{item.related_title}<small>{item.link_display_name}</small></span></div>)}</section>}</div><footer><button type="button" className="primary" onClick={onOpen}>打开完整对象视图</button><button type="button" onClick={onEdit}><Pencil size={13} /> 编辑</button></footer></aside>;
}

function ObjectView({ record, type, instances, tab, setTab, onBack, onEdit, onDelete, onOpen, onCopy, form }) {
  const properties = type?.properties || [];
  const prominent = properties.filter((property) => displayLevel(type, property) === 'prominent').slice(0, 4);
  const normal = properties.filter((property) => displayLevel(type, property) === 'normal');
  const groups = normal.reduce((result, property) => { const group = property.property_category || '业务属性'; if (!result[group]) result[group] = []; result[group].push(property); return result; }, {});
  const relationGroups = (record.related || []).reduce((result, item) => { const group = item.link_display_name || '关联对象'; if (!result[group]) result[group] = []; result[group].push(item); return result; }, {});
  return <div className="ox-page ox-object-page"><header className="ox-object-head"><button type="button" className="ox-back" onClick={onBack}><ChevronLeft size={16} /> 返回探索</button><div className="ox-object-title"><i><ObjectTypeIcon value={record.object_type_icon} size={22} /></i><div><h1>{record.title}</h1><p><code>{record.business_key}</code><span>{type?.display_name || record.object_type_display_name}</span><span>{type?.business_domain_name || ''}{type?.subject_domain_name ? ` / ${type.subject_domain_name}` : ''}</span></p></div></div><div className="ox-object-actions"><ResourceHistoryLink resourceType="object_instance" resourceId={record.id} /><button type="button" onClick={() => onCopy(record)}><Copy size={14} /> 复制主键</button><button type="button" onClick={onEdit}><Pencil size={14} /> 编辑</button><button type="button" className="danger" onClick={onDelete}><Trash2 size={14} /></button></div></header><div className="ox-object-body"><div className="ox-prominent-hero">{prominent.map((property) => <div key={property.key}><small>{property.name}</small><b>{displayValue(record.properties?.[property.key], property)}</b><span>{property.key}</span></div>)}<div className="ox-object-state"><span className={`ix-badge ${statusTone(record.record_status)}`}>{record.record_status}</span><span className={`ix-badge ${statusTone(record.quality_status, 'quality')}`}>{qualityLabels[record.quality_status] || record.quality_status}</span><span className={`ix-badge ${statusTone(record.sync_status, 'sync')}`}>{syncLabels[record.sync_status] || record.sync_status}</span></div></div><nav className="ox-object-tabs"><button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>概览</button><button type="button" className={tab === 'relations' ? 'active' : ''} onClick={() => setTab('relations')}>关联对象 <em>{record.related?.length || 0}</em></button><button type="button" className={tab === 'runtime' ? 'active' : ''} onClick={() => setTab('runtime')}>运行与审计</button></nav>{tab === 'overview' && <div className="ox-object-overview"><div className="ox-object-main">{Object.entries(groups).map(([group, items]) => <section className="ox-property-group" key={group}><header><strong>{group}</strong><span>{items.length} 个属性</span></header>{items.map((property) => <div key={property.key}><span>{property.name}{property.is_required && <em>*</em>}</span><b>{displayValue(record.properties?.[property.key], property)}</b><code>{property.key}</code></div>)}</section>)}{!normal.length && <section className="ox-property-group"><header><strong>核心属性</strong><span>{prominent.length} 个属性</span></header>{prominent.map((property) => <div key={property.key}><span>{property.name}{property.is_required && <em>*</em>}</span><b>{displayValue(record.properties?.[property.key], property)}</b><code>{property.key}</code></div>)}</section>}</div><aside className="ox-object-aside"><section><header><strong>关联对象</strong><button type="button" onClick={() => setTab('relations')}>查看全部 {record.related?.length || 0}</button></header>{record.related?.length ? record.related.slice(0, 4).map((item) => <button type="button" key={item.id} onClick={() => onOpen(item)}><i><ObjectTypeIcon value={item.related_object_icon} size={14} /></i><span><b>{item.related_title}</b><small>{item.link_display_name}</small></span><ChevronRight size={12} /></button>) : <p>暂无关联对象</p>}</section><section><header><strong>对象信息</strong></header><div><span>业务主键</span><code>{record.business_key}</code></div><div><span>对象类型</span><b>{type?.display_name || record.object_type_display_name}</b></div><div><span>来源系统</span><b>{record.source_system || '手工录入'}</b></div><div><span>最近同步</span><b>{record.last_synced_at ? formatTime(record.last_synced_at) : '—'}</b></div><div><span>更新时间</span><b>{record.updated_at ? formatTime(record.updated_at) : '—'}</b></div></section></aside></div>}{tab === 'relations' && <div className="ox-object-relations"><header><strong>关联对象</strong><span>按关系类型分组</span></header>{record.related?.length ? Object.entries(relationGroups).map(([linkName, items]) => <section className="ox-relation-group" key={linkName}><h3>{linkName}<em>{items.length}</em></h3>{items.map((item) => <button type="button" key={item.id} className="ox-relation-row" onClick={() => onOpen(item)}><i><ObjectTypeIcon value={item.related_object_icon} size={16} /></i><span><b>{item.related_title}</b><small>{item.related_object_type} · {item.direction === 'outgoing' ? '出向' : '反向'}</small></span><ChevronRight size={14} /></button>)}</section>) : <p className="ox-empty-inline">该对象尚未建立关联对象。</p>}</div>}{tab === 'runtime' && <div className="ox-object-runtime"><section><h3>运行信息</h3><div><dt>业务主键</dt><dd><code>{record.business_key}</code></dd></div><div><dt>来源系统</dt><dd>{record.source_system || '手工录入'}</dd></div><div><dt>源系统主键</dt><dd><code>{record.source_pk || '—'}</code></dd></div><div><dt>最近同步</dt><dd>{record.last_synced_at ? formatTime(record.last_synced_at) : '—'}</dd></div><div><dt>创建时间</dt><dd>{record.created_at ? formatTime(record.created_at) : '—'}</dd></div><div><dt>更新时间</dt><dd>{record.updated_at ? formatTime(record.updated_at) : '—'}</dd></div></section>{record.sync_error && <div className="ox-sync-error"><AlertTriangle size={15} /><span><b>同步错误</b><small>{record.sync_error}</small></span></div>}</div>}</div>{form}</div>;
}

function InstanceFormModal({ form, setForm, editing, formType, formVisibleProperties, formProperties, formError, busy, onChangeType, onChangeProperty, onClose, onSubmit }) {
  return <Modal wide title={editing ? `编辑对象 · ${editing.title}` : '新建对象'} subtitle={editing ? '修改对象属性与运行状态' : `为「${formType?.display_name || '对象'}」创建一条对象`} onClose={onClose} footer={<><button type="button" className="btn secondary" onClick={onClose} disabled={busy}>取消</button><button type="submit" form="object-instance-form" className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存对象'}</button></>}><form id="object-instance-form" className="form-sections ix-form" noValidate onSubmit={onSubmit}>{formError && <div className="form-error-banner" role="alert">{formError}</div>}<section className="form-section"><div className="form-section-heading"><div><h3>对象标识</h3><p>对象类型决定字段结构；业务主键在类型内唯一。</p></div><span className="required-chip">必填</span></div><div className="form-grid two"><label><span>对象类型</span><select disabled={Boolean(editing)} value={form.object_type_id} onChange={(event) => onChangeType(event.target.value)}>{(formType ? [formType] : []).map((type) => <option key={type.id} value={type.id}>{type.display_name} · {type.name}</option>)}</select></label><label><span>业务主键</span><input className="mono" value={form.business_key} onChange={(event) => setForm({ ...form, business_key: event.target.value })} placeholder="业务唯一编号" /></label><label><span>对象标题</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="便于识别的对象名称" /></label><label><span>业务状态</span><select value={form.record_status} onChange={(event) => setForm({ ...form, record_status: event.target.value })}><option>有效</option><option>冻结</option><option>历史</option></select></label></div></section><section className="form-section"><div className="form-section-heading"><div><h3>对象属性</h3><p>{formVisibleProperties.length} 个可填属性{formVisibleProperties.filter((item) => item.is_required).length ? `，其中 ${formVisibleProperties.filter((item) => item.is_required).length} 个必填` : ''}。</p></div><span className="required-chip">* 必填</span></div>{formProperties.some((item) => item.is_primary_key) && <div className="ix-form-pk-note"><KeyRound size={13} /><span>主键属性 <b>{formProperties.filter((item) => item.is_primary_key).map((item) => `${item.name}（${item.key}）`).join('、')}</b> 自动使用业务主键。</span></div>}<div className="form-grid two ix-property-form">{formVisibleProperties.map((property) => <label key={property.key}><span>{property.name}{property.is_required && <em className="required-star"> *</em>}<em className="ix-prop-key">{property.key}</em></span>{property.type === 'enum' ? <select value={form.properties[property.key] ?? ''} onChange={(event) => onChangeProperty(property.key, event.target.value)}><option value="">请选择</option>{(property.options || []).map((option) => <option key={option}>{option}</option>)}</select> : property.type === 'boolean' ? <select value={String(form.properties[property.key] ?? '')} onChange={(event) => onChangeProperty(property.key, event.target.value)}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select> : <input type={property.type === 'decimal' || property.type === 'integer' ? 'number' : 'text'} step={property.type === 'decimal' ? 'any' : undefined} value={form.properties[property.key] ?? ''} onChange={(event) => onChangeProperty(property.key, event.target.value)} placeholder={property.description || ''} />}</label>)}</div></section><details className="ix-form-advanced"><summary>数据来源与运行状态（可选）</summary><div className="form-grid two"><label><span>同步状态</span><select value={form.sync_status} onChange={(event) => setForm({ ...form, sync_status: event.target.value })}>{Object.entries(syncLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>数据质量</span><select value={form.quality_status} onChange={(event) => setForm({ ...form, quality_status: event.target.value })}>{Object.entries(qualityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>来源系统</span><input value={form.source_system} onChange={(event) => setForm({ ...form, source_system: event.target.value })} placeholder="例如：SRC-PO" /></label><label><span>源系统主键</span><input className="mono" value={form.source_pk} onChange={(event) => setForm({ ...form, source_pk: event.target.value })} placeholder="默认同业务主键" /></label></div><label><span>同步错误</span><input value={form.sync_error} onChange={(event) => setForm({ ...form, sync_error: event.target.value })} placeholder="正常时留空" /></label></details></form></Modal>;
}
