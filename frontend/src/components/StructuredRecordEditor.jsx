import { Plus, Trash2 } from 'lucide-react';

export function flattenRecord(record = {}, prefix = '', result = {}) {
  Object.entries(record || {}).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flattenRecord(value, path, result);
    else result[path] = value;
  });
  return result;
}

export function expandRecord(record = {}) {
  const result = {};
  Object.entries(record).forEach(([path, raw]) => {
    if (!path.trim()) return;
    let value = raw;
    if (raw === 'true') value = true;
    else if (raw === 'false') value = false;
    else if (raw !== '' && Number.isFinite(Number(raw))) value = Number(raw);
    const parts = path.split('.').filter(Boolean);
    let cursor = result;
    parts.forEach((part, index) => { if (index === parts.length - 1) cursor[part] = value; else cursor = cursor[part] ||= {}; });
  });
  return result;
}

export default function StructuredRecordEditor({ value, onChange, title = '测试数据', hint = '字段路径可使用点号，例如 payment.amount' }) {
  const entries = Object.entries(value || {});
  const replace = (index, nextKey, nextValue) => {
    const next = {};
    entries.forEach(([key, current], i) => { next[i === index ? nextKey : key] = i === index ? nextValue : current; });
    onChange(next);
  };
  const remove = (index) => onChange(Object.fromEntries(entries.filter((_, i) => i !== index)));
  const add = () => onChange({ ...value, [`field_${entries.length + 1}`]: '' });
  return <section className="structured-record-editor"><header><div><strong>{title}</strong><small>{hint}</small></div><button type="button" onClick={add}><Plus size={13} /> 添加字段</button></header><div>{entries.map(([key, current], index) => <div key={`${key}-${index}`}><input className="mono" value={key} onChange={(event) => replace(index, event.target.value, current)} placeholder="字段路径" /><input value={current ?? ''} onChange={(event) => replace(index, key, event.target.value)} placeholder="测试值" /><button type="button" onClick={() => remove(index)} title="删除"><Trash2 size={13} /></button></div>)}{!entries.length && <p>尚未添加字段。</p>}</div></section>;
}
