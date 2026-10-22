import { useEffect, useRef } from 'react';
import { Bot, LoaderCircle, Scan, Send, User } from 'lucide-react';
import { useAssistant } from './AssistantContext';
import { RESOURCE_TYPE_LABELS, quickActions } from './selection';

export default function AssistantChat({ compact = false, showPicker = true }) {
  const assistant = useAssistant();
  const scrollRef = useRef(null);
  const { messages, busy, input, items } = assistant;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const actions = items.length ? quickActions(items) : [];
  const pickLabel = assistant.picking
    ? '选择中 · Esc 退出'
    : items.length
      ? '继续选择'
      : '选择资源';

  return <div className={`assistant-chat ${compact ? 'compact' : ''}`}>
    <div className="assistant-messages" ref={scrollRef}>
      {messages.map((message, index) => <article key={index} className={`assistant-msg ${message.role}`}>
        <i className="assistant-avatar">{message.role === 'assistant' ? <Bot size={15} /> : <User size={15} />}</i>
        <div className={`assistant-bubble ${message.error ? 'error' : ''}`}>
          <p>{message.text}</p>
          {message.trace?.length > 0 && <details className="assistant-trace">
            <summary>本体工具轨迹 · {message.trace.length} 步</summary>
            {message.trace.map((step, stepIndex) => <div key={stepIndex}>
              <em>{stepIndex + 1}</em>
              <b>{step.label}</b>
              <small>{step.result}</small>
            </div>)}
          </details>}
          {message.runMode && <small className="assistant-runmode">{message.runMode === 'deepseek' ? 'DeepSeek 运行' : '演示降级模式'}</small>}
        </div>
      </article>)}
      {busy && <article className="assistant-msg assistant">
        <i className="assistant-avatar"><Bot size={15} /></i>
        <div className="assistant-bubble thinking"><LoaderCircle className="spin" size={14} /> 正在读取选中资源与本体上下文…</div>
      </article>}
    </div>

    {items.length > 0 && <div className="assistant-selection">
      <div className="assistant-chips">
        {items.slice(0, 3).map((item) => <span className="assistant-chip" key={item.key}>
          <i>{RESOURCE_TYPE_LABELS[item.type] || '资源'}</i>
          <b title={item.parent ? `${item.label} · 所属 ${item.parent}` : item.label}>{item.label}</b>
          {item.parent && <small>{item.parent}</small>}
          <button type="button" onClick={() => assistant.remove(item)} aria-label={`移除 ${item.label}`}>×</button>
        </span>)}
        {items.length > 3 && <span className="assistant-chip more">+{items.length - 3}</span>}
        <button type="button" className="assistant-chip-clear" onClick={assistant.clear}>清空</button>
      </div>
      {actions.length > 0 && <div className="assistant-quick">
        {actions.map((action) => <button type="button" key={action.label} onClick={() => assistant.send(action.prompt)}>{action.label}</button>)}
      </div>}
    </div>}

    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); assistant.send(); }}>
      <textarea
        value={input}
        rows={2}
        placeholder={items.length ? '已选资源，想让我做什么？' : '问当前本体，或先选择页面上的资源…'}
        onChange={(event) => assistant.setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            assistant.send();
          }
        }}
      />
      <div className="assistant-composer-bar">
        {showPicker && <button
          type="button"
          className={`assistant-pick-btn ${assistant.picking ? 'active' : ''} ${items.length ? 'has-items' : ''}`}
          onClick={assistant.togglePicking}
          title="从页面选择对象、属性或关系"
        >
          <Scan size={15} /> {pickLabel}
        </button>}
        <span className="assistant-hint">Enter 发送 · Shift + Enter 换行</span>
        <button type="submit" className="assistant-send" disabled={!input.trim() || busy} aria-label="发送">
          <Send size={15} />
        </button>
      </div>
    </form>
  </div>;
}
