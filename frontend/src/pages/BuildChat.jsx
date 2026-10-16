import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUp, Bot, Check, CheckCircle2, ChevronRight, FileText, History, Info, PanelLeftClose, PanelLeftOpen, Paperclip, Plus, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { api, formatTime, saveJson } from '../api';
import { dataTypeLabel } from '../labels';
import Modal from '../components/Modal';
import { candidateErrors, inspectObjects, launchBuild, message, MODE_LABELS, readTasks, sampleCandidate, TASK_EVENT, TASK_LABELS, uid, writeTask } from '../buildConversation';
import './BuildChat.css';
import { manualEntry, resourceKind } from '../modelingFlow';

const governanceLabels = { draft: '设计中', in_review: '待评审', reviewed: '评审通过', published: '已发布' };
const fieldLabels = { display_name: '对象显示名称', name: '稳定标识（API 名称）', description: '业务定义', key: '属性字段名称', type: '数据类型', unit: '单位', options: '枚举值' };
const summarize = (c) => c.kind === 'property' ? `${c.targetName} · ${c.after.name || '未命名属性'}` : c.after.display_name || '未命名对象';
const pretty = (key, value) => key === 'type' ? dataTypeLabel(value) : Array.isArray(value) ? value.join('、') || '—' : value || '—';

export default function BuildChat({ active, ontologies, chooseOntology, notify, onCreate }) {
  const location = useLocation();
  const navigate = useNavigate();
  const taskId = new URLSearchParams(location.search).get('task');
  const [tasks, setTasks] = useState([]);
  const [query, setQuery] = useState('');
  const [historyOpen, setHistoryOpen] = useState(() => window.innerWidth >= 1300);
  const [panel, setPanel] = useState(null);
  const [panelTab, setPanelTab] = useState('definition');
  const [objects, setObjects] = useState([]);
  const [objectQuery, setObjectQuery] = useState('');
  const [loadedId, setLoadedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorFields, setErrorFields] = useState([]);
  const [more, setMore] = useState(false);
  const [snapshotId, setSnapshotId] = useState('');
  const fileInput = useRef(null);
  const scroll = useRef(null);
  const task = tasks.find((item) => item.id === taskId);
  const target = ontologies.find((item) => item.id === task?.ontologyId);
  const requestedKind = resourceKind(task?.resourceType);
  const taskModeLabel = task?.purpose === 'initialize' ? '新本体建模' : requestedKind ? `${task.purpose === 'create_resource' ? '新建' : '更新'}${requestedKind.label}` : MODE_LABELS[task?.mode];
  const resource = objects.find((item) => item.id === task?.resourceId);
  const selected = task?.candidates.find((item) => item.id === panel);
  const snapshot = (task?.snapshots || []).find((s) => s.id === snapshotId) || task?.snapshot;
  const accepted = task?.candidates.filter((item) => item.decision === 'accepted') || [];
  const locked = ['review', 'saved'].includes(task?.status);

  useEffect(() => {
    const refresh = () => { try { setTasks(readTasks()); } catch (e) { setError(e.message); } };
    refresh(); window.addEventListener(TASK_EVENT, refresh); window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(TASK_EVENT, refresh); window.removeEventListener('storage', refresh); };
  }, []);
  useEffect(() => { setPanel(null); setErrorFields([]); setConfirmOpen(false); setObjectQuery(''); }, [taskId]);
  useEffect(() => {
    let cancelled = false;
    setObjects([]); setLoadedId(''); setError('');
    if (!task?.ontologyId) { setLoading(false); return; }
    setLoading(true);
    api(`/api/ontologies/${task.ontologyId}/object-types`).then((rows) => {
      if (!cancelled) { setObjects(rows); setLoadedId(task.ontologyId); }
    }).catch((e) => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [task?.ontologyId]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' }); }, [task?.messages.length, task?.status]);

  const update = (fn) => {
    try {
      const latest = readTasks().find((item) => item.id === taskId);
      if (!latest) throw new Error('任务不存在，请新建任务。');
      return writeTask(typeof fn === 'function' ? fn(latest) : { ...latest, ...fn });
    } catch (e) { notify(`任务未保存：${e.message}`); return null; }
  };
  const openPanel = (value) => { setPanel(value); setPanelTab('definition'); setErrorFields([]); if (window.innerWidth < 1550) setHistoryOpen(false); };
  const launch = (mode) => mode === 'create' ? onCreate?.() : launchBuild(navigate, { mode, ontology: target || active }, notify);
  const goBack = () => { if (target) chooseOntology(target.id); navigate(task?.returnTo?.startsWith('/ontology/build') ? '/ontology/overview' : task?.returnTo || '/ontology/overview'); };
  const goManual = () => {
    if (target) chooseOntology(target.id);
    const next = manualEntry({ intent: task.purpose === 'create_resource' ? 'create_resource' : 'update', type: task.resourceType, ontology: target, objectCount: objects.length });
    navigate(next.route);
  };
  const validateScope = () => {
    if (task.mode === 'create') {
      if (!task.newOntology.name.trim()) return '请先填写新本体名称。';
      if (!/^[a-z][a-z0-9_.-]*$/.test(task.newOntology.namespace)) return '命名空间需以小写字母开头，可包含数字、点、横线和下划线。';
      if (ontologies.some((o) => o.namespace === task.newOntology.namespace)) return '命名空间已存在，请使用新名称或创建更新任务。';
    } else {
      if (!target) return '请先选择可访问的目标本体。';
      if (loadedId !== task.ontologyId) return '对象定义尚未加载成功，请重试加载。';
      if (task.resourceId && !resource) return '所选对象已不存在，请重新选择对象。';
    }
    return '';
  };
  const send = (event) => {
    event.preventDefault();
    const text = task?.composer?.trim();
    if (!text) return;
    if (locked) {
      update((t) => ({ ...t, composer: '', messages: [...t.messages, message('user', text), message('assistant', '本轮候选内容已生成。请在右侧表单直接修改并重新确认；如果需求或处理范围变化，请开始下一轮，原来的演示草稿会保留。', { kind: 'followup' })] }));
      return;
    }
    update((t) => ({ ...t, composer: '', goal: text, title: text.replace(/^[@/]\S+\s*/, '').slice(0, 32) || MODE_LABELS[t.mode], status: 'planning', messages: [...t.messages, message('user', text), message('assistant', t.mode === 'inspect' ? '可以先进行只读检查。确认目标后，我将读取对象定义，检查主键、字段重名和标题属性引用，不改动模型。' : '先确认这次的目标和修改范围。这里演示对话引导、表单修正和变更确认；线上智能体接入后，在同一位置返回真实候选结果。', { kind: 'plan' })] }));
    if (task.mode === 'create' || !target) openPanel('scope');
  };
  const run = () => {
    if (readTasks().find((t) => t.id === task.id)?.status !== 'planning') return;
    const problem = validateScope();
    if (problem) { setErrorFields([problem]); openPanel('scope'); setErrorFields([problem]); return; }
    if (task.mode === 'inspect') {
      const scope = resource ? [resource] : objects;
      const issues = inspectObjects(scope);
      update((t) => ({ ...t, status: 'checked', messages: [...t.messages, message('assistant', `已完成 ${scope.length} 个对象的基础结构检查。${issues.length ? `发现 ${issues.length} 个问题。` : scope.length ? '本次检查未发现问题。' : '当前没有对象可检查。'} 这不等于业务语义复核或发布校验通过。`, { kind: 'checks', issues })] }));
      setPanel(null); return;
    }
    if (requestedKind && requestedKind.id !== 'object_type') {
      update((t) => ({ ...t, status: 'planning', messages: [...t.messages, message('assistant', `已将“${requestedKind.label}”需求绑定到当前本体。此类智能体的结构化结果尚未接入本地原型，不会用对象示例冒充。可以继续补充需求，或打开对应的真实表单手动定义。`, { kind: 'handoff' })] }));
      setPanel(null); return;
    }
    try {
      const candidate = sampleCandidate(task, objects);
      update((t) => ({ ...t, status: 'review', candidates: [candidate], baselineVersion: target?.version || null, messages: [...t.messages, message('assistant', '已准备 1 项内置示例建议，供体验查看差异、编辑表单、接受或暂缓。尚未解析附件，也未调用任何智能体；请勿将其作为业务结论。', { kind: 'proposal', candidateIds: [candidate.id] })] }));
      openPanel(candidate.id);
    } catch (e) { notify(e.message); }
  };
  const editCandidate = (patch) => update((t) => ({ ...t, candidates: t.candidates.map((c) => c.id === selected.id ? { ...c, decision: 'pending', after: { ...c.after, ...patch } } : c) }));
  const decide = (candidate, decision) => {
    const errors = decision === 'accepted' ? candidateErrors(candidate, objects) : [];
    if (errors.length) { openPanel(candidate.id); setErrorFields(errors); return; }
    setErrorFields([]);
    update((t) => ({ ...t, candidates: t.candidates.map((c) => c.id === candidate.id ? { ...c, decision } : c) }));
  };
  const saveDraft = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const latest = readTasks().find((t) => t.id === task.id);
      if (!latest || latest.status === 'saved') throw new Error('本轮已保存或任务已不存在。');
      if (latest.updatedAt !== task.updatedAt) throw new Error('任务在其他页面已变化，请刷新并重新确认。');
      const scopeError = validateScope();
      if (scopeError) throw new Error(scopeError);
      const currentObjects = latest.ontologyId ? await api(`/api/ontologies/${latest.ontologyId}/object-types`) : [];
      const chosen = latest.candidates.filter((c) => c.decision === 'accepted');
      if (!chosen.length) throw new Error('请至少接受一项建议。');
      for (const c of chosen) {
        const errors = candidateErrors(c, currentObjects);
        if (errors.length) throw new Error(errors.join('；'));
        if (c.kind === 'property' && JSON.stringify(currentObjects.find((o) => o.id === c.targetId)) !== c.baseline) throw new Error('目标对象已被修改，请开始下一轮，基于最新定义重新核对。');
      }
      const savedSnapshot = { id: uid(), mode: 'prototype-only', ontologyId: latest.ontologyId, ontology: latest.newOntology, goal: latest.goal, changes: chosen, savedAt: new Date().toISOString() };
      const saved = update((t) => ({ ...t, status: 'saved', snapshot: savedSnapshot, snapshots: [...(t.snapshots || []), savedSnapshot], messages: [...t.messages, message('assistant', `已将 ${chosen.length} 项确认内容保存为本浏览器的演示草稿。真实本体和发布版本未改变。可以下载草稿供研发对接，或返回本体中心继续手动建模。`, { kind: 'saved', snapshotId: savedSnapshot.id })] }));
      if (saved) { setConfirmOpen(false); setSnapshotId(savedSnapshot.id); setPanel('saved'); }
    } catch (e) { setConfirmOpen(false); notify(e.message); } finally { setSaving(false); }
  };
  const attach = (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    if (files.length + task.attachments.length > 20) { notify('每个任务最多登记 20 个附件。'); event.target.value = ''; return; }
    update((t) => ({ ...t, attachments: [...t.attachments, ...files.map((file) => ({ id: uid(), name: file.name, size: file.size, kind: 'metadata-only' }))] }));
    notify('已登记附件名称；本轮为交互演示，未上传文件内容或进行解析。'); event.target.value = '';
  };
  const nextRound = () => {
    const next = update((t) => ({ ...t, status: 'ready', rounds: [...(t.rounds || []), { candidates: t.candidates, goal: t.goal }], candidates: [], composer: '@本体建模助手 ', messages: [...t.messages, message('assistant', '已开始下一轮。请描述新的需求；上一轮消息和已保存的演示草稿仍保留。')] }));
    if (next) { setPanel(null); setErrorFields([]); }
  };
  const history = tasks.filter((t) => `${t.title} ${t.ontologyName}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return <div className={`build-chat ${historyOpen ? '' : 'history-hidden'} ${panel ? 'with-panel' : ''}`}>
    <aside className="bc-history"><div className="bc-history-top"><button className="bc-button primary" onClick={() => navigate('/chat')}><Plus size={16} /> 新建对话</button><button className="bc-icon" title="收起对话记录" onClick={() => setHistoryOpen(false)}><PanelLeftClose size={18} /></button></div><label className="bc-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索建模任务" /></label><small className="bc-history-label">本体建模 · 本浏览器记录</small><div className="bc-history-list">{history.map((t) => <button className={t.id === taskId ? 'active' : ''} key={t.id} onClick={() => navigate(`/chat?task=${t.id}`)}><strong><span>建模</span>{t.title}</strong><small>{formatTime(t.updatedAt)} · {TASK_LABELS[t.status]}</small></button>)}{!history.length && <p className="bc-muted">暂无任务记录</p>}</div><button className="bc-history-back" onClick={() => navigate('/ontology/overview')}><History size={16} /> 本体工作台</button></aside>
    <main className="bc-main">
      <header className="bc-context"><div>{!historyOpen && <button className="bc-icon" title="展开对话记录" onClick={() => setHistoryOpen(true)}><PanelLeftOpen size={18} /></button>}<Bot size={19} /><strong>本体建模助手</strong><em>交互演示</em></div><button onClick={goBack}><ArrowLeft size={14} /> 返回本体</button></header>
      {task && <div className="bc-scope-strip"><button onClick={() => openPanel('scope')}><span>{task.mode === 'create' ? task.newOntology.name || '待定义新本体' : target?.name || '待选择本体'}</span><ChevronRight size={13} /><b>{resource?.display_name || taskModeLabel}</b><Settings2 size={14} /></button><span className="bc-state">{TASK_LABELS[task.status]}</span></div>}
      {error && <div role="alert" className="bc-error">{error}<button onClick={() => window.location.reload()}>重新加载</button></div>}
      <div className="bc-messages" ref={scroll}>
        <article className="bc-message assistant"><i><Bot size={18} /></i><div><p>你好，我是本体建模助手。你可以描述业务需求、登记领域资料，或说明已确认治理资产的业务口径与字段契约，也可以只修改已有本体的一小部分。</p><small>当前为交互演示：附件尚未上传解析，治理资产上下文也未连接真实智能体；所有候选都需人工核对，不会直接修改正式模型。</small></div></article>
        {!task && <section className="bc-starters"><h2>{taskId ? '未找到该浏览器中的任务' : '这次想完成什么？'}</h2><p>选择任务后，我会带上对应的本体上下文。不需要逐个选择智能体。</p>{[['create', '从资料创建本体', '提供业务描述、领域资料或已确认治理资产上下文'], ['update', '完善现有本体', active ? `当前：${active.name}` : '新增对象、补充属性或识别关系'], ['inspect', '检查模型定义', '只读检查，不修改已有内容']].map(([mode, label, hint]) => <button key={mode} onClick={() => launch(mode)}><Sparkles size={18} /><span><b>{label}</b><small>{hint}</small></span><ChevronRight size={16} /></button>)}</section>}
        {task?.messages.map((m) => <article key={m.id} className={`bc-message ${m.role}`}><i>{m.role === 'user' ? '我' : <Bot size={18} />}</i><div><p>{m.text}</p>
          {m.kind === 'plan' && <section className="bc-inline-card"><strong>{task.mode === 'inspect' ? '只读检查范围' : '本次建模范围'}</strong><dl><div><dt>目标本体</dt><dd>{task.mode === 'create' ? task.newOntology.name || '待补充' : task.ontologyName || '待选择'}</dd></div><div><dt>处理对象</dt><dd>{resource?.display_name || requestedKind?.label || '当前本体范围'}</dd></div><div><dt>处理边界</dt><dd>{task.mode === 'inspect' ? '仅对象结构检查' : task.resourceId ? '仅补充选中对象的属性；其他资源不修改' : requestedKind ? `只处理${requestedKind.label}；不修改其他资源` : '形成新增对象的示例建议；不删除已有资源'}</dd></div><div><dt>资料</dt><dd>{task.attachments.length} 份附件登记 · 未解析</dd></div></dl>{task.status === 'planning' && <footer><button className="bc-button" onClick={() => openPanel('scope')}>调整范围</button><button className="bc-button primary" disabled={loading || saving} onClick={run}>{task.mode === 'inspect' ? '开始只读检查' : requestedKind && requestedKind.id !== 'object_type' ? '确认范围，继续' : '确认范围，查看示例建议'}</button></footer>}</section>}
          {m.kind === 'proposal' && <section className="bc-inline-card"><header><strong>候选变更</strong><span>示例 · 非模型输出</span></header>{(m.candidateIds || []).map((id) => { const c = task.candidates.find((item) => item.id === id); return c ? <button key={id} className="bc-candidate-row" onClick={() => openPanel(c.id)}><span><b>{summarize(c)}</b><small>新增{c.kind === 'property' ? '属性' : '对象'} · {{ pending: '待确认', accepted: '已接受', deferred: '已暂缓' }[c.decision]}</small></span><ChevronRight size={16} /></button> : <p key={id} className="bc-muted">历史轮次，候选内容请查看已保存的演示草稿。</p>; })}{task.status === 'review' && <footer><button className="bc-button" onClick={nextRound}>开始下一轮</button><button className="bc-button primary" disabled={!accepted.length} onClick={() => setConfirmOpen(true)}>保存演示草稿（{accepted.length}）</button></footer>}</section>}
          {m.kind === 'checks' && <section className="bc-inline-card"><strong>基础结构检查结果</strong>{m.issues.length ? m.issues.map((issue, index) => <p key={index}>{issue}</p>) : <p>未检出问题。未检查业务语义、全部依赖、权限或运行数据。</p>}<button className="bc-button" onClick={() => launch('update')}>创建独立完善任务</button></section>}
          {m.kind === 'saved' && <button className="bc-button" onClick={() => { setSnapshotId(m.snapshotId || ''); openPanel('saved'); }}>查看演示草稿 <ChevronRight size={14} /></button>}
          {m.kind === 'followup' && <button className="bc-button" onClick={nextRound}>开始下一轮</button>}
          {m.kind === 'handoff' && <button className="bc-button" onClick={goManual}>打开{requestedKind?.label}手动配置 <ChevronRight size={14} /></button>}
        </div></article>)}
      </div>
      <form className="bc-composer" onSubmit={send}><nav><strong>智能问答 <small>本体建模已启用</small></strong><button type="button" disabled title="本次仅实现本体建模交互">生成工作流</button><button type="button" disabled title="本次仅实现本体建模交互">生成技能</button><button type="button" onClick={() => setMore(!more)}>更多能力</button>{more && <div className="bc-capabilities"><button type="button" onClick={() => { if (!task) launch('update'); setMore(false); }}>本体建模助手 <Check size={14} /></button><small>其他能力通过统一会话协议接入</small></div>}</nav>
        <div className="bc-composer-body"><span className="bc-agent-chip"><Sparkles size={13} /> 本体建模助手 <code>/ontology-creator</code></span>{task?.attachments.map((file) => <span className="bc-file-chip" key={file.id} title="仅登记附件信息，尚未上传或解析"><FileText size={13} />{file.name}<button type="button" aria-label={`移除附件 ${file.name}`} disabled={locked} onClick={() => update((t) => ({ ...t, attachments: t.attachments.filter((f) => f.id !== file.id) }))}><X size={12} /></button></span>)}<textarea aria-label="建模需求" maxLength={8000} disabled={!task} value={task?.composer || ''} onChange={(e) => update({ composer: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(e); } }} placeholder={task ? '描述业务需求，或提供已确认治理资产的口径/字段契约；Enter 发送，Shift + Enter 换行' : '请先选择上方任务，绑定本体建模上下文'} /></div>
        <footer><input hidden ref={fileInput} type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.csv,.json,.md,.txt" onChange={attach} /><button className="bc-icon" type="button" title="添加领域资料（登记附件，未解析）" disabled={!task || locked} onClick={() => fileInput.current?.click()}><Paperclip size={18} /></button><span>文件内容未上传 · 智能体待接入</span><small>{task?.composer.length || 0} / 8000</small><button className="bc-send" disabled={!task?.composer.trim() || saving} title="发送需求"><ArrowUp size={20} /></button></footer>
      </form>
    </main>
    {panel && task && <aside className="bc-panel"><header><div><strong>{panel === 'scope' ? '任务范围' : panel === 'saved' ? '演示工作草稿' : '变更详情'}</strong><small>{panel === 'scope' ? '范围只作用于本次任务' : '候选内容与正式模型分离'}</small></div><button className="bc-icon" aria-label="关闭详情，返回对话" onClick={() => setPanel(null)}><X size={19} /></button></header><div className="bc-panel-body">
      {!!errorFields.length && <div className="bc-error" role="alert">{errorFields.map((e) => <p key={e}>{e}</p>)}</div>}
      {panel === 'scope' && <><div className="bc-note">{locked ? '本轮已有候选结果，范围已锁定。修改范围请开始下一轮。' : '只填写必要信息，其他内容通过对话和结果表单逐步补充。'}</div><label>任务类型<input value={taskModeLabel} readOnly /></label>{task.mode === 'create' ? <><label>本体名称<input disabled={locked} value={task.newOntology.name} onChange={(e) => update({ newOntology: { ...task.newOntology, name: e.target.value } })} placeholder="例如：设备巡检本体" /></label><label>命名空间<input disabled={locked} value={task.newOntology.namespace} onChange={(e) => update({ newOntology: { ...task.newOntology, namespace: e.target.value } })} placeholder="enterprise.inspection" /></label><label>业务说明<textarea disabled={locked} value={task.newOntology.description} onChange={(e) => update({ newOntology: { ...task.newOntology, description: e.target.value } })} /></label></> : <><label>目标本体<select disabled={locked || task.purpose === 'initialize'} value={task.ontologyId} onChange={(e) => update({ ontologyId: e.target.value, ontologyName: ontologies.find((o) => o.id === e.target.value)?.name || '', resourceId: '', returnTo: e.target.value ? `/ontology/overview/${e.target.value}` : '/ontology/overview' })}><option value="">请选择本体</option>{ontologies.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>{(!requestedKind || requestedKind.id === 'object_type' && task.purpose !== 'create_resource') && <><label>搜索对象<input disabled={locked} value={objectQuery} onChange={(e) => setObjectQuery(e.target.value)} placeholder="搜索对象名称或稳定标识" /></label><label>处理对象<select disabled={locked || loading} value={task.resourceId} onChange={(e) => update({ resourceId: e.target.value })}><option value="">整个本体（可提出新增对象建议）</option>{objects.filter((o) => o.id === task.resourceId || `${o.display_name} ${o.name}`.toLowerCase().includes(objectQuery.toLowerCase())).map((o) => <option key={o.id} value={o.id}>{o.display_name} · {o.name}</option>)}</select></label></>}{requestedKind && <p className="bc-note">本次范围：{requestedKind.label}。具体定义由对话进一步确认。</p>}{task.purpose === 'initialize' && <p className="bc-note">本体已创建，名称、命名空间和业务说明已带入；无需重复填写。</p>}{target && <div className="bc-note">当前本体：{governanceLabels[target.status] || target.status} · {target.version}<br />{target.status === 'draft' ? '真实接入后，确认内容可进入工作状态。' : target.status === 'published' ? '真实接入后需先派生工作副本，不能覆盖已发布版本。' : '真实接入后，写入前需按权限退回设计中，并重新评审。'}</div>}</>}<p className="bc-muted">关系、规则等依赖可供分析；超出本次范围的修改必须再次确认。</p></>}
      {selected && <><nav className="bc-detail-tabs">{[['definition', '定义'], ['diff', '变更'], ['evidence', '依据']].map(([id, label]) => <button key={id} className={panelTab === id ? 'active' : ''} onClick={() => setPanelTab(id)}>{label}</button>)}</nav><h3>{summarize(selected)}</h3>{panelTab === 'definition' && <fieldset disabled={task.status === 'saved'}>{selected.kind === 'property' ? <><label>所属对象<input readOnly value={selected.targetName} /></label><label>属性名称<input value={selected.after.name} onChange={(e) => editCandidate({ name: e.target.value })} /></label><label>属性字段名称<input value={selected.after.key} onChange={(e) => editCandidate({ key: e.target.value })} /></label><label>数据类型<select value={selected.after.type} onChange={(e) => editCandidate({ type: e.target.value })}>{['string', 'integer', 'decimal', 'boolean', 'datetime', 'enum'].map((type) => <option key={type} value={type}>{dataTypeLabel(type)}</option>)}</select></label>{selected.after.type === 'enum' && <label>枚举值<input value={(selected.after.options || []).join(',')} onChange={(e) => editCandidate({ options: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} placeholder="多个枚举值用逗号分隔" /></label>}<label>单位<input value={selected.after.unit} onChange={(e) => editCandidate({ unit: e.target.value })} /></label></> : <><label>对象显示名称<input value={selected.after.display_name} onChange={(e) => editCandidate({ display_name: e.target.value })} /></label><label>稳定标识（API 名称）<input value={selected.after.name} onChange={(e) => editCandidate({ name: e.target.value })} /></label><p className="bc-note">这里只演示对象身份提案。属性、主键、分类等完整字段仍在现有对象类型表单中维护；该示例不能直接发布。</p></>}<label>业务定义<textarea value={selected.after.description} onChange={(e) => editCandidate({ description: e.target.value })} /></label><small>编辑后会恢复“待确认”，需要重新接受；不会改动原对象。</small></fieldset>}{panelTab === 'diff' && <div className="bc-diff"><div className="bc-note">新增{selected.kind === 'property' ? '属性' : '对象'}；原有对象及属性不删除、不覆盖。</div><div className="bc-diff-head"><span>字段</span><span>原值</span><span>建议值</span></div>{Object.entries(selected.after).filter(([key]) => key !== 'options' || selected.after.type === 'enum').map(([key, value]) => <div key={key}><b>{key === 'name' && selected.kind === 'property' ? '属性名称' : fieldLabels[key]}</b><del>不存在</del><ins>{pretty(key, value)}</ins></div>)}</div>}{panelTab === 'evidence' && <><div className="bc-note"><Info size={16} />{selected.basis}</div><h4>登记的资料</h4>{task.attachments.map((file) => <p key={file.id}><FileText size={15} /> {file.name} <small>未解析，不能作为证据引用</small></p>)}{!task.attachments.length && <p>未登记资料。正式结果应定位到文件段落、Sheet 行号或来源字段。</p>}</>}</>}
      {panel === 'saved' && (snapshot ? <><div className="bc-note success"><CheckCircle2 size={17} /> 已保存到本浏览器；未写入真实本体</div><p>{snapshot.changes.length} 项确认内容 · {formatTime(snapshot.savedAt)}</p>{snapshot.changes.map((c) => <div className="bc-snapshot-item" key={c.id}><strong>{summarize(c)}</strong><p>{c.after.description}</p></div>)}<button className="bc-button" onClick={() => saveJson(`本体建模演示草稿-${task.id.slice(0, 8)}.json`, snapshot)}>下载演示草稿</button><h4>正式接入后的后续流程</h4><p>确认写入工作状态 → 提交评审 → 评审通过 → 发布。</p><small>当前演示草稿未进入上述流程。已有本体的治理页面保留不变。</small></> : <p>尚未保存演示草稿。</p>)}
    </div><footer>{panel === 'scope' && (locked ? <button className="bc-button" onClick={nextRound}>开始下一轮并调整范围</button> : <button className="bc-button primary" onClick={() => { const problem = validateScope(); if (problem) setErrorFields([problem]); else { setPanel(null); setErrorFields([]); } }}>确认范围，返回对话</button>)}{selected && task.status !== 'saved' && <><button className="bc-button" onClick={() => decide(selected, 'deferred')}>暂缓</button><button className="bc-button primary" onClick={() => decide(selected, 'accepted')}><Check size={15} />{selected.decision === 'accepted' ? '已接受' : '接受此项'}</button></>}{panel === 'saved' && <button className="bc-button" onClick={goBack}>返回本体工作台</button>}</footer></aside>}
    {confirmOpen && <Modal title="保存本次演示草稿" subtitle="仅保存本浏览器的交互演示数据，不写入本体数据库" onClose={() => !saving && setConfirmOpen(false)} footer={<><button className="btn secondary" disabled={saving} onClick={() => setConfirmOpen(false)}>取消</button><button className="btn primary" disabled={saving} onClick={saveDraft}>{saving ? '核对中…' : '确认保存演示草稿'}</button></>}><p>目标：{task.mode === 'create' ? task.newOntology.name : task.ontologyName}</p><p>保存 {accepted.length} 项已接受内容。未接受项不保存；已发布版本不受影响。</p><ul>{accepted.map((c) => <li key={c.id}>{summarize(c)}</li>)}</ul><p>已读取的目标对象如有变化，将阻止保存并提示重新核对。</p></Modal>}
  </div>;
}
