import { Bot, FileText, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export default function GovernanceInsightChat({
  title, intro, subtitle = '基于当前结果对话解读，不直接修改本体',
  messages, suggestions = [], onSend, busy, disabled, disabledHint,
  guide, onOpenReport, busyText = '正在整理你的问题…',
}) {
  const [draft, setDraft] = useState('');
  const stream = useRef(null);
  // 新消息或新的处理状态出现时滚到底，避免长对话里看不到最新回复
  useEffect(() => { stream.current?.scrollTo({ top: stream.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, busy]);
  const submit = (value) => {
    const message = value.trim();
    if (!message || disabled || busy) return;
    onSend(message);
    setDraft('');
  };
  return <section className="gi-chat-panel gi-full-chat">
    <header><Bot size={18} /><div><strong>{title}</strong><small>{subtitle}</small></div></header>
    {guide}
    <div ref={stream} className="gi-chat-stream" aria-live="polite">
      <div className="gi-message assistant"><span>引导</span><p>{intro}</p></div>
      {messages.map((item, index) => <div className={`gi-message ${item.role}`} key={`${index}-${item.text.slice(0, 12)}`}>
        <span>{item.role === 'user' ? '你' : item.mode === 'ai_explanation' ? 'AI 解读' : '规则解读'}</span>
        <p>{item.text}</p>
        {item.reportId && <button type="button" className="gi-chat-report-link" onClick={() => onOpenReport?.(item.reportId)}><FileText size={18} /><div><strong>{item.reportTitle || '查看报告'}</strong><small>打开右侧报告 · 关闭后可继续对话</small></div></button>}
      </div>)}
      {busy && <div className="gi-message assistant"><span>处理中</span><p>{busyText}</p></div>}
    </div>
    <div className="gi-chat-compose">
      <div className="gi-chat-suggestions">{suggestions.map((item) => <button type="button" key={item} disabled={disabled || busy} onClick={() => submit(item)}>{item}</button>)}</div>
      <form onSubmit={(event) => { event.preventDefault(); submit(draft); }}>
        <textarea value={draft} maxLength={1000} rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(draft); } }}
          disabled={disabled || busy} placeholder={disabled ? disabledHint : '说明你想检查或对比什么，也可以继续补充要求…'} aria-label="对话问题" />
        <button type="submit" disabled={disabled || busy || !draft.trim()} aria-label="发送问题"><Send size={17} /></button>
      </form>
      <small className="gi-chat-hint">Enter 发送，Shift + Enter 换行</small>
    </div>
  </section>;
}
