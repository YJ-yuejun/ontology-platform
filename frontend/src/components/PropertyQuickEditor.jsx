import { useEffect, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { api } from '../api';
import Modal from './Modal';
import { DictionaryField } from './DictionaryManager';
import { emptyProperty, PROPERTY_CATEGORIES } from './PropertyEditor';
import { objectUpdatePayload } from './ObjectTypeEditor';
import { linkUpdatePayload } from './LinkTypeEditor';

const PROPERTY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

// 属性只是所属资源（对象或关系）的一部分，单独改一项时仍然整体保存所属资源，
// 所以主键唯一、标题/状态属性引用这些规则在这里一并处理。
const saveOwner = async (owner, ownerKind, patch) => {
  if (ownerKind === 'object') return api(`/api/object-types/${owner.id}`, { method: 'PUT', body: JSON.stringify(objectUpdatePayload(owner, patch)) });
  return api(`/api/link-types/${owner.id}`, { method: 'PUT', body: JSON.stringify(linkUpdatePayload(owner, patch)) });
};
const mappingsOf = (mappings, owner, key) => mappings.filter((item) => item.mapping_type === 'property' && item.target_object_type === owner.name && item.target_property === key);

/**
 * 在检查器里新增或编辑一项属性。propertyKey 为空表示新增。
 * ownerKind: 'object' | 'link'；关系属性不能做主键。
 */
export function PropertyQuickEditor({ activeId, owner, ownerKind, propertyKey, notify, onClose, onSaved }) {
  const properties = owner.properties || [];
  const original = properties.find((item) => item.key === propertyKey);
  const [form, setForm] = useState(() => ({ ...emptyProperty(), ...(original || {}) }));
  const [mappings, setMappings] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (ownerKind !== 'object' || !original) return;
    api(`/api/ontologies/${activeId}/enterprise/data-mappings`).then(setMappings).catch(() => setMappings([]));
  }, [activeId]);
  const renamed = original && form.key !== original.key;
  const affectedMappings = original ? mappingsOf(mappings, owner, original.key) : [];
  const save = async (event) => {
    event.preventDefault();
    const key = String(form.key || '').trim();
    if (!String(form.name || '').trim()) { setError('请填写属性名称。'); return; }
    if (!PROPERTY_KEY_PATTERN.test(key)) { setError('属性字段名称请以英文字母开头，只能包含英文字母、数字和下划线。'); return; }
    if (properties.some((item) => item.key === key && item.key !== original?.key)) { setError(`字段名称“${key}”已被同一${ownerKind === 'object' ? '对象' : '关系'}的其他属性使用。`); return; }
    if (form.type === 'enum' && !(form.options || []).length) { setError('枚举属性至少需要一个枚举值。'); return; }
    if (ownerKind === 'object' && original?.is_primary_key && !form.is_primary_key) { setError('对象必须保留一个主键。如需更换主键，请在另一项属性上勾选“主键”。'); return; }
    const next = { ...form, key };
    let list = original ? properties.map((item) => (item.key === original.key ? next : item)) : [...properties, next];
    if (ownerKind === 'object' && next.is_primary_key) list = list.map((item) => (item.key === key ? item : { ...item, is_primary_key: false }));
    if (ownerKind !== 'object') list = list.map((item) => ({ ...item, is_primary_key: false }));
    const patch = { properties: list };
    if (ownerKind === 'object' && renamed) {
      if (owner.title_property === original.key) patch.title_property = key;
      if (owner.state_property === original.key) patch.state_property = key;
    }
    setBusy(true); setError('');
    try {
      const saved = await saveOwner(owner, ownerKind, patch);
      notify(original ? `已更新属性“${next.name}”` : `已添加属性“${next.name}”`);
      await onSaved(saved);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return <Modal title={original ? `编辑属性 · ${original.name}` : '添加属性'} subtitle={`${ownerKind === 'object' ? '对象' : '关系'}：${owner.display_name}`} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>取消</button><button className="btn primary" form="property-quick-form" disabled={busy}>{busy ? '保存中…' : '保存'}</button></>}>
    {error && <div className="form-error-banner" role="alert">{error}</div>}
    <form id="property-quick-form" className="form-sections" onSubmit={save}><section className="form-section">
      <div className="form-grid two">
        <label><span>属性名称</span><input autoFocus required value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：合同金额" /></label>
        <label><span>属性字段名称</span><input className="mono" required value={form.key || ''} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="contract_amount" />{renamed && affectedMappings.length > 0 ? <small className="field-error">该字段已有 {affectedMappings.length} 条属性映射，改名后映射会失效，需要到“数据源与映射”重新绑定。</small> : <small>供接口和映射稳定引用，改名会影响已建立的映射。</small>}</label>
        <DictionaryField kind="data_type" label="数据类型" value={form.type || 'string'} valueMode="code" onChange={(next) => setForm({ ...form, type: next, options: next === 'enum' ? (form.options || []) : null })} />
        {ownerKind === 'object' && <label><span>属性类别</span><select value={form.property_category || '业务属性'} onChange={(e) => setForm({ ...form, property_category: e.target.value })}>{PROPERTY_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>}
        {form.type === 'enum' && <label><span>枚举值</span><input value={(form.options || []).join(',')} onChange={(e) => setForm({ ...form, options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="在用, 闲置, 已报废" /></label>}
      </div>
      <label><span>业务定义</span><textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="说明这项属性的业务含义与取值口径" /></label>
      <div className="template-boolean-grid">
        {ownerKind === 'object' && <label className="check"><input type="checkbox" checked={Boolean(form.is_primary_key)} onChange={(e) => setForm({ ...form, is_primary_key: e.target.checked })} /> <KeyRound size={13} /> 主键{!original?.is_primary_key && form.is_primary_key && '（保存后原主键会取消）'}</label>}
        <label className="check"><input type="checkbox" checked={Boolean(form.is_unique)} onChange={(e) => setForm({ ...form, is_unique: e.target.checked })} /> 唯一</label>
        <label className="check"><input type="checkbox" checked={Boolean(form.is_required)} onChange={(e) => setForm({ ...form, is_required: e.target.checked })} /> 必填</label>
      </div>
    </section></form>
  </Modal>;
}

// 删除一项属性：主键不能删；被映射引用时提示映射会失效；标题/状态属性引用会自动清空。
export function PropertyRemoveDialog({ activeId, owner, ownerKind, propertyKey, notify, onClose, onSaved }) {
  const property = (owner.properties || []).find((item) => item.key === propertyKey);
  const [mappings, setMappings] = useState(ownerKind === 'object' ? null : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (ownerKind !== 'object') return;
    api(`/api/ontologies/${activeId}/enterprise/data-mappings`).then(setMappings).catch(() => setMappings([]));
  }, [activeId]);
  if (!property) return null;
  const affected = mappings ? mappingsOf(mappings, owner, property.key) : [];
  const blocked = ownerKind === 'object' && property.is_primary_key;
  const remove = async () => {
    setBusy(true); setError('');
    const patch = { properties: owner.properties.filter((item) => item.key !== property.key) };
    if (ownerKind === 'object') {
      if (owner.title_property === property.key) patch.title_property = '';
      if (owner.state_property === property.key) patch.state_property = '';
    }
    try {
      const saved = await saveOwner(owner, ownerKind, patch);
      notify(`已删除属性“${property.name}”`);
      await onSaved(saved);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return <Modal title="删除属性" subtitle={`${owner.display_name} · ${property.name}`} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>取消</button><button className="btn danger" disabled={blocked || busy || !mappings} onClick={remove}><Trash2 size={15} /> {busy ? '删除中…' : '确认删除'}</button></>}>
    <div className="remove-dialog">
      {error && <div className="form-error-banner" role="alert">{error}</div>}
      {blocked ? <div className="remove-block"><b>主键属性不能删除</b><p>对象必须且只能有一个主键。如需更换，请先在另一项属性上勾选“主键”，再删除这一项。</p></div> : <>
        <p>将从{ownerKind === 'object' ? '对象' : '关系'}“{owner.display_name}”中删除属性 <b>{property.name}</b>（<code>{property.key}</code>），只影响当前工作状态。</p>
        {affected.length > 0 && <div className="remove-block"><b>该属性有 {affected.length} 条属性映射</b><p>删除后这些映射会失效，需要到“数据源与映射”中清理。</p></div>}
        {ownerKind === 'object' && (owner.title_property === property.key || owner.state_property === property.key) && <p className="template-field-note">它当前是对象的{owner.title_property === property.key ? '标题属性' : '状态属性'}，删除后会改为默认值。</p>}
      </>}
    </div>
  </Modal>;
}
