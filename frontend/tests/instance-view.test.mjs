import test from 'node:test';
import assert from 'node:assert/strict';
import { instanceColumnValue, instanceCsvCell, normalizeInstanceProperties, orderInstanceColumns } from '../src/instanceView.js';
import { compareInstanceValues, instanceModelIssues, matchInstanceFilter, clampInstanceColumnWidth } from '../src/instanceView.js';
import { describeInstanceFilter } from '../src/instanceView.js';

const columns = [
  { id: '__key', kind: 'key' }, { id: '__title', kind: 'title' },
  { id: 'prop:amount', key: 'amount', kind: 'property' },
  { id: 'prop:status', key: 'status', kind: 'property' },
  { id: 'sys:record_status', key: 'record_status', kind: 'status' },
];

test('金额列按真实属性值排序，业务属性与系统状态分别读取', () => {
  const records = [
    { business_key: 'A', properties: { amount: 100, status: '已过账' }, record_status: '有效' },
    { business_key: 'B', properties: { amount: 9, status: '待过账' }, record_status: '冻结' },
  ];
  const sorted = [...records].sort((a, b) => instanceColumnValue(a, columns[2]) - instanceColumnValue(b, columns[2]));
  assert.deepEqual(sorted.map((row) => row.business_key), ['B', 'A']);
  assert.equal(instanceColumnValue(records[0], columns[3]), '已过账');
  assert.equal(instanceColumnValue(records[0], columns[4]), '有效');
});

test('列配置可全部隐藏可选列，也能保留顺序并忽略已删除属性', () => {
  assert.deepEqual(orderInstanceColumns(columns, []).map((column) => column.id), ['__key', '__title']);
  assert.deepEqual(orderInstanceColumns(columns, ['sys:record_status', 'prop:amount', 'prop:removed', 'prop:amount']).map((column) => column.id), ['__key', '__title', 'sys:record_status', 'prop:amount']);
});

test('编辑业务主键与来源后同步对应属性，保留数值零和布尔否', () => {
  const definitions = [
    { key: 'id', name: '编号', type: 'string', is_primary_key: true },
    { key: 'amount', name: '金额', type: 'decimal' },
    { key: 'enabled', name: '启用', type: 'boolean' },
    { key: 'source_system', name: '来源系统', type: 'string' },
  ];
  assert.deepEqual(normalizeInstanceProperties(definitions, { id: 'OLD', amount: '0', enabled: 'false', source_system: 'OLD' }, 'NEW', 'FIN'), { id: 'NEW', amount: 0, enabled: false, source_system: 'FIN' });
});

test('禁止把小数截断为整数，或把非法数值保存为 null', () => {
  const integer = [{ key: 'count', name: '次数', type: 'integer' }];
  assert.throws(() => normalizeInstanceProperties(integer, { count: '2.5' }, 'A', ''), /整数/);
  assert.throws(() => normalizeInstanceProperties(integer, { count: 'oops' }, 'A', ''), /整数/);
  assert.equal(normalizeInstanceProperties(integer, { count: '0' }, 'A', '').count, 0);
});

test('枚举值必须符合对象类型定义', () => {
  assert.throws(() => normalizeInstanceProperties([{ key: 'state', name: '状态', type: 'enum', options: ['草稿', '确认'] }], { state: '未知值' }, 'A', ''), /枚举/);
});

test('CSV 导出正确转义文本，阻止文本公式，保留负数金额', () => {
  assert.equal(instanceCsvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(instanceCsvCell('=1+2'), '"\'=1+2"');
  assert.equal(instanceCsvCell(-12.5), '"-12.5"');
});

test('属性筛选使用真实数值且区分 false、零和空值', () => {
  const row = { properties: { amount: 0, enabled: false } };
  assert.equal(matchInstanceFilter(row, { kind: 'property', key: 'amount', type: 'decimal' }, { operator: 'gte', value: '-1' }), true);
  assert.equal(matchInstanceFilter(row, { kind: 'property', key: 'amount', type: 'decimal' }, { operator: 'is_empty' }), false);
  assert.equal(matchInstanceFilter(row, { kind: 'property', key: 'enabled', type: 'boolean' }, { operator: 'equals', value: 'false' }), true);
});

test('升降序都将空值放在末尾，数值与文本编号分别比较', () => {
  assert.equal(compareInstanceValues('', 0, 'decimal', 'desc'), 1);
  assert.equal(compareInstanceValues(10, 2, 'decimal', 'asc'), 8);
  assert.ok(compareInstanceValues('A10', 'A2', 'string', 'asc') > 0);
});

test('对象配置问题可定位，列宽有明确上下界', () => {
  assert.equal(clampInstanceColumnWidth(1), 100);
  assert.equal(clampInstanceColumnWidth(9000), 600);
  const type = { title_property: 'id', properties: [{ key: 'id', is_primary_key: true }, { key: 'state', type: 'enum', options: [] }] };
  assert.equal(instanceModelIssues(type).length, 2);
});

test('筛选摘要保留运算符，空值条件不显示旧输入，系统码显示中文', () => {
  assert.equal(describeInstanceFilter({ operator: 'is_empty', value: '旧输入' }, { label: '金额' }), '金额 为空');
  assert.equal(describeInstanceFilter({ operator: 'gte', value: '100' }, { label: '金额' }), '金额 大于等于 100');
  assert.equal(describeInstanceFilter({ operator: 'equals', value: 'passed' }, { label: '质量状态', property: { optionLabels: { passed: '质量通过' } } }), '质量状态 等于 质量通过');
});
