import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, KeyRound, Layers3, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import { dataTypeLabel, designStatusLabel, designStatusValue, statusLabel, STATUS_OPTIONS } from '../labels';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import { ObjectIconPicker, ObjectTypeIcon } from '../components/ObjectTypeIcon';
import PropertyEditor, { emptyProperty } from '../components/PropertyEditor';
import { EmptyState, ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';
import useCreateIntent from '../hooks/useCreateIntent';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import { useModelingEntry } from '../components/ModelingEntry';
import { governanceFieldCandidates, objectMappingState } from '../objectMapping';

const emptyForm = () => ({
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

export default function ObjectTypes({ activeId, active, refreshOntologies, notify }) {
  const navigate = useNavigate();
  const { requestResource, requestUpdate } = useModelingEntry();
  const [items, setItems] = useState(null);
  const [interfaces, setInterfaces] = useState([]);
  const [sources, setSources] = useState([]);
  const [governanceAssets, setGovernanceAssets] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  // 模板里的“状态属性”若在对象属性中找不到对应字段，就在这里给一句明确解释，
  // 而不是让一个看不见的失效值把保存挡在“状态属性必须来自已定义的属性字段”上。
  const [statePropertyNote, setStatePropertyNote] = useState('');
  const [creationBasis, setCreationBasis] = useState('semantic');
  const [selectedAssetCode, setSelectedAssetCode] = useState('');
  const [selectedCandidateFields, setSelectedCandidateFields] = useState([]);
  const [candidateHints, setCandidateHints] = useState([]);
  const [mappingHint, setMappingHint] = useState(null);

  const load = async (preferredId) => {
    setError('');
    try {
      const [objects, interfaceRows, sourceRows, assetRows, mappingRows, subjectRows] = await Promise.all([
        api(`/api/ontologies/${activeId}/object-types`), api(`/api/ontologies/${activeId}/interfaces`),
        api(`/api/ontologies/${activeId}/enterprise/data-sources`), api(`/api/ontologies/${activeId}/enterprise/governance-assets`), api(`/api/ontologies/${activeId}/enterprise/data-mappings`), api(`/api/ontologies/${activeId}/subject-domains`),
      ]);
      setItems(objects); setInterfaces(interfaceRows); setSources(sourceRows); setGovernanceAssets(assetRows); setMappings(mappingRows); setSubjects(subjectRows);
      setSelected((old) => objects.find((item) => item.id === (preferredId || old?.id)) || objects[0] || null);
    } catch (loadError) { setError(loadError.message); }
  };
  useEffect(() => { setItems(null); load(); }, [activeId]);

  const filtered = useMemo(() => (items || []).filter((item) => (
    (status === 'all' || item.status === status)
    && `${item.display_name} ${item.name} ${item.external_id || ''} ${item.description || ''} ${item.domain || ''} ${item.subject_domain_name || ''}`.toLowerCase().includes(query.toLowerCase())
  )), [items, query, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, status, pageSize]);
  useEffect(() => { if (items && !filtered.some((item) => item.id === selected?.id)) setSelected(filtered[0] || null); }, [items, filtered, selected?.id]);
  useHistoryResourceFocus({ resourceTypes: ['object_type', '对象'], items, visible: filtered, pageSize, setPage, onSelect: setSelected, ready: Boolean(items) });
  const interfaceName = (id) => interfaces.find((item) => item.id === id)?.display_name || '未知接口';
  const sourceName = (code) => sources.find((item) => item.code === code)?.name || code || '未映射';
  const mappingState = (item) => objectMappingState(item, mappings);
  const confirmedAssets = governanceAssets.filter((item) => item.verification_status === 'confirmed');
  const selectedAsset = confirmedAssets.find((item) => item.code === selectedAssetCode);
  const mappingHintAsset = selected && mappingHint?.objectId === selected.id
    ? confirmedAssets.find((item) => item.code === mappingHint.assetCode) : null;
  // 主题域直接列出全部，不再按模板“业务域”过滤：模板业务域是导入的文本口径，
  // 与平台业务域对不上时会把主题域列表筛空，且服务端本来就是从主题域反推业务域。
  const availableSubjects = subjects;
  const changeSubject = (id) => {
    const subject = subjects.find((item) => item.id === id);
    setForm((old) => ({ ...old, subject_domain_id: id,
      domain: subject?.business_domain_name || old.domain }));
  };

  const startManualCreate = () => {
    setForm(emptyForm()); setFormError(''); setCreating(true); setEditing(null); setStatePropertyNote('');
    setCreationBasis('semantic'); setSelectedAssetCode(''); setSelectedCandidateFields([]); setCandidateHints([]);
  };
  const startCreate = () => requestResource({ type: 'object_type', onManual: startManualCreate });
  const startEdit = (item) => {
    // 历史（模板导入）可能留下指向不存在属性的 title_property / state_property。
    // 这类失效引用不能直接把用户挡在保存之外：先按当前属性重置，并留一句可读的解释。
    const properties = item.properties || [];
    const keys = new Set(properties.map((property) => property.key));
    const statePropertyValid = Boolean(item.state_property) && keys.has(item.state_property);
    const titlePropertyValid = !item.title_property || keys.has(item.title_property);
    const templateStateName = (item.template_raw && item.template_raw['状态属性']) || '';
    if (item.state_property && !statePropertyValid) {
      setStatePropertyNote(`模板记录的状态属性「${templateStateName || item.state_property}」在当前对象属性里找不到对应字段，已重置为「未指定」；模板原值仍保留在对象元数据中，请按需重新选择。`);
    } else if (!item.state_property && templateStateName) {
      setStatePropertyNote(`模板记录的状态属性是「${templateStateName}」，但对象属性里没有对应字段，因此未设置状态属性；可以在下方选择一项，或先到“属性定义”补上该属性。`);
    } else {
      setStatePropertyNote('');
    }
    setForm({ ...emptyForm(), ...item, properties, interface_ids: item.interface_ids || [], subject_domain_id: item.subject_domain_id || '', backing_source: item.backing_source || '', external_id: item.external_id || '', design_status: designStatusValue(item.design_status), is_core: Boolean(item.is_core), is_event: Boolean(item.is_event), requires_action: Boolean(item.requires_action), title_property: titlePropertyValid ? (item.title_property || '') : '', state_property: statePropertyValid ? item.state_property : '' });
    setFormError(''); setEditing(item); setCreating(false);
  };
  const close = () => { setCreating(false); setEditing(null); setFormError(''); setStatePropertyNote(''); };
  useCreateIntent(Boolean(items), startManualCreate);

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
      const body = {
        ...form,
        external_id: form.external_id || null,
        plural_name: null, group_ids: [], object_kind: 'business_object', parent_type_id: null,
      };
      const saved = await api(editing ? `/api/object-types/${editing.id}` : `/api/ontologies/${activeId}/object-types`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(body) });
      if (!editing) setMappingHint({ objectId: saved.id, assetCode: creationBasis === 'governed_asset' ? selectedAssetCode : '' });
      close(); await load(saved.id); refreshOntologies(activeId); notify('对象类型已保存到工作状态');
    } catch (saveError) { setFormError(saveError.message); notify(saveError.message); } finally { setBusy(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(`确定删除对象类型“${item.display_name}”吗？`)) return;
    try { await api(`/api/object-types/${item.id}`, { method: 'DELETE' }); await load(); refreshOntologies(activeId); } catch (removeError) { notify(removeError.message); }
  };
  // 状态属性下拉：模板字段是“状态属性”语义，这里只允许选标注为状态属性或枚举类型的属性。
  const statePropertyOptions = form.properties.filter((item) => item.key && (item.property_category === '状态属性' || item.type === 'enum'));
  const openSemanticMapping = (item, assetCode = '') => {
    const params = new URLSearchParams({ object: item.name });
    if (assetCode) params.set('asset', assetCode);
    navigate(`/ontology/data/connections?${params.toString()}`);
  };
  const selectedMappingState = selected ? mappingState(selected) : null;
  const mappingCoverageText = (state) => (state.requiredCount > 0
    ? `已覆盖 ${state.mappedCount}/${state.requiredCount} 个需映射属性`
    : '当前没有需建立来源映射的属性');

  if (error) return <ErrorState message={error} onRetry={() => load()} />;
  if (!items) return <Loading />;
  return <div className="oma-resource-page">
    <section className="oma-resource-toolbar"><div className="oma-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索对象、模板 ID、稳定标识或主题域" /></div><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">全部资源状态</option>{STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><span>显示 {filtered.length} / 共 {items.length} 个</span><button className="bc-button" disabled={!selected} title={`更新：${selected?.display_name || '先选择对象'}`} onClick={() => requestUpdate({ type: 'object_type', resource: selected, onManual: () => startEdit(selected), returnTo: '/ontology/model/object-types' })}>更新选中对象</button><button className="oma-button" onClick={startCreate}><Plus size={15} /> 新建对象类型</button></section>
    <div className="oma-resource-layout"><section className="oma-resource-list"><header><strong>对象类型目录</strong><span>对象直接归属主题域；对象类别保留模板字段</span></header>{!filtered.length ? <EmptyState title="暂无对象类型" description="创建第一个可产生实例的业务对象。" action={<button className="oma-button" onClick={startCreate}><Plus size={15} /> 新建对象类型</button>} /> : <div className="oma-object-table simple"><div className="oma-object-head"><span>对象名称</span><span>模板 ID</span><span>资源状态</span><span>属性</span><span>对象类别 / 归属业务域</span><span>映射状态</span></div>{pageRows.map((item) => { const state = mappingState(item); return <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item)}><span className="oma-resource-name"><i><ObjectTypeIcon value={item.icon} /></i><b>{item.display_name}</b></span><code>{item.external_id || item.name}</code><span><em className={`oma-status ${item.status}`}>{statusLabel(item.status)}</em></span><span>{item.properties.length} 项</span><span className="oma-detail">{item.category || '未填写'} / {item.business_domain_name || '未分类'}</span><span className={`oma-mapping-state ${state.label === '已确认' || state.label === '无需映射' ? 'confirmed' : ''}`} title={`${mappingCoverageText(state)}${state.count ? `；已有 ${state.confirmedCount}/${state.count} 条映射确认` : ''}`}>{state.label} · {state.requiredCount > 0 ? `${state.mappedCount}/${state.requiredCount}` : '无需'}{state.count ? ` · ${state.confirmedCount}/${state.count} 确认` : ''}</span></button>; })}</div>}<PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></section>
      <aside className="oma-resource-inspector">{selected ? <><header><span>对象详情</span><div><ResourceHistoryLink resourceType="object_type" resourceId={selected.id} /><button onClick={() => startEdit(selected)}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={() => remove(selected)}><Trash2 size={14} /> 删除</button></div></header><div className="oma-inspector-title"><i><ObjectTypeIcon value={selected.icon} size={18} /></i><div><h3>{selected.display_name}</h3><code>{selected.name}</code></div></div><p>{selected.description || '尚未填写业务说明。'}</p><dl><div><dt>模板对象类型 ID</dt><dd><code>{selected.external_id || '未填写'}</code></dd></div><div><dt>对象类别</dt><dd>{selected.category || '未填写'}</dd></div><div><dt>归属业务域 / 主题域</dt><dd>{selected.business_domain_name || '未分类'} / {selected.subject_domain_name || '未分类'}</dd></div><div><dt>模板业务域原值</dt><dd>{selected.domain || '未填写'}</dd></div><div><dt>资源使用状态</dt><dd><em className={`oma-status ${selected.status}`}>{statusLabel(selected.status)}</em></dd></div><div><dt>模板建模状态</dt><dd>{designStatusLabel(selected.design_status)}</dd></div><div><dt>模板来源系统</dt><dd>{selected.source_system || '未填写'}</dd></div><div><dt>映射状态</dt><dd>{selectedMappingState.label} · {selectedMappingState.requiredCount > 0 ? `${selectedMappingState.mappedCount}/${selectedMappingState.requiredCount} 个需映射属性` : '无需来源映射'}{selectedMappingState.count ? ` · ${selectedMappingState.confirmedCount}/${selectedMappingState.count} 条映射已确认` : ''}</dd></div>{selected.backing_source && <div><dt>历史直接来源</dt><dd>{sourceName(selected.backing_source)}</dd></div>}<div><dt>标题属性</dt><dd><code>{selected.title_property}</code></dd></div><div><dt>实现接口</dt><dd>{(selected.interface_ids || []).map(interfaceName).join('、') || '无'}</dd></div></dl>
        <section className="oma-mapping-setup"><div><strong>语义映射</strong><em className={`oma-mapping-state ${selectedMappingState.label === '已确认' || selectedMappingState.label === '无需映射' ? 'confirmed' : ''}`}>{selectedMappingState.label}</em></div><p>{mappingCoverageText(selectedMappingState)}{selectedMappingState.count ? `；已存属性映射 ${selectedMappingState.confirmedCount}/${selectedMappingState.count} 条已确认、${selectedMappingState.pendingCount} 条待确认` : ''}。保存对象定义不会导入或读取实例数据。</p>{mappingHintAsset && <small>创建时选择的参考治理资产：{mappingHintAsset.name}（仅作为映射上下文）</small>}<button className="btn secondary" onClick={() => openSemanticMapping(selected, mappingHintAsset?.code)}>{selectedMappingState.count ? '检查或补充映射' : selectedMappingState.requiredCount > 0 ? '建立语义映射' : '配置可选映射'} <ChevronRight size={14} /></button></section>
        {selected.source_binding_issue && !selected.backing_source && <p className="template-field-note">{selected.source_binding_issue}。模板原值是“{selected.source_system}”，请通过治理资产建立新的语义映射。</p>}<div className="oma-interface-props"><strong>对象属性</strong>{selected.properties.map((prop) => <div key={prop.key}><span>{prop.name}{prop.is_primary_key && <KeyRound size={11} />}{prop.is_required && <em>必填</em>}</span><code>{prop.key} · {dataTypeLabel(prop.type)}{prop.source_field ? ` · ${prop.source_field}` : ''}</code></div>)}</div></> : <EmptyState title="请选择对象" description="从左侧目录查看对象定义。" />}</aside></div>

    {(creating || editing) && <Modal wide closeOnBackdrop={false} title={editing ? `编辑对象类型 · ${editing.display_name}` : '新建对象类型'} subtitle="身份、归属、属性与接口在同一页完成" onClose={close} footer={<><button className="btn secondary" onClick={close}>取消</button><button className="btn primary" form="object-form" disabled={busy}>{busy ? '保存中…' : '保存到工作状态'}</button></>}>
      {formError && <div className="form-error-banner" role="alert">{formError}</div>}
      <form id="object-form" className="form-sections object-editor" onSubmit={save}>
        <section className="form-section"><h3>对象身份</h3><div className="form-grid two">
          <label><span>显示名称</span><input autoFocus required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="例如：采购合同" /></label>
          <label><span>稳定标识（API 名称）</span><input className="mono" required disabled={editing && ['active', 'promoted'].includes(editing.status)} aria-invalid={Boolean(form.name && !OBJECT_API_NAME_PATTERN.test(form.name))} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setFormError(''); }} placeholder="PurchaseContract" />{form.name && !OBJECT_API_NAME_PATTERN.test(form.name) ? <small className="field-error">必须以大写英文字母开头，只能包含英文字母和数字，例如 PurchaseContract。</small> : <small>供接口和程序稳定引用，发布后不可直接修改。</small>}</label>
          <label><span>资源使用状态</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>仅表示资源是否可用，不等同模板“建模状态”。</small></label>
          <label><span>主题域</span><select value={form.subject_domain_id || ''} onChange={(e) => changeSubject(e.target.value)}><option value="">暂不分类</option>{availableSubjects.map((item) => <option key={item.id} value={item.id}>{item.business_domain_name} / {item.name}</option>)}</select><small>可暂不分类，但提交评审前必须归入主题域。业务域由所选主题域带出，不用单独填写。</small></label>
        </div>
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
            <div><dt>核心 / 事件 / 需行动</dt><dd>{[form.is_core && '核心对象', form.is_event && '事件对象', form.requires_action && '需要行动'].filter(Boolean).join('、') || '无'}</dd></div>
            <div><dt>数据负责人</dt><dd>{form.owner || '未填写'}</dd></div>
            <div><dt>模板建模状态</dt><dd>{designStatusLabel(form.design_status)}</dd></div>
          </dl>
        </details>}
      </form>
    </Modal>}
  </div>;
}
