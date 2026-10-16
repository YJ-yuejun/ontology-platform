"""map_way 必须以 dic_mapping_way 的 code 存储。

修复前前端 DictionaryField 的 valueMode 默认回写 name，用户在下拉里重选一次
可见项，就把 direct 静默写成「直接映射」，与按 code 存储的记录混在同一列。
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
os.environ.setdefault("ONTOLOGY_MANUAL_DB", os.path.join(tempfile.mkdtemp(), "mapway.db"))

import dictionary_service  # noqa: E402
import enterprise  # noqa: E402
import repository as repo  # noqa: E402
from models import EnterpriseResourceBase  # noqa: E402


class MappingWayContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        repo.init_db()

    def test_dictionary_covers_every_template_value(self):
        """模板里出现过的映射方式都有对应 code，否则前端只能存中文名。"""
        codes = {code for code, _ in dictionary_service.SEEDS["mapping_way"]}
        for code in ("direct", "enum_map", "expr", "script", "constant", "workflow", "link", "unit"):
            self.assertIn(code, codes)
        self.assertEqual(set(repo.MAPPING_WAY_CODES.values()), codes,
                         "迁移映射表与字典种子必须一一对应")

    def test_chinese_name_is_normalized_on_save(self):
        """走真实保存路径：写了中文名，落库必须是 code。"""
        ontology = repo.create_ontology(repo.OntologyBase(
            name="映射方式写入", namespace=f"mapwaywrite.{os.urandom(4).hex()}"))
        enterprise.save_resource(ontology["id"], "data-sources", EnterpriseResourceBase(
            code="SRC-1", name="合同主表", category="业务数据库", status="draft", description="",
            payload={"physical_object": "ods.contract", "system_type": "业务系统",
                     "data_category": "主数据", "interface_type": "数据库",
                     "update_frequency": "每日", "owner": "负责人"}))
        repo.create_object_type(ontology["id"], repo.ObjectTypeBase(
            name="Contract", display_name="合同",
            properties=[repo.PropertyDef(key="contract_id", name="合同编号", is_primary_key=True)]))

        for index, (written, expected) in enumerate((("直接映射", "direct"), ("字段/单位映射", "unit"))):
            saved = enterprise.save_resource(ontology["id"], "data-mappings", EnterpriseResourceBase(
                code=f"MAP-{index}", name=f"映射{index}", category="属性映射", status="draft", description="",
                payload={"mapping_type": "property", "source_code": "SRC-1", "source_table": "ods.contract",
                         "source_field": "contract_id", "target_object_type": "Contract",
                         "target_property": "contract_id", "map_way": written, "update_method": "batch"}))
            self.assertEqual(saved["map_way"], expected,
                             f"写入「{written}」应落库为 code {expected}")

    def test_migration_rewrites_legacy_rows_once(self):
        """迁移把历史中文值改写为 code，并且只跑一次。"""
        ontology = repo.create_ontology(repo.OntologyBase(
            name="映射方式迁移", namespace=f"mapway.{os.urandom(4).hex()}"))
        conn = repo.get_conn()
        conn.execute("DELETE FROM prototype_migrations WHERE migration_key=?",
                     ("v1.9-mapping-way-code-normalization",))
        for code, value in (("M-1", "直接映射"), ("M-2", "字段/单位映射"), ("M-3", "direct")):
            conn.execute(
                "INSERT INTO enterprise_data_mappings (id,ontology_id,code,name,category,status,description,payload,created_at,updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (code, ontology["id"], code, code, "属性映射", "draft", "", json.dumps({"map_way": value}, ensure_ascii=False), "t", "t"))
        conn.commit()
        conn.close()

        self.assertEqual(repo.migrate_mapping_way_codes(), 2, "只有中文值需要改写")

        conn = repo.get_conn()
        rows = {row["code"]: json.loads(row["payload"])["map_way"]
                for row in conn.execute("SELECT code,payload FROM enterprise_data_mappings WHERE ontology_id=?",
                                        (ontology["id"],)).fetchall()}
        conn.close()
        self.assertEqual(rows, {"M-1": "direct", "M-2": "unit", "M-3": "direct"})
        self.assertEqual(repo.migrate_mapping_way_codes(), 0, "已登记的迁移不应重复执行")


if __name__ == "__main__":
    unittest.main(verbosity=2)
