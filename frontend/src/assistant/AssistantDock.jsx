import { useEffect, useMemo, useState } from 'react';
import { Bot, History, LoaderCircle, Maximize2, Plus, Scan, Search, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { api, formatTime } from '../api';
import AssistantChat from './AssistantChat';
import { useAssistant } from './AssistantContext';

const historyGroup = (value) => {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '更早';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= today) return '今天';
  if (time >= today - 6 * 86_400_000) return '近 7 天';
  return '更早';
};

export default function AssistantDock() {
  const assistant = useAssistant();
  const { pathname } = useLocation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!assistant.open) { setHistoryOpen(false); return; }
    setHistoryOpen(false);
  }, [assistant.open]);

  useEffect(() => {
    if (!historyOpen || !assistant.activeId) return;
    let cancelled = false;
    setHistoryLoading(true);
    api(`/api/ontologies/${assistant.activeId}/agent/history?limit=100`)
      .then((result) => {
        if (cancelled) return;
        setConversations((result.conversations || [])
          .filter((conversation) => conversation.mode === 'assistant')
          .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()));
      })
      .catch(() => { if (!cancelled) setConversations([]); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [historyOpen, assistant.activeId, assistant.revision]);

  const filtered = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    return conversations.filter((conversation) => !needle
      || `${conversation.title || ''} ${conversation.messages?.[0]?.text || ''}`.toLowerCase().includes(needle));
  }, [conversations, historyQuery]);
  const groups = useMemo(() => {
    const buckets = new Map([['今天', []], ['近 7 天', []], ['更早', []]]);
    filtered.forEach((conversation) => buckets.get(historyGroup(conversation.updated_at))?.push(conversation));
    return [...buckets.entries()].filter(([, items]) => items.length);
  }, [filtered]);

  if (pathname === '/ontology/ai') return null;

  if (assistant.picking) {
    return <div className="assistant-pick-banner" role="status">
      <Scan size={15} />
      <span>选择模式：点击页面上的对象、属性或关系</span>
      <b>{assistant.items.length} 项</b>
      <button type="button" onClick={assistant.stopPicking}>完成选择</button>
    </div>;
  }

  if (!assistant.open) {
    return <button type="button" className="assistant-fab" onClick={assistant.openAssistant} title="打开本体智能">
      <Bot size={22} />
      {assistant.items.length > 0 && <em>{assistant.items.length}</em>}
    </button>;
  }

  const startNew = () => {
    if (assistant.busy) return;
    assistant.newConversation();
    setHistoryOpen(false);
  };
  const openConversation = (conversation) => {
    if (assistant.busy) return;
    assistant.loadConversation(conversation);
    setHistoryOpen(false);
  };

  return <section className="assistant-panel" aria-label="本体智能">
    <header className="assistant-panel-head">
      <div>
        <i><Bot size={16} /></i>
        <span><b>本体智能</b><small>{assistant.active?.name || '未选择本体'}{assistant.sessionLabel ? ` · ${assistant.sessionLabel}` : ''}</small></span>
      </div>
      <div className="assistant-panel-actions">
        <button type="button" onClick={() => { setHistoryOpen((value) => !value); }} title="历史对话" aria-label="历史对话" disabled={assistant.busy}><History size={15} /></button>
        <button type="button" onClick={startNew} title="新建对话" aria-label="新建对话" disabled={assistant.busy}><Plus size={15} /></button>
        <button type="button" onClick={assistant.expand} title="最大化"><Maximize2 size={15} /></button>
        <button type="button" onClick={() => assistant.setOpen(false)} title="收起"><X size={16} /></button>
      </div>
    </header>

    {historyOpen && <div className="assistant-dock-history">
      <header><div><History size={16} /><strong>历史对话</strong><span>{conversations.length}</span></div><button type="button" onClick={() => setHistoryOpen(false)} aria-label="关闭历史对话"><X size={15} /></button></header>
      <label className="assistant-dock-history-search"><Search size={14} /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索历史对话" autoFocus /></label>
      <div className="assistant-dock-history-list">
        {historyLoading ? <p className="assistant-dock-history-state"><LoaderCircle className="spin" size={15} /> 正在加载…</p> : groups.length ? groups.map(([label, items]) => <section key={label}>
          <h4>{label}</h4>
          {items.map((conversation) => <button type="button" key={conversation.id} className={conversation.id === assistant.conversationId ? 'active' : ''} onClick={() => openConversation(conversation)}>
            <span><b>{conversation.title || '未命名对话'}</b><small>{formatTime(conversation.updated_at)} · {conversation.message_count || 0} 条消息</small></span>
            <em>{conversation.id === assistant.conversationId ? '当前' : '继续'}</em>
          </button>)}
        </section>) : <p className="assistant-dock-history-state"><History size={18} /> 还没有历史对话</p>}
      </div>
      <footer><button type="button" onClick={startNew} disabled={assistant.busy}><Plus size={14} /> 新建对话</button></footer>
    </div>}

    {assistant.hydrating ? <div className="assistant-dock-loading"><LoaderCircle className="spin" size={18} /><span>正在恢复最近对话…</span></div> : <AssistantChat compact />}
  </section>;
}
