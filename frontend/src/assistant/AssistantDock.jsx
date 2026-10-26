import { Bot, Maximize2, Scan, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import AssistantChat from './AssistantChat';
import { useAssistant } from './AssistantContext';

export default function AssistantDock() {
  const assistant = useAssistant();
  const { pathname } = useLocation();
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
    return <button type="button" className="assistant-fab" onClick={() => assistant.setOpen(true)} title="打开本体智能">
      <Bot size={22} />
      {assistant.items.length > 0 && <em>{assistant.items.length}</em>}
    </button>;
  }

  return <section className="assistant-panel" aria-label="本体智能">
    <header className="assistant-panel-head">
      <div>
        <i><Bot size={16} /></i>
        <span><b>本体智能</b><small>{assistant.active?.name || '未选择本体'}</small></span>
      </div>
      <div className="assistant-panel-actions">
        <button type="button" onClick={assistant.expand} title="最大化"><Maximize2 size={15} /></button>
        <button type="button" onClick={() => assistant.setOpen(false)} title="收起"><X size={16} /></button>
      </div>
    </header>
    <AssistantChat compact />
  </section>;
}
