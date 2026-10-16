import { useParams } from 'react-router-dom';
import { ArrowRight, Bot, CheckCircle2, FileSearch, LockKeyhole, MessageSquareText, Network, Route, Sparkles, Workflow } from 'lucide-react';

const configs = {
  domain: { icon: Sparkles, title: '领域知识构建', kicker: '二期 · 模型建议工作台', summary: '将文件、知识库和领域描述转成可审核的对象、关系与动作建议，但永远不直接写入正式本体。', steps: [['资料接入', 'PDF、Word、表格与知识库形成证据集', FileSearch], ['候选构建', '生成对象、属性、关系和动作候选', Network], ['差异审查', '逐项查看新增、扩展、复用和冲突', MessageSquareText], ['人工发布', '校验通过后由建模人员确认合并', CheckCircle2]], buttons: ['创建证据集', '开始模型建议'] },
  agent: { icon: Bot, title: '智能体交互', kicker: '二期 · 本体智能体', summary: '让智能体只通过已发布的本体契约理解业务、查询对象，并在明确授权后调用业务动作。', steps: [['语义查询', '按对象与关系完成可解释查询', MessageSquareText], ['行动计划', '将用户意图映射到已定义业务动作', Route], ['确认与授权', '高风险动作在执行前展示影响并确认', LockKeyhole], ['执行与审计', '记录工具调用、结果与业务对象变化', CheckCircle2]], buttons: ['新建查询智能体', '新建动作智能体'] },
  workflow: { icon: Workflow, title: '智能体工作流', kicker: '二期 · 智能体流程编排', summary: '把事件触发、语义判断、人工审批和本体动作组合成可观测、可接管的业务流程。', steps: [['事件触发', '实例变化、定时任务或外部事件进入流程', Sparkles], ['语义决策', '依据本体约束和上下文生成执行计划', Network], ['动作编排', '串并行执行受控动作与人工审批', Workflow], ['监控恢复', '幂等、重试、失败补偿和人工接管', CheckCircle2]], buttons: ['新建工作流', '查看运行记录'] },
};

export default function FuturePage() {
  const { kind } = useParams();
  const config = configs[kind] || configs.domain;
  return <div className="future-page"><section className="future-hero"><div className="future-icon"><config.icon size={28} /></div><span className="eyebrow purple">{config.kicker}</span><h2>{config.title}</h2><p>{config.summary}</p><div className="future-actions">{config.buttons.map((name) => <button key={name} className="btn future-disabled" disabled><LockKeyhole size={15} /> {name}<span>二期开放</span></button>)}</div></section><section className="future-flow"><div className="panel-head"><div><h3>计划中的完整闭环</h3><p>入口已预留，当前版本不会调用模型或创建任何虚假结果</p></div></div><div className="future-steps">{config.steps.map(([title, desc, Icon], index) => <div className="future-step" key={title}><div className="step-number">0{index + 1}</div><span className="step-icon"><Icon size={20} /></span><h3>{title}</h3><p>{desc}</p>{index < config.steps.length - 1 && <ArrowRight className="step-arrow" size={21} />}</div>)}</div></section><section className="future-principles"><h3>接入前必须满足</h3><div><span><CheckCircle2 size={17} /> 使用已发布本体版本</span><span><CheckCircle2 size={17} /> 智能建议与正式模型隔离</span><span><CheckCircle2 size={17} /> 写操作需要权限与确认</span><span><CheckCircle2 size={17} /> 全过程留存证据和审计</span></div></section></div>;
}
