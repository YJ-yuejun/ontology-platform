"""连接泄漏回归测试。

背景：repository.py 里大量 `conn = get_conn()` 之后调用会抛错的校验函数
（_ensure_object_in_ontology、_validate_object_bindings、_validate_link_status 等），
抛出路径上没有 close()，反复触发会耗尽文件描述符。
修复方式：get_conn() 把连接登记到 ContextVar，入口函数由 @_no_leak 兜底关闭。

这个测试通过替换 sqlite3.connect 来记录"打开过哪些连接"和"哪些被关过"。
"""
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
os.environ.setdefault("ONTOLOGY_MANUAL_DB", os.path.join(tempfile.mkdtemp(), "leak.db"))

import repository as repo  # noqa: E402
from models import LinkTypeBase, ObjectTypeBase, PropertyDef  # noqa: E402

_OPENED = []
_CLOSED = []
_REAL_CONNECT = sqlite3.connect


class TrackingConnection(sqlite3.Connection):
    """记录 close() 是否被调用；sqlite3.Connection 的实例属性只读，只能靠子类。"""

    def close(self):
        if self not in _CLOSED:
            _CLOSED.append(self)
        return super().close()


def _counting_connect(*args, **kwargs):
    kwargs["factory"] = TrackingConnection
    conn = _REAL_CONNECT(*args, **kwargs)
    _OPENED.append(conn)
    return conn


class ConnectionLeakTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        repo.init_db()
        repo.sqlite3.connect = _counting_connect

    @classmethod
    def tearDownClass(cls):
        repo.sqlite3.connect = _REAL_CONNECT

    def setUp(self):
        _OPENED.clear()
        _CLOSED.clear()
        self.ontology = repo.create_ontology(
            repo.OntologyBase(name="泄漏测试本体", namespace=f"leak.{os.urandom(4).hex()}"))

    def _assert_no_leak(self, start):
        batch = _OPENED[start:]
        self.assertTrue(batch, "这一轮应当至少打开过一个连接")
        leaked = [conn for conn in batch if conn not in _CLOSED]
        self.assertEqual(leaked, [], f"泄漏了 {len(leaked)} 个连接")

    def test_subject_domain_validation_error_closes_connection(self):
        """create_object_type 在主题域校验抛错后不能留下未关闭的连接。"""
        start = len(_OPENED)
        with self.assertRaises(repo.ValidationError):
            repo.create_object_type(self.ontology["id"], ObjectTypeBase(
                name="BadObject", display_name="坏对象", subject_domain_id="不存在的主题域",
                properties=[PropertyDef(key="id", name="编号", is_primary_key=True)]))
        self._assert_no_leak(start)

    def test_link_status_validation_error_closes_connection(self):
        """save_link_type 在 _validate_link_status 抛错后不能留下未关闭的连接。"""
        first = repo.create_object_type(self.ontology["id"], ObjectTypeBase(
            name="Alpha", display_name="甲",
            properties=[PropertyDef(key="id", name="编号", is_primary_key=True)]))
        second = repo.create_object_type(self.ontology["id"], ObjectTypeBase(
            name="Beta", display_name="乙",
            properties=[PropertyDef(key="id", name="编号", is_primary_key=True)]))
        start = len(_OPENED)
        with self.assertRaises(repo.ValidationError):
            repo.save_link_type(self.ontology["id"], LinkTypeBase(
                name="alpha_beta", display_name="甲到乙", status="active",
                source_object_type_id=first["id"], target_object_type_id=second["id"]))
        self._assert_no_leak(start)

    def test_successful_call_leaves_no_connection_open(self):
        """正常路径同样不能留下未关闭的连接。"""
        start = len(_OPENED)
        repo.create_object_type(self.ontology["id"], ObjectTypeBase(
            name="Gamma", display_name="丙",
            properties=[PropertyDef(key="id", name="编号", is_primary_key=True)]))
        self._assert_no_leak(start)


if __name__ == "__main__":
    unittest.main(verbosity=2)
