import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import Modal from '../components/Modal';
import ResourceHistoryLink from '../components/ResourceHistoryLink';
import useHistoryResourceFocus from '../hooks/useHistoryResourceFocus';
import PaginationBar from '../components/PaginationBar';
import { EmptyState } from '../components/StateViews';

const blank = () => ({ code: '', name: '', description: '', asset_kind: '数据实体', catalog_origin: 'enterprise_catalog',
  verification_status: 'candidate', governance_subject: '', asset_version: '', upstream_source_code: '', upstream_object: '',
  fields: [{ name: '', data_type: '', is_key: false }] });

export default function GovernanceAssets({ activeId, assets, sources, reload, notify, seed, onSeedConsumed }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(blank());
  const [schema, setSchema] = useState(null);
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => assets.filter((item) => `${item.code} ${item.name} ${item.governance_subject || ''} ${item.upstream_object || ''} ${item.upstream_source_code || ''}`.toLowerCase().includes(query.toLowerCase())), [assets, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const rows = filtered.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize);
  const selected = assets.find((item) => item.id === selectedId) || rows[0];
  useEffect(() => { setPage(1); }, [query, pageSize]);
  useHistoryResourceFocus({ resourceTypes: ['governance_asset'], items: assets, visible: filtered, pageSize, setPage, onSelect: (item) => setSelectedId(item.id), ready: Boolean(sources) });
  useEffect(() => {
    if (!seed) return;
    setEditor({});
    setForm({ ...blank(), catalog_origin: 'schema_candidate', upstream_source_code: seed.sourceCode,
      upstream_object: seed.table.name, fields: seed.table.columns.map((column) => ({ name: column.name,
        data_type: column.column_type || column.data_type || '', is_key: column.key === 'PRI' })) });
    onSeedConsumed?.();
  }, [seed]);
  useEffect(() => {
    let cancelled = false;
    setSchema(null);
    if (editor === null || form.catalog_origin !== 'schema_candidate' || !form.upstream_source_code) return;
    const source = sources.find((item) => item.code === form.upstream_source_code);
    if (!source) return;
    api(`/api/ontologies/${activeId}/enterprise/data-sources/${source.id}/schema`)
      .then((value) => { if (!cancelled) setSchema(value); })
      .catch(() => { if (!cancelled) setSchema(null); });
    return () => { cancelled = true; };
  }, [activeId, editor, form.catalog_origin, form.upstream_source_code, sources]);

  const open = (item = null) => { setEditor(item || {}); setForm(item ? { ...blank(), ...item, fields: item.fields?.length ? item.fields.map((field) => ({ ...field })) : blank().fields } : blank()); };
  const patchField = (index, patch) => setForm((old) => ({ ...old, fields: old.fields.map((field, position) => position === index ? { ...field, ...patch } : field) }));
  const chooseTable = (name) => {
    const table = schema?.schema?.tables?.find((entry) => entry.name === name);
    setForm((old) => ({ ...old, upstream_object: name,
      fields: table ? table.columns.map((column) => ({ name: column.name, data_type: column.column_type || column.data_type || '', is_key: column.key === 'PRI' })) : blank().fields }));
  };
  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const source = sources.find((item) => item.code === form.upstream_source_code);
      const payload = { catalog_origin: form.catalog_origin, verification_status: form.verification_status,
        asset_kind: form.asset_kind, governance_subject: form.governance_subject.trim(), asset_version: form.asset_version.trim(),
        upstream_source_code: form.catalog_origin === 'schema_candidate' ? form.upstream_source_code : '',
        upstream_object: form.catalog_origin === 'schema_candidate' ? form.upstream_object : '',
        fields: form.fields.map((field) => ({ name: field.name.trim(), data_type: field.data_type.trim(), is_key: Boolean(field.is_key) })),
        lineage_label: form.catalog_origin === 'schema_candidate' && source ? `${source.name} / ${form.upstream_object}` : '' };
      const path = editor.id ? `/api/ontologies/${activeId}/enterprise/governance-assets/${editor.id}` : `/api/ontologies/${activeId}/enterprise/governance-assets`;
      const saved = await api(path, { method: editor.id ? 'PUT' : 'POST', body: JSON.stringify({ code: form.code.trim(), name: form.name.trim(),
        description: form.description.trim(), category: form.asset_kind, status: form.verification_status === 'confirmed' ? 'active' : 'draft', payload }) });
      setEditor(null); setSelectedId(saved.id); await reload(); notify('治理资产元数据已保存；确认状态不代表与数据中台已建立运行连接。');
    } catch (cause) { notify(cause.message); } finally { setBusy(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(`删除治理资产“${item.name}”？被语义映射引用时系统会拒绝删除。`)) return;
    try { await api(`/api/enterprise/governance-assets/${item.id}`, { method: 'DELETE' }); setSelectedId(''); await reload(); notify('治理资产已删除'); }
    catch (cause) { notify(cause.message); }
  };
  return <>
    <div className="mapping-controls"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索治理资产名称、编码或主题" /></label><span className="mapping-layer-hint">治理目录资产是语义映射的唯一新建入口；物理来源仅作上游血缘。</span><button onClick={() => open()}><Plus size={15} /> 登记治理资产</button></div>
    <div className="mapping-v2-layout"><div className="mapping-v2-list-pane"><div className="mapping-v2-pane-heading"><strong>治理资产目录</strong><span>候选资产需人工确认后才可用于语义映射</span></div>
      <section className="mapping-v2-table governance-list"><header><span>资产名称／编码</span><span>资产类型</span><span>治理主题</span><span>字段数</span><span>状态</span></header>
        {rows.map((item) => <button type="button" key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}><span><strong>{item.name}</strong><small>{item.code}</small></span><span>{item.asset_kind || '—'}</span><span>{item.governance_subject || '—'}</span><span>{item.fields?.length || 0}</span><span className={`mapping-status ${item.verification_status === 'confirmed' ? 'confirmed' : ''}`}>{item.verification_status === 'confirmed' ? '已确认' : '待确认'}</span></button>)}
        {!rows.length && <EmptyState title="暂无治理资产" description="已治理企业可登记数据中台资产元数据；未治理企业可从已采集结构生成待确认候选。" />}</section>
      <PaginationBar page={Math.min(page, pages)} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /></div>
      <aside className="mapping-v2-inspector"><header><strong>治理资产详情</strong>{selected && <div><ResourceHistoryLink resourceType="governance_asset" resourceId={selected.id} /><button onClick={() => open(selected)}><Pencil size={14} /> 编辑</button><button className="danger-link" onClick={() => remove(selected)}><Trash2 size={14} /> 删除</button></div>}</header>
        <div className="mapping-drawer-body">{!selected ? <EmptyState title="请选择治理资产" description="右侧展示字段契约及可追溯的上游来源。" /> : <><h3>{selected.name}</h3><p>{selected.description || '尚未填写说明。'}</p><dl><div><dt>资产编码</dt><dd>{selected.code}</dd></div><div><dt>登记方式</dt><dd>{selected.catalog_origin === 'schema_candidate' ? '物理结构候选' : '企业治理目录登记'}</dd></div><div><dt>确认状态</dt><dd>{selected.verification_status === 'confirmed' ? '已人工确认' : '待人工确认'}</dd></div><div><dt>资产类型</dt><dd>{selected.asset_kind || '—'}</dd></div><div><dt>治理主题</dt><dd>{selected.governance_subject || '—'}</dd></div><div><dt>资产版本</dt><dd>{selected.asset_version || '—'}</dd></div><div><dt>上游血缘</dt><dd>{selected.lineage_label || '未登记；不推断物理来源'}</dd></div></dl><h4>字段契约</h4><div className="governance-field-list">{(selected.fields || []).map((field) => <div key={field.name}><strong>{field.name}</strong><span>{field.data_type || '类型未登记'}{field.is_key ? ' · 标识字段' : ''}</span></div>)}</div><p className="mapping-layer-note"><CheckCircle2 size={15} /> 本页只登记元数据，尚未对接企业数据中台 API，不代表实例数据可读取。</p></>}</div></aside></div>
    {editor && <Modal wide title={editor.id ? '编辑治理资产' : '登记治理资产'} onClose={() => setEditor(null)} footer={<><button className="btn secondary" onClick={() => setEditor(null)}>取消</button><button className="btn primary" form="governance-asset-form" disabled={busy}>{busy ? '保存中…' : '保存到工作状态'}</button></>}>
      <form id="governance-asset-form" className="form-sections" onSubmit={save}>
        <section className="form-section"><h3>资产身份</h3><div className="form-grid two"><label><span>资产编码</span><input required disabled={Boolean(editor.id)} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label><label><span>资产名称</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>资产类型</span><select value={form.asset_kind} onChange={(event) => setForm({ ...form, asset_kind: event.target.value })}><option>数据实体</option><option>治理视图</option><option>数据服务</option></select></label><label><span>治理主题</span><input value={form.governance_subject} onChange={(event) => setForm({ ...form, governance_subject: event.target.value })} placeholder="按企业数据中台原有名称填写" /></label><label><span>资产版本</span><input value={form.asset_version} onChange={(event) => setForm({ ...form, asset_version: event.target.value })} placeholder="如数据中台目录版本；可留空" /></label><label><span>确认状态</span><select value={form.verification_status} onChange={(event) => setForm({ ...form, verification_status: event.target.value })}><option value="candidate">待确认</option><option value="confirmed">已人工确认</option></select><small>候选不能作为新语义映射的来源；确认仅表示元数据已核对。</small></label><label className="form-grid-wide"><span>说明</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div></section>
        <section className="form-section"><h3>登记来源</h3><p className="form-hint">已有数据治理资产按目录登记；无治理层时可从已采集物理结构生成候选，需核对口径后确认。当前不自动生成治理表。</p><div className="form-grid two"><label><span>来源方式</span><select value={form.catalog_origin} onChange={(event) => setForm({ ...form, catalog_origin: event.target.value, upstream_source_code: '', upstream_object: '', fields: blank().fields, verification_status: 'candidate' })}><option value="enterprise_catalog">企业治理目录登记</option><option value="schema_candidate">从物理结构生成候选</option></select></label>{form.catalog_origin === 'schema_candidate' && <><label><span>上游物理数据源</span><select required value={form.upstream_source_code} onChange={(event) => setForm({ ...form, upstream_source_code: event.target.value, upstream_object: '', fields: blank().fields })}><option value="">请选择已采集结构的数据源</option>{sources.filter((item) => item.schema_snapshot).map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label><label><span>上游表</span><select required value={form.upstream_object} onChange={(event) => chooseTable(event.target.value)}><option value="">请选择来源表</option>{(schema?.schema?.tables || []).map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}</select></label></>}</div></section>
        <section className="form-section"><h3>字段契约</h3><p className="form-hint">仅登记字段元数据；物理结构候选自动带入已采集的字段，不读取业务行。</p><div className="governance-field-editor">{form.fields.map((field, index) => <div key={index}><input aria-label={`字段 ${index + 1} 名称`} required placeholder="字段名称" value={field.name} onChange={(event) => patchField(index, { name: event.target.value })} /><input aria-label={`字段 ${index + 1} 类型`} placeholder="数据类型" value={field.data_type} onChange={(event) => patchField(index, { data_type: event.target.value })} /><label><input type="checkbox" checked={Boolean(field.is_key)} onChange={(event) => patchField(index, { is_key: event.target.checked })} /> 标识字段</label><button type="button" disabled={form.fields.length === 1} onClick={() => setForm((old) => ({ ...old, fields: old.fields.filter((_, position) => position !== index) }))}>移除</button></div>)}</div><button type="button" className="mapping-add-field" onClick={() => setForm((old) => ({ ...old, fields: [...old.fields, { name: '', data_type: '', is_key: false }] }))}><Plus size={14} /> 添加字段</button></section>
      </form></Modal>}
  </>;
}
