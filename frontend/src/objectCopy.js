// 复制对象/关系时的命名与校验。对象 API 名称、关系 API 名称在本体内唯一，
// 复制只给出可改的默认值，保存前必须通过这里的唯一性校验。

export const NEW_OBJECT = '__new__';
const OBJECT_API_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const LINK_API_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

const snake = (value = '') => String(value).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase().replace(/^_+|_+$/g, '');

export function uniqueName(base, taken, suffix = (index) => String(index)) {
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}${suffix(index)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// “合同” → “合同（副本）”，已存在时依次为“合同（副本2）”“合同（副本3）”。
export function copyDisplayName(name, taken) {
  const first = `${name}（副本）`;
  if (!taken.has(first)) return first;
  for (let index = 2; ; index += 1) {
    const candidate = `${name}（副本${index}）`;
    if (!taken.has(candidate)) return candidate;
  }
}

// 对象副本的身份字段：显示名称加“（副本）”，API 名称加 Copy；模板 ID、状态重置，
// 避免副本冒用源对象的模板溯源或已启用状态。
export function copyObjectIdentity(source, objects = []) {
  const displayNames = new Set(objects.map((item) => item.display_name));
  const names = new Set(objects.map((item) => item.name));
  return {
    display_name: copyDisplayName(source.display_name, displayNames),
    name: uniqueName(`${source.name}Copy`, names),
    external_id: '',
    status: 'experimental',
    design_status: 'draft',
  };
}

// 关系 API 名称里若带着源对象名，就换成副本对象名；否则加 _copy 后缀。
export function suggestCopiedLinkName(link, source, newObjectName, taken) {
  const from = snake(source?.name); const to = snake(newObjectName);
  const base = from && to && from !== to && link.name.includes(from) ? link.name.split(from).join(to) : `${link.name}_copy`;
  const valid = LINK_API_NAME_PATTERN.test(base) ? base : `${link.name}_copy`;
  return uniqueName(valid, taken, (index) => `_${index}`);
}

/**
 * 复制对象时可一并复制的关系草稿。副本替换源对象所在的端点；源对象自关联时两端都换成副本。
 * 显示名称沿用（业务含义相同），API 名称按副本对象名生成。
 */
export function copyLinkDrafts(source, links = [], newObjectName = '') {
  const taken = new Set(links.map((item) => item.name));
  return links.filter((link) => link.source_object_type_id === source.id || link.target_object_type_id === source.id).map((link) => {
    const name = suggestCopiedLinkName(link, source, newObjectName, taken);
    taken.add(name);
    return {
      linkId: link.id, link, include: true, nameTouched: false,
      display_name: link.display_name, name,
      source_object_type_id: link.source_object_type_id === source.id ? NEW_OBJECT : link.source_object_type_id,
      target_object_type_id: link.target_object_type_id === source.id ? NEW_OBJECT : link.target_object_type_id,
    };
  });
}

// 副本对象 API 名称变化时，刷新用户没改过的关系 API 名称。
export function renameLinkDrafts(drafts, source, links, newObjectName) {
  const taken = new Set(links.map((item) => item.name));
  drafts.filter((draft) => draft.nameTouched).forEach((draft) => taken.add(draft.name));
  return drafts.map((draft) => {
    if (draft.nameTouched) return draft;
    const name = suggestCopiedLinkName(draft.link, source, newObjectName, taken);
    taken.add(name);
    return { ...draft, name };
  });
}

export function validateObjectCopy({ form, objects = [], links = [], drafts = [] }) {
  const displayName = String(form.display_name || '').trim();
  const sameDisplay = objects.find((item) => item.display_name === displayName);
  if (sameDisplay) return `显示名称“${displayName}”已被对象“${sameDisplay.name}”使用，请修改以便区分。`;
  const sameName = objects.find((item) => item.name === form.name);
  if (sameName) return `API 名称“${form.name}”已被对象“${sameName.display_name}”使用，对象 API 名称在本体内必须唯一。`;
  if (!OBJECT_API_NAME_PATTERN.test(String(form.name || ''))) return '';
  const linkNames = new Set(links.map((item) => item.name));
  const used = new Set();
  for (const draft of drafts.filter((item) => item.include)) {
    if (!String(draft.display_name || '').trim()) return `复制的关系“${draft.link.display_name}”缺少关系名称。`;
    if (!LINK_API_NAME_PATTERN.test(draft.name || '')) return `复制的关系“${draft.display_name}”的 API 名称只能用小写字母开头，包含小写字母、数字和下划线。`;
    if (linkNames.has(draft.name)) return `关系 API 名称“${draft.name}”已存在，请修改。`;
    if (used.has(draft.name)) return `复制的关系 API 名称“${draft.name}”重复，请保持唯一。`;
    used.add(draft.name);
  }
  return '';
}

// 单独复制一条关系：显示名称加“（副本）”，API 名称加 _copy；端点保留，可在表单里改。
export function copyLinkIdentity(link, links = []) {
  const taken = new Set(links.map((item) => item.name));
  return {
    display_name: copyDisplayName(link.display_name, new Set(links.map((item) => item.display_name))),
    name: uniqueName(`${link.name}_copy`, taken, (index) => `_${index}`),
    external_id: '', status: 'experimental', design_status: 'draft',
    reverse_name: link.reverse_name ? `${link.reverse_name}_copy` : '',
  };
}
