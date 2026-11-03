// Pure table/form helpers shared by the instance workspace and its contract checks.
export function orderInstanceColumns(allColumns, visibleKeys) {
  const fixed = allColumns.filter((column) => ['__key', '__title'].includes(column.id));
  const byId = new Map(allColumns.map((column) => [column.id, column]));
  return [...fixed, ...[...new Set(visibleKeys)].filter((id) => !['__key', '__title'].includes(id) && byId.has(id)).map((id) => byId.get(id))];
}

export function instanceColumnValue(record, column) {
  if (!column) return '';
  if (column.kind === 'property') return record.properties?.[column.key] ?? '';
  if (column.kind === 'key') return record.business_key;
  if (column.kind === 'title') return record.title;
  return record[column.key] ?? '';
}

export function normalizeInstanceProperties(definitions, values, businessKey, sourceSystem) {
  return Object.fromEntries(definitions.map((property) => {
    let raw = property.is_primary_key ? businessKey : property.key === 'source_system' ? sourceSystem : values[property.key];
    if (raw === '' || raw === undefined || raw === null) return [property.key, ''];
    if (property.type === 'integer' || property.type === 'decimal') {
      const number = Number(raw);
      if (!Number.isFinite(number) || (property.type === 'integer' && !Number.isSafeInteger(number))) {
        throw new Error(`${property.name}必须是有效的${property.type === 'integer' ? '整数' : '数值'}。`);
      }
      raw = number;
    } else if (property.type === 'boolean') {
      if (![true, false, 'true', 'false'].includes(raw)) throw new Error(`${property.name}必须选择是或否。`);
      raw = raw === true || raw === 'true';
    } else if (property.type === 'datetime' && Number.isNaN(Date.parse(raw))) {
      throw new Error(`${property.name}请输入有效日期或日期时间。`);
    } else if (property.type === 'enum' && property.options?.length && !property.options.includes(raw)) {
      throw new Error(`${property.name}请选择有效的枚举值。`);
    }
    return [property.key, raw];
  }));
}

export const isReadOnlyProperty = (property) => ['计算属性', '实时属性'].includes(property?.property_category);
export const instanceDefinitions = (type) => type?.effective_properties || type?.properties || [];
export const editableTitleProperty = (type) => instanceDefinitions(type).find((property) => property.key === type?.title_property && !property.is_primary_key && !isReadOnlyProperty(property));

export function instanceModelIssues(type) {
  if (!type) return [];
  const properties = instanceDefinitions(type);
  const primary = properties.filter((property) => property.is_primary_key);
  const title = properties.find((property) => property.key === type.title_property);
  const issues = [];
  if (primary.length !== 1) issues.push('需要且仅需要一个稳定主键属性。');
  if (!title || title.is_primary_key) issues.push('建议将标题属性设置为业务名称，避免把编号同时用作实例标题。');
  if (type.state_property && !properties.some((property) => property.key === type.state_property)) issues.push('配置的状态属性不存在，请修正对象类型。');
  if (properties.some((property) => property.type === 'enum' && !property.options?.length)) issues.push('部分枚举属性未配置选项，实例表单无法可靠选择。');
  if (properties.some((property) => isReadOnlyProperty(property) && property.is_required && (property.default === null || property.default === undefined || property.default === ''))) issues.push('存在必填的计算或实时属性；手工新建前需配置生成来源，建议区分新建必填与同步后质量要求。');
  return issues;
}

export function matchInstanceFilter(record, column, filter) {
  const actual = instanceColumnValue(record, column);
  const empty = actual === '' || actual === null || actual === undefined;
  if (filter.operator === 'is_empty') return empty;
  if (filter.operator === 'not_empty') return !empty;
  if (empty) return false;
  const text = String(actual).toLocaleLowerCase();
  const expected = String(filter.value ?? '').toLocaleLowerCase();
  if (filter.operator === 'contains') return text.includes(expected);
  if (filter.operator === 'equals') return text === expected;
  if (filter.operator === 'neq') return text !== expected;
  const numeric = ['integer', 'decimal'].includes(column?.type);
  const date = column?.type === 'datetime' || column?.kind === 'datetime';
  const left = numeric ? Number(actual) : date ? Date.parse(actual) : text;
  const right = numeric ? Number(filter.value) : date ? Date.parse(filter.value) : expected;
  if ((numeric || date) && (!Number.isFinite(left) || !Number.isFinite(right))) return false;
  return ({ gt: left > right, gte: left >= right, lt: left < right, lte: left <= right })[filter.operator] ?? false;
}

export function compareInstanceValues(left, right, type, direction = 'asc') {
  const empty = (value) => value === null || value === undefined || value === '';
  if (empty(left) || empty(right)) return empty(left) === empty(right) ? 0 : empty(left) ? 1 : -1;
  const value = type === 'integer' || type === 'decimal' ? Number(left) - Number(right)
    : type === 'datetime' ? Date.parse(left) - Date.parse(right)
    : new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }).compare(String(left), String(right));
  return direction === 'desc' ? -value : value;
}

export const clampInstanceColumnWidth = (width) => Math.min(600, Math.max(100, Math.round(width)));

export function describeInstanceFilter(filter, column) {
  const labels = { contains: '包含', equals: '等于', neq: '不等于', gt: '大于 / 晚于', gte: '大于等于', lt: '小于 / 早于', lte: '小于等于', is_empty: '为空', not_empty: '不为空' };
  const suffix = ['is_empty', 'not_empty'].includes(filter.operator) ? '' : ` ${column?.property?.optionLabels?.[filter.value] || (column?.property?.type === 'boolean' ? filter.value === 'true' || filter.value === true ? '是' : '否' : filter.value)}`;
  return `${column?.label || '已失效属性'} ${labels[filter.operator] || filter.operator}${suffix}`;
}

export function readInstancePreference(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch { return fallback; }
}

export function writeInstancePreference(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function instanceCsvCell(value) {
  let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Keep user-supplied strings from becoming executable spreadsheet formulas.
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
