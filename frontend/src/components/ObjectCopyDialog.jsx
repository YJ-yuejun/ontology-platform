import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Copy, Link2, Star } from 'lucide-react';
import { api } from '../api';
import { STATUS_OPTIONS } from '../labels';
import Modal from './Modal';
import PropertyEditor from './PropertyEditor';
import { formFromObject, OBJECT_API_NAME_PATTERN, objectSavePayload, validateObjectForm } from './ObjectTypeEditor';
import { formFromLink } from './LinkTypeEditor';
import { copyLinkDrafts, copyObjectIdentity, NEW_OBJECT, renameLinkDrafts, validateObjectCopy } from '../objectCopy';

/**
 * 复制对象（可连同关系）。对象和关系的 API 名称在本体内唯一，所以复制不是“一键克隆”：
 * 先带出源对象的完整定义和唯一的默认名称，用户确认/修改身份、属性和要一并复制的关系后才保存。
 * 先创建对象，再逐条创建关系；关系失败不回滚对象，而是明确告诉用户哪些没建成。
 */
export default function ObjectCopyDialog({ activeId, source, objects, links, notify, onClose, onCopied }) {
  const [subjects, setSubjects] = useState([]);
  const [form, setForm] = useState(() => {
    const { form: base } = formFromObject(source);
    // 接口实现、映射来源跟随具体对象，副本默认不继承，避免两个对象争用同一份映射。
    return { ...base, ...copyObjectIdentity(source, objects), interface_ids: [], backing_source: '' };
  });
  const [drafts, setDrafts] = useState(() => copyLinkDrafts(source, links, `${source.name}Copy`));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('identity');

  useEffect(() => { api(`/api/ontologies/${activeId}/subject-domains`).then(setSubjects).catch(() => setSubjects([])); }, [activeId]);
  useEffect(() => { setDrafts((old) => renameLinkDrafts(old, source, links, form.name)); }, [form.name]);

  const objectName = (id) => (id === NEW_OBJECT ? `新副本 · ${form.display_name || '未命名'}` : objects.find((item) => item.id === id)?.display_name || '未知对象');
  const included = drafts.filter((draft) => draft.include);
  const nameError = form.name && !OBJECT_API_NAME_PATTERN.test(form.name) ? '必须以大写英文字母开头，只能包含英文字母和数字。' : objects.some((item) => item.name === form.name) ? '已被其他对象使用，请修改。' : '';
  const displayError = objects.some((item) => item.display_name === form.display_name.trim()) ? '与已有对象重名，请修改以便区分。' : '';
  const updateDraft = (linkId, patch) => setDrafts((old) => old.map((draft) => (draft.linkId === linkId ? { ...draft, ...patch } : draft)));
  const changed = useMemo(() => ({
    properties: JSON.stringify(form.properties) !== JSON.stringify(source.properties || []),
    subject: form.subject_domain_id !== (source.subject_domain_id || ''),
  }), [form, source]);

  const save = async () => {
    const message = validateObjectCopy({ form, objects, links, drafts }) || validateObjectForm(form);
    if (message) { setError(message); return; }
    setBusy(true); setError('');
    let created;
    try {
      created = await api(`/api/ontologies/${activeId}/object-types`, { method: 'POST', body: JSON.stringify(objectSavePayload(form)) });
    } catch (e) { setError(e.message); setBusy(false); return; }
    const failed = [];
    for (const draft of included) {
      const endpoint = (id) => (id === NEW_OBJECT ? created.id : id);
      const body = {
        ...formFromLink(draft.link), display_name: draft.display_name.trim(), name: draft.name,
        source_object_type_id: endpoint(draft.source_object_type_id), target_object_type_id: endpoint(draft.target_object_type_id),
        external_id: null, status: 'experimental', design_status: 'draft', reverse_name: draft.link.reverse_name ? `${draft.link.reverse_name}_copy` : '',
      };
      try { await api(`/api/ontologies/${activeId}/link-types`, { method: 'POST', body: JSON.stringify(body) }); }
      catch (e) { failed.push(`“${draft.display_name}”：${e.message}`); }
    }
    if (failed.length) notify(`对象已复制，但 ${failed.length} 个关系未能创建：${failed.join('；')}`);
    else notify(`已复制为“${created.display_name}”${included.length ? `，并复制 ${included.length} 个关系` : ''}`);
    await onCopied(created);
  };

  return <Modal wide closeOnBackdrop={false} title={`复制对象 · ${source.display_name}`} subtitle="对象和关系的 API 名称在本体内唯一，确认副本的身份后再保存" onClose={onClose} footer={<><span className="copy-footer-note">将创建 1 个对象{included.length ? `、${included.length} 个关系` : ''}</span><button className="btn secondary" onClick={onClose}>取消</button><button className="btn primary" disabled={busy || Boolean(nameError || displayError)} onClick={save}><Copy size={15} /> {busy ? '复制中…' : '创建副本'}</button></>}>
    {error && <div className="form-error-banner" role="alert">{error}</div>}
    <nav className="copy-steps" aria-label="复制内容">{[['identity', '1. 副本身份'], ['properties', `2. 属性（${form.properties.length}）`], ['links', `3. 关系（${included.length}/${drafts.length}）`]].map(([key, label]) => <button type="button" key={key} className={step === key ? 'active' : ''} onClick={() => setStep(key)}>{label}</button>)}</nav>
    <div className="form-sections">
      {step === 'identity' && <section className="form-section">
        <div className="copy-source"><span>复制自</span><b>{source.display_name}</b><code>{source.name}</code><ArrowRight size={14} /><b>{form.display_name || '未命名'}</b><code>{form.name || '—'}</code></div>
        <div className="form-grid two">
          <label><span>显示名称</span><input autoFocus required value={form.display_name} aria-invalid={Boolean(displayError)} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />{displayError ? <small className="field-error">{displayError}</small> : <small>建议改成能和源对象区分的业务名称。</small>}</label>
          <label><span>稳定标识（API 名称）</span><input className="mono" required value={form.name} aria-invalid={Boolean(nameError)} onChange={(e) => setForm({ ...form, name: e.target.value })} />{nameError ? <small className="field-error">{nameError}</small> : <small>本体内唯一；关系 API 名称会随它自动更新。</small>}</label>
          <label><span>主题域</span><select value={form.subject_domain_id || ''} onChange={(e) => { const subject = subjects.find((item) => item.id === e.target.value); setForm({ ...form, subject_domain_id: e.target.value, domain: subject?.business_domain_name || form.domain }); }}><option value="">暂不分类</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.business_domain_name} / {item.name}</option>)}</select>{changed.subject && <small>已从源对象的主题域调整。</small>}</label>
          <label><span>资源使用状态</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>副本默认“试验中”，不沿用源对象的启用状态。</small></label>
        </div>
        <label className="core-object-toggle"><input type="checkbox" checked={Boolean(form.is_core)} onChange={(e) => setForm({ ...form, is_core: e.target.checked })} /><Star size={15} /><span><b>核心对象</b><small>沿用源对象设置，可按需调整。</small></span></label>
        <label><span>业务定义</span><textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="说明副本与源对象在业务上的区别" /></label>
        <p className="template-field-note">不复制：模板对象 ID、实现接口、数据映射与实例数据。副本保存后请到“数据源与映射”为它建立自己的映射。</p>
      </section>}
      {step === 'properties' && <section className="form-section">
        <p className="form-hint">已带入源对象的全部属性。可以删减、改名或调整类型，主键仍必须唯一。{changed.properties && <b> 已修改。</b>}</p>
        <PropertyEditor primaryKey templateMode label="对象属性" value={form.properties} onChange={(properties) => setForm({ ...form, properties })} />
      </section>}
      {step === 'links' && <section className="form-section">
        {!drafts.length ? <p className="form-hint">源对象没有关联关系，只复制对象本身。</p> : <>
          <div className="copy-links-head"><p className="form-hint">勾选要一并复制的关系。副本会替换源对象所在的那一端，另一端保持不变，也可以改成其他对象。</p><button type="button" className="text-btn" onClick={() => setDrafts((old) => old.map((draft) => ({ ...draft, include: !included.length })))}>{included.length ? '全部不复制' : '全部复制'}</button></div>
          <div className="copy-links">{drafts.map((draft) => <div key={draft.linkId} className={`copy-link ${draft.include ? '' : 'off'}`}>
            <label className="copy-link-toggle"><input type="checkbox" checked={draft.include} onChange={(e) => updateDraft(draft.linkId, { include: e.target.checked })} /><Link2 size={14} /><b>{draft.link.display_name}</b><small>{draft.link.source_display_name} → {draft.link.target_display_name}</small></label>
            {draft.include && <div className="copy-link-fields">
              <label><span>关系名称</span><input value={draft.display_name} onChange={(e) => updateDraft(draft.linkId, { display_name: e.target.value })} /></label>
              <label><span>关系 API 名称</span><input className="mono" value={draft.name} onChange={(e) => updateDraft(draft.linkId, { name: e.target.value, nameTouched: true })} /></label>
              <label><span>起点</span><select value={draft.source_object_type_id} onChange={(e) => updateDraft(draft.linkId, { source_object_type_id: e.target.value })}><option value={NEW_OBJECT}>{objectName(NEW_OBJECT)}</option>{objects.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
              <label><span>终点</span><select value={draft.target_object_type_id} onChange={(e) => updateDraft(draft.linkId, { target_object_type_id: e.target.value })}><option value={NEW_OBJECT}>{objectName(NEW_OBJECT)}</option>{objects.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
              {draft.source_object_type_id !== NEW_OBJECT && draft.target_object_type_id !== NEW_OBJECT && <small className="field-error">这条关系两端都不是副本，复制后与副本无关。</small>}
            </div>}
          </div>)}</div>
        </>}
      </section>}
    </div>
  </Modal>;
}
