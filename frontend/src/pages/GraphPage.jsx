import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import 'vis-network/styles/vis-network.css';
import {
  ArrowRight, Boxes, Check, Copy, Crosshair, Focus, GitBranch, Image as ImageIcon, KeyRound, Link2, Maximize2, Minimize2,
  Network as NetworkIcon, PanelRightClose, PanelRightOpen, Pencil, Plus, RefreshCw, Search, Star, Trash2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ObjectTypeIcon } from '../components/ObjectTypeIcon';
import ObjectTypeEditor, { objectUpdatePayload } from '../components/ObjectTypeEditor';
import LinkTypeEditor, { formFromLink, LINK_CARDINALITIES } from '../components/LinkTypeEditor';
import ObjectCopyDialog from '../components/ObjectCopyDialog';
import { PropertyQuickEditor, PropertyRemoveDialog } from '../components/PropertyQuickEditor';
import { SubjectDomainQuickEditor, SubjectDomainRemoveDialog } from '../components/SubjectDomainQuickEditor';
import { copyLinkIdentity } from '../objectCopy';
import Modal from '../components/Modal';
import { dataTypeLabel, statusLabel } from '../labels';
import { ErrorState, Loading } from '../components/StateViews';
import { domainKey, edgeVisual, graphScope, NEUTRAL_COLOR, nodeVisual, subjectColorMap, subjectKey, UNCLASSIFIED } from '../ontologyGraph';

const layoutKey = (activeId) => `ontology-graph-layout:${activeId}`;
const readLayout = (activeId) => { try { return JSON.parse(localStorage.getItem(layoutKey(activeId)) || '{}'); } catch { return {}; } };
const writeLayout = (activeId, positions) => { try { localStorage.setItem(layoutKey(activeId), JSON.stringify(positions)); } catch { /* 浏览器禁用存储时只是不记住布局 */ } };
const PHYSICS = { enabled: true, stabilization: { iterations: 220, fit: true }, barnesHut: { gravitationalConstant: -4200, springLength: 190, springConstant: 0.035, avoidOverlap: 0.45 } };
const isTyping = (target) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;

export default function GraphPage({ activeId, active, refreshOntologies, notify }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const holder = useRef(null);
  const wrapRef = useRef(null);
  const networkRef = useRef(null);
  const nodesRef = useRef(null);
  const edgesRef = useRef(null);
  const pendingPosition = useRef(null);
  const handlers = useRef({});
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [networkReady, setNetworkReady] = useState(false);
  const [domainIds, setDomainIds] = useState(() => new Set());
  const [subjectFocus, setSubjectFocus] = useState('');
  const [coreOnly, setCoreOnly] = useState(false);
  const [showCross, setShowCross] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [neighborsOf, setNeighborsOf] = useState('');
  const [selection, setSelection] = useState(null); // { kind: 'node' | 'edge', id }
  const [editor, setEditor] = useState(null); // { kind: 'object' | 'link' | 'copy' | 'property' | 'subject', ... }
  const [removing, setRemoving] = useState(null); // { kind: 'object' | 'link' | 'property' | 'subject', item, ... }
  const [menu, setMenu] = useState(null); // { x, y, kind, id }
  const [connecting, setConnecting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState('');
  const [graphIcons, setGraphIcons] = useState([]);
  const graphIconSignature = useRef('');

  const load = async () => {
    const [objects, links, subjects, domains] = await Promise.all([
      api(`/api/ontologies/${activeId}/object-types`), api(`/api/ontologies/${activeId}/link-types`),
      api(`/api/ontologies/${activeId}/subject-domains`), api(`/api/ontologies/${activeId}/business-domains`),
    ]);
    setData({ ontologyId: activeId, objects, links, subjects, domains });
    return { objects, links };
  };
  useEffect(() => {
    const requestedDomain = searchParams.get('domain') || '';
    setData(null); setError(''); setSelection(null); setEditor(null); setRemoving(null); setMenu(null); setConnecting(false); setNeighborsOf('');
    setDomainIds(new Set(requestedDomain ? [requestedDomain] : [])); setSubjectFocus(searchParams.get('subject') || ''); setFocusTarget(searchParams.get('focus') || '');
    load().catch((e) => setError(e.message));
  }, [activeId]);

  const objects = data?.objects || [];
  const links = data?.links || [];
  const objectById = useMemo(() => new Map(objects.map((item) => [item.id, item])), [objects]);
  const linkById = useMemo(() => new Map(links.map((item) => [item.id, item])), [links]);
  const colors = useMemo(() => subjectColorMap(data?.subjects || []), [data]);
  const colorOf = (object) => colors.get(object.subject_domain_id) || NEUTRAL_COLOR;
  const scope = useMemo(() => graphScope({ objects, links, domainIds, coreOnly, focusId: neighborsOf, showCross }), [objects, links, domainIds, coreOnly, neighborsOf, showCross]);

  const nodeItems = useMemo(() => objects.map((object) => {
    const visible = scope.inScope.has(object.id) || scope.context.has(object.id);
    let emphasis = 'normal';
    if (scope.context.has(object.id)) emphasis = 'context';
    else if (subjectFocus) emphasis = subjectKey(object) === subjectFocus ? 'highlight' : 'dim';
    return nodeVisual(object, { color: colorOf(object), emphasis, hidden: !visible });
  }), [objects, scope, subjectFocus, colors]);
  const edgeItems = useMemo(() => links.map((link) => {
    const state = scope.edges.get(link.id) || 'hidden';
    const source = objectById.get(link.source_object_type_id); const target = objectById.get(link.target_object_type_id);
    const faded = Boolean(subjectFocus) && !(source && target && subjectKey(source) === subjectFocus && subjectKey(target) === subjectFocus);
    return edgeVisual(link, { state, faded, showLabels });
  }), [links, scope, subjectFocus, showLabels, objectById]);
  const visualsRef = useRef({ nodeItems, edgeItems });
  visualsRef.current = { nodeItems, edgeItems };
  const graphNodeItemsRef = useRef(nodeItems);
  graphNodeItemsRef.current = nodeItems;

  const savePositions = () => { if (networkRef.current) writeLayout(activeId, networkRef.current.getPositions()); };

  // 网络实例只在本体切换或首次拿到数据时创建；之后的过滤、着色和增删都增量同步到 DataSet，保留用户拖好的布局。
  useEffect(() => {
    // 只在数据属于当前本体时建图，避免切换本体的过渡帧把旧对象的坐标写进新本体的布局缓存。
    if (!data || data.ontologyId !== activeId || !holder.current) return undefined;
    const saved = readLayout(activeId);
    const placed = data.objects.length > 0 && data.objects.every((item) => saved[item.id]);
    const nodes = new DataSet(visualsRef.current.nodeItems.map((item) => (saved[item.id] ? { ...item, ...saved[item.id] } : item)));
    const edges = new DataSet(visualsRef.current.edgeItems);
    nodesRef.current = nodes; edgesRef.current = edges;
    const network = new Network(holder.current, { nodes, edges }, {
      autoResize: true, physics: placed ? { ...PHYSICS, enabled: false } : PHYSICS,
      interaction: { hover: true, tooltipDelay: 220, multiselect: false, keyboard: false, zoomSpeed: 0.8 },
      layout: { improvedLayout: true, randomSeed: 18 },
      manipulation: { enabled: false, addEdge: (edgeData, callback) => { callback(null); handlers.current.onConnect?.(edgeData); } },
    });
    networkRef.current = network;
    const call = (name) => (params) => handlers.current[name]?.(params);
    network.on('click', call('onClick'));
    network.on('doubleClick', call('onDoubleClick'));
    network.on('oncontext', call('onContext'));
    network.on('dragStart', () => setMenu(null));
    network.on('zoom', () => setMenu(null));
    network.on('dragEnd', (params) => { if (params.nodes.length) savePositions(); });
    network.on('stabilizationIterationsDone', () => { network.setOptions({ physics: { enabled: false } }); savePositions(); network.fit({ animation: { duration: 260 } }); });
    network.on('afterDrawing', () => {
      const items = graphNodeItemsRef.current;
      const positions = network.getPositions(items.map((item) => item.id));
      const scale = network.getScale();
      const next = items.flatMap((item) => {
        if (item.hidden) return [];
        const position = positions[item.id];
        if (!position) return [];
        const point = network.canvasToDOM({ x: position.x, y: position.y - item.iconLineHeight * 1.5 });
        return [{ id: item.id, icon: item.icon, x: point.x, y: point.y, size: Math.max(9, item.iconSize * scale), color: item.iconColor, opacity: item.iconOpacity }];
      });
      const signature = next.map((item) => `${item.id}:${item.icon}:${item.x.toFixed(1)}:${item.y.toFixed(1)}:${item.size.toFixed(1)}:${item.color}:${item.opacity}`).join('|');
      if (signature !== graphIconSignature.current) {
        graphIconSignature.current = signature;
        setGraphIcons(next);
      }
    });
    if (placed) requestAnimationFrame(() => network.fit());
    const observer = new ResizeObserver(() => network.redraw()); observer.observe(holder.current);
    setNetworkReady(true);
    return () => { observer.disconnect(); network.destroy(); networkRef.current = null; nodesRef.current = null; edgesRef.current = null; graphIconSignature.current = ''; setGraphIcons([]); setNetworkReady(false); };
  }, [activeId, data?.ontologyId]);

  useEffect(() => {
    const nodes = nodesRef.current; const edges = edgesRef.current; const network = networkRef.current;
    if (!networkReady || !nodes || !edges || !network) return;
    const nodeIds = new Set(nodeItems.map((item) => item.id));
    const edgeIds = new Set(edgeItems.map((item) => item.id));
    const staleEdges = edges.getIds().filter((id) => !edgeIds.has(id)); if (staleEdges.length) edges.remove(staleEdges);
    const staleNodes = nodes.getIds().filter((id) => !nodeIds.has(id)); if (staleNodes.length) nodes.remove(staleNodes);
    const existing = new Set(nodes.getIds());
    const fresh = nodeItems.filter((item) => !existing.has(item.id));
    nodes.update(nodeItems.filter((item) => existing.has(item.id)));
    if (fresh.length) {
      const center = pendingPosition.current || network.getViewPosition();
      nodes.add(fresh.map((item, index) => ({ ...item, x: center.x + index * 40, y: center.y + index * 40 })));
      pendingPosition.current = null;
    }
    edges.update(edgeItems);
    if (fresh.length || staleNodes.length) savePositions();
  }, [nodeItems, edgeItems, networkReady]);

  // 定位对象：若被当前过滤隐藏，只放开挡住它的那一项过滤再聚焦，避免“定位了却看不到”。
  const reveal = (object) => {
    if (!object) return;
    if (domainIds.size && !domainIds.has(domainKey(object))) setDomainIds((old) => new Set([...old, domainKey(object)]));
    if (coreOnly && !object.is_core) setCoreOnly(false);
    if (neighborsOf && neighborsOf !== object.id && !scope.inScope.has(object.id)) setNeighborsOf('');
    setFocusTarget(object.id);
  };
  const locate = (id) => { reveal(objectById.get(id)); setQuery(''); setSearchOpen(false); };
  // 选中状态以 React 为准，同步到画布（新建的连线要等 DataSet 同步后才能被选中）。
  useEffect(() => {
    const network = networkRef.current;
    if (!networkReady || !network) return;
    if (!selection) { network.unselectAll(); return; }
    const store = selection.kind === 'node' ? nodesRef.current : edgesRef.current;
    const item = store?.get(selection.id);
    if (!item || item.hidden) return;
    if (selection.kind === 'node') network.selectNodes([selection.id]); else network.selectEdges([selection.id]);
  }, [selection, nodeItems, edgeItems, networkReady]);
  useEffect(() => {
    if (selection && !(selection.kind === 'node' ? objectById.has(selection.id) : linkById.has(selection.id))) setSelection(null);
  }, [objectById, linkById]);
  useEffect(() => {
    const network = networkRef.current;
    if (!networkReady || !focusTarget || !network) return;
    const node = nodesRef.current?.get(focusTarget);
    if (!node) { if (data && !objectById.has(focusTarget)) setFocusTarget(''); return; }
    if (node.hidden) return;
    network.selectNodes([focusTarget]); setSelection({ kind: 'node', id: focusTarget });
    network.focus(focusTarget, { scale: Math.max(network.getScale(), 1.1), animation: { duration: 360 } });
    setFocusTarget('');
  }, [focusTarget, nodeItems, networkReady]);

  // 过滤范围变化后自动适配可见对象；首次渲染不触发，避免覆盖记住的视角。
  const fitAfterSync = useRef(false);
  const scopeSignature = `${[...domainIds].sort().join(',')}|${coreOnly}|${neighborsOf}|${showCross}`;
  const lastSignature = useRef(scopeSignature);
  useEffect(() => {
    if (lastSignature.current === scopeSignature) return;
    lastSignature.current = scopeSignature; fitAfterSync.current = true;
  }, [scopeSignature]);
  useEffect(() => {
    if (!fitAfterSync.current || !networkRef.current) return;
    fitAfterSync.current = false;
    requestAnimationFrame(() => networkRef.current?.fit({ animation: { duration: 300 } }));
  }, [nodeItems]);

  const visibleSubjects = useMemo(() => {
    const counts = new Map();
    objects.forEach((object) => { if (scope.inScope.has(object.id)) counts.set(subjectKey(object), (counts.get(subjectKey(object)) || 0) + 1); });
    const rows = (data?.subjects || []).filter((item) => counts.has(item.id)).map((item) => ({ id: item.id, name: item.name, domain: item.business_domain_name, count: counts.get(item.id), color: colors.get(item.id) || NEUTRAL_COLOR }));
    if (counts.has(UNCLASSIFIED)) rows.push({ id: UNCLASSIFIED, name: '未分类', domain: '', count: counts.get(UNCLASSIFIED), color: NEUTRAL_COLOR });
    return rows;
  }, [objects, scope, data, colors]);
  useEffect(() => { if (subjectFocus && data && !visibleSubjects.some((item) => item.id === subjectFocus)) setSubjectFocus(''); }, [visibleSubjects]);

  const domainChips = useMemo(() => {
    const counts = new Map();
    objects.forEach((object) => counts.set(domainKey(object), (counts.get(domainKey(object)) || 0) + 1));
    const rows = (data?.domains || []).map((item) => ({ id: item.id, name: item.name, count: counts.get(item.id) || 0 }));
    if (counts.has(UNCLASSIFIED)) rows.push({ id: UNCLASSIFIED, name: '未分类', count: counts.get(UNCLASSIFIED) });
    return rows;
  }, [objects, data]);
  const toggleDomain = (id) => setDomainIds((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const stats = useMemo(() => {
    let internal = 0; let cross = 0;
    scope.edges.forEach((state) => { if (state === 'internal') internal += 1; if (state === 'cross') cross += 1; });
    return { nodes: scope.inScope.size, internal, cross, core: objects.filter((item) => item.is_core && scope.inScope.has(item.id)).length };
  }, [scope, objects]);

  const matches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return [];
    return objects.filter((item) => `${item.display_name} ${item.name} ${item.external_id || ''}`.toLowerCase().includes(keyword)).slice(0, 8);
  }, [objects, query]);

  const selectedObject = selection?.kind === 'node' ? objectById.get(selection.id) : null;
  const selectedLink = selection?.kind === 'edge' ? linkById.get(selection.id) : null;
  const relationsOf = (id) => links.filter((link) => link.source_object_type_id === id || link.target_object_type_id === id);

  const openCreateObject = (position) => {
    pendingPosition.current = position || null;
    setEditor({ kind: 'object', initial: subjectFocus && subjectFocus !== UNCLASSIFIED ? { subject_domain_id: subjectFocus } : null });
  };
  const openCreateLink = (initial = {}) => setEditor({ kind: 'link', initial });
  const editObject = (item) => item && setEditor({ kind: 'object', item });
  const editLink = (item) => item && setEditor({ kind: 'link', item });
  // 复制必须经过编辑：对象走专门的复制弹窗（身份 + 属性 + 关系），关系走带入全部配置的新建表单。
  const copyObject = (item) => item && setEditor({ kind: 'copy', item });
  const copyLink = (item) => item && setEditor({ kind: 'link', initial: { ...formFromLink(item), ...copyLinkIdentity(item, links) }, copyFrom: item });
  const editProperty = (owner, ownerKind, propertyKey = '') => setEditor({ kind: 'property', owner, ownerKind, propertyKey });
  const removeProperty = (owner, ownerKind, propertyKey) => setRemoving({ kind: 'property', owner, ownerKind, propertyKey });
  const subjectById = (id) => (data?.subjects || []).find((item) => item.id === id);
  const showNeighbors = (id) => { setNeighborsOf(id); setSelection({ kind: 'node', id }); };

  const afterObjectSaved = async (saved) => {
    const creating = !editor?.item;
    setEditor(null);
    await load(); refreshOntologies(activeId);
    reveal(saved);
    notify(creating ? `已创建对象类型“${saved.display_name}”` : `已保存对象类型“${saved.display_name}”`);
  };
  const afterCopied = async (created) => {
    setEditor(null);
    await load(); refreshOntologies(activeId);
    reveal(created);
  };
  // 属性、主题域等“卡片级”编辑：保存后刷新，保持当前选中的对象或关系不变。
  const afterCardSaved = async () => { setEditor(null); setRemoving(null); await load(); refreshOntologies(activeId); };
  const afterLinkSaved = async (saved) => {
    const creating = !editor?.item;
    setEditor(null);
    await load(); refreshOntologies(activeId);
    const source = objectById.get(saved.source_object_type_id); const target = objectById.get(saved.target_object_type_id);
    reveal(source); if (target && target.id !== source?.id) reveal(target);
    setFocusTarget(''); setSelection({ kind: 'edge', id: saved.id });
    notify(creating ? `已创建关系“${saved.display_name}”` : `已保存关系“${saved.display_name}”`);
  };
  const toggleCore = async (item) => {
    try {
      await api(`/api/object-types/${item.id}`, { method: 'PUT', body: JSON.stringify(objectUpdatePayload(item, { is_core: !item.is_core })) });
      await load(); refreshOntologies(activeId);
      notify(item.is_core ? `已取消“${item.display_name}”的核心对象标记` : `已将“${item.display_name}”设为核心对象`);
    } catch (e) { notify(e.message); }
  };
  // 从卡片上删掉的若不是当前选中项（如对象详情里删一条关系），保留当前选中。
  const afterRemoved = async (message, removedId) => {
    setRemoving(null);
    if (!selection || selection.id === removedId) setSelection(null);
    if (neighborsOf && !objectById.has(neighborsOf)) setNeighborsOf('');
    await load(); refreshOntologies(activeId); notify(message);
  };

  const relayout = () => {
    const network = networkRef.current; if (!network) return;
    network.setOptions({ physics: { ...PHYSICS, stabilization: { iterations: 200, fit: true } } });
    network.stabilize(200);
  };
  const zoom = (factor) => {
    const network = networkRef.current; if (!network) return;
    network.moveTo({ scale: Math.min(3, Math.max(0.15, network.getScale() * factor)), animation: { duration: 180 } });
  };
  const exportImage = async () => {
    const canvas = holder.current?.querySelector('canvas'); if (!canvas) return;
    const output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height;
    const ctx = output.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, output.width, output.height); ctx.drawImage(canvas, 0, 0);
    const canvasRect = canvas.getBoundingClientRect();
    const ratioX = output.width / canvasRect.width; const ratioY = output.height / canvasRect.height;
    const icons = [...(wrapRef.current?.querySelectorAll('.network-node-icon svg') || [])];
    const images = await Promise.all(icons.map((svg) => new Promise((resolve) => {
      const clone = svg.cloneNode(true); const color = getComputedStyle(svg).color;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(svg.getBoundingClientRect().width));
      clone.setAttribute('height', String(svg.getBoundingClientRect().height));
      const source = new XMLSerializer().serializeToString(clone).replaceAll('currentColor', color);
      const image = new Image(); const rect = svg.getBoundingClientRect();
      image.onload = () => resolve({ image, rect, opacity: Number(getComputedStyle(svg.parentElement).opacity) || 1 });
      image.onerror = () => resolve(null);
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    })));
    images.filter(Boolean).forEach(({ image, rect, opacity }) => {
      ctx.globalAlpha = opacity;
      ctx.drawImage(image, (rect.left - canvasRect.left) * ratioX, (rect.top - canvasRect.top) * ratioY, rect.width * ratioX, rect.height * ratioY);
    });
    ctx.globalAlpha = 1;
    const anchor = document.createElement('a'); anchor.href = output.toDataURL('image/png'); anchor.download = `${active?.name || '本体'}-本体图谱.png`; anchor.click();
  };

  // 全屏：页面内铺满视口（弹窗和提示仍可用），浏览器支持时同时进入系统全屏。
  const toggleFullscreen = () => {
    if (!fullscreen) {
      setFullscreen(true);
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      setFullscreen(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
    setTimeout(() => networkRef.current?.fit({ animation: { duration: 240 } }), 220);
  };
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const network = networkRef.current; if (!networkReady || !network) return;
    if (connecting) { setMenu(null); network.addEdgeMode(); } else network.disableEditMode();
  }, [connecting, networkReady]);

  handlers.current = {
    onClick: ({ nodes, edges }) => {
      setMenu(null);
      if (connecting) return;
      if (nodes.length) setSelection({ kind: 'node', id: nodes[0] });
      else if (edges.length) setSelection({ kind: 'edge', id: edges[0] });
      else setSelection(null);
    },
    onDoubleClick: ({ nodes, edges, pointer }) => {
      if (connecting) return;
      if (nodes.length) editObject(objectById.get(nodes[0]));
      else if (edges.length) editLink(linkById.get(edges[0]));
      else openCreateObject(pointer.canvas);
    },
    onContext: ({ event, pointer }) => {
      event.preventDefault();
      if (connecting) { setConnecting(false); return; }
      const network = networkRef.current;
      const nodeId = network.getNodeAt(pointer.DOM);
      const edgeId = nodeId === undefined ? network.getEdgeAt(pointer.DOM) : undefined;
      if (nodeId !== undefined) setSelection({ kind: 'node', id: nodeId });
      else if (edgeId !== undefined) setSelection({ kind: 'edge', id: edgeId });
      setMenu({ x: pointer.DOM.x, y: pointer.DOM.y, kind: nodeId !== undefined ? 'node' : edgeId !== undefined ? 'edge' : 'canvas', id: nodeId ?? edgeId, canvas: pointer.canvas });
    },
    onConnect: ({ from, to }) => { setConnecting(false); openCreateLink({ source_object_type_id: from, target_object_type_id: to }); },
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (editor || removing || isTyping(event.target)) return;
      if (event.key === 'Escape') {
        if (menu) setMenu(null);
        else if (connecting) setConnecting(false);
        else if (neighborsOf) setNeighborsOf('');
        else if (fullscreen) toggleFullscreen();
        else if (selection) setSelection(null);
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
        event.preventDefault();
        if (selectedObject) setRemoving({ kind: 'object', item: selectedObject });
        else if (selectedLink) setRemoving({ kind: 'link', item: selectedLink });
        return;
      }
      if (event.key === 'Enter' && selection) { if (selectedObject) editObject(selectedObject); else editLink(selectedLink); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && selection) {
        event.preventDefault();
        if (selectedObject) copyObject(selectedObject); else copyLink(selectedLink);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'f') networkRef.current?.fit({ animation: { duration: 260 } });
      if (event.key === 'l') setConnecting((value) => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (error) return <ErrorState message={error} onRetry={() => { setError(''); load().catch((e) => setError(e.message)); }} />;
  if (!data) return <Loading />;
  const menuObject = menu?.kind === 'node' ? objectById.get(menu.id) : null;
  const menuLink = menu?.kind === 'edge' ? linkById.get(menu.id) : null;
  const neighborsObject = neighborsOf ? objectById.get(neighborsOf) : null;
  const menuAction = (fn) => () => { setMenu(null); fn(); };

  return <div className={`graph-layout ${fullscreen ? 'graph-fullscreen' : ''} ${inspectorOpen ? '' : 'inspector-collapsed'}`}>
    <section className="graph-panel">
      <div className="graph-toolbar">
        <div className="graph-context"><NetworkIcon size={17} /><span><b>{active?.name || '当前本体'}</b><small>本体图谱</small></span></div>
        <div className="graph-search">
          <div className="search-box compact"><Search size={16} /><input value={query} onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onBlur={() => setTimeout(() => setSearchOpen(false), 150)} onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) locate(matches[0].id); if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }} placeholder="搜索并定位对象" aria-label="搜索并定位对象" /></div>
          {searchOpen && query.trim() && <div className="graph-search-results" role="listbox">{matches.map((item) => <button type="button" key={item.id} role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => locate(item.id)}><i style={{ background: colorOf(item).border }} /><span><b>{item.is_core ? '★ ' : ''}{item.display_name}</b><code>{item.name}</code></span><small>{item.subject_domain_name || '未分类'}</small></button>)}{!matches.length && <p>没有匹配的对象</p>}</div>}
        </div>
        <div className="graph-tool-group">
          <button className="btn primary small" onClick={() => openCreateObject()}><Plus size={14} /> 新建对象</button>
          <button className={`btn small ${connecting ? 'primary' : 'secondary'}`} disabled={objects.length < 1} onClick={() => setConnecting((value) => !value)} title="从一个对象拖到另一个对象即可新建关系（快捷键 L）"><Link2 size={14} /> {connecting ? '连线中…' : '连线建关系'}</button>
        </div>
        <div className="graph-tool-group icon-only">
          <button className="icon-btn" onClick={() => zoom(1.25)} title="放大" aria-label="放大"><ZoomIn size={16} /></button>
          <button className="icon-btn" onClick={() => zoom(0.8)} title="缩小" aria-label="缩小"><ZoomOut size={16} /></button>
          <button className="icon-btn" onClick={() => networkRef.current?.fit({ animation: { duration: 260 } })} title="适配全图（F）" aria-label="适配全图"><Focus size={16} /></button>
          <button className="icon-btn" onClick={relayout} title="重新布局" aria-label="重新布局"><RefreshCw size={15} /></button>
          <button className="icon-btn" onClick={exportImage} title="导出为图片" aria-label="导出为图片"><ImageIcon size={16} /></button>
          <button className="icon-btn" onClick={() => setInspectorOpen((value) => !value)} title={inspectorOpen ? '收起检查器' : '展开检查器'} aria-label={inspectorOpen ? '收起检查器' : '展开检查器'}>{inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button>
          <button className="icon-btn" onClick={toggleFullscreen} title={fullscreen ? '退出全屏（Esc）' : '全屏查看'} aria-label={fullscreen ? '退出全屏' : '全屏查看'}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        </div>
        <div className="graph-legend"><span><i className="legend-node" /> 对象 {stats.nodes}/{objects.length}</span><span><Star size={11} className="core-star" /> 核心 {stats.core}</span><span><i className="legend-edge" /> 关系 {stats.internal}</span>{showCross && stats.cross > 0 && <span><i className="legend-cross-edge" /> 跨域 {stats.cross}</span>}</div>
      </div>
      <div className="graph-filterbar">
        <span className="graph-filter-label">业务域</span>
        <div className="graph-chips">
          <button type="button" className={`graph-chip ${domainIds.size ? '' : 'active'}`} onClick={() => setDomainIds(new Set())}>全部</button>
          {domainChips.map((item) => <button type="button" key={item.id} aria-pressed={domainIds.has(item.id)} className={`graph-chip ${domainIds.has(item.id) ? 'active' : ''}`} onClick={() => toggleDomain(item.id)} disabled={!item.count}>{item.name}<small>{item.count}</small>{domainIds.has(item.id) && <Check size={12} />}</button>)}
        </div>
        <div className="graph-switches">
          <label><input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} /> 仅核心对象</label>
          <label title="范围外但与当前对象有关系的对象以虚线淡显"><input type="checkbox" checked={showCross} onChange={(e) => setShowCross(e.target.checked)} /> 显示跨域关联</label>
          <label><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> 关系名称</label>
        </div>
      </div>
      <div className="graph-filterbar subject">
        <span className="graph-filter-label">主题域</span>
        <div className="graph-chips">{visibleSubjects.map((item) => <button type="button" key={item.id} aria-pressed={subjectFocus === item.id} className={`graph-chip subject ${subjectFocus === item.id ? 'active' : ''} ${subjectFocus && subjectFocus !== item.id ? 'muted' : ''}`} style={{ '--chip-color': item.color.border, '--chip-fill': item.color.fill, '--chip-text': item.color.text }} title={item.domain ? `${item.domain} / ${item.name}` : item.name} onClick={() => setSubjectFocus(subjectFocus === item.id ? '' : item.id)}><i />{item.name}<small>{item.count}</small>{subjectFocus === item.id && <Check size={12} />}</button>)}{!visibleSubjects.length && <span className="graph-filter-empty">当前范围没有对象</span>}</div>
        <span className="graph-filter-hint">{subjectFocus ? '再次点击取消高亮' : '点击主题域高亮其对象'}</span>
      </div>
      <div className="network-canvas-wrap" ref={wrapRef}>
        <div ref={holder} className={`network-canvas ${connecting ? 'connecting' : ''}`} />
        <div className="network-node-icons" aria-hidden="true">{graphIcons.map((item) => <span key={item.id} className="network-node-icon" style={{ left: item.x, top: item.y, width: item.size, height: item.size, color: item.color, opacity: item.opacity }}><ObjectTypeIcon value={item.icon} size={Math.max(1, item.size)} /></span>)}</div>
        {(neighborsObject || connecting) && <div className="graph-banner">{connecting ? <><Link2 size={14} /><span>连线模式：按住起点对象拖到终点对象，松开后填写关系信息。</span><button type="button" onClick={() => setConnecting(false)}>退出（Esc）</button></> : <><Crosshair size={14} /><span>正在查看“{neighborsObject.display_name}”及其直接关联的 {Math.max(0, scope.inScope.size - 1)} 个对象</span><button type="button" onClick={() => setNeighborsOf('')}>返回全图</button></>}</div>}
        {!objects.length && <div className="graph-empty"><NetworkIcon size={34} /><strong>还没有对象类型</strong><span>新建第一个对象后，本体图谱会在这里生成。也可以双击画布空白处直接新建。</span><button className="btn primary small" onClick={() => openCreateObject()}><Plus size={14} /> 新建对象类型</button></div>}
        {objects.length > 0 && !scope.inScope.size && <div className="graph-empty soft"><Boxes size={30} /><strong>当前过滤条件下没有对象</strong><button className="btn secondary small" onClick={() => { setDomainIds(new Set()); setCoreOnly(false); setNeighborsOf(''); }}>清除过滤</button></div>}
        {objects.length > 0 && <div className="graph-hint">单击查看 · 双击编辑 · 右键更多操作 · 双击空白处新建对象 · Delete 删除选中项</div>}
        {menu && <div className="graph-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(e) => e.preventDefault()}>
          {menuObject && <><header>{menuObject.display_name}</header>
            <button role="menuitem" onClick={menuAction(() => editObject(menuObject))}><Pencil size={14} /> 编辑对象</button>
            <button role="menuitem" onClick={menuAction(() => copyObject(menuObject))}><Copy size={14} /> 复制对象…<kbd>⌘D</kbd></button>
            <button role="menuitem" onClick={menuAction(() => openCreateLink({ source_object_type_id: menuObject.id }))}><Link2 size={14} /> 从此对象新建关系</button>
            <button role="menuitem" onClick={menuAction(() => toggleCore(menuObject))}><Star size={14} /> {menuObject.is_core ? '取消核心对象' : '设为核心对象'}</button>
            <button role="menuitem" onClick={menuAction(() => showNeighbors(menuObject.id))}><Crosshair size={14} /> 只看关联对象</button>
            <button role="menuitem" onClick={menuAction(() => setSubjectFocus(subjectKey(menuObject)))}><span className="menu-dot" style={{ background: colorOf(menuObject).border }} /> 高亮所在主题域</button>
            <hr /><button role="menuitem" className="danger" onClick={menuAction(() => setRemoving({ kind: 'object', item: menuObject }))}><Trash2 size={14} /> 删除对象</button></>}
          {menuLink && <><header>{menuLink.display_name}</header>
            <button role="menuitem" onClick={menuAction(() => editLink(menuLink))}><Pencil size={14} /> 编辑关系</button>
            <button role="menuitem" onClick={menuAction(() => copyLink(menuLink))}><Copy size={14} /> 复制关系…<kbd>⌘D</kbd></button>
            <button role="menuitem" onClick={menuAction(() => locate(menuLink.source_object_type_id))}><ArrowRight size={14} /> 定位起点“{menuLink.source_display_name}”</button>
            <button role="menuitem" onClick={menuAction(() => locate(menuLink.target_object_type_id))}><ArrowRight size={14} /> 定位终点“{menuLink.target_display_name}”</button>
            <hr /><button role="menuitem" className="danger" onClick={menuAction(() => setRemoving({ kind: 'link', item: menuLink }))}><Trash2 size={14} /> 删除关系</button></>}
          {menu.kind === 'canvas' && <>
            <button role="menuitem" onClick={menuAction(() => openCreateObject(menu.canvas))}><Plus size={14} /> 在此处新建对象</button>
            <button role="menuitem" onClick={menuAction(() => openCreateLink())}><Link2 size={14} /> 新建关系</button>
            <button role="menuitem" onClick={menuAction(() => networkRef.current?.fit({ animation: { duration: 260 } }))}><Focus size={14} /> 适配全图</button>
            <button role="menuitem" onClick={menuAction(relayout)}><RefreshCw size={14} /> 重新布局</button></>}
        </div>}
      </div>
    </section>
    {inspectorOpen && <aside className="inspector">
      <div className="inspector-title"><NetworkIcon size={18} /><div><h3>本体检查器</h3><p>选中对象或关系后可直接编辑、删除</p></div>{selection && <button className="icon-btn" onClick={() => setSelection(null)} aria-label="取消选择" title="取消选择"><X size={15} /></button>}</div>
      {selectedObject ? <ObjectInspector object={selectedObject} color={colorOf(selectedObject)} relations={relationsOf(selectedObject.id)} onEdit={() => editObject(selectedObject)} onCopy={() => copyObject(selectedObject)} onRemove={() => setRemoving({ kind: 'object', item: selectedObject })} onToggleCore={() => toggleCore(selectedObject)} onNeighbors={() => showNeighbors(selectedObject.id)} onAddLink={() => openCreateLink({ source_object_type_id: selectedObject.id })} onSelectLink={(id) => setSelection({ kind: 'edge', id })} onEditLink={(id) => editLink(linkById.get(id))} onRemoveLink={(id) => setRemoving({ kind: 'link', item: linkById.get(id) })} onEditProperty={(key) => editProperty(selectedObject, 'object', key)} onRemoveProperty={(key) => removeProperty(selectedObject, 'object', key)} onAddProperty={() => editProperty(selectedObject, 'object')} onOpenList={() => navigate('/ontology/model/object-types')} />
        : selectedLink ? <LinkInspector link={selectedLink} onEdit={() => editLink(selectedLink)} onCopy={() => copyLink(selectedLink)} onRemove={() => setRemoving({ kind: 'link', item: selectedLink })} onLocate={locate} onEditObject={(id) => editObject(objectById.get(id))} onEditProperty={(key) => editProperty(selectedLink, 'link', key)} onRemoveProperty={(key) => removeProperty(selectedLink, 'link', key)} onAddProperty={() => editProperty(selectedLink, 'link')} />
          : <OverviewInspector stats={stats} subjects={visibleSubjects} subjectFocus={subjectFocus} onSubject={(id) => setSubjectFocus(subjectFocus === id ? '' : id)} onEditSubject={(id) => setEditor({ kind: 'subject', item: subjectById(id) })} onRemoveSubject={(id) => setRemoving({ kind: 'subject', item: subjectById(id) })} coreObjects={objects.filter((item) => item.is_core && scope.inScope.has(item.id))} onLocate={locate} onEditObject={(id) => editObject(objectById.get(id))} onUncore={(id) => toggleCore(objectById.get(id))} onCreate={() => openCreateObject()} />}
    </aside>}
    {editor?.kind === 'object' && <ObjectTypeEditor activeId={activeId} editing={editor.item || null} initial={editor.initial} notify={notify} onClose={() => { pendingPosition.current = null; setEditor(null); }} onSaved={afterObjectSaved} />}
    {editor?.kind === 'link' && <LinkTypeEditor activeId={activeId} objects={objects} editing={editor.item || null} initial={editor.initial} copyFrom={editor.copyFrom} notify={notify} onClose={() => setEditor(null)} onSaved={afterLinkSaved} />}
    {editor?.kind === 'copy' && <ObjectCopyDialog activeId={activeId} source={editor.item} objects={objects} links={links} notify={notify} onClose={() => setEditor(null)} onCopied={afterCopied} />}
    {editor?.kind === 'property' && <PropertyQuickEditor activeId={activeId} owner={editor.owner} ownerKind={editor.ownerKind} propertyKey={editor.propertyKey} notify={notify} onClose={() => setEditor(null)} onSaved={afterCardSaved} />}
    {editor?.kind === 'subject' && editor.item && <SubjectDomainQuickEditor activeId={activeId} subject={editor.item} notify={notify} onClose={() => setEditor(null)} onSaved={afterCardSaved} />}
    {removing?.kind === 'property' && <PropertyRemoveDialog activeId={activeId} owner={removing.owner} ownerKind={removing.ownerKind} propertyKey={removing.propertyKey} notify={notify} onClose={() => setRemoving(null)} onSaved={afterCardSaved} />}
    {removing?.kind === 'subject' && removing.item && <SubjectDomainRemoveDialog subject={removing.item} objectCount={objects.filter((item) => item.subject_domain_id === removing.item.id).length} notify={notify} onClose={() => setRemoving(null)} onRemoved={async () => { if (subjectFocus === removing.item.id) setSubjectFocus(''); await afterCardSaved(); }} />}
    {(removing?.kind === 'object' || removing?.kind === 'link') && removing.item && <RemoveDialog activeId={activeId} target={removing} links={links} onClose={() => setRemoving(null)} onRemoved={(message) => afterRemoved(message, removing.item.id)} onEditObject={(item) => { setRemoving(null); editObject(item); }} navigate={navigate} />}
  </div>;
}

// 检查器里的每张小卡片都带“编辑 / 删除”两个图标；卡片本身仍可点击（选中关系、定位对象、高亮主题域）。
function CardActions({ label, onEdit, onRemove, editTitle = '编辑', removeTitle = '删除', removeIcon }) {
  const stop = (fn) => (event) => { event.stopPropagation(); fn(); };
  return <span className="card-actions">
    {onEdit && <button type="button" className="card-action" onClick={stop(onEdit)} title={`${editTitle}${label ? `：${label}` : ''}`} aria-label={`${editTitle}${label ? `：${label}` : ''}`}><Pencil size={13} /></button>}
    {onRemove && <button type="button" className="card-action danger" onClick={stop(onRemove)} title={`${removeTitle}${label ? `：${label}` : ''}`} aria-label={`${removeTitle}${label ? `：${label}` : ''}`}>{removeIcon || <Trash2 size={13} />}</button>}
  </span>;
}

function SectionHeader({ title, count, onAdd, addLabel }) {
  return <h4 className="inspector-section-head"><span>{title} · {count}</span>{onAdd && <button type="button" className="card-action" onClick={onAdd} title={addLabel} aria-label={addLabel}><Plus size={13} /></button>}</h4>;
}

function PropertyCards({ properties, onEdit, onRemove }) {
  return <div className="inspector-props">{properties.map((prop) => <div key={prop.key} className="inspector-card" role="button" tabIndex={0} onDoubleClick={() => onEdit(prop.key)} onKeyDown={(e) => { if (e.key === 'Enter') onEdit(prop.key); }}>
    <span className="inspector-card-body"><span>{prop.name}{prop.is_primary_key && <KeyRound size={11} aria-label="主键" />}{prop.is_required && <em className="mini-tag">必填</em>}</span><code>{prop.key} · {dataTypeLabel(prop.type)}</code></span>
    <CardActions label={prop.name} onEdit={() => onEdit(prop.key)} onRemove={prop.is_primary_key ? null : () => onRemove(prop.key)} />
  </div>)}</div>;
}

function ObjectInspector({ object, color, relations, onEdit, onCopy, onRemove, onToggleCore, onNeighbors, onAddLink, onSelectLink, onEditLink, onRemoveLink, onEditProperty, onRemoveProperty, onAddProperty, onOpenList }) {
  const properties = object.effective_properties || object.properties || [];
  return <div className="inspector-content">
    <div className="inspector-object"><div className="entity-icon large" style={{ color: color.text, background: color.fill, borderColor: color.border }}><ObjectTypeIcon value={object.icon} size={22} /></div><div><h2>{object.display_name}{object.is_core && <em className="core-badge"><Star size={10} /> 核心</em>}</h2><code>{object.name}</code></div></div>
    <div className="inspector-actions"><button className="btn primary small" onClick={onEdit}><Pencil size={14} /> 编辑</button><button className="btn secondary small" onClick={onCopy} title="复制对象（⌘D）"><Copy size={14} /> 复制</button><button className="btn secondary small" onClick={onAddLink}><Link2 size={14} /> 新建关系</button><button className="btn danger small" onClick={onRemove}><Trash2 size={14} /> 删除</button></div>
    <div className="inspector-quick"><button type="button" onClick={onToggleCore} className={object.is_core ? 'on' : ''}><Star size={13} /> {object.is_core ? '已设为核心对象' : '设为核心对象'}</button><button type="button" onClick={onNeighbors}><Crosshair size={13} /> 只看关联对象</button></div>
    <p>{object.description || '暂无业务说明'}</p>
    <dl>
      <div><dt>业务域 / 主题域</dt><dd><span className="subject-dot" style={{ background: color.border }} />{object.business_domain_name || '未分类'} / {object.subject_domain_name || '未分类'}</dd></div>
      <div><dt>对象类别</dt><dd>{object.category || '未设置'}</dd></div>
      <div><dt>资源状态</dt><dd><em className={`oma-status ${object.status}`}>{statusLabel(object.status)}</em></dd></div>
      <div><dt>标题属性</dt><dd className="mono">{object.title_property || '未设置'}</dd></div>
    </dl>
    <SectionHeader title="关联关系" count={relations.length} onAdd={onAddLink} addLabel="新建关系" />
    <div className="inspector-relations">{relations.map((link) => { const outgoing = link.source_object_type_id === object.id; return <div key={link.id} className="inspector-card" role="button" tabIndex={0} onClick={() => onSelectLink(link.id)} onKeyDown={(e) => { if (e.key === 'Enter') onSelectLink(link.id); }}>
      <span className={`direction ${outgoing ? 'out' : 'in'}`}>{outgoing ? '出' : '入'}</span>
      <span className="inspector-card-body"><b>{link.display_name}</b><small>{outgoing ? `→ ${link.target_display_name}` : `← ${link.source_display_name}`}</small></span>
      <CardActions label={link.display_name} onEdit={() => onEditLink(link.id)} onRemove={() => onRemoveLink(link.id)} />
    </div>; })}{!relations.length && <p className="inspector-note">还没有关系，可点 + 或使用连线模式。</p>}</div>
    <SectionHeader title="对象属性" count={properties.length} onAdd={onAddProperty} addLabel="添加属性" />
    <PropertyCards properties={properties} onEdit={onEditProperty} onRemove={onRemoveProperty} />
    <button type="button" className="text-btn inspector-more" onClick={onOpenList}>在对象类型目录中查看 <ArrowRight size={13} /></button>
  </div>;
}

function LinkInspector({ link, onEdit, onCopy, onRemove, onLocate, onEditObject, onEditProperty, onRemoveProperty, onAddProperty }) {
  const endpoint = (id, name, label) => <div className="inspector-card endpoint" role="button" tabIndex={0} onClick={() => onLocate(id)} onKeyDown={(e) => { if (e.key === 'Enter') onLocate(id); }} title={`定位${label}`}>
    <span className="inspector-card-body"><small>{label}</small><b>{name}</b></span>
    <CardActions label={name} onEdit={() => onEditObject(id)} editTitle="编辑对象" />
  </div>;
  return <div className="inspector-content">
    <div className="inspector-object"><div className="entity-icon large"><GitBranch size={20} /></div><div><h2>{link.display_name}{link.is_core && <em className="core-badge">核心</em>}</h2><code>{link.name}</code></div></div>
    <div className="inspector-actions"><button className="btn primary small" onClick={onEdit}><Pencil size={14} /> 编辑</button><button className="btn secondary small" onClick={onCopy} title="复制关系（⌘D）"><Copy size={14} /> 复制</button><button className="btn danger small" onClick={onRemove}><Trash2 size={14} /> 删除</button></div>
    <div className="inspector-endpoints">{endpoint(link.source_object_type_id, link.source_display_name, '起点')}<span><ArrowRight size={14} /><small>{LINK_CARDINALITIES[link.cardinality] || link.cardinality}</small></span>{endpoint(link.target_object_type_id, link.target_display_name, '终点')}</div>
    <p>{link.description || '暂无业务定义'}</p>
    <dl>
      <div><dt>反向名称</dt><dd>{link.reverse_display_name || '—'}</dd></div>
      <div><dt>来源系统</dt><dd>{link.source_system || '—'}</dd></div>
      <div><dt>起点键 / 终点键</dt><dd className="mono">{link.source_key || '—'} / {link.target_key || '—'}</dd></div>
      <div><dt>资源状态</dt><dd><em className={`oma-status ${link.status}`}>{statusLabel(link.status)}</em></dd></div>
    </dl>
    <SectionHeader title="关系属性" count={(link.properties || []).length} onAdd={onAddProperty} addLabel="添加关系属性" />
    <PropertyCards properties={link.properties || []} onEdit={onEditProperty} onRemove={onRemoveProperty} />
    {!(link.properties || []).length && <p className="inspector-note">关系属性用于描述关系本身，例如“签约日期”。可点 + 添加。</p>}
  </div>;
}

function OverviewInspector({ stats, subjects, subjectFocus, onSubject, onEditSubject, onRemoveSubject, coreObjects, onLocate, onEditObject, onUncore, onCreate }) {
  return <div className="inspector-content">
    <div className="inspector-overview">{[['对象', stats.nodes], ['核心对象', stats.core], ['关系', stats.internal], ['跨域关联', stats.cross]].map(([label, value]) => <span key={label}><b>{value}</b><small>{label}</small></span>)}</div>
    <h4>主题域配色</h4>
    <div className="inspector-subjects">{subjects.map((item) => <div key={item.id} className={`inspector-card ${subjectFocus === item.id ? 'active' : ''}`} role="button" tabIndex={0} aria-pressed={subjectFocus === item.id} onClick={() => onSubject(item.id)} onKeyDown={(e) => { if (e.key === 'Enter') onSubject(item.id); }}>
      <i style={{ background: item.color.border }} /><span className="inspector-card-body">{item.name}<small>{item.domain}</small></span><em>{item.count}</em>
      {item.id !== UNCLASSIFIED && <CardActions label={item.name} onEdit={() => onEditSubject(item.id)} onRemove={() => onRemoveSubject(item.id)} />}
    </div>)}{!subjects.length && <p className="inspector-note">当前范围没有对象。</p>}</div>
    <h4>核心对象 · {coreObjects.length}</h4>
    <div className="inspector-relations">{coreObjects.map((item) => <div key={item.id} className="inspector-card" role="button" tabIndex={0} onClick={() => onLocate(item.id)} onKeyDown={(e) => { if (e.key === 'Enter') onLocate(item.id); }}>
      <span className="direction core"><Star size={10} /></span><span className="inspector-card-body"><b>{item.display_name}</b><small>{item.subject_domain_name || '未分类'}</small></span>
      <CardActions label={item.display_name} onEdit={() => onEditObject(item.id)} onRemove={() => onUncore(item.id)} removeTitle="取消核心标记" removeIcon={<X size={13} />} />
    </div>)}{!coreObjects.length && <p className="inspector-note">还没有核心对象。右键对象选择“设为核心对象”，或在对象编辑中勾选。</p>}</div>
    <button type="button" className="btn secondary small inspector-create" onClick={onCreate}><Plus size={14} /> 新建对象类型</button>
  </div>;
}

// 删除确认：先列出影响范围，再决定能否删除。对象被关系引用时可选择连同关系一并删除；
// 被动作、规则或实例引用时不在图谱里级联处理，避免误删业务逻辑。
function RemoveDialog({ activeId, target, links, onClose, onRemoved, onEditObject, navigate }) {
  const { kind, item } = target;
  const [impact, setImpact] = useState(kind === 'object' ? null : {});
  const [withLinks, setWithLinks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const related = kind === 'object' ? links.filter((link) => link.source_object_type_id === item.id || link.target_object_type_id === item.id) : [];
  useEffect(() => {
    if (kind !== 'object') return;
    Promise.all([api(`/api/ontologies/${activeId}/actions`), api(`/api/ontologies/${activeId}/business-rules`), api(`/api/ontologies/${activeId}/instances?object_type_id=${encodeURIComponent(item.id)}`)])
      .then(([actions, rules, instances]) => setImpact({ actions: actions.filter((row) => row.target_object_type_id === item.id), rules: rules.filter((row) => row.target_object_type_id === item.id), instances: instances.length }))
      .catch((e) => setError(e.message));
  }, [kind, item.id]);
  const locked = kind === 'object' ? ['active', 'promoted'].includes(item.status) : item.status === 'active';
  const activeLinks = related.filter((link) => link.status === 'active');
  const hardBlocked = kind === 'object' && impact && (impact.actions.length || impact.rules.length || impact.instances);
  const needsLinks = related.length > 0;
  const canRemove = impact && !locked && !hardBlocked && (!needsLinks || (withLinks && !activeLinks.length));
  const remove = async () => {
    setBusy(true); setError('');
    try {
      if (kind === 'link') { await api(`/api/link-types/${item.id}`, { method: 'DELETE' }); await onRemoved(`已删除关系“${item.display_name}”`); return; }
      for (const link of related) await api(`/api/link-types/${link.id}`, { method: 'DELETE' });
      await api(`/api/object-types/${item.id}`, { method: 'DELETE' });
      await onRemoved(`已删除对象类型“${item.display_name}”${related.length ? `及 ${related.length} 个关联关系` : ''}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const label = kind === 'object' ? '对象类型' : '关系类型';
  return <Modal title={`删除${label}`} subtitle={item.display_name} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>取消</button><button className="btn danger" disabled={!canRemove || busy} onClick={remove}><Trash2 size={15} /> {busy ? '删除中…' : '确认删除'}</button></>}>
    <div className="remove-dialog">
      {error && <div className="form-error-banner" role="alert">{error}</div>}
      {!impact ? <p className="form-hint">正在检查引用影响…</p> : <>
        {locked && <div className="remove-block"><b>{statusLabel(item.status)}状态的{label}不能直接删除</b><p>请先把资源状态改为“已弃用”，再删除。</p>{kind === 'object' && <button className="btn secondary small" onClick={() => onEditObject(item)}><Pencil size={14} /> 编辑对象状态</button>}</div>}
        {kind === 'link' && !locked && <p>删除后，<b>{item.source_display_name}</b> → <b>{item.target_display_name}</b> 之间的这条关系定义会从工作状态中移除，已发布版本不受影响。</p>}
        {kind === 'object' && <>
          <ul className="remove-impact">
            <li className={related.length ? 'warn' : ''}><span>关联关系</span><b>{related.length}</b></li>
            <li className={impact.actions.length ? 'block' : ''}><span>动作类型</span><b>{impact.actions.length}</b></li>
            <li className={impact.rules.length ? 'block' : ''}><span>规则</span><b>{impact.rules.length}</b></li>
            <li className={impact.instances ? 'block' : ''}><span>实例数据</span><b>{impact.instances}</b></li>
          </ul>
          {hardBlocked ? <div className="remove-block"><b>该对象仍被业务逻辑或实例引用</b><p>请先处理以下引用后再删除：{[...impact.actions.map((row) => `动作“${row.display_name}”`), ...impact.rules.map((row) => `规则“${row.display_name}”`), impact.instances ? `${impact.instances} 条实例` : ''].filter(Boolean).join('、')}。</p><div>{impact.actions.length > 0 && <button className="btn secondary small" onClick={() => navigate('/ontology/model/actions')}>前往动作类型</button>}{impact.rules.length > 0 && <button className="btn secondary small" onClick={() => navigate('/ontology/logic/definitions')}>前往规则</button>}{impact.instances > 0 && <button className="btn secondary small" onClick={() => navigate('/ontology/data/instances')}>前往实例数据</button>}</div></div>
            : needsLinks && !locked && <div className="remove-links"><p>该对象有 {related.length} 个关联关系，需要一并删除：</p><ul>{related.map((link) => <li key={link.id}><b>{link.display_name}</b><small>{link.source_display_name} → {link.target_display_name}</small>{link.status === 'active' && <em>已启用，不能删除</em>}</li>)}</ul>{activeLinks.length ? <p className="field-error">其中 {activeLinks.length} 个关系为“已启用”，请先在关系编辑中改为“已弃用”。</p> : <label className="check"><input type="checkbox" checked={withLinks} onChange={(e) => setWithLinks(e.target.checked)} /> 同时删除这 {related.length} 个关系</label>}</div>}
          {!locked && !hardBlocked && !needsLinks && <p>该对象没有被其他资源引用，可以直接删除。删除只影响当前工作状态。</p>}
        </>}
      </>}
    </div>
  </Modal>;
}
