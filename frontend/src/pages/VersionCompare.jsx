import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, GitCompareArrows, Search } from 'lucide-react';
import { api } from '../api';
import { ErrorState, Loading } from '../components/StateViews';
import GovernanceInsightChat from '../components/GovernanceInsightChat';
import './GovernanceInsights.css';

const changeNames = { added: '新增', modified: '修改', removed: '删除' };
const fieldNames = {
  name: '名称', display_name: '显示名称', code: '编码', description: '业务说明',
  business_domain_id: '业务域', subject_domain_id: '主题域', title_property: '标题属性',
  properties: '属性', source_object_type_id: '起点对象', target_object_type_id: '终点/作用对象',
  cardinality: '基数', expression: '表达式', backing_source: '直接来源',
  parameters: '参数', interface_ids: '接口', category: '类别', payload: '配置',
  is_core: '核心对象', trigger_mode: '触发方式', severity: '严重级别',
};
const displayValue = (value, field, names = {}) => {
  if (value === undefined || value === null || value === '') return '—';
  if (field.endsWith('_id') && typeof value === 'string' && names[value]) return `${names[value]} (${value})`;
  if (field === 'interface_ids' && Array.isArray(value)) return value.map((id) => (names[id] ? `${names[id]} (${id})` : id)).join('、') || '—';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

// 产品已去掉“版本”概念：这里对比的是两个本体，不再选择发布版本。
export default function VersionCompare({ activeId, notify }) {
  const generation = useRef(0);
  const [ontologies, setOntologies] = useState(null);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [result, setResult] = useState(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const current = ++generation.current;
    setError('');
    try {
      const items = await api('/api/ontologies');
      if (current !== generation.current) return;
      setOntologies(items);
      const base = items.some((item) => item.id === activeId) ? activeId : items[0]?.id || '';
      setLeft(base);
      setRight((old) => (items.some((item) => item.id === old) && old !== base ? old : items.find((item) => item.id !== base)?.id || ''));
      setResult(null); setMessages([]);
    } catch (cause) { if (current === generation.current) setError(cause.message); }
  };
  useEffect(() => { generation.current += 1; setOntologies(null); if (activeId) load(); }, [activeId]);

  const compare = async () => {
    if (!left || !right || left === right) return;
    const current = ++generation.current;
    setBusy('compare');
    try {
      const data = await api(`/api/ontologies/${left}/compare-with`, { method: 'POST', body: JSON.stringify({ other_id: right }) });
      if (current === generation.current) {
        setResult(data); setSelectedKey(data.rows[0]?.key || '');
        setKindFilter('all'); setSectionFilter('all'); setSearch(''); setMessages([]);
      }
    } catch (cause) { notify(cause.message); } finally { setBusy(''); }
  };
  const send = async (message) => {
    if (!result) return;
    const current = generation.current;
    setMessages((old) => [...old, { role: 'user', text: message }]); setBusy('chat');
    try {
      const reply = await api(`/api/ontologies/${result.left.id}/compare-with/chat`, { method: 'POST', body: JSON.stringify({ other_id: result.right.id, message }) });
      if (current === generation.current) setMessages((old) => [...old, { role: 'assistant', text: reply.answer, mode: reply.mode }]);
    } catch (cause) { notify(cause.message); } finally { setBusy(''); }
  };

  const sections = useMemo(() => [...new Map((result?.rows || []).map((item) => [item.section, item.section_label])).entries()], [result]);
  const visible = (result?.rows || []).filter((item) => (kindFilter === 'all' || item.change === kindFilter) && (sectionFilter === 'all' || item.section === sectionFilter) && `${item.name} ${item.stable_id} ${item.section_label}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = visible.find((item) => item.key === selectedKey) || visible[0];

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!ontologies) return <Loading />;
  const enough = ontologies.length >= 2;
  const picker = (value, setValue, label) => <label>{label}<select aria-label={label} value={value} disabled={!!busy}
    onChange={(event) => { generation.current += 1; setValue(event.target.value); setResult(null); setMessages([]); }}>
    <option value="" disabled>选择本体</option>
    {ontologies.map((item) => <option key={item.id} value={item.id}>{item.name}{item.namespace ? ` · ${item.namespace}` : ''}</option>)}
  </select></label>;

  return <div className="gi-page">
    <header className="gi-page-head"><div><small>跨本体对比</small><h2>本体对比</h2><p>直接拿两个本体对比结构差异，不再选择版本。资源按业务标识配对，引用关系已归一化。</p></div></header>
    {!enough ? <p className="gi-inline-note">当前只有一个本体。要对比差异，请先复制一份本体作为分支，再回来对比。</p> : <>
      <section className="gi-compare-picker">
        {picker(left, setLeft, '基准本体')}
        <ArrowRight size={18} />
        {picker(right, setRight, '对比本体')}
        <button className="gi-primary" disabled={!left || !right || left === right || !!busy} onClick={compare}><GitCompareArrows size={16} /> {busy === 'compare' ? '对比中…' : '开始对比'}</button>
      </section>
      <div className="gi-main-layout">
        <GovernanceInsightChat title="差异解读" intro="选择两个本体并开始对比后，可以围绕差异提问。解读只依据已生成的差异表，不会自动判定兼容性或修改本体。" messages={messages} suggestions={['总结主要差异', '哪些资源被删除？', '要核对哪些下游依赖？']} onSend={send} busy={busy === 'chat'} disabled={!result} disabledHint="请先选择两个本体并开始对比" />
        <section className="gi-result-panel"><header><div><GitCompareArrows size={17} /><strong>结构差异</strong></div>{result && <small>{result.left.label} → {result.right.label}</small>}</header>
          {!result ? <div className="gi-empty"><GitCompareArrows size={32} /><strong>选择两个本体开始对比</strong><span>例如：原体 vs 复制出来的分支本体。</span></div> : <div className="gi-compare-body">
            <div className="gi-diff-summary"><b>{result.total}</b><span>项差异</span><em>新增 {result.counts.added}</em><em>修改 {result.counts.modified}</em><em>删除 {result.counts.removed}</em></div>
            <p className="gi-scope">{result.method}。{result.note}</p>
            <div className="gi-diff-filter"><label><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索资源名称或标识" /></label>
              <select aria-label="筛选变更类型" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="all">全部变化</option><option value="added">新增</option><option value="modified">修改</option><option value="removed">删除</option></select>
              <select aria-label="筛选资源类型" value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}><option value="all">全部资源</option>{sections.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
            {visible.length ? <div className="gi-diff-layout">
              <div className="gi-diff-list">{visible.map((item) => <button className={selected?.key === item.key ? 'active' : ''} key={item.key} onClick={() => setSelectedKey(item.key)}><span><strong>{item.name}</strong><small>{item.section_label} · {item.stable_id}</small></span><em className={item.change}>{changeNames[item.change]}</em></button>)}</div>
              <div className="gi-diff-detail"><h3>{selected.name} <em className={selected.change}>{changeNames[selected.change]}</em></h3><p>{selected.section_label} · {selected.changed_fields.length} 个差异字段</p><div className="gi-diff-columns">
                <div><strong>{result.left.label}</strong>{selected.changed_fields.map((field) => <dl key={field}><dt>{fieldNames[field] || field}</dt><dd>{displayValue(selected.left[field], field, result.reference_names?.left)}</dd></dl>)}</div>
                <div><strong>{result.right.label}</strong>{selected.changed_fields.map((field) => <dl key={field}><dt>{fieldNames[field] || field}</dt><dd>{displayValue(selected.right[field], field, result.reference_names?.right)}</dd></dl>)}</div>
              </div></div>
            </div> : <p className="gi-no-issues">{result.total ? '没有符合当前筛选条件的资源。' : `「${result.left.label}」与「${result.right.label}」在当前对比范围内没有语义差异。`}</p>}
          </div>}
        </section>
      </div>
    </>}
  </div>;
}
