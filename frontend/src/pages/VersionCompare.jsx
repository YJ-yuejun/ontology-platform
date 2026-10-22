import { useMemo, useState } from 'react';
import {
  ArrowLeftRight, ArrowRight, Bot, Boxes, ChevronDown, ChevronRight, CircleAlert, FileSearch,
  Fingerprint, GitBranch, GitCompareArrows, Layers3, ListTree, Search, Send,
  ShieldCheck, Sparkles, X, Zap,
} from 'lucide-react';
import { MOCK_COMPARE, MOCK_COMPARE_META, MOCK_ONTOLOGY_A, MOCK_ONTOLOGY_B, NUMBERING_RULES } from '../compareMock';
import {
  FIELD_LABELS, RESOURCE_ORDER, answerCompareQuestion, detectRenameSuggestions, dimensionLabel,
  driftTitle, formLabel, groupSource, ownerLabel, prettyValue, relatedDrifts, renameForDrift,
  severityLabel, severityReason,
} from '../compareInsights';
import './VersionCompare.css';

const RESOURCE_ICONS = { 对象类型: Boxes, 对象属性: ListTree, 关系: GitBranch, 业务规则: ShieldCheck, 业务行动: Zap };
const AI_SUGGESTIONS = ['总结主要差异', 'P0 风险有哪些？', '产品对象是不是改名？', '订单迁移影响什么？'];

function StatusBadge({ status }) {
  if (!status) return <span className="vc-status absent">不存在</span>;
  return <span className={`vc-status ${status === '已启用' ? 'on' : 'off'}`}>{status}</span>;
}

function SeverityBadge({ severity }) {
  return <em className={`vc-sev ${severity}`}>{severity}</em>;
}

function FormBadge({ form }) {
  return <em className={`vc-form-badge ${form}`}>{formLabel(form)}</em>;
}

export default function VersionCompare() {
  const baseDrifts = useMemo(() => groupSource(MOCK_COMPARE.drifts).flatMap((group) => group.items), []);
  const groups = useMemo(() => groupSource(MOCK_COMPARE.drifts), []);
  const renames = useMemo(() => detectRenameSuggestions(MOCK_COMPARE.drifts), []);
  const [selectedId, setSelectedId] = useState('removed|对象类型|Prod');
  const [severity, setSeverity] = useState('all');
  const [form, setForm] = useState('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set(RESOURCE_ORDER));
  const [infoPanel, setInfoPanel] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessages, setAiMessages] = useState([{
    role: 'assistant', mode: 'rules',
    text: '我基于本次对比的 12 项差异回答。可以问我 P0 风险、产品疑似改名、订单迁移、发票删除，或某一项差异的字段变化。',
  }]);

  const summary = MOCK_COMPARE.summary;
  const dimensionCounts = useMemo(() => baseDrifts.reduce((acc, item) => {
    acc[item.dimension] = (acc[item.dimension] || 0) + 1;
    return acc;
  }, {}), [baseDrifts]);
  const filtering = severity !== 'all' || form !== 'all' || Boolean(query.trim());
  const visible = baseDrifts.filter((item) => {
    const needle = query.trim().toLowerCase();
    return (severity === 'all' || item.severity === severity)
      && (form === 'all' || item.form === form)
      && (!needle || `${item.displayName} ${item.res_key} ${item.ownerName} ${item.res_type}`.toLowerCase().includes(needle));
  });
  const selected = visible.find((item) => item.drift_id === selectedId) || visible[0] || null;
  const selectedRename = selected ? renameForDrift(selected, renames) : null;
  const visibleGroups = groups.map((group) => ({
    ...group,
    visibleItems: group.items.filter((item) => visible.some((candidate) => candidate.drift_id === item.drift_id)),
  })).filter((group) => !filtering || group.visibleItems.length);

  const selectDrift = (drift) => {
    setSelectedId(drift.drift_id);
    const group = groups.find((item) => item.type === drift.res_type);
    if (group) setExpanded((old) => new Set([...old, group.type]));
  };
  const showRenameChain = () => {
    const first = renames[0];
    if (!first) return;
    setSeverity('all'); setForm('all'); setQuery('');
    selectDrift(first.fromDrift);
  };
  const openAI = () => setAiOpen(true);
  const askSelected = () => {
    if (!selected) return;
    setAiDraft(`详细解释「${selected.displayName}」这项差异的风险、影响和下一步。`);
    setAiOpen(true);
  };
  const sendAI = (value = aiDraft) => {
    const question = String(value || '').trim();
    if (!question || aiBusy) return;
    setAiMessages((old) => [...old, { role: 'user', text: question }]);
    setAiDraft(''); setAiBusy(true);
    const answer = answerCompareQuestion(question, { compare: MOCK_COMPARE, drifts: baseDrifts, renames, domainNames: MOCK_COMPARE.domain_names });
    window.setTimeout(() => {
      setAiMessages((old) => [...old, { role: 'assistant', mode: 'rules', text: answer }]);
      setAiBusy(false);
    }, 260);
  };
  const toggleGroup = (type) => setExpanded((old) => {
    const next = new Set(old);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });

  const formSegments = [
    ['removed', summary.by_form.removed], ['added', summary.by_form.added],
    ['modified', summary.by_form.modified], ['moved', summary.by_form.moved],
  ];
  const severitySegments = [['P0', summary.by_severity.P0], ['P1', summary.by_severity.P1], ['P2', summary.by_severity.P2]];

  return <div className="vc-page">
    <header className="vc-page-head">
      <div>
        <small>本体治理 · 跨本体差异</small>
        <h1>本体对比 <em>差异分析</em></h1>
        <p>不再按发布版本对比。直接比较基线和从它复制出来的副本，追踪迭代三十多天后的语义漂移。</p>
      </div>
      <div className="vc-head-actions">
        <button type="button" onClick={() => setInfoPanel('numbering')}><Fingerprint size={15} /> 编号规则</button>
        <button type="button" onClick={() => setInfoPanel('scope')}><FileSearch size={15} /> 对比口径</button>
        <button type="button" className="primary" onClick={openAI}><Sparkles size={15} /> 问 AI</button>
      </div>
    </header>

    <section className="vc-pair-strip">
      <article className="vc-onto-card base">
        <header><span><i className="vc-role-dot" />基线本体</span><code>{MOCK_ONTOLOGY_A.number}</code></header>
        <h2>{MOCK_ONTOLOGY_A.name}</h2>
        <p>{MOCK_ONTOLOGY_A.namespace}</p>
        <footer><span>{MOCK_ONTOLOGY_A.elementCount} 个元素</span><span>{MOCK_ONTOLOGY_A.contentHash}</span><em>{MOCK_ONTOLOGY_A.updatedAt}</em></footer>
      </article>
      <div className="vc-pair-link">
        <div><GitCompareArrows size={18} /></div>
        <strong>副本派生</strong><em className="vc-demo-chip">演示对比组</em>
        <small>{MOCK_ONTOLOGY_A.number} → {MOCK_ONTOLOGY_B.number}<br />复制于 {MOCK_ONTOLOGY_B.copiedAt} · 已迭代 {MOCK_ONTOLOGY_B.iterationDays} 天</small>
      </div>
      <article className="vc-onto-card current">
        <header><span><i className="vc-role-dot" />副本本体</span><code>{MOCK_ONTOLOGY_B.number}</code></header>
        <h2>{MOCK_ONTOLOGY_B.name}</h2>
        <p>{MOCK_ONTOLOGY_B.namespace}</p>
        <footer><span>{MOCK_ONTOLOGY_B.elementCount} 个元素</span><span>{MOCK_ONTOLOGY_B.contentHash}</span><em>{MOCK_ONTOLOGY_B.updatedAt}</em></footer>
      </article>
    </section>

    <section className="vc-summary">
      <div className="vc-total"><small>差异总数</small><strong>{summary.total}</strong><span><i /> 对比成功</span></div>
      <div className="vc-sev-kpis">{severitySegments.map(([key, value]) => <div className={`vc-sev-kpi ${key}`} key={key}><small>{severityLabel(key)}</small><b>{value}</b><span>{Math.round((value / summary.total) * 100)}%</span></div>)}</div>
      <div className="vc-distribution">
        <header><span>形态分布</span><small>{MOCK_COMPARE_META.jobId} · {MOCK_COMPARE_META.compareAt}</small></header>
        <div className="vc-stack-bar">{formSegments.map(([key, value]) => <i key={key} className={key} style={{ width: `${(value / summary.total) * 100}%` }} title={`${formLabel(key)} ${value}`} />)}</div>
        <footer>{formSegments.map(([key, value]) => <span key={key}><i className={key} />{formLabel(key)} {value}</span>)}</footer>
      </div>
      <div className="vc-distribution compact">
        <header><span>维度 / 元素</span><small>{MOCK_COMPARE.global.content_hash_same ? '哈希一致' : '内容哈希不同'}</small></header>
        <div className="vc-dimension-row"><span>结构 {dimensionCounts.structural || 0}</span><span>语义 {dimensionCounts.semantic || 0}</span><span>权限 {dimensionCounts.permission || 0}</span></div>
        <div className="vc-elem-bar"><b>{MOCK_COMPARE.global.elem_counts.left}</b><i><span style={{ width: `${(MOCK_COMPARE.global.elem_counts.right / MOCK_COMPARE.global.elem_counts.left) * 100}%` }} /></i><b>{MOCK_COMPARE.global.elem_counts.right}</b></div>
        <small className="vc-elem-caption">元素数量：基线 → 副本</small>
      </div>
    </section>

    {renames.length > 0 && <section className="vc-rename-strip">
      <CircleAlert size={18} />
      <div><strong>发现 {renames.length} 组疑似改名 / 重建</strong><p>算法按“删除 + 新增”呈现；展示层把同名的对象、属性和关系串成链路，供人工确认是否同一业务对象。</p></div>
      <div className="vc-rename-chips">{renames.slice(0, 2).map((item) => <span key={`${item.kind}-${item.from}`} title={`${item.from} → ${item.to}`}><code>{item.from}</code><ArrowRight size={11} /><code>{item.to}</code></span>)}{renames.length > 2 && <span className="vc-rename-more" title={renames.slice(2).map((item) => `${item.from} → ${item.to}`).join('\n')}>+{renames.length - 2}</span>}</div>
      <button type="button" onClick={showRenameChain}>查看改名链 <ArrowRight size={13} /></button>
    </section>}

    <div className="vc-workbench">
      <aside className="vc-tree panel">
        <header><div><Layers3 size={16} /><strong>差异目录</strong></div><span>{visible.length} / {baseDrifts.length}</span></header>
        <label className="vc-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对象、属性、关系或业务键" /></label>
        <div className="vc-filter-row">
          <div className="vc-sev-filter">{[['all', '全部'], ['P0', 'P0'], ['P1', 'P1'], ['P2', 'P2']].map(([key, label]) => <button type="button" key={key} className={severity === key ? 'active' : ''} onClick={() => setSeverity(key)}>{label}</button>)}</div>
          <select value={form} onChange={(event) => setForm(event.target.value)} aria-label="按形态筛选"><option value="all">全部形态</option><option value="removed">删除</option><option value="added">新增</option><option value="modified">修改</option><option value="moved">迁移</option></select>
        </div>
        <div className="vc-tree-scroll">
          {visibleGroups.map((group) => {
            const Icon = RESOURCE_ICONS[group.type] || Boxes;
            const isOpen = expanded.has(group.type) || filtering;
            return <section className="vc-group" key={group.type}>
              <button type="button" className="vc-group-head" onClick={() => toggleGroup(group.type)}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <i><Icon size={14} /></i>
                <strong>{group.label}</strong>
                <em>{group.items.length}</em>
                <span>{group.counts.P0 > 0 && <i className="vc-mini-dot P0" title={`P0 ${group.counts.P0}`} />}{group.counts.P1 > 0 && <i className="vc-mini-dot P1" title={`P1 ${group.counts.P1}`} />}{group.counts.P2 > 0 && <i className="vc-mini-dot P2" title={`P2 ${group.counts.P2}`} />}</span>
              </button>
              {isOpen && <div className="vc-group-items">{group.visibleItems.map((drift) => <button type="button" className={`vc-drift-item ${selected?.drift_id === drift.drift_id ? 'active' : ''}`} key={drift.drift_id} onClick={() => selectDrift(drift)}>
                <i className={`vc-dot ${drift.severity}`} />
                <span><b>{drift.displayName}</b><small>{drift.res_key}</small></span>
                <FormBadge form={drift.form} />
              </button>)}</div>}
            </section>;
          })}
          {!visibleGroups.length && <p className="vc-empty-filter">没有符合当前筛选条件的差异。</p>}
        </div>
      </aside>

      <section className="vc-detail panel">
        {selected ? <>
          <header className="vc-detail-head">
            <div><span className="vc-detail-type">{selected.res_type}<code>{selected.res_key}</code></span><h2>{selected.displayName}</h2><p>{ownerLabel(selected, baseDrifts)} · 记录 ID {selected.res_id}</p></div>
            <div className="vc-detail-badges"><SeverityBadge severity={selected.severity} /><FormBadge form={selected.form} /><em className="vc-dim-badge">{dimensionLabel(selected.dimension)}</em></div>
          </header>
          <div className="vc-detail-meta">
            <span>左状态 <StatusBadge status={selected.left_status} /></span>
            <span>右状态 <StatusBadge status={selected.right_status} /></span>
            <span>归属 <b>{ownerLabel(selected, baseDrifts)}</b></span>
            {selected.note && <span className="vc-note">备注：{selected.note}</span>}
          </div>
          <div className={`vc-severity-reason ${selected.severity}`}><strong>为什么判定为 {selected.severity}？</strong><p>{severityReason(selected)}</p></div>
          {selectedRename && <div className="vc-detail-callout rename"><ArrowLeftRight size={16} /><div><strong>疑似改名 / 重建</strong><p>{selectedRename.reason}：<code>{selectedRename.from}</code> → <code>{selectedRename.to}</code>。算法仍按 {formLabel(selected.form)} 输出，确认后可把两端合并理解。</p></div></div>}
          {selected.form === 'moved' && <MoveCard drift={selected} />}
          <section className="vc-field-section">
            <header><strong>字段差异</strong><span>{selected.field_diffs.length ? `${selected.field_diffs.length} 个字段` : '无字段级差异'}</span></header>
            {selected.field_diffs.length ? <div className="vc-field-table">
              <div className="vc-field-head"><span>字段</span><span>{MOCK_ONTOLOGY_A.number} · 基线</span><span>{MOCK_ONTOLOGY_B.number} · 副本</span></div>
              {selected.field_diffs.map((item) => <div className="vc-field-row" key={item.field}>
                <span><b>{FIELD_LABELS[item.field] || item.field}</b><code>{item.field}</code></span>
                <pre>{prettyValue(item.field, item.left, MOCK_COMPARE.domain_names)}</pre>
                <pre>{prettyValue(item.field, item.right, MOCK_COMPARE.domain_names)}</pre>
              </div>)}
            </div> : <div className={`vc-existence ${selected.form}`}>
              <strong>{selected.form === 'removed' ? '基线 A 中存在，副本 B 中不存在' : '基线 A 中不存在，副本 B 中存在'}</strong>
              <p>{selected.form === 'removed' ? '删除元素没有字段级差异，但可能被属性、关系、映射、规则或页面引用。' : '新增元素没有字段级差异，需确认是否补全属性、映射和下游引用。'}</p>
            </div>}
          </section>
          {selected.embedded_diffs?.length > 0 && <section className="vc-field-section"><header><strong>嵌套差异</strong><span>{selected.embedded_diffs.length} 组</span></header>{selected.embedded_diffs.map((embedded, index) => <details className="vc-embedded" key={index}><summary>{embedded.name || embedded.res_key || `嵌套差异 ${index + 1}`}</summary>{(embedded.field_diffs || []).map((item) => <div key={item.field}><b>{FIELD_LABELS[item.field] || item.field}</b><span>{prettyValue(item.field, item.left, MOCK_COMPARE.domain_names)} → {prettyValue(item.field, item.right, MOCK_COMPARE.domain_names)}</span></div>)}</details>)}</section>}
          <section className="vc-related-section">
            <header><strong>关联差异</strong><span>{selected.related.length} 项</span></header>
            {selected.related.length ? <div className="vc-related-list">{selected.related.map((item) => <button type="button" key={item.drift_id} onClick={() => selectDrift(item)}><i className={`vc-dot ${item.severity}`} /><span><b>{driftTitle(item, baseDrifts)}</b><small>{item.res_type} · {formLabel(item.form)}</small></span><ArrowRight size={12} /></button>)}</div> : <p className="vc-related-empty">当前差异没有可关联的其他变更。</p>}
          </section>
          <footer className="vc-detail-foot">
            <button type="button" className="vc-primary" onClick={askSelected}><Sparkles size={15} /> 问 AI 这项差异</button>
            <span>原始严重级与形态不会被展示层改写；AI 解读只基于当前差异表。</span>
          </footer>
        </> : <div className="vc-detail-empty"><GitCompareArrows size={28} /><strong>没有匹配的差异</strong><p>调整左侧筛选，或清空搜索条件。</p></div>}
      </section>
    </div>

    {aiOpen && <>
      <div className="vc-ai-backdrop" onClick={() => setAiOpen(false)} />
      <aside className="vc-ai-drawer">
        <header><div><i><Bot size={17} /></i><span><strong>对比解读</strong><small>基于当前差异表 · 规则演示</small></span></div><button type="button" aria-label="关闭 AI 解读" onClick={() => setAiOpen(false)}><X size={16} /></button></header>
        <div className="vc-ai-focus"><span>当前关注</span><b>{selected?.displayName || '整体差异'}</b>{selected && <em>{selected.severity} · {formLabel(selected.form)}</em>}</div>
        <div className="vc-ai-stream">
          {aiMessages.map((message, index) => <article className={`vc-ai-message ${message.role}`} key={index}><span>{message.role === 'assistant' ? (message.mode === 'rules' ? '规则解读' : 'AI 解读') : '你'}</span><p>{message.text}</p></article>)}
          {aiBusy && <article className="vc-ai-message assistant"><span>规则解读</span><p className="vc-ai-thinking">正在整理差异链路…</p></article>}
        </div>
        <div className="vc-ai-suggestions">{AI_SUGGESTIONS.map((item) => <button type="button" key={item} disabled={aiBusy} onClick={() => sendAI(item)}>{item}</button>)}</div>
        <form className="vc-ai-composer" onSubmit={(event) => { event.preventDefault(); sendAI(); }}>
          <textarea value={aiDraft} onChange={(event) => setAiDraft(event.target.value)} placeholder="问对比细节，例如：为什么产品删除是 P0？" rows={2} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendAI(); } }} />
          <button type="submit" disabled={!aiDraft.trim() || aiBusy} aria-label="发送问题"><Send size={16} /></button>
        </form>
        <small className="vc-ai-hint">Enter 发送 · Shift + Enter 换行 · 不修改本体</small>
      </aside>
    </>}

    {infoPanel && <>
      <div className="vc-info-backdrop" onClick={() => setInfoPanel('')} />
      <aside className={`vc-info-popover ${infoPanel}`}>
        <header><div>{infoPanel === 'numbering' ? <Fingerprint size={17} /> : <FileSearch size={17} />}<strong>{infoPanel === 'numbering' ? '本体编号规则' : '对比口径'}</strong></div><button type="button" aria-label="关闭" onClick={() => setInfoPanel('')}><X size={15} /></button></header>
        {infoPanel === 'numbering' ? <div className="vc-info-body">
          <p>6 位编号 = <b>3 位本体族编号</b> + <b>3 位副本序号</b>。复制时末三位自增；手动新建分配新族号。</p>
          <div className="vc-numbering-list">{NUMBERING_RULES.map((item) => <div key={item.number}><code>{item.number}</code><span><b>{item.label}</b><small>{item.kind} · {item.note}</small></span></div>)}</div>
          <p className="vc-info-note">编号只服务识别和展示；内部仍然使用不可变 ID。对比按业务键匹配，不按编号或 ID 匹配。</p>
        </div> : <div className="vc-info-body">
          <p className="vc-scope-product">产品层不暴露发布版本：这里比较的是两个本体（{MOCK_ONTOLOGY_A.number} / {MOCK_ONTOLOGY_B.number}）。下面保留算法实现口径，其中“版本列 / 版本副本”只是底层只读快照细节。</p>
          <p>本次对比任务 {MOCK_COMPARE_META.jobId} · {MOCK_COMPARE_META.algorithm} · 耗时 {MOCK_COMPARE_META.durationMs}ms。{MOCK_COMPARE.compare_state}，{MOCK_COMPARE.global.content_hash_same ? '内容哈希一致' : '内容哈希不同'}。</p>
          <ul>{MOCK_COMPARE.contract_notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
          <p className="vc-info-note">{MOCK_COMPARE.coverage._note}</p>
        </div>}
      </aside>
    </>}
  </div>;
}

function MoveCard({ drift }) {
  const diff = drift.field_diffs.find((item) => item.field === 'oot_biz_domain_id');
  if (!diff) return null;
  return <div className="vc-move-card">
    <div><span>业务域迁移</span><strong>{drift.owner?.name || drift.res_key}</strong></div>
    <div className="vc-move-flow"><span><small>基线 A</small><b>{prettyValue('oot_biz_domain_id', diff.left, MOCK_COMPARE.domain_names)}</b></span><ArrowRight size={18} /><span><small>副本 B</small><b>{prettyValue('oot_biz_domain_id', diff.right, MOCK_COMPARE.domain_names)}</b></span></div>
    <p>归属调整会影响对象在业务域目录、权限范围和责任归属中的位置；它本身不等于对象被删除。</p>
  </div>;
}
