// 本体图谱的纯计算：范围过滤、主题域配色和节点/连线外观。
// 与 vis-network 解耦，便于单测；GraphPage 只负责把结果同步到 DataSet。

export const UNCLASSIFIED = '__none__';

// 主题域色板：每项给出描边、浅底和文字色。超过 10 个主题域时循环使用。
export const SUBJECT_PALETTE = [
  { border: '#2f80ed', fill: '#e8f1fe', text: '#174a8b' },
  { border: '#27a17a', fill: '#e4f5ee', text: '#16624a' },
  { border: '#e08a2c', fill: '#fdf0e1', text: '#8a4f12' },
  { border: '#8b5cf6', fill: '#f1ebfe', text: '#5531a8' },
  { border: '#d6457a', fill: '#fcebf2', text: '#8e2350' },
  { border: '#1a9fb5', fill: '#e2f4f7', text: '#106574' },
  { border: '#b8962e', fill: '#f8f1da', text: '#6f5814' },
  { border: '#5b6ee1', fill: '#eceffd', text: '#2f3f9e' },
  { border: '#c0573e', fill: '#fbebe7', text: '#7d3121' },
  { border: '#5f8f3a', fill: '#edf4e5', text: '#3b5d22' },
];
export const NEUTRAL_COLOR = { border: '#9aabbb', fill: '#f2f5f8', text: '#4a6075' };

export function subjectColorMap(subjects = []) {
  const map = new Map();
  subjects.forEach((item, index) => map.set(item.id, SUBJECT_PALETTE[index % SUBJECT_PALETTE.length]));
  return map;
}

export const domainKey = (object) => object.business_domain_id || UNCLASSIFIED;
export const subjectKey = (object) => object.subject_domain_id || UNCLASSIFIED;

/**
 * 计算当前可见范围。
 * - domainIds 为空表示不过滤业务域；focusId 存在时只看该对象和一跳关联对象（优先于其他过滤）。
 * - showCross 打开时，范围外但与范围内对象有关系的对象作为“上下文”淡显。
 */
export function graphScope({ objects = [], links = [], domainIds = new Set(), coreOnly = false, focusId = '', showCross = false }) {
  const known = new Set(objects.map((item) => item.id));
  const coreIds = new Set(objects.filter((item) => item.is_core).map((item) => item.id));
  const inScope = new Set();
  if (focusId && known.has(focusId)) {
    inScope.add(focusId);
    links.forEach((link) => {
      if (link.source_object_type_id === focusId) inScope.add(link.target_object_type_id);
      if (link.target_object_type_id === focusId) inScope.add(link.source_object_type_id);
    });
  } else {
    objects.forEach((item) => {
      if (domainIds.size && !domainIds.has(domainKey(item))) return;
      if (coreOnly && !item.is_core) return;
      inScope.add(item.id);
    });
  }
  const context = new Set();
  const edges = new Map();
  links.forEach((link) => {
    const source = link.source_object_type_id; const target = link.target_object_type_id;
    if (!known.has(source) || !known.has(target)) { edges.set(link.id, 'hidden'); return; }
    const sourceIn = inScope.has(source); const targetIn = inScope.has(target);
    if (sourceIn && targetIn) edges.set(link.id, 'internal');
    else if ((sourceIn || targetIn) && showCross && !focusId && (!coreOnly || coreIds.has(sourceIn ? target : source))) {
      // 跨范围关联：另一端作为淡显的上下文对象；“仅核心对象”时上下文也只保留核心对象。
      edges.set(link.id, 'cross');
      context.add(sourceIn ? target : source);
    } else edges.set(link.id, 'hidden');
  });
  return { inScope, context, edges };
}

// vis-network 的 html 标签解析只还原 &lt; 与 &amp;，所以只转义这两个字符。
export const escapeLabel = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * 节点外观。emphasis：
 * - normal：按主题域着色；
 * - highlight：处于被选中的主题域，加深描边与阴影；
 * - dim：有主题域被选中但该对象不在其中，整体淡化；
 * - context：范围外的跨域关联对象，虚线描边并淡化。
 * 核心对象加粗、放大并带 ★ 标记。
 */
// vis-network 的节点 opacity 不作用于文字，淡化时直接给每个颜色加透明度。
export const withAlpha = (hex, alpha) => {
  if (alpha >= 1) return hex;
  const value = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
};

export function nodeVisual(object, { color = NEUTRAL_COLOR, emphasis = 'normal', hidden = false } = {}) {
  const core = Boolean(object.is_core);
  const strong = emphasis === 'highlight';
  const alpha = emphasis === 'dim' ? 0.3 : emphasis === 'context' ? 0.55 : 1;
  const title = `${core ? '★ ' : ''}${escapeLabel(object.display_name)}`;
  const text = withAlpha(color.text, alpha);
  return {
    id: object.id,
    icon: object.icon || 'box',
    iconColor: color.text,
    iconOpacity: alpha,
    iconSize: core ? 17 : 14,
    hidden,
    // 隐藏对象退出布局计算，“重新布局”只排当前可见范围。
    physics: !hidden,
    // 图标由 GraphPage 绘制在名称左侧，节点本身不再为它预留顶部空行。
    label: `<b>${title}</b>\n${escapeLabel(object.name)}`,
    title: `${object.display_name}${core ? '（核心对象）' : ''} · ${object.properties?.length || 0} 个属性 · ${object.business_domain_name || '未分类'} / ${object.subject_domain_name || '未分类'}`,
    shape: 'box',
    margin: core ? { top: 10, right: 18, bottom: 10, left: 38 } : { top: 8, right: 14, bottom: 8, left: 32 },
    widthConstraint: { minimum: core ? 170 : 132 },
    borderWidth: core ? 3 : strong ? 2 : 1.2,
    borderWidthSelected: core ? 4 : 2.6,
    shapeProperties: { borderRadius: 6, borderDashes: emphasis === 'context' ? [5, 4] : false },
    color: {
      background: withAlpha(color.fill, alpha), border: withAlpha(color.border, alpha),
      highlight: { background: '#ffffff', border: color.border },
      hover: { background: '#ffffff', border: color.border },
    },
    font: {
      face: 'Inter, PingFang SC, sans-serif', size: core ? 15 : 12, color: text, multi: 'html',
      bold: { size: core ? 18 : 13.5, color: text, face: 'Inter, PingFang SC, sans-serif', mod: 'bold' },
    },
    shadow: { enabled: alpha === 1 && (core || strong), color: 'rgba(31,67,115,.16)', size: core ? 14 : 9, x: 0, y: 4 },
    mass: core ? 2 : 1,
  };
}

export const CARDINALITY_SHORT = { one_to_one: '1:1', one_to_many: '1:N', many_to_one: 'N:1', many_to_many: 'N:N' };

export function edgeVisual(link, { state = 'internal', faded = false, showLabels = true } = {}) {
  const cross = state === 'cross';
  const base = cross ? '#d49a55' : '#8aa3bd';
  const color = faded ? '#dde4eb' : base;
  return {
    id: link.id, from: link.source_object_type_id, to: link.target_object_type_id,
    hidden: state === 'hidden',
    physics: state !== 'hidden',
    // vis-network 更新时会忽略空标签而保留旧值，隐藏名称时用一个空格占位。
    label: showLabels ? `${link.display_name}  ${CARDINALITY_SHORT[link.cardinality] || ''}`.trim() : ' ',
    title: `${link.source_display_name || ''} → ${link.display_name} → ${link.target_display_name || ''}${link.is_core ? '（核心关系）' : ''}`,
    arrows: { to: { enabled: true, scaleFactor: 0.65 } },
    dashes: cross,
    width: link.is_core ? 2.6 : 1.3,
    selectionWidth: 1.6,
    color: { color, highlight: '#2169d7', hover: cross ? '#b8731b' : '#4b78aa' },
    font: { size: 11, color: faded ? '#c3ccd5' : cross ? '#a06a2c' : '#55708c', background: showLabels ? 'rgba(249,251,253,.92)' : 'rgba(0,0,0,0)', strokeWidth: 0, align: 'middle' },
    smooth: { type: 'continuous', roundness: 0.25 },
  };
}
