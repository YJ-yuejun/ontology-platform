import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { api } from '../api';
import { designStatusValue, DESIGN_STATUS_OPTIONS, STATUS_OPTIONS } from '../labels';
import Modal from './Modal';
import PropertyEditor from './PropertyEditor';

export const LINK_CARDINALITIES = { one_to_one: '一对一', one_to_many: '一对多', many_to_one: '多对一', many_to_many: '多对多' };
export const emptyLinkForm = () => ({ name: '', display_name: '', external_id: '', source_object_type_id: '', target_object_type_id: '', cardinality: '', description: '', status: 'experimental', design_status: 'draft', properties: [], source_system: '', source_key: '', target_key: '', is_core: false, bidirectional_display: false, reverse_display_name: '', reverse_name: '' });

export const formFromLink = (item) => ({ ...emptyLinkForm(), ...item, external_id: item.external_id || '', description: item.description || '', design_status: designStatusValue(item.design_status), properties: item.properties || [], source_system: item.source_system || '', source_key: item.source_key || '', target_key: item.target_key || '', is_core: Boolean(item.is_core), bidirectional_display: item.bidirectional_display !== false });

// 关系 API 名称只能小写+下划线；从对象 API 名称推一个可改的默认值，省去手敲。
const snake = (value = '') => String(value).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase().replace(/^_+|_+$/g, '');
export const suggestLinkName = (source, target) => {
  const name = [snake(source?.name), 'to', snake(target?.name)].filter(Boolean).join('_');
  return /^[a-z]/.test(name) ? name : '';
};

/**
 * 关系类型新建/编辑弹窗。关系类型目录与本体图谱共用。
 * initial 用于新建时预填起点/终点（例如在图谱中从一个对象连到另一个对象）。
 */
// 不打开表单直接改关系的某个字段（如检查器里增删一项关系属性）。
export const linkUpdatePayload = (item, patch = {}) => ({ ...formFromLink(item), ...patch });

export default function LinkTypeEditor({ activeId, objects, editing, initial, copyFrom, notify, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    if (editing) return formFromLink(editing);
    const next = { ...emptyLinkForm(), ...(initial || {}) };
    const source = objects.find((obj) => obj.id === next.source_object_type_id);
    const target = objects.find((obj) => obj.id === next.target_object_type_id);
    if (!next.name && source && target) next.name = suggestLinkName(source, target);
    return next;
  });
  // 复制关系时 API 名称已经给出唯一的默认值，切换端点时不再自动覆盖。
  const [nameTouched, setNameTouched] = useState(Boolean(editing || copyFrom));
  const [busy, setBusy] = useState(false);
  const objectById = (id) => objects.find((obj) => obj.id === id);
  const changeEndpoint = (key, value) => setForm((old) => {
    const next = { ...old, [key]: value, [key === 'source_object_type_id' ? 'source_key' : 'target_key']: '' };
    if (!nameTouched) next.name = suggestLinkName(objectById(next.source_object_type_id), objectById(next.target_object_type_id));
    return next;
  });
  const swap = () => setForm((old) => ({ ...old, source_object_type_id: old.target_object_type_id, target_object_type_id: old.source_object_type_id, source_key: old.target_key, target_key: old.source_key, ...(nameTouched ? {} : { name: suggestLinkName(objectById(old.target_object_type_id), objectById(old.source_object_type_id)) }) }));
  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const saved = await api(editing ? `/api/link-types/${editing.id}` : `/api/ontologies/${activeId}/link-types`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(form) });
      await onSaved(saved);
    } catch (e) { notify(e.message); setBusy(false); }
  };
  return <Modal wide title={editing ? `编辑关系 · ${editing.display_name}` : copyFrom ? `复制关系 · ${copyFrom.display_name}` : '新建关系类型'} subtitle="明确关系方向、业务含义与基数，避免把关系当成普通字段" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>取消</button><button form="link-form" className="btn primary" disabled={busy}>{busy ? '保存中…' : copyFrom ? '创建副本' : '保存关系类型'}</button></>}>
    {copyFrom && <div className="template-field-note">已带入“{copyFrom.display_name}”的全部配置。关系 API 名称在本体内唯一，请确认名称后再保存；通常还需要调整起点或终点，否则会得到两条含义重复的关系。</div>}
    <form id="link-form" onSubmit={save} className="form-sections">
      <section className="form-section"><h3>1. 基础信息</h3><div className="form-grid two">
        <label><span>关系 ID（模板）</span><input className="mono" value={form.external_id} onChange={(e) => setForm({ ...form, external_id: e.target.value })} placeholder="例如：L-001" /></label>
        <label><span>关系名称</span><input required autoFocus value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="归属部门" /></label>
        <label><span>关系 API 名称</span><input required className="mono" disabled={editing?.status === 'active'} value={form.name} onChange={(e) => { setNameTouched(true); setForm({ ...form, name: e.target.value }); }} placeholder="asset_belongs_to_department" />{!editing && <small>选择起点和终点后会自动生成，可直接修改。</small>}</label>
        <label><span>业务定义</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="说明关系成立的业务条件与正式方向" /></label>
      </div></section>
      <section className="form-section"><h3>2. 关系结构</h3><div className="form-grid two">
        <label><span>起点对象</span><select required value={form.source_object_type_id} onChange={(e) => changeEndpoint('source_object_type_id', e.target.value)}><option value="">请选择起点对象</option>{objects.map((obj) => <option value={obj.id} key={obj.id}>{obj.display_name} · {obj.name}</option>)}</select></label>
        <label><span>终点对象</span><select required value={form.target_object_type_id} onChange={(e) => changeEndpoint('target_object_type_id', e.target.value)}><option value="">请选择终点对象</option>{objects.map((obj) => <option value={obj.id} key={obj.id}>{obj.display_name} · {obj.name}</option>)}</select></label>
        <label><span>关系方向</span><span className="link-direction-field"><input disabled value={`${objectById(form.source_object_type_id)?.display_name || '起点'} → ${objectById(form.target_object_type_id)?.display_name || '终点'}`} /><button type="button" className="btn secondary small" onClick={swap} disabled={!form.source_object_type_id && !form.target_object_type_id} title="交换起点与终点"><ArrowLeftRight size={14} /> 反转</button></span></label>
        <label><span>关系基数</span><select required value={form.cardinality} onChange={(e) => setForm({ ...form, cardinality: e.target.value })}><option value="">请选择关系基数</option>{Object.entries(LINK_CARDINALITIES).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>
        <label><span>反向名称</span><input value={form.reverse_display_name || ''} onChange={(e) => setForm({ ...form, reverse_display_name: e.target.value })} placeholder="例如：所属合同" /><small>从终点回看起点时使用的说法，例如「客户 —签署→ 合同」的反向是「合同 —被谁签署→ 客户」。</small></label>
        <label><span>反向 API 名称</span><input className="mono" value={form.reverse_name || ''} onChange={(e) => setForm({ ...form, reverse_name: e.target.value })} placeholder="signed_by_customer" /><small>供接口和程序反向读取时稳定引用，只能用小写字母、数字和下划线。</small></label>
      </div><p className="form-hint">关系方向以起点 → 终点为事实；反向名称只描述从另一侧看这条关系的说法，不改变正式方向，也不影响存储。</p></section>
      <section className="form-section"><h3>3. 来源与治理</h3><div className="form-grid two">
        <label><span>来源系统</span><input value={form.source_system || ''} onChange={(e) => setForm({ ...form, source_system: e.target.value })} placeholder="例如：调度系统 / 资产系统" /></label>
        <label><span>起点键</span><input className="mono" value={form.source_key || ''} onChange={(e) => setForm({ ...form, source_key: e.target.value })} placeholder="例如：TASK_ID" /></label>
        <label><span>终点键</span><input className="mono" value={form.target_key || ''} onChange={(e) => setForm({ ...form, target_key: e.target.value })} placeholder="例如：PIPE_ID" /></label>
        <label><span>使用状态</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label><span>模板建模状态</span><select value={form.design_status || 'draft'} onChange={(e) => setForm({ ...form, design_status: e.target.value })}>{DESIGN_STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div><div className="template-boolean-grid"><label className="check"><input type="checkbox" checked={Boolean(form.is_core)} onChange={(e) => setForm({ ...form, is_core: e.target.checked })} /> 核心关系（图谱中加粗显示）</label><label className="check"><input type="checkbox" checked={Boolean(form.bidirectional_display)} onChange={(e) => setForm({ ...form, bidirectional_display: e.target.checked })} /> 双向展示</label></div></section>
      <section className="form-section"><h3>4. 关系属性（可选）</h3><PropertyEditor primaryKey={false} label="关系属性" value={form.properties} onChange={(properties) => setForm({ ...form, properties })} /></section>
    </form>
  </Modal>;
}
