import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clock3, ExternalLink, History, RefreshCw, Search, X } from 'lucide-react';
import { api } from '../api';
import { actorLabel, dataTypeLabel, localizeModelText, operationLabel, statusLabel } from '../labels';
import { resourcePageUrl, UNDESTINED_RESOURCE_TYPES } from '../historyNavigation';
import { ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import './ActivityLog.css';

const resourceNames = {
  ontology: '本体', 本体: '本体', business_domain: '业务域', 业务域: '业务域',
  subject_domain: '主题域', 主题域: '主题域', object_type: '对象类型', 对象: '对象类型',
  property: '属性', 属性: '属性', link_type: '关系类型', 关系: '关系类型',
  business_rule: '规则', 规则: '规则', logic_definition: '规则与函数',
  action: '动作类型', interface: '接口', data_source: '数据源', 数据源: '数据源',
  data_mapping: '数据映射', 映射: '数据映射', governance_asset: '治理资产',
  business_scenario: '业务场景', object_instance: '对象实例', link_instance: '关系实例',
  capability: '系统能力', capabilitie: '系统能力', action_mapping: '动作执行映射',
  permission_policy: '权限策略', permission_policie: '权限策略',
  proposal: '智能构建提案', evidence_source: '建模证据', version: '发布记录',
  object_type_group: '旧版对象类型组', shared_property: '旧版共享属性',
};
const resourceOptions = [
  ['ontology', '本体'], ['business_domain', '业务域'], ['subject_domain', '主题域'],
  ['object_type', '对象类型'], ['property', '属性'], ['link_type', '关系类型'],
  ['business_rule', '规则'], ['action', '动作类型'], ['interface', '接口'],
  ['data_source', '数据源'], ['governance_asset', '治理资产'],
  ['data_mapping', '数据映射'], ['business_scenario', '业务场景'],
  ['capability', '系统能力'], ['action_mapping', '动作执行映射'],
  ['permission_policy', '权限策略'], ['logic_definition', '规则与函数（旧）'],
  ['object_instance', '对象实例'], ['link_instance', '关系实例'],
  ['proposal', '智能构建提案'], ['evidence_source', '建模证据'],
  ['version', '发布记录'], ['object_type_group', '旧版对象类型组'],
  ['shared_property', '旧版共享属性'],
];
const fieldNames = {
  display_name: '显示名称', name: '稳定标识', code: '编码', external_id: '模板 ID',
  description: '描述', status: '资源状态', object_kind: '对象类别',
  title_property: '标题属性', subject_domain_id: '所属主题域 ID',
  business_domain_id: '所属业务域 ID', source_object_type_id: '起点对象 ID',
  target_object_type_id: '终点对象 ID', cardinality: '关系基数',
  action_type: '行动类型', data_type: '数据类型', mapping_type: '映射类型',
  owner: '负责人', properties: '属性', input_fields: '输入属性',
  output_description: '输出', trigger_mode: '触发方式',
};

function fullTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}
function displayValue(field, value) {
  if (value === null || value === undefined || value === '') return '无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (field === 'status') return statusLabel(value);
  if (field === 'data_type') return dataTypeLabel(value);
  if (field === 'object_kind' && value === 'business_object') return '业务对象';
  return typeof value === 'string' ? localizeModelText(value) : JSON.stringify(value, null, 2);
}
function contentParts(content) {
  const segments = String(content || '未记录具体内容').split(/[；\n]+/).map((part) => part.trim()).filter(Boolean);
  const out = [];
  segments.forEach((segment, index) => {
    let prefix = '';
    let body = segment;
    // 首个片段通常是「修改对象类型「客户」：backing_source：无 → 无」，标题与第一个字段粘在一起
    if (index === 0) {
      const head = segment.match(/^(.*?」)\s*[：:]\s*(.*)$/);
      if (head && head[2].includes('→')) { prefix = `${head[1]}：`; body = head[2]; }
    }
    // 两侧相同的字段（历史记录里 None 与 "" 都会渲染成“无”）没有信息量，丢掉但保留标题
    const pair = body.match(/^[^：:]*[：:]\s*(.*?)\s*→\s*(.*)$/);
    if (pair && pair[1] === pair[2]) {
      if (prefix) out.push(prefix.replace(/[：:]\s*$/, ''));
      return;
    }
    out.push(prefix + body);
  });
  return out.length ? out : ['未记录具体内容'];
}

export default function ActivityLog({ activeId, active, embedded = false }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const resourceType = searchParams.get('resource_type') || 'all';
  const resourceId = searchParams.get('resource_id') || '';
  // 从资源页点“变更记录”返回时会带回记录号与分页，用于恢复现场（historyReturnUrl 生成）
  const returnRecordId = Number(searchParams.get('record_id')) || null;
  const returnPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const returnPageSize = Math.max(1, Number(searchParams.get('page_size')) || 20);
  const resourceGone = searchParams.get('not_found') === '1';
  const [keyword, setKeyword] = useState('');
  const [operation, setOperation] = useState('all');
  const [includeSystem, setIncludeSystem] = useState(false);
  const [page, setPage] = useState(returnPage);
  const [pageSize, setPageSize] = useState(returnPageSize);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState(returnRecordId);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setPage(returnPage);
    setSelectedId(returnRecordId);
    // 仅在切换本体或改变资源作用域时重置；不跟随 record_id 变化，避免打断用户当前选择
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, resourceType, resourceId]);
  useEffect(() => {
    if (!activeId) return undefined;
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          page: String(page), page_size: String(pageSize), keyword: keyword.trim(),
          include_system: String(includeSystem),
        });
        if (resourceType !== 'all') params.set('resource_type', resourceType);
        if (resourceId) params.set('resource_id', resourceId);
        if (operation !== 'all') params.set('operation', operation);
        const result = await api(`/api/ontologies/${activeId}/model-changes?${params}`);
        if (live) {
          setData(result); setError('');
          setSelectedId((current) => result.items.some((item) => item.mvc_id === current)
            ? current : result.items[0]?.mvc_id ?? null);
        }
      } catch (cause) { if (live) setError(cause.message); }
    }, keyword ? 250 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [activeId, keyword, operation, includeSystem, resourceType, resourceId, page, pageSize, revision]);

  const selected = data?.items.find((item) => item.mvc_id === selectedId) || null;
  const extraNote = selected?.mvc_change_note && selected.mvc_change_note !== selected.mvc_chg_content
    && !selected.mvc_change_note.includes('已保存创建后快照')
    && !selected.mvc_change_note.includes('待本体发布')
    && !(selected.mvc_field_changes?.length && selected.mvc_change_note.includes('变更字段：'))
    ? selected.mvc_change_note.replace(`${selected.mvc_chg_content}；`, '').trim() : '';
  const scopeName = data?.items[0]?.mvc_resource_name || resourceId;
  // “记录 → 资源”跳转：地址由 historyNavigation 统一生成，接收页用 from_history 参数选中该资源
  const resourceTargetUrl = selected ? resourcePageUrl(selected, page, pageSize) : '';
  const resourceHasNoPage = Boolean(selected && !resourceTargetUrl
    && UNDESTINED_RESOURCE_TYPES.has(selected.mvc_res_type));
  const dismissResourceGone = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('not_found');
    setSearchParams(next);
  };
  const resetScope = () => setSearchParams(embedded ? { tab: 'changes' } : {});
  const setType = (value) => setSearchParams({
    ...(embedded ? { tab: 'changes' } : {}), ...(value === 'all' ? {} : { resource_type: value }),
  });
  if (error) return <ErrorState message={error} onRetry={() => setRevision((value) => value + 1)} />;
  return <div className={`history-page ${embedded ? 'embedded' : ''}`}>
    {!embedded && <header className="history-page-heading"><div><small>本体工作台 · {active?.name || '当前本体'}</small><h2>变更记录</h2><p>仅显示当前本体的新增、修改与删除，不混入其他本体的记录。</p></div></header>}
    <section className="history-shell">
      <div className="history-toolbar">
        <label className="history-search"><Search size={16} /><input aria-label="搜索变更记录" value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} placeholder="搜索资源名称、ID、变更内容或操作人" /></label>
        <select aria-label="筛选资源类型" value={resourceType} onChange={(event) => setType(event.target.value)}><option value="all">全部资源</option>{resourceOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select aria-label="筛选操作" value={operation} onChange={(event) => { setOperation(event.target.value); setPage(1); }}><option value="all">全部操作</option><option value="create">新增</option><option value="update">修改</option><option value="delete">删除</option></select>
        <label className="history-system"><input type="checkbox" checked={includeSystem} onChange={(event) => { setIncludeSystem(event.target.checked); setPage(1); }} /> 包含系统操作</label>
        <button type="button" className="history-refresh" onClick={() => setRevision((value) => value + 1)} title="刷新记录" aria-label="刷新记录"><RefreshCw size={15} /></button>
        <span className="history-total">共 {data?.total ?? 0} 条</span>
      </div>
      {resourceGone && <div className="history-scope history-resource-gone"><History size={14} /><span>该资源已不存在或不属于当前本体，已退回变更记录；历史记录仍然保留。</span><button onClick={dismissResourceGone}><X size={13} /> 知道了</button></div>}
      {resourceId && <div className="history-scope"><History size={14} /><span>仅看当前{resourceNames[resourceType] || '资源'}：<strong>{scopeName}</strong><code>{resourceId}</code></span><button onClick={resetScope}><X size={13} /> 查看本体全部记录</button></div>}
      <div className="history-layout">
        <div className="history-list-wrap">
          <div className="history-list-head"><span>时间</span><span>资源</span><span>操作</span><span>变更内容</span><span>操作人</span></div>
          {data?.items.map((item) => <button type="button" className={`history-log-row ${selectedId === item.mvc_id ? 'selected' : ''}`} onClick={() => setSelectedId(item.mvc_id)} key={item.mvc_id}>
            <time>{fullTime(item.mvc_created_at)}</time>
            <span className="history-resource"><strong>{item.mvc_resource_name || resourceNames[item.mvc_res_type] || '资源'}</strong><small>{resourceNames[item.mvc_res_type] || item.mvc_res_type || '资源'} · {item.mvc_chg_obj || '无 ID'}</small></span>
            <span><em className={`history-operation ${item.mvc_chg_type === '删除' ? 'delete' : item.mvc_chg_type === '新增' ? 'create' : ''}`}>{operationLabel(item.mvc_chg_type)}</em></span>
            <span className="history-summary" title={item.mvc_chg_content}>{localizeModelText(item.mvc_chg_content || '未记录具体内容')}</span>
            <span className="history-actor">{actorLabel(item.mvc_created_by)}</span>
          </button>)}
          {!data && <div className="history-empty"><Loading /></div>}
          {data && !data.items.length && <div className="history-empty"><Clock3 size={24} /><strong>暂无符合条件的记录</strong><span>可调整资源类型、操作或搜索词。</span></div>}
          <PaginationBar page={page} pageSize={pageSize} total={data?.total ?? 0} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
        </div>
        <aside className="history-detail">
          <header><strong>变更详情</strong><span>{selected ? `#${selected.mvc_id}` : ''}</span></header>
          {selected ? <div className="history-detail-body">
            <div className="history-detail-title"><em className={`history-operation ${selected.mvc_chg_type === '删除' ? 'delete' : selected.mvc_chg_type === '新增' ? 'create' : ''}`}>{operationLabel(selected.mvc_chg_type)}</em><h3>{selected.mvc_resource_name || resourceNames[selected.mvc_res_type] || '资源'}</h3><p>{resourceNames[selected.mvc_res_type] || selected.mvc_res_type}</p></div>
            <div className="history-detail-actions">
              {resourceTargetUrl
                ? <button type="button" className="history-open-resource" onClick={() => navigate(resourceTargetUrl)} title="前往该资源的编辑或查看页面"><ExternalLink size={14} /> 打开该资源</button>
                : resourceHasNoPage
                  ? <p className="history-detail-note">该资源类型在当前产品里没有独立的编辑或查看页面（旧版资源），变更内容只在本页保留。</p>
                  : <p className="history-detail-note">这条记录没有关联到可定位的资源 ID，无法跳转。</p>}
            </div>
            <section className="history-detail-section"><h4>资源定位</h4><dl><div><dt>记录编号</dt><dd>#{selected.mvc_id}</dd></div><div><dt>资源类型</dt><dd>{resourceNames[selected.mvc_res_type] || selected.mvc_res_type || '—'}</dd></div><div><dt>资源 ID</dt><dd className="history-id">{selected.mvc_chg_obj || '—'}</dd></div><div><dt>所属本体</dt><dd>{active?.name || selected.mvc_ontology_id || '—'}</dd></div></dl></section>
            <section className="history-detail-section"><h4>操作信息</h4><dl><div><dt>操作人</dt><dd>{actorLabel(selected.mvc_created_by)}</dd></div><div><dt>操作时间</dt><dd>{fullTime(selected.mvc_created_at)}</dd></div>{selected.mvc_updated_by && selected.mvc_updated_by !== selected.mvc_created_by && <div><dt>后续编辑人</dt><dd>{actorLabel(selected.mvc_updated_by)}</dd></div>}{selected.mvc_updated_at && <div><dt>后续编辑时间</dt><dd>{fullTime(selected.mvc_updated_at)}</dd></div>}{selected.mvc_source && <div><dt>操作来源</dt><dd>{selected.mvc_source}</dd></div>}</dl></section>
            <section><h4>变更内容</h4>{contentParts(selected.mvc_chg_content).map((part, index) => <p className="history-content-line" key={`${index}-${part}`}>{localizeModelText(part)}</p>)}</section>
            {selected.mvc_field_changes?.length > 0 && <section><h4>字段变化 · 操作时快照</h4>{selected.mvc_field_changes.map((field) => <div className="history-field-diff" key={field.field}><strong>{fieldNames[field.field] || field.field}</strong><div><span>修改前</span><code>{displayValue(field.field, field.before)}</code></div><div><span>修改后</span><code>{displayValue(field.field, field.after)}</code></div></div>)}</section>}
            {selected.mvc_snapshot_fields?.length > 0 && <section><h4>{selected.mvc_chg_type === '删除' ? '删除前资源摘要' : '操作时资源摘要'}</h4><dl className="history-snapshot-list">{selected.mvc_snapshot_fields.map((field) => <div key={field.field}><dt>{fieldNames[field.field] || field.field}</dt><dd>{displayValue(field.field, field.value)}</dd></div>)}</dl></section>}
            {selected.mvc_chg_reason && <section><h4>变更原因</h4><p className="history-content-line">{selected.mvc_chg_reason}</p></section>}
            {extraNote && <section><h4>补充说明</h4><p className="history-content-line">{localizeModelText(extraNote)}</p></section>}
            {selected.mvc_remark && <section><h4>备注</h4><p className="history-content-line">{selected.mvc_remark}</p></section>}
            {!selected.mvc_field_changes?.length && !selected.mvc_snapshot_fields?.length && <p className="history-detail-note">这条记录没有保存结构化字段差异或资源快照；不推断未记录的旧值。</p>}
          </div> : <div className="history-detail-empty"><History size={26} /><span>选择一条记录查看详情</span></div>}
        </aside>
      </div>
    </section>
  </div>;
}
