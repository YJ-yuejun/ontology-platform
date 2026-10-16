import test from 'node:test';
import assert from 'node:assert/strict';
import { copyDisplayName, copyLinkDrafts, copyLinkIdentity, copyObjectIdentity, NEW_OBJECT, renameLinkDrafts, validateObjectCopy } from '../src/objectCopy.js';

const contract = { id: 'c', name: 'PurchaseContract', display_name: '采购合同', status: 'active', external_id: 'OBJ-001' };
const supplier = { id: 's', name: 'Supplier', display_name: '供应商' };
const objects = [contract, supplier, { id: 'x', name: 'PurchaseContractCopy', display_name: '采购合同（副本）' }];
const links = [
  { id: 'l1', name: 'purchase_contract_to_supplier', display_name: '签约供应商', source_object_type_id: 'c', target_object_type_id: 's', reverse_name: 'contracts' },
  { id: 'l2', name: 'supplier_signs', display_name: '签署', source_object_type_id: 's', target_object_type_id: 'c' },
  { id: 'l3', name: 'contract_parent', display_name: '主合同', source_object_type_id: 'c', target_object_type_id: 'c' },
  { id: 'l4', name: 'unrelated', display_name: '无关', source_object_type_id: 's', target_object_type_id: 's' },
];

test('copied identity is unique and resets template id and status', () => {
  const identity = copyObjectIdentity(contract, objects);
  assert.equal(identity.display_name, '采购合同（副本2）');
  assert.equal(identity.name, 'PurchaseContractCopy2');
  assert.equal(identity.external_id, '');
  assert.equal(identity.status, 'experimental');
  assert.equal(copyDisplayName('供应商', new Set()), '供应商（副本）');
});

test('link drafts replace the source endpoint with the copy and rename api names', () => {
  const drafts = copyLinkDrafts(contract, links, 'FrameContract');
  assert.deepEqual(drafts.map((item) => item.linkId), ['l1', 'l2', 'l3']);
  const [outgoing, incoming, self] = drafts;
  assert.equal(outgoing.source_object_type_id, NEW_OBJECT);
  assert.equal(outgoing.target_object_type_id, 's');
  assert.equal(outgoing.name, 'frame_contract_to_supplier');
  assert.equal(incoming.source_object_type_id, 's');
  assert.equal(incoming.target_object_type_id, NEW_OBJECT);
  assert.equal(incoming.name, 'supplier_signs_copy');
  assert.equal(self.source_object_type_id, NEW_OBJECT);
  assert.equal(self.target_object_type_id, NEW_OBJECT);
  assert.ok(drafts.every((item) => item.include));
});

test('renaming the copied object refreshes untouched link names only', () => {
  const drafts = copyLinkDrafts(contract, links, 'FrameContract');
  drafts[1] = { ...drafts[1], name: 'my_custom_name', nameTouched: true };
  const renamed = renameLinkDrafts(drafts, contract, links, 'LeaseContract');
  assert.equal(renamed[0].name, 'lease_contract_to_supplier');
  assert.equal(renamed[1].name, 'my_custom_name');
});

test('copy validation rejects duplicated names before saving', () => {
  const drafts = copyLinkDrafts(contract, links, 'FrameContract');
  const form = { display_name: '框架合同', name: 'FrameContract' };
  assert.equal(validateObjectCopy({ form, objects, links, drafts }), '');
  assert.match(validateObjectCopy({ form: { ...form, name: 'Supplier' }, objects, links, drafts }), /API 名称“Supplier”已被对象/);
  assert.match(validateObjectCopy({ form: { ...form, display_name: '供应商' }, objects, links, drafts }), /显示名称“供应商”已被/);
  const clash = drafts.map((item, index) => (index === 0 ? { ...item, name: 'unrelated' } : item));
  assert.match(validateObjectCopy({ form, objects, links, drafts: clash }), /关系 API 名称“unrelated”已存在/);
  const dup = drafts.map((item) => ({ ...item, name: 'same_name' }));
  assert.match(validateObjectCopy({ form, objects, links, drafts: dup }), /重复/);
  const excluded = clash.map((item, index) => (index === 0 ? { ...item, include: false } : item));
  assert.equal(validateObjectCopy({ form, objects, links, drafts: excluded }), '', '未勾选的关系不参与校验');
});

test('copying a single link proposes a unique api name', () => {
  const identity = copyLinkIdentity(links[0], [...links, { name: 'purchase_contract_to_supplier_copy', display_name: '签约供应商（副本）' }]);
  assert.equal(identity.name, 'purchase_contract_to_supplier_copy_2');
  assert.equal(identity.display_name, '签约供应商（副本2）');
  assert.equal(identity.reverse_name, 'contracts_copy');
});
