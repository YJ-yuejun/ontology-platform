import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileCheck2, Layers3, PanelRightClose, Play, RefreshCw } from 'lucide-react';
import { api, formatTime } from '../api';
import { ErrorState, Loading } from '../components/StateViews';
import GovernanceInsightChat from '../components/GovernanceInsightChat';
import './GovernanceInsights.css';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function downloadReport(run) {
  const report = run.report;
  const issueRows = report.issues.length ? report.issues.map((item) => `<tr><td>${item.severity === 'error' ? '错误' : '警告'}</td><td>${escapeHtml(item.resource_type)}</td><td>${escapeHtml(item.message)}</td></tr>`).join('') : '<tr><td colspan="3">当前检查范围内未发现问题</td></tr>';
  const checkRows = report.checks.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.passed ? '通过' : '未通过'}</td></tr>`).join('');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>本体质检报告</title><style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;max-width:960px;margin:36px auto;color:#21384c}h1{margin-bottom:4px}small{color:#718293}table{border-collapse:collapse;width:100%;margin:12px 0 28px}td,th{border:1px solid #d6e0e8;padding:9px;text-align:left}th{background:#eef4f9}.verdict{padding:15px;background:#eef6fd;border-left:4px solid #2878bf}</style></head><body><h1>${escapeHtml(report.ontology_name)} · 本体质检报告</h1><small>报告时间：${escapeHtml(formatTime(run.created_at))}　检查范围：${escapeHtml(run.scope_label || run.version_label)}　执行人：${escapeHtml(run.created_by)}</small><p class="verdict"><strong>结论：${escapeHtml(report.result)}</strong><br>${escapeHtml(report.summary)}</p><p>范围：${escapeHtml(report.scope)}。方法：${escapeHtml(report.method)}。</p><h2>检查项</h2><table><tr><th>检查</th><th>结果</th></tr>${checkRows}</table><h2>发现的问题</h2><table><tr><th>级别</th><th>资源类型</th><th>问题描述</th></tr>${issueRows}</table><small>此报告为生成时的模型快照结果；模型后续变更需重新质检。</small></body></html>`;
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  link.href = url; link.download = `${report.ontology_name}-本体质检报告.html`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 范围引导：全部质检 / 只查某几项。key 与后端 QUALITY_DIMENSIONS 一致。
function ScopeGuide({ dimensions, scope, onToggle, onAll, busy }) {
  const all = scope.length === 0;
  return <div className="gi-scope-guide">
    <div className="gi-scope-guide-head"><Layers3 size={15} /><strong>质检范围</strong><span>{all ? '当前：全部 9 项维度' : `当前：已选 ${scope.length} 项`}</span></div>
    <div className="gi-scope-chips">
      <button type="button" className={`gi-scope-chip ${all ? 'active' : ''}`} disabled={busy} onClick={onAll}>全部质检</button>
      {dimensions.map((item) => <button type="button" key={item.key} title={item.description}
        className={`gi-scope-chip ${scope.includes(item.key) ? 'active' : ''}`} disabled={busy}
        onClick={() => onToggle(item.key)}>{item.label}</button>)}
    </div>
    <p className="gi-scope-hint">选好范围后，在下面说「开始质检」；不选则默认全部维度。也可以直接问我某个检查项具体查什么。</p>
  </div>;
}

export default function OntologyQuality({ activeId, active, notify }) {
  const generation = useRef(0);
  const [runs, setRuns] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState([]);
  const [dimensions, setDimensions] = useState([]);
  const [scope, setScope] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const current = ++generation.current;
    setError('');
    try {
      const items = await api(`/api/ontologies/${activeId}/quality-runs`);
      if (current === generation.current) {
        setRuns(items);
        setSelectedId((old) => (items.some((item) => item.id === old) ? old : items[0]?.id || ''));
      }
    } catch (cause) { if (current === generation.current) setError(cause.message); }
  };

  useEffect(() => {
    generation.current += 1; setRuns(null); setSelectedId(''); setMessages([]); setScope([]); setDrawerOpen(false);
    if (activeId) load();
  }, [activeId]);

  useEffect(() => {
    api('/api/quality-dimensions').then(setDimensions).catch(() => setDimensions([]));
  }, []);

  const selected = runs?.find((item) => item.id === selectedId) || null;

  const run = async (scopeKeys = scope, fromChat = false) => {
    const current = ++generation.current;
    setBusy('run');
    try {
      const result = await api(`/api/ontologies/${activeId}/quality-runs`, {
        method: 'POST', body: JSON.stringify({ scope: scopeKeys }),
      });
      if (current !== generation.current) return;
      setRuns((old) => [result, ...(old || [])].slice(0, 10));
      setSelectedId(result.id);
      setDrawerOpen(true);
      if (fromChat) {
        setMessages((old) => [...old, {
          role: 'assistant', mode: 'rule_fallback',
          reportId: result.id, reportTitle: '查看质检报告',
          text: `已按「${result.scope_label || '全部维度'}」完成质检：${result.report.summary}结论为“${result.result}”。报告已从右侧打开，可以继续问我具体问题。`,
        }]);
      }
      notify(`本体质检完成：${result.result}`);
    } catch (cause) { notify(cause.message); } finally { setBusy(''); }
  };

  const toggleScope = (key) => setScope((old) => (old.includes(key) ? old.filter((item) => item !== key) : [...old, key]));

  const send = async (message) => {
    const wantsRun = /开始|运行|重新|质检一下|全部质检|跑一遍/.test(message);
    if (wantsRun) {
      setMessages((old) => [...old, { role: 'user', text: message }]);
      await run(scope, true);
      return;
    }
    if (!selected || selected.stale) {
      setMessages((old) => [...old, { role: 'user', text: message }, {
        role: 'assistant', mode: 'rule_fallback',
        text: '还没有可解读的报告。先在上面选好质检范围（不选就是全部 9 项维度），然后跟我说「开始质检」；报告生成后我会基于真实检查结果回答。',
      }]);
      return;
    }
    const current = generation.current;
    setMessages((old) => [...old, { role: 'user', text: message }]); setBusy('chat');
    try {
      const reply = await api(`/api/ontologies/${activeId}/quality-runs/${selected.id}/chat`, { method: 'POST', body: JSON.stringify({ message }) });
      if (current === generation.current) setMessages((old) => [...old, { role: 'assistant', text: reply.answer, mode: reply.mode }]);
    } catch (cause) { notify(cause.message); } finally { setBusy(''); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!runs) return <Loading />;

  const scopeText = scope.length === 0 ? '全部维度' : `已选 ${scope.length} 项维度`;
  const intro = selected && !selected.stale
    ? `当前已有一份质检报告（范围：${selected.scope_label || '全部维度'}，结论：${selected.result}）。你可以直接问我问题，也可以改范围后重新质检。`
    : `我会按确定性规则检查本体的语义结构。先确认范围：是全部质检，还是只查某几部分？选好后说「开始质检」。`;

  return <div className="gi-page gi-quality-page">
    <header className="gi-page-head"><div><small>语义建模完成后</small><h2>本体质检</h2><p>对话式质检：先说清要查哪部分，出报告后从右侧查看，并可继续追问。</p></div>
      <div className="gi-quality-actions">
        {selected && <button className="gi-primary ghost" onClick={() => setDrawerOpen(true)}><FileCheck2 size={15} /> 查看质检报告</button>}
        <button className="gi-primary" disabled={!!busy} onClick={() => { setMessages((old) => [...old, { role: 'user', text: '开始质检' }]); run(scope, true); }}><Play size={15} /> {busy === 'run' ? '质检中…' : `运行质检 · ${scopeText}`}</button>
      </div>
    </header>
    <div className={`gi-quality-layout ${drawerOpen && selected ? 'drawer-open' : ''}`}>
      <GovernanceInsightChat
        title="质检对话" intro={intro} messages={messages}
        subtitle="可多轮确认范围，生成报告后继续追问"
        suggestions={selected && !selected.stale
          ? ['有哪些问题？', '先修复哪一项？', '这份报告检查了什么？']
          : ['开始质检', '每项检查分别查什么？', '只查对象和关系的部分']}
        onSend={send} busy={!!busy}
        onOpenReport={() => setDrawerOpen(true)}
        guide={<ScopeGuide dimensions={dimensions} scope={scope} onToggle={toggleScope} onAll={() => setScope([])} busy={!!busy} />}
      />
    </div>

    {selected && <aside className={`gi-report-drawer ${drawerOpen ? 'open' : ''}`} aria-hidden={!drawerOpen}>
      <header>
        <div><FileCheck2 size={17} /><strong>质检报告</strong></div>
        <div className="gi-actions">
          {runs.length > 0 && <select aria-label="选择历史质检报告" value={selectedId} disabled={!!busy}
            onChange={(event) => { generation.current += 1; setSelectedId(event.target.value); setMessages([]); }}>
            {runs.map((item) => <option key={item.id} value={item.id}>{formatTime(item.created_at)} · {item.scope_label || '全部维度'} · {item.result}</option>)}
          </select>}
          <button onClick={() => downloadReport(selected)} title="下载 HTML 报告"><Download size={15} /></button>
          <button onClick={load} title="刷新报告"><RefreshCw size={15} /></button>
          <button onClick={() => setDrawerOpen(false)} title="收起报告"><PanelRightClose size={16} /></button>
        </div>
      </header>
      <div className="gi-report-body">
        <div className={`gi-verdict ${selected.report.issues.some((item) => item.severity === 'error') ? 'bad' : 'good'}`}>
          <div><small>质检结论</small><strong>{selected.report.result}</strong><p>{selected.report.summary}</p></div>
          {selected.report.result.startsWith('通过') ? <CheckCircle2 size={29} /> : <AlertTriangle size={29} />}
        </div>
        {selected.stale && <p className="gi-stale"><AlertTriangle size={15} /> 本体已发生变化，此报告不是当前状态的结论，请重新质检。</p>}
        <div className="gi-report-meta">
          <span>检查范围：{selected.scope_label || '全部维度'}</span>
          <span>执行时间：{formatTime(selected.created_at)}</span>
          <span>执行人：{selected.created_by}</span>
        </div>
        <p className="gi-scope">范围：{selected.report.scope}；方法：{selected.report.method}。</p>
        <h3>检查项 <small>{selected.report.checks.length}</small></h3>
        <div className="gi-checks">{selected.report.checks.map((item) => <div key={item.name}><span>{item.name}</span><em className={item.passed ? 'pass' : 'fail'}>{item.passed ? '通过' : '未通过'}</em></div>)}</div>
        <h3>发现的问题 <small>{selected.report.issues.length}</small></h3>
        {selected.report.issues.length
          ? <div className="gi-issues">{selected.report.issues.map((item, index) => <article key={`${item.resource_id}-${index}`}><em className={item.severity}>{item.severity === 'error' ? '错误' : '警告'}</em><div><strong>{item.message}</strong><small>{item.resource_type} · {item.resource_id}</small></div></article>)}</div>
          : <p className="gi-no-issues">当前检查范围内未发现问题。实例数据和生产接口不在本次范围内。</p>}
      </div>
    </aside>}
  </div>;
}
