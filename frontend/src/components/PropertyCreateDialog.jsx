import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../api';
import Modal from './Modal';
import { emptyProperty, PROPERTY_CATEGORIES } from './PropertyEditor';
import { objectUpdatePayload } from './ObjectTypeEditor';

const PROPERTY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const DATA_TYPES = [
  ['string', '文本'], ['integer', '整数'], ['decimal', '数值'],
  ['boolean', '布尔'], ['datetime', '日期时间'], ['enum', '枚举'],
];

export default function PropertyCreateDialog({ objects = [], activeId, defaultObjectId = '', notify, onClose, onSaved }) {
  const [objectId, setObjectId] = useState(defaultObjectId || objects[0]?.id || '');
  const [property, setProperty] = useState(() => emptyProperty());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const object = useMemo(() => objects.find((item) => item.id === objectId), [objects, objectId]);
  const hasPrimaryKey = Boolean(object?.properties?.some((item) => item.is_primary_key));

  useEffect(() => {
    if (objectId && objects.some((item) => item.id === objectId)) return;
    setObjectId(defaultObjectId || objects[0]?.id || '');
  }, [defaultObjectId, objectId, objects]);

  const change = (patch) => { setProperty((old) => ({ ...old, ...patch })); setError(''); };
  const submit = async (event) => {
    event.preventDefault();
    if (!object) { setError('请选择所属对象类型。'); return; }
    const candidate = {
      ...property,
      is_primary_key: !hasPrimaryKey,
      options: property.type === 'enum' ? (property.options || []) : null,
    };
    if (!String(candidate.name || '').trim()) { setError('请填写属性名称。'); return; }
    if (!PROPERTY_KEY_PATTERN.test(String(candidate.key || ''))) {
      setError('字段名称必须以英文字母开头，只能包含英文字母、数字和下划线。');
      return;
    }
    const duplicate = (object.properties || []).some((item) => item.key === candidate.key);
    if (duplicate) { setError(`属性字段名称“${candidate.key}”在该对象中已存在。`); return; }
    if (candidate.type === 'enum' && !(candidate.options || []).length) { setError('枚举属性至少需要一个枚举值。'); return; }
    setBusy(true); setError('');
    try {
      await api(`/api/object-types/${object.id}`, {
        method: 'PUT',
        body: JSON.stringify(objectUpdatePayload(object, { properties: [...(object.properties || []), candidate] })),
      });
      await onSaved?.(object.id, candidate.key);
    } catch (saveError) {
      setError(saveError.message);
      notify?.(saveError.message);
      setBusy(false);
    }
  };

  return <Modal
    title="新增对象属性"
    subtitle="属性归属于某个对象类型；保存后会出现在对象属性目录，并参与映射状态统计。"
    onClose={onClose}
    footer={<><button type="button" className="btn secondary" onClick={onClose}>取消</button><button type="submit" form="property-create-form" className="btn primary" disabled={busy || !object}>{busy ? '保存中…' : '保存属性'}</button></>}
  >
    {error && <div className="form-error-banner" role="alert">{error}</div>}
    <form id="property-create-form" className="form-sections" noValidate onSubmit={submit}>
      <section className="form-section">
        <h3>所属对象</h3>
        <p>属性不能独立存在，先选择它要挂载到哪个对象类型。</p>
        <label><span>对象类型</span><select value={objectId} onChange={(event) => { setObjectId(event.target.value); setError(''); }}>{objects.map((item) => <option key={item.id} value={item.id}>{item.business_domain_name ? `${item.business_domain_name} / ` : ''}{item.display_name} · {item.name}</option>)}</select>{object && <small>{object.subject_domain_name || '未分类主题域'} · 当前 {object.properties?.length || 0} 个属性{hasPrimaryKey ? '，已有主键' : '，尚无主键'}</small>}</label>
      </section>
      <section className="form-section">
        <h3>属性定义</h3>
        <p>中文名称给业务用户，字段名称给接口和程序稳定引用。</p>
        <div className="form-grid two">
          <label><span>属性名称</span><input autoFocus value={property.name} onChange={(event) => change({ name: event.target.value })} placeholder="例如：合同编号" /></label>
          <label><span>字段名称（API 名称）</span><input className="mono" value={property.key} onChange={(event) => change({ key: event.target.value })} placeholder="contract_no" /><small>以英文字母开头，只能包含英文字母、数字和下划线。</small></label>
          <label><span>数据类型</span><select value={property.type} onChange={(event) => change({ type: event.target.value, options: event.target.value === 'enum' ? (property.options || []) : null })}>{DATA_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>属性类别</span><select value={property.property_category} onChange={(event) => change({ property_category: event.target.value })}>{PROPERTY_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
          {property.type === 'enum' && <label className="property-options"><span>枚举值</span><input value={(property.options || []).join(',')} onChange={(event) => change({ options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} placeholder="草稿, 审批中, 已生效" /><small>用英文逗号分隔。</small></label>}
          <label><span>单位（可选）</span><input value={property.unit || ''} onChange={(event) => change({ unit: event.target.value })} placeholder="例如：元、天、%" /></label>
          <label className="form-span-two"><span>业务定义（可选）</span><textarea rows={2} value={property.description || ''} onChange={(event) => change({ description: event.target.value })} placeholder="这个属性在业务上表示什么、怎么计算或使用" /></label>
        </div>
        <div className="property-flags">
          {!hasPrimaryKey && <span className="required-chip">新属性将作为该对象的主键</span>}
          <label className="check"><input type="checkbox" checked={Boolean(property.is_required)} onChange={(event) => change({ is_required: event.target.checked })} /> 必填</label>
          <label className="check"><input type="checkbox" checked={Boolean(property.is_unique)} onChange={(event) => change({ is_unique: event.target.checked })} /> 唯一</label>
          <label className="check"><input type="checkbox" checked={Boolean(property.is_searchable)} onChange={(event) => change({ is_searchable: event.target.checked })} /> 可搜索</label>
        </div>
      </section>
    </form>
  </Modal>;
}
