import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import 'vis-network/styles/vis-network.css';
import { Focus, GitBranch, Network as NetworkIcon, RefreshCw, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ObjectTypeIcon } from '../components/ObjectTypeIcon';
import { dataTypeLabel, designStatusLabel, statusLabel } from '../labels';
import { ErrorState, Loading } from '../components/StateViews';

const cardinalities = { one_to_one: '1 : 1', one_to_many: '1 : N', many_to_one: 'N : 1', many_to_many: 'N : N' };

export default function GraphPage({ activeId, active }) {
  const [searchParams] = useSearchParams();
  const holder = useRef(null);
  const networkRef = useRef(null);
  const [graph, setGraph] = useState(null);
  const [objects, setObjects] = useState([]);
  const [links, setLinks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [isolate, setIsolate] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const requestedDomain = searchParams.get('domain') || '';
    const requestedSubject = searchParams.get('subject') || '';
    setGraph(null); setSelected(null); setError(''); setDomainFilter(requestedDomain); setSubjectFilter(requestedSubject); setIsolate(Boolean(requestedDomain || requestedSubject));
    Promise.all([
      api(`/api/ontologies/${activeId}/graph`), api(`/api/ontologies/${activeId}/object-types`), api(`/api/ontologies/${activeId}/link-types`),
    ]).then(([g, o, l]) => { setGraph(g); setObjects(o); setLinks(l); }).catch((e) => setError(e.message));
  }, [activeId]);

  const domainOptions = useMemo(() => {
    const values = new Map();
    objects.forEach((item) => { const value = item.business_domain_id || item.business_domain_name; const label = item.business_domain_name; if (value && label) values.set(value, label); });
    return [...values.entries()].map(([value, label]) => ({ value, label }));
  }, [objects]);
  const subjectOptions = useMemo(() => {
    const values = new Map();
    objects.filter((item) => !domainFilter || item.business_domain_id === domainFilter || item.business_domain_name === domainFilter || item.domain === domainFilter).forEach((item) => { if (item.subject_domain_id && item.subject_domain_name) values.set(item.subject_domain_id, item.subject_domain_name); });
    return [...values.entries()].map(([value, label]) => ({ value, label }));
  }, [objects, domainFilter]);
  const inScope = (node) => {
    const domainMatch = !domainFilter || node.business_domain_id === domainFilter || node.business_domain_name === domainFilter;
    const subjectMatch = !subjectFilter || node.subject_domain_id === subjectFilter;
    return domainMatch && subjectMatch;
  };
  const scopeStats = useMemo(() => {
    const nodes = graph?.nodes || [];
    const ids = new Set(nodes.filter(inScope).map((node) => node.id));
    const internal = (graph?.edges || []).filter((edge) => ids.has(edge.from) && ids.has(edge.to)).length;
    const cross = (graph?.edges || []).filter((edge) => ids.has(edge.from) !== ids.has(edge.to)).length;
    return { nodes: ids.size, internal, cross };
  }, [graph, domainFilter, subjectFilter]);

  useEffect(() => {
    if (!graph?.nodes.length || !holder.current) return undefined;
    const visibleNodes = graph.nodes.map((node) => {
      const focused = inScope(node);
      return {
        ...node, hidden: isolate && !focused, label: `${node.label}\n${node.name}`,
        title: `${node.label} · ${node.property_count || 0} 个属性 · ${node.business_domain_name || '未分类'}`,
        shape: 'box', margin: { top: 13, right: 18, bottom: 13, left: 18 }, widthConstraint: { minimum: 118 },
        color: focused ? { background: '#ffffff', border: '#6f9ed3', highlight: { background: '#eaf2ff', border: '#2169d7' }, hover: { background: '#f5f9ff', border: '#3979b9' } } : { background: '#f1f4f7', border: '#cbd4dd', highlight: { background: '#edf2f7', border: '#a9b7c4' }, hover: { background: '#edf2f7', border: '#a9b7c4' } },
        font: { face: 'Inter, PingFang SC, sans-serif', size: 15, color: focused ? '#19324f' : '#9aa9b6', multi: true, bold: { color: focused ? '#173a5c' : '#8d9ba8' } },
        borderWidth: focused ? 1.4 : 1, borderWidthSelected: 2, shadow: { enabled: focused, color: 'rgba(31,67,115,.12)', size: 10, x: 0, y: 4 },
      };
    });
    const nodeScope = new Set(graph.nodes.filter(inScope).map((node) => node.id));
    const visibleEdges = graph.edges.map((edge) => {
      const sourceIn = nodeScope.has(edge.from); const targetIn = nodeScope.has(edge.to); const internal = sourceIn && targetIn; const cross = sourceIn !== targetIn;
      return { ...edge, hidden: isolate && !internal, label: edge.kind === 'inheritance' ? '继承' : `${edge.label}  ${cardinalities[edge.cardinality]}`, arrows: { to: { enabled: true, scaleFactor: .7 } }, color: internal ? { color: '#7f9dbc', highlight: '#2169d7', hover: '#4b78aa' } : cross ? { color: '#d49a55', highlight: '#b8731b', hover: '#b8731b' } : { color: '#c7d0d9', highlight: '#9aa9b6', hover: '#9aa9b6' }, width: internal ? 1.4 : 1, dashes: edge.kind === 'inheritance' || cross, font: { size: 12, color: internal ? '#526b88' : '#a0adb8', background: '#f7fafd', strokeWidth: 0, align: 'middle' }, smooth: { type: 'dynamic', roundness: .3 } };
    });
    const nodes = new DataSet(visibleNodes); const edges = new DataSet(visibleEdges);
    const network = new Network(holder.current, { nodes, edges }, {
      autoResize: true, physics: { enabled: true, stabilization: { iterations: 180, fit: true }, barnesHut: { gravitationalConstant: -4200, springLength: 190, springConstant: .035, avoidOverlap: .45 } },
      interaction: { hover: true, tooltipDelay: 180, keyboard: { enabled: true, bindToWindow: false }, multiselect: false }, layout: { improvedLayout: true, randomSeed: 18 },
    });
    networkRef.current = network;
    network.on('selectNode', ({ nodes: ids }) => setSelected(objects.find((item) => item.id === ids[0]) || null));
    network.on('deselectNode', () => setSelected(null));
    network.once('stabilizationIterationsDone', () => { network.setOptions({ physics: { enabled: false } }); network.fit({ animation: { duration: 260 } }); });
    const observer = new ResizeObserver(() => { network.redraw(); }); observer.observe(holder.current);
    requestAnimationFrame(() => { network.redraw(); network.fit(); });
    return () => { observer.disconnect(); network.destroy(); networkRef.current = null; };
  }, [graph, objects, domainFilter, subjectFilter, isolate]);

  const search = () => {
    const normalized = query.trim().toLowerCase();
    const found = normalized && objects.find((item) => `${item.display_name} ${item.name} ${item.external_id || ''}`.toLowerCase().includes(normalized));
    if (found && networkRef.current) { networkRef.current.selectNodes([found.id]); networkRef.current.focus(found.id, { scale: 1.25, animation: { duration: 320 } }); setSelected(found); }
  };
  const relayout = () => { if (!networkRef.current) return; networkRef.current.setOptions({ physics: { enabled: true, stabilization: { iterations: 120 } } }); networkRef.current.stabilize(120); };

  if (error) return <ErrorState message={error} />;
  if (!graph) return <Loading />;
  return <div className="graph-layout">
    <section className="graph-panel">
      <div className="graph-toolbar"><div className="graph-context"><NetworkIcon size={17} /><span><b>{active?.name || '当前本体'}</b><small>模型图谱</small></span></div><div className="graph-filters"><select value={domainFilter} onChange={(e) => { setDomainFilter(e.target.value); setSubjectFilter(''); }}><option value="">全部业务域</option>{domainOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}><option value="">全部主题域</option>{subjectOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><label className="graph-isolate"><input type="checkbox" checked={isolate} onChange={(e) => setIsolate(e.target.checked)} /> 仅看当前范围</label></div><div className="search-box compact"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="定位对象类型" /></div><button className="btn secondary small" disabled={!query.trim()} onClick={search}>定位</button><button className="btn secondary small" onClick={() => networkRef.current?.fit({ animation: true })}><Focus size={15} /> 适配全图</button><button className="btn secondary small" onClick={relayout}><RefreshCw size={14} /> 重新布局</button><div className="graph-legend"><span><i className="legend-node" /> 对象 {scopeStats.nodes}/{graph.nodes.length}</span><span><i className="legend-edge" /> 内部关系 {scopeStats.internal}</span>{scopeStats.cross > 0 && <span><i className="legend-cross-edge" /> 跨域 {scopeStats.cross}</span>}</div></div>
      <div className="network-canvas-wrap"><div ref={holder} className="network-canvas" />{!graph.nodes.length && <div className="graph-empty"><NetworkIcon size={34} /><strong>暂无可展示的模型</strong><span>创建至少一个对象类型后，模型图谱会在这里生成。</span></div>}</div>
    </section>
    <aside className={`inspector ${selected ? 'has-selection' : ''}`}><div className="inspector-title"><NetworkIcon size={18} /><div><h3>模型检查器</h3><p>业务域/主题域用于筛选与高亮，关系方向仍以关系定义为准</p></div></div>{selected ? <div className="inspector-content"><div className="inspector-object"><div className="entity-icon large"><ObjectTypeIcon value={selected.icon} size={22} /></div><div><h2>{selected.display_name}</h2><code>{selected.name}</code></div></div><p>{selected.description || '暂无业务说明'}</p><dl><div><dt>对象类别</dt><dd>{selected.category || '未设置'}</dd></div><div><dt>归属业务域 / 主题域</dt><dd>{selected.business_domain_name || '未分类'} / {selected.subject_domain_name || '未分类'}</dd></div><div><dt>标题属性</dt><dd className="mono">{selected.title_property || '未设置'}</dd></div><div><dt>属性</dt><dd>{selected.effective_property_count || selected.properties?.length || 0}</dd></div><div><dt>关联关系</dt><dd>{links.filter((link) => link.source_object_type_id === selected.id || link.target_object_type_id === selected.id).length}</dd></div><div><dt>资源状态</dt><dd><em className={`oma-status ${selected.status}`}>{statusLabel(selected.status)}</em></dd></div><div><dt>模板建模状态</dt><dd>{designStatusLabel(selected.design_status)}</dd></div></dl><h4>对象属性</h4><div className="inspector-props">{(selected.effective_properties || selected.properties || []).map((prop) => <div key={prop.key}><span>{prop.name}</span><code>{prop.key} · {dataTypeLabel(prop.type)}</code></div>)}</div></div> : <div className="inspector-empty"><GitBranch size={30} /><p>选择一个对象，查看它的属性、分类和关系。</p></div>}</aside>
  </div>;
}
