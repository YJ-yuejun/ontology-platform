import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Boxes, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

const GROUPS = [
  ['objects', '主要对象'],
  ['links', '关键关系'],
  ['rules', '规则'],
  ['actions', '行动'],
  ['sources', '关联系统'],
];

export default function ScenarioDiscoveryCard({ discovery }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState({
    name: discovery?.name || 'AI 识别业务场景',
    business_goal: discovery?.business_goal || '',
    trigger_condition: discovery?.trigger_condition || '',
  });
  if (!discovery) return null;

  const apply = (event) => {
    event.preventDefault();
    navigate('/ontology/scenarios', {
      state: {
        scenarioDraft: {
          name: form.name,
          business_goal: form.business_goal,
          trigger_condition: form.trigger_condition,
          objects: (discovery.objects || []).map((item) => item.name),
          links: (discovery.links || []).map((item) => item.name),
          rules: (discovery.rules || []).map((item) => item.name),
          actions: (discovery.actions || []).map((item) => item.name),
          sources: (discovery.sources || []).map((item) => item.code),
        },
      },
    });
  };

  return <article className={`scenario-discovery-card ${expanded ? 'expanded' : ''}`}>
    <header>
      <div className="scenario-discovery-title"><span><Sparkles size={15} /> AI 场景资源包</span><small>候选资源 · 需人工确认，不会自动保存</small></div>
      <button type="button" className="scenario-discovery-toggle" onClick={() => setExpanded((value) => !value)}>{expanded ? <><ChevronUp size={14} /> 收起表单</> : <><ChevronDown size={14} /> 展开表单</>}</button>
    </header>
    <div className="scenario-discovery-layout">
      <section className="scenario-discovery-summary">
        <div className="scenario-discovery-goal"><span>业务目标</span><b>{form.business_goal || '未填写'}</b></div>
        <div className="scenario-discovery-metrics"><span><b>{discovery.objects?.length || 0}</b>对象</span><span><b>{discovery.links?.length || 0}</b>关系</span><span><b>{discovery.rules?.length || 0}</b>规则</span><span><b>{discovery.actions?.length || 0}</b>行动</span><span><b>{discovery.sources?.length || 0}</b>系统</span></div>
        <div className="scenario-discovery-groups">{GROUPS.map(([key, label]) => <div key={key}><span>{label}<em>{discovery[key]?.length || 0}</em></span><div>{discovery[key]?.length ? discovery[key].map((item) => <i key={item.id || item.name || item.code}>{item.display_name || item.name}</i>) : <small>未发现</small>}</div></div>)}</div>
        <small className="scenario-discovery-evidence">证据：{discovery.evidence?.join('、') || '来自当前本体资源'} · 置信度 {Math.round((discovery.confidence || 0) * 100)}%</small>
      </section>
      {expanded && <form className="scenario-discovery-form" onSubmit={apply}>
        <div className="scenario-discovery-form-head"><span>场景草案</span><small>应用后可在业务场景弹窗继续修改并保存</small></div>
        <label><span>业务场景</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
        <label><span>业务目标 / 任务</span><textarea value={form.business_goal} onChange={(event) => setForm({ ...form, business_goal: event.target.value })} required /></label>
        <label><span>触发条件</span><textarea value={form.trigger_condition} onChange={(event) => setForm({ ...form, trigger_condition: event.target.value })} required /></label>
        <div className="scenario-discovery-form-note"><Boxes size={14} /><span>资源包会带入业务场景创建弹窗；场景ID需在弹窗中补充。</span></div>
        <button type="submit" className="scenario-discovery-apply">应用到业务场景 <ArrowRight size={14} /></button>
      </form>}
    </div>
  </article>;
}
