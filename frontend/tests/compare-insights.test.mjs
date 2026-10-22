import assert from 'node:assert/strict';
import test from 'node:test';
import { MOCK_COMPARE } from '../src/compareMock.js';
import {
  answerCompareQuestion, detectRenameSuggestions, driftTitle, groupSource, prettyValue, relatedDrifts, severityReason,
} from '../src/compareInsights.js';

test('compare fixture keeps the algorithm summary and 12 drifts', () => {
  assert.equal(MOCK_COMPARE.summary.total, 12);
  assert.equal(MOCK_COMPARE.drifts.length, 12);
  assert.equal(MOCK_COMPARE.summary.by_form.removed, 5);
  assert.equal(MOCK_COMPARE.summary.by_severity.P0, 5);
});

test('presentation layer groups object, attribute and relation drifts', () => {
  const groups = groupSource(MOCK_COMPARE.drifts);
  assert.deepEqual(groups.map((group) => [group.type, group.items.length]), [['对象类型', 6], ['对象属性', 4], ['关系', 2]]);
});

test('removed Prod links to its attribute and relation drifts', () => {
  const prod = MOCK_COMPARE.drifts.find((drift) => drift.res_key === 'Prod');
  const related = relatedDrifts(prod, MOCK_COMPARE.drifts);
  assert.equal(related.length, 2);
  assert.deepEqual(new Set(related.map((drift) => drift.res_key)), new Set(['Prod|prod_id', 'Ord|containsProduct|Prod']));
});

test('same-name removed and added resources produce rename suggestions without changing severity', () => {
  const suggestions = detectRenameSuggestions(MOCK_COMPARE.drifts);
  assert.equal(suggestions.length, 3);
  assert.deepEqual(suggestions.map((item) => item.kind).sort(), ['attribute', 'object', 'relation']);
  assert.equal(suggestions.some((item) => item.from === 'Prod' && item.to === 'Product'), true);
  assert.equal(MOCK_COMPARE.drifts.find((drift) => drift.res_key === 'Prod').severity, 'P0');
});

test('field values resolve domain names and expand extension JSON', () => {
  assert.equal(prettyValue('oot_biz_domain_id', 'fixver:BD-B', MOCK_COMPARE.domain_names), '销售域（fixver:BD-B）');
  assert.equal(prettyValue('extend_params', '{"fix":"ext-change"}'), '{\n  "fix": "ext-change"\n}');
  assert.equal(prettyValue('oop_biz_def', ''), '—');
});

test('drift titles read as business language', () => {
  const drifts = MOCK_COMPARE.drifts;
  assert.equal(driftTitle(drifts.find((item) => item.res_key === 'Ord'), drifts), '订单');
  assert.equal(driftTitle(drifts.find((item) => item.res_key === 'Ord|ord_amt'), drifts), '订单 · 订单金额');
  assert.equal(driftTitle(drifts.find((item) => item.res_key === 'Ord|containsProduct|Prod'), drifts), '订单 包含产品 产品');
});

test('AI rule answers use the compare evidence', () => {
  const context = { compare: MOCK_COMPARE, drifts: groupSource(MOCK_COMPARE.drifts).flatMap((group) => group.items), renames: detectRenameSuggestions(MOCK_COMPARE.drifts), domainNames: MOCK_COMPARE.domain_names };
  const p0 = answerCompareQuestion('P0 风险有哪些？', context);
  assert.match(p0, /P0 共 5 项/);
  assert.match(p0, /产品/);
  const rename = answerCompareQuestion('产品是不是改名了？', context);
  assert.match(rename, /疑似改名/);
  const specific = answerCompareQuestion('为什么产品删除是 P0？', context);
  assert.match(specific, /删除会使基线中的资源/);
  const summary = answerCompareQuestion('总结主要差异', context);
  assert.match(summary, /12 项差异/);
  assert.match(summary, /疑似改名/);
});

test('severity reason explains the algorithm grade without changing it', () => {
  const prod = MOCK_COMPARE.drifts.find((drift) => drift.res_key === 'Prod');
  const order = MOCK_COMPARE.drifts.find((drift) => drift.res_key === 'Ord');
  assert.match(severityReason(prod), /破坏属性、关系、映射/);
  assert.match(severityReason(order), /业务域归属发生迁移/);
});
