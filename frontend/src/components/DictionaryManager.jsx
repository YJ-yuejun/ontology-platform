import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api } from '../api';

const TITLES = {
  data_type: '数据类型', system_type: '系统类型', data_category: '数据类别',
  interface_type: '接口方式', mapping_way: '映射方式', action_type: '行动类型', xform_rule: '转换规则',
};
const EXTRA = { data_type: [['default', '默认值'], ['sys_dt', '系统代码']], system_type: [['contact', '联络人']] };
const BEHAVIOR_KINDS = new Set(['data_type', 'interface_type', 'mapping_way', 'action_type', 'xform_rule']);
const empty = () => ({ code: '', name: '', description: '', ordering: 0, status: 1, default: '', sys_dt: '', contact: '' });
const dictionaryCache = new Map();
const dictionaryRequests = new Map();
function loadDictionary(kind, force = false) {
  if (!force && dictionaryCache.has(kind)) return Promise.resolve(dictionaryCache.get(kind));
  if (dictionaryRequests.has(kind)) return dictionaryRequests.get(kind);
  const request = api(`/api/model-dictionaries/${kind}?include_disabled=true`)
    .then((rows) => { dictionaryCache.set(kind, rows); return rows; })
    .finally(() => dictionaryRequests.delete(kind));
  dictionaryRequests.set(kind, request);
  return request;
}

export function useModelDictionary(kind) {
  const [items, setItems] = useState(() => dictionaryCache.get(kind) || []);
  const [error, setError] = useState('');
  const fetchRows = (force = false) => loadDictionary(kind, force)
    .then((rows) => { setItems(rows); setError(''); })
    .catch((cause) => setError(cause.message));
  const refresh = () => fetchRows(true);
  useEffect(() => {
    if (!kind) return;
    fetchRows();
    const listener = (event) => { if (event.detail === kind) refresh(); };
    window.addEventListener('model-dictionary-updated', listener);
    return () => window.removeEventListener('model-dictionary-updated', listener);
  }, [kind]);
  return { items, error, refresh };
}

function signal(kind) { window.dispatchEvent(new CustomEvent('model-dictionary-updated', { detail: kind })); }

export function DictionaryItems({ kind, onCreated, compact = false }) {
  const { items, error, refresh } = useModelDictionary(kind);
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const visible = useMemo(() => items.filter((item) => `${item.name} ${item.code} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const selected = items.find((item) => item.id === selectedId) || visible[0];
  const begin = (item) => { setEditing(item || {}); setForm(item ? { ...empty(), ...item } : { ...empty(), status: BEHAVIOR_KINDS.has(kind) ? 0 : 1 }); setMessage(''); };
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const created = await api(`/api/model-dictionaries/${kind}${editing?.id ? `/${editing.id}` : ''}`, {
        method: editing?.id ? 'PUT' : 'POST', body: JSON.stringify(form),
      });
      setEditing(null); setSelectedId(created.id); await refresh(); signal(kind);
      if (!editing?.id) onCreated?.(created);
      setMessage('已保存；使用此字典的下拉选项已刷新。');
    } catch (cause) { setMessage(cause.message); }
    finally { setBusy(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(`确定删除「${item.name}」吗？已被引用的字典项不能删除。`)) return;
    try { await api(`/api/model-dictionaries/${kind}/${item.id}`, { method: 'DELETE' }); setSelectedId(''); await refresh(); signal(kind); setMessage('已删除'); }
    catch (cause) { setMessage(cause.message); }
  };
  return <div className={`dictionary-items ${compact ? 'compact' : ''}`}>
    <div className="dictionary-items-toolbar">
      <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或代码" /></label>
      <button type="button" onClick={() => begin(null)}><Plus size={14} /> 新增字典项</button>
      <button type="button" aria-label="刷新字典" onClick={refresh}><RefreshCw size={14} /></button>
    </div>
    {error && <p className="dictionary-message error">{error}</p>}
    {message && <p className="dictionary-message">{message}</p>}
    <div className="dictionary-items-layout">
      <div className="dictionary-items-list">
        <div className="dictionary-items-head"><span>名称 / 代码</span><span>状态</span><span>排序</span></div>
        {visible.map((item) => <button type="button" key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => { setSelectedId(item.id); setEditing(null); }}>
          <span><strong>{item.name}</strong><code>{item.code}</code></span>
          <em className={item.status ? 'enabled' : 'disabled'}>{item.status ? '有效' : '禁用'}</em><small>{item.ordering}</small>
        </button>)}
        {!visible.length && <p className="dictionary-empty">没有匹配的字典项</p>}
      </div>
      <aside className="dictionary-items-detail">
        {editing ? <form onSubmit={save}>
          <header><strong>{editing.id ? '编辑字典项' : '新增字典项'}</strong><button type="button" aria-label="取消编辑" onClick={() => setEditing(null)}><X size={15} /></button></header>
          <label>代码<input required disabled={Boolean(editing.id)} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="小写英文与下划线" /></label>
          <label>名称<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>描述<textarea value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label>排序<input type="number" value={form.ordering} onChange={(event) => setForm({ ...form, ordering: Number(event.target.value) })} /></label>
          {(EXTRA[kind] || []).map(([key, label]) => <label key={key}>{label}<input value={form[key] || ''} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}
          <label>状态<select value={form.status} onChange={(event) => setForm({ ...form, status: Number(event.target.value) })}><option value={1}>有效</option><option value={0}>禁用</option></select></label>
          <p>状态字段来自 V4 模板；禁用项不再出现在新建下拉中。已被引用的项不能禁用或删除。{BEHAVIOR_KINDS.has(kind) && ' 新增运行类型先保存为禁用，接入处理能力后再启用。'}</p>
          <button type="submit" disabled={busy}>{busy ? '保存中…' : '保存字典项'}</button>
        </form> : selected ? <>
          <header><strong>字典项详情</strong><div><button type="button" onClick={() => begin(selected)} title="编辑"><Pencil size={14} /></button><button type="button" onClick={() => remove(selected)} title="删除"><Trash2 size={14} /></button></div></header>
          <h3>{selected.name}</h3><code>{selected.code}</code><p>{selected.description || '暂无描述'}</p>
          <dl><div><dt>状态</dt><dd>{selected.status ? '有效' : '禁用'}</dd></div><div><dt>排序</dt><dd>{selected.ordering}</dd></div>{(EXTRA[kind] || []).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{selected[key] || '—'}</dd></div>)}</dl>
          {selected.params_configured && <p>参数配置已保存；本原型未定义结构化参数表单，暂不开放直接编辑。</p>}
        </> : <p>请选择字典项</p>}
      </aside>
    </div>
  </div>;
}

export function DictionaryField({ kind, label, value, onChange, required = false, valueMode = 'name', filter, emptyLabel = '请选择' }) {
  const { items, error } = useModelDictionary(kind);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState(null);
  const allowed = items.filter((item) => item.status && (!filter || filter(item)));
  const matches = (item) => item.code === value || item.name === value;
  const current = items.find(matches);
  const fallback = value && !current ? value : null;
  return <div className="dictionary-field"><div className="dictionary-field-label"><span>{label}</span><button type="button" onClick={(event) => { setHost(event.currentTarget.closest('.modal') || document.body); setOpen((old) => !old); }}>{open ? '收起管理' : '管理此字典'}</button></div><select aria-label={label} required={required} value={current ? current.code : fallback || ''} onChange={(event) => {
    const item = items.find((row) => row.code === event.target.value);
    onChange(item ? (valueMode === 'code' ? item.code : item.name) : event.target.value);
  }}><option value="">{emptyLabel}</option>{allowed.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}{current && !current.status && <option value={current.code}>{current.name}（已禁用，历史值）</option>}{fallback && <option value={fallback}>{fallback}（已有值，待规范）</option>}</select>{error && <small>{error}</small>}{open && host && createPortal(<div className="dictionary-field-manager" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}><div className="dictionary-field-manager-title"><strong>{TITLES[kind]} · 全局共享</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭字典管理"><X size={15} /></button></div><DictionaryItems kind={kind} compact onCreated={(item) => onChange(valueMode === 'code' ? item.code : item.name)} /></div>, host)}</div>;
}
