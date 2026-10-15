import { useEffect, useState } from 'react';
import { Layers3, Star } from 'lucide-react';
import { api } from '../api';
import { dataTypeLabel, designStatusLabel, designStatusValue, STATUS_OPTIONS } from '../labels';
import Modal from './Modal';
import { ObjectIconPicker } from './ObjectTypeIcon';
import PropertyEditor, { emptyProperty } from './PropertyEditor';
import { governanceFieldCandidates } from '../objectMapping';

export const emptyObjectForm = () => ({
  external_id: '', name: '', display_name: '', icon: 'box', title_property: '', description: '',
  status: 'experimental', design_status: 'draft', properties: [], subject_domain_id: '',
  interface_ids: [], backing_source: '', category: '业务实体', domain: '', lifecycle: '', state_property: '',
  owner: '', source_system: '', is_core: false, is_event: false, requires_action: false,
});
// 对象 API 名称和属性字段名是运行时稳定引用，不能直接使用中文显示名称。
// 之前只在后端 Pydantic 校验，用户一直填到最后一步才看到一个不易理解的 422。
const OBJECT_API_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const PROPERTY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const validatePropertyForm = (properties = []) => {
  if (!properties.length) return '至少添加一项对象属性，并勾选一个主键属性。';
  const primaryKeys = properties.filter((item) => item.is_primary_key);
  if (primaryKeys.length !== 1) return '对象必须且只能有一个主键属性。';
  const keys = new Set();
  for (const [index, item] of properties.entries()) {
    const row = index + 1;
    if (!String(item.name || '').trim()) return `第 ${row} 项属性缺少中文名称。`;
    if (!PROPERTY_KEY_PATTERN.test(String(item.key || ''))) return `第 ${row} 项属性字段名称格式不正确：请以英文字母开头，只能包含英文字母、数字和下划线。`;
    if (keys.has(item.key)) return `属性字段名称“${item.key}”重复，请保持唯一。`;
    keys.add(item.key);
    if (item.type === 'enum' && (!Array.isArray(item.options) || !item.options.length)) return `枚举属性“${item.name}”至少需要一个枚举值。`;
  }
  return '';
};

const validateObjectForm = (form) => {
  if (!String(form.display_name || '').trim()) return '请填写对象显示名称。';
  if (!OBJECT_API_NAME_PATTERN.test(String(form.name || ''))) return '稳定标识（API 名称）必须以大写英文字母开头，只能包含英文字母和数字，例如 PurchaseContract。';
  const propertyError = validatePropertyForm(form.properties);
  if (propertyError) return propertyError;
  const keys = new Set((form.properties || []).map((item) => item.key));
  if (form.title_property && !keys.has(form.title_property)) return '标题属性必须来自已定义的属性字段。';
  if (form.state_property && !keys.has(form.state_property)) return '状态属性必须来自已定义的属性字段。';
  return '';
};

// 历史（模板导入）可能留下指向不存在属性的 title_property / state_property。
// 这类失效引用不能直接把用户挡在保存之外：先按当前属性重置，并留一句可读的解释。
const formFromObject = (item) => {
  const properties = item.properties || [];
  const keys = new Set(properties.map((property) => property.key));
  const statePropertyValid = Boolean(item.state_property) && keys.has(item.state_property);
  const titlePropertyValid = !item.title_property || keys.has(item.title_property);
  const templateStateName = (item.template_raw && item.template_raw['状态属性']) || '';
  let note = '';
  if (item.state_property && !statePropertyValid) {
    note = `模板记录的状态属性「${templateStateName || item.state_property}」在当前对象属性里找不到对应字段，已重置为「未指定」；模板原值仍保留在对象元数据中，请按需重新选择。`;
  } else if (!item.state_property && templateStateName) {
    note = `模板记录的状态属性是「${templateStateName}」，但对象属性里没有对应字段，因此未设置状态属性；可以在下方选择一项，或先到“属性定义”补上该属性。`;
  }
  const form = { ...emptyObjectForm(), ...item, properties, interface_ids: item.interface_ids || [], subject_domain_id: item.subject_domain_id || '', backing_source: item.backing_source || '', external_id: item.external_id || '', design_status: designStatusValue(item.design_status), is_core: Boolean(item.is_core), is_event: Boolean(item.is_event), requires_action: Boolean(item.requires_action), title_property: titlePropertyValid ? (item.title_property || '') : '', state_property: statePropertyValid ? item.state_property : '' };
  return { form, note };
};

// 对象保存请求体。v1.9 只创建业务对象，分组/继承等历史字段固定清空。
export const objectSavePayload = (form) => ({
  ...form,
  external_id: form.external_id || null,
  plural_name: null, group_ids: [], object_kind: 'business_object', parent_type_id: null,
});
// 不打开表单直接改一个字段（如图谱里“设为核心对象”），沿用表单的失效引用清理，避免被历史值挡住保存。
export const objectUpdatePayload = (item, patch = {}) => objectSavePayload({ ...formFromObject(item).form, ...patch });

/**
 * 对象类型新建/编辑弹窗。对象类型目录与本体图谱共用，保证两处的校验与保存口径一致。
 * editing 为空时新建；initial 用于新建时预填（例如从图谱当前主题域发起）。
 * onSaved(saved, { assetCode }) 在保存成功后回调，assetCode 是新建时参考的治理资产。
 */
export default function ObjectTypeEditor({ activeId, editing, initial, notify, onClose, onSaved }) {
  const [interfaces, setInterfaces] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [governanceAssets, setGovernanceAssets] = useState([]);
  const [{ form: initialForm, note: initialNote }] = useState(() => (editing ? formFromObject(editing) : { form: { ...emptyObjectForm(), ...(initial || {}) }, note: '' }));
  const [form, setForm] = useState(initialForm);
  // 模板里的“状态属性”若在对象属性中找不到对应字段，就在这里给一句明确解释，
  // 而不是让一个看不见的失效值把保存挡在“状态属性必须来自已定义的属性字段”上。
  const [statePropertyNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [selectedAssetCode, setSelectedAssetCode] = useState('');
  const [selectedCandidateFields, setSelectedCandidateFields] = useState([]);
  const [candidateHints, setCandidateHints] = useState([]);

  useEffect(() => {
    Promise.all([
      api(`/api/ontologies/${activeId}/interfaces`), api(`/api/ontologies/${activeId}/subject-domains`), api(`/api/ontologies/${activeId}/enterprise/governance-assets`),
    ]).then(([interfaceRows, subjectRows, assetRows]) => { setInterfaces(interfaceRows); setSubjects(subjectRows); setGovernanceAssets(assetRows); })
      .catch((loadError) => setFormError(loadError.message));
  }, [activeId]);

  const confirmedAssets = governanceAssets.filter((item) => item.verification_status === 'confirmed');
  const selectedAsset = confirmedAssets.find((item) => item.code === selectedAssetCode);
  // 主题域直接列出全部，不再按模板“业务域”过滤：模板业务域是导入的文本口径，
  // 与平台业务域对不上时会把主题域列表筛空，且服务端本来就是从主题域反推业务域。
  const changeSubject = (id) => {
    const subject = subjects.find((item) => item.id === id);
    setForm((old) => ({ ...old, subject_domain_id: id, domain: subject?.business_domain_name || old.domain }));
  };

  const addSelectedFieldCandidates = () => {
    if (!selectedAsset) return;
    const candidates = governanceFieldCandidates(selectedAsset.fields || []);
    const chosen = candidates.filter((candidate) => selectedCandidateFields.includes(candidate.candidateKey));
    const existingKeys = new Set((form.properties || []).map((property) => property.key));
    const additions = chosen.filter((candidate) => !existingKeys.has(candidate.candidateKey)).map((candidate) => {
      existingKeys.add(candidate.candidateKey);
      return { ...emptyProperty(), key: candidate.candidateKey, type: candidate.candidateType };
    });
    if (!additions.length) { notify('所选字段已在属性草稿中，或请先勾选治理字段。'); return; }
    setForm((old) => ({ ...old, properties: [...old.properties, ...additions] }));
    setCandidateHints((old) => [...old, ...chosen.filter((candidate) => additions.some((item) => item.key === candidate.candidateKey)).map((candidate) => ({ ...candidate, assetName: selectedAsset.name }))]);
    setSelectedCandidateFields([]);
    notify(`已将 ${additions.length} 个字段加入待确认属性草稿。请在“对象属性”中补全中文名称与业务定义；对象和映射尚未保存。`);
  };

  const toggleInterface = (entry) => {
    if (form.interface_ids.includes(entry.id)) { setForm({ ...form, interface_ids: form.interface_ids.filter((id) => id !== entry.id) }); return; }
    const keys = new Set(form.properties.map((item) => item.key));
    const additions = (entry.properties || []).filter((item) => !keys.has(item.key)).map((item) => ({ ...item, is_primary_key: false }));
    setForm({ ...form, interface_ids: [...form.interface_ids, entry.id], properties: [...form.properties, ...additions] });
  };
  const save = async (event) => {
    event.preventDefault();
    const validationMessage = validateObjectForm(form);
    if (validationMessage) { setFormError(validationMessage); notify(validationMessage); return; }
    setFormError(''); setBusy(true);
    try {
      const saved = await api(editing ? `/api/object-types/${editing.id}` : `/api/ontologies/${activeId}/object-types`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(objectSavePayload(form)) });
      await onSaved(saved, { assetCode: editing ? '' : selectedAssetCode });
    } catch (saveError) { setFormError(saveError.message); notify(saveError.message); setBusy(false); }
  };
  // 状态属性下拉：模板字段是“状态属性”语义，这里只允许选标注为状态属性或枚举类型的属性。
  const statePropertyOptions = form.properties.filter((item) => item.key && (item.property_category === '状态属性' || item.type === 'enum'));

  return <Modal wide closeOnBackdrop={false} title={editing ? `编辑对象类型 · ${editing.display_name}` : '新建对象类型'} subtitle="身份、归属、属性与接口在同一页完成" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>取消</button><button className="btn primary" form="object-form" disabled={busy}>{busy ? '保存中…' : '保存到工作状态'}</button></>}>
    {formError && <div className="form-error-banner" role="alert">{formError}</div>}
    <form id="object-form" className="form-sections object-editor" onSubmit={save}>
      <section className="form-section"><h3>对象身份</h3><div className="form-grid two">
        <label><span>显示名称</span><input autoFocus required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="例如：采购合同" /></label>
        <label><span>稳定标识（API 名称）</span><input className="mono" required disabled={editing && ['active', 'promoted'].includes(editing.status)} aria-invalid={Boolean(form.name && !OBJECT_API_NAME_PATTERN.test(form.name))} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setFormError(''); }} placeholder="PurchaseContract" />{form.name && !OBJECT_API_NAME_PATTERN.test(form.name) ? <small className="field-error">必须以大写英文字母开头，只能包含英文字母和数字，例如 PurchaseContract。</small> : <small>供接口和程序稳定引用，发布后不可直接修改。</small>}</label>
        <label><span>资源使用状态</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>仅表示资源是否可用，不等同模板“建模状态”。</small></label>
        <label><span>主题域</span><select value={form.subject_domain_id || ''} onChange={(e) => changeSubject(e.target.value)}><option value="">暂不分类</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.business_domain_name} / {item.name}</option>)}</select><small>可暂不分类，但提交评审前必须归入主题域。业务域由所选主题域带出，不用单独填写。</small></label>
      </div>
        <label className="core-object-toggle"><input type="checkbox" checked={Boolean(form.is_core)} onChange={(e) => setForm({ ...form, is_core: e.target.checked })} /><Star size={15} /><span><b>核心对象</b><small>业务链路的中心对象。本体图谱中会加粗、放大并标记 ★，可用“仅看核心对象”快速聚焦。</small></span></label>
        <label><span>选择图标</span><ObjectIconPicker value={form.icon} onChange={(icon) => setForm({ ...form, icon })} /></label>
        <label><span>业务定义</span><textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="说明对象的身份、业务边界和生命周期" /></label>
      </section>

      <section className="form-section"><h3>对象属性</h3>
        {!editing && <details className="object-asset-basis"><summary>从已确认治理资产带入字段（可选）</summary>
          <p className="form-hint">只读取已确认资产的字段元数据作为待确认候选，不选择物理表，也不建立数据连接或映射。</p>
          <label><span>选择已确认治理资产</span><select value={selectedAssetCode} onChange={(event) => { setSelectedAssetCode(event.target.value); setSelectedCandidateFields([]); }}><option value="">请选择已确认资产</option>{confirmedAssets.map((asset) => <option key={asset.id} value={asset.code}>{asset.name} · {asset.code}</option>)}</select></label>
          {!confirmedAssets.length && <p className="template-field-note">当前没有已确认治理资产。可先到“数据源与映射”登记并确认资产。</p>}
          {selectedAsset && <div className="oma-asset-candidate-list"><div><strong>{selectedAsset.name} · 字段候选</strong><small>字段名称和登记类型仅是元数据；中文业务名称、含义和主键均需你确认。</small></div><div className="oma-asset-candidate-rows">{governanceFieldCandidates(selectedAsset.fields || []).map((candidate) => <label key={candidate.candidateKey}><input type="checkbox" checked={selectedCandidateFields.includes(candidate.candidateKey)} onChange={() => setSelectedCandidateFields((old) => old.includes(candidate.candidateKey) ? old.filter((key) => key !== candidate.candidateKey) : [...old, candidate.candidateKey])} /><span><strong>{candidate.sourceField}</strong><small>{candidate.declaredType || '类型未登记'}</small></span><code>{candidate.candidateKey} · {dataTypeLabel(candidate.candidateType)} 候选</code></label>)}{!selectedAsset.fields?.length && <p className="template-field-note">该资产还没有字段契约；可先继续填写对象业务语义。</p>}</div><button type="button" className="btn secondary small" disabled={!selectedCandidateFields.length} onClick={addSelectedFieldCandidates}>将选中字段加入属性草稿</button></div>}
        </details>}
        {!editing && candidateHints.length > 0 && <div className="template-field-note">已暂存 {candidateHints.length} 个治理字段属性候选；请在下方补全中文名称与业务定义。它们尚未保存为对象属性，也没有建立映射。</div>}
        <PropertyEditor primaryKey templateMode label="对象属性" value={form.properties} onChange={(properties) => setForm({ ...form, properties })} />
        <div className="form-grid two">
          <label><span>标题属性</span><select value={form.title_property || ''} onChange={(e) => setForm({ ...form, title_property: e.target.value })}><option value="">默认使用主键</option>{form.properties.filter((item) => item.key).map((item) => <option key={item.key} value={item.key}>{item.name || item.key} · {item.key}</option>)}</select><small>实例列表和关系穿透中用它显示对象。</small></label>
          <label><span>状态属性</span><select value={form.state_property || ''} onChange={(e) => setForm({ ...form, state_property: e.target.value })}><option value="">未指定</option>{statePropertyOptions.map((item) => <option key={item.key} value={item.key}>{item.name || item.key} · {item.key}</option>)}{form.state_property && !statePropertyOptions.some((item) => item.key === form.state_property) && <option value={form.state_property}>{form.state_property}{form.properties.some((item) => item.key === form.state_property) ? '（当前值，未标注为状态属性）' : '（原值，属性已不存在）'}</option>}</select>{statePropertyNote && <small>{statePropertyNote}</small>}</label>
        </div>
      </section>

      <section className="form-section"><h3>实现接口</h3>
        <fieldset className="compact-check-field"><legend><Layers3 size={15} /> 实现接口（可选）</legend><p>接口只声明可复用的结构契约；外部系统调用在“系统能力与行动执行映射”管理。</p><div className="compact-check-list">{interfaces.map((entry) => <label key={entry.id}><input type="checkbox" checked={form.interface_ids.includes(entry.id)} onChange={() => toggleInterface(entry)} /><span><b>{entry.display_name}</b><code>{entry.name}</code><small>{entry.properties.length} 项属性契约</small></span></label>)}{!interfaces.length && <em>当前本体尚未定义接口，可先到“接口”页新建。</em>}</div></fieldset>
        <p className="template-field-note">保存只进入当前工作状态；映射需在“数据源与映射 → 语义映射”另行配置，对象保存不会导入实例，也不会自动创建业务行动。</p>
      </section>

      {editing && <details className="object-template-source"><summary>模板来源（只读）</summary>
        <p className="form-hint">以下字段来自《本体建模模板》导入，不是平台语义，因此不在表单里编辑；原值继续保留用于溯源。</p>
        <dl>
          <div><dt>模板对象类型 ID</dt><dd><code>{form.external_id || '未填写'}</code></dd></div>
          <div><dt>对象类别</dt><dd>{form.category || '未填写'}</dd></div>
          <div><dt>模板业务域原值</dt><dd>{form.domain || '未填写'}</dd></div>
          <div><dt>模板来源系统</dt><dd>{form.source_system || '未填写'}</dd></div>
          <div><dt>生命周期</dt><dd>{form.lifecycle || '未填写'}</dd></div>
          <div><dt>事件 / 需行动</dt><dd>{[form.is_event && '事件对象', form.requires_action && '需要行动'].filter(Boolean).join('、') || '无'}</dd></div>
          <div><dt>数据负责人</dt><dd>{form.owner || '未填写'}</dd></div>
          <div><dt>模板建模状态</dt><dd>{designStatusLabel(form.design_status)}</dd></div>
        </dl>
      </details>}
    </form>
  </Modal>;
}
