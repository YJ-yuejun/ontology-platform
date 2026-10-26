import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../api';
import { USAGE_STATUS_OPTIONS } from '../labels';
import Modal from './Modal';

// 图谱检查器里编辑主题域。编码是稳定引用，创建后不可修改，与“业务主题”页口径一致。
export function SubjectDomainQuickEditor({ activeId, subject, notify, onClose, onSaved }) {
  const [domains, setDomains] = useState([]);
  const [form, setForm] = useState({ business_domain_id: subject.business_domain_id, code: subject.code, name: subject.name, description: subject.description || '', owner: subject.owner || '', status: subject.status });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api(`/api/ontologies/${activeId}/business-domains`).then(setDomains).catch((e) => setError(e.message)); }, [activeId]);
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const saved = await api(`/api/subject-domains/${subject.id}`, { method: 'PUT', body: JSON.stringify(form) });
      notify(`已保存主题域“${saved.name}”`); await onSaved(saved);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return <Modal title={`编辑主题域 · ${subject.name}`} subtitle="分类变更进入当前工作状态，并由统一变更日志留痕" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>取消</button><button form="subject-quick-form" className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存到工作状态'}</button></>}>
    {error && <div className="form-error-banner" role="alert">{error}</div>}
    <form id="subject-quick-form" className="form-sections" onSubmit={save}><section className="form-section">
      <div className="form-grid two">
        <label><span>主题域名称</span><input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label><span>稳定编码</span><input disabled className="mono" value={form.code} /><small>编码用于稳定引用，创建后不可修改。</small></label>
        <label><span>所属业务域</span><select required value={form.business_domain_id} onChange={(e) => setForm({ ...form, business_domain_id: e.target.value })}>{domains.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>调整后，下属对象的业务域随之变化。</small></label>
        <label><span>使用状态</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{USAGE_STATUS_OPTIONS.filter(([key]) => key !== 'experimental' || subject.status === 'experimental').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label><span>负责人</span><input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></label>
      </div>
      <label><span>业务说明</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
    </section></form>
  </Modal>;
}

export function SubjectDomainRemoveDialog({ subject, objectCount, notify, onClose, onRemoved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true); setError('');
    try { await api(`/api/subject-domains/${subject.id}`, { method: 'DELETE' }); notify(`已删除主题域“${subject.name}”`); await onRemoved(); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return <Modal title="删除主题域" subtitle={subject.name} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>取消</button><button className="btn danger" disabled={busy} onClick={remove}><Trash2 size={15} /> {busy ? '删除中…' : '确认删除'}</button></>}>
    <div className="remove-dialog">
      {error && <div className="form-error-banner" role="alert">{error}</div>}
      <p>删除后，其下 <b>{objectCount}</b> 个对象类型会变为“未分类”。对象类型及其属性、关系、规则和动作不会被删除，之后可重新归入其他主题域。</p>
      {objectCount > 0 && <p className="template-field-note">提交评审前，所有对象都必须归入主题域。</p>}
    </div>
  </Modal>;
}
