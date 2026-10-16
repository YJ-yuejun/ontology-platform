import { Plus, Trash2 } from 'lucide-react';
import { emptyProperty } from './PropertyEditor';

const TYPES = [
  ['string', '文本'], ['integer', '整数'], ['decimal', '数值'],
  ['boolean', '布尔'], ['datetime', '日期时间'], ['enum', '枚举'],
];

const PARAMETER_SOURCES = [
  ['user_input', '用户填写'],
  ['current_object', '当前对象属性'],
  ['related_object', '关联对象属性'],
  ['rule_result', '规则/函数结果'],
  ['actor_context', '当前用户上下文'],
  ['system_default', '系统默认值'],
];

export const emptyActionParameter = () => ({
  ...emptyProperty(), parameter_source: 'user_input', parameter_source_ref: '', is_sensitive: false,
});

export default function ActionParameterEditor({ value, onChange, objects = [], targetObject }) {
  const update = (index, patch) => onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item));
  const remove = (index) => onChange(value.filter((_, i) => i !== index));
  const add = () => onChange([...value, emptyActionParameter()]);
  const objectProperties = (targetObject?.effective_properties || targetObject?.properties || []).map((item) => ({
    value: `object.${item.key}`, label: `${item.name}（${item.key}）`,
  }));
  const relationHint = objects.length ? '可填写对象属性路径，例如 object.status' : '可填写来源路径，例如 object.status';

  return <section className="action-parameter-editor">
    <div className="section-row"><div><h3>输入参数</h3><p>参数是动作的输入契约；来源用于生成表单和执行映射，不是数据源字段。</p></div><button type="button" className="btn secondary small" onClick={add}><Plus size={15} /> 添加参数</button></div>
    <div className="action-parameter-note">模板字段“输入参数”在这里结构化配置；真实系统参数名在“行动执行映射”中绑定。</div>
    {value.length === 0 ? <button type="button" className="empty-properties" onClick={add}>暂无输入参数，点击添加</button> : <div className="action-parameter-list">{value.map((item, index) => <article key={`${item.key}-${index}`} className="action-parameter-row">
      <div className="action-parameter-grid">
        <label><span>参数名称</span><input value={item.name || ''} onChange={(e) => update(index, { name: e.target.value })} placeholder="例如：暂停原因" /></label>
        <label><span>稳定标识</span><input className="mono" value={item.key || ''} onChange={(e) => update(index, { key: e.target.value })} placeholder="reason" /></label>
        <label><span>数据类型</span><select value={item.type || 'string'} onChange={(e) => update(index, { type: e.target.value, options: e.target.value === 'enum' ? (item.options || []) : null })}>{TYPES.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label><span>参数来源</span><select value={item.parameter_source || 'user_input'} onChange={(e) => update(index, { parameter_source: e.target.value })}>{PARAMETER_SOURCES.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        <label><span>来源路径（可选）</span><input className="mono" value={item.parameter_source_ref || ''} onChange={(e) => update(index, { parameter_source_ref: e.target.value })} placeholder={relationHint} /></label>
        {item.type === 'enum' && <label><span>枚举值</span><input value={(item.options || []).join(',')} onChange={(e) => update(index, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="人工暂停,安全策略" /></label>}
        <label><span>默认值（可选）</span><input value={item.default ?? ''} onChange={(e) => update(index, { default: e.target.value || null })} placeholder="留空表示无默认值" /></label>
      </div>
      <div className="property-flags"><label className="check"><input type="checkbox" checked={Boolean(item.is_required)} onChange={(e) => update(index, { is_required: e.target.checked })} /> 必填</label><label className="check"><input type="checkbox" checked={Boolean(item.is_sensitive)} onChange={(e) => update(index, { is_sensitive: e.target.checked })} /> 敏感参数</label><button type="button" className="danger-link" onClick={() => remove(index)}><Trash2 size={14} /> 删除</button></div>
    </article>)}</div>}
  </section>;
}
