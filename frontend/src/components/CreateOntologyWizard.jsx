import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { api } from '../api';
import { validateOntologyIdentity } from '../modelingFlow';
import Modal from './Modal';
import { MethodChoices } from './ModelingEntry';

export default function CreateOntologyWizard({ ontologies, onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: '', namespace: '', description: '' });
  const [method, setMethod] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  const createdRef = useRef(null);
  const next = (event) => {
    event.preventDefault();
    const problem = validateOntologyIdentity(form, ontologies);
    if (problem) { setError(problem); return; }
    setError(''); setStep(2);
  };
  const create = async () => {
    if (!method || submitted.current) return;
    const problem = !createdRef.current && validateOntologyIdentity(form, ontologies);
    if (problem) { setError(problem); setStep(1); return; }
    submitted.current = true; setBusy(true); setError('');
    try {
      // A failed post-create navigation must never create a second ontology.
      if (!createdRef.current) createdRef.current = await api('/api/ontologies', { method: 'POST', body: JSON.stringify({ name: form.name.trim(), namespace: form.namespace.trim(), description: form.description.trim() }) });
      await onCreated(createdRef.current, method);
    } catch (e) { setError(createdRef.current ? `本体已创建，但打开失败：${e.message}。重试不会重复创建。` : e.message); }
    finally { setBusy(false); submitted.current = false; }
  };
  return <Modal closeOnBackdrop={false} title="新建本体" subtitle="先定义业务范围，再选择如何开始建模" onClose={() => !busy && onClose()} footer={<><button className="btn secondary" disabled={busy} onClick={onClose}>取消</button>{step === 2 && <button className="btn secondary" disabled={busy || Boolean(createdRef.current)} onClick={() => setStep(1)}><ArrowLeft size={14} /> 上一步</button>}{step === 1 ? <button className="btn primary" form="create-ontology-identity">下一步：选择建模方式 <ArrowRight size={15} /></button> : <button className="btn primary" disabled={!method || busy} onClick={create}>{busy ? '创建中…' : createdRef.current ? '继续打开已创建本体' : method === 'smart' ? '创建并开始智能构建' : method === 'manual' ? '创建并开始手动建模' : '请选择建模方式'}</button>}</>}>
    <nav className="modeling-steps" aria-label="新建本体步骤"><span className={step === 1 ? 'current' : 'done'}><i>{step === 2 ? <Check size={13} /> : '1'}</i>填写本体信息</span><ArrowRight size={15} /><span className={step === 2 ? 'current' : ''}><i>2</i>选择建模方式</span></nav>
    {error && <p className="modeling-warning" role="alert">{error}</p>}
    {step === 1 ? <form id="create-ontology-identity" className="form-sections" onSubmit={next}>
      <section className="form-section"><h3>基础标识</h3>
        <label><span>本体名称</span><input autoFocus required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：供应链运营本体" /></label>
        <label><span>命名空间</span><input required maxLength={120} value={form.namespace} onChange={(e) => setForm({ ...form, namespace: e.target.value })} placeholder="enterprise.supplychain" /><small>本体的唯一标识，小写字母开头，可使用数字、点、横线和下划线。</small></label>
      </section>
      <section className="form-section"><h3>业务范围</h3><label><span>业务说明</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="这个本体覆盖什么业务，需要解决哪些问题？" /></label></section>
    </form> : <><div className="modeling-identity-summary"><strong>{form.name}</strong><code>{form.namespace}</code><p>{form.description || '未填写业务说明，可后续补充。'}</p></div><MethodChoices value={method} onChange={setMethod} disabled={busy} /><p className="modeling-hint">确认后创建本体。智能方式自动携带以上信息进入问答；手动方式直接进入本体工作台，并在“新建资源”旁提供首次指引。</p><p className="modeling-hint">本体信息会真实保存；智能建议仍为演示，不会自动生成正式模型。</p></>}
  </Modal>;
}
