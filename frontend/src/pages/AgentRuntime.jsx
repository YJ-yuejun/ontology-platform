import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, Bot, Boxes, Check, CheckCircle2, ChevronRight, ChevronUp, CircleAlert, Database, GitBranch,
  Globe2, Hammer, History, Info, ListChecks, LoaderCircle, LockKeyhole, MessageSquareText, Plus, Search,
  ShieldCheck, Sparkles, User, X,
} from 'lucide-react';
import { api, formatTime } from '../api';

const MODEL_LABEL = 'DeepSeek V4 Flash';
const MAX_CHARS = 8000;
const STARTERS = [
  '这个本体包含哪些核心业务对象？',
  '解释选中资源的业务定义与映射状态',
  '哪些对象还没有完成属性映射？',
  '为本体生成一份业务域与主题域概览',
];
const RESOURCE_TABS = [
  { type: 'object_type', label: '对象类型', icon: Boxes },
  { type: 'link_type', label: '关系类型', icon: GitBranch },
  { type: 'business_rule', label: '规则', icon: ListChecks },
  { type: 'action', label: '动作', icon: Hammer },
];
const resourceMeta = Object.fromEntries(RESOURCE_TABS.map((item) => [item.type, item]));

const randomId = () => globalThis.crypto?.randomUUID?.()
  || `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function relativeTime(value) {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return formatTime(value);
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.max(1, Math.floor(diff / 86_400_000))} 天前`;
  return formatTime(value);
}

function historyGroup(value) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '更早';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= startToday) return '今天';
  if (time >= startToday - 6 * 86_400_000) return '近 7 天';
  return '更早';
}

function normalizeMessages(messages = []) {
  return messages.map((message) => message.role === 'assistant'
    ? { ...message, runMode: message.run_mode || message.runMode }
    : message);
}

export default function AgentRuntime({ activeId, active, notify }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [summary, setSummary] = useState(null);
  const [resourceSource, setResourceSource] = useState({ objects: [], links: [], rules: [], actions: [] });
  const [selectedResources, setSelectedResources] = useState([]);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [resourceTab, setResourceTab] = useState('object_type');
  const [resourceQuery, setResourceQuery] = useState('');
  const [thinking, setThinking] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [conversations, setConversations] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const scrollRef = useRef(null);

  const loadHistory = async () => {
    try {
      const result = await api(`/api/ontologies/${activeId}/agent/history?limit=100`);
      setConversations((result.conversations || []).filter((conversation) => conversation.mode !== 'assistant'));
    } catch {
      setConversations([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setMessages([]); setText(''); setBusy(false); setPendingAction(null); setSummary(null);
    setSelectedResources([]); setConversationId(''); setConversations([]); setHistoryOpen(false);
    setContextOpen(false); setResourceOpen(false); setHistoryQuery(''); setResourceQuery(''); setHistoryLoading(true);
    Promise.all([
      api(`/api/ontologies/${activeId}/overview`),
      api(`/api/ontologies/${activeId}/object-types`),
      api(`/api/ontologies/${activeId}/link-types`),
      api(`/api/ontologies/${activeId}/business-rules`),
      api(`/api/ontologies/${activeId}/actions`),
      api(`/api/ontologies/${activeId}/agent/history?limit=100`).catch(() => ({ conversations: [] })),
    ]).then(([overview, objects, links, rules, actions, history]) => {
      if (cancelled) return;
      setSummary(overview);
      setResourceSource({ objects, links, rules, actions });
      setConversations((history.conversations || []).filter((conversation) => conversation.mode !== 'assistant'));
    }).catch((error) => { if (!cancelled) notify(error.message); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pendingAction, busy]);

  const resourceGroups = useMemo(() => ({
    object_type: resourceSource.objects.map((item) => ({
      type: 'object_type', id: item.id, label: item.display_name,
      parent: item.subject_domain_name || item.business_domain_name || '未分类',
      detail: { name: item.name, core: Boolean(item.is_core) },
    })),
    link_type: resourceSource.links.map((item) => ({
      type: 'link_type', id: item.id, label: item.display_name,
      parent: `${item.source_display_name || '起点'} → ${item.target_display_name || '终点'}`,
      detail: { name: item.name },
    })),
    business_rule: resourceSource.rules.map((item) => ({
      type: 'business_rule', id: item.id, label: item.display_name,
      parent: item.category || '规则',
      detail: { name: item.name },
    })),
    action: resourceSource.actions.map((item) => ({
      type: 'action', id: item.id, label: item.display_name,
      parent: item.target_display_name || '动作',
      detail: { name: item.name },
    })),
  }), [resourceSource]);

  const selectedKeys = useMemo(() => new Set(selectedResources.map((item) => `${item.type}:${item.id}`)), [selectedResources]);
  const activeResourceItems = useMemo(() => {
    const needle = resourceQuery.trim().toLowerCase();
    return (resourceGroups[resourceTab] || []).filter((item) => !needle
      || `${item.label} ${item.parent} ${item.detail?.name || ''}`.toLowerCase().includes(needle));
  }, [resourceGroups, resourceTab, resourceQuery]);

  const filteredConversations = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    return conversations.filter((item) => !needle || `${item.title} ${item.messages?.[0]?.text || ''}`.toLowerCase().includes(needle));
  }, [conversations, historyQuery]);
  const historySections = useMemo(() => {
    const order = ['今天', '近 7 天', '更早'];
    const buckets = new Map(order.map((label) => [label, []]));
    filteredConversations.forEach((item) => buckets.get(historyGroup(item.updated_at))?.push(item));
    return order.map((label) => ({ label, items: buckets.get(label) })).filter((group) => group.items.length);
  }, [filteredConversations]);

  const charCount = text.length;
  const selectedCount = selectedResources.length;
  const toggleResource = (item) => {
    const key = `${item.type}:${item.id}`;
    setSelectedResources((old) => old.some((entry) => `${entry.type}:${entry.id}` === key)
      ? old.filter((entry) => `${entry.type}:${entry.id}` !== key)
      : [...old, item]);
  };
  const selectionPayload = (items = selectedResources) => items.map((item) => ({
    type: item.type, id: item.id, label: item.label, parent: item.parent, detail: item.detail || {},
  }));
  const openResourcePicker = () => {
    setHistoryOpen(false); setContextOpen(false); setResourceOpen((value) => !value);
  };
  const openHistory = () => {
    setResourceOpen(false); setContextOpen(false); setHistoryOpen(true);
    if (!conversations.length) loadHistory();
  };
  const openContext = () => {
    setResourceOpen(false); setHistoryOpen(false); setContextOpen(true);
  };
  const newConversation = () => {
    setMessages([]); setConversationId(''); setPendingAction(null); setText('');
    setSelectedResources([]); setHistoryOpen(false); setResourceOpen(false); setContextOpen(false);
  };

  const send = async (value = text, confirmAction = false, actionContext = null) => {
    const message = String(value || '').trim();
    if (!message || busy) return;
    const usedResources = actionContext?.resources ?? selectedResources;
    const usedThinking = actionContext ? Boolean(actionContext.thinking_mode) : thinking;
    const usedWeb = actionContext ? Boolean(actionContext.web_search) : webSearch;
    const nextConversationId = actionContext?.conversationId || conversationId || randomId();
    setBusy(true);
    if (!confirmAction) {
      setMessages((old) => [...old, {
        role: 'user', text: message, resources: selectionPayload(usedResources),
        thinking_mode: usedThinking, web_search: usedWeb,
      }]);
      setText(''); setResourceOpen(false); setSelectedResources([]);
    }
    if (!conversationId) setConversationId(nextConversationId);
    try {
      const result = await api(`/api/ontologies/${activeId}/agent/chat`, {
        method: 'POST',
        body: JSON.stringify({
          message,
          confirm_action: confirmAction,
          context: {
            conversation_id: nextConversationId,
            selection: selectionPayload(usedResources),
            thinking_mode: usedThinking,
            web_search: usedWeb,
            pending_action: actionContext || pendingAction,
          },
        }),
      });
      setMessages((old) => [...old, {
        role: 'assistant', text: result.answer, trace: result.trace,
        runMode: result.run_mode, created_at: new Date().toISOString(),
      }]);
      setPendingAction(result.action_proposal?.confirmation_required ? {
        ...result.action_proposal,
        originalMessage: message,
        conversationId: nextConversationId,
        resources: usedResources,
        thinking_mode: usedThinking,
        web_search: usedWeb,
      } : null);
      await loadHistory();
    } catch (error) {
      setMessages((old) => [...old, { role: 'assistant', text: `请求失败：${error.message}`, error: true }]);
      notify(error.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    const action = pendingAction;
    if (!action) return;
    setPendingAction(null);
    send(action.originalMessage, true, action);
  };

  const openConversation = (conversation) => {
    setConversationId(conversation.id);
    setMessages(normalizeMessages(conversation.messages || []));
    setPendingAction(null);
    setHistoryOpen(false);
    setText('');
    const lastResources = [...(conversation.messages || [])].reverse()
      .find((message) => message.role === 'user' && message.resources?.length)?.resources || [];
    setSelectedResources(lastResources.map((item) => ({ ...item, detail: item.detail || {} })));
  };

  return <div className="agent-console">
    <header className="agent-console-head">
      <div className="agent-console-identity"><i><Bot size={19} /></i><div><strong>本体智能体</strong><small><b /> {active?.name || '当前本体'} · 已连接本体工具</small></div></div>
      <div className="agent-console-actions">
        <button type="button" onClick={openHistory}><History size={15} /> 历史对话 <em>{conversations.length}</em></button>
        <button type="button" onClick={newConversation} disabled={busy}><Plus size={15} /> 新对话</button>
        <button type="button" onClick={openContext}><Info size={15} /> 运行上下文</button>
      </div>
    </header>

    <div className="agent-capability-bar">
      <span><Database size={14} /> 对象查询 <b>{summary?.stats?.object_types || 0}</b></span>
      <span><GitBranch size={14} /> 关系遍历 <b>{summary?.stats?.link_types || 0}</b></span>
      <span><ShieldCheck size={14} /> 规则执行 <b>{summary?.stats?.business_rules || 0}</b></span>
      <span><Hammer size={14} /> 动作调用 <b>{summary?.stats?.actions || 0}</b></span>
      <button type="button" onClick={openContext}><LockKeyhole size={13} /> 运行边界</button>
      <em>写操作只提出建议，确认后才执行演示</em>
    </div>

    <div className="agent-thread" ref={scrollRef}>
      <div className="agent-thread-inner">
        {!messages.length && <section className="agent-welcome">
          <i><Bot size={28} /></i>
          <h2>从本体语义出发，问业务问题</h2>
          <p>{active?.name || '当前本体'} · {summary?.stats?.object_types || 0} 个对象类型、{summary?.stats?.link_types || 0} 类关系已经挂载</p>
          <div className="agent-starter-grid">{STARTERS.map((item, index) => <button type="button" key={item} onClick={() => send(item)} disabled={busy}><span>{index + 1}</span><b>{item}</b><ChevronRight size={14} /></button>)}</div>
          <small>可以点左下角“+”，把对象、关系、规则或动作一起带入对话；选中的资源会随问题一起发送。</small>
        </section>}
        {messages.map((message, index) => <article className={`agent-thread-message ${message.role} ${message.error ? 'error' : ''}`} key={index}>
          <span className="agent-thread-avatar">{message.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}</span>
          <div className="agent-thread-body">
            {message.resources?.length > 0 && <div className="agent-thread-resources">{message.resources.map((item, resourceIndex) => {
              const MetaIcon = resourceMeta[item.type]?.icon || Boxes;
              return <span key={`${item.type}-${item.id}-${resourceIndex}`}><MetaIcon size={12} />{item.label}</span>;
            })}</div>}
            <p>{message.text}</p>
            {(message.thinking_mode || message.web_search) && <div className="agent-thread-tags">{message.thinking_mode && <span><Sparkles size={11} /> 思考模式</span>}{message.web_search && <span><Globe2 size={11} /> 联网检索</span>}</div>}
            {message.trace?.length > 0 && <details className="agent-trace"><summary>查看本体工具轨迹 · {message.trace.length} 步</summary>{message.trace.map((step, traceIndex) => <span key={traceIndex}><em>{traceIndex + 1}</em><b>{step.label}</b><small>{step.result}</small><CheckCircle2 size={13} /></span>)}</details>}
            {message.runMode && <small className="agent-run-mode">{message.runMode === 'deepseek' ? 'DeepSeek 实际运行' : '演示降级模式'}</small>}
          </div>
        </article>)}
        {busy && <article className="agent-thread-message assistant"><span className="agent-thread-avatar"><Bot size={16} /></span><div className="agent-thread-body"><p className="agent-thinking"><LoaderCircle className="spin" size={15} /> 正在读取本体资源并规划工具调用…</p></div></article>}
        {pendingAction && <section className="agent-confirmation">
          <header><CircleAlert size={18} /><div><strong>需要确认写操作</strong><span>该动作将改变业务对象或外部系统状态</span></div></header>
          <dl><div><dt>动作</dt><dd>{pendingAction.action}</dd></div><div><dt>目标对象</dt><dd>{pendingAction.target}</dd></div><div><dt>安全策略</dt><dd>确认、权限与审计</dd></div></dl>
          <p>{pendingAction.note}</p>
          <footer><button type="button" onClick={() => setPendingAction(null)}>取消</button><button type="button" onClick={confirm}><ShieldCheck size={14} /> 确认执行演示</button></footer>
        </section>}
      </div>
    </div>

    <div className="agent-chat-composer-wrap">
      <form className="agent-chat-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
        {selectedResources.length > 0 && <div className="agent-selected-resources">{selectedResources.map((item) => {
          const MetaIcon = resourceMeta[item.type]?.icon || Boxes;
          return <span className="agent-selected-chip" key={`${item.type}:${item.id}`}><MetaIcon size={12} /><b>{item.label}</b><button type="button" aria-label={`移除 ${item.label}`} onClick={() => toggleResource(item)}><X size={11} /></button></span>;
        })}</div>}
        <textarea
          aria-label="输入本体问题"
          maxLength={MAX_CHARS}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault(); send();
            }
          }}
          placeholder="输入问题，开始探索你的本体数据，输入 / 调用本体工具…"
        />
        <div className="agent-chat-composer-footer">
          <button type="button" className="agent-tool-button" onClick={openResourcePicker} title="选择本体资源" aria-label="选择本体资源"><Plus size={17} /></button>
          <button type="button" className={`agent-mode-button ${thinking ? 'active' : ''}`} onClick={() => setThinking((value) => !value)} aria-pressed={thinking}><Sparkles size={14} /> 思考模式</button>
          <button type="button" className={`agent-tool-button ${webSearch ? 'active' : ''}`} onClick={() => setWebSearch((value) => !value)} title="联网检索（演示）" aria-label="联网检索（演示）"><Globe2 size={16} /></button>
          <div className="agent-chat-composer-right">
            <button type="button" className={`agent-resource-trigger ${selectedCount ? 'has-selection' : ''}`} onClick={openResourcePicker}><Boxes size={14} /> {selectedCount ? `已选 ${selectedCount} 项资源` : '未选择本体资源'} <ChevronUp size={12} /></button>
            <span className="agent-model-chip" title="当前本体智能体模型"><Sparkles size={12} /> {MODEL_LABEL}</span>
            <span className="agent-char-count">{charCount} / {MAX_CHARS}</span>
            <button type="submit" className="agent-send-button" disabled={!text.trim() || busy} aria-label="发送"><ArrowUp size={18} /></button>
          </div>
        </div>
      </form>
    </div>

    {resourceOpen && <>
      <div className="agent-popover-backdrop" onClick={() => setResourceOpen(false)} />
      <section className="agent-resource-popover">
        <header><div><strong>选择本体资源</strong><span>可多选，发送时一起带入</span></div><button type="button" onClick={() => setSelectedResources([])} disabled={!selectedCount}>清空</button><button type="button" aria-label="关闭" onClick={() => setResourceOpen(false)}><X size={15} /></button></header>
        <nav className="agent-resource-tabs">{RESOURCE_TABS.map((tab) => <button type="button" key={tab.type} className={resourceTab === tab.type ? 'active' : ''} onClick={() => setResourceTab(tab.type)}><tab.icon size={14} /><span>{tab.label}</span><em>{resourceGroups[tab.type]?.length || 0}</em></button>)}</nav>
        <label className="agent-resource-search"><Search size={14} /><input value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder="搜索资源名称或编码" /></label>
        <div className="agent-resource-list">
          {activeResourceItems.map((item) => {
            const MetaIcon = resourceMeta[item.type]?.icon || Boxes;
            const checked = selectedKeys.has(`${item.type}:${item.id}`);
            return <button type="button" key={`${item.type}:${item.id}`} className={`agent-resource-item ${checked ? 'selected' : ''}`} onClick={() => toggleResource(item)}>
              <span className="agent-resource-icon"><MetaIcon size={15} /></span>
              <span className="agent-resource-copy"><b>{item.label}</b><small>{item.parent}{item.detail?.name ? ` · ${item.detail.name}` : ''}</small></span>
              <span className="agent-resource-check">{checked && <Check size={13} />}</span>
            </button>;
          })}
          {!activeResourceItems.length && <p className="agent-resource-empty">{resourceQuery ? '没有匹配的本体资源' : '当前没有可选择的资源'}</p>}
        </div>
        <footer><span>已选 {selectedCount} 项</span><button type="button" onClick={() => setResourceOpen(false)}>完成</button></footer>
      </section>
    </>}

    {historyOpen && <>
      <div className="agent-drawer-backdrop" onClick={() => setHistoryOpen(false)} />
      <aside className="agent-history-drawer">
        <header><div><strong>历史对话</strong><span>{conversations.length} 条</span></div><button type="button" aria-label="关闭历史对话" onClick={() => setHistoryOpen(false)}><X size={16} /></button></header>
        <label className="agent-history-search"><Search size={14} /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索历史对话" /></label>
        <div className="agent-history-scroll">
          {historyLoading ? <p className="agent-history-loading"><LoaderCircle className="spin" size={15} /> 正在加载历史对话…</p> : historySections.length ? historySections.map((group) => <section key={group.label} className="agent-history-group">
            <h4>{group.label}</h4>
            {group.items.map((conversation) => <button type="button" key={conversation.id} className={`agent-history-item ${conversation.id === conversationId ? 'active' : ''}`} onClick={() => openConversation(conversation)}>
              <span className="agent-history-icon"><MessageSquareText size={15} /></span>
              <span className="agent-history-copy"><b>{conversation.title}</b><small>{relativeTime(conversation.updated_at)} · {conversation.message_count} 条消息</small></span>
            </button>)}
          </section>) : <div className="agent-history-empty"><History size={26} /><strong>还没有历史对话</strong><p>发送第一条问题后，对话会出现在这里。</p></div>}
        </div>
        <footer><button type="button" onClick={newConversation}><Plus size={15} /> 新建对话</button></footer>
      </aside>
    </>}

    {contextOpen && <>
      <div className="agent-popover-backdrop" onClick={() => setContextOpen(false)} />
      <aside className="agent-context-popover">
        <header><strong>运行上下文</strong><button type="button" aria-label="关闭" onClick={() => setContextOpen(false)}><X size={15} /></button></header>
        <dl><div><dt>本体</dt><dd>{active?.name || '—'}</dd></div><div><dt>命名空间</dt><dd><code>{active?.namespace || '—'}</code></dd></div><div><dt>版本</dt><dd>{active?.version || '—'}</dd></div><div><dt>权限主体</dt><dd>admin · 本体管理员</dd></div></dl>
        <section><strong>可用本体工具</strong><p><Database size={13} /> 对象查询 · {summary?.stats?.object_types || 0} 个对象类型</p><p><GitBranch size={13} /> 关系遍历 · {summary?.stats?.link_types || 0} 类关系</p><p><ShieldCheck size={13} /> 规则执行 · {summary?.stats?.business_rules || 0} 条规则</p><p><Hammer size={13} /> 动作调用 · {summary?.stats?.actions || 0} 个动作</p></section>
        <section className="agent-boundary"><LockKeyhole size={15} /><strong>运行边界</strong><p>模型负责意图、解释与规划；数据查询、规则计算、权限校验和业务写入走确定性工具。写操作只在确认后执行演示并留痕。</p></section>
      </aside>
    </>}
  </div>;
}
