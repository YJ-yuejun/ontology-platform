import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ArrowLeft, BookOpen, Bot, Boxes, Building2, Check, ChevronDown, ChevronLeft, ChevronRight,
  ClipboardList, Database, FileText, GitBranch, Hammer, History, ListChecks, ListTree, Menu,
  Library, MessageSquareText, Network, Plus, Search, Settings, ShieldCheck, Sparkles, Layers3, TableProperties,
  Waypoints, Workflow, LogOut, MoreHorizontal, UserRound,
} from 'lucide-react';
import { api } from './api';
import Modal from './components/Modal';
import ObjectTypes from './pages/ObjectTypes';
import ObjectProperties from './pages/ObjectProperties';
import LinkTypes from './pages/LinkTypes';
import Actions from './pages/Actions';
import GraphPage from './pages/GraphPage';
import Governance from './pages/Governance';
import OntologyQuality from './pages/OntologyQuality';
import VersionCompare from './pages/VersionCompare';
import ActivityLog from './pages/ActivityLog';
import ReleaseSnapshot from './pages/ReleaseSnapshot';
import DictionaryManagement from './pages/DictionaryManagement';
import FuturePage from './pages/FuturePage';
import OntologyWorkspace from './pages/OntologyWorkspace';
import BusinessRules from './pages/BusinessRules';
import ObjectExplorer from './pages/ObjectExplorer';
import AIBuilder from './pages/AIBuilder';
import EnterpriseResources from './pages/EnterpriseResources';
import AgentRuntime from './pages/AgentRuntime';
import ScenarioStudio from './pages/ScenarioStudio';
import DataMappingStudio from './pages/DataMappingStudio';
import DomainHierarchy from './pages/DomainHierarchy';
import Interfaces from './pages/Interfaces';
import BuildChat from './pages/BuildChat';
import AssistantPage from './assistant/AssistantPage';
import AssistantDock from './assistant/AssistantDock';
import { AssistantProvider } from './assistant/AssistantContext';
import './assistant/assistant.css';
import CreateOntologyWizard from './components/CreateOntologyWizard';
import ModelingEntry, { ModelingEntryContext } from './components/ModelingEntry';
import { launchBuild } from './buildConversation';
import { historyReturnUrl } from './historyNavigation';

const MAIN_NAV = [
  { label: '智能问答', icon: MessageSquareText },
  { label: '知识库', icon: BookOpen },
  { label: '本体中心', icon: Waypoints, active: true },
  { label: '报告', icon: FileText, children: ['报告中心', '模板管理'] },
  { label: '工作流', icon: Workflow, children: ['发布管理', '流程编排', '流程日志'] },
  { label: '调度中心', icon: ClipboardList, children: ['作业调度', '执行日志'] },
  { label: '系统', icon: Settings, children: ['表单模板', '用户与权限', '系统配置'] },
];

const ONTOLOGY_NAV = [
  { id: 'workbench', label: '工作区', items: [
    { to: '/ontology/ai', label: '本体智能', icon: Sparkles },
    { to: '/ontology/overview', label: '本体工作台', icon: Library },
    { to: '/ontology/graph', label: '本体图谱', icon: Network },
    { to: '/ontology/scenarios', label: '业务场景', icon: Workflow },
  ] },
  { id: 'model', label: '本体模型', items: [
    { to: '/ontology/model/domains', label: '业务主题', icon: Building2 },
    { to: '/ontology/model/object-types', label: '对象类型', icon: Boxes },
    { to: '/ontology/model/object-properties', label: '对象属性', icon: ListTree, child: true },
    { to: '/ontology/model/link-types', label: '关系类型', icon: GitBranch },
    { to: '/ontology/model/actions', label: '动作类型', icon: Hammer },
    { to: '/ontology/logic/definitions', label: '规则', icon: ListChecks },
    { to: '/ontology/model/interfaces', label: '接口', icon: Layers3 },
    { to: '/ontology/model/dictionaries', label: '字典管理', icon: ClipboardList },
  ] },
  { id: 'data', label: '数据与映射', items: [
    { to: '/ontology/data/sources', label: '数据源', icon: Database },
    { to: '/ontology/data/mappings', label: '数据映射', icon: TableProperties },
    { to: '/ontology/data/mapping-graph', label: '映射图谱', icon: Network },
    { to: '/ontology/data/instances', label: '对象探索', icon: Library },
  ] },
  { id: 'logic', label: '运行能力', items: [
    { to: '/ontology/logic/execution', label: '系统能力与执行映射', icon: Workflow },
    { to: '/ontology/agent', label: '本体智能体', icon: Bot },
  ] },
  { id: 'govern', label: '变更与发布', items: [
    { to: '/ontology/governance/quality', label: '本体质检', icon: ListChecks },
    { to: '/ontology/governance/compare', label: '本体对比', icon: GitBranch },
    { to: '/ontology/governance', label: '版本与发布', icon: Check },
    { to: '/ontology/governance/activity', label: '变更记录', icon: History },
    { to: '/ontology/governance/security', label: '权限策略', icon: ShieldCheck },
  ] },
];

const TITLES = {
  '/ontology/ai': ['本体智能', '选中页面资源，让 AI 解释、检查或起草修改'],
  '/ontology/overview': ['本体工作台', '发现本体并进入具体业务语义空间'],
  '/ontology/scenarios': ['业务场景', '用真实业务闭环校验本体覆盖度'],
  '/ontology/model/domains': ['业务主题', '用业务域和主题域两级分类组织对象类型'],
  '/ontology/model/object-types': ['对象类型', '管理可识别、可关联、可产生实例的业务对象'],
  '/ontology/model/object-properties': ['对象属性', '汇总查看全部对象类型的属性定义与映射情况'],
  '/ontology/model/interfaces': ['接口', '单独管理跨对象类型的统一属性契约'],
  '/ontology/model/link-types': ['关系类型', '手工维护对象之间的业务关系、方向与基数'],
  '/ontology/model/dictionaries': ['字典管理', '维护全局共享的建模选项'],
  '/ontology/model/actions': ['动作类型', '定义对象允许执行的业务动作契约'],
  '/ontology/graph': ['本体图谱', '从全局查看并直接维护对象与关系组成的语义网络'],
  '/ontology/data/instances': ['对象探索', '从对象类型出发，探索对象集并查看对象视图'],
  '/ontology/data/sources': ['数据源', '登记业务系统与物理来源，采集表结构'],
  '/ontology/data/mappings': ['数据映射', '把物理字段直接映射到本体对象属性或关系'],
  '/ontology/data/mapping-graph': ['映射图谱', '从物理表到对象类型、再到表字段到对象属性的可探索映射网络'],
  '/ontology/data/connections': ['数据源', '登记业务系统与物理来源，采集表结构'],
  '/ontology/logic/definitions': ['规则', '管理确定性业务逻辑并作为智能体工具复用'],
  '/ontology/logic/execution': ['系统能力与执行映射', '把本体动作受控绑定到企业系统接口与操作能力'],
  '/ontology/governance/security': ['权限策略', '统一治理对象、属性和动作访问边界'],
  '/ontology/agent': ['本体智能体', '让智能体基于对象、关系、规则和动作工作'],
  '/ontology/governance': ['版本与发布', '评审当前变更并发布正式版本'],
  '/ontology/governance/activity': ['变更记录', '查看当前本体的资源操作历史'],
  '/ontology/governance/quality': ['本体质检', '在语义层建模后运行检查并形成报告'],
  '/ontology/governance/compare': ['本体对比', '直接比较基线与副本，定位语义漂移'],
};

function PlatformSidebar({ collapsed, onToggle, onLogout }) {
  const navigate = useNavigate();
  const isChat = useLocation().pathname === '/chat';
  const [expanded, setExpanded] = useState({});
  const [userOpen, setUserOpen] = useState(false);
  return <aside className="platform-main-sidebar">
    <div className="platform-sidebar-brand">
      {collapsed
        ? <button className="brand-logo collapsed" onClick={onToggle} title="展开平台导航"><Waypoints size={19} /></button>
        : <><span className="brand-logo"><Waypoints size={19} /></span><span className="brand-copy"><b>本体技能开发</b><small>企业语义与行动层</small></span><button className="brand-collapse" onClick={onToggle} title="收起平台导航"><ChevronLeft size={16} /></button></>}
    </div>
    <nav>{MAIN_NAV.map((item) => <div className="platform-main-group" key={item.label}>
      <button className={`platform-main-item ${(isChat ? item.label === '智能问答' : item.active) ? 'active' : ''}`} title={collapsed ? item.label : undefined} onClick={() => item.label === '智能问答' ? navigate('/chat') : item.label === '本体中心' ? navigate('/ontology/overview') : item.children && setExpanded((old) => ({ ...old, [item.label]: !old[item.label] }))}><item.icon size={17} /><span>{item.label}</span>{item.children && <ChevronDown size={14} className={expanded[item.label] ? 'open' : ''} />}</button>
      {!collapsed && item.children && expanded[item.label] && <div className="platform-main-children">{item.children.map((child) => <button key={child}>{child}</button>)}</div>}
    </div>)}</nav>
    <div className="platform-user-footer">
      <button className={`platform-user-card ${userOpen ? 'open' : ''}`} onClick={() => setUserOpen((value) => !value)} title="账号与退出">
        <span className="platform-user-avatar">A</span>
        {!collapsed && <span className="platform-user-copy"><b>admin</b><small>系统管理员</small></span>}
        {!collapsed && <MoreHorizontal size={16} />}
      </button>
      {userOpen && <>
        <div className="platform-user-backdrop" onClick={() => setUserOpen(false)} />
        <div className={`platform-user-menu ${collapsed ? 'collapsed' : ''}`} role="menu">
          <div className="platform-user-menu-head"><span className="platform-user-avatar">A</span><span><b>admin</b><small>系统管理员</small></span></div>
          <button role="menuitem" onClick={() => { setUserOpen(false); navigate('/ontology/overview'); }}><UserRound size={14} /> 个人工作台</button>
          <button role="menuitem" onClick={() => { setUserOpen(false); onLogout?.(); }}><LogOut size={14} /> 退出登录</button>
        </div>
      </>}
    </div>
  </aside>;
}

function WorkspaceTabs() {
  const isChat = useLocation().pathname === '/chat';
  return <div className="workspace-tabs"><NavLink to="/chat" className={`workspace-tab ${isChat ? 'active' : 'muted'}`}>智能问答</NavLink><div className="workspace-tab muted">知识库</div><NavLink to="/ontology/overview" className={`workspace-tab ${isChat ? 'muted' : 'active'}`}>本体中心</NavLink></div>;
}

function OntologySidebar({ collapsed, onToggle, activeId, active, onOpenSwitcher, onCreate, changeCount = 0 }) {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState({ workbench: true, model: true, data: true, logic: true, govern: true, agent: true });
  return <aside className="platform-ontology-sidebar">
    <div className="ontology-side-header">
      {!collapsed && <div><h2>本体中心</h2><span>企业语义与行动层</span></div>}
      <div className="ontology-side-actions">{!collapsed && <button className="round-add" onClick={onCreate} title="新建本体"><Plus size={16} /></button>}<button className="ontology-collapse" onClick={onToggle}>{collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button></div>
    </div>
    <div className="platform-ontology-picker">
      {collapsed ? <button className="compact-ontology" title={`切换本体：${active?.name || '未选择'}`} onClick={onOpenSwitcher}>{active?.name?.slice(0, 1) || '本'}</button> : <><label>建模上下文</label><button className="ontology-picker-trigger" onClick={onOpenSwitcher}><i><Waypoints size={16} /></i><span><b>{active?.name || '选择本体'}</b><code>{active?.namespace || '尚未选择'}</code></span><ChevronRight size={15} /></button></>}
    </div>
    {!collapsed && <label className="platform-side-search"><Menu size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索建模功能" /></label>}
    <nav className="ontology-tree">{ONTOLOGY_NAV.map((group) => {
      const items = group.items.filter((item) => !query || item.label.toLowerCase().includes(query.toLowerCase()));
      if (!items.length) return null;
      const open = collapsed || query || expanded[group.id];
      return <section key={group.id} className="ontology-tree-section">
        {!collapsed && <button className="ontology-tree-group" onClick={() => setExpanded((old) => ({ ...old, [group.id]: !old[group.id] }))}><span>{group.label}</span>{group.id === 'govern' && changeCount > 0 && <i className="ontology-group-notice-dot" title={`当前有 ${changeCount} 条未读变更记录`} />}<ChevronDown size={13} className={open ? 'open' : ''} /></button>}
        {open && items.map((item) => {
          const isWorkbench = item.to === '/ontology/overview';
          const to = isWorkbench && activeId ? `/ontology/overview/${activeId}` : item.to;
          const unread = item.to === '/ontology/governance/activity' && changeCount > 0;
          return <NavLink key={item.to} to={to} end title={collapsed ? item.label : unread ? `${item.label}：${changeCount} 条未读变更记录` : undefined} className={({ isActive }) => `ontology-tree-item ${item.child ? 'child' : ''} ${unread ? 'has-notice' : ''} ${(isActive || (isWorkbench && location.pathname.startsWith('/ontology/overview'))) ? 'active' : ''}`}><item.icon size={17} /><span>{item.label}</span>{unread && <em className="ontology-notice-badge" aria-label={`${changeCount} 条未读变更记录`}>{changeCount > 99 ? '99+' : changeCount}</em>}</NavLink>;
        })}
      </section>;
    })}</nav>
    <div className="platform-health"><Activity size={15} /><span>{collapsed ? '' : '本体服务与变更提案治理正常'}</span></div>
  </aside>;
}

function OntologySwitchDialog({ ontologies, activeId, onChoose, onClose, onCreate, onShowDirectory }) {
  const [query, setQuery] = useState('');
  const matches = ontologies.filter((item) => `${item.name} ${item.namespace} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase()));
  return <Modal title="切换建模本体" subtitle="选择后，当前页面将切换到对应业务语义空间" onClose={onClose} footer={<><button className="btn secondary" onClick={onShowDirectory}><Library size={15} /> 返回本体工作台</button><button className="btn primary" onClick={onCreate}><Plus size={15} /> 新建本体</button></>}>
    <label className="ontology-switch-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、命名空间或说明" /></label>
    <div className="ontology-switch-list">{matches.map((item) => <button key={item.id} className={item.id === activeId ? 'selected' : ''} onClick={() => onChoose(item.id)}><i>{item.name.slice(0, 1)}</i><span><b>{item.name}</b><code>{item.namespace}</code><small>{item.object_type_count} 个对象 · {item.link_type_count} 个关系 · {item.business_rule_count || 0} 条规则 · {item.instance_count || 0} 条实例</small></span>{item.id === activeId ? <em><Check size={13} /> 当前</em> : <ChevronRight size={15} />}</button>)}{!matches.length && <p>没有匹配的本体</p>}</div>
  </Modal>;
}

function ResourceContextBar({ active, title, onBack, onSwitch }) {
  return <section className="resource-context-bar">
    <button onClick={onBack}><ArrowLeft size={15} /> 返回本体概览</button>
    <div><Waypoints size={15} /><span>本体工作台</span><ChevronRight size={12} /><strong>{active.name}</strong><ChevronRight size={12} /><b>{title}</b></div>
    <button onClick={onSwitch}>切换本体 <ChevronDown size={14} /></button>
  </section>;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const isChat = location.pathname === '/chat';
  const isCompareWorkspace = location.pathname === '/ontology/governance/compare';
  const initialCompact = () => typeof window !== 'undefined' && window.innerWidth < 1500;
  const [mainCollapsed, setMainCollapsed] = useState(initialCompact);
  const [ontologyCollapsed, setOntologyCollapsed] = useState(initialCompact);
  const [ontologies, setOntologies] = useState([]);
  const [activeId, setActiveId] = useState(localStorage.getItem('manual-ontology-id') || '');
  const [createOpen, setCreateOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [modelingEntry, setModelingEntry] = useState(null);
  const [message, setMessage] = useState('');
  const [changeCount, setChangeCount] = useState(0);
  const [badgeRevision, setBadgeRevision] = useState(0);

  const refreshOntologies = async (preferredId) => {
    const items = await api('/api/ontologies');
    setOntologies(items);
    const nextId = preferredId || (items.some((item) => item.id === activeId) ? activeId : items[0]?.id || '');
    setActiveId(nextId);
    if (nextId) localStorage.setItem('manual-ontology-id', nextId);
    setBadgeRevision((value) => value + 1);
    return items;
  };
  useEffect(() => { refreshOntologies().catch((error) => setMessage(error.message)); }, []);
  useEffect(() => {
    const resize = () => { if (window.innerWidth < 1180) { setMainCollapsed(true); setOntologyCollapsed(true); } };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!activeId) { setChangeCount(0); return undefined; }
    const seenKey = `change-log-seen:${activeId}`;
    let cancelled = false;
    const loadBadge = async () => {
      try {
        const result = await api(`/api/ontologies/${activeId}/model-changes?pending=1&page=1&page_size=100`);
        if (cancelled) return;
        const items = result.items || [];
        const latest = items.reduce((value, item) => {
          const stamp = Date.parse(item.mvc_created_at) || 0;
          return stamp > value.stamp ? { stamp, iso: item.mvc_created_at } : value;
        }, { stamp: 0, iso: '' });
        if (location.pathname === '/ontology/governance/activity') {
          if (latest.iso) { try { localStorage.setItem(seenKey, latest.iso); } catch { /* 忽略浏览器存储限制 */ } }
          setChangeCount(0);
          return;
        }
        let seenAt = '';
        try { seenAt = localStorage.getItem(seenKey) || ''; } catch { /* 忽略浏览器存储限制 */ }
        const seenStamp = Date.parse(seenAt) || 0;
        if (!seenStamp) {
          setChangeCount(Number(result.total) || items.length);
          return;
        }
        setChangeCount(items.filter((item) => (Date.parse(item.mvc_created_at) || 0) > seenStamp).length);
      } catch { /* 徽标失败不阻塞主流程 */ }
    };
    loadBadge();
    const timer = window.setInterval(loadBadge, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeId, location.pathname, badgeRevision]);

  const active = useMemo(() => ontologies.find((item) => item.id === activeId), [ontologies, activeId]);
  const title = isChat ? ['智能问答', '本体建模助手'] : TITLES[location.pathname] || TITLES['/ontology/overview'];
  useEffect(() => { document.title = `${title[0]} · 本体建模`; }, [title]);
  const chooseOntology = (id) => {
    setActiveId(id);
    if (id) localStorage.setItem('manual-ontology-id', id);
    if (location.pathname.startsWith('/ontology/overview/')) navigate(`/ontology/overview/${id}`);
  };
  const completeCreate = async (created, method) => {
    created = { object_type_count: 0, link_type_count: 0, action_count: 0, business_rule_count: 0, interface_count: 0, business_domain_count: 0, subject_domain_count: 0, instance_count: 0, scenario_count: 0, data_mapping_count: 0, logic_definition_count: 0, ...created };
    setOntologies((old) => [created, ...old.filter((item) => item.id !== created.id)]);
    setActiveId(created.id);
    try { localStorage.setItem('manual-ontology-id', created.id); } catch { setMessage('本体已创建，浏览器未能保存当前本体偏好。'); }
    setCreateOpen(false);
    if (method === 'smart') {
      const task = launchBuild(navigate, { mode: 'update', purpose: 'initialize', ontology: created }, setMessage);
      if (!task) navigate(`/ontology/overview/${created.id}`);
    } else navigate(`/ontology/overview/${created.id}`);
  };
  const entries = {
    requestResource: (options = {}) => setModelingEntry({ intent: 'create_resource', ontology: active, objectCount: active?.object_type_count || 0, ...options }),
    requestUpdate: (options = {}) => setModelingEntry({ intent: 'update', ontology: active, objectCount: active?.object_type_count || 0, ...options }),
  };
  const continueModeling = (entry) => {
    if (entry.method === 'resume') {
      setModelingEntry(null); navigate(`/chat?task=${encodeURIComponent(entry.taskId)}`);
    } else if (entry.method === 'smart') {
      const task = launchBuild(navigate, { mode: 'update', purpose: entry.intent === 'update' ? 'update_resource' : 'create_resource', resourceType: entry.type, ontology: entry.ontology, resource: entry.resource, returnTo: entry.returnTo || `/ontology/overview/${entry.ontology.id}` }, setMessage);
      if (task) setModelingEntry(null);
    } else {
      setModelingEntry(null);
      if (entry.onManual && entry.type === modelingEntry.type && !entry.destination.prerequisite && !entry.destination.governance) entry.onManual();
      else navigate(entry.destination.route);
    }
  };
  useEffect(() => { setModelingEntry(null); }, [location.pathname, activeId]);
  const pageProps = { activeId, active, refreshOntologies, chooseOntology, notify: setMessage };

  return <AssistantProvider activeId={activeId} active={active} notify={setMessage}><ModelingEntryContext.Provider value={entries}><div className={`platform-shell ${isChat ? 'chat-workspace' : ''} ${mainCollapsed ? 'main-collapsed' : ''} ${ontologyCollapsed ? 'ontology-collapsed' : ''}`}>
    <PlatformSidebar collapsed={mainCollapsed} onToggle={() => setMainCollapsed((value) => !value)} onLogout={() => setMessage('原型演示环境，暂不执行真实退出；账号入口已移到左下角。')} />
    <div className="workspace-area"><WorkspaceTabs /><div className="workspace-body">
      {!isChat && !isCompareWorkspace && <OntologySidebar collapsed={ontologyCollapsed} onToggle={() => setOntologyCollapsed((value) => !value)} activeId={activeId} active={active} onOpenSwitcher={() => setSwitchOpen(true)} onCreate={() => setCreateOpen(true)} changeCount={changeCount} />}
      <main className="page-stage" aria-label={`${title[0]}：${title[1]}`}>
        {!isChat && !location.pathname.startsWith('/ontology/overview') && new URLSearchParams(location.search).get('guide') === '1' && <section className="modeling-next-step"><span>手动建模</span><div><b>{title[0]}</b><p>按表单保存后，返回工作台继续下一步；未保存的内容不会自动提交。</p></div><button className="bc-button" onClick={() => navigate(`/ontology/overview/${activeId}?guide=1`)}>返回工作台，继续下一步 <ChevronRight size={14} /></button></section>}
        {!isChat && new URLSearchParams(location.search).get('from_history') === '1' && <section className="history-return-bar"><span><History size={15} /> 正在查看变更记录关联的资源</span><button type="button" onClick={() => navigate(historyReturnUrl(location.search))}><ArrowLeft size={14} /> 返回这条变更记录</button></section>}
        <div className="studio-content">{!activeId && ontologies.length === 0 && !isChat && !location.pathname.startsWith('/ontology/build') ? <div className="welcome-empty"><Waypoints size={44} /><h2>从第一个本体开始</h2><p>创建业务语义空间，再定义对象、关系和业务动作。</p><button className="btn primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> 新建本体</button></div> : <Routes>
          <Route path="/chat" element={<BuildChat {...pageProps} ontologies={ontologies} onCreate={() => setCreateOpen(true)} />} />
          <Route path="/ontology/all" element={<Navigate to="/ontology/overview" replace />} />
          <Route path="/ontology/ai" element={<AssistantPage />} />
          <Route path="/ontology/overview" element={<OntologyWorkspace {...pageProps} ontologies={ontologies} onCreate={() => setCreateOpen(true)} />} />
          <Route path="/ontology/overview/:ontologyId" element={<OntologyWorkspace {...pageProps} ontologies={ontologies} onCreate={() => setCreateOpen(true)} />} />
          <Route path="/ontology/model/object-types" element={<ObjectTypes {...pageProps} />} />
          <Route path="/ontology/model/object-properties" element={<ObjectProperties {...pageProps} />} />
          <Route path="/ontology/model/domains" element={<DomainHierarchy {...pageProps} />} />
          <Route path="/ontology/build" element={<Navigate to={activeId ? `/ontology/overview/${activeId}` : '/ontology/overview'} replace />} />
          <Route path="/ontology/build/legacy" element={<AIBuilder {...pageProps} ontologies={ontologies} />} />
          <Route path="/ontology/scenarios" element={<ScenarioStudio {...pageProps} />} />
          <Route path="/ontology/model/link-types" element={<LinkTypes {...pageProps} />} />
          <Route path="/ontology/model/dictionaries" element={<DictionaryManagement {...pageProps} />} />
          <Route path="/ontology/model/actions" element={<Actions {...pageProps} />} />
          <Route path="/ontology/model/business-rules" element={<BusinessRules {...pageProps} />} />
          <Route path="/ontology/model/interfaces" element={<Interfaces {...pageProps} />} />
          <Route path="/ontology/graph" element={<GraphPage {...pageProps} />} />
          <Route path="/ontology/data/instances" element={<ObjectExplorer {...pageProps} />} />
          <Route path="/ontology/data/sources" element={<DataMappingStudio mode="sources" {...pageProps} />} />
          <Route path="/ontology/data/mappings" element={<DataMappingStudio mode="mappings" {...pageProps} />} />
          <Route path="/ontology/data/mapping-graph" element={<DataMappingStudio mode="graph" {...pageProps} />} />
          <Route path="/ontology/data/connections" element={<Navigate to="/ontology/data/sources" replace />} />
          <Route path="/ontology/logic/definitions" element={<BusinessRules {...pageProps} />} />
          <Route path="/ontology/logic/execution" element={<EnterpriseResources view="execution" {...pageProps} />} />
          <Route path="/ontology/governance/security" element={<EnterpriseResources view="security" {...pageProps} />} />
          <Route path="/ontology/governance/quality" element={<OntologyQuality {...pageProps} />} />
          <Route path="/ontology/governance/compare" element={<VersionCompare {...pageProps} />} />
          <Route path="/ontology/governance/versions" element={<Navigate to="/ontology/governance" replace />} />
          <Route path="/ontology/governance/releases/:releaseId" element={<ReleaseSnapshot {...pageProps} />} />
          <Route path="/ontology/governance/activity" element={<ActivityLog {...pageProps} />} />
          <Route path="/ontology/agent" element={<AgentRuntime {...pageProps} />} />
          <Route path="/ontology/governance" element={<Governance {...pageProps} />} />
          <Route path="*" element={<Navigate to="/ontology/overview" replace />} />
        </Routes>}</div>
      </main>
    </div></div>
    {message && <div className="toast" onClick={() => setMessage('')}>{message}</div>}
    {switchOpen && <OntologySwitchDialog ontologies={ontologies} activeId={activeId} onClose={() => setSwitchOpen(false)} onChoose={(id) => { chooseOntology(id); setSwitchOpen(false); }} onShowDirectory={() => { setSwitchOpen(false); navigate('/ontology/overview'); }} onCreate={() => { setSwitchOpen(false); setCreateOpen(true); }} />}
    {createOpen && <CreateOntologyWizard ontologies={ontologies} onClose={() => setCreateOpen(false)} onCreated={completeCreate} />}
    {modelingEntry && <ModelingEntry entry={modelingEntry} onClose={() => setModelingEntry(null)} onContinue={continueModeling} />}
    <AssistantDock />
  </div></ModelingEntryContext.Provider></AssistantProvider>;
}
