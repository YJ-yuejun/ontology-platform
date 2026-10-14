import { changeMappingType, mappingSourceKind, relationDefaultKey, resetMappingSource, selectMappingRelation, setMappingSourceField, sourceKindForLocation, sourceLocationLabel } from '../mappingForm';

export function MappingTargetFields({ form, setForm, objects, links }) {
  const object = objects.find((item) => item.name === form.target_object_type);
  return <section className="form-section"><h3>本体语义目标</h3><div className="form-grid two">
    <label><span>映射类型</span><select value={form.mapping_type} onChange={(event) => setForm((old) => changeMappingType(old, event.target.value))}><option value="property">属性映射</option><option value="relation">关系映射</option></select></label>
    <span className="form-grid-spacer" aria-hidden="true" />
    {form.mapping_type === 'property' ? <>
      <label><span>本体对象</span><select required value={form.target_object_type || ''} onChange={(event) => setForm((old) => resetMappingSource(old, { target_object_type: event.target.value, target_property: '' }))}><option value="">请选择对象</option>{objects.map((item) => <option value={item.name} key={item.id}>{item.display_name}</option>)}</select></label>
      <label><span>本体属性</span><select required disabled={!object} value={form.target_property || ''} onChange={(event) => setForm((old) => ({ ...resetMappingSource(old, { target_property: event.target.value }), source_key: old.source_key }))}><option value="">{object ? '请选择属性' : '请先选择本体对象'}</option>{(object?.properties || []).map((item) => <option value={item.key} key={item.key}>{item.name} · {item.key}</option>)}</select></label>
    </> : <><label><span>本体关系</span><select required value={form.target_relation || ''} onChange={(event) => setForm((old) => selectMappingRelation(old, links.find((item) => item.name === event.target.value)))}><option value="">请选择关系</option>{links.map((item) => {
      const start = objects.find((entry) => entry.id === item.source_object_type_id)?.display_name;
      const end = objects.find((entry) => entry.id === item.target_object_type_id)?.display_name;
      return <option value={item.name} key={item.id}>{start} → {item.display_name} → {end}</option>;
    })}</select></label><label><span>本体属性</span><input readOnly value="-" /></label></>}
  </div></section>;
}

function FieldPicker({ label, value, columns, onChange, required = true, disabled = false, placeholder = '填写来源字段' }) {
  return <label><span>{label}</span>{columns?.length ? <select required={required} disabled={disabled} value={value || ''} onChange={(event) => onChange(event.target.value)}><option value="">请选择字段</option>{value && !columns.some((item) => item.name === value) && <option value={value}>{value}（原有值，待核对）</option>}{columns.map((item) => <option value={item.name} key={item.name}>{item.name} · {item.column_type || item.data_type}</option>)}</select>
    : <input required={required} disabled={disabled} value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</label>;
}

export function MappingSourceFields({ form, setForm, sources, tables, objects, relation }) {
  const source = sources.find((item) => item.code === form.source_code);
  const kind = mappingSourceKind(form, source);
  const locationLabel = sourceLocationLabel(form, source);
  const table = kind === 'table' ? tables.find((item) => item.name === form.source_table || item.name === form.source_table?.split('.').at(-1)) : null;
  const property = objects.find((item) => item.name === form.target_object_type)?.properties?.find((item) => item.key === form.target_property);
  return <>
    <label><span>来源系统</span><select required value={form.source_code || ''} onChange={(event) => {
      const selected = sources.find((item) => item.code === event.target.value);
      setForm((old) => resetMappingSource(old, { source_code: event.target.value, source_table: '', source_kind: mappingSourceKind({}, selected) }, relation));
    }}><option value="">请选择来源系统</option>{sources.map((item) => <option value={item.code} key={item.id}>{item.name} · {item.code}</option>)}</select></label>
    <div className="mapping-location-field"><label htmlFor="mapping-source-location">{locationLabel}</label>
      <input id="mapping-source-location" list="mapping-source-locations" required value={form.source_table || ''} onChange={(event) => {
        const value = event.target.value;
        setForm((old) => resetMappingSource(old, { source_table: value,
          source_kind: sourceKindForLocation(value, source, tables, old.source_kind) }, relation));
      }} placeholder={form.mapping_type === 'relation' ? '如：任务线路明细' : '选择或填写来源名称'} />
      <datalist id="mapping-source-locations">{tables.map((item) => <option value={item.name} key={item.name} />)}</datalist>
    </div>
    {form.mapping_type === 'property' ? <>
      <FieldPicker label="来源字段" value={form.source_field} columns={table?.columns} onChange={(value) => setForm((old) => ({ ...old, source_field: value,
        source_key: property?.is_primary_key && ['直接映射', 'direct'].includes(old.map_way) && (!old.source_key || old.source_key === old.source_field) ? value : old.source_key }))} />
      <div className="mapping-key-field"><FieldPicker label="主键" value={form.source_key} columns={table?.columns} required={form.design_status === '已确认'} onChange={(value) => setForm((old) => ({ ...old, source_key: value }))} placeholder="填写能定位该对象的来源业务主键" /><small>用于定位本体对象；不一定是当前映射的来源字段，也不一定是物理表主键。</small></div>
    </> : <>
      <label><span>来源字段</span><input required value={form.source_field || ''} onChange={(event) => setForm((old) => setMappingSourceField(old, event.target.value))} placeholder="如：TASK_ID/PIPE_ID" /></label>
      <label><span>关联键</span><input required value={form.source_key || ''} onChange={(event) => setForm((old) => ({ ...old, source_key: event.target.value }))} placeholder="如：TASK_ID+PIPE_ID" /><small>{!relation ? '请先选择本体关系。' : relationDefaultKey(relation) ? '选择关系后自动带入，可修改；只影响本条映射。' : '所选关系未配置完整关联键，请填写。'}</small></label>
    </>}
  </>;
}

export function GovernedMappingFields({ form, setForm, assets }) {
  const asset = assets.find((item) => item.code === form.governance_asset_code);
  const fields = asset?.fields || [];
  const changeRelationField = (index, value) => setForm((old) => ({ ...old,
    governance_relation_fields: (old.governance_relation_fields || ['', '']).map((field, position) => position === index ? value : field) }));
  return <>
    <label><span>治理资产</span><select required value={form.governance_asset_code || ''} onChange={(event) => setForm((old) => ({ ...old, governance_asset_code: event.target.value, governance_field: '', governance_relation_fields: ['', ''] }))}>
      <option value="">请选择已确认的治理资产</option>{assets.filter((item) => item.verification_status === 'confirmed' || item.code === form.governance_asset_code).map((item) => <option key={item.id} value={item.code}>{item.name} · {item.code}{item.verification_status !== 'confirmed' ? '（待确认）' : ''}</option>)}
    </select><small>企业治理目录资产或已确认的结构候选；不直接选择物理表。</small></label>
    {form.mapping_type === 'property' ? <label><span>治理资产字段</span><select required disabled={!asset} value={form.governance_field || ''} onChange={(event) => setForm((old) => ({ ...old, governance_field: event.target.value }))}><option value="">请选择字段</option>{fields.map((field) => <option key={field.name} value={field.name}>{field.name}{field.data_type ? ` · ${field.data_type}` : ''}</option>)}</select></label> : <>
      <label><span>起点关联字段</span><select required disabled={!asset} value={form.governance_relation_fields?.[0] || ''} onChange={(event) => changeRelationField(0, event.target.value)}><option value="">请选择字段</option>{fields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}</select></label>
      <label><span>终点关联字段</span><select required disabled={!asset} value={form.governance_relation_fields?.[1] || ''} onChange={(event) => changeRelationField(1, event.target.value)}><option value="">请选择字段</option>{fields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}</select></label>
    </>}
    {asset && <p className="mapping-layer-note">上游物理血缘：{asset.lineage_label || '未登记，不推断来源'}。本次只配置治理资产 → 本体语义的映射。</p>}
  </>;
}
