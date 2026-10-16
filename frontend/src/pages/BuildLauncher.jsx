import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FilePlus2, History, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { api, formatTime } from '../api';
import { launchBuild, readTasks, TASK_EVENT, TASK_LABELS, MODE_LABELS } from '../buildConversation';
import PaginationBar from '../components/PaginationBar';
import './BuildChat.css';

export default function BuildLauncher({ active, notify }) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [legacy, setLegacy] = useState([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => {
    const refresh = () => { try { setTasks(readTasks()); } catch (e) { notify(e.message); } };
    refresh(); window.addEventListener(TASK_EVENT, refresh);
    api('/api/ontology-build-sessions').then(setLegacy).catch(() => {});
    return () => window.removeEventListener(TASK_EVENT, refresh);
  }, []);
  const rows = tasks.filter((t) => `${t.title} ${t.ontologyName} ${t.goal}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  return <div className="build-launcher">
    <header><div><h2>智能构建</h2><span>在一个对话中创建、完善或检查本体</span></div><button className="bc-button" onClick={() => navigate('/chat')}><Sparkles size={15} /> 打开智能问答</button></header>
    <section className="build-entry-grid">{[
      ['create', FilePlus2, '新建本体', '从领域资料和业务需求开始，逐步确认模型。'],
      ['update', Sparkles, '完善当前本体', active ? `继续完善「${active.name}」，只提出增量建议。` : '选择已有本体，补充对象、属性与关系。'],
      ['inspect', ShieldCheck, '检查现有模型', '先看定义缺口和检查结果，不直接修改模型。'],
    ].map(([mode, Icon, label, hint]) => <button key={mode} onClick={() => launchBuild(navigate, { mode, ontology: active }, notify)}><Icon size={23} /><div><strong>{label}</strong><p>{hint}</p></div><ArrowRight size={16} /></button>)}</section>
    <div className="bc-note">当前为对话交互演示：读取真实模型；示例建议及草稿仅保存在本浏览器，不调用线上智能体，不改动已有本体。</div>
    <section className="build-task-table"><header><strong>建模任务</strong><label className="bc-search"><Search size={16} /><input aria-label="搜索建模任务" placeholder="搜索任务、本体或需求" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label></header>
      <div className="build-task-head"><span>任务名称</span><span>目标本体</span><span>任务进度</span><span>更新时间</span></div>
      {rows.slice((current - 1) * pageSize, current * pageSize).map((t) => <button className="build-task-row" key={t.id} onClick={() => navigate(`/chat?task=${t.id}`)}><span><b>{t.title}</b><small>{MODE_LABELS[t.mode]} · 浏览器本地</small></span><span>{t.ontologyName || t.newOntology.name || '待定义新本体'}</span><span><em className="bc-state">{TASK_LABELS[t.status]}</em></span><span>{formatTime(t.updatedAt)} <ArrowRight size={14} /></span></button>)}
      {!rows.length && <div className="bc-empty"><History size={24} /><strong>{query ? '没有匹配的任务' : '还没有对话建模任务'}</strong><p>从上方选择任务；未完成的对话可以在这里继续。</p></div>}
      <PaginationBar total={rows.length} page={current} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(v) => { setPageSize(v); setPage(1); }} />
    </section>
    <footer className="build-legacy"><span>原有构建记录与评审流程保留 · {legacy.length} 个历史任务</span><button onClick={() => navigate('/ontology/build/legacy')}>打开原有构建流程 <ArrowRight size={14} /></button></footer>
  </div>;
}
