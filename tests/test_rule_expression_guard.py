"""规则表达式求值的资源耗尽防护。

`_evaluate_rule_expression` 在进程内 eval。修复前 `9**9**9`（约 3.7 亿位整数）
和 `"a"*999999999` 都会挂死请求。这里既断言被拒绝，也用 alarm 断言不会卡住。
"""
import os
import signal
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
os.environ.setdefault("ONTOLOGY_MANUAL_DB", os.path.join(tempfile.mkdtemp(), "rule.db"))

import repository as repo  # noqa: E402


class _Timeout(Exception):
    pass


def _alarm(seconds=5):
    def handler(signum, frame):
        raise _Timeout(f"求值超过 {seconds} 秒，疑似资源耗尽")
    signal.signal(signal.SIGALRM, handler)
    signal.alarm(seconds)


def _cancel_alarm():
    signal.alarm(0)


class RuleExpressionGuardTest(unittest.TestCase):
    def _reject(self, expression, data=None):
        _alarm()
        try:
            with self.assertRaises(repo.ValidationError):
                repo._evaluate_rule_expression(expression, data or {"amount": 100})
        finally:
            _cancel_alarm()

    def test_exponentiation_is_rejected(self):
        """9**9**9 修复前会算出约 3.7 亿位整数。"""
        self._reject("9**9**9")

    def test_small_exponentiation_is_also_rejected(self):
        """幂运算整体不支持，避免留后门。"""
        self._reject("2**10")

    def test_string_multiplication_is_rejected(self):
        """'a'*999999999 修复前会撑爆内存。"""
        self._reject('"a"*999999999')

    def test_oversized_integer_literal_is_rejected(self):
        self._reject("1" * 200)

    def test_oversized_string_literal_is_rejected(self):
        self._reject('"' + "a" * 1500 + '"')

    def test_overlong_expression_is_rejected(self):
        self._reject("amount > 0 or " * 300 + "amount > 0")

    def test_normal_expressions_still_work(self):
        """正常表达式不受影响。"""
        data = {"amount": 120, "status": "执行中", "items": [1, 2, 3]}
        self.assertTrue(repo._evaluate_rule_expression("amount > 100", data))
        self.assertFalse(repo._evaluate_rule_expression("amount < 100", data))
        self.assertEqual(repo._evaluate_rule_expression("round(amount / 3, 2)", data), 40.0)
        self.assertEqual(repo._evaluate_rule_expression("sum(items)", data), 6)
        self.assertTrue(repo._evaluate_rule_expression('status == "执行中" and amount >= 100', data))
        self.assertEqual(repo._evaluate_rule_expression("amount * 2", data), 240)


if __name__ == "__main__":
    unittest.main(verbosity=2)
