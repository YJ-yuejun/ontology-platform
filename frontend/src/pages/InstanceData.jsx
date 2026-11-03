import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Columns3, Copy, Database, Download, KeyRound,
  LayoutList, LoaderCircle, Pencil, Plus, RefreshCw, Rows3, Search, SlidersHorizontal, Trash2, X,
  Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, ChevronLeft, CheckSquare, GitBranch, Link2, Save, Filter, Eye,
} from 'lucide-react';
import { api, formatTime } from '../api';
import Modal from '../components/Modal';
import PaginationBar from '../components/PaginationBar';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import { ObjectTypeIcon } from '../components/ObjectTypeIcon';
import { ErrorState, Loading } from '../components/StateViews';
import { instanceColumnValue, instanceCsvCell, normalizeInstanceProperties, orderInstanceColumns, readInstancePreference, writeInstancePreference } from '../instanceView';
import { InstanceEditor, InstanceColumnSettings, InstanceFilterEditor, InstanceComparison, InstancePropertyInput } from '../components/InstanceControls';
import { clampInstanceColumnWidth, compareInstanceValues, describeInstanceFilter, editableTitleProperty, instanceDefinitions, instanceModelIssues, isReadOnlyProperty, matchInstanceFilter } from '../instanceView';
import './InstanceData.css';

const syncLabels = { pending: '待同步', syncing: '同步中', synced: '已同步', failed: '同步失败', stale: '已过期', disabled: '未启用同步' };
const qualityLabels = { passed: '质量通过', warning: '质量警告', failed: '质量失败', unknown: '未评估' };
const typeLabels = { string: '文本', integer: '整数', decimal: '数值', boolean: '布尔', datetime: '日期时间', enum: '枚举' };
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 20 });
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

const emptyForm = () => ({
  object_type_id: '', business_key: '', title: '', properties: {}, record_status: '有效',
  sync_status: 'disabled', quality_status: 'unknown', source_system: '', source_pk: '', sync_error: '',
});

const getTypeName = (type) => type?.display_name || type?.name || '未选择对象';
const defaultVisibleKeys = (type) => [
  // 主键属性由“业务主键”列承载；来源系统由系统列承载，默认避免重复列。
  ...(type?.effective_properties || type?.properties || []).filter((item) => !item.is_primary_key && item.key !== 'source_system').map((item) => `prop:${item.key}`),
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
    return text.includes('T') && !Number.isNaN(Date.parse(text)) ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(text)) : text;
  }
  return String(value);
}

function statusTone(value, kind) {
  if (kind === 'quality') return value === 'passed' ? 'good' : value === 'failed' ? 'bad' : value === 'warning' ? 'warn' : 'neutral';
  if (kind === 'sync') return value === 'synced' ? 'good' : value === 'failed' ? 'bad' : value === 'pending' || value === 'syncing' || value === 'stale' ? 'warn' : 'neutral';
  return value === '有效' ? 'good' : value === '冻结' ? 'warn' : 'neutral';
}

export default function InstanceData({ activeId, chooseOntology, refreshOntologies, notify }) {
  const navigate = useNavigate();
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
  const [sorts, setSorts] = useState([{ key: '__key', dir: 'asc' }]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [density, setDensity] = useState(() => readInstancePreference('instance-density', 'compact'));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const loadRequest = useRef(0);
  const searchRef = useRef(null);
  const pageRef = useRef(null);
  const initialForm = useRef('');
  const resizeCleanup = useRef(null);
  const appliedHistoryFocus = useRef('');
  const typesBeforeFullscreen = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [typesCollapsed, setTypesCollapsed] = useState(false);
  const [widths, setWidths] = useState({});
  const [wrap, setWrap] = useState(false);
  const [freeze, setFreeze] = useState(true);
  const [propertyFilters, setPropertyFilters] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selection, setSelection] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [savedViews, setSavedViews] = useState([]);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingFormType, setPendingFormType] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [linkTypes, setLinkTypes] = useState([]);
  const [relationOpen, setRelationOpen] = useState(false);
  const [editingRelation, setEditingRelation] = useState(null);
  const [relationChoice, setRelationChoice] = useState('');
  const [relationTarget, setRelationTarget] = useState('');
  const [relationQuery, setRelationQuery] = useState('');
  const [relationProperties, setRelationProperties] = useState({});
  const [relationError, setRelationError] = useState('');
  const [unlinkTarget, setUnlinkTarget] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null);
  const formDirty = (creating || editing) && JSON.stringify(form) !== initialForm.current;


  const selectedType = types?.find((item) => item.id === selectedTypeId) || null;
  const propertyColumns = selectedType?.effective_properties || selectedType?.properties || [];
  const typeCounts = useMemo(() => instances.reduce((result, item) => ({ ...result, [item.object_type_id]: (result[item.object_type_id] || 0) + 1 }), {}), [instances]);
  const typeInstances = useMemo(() => instances.filter((item) => item.object_type_id === selectedTypeId), [instances, selectedTypeId]);
  const detailInstance = instances.find((item) => item.id === selectedId) || null;

  const systemColumns = useMemo(() => [
    { id: '__title', key: '__title', label: '实例标题', sub: 'title', kind: 'title', width: 230, sticky: 'title' },
    { id: 'sys:record_status', key: 'record_status', label: '记录状态', sub: 'record_status', kind: 'status', width: 100 },
    { id: 'sys:quality_status', key: 'quality_status', label: '质量状态', sub: 'quality_status', kind: 'quality', width: 100, property: { type: 'enum', options: Object.keys(qualityLabels), optionLabels: qualityLabels } },
    { id: 'sys:sync_status', key: 'sync_status', label: '同步状态', sub: 'sync_status', kind: 'sync', width: 100, property: { type: 'enum', options: Object.keys(syncLabels), optionLabels: syncLabels } },
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
  const columns = useMemo(() => orderInstanceColumns(allColumns, visibleKeys), [allColumns, visibleKeys]);
  const tableWidth = columns.reduce((total, column) => total + (widths[column.id] || column.width), 0);
  const columnStyle = (column) => ({ width: widths[column.id] || column.width, minWidth: widths[column.id] || column.width, ...(column.sticky && freeze ? { left: column.kind === 'key' ? 40 : 40 + (widths.__key || 170) } : {}) });

  const load = async (preferredId = '', preferredType = '') => {
    const request = ++loadRequest.current;
    setError('');
    setRefreshing(true);
    try {
      const [objectTypes, records, links] = await Promise.all([
        api(`/api/ontologies/${activeId}/object-types?include_abstract=false`),
        api(`/api/ontologies/${activeId}/instances`),
        api(`/api/ontologies/${activeId}/link-types`),
      ]);
      if (request !== loadRequest.current) return;
      setTypes(objectTypes); setLinkTypes(links);
      setInstances(records);
      const requested = preferredType || selectedTypeId || searchParams.get('type') || readInstancePreference(`instance-type:${activeId}`, '') || '';
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
      if (next) {
        const record = await api(`/api/instances/${next.id}`);
        if (request === loadRequest.current) setDetail(record);
      }
      if (!next) { setDetail(null); setDrawerOpen(false); }
    } catch (loadError) {
      if (request === loadRequest.current) setError(loadError.message);
    } finally { if (request === loadRequest.current) setRefreshing(false); }
  };

  useEffect(() => {
    setTypes(null); setSelectedTypeId(''); setSelectedId(''); setDetail(null); setDrawerOpen(false);
    const linkedOntology = searchParams.get('ontology');
    if (linkedOntology && linkedOntology !== activeId && chooseOntology) {
      let cancelled = false;
      api(`/api/ontologies/${linkedOntology}`).then(() => { if (!cancelled) chooseOntology(linkedOntology); }).catch((err) => { if (!cancelled) setError(`无法打开链接中的本体：${err.message}`); });
      return () => { cancelled = true; };
    }
    load();
    return () => { loadRequest.current += 1; };
  }, [activeId]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return undefined; }
    let cancelled = false;
    setDetail(null); setDetailError('');
    api(`/api/instances/${selectedId}`).then((record) => { if (!cancelled) setDetail(record); }).catch((err) => { if (!cancelled) setDetailError(err.message); });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    if (!types || !selectedTypeId) return;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('type', selectedTypeId);
      return next;
    }, { replace: true });
    writeInstancePreference(`instance-type:${activeId}`, selectedTypeId);
    const stored = readInstancePreference(`instance-columns:${activeId}:${selectedTypeId}`, readInstancePreference(`object-explorer-columns:${activeId}:${selectedTypeId}`, null));
    let next = defaultVisibleKeys(selectedType);
    if (Array.isArray(stored)) next = stored;
    setVisibleKeys(next);
    setPage(1);
    setSorts([{ key: '__key', dir: 'asc' }]);
    setRecordStatus(''); setQualityStatus(''); setSyncStatus(''); setQuery('');
    setColumnsOpen(false); setPropertyFilters([]); setSelection([]);
    const config = readInstancePreference(`instance-table:${activeId}:${selectedTypeId}`, {});
    setWidths(config.widths || {}); setWrap(Boolean(config.wrap)); setFreeze(config.freeze !== false);
    setSavedViews(readInstancePreference(`instance-views:${activeId}:${selectedTypeId}`, []));
  }, [selectedTypeId, activeId]);

  useEffect(() => {
    const requested = searchParams.get('type');
    if (requested && requested !== selectedTypeId && types?.some((type) => type.id === requested)) chooseType(requested);
  }, [searchParams]);

  useEffect(() => {
    if (!selectedTypeId) return;
    writeInstancePreference(`instance-table:${activeId}:${selectedTypeId}`, { widths, wrap, freeze });
  }, [widths, wrap, freeze]);
  useEffect(() => {
    if (!fullscreen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [fullscreen]);
  useEffect(() => {
    if (!formDirty) return;
    const leave = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [formDirty]);
  useEffect(() => () => resizeCleanup.current?.(), []);

  const availableStatuses = useMemo(() => [...new Set(typeInstances.map((item) => item.record_status).filter(Boolean))], [typeInstances]);
  const availableQualities = useMemo(() => [...new Set(typeInstances.map((item) => item.quality_status).filter(Boolean))], [typeInstances]);
  const availableSyncs = useMemo(() => [...new Set(typeInstances.map((item) => item.sync_status).filter(Boolean))], [typeInstances]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return typeInstances.filter((item) => {
      if (recordStatus && item.record_status !== recordStatus) return false;
      if (qualityStatus && item.quality_status !== qualityStatus) return false;
      if (syncStatus && item.sync_status !== syncStatus) return false;
      if (!propertyFilters.every((filter) => matchInstanceFilter(item, allColumns.find((column) => column.id === filter.column), filter))) return false;
      if (!needle) return true;
      const propertyText = Object.values(item.properties || {}).map(normalizeValue).join(' ');
      return `${item.title} ${item.business_key} ${item.source_system || ''} ${propertyText}`.toLowerCase().includes(needle);
    });
  }, [typeInstances, query, recordStatus, qualityStatus, syncStatus, propertyFilters, allColumns]);

  const sorted = useMemo(() => [...filtered].sort((left, right) => {
    for (const sort of sorts) {
      const column = allColumns.find((item) => item.id === sort.key);
      const result = compareInstanceValues(instanceColumnValue(left, column), instanceColumnValue(right, column), column?.type, sort.dir);
      if (result) return result;
    }
    return collator.compare(left.business_key, right.business_key);
  }), [filtered, sorts, allColumns]);

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
    setPage, ready: Boolean(types), onSelect: (record) => {
      if (appliedHistoryFocus.current !== record.id) { appliedHistoryFocus.current = record.id; openInstance(record); }
    },
  });

  useEffect(() => { setPage(1); }, [query, recordStatus, qualityStatus, syncStatus, pageSize, propertyFilters]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (document.querySelector('.modal[role="dialog"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  useEffect(() => { setSelection([]); }, [selectedTypeId, query, recordStatus, qualityStatus, syncStatus, propertyFilters]);
  useEffect(() => { setSelection((old) => old.filter((id) => instances.some((record) => record.id === id))); }, [instances]);
  useEffect(() => {
    if (!drawerOpen || !selectedId) return;
    const index = sorted.findIndex((record) => record.id === selectedId);
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1);
  }, [drawerOpen, selectedId, sorted, pageSize]);
  useEffect(() => {
    if (!types) return;
    const id = searchParams.get('object');
    const record = instances.find((item) => item.id === id);
    if (record && record.id !== selectedId) { openInstance(record); setDetailExpanded(true); }
    else if (id && !record) notify?.('链接中的实例不存在或不属于当前本体，请从列表选择实例。');
  }, [types, searchParams.get('object')]);
  useEffect(() => {
    const onEscape = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.modal[role="dialog"]') || creating || editing || deleteTarget || columnsOpen || filterOpen || saveViewOpen || compareOpen || relationOpen || unlinkTarget || inlineEdit) return;
      if (detailExpanded) setDetailExpanded(false);
      else if (drawerOpen) closeDrawer();
      else if (fullscreen) toggleFullscreen();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  });

  const toggleSort = (key, additive = false) => setSorts((old) => {
    const current = old.find((item) => item.key === key);
    const next = current?.dir === 'asc' ? { key, dir: 'desc' } : current?.dir === 'desc' ? null : { key, dir: 'asc' };
    const remaining = additive ? old.filter((item) => item.key !== key) : [];
    return next ? [next, ...remaining] : remaining;
  });
  const chooseType = (id) => {
    if (inlineEdit) return;
    setSearchParams((previous) => { const next = new URLSearchParams(previous); next.set('type', id); next.delete('object'); next.delete('from_history'); return next; }, { replace: true });
    setSelectedTypeId(id); setSelection([]); setDetailExpanded(false);
    setSelectedId(''); setDrawerOpen(false); setDetail(null);
    setPage(1);
  };
  const openInstance = (record) => {
    if (!record) return;
    if (searchParams.get('object') !== record.id || searchParams.get('type') !== record.object_type_id) {
      setSearchParams((previous) => { const next = new URLSearchParams(previous); next.set('ontology', activeId); next.set('type', record.object_type_id); next.set('object', record.id); return next; }, { replace: true });
    }
    if (record.object_type_id !== selectedTypeId) setSelectedTypeId(record.object_type_id);
    setSelectedId(record.id);
    if (record.id !== selectedId) setDetail(null);
    setDrawerOpen(true);
    setTab('attributes');
  };
  const selectRow = (record) => {
    openInstance(record);
  };
  const copyKey = async (record) => {
    try { await navigator.clipboard.writeText(record.business_key); notify?.('已复制业务主键'); }
    catch { notify?.('浏览器未允许复制，请手动选择主键'); }
  };
  const toggleColumn = (id) => {
    const next = visibleKeys.includes(id) ? visibleKeys.filter((item) => item !== id) : [...visibleKeys, id];
    setVisibleKeys(next);
    setSorts((old) => old.filter((item) => item.key !== id));
    writeInstancePreference(`instance-columns:${activeId}:${selectedTypeId}`, next);
  };
  const resetColumns = () => {
    const next = defaultVisibleKeys(selectedType);
    setVisibleKeys(next);
    writeInstancePreference(`instance-columns:${activeId}:${selectedTypeId}`, next);
  };
  const moveColumn = (id, direction) => {
    const next = columns.filter((column) => !['__key', '__title'].includes(column.id)).map((column) => column.id);
    const index = next.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setVisibleKeys(next);
    writeInstancePreference(`instance-columns:${activeId}:${selectedTypeId}`, next);
  };
  const toggleDensity = () => {
    const next = density === 'compact' ? 'comfortable' : 'compact';
    setDensity(next); writeInstancePreference('instance-density', next);
  };
  const clearFilters = () => { setQuery(''); setRecordStatus(''); setQualityStatus(''); setSyncStatus(''); setPropertyFilters([]); };
  const hasFilters = Boolean(query || recordStatus || qualityStatus || syncStatus || propertyFilters.length);
  const exportCsv = (selectedOnly = false) => {
    if (!selectedType || !columns.length) return;
    const header = columns.map((column) => column.label);
    const lines = sorted.filter((record) => !selectedOnly || selection.includes(record.id)).map((record) => columns.map((column) => {
      if (column.kind === 'key') return record.business_key;
      if (column.kind === 'title') return record.title;
      if (column.kind === 'status') return record.record_status;
      if (column.kind === 'quality') return qualityLabels[record.quality_status] || record.quality_status;
      if (column.kind === 'sync') return syncLabels[record.sync_status] || record.sync_status;
      if (column.kind === 'property') return record.properties?.[column.key] ?? '';
      return record[column.key] ?? '';
    }).map(instanceCsvCell).join(','));
    const blob = new Blob([`\uFEFF${[header.map(instanceCsvCell).join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${selectedType.display_name}-实例-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const emptyProperties = (type, source = {}) => Object.fromEntries((type?.effective_properties || type?.properties || []).map((item) => [item.key, source[item.key] ?? item.default ?? '']));
  const openCreate = () => {
    if (!types?.length) return;
    const type = selectedType || types[0];
    const next = { ...emptyForm(), object_type_id: type.id, properties: emptyProperties(type) };
    initialForm.current = JSON.stringify(next); setForm(next); setFieldErrors({});
    setEditing(null); setCreating(true); setFormError('');
  };
  const openEdit = (record = detail) => {
    if (!record?.id || !selectedType) return;
    const next = {
      ...emptyForm(), object_type_id: record.object_type_id, business_key: record.business_key, title: record.title,
      record_status: record.record_status, sync_status: record.sync_status, quality_status: record.quality_status,
      source_system: record.source_system || '', source_pk: record.source_pk || '', sync_error: record.sync_error || '',
      last_synced_at: record.last_synced_at, expected_updated_at: record.updated_at,
      ...Object.fromEntries(['external_id', 'source_summary', 'template_sheet', 'template_row'].map((key) => [key, record[key] ?? null])),
      properties: emptyProperties(selectedType, record.properties),
    };
    initialForm.current = JSON.stringify(next); setForm(next); setFieldErrors({});
    setEditing(record); setCreating(false); setFormError('');
  };
  const discardForm = () => { setCreating(false); setEditing(null); setFormError(''); setFieldErrors({}); setDiscardOpen(false); };
  const closeForm = () => { if (busy) return; if (formDirty) setDiscardOpen(true); else discardForm(); };
  const applyFormType = (id) => {
    const type = types.find((item) => item.id === id);
    const next = { ...emptyForm(), object_type_id: id, properties: emptyProperties(type) };
    initialForm.current = JSON.stringify(next); setForm(next); setFormError(''); setFieldErrors({}); setPendingFormType('');
  };
  const changeFormType = (id) => { if (formDirty) setPendingFormType(id); else applyFormType(id); };
  const changeProperty = (key, value) => { setFieldErrors((old) => ({ ...old, [key]: '' })); setForm((old) => ({ ...old, properties: { ...old.properties, [key]: value } })); };
  const currentFormType = types?.find((item) => item.id === form.object_type_id);
  const formProperties = currentFormType?.effective_properties || currentFormType?.properties || [];
  const formVisibleProperties = formProperties.filter((item) => !item.is_primary_key && item.key !== 'source_system');
  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    const titleProperty = editableTitleProperty(currentFormType);
    const title = titleProperty ? String(form.properties[titleProperty.key] ?? '').trim() : form.title.trim();
    const errors = {};
    if (!form.business_key.trim()) errors.business_key = '请填写业务主键';
    if (!title) errors[titleProperty?.key || 'title'] = '请填写实例标题';
    formVisibleProperties.filter((item) => !isReadOnlyProperty(item)).forEach((item) => {
      const value = form.properties[item.key];
      if (item.is_required && (value === '' || value === undefined || value === null || typeof value === 'string' && !value.trim())) errors[item.key] = `${item.name}为必填项`;
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setFormError(Object.values(errors).join('；')); return; }
    setBusy(true); setFormError('');
    try {
      const normalized = normalizeInstanceProperties(formProperties, form.properties, form.business_key.trim(), form.source_system);
      const payload = { ...form, business_key: form.business_key.trim(), title, properties: normalized, source_pk: form.source_pk || form.business_key.trim() };
      const saved = await api(editing ? `/api/instances/${editing.id}` : `/api/ontologies/${activeId}/instances`, {
        method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      setCreating(false); setEditing(null); setFieldErrors({});
      await load(saved.id, saved.object_type_id);
      openInstance(saved); setDetail(saved); setTab('attributes');
      refreshOntologies?.(activeId);
      notify?.(editing ? '实例已更新' : '实例已创建');
    } catch (saveError) {
      setFormError(saveError.message);
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true); setDeleteError('');
    try {
      await api(`/api/instances/${deleteTarget.id}?expected_updated_at=${encodeURIComponent(deleteTarget.updated_at)}`, { method: 'DELETE' });
      setDeleteTarget(null);
      closeDrawer(); setSelectedId(''); setDetail(null);
      await load('', selectedTypeId);
      refreshOntologies?.(activeId);
      notify?.('实例已删除');
    } catch (removeError) { setDeleteError(removeError.message); }
    finally { setBusy(false); }
  };
  const requestDelete = async (record) => {
    setDeleteError(''); setDeleteTarget({ ...record, loadingImpact: true });
    try {
      const latest = await api(`/api/instances/${record.id}`);
      setDeleteTarget((old) => old?.id === record.id ? { ...latest, loadingImpact: false } : old);
    } catch (err) { setDeleteError(err.message); }
  };
  const openRelated = (related) => {
    const record = instances.find((item) => item.id === related.related_instance_id);
    if (record) openInstance(record);
  };
  const closeDrawer = () => {
    setDrawerOpen(false); setDetailExpanded(false);
    if (searchParams.has('object')) setSearchParams((old) => { const next = new URLSearchParams(old); next.delete('object'); return next; }, { replace: true });
  };
  const toggleFullscreen = () => {
    if (fullscreen) { setFullscreen(false); setTypesCollapsed(typesBeforeFullscreen.current); }
    else { typesBeforeFullscreen.current = typesCollapsed; if (window.innerWidth < 980) setTypesCollapsed(true); setFullscreen(true); }
  };
  const changeWidth = (id, width) => setWidths((old) => ({ ...old, [id]: clampInstanceColumnWidth(width) }));
  const startResize = (event, column) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    resizeCleanup.current?.();
    const start = event.clientX, width = widths[column.id] || column.width;
    const move = (next) => changeWidth(column.id, width + next.clientX - start);
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); document.body.style.removeProperty('cursor'); };
    resizeCleanup.current = finish;
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true });
  };
  const reorderColumn = (source, target) => {
    const next = visibleKeys.filter((id) => id !== source);
    next.splice(next.indexOf(target), 0, source);
    setVisibleKeys(next); writeInstancePreference(`instance-columns:${activeId}:${selectedTypeId}`, next);
  };
  const toggleSelection = (id) => setSelection((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]);
  const selectedRecords = sorted.filter((record) => selection.includes(record.id));
  const allPageSelected = pageRows.length > 0 && pageRows.every((record) => selection.includes(record.id));
  const saveView = (event) => {
    event.preventDefault();
    if (!viewName.trim()) return;
    const view = { id: crypto.randomUUID(), name: viewName.trim(), query, recordStatus, qualityStatus, syncStatus, sorts, propertyFilters, visibleKeys, widths, freeze, wrap, pageSize };
    const next = [...savedViews, view];
    setSavedViews(next); const persisted = writeInstancePreference(`instance-views:${activeId}:${selectedTypeId}`, next); setSaveViewOpen(false); setViewName(''); notify?.(persisted ? '视图已保存到当前浏览器' : '浏览器未允许持久保存，视图已保留在本次会话');
  };
  const applyView = (id) => {
    const view = savedViews.find((item) => item.id === id);
    if (!view) return;
    setQuery(view.query || ''); setRecordStatus(view.recordStatus || ''); setQualityStatus(view.qualityStatus || ''); setSyncStatus(view.syncStatus || '');
    const validIds = new Set(allColumns.map((column) => column.id));
    const validFilters = (view.propertyFilters || []).filter((filter) => validIds.has(filter.column));
    setPropertyFilters(validFilters); setSorts((view.sorts || []).filter((sort) => validIds.has(sort.key))); setWidths(view.widths || {}); setWrap(Boolean(view.wrap)); setFreeze(view.freeze !== false);
    const keys = view.visibleKeys || defaultVisibleKeys(selectedType); setVisibleKeys(keys); writeInstancePreference(`instance-columns:${activeId}:${selectedTypeId}`, keys);
    setPageSize(view.pageSize || 20); setPage(1); notify?.(`已应用视图：${view.name}${validFilters.length !== (view.propertyFilters || []).length ? '；对象定义已变化，失效筛选已移除' : ''}`);
  };
  const relationOptions = linkTypes.flatMap((link) => [
    ...(link.source_object_type_id === selectedTypeId ? [{ key: `${link.id}:outgoing`, link, direction: 'outgoing', targetType: link.target_object_type_id, label: `${link.display_name} → ${getTypeName(types?.find((item) => item.id === link.target_object_type_id))}` }] : []),
    ...(link.target_object_type_id === selectedTypeId ? [{ key: `${link.id}:incoming`, link, direction: 'incoming', targetType: link.source_object_type_id, label: `← ${link.reverse_display_name || link.display_name} · ${getTypeName(types?.find((item) => item.id === link.source_object_type_id))}` }] : []),
  ]);
  const activeRelation = relationOptions.find((option) => option.key === relationChoice);
  const relationTargets = instances.filter((record) => record.object_type_id === activeRelation?.targetType && `${record.title} ${record.business_key}`.toLowerCase().includes(relationQuery.toLowerCase()));
  const saveRelation = async (event) => {
    event.preventDefault(); if (busy || !detail || !activeRelation || !relationTarget) return;
    setBusy(true); setRelationError('');
    try {
      const properties = normalizeInstanceProperties(activeRelation.link.properties || [], relationProperties, '', '');
      await api(editingRelation ? `/api/instance-links/${editingRelation.id}` : `/api/ontologies/${activeId}/instance-links`, { method: editingRelation ? 'PUT' : 'POST', body: JSON.stringify({ link_type_id: activeRelation.link.id, source_instance_id: activeRelation.direction === 'outgoing' ? detail.id : relationTarget, target_instance_id: activeRelation.direction === 'outgoing' ? relationTarget : detail.id, properties, expected_updated_at: editingRelation?.updated_at }) });
      setDetail(await api(`/api/instances/${detail.id}`)); setRelationOpen(false); notify?.(editingRelation ? '关系属性已更新' : '关联关系已建立');
    } catch (err) { setRelationError(err.message); } finally { setBusy(false); }
  };
  const unlinkRelation = async () => {
    if (!unlinkTarget || busy) return;
    setBusy(true); setRelationError('');
    try { await api(`/api/instance-links/${unlinkTarget.id}`, { method: 'DELETE' }); setDetail(await api(`/api/instances/${detail.id}`)); setUnlinkTarget(null); notify?.('已解除关联，双方实例保留'); }
    catch (err) { setRelationError(err.message); } finally { setBusy(false); }
  };
  const copyInstanceLink = async () => {
    const url = new URL(window.location.href);
    url.hash = `/ontology/data/instances?ontology=${activeId}&type=${selectedTypeId}&object=${selectedId}`;
    try { await navigator.clipboard.writeText(url.toString()); notify?.('实例链接已复制'); }
    catch { notify?.('浏览器未允许复制，请使用地址栏复制链接'); }
  };
  const saveInline = async (event) => {
    event.preventDefault(); if (!inlineEdit || busy) return;
    setBusy(true);
    try {
      const { record, column, value } = inlineEdit;
      if (column.property.is_required && (value === '' || value === null)) throw new Error(`${column.label}为必填项`);
      const properties = normalizeInstanceProperties(propertyColumns, { ...record.properties, [column.key]: value }, record.business_key, record.source_system);
      const titleProperty = editableTitleProperty(selectedType);
      const saved = await api(`/api/instances/${record.id}`, { method: 'PUT', body: JSON.stringify({ ...record, properties, title: titleProperty ? String(properties[titleProperty.key] || record.title) : record.title, expected_updated_at: record.updated_at }) });
      const remainsVisible = propertyFilters.every((filter) => matchInstanceFilter(saved, allColumns.find((item) => item.id === filter.column), filter));
      setInlineEdit(null); await load(saved.id, selectedTypeId); openInstance(saved); setDetail(saved); notify?.(`${column.label}已更新${remainsVisible ? '' : '；该实例不再符合当前属性筛选'}`);
    } catch (err) { setInlineEdit((old) => ({ ...old, error: err.message })); }
    finally { setBusy(false); }
  };

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!types) return <Loading />;
  const selectedTypeCount = selectedType ? typeCounts[selectedType.id] || 0 : 0;
  const qualityIssues = typeInstances.filter((item) => ['warning', 'failed'].includes(item.quality_status)).length;
  const syncIssues = typeInstances.filter((item) => ['pending', 'syncing', 'failed', 'stale'].includes(item.sync_status)).length;
  const modelIssues = instanceModelIssues(selectedType);
  const filteredTypes = types.filter((type) => `${type.display_name} ${type.name} ${type.business_domain_name || ''} ${type.subject_domain_name || ''}`.toLowerCase().includes(typeQuery.trim().toLowerCase()))
    .sort((left, right) => collator.compare(left.display_name, right.display_name));

  return <div ref={pageRef} className={`ix-page ${fullscreen ? 'ix-fullscreen' : ''} ${typesCollapsed ? 'ix-types-collapsed' : ''}`}>
    <header className="ix-page-head">
      <div><small>本体数据 · 业务实例</small><h1>实例</h1><p>选择对象类型，查看和维护实例数据；点击实例可查看属性、关系及来源信息。</p></div>
      <div className="ix-head-actions">
        <button type="button" aria-label={fullscreen ? '退出全屏' : '全屏查看实例'} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{fullscreen ? '退出全屏' : '全屏'}</button>
        <button type="button" disabled={refreshing} onClick={() => load(selectedId, selectedTypeId)}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /> {refreshing ? '刷新中…' : '刷新'}</button>
        <button type="button" className="primary" onClick={openCreate} disabled={!types.length}><Plus size={15} /> 新建实例</button>
      </div>
    </header>

    <div className="ix-shell">
      <aside className="ix-types" aria-label="对象类型目录">
        <header><div><LayoutList size={15} /><strong>对象类型</strong></div><span>{types.length} 类</span></header>
        <label className="ix-type-search"><Search size={14} /><input value={typeQuery} onChange={(event) => setTypeQuery(event.target.value)} placeholder="搜索类型、业务域或主题域" /></label>
        <div className="ix-type-list">
          {filteredTypes.map((type) => <button type="button" key={type.id} className={type.id === selectedTypeId ? 'active' : ''} aria-pressed={type.id === selectedTypeId} onClick={() => chooseType(type.id)}>
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
            <button className="ix-panel-toggle" aria-label={typesCollapsed ? '展开对象类型列表' : '收起对象类型列表'} onClick={() => setTypesCollapsed((value) => !value)}>{typesCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
            <i>{selectedType ? <ObjectTypeIcon value={selectedType.icon} size={22} /> : <Database size={22} />}</i>
            <div><h2>{selectedType ? getTypeName(selectedType) : '选择对象类型'}</h2><p>{selectedType ? <><code>{selectedType.name}</code><span>{selectedType.business_domain_name || '未分类'} / {selectedType.subject_domain_name || '未分类'}</span><span>{propertyColumns.length} 个属性</span></> : '从左侧选择对象类型开始浏览'}</p></div>
            <em className="ix-type-count">{selectedTypeCount} 条实例</em>
          </div>
          <div className="ix-type-actions">
            <button type="button" disabled={!selectedType} onClick={() => navigate(`/ontology/model/object-types?focus=${selectedType.id}`)} title="查看对象类型定义"><SlidersHorizontal size={15} /> 类型配置</button>
            <div className="ix-columns-wrap">
              <button type="button" disabled={!selectedType} aria-expanded={columnsOpen} className={columnsOpen ? 'active' : ''} onClick={(event) => { event.stopPropagation(); setColumnsOpen((value) => !value); }}><Columns3 size={15} /> 列设置</button>

            </div>
            <button type="button" disabled={!sorted.length} onClick={() => exportCsv(false)}><Download size={15} /> 导出</button>
            <button type="button" onClick={toggleDensity} aria-label="切换行密度" aria-pressed={density === 'comfortable'} title={density === 'compact' ? '切换为舒适行高' : '切换为紧凑行高'}>{density === 'compact' ? <Rows3 size={15} /> : <LayoutList size={15} />}</button>
          </div>
        </header>

        {modelIssues.length > 0 && <details className="ix-model-notice"><summary><AlertTriangle size={13} /> 对象定义有 {modelIssues.length} 项配置建议</summary><ul>{modelIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul><button onClick={() => navigate(`/ontology/model/object-types?focus=${selectedType.id}`)}>查看对象类型配置</button></details>}
        <div className="ix-stat-strip">
          <div><small>当前对象实例</small><b>{selectedTypeCount}</b></div>
          <div><small>属性列</small><b>{propertyColumns.length}</b></div>
          <div className={qualityIssues ? 'warn' : ''}><small>质量异常</small><b>{qualityIssues}</b></div>
          <div className={syncIssues ? 'warn' : ''}><small>同步异常</small><b>{syncIssues}</b></div>
        </div>

        <div className="ix-toolbar">
          <label className="ix-search"><Search size={15} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主键、标题或任意属性值" /><kbd>⌘ K</kbd></label>
          <select value={recordStatus} onChange={(event) => setRecordStatus(event.target.value)} aria-label="按记录状态筛选"><option value="">全部记录状态</option>{availableStatuses.map((value) => <option key={value}>{value}</option>)}</select>
          <select value={qualityStatus} onChange={(event) => setQualityStatus(event.target.value)} aria-label="按质量状态筛选"><option value="">全部质量状态</option>{availableQualities.map((value) => <option key={value} value={value}>{qualityLabels[value] || value}</option>)}</select>
          <select value={syncStatus} onChange={(event) => setSyncStatus(event.target.value)} aria-label="按同步状态筛选"><option value="">全部同步状态</option>{availableSyncs.map((value) => <option key={value} value={value}>{syncLabels[value] || value}</option>)}</select>
          <button className="ix-filter-button" disabled={!selectedType} onClick={() => setFilterOpen(true)}><Filter size={14} /> 属性筛选{propertyFilters.length ? ` (${propertyFilters.length})` : ''}</button>
          <button className="ix-filter-button" disabled={!selectedType} onClick={() => { setViewName(''); setSaveViewOpen(true); }}><Save size={14} /> 保存视图</button>
          {savedViews.length > 0 && <select aria-label="已保存视图" value="" onChange={(event) => applyView(event.target.value)}><option value="">已保存视图</option>{savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select>}
          {hasFilters && <button type="button" className="ix-clear" onClick={clearFilters}>清空筛选</button>}
          <span className="ix-result-count">{sorted.length} 条{hasFilters ? ` / 全部 ${typeInstances.length}` : ''}</span>
        </div>

        {propertyFilters.length > 0 && <div className="ix-filter-chips">{propertyFilters.map((filter) => <button key={filter.id} onClick={() => setPropertyFilters((old) => old.filter((item) => item.id !== filter.id))}>{describeInstanceFilter(filter, allColumns.find((column) => column.id === filter.column))}<X size={12} /></button>)}</div>}
        {selection.length > 0 && <div className="ix-selection-bar"><span><CheckSquare size={15} /> 已选择 {selectedRecords.length} 条实例</span><button onClick={() => setSelection([])}>取消选择</button><button disabled={selectedRecords.length < 2 || selectedRecords.length > 4} title="选择 2—4 条实例对比" onClick={() => setCompareOpen(true)}>对比属性</button><button onClick={() => exportCsv(true)}>导出所选</button><small>切换类型或筛选时清空选择</small></div>}
        <div className={`ix-table-wrap ${density} ${wrap ? 'ix-wrap-text' : ''} ${freeze ? '' : 'ix-unfrozen'}`}>
          {!selectedType ? <div className="ix-empty"><Database size={28} /><strong>选择对象类型</strong><p>从左侧列表选择类型后开始查看实例。</p></div> : <table className="ix-table" style={{ minWidth: tableWidth + 144, width: '100%' }}>
            <colgroup><col style={{ width: 40 }} />{columns.map((column) => <col key={column.id} style={{ width: widths[column.id] || column.width }} />)}<col style={{ width: 104 }} /></colgroup>
            <thead><tr><th className="ix-select-cell"><input aria-label="选择本页全部实例" type="checkbox" checked={allPageSelected} disabled={!pageRows.length} onChange={() => setSelection((old) => allPageSelected ? old.filter((id) => !pageRows.some((record) => record.id === id)) : [...new Set([...old, ...pageRows.map((record) => record.id)])])} /></th>{columns.map((column) => { const sort = sorts.find((item) => item.key === column.id); return <th key={column.id} style={columnStyle(column)} className={`${column.sticky ? `ix-sticky ix-sticky-${column.sticky}` : ''} ix-col-${column.kind}`} scope="col" aria-sort={sort ? sort.dir === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="ix-th-button" onClick={(event) => toggleSort(column.id, event.shiftKey)} title={`按${column.label}排序；再次点击切换降序或取消，Shift 点击添加排序`}><span>{column.label}{column.required && <em>*</em>}</span><small>{column.kind === 'property' ? `${column.sub} · ${typeLabels[column.type] || column.type}` : column.sub}</small>{sort ? <>{sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{sorts.length > 1 && <em>{sorts.indexOf(sort) + 1}</em>}</> : <ArrowUpDown size={12} className="ix-sort-idle" />}</button><span role="separator" tabIndex={0} aria-label={`调整${column.label}列宽`} aria-orientation="vertical" aria-valuenow={widths[column.id] || column.width} aria-valuemin={100} aria-valuemax={600} className="ix-column-resizer" title="拖动调整列宽；可用左右方向键微调" onPointerDown={(event) => startResize(event, column)} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); changeWidth(column.id, (widths[column.id] || column.width) + (event.key === 'ArrowRight' ? 10 : -10)); } }} /></th>; })}<th className="ix-row-actions" scope="col">操作</th></tr></thead>
            <tbody>{pageRows.length ? pageRows.map((record) => <tr key={record.id} className={selectedId === record.id || selection.includes(record.id) ? 'selected' : ''} onClick={() => selectRow(record)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) selectRow(record); }}>
              <td className="ix-select-cell" onClick={(event) => event.stopPropagation()}><input aria-label={`选择${record.title}`} type="checkbox" checked={selection.includes(record.id)} onChange={() => toggleSelection(record.id)} /></td>
              {columns.map((column) => <td key={column.id} style={columnStyle(column)} className={`${column.sticky ? `ix-sticky ix-sticky-${column.sticky}` : ''} ix-col-${column.kind}`}>
                {column.kind === 'key' ? <span className="ix-key-cell"><code>{record.business_key}</code><button type="button" className="ix-copy" title="复制业务主键" onClick={(event) => { event.stopPropagation(); copyKey(record); }}><Copy size={12} /></button></span>
                  : column.kind === 'title' ? <button className="ix-title-cell ix-title-link" onClick={(event) => { event.stopPropagation(); openInstance(record); setDetailExpanded(true); }}><b>{record.title}</b><small>{record.source_system || '手工录入'}</small></button>
                  : column.kind === 'status' ? <span className={`ix-badge ${statusTone(record.record_status)}`}>{record.record_status || '—'}</span>
                  : column.kind === 'quality' ? <span className={`ix-badge ${statusTone(record.quality_status, 'quality')}`}>{qualityLabels[record.quality_status] || record.quality_status || '—'}</span>
                  : column.kind === 'sync' ? <span className={`ix-badge ${statusTone(record.sync_status, 'sync')}`}>{syncLabels[record.sync_status] || record.sync_status || '—'}</span>
                  : column.kind === 'source' ? <code className="ix-source">{record.source_system || '—'}</code>
                  : column.kind === 'datetime' ? <span className="ix-date">{record[column.key] ? formatTime(record[column.key]) : '—'}</span>
                  : <span className="ix-property-cell"><span className={`ix-value ${column.type || ''}`} title={normalizeValue(record.properties?.[column.key])}>{displayValue(record.properties?.[column.key], column.property)}</span>{!column.property.is_primary_key && column.key !== 'source_system' && !isReadOnlyProperty(column.property) && <button className="ix-cell-edit" title="修改此属性" aria-label={`修改${record.title}的${column.label}`} onClick={(event) => { event.stopPropagation(); setInlineEdit({ record, column, value: record.properties?.[column.key] ?? '', error: '' }); }}><Pencil size={12} /></button>}</span>}
              </td>)}
              <td className="ix-row-actions"><button type="button" title="编辑实例" aria-label={`编辑${record.title}`} onClick={(event) => { event.stopPropagation(); openEdit(record); }}><Pencil size={14} /></button><button type="button" className="danger" title="删除实例" aria-label={`删除${record.title}`} onClick={(event) => { event.stopPropagation(); requestDelete(record); }}><Trash2 size={14} /></button></td>
            </tr>) : <tr><td colSpan={columns.length + 2} className="ix-empty-cell"><div className="ix-empty"><Database size={28} /><strong>{typeInstances.length ? '没有匹配的实例' : '这个对象类型还没有实例'}</strong><p>{typeInstances.length ? '调整或清空筛选条件后重试。' : '创建第一条实例，或在数据映射中配置数据来源。'}</p>{typeInstances.length ? <button onClick={clearFilters}>清空筛选</button> : <button onClick={openCreate}><Plus size={14} /> 新建实例</button>}</div></td></tr>}</tbody>
          </table>}
        </div>

        <footer className="ix-footer"><span>{selectedType ? `显示 ${sorted.length ? (currentPage - 1) * pageSize + 1 : 0}–${Math.min(currentPage * pageSize, sorted.length)} / 共 ${sorted.length} 条` : '—'}</span><PaginationBar page={currentPage} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></footer>
      </main>
    </div>

    {drawerOpen && selectedInstance && <aside className={`ix-drawer ${detailExpanded ? 'ix-detail-expanded' : ''}`} aria-label="实例详情">
      <header><div><i><ObjectTypeIcon value={selectedInstance.object_type_icon} size={20} /></i><span><strong>{selectedInstance.title}</strong><small>{selectedInstance.business_key} · {selectedInstance.object_type_display_name}</small></span></div><div><ResourceHistoryLink resourceType="object_instance" resourceId={selectedInstance.id} /><button type="button" aria-label={detailExpanded ? '收起完整详情' : '放大实例详情'} onClick={() => setDetailExpanded((value) => !value)}>{detailExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button><button type="button" className="ix-drawer-close" aria-label="关闭详情" onClick={closeDrawer}><X size={17} /></button></div></header>
      {detailError ? <div className="ix-drawer-loading" role="alert">{detailError}<button type="button" onClick={() => { setSelectedId(''); setDrawerOpen(false); }}>关闭详情</button></div> : !detail || detail.id !== selectedId ? <div className="ix-drawer-loading"><LoaderCircle className="spin" size={18} /> 加载实例详情…</div> : <>
        <div className="ix-detail-navigation"><button disabled={sorted.findIndex((record) => record.id === selectedId) <= 0} onClick={() => openInstance(sorted[sorted.findIndex((record) => record.id === selectedId) - 1])}><ChevronLeft size={14} /> 上一条</button><span>{sorted.findIndex((record) => record.id === selectedId) >= 0 ? `${sorted.findIndex((record) => record.id === selectedId) + 1} / ${sorted.length}` : '关联实例'}</span><button disabled={sorted.findIndex((record) => record.id === selectedId) < 0 || sorted.findIndex((record) => record.id === selectedId) >= sorted.length - 1} onClick={() => openInstance(sorted[sorted.findIndex((record) => record.id === selectedId) + 1])}>下一条 <ChevronRight size={14} /></button><button onClick={copyInstanceLink}><Link2 size={14} /> 复制链接</button></div>
        <div className="ix-drawer-status"><span className={`ix-badge ${statusTone(detail.record_status)}`}>{detail.record_status}</span><span className={`ix-badge ${statusTone(detail.quality_status, 'quality')}`}>{qualityLabels[detail.quality_status] || detail.quality_status}</span><span className={`ix-badge ${statusTone(detail.sync_status, 'sync')}`}>{syncLabels[detail.sync_status] || detail.sync_status}</span><code>{detail.source_system || '手工录入'}</code></div>
        <nav className="ix-drawer-tabs"><button type="button" className={tab === 'attributes' ? 'active' : ''} onClick={() => setTab('attributes')}>属性 <em>{propertyColumns.length}</em></button><button type="button" className={tab === 'relations' ? 'active' : ''} onClick={() => setTab('relations')}>关系 <em>{detail.related?.length || 0}</em></button><button type="button" className={tab === 'runtime' ? 'active' : ''} onClick={() => setTab('runtime')}>运行信息</button></nav>
        <div className="ix-drawer-body">
          {tab === 'attributes' && <>{selectedPropertyGroups.map(([group, properties]) => <section className="ix-attribute-group" key={group}><h4>{group}</h4>{properties.map((property) => <div className="ix-attribute-row" key={property.key}><span>{property.name}{property.is_primary_key && <em className="ix-pk">主键</em>}{property.is_required && <em className="ix-required">*</em>}</span><b>{displayValue(detail.properties?.[property.key], property)}</b><code>{property.key}</code></div>)}</section>)}{!propertyColumns.length && <p className="ix-drawer-empty">该对象类型还没有属性定义。</p>}</>}
          {tab === 'relations' && <><div className="ix-relation-toolbar"><span>按照关系类型与方向查看关联实例</span><button disabled={!relationOptions.length} onClick={() => { setEditingRelation(null); setRelationChoice(relationOptions[0]?.key || ''); setRelationTarget(''); setRelationProperties({}); setRelationError(''); setRelationQuery(''); setRelationOpen(true); }}><Plus size={14} /> 建立关联</button></div>{detail.related?.length ? <div className="ix-relations">{detail.related.map((item) => <div className="ix-relation-item" key={item.id}><button type="button" onClick={() => openRelated(item)}><i><ObjectTypeIcon value={item.related_object_icon} size={16} /></i><span><b>{item.related_title}</b><small>{item.direction === 'outgoing' ? '→' : '←'} {item.link_display_name} · {item.related_object_type}</small>{Object.keys(item.properties || {}).length > 0 && <small>{Object.entries(item.properties).map(([key, value]) => `${linkTypes.find((link) => link.id === item.link_type_id)?.properties?.find((property) => property.key === key)?.name || key}：${normalizeValue(value)}`).join(' · ')}</small>}</span><ChevronRight size={14} /></button><button className="ix-unlink" aria-label={`编辑与${item.related_title}的关系属性`} disabled={!linkTypes.find((link) => link.id === item.link_type_id)?.properties?.length} onClick={() => { setEditingRelation(item); setRelationChoice(`${item.link_type_id}:${item.direction}`); setRelationTarget(item.related_instance_id); setRelationProperties(item.properties || {}); setRelationError(''); setRelationQuery(''); setRelationOpen(true); }}><Pencil size={14} /></button><button className="ix-unlink" aria-label={`解除与${item.related_title}的关联`} onClick={() => { setUnlinkTarget(item); setRelationError(''); }}><X size={14} /></button></div>)}</div> : <p className="ix-drawer-empty">{relationOptions.length ? '该实例尚无关联，可从已定义的关系类型建立。' : '当前对象类型尚未定义关系，请先配置关系类型。'}</p>}</>}

          {tab === 'runtime' && <section className="ix-runtime"><div><span>业务主键</span><code>{detail.business_key}</code></div><div><span>来源系统</span><b>{detail.source_system || '手工录入'}</b></div><div><span>源系统主键</span><code>{detail.source_pk || '—'}</code></div><div><span>最近同步</span><b>{detail.last_synced_at ? formatTime(detail.last_synced_at) : '—'}</b></div><div><span>创建时间</span><b>{detail.created_at ? formatTime(detail.created_at) : '—'}</b></div><div><span>更新时间</span><b>{detail.updated_at ? formatTime(detail.updated_at) : '—'}</b></div>{detail.sync_error && <div className="ix-sync-error"><AlertTriangle size={14} /><span><b>同步错误</b><small>{detail.sync_error}</small></span></div>}</section>}
        </div>
        <footer className="ix-drawer-foot"><button type="button" className="primary" onClick={() => openEdit(detail)}><Pencil size={14} /> 编辑实例</button><button type="button" className="danger" onClick={() => requestDelete(detail)}><Trash2 size={14} /> 删除</button><button type="button" onClick={() => copyKey(detail)}><Copy size={14} /> 复制主键</button></footer>
      </>}
    </aside>}

    {deleteTarget && <Modal title="删除实例" subtitle={getTypeName(selectedType)} onClose={() => !busy && setDeleteTarget(null)} footer={<><button type="button" className="btn secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button><button type="button" className="btn danger" disabled={busy || deleteTarget.loadingImpact || Boolean(deleteError)} onClick={remove}>{busy ? '删除中…' : '确认删除'}</button></>}>
      <div className="ix-delete-confirm"><AlertTriangle size={24} /><div><p>确定删除实例 <strong>{deleteTarget.title}</strong> 吗？</p><code>{deleteTarget.business_key}</code><p>{deleteTarget.loadingImpact ? '正在检查关联影响…' : `将删除该实例及 ${deleteTarget.related?.length || 0} 条关联关系；关联的其他实例保留。此操作无法撤销。`}</p></div></div>{deleteError && <div className="form-error-banner" role="alert">{deleteError}</div>}
    </Modal>}

    {columnsOpen && <InstanceColumnSettings allColumns={allColumns} columns={columns} visibleKeys={visibleKeys} widths={widths} freeze={freeze} wrap={wrap} onFreeze={setFreeze} onWrap={setWrap} onToggle={toggleColumn} onMove={moveColumn} onReorder={reorderColumn} onWidth={changeWidth} onReset={() => { resetColumns(); setWidths({}); setWrap(false); setFreeze(true); }} onClose={() => setColumnsOpen(false)} />}
    {filterOpen && <InstanceFilterEditor columns={allColumns} filters={propertyFilters} onApply={setPropertyFilters} onClose={() => setFilterOpen(false)} />}
    {compareOpen && <InstanceComparison records={selectedRecords} type={selectedType} display={displayValue} onClose={() => setCompareOpen(false)} />}
    {saveViewOpen && <Modal title="保存实例视图" subtitle="保存当前筛选、排序、显示列及列宽；仅在当前浏览器使用" onClose={() => setSaveViewOpen(false)} footer={<><button className="btn secondary" onClick={() => setSaveViewOpen(false)}>取消</button><button className="btn primary" form="instance-save-view" disabled={!viewName.trim()}>保存视图</button></>}><form id="instance-save-view" onSubmit={saveView}><label className="ix-view-name">视图名称<input autoFocus maxLength={80} value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="例如：待核对的大额合同" /></label></form>{savedViews.length > 0 && <div className="ix-saved-views"><h4>已保存视图</h4>{savedViews.map((view) => <div key={view.id}><span>{view.name}</span><button aria-label={`删除视图${view.name}`} onClick={() => { const next = savedViews.filter((item) => item.id !== view.id); setSavedViews(next); writeInstancePreference(`instance-views:${activeId}:${selectedTypeId}`, next); }}><Trash2 size={14} /></button></div>)}</div>}</Modal>}
    {inlineEdit && <Modal title={`修改属性 · ${inlineEdit.column.label}`} subtitle={inlineEdit.record.title} closeOnBackdrop={false} onClose={() => !busy && setInlineEdit(null)} footer={<><button className="btn secondary" disabled={busy} onClick={() => setInlineEdit(null)}>取消</button><button className="btn primary" form="instance-inline-edit" disabled={busy}>{busy ? '保存中…' : '保存修改'}</button></>}><form id="instance-inline-edit" className="ix-inline-form" onSubmit={saveInline}>{inlineEdit.error && <p className="form-error-banner" role="alert">{inlineEdit.error}</p>}<label><span>{inlineEdit.column.label}</span><InstancePropertyInput property={inlineEdit.column.property} value={inlineEdit.value} disabled={busy} onChange={(value) => setInlineEdit((old) => ({ ...old, value, error: '' }))} /></label><p>保存时会校验实例版本、属性类型与唯一性。</p></form></Modal>}
    {relationOpen && <Modal wide title={editingRelation ? '编辑关系属性' : '建立实例关联'} subtitle={detail?.title} onClose={() => !busy && setRelationOpen(false)} footer={<><button className="btn secondary" disabled={busy} onClick={() => setRelationOpen(false)}>取消</button><button className="btn primary" disabled={busy || !relationTarget} form="instance-link-form">{busy ? '保存中…' : editingRelation ? '保存关系属性' : '建立关联'}</button></>}><form id="instance-link-form" className="ix-relation-form" onSubmit={saveRelation}>{relationError && <p role="alert" className="form-error-banner">{relationError}</p>}<label>关系类型与方向<select aria-label="关系类型与方向" value={relationChoice} disabled={busy || Boolean(editingRelation)} onChange={(event) => { setRelationChoice(event.target.value); setRelationTarget(''); setRelationProperties({}); setRelationError(''); }}>{relationOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label><p>将按关系类型定义检查起终点及基数；重复关联不会重复创建。</p><label>搜索关联实例<input value={relationQuery} onChange={(event) => setRelationQuery(event.target.value)} placeholder="按实例标题或业务主键搜索" /></label><div className="ix-relation-targets">{relationTargets.map((record) => <label key={record.id}><input type="radio" name="relation-target" checked={relationTarget === record.id} onChange={() => setRelationTarget(record.id)} disabled={busy || Boolean(editingRelation)} /><span>{record.title}<code>{record.business_key}</code></span></label>)}{!relationTargets.length && <p>没有匹配的目标实例，请先创建实例或调整搜索条件。</p>}</div>{(activeRelation?.link.properties || []).map((property) => <label key={property.key}>{property.name}{property.is_required ? ' *' : ''}<InstancePropertyInput property={property} value={relationProperties[property.key]} onChange={(value) => setRelationProperties((old) => ({ ...old, [property.key]: value }))} /></label>)}</form></Modal>}
    {unlinkTarget && <Modal title="解除关联" subtitle="只移除这条关系，保留双方实例" onClose={() => !busy && setUnlinkTarget(null)} footer={<><button className="btn secondary" disabled={busy} onClick={() => setUnlinkTarget(null)}>取消</button><button className="btn danger" disabled={busy} onClick={unlinkRelation}>{busy ? '处理中…' : '解除关联'}</button></>}><p className="ix-confirm-text">确定解除与「{unlinkTarget.related_title}」的「{unlinkTarget.link_display_name}」关系吗？</p>{relationError && <p className="form-error-banner" role="alert">{relationError}</p>}</Modal>}
    {(creating || editing) && <InstanceEditor form={form} setForm={setForm} types={types} editing={editing} busy={busy} error={formError} fieldErrors={fieldErrors} onChangeType={changeFormType} onChangeProperty={changeProperty} onClose={closeForm} onSave={save} />}
    {discardOpen && <Modal title="放弃未保存的修改？" subtitle="关闭后本次填写的内容不会保存" onClose={() => setDiscardOpen(false)} footer={<><button className="btn secondary" onClick={() => setDiscardOpen(false)}>继续编辑</button><button className="btn danger" onClick={discardForm}>放弃修改</button></>}><p className="ix-confirm-text">你可以继续编辑并保存，或放弃本次修改。</p></Modal>}
    {pendingFormType && <Modal title="切换对象类型？" subtitle="不同类型的属性结构不同，切换将清空当前草稿" onClose={() => setPendingFormType('')} footer={<><button className="btn secondary" onClick={() => setPendingFormType('')}>保留当前草稿</button><button className="btn primary" onClick={() => applyFormType(pendingFormType)}>清空并切换</button></>}><p className="ix-confirm-text">将切换为「{getTypeName(types.find((type) => type.id === pendingFormType))}」。</p></Modal>}

  </div>;
}
