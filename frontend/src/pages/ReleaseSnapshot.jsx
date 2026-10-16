import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LockKeyhole, Search } from 'lucide-react';
import { api } from '../api';
import { ErrorState, Loading } from '../components/StateViews';
import './GovernanceInsights.css';

const sections = [
  ['business_domains', '业务域'], ['subject_domains', '主题域'],
  ['object_types', '对象类型'], ['interfaces', '接口'], ['link_types', '关系类型'],
  ['business_rules', '业务规则'], ['actions', '动作类型'],
  ['business-scenarios', '业务场景'], ['governance-assets', '治理资产'],
  ['data-sources', '数据源'], ['data-mappings', '数据映射'],
  ['logic-definitions', '规则与函数'], ['capabilities', '系统能力'],
  ['action-mappings', '执行映射'], ['permission-policies', '权限策略'],
  ['model_dictionaries', '字典项'],
];
const names = {
  code: '编码', name: '稳定标识', display_name: '名称', description: '说明', category: '类别',
  status: '发布状态', business_domain_id: '业务域', subject_domain_id: '主题域',
  title_property: '标题属性', backing_source: '映射数据源', interface_ids: '实现接口',
  source_object_type_id: '起点对象', target_object_type_id: '终点对象',
  cardinality: '基数', target_key: '终点关联键',
  target_object_type: '本体对象', target_property: '本体属性',
  target_relation: '本体关系', governance_asset_code: '治理资产',
  governance_field: '治理字段', governance_relation_fields: '关联字段',
  source_system: '来源系统', source_table: '来源表／接口', source_field: '来源字段',
  source_key: '来源／关联键', mapping_type: '映射类型', map_way: '映射方式',
  transform_rule: '转换规则', quality_rule: '质量校验', update_method: '更新方式',
  input_objects: '输入对象／数据', input_properties: '输入属性', output: '输出',
  trigger_mode: '触发方式', expression: '判断逻辑', owner: '负责人', properties: '属性',
  parameters: '输入参数', preconditions: '前置条件', execution_logic: '执行逻辑',
  system_type: '系统类型', database_type: '数据库类型', physical_object: '物理来源',
  data_topic: '数据主题', data_scope: '数据范围', data_category: '数据类别',
  interface_type: '接口方式', update_frequency: '更新频率',
};
const visibleFields = new Set(Object.keys(names));
function rowsFor(snapshot, section) {
  if (section === 'model_dictionaries') return Object.entries(snapshot?.model_dictionaries || {})
    .flatMap(([kind, items]) => items.map((item) => ({ ...item, id: `${kind}:${item.code}`, display_name: `${kind} · ${item.name}` })));
  return section.includes('-') ? snapshot?.enterprise_resources?.[section] || [] : snapshot?.[section] || [];
}
function formatValue(value) {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? item.display_name || item.name || item.key || item.code || '配置项' : item).join('、') || '—';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

export default function ReleaseSnapshot({ activeId }) {
  const { releaseId } = useParams();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [section, setSection] = useState('object_types');
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    setSnapshot(null); setError(''); setSelectedId('');
    if (activeId && releaseId) api(`/api/ontologies/${activeId}/releases/${releaseId}/snapshot`)
      .then(setSnapshot).catch((cause) => setError(cause.message));
  }, [activeId, releaseId]);
  const resources = useMemo(() => rowsFor(snapshot, section).filter((item) =>
    `${item.display_name || ''} ${item.name || ''} ${item.code || ''}`.toLowerCase().includes(query.toLowerCase())), [snapshot, section, query]);
  const selected = resources.find((item) => (item.id || item.code) === selectedId) || resources[0];
  if (error) return <ErrorState message={error} onRetry={() => navigate('/ontology/governance')} />;
  if (!snapshot) return <Loading />;
  return <div className="gi-page release-snapshot-page">
    <header className="gi-page-head"><div><small>只读发布快照</small><h2>{snapshot.ontology?.name} · {snapshot.version}</h2><p>这里展示该版本发布时的语义定义。后续编辑不会改变本页内容。</p></div><button onClick={() => navigate('/ontology/governance')}><ArrowLeft size={15} /> 返回版本与发布</button></header>
    <div className="release-snapshot-layout"><nav aria-label="历史版本资源分类">{sections.map(([key, label]) => <button key={key} className={section === key ? 'selected' : ''} onClick={() => { setSection(key); setSelectedId(''); setQuery(''); }}>{label}<span>{rowsFor(snapshot, key).length}</span></button>)}</nav>
      <section className="release-snapshot-list"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或编码" /></label>{resources.map((item) => <button key={item.id || item.code} className={(item.id || item.code) === (selected?.id || selected?.code) ? 'selected' : ''} onClick={() => setSelectedId(item.id || item.code)}><strong>{item.display_name || item.name || item.code}</strong><small>{item.code || item.name}</small></button>)}{!resources.length && <p>当前版本没有匹配的资源</p>}</section>
      <aside className="release-snapshot-detail"><h3><LockKeyhole size={17} /> {selected?.display_name || selected?.name || '选择一项资源'}</h3>{selected ? <dl>{Object.entries(selected).filter(([key]) => visibleFields.has(key)).map(([key, value]) => <div key={key}><dt>{names[key]}</dt><dd>{formatValue(value)}</dd></div>)}</dl> : <p>从左侧选择资源，查看该版本的定义。</p>}</aside>
    </div>
  </div>;
}
