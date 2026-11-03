import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Download, FileUp, Layers3, Search, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import './SystemTransfer.css';

const MOCK_SOURCES = [
  { id: 'sample-ops', name: '共享运营业务系统', code: 'shared_operations', driver: 'MySQL', sample: true },
  { id: 'sample-schedule', name: '排班调度系统', code: 'scheduling', driver: 'MySQL', sample: true },
];
const key = 'ontology-transfer-demo-pending';
const readPending = () => { try { return JSON.parse(sessionStorage.getItem(key) || '[]'); } catch { return []; } };

export default function SystemTransfer({ mode, ontologies = [], onNavigateSources }) {
  const importing = mode === 'import';
  const [selected, setSelected] = useState([]);
  const [selectedSources, setSelectedSources] = useState([]);
  const [sources, setSources] = useState([]);
  const [ontologySearch, setOntologySearch] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  const [manifest, setManifest] = useState(null);
  const [fileError, setFileError] = useState('');
  const [choices, setChoices] = useState({});
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { setOntologySearch(''); setSourceSearch(''); setDone(false); }, [mode]);
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(ontologies.map(o => api(`/api/ontologies/${o.id}/enterprise/data-sources`).then(items => items.map(item => ({ id: `${o.id}:${item.id}`, name: item.name, code: item.code, driver: item.driver, ontology: o.name }))))).then(results => {
      if (cancelled) return;
      const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      setSources(all.length ? all : MOCK_SOURCES);
    });
    return () => { cancelled = true; };
  }, [ontologies]);
  const toggle = (value, setter) => setter(old => old.includes(value) ? old.filter(x => x !== value) : [...old, value]);
  const sourceRows = useMemo(() => sources.filter(s => `${s.name} ${s.code}`.toLowerCase().includes(sourceSearch.toLowerCase())), [sources, sourceSearch]);
  const ontologyRows = ontologies.filter(o => `${o.name} ${o.namespace}`.toLowerCase().includes(ontologySearch.toLowerCase()));
  const buildManifest = () => ({ kind: 'ontology-transfer-demo', version: 1, created_at: new Date().toISOString(), ontologies: ontologies.filter(o => selected.includes(o.id)).map(o => ({ id: o.id, name: o.name, namespace: o.namespace })), sources: sources.filter(s => selectedSources.includes(s.id)).map(s => ({ id: s.id, name: s.name, code: s.code, driver: s.driver || '', sample: !!s.sample })) });
  const saveDemo = () => {
    const data = buildManifest();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = '本体迁移_交互演示清单.json'; a.click(); URL.revokeObjectURL(url);
    setDone(true);
  };
  const loadDemo = async event => {
    setFileError(''); setDone(false);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('演示清单不能超过 1 MB');
      const data = JSON.parse(await file.text());
      if (data.kind !== 'ontology-transfer-demo' || data.version !== 1 || !Array.isArray(data.ontologies) || !Array.isArray(data.sources) || [...data.ontologies, ...data.sources].some(x => !x || typeof x.id !== 'string' || typeof x.name !== 'string')) throw new Error('请选择本页面导出的交互演示清单');
      setManifest(data); setSelected(data.ontologies.map(o => o.id)); setSelectedSources(data.sources.map(s => s.id)); setChoices({});
    } catch (e) { setManifest(null); setSelected([]); setSelectedSources([]); setFileError(e.message || '文件格式不正确'); }
    event.target.value = '';
  };
  const loadSample = () => { const data = { kind: 'ontology-transfer-demo', version: 1, ontologies: ontologies.slice(0, 2).map(o => ({ id: o.id, name: o.name, namespace: o.namespace })), sources: sources.slice(0, 1).map(s => ({ id: s.id, name: s.name, code: s.code, driver: s.driver || '' })) }; setManifest(data); setSelected(data.ontologies.map(o => o.id)); setSelectedSources(data.sources.map(s => s.id)); setChoices({}); setFileError(''); setDone(false); };
  const conflicts = (manifest?.ontologies || []).filter(o => selected.includes(o.id) && ontologies.some(x => x.id === o.id || (o.namespace && x.namespace === o.namespace)));
  const sourceConflicts = (manifest?.sources || []).filter(s => selectedSources.includes(s.id) && sources.some(x => x.code && x.code === s.code));
  const unresolved = [...conflicts.map(x => `o:${x.id}`), ...sourceConflicts.map(x => `s:${x.id}`)].filter(id => !choices[id]);
  const finishImport = () => {
    const pending = (manifest?.sources || []).filter(s => selectedSources.includes(s.id) && choices[`s:${s.id}`] !== 'skip' && choices[`s:${s.id}`] !== 'append').map(s => ({ name: s.name, code: s.code }));
    sessionStorage.setItem(key, JSON.stringify(pending));
    window.dispatchEvent(new Event('ontology-transfer-pending'));
    setDone(true);
  };
  return <div className="transfer-page">
    <div className="transfer-title"><div><h1>{importing ? '系统数据导入' : '系统数据导出'}</h1><p>本体与数据源迁移 · 交互原型</p></div><span className="transfer-demo">演示模式</span></div>
    <div className="transfer-note"><ShieldCheck size={17}/><span>本体按整体选择。数据源为共享资源，需单独勾选；账号、密码及其他凭据不随迁移，导入后需重新配置并验证连接。</span></div>
    {!importing ? <div className="transfer-layout"><aside className="transfer-aside"><b>导出范围</b><small>选择需要迁移的内容</small><button className="active"><Layers3 size={16}/> 本体与数据源 <em>{selected.length + selectedSources.length}</em></button></aside>
      <section className="transfer-panel"><header><div><h2>本体与数据源</h2><p>选择一个或多个本体及需要携带的数据源，本体按全部语义资源导出。</p></div><div className="transfer-head-actions"><button className="primary" disabled={!selected.length} onClick={saveDemo}><Download size={15}/> 生成演示清单</button></div></header>
        <div className="transfer-toolbar"><span>已选 {selected.length} 个本体 · {selectedSources.length} 个数据源</span></div>
        <div className="transfer-selection-grid">
          <section className="transfer-selection-column" aria-label="选择本体">
            <div className="transfer-section-title"><b>本体</b><small>已选 {selected.length} 个 · 每个本体包含全部语义资源</small></div>
            <label className="transfer-column-search"><Search size={15}/><input value={ontologySearch} onChange={e => setOntologySearch(e.target.value)} placeholder="搜索本体名称或标识" aria-label="搜索本体"/></label>
            <div className="transfer-selection-list">{ontologyRows.map(o => <label className="transfer-choice-row" key={o.id}><input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id, setSelected)}/><span><b>{o.name}</b><small>{o.namespace} · 全部语义资源</small></span></label>)}{!ontologyRows.length && <div className="transfer-empty-section">没有匹配的本体</div>}</div>
          </section>
          <section className="transfer-selection-column" aria-label="选择数据源">
            <div className="transfer-section-title"><b>数据源</b><small>已选 {selectedSources.length} 个 · 共享资源，默认不携带</small></div>
            <label className="transfer-column-search"><Search size={15}/><input value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} placeholder="搜索数据源名称或编码" aria-label="搜索数据源"/></label>
            <div className="transfer-inline-info"><AlertCircle size={15}/> 原型暂从各本体读取数据源，未实现全局共享目录；同名记录可能重复，请核对所属本体。</div>
            <div className="transfer-selection-list">{sourceRows.map(s => <label className="transfer-choice-row" key={s.id}><input type="checkbox" checked={selectedSources.includes(s.id)} onChange={() => toggle(s.id, setSelectedSources)}/><span><b>{s.name}</b><small>{s.code} · {s.driver || '未配置'} · {s.sample ? '演示数据' : s.ontology}</small></span></label>)}{!sourceRows.length && <div className="transfer-empty-section">没有匹配的数据源</div>}</div>
          </section>
        </div>{done && <div className="transfer-success"><CheckCircle2 size={17}/> 已下载演示清单。清单仅用于演示选择和导入流程，不包含模型资源、连接参数或凭据。</div>}
      </section></div> : <section className="transfer-panel transfer-import"><header><div><h2>导入迁移包</h2><p>上传后选择本体与数据源，处理冲突，再确认导入。</p></div><button onClick={() => fileRef.current?.click()}><FileUp size={15}/> 选择演示清单</button><input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={loadDemo}/></header>
      <div className="transfer-inline-info"><AlertCircle size={15}/> 当前仅支持本原型生成的 JSON 演示清单；不会导入真实本体或数据源。</div>
      {fileError && <div className="transfer-error">{fileError}</div>}
      {!manifest ? <div className="transfer-empty"><FileUp size={32}/><b>选择一个演示清单</b><p>可先到“系统数据导出”选择本体和数据源并生成演示清单，或直接加载示例。</p><button onClick={() => fileRef.current?.click()}>选择文件</button> <button onClick={loadSample} disabled={!ontologies.length}>加载示例清单</button></div> : <><div className="transfer-import-grid"><div><h3>选择需要导入的内容</h3><p>本体按整体导入，数据源可以单独选择；原型暂不检测本体引用的数据源是否遗漏。</p><h4>本体 <small>{selected.length} / {manifest.ontologies.length}</small></h4>{manifest.ontologies.map(o => <label className="transfer-select" key={o.id}><input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id, setSelected)}/><span><b>{o.name}</b><small>{o.namespace || '—'} · 全部语义资源</small></span></label>)}<h4>数据源 <small>{selectedSources.length} / {manifest.sources.length}</small></h4>{manifest.sources.map(s => <label className="transfer-select" key={s.id}><input type="checkbox" checked={selectedSources.includes(s.id)} onChange={() => toggle(s.id, setSelectedSources)}/><span><b>{s.name}</b><small>{s.code || '—'} · 需重新配置凭据</small></span></label>)}{!manifest.sources.length && <p>清单中未选择数据源。</p>}</div><div><h3>冲突处理</h3><p>本体按标识或命名空间检测，数据源按编码提示。覆盖更新已有内容；跳过保留原内容；追加仅补充不存在的内容。</p>{!conflicts.length && !sourceConflicts.length && <div className="transfer-no-conflict">未检测到冲突</div>}{conflicts.map(o => <div className="transfer-conflict" key={o.id}><span><b>{o.name}</b><small>本体已存在</small></span><select aria-label={`${o.name}本体冲突处理`} value={choices[`o:${o.id}`] || ''} onChange={e => setChoices({ ...choices, [`o:${o.id}`]: e.target.value })}><option value="">请选择</option><option value="overwrite">覆盖</option><option value="skip">跳过</option><option value="append">追加</option></select></div>)}{sourceConflicts.map(s => <div className="transfer-conflict" key={s.id}><span><b>{s.name}</b><small>数据源编码已存在</small></span><select aria-label={`${s.name}数据源冲突处理`} value={choices[`s:${s.id}`] || ''} onChange={e => setChoices({ ...choices, [`s:${s.id}`]: e.target.value })}><option value="">请选择</option><option value="overwrite">覆盖</option><option value="skip">跳过</option><option value="append">追加</option></select></div>)}</div></div><footer className="transfer-footer"><span>已选 {selected.length} 个本体 · {selectedSources.length} 个数据源{unresolved.length ? ` · ${unresolved.length} 项冲突待处理` : ''}</span><button className="primary" disabled={(!selected.length && !selectedSources.length) || !!unresolved.length} onClick={finishImport}>模拟导入</button></footer>{done && <div className="transfer-result"><CheckCircle2 size={20}/><div><b>导入流程演示完成</b><p>未写入实际数据。{readPending().length ? `演示中 ${readPending().length} 个数据源需检查凭据并重新验证连接。` : '没有需要新建并重新连接的数据源。'}</p>{readPending().length > 0 && <button onClick={onNavigateSources}>查看数据源待处理提示 <ArrowRight size={14}/></button>}</div></div>}</>}
    </section>}
  </div>;
}
export { readPending as readTransferPending };
