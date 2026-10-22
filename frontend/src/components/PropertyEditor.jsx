import { Plus, Trash2 } from 'lucide-react';
import { DictionaryField } from './DictionaryManager';

const TYPES = [
  ['string', '文本'], ['integer', '整数'], ['decimal', '数值'],
  ['boolean', '布尔'], ['datetime', '日期时间'], ['enum', '枚举'],
];

// 与《本体建模模板.xlsx》的“属性类别”列保持一致。它是属性语义维度，
// 不替代对象的对象类别、资源状态或本体发布状态。
export const PROPERTY_CATEGORIES = ['标识属性', '业务属性', '状态属性', '实时属性', '计算属性'];

export const emptyProperty = () => ({
  key: '', name: '', type: 'string', property_category: '业务属性',
  is_primary_key: false, is_unique: false, is_required: false, is_searchable: false,
  default: null, options: null, description: '', business_definition: '', unit: '',
  source_system: '', source_field: '', update_frequency: '', transform_rule: '',
  quality_rule: '', status: 'experimental', design_status: 'draft',
});

export default function PropertyEditor({
  value, onChange, primaryKey = true, label = '属性定义', templateMode = false, compact = false,
}) {
  const update = (index, patch) => onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item));
  const remove = (index) => onChange(value.filter((_, i) => i !== index));
  const add = () => {
    const item = emptyProperty();
    // 新建对象时第一项属性默认作为主键，减少一次必选操作；用户仍可改选其他属性。
    if (primaryKey && !value.some((entry) => entry.is_primary_key)) item.is_primary_key = true;
    onChange([...value, item]);
  };

  return (
    <div className="property-editor">
      {compact
        ? <div className="section-row compact"><h3>属性字段</h3><button type="button" className="btn secondary small" onClick={add}><Plus size={15} /> 添加一项</button></div>
        : <div className="section-row">
          <div>
            <h3>{label}</h3>
            <p>{templateMode ? '按模板的对象属性字段填写；物理接入仍以“数据源与映射”为准。' : '用稳定英文标识描述字段，用中文名称服务业务用户。'}</p>
          </div>
          <button type="button" className="btn secondary small" onClick={add}><Plus size={15} /> 添加一项</button>
        </div>}
      {value.length === 0 ? (
        <button type="button" className="empty-properties" onClick={add}>暂无定义，点击添加</button>
      ) : (
        <div className="property-list">
          {value.map((item, index) => (
            <div className="property-row" key={`${item.key}-${index}`}>
              <div className="property-grid">
                <label><span>属性名称</span><input value={item.name || ''} onChange={(e) => update(index, { name: e.target.value })} placeholder="例如：资产编号" /></label>
                <label><span>属性字段名称</span><input className="mono" value={item.key || ''} onChange={(e) => update(index, { key: e.target.value })} placeholder="asset_id" /></label>
                <DictionaryField kind="data_type" label="数据类型" value={item.type || 'string'} valueMode="code" onChange={(next) => update(index, { type: next, options: next === 'enum' ? (item.options || []) : null })} />
                {templateMode && <label><span>属性类别</span><select value={item.property_category || '业务属性'} onChange={(e) => update(index, { property_category: e.target.value })}>{PROPERTY_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>}
                {item.type === 'enum' && <label className="property-options"><span>单位 / 枚举值</span><input value={(item.options || []).join(',')} onChange={(e) => update(index, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="在用, 闲置, 已报废" /></label>}
              </div>
              <div className="property-flags">
                {primaryKey && <label className="check"><input type="checkbox" checked={Boolean(item.is_primary_key)} onChange={(e) => {
                  const next = value.map((p, i) => ({ ...p, is_primary_key: i === index ? e.target.checked : (e.target.checked ? false : p.is_primary_key) }));
                  onChange(next);
                }} /> 主键</label>}
                <label className="check"><input type="checkbox" checked={Boolean(item.is_unique)} onChange={(e) => update(index, { is_unique: e.target.checked })} /> 唯一</label>
                <label className="check"><input type="checkbox" checked={Boolean(item.is_required)} onChange={(e) => update(index, { is_required: e.target.checked })} /> 必填</label>
                <button type="button" className="danger-link" onClick={() => remove(index)}><Trash2 size={14} /> 删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
