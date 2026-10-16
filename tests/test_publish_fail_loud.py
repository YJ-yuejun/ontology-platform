"""发布路径不得静默吞异常。

修复前 publish() 是：

    try:
        from enterprise import RESOURCE_TABLES
        for table,_ in RESOURCE_TABLES.values(): conn.execute("UPDATE ... SET status='active' ...")
    except (ImportError, sqlite3.OperationalError): pass

企业资源（数据源、映射、场景等）没被置为 active 时，版本照样发布成功，
工作状态和已发布版本从此不一致。这里断言失败会真地抛出来。
"""
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
os.environ.setdefault("ONTOLOGY_MANUAL_DB", os.path.join(tempfile.mkdtemp(), "publish.db"))

import enterprise  # noqa: E402
import governance_insights  # noqa: E402
import repository as repo  # noqa: E402
from models import ObjectTypeBase, PropertyDef  # noqa: E402


class PublishFailLoudTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        repo.init_db()

    def _publishable_ontology(self):
        ontology = repo.create_ontology(repo.OntologyBase(
            name="发布测试本体", namespace=f"pub.{os.urandom(4).hex()}"))
        domain = repo.save_business_domain(ontology["id"], repo.BusinessDomainBase(
            code="contract.domain", name="合同域"))
        subject = repo.save_subject_domain(ontology["id"], repo.SubjectDomainBase(
            business_domain_id=domain["id"], code="contract.subject", name="合同主题"))
        repo.create_object_type(ontology["id"], ObjectTypeBase(
            name="Contract", display_name="合同", subject_domain_id=subject["id"],
            properties=[PropertyDef(key="contract_id", name="合同编号", is_primary_key=True)]))
        governance_insights.run_quality(ontology["id"], None)
        repo.submit_review(ontology["id"])
        repo.approve_review(ontology["id"])
        return ontology["id"]

    def test_publish_raises_when_enterprise_status_update_fails(self):
        ontology_id = self._publishable_ontology()
        original = enterprise.RESOURCE_TABLES
        enterprise.RESOURCE_TABLES = {
            **original,
            # 故意指向不存在的表：修复前这一步失败会被 except pass 吃掉。
            "broken-kind": ("enterprise_table_that_does_not_exist", "坏资源"),
        }
        try:
            with self.assertRaises(sqlite3.OperationalError):
                repo.publish(ontology_id, "minor", "验证静默失败", "测试评审人")
        finally:
            enterprise.RESOURCE_TABLES = original

    def test_publish_succeeds_on_normal_path(self):
        """正常路径不受影响。"""
        ontology_id = self._publishable_ontology()
        published = repo.publish(ontology_id, "minor", "正常发布", "测试评审人")
        self.assertEqual(published["status"], "published")


if __name__ == "__main__":
    unittest.main(verbosity=2)
