import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileUp, GitBranch, History, PackageCheck, RefreshCw, Send, ShieldCheck, TableProperties, XCircle } from 'lucide-react';
import { api, formatTime, saveJson } from '../api';
import { actorLabel, localizeModelText, operationLabel } from '../labels';
import { ErrorState, Loading } from '../components/StateViews';
import PaginationBar from '../components/PaginationBar';

const componentNames = {
  ontology: '本体', object_type: '对象类型', link_type: '关系类型', action: '动作类型',
  business_rule: '业务规则', interface: '接口',
  business_domain: '业务域', subject_domain: '主题域',
  object_instance: '对象实例', link_instance: '关系实例',
  data_mapping: '数据映射', data_source: '数据源', business_scenario: '业务场景',
  capability: '系统能力', capabilitie: '系统能力', action_mapping: '动作执行映射',
  permission_policy: '权限策略', logic_definition: '逻辑定义', version: '版本记录', evidence_source: '建模证据',
  proposal: '智能构建提案',
};
const stateLabels = { draft: '设计中', in_review: '待评审', reviewed: '评审通过', published: '已发布' };
const compatibilityLabels = { baseline: '基线快照', compatible: '兼容', additive: '增量兼容', breaking: '破坏性' };

export default function Governance({ activeId, active, refreshOntologies, chooseOntology, notify }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [report, setReport] = useState(null);
  const [preview, setPreview] = useState(null);
  const [current, setCurrent] = useState(active);
  const [pending, setPending] = useState([]);
  const [releases, setReleases] = useState([]);
  const [qualityRuns, setQualityRuns] = useState([]);
  const [templateRows, setTemplateRows] = useState([]);
  const [templateSheet, setTemplateSheet] = useState('');
  const [bump, setBump] = useState('minor');
  const [reason, setReason] = useState('业务模型和数据映射变更');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [listPageSize, setListPageSize] = useState(20);
  const [pendingPage, setPendingPage] = useState(1);
  const [releasePage, setReleasePage] = useState(1);
  const [templatePage, setTemplatePage] = useState(1);
  const load = async () => {
    setReport(null); setError('');
    try { const [ontology, validation, impact, releaseRows, sourceRows, checks] = await Promise.all([api(`/api/ontologies/${activeId}`), api(`/api/ontologies/${activeId}/validate`, { method: 'POST' }), api(`/api/ontologies/${activeId}/release-preview`), api(`/api/ontologies/${activeId}/releases`), api(`/api/ontologies/${activeId}/template-records`), api(`/api/ontologies/${activeId}/quality-runs`)]); setCurrent(ontology); setReport(validation); setPreview(impact); setPending(impact.pending || []); setReleases(releaseRows); setQualityRuns(checks); setTemplateRows(sourceRows); setTemplateSheet((old) => old || sourceRows.find((item) => item.record_kind === 'data')?.sheet_name || sourceRows[0]?.sheet_name || ''); setBump(impact.recommended_bump); } catch (e) { setError(e.message); }
  };
  useEffect(load, [activeId]);
  const transition = async (kind) => { setBusy(kind); try { const paths = { derive: 'derive', submit: 'review/submit', approve: 'review/approve' }; await api(`/api/ontologies/${activeId}/${paths[kind]}`, { method: 'POST' }); await refreshOntologies(activeId); await load(); notify(kind === 'derive' ? '已从发布版派生新工作状态' : kind === 'submit' ? '已提交评审' : '评审已通过'); } catch (e) { notify(e.message); } finally { setBusy(''); } };
  const publish = async () => { if (!window.confirm(`确定将 ${pending.length} 项变更发布为新版本吗？`)) return; setBusy('publish'); try { const result = await api(`/api/ontologies/${activeId}/publish`, { method: 'POST', body: JSON.stringify({ bump, change_reason: reason, reviewer: '' }) }); await refreshOntologies(activeId); notify(`已发布版本 ${result.version}`); await load(); } catch (e) { notify(e.message); } finally { setBusy(''); } };
  const exportModel = async () => { setBusy('export'); try { const payload = await api(`/api/ontologies/${activeId}/export`); saveJson(`${active.namespace}-${current.version}.json`, payload); } catch (e) { notify(e.message); } finally { setBusy(''); } };
  const importModel = async (event) => { const file = event.target.files?.[0]; if (!file) return; setBusy('import'); try { const payload = JSON.parse(await file.text()); const created = await api('/api/ontologies/import', { method: 'POST', body: JSON.stringify({ payload }) }); await refreshOntologies(created.id); chooseOntology(created.id); notify(`已导入为“${created.name}”`); } catch (e) { notify(e.message); } finally { setBusy(''); event.target.value = ''; } };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!report || !preview) return <Loading />;
  const states = ['draft', 'in_review', 'reviewed', 'published'];
  const currentIndex = states.indexOf(current.status);
  const templateSheets = [...new Set(templateRows.map((item) => item.sheet_name))];
  const visibleTemplateRows = templateRows.filter((item) => item.sheet_name === templateSheet);
  const paginate = (rows, page) => rows.slice((Math.max(1, page) - 1) * listPageSize, Math.max(1, page) * listPageSize);
  const pendingPages = Math.max(1, Math.ceil(pending.length / listPageSize));
  const releasePages = Math.max(1, Math.ceil(releases.length / listPageSize));
  const templatePages = Math.max(1, Math.ceil(visibleTemplateRows.length / listPageSize));
  const currentPendingPage = Math.min(pendingPage, pendingPages);
  const currentReleasePage = Math.min(releasePage, releasePages);
  const currentTemplatePage = Math.min(templatePage, templatePages);
  const pendingRows = paginate(pending, currentPendingPage);
  const releaseRows = paginate(releases, currentReleasePage);
  const templatePageRows = paginate(visibleTemplateRows, currentTemplatePage);
  const latestQuality = qualityRuns[0];
  const qualityPassed = !!latestQuality && !latestQuality.stale && latestQuality.result.startsWith('通过');
  return <div className="release-studio">
    <section className="release-header"><div><span>发布治理</span><h2>发布管理</h2><p>发布前完成基础阻断校验；完整语义问题请到“本体质检”查看报告。</p></div><div className="release-header-actions"><button onClick={() => navigate('/ontology/governance/activity')}><History size={15} /> 查看变更记录</button><button onClick={load}><RefreshCw size={15} /> 重新运行检查</button></div></section>
    <div className="release-grid"><section className="release-changes"><header><div><strong>工作状态变更</strong><span>{pending.length} 项待发布变更</span></div><em>{stateLabels[current.status] || current.status}</em></header>{pending.length ? <>{pendingRows.map((item) => <div className="oma-edit-row" key={item.id}><span className={`oma-operation ${item.operation}`}>{operationLabel(item.operation)}</span><div><strong>{localizeModelText(item.summary)}</strong><small>{componentNames[item.component_type] || item.component_type} · {formatTime(item.created_at)}</small></div><span>{actorLabel(item.actor)}</span></div>)}<PaginationBar page={currentPendingPage} pageSize={listPageSize} total={pending.length} onPageChange={setPendingPage} onPageSizeChange={(size) => { setListPageSize(size); setPendingPage(1); }} /></> : <div className="oma-clean-state"><CheckCircle2 size={25} /><strong>当前没有未发布变更</strong><span>建模操作会出现在这里；保存变更后通过校验即可发布。</span></div>}</section>
      <aside className="release-checks"><header><strong>模型检查</strong><em className={report.valid ? 'pass' : 'fail'}>{report.valid ? '已通过' : '已阻断'}</em></header><div className="oma-check-summary"><span className={report.valid ? 'pass' : 'fail'}>{report.valid ? <ShieldCheck size={22} /> : <AlertTriangle size={22} />}</span><div><strong>{report.errors.length} 项错误 · {report.warnings.length} 项警告</strong><small>已通过 {report.checks.filter((item) => item.passed).length}/{report.checks.length} 项检查</small></div></div>{report.checks.map((item) => <div className="oma-check-row" key={item.name}>{item.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}<span>{localizeModelText(item.name)}</span><em>{item.passed ? '已通过' : '未通过'}</em></div>)}{report.errors.map((item, index) => <div className="oma-check-message error" key={`e${index}`}><XCircle size={15} />{localizeModelText(item.message)}</div>)}</aside>
      <aside className="release-impact"><header><strong>发布影响</strong><em className={preview.compatibility}>{preview.compatibility === 'breaking' ? '破坏性' : preview.compatibility === 'additive' ? '增量兼容' : '兼容'}</em></header><dl><div><dt>变更资源</dt><dd>{preview.impacted_resource_types.length} 类</dd></div><div><dt>待核查场景（全量）</dt><dd>{preview.impacted_scenarios.length} 个</dd></div><div><dt>破坏性变更</dt><dd>{preview.breaking_changes.length} 项</dd></div><div><dt>建议版本升级</dt><dd>{preview.recommended_bump === 'major' ? '主版本' : preview.recommended_bump === 'minor' ? '次版本' : '修订版'}</dd></div></dl><section><strong>待核查场景</strong><p>尚未按资源依赖精确筛选，以下为当前全部场景：{preview.impacted_scenarios.join('、') || '无'}</p></section></aside>
    </div>
    <section className="release-actions"><div><strong>变更提案与发布</strong><span>当前质检：{qualityPassed ? '已通过' : latestQuality?.stale ? '报告已过期' : latestQuality?.result || '尚未质检'}。质检、评审通过后才能发布。</span></div><button onClick={() => navigate('/ontology/governance/quality')}>查看／运行质检</button>{current.status === 'draft' && <button onClick={() => transition('submit')} disabled={!pending.length || !report.valid || !qualityPassed || !!busy}><Send size={15} /> 提交评审</button>}{current.status === 'in_review' && <button onClick={() => transition('approve')} disabled={!qualityPassed || !!busy}><CheckCircle2 size={15} /> 评审通过</button>}{current.status === 'reviewed' && <><select value={bump} onChange={(e) => setBump(e.target.value)}><option value="major">主版本升级</option><option value="minor">次版本升级</option><option value="patch">修订版升级</option></select><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="发布说明" /><button className="oma-button" onClick={publish} disabled={!pending.length || !report.valid || !qualityPassed || !!busy}><PackageCheck size={15} /> 发布新版本</button></>}</section>
    <div className="release-bottom"><section className="release-history"><header><div><strong>已发布版本</strong><span>{releases.length} 个正式版本 · 历史语义只读</span></div><History size={16} /></header>{releases.length ? <>{releaseRows.map((item) => <article key={item.id}><i><PackageCheck size={16} /></i><span><b>{item.version}</b><small>{item.change_summary}</small></span><em>{compatibilityLabels[item.compatibility] || item.compatibility}</em><time>{formatTime(item.created_at)}</time><button type="button" className="release-snapshot-open" onClick={() => navigate(`/ontology/governance/releases/${item.id}`)}>查看历史版 <ArrowRight size={14} /></button></article>)}<PaginationBar page={currentReleasePage} pageSize={listPageSize} total={releases.length} onPageChange={setReleasePage} onPageSizeChange={(size) => { setListPageSize(size); setReleasePage(1); }} /></> : <p>首次发布后，将在这里显示版本记录。</p>}</section><aside className="oma-transfer"><header><strong>本体数据包</strong><span>可移植的元数据定义</span></header><button onClick={exportModel}><Download size={18} /><span><strong>导出 JSON</strong><small>包含模型、映射、实例和治理资源</small></span></button><button onClick={() => inputRef.current?.click()}><FileUp size={18} /><span><strong>导入为新本体</strong><small>不会覆盖当前本体</small></span></button><input hidden ref={inputRef} type="file" accept="application/json,.json" onChange={importModel} /></aside></div>
    <section className="release-template-source"><header><div><strong><TableProperties size={16} /> 模板原始数据</strong><span>{templateRows.length ? `${templateRows.length} 条非空行已接入` : '当前本体没有模板来源记录'}</span></div>{templateSheets.length > 0 && <select value={templateSheet} onChange={(e) => { setTemplateSheet(e.target.value); setTemplatePage(1); }}>{templateSheets.map((sheet) => <option key={sheet}>{sheet}</option>)}</select>}</header>{visibleTemplateRows.length > 0 ? <><div className="release-template-table">{templatePageRows.map((item) => <div className={`release-template-row ${item.record_kind}`} key={item.id}><span>{item.source_row}</span><code>{item.template_id || item.record_kind}</code><span>{item.raw_values.join(' · ')}</span><small>{item.normalized_ref_id ? `${item.normalized_ref_type} · ${item.normalized_ref_id}` : '来源说明行'}</small></div>)}</div><PaginationBar page={currentTemplatePage} pageSize={listPageSize} total={visibleTemplateRows.length} onPageChange={setTemplatePage} onPageSizeChange={(size) => { setListPageSize(size); setTemplatePage(1); }} /></> : <p className="release-template-empty">切换到有数据的 Sheet 查看原始行。规范化资源会保留对应模板 ID 和修复说明。</p>}</section>
  </div>;
}
