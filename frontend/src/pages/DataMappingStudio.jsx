import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronRight, Database, FileUp, HelpCircle, Network, Pencil, Plus, RefreshCw, Search, TableProperties, Trash2, X } from 'lucide-react';
import { api, formatTime } from '../api';
import { statusLabel } from '../labels';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import { MappingSourceFields, MappingTargetFields } from '../components/MappingFields';
import { DictionaryField, useModelDictionary } from '../components/DictionaryManager';
import { mappingKeyLabel, mappingSourceKind, mappingTargetPayload, sourceLocationLabel } from '../mappingForm';
import { historyReturnUrl } from '../historyNavigation';
import MappingLineageGraph from './MappingLineageGraph';

const mappingTypes = { property: '属性映射', relation: '关系映射' };
const physicalKinds = { table: '物理表', api: '接口', file: '文件' };
const databaseDrivers = [
  ['mysql', 'MySQL'], ['postgresql', 'PostgreSQL'], ['oracle', 'Oracle'],
  ['sqlserver', 'SQL Server'], ['dameng', '达梦数据库'],
];
const driverLabel = (value) => databaseDrivers.find(([key]) => key === value)?.[1] || value || '未配置';
const sourceOptions = {
  system_type: ['业务系统', '实时系统', '资产管理', '资产系统', '监测系统', '财务系统', '主数据系统'],
  data_category: ['交易', '实时', '主数据', '交易数据', '时序数据', '分析数据', '文档数据'],
  interface_type: ['接口/数据库', '实时接口', '接口', '数据库', 'REST API', '文件交换', '消息队列'],
  update_frequency: ['实时/日', '秒级', '日', '实时', '每小时', '每日', '每周', '手工触发'],
};
const emptySource = () => ({ code: '', name: '', category: '', status: 'draft', description: '',
  system_type: '', physical_object: '', data_subject: '', data_scope: '', data_category: '',
  interface_type: '', update_frequency: '', subject_domain_code: '',
  driver: '', host: '', port: '', database: '', username: '', password: '' });
const emptyMapping = () => ({ code: '', name: '', status: 'experimental', design_status: '设计中', owner: '', description: '', mapping_type: 'property',
  binding_mode: 'direct', governance_asset_code: '', governance_field: '', governance_relation_fields: ['', ''],
  source_code: '', source_kind: 'table', source_table: '', source_field: '', source_key: '', target_key: '',
  target_object_type: '', target_property: '', target_relation: '', map_way: 'direct',
  transform_rule: '', lookup_dictionary: '', update_method: '', quality_rule: '' });

function parseCsv(text) {
  const rows = []; let cell = ''; let row = []; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
  const [headers = [], ...records] = rows;
  const index = (names) => headers.findIndex((name) => names.includes(name.trim().replace(/^\uFEFF/, '')));
  const tableIndex = index(['表名', 'table', 'table_name']);
  const fieldIndex = index(['字段名', '字段名称', 'column', 'column_name']);
  const typeIndex = index(['数据类型', '类型', 'data_type', 'type']);
  const commentIndex = index(['字段注释', '注释', 'comment']);
  if ([tableIndex, fieldIndex, typeIndex].some((value) => value < 0)) throw new Error('CSV 需要表名、字段名、数据类型三列');
  const tables = new Map();
  records.forEach((values) => {
    const name = values[tableIndex]?.trim(); const field = values[fieldIndex]?.trim();
    if (!name || !field) return;
    if (!tables.has(name)) tables.set(name, { name, type: 'BASE TABLE', comment: '', columns: [], references: [] });
    tables.get(name).columns.push({ name: field, data_type: values[typeIndex]?.trim(), comment: values[commentIndex]?.trim() || '', key: '', nullable: null });
  });
  return { tables: [...tables.values()], origin: 'data-dictionary-csv' };
}

function SchemaBrowser({ tables, query, onQueryChange, onPick, selectedTable = '', selectedField = '', pickLabel = '映射到对象属性' }) {
  const needle = query.trim().toLowerCase();
  const filtered = tables.map((table) => {
    const tableMatches = `${table.name} ${table.comment || ''}`.toLowerCase().includes(needle);
    return { ...table, visibleColumns: !needle || tableMatches ? table.columns : table.columns.filter((column) => `${column.name} ${column.comment || ''} ${column.column_type || column.data_type || ''}`.toLowerCase().includes(needle)) };
  }).filter((table) => !needle || table.visibleColumns.length || `${table.name} ${table.comment || ''}`.toLowerCase().includes(needle));
  return <div className="mapping-schema-browser">
    <label className="mapping-schema-search"><Search size={15} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索表名、字段名或注释" aria-label="搜索表结构" /></label>
    <div className="mapping-schema-tree">{filtered.map((table, index) => <details key={`${table.name}-${needle}`} defaultOpen={Boolean(needle) || index === 0}>
      <summary><TableProperties size={15} /><strong>{table.name}</strong><small>{table.visibleColumns.length} 个字段</small></summary>
      <div className="mapping-schema-fields">{table.visibleColumns.map((column) => <div key={column.name} className={`mapping-schema-field ${selectedTable === table.name && selectedField === column.name ? 'selected' : ''}`}>
        <div className="mapping-schema-field-name"><code>{column.name}</code>{column.comment && <small title={column.comment}>{column.comment}</small>}</div>
        <div className="mapping-schema-field-meta"><span title={column.column_type || column.data_type}>{column.column_type || column.data_type}</span>{column.key === 'PRI' && <em className="key">主键</em>}{column.key === 'UNI' && <em className="key">唯一</em>}{column.nullable === false && <em>非空</em>}{column.nullable === true && <em>可空</em>}</div>
        {onPick && <button type="button" onClick={() => onPick(table, column)}>{pickLabel}</button>}
      </div>)}</div>
    </details>)}{!filtered.length && <p>没有匹配的表或字段。</p>}</div>
  </div>;
}


function SchemaDetailModal({ source, tables, mappings, capturedAt, getOrigin, targetLabel, propertyLabel, statusLabel, onClose, onViewMapping, onCreateMapping }) {
  const [query, setQuery] = useState('');
  const [mappingFilter, setMappingFilter] = useState('all');
  const [selectedTable, setSelectedTable] = useState(tables[0]?.name || '');
  const needle = query.trim().toLowerCase();
  const mappedIndex = useMemo(() => {
    const index = new Map();
    mappings.forEach((mapping) => {
      const origin = getOrigin(mapping);
      if (!origin.table || !origin.field) return;
      const fields = String(origin.field).split(/\s*\/\s*/).filter(Boolean);
      fields.forEach((field) => {
        const key = `${origin.table}\u0000${field}`;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(mapping);
      });
    });
    return index;
  }, [mappings, getOrigin]);
  const tableRows = useMemo(() => tables.map((table) => {
    const columns = table.columns || [];
    const mapped = columns.filter((column) => (mappedIndex.get(`${table.name}\u0000${column.name}`) || []).length > 0).length;
    return { ...table, columns, mapped };
  }), [tables, mappedIndex]);
  const visibleTables = useMemo(() => tableRows.filter((table) => !needle
    || `${table.name} ${table.comment || ''}`.toLowerCase().includes(needle)
    || (table.columns || []).some((column) => `${column.name} ${column.comment || ''} ${column.column_type || column.data_type || ''}`.toLowerCase().includes(needle))), [tableRows, needle]);
  const activeTable = visibleTables.find((table) => table.name === selectedTable) || visibleTables[0] || null;
  const fields = useMemo(() => {
    if (!activeTable) return [];
    return activeTable.columns.filter((column) => {
      const entries = mappedIndex.get(`${activeTable.name}\u0000${column.name}`) || [];
      if (mappingFilter === 'mapped' && !entries.length) return false;
      if (mappingFilter === 'unmapped' && entries.length) return false;
      return !needle || `${activeTable.name} ${column.name} ${column.comment || ''} ${column.column_type || column.data_type || ''}`.toLowerCase().includes(needle);
    });
  }, [activeTable, mappedIndex, mappingFilter, needle]);
  const totalFields = tables.reduce((total, table) => total + (table.columns || []).length, 0);
  const mappedFields = [...mappedIndex.keys()].filter((key) => {
    const [tableName, fieldName] = key.split('\u0000');
    return tables.some((table) => table.name === tableName && (table.columns || []).some((column) => column.name === fieldName));
  }).length;
  const coverage = totalFields ? Math.round((mappedFields / totalFields) * 100) : 0;
  const mappedTables = tableRows.filter((table) => table.mapped > 0).length;
  const statusClass = (value) => value === '已确认' ? 'confirmed' : value === '已停用' ? 'disabled' : 'pending';
  const fieldEntries = (table, column) => mappedIndex.get(`${table.name}\u0000${column.name}`) || [];
  return <Modal extraWide title={`表结构 · ${source.name}`} subtitle={`${source.code} · ${tables.length} 张表 · ${totalFields} 个字段${capturedAt ? ` · 快照 ${formatTime(capturedAt)}` : ''}`} onClose={onClose} footer={<><span className="schema-modal-footnote">结构快照只读；映射状态来自数据映射页，字段映射仍在数据映射中维护。</span><button type="button" className="btn secondary" onClick={onClose}>关闭</button></>}>
    <div className="schema-browser-modal">
      <div className="schema-browser-stats">
        <div><small>物理表</small><b>{tables.length}</b><span>{mappedTables} 张已有映射</span></div>
        <div><small>字段</small><b>{totalFields}</b><span>来自结构快照</span></div>
        <div className="good"><small>已映射字段</small><b>{mappedFields}</b><span>至少有一条字段映射</span></div>
        <div className="warn"><small>未映射字段</small><b>{Math.max(0, totalFields - mappedFields)}</b><span>待补映射</span></div>
        <div><small>字段覆盖率</small><b>{coverage}%</b><span>已映射 / 全部字段</span></div>
      </div>
      <div className="schema-browser-toolbar">
        <label className="mapping-schema-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索表名、字段名、类型或注释" aria-label="搜索表结构" /></label>
        <div className="schema-browser-segments" role="group" aria-label="映射状态筛选">
          <button type="button" className={mappingFilter === 'all' ? 'active' : ''} onClick={() => setMappingFilter('all')}>全部 <b>{totalFields}</b></button>
          <button type="button" className={mappingFilter === 'mapped' ? 'active' : ''} onClick={() => setMappingFilter('mapped')}>已映射 <b>{mappedFields}</b></button>
          <button type="button" className={mappingFilter === 'unmapped' ? 'active' : ''} onClick={() => setMappingFilter('unmapped')}>未映射 <b>{Math.max(0, totalFields - mappedFields)}</b></button>
        </div>
      </div>
      <div className="schema-browser-layout">
        <aside className="schema-table-list">
          <header><span>物理表</span><b>{visibleTables.length}</b></header>
          <div className="schema-table-scroll">{visibleTables.map((table) => <button type="button" key={table.name} className={activeTable?.name === table.name ? 'active' : ''} onClick={() => setSelectedTable(table.name)}>
            <span><strong>{table.name}</strong><small>{table.comment || '暂无表注释'}</small></span>
            <em>{table.mapped}/{table.columns.length} 已映射</em>
            <i><b style={{ width: `${table.columns.length ? Math.max(3, (table.mapped / table.columns.length) * 100) : 0}%` }} /></i>
          </button>)}{!visibleTables.length && <p className="schema-empty">没有匹配的物理表。</p>}</div>
        </aside>
        <section className="schema-field-panel">
          {!activeTable ? <div className="schema-empty"><TableProperties size={26} /><strong>没有匹配的表结构</strong><p>调整搜索关键词或映射状态筛选。</p></div> : <>
            <header><div><h3>{activeTable.name}</h3><p>{activeTable.comment || '暂无表注释'} · {activeTable.columns.length} 个字段 · {activeTable.mapped} 个已映射</p></div><button type="button" onClick={() => onCreateMapping(activeTable, null)}><Plus size={14} /> 新建字段映射</button></header>
            <div className="schema-field-table-wrap"><table className="schema-field-table"><colgroup><col style={{ width: '20%' }} /><col style={{ width: '13%' }} /><col style={{ width: '9%' }} /><col style={{ width: '8%' }} /><col style={{ width: '18%' }} /><col style={{ width: '12%' }} /><col style={{ width: '13%' }} /><col style={{ width: '7%' }} /></colgroup><thead><tr><th>字段</th><th>类型</th><th>键</th><th>可空</th><th>注释</th><th>映射状态</th><th>映射目标</th><th>操作</th></tr></thead><tbody>
              {fields.map((column) => {
                const entries = fieldEntries(activeTable, column);
                const first = entries[0];
                return <tr key={column.name} className={entries.length ? 'mapped' : ''}>
                  <td><code>{column.name}</code></td>
                  <td title={column.column_type || column.data_type}><span className="schema-type">{column.column_type || column.data_type || '—'}</span></td>
                  <td>{column.key === 'PRI' ? <em className="schema-key">主键</em> : column.key === 'UNI' ? <em className="schema-key">唯一</em> : '—'}</td>
                  <td>{column.nullable === false ? '否' : column.nullable === true ? '是' : '—'}</td>
                  <td title={column.comment || ''}><span className="schema-comment">{column.comment || '—'}</span></td>
                  <td>{entries.length ? <span className={`schema-map-state ${statusClass(statusLabel(first))}`}>{statusLabel(first)}{entries.length > 1 ? ` · ${entries.length} 条` : ''}</span> : <span className="schema-map-state none">未映射</span>}</td>
                  <td title={first ? `${targetLabel(first)} · ${propertyLabel(first)}` : ''}><span className="schema-target">{first ? `${targetLabel(first)} · ${propertyLabel(first)}` : '—'}</span></td>
                  <td>{entries.length ? <button type="button" className="schema-view" onClick={() => onViewMapping(first)}>查看</button> : <button type="button" className="schema-create" onClick={() => onCreateMapping(activeTable, column)}>建立</button>}</td>
                </tr>;
              })}
            </tbody></table>{!fields.length && <div className="schema-empty"><Search size={22} /><strong>没有匹配的字段</strong><p>调整搜索或切换“全部/已映射/未映射”。</p></div>}</div>
          </>}
        </section>
      </div>
    </div>
  </Modal>;
}

export default function DataMappingStudio({ activeId, refreshOntologies, notify, mode = 'sources' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const mappingSeedApplied = useRef('');
  const historyFocusApplied = useRef('');
  const schemaRequests = useRef(new Set());
  const [sources, setSources] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [assets, setAssets] = useState([]);
  const [objects, setObjects] = useState([]);
  const [links, setLinks] = useState([]);
  const [releases, setReleases] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [schemas, setSchemas] = useState({});
  const [graphRelease, setGraphRelease] = useState('working');
  const [graphSnapshot, setGraphSnapshot] = useState(null);
  const activeTab = ['graph', 'mappings', 'sources'].includes(mode) ? mode : 'sources';
  const [mappingTab, setMappingTab] = useState('all');
  const [mappingStatusFilter, setMappingStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [driverFilter, setDriverFilter] = useState('all');
  const mappingFieldSeed = useRef('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [help, setHelp] = useState(false);
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(emptySource());
  const [detail, setDetail] = useState(null);
  const [schemaQuery, setSchemaQuery] = useState('');
  const [remoteTables, setRemoteTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [validation, setValidation] = useState(null);
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const { items: mappingWays } = useModelDictionary('mapping_way');
  const directStats = useMemo(() => {
    const tables = new Set();
    mappings.forEach((item) => {
      if (item.binding_mode === 'governed') {
        const asset = assets.find((entry) => entry.code === item.governance_asset_code);
        if (asset?.upstream_object) tables.add(asset.upstream_object);
      } else if (item.source_table) tables.add(item.source_table);
    });
    return { tables: tables.size, domains: new Set(objects.map((item) => item.business_domain_code).filter(Boolean)).size };
  }, [mappings, assets, objects]);
  const mappingStats = useMemo(() => {
    const statusOf = (item) => item.design_status || ({ draft: '设计中', experimental: '设计中', active: '已确认', deprecated: '已停用' })[item.status] || '待确认';
    return {
      total: mappings.length,
      confirmed: mappings.filter((item) => statusOf(item) === '已确认').length,
      pending: mappings.filter((item) => statusOf(item) !== '已确认' && statusOf(item) !== '已停用').length,
      relations: mappings.filter((item) => item.mapping_type === 'relation').length,
      objects: new Set(mappings.filter((item) => item.mapping_type !== 'relation' && item.target_object_type).map((item) => item.target_object_type)).size,
    };
  }, [mappings]);
  const sourceStats = useMemo(() => ({
    total: (sources || []).length,
    active: (sources || []).filter((item) => item.status === 'active').length,
    withSchema: (sources || []).filter((item) => item.schema_snapshot).length,
    connected: (sources || []).filter((item) => item.connection_check?.status === 'passed').length,
  }), [sources]);

  const load = async () => {
    setError('');
    try {
      const [sourceRows, assetRows, mappingRows, objectRows, linkRows, subjectRows, releaseRows] = await Promise.all([
        api(`/api/ontologies/${activeId}/enterprise/data-sources`),
        api(`/api/ontologies/${activeId}/enterprise/governance-assets`),
        api(`/api/ontologies/${activeId}/enterprise/data-mappings`),
        api(`/api/ontologies/${activeId}/object-types`),
        api(`/api/ontologies/${activeId}/link-types`),
        api(`/api/ontologies/${activeId}/subject-domains`),
        api(`/api/ontologies/${activeId}/releases`),
      ]);
      setSources(sourceRows); setAssets(assetRows); setMappings(mappingRows); setObjects(objectRows); setLinks(linkRows); setSubjects(subjectRows); setReleases(releaseRows);
      setDetail((old) => old && ({ kind: old.kind, item: (old.kind === 'source' ? sourceRows : mappingRows).find((item) => item.id === old.item.id) || old.item }));
    } catch (cause) { setError(cause.message); }
  };
  useEffect(() => {
    setSources(null); setDetail(null); setValidation(null); setGraphRelease('working'); setGraphSnapshot(null);
    setSchemas({}); schemaRequests.current.clear(); load();
  }, [activeId]);
  useEffect(() => {
    if (activeTab !== 'mappings') return;
    const params = new URLSearchParams(location.search);
    const objectValue = params.get('object');
    if (!objectValue || !sources) return;
    const seedKey = `${activeId}:${location.search}`;
    if (mappingSeedApplied.current === seedKey) return;
    const object = objects.find((item) => item.name === objectValue || item.id === objectValue);
    if (!object) return;
    setMappingTab('property'); setQuery(''); setDetail(null);
    setForm({ ...emptyMapping(), mapping_type: 'property', binding_mode: 'direct',
      source_code: params.get('source') || '', source_table: params.get('table') || '',
      source_field: params.get('field') || '', target_object_type: object.name });
    setEditor({ kind: 'mapping', item: null });
    mappingSeedApplied.current = seedKey;
  }, [activeId, location.search, sources, objects, activeTab]);
  useEffect(() => {
    if (activeTab !== 'mappings' || !sources) return;
    const params = new URLSearchParams(location.search);
    const sourceCode = params.get('source');
    if (sourceCode && sources.some((source) => source.code === sourceCode)) setSourceFilter(sourceCode);
  }, [activeTab, sources, location.search]);
  useEffect(() => {
    if (activeTab !== 'mappings' || !mappings.length) return;
    const params = new URLSearchParams(location.search);
    const mappingId = params.get('mapping');
    if (!mappingId) return;
    const item = mappings.find((mapping) => mapping.id === mappingId);
    if (item) setDetail({ kind: 'mapping', item });
  }, [activeTab, mappings, location.search]);
  useEffect(() => {
    if (activeTab !== 'mappings' || !sources) return;
    const params = new URLSearchParams(location.search);
    if (params.get('new') !== '1') return;
    const sourceCode = params.get('source');
    if (!sourceCode || !sources.some((source) => source.code === sourceCode)) return;
    const seedKey = `${activeId}:${location.search}`;
    if (mappingFieldSeed.current === seedKey) return;
    mappingFieldSeed.current = seedKey;
    setForm({ ...emptyMapping(), mapping_type: 'property', binding_mode: 'direct',
      source_code: sourceCode, source_kind: 'table', source_table: params.get('table') || '',
      source_field: params.get('field') || '', source_key: '' });
    setEditor({ kind: 'mapping', item: null }); setDetail(null);
  }, [activeId, activeTab, sources, location.search]);
  // 接收“变更记录 → 打开该资源”的跳转：在对应独立页面选中资源。
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('from_history') !== '1') return;
    const type = params.get('resource_type');
    const id = params.get('resource_id');
    if (!id || (type !== 'data_source' && type !== 'data_mapping')) return;
    if (!sources) return;
    const targetMode = type === 'data_source' ? 'sources' : 'mappings';
    if (activeTab !== targetMode) {
      navigate(`/ontology/data/${type === 'data_source' ? 'sources' : 'mappings'}?${location.search}`, { replace: true });
      return;
    }
    const key = `${activeId}:${type}:${id}`;
    if (historyFocusApplied.current === key) return;
    const pool = type === 'data_source' ? sources : mappings;
    const index = pool.findIndex((item) => String(item.id) === id);
    if (index < 0) {
      navigate(`${historyReturnUrl(location.search)}&not_found=1`, { replace: true });
      return;
    }
    historyFocusApplied.current = key;
    setMappingTab('all'); setMappingStatusFilter('all'); setSourceFilter('all'); setDriverFilter('all'); setQuery('');
    setPage(Math.floor(index / pageSize) + 1);
    setDetail({ kind: type === 'data_source' ? 'source' : 'mapping', item: pool[index] });
  }, [activeId, location.search, sources, mappings, pageSize, navigate, activeTab]);
  useEffect(() => {
    if (graphRelease === 'working') { setGraphSnapshot(null); return; }
    let cancelled = false;
    api(`/api/ontologies/${activeId}/releases/${graphRelease}/snapshot`)
      .then((snapshot) => { if (!cancelled) setGraphSnapshot(snapshot); })
      .catch((cause) => { if (!cancelled) notify(cause.message); });
    return () => { cancelled = true; };
  }, [activeId, graphRelease]);
  useEffect(() => { setPage(1); }, [activeTab, mappingTab, mappingStatusFilter, sourceFilter, driverFilter, query, pageSize]);
  useEffect(() => { setRemoteTables([]); setSelectedTables([]); setSchemaModalOpen(false); }, [detail?.item?.id]);
  useEffect(() => { setSchemaQuery(''); }, [detail?.item?.id]);
  useEffect(() => { setValidation(null); }, [detail?.item?.id, activeTab]);

  const ensureSchema = async (sourceCode, force = false) => {
    if (!sourceCode || (!force && schemaRequests.current.has(sourceCode))) return;
    const source = sources?.find((item) => item.code === sourceCode);
    if (!source) return;
    schemaRequests.current.add(sourceCode);
    try {
      const value = await api(`/api/ontologies/${activeId}/enterprise/data-sources/${source.id}/schema`);
      setSchemas((old) => ({ ...old, [sourceCode]: value }));
    } catch {
      setSchemas((old) => ({ ...old, [sourceCode]: { schema: { tables: [] } } }));
    }
  };

  const visible = useMemo(() => activeTab === 'sources'
    ? (sources || []).filter((item) => (driverFilter === 'all' || (driverFilter === 'none' ? !item.driver : item.driver === driverFilter))
      && `${item.name} ${item.code} ${item.physical_object || ''} ${item.database || ''} ${item.system_type || ''} ${item.data_subject || ''} ${driverLabel(item.driver)}`.toLowerCase().includes(query.toLowerCase()))
    : mappings.filter((item) => {
      const status = item.design_status || ({ draft: '设计中', experimental: '设计中', active: '已确认', deprecated: '已停用' })[item.status] || '待确认';
      const sourceCode = item.binding_mode === 'governed'
        ? assets.find((entry) => entry.code === item.governance_asset_code)?.upstream_source_code || item.source_code || ''
        : item.source_code || '';
      return (mappingTab === 'all' || item.mapping_type === mappingTab)
        && (mappingStatusFilter === 'all' || status === mappingStatusFilter)
        && (sourceFilter === 'all' || sourceCode === sourceFilter)
        && `${item.name} ${item.code} ${item.source_code || ''} ${item.source_table || ''} ${item.source_field || ''} ${item.target_object_type || ''} ${item.target_property || ''} ${item.target_relation || ''}`.toLowerCase().includes(query.toLowerCase());
    }),
  [sources, mappings, assets, activeTab, mappingTab, mappingStatusFilter, sourceFilter, driverFilter, query]);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const rows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedDetail = detail?.item && (activeTab === 'sources' ? detail.kind === 'source' : detail.kind === 'mapping')
    ? { kind: activeTab === 'sources' ? 'source' : 'mapping', item: detail.item }
    : null;
  const sourceCodeForSchema = editor?.kind === 'mapping' ? form.source_code : selectedDetail?.kind === 'source' ? selectedDetail.item.code : selectedDetail?.kind === 'mapping' ? selectedDetail.item.source_code : '';
  const selectedSource = sources?.find((source) => source.code === sourceCodeForSchema);
  useEffect(() => { if (sourceCodeForSchema) ensureSchema(sourceCodeForSchema); }, [sourceCodeForSchema, sources]);
  const tables = schemas[form.source_code]?.schema?.tables || [];
  const detailTables = schemas[selectedDetail?.item?.code]?.schema?.tables || (selectedDetail?.kind === 'mapping' ? schemas[selectedDetail?.item?.source_code]?.schema?.tables || [] : []);
  const sourceForDetail = selectedDetail?.kind === 'source' ? selectedDetail.item : null;
  const objectLabel = (name) => objects.find((item) => item.name === name)?.display_name || name || '—';
  const objectRecord = (name) => objects.find((item) => item.name === name);
  const relationLabel = (name) => {
    const relation = links.find((link) => link.name === name);
    if (!relation) return name || '—';
    const start = objects.find((object) => object.id === relation.source_object_type_id)?.display_name;
    const end = objects.find((object) => object.id === relation.target_object_type_id)?.display_name;
    return start && end ? `${start} → ${relation.display_name} → ${end}` : relation.display_name;
  };
  const mappingTargetLabel = (item) => item.mapping_type === 'relation' ? relationLabel(item.target_relation) : objectLabel(item.target_object_type);
  const mappingPropertyLabel = (item) => {
    if (item.mapping_type === 'relation') return '—';
    const object = objectRecord(item.target_object_type);
    return object?.properties?.find((property) => property.key === item.target_property)?.name || item.target_property || '—';
  };
  const mappingTypeLabel = (item) => mappingTypes[item.mapping_type] || '待修正类型';
  const mappingSourceLabel = (item) => {
    if (item.binding_mode === 'governed') {
      const asset = assets.find((entry) => entry.code === item.governance_asset_code);
      const source = sources?.find((entry) => entry.code === asset?.upstream_source_code);
      return source?.name || asset?.name || item.governance_asset_code || '旧治理资产';
    }
    return sources?.find((source) => source.code === item.source_code)?.name || item.source_system_display || item.source_code || '—';
  };
  const physicalOrigin = (item) => {
    if (!item) return { sourceCode: '', table: '', field: '', key: '' };
    if (item.binding_mode === 'governed') {
      const asset = assets.find((entry) => entry.code === item.governance_asset_code);
      const fields = item.mapping_type === 'relation' ? item.governance_relation_fields || [] : [item.governance_field].filter(Boolean);
      return { sourceCode: asset?.upstream_source_code || item.source_code || '', table: asset?.upstream_object || item.source_table || '', field: fields.join(' / '), key: item.source_key || '' };
    }
    return { sourceCode: item.source_code || '', table: item.source_table || '', field: item.source_field || '', key: item.source_key || '' };
  };
  // 映射方式一律按 dic_mapping_way 的 code 存储，显示名从字典取。
  const mappingWayLabel = (item) => mappingWays.find((row) => row.code === item.map_way)?.name || item.map_way || '—';
  const mappingStatusLabel = (item) => item.design_status || ({ draft: '设计中', experimental: '设计中', active: '已确认', deprecated: '已停用' })[item.status] || '待确认';
  const mappingUpdateLabel = (item) => item.update_method_display || ({ realtime: '实时', event: '事件触发', batch: '批量', manual: '手工触发' })[item.update_method] || item.update_method || '—';
  const sourceSchemaMappings = useMemo(() => sourceForDetail ? mappings.filter((item) => physicalOrigin(item).sourceCode === sourceForDetail.code) : [], [mappings, sourceForDetail, assets]);
  const schemaFieldCount = detailTables.reduce((total, table) => total + (table.columns || []).length, 0);
  const schemaMappedFieldCount = new Set(sourceSchemaMappings.flatMap((item) => {
    const origin = physicalOrigin(item);
    return String(origin.field || '').split(/\s*\/\s*/).filter(Boolean).map((field) => `${origin.table}\u0000${field}`);
  })).size;
  const schemaCoverage = schemaFieldCount ? Math.round((schemaMappedFieldCount / schemaFieldCount) * 100) : 0;
  const schemaCapturedAt = schemas[sourceForDetail?.code]?.captured_at || sourceForDetail?.schema_snapshot?.captured_at || '';
  const openSchema = () => setSchemaModalOpen(true);
  const openSourceSchema = async (item) => {
    setDetail({ kind: 'source', item });
    let schema = schemas[item.code];
    if (!schema?.schema?.tables?.length) {
      try {
        schema = await api(`/api/ontologies/${activeId}/enterprise/data-sources/${item.id}/schema`);
        setSchemas((old) => ({ ...old, [item.code]: schema }));
      } catch (cause) {
        notify?.(cause.message);
        return;
      }
    }
    const tables = schema?.schema?.tables || [];
    if (!tables.length) { notify?.('该数据源尚未获取表结构，请先在详情中采集或导入结构。'); return; }
    setSchemaModalOpen(true);
  };
  const testSourceConnection = async (item) => {
    if (item.driver !== 'mysql') { notify?.('该数据源类型暂不支持直连测试，请导入 CSV/JSON/SQL 结构字典。'); return; }
    await sourceAction('test-connection', item);
  };
  const viewMappingFromSchema = (mapping) => {
    if (!mapping) return;
    setSchemaModalOpen(false);
    navigate(`/ontology/data/mappings?source=${encodeURIComponent(sourceForDetail.code)}&mapping=${encodeURIComponent(mapping.id)}`);
  };

  const startSource = (item = null) => {
    setEditor({ kind: 'source', item });
    const legacySubjectCode = subjects.find((subject) => subject.code === item?.data_topic)?.code || '';
    setForm(item ? { ...emptySource(), ...item,
      data_subject: item.data_subject || (legacySubjectCode ? '' : item.data_topic) || '',
      subject_domain_code: item.subject_domain_code || legacySubjectCode, password: '' } : emptySource());
  };
  const startMapping = (item = null) => {
    setEditor({ kind: 'mapping', item });
    const origin = physicalOrigin(item);
    const source = sources?.find((entry) => entry.code === origin.sourceCode);
    setForm({ ...emptyMapping(), ...(item || {}), binding_mode: 'direct',
      governance_asset_code: '', governance_field: '', governance_relation_fields: ['', ''],
      source_code: origin.sourceCode || '', source_table: origin.table || '', source_field: origin.field || '',
      source_key: origin.key || '', source_kind: mappingSourceKind({ ...item, source_code: origin.sourceCode, source_table: origin.table }, source),
      target_key: item?.target_key || '', relation_key_mode: 'link_table' });
  };
  const startMappingFromField = (source, table, column) => {
    const params = new URLSearchParams({ source: source.code, table: table.name, new: '1' });
    if (column?.name) params.set('field', column.name);
    navigate(`/ontology/data/mappings?${params.toString()}`);
    setSchemaModalOpen(false);
  };
  const save = async (event) => {
    event.preventDefault(); setBusy('save');
    const sourceMode = editor.kind === 'source';
    const objectName = objectRecord(form.target_object_type)?.display_name || form.target_object_type;
    const propertyName = objectRecord(form.target_object_type)?.properties?.find((item) => item.key === form.target_property)?.name || form.target_property;
    const relationName = links.find((item) => item.name === form.target_relation)?.display_name || form.target_relation;
    const generatedName = form.mapping_type === 'relation' ? `${relationName || '关系'}映射` : `${objectName || '对象'} · ${propertyName || '属性'}`;
    const keepName = editor.item && editor.item.mapping_type === form.mapping_type ? editor.item.name : generatedName;
    const base = { code: form.code.trim(), name: sourceMode ? form.name.trim() : keepName,
      status: sourceMode ? form.status : form.design_status === '已确认' ? 'active' : 'experimental', description: form.description || '' };
    const preserved = {};
    if (editor.item) ['template_external_id', 'template_sheet', 'template_row', 'template_raw', 'design_status',
      'template_owner_missing', 'credential_policy', 'source_system_display', 'data_topic',
      'mapping_type_display', 'update_method_display', 'owner'].forEach((key) => {
      if (editor.item[key] !== undefined) preserved[key] = editor.item[key];
    });
    const payload = sourceMode
      ? { ...preserved, system_type: form.system_type.trim(), physical_object: form.physical_object.trim(),
        data_subject: form.data_subject.trim(), update_frequency: form.update_frequency.trim(),
        data_scope: form.data_scope.trim(), data_category: form.data_category.trim(),
        interface_type: form.interface_type.trim(), subject_domain_code: form.subject_domain_code || '',
        driver: form.driver,
        host: form.driver === 'mysql' ? form.host : '', port: form.driver === 'mysql' ? Number(form.port) || null : null,
        database: form.driver === 'mysql' ? form.database : '', username: form.driver === 'mysql' ? form.username : '',
        ...(form.driver === 'mysql' && form.password ? { password: form.password } : {}),
        ...(form.driver === 'mysql' && form.connection_check ? { connection_check: form.connection_check } : {}) }
      : { ...preserved, design_status: form.design_status, owner: form.owner.trim(),
        update_method_display: ({ realtime: '实时', event: '事件触发', batch: '批量', manual: '手工触发' })[form.update_method] || '',
        mapping_editor_version: 3, mapping_type_display: mappingTypes[form.mapping_type], binding_mode: 'direct',
        governance_asset_code: '', governance_field: '', governance_relation_fields: [],
        mapping_type: form.mapping_type, ...mappingTargetPayload(form),
        source_kind: mappingSourceKind(form, sources?.find((entry) => entry.code === form.source_code)),
        source_code: form.source_code.trim(), source_table: form.source_table.trim(),
        source_system_display: sources?.find((entry) => entry.code === form.source_code)?.name || '',
        source_field: form.source_field.trim(), source_key: form.source_key.trim(), target_key: form.target_key || '',
        map_way: form.mapping_type === 'relation' ? 'link' : form.map_way,
        transform_rule: form.transform_rule, lookup_dictionary: form.lookup_dictionary,
        update_method: form.update_method, quality_rule: form.quality_rule };
    const kind = sourceMode ? 'data-sources' : 'data-mappings';
    const path = editor.item ? `/api/ontologies/${activeId}/enterprise/${kind}/${editor.item.id}` : `/api/ontologies/${activeId}/enterprise/${kind}`;
    try {
      const saved = await api(path, { method: editor.item ? 'PUT' : 'POST', body: JSON.stringify({ ...base, category: sourceMode ? form.system_type : mappingTypes[form.mapping_type], payload }) });
      setEditor(null); await load(); refreshOntologies?.(activeId); setDetail({ kind: sourceMode ? 'source' : 'mapping', item: saved }); setValidation(null);
      notify(sourceMode ? form.driver === 'mysql' ? '物理来源已保存，可测试连接并获取结构' : '物理来源已登记；可导入 CSV、JSON 或 SQL 数据字典以获取结构' : '字段映射已保存：物理字段 → 本体对象属性。当前只登记结构和语义，不执行数据同步。');
    } catch (cause) { notify(cause.message); } finally { setBusy(''); }
  };
  const remove = async (kind, item) => {
    if (!window.confirm(`确定删除“${item.name}”吗？存在引用时系统会拒绝删除。`)) return;
    try {
      await api(`/api/enterprise/${kind === 'source' ? 'data-sources' : 'data-mappings'}/${item.id}`, { method: 'DELETE' });
      setDetail(null); await load(); refreshOntologies?.(activeId); notify('已删除');
    } catch (cause) { notify(cause.message); }
  };
  const sourceAction = async (action, item, body) => {
    setBusy(action);
    try {
      const result = await api(`/api/ontologies/${activeId}/enterprise/data-sources/${item.id}/${action}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      await load(); refreshOntologies?.(activeId);
      if (action === 'capture-schema' || action === 'import-schema' || action === 'import-ddl') {
        setSchemas((old) => ({ ...old, [item.code]: result }));
        schemaRequests.current.add(item.code);
      }
      notify(action === 'test-connection' ? `连接及元数据权限检查通过，可见 ${result.table_count} 张表` : `结构已保存，共 ${result.table_count} 张表`);
    } catch (cause) { notify(cause.message); if (action === 'test-connection') await load(); } finally { setBusy(''); }
  };
  const browseTables = async (item) => {
    setBusy('tables');
    try {
      const result = await api(`/api/ontologies/${activeId}/enterprise/data-sources/${item.id}/tables`);
      setRemoteTables(result.tables); setSelectedTables([]);
    } catch (cause) { notify(cause.message); } finally { setBusy(''); }
  };
  const importDictionary = async (file, item) => {
    if (!file) return;
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.sql')) {
        if (item.driver && item.driver !== 'mysql') throw new Error(`${driverLabel(item.driver)} 暂不支持 SQL DDL 解析，请导入 CSV 或 JSON 数据字典`);
        await sourceAction('import-ddl', item, { ddl_text: text });
      } else {
        const schema = file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : parseCsv(text);
        await sourceAction('import-schema', item, { schema_data: schema });
      }
    } catch (cause) { notify(`结构导入失败：${cause.message}`); }
  };
  const validate = async (item) => {
    setBusy('validate');
    try { setValidation(await api(`/api/ontologies/${activeId}/enterprise/data-mappings/${item.id}/validate`, { method: 'POST' })); }
    catch (cause) { notify(cause.message); } finally { setBusy(''); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!sources) return <Loading />;
  return <div className={`mapping-studio mapping-v2 mapping-direct ${activeTab === 'graph' ? '' : 'mapping-with-insights'}`}>
    {activeTab === 'graph' && <div className="mapping-topbar mapping-split-topbar">
      <div className="mapping-page-heading"><div><h1>映射图谱</h1><p>从物理表到对象类型、再到表字段到对象属性的可探索映射网络。</p></div></div>
      <div className="mapping-top-actions">
        <label className="mapping-version-control" title="查看已发布版本的只读映射"><span>图谱版本</span><select value={graphRelease} onChange={(event) => { setGraphSnapshot(null); setGraphRelease(event.target.value); }}><option value="working">当前工作状态</option>{releases.map((release) => <option key={release.id} value={release.id}>{release.version} · 已发布</option>)}</select></label>
        <div className="mapping-help-wrap"><button className="mapping-icon-button" aria-label="功能说明" onClick={() => setHelp(!help)}><HelpCircle size={17} /></button>{help && <div className="mapping-help"><button aria-label="关闭说明" onClick={() => setHelp(false)}><X size={14} /></button><strong>物理表 → 对象，按需下钻到字段</strong><p>对象视图只展示物理表到本体对象类型的连接，连线数字表示该表映射到该对象的字段数；选中对象、表或连线后，在右侧查看字段明细并一键展开到“表字段 → 对象属性”的字段视图。暂不经过数据治理资产层，也不导入实例数据。</p></div>}</div>
        <button className="mapping-secondary" onClick={() => navigate('/ontology/data/mappings')}><ArrowRight size={15} /> 返回数据映射</button>
      </div>
    </div>}
    {activeTab === 'graph' && <>
      <div className="mapping-direct-summary">
        <span><b>{sources.length}</b> 个物理数据源</span>
        <span><b>{directStats.tables}</b> 张物理表</span>
        <span><b>{mappings.length}</b> 条字段映射</span>
        <span><b>{objects.length}</b> 个对象类型</span>
        <span><b>{directStats.domains}</b> 个业务域</span>
        <em>默认展示“物理表 → 本体对象类型”的连接，点击可下钻到“表字段 → 对象属性”；不再经过数据治理层。为保持可读性，默认聚焦一个数据源，可切换筛选查看全部来源。</em>
      </div>
      {graphRelease !== 'working' && <div className="mapping-graph-version-note">{graphSnapshot ? `只读查看 ${graphSnapshot.version} 发布时的映射` : '正在加载历史版本…'}</div>}
      {(graphRelease === 'working' || graphSnapshot) && <MappingLineageGraph
        sources={graphSnapshot?.enterprise_resources?.['data-sources'] || sources}
        assets={graphSnapshot?.enterprise_resources?.['governance-assets'] || assets}
        mappings={graphSnapshot?.enterprise_resources?.['data-mappings'] || mappings}
        objects={graphSnapshot?.object_types || objects}
        links={graphSnapshot?.link_types || links} />}
    </>}
    {(activeTab === 'sources' || activeTab === 'mappings') && <>
    <div className={`mapping-insight-strip ${activeTab === 'mappings' ? 'five' : ''}`}>
      {activeTab === 'sources' ? <>
        <div><small>数据源</small><b>{sourceStats.total}</b><span>已登记物理来源</span></div>
        <div><small>已启用</small><b>{sourceStats.active}</b><span>可用于结构采集</span></div>
        <div><small>已采结构</small><b>{sourceStats.withSchema}</b><span>有表结构快照</span></div>
        <div><small>连接通过</small><b>{sourceStats.connected}</b><span>最近一次检测通过</span></div>
      </> : <>
        <div><small>字段映射</small><b>{mappingStats.total}</b><span>物理字段 → 对象属性</span></div>
        <div className="good"><small>已确认</small><b>{mappingStats.confirmed}</b><span>可作为可信连接</span></div>
        <div className="warn"><small>待确认</small><b>{mappingStats.pending}</b><span>设计中或待校验</span></div>
        <div><small>关系映射</small><b>{mappingStats.relations}</b><span>对象之间的关系</span></div>
        <div><small>覆盖对象</small><b>{mappingStats.objects}</b><span>已有属性映射</span></div>
      </>}
    </div>
    <div className="mapping-controls">
      <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={activeTab === 'sources' ? '搜索系统、编码或数据库类型' : '搜索映射、来源表、字段或本体属性'} /></label>
      {activeTab === 'sources' && <select aria-label="按数据库类型筛选" value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)}><option value="all">全部数据库类型</option>{databaseDrivers.map(([key, name]) => <option value={key} key={key}>{name}</option>)}<option value="none">未指定</option></select>}
      {activeTab === 'mappings' && <>
        <select aria-label="按映射类型筛选" value={mappingTab} onChange={(event) => setMappingTab(event.target.value)}><option value="all">全部类型</option>{Object.entries(mappingTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select aria-label="按映射状态筛选" value={mappingStatusFilter} onChange={(event) => setMappingStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="已确认">已确认</option><option value="设计中">设计中</option><option value="待确认">待确认</option><option value="已停用">已停用</option></select>
        <select aria-label="按数据源筛选" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">全部数据源</option>{(sources || []).map((source) => <option key={source.id} value={source.code}>{source.name}</option>)}</select>
      </>}
      <button onClick={load}><RefreshCw size={15} /> 刷新</button>
      <div className="mapping-controls-actions">
        {activeTab === 'sources' && <button className="mapping-primary" onClick={() => startSource()}><Plus size={16} /> 登记数据源</button>}
        {activeTab === 'mappings' && <><button className="mapping-secondary" onClick={() => navigate('/ontology/data/mapping-graph')}><Network size={15} /> 映射图谱</button><button className="mapping-primary" onClick={() => startMapping()}><Plus size={16} /> 新建字段映射</button></>}
      </div>
    </div>
    <div className={`mapping-v2-layout ${selectedDetail ? 'detail-open' : 'detail-collapsed'}`}>
      <div className="mapping-v2-list-pane"><div className="mapping-v2-pane-heading"><strong>{activeTab === 'sources' ? '数据源目录' : '数据映射目录'}</strong><span>{activeTab === 'mappings' ? '每条映射直接连接物理字段与本体对象属性' : '登记连接、采集结构，作为字段映射的起点'}</span></div>
      {activeTab === 'sources' ? <section className="mapping-v2-table source-list"><header><span>系统名称 / 数据源ID</span><span>类型</span><span>数据库类型</span><span>状态</span><span>操作</span></header>
        {rows.map((item) => <div key={item.id} role="button" tabIndex={0} className={`mapping-source-row ${detail?.item?.id === item.id ? 'selected' : ''}`} onClick={() => setDetail({ kind: 'source', item })} onKeyDown={(event) => { if (event.key === 'Enter') setDetail({ kind: 'source', item }); }}>
          <span><strong>{item.name}</strong><small>{item.code}{item.source_origin === 'built_in_demo' && item.connection_check?.status !== 'passed' ? ' · 演示登记' : ''}</small></span>
          <span title={item.system_type || ''}>{item.system_type || '未填写'}</span>
          <span title={driverLabel(item.driver)}>{item.driver ? driverLabel(item.driver) : '未指定'}</span>
          <span><em className={`mapping-status ${item.status || ''}`}>{statusLabel(item.status)}</em></span>
          <span className="mapping-row-actions"><button type="button" disabled={Boolean(busy)} title={item.driver === 'mysql' ? '测试数据库连接' : '点击查看该类型是否支持直连测试'} onClick={(event) => { event.stopPropagation(); testSourceConnection(item); }}>测试连通</button><button type="button" onClick={(event) => { event.stopPropagation(); openSourceSchema(item); }}>表结构</button></span>
        </div>)}
        {!rows.length && <EmptyState title="没有匹配的数据源" description="登记业务系统后，可以配置连接或导入结构字典。" />}</section>
        : <section className={`mapping-v2-table mapping-list direct-list ${mappingTab === 'relation' ? 'relation-only' : ''}`}><header><span>映射ID</span><span>物理来源</span><span>物理字段</span><span>本体对象／关系</span><span>对象属性</span><span>状态</span></header>
          {rows.map((item) => {
            const origin = physicalOrigin(item);
            return <button type="button" key={item.id} className={selectedDetail?.item.id === item.id ? 'selected' : ''} onClick={() => setDetail({ kind: 'mapping', item })}><span title={item.code}><strong>{item.code}</strong><small>{mappingTypeLabel(item)}</small></span><span title={mappingSourceLabel(item)}>{mappingSourceLabel(item)}</span><span title={origin.table ? `${origin.table}.${origin.field}` : origin.field}><code>{origin.table ? `${origin.table}.${origin.field}` : (origin.field || '—')}</code></span><span title={mappingTargetLabel(item)}>{mappingTargetLabel(item)}</span><span title={mappingPropertyLabel(item)}>{mappingPropertyLabel(item)}</span><span className={mappingStatusLabel(item) === '已确认' ? 'mapping-status confirmed' : 'mapping-status'}>{mappingStatusLabel(item)}</span></button>;
          })}
          {!rows.length && <EmptyState title="没有匹配的字段映射" description="从物理来源字段出发，选择它对应的本体对象属性。" />}</section>}
      <PaginationBar page={currentPage} pageSize={pageSize} total={visible.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></div>

      <aside className="mapping-v2-inspector"><header><strong>{activeTab === 'sources' ? '数据源详情' : '映射详情'}</strong>{selectedDetail && <div><ResourceHistoryLink resourceType={selectedDetail.kind === 'source' ? 'data_source' : 'data_mapping'} resourceId={selectedDetail.item.id} /><button onClick={() => selectedDetail.kind === 'source' ? startSource(selectedDetail.item) : startMapping(selectedDetail.item)}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={() => remove(selectedDetail.kind, selectedDetail.item)}><Trash2 size={14} /> 删除</button><button className="mapping-detail-close" title="收起详情" aria-label="收起详情" onClick={() => setDetail(null)}><X size={14} /></button></div>}</header>
      <div key={selectedDetail?.item.id || activeTab} className="mapping-drawer-body">{!selectedDetail ? <EmptyState title="请选择记录" description="从左侧目录选择一条记录查看详情。" /> : selectedDetail.kind === 'source' ? <><h3>{sourceForDetail.name}</h3>{sourceForDetail.source_origin === 'built_in_demo' && sourceForDetail.connection_check?.status !== 'passed' && <p>这是内置采购财务演示登记，不代表已接入真实系统。</p>}<h4>来源登记信息</h4><dl><div><dt>数据源ID</dt><dd>{sourceForDetail.code}</dd></div><div><dt>登记状态</dt><dd>{statusLabel(sourceForDetail.status)}</dd></div><div><dt>系统类型</dt><dd>{sourceForDetail.system_type || '—'}</dd></div><div><dt>数据库/接口/文件</dt><dd>{sourceForDetail.physical_object || '—'}</dd></div><div><dt>数据主题</dt><dd>{sourceForDetail.data_subject || '—'}</dd></div><div><dt>更新频率</dt><dd>{sourceForDetail.update_frequency || '—'}</dd></div><div><dt>数据范围</dt><dd>{sourceForDetail.data_scope || '—'}</dd></div><div><dt>数据类别</dt><dd>{sourceForDetail.data_category || '—'}</dd></div><div><dt>接口方式</dt><dd>{sourceForDetail.interface_type || '—'}</dd></div></dl><h4>本体分类关联（扩展配置）</h4><dl><div><dt>关联主题域</dt><dd>{subjects.find((item) => item.code === sourceForDetail.subject_domain_code)?.name || sourceForDetail.subject_domain_code || '未关联'}</dd></div></dl><h4>连接与结构采集（扩展配置）</h4><dl><div><dt>数据库类型</dt><dd>{driverLabel(sourceForDetail.driver)}</dd></div><div><dt>连接地址</dt><dd>{sourceForDetail.host ? `${sourceForDetail.host}:${sourceForDetail.port}/${sourceForDetail.database}` : '未配置'}</dd></div><div><dt>凭据</dt><dd>{sourceForDetail.driver === 'mysql' ? sourceForDetail.credential_configured ? '已安全保存' : '未配置' : '不适用'}</dd></div><div><dt>连接检测</dt><dd>{sourceForDetail.driver === 'mysql' ? sourceForDetail.connection_check?.status === 'passed' ? `通过 · ${formatTime(sourceForDetail.connection_check.checked_at)}` : '未检测' : '暂不支持直连'}</dd></div><div><dt>结构快照</dt><dd>{sourceForDetail.schema_snapshot ? `${sourceForDetail.schema_snapshot.table_count} 张表 · ${formatTime(sourceForDetail.schema_snapshot.captured_at)}` : '未获取'}</dd></div></dl>
        <div className="mapping-drawer-actions">{sourceForDetail.driver === 'mysql' && <button disabled={Boolean(busy)} onClick={() => sourceAction('test-connection', sourceForDetail)}><CheckCircle2 size={15} /> 测试连接</button>}{sourceForDetail.driver === 'mysql' && <button disabled={Boolean(busy) || sourceForDetail.connection_check?.status !== 'passed'} onClick={() => browseTables(sourceForDetail)}><Database size={15} /> 选择/刷新来源表</button>}<label className="mapping-upload"><FileUp size={15} /> 导入结构文件<input type="file" accept={sourceForDetail.driver && sourceForDetail.driver !== "mysql" ? ".csv,.json" : ".csv,.json,.sql"} hidden onChange={(event) => { importDictionary(event.target.files?.[0], sourceForDetail); event.target.value = ''; }} /></label><button onClick={() => navigate(`/ontology/data/mappings?source=${encodeURIComponent(sourceForDetail.code)}`)}><ArrowRight size={15} /> 查看字段映射</button></div>
        {remoteTables.length > 0 && <section className="mapping-remote-tables"><h4>选择要采集结构的物理表</h4><p>这里只采集选中表的结构，不读取业务行。</p><div>{remoteTables.map((table) => <label key={table.name}><input type="checkbox" checked={selectedTables.includes(table.name)} onChange={() => setSelectedTables((old) => old.includes(table.name) ? old.filter((name) => name !== table.name) : [...old, table.name])} /><span>{table.name}</span><small>{table.comment}</small></label>)}</div><button disabled={!selectedTables.length || Boolean(busy)} onClick={() => sourceAction('capture-schema', sourceForDetail, { table_names: selectedTables })}>获取所选 {selectedTables.length} 张表的结构</button></section>}
        <section className="mapping-schema"><div className="mapping-schema-head"><h4>已获取的表结构</h4>{detailTables.length > 0 && <button type="button" className="mapping-schema-expand" onClick={openSchema}>展开完整结构 <ChevronRight size={14} /></button>}</div>{schemaCapturedAt && <p>结构快照：{formatTime(schemaCapturedAt)}。这里只展示字段元数据，不读取业务记录。</p>}{detailTables.length ? <button type="button" className="mapping-schema-summary" onClick={openSchema}><span className="mapping-schema-summary-icon"><TableProperties size={18} /></span><span><strong>{detailTables.length} 张表 · {schemaFieldCount} 个字段</strong><small>{schemaMappedFieldCount} 个字段已映射 · 覆盖率 {schemaCoverage}%</small></span><span className="mapping-schema-coverage"><i><b style={{ width: `${schemaCoverage}%` }} /></i><em>{schemaCoverage}%</em></span><ChevronRight size={15} /></button> : <p>尚无结构快照。MySQL 可直连采集；其他类型请导入含表名、字段名、数据类型的 CSV、JSON 或 SQL 数据字典。</p>}</section></>
        : <><h3>{selectedDetail.item.name}</h3><p>{selectedDetail.item.description || '物理字段到本体对象属性的映射记录'}</p>
          {selectedDetail.item.binding_mode === 'governed' && <p className="mapping-layer-warning">这是历史治理层映射。图谱会展开它的上游物理字段；保存后本记录将改为物理字段直连。</p>}
          <h4>物理来源</h4><dl>
            <div><dt>映射ID</dt><dd>{selectedDetail.item.code}</dd></div>
            <div><dt>映射类型</dt><dd>{mappingTypeLabel(selectedDetail.item)}</dd></div>
            <div><dt>来源系统</dt><dd>{mappingSourceLabel(selectedDetail.item)}</dd></div>
            <div><dt>物理来源</dt><dd>{physicalOrigin(selectedDetail.item).sourceCode || '—'}</dd></div>
            <div><dt>物理表</dt><dd><code>{physicalOrigin(selectedDetail.item).table || '—'}</code></dd></div>
            <div><dt>物理字段</dt><dd><code>{physicalOrigin(selectedDetail.item).field || '—'}</code></dd></div>
            <div><dt>主键／关联键</dt><dd><code>{mappingKeyLabel(selectedDetail.item)}</code></dd></div>
          </dl>
          <h4>本体语义</h4><dl>
            <div><dt>{selectedDetail.item.mapping_type === 'relation' ? '本体关系' : '本体对象'}</dt><dd>{mappingTargetLabel(selectedDetail.item)}</dd></div>
            <div><dt>对象属性</dt><dd>{selectedDetail.item.mapping_type === 'relation' ? '—' : mappingPropertyLabel(selectedDetail.item)}</dd></div>
            <div><dt>归属域</dt><dd>{selectedDetail.item.mapping_type === 'relation' ? '—' : `${objectRecord(selectedDetail.item.target_object_type)?.business_domain_name || '未分类'} / ${objectRecord(selectedDetail.item.target_object_type)?.subject_domain_name || '未分类'}`}</dd></div>
          </dl>
          <h4>映射配置</h4><dl><div><dt>映射方式</dt><dd>{mappingWayLabel(selectedDetail.item)}</dd></div><div><dt>转换规则</dt><dd>{selectedDetail.item.transform_rule || '—'}</dd></div><div><dt>质量校验</dt><dd>{selectedDetail.item.quality_rule || '—'}</dd></div><div><dt>更新方式</dt><dd>{mappingUpdateLabel(selectedDetail.item)}</dd></div><div><dt>负责人</dt><dd>{selectedDetail.item.owner || '—'}</dd></div><div><dt>状态</dt><dd>{mappingStatusLabel(selectedDetail.item)}</dd></div></dl>
          <div className="mapping-drawer-actions"><button disabled={Boolean(busy)} onClick={() => validate(selectedDetail.item)}><CheckCircle2 size={15} /> 校验映射配置</button></div>{validation && <section className="mapping-validation"><h4>{validation.status === 'valid' ? '静态校验通过' : validation.status === 'error' ? '发现阻断问题' : '存在待确认项'}</h4><p>仅核对模型与已有元数据，不读取业务数据；校验于 {formatTime(validation.checked_at)}。</p>{validation.checks.map((item, index) => <div key={`${item.name}-${index}`} className={item.level}><strong>{item.name}</strong><span>{item.detail}</span><em>{({ ok: '通过', error: '错误', warning: '警告', pending: '待验证' })[item.level]}</em></div>)}</section>}</>}
      </div></aside></div></>}

    {schemaModalOpen && sourceForDetail && detailTables.length > 0 && <SchemaDetailModal
      source={sourceForDetail}
      tables={detailTables}
      mappings={sourceSchemaMappings}
      capturedAt={schemaCapturedAt}
      getOrigin={physicalOrigin}
      targetLabel={mappingTargetLabel}
      propertyLabel={mappingPropertyLabel}
      statusLabel={mappingStatusLabel}
      onClose={() => setSchemaModalOpen(false)}
      onViewMapping={viewMappingFromSchema}
      onCreateMapping={(table, column) => startMappingFromField(sourceForDetail, table, column)}
    />}
    {editor && <Modal wide title={editor.kind === 'source' ? `${editor.item ? '编辑' : '登记'}数据源` : `${editor.item ? '编辑' : '新建'}字段映射`} onClose={() => setEditor(null)} footer={<><button className="btn secondary" onClick={() => setEditor(null)}>取消</button><button className="btn primary" form="mapping-v2-form" disabled={busy === 'save'}>{busy === 'save' ? '保存中…' : '保存到工作状态'}</button></>}>
      <form id="mapping-v2-form" className="form-sections" onSubmit={save}><div className="form-section"><h3>基本信息</h3><div className="form-grid two"><label><span>{editor.kind === 'source' ? '数据源ID' : '映射ID'}</span><input required disabled={Boolean(editor.item)} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label>{editor.kind === 'source' && <><label><span>系统名称</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>登记状态（平台）</span><select value={form.status || 'draft'} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="draft">草稿</option><option value="active">已启用</option><option value="deprecated">已停用</option>{form.status && !['draft', 'active', 'deprecated'].includes(form.status) && <option value={form.status}>{statusLabel(form.status)}（已有值）</option>}</select><small>仅表示数据源登记的使用状态，不是连接测试结果。</small></label></>}</div></div>
      {editor.kind === 'source' ? <><div className="form-section"><h3>来源登记</h3><p className="form-hint">按业务系统原始口径填写；“数据主题”不等于本体的“主题域”，连接参数也不是模板事实。</p><div className="form-grid two">
        <DictionaryField kind="system_type" label="系统类型" required={!editor.item} value={form.system_type || ''} valueMode="name" onChange={(value) => setForm({ ...form, system_type: value })} />
        <label><span>数据库/接口/文件</span><input required={!editor.item} value={form.physical_object || ''} onChange={(event) => setForm({ ...form, physical_object: event.target.value })} placeholder="如：finance.payment_request；不是连接地址" /></label>
        <label><span>数据主题</span><input required={!editor.item} value={form.data_subject || ''} onChange={(event) => setForm({ ...form, data_subject: event.target.value })} placeholder="如：付款、合同、预算" /></label>
        <label><span>更新频率</span><input required={!editor.item} list="source-update-frequencies" value={form.update_frequency || ''} onChange={(event) => setForm({ ...form, update_frequency: event.target.value })} /><datalist id="source-update-frequencies">{sourceOptions.update_frequency.map((value) => <option value={value} key={value} />)}</datalist></label>
        <label><span>数据范围</span><input required={!editor.item} value={form.data_scope || ''} onChange={(event) => setForm({ ...form, data_scope: event.target.value })} /></label>
        <DictionaryField kind="data_category" label="数据类别" required={!editor.item} value={form.data_category || ''} valueMode="name" onChange={(value) => setForm({ ...form, data_category: value })} />
        <DictionaryField kind="interface_type" label="接口方式" required={!editor.item} value={form.interface_type || ''} valueMode="name" onChange={(value) => setForm({ ...form, interface_type: value })} />
      </div></div>
        <div className="form-section"><h3>数据库类型与结构获取</h3><p className="form-hint">数据库类型属于连接配置，不改变上面的登记字段。目前仅 MySQL 支持直连获取表结构；其余类型可登记并导入 CSV、JSON 或 SQL 数据字典。</p><div className="form-grid two">
          <label><span>数据库类型</span><select value={form.driver || ''} onChange={(event) => setForm({ ...form, driver: event.target.value, port: event.target.value === 'mysql' ? form.port || 3306 : '' })}><option value="">暂不指定</option>{databaseDrivers.map(([key, label]) => <option key={key} value={key}>{label}</option>)}{form.driver && !databaseDrivers.some(([key]) => key === form.driver) && <option value={form.driver}>{form.driver}（已有值）</option>}</select></label>
          {form.driver && form.driver !== 'mysql' && <p className="mapping-driver-note">{driverLabel(form.driver)} 暂不支持直连测试与采集。保存登记信息后，请在详情中导入 CSV 或 JSON 结构文件。</p>}
          {form.driver === 'mysql' && <>
            <label><span>主机地址</span><input required value={form.host || ''} onChange={(event) => setForm({ ...form, host: event.target.value })} /></label>
            <label><span>端口</span><input type="number" min="1" max="65535" required value={form.port ?? ''} onChange={(event) => setForm({ ...form, port: event.target.value })} /></label>
            <label><span>数据库名称</span><input required value={form.database || ''} onChange={(event) => setForm({ ...form, database: event.target.value })} /></label>
            <label><span>用户名</span><input required value={form.username || ''} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
            <label><span>密码</span><input type="password" autoComplete="new-password" required={!editor.item || !form.credential_configured} value={form.password || ''} placeholder={form.credential_configured ? '已配置；留空表示不修改' : '输入连接密码'} onChange={(event) => setForm({ ...form, password: event.target.value })} /><small>密码加密保存，不进入本体元数据或导出文件。</small></label>
          </>}
        </div></div></>
        : <><section className="form-section"><h3>物理来源</h3><p className="form-hint">直接选择来源系统、物理表和字段；这是图谱左侧连线的起点。<button type="button" className="mapping-inline-action" onClick={() => { setEditor(null); navigate('/ontology/data/sources'); }}>先登记物理来源</button></p><div className="form-grid two">
          <MappingSourceFields form={form} setForm={setForm} sources={sources || []} tables={tables} objects={objects} relation={links.find((item) => item.name === form.target_relation)} />
          <label><span>来源载体</span><input readOnly value={physicalKinds[mappingSourceKind(form, sources?.find((entry) => entry.code === form.source_code))] || sourceLocationLabel(form)} /></label>
        </div></section>
        <MappingTargetFields form={form} setForm={setForm} objects={objects} links={links} />
        <section className="form-section"><h3>转换与质量</h3><div className="form-grid two">{form.mapping_type === 'property' ? <DictionaryField kind="mapping_way" label="映射方式" value={form.map_way} onChange={(value) => setForm({ ...form, map_way: value })} /> : <label><span>映射方式</span><select value={form.map_way || 'link'} onChange={(event) => setForm({ ...form, map_way: event.target.value })}><option value="link">关联映射</option></select><small>关系映射固定使用“关联映射”（dic_mapping_way · link）。</small></label>}
          <label><span>转换规则</span><input value={form.transform_rule || ''} onChange={(event) => setForm({ ...form, transform_rule: event.target.value })} placeholder="无转换可填 -" /></label>
          <label><span>质量校验</span><input value={form.quality_rule || ''} onChange={(event) => setForm({ ...form, quality_rule: event.target.value })} placeholder="如：非空+唯一" /></label>
          <label><span>更新方式</span><select value={form.update_method || ''} onChange={(event) => setForm({ ...form, update_method: event.target.value })}><option value="">待确定</option><option value="realtime">实时</option><option value="event">事件触发</option><option value="batch">批量</option><option value="manual">手工触发</option></select></label>
        </div></section><section className="form-section"><h3>维护责任与状态</h3><p className="form-hint">保存后进入当前工作状态；不会自动发布版本或生成实例。</p><div className="form-grid two"><label><span>负责人</span><input required value={form.owner || ''} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="填写负责岗位或人员" /></label>
          <label><span>状态</span><select value={form.design_status || '设计中'} onChange={(event) => setForm({ ...form, design_status: event.target.value })}><option value="设计中">设计中</option><option value="已确认">已确认</option></select></label>
        </div></section></>}
      </form></Modal>}
  </div>;
}
