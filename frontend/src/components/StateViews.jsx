import { AlertCircle, Inbox } from 'lucide-react';

export function Loading() {
  return <div className="state-view"><span className="spinner" />正在读取模型…</div>;
}

export function ErrorState({ message, onRetry }) {
  return <div className="state-view error"><AlertCircle size={21} /><span>{message}</span>{onRetry && <button className="btn secondary small" onClick={onRetry}>重试</button>}</div>;
}

export function EmptyState({ title, description, action }) {
  return <div className="empty-state"><div className="empty-icon"><Inbox size={25} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}
