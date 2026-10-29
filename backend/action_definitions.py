"""Validation for v1 action definitions. No formulas or HTTP requests are executed."""
from __future__ import annotations

import math
import re
from datetime import datetime
from urllib.parse import urlsplit


def merge_config(old, new):
    result = dict(old) if isinstance(old, dict) else {}
    for key, value in (new or {}).items():
        result[key] = merge_config(result.get(key), value) if isinstance(value, dict) else value
    return result


def validate_definition(data, previous=None):
    """Opt in to v1 validation; legacy imports remain readable and editable."""
    if data.definition_config is None:
        return
    required = {"external_id": "行动编号", "display_name": "行动名称", "name": "API 名称",
                "action_category": "行动类型", "execution_logic": "执行逻辑", "owner": "责任人"}
    for key, title in required.items():
        if not str(getattr(data, key) or "").strip():
            raise ValueError(f"{title}不能为空")
    limits = {"external_id": 80, "display_name": 100, "name": 100, "description": 500,
              "precondition_text": 500, "object_effect": 255, "result_text": 255,
              "side_effects_text": 255, "owner": 50, "definition_version": 50}
    for key, limit in limits.items():
        value = getattr(data, key)
        # Existing workbook evidence is not truncated merely by editing another field.
        if previous and previous.get(key) == value:
            continue
        if value is not None and len(value) > limit:
            raise ValueError(f"{key} 最多 {limit} 个字符")
    if data.design_status not in {"draft", "validated"}:
        if not previous or data.design_status != previous.get("design_status"):
            raise ValueError("建模状态必须是设计中或已确认")
    config = data.definition_config
    if config.get("schema_version") != 1:
        raise ValueError("动作定义配置版本必须为 1")
    mode = config.get("definition_mode")
    if not isinstance(mode, str) or mode not in {"text", "formula", "api"}:
        raise ValueError("填写形式必须是文字规则、公式或 API")
    for section in ("formula", "api"):
        if section in config and not isinstance(config[section], dict):
            raise ValueError(f"{section} 配置必须为对象")
    def text(section, key, required=False, limit=20000):
        value = config.get(section, {}).get(key, "")
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError(f"{section}.{key} 必须是 {limit} 字以内的文本")
        if required and not value.strip():
            raise ValueError(f"{section}.{key} 不能为空")
        return value
    for key in ("expression_text", "variables_text", "example_text"):
        text("formula", key, mode == "formula" and key == "expression_text")
    for key in ("url", "system_name", "request_mapping_text", "request_example_text",
                "response_mapping_text", "success_criteria_text", "credential_ref"):
        text("api", key, mode == "api" and not config.get("action_mapping_code") and key in {"url", "success_criteria_text"})
    if mode == "api" and not config.get("action_mapping_code"):
        api = config["api"]
        if not isinstance(api.get("method"), str) or api.get("method") not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
            raise ValueError("API 请求方法无效")
        url = api["url"].strip()
        parsed = urlsplit(url)
        if re.search(r"\s", url) or not ((url.startswith("/") and not url.startswith("//")) or
                (parsed.scheme in {"http", "https"} and parsed.netloc and not parsed.username and not parsed.password)):
            raise ValueError("API 地址应为 HTTP(S) 地址或以 / 开头的相对路径，不包含凭据")
    for parameter in data.parameters:
        value = parameter.default
        if value is None:
            continue
        kind = parameter.type
        valid = True
        if kind == "integer": valid = type(value) is int
        elif kind == "decimal": valid = type(value) in {int, float} and math.isfinite(value)
        elif kind == "boolean": valid = type(value) is bool
        elif kind in {"string", "enum", "datetime"}: valid = isinstance(value, str)
        if kind == "enum": valid = valid and value in (parameter.options or [])
        if kind == "datetime" and valid:
            try: datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError: valid = False
        if not valid:
            raise ValueError(f"参数 {parameter.key} 的默认值与类型不符")


def references_action(payload, identifiers):
    """Match explicit resource references, never free-form business descriptions."""
    if not isinstance(payload, dict):
        return False
    for key, value in payload.items():
        if key in {"action_code", "action_id", "action_ref", "related_actions", "resource_ref"}:
            values = value if isinstance(value, list) else [value]
            if any(isinstance(item, str) and (item in identifiers or item.removeprefix("Action:") in identifiers) for item in values):
                return True
        if isinstance(value, dict) and references_action(value, identifiers):
            return True
        if isinstance(value, list) and any(references_action(item, identifiers) for item in value if isinstance(item, dict)):
            return True
    return False
