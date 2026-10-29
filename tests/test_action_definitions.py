"""v1 definition contracts; isolated DB, no formula/HTTP execution."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import repository as repo
import enterprise
import governance_insights as governance
from models import ActionBase, EnterpriseResourceBase
from main import app


class ActionDefinitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.old_db = repo.DB_PATH
        repo.DB_PATH = str(Path(cls.temp.name) / 'actions.db')
        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)
        repo.DB_PATH = cls.old_db
        cls.temp.cleanup()

    def setUp(self):
        self.ontology = repo.create_ontology(repo.OntologyBase(name='动作验收', namespace='actions.t' + __import__('uuid').uuid4().hex))
        self.oid = self.ontology['id']
        self.obj = repo.create_object_type(self.oid, repo.ObjectTypeBase(name='WorkOrder', display_name='工单', properties=[repo.PropertyDef(key='id', name='编号', is_primary_key=True)]))
        self.base = dict(name='assign_order', display_name='分派工单', external_id='ACT-001', target_object_type_id=self.obj['id'], action_category='business', action_type='modify', description='用于分派', execution_logic='检查状态后分派', owner='调度', parameters=[dict(key='assignee', name='处理人', type='string', is_required=True)], definition_version='v1.0', definition_config=dict(schema_version=1, definition_mode='text'))

    def post(self, payload=None):
        return self.client.post(f'/api/ontologies/{self.oid}/actions', json=self.base if payload is None else payload)

    def test_all_three_modes_round_trip(self):
        for mode in ('text', 'formula', 'api'):
            payload = copy.deepcopy(self.base)
            payload.update(name=f'action_{mode}', external_id=f'A-{mode}', display_name=mode)
            payload['definition_config'].update(definition_mode=mode, formula={'expression_text': 'quantity * price', 'variables_text': '数量、单价'}, api={'method': 'POST', 'url': '/orders/{id}', 'success_criteria_text': '业务码为零', 'request_example_text': '非JSON，仍可保存\n原文'})
            payload['result_schema'] = {'status': 'string'}
            result = self.post(payload)
            self.assertEqual(result.status_code, 201, result.text)
            saved = self.client.get('/api/actions/' + result.json()['id']).json()
            self.assertEqual(saved['definition_config'], payload['definition_config'])
            self.assertEqual(saved['description'], '用于分派')
            self.assertEqual(saved['result_schema'], payload['result_schema'])

    def test_uniqueness_and_scope(self):
        saved = self.post().json()
        for key in ('name', 'external_id', 'display_name'):
            payload = {**self.base, 'name': 'other', 'external_id': 'A-other', 'display_name': '另一个'}
            payload[key] = self.base[key]
            response = self.post(payload)
            self.assertEqual(response.status_code, 409, response.text)
        other = repo.create_ontology(repo.OntologyBase(name='另一本体', namespace='other.t' + __import__('uuid').uuid4().hex))
        obj = repo.create_object_type(other['id'], repo.ObjectTypeBase(name='OtherOrder', display_name='工单', properties=[repo.PropertyDef(key='id', name='编号', is_primary_key=True)]))
        self.assertNotEqual(repo.save_action(other['id'], ActionBase(**{**self.base, 'target_object_type_id': obj['id']}))['id'], saved['id'])
        response = self.post({**self.base, 'name': 'cross', 'external_id': 'A-cross', 'display_name': '跨本体', 'target_object_type_id': obj['id']})
        self.assertEqual(response.status_code, 400)

    def test_identity_concurrency_and_legacy_structures_preserved(self):
        saved = repo.save_action(self.oid, ActionBase(**{**self.base, 'preconditions': [{'expression': 'one'}, {'expression': 'two'}], 'side_effects': ['原始、联动'], 'result_schema': {'result': '旧结果'}}))
        conn = repo.get_conn(); metadata = json.loads(conn.execute('SELECT metadata FROM actions WHERE id=?', (saved['id'],)).fetchone()[0]); metadata['template_raw'] = {'行动名称': '来源证据'}; metadata['definition_config']['vendor'] = {'keep': True}; conn.execute('UPDATE actions SET metadata=? WHERE id=?', (json.dumps(metadata), saved['id'])); conn.commit(); conn.close()
        payload = {**self.base, 'owner': '新负责人', 'expected_updated_at': saved['updated_at'], 'definition_config': {'schema_version': 1, 'definition_mode': 'formula', 'formula': {'expression_text': '1 + 1'}}}
        response = self.client.put('/api/actions/' + saved['id'], json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        changed = response.json()
        for key in ('preconditions', 'side_effects', 'result_schema'): self.assertEqual(changed[key], saved[key])
        self.assertEqual(changed['template_raw'], {'行动名称': '来源证据'})
        self.assertTrue(changed['definition_config']['vendor']['keep'])
        self.assertEqual(self.client.put('/api/actions/' + saved['id'], json=payload).status_code, 409)
        for key, value in [('name', 'renamed'), ('external_id', 'new-id')]:
            response = self.client.put('/api/actions/' + saved['id'], json={**self.base, key: value})
            self.assertEqual(response.status_code, 400, response.text)

    def test_mode_schema_and_defaults_validation(self):
        cases = [ {'definition_config': {'schema_version': 1, 'definition_mode': 'formula'}},
                  {'definition_config': {'schema_version': 1, 'definition_mode': 'api', 'api': {'method': 'POST', 'url': 'javascript:bad', 'success_criteria_text': 'ok'}}},
                  {'parameters': [{'key': 'cost', 'name': '金额', 'type': 'integer', 'default': 'bad'}]},
                  {'parameters': [{'key': 'cost', 'name': '金额', 'type': 'enum', 'options': ['a'], 'default': 'b'}]},
                  {'object_effect': 'a' * 256}, {'owner': ''}, {'action_category': 'nonexistent'} ]
        for patch in cases:
            response = self.post({**self.base, **patch})
            self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(self.post({**self.base, 'result_schema': []}).status_code, 422)
        self.assertEqual(self.post({**self.base, 'parameters': [{'key': 'x', 'name': '一'}, {'key': 'x', 'name': '二'}]}).status_code, 400)
        self.assertEqual(repo.list_actions(self.oid), [])

    def test_dictionary_code_and_disabled_historical_category(self):
        saved = self.post({**self.base, 'action_category': '业务行动'}).json()
        self.assertEqual(saved['action_category'], 'business')
        conn = repo.get_conn(); conn.execute("UPDATE dic_action_type SET dat_status=0 WHERE dat_code='business'"); conn.commit(); conn.close()
        try:
            self.assertEqual(self.client.put('/api/actions/' + saved['id'], json={**self.base, 'owner': '新调度'}).status_code, 200)
            self.assertEqual(self.post({**self.base, 'name': 'disabled', 'display_name': '禁用', 'external_id': 'A-disabled'}).status_code, 400)
        finally:
            conn = repo.get_conn(); conn.execute("UPDATE dic_action_type SET dat_status=1 WHERE dat_code='business'"); conn.commit(); conn.close()

    def test_deletion_reference_protection(self):
        saved = self.post().json()
        mapping = enterprise.save_resource(self.oid, 'action-mappings', EnterpriseResourceBase(code='MAP-1', name='分派映射', payload={'action_code': saved['external_id']}))
        response = self.client.delete('/api/actions/' + saved['id'])
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn('分派映射', response.json()['detail'])
        enterprise.delete_resource('action-mappings', mapping['id'])
        self.assertEqual(self.client.delete('/api/actions/' + saved['id']).status_code, 204)
        self.assertEqual(self.client.get('/api/actions/' + saved['id']).status_code, 404)

    def test_bound_mapping_copy_export_import_and_reverse_guard(self):
        saved = self.post().json()
        mapping = enterprise.save_resource(self.oid, 'action-mappings', EnterpriseResourceBase(code='MAP-1', name='分派映射', payload={'action_code': saved['id']}))
        bound = repo.save_action(self.oid, ActionBase(**{**self.base, 'definition_config': {'schema_version': 1, 'definition_mode': 'api', 'action_mapping_code': mapping['code']}}), saved['id'])
        with self.assertRaises(repo.ConflictError): enterprise.delete_resource('action-mappings', mapping['id'])
        with self.assertRaises(repo.ValidationError): enterprise.save_resource(self.oid, 'action-mappings', EnterpriseResourceBase(code='MAP-1', name='错误改绑', payload={'action_code': 'other'}), mapping['id'])
        exported = repo.export_ontology(self.oid)
        imported = repo.import_ontology(exported)
        cloned = repo.copy_ontology(self.oid)
        for oid in (imported['id'], cloned['id']):
            copied = repo.list_actions(oid)[0]
            self.assertEqual(copied['definition_config'], bound['definition_config'])
            self.assertNotEqual(copied['target_object_type_id'], self.obj['id'])
            self.assertEqual(enterprise.list_resources(oid, 'action-mappings')[0]['code'], 'MAP-1')
            self.assertEqual(enterprise.list_resources(oid, 'action-mappings')[0]['action_code'], copied['id'])

    def test_new_fields_invalidate_quality_fingerprint(self):
        saved = self.post().json()
        before = governance._fingerprint(governance._current_semantic_snapshot(self.oid))
        repo.save_action(self.oid, ActionBase(**{**self.base, 'object_effect': '状态更新'}), saved['id'])
        after = governance._fingerprint(governance._current_semantic_snapshot(self.oid))
        self.assertNotEqual(before, after)


if __name__ == '__main__': unittest.main()
