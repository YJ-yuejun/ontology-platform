import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import 'vis-network/styles/vis-network.css';
import { ArrowLeft, Focus, Layers3, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, Search, TableProperties, ZoomIn, ZoomOut } from 'lucide-react';
import { buildAggregateLineage, buildMappingLineage } from '../mappingLineage';
import { EmptyState } from '../components/StateViews';

const mapWayLabel = {
  direct: '直接映射', enum_map: '枚举映射', expr: '公式计算', script: '脚本计算',
  constant: '常量映射', workflow: '自定义流程', link: '关联映射', unit: '单位/字段映射',
};

const nodeStyle = {
  source: { background: '#e8f0f7', border: '#7895ad', font: 13 },
  table: { background: '#f7fbfe', border: '#a9c3d8', font: 12.5 },
  column: { background: '#ffffff', border: '#c2d3e1', font: 12 },
  object: { background: '#e6f1fd', border: '#4a89c8', font: 13 },
  property: { background: '#eaf4ff', border: '#6d9fd3', font: 12.5 },
  relation: { background: '#f3ecfa', border: '#9a7cc1', font: 12.5 },
};

function mappingStatusLabel(mapping) {
  if (mapping.design_status) return mapping.design_status;
  return ({ draft: '设计中', experimental: '设计中', active: '已确认', deprecated: '已停用' })[mapping.status] || '待确认';
}

const hashParams = () => {
  const hash = window.location.hash || '';
  return new URLSearchParams(hash.includes('?') ? hash.split('?').slice(1).join('?') : '');
};

function aggregateTargetLabel(edge) {
  if (!edge?.target) return '—';
  if (edge.target.kind === 'relation') return edge.target.record?.display_name || edge.target.name || '关系';
  return edge.target.object?.display_name || edge.target.objectName || '对象';
}

export default function MappingLineageGraph({ sources, assets, mappings, objects, links }) {
  const holder = useRef(null);
  const network = useRef(null);
  const initialized = useRef(false);
  const initialParams = useRef(hashParams());
  const [view, setView] = useState(initialParams.current.get('view') === 'field' ? 'field' : 'object');
  const [sourceFilter, setSourceFilter] = useState(initialParams.current.get('source') === 'all' ? '' : initialParams.current.get('source') || '');
  const [tableFilter, setTableFilter] = useState(initialParams.current.get('table') || '');
  const [domainFilter, setDomainFilter] = useState(initialParams.current.get('domain') || '');
  const [objectFilter, setObjectFilter] = useState(initialParams.current.get('object') || '');
  const [query, setQuery] = useState(initialParams.current.get('q') || '');
  const [selectedId, setSelectedId] = useState('');
  const [zoomLevel, setZoomLevel] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);

  useEffect(() => {
    if (initialized.current || !sources.length) return;
    initialized.current = true;
    const params = initialParams.current;
    if (params.has('source') || params.has('domain') || params.has('object') || params.has('table') || params.has('q')) return;
    // 全部展开时画布会缩成一条细线；默认聚焦一个较有代表性的数据源，
    // 仍可在筛选器中切到“全部数据源”查看完整图谱。
    if (mappings.length <= 30) return;
    const summaries = new Map();
    mappings.forEach((mapping) => {
      let code = mapping.source_code;
      let table = mapping.source_table;
      if (mapping.binding_mode === 'governed') {
        const asset = assets.find((item) => item.code === mapping.governance_asset_code);
        code = asset?.upstream_source_code || code;
        table = asset?.upstream_object || table;
      }
      if (!code) return;
      const summary = summaries.get(code) || { code, count: 0, relations: 0, tables: new Set() };
      summary.count += 1;
      if (mapping.mapping_type === 'relation') summary.relations += 1;
      if (table) summary.tables.add(table);
      summaries.set(code, summary);
    });
    const candidates = [...summaries.values()];
    const byDetail = (left, right) => right.tables.size - left.tables.size || right.count - left.count;
    const readable = candidates.filter((item) => item.count >= 6 && item.count <= 12);
    const withRelation = readable.filter((item) => item.relations > 0).sort(byDetail);
    const best = withRelation[0] || readable.sort(byDetail)[0]
      || candidates.sort((left, right) => right.count - left.count)[0];
    if (best) setSourceFilter(best.code);
  }, [sources, mappings, assets]);

  const domainOptions = useMemo(() => {
    const byCode = new Map();
    objects.forEach((item) => {
      if (item.business_domain_code) byCode.set(item.business_domain_code, item.business_domain_name || item.business_domain_code);
    });
    return [...byCode.entries()].sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'));
  }, [objects]);

  const mappedObjects = useMemo(() => {
    const names = new Set(mappings.filter((item) => item.mapping_type === 'property' && item.target_object_type).map((item) => item.target_object_type));
    return objects.filter((item) => names.has(item.name)).sort((left, right) => left.display_name.localeCompare(right.display_name, 'zh-CN'));
  }, [mappings, objects]);

  const tableOptions = useMemo(() => {
    const map = new Map();
    mappings.forEach((mapping) => {
      let code = mapping.source_code;
      let table = mapping.source_table;
      if (mapping.binding_mode === 'governed') {
        const asset = assets.find((item) => item.code === mapping.governance_asset_code);
        code = asset?.upstream_source_code || code;
        table = asset?.upstream_object || table;
      }
      if (!code || !table || (sourceFilter && code !== sourceFilter)) return;
      map.set(`${code}:${table}`, { code, table, sourceName: sources.find((item) => item.code === code)?.name || code });
    });
    return [...map.values()].sort((left, right) => left.sourceName.localeCompare(right.sourceName, 'zh-CN')
      || left.table.localeCompare(right.table, 'zh-CN'));
  }, [mappings, assets, sources, sourceFilter]);

  const filter = useMemo(() => ({ source: sourceFilter, table: view === 'field' ? tableFilter : '', domain: domainFilter, object: objectFilter, text: query.trim() }),
    [sourceFilter, tableFilter, domainFilter, objectFilter, query, view]);

  const graph = useMemo(() => (view === 'field' ? buildMappingLineage : buildAggregateLineage)({
    sources, assets, mappings, objects, links, filter,
  }), [view, sources, assets, mappings, objects, links, filter]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    const node = graph.nodes.find((item) => item.id === selectedId);
    if (node) return node;
    const edge = graph.edges.find((item) => item.id === selectedId);
    return edge && (edge.record || edge.entries) ? edge : null;
  }, [graph, selectedId]);

  useEffect(() => {
    if (!holder.current || !graph.nodes.length) return undefined;
    const nodeRows = graph.nodes.map((node) => {
      const style = nodeStyle[node.kind] || nodeStyle.column;
      const level = node.kind === 'source' ? 0 : ['table', 'column'].includes(node.kind) ? 1 : 2;
      const isSource = node.kind === 'source';
      const isTable = node.kind === 'table';
      const isColumn = node.kind === 'column';
      const isObject = node.kind === 'object';
      const title = isSource ? `${node.record?.name || ''} · ${node.record?.code || ''}`
        : isTable ? `${node.record?.source?.name || ''} / ${node.record?.name || ''} · ${node.count} 条字段映射`
          : isColumn ? `${node.record?.source?.name || ''} / ${node.record?.table || ''} / ${node.record?.name || ''}`
            : isObject ? `${node.objectDisplay || ''} · ${node.count} 条映射 · ${node.tableCount || 0} 张表`
              : node.kind === 'property' ? `${node.objectDisplay || ''} · ${node.record?.name || ''} (${node.key || ''})`
                : `${node.record?.display_name || node.record?.name || ''} · ${node.count} 条映射`;
      return {
        id: node.id, label: node.label, level,
        shape: 'box', margin: isSource ? 12 : isTable ? 10 : isObject ? 12 : 9,
        widthConstraint: {
          minimum: isSource ? 160 : isTable ? 155 : isColumn ? 150 : isObject ? 175 : 170,
          maximum: isSource ? 230 : isTable ? 235 : isColumn ? 280 : 245,
        },
        color: { background: style.background, border: style.border,
          highlight: { background: '#fff2d6', border: '#d59b34' }, hover: { background: '#f4f9ff', border: '#7ba9d5' } },
        font: { face: 'Inter, PingFang SC, sans-serif', size: style.font, color: '#203b53', multi: false },
        borderWidth: node.kind === 'object' ? 1.8 : 1.2, shapeProperties: { borderRadius: 5 }, title,
      };
    });
    const mappingEdges = graph.edges.map((edge) => {
      const aggregate = edge.kind === 'aggregate' || edge.kind === 'aggregateRelation';
      const relation = edge.kind === 'relation' || edge.kind === 'aggregateRelation';
      return {
        id: edge.id, from: edge.from, to: edge.to, kind: edge.kind,
        arrows: { to: { enabled: true, scaleFactor: .55 } },
        color: { color: relation ? '#9878bb' : '#4f9774', highlight: '#d19635', hover: '#2f7f5b' },
        width: aggregate ? Math.min(3.2, 1.2 + Math.log2((edge.fieldCount || 1) + 1) * .35) : 1.4,
        selectionWidth: 2.4,
        smooth: { type: 'cubicBezier', forceDirection: 'horizontal', roundness: .18 },
        title: edge.title || '', label: aggregate ? edge.label || '' : '',
        font: aggregate ? { size: 10.5, color: relation ? '#7b5a9e' : '#327a59', background: '#ffffff', strokeWidth: 0 } : undefined,
      };
    });
    const containEdges = graph.nodes
      .filter((node) => node.kind === 'table' || node.kind === 'column')
      .flatMap((node) => {
        const code = node.record?.source?.code;
        if (!code || !graph.nodes.some((item) => item.id === `physical:source:${code}`)) return [];
        return [{
          id: `contains:${node.id}`, from: `physical:source:${code}`, to: node.id, kind: 'contains',
          arrows: { to: { enabled: false } }, color: { color: '#cddbe6', highlight: '#cddbe6', hover: '#b8ccda' },
          width: .8, dashes: false, chosen: false, selectionWidth: 0,
          smooth: { type: 'cubicBezier', forceDirection: 'horizontal', roundness: .12 },
        }];
      });
    const nodes = new DataSet(nodeRows);
    const edges = new DataSet([...containEdges, ...mappingEdges]);
    const instance = new Network(holder.current, { nodes, edges }, {
      autoResize: true, physics: false,
      layout: { hierarchical: { enabled: true, direction: 'LR', sortMethod: 'directed',
        levelSeparation: view === 'object' ? 300 : 290, nodeSpacing: view === 'object' ? 84 : 72,
        blockShifting: true, edgeMinimization: true, parentCentralization: true } },
      interaction: { hover: true, dragNodes: false, zoomView: true, keyboard: { enabled: true, bindToWindow: false } },
    });
    network.current = instance;
    instance.on('selectNode', ({ nodes: ids }) => setSelectedId(ids[0] || ''));
    // 点击靠近节点的连线时，vis 可能同时选中节点和连线。节点优先，
    // 否则用户点对象时会被连线详情覆盖。
    instance.on('selectEdge', ({ edges: ids }) => {
      if (instance.getSelectedNodes().length) return;
      setSelectedId(ids[0] || '');
    });
    instance.on('deselectNode', () => setSelectedId(''));
    instance.on('deselectEdge', () => setSelectedId(''));
    instance.on('zoom', () => setZoomLevel(Math.round(instance.getScale() * 100)));
    instance.on('doubleClick', ({ nodes: ids, edges: edgeIds }) => {
      if (view !== 'object') return;
      if (ids.length) {
        const node = graph.nodes.find((item) => item.id === ids[0]);
        if (node?.kind === 'object') expandObject(node.objectName);
        else if (node?.kind === 'table') expandTable(node.record.source.code, node.record.name);
        else if (node?.kind === 'relation') expandRelation(node.target?.name || node.record?.name);
      } else if (edgeIds.length) {
        const edge = graph.edges.find((item) => item.id === edgeIds[0]);
        if (edge?.entries) expandEdge(edge);
      }
    });
    requestAnimationFrame(() => {
      instance.fit({ animation: false });
      instance.moveTo({ scale: Math.max(.2, instance.getScale() * 0.9) });
      setZoomLevel(Math.round(instance.getScale() * 100));
    });
    return () => { instance.destroy(); network.current = null; };
  }, [graph, view]);

  useEffect(() => {
    if (selectedId && !selected) setSelectedId('');
  }, [graph, selectedId, selected]);

  const fit = () => {
    network.current?.fit({ animation: { duration: 350, easingFunction: 'easeInOutQuad' } });
    setTimeout(() => { const instance = network.current; if (instance) setZoomLevel(Math.round(instance.getScale() * 100)); }, 420);
  };
  const zoom = (factor) => {
    const instance = network.current;
    if (!instance) return;
    const scale = Math.min(2.8, Math.max(0.15, instance.getScale() * factor));
    instance.moveTo({ scale, animation: { duration: 180 } });
    setZoomLevel(Math.round(scale * 100));
  };
  const toggleFullscreen = () => {
    if (!fullscreen) {
      setFullscreen(true);
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      setFullscreen(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
    setTimeout(fit, 260);
  };
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => { document.removeEventListener('fullscreenchange', onChange); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
  }, []);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (fullscreen) { toggleFullscreen(); return; }
      if (view === 'field') { collapseToObjects(); return; }
      if (selectedId) setSelectedId('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  const resetFilters = () => { setSourceFilter(''); setTableFilter(''); setDomainFilter(''); setObjectFilter(''); setQuery(''); setSelectedId(''); };

  const expandObject = (objectName) => {
    setView('field'); setSourceFilter(''); setTableFilter(''); setObjectFilter(objectName); setSelectedId('');
  };
  const expandRelation = (relationName) => {
    setView('field'); setSourceFilter(''); setTableFilter(''); setObjectFilter(relationName); setSelectedId('');
  };
  const expandTable = (sourceCode, table) => {
    setView('field'); setSourceFilter(sourceCode); setTableFilter(table); setObjectFilter(''); setSelectedId('');
  };
  const expandEdge = (edge) => {
    setView('field');
    setSourceFilter(edge.sourceCode);
    setTableFilter(edge.table);
    setObjectFilter(edge.target?.kind === 'property' ? edge.target.objectName : edge.target?.name || '');
    setSelectedId('');
  };
  const collapseToObjects = () => { setView('object'); setTableFilter(''); setSelectedId(''); };
  const switchToField = () => {
    if (selected?.kind === 'object' && !selected.from) { expandObject(selected.objectName); return; }
    if (selected?.kind === 'table' && !selected.from) { expandTable(selected.record.source.code, selected.record.name); return; }
    if (selected?.kind === 'relation' && !selected.from) { expandRelation(selected.target?.name || selected.record?.name); return; }
    if (selected?.from && selected.entries) { expandEdge(selected); return; }
    setView('field');
  };

  const showReset = Boolean(tableFilter || domainFilter || objectFilter || query.trim());
  const outgoing = selected?.kind === 'column' ? graph.edges.filter((edge) => edge.from === selected.id) : [];
  const incoming = (selected?.kind === 'property' || selected?.kind === 'relation') && view === 'field'
    ? graph.edges.filter((edge) => edge.to === selected.id) : [];
  const tableLinks = selected?.kind === 'table' ? graph.edges.filter((edge) => edge.from === selected.id) : [];
  const objectLinks = selected?.kind === 'object' ? graph.edges.filter((edge) => edge.to === selected.id) : [];
  const relationLinks = selected?.kind === 'relation' && view === 'object' ? graph.edges.filter((edge) => edge.to === selected.id) : [];
  const aggregateEntries = selected?.entries || [];
  const mappingTotal = view === 'field' ? graph.entries.length : graph.mappingCount;
  const semanticTotal = graph.nodes.filter((node) => node.layer === 'semantic').length;
  const crumbFocus = objectFilter
    ? (mappedObjects.find((item) => item.name === objectFilter)?.display_name
      || links.find((item) => item.name === objectFilter)?.display_name || objectFilter)
    : tableFilter || '';

  return <div className={`mapping-graph-shell ${fullscreen ? 'is-fullscreen' : ''}`}>
    <div className="mapping-controls mapping-graph-controls mapping-direct-controls">
      <label className="mapping-graph-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === 'field' ? '搜索字段/属性/映射' : '搜索表/对象/映射'} /></label>
      <select aria-label="按物理数据源筛选" value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value); setTableFilter(''); setSelectedId(''); }}>
        <option value="">全部数据源</option>
        {sources.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}
      </select>
      {view === 'field' && <select aria-label="按物理表筛选" value={tableFilter} onChange={(event) => { setTableFilter(event.target.value); setSelectedId(''); }}>
        <option value="">全部物理表</option>
        {tableOptions.map((item) => <option key={`${item.code}:${item.table}`} value={item.table}>{item.table}</option>)}
      </select>}
      <select aria-label="按业务域筛选" value={domainFilter} onChange={(event) => { setDomainFilter(event.target.value); setSelectedId(''); }}>
        <option value="">全部业务域</option>
        {domainOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
      <select aria-label="按本体对象筛选" value={objectFilter} onChange={(event) => { setObjectFilter(event.target.value); setSelectedId(''); }}>
        <option value="">全部本体对象</option>
        {mappedObjects.map((item) => <option key={item.id} value={item.name}>{item.display_name}</option>)}
        {links.filter((item) => mappings.some((mapping) => mapping.target_relation === item.name)).map((item) => <option key={item.id} value={item.name}>关系 · {item.display_name}</option>)}
      </select>
      <span className="mapping-graph-count">{view === 'field' ? `${mappingTotal} 条字段映射 · ${semanticTotal} 个语义目标` : `${graph.edges.length} 条表→对象连接 · ${mappingTotal} 条字段映射`}</span>
      {showReset && <button type="button" onClick={resetFilters} title="清除筛选并查看全部物理来源">查看全部映射</button>}
    </div>
    <div className={`mapping-graph-layout mapping-direct-graph ${detailOpen ? '' : 'detail-collapsed'}`}>
      <div className="mapping-graph-main">
        <div className={`mapping-graph-layers mapping-direct-layers ${view === 'object' ? 'object-level' : 'field-level'}`}>
          <span><i>1</i>物理来源（系统）</span><span><i>2</i>{view === 'object' ? '物理表' : '物理表字段'}</span><span><i>3</i>{view === 'object' ? '本体对象类型' : '本体语义（对象属性）'}</span>
        </div>
        {graph.nodes.length ? <div className="mapping-graph-stage">
          <div ref={holder} className="mapping-graph-canvas" role="img" aria-label={view === 'object' ? '物理表到本体对象类型的映射图谱' : '物理表字段到本体对象属性的直连映射图谱'} />
          <div className="mapping-graph-crumb">
            <button type="button" className={view === 'object' ? 'active' : ''} onClick={collapseToObjects}><Layers3 size={13} /> 对象视图</button>
            <span>›</span>
            <button type="button" className={view === 'field' ? 'active' : ''} onClick={switchToField}><TableProperties size={13} /> 字段视图</button>
            {crumbFocus && <em title={tableFilter ? `${sources.find((item) => item.code === sourceFilter)?.name || sourceFilter || '全部来源'} / ${tableFilter}` : crumbFocus}>{crumbFocus}</em>}
            {view === 'field' && <button type="button" className="mapping-crumb-back" onClick={collapseToObjects}><ArrowLeft size={13} /> 返回上一步</button>}
          </div>
          <div className="mapping-floating-controls" role="toolbar" aria-label="映射图谱视图控制">
            <button type="button" onClick={() => zoom(0.8)} title="缩小" aria-label="缩小"><ZoomOut size={15} /></button>
            <span className="mapping-zoom-level">{zoomLevel}%</span>
            <button type="button" onClick={() => zoom(1.25)} title="放大" aria-label="放大"><ZoomIn size={15} /></button>
            <span className="mapping-float-sep" />
            <button type="button" onClick={fit} title="适配全图" aria-label="适配全图"><Focus size={15} /></button>
            <button type="button" onClick={toggleFullscreen} title={fullscreen ? '退出全屏（Esc）' : '全屏查看'} aria-label={fullscreen ? '退出全屏' : '全屏查看'}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
            {!detailOpen && <button type="button" className="mapping-reopen-detail" onClick={() => setDetailOpen(true)} title="展开详情" aria-label="展开详情"><PanelRightOpen size={15} /></button>}
          </div>
          <div className="mapping-graph-hint">滚轮缩放 · 拖动平移 · 单击查看 · 双击展开字段 · Esc 返回</div>
        </div>
          : <EmptyState title={view === 'object' ? '当前范围没有表→对象映射' : '当前范围没有字段映射'} description="调整数据源、物理表或业务域筛选，或先在“字段映射”中建立物理字段到对象属性的连线。" />}
      </div>
      {detailOpen && <aside className="mapping-graph-detail">
        <header className="mapping-graph-detail-head"><strong>{view === 'object' ? '对象 / 表连接详情' : '字段与映射详情'}</strong><button type="button" onClick={() => setDetailOpen(false)} title="收起详情" aria-label="收起详情"><PanelRightClose size={15} /></button></header>
        {!selected && <p>{view === 'object'
          ? '默认只展示物理表到对象类型的连接，连线上的数字表示该表映射到该对象的字段数。点击对象、表或连线查看字段明细，再点“展开字段”进入字段视图。'
          : '当前为字段视图，连线直接表示表字段到对象属性。可点击上方“对象视图”收起，或继续筛选其他对象、表和数据源。'}</p>}
        {selected?.kind === 'source' && !selected.from && <>
          <h3>{selected.record?.name}</h3>
          <dl>
            <div><dt>数据源编码</dt><dd><code>{selected.record?.code || '—'}</code></dd></div>
            <div><dt>系统类型</dt><dd>{selected.record?.system_type || '—'}</dd></div>
            <div><dt>物理对象</dt><dd>{selected.record?.physical_object || '—'}</dd></div>
            <div><dt>来源表</dt><dd>{graph.edges.filter((edge) => edge.sourceCode === selected.record?.code).reduce((set, edge) => set.add(edge.table), new Set()).size || 0} 张</dd></div>
            <div><dt>字段映射</dt><dd>{graph.edges.filter((edge) => edge.sourceCode === selected.record?.code && edge.entries).reduce((total, edge) => total + edge.entries.length, 0) || mappings.filter((mapping) => mapping.source_code === selected.record?.code).length} 条</dd></div>
          </dl>
        </>}
        {selected?.kind === 'table' && !selected.from && <>
          <h3><code>{selected.record?.name}</code></h3>
          <dl>
            <div><dt>来源系统</dt><dd>{selected.record?.source?.name || '—'}</dd></div>
            <div><dt>物理表</dt><dd><code>{selected.record?.name}</code></dd></div>
            <div><dt>字段映射</dt><dd>{selected.count} 条</dd></div>
            <div><dt>关联对象</dt><dd>{tableLinks.length} 个</dd></div>
          </dl>
          <h4>该表关联的本体对象</h4>
          <div className="mapping-graph-target-list">
            {tableLinks.map((edge) => <div key={edge.id}>
              <span><b>{aggregateTargetLabel(edge)}</b><small>{edge.fieldCount} 个字段 · {edge.mappingCount} 条映射</small></span>
              <button type="button" onClick={() => expandEdge(edge)}>展开</button>
            </div>)}
            {!tableLinks.length && <p>该表尚未建立字段映射。</p>}
          </div>
          <button type="button" className="mapping-expand-button" onClick={() => expandTable(selected.record.source.code, selected.record.name)}><TableProperties size={14} /> 展开该表的字段映射</button>
        </>}
        {selected?.kind === 'object' && !selected.from && <>
          <h3>{selected.objectDisplay}</h3>
          <dl>
            <div><dt>对象类型</dt><dd><code>{selected.objectName}</code></dd></div>
            <div><dt>归属业务域</dt><dd>{selected.domain || selected.record?.business_domain_name || '未分类'}</dd></div>
            <div><dt>字段映射</dt><dd>{selected.count} 条</dd></div>
            <div><dt>关联物理表</dt><dd>{objectLinks.length} 张</dd></div>
          </dl>
          <h4>该对象涉及的物理表</h4>
          <div className="mapping-graph-source-list">
            {objectLinks.map((edge) => <div key={edge.id}>
              <span><b>{edge.sourceCode} / {edge.table}</b><small>{edge.fieldCount} 个字段 · {edge.mappingCount} 条映射</small></span>
              <button type="button" onClick={() => expandEdge(edge)}>展开</button>
            </div>)}
            {!objectLinks.length && <p>该对象尚未建立字段映射。</p>}
          </div>
          <button type="button" className="mapping-expand-button" onClick={() => expandObject(selected.objectName)}><TableProperties size={14} /> 展开该对象的字段映射</button>
        </>}
        {selected?.kind === 'relation' && !selected.from && view === 'object' && <>
          <h3>{selected.record?.display_name || selected.record?.name}</h3>
          <dl>
            <div><dt>关系标识</dt><dd><code>{selected.record?.name}</code></dd></div>
            <div><dt>起点对象</dt><dd>{selected.record?.source_display_name || '—'}</dd></div>
            <div><dt>终点对象</dt><dd>{selected.record?.target_display_name || '—'}</dd></div>
            <div><dt>关系映射</dt><dd>{selected.count} 条</dd></div>
          </dl>
          <h4>关系来源表</h4>
          <div className="mapping-graph-source-list">
            {relationLinks.map((edge) => <div key={edge.id}>
              <span><b>{edge.sourceCode} / {edge.table}</b><small>{edge.fieldCount} 个字段 · {edge.mappingCount} 条映射</small></span>
              <button type="button" onClick={() => expandEdge(edge)}>展开</button>
            </div>)}
            {!relationLinks.length && <p>尚未登记关系来源字段。</p>}
          </div>
          <button type="button" className="mapping-expand-button" onClick={() => expandRelation(selected.target?.name || selected.record?.name)}><TableProperties size={14} /> 展开关系字段映射</button>
        </>}
        {selected?.kind === 'column' && !selected.from && view === 'field' && <>
          <h3><code>{selected.record?.table}.{selected.record?.name}</code></h3>
          <dl>
            <div><dt>物理来源</dt><dd>{selected.record?.source?.name} · {selected.record?.source?.code}</dd></div>
            <div><dt>物理表</dt><dd><code>{selected.record?.table}</code></dd></div>
            <div><dt>字段</dt><dd><code>{selected.record?.name}</code></dd></div>
            <div><dt>映射目标</dt><dd>{outgoing.length} 个</dd></div>
          </dl>
          <h4>该字段映射到的对象属性</h4>
          <div className="mapping-graph-target-list">
            {outgoing.map((edge) => <div key={edge.id}>
              <span><b>{edge.target.kind === 'property' ? `${edge.target.objectName}.${edge.target.name}` : edge.target.name}</b><small>{edge.record?.code} · {mapWayLabel[edge.record?.map_way] || edge.record?.map_way || '—'}</small></span>
              <em>{mappingStatusLabel(edge.record || {})}</em>
            </div>)}
            {!outgoing.length && <p>该字段尚未建立对象属性映射。</p>}
          </div>
        </>}
        {selected?.kind === 'property' && !selected.from && view === 'field' && <>
          <h3>{selected.objectDisplay} · {selected.record?.name}</h3>
          <dl>
            <div><dt>对象类型</dt><dd>{selected.objectDisplay} <code>{selected.objectName}</code></dd></div>
            <div><dt>属性标识</dt><dd><code>{selected.key}</code></dd></div>
            <div><dt>数据类型</dt><dd>{selected.record?.type || '—'}</dd></div>
            <div><dt>归属业务域</dt><dd>{selected.domain || '未分类'}</dd></div>
            <div><dt>来源字段</dt><dd>{incoming.length} 个</dd></div>
          </dl>
          <h4>映射到该属性的物理字段</h4>
          <div className="mapping-graph-source-list">
            {incoming.map((edge) => <div key={edge.id}>
              <span><b>{edge.table}.{edge.field}</b><small>{edge.record?.code} · {mappingStatusLabel(edge.record || {})}</small></span>
            </div>)}
            {!incoming.length && <p>尚未登记来源字段。</p>}
          </div>
        </>}
        {selected?.kind === 'relation' && !selected.from && view === 'field' && <>
          <h3>{selected.record?.display_name || selected.record?.name}</h3>
          <dl>
            <div><dt>关系标识</dt><dd><code>{selected.record?.name}</code></dd></div>
            <div><dt>起点对象</dt><dd>{selected.record?.source_display_name || '—'}</dd></div>
            <div><dt>终点对象</dt><dd>{selected.record?.target_display_name || '—'}</dd></div>
            <div><dt>来源字段</dt><dd>{incoming.length} 个</dd></div>
          </dl>
          <h4>关系映射来源</h4>
          <div className="mapping-graph-source-list">
            {incoming.map((edge) => <div key={edge.id}>
              <span><b>{edge.table}.{edge.field}</b><small>{edge.record?.code} · {mappingStatusLabel(edge.record || {})}</small></span>
            </div>)}
            {!incoming.length && <p>尚未登记关系来源字段。</p>}
          </div>
        </>}
        {selected?.from && view === 'object' && selected.entries && <>
          <h3>{selected.sourceCode} / {selected.table}</h3>
          <p className="mapping-detail-relation">→ {aggregateTargetLabel(selected)}</p>
          <dl>
            <div><dt>映射到该对象</dt><dd>{selected.fieldCount} 个字段 · {selected.mappingCount} 条映射</dd></div>
            <div><dt>目标类型</dt><dd>{selected.target?.kind === 'relation' ? '本体关系' : '本体对象属性'}</dd></div>
          </dl>
          <h4>字段映射明细</h4>
          <div className="mapping-graph-aggregate-list">
            {aggregateEntries.flatMap((entry) => entry.fields.map((field, index) => <div key={`${entry.mapping.id}:${index}`}>
              <span><code>{entry.table}.{field}</code><small>{entry.target.kind === 'property' ? `${entry.target.objectName}.${entry.target.name}` : entry.target.name}</small></span>
              <em>{mappingStatusLabel(entry.mapping)}</em>
            </div>))}
          </div>
          <button type="button" className="mapping-expand-button" onClick={() => expandEdge(selected)}><TableProperties size={14} /> 只看这条字段链路</button>
        </>}
        {selected?.from && view === 'field' && <>
          <h3>{selected.record?.name || selected.record?.code || '字段映射'}</h3>
          <dl>
            <div><dt>映射编号</dt><dd><code>{selected.record?.code || '—'}</code></dd></div>
            <div><dt>来源字段</dt><dd><code>{selected.table}.{selected.field}</code></dd></div>
            <div><dt>本体目标</dt><dd>{selected.target?.kind === 'property' ? `${selected.target.objectName}.${selected.target.name}` : selected.target?.name}</dd></div>
            <div><dt>映射方式</dt><dd>{mapWayLabel[selected.record?.map_way] || selected.record?.map_way || '—'}</dd></div>
            <div><dt>转换规则</dt><dd>{selected.record?.transform_rule || '—'}</dd></div>
            <div><dt>质量校验</dt><dd>{selected.record?.quality_rule || '—'}</dd></div>
            <div><dt>状态</dt><dd>{mappingStatusLabel(selected.record || {})}</dd></div>
          </dl>
        </>}
      </aside>}
    </div>
  </div>;
}
