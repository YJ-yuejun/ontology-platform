import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import repository as repo
from main import app


class InstanceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory(prefix='instance-contract-')
        cls.original_db = repo.DB_PATH
        repo.DB_PATH = str(Path(cls.folder.name) / 'isolated.db')
        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()
        cls.ontology = cls.client.post('/api/ontologies', json={'name': '实例契约验证', 'namespace': 'instance.contract.check'}).json()
        cls.base = f"/api/ontologies/{cls.ontology['id']}"
        domain = cls.client.post(cls.base + '/business-domains', json={'code': 'check', 'name': '验证域'}).json()
        subject = cls.client.post(cls.base + '/subject-domains', json={'code': 'check.instance', 'name': '实例', 'business_domain_id': domain['id']}).json()
        response = cls.client.post(cls.base + '/object-types', json={
            'name': 'ContractCheck', 'display_name': '验证对象', 'title_property': 'name', 'subject_domain_id': subject['id'],
            'properties': [
                {'key': 'id', 'name': '编号', 'type': 'string', 'is_primary_key': True, 'is_required': True},
                {'key': 'name', 'name': '名称', 'type': 'string', 'is_unique': True, 'is_required': True},
                {'key': 'amount', 'name': '金额', 'type': 'decimal'},
                {'key': 'count', 'name': '数量', 'type': 'integer'},
                {'key': 'enabled', 'name': '启用', 'type': 'boolean', 'is_required': True},
                {'key': 'state', 'name': '状态', 'type': 'enum', 'options': ['正常', '暂停']},
                {'key': 'time', 'name': '时间', 'type': 'datetime'},
            ],
        })
        assert response.status_code == 201, response.text
        cls.type = response.json()
        cls.serial = 0

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)
        repo.DB_PATH = cls.original_db
        cls.folder.cleanup()

    def payload(self):
        type(self).serial += 1
        key = f'CHECK-{type(self).serial}'
        return {'object_type_id': self.type['id'], 'business_key': key, 'title': key,
                'properties': {'id': key, 'name': key, 'enabled': False, 'amount': 0, 'count': 0, 'state': '正常', 'time': '2026-10-29'},
                'sync_status': 'disabled', 'quality_status': 'unknown'}

    def create(self):
        payload = self.payload()
        response = self.client.post(self.base + '/instances', json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        return payload, response.json()

    def test_false_zero_and_manual_sync_time_are_preserved(self):
        payload, record = self.create()
        self.assertIs(record['properties']['enabled'], False)
        self.assertEqual(record['properties']['amount'], 0)
        self.assertIsNone(record['last_synced_at'])
        response = self.client.put('/api/instances/' + record['id'], json={**payload, 'title': '手工编辑', 'expected_updated_at': record['updated_at']})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['last_synced_at'])

    def test_openapi_exposes_the_instance_edit_contracts(self):
        response = self.client.get('/openapi.json')
        self.assertEqual(response.status_code, 200, response.text)
        paths = response.json()['paths']
        self.assertIn('put', paths['/api/instance-links/{component_id}'])
        parameters = paths['/api/instances/{component_id}']['delete']['parameters']
        self.assertIn('expected_updated_at', [parameter['name'] for parameter in parameters])

    def test_direct_api_rejects_wrong_types_and_invalid_dates(self):
        for key, value in [('count', 1.2), ('count', True), ('amount', 'not-a-number'), ('enabled', 'false'), ('state', '不在值域'), ('time', '2026-02-30'), ('name', {'unsafe': 'shape'})]:
            with self.subTest(key=key, value=value):
                payload = self.payload()
                payload['properties'][key] = value
                response = self.client.post(self.base + '/instances', json=payload)
                self.assertEqual(response.status_code, 400, response.text)

    def test_optimistic_update_prevents_silent_lost_updates(self):
        payload, record = self.create()
        url = '/api/instances/' + record['id']
        first = self.client.put(url, json={**payload, 'title': '首位编辑者', 'expected_updated_at': record['updated_at']})
        self.assertEqual(first.status_code, 200, first.text)
        stale = self.client.put(url, json={**payload, 'title': '过期编辑者', 'expected_updated_at': record['updated_at']})
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(self.client.get(url).json()['title'], '首位编辑者')

    def test_primary_key_is_immutable_and_primary_property_must_match(self):
        payload, record = self.create()
        response = self.client.put('/api/instances/' + record['id'], json={**payload, 'business_key': 'OTHER'})
        self.assertEqual(response.status_code, 400, response.text)
        bad = self.payload()
        bad['properties']['id'] = 'mismatch'
        self.assertEqual(self.client.post(self.base + '/instances', json=bad).status_code, 400)

    def test_unique_properties_are_checked_on_backend(self):
        payload, record = self.create()
        another = self.payload()
        another['properties']['name'] = payload['properties']['name']
        response = self.client.post(self.base + '/instances', json=another)
        self.assertEqual(response.status_code, 409, response.text)

    def test_delete_checks_the_reviewed_instance_version(self):
        payload, record = self.create()
        url = '/api/instances/' + record['id']
        latest = self.client.put(url, json={**payload, 'title': '删除前发生变更', 'expected_updated_at': record['updated_at']}).json()
        self.assertEqual(self.client.delete(url, params={'expected_updated_at': record['updated_at']}).status_code, 409)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.delete(url, params={'expected_updated_at': latest['updated_at']}).status_code, 204)

    def test_relation_attributes_update_without_changing_endpoints(self):
        _, a = self.create()
        _, b = self.create()
        _, c = self.create()
        link = self.client.post(self.base + '/link-types', json={'name': 'weighted_check', 'display_name': '权重关联', 'source_object_type_id': self.type['id'], 'target_object_type_id': self.type['id'], 'cardinality': 'many_to_many', 'properties': [{'key': 'weight', 'name': '权重', 'type': 'decimal', 'is_required': True}]}).json()
        payload = {'link_type_id': link['id'], 'source_instance_id': a['id'], 'target_instance_id': b['id'], 'properties': {'weight': 1}}
        created = self.client.post(self.base + '/instance-links', json=payload).json()
        self.assertEqual(self.client.get('/api/instances/' + a['id']).json()['related'][0]['properties']['weight'], 1)
        url = '/api/instance-links/' + created['id']
        update = {**payload, 'properties': {'weight': 2}, 'expected_updated_at': created['updated_at']}
        response = self.client.put(url, json=update)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['properties']['weight'], 2)
        self.assertEqual(self.client.put(url, json=update).status_code, 409)
        self.assertEqual(self.client.put(url, json={**update, 'expected_updated_at': response.json()['updated_at'], 'target_instance_id': c['id']}).status_code, 400)

    def test_link_cardinality_duplicate_and_unlink_preserve_objects(self):
        _, a = self.create()
        _, b = self.create()
        _, c = self.create()
        link = self.client.post(self.base + '/link-types', json={'name': 'paired_with', 'display_name': '配对', 'source_object_type_id': self.type['id'], 'target_object_type_id': self.type['id'], 'cardinality': 'one_to_one'}).json()
        payload = {'link_type_id': link['id'], 'source_instance_id': a['id'], 'target_instance_id': b['id']}
        created = self.client.post(self.base + '/instance-links', json=payload)
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(self.client.post(self.base + '/instance-links', json=payload).json()['id'], created.json()['id'])
        self.assertEqual(self.client.post(self.base + '/instance-links', json={**payload, 'target_instance_id': c['id']}).status_code, 409)
        self.assertEqual(self.client.post(self.base + '/instance-links', json={**payload, 'source_instance_id': c['id']}).status_code, 409)
        self.assertEqual(self.client.delete('/api/instance-links/' + created.json()['id']).status_code, 204)
        self.assertEqual(self.client.get('/api/instances/' + a['id']).status_code, 200)
        self.assertEqual(self.client.get('/api/instances/' + b['id']).status_code, 200)
