"""V4 shared dictionaries for the local ontology prototype.

These seven tables are global reference data. Business and topic domains are
ontology directory entities and deliberately do not appear here.
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from typing import Any

import repository as repo


DICTIONARIES = {
    "data_type": ("dic_data_type", "ddt", "数据类型", {"default": "默认值", "sys_dt": "系统代码"}),
    "system_type": ("dic_sys_type", "dsyt", "系统类型", {"contact": "联络人", "params": "登录连接等信息"}),
    "data_category": ("dic_data_category", "ddc", "数据类别", {}),
    "interface_type": ("dic_interface_type", "dit", "接口方式", {"params": "接口选项"}),
    "mapping_way": ("dic_mapping_way", "dmw", "映射方式", {"params": "参数选项"}),
    "action_type": ("dic_action_type", "dat", "行动类型", {"params": "参数选项"}),
    "xform_rule": ("dic_xform_rule", "dxr", "转换规则", {"params": "规则参数"}),
}

SEEDS = {
    "data_type": [("string", "字符串"), ("integer", "整数"), ("decimal", "小数"), ("boolean", "布尔"), ("datetime", "日期时间"), ("enum", "枚举")],
    "system_type": [("business", "业务系统"), ("realtime", "实时系统"), ("asset", "资产系统"), ("finance", "财务系统"), ("monitor", "监测系统"), ("dispatch", "调度系统"), ("external", "外部系统"), ("other", "其他")],
    "data_category": [("general", "通用数据"), ("transaction", "交易数据"), ("master", "主数据"), ("realtime", "实时数据"), ("analysis", "分析数据"), ("log", "日志数据"), ("other", "其他")],
    "interface_type": [("api", "API"), ("database", "数据库"), ("file", "文件"), ("mq", "消息队列"), ("rest", "REST"), ("other", "其他")],
    "mapping_way": [("direct", "直接映射"), ("enum_map", "枚举映射"), ("expr", "公式计算"), ("script", "脚本计算"), ("constant", "常量映射"), ("workflow", "自定义流程")],
    "action_type": [("business", "业务行动"), ("control", "控制行动"), ("notify", "通知行动"), ("calculate", "计算行动"), ("manual", "人工行动"), ("other", "其他")],
    "xform_rule": [("enum_map", "枚举映射"), ("unit_standardize", "单位标准化"), ("unit_convert", "单位换算"), ("window_calc", "滑动窗口计算"), ("level_map", "等级映射")],
}

# New behavior-bearing codes need an implementation before they may be enabled.
RUNTIME_CODES = {key: {code for code, _ in rows} for key, rows in SEEDS.items() if key in {"data_type", "interface_type", "mapping_way", "action_type", "xform_rule"}}


def _meta(kind: str):
    if kind not in DICTIONARIES:
        raise repo.NotFoundError("字典类型不存在")
    return DICTIONARIES[kind]


def init_tables() -> None:
    conn = repo.get_conn()
    for kind, (table, prefix, _, extras) in DICTIONARIES.items():
        columns = ", ".join(f"{prefix}_{field} TEXT" for field in extras)
        if columns:
            columns = ", " + columns
        conn.execute(f"""CREATE TABLE IF NOT EXISTS {table} (
            {prefix}_id TEXT PRIMARY KEY, {prefix}_code TEXT NOT NULL UNIQUE,
            {prefix}_name TEXT NOT NULL, {prefix}_desc TEXT NOT NULL DEFAULT '',
            {prefix}_ordering INTEGER NOT NULL DEFAULT 0,
            {prefix}_status INTEGER NOT NULL DEFAULT 1{columns}
        )""")
        for position, (code, name) in enumerate(SEEDS[kind]):
            conn.execute(
                f"INSERT OR IGNORE INTO {table} ({prefix}_id,{prefix}_code,{prefix}_name,{prefix}_ordering) VALUES (?,?,?,?)",
                (str(uuid.uuid4()), code, name, position + 1),
            )
    conn.commit()
    conn.close()


def types() -> list[dict[str, Any]]:
    conn = repo.get_conn()
    result = []
    for kind, (table, prefix, title, extras) in DICTIONARIES.items():
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        result.append({"key": kind, "name": title, "count": count, "extra_fields": extras, "global": True})
    conn.close()
    return result


def _item(row: sqlite3.Row, prefix: str, extras: dict[str, str], include_params: bool = False) -> dict[str, Any]:
    value = {"id": row[f"{prefix}_id"], "code": row[f"{prefix}_code"], "name": row[f"{prefix}_name"],
             "description": row[f"{prefix}_desc"], "ordering": row[f"{prefix}_ordering"], "status": row[f"{prefix}_status"]}
    for field in extras:
        if field == "params" and not include_params:
            value["params_configured"] = bool(row[f"{prefix}_params"])
        else:
            value[field] = row[f"{prefix}_{field}"]
    return value


def items(kind: str, include_disabled: bool = False) -> list[dict[str, Any]]:
    table, prefix, _, extras = _meta(kind)
    conn = repo.get_conn()
    rows = conn.execute(f"SELECT * FROM {table} {'WHERE ' + prefix + '_status=1' if not include_disabled else ''} ORDER BY {prefix}_ordering,{prefix}_name").fetchall()
    conn.close()
    return [_item(row, prefix, extras) for row in rows]


def _references(kind: str, code: str, name: str, *, name_only: bool = False) -> int:
    """Count current prototype references, including pre-V4 Chinese values."""
    targets = {
        "data_type": [("object_types", "properties", "type")],
        "system_type": [("enterprise_data_sources", "payload", "system_type")],
        "data_category": [("enterprise_data_sources", "payload", "data_category"), ("enterprise_data_mappings", "payload", "data_category")],
        "interface_type": [("enterprise_data_sources", "payload", "interface_type"), ("enterprise_data_mappings", "payload", "interface_type")],
        "mapping_way": [("enterprise_data_mappings", "payload", "map_way")],
        "action_type": [("actions", "metadata", "action_category")],
        "xform_rule": [("object_types", "properties", "transform_rule"), ("enterprise_data_mappings", "payload", "transform_rule")],
    }
    conn = repo.get_conn()
    count = 0
    for table, column, field in targets[kind]:
        try:
            rows = conn.execute(f"SELECT {column} FROM {table}").fetchall()
        except sqlite3.OperationalError:
            continue
        for row in rows:
            if not row[0]:
                continue
            try:
                data = json.loads(row[0])
            except (TypeError, json.JSONDecodeError):
                continue
            if _field_contains(data, field, {name} if name_only else {code, name}):
                count += 1
    conn.close()
    return count


def _field_contains(data: Any, field: str, values: set[str]) -> bool:
    if isinstance(data, dict):
        value = data.get(field)
        return isinstance(value, str) and value in values
    if isinstance(data, list):
        return any(_field_contains(value, field, values) for value in data)
    return False


def _validate(kind: str, data: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    _, _, _, extras = _meta(kind)
    code = str(data.get("code", existing["code"] if existing else "")).strip()
    name = str(data.get("name", existing["name"] if existing else "")).strip()
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,49}", code):
        raise repo.ValidationError("代码需以小写字母开头，仅包含小写字母、数字、下划线，最多50位")
    if not name or len(name) > 100:
        raise repo.ValidationError("名称不能为空且不能超过100字")
    if existing and code != existing["code"]:
        raise repo.ValidationError("字典代码创建后不可修改")
    try:
        status = int(data.get("status", existing["status"] if existing else 1))
        ordering = int(data.get("ordering", existing["ordering"] if existing else 0))
    except (TypeError, ValueError) as exc:
        raise repo.ValidationError("状态和排序须为整数") from exc
    if status not in (0, 1):
        raise repo.ValidationError("字典项状态只能是有效或禁用")
    if status and kind in RUNTIME_CODES and code not in RUNTIME_CODES[kind]:
        raise repo.ValidationError("该代码尚无对应运行处理能力，请先保存为禁用，待实现后再启用")
    result = {"code": code, "name": name, "description": str(data.get("description", existing["description"] if existing else ""))[:255],
              "ordering": ordering, "status": status}
    for field in extras:
        raw = data.get(field, existing.get(field) if existing else None)
        if field == "params":
            if field in data and raw != (existing.get(field) if existing else None):
                raise repo.ValidationError("参数配置尚无结构化表单，本原型暂不开放直接编辑")
            if raw not in (None, ""):
                try:
                    json.loads(raw if isinstance(raw, str) else json.dumps(raw))
                except json.JSONDecodeError as exc:
                    raise repo.ValidationError("参数不是有效 JSON") from exc
            result[field] = raw if isinstance(raw, str) or raw is None else json.dumps(raw, ensure_ascii=False)
        else:
            result[field] = None if raw in (None, "") else str(raw)
    return result


def save(kind: str, data: dict[str, Any], item_id: str | None = None) -> dict[str, Any]:
    table, prefix, _, extras = _meta(kind)
    conn = repo.get_conn()
    try:
        row = conn.execute(f"SELECT * FROM {table} WHERE {prefix}_id=?", (item_id,)).fetchone() if item_id else None
        if item_id and not row:
            raise repo.NotFoundError("字典项不存在")
        existing = _item(row, prefix, extras, include_params=True) if row else None
        value = _validate(kind, data, existing)
        references = _references(kind, existing["code"], existing["name"]) if existing else 0
        if existing and existing["name"] != value["name"] and _references(kind, existing["code"], existing["name"], name_only=True):
            raise repo.ConflictError("原型中仍有按名称保存的历史引用，不能直接改名；请先完成引用迁移")
        if existing and existing["status"] and not value["status"] and references:
            raise repo.ConflictError("字典项已被模型引用，不能禁用；请先处理引用")
        fields = ["code", "name", "description", "ordering", "status", *extras]
        columns = {field: f"{prefix}_{'desc' if field == 'description' else field}" for field in fields}
        if item_id:
            assignments = ",".join(f"{columns[field]}=?" for field in fields)
            conn.execute(f"UPDATE {table} SET {assignments} WHERE {prefix}_id=?", [*(value[field] for field in fields), item_id])
        else:
            item_id = str(uuid.uuid4())
            conn.execute(f"INSERT INTO {table} ({prefix}_id,{','.join(columns.values())}) VALUES ({','.join('?' for _ in range(len(fields)+1))})",
                         [item_id, *(value[field] for field in fields)])
        conn.commit()
        return _item(conn.execute(f"SELECT * FROM {table} WHERE {prefix}_id=?", (item_id,)).fetchone(), prefix, extras)
    except sqlite3.IntegrityError as exc:
        raise repo.ConflictError("该字典代码已存在") from exc
    finally:
        conn.close()


def remove(kind: str, item_id: str) -> None:
    table, prefix, _, extras = _meta(kind)
    conn = repo.get_conn()
    try:
        row = conn.execute(f"SELECT * FROM {table} WHERE {prefix}_id=?", (item_id,)).fetchone()
        if not row:
            raise repo.NotFoundError("字典项不存在")
        value = _item(row, prefix, extras)
        if _references(kind, value["code"], value["name"]):
            raise repo.ConflictError("字典项已被模型引用，不能删除；请先处理引用")
        conn.execute(f"DELETE FROM {table} WHERE {prefix}_id=?", (item_id,))
        conn.commit()
    finally:
        conn.close()
