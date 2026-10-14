import { Plus, Trash2 } from 'lucide-react';
import { designStatusValue } from '../labels';
import { DictionaryField } from './DictionaryManager';

const TYPES = [
  ['string', '文本'], ['integer', '整数'], ['decimal', '数值'],
  ['boolean', '布尔'], ['datetime', '日期时间'], ['enum', '枚举'],
];

// 与《本体建模模板.xlsx》的“属性类别”列保持一致。它是属性语义维度，
// 不替代对象的对象类别、资源状态或本体发布状态。
const PROPERTY_CATEGORIES = ['标识属性', '业务属性', '状态属性', '实时属性', '计算属性'];
const UPDATE_FREQUENCIES = ['实时', '秒级', '按源系统', '每小时', '日', '每日', '批量', '手工触发'];

export const emptyProperty = () => ({
  key: '', name: '', type: 'string', property_category: '业务属性',
  is_primary_key: false, is_unique: false, is_required: false, is_searchable: false,
  default: null, options: null, description: '', business_definition: '', unit: '',
  source_system: '', source_field: '', update_frequency: '', transform_rule: '',
  quality_rule: '', status: 'experimental', design_status: 'draft',
});

const sourceOptions = (sources, current) => {
  const values = [...new Set([...(sources || []).map((item) => item.name || item.code), current].filter(Boolean))];
  return values;
};

export default function PropertyEditor({
  value, onChange, primaryKey = true, label = '属性定义',
  sources = [], templateMode = false,
}) {
  const update = (index, patch) => onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item));
  const remove = (index) => onChange(value.filter((_, i) => i !== index));
  const add = () => onChange([...value, emptyProperty()]);

  return (
    <div className="property-editor">
      <div className="section-row">
        <div>
          <h3>{label}</h3>
          <p>{templateMode ? '按模板的对象属性字段填写；物理接入仍以“数据源与映射”为准。' : '用稳定英文标识描述字段，用中文名称服务业务用户。'}</p>
        </div>
        <button type="button" className="btn secondary small" onClick={add}><Plus size={15} /> 添加一项</button>
      </div>
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
              {templateMode && <details className="property-template-details">
                <summary>模板字段（来源、转换与质量）</summary>
                <div className="property-template-grid">
                  <label><span>单位</span><input value={item.unit || ''} onChange={(e) => update(index, { unit: e.target.value })} placeholder="例如：MPa、元" /></label>
                  <label><span>业务定义</span><input value={item.business_definition || item.description || ''} onChange={(e) => update(index, { business_definition: e.target.value, description: e.target.value })} placeholder="该属性的业务口径" /></label>
                  <label><span>来源系统</span><select value={item.source_system || ''} onChange={(e) => update(index, { source_system: e.target.value })}><option value="">未指定</option>{sourceOptions(sources, item.source_system).map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
                  <label><span>来源字段（模板字段，可选）</span><input className="mono" value={item.source_field || ''} onChange={(e) => update(index, { source_field: e.target.value || null })} placeholder="例如：PRESSURE / JSON 路径" /></label>
                  <label><span>更新频率</span><select value={item.update_frequency || ''} onChange={(e) => update(index, { update_frequency: e.target.value })}><option value="">未指定</option>{UPDATE_FREQUENCIES.map((frequency) => <option key={frequency}>{frequency}</option>)}</select></label>
                  <label><span>转换规则</span><input className="mono" value={item.transform_rule || ''} onChange={(e) => update(index, { transform_rule: e.target.value })} placeholder="例如：单位标准化" /></label>
                  <label><span>质量要求</span><input value={item.quality_rule || ''} onChange={(e) => update(index, { quality_rule: e.target.value })} placeholder="例如：非空、唯一、范围合理" /></label>
                  <label><span>建模状态</span><select value={designStatusValue(item.design_status)} onChange={(e) => update(index, { design_status: e.target.value })}><option value="validated">已确认</option><option value="draft">设计中</option></select></label>
                </div>
              </details>}
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
