import { createContext, useContext, useState } from 'react';
import { ArrowRight, Bot, Boxes, Check, Pencil, ShieldCheck } from 'lucide-react';
import Modal from './Modal';
import { manualEntry, RESOURCE_KINDS, resourceKind } from '../modelingFlow';
import './ModelingEntry.css';
import { readTasks, TASK_LABELS } from '../buildConversation';

export const ModelingEntryContext = createContext(null);
export const useModelingEntry = () => useContext(ModelingEntryContext);

export function MethodChoices({ value, onChange, disabled, smartHint, manualHint }) {
  return <div className="modeling-methods" role="group" aria-label="选择建模方式">
    {[['smart', Bot, '智能构建', smartHint || '描述需求或提供资料，由建模助手提出建议，确认后再保存。'], ['manual', Pencil, '手动建模', manualHint || '使用现有模板表单，逐项定义对象、关系、规则等内容。']].map(([id, Icon, name, hint]) => <button type="button" key={id} className={value === id ? 'selected' : ''} aria-pressed={value === id} disabled={disabled} onClick={() => onChange(id)}><Icon size={22} /><span><strong>{name}</strong><small>{hint}</small></span><i>{value === id && <Check size={14} />}</i></button>)}
  </div>;
}

export default function ModelingEntry({ entry, onClose, onContinue }) {
  const [type, setType] = useState(entry.type || '');
  const [method, setMethod] = useState('');
  const [recent] = useState(() => {
    try { return readTasks().filter((task) => task.ontologyId === entry.ontology?.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3); }
    catch { return []; }
  });
  const isUpdate = entry.intent === 'update';
  const selected = resourceKind(type);
  const destination = manualEntry({ ...entry, type });
  return <Modal title={isUpdate ? entry.resource ? '更新资源' : '更新本体' : '新建资源'} subtitle={`${entry.ontology?.name || '当前本体'}${entry.resource ? ` · ${entry.resource.display_name}` : ''}`} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>取消</button><button className="btn primary" disabled={!method || (!isUpdate && !type) || (method === 'manual' && !type && !destination.governance)} onClick={() => onContinue({ ...entry, type, method, destination })}>{method === 'smart' ? '进入建模对话' : destination.governance ? '前往工作状态管理' : destination.prerequisite ? destination.label : '进入手动建模'} <ArrowRight size={15} /></button></>}>
    {!entry.resource && <label className="modeling-scope-label">{isUpdate ? '本次处理范围' : '1. 选择资源类型'}<select value={type} onChange={(e) => setType(e.target.value)}><option value="">{isUpdate ? '整个本体（智能方式可自动拆解需求）' : '请选择资源类型'}</option>{RESOURCE_KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
    {selected && <p className="modeling-hint"><Boxes size={15} /> {selected.hint}</p>}
    <h3 className="modeling-section-title">{entry.resource || isUpdate ? '选择操作方式' : '2. 选择创建方式'}</h3>
    <MethodChoices value={method} onChange={setMethod} smartHint={isUpdate ? '在当前本体基础上生成增量建议；可补充业务描述、资料或已确认治理资产上下文。' : selected?.id === 'object_type' ? '进入 AI 建模对话，可提供业务描述、领域资料或已确认治理资产上下文。' : `进入问答，由助手引导定义${selected?.label || '所选资源'}。`} manualHint={isUpdate ? '打开所选资源目录，选择具体条目进行编辑。' : selected?.id === 'object_type' ? '打开对象模板表单后，再选择从业务语义空白开始或参考已确认治理资产字段。' : '直接打开该类资源的现有表单，不改变模板字段。'} />
    {method === 'manual' && !type && !destination.governance && <p className="modeling-warning">请选择上方资源范围，系统将直接带你进入对应目录。</p>}
    {method === 'manual' && destination.prerequisite && <p className="modeling-warning">{destination.prerequisite === 'classification' ? '当前尚未完成业务分类。对象表单需要选择所属分类，下一步先建立业务主题，再创建对象。' : `当前没有对象类型，暂时无法定义${selected?.label}。下一步先创建对象，再回来补充${selected?.label}。`}</p>}
    {destination.governance && <p className="modeling-warning"><ShieldCheck size={16} />{entry.ontology?.status === 'published' ? '当前本体已发布。手动修改前需派生工作状态；智能方式可先形成建议，不覆盖已发布版本。' : '当前本体正在评审或已获批准。手动修改前需按权限退回设计中，并重新评审。'}</p>}
    <p className="modeling-hint">智能／手动是建模方式；业务语义／治理资产是手动对象创建时的依据。智能能力目前为交互演示，候选仍需人工确认。</p>
    {isUpdate && recent.length > 0 && <section className="modeling-resume"><h3>也可以继续已有建模对话</h3>{recent.map((task) => <button key={task.id} onClick={() => onContinue({ ...entry, method: 'resume', taskId: task.id })}><span>{task.title}<small>{TASK_LABELS[task.status] || '未完成'}</small></span><ArrowRight size={15} /></button>)}</section>}
  </Modal>;
}
