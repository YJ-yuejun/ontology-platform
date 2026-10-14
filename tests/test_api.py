import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from fastapi.testclient import TestClient


PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "backend"))

import repository as repo  # noqa: E402
import enterprise  # noqa: E402
from main import app  # noqa: E402


class OntologyApiTests(unittest.TestCase):
    """v1.9 product-contract tests, isolated from the developer database."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        repo.DB_PATH = str(Path(self.temp_dir.name) / "test.db")
        self.client_context = TestClient(app)
        self.client = self.client_context.__enter__()
        ontologies = self.client.get("/api/ontologies").json()
        self.procurement = next(item for item in ontologies if item["namespace"] == "enterprise.supplychain.manual")
        self.pipeline = next(item for item in ontologies if item["namespace"] == "enterprise.pipeline.operations.manual")

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.temp_dir.cleanup()

    def request(self, method, path, expected=200, **kwargs):
        response = self.client.request(method, path, **kwargs)
        self.assertEqual(response.status_code, expected, response.text)
        return response.json() if response.content else None

    def create_workspace(self, suffix="contract"):
        ontology = self.request("POST", "/api/ontologies", 201, json={
            "name": "合同治理测试本体",
            "namespace": f"enterprise.test.{suffix}",
            "description": "验证新版直接分类、接口契约与发布流程",
        })
        business_domain = self.request("POST", f"/api/ontologies/{ontology['id']}/business-domains", 201, json={
            "code": "procurement", "name": "采购域", "description": "采购全生命周期", "owner": "采购管理部",
        })
        subject_domain = self.request("POST", f"/api/ontologies/{ontology['id']}/subject-domains", 201, json={
            "business_domain_id": business_domain["id"], "code": "procurement.contract",
            "name": "合同管理主题", "description": "采购合同与履约", "owner": "合同管理岗",
        })
        source = self.request("POST", f"/api/ontologies/{ontology['id']}/enterprise/data-sources", 201, json={
            "code": "SRC-CONTRACT", "name": "采购合同主表", "category": "业务数据库", "status": "draft",
            "description": "受治理的数据源引用",
            "payload": {"physical_object": "ods.purchase_contract", "system_type": "关系型数据库", "data_category": "主数据", "interface_type": "数据库", "update_frequency": "每日", "owner": "采购数据管理员"},
        })
        return ontology, business_domain, subject_domain, source

    @staticmethod
    def object_payload(subject_domain_id, interface_ids=None, source="SRC-CONTRACT"):
        return {
            "name": "PurchaseContract", "display_name": "采购合同", "icon": "file-text",
            "title_property": "contract_name", "description": "采购合同业务对象", "status": "experimental",
            "subject_domain_id": subject_domain_id, "interface_ids": interface_ids or [], "backing_source": source,
            "properties": [
                {"key": "contract_id", "name": "合同编号", "type": "string", "is_primary_key": True, "is_required": True, "is_searchable": True},
                {"key": "contract_name", "name": "合同名称", "type": "string", "is_required": True, "is_searchable": True},
            ],
        }

    def review_and_publish(self, ontology_id, **publish_options):
        quality = self.request("POST", f"/api/ontologies/{ontology_id}/quality-runs")
        self.assertTrue(quality["result"].startswith("通过"), quality["report"])
        self.request("POST", f"/api/ontologies/{ontology_id}/review/submit")
        self.request("POST", f"/api/ontologies/{ontology_id}/review/approve")
        return self.request("POST", f"/api/ontologies/{ontology_id}/publish", json=publish_options)

    def test_only_procurement_and_pipeline_builtins_remain(self):
        ontologies = self.request("GET", "/api/ontologies")
        self.assertEqual(
            {item["namespace"] for item in ontologies},
            {"enterprise.supplychain.manual", "enterprise.pipeline.operations.manual"},
        )
        self.assertEqual(self.procurement["status"], "published")
        self.assertEqual(self.pipeline["status"], "published")
        self.request("GET", f"/api/ontologies/{self.pipeline['id']}/shared-properties", 404)
        self.request("GET", f"/api/ontologies/{self.pipeline['id']}/object-type-groups", 404)
        self.request("DELETE", f"/api/ontologies/{self.procurement['id']}", 400)
        self.request("DELETE", f"/api/ontologies/{self.pipeline['id']}", 400)

    def test_activity_is_paged_and_bootstrap_does_not_repeat_legacy_changes(self):
        oid = self.procurement["id"]
        before = self.request("GET", f"/api/ontologies/{oid}/activity?include_system=true&page_size=20")
        repo.init_db()
        after = self.request("GET", f"/api/ontologies/{oid}/activity?include_system=true&page_size=20")
        self.assertEqual(after["total"], before["total"])

        ontology, _, _, _ = self.create_workspace("activity")
        url = f"/api/ontologies/{ontology['id']}/activity"
        result = self.request("GET", f"{url}?page_size=2")
        self.assertEqual(len(result["items"]), 2)
        self.assertGreater(result["total"], 2)
        self.assertNotIn("before_data", result["items"][0])
        self.assertNotIn("after_data", result["items"][0])
        self.assertTrue(any(item["actor"] == "manual-admin" for item in result["items"]))
        second = self.request("GET", f"{url}?page=2&page_size=2")
        self.assertNotEqual(result["items"][0]["id"], second["items"][0]["id"])
        filtered = self.request("GET", f"{url}?keyword=合同管理主题")
        self.assertEqual(filtered["total"], 1)
        self.assertEqual(filtered["items"][0]["component_type"], "subject_domain")

    def test_copy_ontology_reproduces_the_built_in_pipeline_ontology_without_a_single_diff(self):
        """整体复制本体：资源齐全、模板证据保留、引用改指副本，且与原体零语义差异。"""
        oid = self.pipeline["id"]
        copy = self.request("POST", f"/api/ontologies/{oid}/copy", 201, json={"name": "管道运输运营本体_copy"})
        new = copy["id"]
        self.assertNotEqual(new, oid)
        self.assertEqual(copy["origin_ontology_id"], oid)
        self.assertEqual(copy["name"], "管道运输运营本体_copy")
        self.assertNotEqual(copy["namespace"], self.pipeline["namespace"])

        source_stats = self.request("GET", f"/api/ontologies/{oid}/overview")["stats"]
        copy_stats = self.request("GET", f"/api/ontologies/{new}/overview")["stats"]
        for key in ("object_types", "link_types", "actions", "business_rules", "interfaces",
                    "business_domains", "subject_domains", "instances", "properties"):
            self.assertEqual(source_stats[key], copy_stats[key], key)

        source_objects = {item["name"]: item for item in self.request("GET", f"/api/ontologies/{oid}/object-types")}
        copy_objects = {item["name"]: item for item in self.request("GET", f"/api/ontologies/{new}/object-types")}
        self.assertEqual(set(source_objects), set(copy_objects))
        # 资源 ID 全部换新，业务标识（name）保留
        self.assertFalse({item["id"] for item in source_objects.values()}
                         & {item["id"] for item in copy_objects.values()})
        # 带“映射数据源”的对象在副本里仍然有效 —— 这要求数据源先于对象类型复制
        self.assertEqual(copy_objects["Contract"]["backing_source"], "DS-004")
        # 引用改指副本内部资源，不跨本体指回源
        copy_object_ids = {item["id"] for item in copy_objects.values()}
        for link in self.request("GET", f"/api/ontologies/{new}/link-types"):
            self.assertIn(link["source_object_type_id"], copy_object_ids)
            self.assertIn(link["target_object_type_id"], copy_object_ids)
        # 模板证据随 metadata 一起复制，不能丢
        for name in ("Customer", "Contract"):
            self.assertEqual(copy_objects[name]["template_raw"], source_objects[name]["template_raw"])
            self.assertEqual(copy_objects[name]["template_id"], source_objects[name]["template_id"])

        # 零语义差异：证明没有丢字段，也没有把引用 / 布尔默认值误报成修改
        import governance_insights
        diff = governance_insights.compare_ontologies(oid, new)
        self.assertEqual(diff["total"], 0, diff["rows"][:3])

    def test_pipeline_workbook_contract_is_complete_and_exact(self):
        oid = self.pipeline["id"]
        objects = self.request("GET", f"/api/ontologies/{oid}/object-types")
        links = self.request("GET", f"/api/ontologies/{oid}/link-types")
        actions = self.request("GET", f"/api/ontologies/{oid}/actions")
        scenarios = self.request("GET", f"/api/ontologies/{oid}/enterprise/business-scenarios")

        self.assertEqual({item["name"] for item in objects}, {
            "Customer", "Contract", "TransportTask", "Pipeline", "PipeSegment", "Station", "Equipment", "Alarm", "WorkOrder",
        })
        self.assertEqual({item["external_id"] for item in objects}, {f"OBJ-{index:03d}" for index in range(1, 10)})
        self.assertEqual({item["external_id"] for item in links}, {f"REL-{index:03d}" for index in range(1, 11)})
        self.assertEqual({item["external_id"] for item in actions}, {f"A-{index:03d}" for index in range(1, 5)})
        self.assertEqual({item["name"] for item in scenarios}, {"运输任务异常处置", "运输任务执行"})
        self.assertEqual(self.request("GET", f"/api/ontologies/{oid}")["version"], "v1.1.0")

        expected_counts = {
            "data-sources": 5, "data-mappings": 4, "logic-definitions": 4,
            "capabilities": 3, "action-mappings": 3, "permission-policies": 4,
        }
        for kind, count in expected_counts.items():
            self.assertEqual(len(self.request("GET", f"/api/ontologies/{oid}/enterprise/{kind}")), count)
        evidence = self.request("GET", f"/api/ontologies/{oid}/evidence")
        workbook = next(item for item in evidence if item["filename"] == "本体建模模板.xlsx")
        self.assertEqual(workbook["parse_summary"]["sheet_count"], 15)
        self.assertTrue(self.request("POST", f"/api/ontologies/{oid}/validate")["valid"])

    def test_pipeline_action_editor_keeps_exact_source_values_and_lineage(self):
        actions = {item["external_id"]: item for item in self.request("GET", f"/api/ontologies/{self.pipeline['id']}/actions")}
        expected = {
            "A-001": ("暂停运输任务", "业务行动", "运输任务", "任务编号、原因", "任务执行中且满足暂停条件", "调用调度能力暂停任务", "任务状态→暂停", "成功/失败", "通知调度、审计", "是", "示例负责人", "设计中"),
            "A-002": ("关闭阀门", "控制行动", "阀门", "阀门编号、关闭方式", "满足安全控制条件", "调用控制系统执行关闭", "阀门状态→关闭", "成功/失败", "回写状态、审计", "是", "示例负责人", "设计中"),
            "A-003": ("通知调度", "通知行动", "调度人员/事件", "事件、内容、等级", "产生需要人工关注的事件", "发送通知", "通知状态→已发送", "成功/失败", "审计记录", "否", "示例负责人", "设计中"),
            "A-004": ("创建工单", "业务行动", "设备/工单", "设备、故障、优先级", "异常需要维护处置", "调用工单系统创建", "生成工单对象", "工单编号", "关联告警、通知责任人", "否", "示例负责人", "设计中"),
        }
        fields = ("行动名称", "行动类型", "作用对象", "输入参数", "前置条件", "执行逻辑", "对象/属性变化", "执行结果", "副作用/联动", "需审批", "责任人", "状态")
        for code, values in expected.items():
            self.assertEqual(tuple(actions[code]["template_raw"][field] for field in fields), values)
        action = actions["A-002"]
        self.assertNotEqual(action["target_display_name"], action["template_raw"]["作用对象"])
        updated = self.request("PUT", f"/api/actions/{action['id']}", json={
            **{field: action[field] for field in repo.ActionBase.model_fields if field in action},
            "target_role": "阀门", "input_parameters_text": "阀门编号、关闭方式",
            "precondition_text": "满足安全控制条件", "result_text": "成功/失败",
            "side_effects_text": "回写状态、审计", "execution_logic": "调用控制系统执行关闭",
        })
        self.assertEqual(updated["target_role"], "阀门")
        self.assertEqual(updated["result_text"], "成功/失败")
        self.assertEqual(updated["template_raw"]["作用对象"], "阀门")
        self.assertEqual(updated["template_version"], "V1.0")

    def test_action_editor_fields_round_trip_for_new_action(self):
        ontology, _, subject, _ = self.create_workspace("actions")
        obj = self.request("POST", f"/api/ontologies/{ontology['id']}/object-types", 201,
                           json=self.object_payload(subject["id"]))
        action = self.request("POST", f"/api/ontologies/{ontology['id']}/actions", 201, json={
            "name": "action_a_101", "external_id": "A-101", "display_name": "暂停采购合同",
            "target_object_type_id": obj["id"], "target_role": "采购合同", "action_type": "modify",
            "action_category": "业务行动", "input_parameters_text": "合同编号、原因",
            "parameters": [{"key": "param1", "name": "合同编号"}, {"key": "param2", "name": "原因"}],
            "precondition_text": "合同履行中", "preconditions": [{"expression": "合同履行中", "message": "行动前置条件未满足"}],
            "execution_logic": "调用合同能力暂停合同", "object_effect": "合同状态→暂停",
            "result_text": "成功/失败", "result_schema": {"result": "成功/失败"},
            "side_effects_text": "通知经办人、审计", "side_effects": ["通知经办人", "审计"],
            "approval_required": True, "owner": "合同负责人", "design_status": "设计中",
        })
        fetched = self.request("GET", f"/api/actions/{action['id']}")
        for field in ("external_id", "display_name", "action_category", "target_role", "input_parameters_text",
                      "precondition_text", "execution_logic", "object_effect", "result_text",
                      "side_effects_text", "approval_required", "owner", "design_status"):
            self.assertEqual(fetched[field], action[field])

    def test_procurement_finance_ontology_is_retained(self):
        oid = self.procurement["id"]
        overview = self.request("GET", f"/api/ontologies/{oid}/overview")
        self.assertGreaterEqual(overview["stats"]["object_types"], 13)
        self.assertGreaterEqual(overview["stats"]["link_types"], 18)
        self.assertGreaterEqual(overview["stats"]["actions"], 10)
        objects = self.request("GET", f"/api/ontologies/{oid}/object-types")
        self.assertTrue({"PaymentRequest", "Contract", "Supplier", "Budget"}.issubset({item["name"] for item in objects}))
        self.assertTrue(self.request("POST", f"/api/ontologies/{oid}/validate")["valid"])

    def test_workbook_mappings_keep_target_object_and_property_separate(self):
        oid = self.pipeline["id"]
        mappings = {item["code"]: item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-mappings")}
        workbook_fields = {"映射ID", "映射类型", "本体对象/关系", "本体属性", "来源系统", "来源表/接口", "来源字段",
                           "主键/关联键", "映射方式", "转换规则", "质量校验", "更新方式", "负责人", "状态"}
        expected = {
            "M-001": ("property", "运输任务", "任务编号", "TransportTask", "taskId"),
            "M-002": ("property", "运输任务", "当前状态", "TransportTask", "status"),
            "M-003": ("property", "管段", "当前压力", "PipeSegment", "pressure"),
            "M-004": ("relation", "运输任务—经过—管段", "-", "TransportTask", None),
        }
        self.assertEqual(set(mappings), set(expected))
        for code, (kind, target_label, property_label, target_api, property_key) in expected.items():
            item = mappings[code]
            self.assertEqual(item["mapping_type"], kind)
            self.assertEqual(set(item["template_raw"]), workbook_fields)
            self.assertTrue(all(str(item["template_raw"][field]).strip() for field in workbook_fields))
            self.assertEqual(item["template_raw"]["本体对象/关系"], target_label)
            self.assertEqual(item["template_raw"]["本体属性"], property_label)
            self.assertEqual(item.get("target_object_type"), target_api)
            self.assertEqual(item.get("target_property"), property_key)
            self.assertEqual(item["source_key"], item["template_raw"]["主键/关联键"])
            self.assertEqual(item["design_status"], item["template_raw"]["状态"])
            self.assertEqual(item["owner"], item["template_raw"]["负责人"])
        self.assertEqual(mappings["M-004"]["source_field"], "TASK_ID/PIPE_ID")
        self.assertEqual(mappings["M-004"]["source_key"], "TASK_ID+PIPE_ID")
        self.assertTrue(mappings["M-004"]["target_relation"])

    def test_editing_workbook_mapping_keeps_all_original_template_fields(self):
        oid = self.pipeline["id"]
        mapping = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-mappings") if item["code"] == "M-002")
        updated = self.request("PUT", f"/api/ontologies/{oid}/enterprise/data-mappings/{mapping['id']}", json={
            "code": mapping["code"], "name": mapping["name"], "category": "属性映射",
            "status": mapping["status"], "description": mapping["description"],
            "payload": {"owner": "新负责人"},
        })
        self.assertEqual(updated["template_raw"], mapping["template_raw"])
        for field in ("source_key", "source_field", "map_way", "transform_rule", "quality_rule", "update_method_display", "design_status"):
            self.assertEqual(updated[field], mapping[field])
        self.assertEqual(updated["owner"], "新负责人")

    def test_mapping_type_contract_rejects_object_mapping(self):
        ontology, _, subject, source = self.create_workspace("mapping-kind")
        oid = ontology["id"]
        self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=self.object_payload(subject["id"]))
        body = {"code": "MAP-CONTRACT-ID", "name": "合同编号映射", "category": "对象映射", "status": "draft",
                "payload": {"mapping_type": "object", "source_code": source["code"],
                            "source_table": "purchase_contract", "source_field": "contract_id",
                            "target_object_type": "PurchaseContract", "target_property": "contract_id"}}
        self.request("POST", f"/api/ontologies/{oid}/enterprise/data-mappings", 400, json=body)
        body["category"] = "属性映射"
        body["payload"]["mapping_type"] = "property"
        saved = self.request("POST", f"/api/ontologies/{oid}/enterprise/data-mappings", 201, json=body)
        self.assertEqual(saved["mapping_type"], "property")
        self.assertEqual({row["code"] for row in self.request("GET", "/api/dictionaries/mapping_type") if row["status"] == "active"}, {"property", "relation"})
        confirmed = {**body, "code": "MAP-CONTRACT-CONFIRMED",
                     "payload": {**body["payload"], "design_status": "已确认", "owner": "合同管理员"}}
        self.request("POST", f"/api/ontologies/{oid}/enterprise/data-mappings", 400, json=confirmed)
        confirmed["payload"]["source_key"] = "contract_id"
        self.assertEqual(self.request("POST", f"/api/ontologies/{oid}/enterprise/data-mappings", 201, json=confirmed)["source_key"], "contract_id")

    def test_legacy_procurement_object_mapping_is_normalized_without_losing_reference(self):
        oid = self.procurement["id"]
        mapping = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-mappings") if item["code"] == "MAP-PAY-OBJECT")
        self.assertEqual(mapping["mapping_type"], "property")
        self.assertEqual(mapping["category"], "属性映射")
        conn = repo.get_conn()
        old_payload = {**json.loads(conn.execute("SELECT payload FROM enterprise_data_mappings WHERE id=?", (mapping["id"],)).fetchone()[0]), "mapping_type": "object"}
        conn.execute("UPDATE enterprise_data_mappings SET name='付款申请对象映射',category='对象映射',payload=? WHERE id=?",
                     (json.dumps(old_payload, ensure_ascii=False), mapping["id"]))
        conn.commit(); conn.close()
        enterprise.repair_mapping_type_contract()
        repaired = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-mappings") if item["code"] == "MAP-PAY-OBJECT")
        self.assertEqual(repaired["mapping_type"], "property")
        self.assertEqual(repaired["name"], "付款申请编号属性映射")
        self.assertEqual(repaired["legacy_mapping_type"], "object")
        enterprise.repair_mapping_type_contract()
        self.assertEqual(repaired["code"], "MAP-PAY-OBJECT")

    def test_interface_is_separate_and_enforced_as_a_contract(self):
        ontology, _, subject, _ = self.create_workspace("interface")
        oid = ontology["id"]
        interface = self.request("POST", f"/api/ontologies/{oid}/interfaces", 201, json={
            "name": "Auditable", "display_name": "可审计接口", "description": "要求对象具有审计状态", "status": "experimental",
            "properties": [{"key": "audit_status", "name": "审计状态", "type": "string", "is_required": True}],
        })
        invalid = self.object_payload(subject["id"], [interface["id"]])
        self.request("POST", f"/api/ontologies/{oid}/object-types", 400, json=invalid)
        valid = self.object_payload(subject["id"], [interface["id"]])
        valid["properties"].append({"key": "audit_status", "name": "审计状态", "type": "string", "is_required": True})
        created = self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=valid)
        self.assertEqual(created["interface_ids"], [interface["id"]])
        self.assertIsNone(created["plural_name"])
        self.request("DELETE", f"/api/interfaces/{interface['id']}", 400)
        abstract = dict(valid)
        abstract.update({"name": "AbstractContract", "object_kind": "abstract_type", "interface_ids": []})
        self.request("POST", f"/api/ontologies/{oid}/object-types", 400, json=abstract)

    def test_object_uses_direct_subject_and_registered_source(self):
        ontology, domain, subject, source = self.create_workspace("classification")
        self.request("POST", f"/api/ontologies/{ontology['id']}/object-types", 400, json=self.object_payload(subject["id"], source="unregistered.table"))
        self.request("POST", f"/api/ontologies/{ontology['id']}/object-types", 400,
                     json={**self.object_payload(subject["id"]), "domain": "财务域"})
        created = self.request("POST", f"/api/ontologies/{ontology['id']}/object-types", 201, json=self.object_payload(subject["id"]))
        self.assertEqual(created["subject_domain_id"], subject["id"])
        self.assertEqual(created["subject_domain_name"], "合同管理主题")
        self.assertEqual(created["business_domain_name"], "采购域")
        self.assertEqual(created["domain"], "采购域")
        self.assertEqual(created["backing_source"], source["code"])
        self.assertEqual(created.get("group_ids"), [])
        mapping_body = {
            "code": "MAP-CONTRACT-ID", "name": "合同编号属性映射", "category": "属性映射", "status": "draft",
            "description": "将物理合同编号映射到本体属性", "payload": {
                "mapping_type": "property", "source_code": source["code"], "source_table": "ods.purchase_contract",
                "source_field": "contract_id", "target_object_type": "PurchaseContract", "target_property": "contract_id",
                "map_way": "direct", "update_method": "batch", "quality_rule": "contract_id not null",
            },
        }
        mapping = self.request("POST", f"/api/ontologies/{ontology['id']}/enterprise/data-mappings", 201, json=mapping_body)
        renamed = {**mapping_body, "code": "MAP-RENAMED"}
        self.request("PUT", f"/api/ontologies/{ontology['id']}/enterprise/data-mappings/{mapping['id']}", 400, json=renamed)
        self.request("DELETE", f"/api/enterprise/data-sources/{source['id']}", 400)
        self.request("DELETE", f"/api/subject-domains/{subject['id']}", 204)
        self.assertIsNone(self.request("GET", f"/api/object-types/{created['id']}")["subject_domain_id"])
        self.request("DELETE", f"/api/business-domains/{domain['id']}", 204)

    def test_deleting_business_domain_removes_classifications_not_objects(self):
        ontology, domain, subject, _ = self.create_workspace("classification-delete")
        created = self.request("POST", f"/api/ontologies/{ontology['id']}/object-types", 201,
                               json=self.object_payload(subject["id"]))
        self.request("DELETE", f"/api/business-domains/{domain['id']}", 204)
        remaining = self.request("GET", f"/api/object-types/{created['id']}")
        self.assertIsNone(remaining["subject_domain_id"])
        self.assertEqual(self.request("GET", f"/api/ontologies/{ontology['id']}/subject-domains"), [])
        self.assertEqual(self.request("GET", f"/api/ontologies/{ontology['id']}/business-domains"), [])

    def test_structured_business_scenario_checks_references(self):
        oid = self.pipeline["id"]
        objects = self.request("GET", f"/api/ontologies/{oid}/object-types")
        links = self.request("GET", f"/api/ontologies/{oid}/link-types")
        segment = next(item for item in objects if item["name"] == "PipeSegment")
        equipment = next(item for item in objects if item["name"] == "Equipment")
        relation = next(item for item in links if item["source_object_type_id"] == segment["id"] and item["target_object_type_id"] == equipment["id"])
        base = {
            "code": "SCN-TEST-001", "name": "管段设备巡检", "category": "运行处置", "status": "draft",
            "description": "验证结构化场景配置",
            "payload": {
                "business_goal": "从管段定位设备并完成巡检闭环", "entry_object": "PipeSegment",
                "trigger_type": "manual", "trigger_condition": "人工发起巡检",
                "related_objects": ["PipeSegment", "Equipment"], "related_links": [relation["name"]],
                "related_rules": [], "related_actions": [], "source_codes": ["SRC-001"],
                "participants": ["巡检员"], "output_change": "生成巡检结论", "acceptance_criteria": ["对象与关系均可追溯"],
                "steps": [
                    {"order": 1, "name": "定位管段", "type": "object_resolve", "resource_ref": "PipeSegment", "on_failure": "stop"},
                    {"order": 2, "name": "穿透管段设备关系", "type": "link_traverse", "resource_ref": relation["name"], "on_failure": "stop"},
                    {"order": 3, "name": "验证巡检结果", "type": "verify", "resource_ref": "", "on_failure": "manual", "state_change": True},
                ],
            },
        }
        created = self.request("POST", f"/api/ontologies/{oid}/enterprise/business-scenarios", 201, json=base)
        self.assertEqual(created["entry_object"], "PipeSegment")
        invalid = {**base, "code": "SCN-TEST-002", "payload": {**base["payload"], "related_actions": ["missing_action"]}}
        self.request("POST", f"/api/ontologies/{oid}/enterprise/business-scenarios", 400, json=invalid)

    def test_semantic_scenario_can_be_saved_before_execution_steps(self):
        oid = self.pipeline["id"]
        scenario = self.request("POST", f"/api/ontologies/{oid}/enterprise/business-scenarios", 201, json={
            "code": "SCN-SEMANTIC-001", "name": "压力监测分析", "category": "", "status": "draft",
            "payload": {"business_goal": "识别管段压力变化", "trigger_condition": "压力数据更新",
                        "input_data": "当前压力、压力下限", "connected_systems": "监测系统",
                        "output_change": "形成异常判断", "related_objects": [], "steps": []},
        })
        self.assertEqual(scenario["input_data"], "当前压力、压力下限")
        self.request("POST", f"/api/ontologies/{oid}/scenarios/{scenario['id']}/run", 400,
                     json={"sample_data": {}})

    def test_mapping_validation_uses_schema_snapshot_without_business_rows(self):
        ontology, _, subject, source = self.create_workspace("mapping-static")
        oid = ontology["id"]
        self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=self.object_payload(subject["id"]))
        mapping = self.request("POST", f"/api/ontologies/{oid}/enterprise/data-mappings", 201, json={
            "code": "MAP-CONTRACT-KEY", "name": "合同主键映射", "category": "属性映射", "status": "draft",
            "payload": {"mapping_type": "property", "source_code": source["code"],
                        "source_table": "purchase_contract", "source_field": "contract_id",
                        "target_object_type": "PurchaseContract", "target_property": "contract_id",
                        "map_way": "direct"},
        })
        path = f"/api/ontologies/{oid}/enterprise/data-mappings/{mapping['id']}/validate"
        before = self.request("POST", path)
        self.assertEqual(before["status"], "pending")
        self.assertNotIn("match_rate", before)
        self.request("POST", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}/import-schema", json={
            "schema_data": {"origin": "data-dictionary-csv", "tables": [{"name": "purchase_contract", "columns": [
                {"name": "contract_id", "data_type": "varchar", "key": "PRI"}]}]},
        })
        result = self.request("POST", path)
        self.assertEqual(result["status"], "pending")  # 更新方式尚未定义，仅可静态确认字段。
        self.assertTrue(any(item["name"] == "来源字段／键" and item["level"] == "ok" for item in result["checks"]))
        self.assertNotIn("input", result)

    def test_mapping_validation_distinguishes_type_nullability_and_source_key(self):
        ontology, _, subject, source = self.create_workspace("mapping-compatibility")
        oid = ontology["id"]
        self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=self.object_payload(subject["id"]))
        mapping = self.request("POST", f"/api/ontologies/{oid}/enterprise/data-mappings", 201, json={
            "code": "MAP-CONTRACT-NAME", "name": "合同名称映射", "category": "属性映射", "status": "draft",
            "payload": {"mapping_type": "property", "source_code": source["code"],
                        "source_table": "purchase_contract", "source_field": "amount",
                        "source_key": "contract_id", "target_object_type": "PurchaseContract",
                        "target_property": "contract_name", "map_way": "直接映射", "update_method": "batch"},
        })
        self.request("POST", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}/import-schema", json={
            "schema_data": {"tables": [{"name": "purchase_contract", "columns": [
                {"name": "contract_id", "data_type": "varchar", "key": "PRI", "nullable": False},
                {"name": "amount", "data_type": "decimal", "column_type": "decimal(12,2)", "nullable": True},
            ]}]},
        })
        path = f"/api/ontologies/{oid}/enterprise/data-mappings/{mapping['id']}/validate"
        initial = self.request("POST", path)
        self.assertEqual(initial["status"], "error")
        self.assertTrue(any(check["name"] == "字段类型" and check["level"] == "error" for check in initial["checks"]))
        self.assertTrue(any(check["name"] == "必填约束" and check["level"] == "warning" for check in initial["checks"]))
        self.assertTrue(any(check["name"] == "主键/关联键" and check["level"] == "ok" for check in initial["checks"]))
        self.assertTrue(initial["snapshot_captured_at"])
        self.request("PUT", f"/api/ontologies/{oid}/enterprise/data-mappings/{mapping['id']}", json={
            "code": mapping["code"], "name": mapping["name"], "category": "属性映射",
            "status": mapping["status"], "description": mapping["description"],
            "payload": {"transform_rule": "按业务口径转为文本"},
        })
        revised = self.request("POST", path)
        self.assertEqual(revised["status"], "pending")
        self.assertTrue(any(check["name"] == "字段类型" and check["level"] == "warning" for check in revised["checks"]))

    def test_relation_mapping_checks_each_composite_source_field(self):
        oid = self.pipeline["id"]
        source = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-sources") if item["code"] == "DS-001")
        mapping = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-mappings") if item["code"] == "M-004")
        self.request("POST", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}/import-schema", json={
            "schema_data": {"origin": "data-dictionary-csv", "tables": [{"name": "任务线路明细", "columns": [
                {"name": "TASK_ID", "data_type": "varchar"}, {"name": "PIPE_ID", "data_type": "varchar"}]}]},
        })
        result = self.request("POST", f"/api/ontologies/{oid}/enterprise/data-mappings/{mapping['id']}/validate")
        source_checks = [item for item in result["checks"] if item["name"] == "来源字段／键"]
        self.assertEqual([(item["level"], item["detail"]) for item in source_checks],
                         [("ok", "TASK_ID"), ("ok", "PIPE_ID")])
        self.assertNotEqual(result["status"], "error")

    def test_relation_mapping_uses_workbook_composite_key_without_extra_target_key(self):
        oid = self.pipeline["id"]
        original = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-mappings") if item["code"] == "M-004")
        source = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-sources") if item["code"] == original["source_code"])
        self.request("POST", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}/import-schema", json={
            "schema_data": {"tables": [{"name": "任务线路明细", "columns": [
                {"name": "TASK_ID", "data_type": "varchar"}, {"name": "PIPE_ID", "data_type": "varchar"}]}]},
        })
        saved = self.request("POST", f"/api/ontologies/{oid}/enterprise/data-mappings", 201, json={
            "code": "M-NEW-REL", "name": "运输任务经过管段映射", "category": "关系映射", "status": "experimental",
            "payload": {"mapping_type": "relation", "target_relation": original["target_relation"],
                "target_object_type": "", "target_property": "", "source_code": source["code"],
                "source_table": "任务线路明细", "source_field": "TASK_ID/PIPE_ID",
                "source_key": "TASK_ID+PIPE_ID", "map_way": "关联映射", "design_status": "设计中"},
        })
        self.assertEqual(saved["source_key"], "TASK_ID+PIPE_ID")
        self.assertFalse(saved.get("target_key"))
        result = self.request("POST", f"/api/ontologies/{oid}/enterprise/data-mappings/{saved['id']}/validate")
        self.assertFalse(any(item["level"] == "error" for item in result["checks"]))

    def test_mapping_editor_preserves_template_semantics_and_checks_endpoint_roles(self):
        oid = self.pipeline["id"]
        mappings = self.request("GET", f"/api/ontologies/{oid}/enterprise/data-mappings")
        original = next(item for item in mappings if item["code"] == "M-004")
        relation = next(item for item in self.request("GET", f"/api/ontologies/{oid}/link-types")
                        if item["name"] == original["target_relation"])
        bindings = [
            {"role": "source", "object_type_id": relation["source_object_type_id"], "field": "TASK_ID"},
            {"role": "target", "object_type_id": relation["target_object_type_id"], "field": "PIPE_ID"},
        ]
        body = {"code": "M-EDITOR", "name": "关系字段绑定", "category": "关系映射", "status": "experimental",
                "payload": {"mapping_editor_version": 2, "mapping_type": "relation", "source_kind": "table",
                            "target_relation": original["target_relation"], "source_code": original["source_code"],
                            "source_table": original["source_table"], "source_field": "STALE", "source_key": "STALE",
                            "target_object_type": "stale", "target_property": "stale", "target_key": "stale",
                            "relation_field_bindings": bindings}}
        path = f"/api/ontologies/{oid}/enterprise/data-mappings"
        saved = self.request("POST", path, 201, json=body)
        self.assertEqual(saved["source_field"], original["source_field"])
        self.assertEqual(saved["source_key"], original["source_key"])
        self.assertEqual(saved["source_kind"], "table")
        self.assertFalse(saved["target_property"])
        self.assertFalse(saved["target_object_type"])
        update = f"{path}/{saved['id']}"
        wrong = {**body, "payload": {**body["payload"], "relation_field_bindings": [
            {**bindings[0], "object_type_id": relation["target_object_type_id"]}, bindings[1]]}}
        self.request("PUT", update, 400, json=wrong)
        missing = {**body, "payload": {**body["payload"], "relation_field_bindings": [bindings[0], {**bindings[1], "field": ""}]}}
        self.request("PUT", update, 400, json=missing)
        # M-003 is an attribute mapping backed by an API, not a table.
        api_mapping = next(item for item in mappings if item["code"] == "M-003")
        property_body = {**body, "category": "属性映射", "payload": {
            **body["payload"], "mapping_type": "property", "source_kind": "api",
            **{key: api_mapping[key] for key in ("source_code", "source_table", "source_field", "source_key",
                                                "target_object_type", "target_property", "map_way")}}}
        changed = self.request("PUT", update, json=property_body)
        self.assertEqual(changed["source_table"], "实时接口")
        self.assertEqual(changed["source_field"], "PRESSURE")
        self.assertEqual(changed["source_key"], "PIPE_ID")
        self.assertFalse(changed["target_relation"])
        self.assertEqual(changed["relation_field_bindings"], [])
        report = self.request("POST", f"{update}/validate")
        self.assertTrue(any(item["name"] == "来源接口" and item["level"] == "pending" for item in report["checks"]))

    def test_three_layer_mapping_preserves_legacy_and_requires_confirmed_governance_asset(self):
        oid = self.pipeline["id"]
        original = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-mappings") if item["code"] == "M-001")
        self.assertFalse(original.get("binding_mode"))
        self.assertEqual(original["source_field"], "TASK_ID")
        asset_path = f"/api/ontologies/{oid}/enterprise/governance-assets"
        payload = {"catalog_origin": "enterprise_catalog", "verification_status": "candidate", "asset_kind": "数据实体",
                   "governance_subject": "运输任务", "fields": [{"name": "task_id", "data_type": "string", "is_key": True}]}
        asset = self.request("POST", asset_path, 201, json={"code": "GOV-TASK", "name": "治理运输任务", "category": "数据实体", "payload": payload})
        mapping_path = f"/api/ontologies/{oid}/enterprise/data-mappings"
        mapped = {"mapping_editor_version": 3, "mapping_type": "property", "binding_mode": "governed",
                  "governance_asset_code": "GOV-TASK", "governance_field": "task_id",
                  "target_object_type": original["target_object_type"], "target_property": original["target_property"],
                  "design_status": "设计中", "map_way": "直接映射"}
        body = {"code": "M-GOV", "name": "治理任务编号映射", "category": "属性映射", "status": "experimental", "payload": mapped}
        self.request("POST", mapping_path, 400, json=body)
        asset = self.request("PUT", f"{asset_path}/{asset['id']}", json={"code": asset["code"], "name": asset["name"], "category": "数据实体",
                                                                        "payload": {**payload, "verification_status": "confirmed"}})
        saved = self.request("POST", mapping_path, 201, json=body)
        self.assertEqual(saved["governance_asset_code"], "GOV-TASK")
        self.assertFalse(saved.get("source_code"))
        report = self.request("POST", f"{mapping_path}/{saved['id']}/validate")
        self.assertFalse(any(item["level"] == "error" for item in report["checks"]))
        self.assertEqual(report["status"], "pending")
        self.request("DELETE", f"/api/enterprise/governance-assets/{asset['id']}", 400)
        self.request("PUT", f"{asset_path}/{asset['id']}", 400, json={"code": asset["code"], "name": asset["name"], "category": "数据实体",
                                                                    "payload": {**payload, "verification_status": "confirmed", "fields": [{"name": "renamed"}]}})
        legacy = next(item for item in self.request("GET", mapping_path) if item["code"] == "M-001")
        self.assertEqual(legacy["source_field"], "TASK_ID")

    def test_mapping_editor_keeps_existing_cross_table_join_keys(self):
        oid = self.procurement["id"]
        original = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-mappings")
                        if item["code"] == "MAP-PAY-CONTRACT")
        relation = next(item for item in self.request("GET", f"/api/ontologies/{oid}/link-types")
                        if item["name"] == original["target_relation"])
        payload = {key: original.get(key) for key in ("mapping_type", "source_code", "source_table", "source_field",
                                                     "source_key", "target_key", "target_relation", "map_way")}
        payload.update(mapping_editor_version=2, source_kind="table", relation_key_mode="join",
                       relation_field_bindings=[
                           {"role": "source", "object_type_id": relation["source_object_type_id"], "field": original["source_key"]},
                           {"role": "target", "object_type_id": relation["target_object_type_id"], "field": original["target_key"]}])
        saved = self.request("PUT", f"/api/ontologies/{oid}/enterprise/data-mappings/{original['id']}", json={
            "code": original["code"], "name": original["name"], "category": "关系映射", "status": original["status"], "payload": payload})
        for key in ("source_field", "source_key", "target_key", "target_relation"):
            self.assertEqual(saved[key], original[key])

    def test_template_mapping_editor_saves_single_source_fields_and_key_without_endpoint_inputs(self):
        oid = self.pipeline["id"]
        original = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-mappings")
                        if item["code"] == "M-004")
        keys = ("mapping_type", "target_relation", "source_code", "source_table", "source_field", "source_key",
                "map_way", "transform_rule", "quality_rule", "update_method", "owner", "design_status")
        payload = {key: original.get(key) for key in keys}
        payload.update(mapping_editor_version=3, source_kind="table", target_property="stale")
        path = f"/api/ontologies/{oid}/enterprise/data-mappings/{original['id']}"
        body = {"code": original["code"], "name": original["name"], "category": "关系映射",
                "status": original["status"], "payload": payload}
        saved = self.request("PUT", path, json=body)
        for key in keys:
            self.assertEqual(saved.get(key), original.get(key), key)
        self.assertFalse(saved["target_property"])
        self.assertEqual(saved["relation_field_bindings"], [])
        self.assertEqual(saved["source_field"], "TASK_ID/PIPE_ID")
        self.assertEqual(saved["source_key"], "TASK_ID+PIPE_ID")
        changed = self.request("PUT", path, json={**body, "payload": {**payload, "source_key": "TASK_ID+PIPE_ID+SEQUENCE"}})
        self.assertEqual(changed["source_key"], "TASK_ID+PIPE_ID+SEQUENCE")
        self.request("PUT", path, 400, json={**body, "payload": {**payload, "source_key": ""}})

    def test_source_password_is_stored_separately_and_never_returned(self):
        ontology, _, _, source = self.create_workspace("credential")
        oid = ontology["id"]
        body = {"code": source["code"], "name": source["name"], "category": source["category"],
                "status": "draft", "description": "结构采集连接", "payload": {
                    "system_type": "业务系统", "interface_type": "数据库", "driver": "mysql",
                    "host": "db.internal.example", "port": 3306, "database": "assetdb",
                    "username": "metadata_reader", "password": "secret-for-test"}}
        saved = self.request("PUT", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}", json=body)
        self.assertTrue(saved["credential_configured"])
        self.assertNotIn("password", saved)
        listed = next(item for item in self.request("GET", f"/api/ontologies/{oid}/enterprise/data-sources") if item["id"] == source["id"])
        self.assertNotIn("password", listed)
        import source_connections
        self.assertTrue(source_connections.has_password(source["id"]))
        conn = repo.get_conn()
        token = conn.execute("SELECT password_token FROM source_connection_secrets WHERE source_id=?", (source["id"],)).fetchone()[0]
        conn.close()
        self.assertNotIn("secret-for-test", token)

    def test_mysql_metadata_flow_reads_selected_structure_only(self):
        ontology, _, _, source = self.create_workspace("mysql-flow")
        oid = ontology["id"]
        self.request("PUT", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}", json={
            "code": source["code"], "name": source["name"], "category": source["category"],
            "status": "draft", "payload": {"driver": "mysql", "host": "db.internal.example",
                "port": 3306, "database": "assetdb", "username": "metadata_reader", "password": "test-secret"},
        })
        statements = []

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def execute(self, sql, params):
                statements.append(sql)
                self.sql = sql
            def fetchone(self): return {"total": 1}
            def fetchall(self):
                if "information_schema.COLUMNS" in self.sql:
                    return [{"COLUMN_NAME": "contract_id", "DATA_TYPE": "varchar", "COLUMN_TYPE": "varchar(32)",
                             "IS_NULLABLE": "NO", "COLUMN_KEY": "PRI", "COLUMN_COMMENT": "合同编号", "ORDINAL_POSITION": 1}]
                if "information_schema.KEY_COLUMN_USAGE" in self.sql: return []
                return [{"TABLE_NAME": "purchase_contract", "TABLE_TYPE": "BASE TABLE", "TABLE_COMMENT": "采购合同"}]

        class Remote:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def cursor(self): return Cursor()

        with patch("source_connections._connect", return_value=Remote()):
            self.assertEqual(self.request("POST", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}/test-connection")["table_count"], 1)
            self.assertEqual(len(self.request("GET", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}/tables")["tables"]), 1)
            snapshot = self.request("POST", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}/capture-schema", json={"table_names": ["purchase_contract"]})
        self.assertEqual(snapshot["schema"]["tables"][0]["columns"][0]["name"], "contract_id")
        self.assertTrue(all("information_schema" in statement for statement in statements))

    def test_additional_database_types_are_registered_without_claiming_live_connection(self):
        ontology, _, _, _ = self.create_workspace("database-types")
        oid = ontology["id"]
        for index, driver in enumerate(("postgresql", "oracle", "sqlserver", "dameng"), start=1):
            with self.subTest(driver=driver):
                source = self.request("POST", f"/api/ontologies/{oid}/enterprise/data-sources", 201, json={
                    "code": f"SRC-DRIVER-{index}", "name": f"{driver} 数据源", "category": "业务数据库",
                    "status": "draft", "payload": {"driver": driver, "system_type": "业务系统",
                        "physical_object": "业务表", "data_subject": "测试主题", "update_frequency": "日",
                        "data_scope": "表结构", "data_category": "主数据", "interface_type": "数据库"},
                })
                self.assertEqual(source["driver"], driver)
                self.assertFalse(source["credential_configured"])
                self.request("POST", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}/test-connection", 400)
                snapshot = self.request("POST", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}/import-schema", json={
                    "schema_data": {"tables": [{"name": "business_table", "columns": [{"name": "id", "data_type": "integer"}]}]},
                })
                self.assertEqual(snapshot["schema"]["tables"][0]["name"], "business_table")

    def test_template_rules_and_functions_are_both_visible_in_logic_registry(self):
        oid = self.pipeline["id"]
        logic = self.request("GET", f"/api/ontologies/{oid}/enterprise/logic-definitions")
        self.assertEqual({item["code"] for item in logic}, {"R-001", "R-002", "F-001", "F-002"})
        self.assertEqual({item["category"] for item in logic}, {"规则", "函数"})

    def test_editing_workbook_logic_preserves_all_fourteen_template_fields(self):
        oid = self.pipeline["id"]
        item = next(row for row in self.request("GET", f"/api/ontologies/{oid}/enterprise/logic-definitions") if row["code"] == "F-001")
        original = item["template_raw"]
        original_ontology_version = self.request("GET", f"/api/ontologies/{oid}")["version"]
        self.assertEqual(list(original), ["逻辑ID", "类型", "名称", "适用对象", "输入对象/数据", "输入属性",
                                          "判断/计算逻辑", "输出", "触发方式", "实时性", "可复用", "负责人", "状态", "版本"])
        edited = self.request("PUT", f"/api/ontologies/{oid}/enterprise/logic-definitions/{item['id']}", json={
            "code": item["code"], "name": item["name"], "category": item["category"],
            "status": item["status"], "description": item["description"],
            "payload": {"authoring_version": 2, "applicable_objects": ["TransportTask"],
                        "input_objects": ["TransportTask"], "input_properties": [],
                        "input_data_description": "运输任务、关联管段", "input_fields_display": "压力、流量、状态",
                        "logic": item["logic"], "output": item["output"], "owner": item["owner"],
                        "design_status": "已确认", "version": "V1.1"},
        })
        self.assertEqual(edited["template_raw"], original)
        self.assertEqual(edited["design_status"], "已确认")
        self.assertEqual(edited["version"], "V1.1")
        self.assertEqual(edited["input_data_description"], "运输任务、关联管段")
        ontology = self.request("GET", f"/api/ontologies/{oid}")
        self.assertEqual(ontology["version"], original_ontology_version)
        self.assertEqual(ontology["status"], "draft")

    def test_source_edit_keeps_original_workbook_row(self):
        oid = self.pipeline["id"]
        source = self.request("GET", f"/api/ontologies/{oid}/enterprise/data-sources")[0]
        original = source["template_raw"]
        edited = self.request("PUT", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}", json={
            "code": source["code"], "name": source["name"], "category": source["category"],
            "status": source["status"], "description": source["description"],
            "payload": {"owner": "数据治理负责人"},
        })
        self.assertEqual(edited["template_raw"], original)
        self.assertEqual(edited["data_subject"], source["data_subject"])
        self.assertEqual(edited["owner"], "数据治理负责人")

    def test_pipeline_data_sources_keep_all_nine_workbook_fields_without_placeholder_owner(self):
        rows = self.request("GET", f"/api/ontologies/{self.pipeline['id']}/enterprise/data-sources")
        expected = {
            "DS-001": ("调度系统", "业务系统", "运输任务接口/表", "运输任务", "实时/日", "任务计划与执行", "交易", "接口/数据库"),
            "DS-002": ("监测系统", "实时系统", "实时数据接口", "压力、流量、状态", "秒级", "运行监测", "实时", "实时接口"),
            "DS-003": ("资产系统", "资产管理", "资产台账", "管线、管段、设备", "日", "资产主数据", "主数据", "接口/数据库"),
            "DS-004": ("合同系统", "业务系统", "合同表/接口", "合同", "日", "合同主数据", "交易", "接口/数据库"),
            "DS-005": ("工单系统", "业务系统", "工单接口", "工单", "实时", "维护任务", "交易", "接口"),
        }
        self.assertEqual({item["code"] for item in rows}, set(expected))
        for item in rows:
            actual = tuple(item[key] for key in ("name", "system_type", "physical_object", "data_subject",
                                               "update_frequency", "data_scope", "data_category", "interface_type"))
            self.assertEqual(actual, expected[item["code"]])
            self.assertNotIn("owner", item)
            self.assertNotIn("connection_status", item)
            self.assertFalse(item["credential_configured"])
            self.assertIsNone(item["schema_snapshot"])
        objects = {item["name"]: item for item in self.request("GET", f"/api/ontologies/{self.pipeline['id']}/object-types")}
        for name in ("Customer", "PipeSegment", "Equipment"):
            self.assertIsNone(objects[name]["backing_source"])
            self.assertIn("待人工确认", objects[name]["source_binding_issue"])
        self.assertEqual(objects["TransportTask"]["backing_source"], "DS-001")

    def test_builtin_source_placeholder_status_is_repaired_without_touching_business_fields(self):
        pipeline_source = self.request("GET", f"/api/ontologies/{self.pipeline['id']}/enterprise/data-sources")[0]
        procurement_source = self.request("GET", f"/api/ontologies/{self.procurement['id']}/enterprise/data-sources")[0]
        conn = repo.get_conn()
        for source, additions in ((pipeline_source, {"owner": "示例负责人", "connection_status": "registered"}),
                                  (procurement_source, {"connection_status": "connected"})):
            row = conn.execute("SELECT payload FROM enterprise_data_sources WHERE id=?", (source["id"],)).fetchone()
            payload = {**json.loads(row["payload"]), **additions}
            conn.execute("UPDATE enterprise_data_sources SET payload=? WHERE id=?", (json.dumps(payload, ensure_ascii=False), source["id"]))
        conn.commit(); conn.close()
        enterprise.repair_data_source_provenance()
        repaired_pipeline = self.request("GET", f"/api/ontologies/{self.pipeline['id']}/enterprise/data-sources")[0]
        repaired_procurement = self.request("GET", f"/api/ontologies/{self.procurement['id']}/enterprise/data-sources")[0]
        self.assertEqual(repaired_pipeline["template_raw"], pipeline_source["template_raw"])
        self.assertNotIn("owner", repaired_pipeline)
        self.assertNotIn("connection_status", repaired_pipeline)
        self.assertNotIn("connection_status", repaired_procurement)
        self.assertEqual(repaired_procurement["source_origin"], "built_in_demo")

    def test_editing_workbook_object_keeps_source_evidence_and_unresolved_binding(self):
        objects = self.request("GET", f"/api/ontologies/{self.pipeline['id']}/object-types")
        customer = next(item for item in objects if item["name"] == "Customer")
        updated = self.request("PUT", f"/api/object-types/{customer['id']}", json={
            **customer, "description": customer["description"] + "（说明更新）",
        })
        self.assertEqual(updated["template_raw"], customer["template_raw"])
        self.assertEqual(updated["source_system"], "业务系统")
        self.assertIsNone(updated["backing_source"])
        self.assertIn("待人工确认", updated["source_binding_issue"])

    def test_ddl_import_extracts_schema_without_executing_sql(self):
        ontology, _, _, source = self.create_workspace("ddl")
        ddl = """CREATE TABLE `purchase_contract` (
            `contract_id` varchar(32) NOT NULL COMMENT '合同编号',
            `amount` decimal(12,2) NULL,
            PRIMARY KEY (`contract_id`)
        );"""
        result = self.request("POST", f"/api/ontologies/{ontology['id']}/enterprise/data-sources/{source['id']}/import-ddl", json={"ddl_text": ddl})
        self.assertEqual(result["table_count"], 1)
        self.assertEqual(result["schema"]["tables"][0]["columns"][0]["key"], "PRI")
        self.assertEqual(result["schema"]["tables"][0]["columns"][1]["column_type"], "decimal(12,2)")
        self.assertEqual(self.request("GET", f"/api/ontologies/{ontology['id']}/enterprise/data-sources/{source['id']}/schema")["id"], result["id"])

    def test_authored_logic_checks_object_references(self):
        ontology, _, subject, _ = self.create_workspace("logic")
        oid = ontology["id"]
        self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=self.object_payload(subject["id"]))
        body = {"code": "R-001", "name": "合同金额校验", "category": "规则", "status": "draft",
                "payload": {"authoring_version": 2, "applicable_objects": ["PurchaseContract"],
                            "input_objects": ["PurchaseContract"], "input_properties": ["PurchaseContract.contract_id"],
                            "logic": "合同编号存在", "output": "校验结果", "design_status": "设计中", "version": "V1.0"}}
        created = self.request("POST", f"/api/ontologies/{oid}/enterprise/logic-definitions", 201, json=body)
        self.assertEqual((created["design_status"], created["version"]), ("设计中", "V1.0"))
        body["code"] = "R-002"
        body["payload"]["design_status"] = "已发布"
        self.request("POST", f"/api/ontologies/{oid}/enterprise/logic-definitions", 400, json=body)
        body["payload"]["design_status"] = "设计中"
        body["payload"]["version"] = ""
        self.request("POST", f"/api/ontologies/{oid}/enterprise/logic-definitions", 400, json=body)
        body["payload"]["version"] = "V1.0"
        body["payload"]["input_properties"] = ["PurchaseContract.missing"]
        self.request("POST", f"/api/ontologies/{oid}/enterprise/logic-definitions", 400, json=body)
        body["payload"]["input_properties"] = ["PurchaseContract.contract_id"]
        body["payload"]["input_objects"] = []
        self.request("POST", f"/api/ontologies/{oid}/enterprise/logic-definitions", 400, json=body)

    def test_unclassified_object_cannot_enter_review(self):
        ontology, _, _, _ = self.create_workspace("unclassified")
        payload = self.object_payload(None)
        self.request("POST", f"/api/ontologies/{ontology['id']}/object-types", 201, json=payload)
        report = self.request("POST", f"/api/ontologies/{ontology['id']}/validate")
        self.assertFalse(report["valid"])
        self.assertTrue(any(item["component"] == "classification" for item in report["errors"]))
        self.request("POST", f"/api/ontologies/{ontology['id']}/review/submit", 400)

    def test_design_review_publish_state_machine(self):
        ontology, _, subject, _ = self.create_workspace("publish")
        oid = ontology["id"]
        self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=self.object_payload(subject["id"]))
        self.assertTrue(self.request("POST", f"/api/ontologies/{oid}/validate")["valid"])
        self.request("POST", f"/api/ontologies/{oid}/publish", 400, json={"bump": "minor"})
        self.request("POST", f"/api/ontologies/{oid}/review/submit", 400)
        self.assertTrue(self.request("POST", f"/api/ontologies/{oid}/quality-runs")["result"].startswith("通过"))
        self.assertEqual(self.request("POST", f"/api/ontologies/{oid}/review/submit")["status"], "in_review")
        self.assertEqual(self.request("POST", f"/api/ontologies/{oid}/review/approve")["status"], "reviewed")
        published = self.request("POST", f"/api/ontologies/{oid}/publish", json={
            "bump": "minor", "change_reason": "新版产品口径验收", "reviewer": "测试评审人",
        })
        self.assertEqual(published["status"], "published")
        self.assertEqual(published["version"], "v0.2.0")
        self.assertEqual(self.request("GET", f"/api/ontologies/{oid}/releases")[0]["reviewer"], "测试评审人")

    def test_v4_shared_dictionary_crud_and_reference_protection(self):
        kinds = self.request("GET", "/api/model-dictionaries")
        self.assertEqual({item["key"] for item in kinds}, {
            "data_type", "system_type", "data_category", "interface_type",
            "mapping_way", "action_type", "xform_rule",
        })
        created = self.request("POST", "/api/model-dictionaries/data_category", 201, json={
            "code": "quality_sample", "name": "质检样本", "description": "测试新增选项", "ordering": 30,
        })
        self.assertEqual(created["name"], "质检样本")
        edited = self.request("PUT", f"/api/model-dictionaries/data_category/{created['id']}", json={"name": "质检数据"})
        self.assertEqual(edited["name"], "质检数据")
        self.request("DELETE", f"/api/model-dictionaries/data_category/{created['id']}", 204)
        data_types = self.request("GET", "/api/model-dictionaries/data_type?include_disabled=true")
        string = next(item for item in data_types if item["code"] == "string")
        self.request("PUT", f"/api/model-dictionaries/data_type/{string['id']}", 409, json={"status": 0})
        self.request("DELETE", f"/api/model-dictionaries/data_type/{string['id']}", 409)

    def test_v4_model_change_records_direct_publish(self):
        ontology, _, subject, _ = self.create_workspace("v4changes")
        oid = ontology["id"]
        self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=self.object_payload(subject["id"]))
        pending = self.request("GET", f"/api/ontologies/{oid}/model-changes?pending=1")
        self.assertGreater(pending["total"], 0)
        self.assertTrue(all(item["mvc_pending"] == 1 for item in pending["items"]))
        published = self.review_and_publish(oid, bump="minor", change_reason="V4评审发布验证", reviewer="测试评审人")
        archived = self.request("GET", f"/api/ontologies/{oid}/model-changes?pending=0")
        self.assertTrue(any(item["mvc_ver_no"] == published["version"] for item in archived["items"]))
        self.assertTrue(any(item["mvc_chg_type"] == "发布" for item in archived["items"]))

    def test_history_property_difference_names_added_and_removed_attributes(self):
        before = json.dumps([{"key": "pressure", "name": "当前压力"}, {"key": "flow", "name": "流量"}])
        after = json.dumps([{"key": "pressure", "name": "实时压力"}, {"key": "risk", "name": "风险等级"}])
        self.assertEqual(repo._model_change_property_details(before, after), [
            "新增属性：风险等级（risk）", "删除属性：流量（flow）",
            "修改属性 实时压力（pressure）：名称：当前压力 → 实时压力",
        ])

    def test_history_one_save_keeps_multiple_changes_in_one_record(self):
        ontology, _, subject, _ = self.create_workspace('history-multiple')
        oid = ontology['id']
        payload = self.object_payload(subject['id'])
        obj = self.request('POST', f'/api/ontologies/{oid}/object-types', 201, json=payload)
        history_path = f'/api/ontologies/{oid}/model-changes?resource_type=object_type&resource_id={obj["id"]}'
        initial = self.request('GET', history_path)
        payload.update(display_name='采购框架合同', description='新的业务说明', owner='合同管理岗')
        payload['properties'][1]['name'] = '合同标题'
        self.request('PUT', f'/api/object-types/{obj["id"]}', json=payload)
        changed = self.request('GET', history_path)
        self.assertEqual(changed['total'], initial['total'] + 1)
        record = changed['items'][0]
        fields = {item['field']: item for item in record['mvc_field_changes']}
        self.assertEqual(fields['display_name']['before'], '采购合同')
        self.assertEqual(fields['display_name']['after'], '采购框架合同')
        self.assertEqual(fields['owner']['after'], '合同管理岗')
        self.assertEqual(fields['properties.contract_name.name']['after'], '合同标题')
        conn = repo.get_conn()
        saved = conn.execute('SELECT mvc_extend_params FROM mdl_ver_chg WHERE mvc_id=?', (record['mvc_id'],)).fetchone()
        conn.close()
        self.assertEqual(len(json.loads(saved['mvc_extend_params'])['changes']), len(fields))
        self.assertIn('对象名称：采购合同 → 采购框架合同', record['mvc_chg_content'])
        payload['description'] = '第二次修改说明'
        self.request('PUT', f'/api/object-types/{obj["id"]}', json=payload)
        next_history = self.request('GET', history_path)
        self.assertEqual(next_history['total'], changed['total'] + 1)
        self.assertEqual(next_history['items'][1]['mvc_id'], record['mvc_id'])

    def test_history_legacy_text_and_cascade_delete_identify_the_actual_resource(self):
        base = {'mvc_id': 1264, 'mvc_res_type': '映射', 'mvc_chg_type': '修改', 'mvc_extend_params': '{}',
                'mvc_chg_content': '修改数据映射「PROBE-MAP-92-001」：来源字段：CUST_ID → CUST_CODE；质量规则：not_null → 空'}
        modified = repo._model_change_display(base)
        self.assertEqual([(x['label'], x['before'], x['after']) for x in modified['mvc_field_changes']],
                         [('来源字段', 'CUST_ID', 'CUST_CODE'), ('质量规则', 'not_null', '空')])
        deleted = repo._model_change_display({**base, 'mvc_id': 1170, 'mvc_res_type': '主题域', 'mvc_chg_type': '删除',
                    'mvc_chg_content': '随业务域「ceshi1」删除主题域「测试修改主题域」'})
        self.assertEqual(deleted['mvc_resource_name'], '测试修改主题域')
        explicit = repo._model_change_display({**base, 'mvc_extend_params': json.dumps({'changes': [
            {'field': 'source_field', 'label': '来源字段', 'before': 'A', 'after': 'B'}]})})
        self.assertEqual(explicit['mvc_field_changes'][0]['before'], 'A')
        self.assertEqual(len(explicit['mvc_field_changes']), 1)

    def test_quality_report_is_persisted_and_marked_stale_after_semantic_change(self):
        ontology, domain, subject, _ = self.create_workspace("quality-report")
        oid = ontology["id"]
        self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=self.object_payload(subject["id"]))
        report = self.request("POST", f"/api/ontologies/{oid}/quality-runs")
        self.assertEqual(report["report"]["method"], "确定性模型规则检查")
        self.assertFalse(report["stale"])
        listed = self.request("GET", f"/api/ontologies/{oid}/quality-runs")
        self.assertEqual(listed[0]["id"], report["id"])
        with patch.dict("os.environ", {"DEEPSEEK_API_KEY": ""}):
            reply = self.request("POST", f"/api/ontologies/{oid}/quality-runs/{report['id']}/chat", json={"message": "有哪些问题？"})
        self.assertEqual(reply["mode"], "rule_fallback")
        scope = self.request("POST", f"/api/ontologies/{oid}/quality-runs/{report['id']}/chat", json={"message": "检查了什么？"})
        self.assertIn("本次按确定性模型规则检查执行", scope["answer"])
        self.request("POST", f"/api/ontologies/{oid}/subject-domains", 201, json={
            "business_domain_id": domain["id"], "code": "procurement.supplier", "name": "供应商主题",
        })
        self.assertTrue(self.request("GET", f"/api/ontologies/{oid}/quality-runs")[0]["stale"])
        seeded = self.request("POST", f"/api/ontologies/{self.procurement['id']}/quality-runs")
        self.assertFalse(any("'payload'" in item["message"] for item in seeded["report"]["issues"]))

    def test_version_compare_uses_release_snapshot_and_working_semantics(self):
        ontology, domain, subject, source = self.create_workspace("version-compare")
        oid = ontology["id"]
        self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=self.object_payload(subject["id"]))
        self.review_and_publish(oid, bump="minor", change_reason="测试基线")
        release = self.request("GET", f"/api/ontologies/{oid}/releases")[0]
        self.request("POST", f"/api/ontologies/{oid}/subject-domains", 201, json={
            "business_domain_id": domain["id"], "code": "procurement.supplier", "name": "供应商主题",
        })
        self.request("PUT", f"/api/ontologies/{oid}/enterprise/data-sources/{source['id']}", json={
            "code": source["code"], "name": source["name"], "category": source["category"],
            "status": "draft", "description": source["description"],
            "payload": {"physical_object": "ods.purchase_contract", "system_type": "关系型数据库",
                        "data_category": "主数据", "interface_type": "数据库", "update_frequency": "每小时",
                        "owner": "采购数据管理员"},
        })
        result = self.request("POST", f"/api/ontologies/{oid}/version-compare", json={"left": release["id"], "right": "working"})
        self.assertGreaterEqual(result["counts"]["added"], 1)
        self.assertTrue(any(row["name"] == "供应商主题" and row["change"] == "added" for row in result["rows"]))
        self.assertTrue(any(row["section"] == "data-sources" and "update_frequency" in row["changed_fields"] for row in result["rows"]))
        self.assertFalse(any("password" in json.dumps(row).lower() for row in result["rows"]))
        self.request("POST", f"/api/ontologies/{oid}/version-compare", 400, json={"left": release["id"], "right": release["id"]})
        with patch.dict("os.environ", {"DEEPSEEK_API_KEY": ""}):
            reply = self.request("POST", f"/api/ontologies/{oid}/version-compare/chat", json={"left": release["id"], "right": "working", "message": "总结变化"})
        self.assertEqual(reply["mode"], "rule_fallback")
        focused = self.request("POST", f"/api/ontologies/{oid}/version-compare/chat", json={"left": release["id"], "right": "working", "message": "供应商主题有什么变化？"})
        self.assertIn("供应商主题", focused["answer"])

    def test_published_semantic_snapshot_survives_later_deletion(self):
        ontology, _, subject, _ = self.create_workspace("immutable-history")
        oid = ontology["id"]
        first = self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=self.object_payload(subject["id"]))
        second_payload = self.object_payload(subject["id"])
        second_payload["name"] = "PurchaseOrder"
        second_payload["display_name"] = "采购订单"
        second = self.request("POST", f"/api/ontologies/{oid}/object-types", 201, json=second_payload)
        self.review_and_publish(oid, bump="minor", change_reason="首版")
        old_release = self.request("GET", f"/api/ontologies/{oid}/releases")[0]
        self.assertEqual(old_release["reviewer"], "manual-admin")
        activity = self.request("GET", f"/api/ontologies/{oid}/activity?page_size=50")
        self.assertTrue(any(item["operation"] == "review_approve" for item in activity["items"]))
        second_payload["status"] = "deprecated"
        self.request("PUT", f"/api/object-types/{second['id']}", json=second_payload)
        self.request("DELETE", f"/api/object-types/{second['id']}", 204)
        self.review_and_publish(oid, bump="minor", change_reason="移除采购订单")
        new_release = self.request("GET", f"/api/ontologies/{oid}/releases")[0]
        old_snapshot = self.request("GET", f"/api/ontologies/{oid}/releases/{old_release['id']}/snapshot")
        new_snapshot = self.request("GET", f"/api/ontologies/{oid}/releases/{new_release['id']}/snapshot")
        self.assertEqual({item["id"] for item in old_snapshot["object_types"]}, {first["id"], second["id"]})
        self.assertEqual({item["id"] for item in new_snapshot["object_types"]}, {first["id"]})
        self.assertNotIn("object_instances", old_snapshot)
        diff = self.request("POST", f"/api/ontologies/{oid}/version-compare", json={"left": old_release["id"], "right": new_release["id"]})
        self.assertTrue(any(row["change"] == "removed" and row["name"] == "采购订单" for row in diff["rows"]))


if __name__ == "__main__":
    unittest.main()
