import { useMemo, useState, useEffect } from 'react';
import { Boxes, Database, GitBranch, Hammer, Layers3, ListChecks, Plus, Search, Waypoints, Workflow } from 'lucide-react';
import { formatTime } from '../api';
import PaginationBar from '../components/PaginationBar';

export default function Ontologies({ ontologies, activeId, onOpen, onCreate, notify }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const filtered = useMemo(() => ontologies.filter((item) => `${item.name} ${item.namespace} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase())), [ontologies, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, pageSize]);
  const resourceCount = ontologies.reduce((total, item) => total + item.object_type_count + item.link_type_count + item.action_count + (item.business_rule_count || 0) + item.interface_count + (item.scenario_count || 0) + (item.data_mapping_count || 0) + (item.logic_definition_count || 0), 0);
  const open = (item) => onOpen(item);

  return <div className="ontology-directory">
    <section className="ontology-directory-head">
      <div><span>本体目录</span><h1>全部本体</h1><p>每个本体都是独立的业务语义空间，选择后进入对象、关系与动作的建模工作状态。</p></div>
      <button className="oma-button ontology-directory-create" onClick={onCreate}><Plus size={16} /> 新建本体</button>
    </section>
    <section className="ontology-directory-summary">
      <div><strong>{ontologies.length}</strong><span>可访问本体</span></div>
      <div><strong>{resourceCount}</strong><span>模型资源</span></div>
    </section>
    <section className="ontology-directory-toolbar">
      <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索本体名称、命名空间或业务说明" /></label>
      <span>显示 {filtered.length} / 共 {ontologies.length} 个</span>
    </section>
    <div className="ontology-card-grid">
      {pageRows.map((item) => <article key={item.id} className={item.id === activeId ? 'active' : ''}>
        <button className="ontology-card-main" onClick={() => open(item)}>
          <div className="ontology-card-title"><i><Waypoints size={20} /></i><div><h2>{item.name}</h2><code>{item.namespace}</code></div>{item.id === activeId && <em>当前</em>}</div>
          <p>{item.description || '尚未填写业务范围说明。'}</p>
          <div className="ontology-card-resources">
            <span><Boxes size={14} /><b>{item.object_type_count}</b> 对象</span>
            <span><GitBranch size={14} /><b>{item.link_type_count}</b> 关系</span>
            <span><Hammer size={14} /><b>{item.action_count}</b> 动作</span>
            <span><ListChecks size={14} /><b>{item.business_rule_count || 0}</b> 规则</span>
            <span><Workflow size={14} /><b>{item.scenario_count || 0}</b> 场景</span>
            <span><Database size={14} /><b>{item.data_mapping_count || 0}</b> 映射</span>
            <span><Database size={14} /><b>{item.instance_count || 0}</b> 实例</span>
            <span><Layers3 size={14} /><b>{item.interface_count}</b> 接口</span>
          </div>
        </button>
        <footer><span className={`ontology-state ${item.status}`}>{item.status === 'published' ? '已发布' : '工作状态'}</span><span>{item.version}</span><time>更新于 {formatTime(item.updated_at)}</time><button onClick={() => open(item)}>打开本体</button></footer>
      </article>)}
    </div>
    <PaginationBar page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
    {!filtered.length && <div className="ontology-directory-empty"><Search size={28} /><strong>没有匹配的本体</strong><span>换一个关键词，或创建新的业务语义空间。</span></div>}
  </div>;
}
