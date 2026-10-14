import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Database, FileUp, HelpCircle, Pencil, Plus, RefreshCw, Search, TableProperties, Trash2, X } from 'lucide-react';
import { api, formatTime } from '../api';
import { statusLabel } from '../labels';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import { GovernedMappingFields, MappingTargetFields } from '../components/MappingFields';
import { DictionaryField } from '../components/DictionaryManager';
import { mappingKeyLabel, mappingSourceKind, mappingTargetPayload, sourceLocationLabel } from '../mappingForm';
import { historyReturnUrl } from '../historyNavigation';
import GovernanceAssets from './GovernanceAssets';
import MappingLineageGraph from './MappingLineageGraph';

const mappingTypes = { property: '属性映射', relation: '关系映射' };
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
  binding_mode: 'governed', governance_asset_code: '', governance_field: '', governance_relation_fields: ['', ''],
  source_code: '', source_kind: 'table', source_table: '', source_field: '', source_key: '', target_key: '',
  target_object_type: '', target_property: '', target_relation: '', map_way: '直接映射',
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

function SchemaBrowser({ tables, query, onQueryChange, onPick, selectedTable = '', selectedField = '', pickLabel = '选用字段' }) {
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

export default function DataMappingStudio({ activeId, notify }) {
  const location = useLocation();
  const navigate = useNavigate();
  const mappingSeedApplied = useRef('');
  const historyFocusApplied = useRef('');
  const [sources, setSources] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [assets, setAssets] = useState([]);
  const [assetSeed, setAssetSeed] = useState(null);
  const [objects, setObjects] = useState([]);
  const [links, setLinks] = useState([]);
  const [releases, setReleases] = useState([]);
  const [graphRelease, setGraphRelease] = useState('working');
  const [graphSnapshot, setGraphSnapshot] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [activeTab, setActiveTab] = useState('assets');
  const [mappingTab, setMappingTab] = useState('all');
  const [driverFilter, setDriverFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [help, setHelp] = useState(false);
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(emptySource());
  const [detail, setDetail] = useState(null);
  const [sourceSchema, setSourceSchema] = useState(null);
  const [schemaQuery, setSchemaQuery] = useState('');
  const [remoteTables, setRemoteTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

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
  useEffect(() => { setSources(null); setDetail(null); setValidation(null); setGraphRelease('working'); setGraphSnapshot(null); load(); }, [activeId]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const objectValue = params.get('object');
    if (!objectValue || !sources) return;
    const seedKey = `${activeId}:${location.search}`;
    if (mappingSeedApplied.current === seedKey) return;
    const object = objects.find((item) => item.name === objectValue || item.id === objectValue);
    if (!object) return;
    const requestedAssetCode = params.get('asset') || '';
    const asset = assets.find((item) => item.code === requestedAssetCode && item.verification_status === 'confirmed');
    if (requestedAssetCode && !asset) notify('所选治理资产不再处于已确认状态；已保留对象上下文，请重新选择资产。');
    setActiveTab('mappings'); setMappingTab('property'); setQuery(''); setDetail(null);
    setForm({ ...emptyMapping(), mapping_type: 'property', binding_mode: 'governed',
      governance_asset_code: asset?.code || '', target_object_type: object.name });
    setEditor({ kind: 'mapping', item: null });
    mappingSeedApplied.current = seedKey;
  }, [activeId, location.search, sources, objects, assets, notify]);
  // 接收“变更记录 → 打开该资源”的跳转：切到对应页签、清空筛选，并选中该资源。
  // 地址由 historyNavigation.resourcePageUrl 生成，带回 from_history/resource_type/resource_id。
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('from_history') !== '1') return;
    const type = params.get('resource_type');
    const id = params.get('resource_id');
    if (!id || (type !== 'data_source' && type !== 'data_mapping')) return;
    if (!sources) return;
    const key = `${activeId}:${type}:${id}`;
    if (historyFocusApplied.current === key) return;
    const pool = type === 'data_source' ? sources : mappings;
    const index = pool.findIndex((item) => String(item.id) === id);
    if (index < 0) {
      navigate(`${historyReturnUrl(location.search)}&not_found=1`, { replace: true });
      return;
    }
    historyFocusApplied.current = key;
    setActiveTab(type === 'data_source' ? 'sources' : 'mappings');
    setMappingTab('all'); setDriverFilter('all'); setQuery('');
    setPage(Math.floor(index / pageSize) + 1);
    setDetail({ kind: type === 'data_source' ? 'source' : 'mapping', item: pool[index] });
  }, [activeId, location.search, sources, mappings, pageSize, navigate]);
  useEffect(() => {
    if (graphRelease === 'working') { setGraphSnapshot(null); return; }
    let cancelled = false;
    api(`/api/ontologies/${activeId}/releases/${graphRelease}/snapshot`)
      .then((snapshot) => { if (!cancelled) setGraphSnapshot(snapshot); })
      .catch((cause) => { if (!cancelled) notify(cause.message); });
    return () => { cancelled = true; };
  }, [activeId, graphRelease]);
  useEffect(() => { setPage(1); }, [activeTab, mappingTab, driverFilter, query, pageSize]);
  const visible = useMemo(() => activeTab === 'sources'
    ? (sources || []).filter((item) => (driverFilter === 'all' || (driverFilter === 'none' ? !item.driver : item.driver === driverFilter))
      && `${item.name} ${item.code} ${item.physical_object || ''} ${item.database || ''} ${item.system_type || ''} ${item.data_subject || ''} ${driverLabel(item.driver)}`.toLowerCase().includes(query.toLowerCase()))
    : mappings.filter((item) => (mappingTab === 'all' || item.mapping_type === mappingTab)
      && `${item.name} ${item.code} ${item.source_code || ''} ${item.source_table || ''} ${item.source_field || ''} ${item.governance_asset_code || ''} ${item.target_object_type || ''} ${item.target_property || ''} ${item.target_relation || ''}`.toLowerCase().includes(query.toLowerCase())),
  [sources, mappings, activeTab, mappingTab, driverFilter, query]);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const rows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedDetail = rows.length ? {
    kind: activeTab === 'sources' ? 'source' : 'mapping',
    item: rows.find((item) => item.id === detail?.item.id) || rows[0],
  } : null;
  const sourceCode = editor?.kind === 'mapping' ? form.source_code : selectedDetail?.kind === 'source' ? selectedDetail.item.code : '';
  const selectedSource = sources?.find((source) => source.code === sourceCode);
  useEffect(() => {
    let cancelled = false;
    setSourceSchema(null);
    if (!selectedSource) return;
    api(`/api/ontologies/${activeId}/enterprise/data-sources/${selectedSource.id}/schema`)
      .then((value) => { if (!cancelled) setSourceSchema(value); })
      .catch(() => { if (!cancelled) setSourceSchema(null); });
    return () => { cancelled = true; };
  }, [activeId, selectedSource?.id, selectedSource?.schema_snapshot?.id]);
  const tables = sourceSchema?.schema?.tables || [];
  const sourceForDetail = selectedDetail?.kind === 'source' ? selectedDetail.item : null;
  const objectLabel = (name) => objects.find((item) => item.name === name)?.display_name || name || '—';
  const mappingTargetLabel = (item) => {
    if (item.mapping_type !== 'relation') return objectLabel(item.target_object_type);
    const relation = links.find((link) => link.name === item.target_relation);
    if (!relation) return item.target_relation || '—';
    const start = objects.find((object) => object.id === relation.source_object_type_id)?.display_name;
    const end = objects.find((object) => object.id === relation.target_object_type_id)?.display_name;
    return start && end ? `${start}—${relation.display_name}—${end}` : relation.display_name;
  };
  const mappingPropertyLabel = (item) => {
    if (item.mapping_type === 'relation') return '—';
    const object = objects.find((entry) => entry.name === item.target_object_type);
    return object?.properties?.find((property) => property.key === item.target_property)?.name || item.target_property || '—';
  };
  const mappingTypeLabel = (item) => mappingTypes[item.mapping_type] || '待修正类型';
  const mappingSourceLabel = (item) => item.binding_mode === 'governed'
    ? assets.find((asset) => asset.code === item.governance_asset_code)?.name || item.governance_asset_code || '治理资产缺失'
    : sources?.find((source) => source.code === item.source_code)?.name || item.source_system_display || item.source_code || '—';
  const mappingWayLabel = (item) => ({ direct: '直接映射', expression: '表达式转换', lookup: '字典关联' })[item.map_way] || item.map_way || '—';
  const mappingStatusLabel = (item) => item.design_status || ({ draft: '设计中', experimental: '设计中', active: '已确认', deprecated: '已停用' })[item.status] || '待确认';
  const mappingUpdateLabel = (item) => item.update_method_display || ({ realtime: '实时', event: '事件触发', batch: '批量', manual: '手工触发' })[item.update_method] || item.update_method || '—';
  useEffect(() => { setValidation(null); }, [selectedDetail?.item.id, activeTab]);
  useEffect(() => { setRemoteTables([]); setSelectedTables([]); }, [sourceForDetail?.id]);
  useEffect(() => { setSchemaQuery(''); }, [selectedSource?.id]);

  const startSource = (item = null) => {
    setEditor({ kind: 'source', item });
    const legacySubjectCode = subjects.find((subject) => subject.code === item?.data_topic)?.code || '';
    setForm(item ? { ...emptySource(), ...item,
      data_subject: item.data_subject || (legacySubjectCode ? '' : item.data_topic) || '',
      subject_domain_code: item.subject_domain_code || legacySubjectCode, password: '' } : emptySource());
  };
  const startMapping = (item = null) => {
    setEditor({ kind: 'mapping', item });
    const source = sources?.find((entry) => entry.code === item?.source_code);
    setForm({ ...emptyMapping(), ...(item || {}), binding_mode: 'governed', governance_asset_code: item?.governance_asset_code || '',
      governance_field: item?.governance_field || '', governance_relation_fields: item?.governance_relation_fields || ['', ''], source_code: item?.source_code || source?.code || '',
      source_kind: mappingSourceKind(item || {}, source), source_key: item?.source_key ? mappingKeyLabel(item) : '', target_key: '', relation_key_mode: 'link_table' });
  };
  const startMappingFromField = (source, table, column) => {
    setActiveTab('assets'); setDetail(null);
    setAssetSeed({ sourceCode: source.code, table });
    notify(`已带入 ${table.name} 的结构，请登记为待确认治理资产；核对后再做语义映射。`);
  };
  const save = async (event) => {
    event.preventDefault(); setBusy('save');
    const sourceMode = editor.kind === 'source';
    const objectName = objects.find((item) => item.name === form.target_object_type)?.display_name || form.target_object_type;
    const propertyName = objects.find((item) => item.name === form.target_object_type)?.properties?.find((item) => item.key === form.target_property)?.name || form.target_property;
    const relationName = links.find((item) => item.name === form.target_relation)?.display_name || form.target_relation;
    const generatedName = form.mapping_type === 'relation' ? `${relationName || '关系'}映射` : `${objectName || '对象'} · ${propertyName || '属性'}`;
    const base = { code: form.code.trim(), name: sourceMode ? form.name.trim() : editor.item?.mapping_type === form.mapping_type ? editor.item.name : generatedName,
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
        update_method_display: form.update_method === editor.item?.update_method && editor.item?.update_method_display
          ? editor.item.update_method_display : ({ realtime: '实时', event: '事件触发', batch: '批量', manual: '手工触发' })[form.update_method] || '',
        mapping_editor_version: 3, mapping_type_display: mappingTypes[form.mapping_type],
        binding_mode: 'governed', governance_asset_code: form.governance_asset_code,
        governance_field: form.mapping_type === 'property' ? form.governance_field : '',
        governance_relation_fields: form.mapping_type === 'relation' ? form.governance_relation_fields : [],
        mapping_type: form.mapping_type, ...mappingTargetPayload(form),
        source_kind: editor.item?.source_kind || '', source_code: editor.item?.source_code || '',
        source_table: editor.item?.source_table || '', source_system_display: editor.item?.source_system_display || '',
        source_field: editor.item?.source_field || '', source_key: editor.item?.source_key || '', target_key: editor.item?.target_key || '',
        map_way: form.map_way, transform_rule: form.transform_rule,
        lookup_dictionary: form.lookup_dictionary, update_method: form.update_method, quality_rule: form.quality_rule };
    const kind = sourceMode ? 'data-sources' : 'data-mappings';
    const path = editor.item ? `/api/ontologies/${activeId}/enterprise/${kind}/${editor.item.id}` : `/api/ontologies/${activeId}/enterprise/${kind}`;
    try {
      const saved = await api(path, { method: editor.item ? 'PUT' : 'POST', body: JSON.stringify({ ...base, category: sourceMode ? form.system_type : mappingTypes[form.mapping_type], payload }) });
      setEditor(null); await load(); setDetail({ kind: sourceMode ? 'source' : 'mapping', item: saved }); setValidation(null);
      notify(sourceMode ? form.driver === 'mysql' ? '物理来源已保存，可测试连接并获取结构' : '物理来源已登记；请导入 CSV 或 JSON 数据字典以获取结构' : '语义映射已保存到工作状态；当前只登记结构和语义，不执行数据同步。');
    } catch (cause) { notify(cause.message); } finally { setBusy(''); }
  };
  const remove = async (kind, item) => {
    if (!window.confirm(`确定删除“${item.name}”吗？存在引用时系统会拒绝删除。`)) return;
    try {
      await api(`/api/enterprise/${kind === 'source' ? 'data-sources' : 'data-mappings'}/${item.id}`, { method: 'DELETE' });
      setDetail(null); await load(); notify('已删除');
    } catch (cause) { notify(cause.message); }
  };
  const sourceAction = async (action, item, body) => {
    setBusy(action);
    try {
      const result = await api(`/api/ontologies/${activeId}/enterprise/data-sources/${item.id}/${action}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      await load();
      if (action === 'capture-schema' || action === 'import-schema' || action === 'import-ddl') setSourceSchema(result);
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
      }
      else {
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
  return <div className="mapping-studio mapping-v2">
    <div className="mapping-topbar"><nav aria-label="数据源与映射">
      <button className={activeTab === 'assets' ? 'active' : ''} onClick={() => { setActiveTab('assets'); setDetail(null); }}>治理资产 <b>{assets.length}</b></button>
      <button className={activeTab === 'mappings' ? 'active' : ''} onClick={() => { setActiveTab('mappings'); setDetail(null); }}>语义映射 <b>{mappings.length}</b></button>
      <button className={activeTab === 'graph' ? 'active' : ''} onClick={() => { setActiveTab('graph'); setDetail(null); }}>映射图谱</button>
      <button className={activeTab === 'sources' ? 'active' : ''} onClick={() => { setActiveTab('sources'); setDetail(null); }}>物理来源 <b>{sources.length}</b></button>
    </nav><div className="mapping-top-actions"><div className="mapping-help-wrap"><button className="mapping-icon-button" aria-label="功能说明" onClick={() => setHelp(!help)}><HelpCircle size={17} /></button>{help && <div className="mapping-help"><button aria-label="关闭说明" onClick={() => setHelp(false)}><X size={14} /></button><strong>三层结构映射</strong><p>物理来源 → 数据治理资产 → 本体语义。已治理企业登记既有目录资产；未治理企业可由物理结构生成待确认候选。旧直连映射保留并标记待适配；当前不导入实例数据。</p></div>}</div>
      {activeTab === 'sources' && <button className="mapping-primary" onClick={() => startSource()}><Plus size={16} />登记物理来源</button>}
      {activeTab === 'mappings' && <button className="mapping-primary" onClick={() => startMapping()}><Plus size={16} />新建语义映射</button>}</div></div>
    {activeTab === 'assets' && <GovernanceAssets activeId={activeId} assets={assets} sources={sources} reload={load} notify={notify} seed={assetSeed} onSeedConsumed={() => setAssetSeed(null)} />}
    {activeTab === 'graph' && <><div className="mapping-controls"><label>图谱版本<select value={graphRelease} onChange={(event) => { setGraphSnapshot(null); setGraphRelease(event.target.value); }}><option value="working">当前工作状态</option>{releases.map((release) => <option key={release.id} value={release.id}>{release.version} · 已发布</option>)}</select></label><span>{graphRelease === 'working' ? '展示当前配置' : graphSnapshot ? `只读查看 ${graphSnapshot.version} 发布时的映射` : '正在加载历史版本…'}</span></div>{(graphRelease === 'working' || graphSnapshot) && <MappingLineageGraph sources={graphSnapshot?.enterprise_resources?.['data-sources'] || sources} assets={graphSnapshot?.enterprise_resources?.['governance-assets'] || assets} mappings={graphSnapshot?.enterprise_resources?.['data-mappings'] || mappings} objects={graphSnapshot?.object_types || objects} links={graphSnapshot?.link_types || links} />}</>}
    {(activeTab === 'sources' || activeTab === 'mappings') && <>
    <div className="mapping-controls"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={activeTab === 'sources' ? '搜索系统、编码或数据库类型' : '搜索映射、数据源或目标对象'} /></label>{activeTab === 'sources' && <select aria-label="按数据库类型筛选" value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)}><option value="all">全部数据库类型</option>{databaseDrivers.map(([key, name]) => <option value={key} key={key}>{name}</option>)}<option value="none">未指定</option></select>}{activeTab === 'mappings' && <select aria-label="按映射类型筛选" value={mappingTab} onChange={(event) => setMappingTab(event.target.value)}><option value="all">全部类型</option>{Object.entries(mappingTypes).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>}<button onClick={load}><RefreshCw size={15} /> 刷新</button></div>
    <div className="mapping-v2-layout">
      <div className="mapping-v2-list-pane"><div className="mapping-v2-pane-heading"><strong>{activeTab === 'sources' ? '物理来源目录' : '语义映射目录'}</strong><span>{activeTab === 'mappings' ? '新映射经治理资产绑定；旧直连记录标记待适配' : '物理来源仅用于结构采集与上游血缘'}</span></div>
      {activeTab === 'sources' ? <section className="mapping-v2-table source-list"><header><span>系统名称／数据源ID</span><span>系统类型</span><span>数据库/接口/文件</span><span>数据库类型</span><span>数据主题</span><span>更新频率</span><span>接口方式</span><span>状态</span></header>
        {rows.map((item) => <button type="button" key={item.id} className={selectedDetail?.item.id === item.id ? 'selected' : ''} onClick={() => setDetail({ kind: 'source', item })}><span><strong>{item.name}</strong><small>{item.code}{item.source_origin === 'built_in_demo' && item.connection_check?.status !== 'passed' ? ' · 演示登记' : ''}</small></span><span title={item.system_type || ''}>{item.system_type || '未填写'}</span><span title={item.physical_object || ''}>{item.physical_object || '未填写'}</span><span title={driverLabel(item.driver)}>{item.driver ? driverLabel(item.driver) : '未指定'}</span><span title={item.data_subject || ''}>{item.data_subject || '未填写'}</span><span title={item.update_frequency || ''}>{item.update_frequency || '未填写'}</span><span title={item.interface_type || ''}>{item.interface_type || '未填写'}</span><span><em className={`mapping-status ${item.status || ''}`}>{statusLabel(item.status)}</em></span></button>)}
        {!rows.length && <EmptyState title="没有匹配的数据源" description="登记业务系统后，可以配置连接或导入结构字典。" />}</section>
        : <section className={`mapping-v2-table mapping-list ${mappingTab === 'relation' ? 'relation-only' : ''}`}><header><span>映射ID</span><span>映射类型</span><span>{mappingTab === 'property' ? '本体对象' : mappingTab === 'relation' ? '本体关系' : '本体对象/关系'}</span>{mappingTab !== 'relation' && <span>本体属性</span>}<span>治理资产／旧来源</span><span>{mappingTab === 'relation' ? '关联来源' : '来源位置'}</span><span>字段</span><span>状态</span></header>
          {rows.map((item) => <button type="button" key={item.id} className={selectedDetail?.item.id === item.id ? 'selected' : ''} onClick={() => setDetail({ kind: 'mapping', item })}><span><strong>{item.code}</strong></span><span>{mappingTypeLabel(item)}</span><span title={mappingTargetLabel(item)}>{mappingTargetLabel(item)}</span>{mappingTab !== 'relation' && <span title={mappingPropertyLabel(item)}>{mappingPropertyLabel(item)}</span>}<span title={mappingSourceLabel(item)}>{mappingSourceLabel(item)}</span><span title={item.source_table || ''}>{item.binding_mode === 'governed' ? '数据治理层' : item.source_table || '—'}<small>{item.binding_mode === 'governed' ? '语义绑定' : '物理直连 · 待适配'}</small></span><span title={item.source_field || ''}><strong>{item.binding_mode === 'governed' ? item.mapping_type === 'relation' ? (item.governance_relation_fields || []).join(' / ') : item.governance_field || '—' : item.source_field || '—'}</strong><small>{item.binding_mode === 'governed' ? '治理资产字段' : '旧模板来源字段'}</small></span><span className={mappingStatusLabel(item) === '已确认' && item.binding_mode === 'governed' ? 'mapping-status confirmed' : 'mapping-status'}>{mappingStatusLabel(item)}{item.binding_mode !== 'governed' ? ' · 待适配' : ''}</span></button>)}
          {!rows.length && <EmptyState title="没有匹配的数据映射" description="从对象主键映射开始，逐步补充属性和关系映射。" />}</section>}
      <PaginationBar page={currentPage} pageSize={pageSize} total={visible.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></div>

      <aside className="mapping-v2-inspector"><header><strong>{activeTab === 'sources' ? '数据源详情' : '映射详情'}</strong>{selectedDetail && <div><ResourceHistoryLink resourceType={selectedDetail.kind === 'source' ? 'data_source' : 'data_mapping'} resourceId={selectedDetail.item.id} /><button onClick={() => selectedDetail.kind === 'source' ? startSource(selectedDetail.item) : startMapping(selectedDetail.item)}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={() => remove(selectedDetail.kind, selectedDetail.item)}><Trash2 size={14} /> 删除</button></div>}</header>
      <div key={selectedDetail?.item.id || activeTab} className="mapping-drawer-body">{!selectedDetail ? <EmptyState title="请选择记录" description="从左侧目录选择一条记录查看详情。" /> : selectedDetail.kind === 'source' ? <><h3>{sourceForDetail.name}</h3>{sourceForDetail.source_origin === 'built_in_demo' && sourceForDetail.connection_check?.status !== 'passed' && <p>这是内置采购财务演示登记，不代表已接入真实系统。</p>}<h4>来源登记信息</h4><dl><div><dt>数据源ID</dt><dd>{sourceForDetail.code}</dd></div><div><dt>登记状态</dt><dd>{statusLabel(sourceForDetail.status)}</dd></div><div><dt>系统类型</dt><dd>{sourceForDetail.system_type || '—'}</dd></div><div><dt>数据库/接口/文件</dt><dd>{sourceForDetail.physical_object || '—'}</dd></div><div><dt>数据主题</dt><dd>{sourceForDetail.data_subject || '—'}</dd></div><div><dt>更新频率</dt><dd>{sourceForDetail.update_frequency || '—'}</dd></div><div><dt>数据范围</dt><dd>{sourceForDetail.data_scope || '—'}</dd></div><div><dt>数据类别</dt><dd>{sourceForDetail.data_category || '—'}</dd></div><div><dt>接口方式</dt><dd>{sourceForDetail.interface_type || '—'}</dd></div></dl><h4>本体分类关联（扩展配置）</h4><dl><div><dt>关联主题域</dt><dd>{subjects.find((item) => item.code === sourceForDetail.subject_domain_code)?.name || sourceForDetail.subject_domain_code || '未关联'}</dd></div></dl><h4>连接与结构采集（扩展配置）</h4><dl><div><dt>数据库类型</dt><dd>{driverLabel(sourceForDetail.driver)}</dd></div><div><dt>连接地址</dt><dd>{sourceForDetail.host ? `${sourceForDetail.host}:${sourceForDetail.port}/${sourceForDetail.database}` : '未配置'}</dd></div><div><dt>凭据</dt><dd>{sourceForDetail.driver === 'mysql' ? sourceForDetail.credential_configured ? '已安全保存' : '未配置' : '不适用'}</dd></div><div><dt>连接检测</dt><dd>{sourceForDetail.driver === 'mysql' ? sourceForDetail.connection_check?.status === 'passed' ? `通过 · ${formatTime(sourceForDetail.connection_check.checked_at)}` : '未检测' : '暂不支持直连'}</dd></div><div><dt>结构快照</dt><dd>{sourceForDetail.schema_snapshot ? `${sourceForDetail.schema_snapshot.table_count} 张表 · ${formatTime(sourceForDetail.schema_snapshot.captured_at)}` : '未获取'}</dd></div></dl>{sourceForDetail.driver && sourceForDetail.driver !== 'mysql' && <p className="mapping-driver-note">{driverLabel(sourceForDetail.driver)} 已登记；当前尚不支持直连采集，请导入 CSV 或 JSON 数据字典。</p>}
        <div className="mapping-drawer-actions">{sourceForDetail.driver === 'mysql' && <button disabled={Boolean(busy)} onClick={() => sourceAction('test-connection', sourceForDetail)}><CheckCircle2 size={15} /> 测试连接</button>}{sourceForDetail.driver === 'mysql' && <button disabled={Boolean(busy) || sourceForDetail.connection_check?.status !== 'passed'} onClick={() => browseTables(sourceForDetail)}><Database size={15} /> 选择/刷新来源表</button>}<label className="mapping-upload"><FileUp size={15} /> 导入结构文件<input type="file" accept={sourceForDetail.driver && sourceForDetail.driver !== "mysql" ? ".csv,.json" : ".csv,.json,.sql"} hidden onChange={(event) => { importDictionary(event.target.files?.[0], sourceForDetail); event.target.value = ''; }} /></label><button onClick={() => { setActiveTab('assets'); setDetail(null); }}><ArrowRight size={15} /> 查看治理资产</button></div>
        {remoteTables.length > 0 && <section className="mapping-remote-tables"><h4>选择要采集结构的物理表</h4><p>这里只采集选中表的结构，不读取业务行；采集结果可作为待确认治理资产的候选来源。</p><div>{remoteTables.map((table) => <label key={table.name}><input type="checkbox" checked={selectedTables.includes(table.name)} onChange={() => setSelectedTables((old) => old.includes(table.name) ? old.filter((name) => name !== table.name) : [...old, table.name])} /><span>{table.name}</span><small>{table.comment}</small></label>)}</div><button disabled={!selectedTables.length || Boolean(busy)} onClick={() => sourceAction('capture-schema', sourceForDetail, { table_names: selectedTables })}>获取所选 {selectedTables.length} 张表的结构</button></section>}
        <section className="mapping-schema"><h4>已获取的表结构</h4>{sourceSchema?.captured_at && <p>结构快照：{formatTime(sourceSchema.captured_at)}。这里只展示字段元数据，不读取业务记录。</p>}{tables.length ? <SchemaBrowser tables={tables} query={schemaQuery} onQueryChange={setSchemaQuery} onPick={(table, column) => startMappingFromField(sourceForDetail, table, column)} pickLabel="生成治理候选" /> : <p>尚无结构快照。MySQL 可直连采集；其他类型请导入含表名、字段名、数据类型的 CSV 或 JSON 数据字典。</p>}</section></>
        : <><h3>{selectedDetail.item.name}</h3><p>{selectedDetail.item.description || '模板映射记录'}</p>
          {selectedDetail.item.binding_mode !== 'governed' && <p className="mapping-layer-warning">旧版物理直连映射 · 待适配治理层。原始字段保留，不自动推断或覆盖。</p>}
          <h4>映射定义</h4><dl>
            <div><dt>映射ID</dt><dd>{selectedDetail.item.code}</dd></div>
            <div><dt>映射类型</dt><dd>{mappingTypeLabel(selectedDetail.item)}</dd></div>
            <div><dt>{selectedDetail.item.mapping_type === 'relation' ? '本体关系' : '本体对象'}</dt><dd>{mappingTargetLabel(selectedDetail.item)}</dd></div>
            <div><dt>本体属性</dt><dd>{selectedDetail.item.mapping_type === 'relation' ? '-' : mappingPropertyLabel(selectedDetail.item)}</dd></div>
            {selectedDetail.item.binding_mode === 'governed' && <><div><dt>治理资产</dt><dd>{mappingSourceLabel(selectedDetail.item)}</dd></div><div><dt>治理字段</dt><dd>{selectedDetail.item.mapping_type === 'relation' ? (selectedDetail.item.governance_relation_fields || []).join(' / ') : selectedDetail.item.governance_field || '—'}</dd></div></>}
            {selectedDetail.item.source_code && <><div><dt>模板来源系统</dt><dd>{sources.find((source) => source.code === selectedDetail.item.source_code)?.name || selectedDetail.item.source_system_display || selectedDetail.item.source_code}</dd></div><div><dt>模板来源表/接口</dt><dd>{selectedDetail.item.source_table || '—'}</dd></div><div><dt>模板来源字段</dt><dd>{selectedDetail.item.source_field || '—'}</dd></div><div><dt>模板主键/关联键</dt><dd>{mappingKeyLabel(selectedDetail.item)}</dd></div></>}
            <div><dt>映射方式</dt><dd>{mappingWayLabel(selectedDetail.item)}</dd></div><div><dt>转换规则</dt><dd>{selectedDetail.item.transform_rule || '—'}</dd></div><div><dt>质量校验</dt><dd>{selectedDetail.item.quality_rule || '—'}</dd></div><div><dt>更新方式</dt><dd>{mappingUpdateLabel(selectedDetail.item)}</dd></div><div><dt>负责人</dt><dd>{selectedDetail.item.owner || '—'}</dd></div><div><dt>状态</dt><dd>{mappingStatusLabel(selectedDetail.item)}</dd></div>
          </dl><div className="mapping-drawer-actions"><button disabled={Boolean(busy)} onClick={() => validate(selectedDetail.item)}><CheckCircle2 size={15} /> 校验映射配置</button></div>{validation && <section className="mapping-validation"><h4>{validation.status === 'valid' ? '静态校验通过' : validation.status === 'error' ? '发现阻断问题' : '存在待确认项'}</h4><p>仅核对模型与已有元数据，不读取业务数据；校验于 {formatTime(validation.checked_at)}。</p>{validation.checks.map((item, index) => <div key={`${item.name}-${index}`} className={item.level}><strong>{item.name}</strong><span>{item.detail}</span><em>{({ ok: '通过', error: '错误', warning: '警告', pending: '待验证' })[item.level]}</em></div>)}</section>}</>}
      </div></aside></div></>}

    {editor && <Modal wide title={editor.kind === 'source' ? `${editor.item ? '编辑' : '登记'}数据源` : `${editor.item ? '编辑' : '新建'}数据映射`} onClose={() => setEditor(null)} footer={<><button className="btn secondary" onClick={() => setEditor(null)}>取消</button><button className="btn primary" form="mapping-v2-form" disabled={busy === 'save'}>{busy === 'save' ? '保存中…' : '保存到工作状态'}</button></>}>
      <form id="mapping-v2-form" className="form-sections" onSubmit={save}><div className="form-section"><h3>基本信息</h3><div className="form-grid two"><label><span>{editor.kind === 'source' ? '数据源ID' : '映射ID'}</span><input required disabled={Boolean(editor.item)} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label>{editor.kind === 'source' && <><label><span>系统名称</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>登记状态（平台）</span><select value={form.status || 'draft'} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="draft">草稿</option><option value="active">已启用</option><option value="deprecated">已停用</option>{form.status && !['draft', 'active', 'deprecated'].includes(form.status) && <option value={form.status}>{statusLabel(form.status)}（已有值）</option>}</select><small>仅表示数据源登记的使用状态，不是连接测试结果。</small></label></>}</div></div>
      {editor.kind === 'source' ? <><div className="form-section"><h3>来源登记（对应模板 06_数据源）</h3><p className="form-hint">按业务系统原始口径填写；“数据主题”不等于本体的“主题域”，连接参数也不是模板事实。</p><div className="form-grid two">
        <DictionaryField kind="system_type" label="系统类型" required={!editor.item} value={form.system_type || ''} onChange={(value) => setForm({ ...form, system_type: value })} />
        <label><span>数据库/接口/文件</span><input required={!editor.item} value={form.physical_object || ''} onChange={(event) => setForm({ ...form, physical_object: event.target.value })} placeholder="如：运输任务接口/表；不是连接地址" /></label>
        <label><span>数据主题</span><input required={!editor.item} value={form.data_subject || ''} onChange={(event) => setForm({ ...form, data_subject: event.target.value })} placeholder="如：压力、流量、状态" /></label>
        <label><span>更新频率</span><input required={!editor.item} list="source-update-frequencies" value={form.update_frequency || ''} onChange={(event) => setForm({ ...form, update_frequency: event.target.value })} /><datalist id="source-update-frequencies">{sourceOptions.update_frequency.map((value) => <option value={value} key={value} />)}</datalist></label>
        <label><span>数据范围</span><input required={!editor.item} value={form.data_scope || ''} onChange={(event) => setForm({ ...form, data_scope: event.target.value })} /></label>
        <DictionaryField kind="data_category" label="数据类别" required={!editor.item} value={form.data_category || ''} onChange={(value) => setForm({ ...form, data_category: value })} />
        <DictionaryField kind="interface_type" label="接口方式" required={!editor.item} value={form.interface_type || ''} onChange={(value) => setForm({ ...form, interface_type: value })} />
      </div></div>
        <div className="form-section"><h3>数据库类型与结构获取</h3><p className="form-hint">数据库类型属于连接配置，不改变上面的模板字段。目前仅 MySQL 支持直连获取表结构；其余类型可登记并导入 CSV／JSON 数据字典。</p><div className="form-grid two">
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
        : <><MappingTargetFields form={form} setForm={setForm} objects={objects} links={links} />
        <section className="form-section"><h3>治理资产来源</h3><p className="form-hint">新映射只绑定数据治理层的资产，不再直连物理表。若编辑旧映射，保存后将迁移为治理层绑定，原模板物理来源字段保留为历史溯源。</p><div className="form-grid two">
          <GovernedMappingFields form={form} setForm={setForm} assets={assets} />
          {!assets.some((item) => item.verification_status === 'confirmed') && <div className="mapping-layer-warning">当前没有已确认治理资产。<button type="button" onClick={() => { setEditor(null); setActiveTab('assets'); }}>先登记并确认治理资产</button></div>}
          {editor.item && !editor.item.binding_mode && <p className="mapping-layer-note">旧映射原值：{mappingSourceLabel(editor.item)} / {editor.item.source_table || '—'} / {editor.item.source_field || '—'}。这些字段只作溯源，不作为新映射的运行来源。</p>}
        </div></section><section className="form-section"><h3>转换与质量</h3><div className="form-grid two">{form.mapping_type === 'property' ? <DictionaryField kind="mapping_way" label="映射方式" value={form.map_way} onChange={(value) => setForm({ ...form, map_way: value })} /> : <label><span>映射方式</span><select value={form.map_way || '关联映射'} onChange={(event) => setForm({ ...form, map_way: event.target.value })}><option>关联映射</option>{form.map_way && form.map_way !== '关联映射' && <option>{form.map_way}（已有值）</option>}</select><small>V4 映射方式字典尚无“关联映射”代码，关系映射暂保留模板原值。</small></label>}
          <label><span>转换规则</span><input value={form.transform_rule || ''} onChange={(event) => setForm({ ...form, transform_rule: event.target.value })} placeholder="无转换可填 -" /></label>
          <label><span>质量校验</span><input value={form.quality_rule || ''} onChange={(event) => setForm({ ...form, quality_rule: event.target.value })} placeholder="如：非空+唯一" /></label>
          <label><span>更新方式</span><select value={form.update_method || ''} onChange={(event) => setForm({ ...form, update_method: event.target.value })}><option value="">待确定</option><option value="realtime">实时</option><option value="event">事件触发</option><option value="batch">批量</option><option value="manual">手工触发</option></select></label>
        </div></section><section className="form-section"><h3>维护责任与状态</h3><p className="form-hint">与模板字段一致，保存后进入当前工作状态。</p><div className="form-grid two"><label><span>负责人</span><input required value={form.owner || ''} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="填写负责岗位或人员" /></label>
          <label><span>状态</span><select value={form.design_status || '设计中'} onChange={(event) => setForm({ ...form, design_status: event.target.value })}><option value="设计中">设计中</option><option value="已确认">已确认</option></select></label>
        </div></section></>}
      </form></Modal>}
  </div>;
}
