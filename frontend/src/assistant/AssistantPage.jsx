import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowUp, Bot, Boxes, CheckCircle2, ChevronRight, ChevronUp, Globe2, History,
  LoaderCircle, MessageSquareText, Plus, Scan, Search, ShieldCheck, Sparkles, User, X,
} from 'lucide-react';
import { api, formatTime } from '../api';
import { useAssistant } from './AssistantContext';
import { RESOURCE_TYPE_LABELS, quickActions } from './selection';

const MODEL_LABEL = 'DeepSeek V4 Flash';
const MAX_CHARS = 8000;
const STARTERS = [
  '这个本体包含哪些核心业务对象？',
  '哪些对象还没有完成属性映射？',
  '当前本体有哪些规则和动作？',
  '解释一下如何从业务主题定位对象',
];

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

export default function AssistantPage() {
  const assistant = useAssistant();
  const { active, items, messages, busy, input } = assistant;
  const [resourceOpen, setResourceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const scrollRef = useRef(null);
  const actions = items.length ? quickActions(items) : [];

  const loadHistory = async () => {
    try {
      const result = await api(`/api/ontologies/${assistant.activeId}/agent/history?limit=100`);
      setConversations((result.conversations || []).filter((conversation) => conversation.mode === 'assistant'));
    } catch {
      setConversations([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    setHistoryLoading(true);
    loadHistory();
  }, [assistant.activeId, assistant.revision]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const filteredConversations = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    return conversations.filter((conversation) => !needle
      || `${conversation.title} ${conversation.messages?.[0]?.text || ''}`.toLowerCase().includes(needle));
  }, [conversations, historyQuery]);
  const historySections = useMemo(() => {
    const order = ['今天', '近 7 天', '更早'];
    const buckets = new Map(order.map((label) => [label, []]));
    filteredConversations.forEach((conversation) => buckets.get(historyGroup(conversation.updated_at))?.push(conversation));
    return order.map((label) => ({ label, items: buckets.get(label) })).filter((group) => group.items.length);
  }, [filteredConversations]);

  const openResource = () => {
    setHistoryOpen(false);
    setResourceOpen((value) => !value);
  };
  const openHistory = () => {
    setResourceOpen(false);
    setHistoryOpen(true);
    setHistoryLoading(true);
    loadHistory();
  };
  const newConversation = () => {
    assistant.newConversation();
    setHistoryOpen(false);
    setResourceOpen(false);
  };
  const goPagePick = () => {
    setResourceOpen(false);
    assistant.collapse();
    assistant.startPicking();
  };
  const openConversation = (conversation) => {
    assistant.loadConversation(conversation);
    setHistoryOpen(false);
    setResourceOpen(false);
  };

  return <div className="agent-console">
    <header className="agent-console-head">
      <div className="agent-console-identity"><i><Bot size={19} /></i><div><strong>本体智能</strong><small><b /> {active?.name || '未选择本体'} · 选中资源后提问，或直接问当前本体</small></div></div>
      <div className="agent-console-actions">
        <button type="button" onClick={openHistory}><History size={15} /> 历史对话 <em>{conversations.length}</em></button>
        <button type="button" onClick={newConversation} disabled={busy}><Plus size={15} /> 新对话</button>
        <button type="button" onClick={assistant.collapse}><ArrowLeft size={15} /> 收起为悬浮窗</button>
      </div>
    </header>

    <div className="agent-capability-bar">
      <span><Scan size={14} /> 页面选资源</span>
      <span><Boxes size={14} /> 已选 <b>{items.length}</b> 项</span>
      <span><ShieldCheck size={14} /> 只读问答</span>
      <em>选中的对象、属性或关系会随问题一起发送；建议只生成提案，不直接改模型</em>
    </div>

    <div className="agent-thread" ref={scrollRef}>
      <div className="agent-thread-inner">
        {messages.length <= 1 ? <section className="agent-welcome">
          <i><Bot size={28} /></i>
          <h2>选中资源，或直接问当前本体</h2>
          <p>{messages[0]?.text || '我是本体智能。选中页面上的对象、属性或关系，我可以解释定义、检查口径，或起草修改建议。'}</p>
          <div className="agent-starter-grid">{STARTERS.map((item, index) => <button type="button" key={item} onClick={() => assistant.send(item)} disabled={busy}><span>{index + 1}</span><b>{item}</b><ChevronRight size={14} /></button>)}</div>
          <small>点左下角“+”打开本体资源面板；也可以先到对象属性、图谱等页面选择资源，再回来提问。</small>
        </section> : messages.map((message, index) => <article className={`agent-thread-message ${message.role} ${message.error ? 'error' : ''}`} key={index}>
          <span className="agent-thread-avatar">{message.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}</span>
          <div className="agent-thread-body">
            {message.resources?.length > 0 && <div className="agent-thread-resources">{message.resources.map((item, resourceIndex) => <span key={`${item.type}-${item.id}-${resourceIndex}`}><Boxes size={12} />{RESOURCE_TYPE_LABELS[item.type] || '资源'} · {item.label}</span>)}</div>}
            <p>{message.text}</p>
            {(message.thinking_mode || message.web_search) && <div className="agent-thread-tags">{message.thinking_mode && <span><Sparkles size={11} /> 思考模式</span>}{message.web_search && <span><Globe2 size={11} /> 联网检索</span>}</div>}
            {message.trace?.length > 0 && <details className="agent-trace"><summary>查看本体工具轨迹 · {message.trace.length} 步</summary>{message.trace.map((step, traceIndex) => <span key={traceIndex}><em>{traceIndex + 1}</em><b>{step.label}</b><small>{step.result}</small><CheckCircle2 size={13} /></span>)}</details>}
            {message.runMode && <small className="agent-run-mode">{message.runMode === 'deepseek' ? 'DeepSeek 实际运行' : '演示降级模式'}</small>}
            {message.proposal && <small className="agent-run-mode">已生成动作提案，未执行</small>}
          </div>
        </article>)}
        {busy && <article className="agent-thread-message assistant"><span className="agent-thread-avatar"><Bot size={16} /></span><div className="agent-thread-body"><p className="agent-thinking"><LoaderCircle className="spin" size={15} /> 正在读取选中资源与本体上下文…</p></div></article>}
      </div>
    </div>

    <div className="agent-chat-composer-wrap">
      {actions.length > 0 && <div className="assistant-quick-row"><span>快捷动作</span>{actions.map((action) => <button type="button" key={action.label} onClick={() => assistant.send(action.prompt)} disabled={busy}>{action.label}</button>)}</div>}
      <form className="agent-chat-composer" onSubmit={(event) => { event.preventDefault(); assistant.send(); }}>
        {items.length > 0 && <div className="agent-selected-resources">{items.map((item) => <span className="agent-selected-chip" key={item.key}><Boxes size={12} /><b>{item.label}</b><button type="button" aria-label={`移除 ${item.label}`} onClick={() => assistant.remove(item)}><X size={11} /></button></span>)}</div>}
        <textarea
          aria-label="输入本体问题"
          maxLength={MAX_CHARS}
          value={input}
          onChange={(event) => assistant.setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault(); assistant.send();
            }
          }}
          placeholder={items.length ? '已选本体资源，想让我解释、检查还是起草修改？' : '输入问题，开始探索你的本体数据，输入 / 调用本体工具…'}
        />
        <div className="agent-chat-composer-footer">
          <button type="button" className="agent-tool-button" onClick={openResource} title="选择本体资源" aria-label="选择本体资源"><Plus size={17} /></button>
          <button type="button" className={`agent-mode-button ${assistant.thinking ? 'active' : ''}`} onClick={() => assistant.setThinking((value) => !value)} aria-pressed={assistant.thinking}><Sparkles size={14} /> 思考模式</button>
          <button type="button" className={`agent-tool-button ${assistant.webSearch ? 'active' : ''}`} onClick={() => assistant.setWebSearch((value) => !value)} title="联网检索（演示）" aria-label="联网检索（演示）"><Globe2 size={16} /></button>
          <div className="agent-chat-composer-right">
            <button type="button" className={`agent-resource-trigger ${items.length ? 'has-selection' : ''}`} onClick={openResource}><Scan size={14} /> {items.length ? `已选 ${items.length} 项本体资源` : '未选择本体资源'} <ChevronUp size={12} /></button>
            <span className="agent-model-chip" title="当前本体智能模型"><Sparkles size={12} /> {MODEL_LABEL}</span>
            <span className="agent-char-count">{input.length} / {MAX_CHARS}</span>
            <button type="submit" className="agent-send-button" disabled={!input.trim() || busy} aria-label="发送"><ArrowUp size={18} /></button>
          </div>
        </div>
      </form>
    </div>

    {resourceOpen && <>
      <div className="agent-popover-backdrop" onClick={() => setResourceOpen(false)} />
      <section className="assistant-resource-popover">
        <header><div><strong>本体资源</strong><span>已选 {items.length} 项；会随问题一起发送</span></div><button type="button" aria-label="关闭" onClick={() => setResourceOpen(false)}><X size={15} /></button></header>
        <div className="assistant-resource-body">
          {items.length === 0 ? <div className="assistant-resource-empty"><Scan size={23} /><strong>还没有选择本体资源</strong><p>到对象属性、图谱等页面点选对象、属性或关系，选完会自动回到这里。</p></div> : <div className="assistant-resource-list">{items.map((item) => <div className="assistant-resource-item" key={item.key}><i>{RESOURCE_TYPE_LABELS[item.type] || '资源'}</i><span><b>{item.label}</b>{item.parent && <small>{item.parent}</small>}</span><button type="button" aria-label={`移除 ${item.label}`} onClick={() => assistant.remove(item)}><X size={12} /></button></div>)}</div>}
          <p className="assistant-resource-hint">提示：页面上的“选择资源”入口已收进这里；选择模式会暂时收起为本体智能悬浮窗。</p>
        </div>
        <footer><button type="button" className="secondary" onClick={() => assistant.clear()} disabled={!items.length}>清空</button><button type="button" className="primary" onClick={goPagePick}><Scan size={14} /> 去页面选择资源</button></footer>
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
            {group.items.map((conversation) => <button type="button" key={conversation.id} className={`agent-history-item ${conversation.id === assistant.conversationId ? 'active' : ''}`} onClick={() => openConversation(conversation)}>
              <span className="agent-history-icon"><MessageSquareText size={15} /></span>
              <span className="agent-history-copy"><b>{conversation.title}</b><small>{relativeTime(conversation.updated_at)} · {conversation.message_count} 条消息</small></span>
            </button>)}
          </section>) : <div className="agent-history-empty"><History size={26} /><strong>还没有历史对话</strong><p>发送第一条问题后，对话会出现在这里。</p></div>}
        </div>
        <footer><button type="button" onClick={newConversation}><Plus size={15} /> 新建对话</button></footer>
      </aside>
    </>}
  </div>;
}
