import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import 'vis-network/styles/vis-network.css';
import { buildMappingLineage } from '../mappingLineage';
import { EmptyState } from '../components/StateViews';

const colors = {
  physical: { background: '#edf2f7', border: '#98aabd' },
  governance: { background: '#eaf7f1', border: '#69aa8c' },
  semantic: { background: '#eaf2ff', border: '#6b9ed8' },
};

export default function MappingLineageGraph({ sources, assets, mappings, objects, links }) {
  const holder = useRef(null);
  const network = useRef(null);
  const [focus, setFocus] = useState('');
  const [selected, setSelected] = useState(null);
  const graph = useMemo(() => buildMappingLineage({ sources, assets, mappings, objects, links, focus }), [sources, assets, mappings, objects, links, focus]);
  useEffect(() => {
    if (!holder.current || !graph.nodes.length) return undefined;
    const nodes = new DataSet(graph.nodes.map((node) => ({ id: node.id, label: node.label, level: { physical: 0, governance: 1, semantic: 2 }[node.layer],
      shape: 'box', margin: 14, widthConstraint: { minimum: 130, maximum: 220 }, color: colors[node.layer],
      font: { face: 'Inter, PingFang SC, sans-serif', size: 14, color: '#223b54' }, borderWidth: 1.3 })));
    const edges = new DataSet(graph.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, label: edge.label,
      arrows: { to: { enabled: true, scaleFactor: .65 } }, dashes: edge.kind === 'legacy',
      color: edge.kind === 'legacy' ? '#d58a62' : edge.kind === 'upstream' ? '#9daec0' : '#5a9e7e',
      font: { size: 11, color: '#526a7e', background: '#fff' }, smooth: { type: 'cubicBezier', forceDirection: 'horizontal', roundness: .25 } })));
    const instance = new Network(holder.current, { nodes, edges }, { autoResize: true, physics: false,
      layout: { hierarchical: { enabled: true, direction: 'LR', sortMethod: 'directed', levelSeparation: 220, nodeSpacing: 115 } },
      interaction: { hover: true, keyboard: { enabled: true, bindToWindow: false }, dragNodes: false } });
    network.current = instance;
    instance.on('selectNode', ({ nodes: ids }) => setSelected(graph.nodes.find((node) => node.id === ids[0]) || null));
    instance.on('selectEdge', ({ edges: ids }) => setSelected(graph.edges.find((edge) => edge.id === ids[0]) || null));
    instance.on('deselectNode', () => setSelected(null));
    requestAnimationFrame(() => instance.fit());
    return () => { instance.destroy(); network.current = null; };
  }, [graph]);
  return <><div className="mapping-controls mapping-graph-controls"><label>查看范围<select value={focus} onChange={(event) => { setFocus(event.target.value); setSelected(null); }}><option value="">全部有映射的资源</option><optgroup label="治理资产">{assets.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</optgroup><optgroup label="本体对象">{objects.map((item) => <option key={item.id} value={item.name}>{item.display_name}</option>)}</optgroup><optgroup label="本体关系">{links.map((item) => <option key={item.id} value={item.name}>{item.display_name}</option>)}</optgroup><optgroup label="物理来源">{sources.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</optgroup></select></label><span>实线：已登记的治理血缘与语义映射；橙色虚线：旧版物理直连映射，待适配。</span></div>
    <div className="mapping-graph-layout"><div className="mapping-graph-main"><div className="mapping-graph-layers"><span>物理来源（表／接口）</span><span>数据治理层</span><span>本体语义层</span></div>{graph.nodes.length ? <div ref={holder} className="mapping-graph-canvas" role="img" aria-label="物理来源到数据治理资产再到本体语义的映射图谱" /> : <EmptyState title="当前范围没有映射" description="先登记治理资产，再创建语义映射；旧物理直连映射会以虚线显示。" />}</div><aside className="mapping-graph-detail"><strong>节点与映射详情</strong>{!selected ? <p>点击图中节点或连线查看已有元数据。图谱仅由已登记来源、治理资产和映射推导，不新增独立关系。</p> : selected.layer ? <><h3>{selected.label}</h3><dl><div><dt>层级</dt><dd>{({ physical: '物理来源', governance: '数据治理层', semantic: '本体语义层' })[selected.layer]}</dd></div><div><dt>标识</dt><dd>{selected.record?.code || selected.record?.name || '—'}</dd></div></dl></> : <><h3>{selected.record?.name || selected.record?.code || '上游血缘'}</h3><dl><div><dt>连线</dt><dd>{({ governed: '治理资产 → 本体语义', upstream: '物理来源 → 治理资产', legacy: '物理直连（待适配）' })[selected.kind]}</dd></div><div><dt>依据</dt><dd>{selected.label || '已登记资产血缘'}</dd></div></dl></>}</aside></div>
  </>;
}
