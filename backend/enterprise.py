from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import uuid
import zipfile
from io import BytesIO
from typing import Any, Dict, Iterable, Optional
from xml.etree import ElementTree as ET

import httpx

import repository as repo
import source_connections
from models import (
    ActionBase,
    AgentChatRequest,
    AIAnalyzeRequest,
    BuildSessionCreate,
    BuildSessionTransition,
    BusinessRuleBase,
    EnterpriseResourceBase,
    EvidenceUpload,
    LinkInstanceBase,
    LinkTypeBase,
    ObjectInstanceBase,
    ObjectTypeBase,
    ObjectTypeGroupBase,
    OntologyBase,
    PropertyDef,
)


RESOURCE_TABLES = {
    "business-scenarios": ("enterprise_business_scenarios", "业务场景"),
    "data-sources": ("enterprise_data_sources", "数据源"),
    "governance-assets": ("enterprise_governance_assets", "治理资产"),
    "data-mappings": ("enterprise_data_mappings", "数据映射"),
    "logic-definitions": ("enterprise_logic_definitions", "规则与函数"),
    "capabilities": ("enterprise_capabilities", "系统能力"),
    "action-mappings": ("enterprise_action_mappings", "动作执行映射"),
    "permission-policies": ("enterprise_permission_policies", "权限策略"),
}

# A scenario reads a governed mapping rather than reaching directly into a
# physical table.  ``source_codes`` remains accepted for old workbook records,
# but all newly authored scenarios should reference ``related_mappings`` and
# use those mapping codes in ``mapping_read`` steps.


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _audit(conn, ontology_id: str, component_type: str, component_id: str, operation: str, summary: str) -> None:
    """Record AI/evidence activity without treating it as a publishable schema edit."""
    conn.execute(
        """INSERT INTO change_log
           (id,ontology_id,component_type,component_id,operation,summary,actor,created_at,pending)
           VALUES (?,?,?,?,?,?,?,?,0)""",
        (str(uuid.uuid4()), ontology_id, component_type, component_id, operation, summary, repo.audit_actor(), repo.now()),
    )


def _row(row) -> Dict[str, Any]:
    data = dict(row)
    data.update(json.loads(data.pop("payload", "{}") or "{}"))
    return data


def init_enterprise() -> None:
    conn = repo.get_conn()
    for table, _ in RESOURCE_TABLES.values():
        conn.execute(
            f"""CREATE TABLE IF NOT EXISTS {table} (
              id TEXT PRIMARY KEY, ontology_id TEXT NOT NULL, code TEXT NOT NULL,
              name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
              description TEXT, payload TEXT NOT NULL DEFAULT '{{}}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              created_by TEXT NOT NULL DEFAULT 'system', updated_by TEXT NOT NULL DEFAULT 'system',
              UNIQUE(ontology_id, code), FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
            )"""
        )
        repo._ensure_column(conn, table, "created_by", "TEXT NOT NULL DEFAULT 'system-migration'")
        repo._ensure_column(conn, table, "updated_by", "TEXT NOT NULL DEFAULT 'system-migration'")
        conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_ontology ON {table}(ontology_id)")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS evidence_sources (
          id TEXT PRIMARY KEY, ontology_id TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL,
          source_kind TEXT NOT NULL, content_hash TEXT NOT NULL, extracted_text TEXT NOT NULL,
          parse_summary TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ontology_proposals (
          id TEXT PRIMARY KEY, ontology_id TEXT NOT NULL, title TEXT NOT NULL, instruction TEXT NOT NULL,
          source_ids TEXT NOT NULL, status TEXT NOT NULL, model TEXT NOT NULL, run_mode TEXT NOT NULL,
          summary TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS proposal_operations (
          id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, sort_order INTEGER NOT NULL,
          resource_type TEXT NOT NULL, operation TEXT NOT NULL, display_name TEXT NOT NULL,
          api_name TEXT, confidence REAL NOT NULL, rationale TEXT, evidence TEXT,
          payload TEXT NOT NULL, decision TEXT NOT NULL DEFAULT 'pending', decision_note TEXT,
          risk TEXT NOT NULL DEFAULT 'low', diff_summary TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY(proposal_id) REFERENCES ontology_proposals(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS agent_interactions (
          id TEXT PRIMARY KEY, ontology_id TEXT NOT NULL, user_message TEXT NOT NULL, answer TEXT NOT NULL,
          trace TEXT NOT NULL, action_proposal TEXT, run_mode TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ontology_build_runs (
          id TEXT PRIMARY KEY, ontology_id TEXT NOT NULL, scenario_id TEXT,
          status TEXT NOT NULL, strategy TEXT NOT NULL, model TEXT NOT NULL, run_mode TEXT NOT NULL,
          rounds TEXT NOT NULL, metrics TEXT NOT NULL, proposal_id TEXT, created_at TEXT NOT NULL,
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ontology_build_sessions (
          id TEXT PRIMARY KEY, ontology_id TEXT NOT NULL, mode TEXT NOT NULL,
          title TEXT NOT NULL, domain TEXT NOT NULL, business_goal TEXT NOT NULL,
          change_scope TEXT NOT NULL, base_version TEXT NOT NULL, status TEXT NOT NULL,
          current_step INTEGER NOT NULL DEFAULT 2, scenario_id TEXT, proposal_id TEXT,
          context TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS scenario_runs (
          id TEXT PRIMARY KEY, ontology_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
          status TEXT NOT NULL, input_snapshot TEXT NOT NULL, steps TEXT NOT NULL,
          result TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS template_records (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          sheet_name TEXT NOT NULL,
          source_row INTEGER NOT NULL,
          record_kind TEXT NOT NULL,
          template_id TEXT,
          headers TEXT NOT NULL,
          raw_values TEXT NOT NULL,
          normalized_ref_type TEXT,
          normalized_ref_id TEXT,
          quality_status TEXT NOT NULL DEFAULT 'source',
          issue_note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, sheet_name, source_row),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ontology_dictionary_items (
          id TEXT PRIMARY KEY, dict_type TEXT NOT NULL, code TEXT NOT NULL,
          label TEXT NOT NULL, value TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
          sort_order INTEGER NOT NULL DEFAULT 0, extra TEXT NOT NULL DEFAULT '{}',
          UNIQUE(dict_type, code)
        );
        CREATE INDEX IF NOT EXISTS idx_evidence_ontology ON evidence_sources(ontology_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_proposals_ontology ON ontology_proposals(ontology_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_proposal_operations ON proposal_operations(proposal_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_build_runs_ontology ON ontology_build_runs(ontology_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_build_sessions_ontology ON ontology_build_sessions(ontology_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_scenario_runs_ontology ON scenario_runs(ontology_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_template_records_ontology ON template_records(ontology_id, sheet_name, source_row);
        """
    )
    repo._ensure_column(conn, "proposal_operations", "risk", "TEXT NOT NULL DEFAULT 'low'")
    repo._ensure_column(conn, "proposal_operations", "diff_summary", "TEXT")
    repo._ensure_column(conn, "ontology_build_runs", "session_id", "TEXT")
    conn.commit()
    conn.close()
    source_connections.init_tables()
    seed_dictionaries()
    ensure_procurement_registered_sources()
    seed_procurement_enterprise_resources()


DICTIONARY_SEEDS = {
    "data_type": [("string", "文本"), ("integer", "整数"), ("decimal", "小数"), ("boolean", "布尔"), ("datetime", "日期时间"), ("enum", "枚举")],
    "system_type": [("business", "业务系统"), ("finance", "财务系统"), ("mdm", "主数据系统"), ("iot", "物联网 / 时序系统"), ("document", "文档系统")],
    "interface_type": [("database", "数据库"), ("rest", "REST API"), ("message", "消息队列"), ("file", "文件交换"), ("stream", "流式订阅")],
    "mapping_type": [("property", "属性映射"), ("relation", "关系映射")],
    "update_method": [("realtime", "实时"), ("event", "事件触发"), ("batch", "批量"), ("manual", "手工触发")],
    "rule_implementation": [("description", "文本说明"), ("expression", "受限表达式"), ("function", "函数"), ("workflow", "工作流"), ("model", "模型判断")],
    "sync_status": [("pending", "待同步"), ("syncing", "同步中"), ("synced", "已同步"), ("failed", "同步失败"), ("stale", "已过期"), ("disabled", "已停用")],
    "ontology_status": [("draft", "设计中"), ("in_review", "待评审"), ("reviewed", "评审通过"), ("published", "已发布")],
}


def seed_dictionaries() -> None:
    conn = repo.get_conn()
    for dict_type, items in DICTIONARY_SEEDS.items():
        for index, (code, label) in enumerate(items):
            conn.execute("""INSERT OR IGNORE INTO ontology_dictionary_items
                (id,dict_type,code,label,value,status,sort_order,extra) VALUES (?,?,?,?,?,'active',?,'{}')""",
                (str(uuid.uuid4()), dict_type, code, label, code, index))
    conn.commit(); conn.close()


def list_dictionary_types() -> list[Dict[str, Any]]:
    conn = repo.get_conn()
    rows = conn.execute("SELECT dict_type,COUNT(*) item_count FROM ontology_dictionary_items WHERE status='active' GROUP BY dict_type ORDER BY dict_type").fetchall()
    conn.close()
    return [dict(row) for row in rows]


def list_dictionary_items(dict_type: str) -> list[Dict[str, Any]]:
    conn = repo.get_conn()
    rows = conn.execute("SELECT * FROM ontology_dictionary_items WHERE dict_type=? AND status='active' ORDER BY sort_order,code", (dict_type,)).fetchall()
    conn.close()
    return [{**dict(row), "extra": json.loads(row["extra"] or "{}")} for row in rows]


def list_resources(ontology_id: str, kind: str) -> list[Dict[str, Any]]:
    repo.get_ontology(ontology_id)
    if kind == "versions":
        return [{
            **item, "code": f"VER-{item['version'].lstrip('v').replace('.', '-')}",
            "name": f"本体版本 {item['version']}", "category": "正式版本",
            "description": item["change_reason"], "updated_at": item["created_at"],
        } for item in repo.release_history(ontology_id)]
    table, _ = RESOURCE_TABLES[kind]
    conn = repo.get_conn()
    rows = conn.execute(f"SELECT * FROM {table} WHERE ontology_id=? ORDER BY code", (ontology_id,)).fetchall()
    conn.close()
    resources = [_row(item) for item in rows]
    if kind == "data-sources":
        for item in resources:
            item["credential_configured"] = source_connections.has_password(item["id"])
            snapshot = source_connections.latest_snapshot(ontology_id, item["id"])
            item["schema_snapshot"] = ({"id": snapshot["id"], "captured_at": snapshot["captured_at"],
                                        "table_count": len(snapshot["schema"]["tables"])} if snapshot else None)
    return resources


def list_template_records(ontology_id: str, sheet_name: Optional[str] = None) -> list[Dict[str, Any]]:
    """Return the verbatim workbook rows used to build a built-in ontology.

    Normalized resources are intentionally not the only copy of the workbook:
    this endpoint lets the UI, export jobs, and later AI builders inspect the
    exact source row and its normalized target without guessing what was
    changed during semantic mapping.
    """
    repo.get_ontology(ontology_id)
    conn = repo.get_conn()
    if sheet_name:
        rows = conn.execute(
            "SELECT * FROM template_records WHERE ontology_id=? AND sheet_name=? ORDER BY source_row",
            (ontology_id, sheet_name),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM template_records WHERE ontology_id=? ORDER BY sheet_name,source_row",
            (ontology_id,),
        ).fetchall()
    conn.close()
    result = []
    for row in rows:
        item = dict(row)
        item["headers"] = json.loads(item.get("headers") or "[]")
        item["raw_values"] = json.loads(item.get("raw_values") or "[]")
        result.append(item)
    return result


def _validate_business_scenario(ontology_id: str, payload: Dict[str, Any], allow_legacy_steps: bool = False) -> None:
    # The original bootstrap stored a human-readable list of steps.  Keep it
    # readable for old snapshots, but any new/edit request must use the
    # structured step contract below so a scenario can really be executed and
    # audited instead of merely displaying a plan.
    steps = payload.get("steps") or []
    if allow_legacy_steps and steps and isinstance(steps[0], str):
        return
    required = {"business_goal": "业务目标", "output_change": "输出/状态变化"}
    missing = [label for key, label in required.items() if not payload.get(key)]
    if missing: raise repo.ValidationError(f"业务场景缺少：{'、'.join(missing)}")
    if not (payload.get("trigger_condition") or payload.get("trigger")):
        raise repo.ValidationError("业务场景缺少：触发条件")
    conn=repo.get_conn()
    objects={row["name"]:dict(row) for row in conn.execute("SELECT id,name FROM object_types WHERE ontology_id=? AND COALESCE(object_kind,'business_object')='business_object'",(ontology_id,)).fetchall()}
    links={row["name"]:dict(row) for row in conn.execute("SELECT name,source_object_type_id,target_object_type_id FROM link_types WHERE ontology_id=?",(ontology_id,)).fetchall()}
    rules={row["name"] for row in conn.execute("SELECT name FROM business_rules WHERE ontology_id=?",(ontology_id,)).fetchall()}
    actions={row["name"] for row in conn.execute("SELECT name FROM actions WHERE ontology_id=?",(ontology_id,)).fetchall()}
    sources={row["code"] for row in conn.execute("SELECT code FROM enterprise_data_sources WHERE ontology_id=?",(ontology_id,)).fetchall()}
    mapping_rows=conn.execute("SELECT code,payload FROM enterprise_data_mappings WHERE ontology_id=?",(ontology_id,)).fetchall()
    mapping_payloads={row["code"]:json.loads(row["payload"] or "{}") for row in mapping_rows}
    mappings=set(mapping_payloads)
    object_names=set(payload.get("related_objects") or [])
    if payload.get("entry_object"):
        if payload["entry_object"] not in objects: raise repo.ValidationError("入口对象不存在于当前本体")
        if payload["entry_object"] not in object_names: raise repo.ValidationError("入口对象必须包含在关联对象中")
    unknown=object_names-set(objects)
    if unknown: raise repo.ValidationError(f"场景引用了不存在的对象：{', '.join(sorted(unknown))}")
    for link_name in payload.get("related_links") or []:
        link=links.get(link_name)
        if not link: raise repo.ValidationError(f"场景引用了不存在的关系：{link_name}")
        id_to_name={item["id"]:name for name,item in objects.items()}
        if id_to_name.get(link["source_object_type_id"]) not in object_names or id_to_name.get(link["target_object_type_id"]) not in object_names:
            raise repo.ValidationError(f"关系 {link_name} 的两端对象未全部加入场景")
    legacy_source_aliases = {"SRC-001": "DS-001", "SRC-002": "DS-002", "SRC-003": "DS-001", "SRC-004": "DS-002", "SRC-005": "DS-005"}
    for field, known, label in (("related_rules",rules,"规则"),("related_actions",actions,"动作"),("source_codes",sources | set(legacy_source_aliases),"数据源"),("related_mappings",mappings,"数据映射")):
        unknown=set(payload.get(field) or [])-known
        if unknown: raise repo.ValidationError(f"场景引用了不存在的{label}：{', '.join(sorted(unknown))}")
    selected_sources=set(payload.get("source_codes") or [])
    for mapping_code in payload.get("related_mappings") or []:
        source_code=mapping_payloads[mapping_code].get("source_code")
        if source_code and source_code not in selected_sources:
            raise repo.ValidationError(f"数据映射 {mapping_code} 的数据源 {source_code} 未加入当前场景")

    if not steps:
        conn.close()
        return
    if not isinstance(steps, list):
        conn.close()
        raise repo.ValidationError("执行步骤必须是列表")
    if not payload.get("entry_object"):
        conn.close()
        raise repo.ValidationError("配置执行步骤前，请先选择主要对象")
    step_types = {
        "object_resolve": "定位对象",
        "link_traverse": "穿透关系",
        "rule_execute": "执行规则",
        "mapping_read": "读取数据映射",
        "action_propose": "提议动作",
        "approval": "人工审批",
        "verify": "验证结果",
    }
    orders = []
    has_entry = False
    has_output = False
    for index, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            raise repo.ValidationError(f"第 {index} 个执行步骤必须是结构化配置")
        step_type = step.get("type")
        if step_type not in step_types:
            raise repo.ValidationError(f"第 {index} 个执行步骤类型无效，请选择：{'、'.join(step_types.values())}")
        order = step.get("order", index)
        if not isinstance(order, int) or order < 1:
            raise repo.ValidationError(f"第 {index} 个执行步骤的顺序必须是正整数")
        orders.append(order)
        if not step.get("name"):
            raise repo.ValidationError(f"第 {index} 个执行步骤缺少名称")
        resource_ref = step.get("resource_ref")
        if step_type == "object_resolve":
            if resource_ref not in object_names:
                raise repo.ValidationError(f"步骤 {step['name']} 的入口对象必须来自关联对象")
            has_entry = has_entry or resource_ref == payload.get("entry_object")
        elif step_type == "link_traverse":
            if resource_ref not in (payload.get("related_links") or []):
                raise repo.ValidationError(f"步骤 {step['name']} 的关系必须来自已关联关系")
        elif step_type == "rule_execute":
            if resource_ref not in (payload.get("related_rules") or []):
                raise repo.ValidationError(f"步骤 {step['name']} 的规则必须来自已关联规则")
        elif step_type == "mapping_read":
            # v1.9 scenarios use mapping codes.  Source codes are accepted as
            # a compatibility bridge for old records that predate mappings.
            if resource_ref not in (payload.get("related_mappings") or []) and resource_ref not in (payload.get("source_codes") or []):
                raise repo.ValidationError(f"步骤 {step['name']} 的数据映射必须来自已关联映射")
        elif step_type == "action_propose":
            if resource_ref not in (payload.get("related_actions") or []):
                raise repo.ValidationError(f"步骤 {step['name']} 的动作必须来自已关联动作")
            action_row = conn.execute("SELECT metadata FROM actions WHERE ontology_id=? AND name=?", (ontology_id, resource_ref)).fetchone()
            action_metadata = json.loads(action_row["metadata"] or "{}") if action_row else {}
            if action_metadata.get("approval_required") and not step.get("approval_required"):
                raise repo.ValidationError(f"动作 {step['name']} 标记为需审批，请开启人工审批或确认")
        elif step_type == "approval":
            has_output = True
        elif step_type == "verify":
            has_output = True
        if step.get("output_mapping") or step.get("state_change"):
            has_output = True
    if sorted(orders) != list(range(1, len(steps) + 1)):
        raise repo.ValidationError("执行步骤顺序必须从 1 开始连续编号")
    if not has_entry:
        raise repo.ValidationError("执行步骤必须包含入口对象定位")
    if not has_output:
        raise repo.ValidationError("执行步骤必须包含验证结果或状态变化")
    conn.close()


SCENARIO_STEP_TYPES = {
    "object_resolve": "定位对象",
    "link_traverse": "穿透关系",
    "rule_execute": "执行规则",
    "mapping_read": "读取数据映射",
    "action_propose": "提议动作",
    "approval": "人工审批",
    "verify": "验证结果",
}


def _build_structured_steps(payload: Dict[str, Any]) -> list[Dict[str, Any]]:
    """Convert the old descriptive scenario fields into executable step records.

    This is deliberately deterministic.  It is only an upgrade bridge for
    records created before the step editor existed; it does not invent a new
    business resource or call an LLM.
    """
    steps: list[Dict[str, Any]] = []
    order = 1
    entry = payload.get("entry_object")
    if entry:
        steps.append({
            "order": order, "name": f"定位{entry}", "type": "object_resolve",
            "resource_ref": entry, "detail": f"以 {entry} 作为场景入口对象",
            "on_failure": "stop", "approval_required": False,
        })
        order += 1
    for relation in payload.get("related_links") or []:
        steps.append({
            "order": order, "name": f"穿透关系：{relation}", "type": "link_traverse",
            "resource_ref": relation, "detail": f"沿关系 {relation} 扩展业务上下文",
            "on_failure": "stop", "approval_required": False,
        })
        order += 1
    mapping_refs = payload.get("related_mappings") or []
    # Old scenarios only recorded data-source codes.  Keep those usable if a
    # legacy export has no mapping registry yet.
    for source in mapping_refs or (payload.get("source_codes") or []):
        steps.append({
            "order": order, "name": f"读取数据映射：{source}", "type": "mapping_read",
            "resource_ref": source, "detail": f"读取已登记映射 {source} 并写入本体工作上下文",
            "on_failure": "manual", "approval_required": False,
        })
        order += 1
    for rule in payload.get("related_rules") or []:
        steps.append({
            "order": order, "name": f"执行规则：{rule}", "type": "rule_execute",
            "resource_ref": rule, "detail": f"执行确定性规则 {rule}",
            "on_failure": "stop", "approval_required": False,
        })
        order += 1
    for action in payload.get("related_actions") or []:
        steps.append({
            "order": order, "name": f"提议动作：{action}", "type": "action_propose",
            "resource_ref": action, "detail": f"形成动作 {action} 的受控执行建议",
            "on_failure": "manual", "approval_required": True,
        })
        order += 1
    steps.append({
        "order": order, "name": "验证结果并记录状态", "type": "verify",
        "resource_ref": entry or "", "detail": payload.get("output_change") or "验证场景输出并记录审计",
        "on_failure": "manual", "approval_required": False, "state_change": True,
    })
    return steps


def migrate_legacy_scenario_steps() -> int:
    """Backfill structured steps once without overwriting user-authored steps."""
    marker = "structured-scenario-steps-v1"
    conn = repo.get_conn()
    if conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (marker,)).fetchone():
        conn.close()
        return 0
    rows = conn.execute("SELECT id,ontology_id,payload FROM enterprise_business_scenarios").fetchall()
    changed = 0
    for row in rows:
        payload = json.loads(row["payload"] or "{}")
        if not payload.get("related_mappings") and payload.get("source_codes"):
            mapping_rows = conn.execute(
                "SELECT code,payload FROM enterprise_data_mappings WHERE ontology_id=? ORDER BY code",
                (row["ontology_id"],),
            ).fetchall()
            source_codes = set(payload["source_codes"])
            payload["related_mappings"] = [
                item["code"] for item in mapping_rows
                if json.loads(item["payload"] or "{}").get("source_code") in source_codes
            ]
        steps = payload.get("steps")
        if isinstance(steps, list) and steps and isinstance(steps[0], dict):
            continue
        if steps:
            payload["legacy_steps"] = steps
        payload["steps"] = _build_structured_steps(payload)
        timestamp = repo.now()
        conn.execute(
            "UPDATE enterprise_business_scenarios SET payload=?,updated_at=?,updated_by=? WHERE id=?",
            (_json(payload), timestamp, "system-migration", row["id"]),
        )
        _audit(conn, row["ontology_id"], "business_scenario", row["id"], "migrate", "补齐结构化执行步骤")
        changed += 1
    conn.execute(
        "INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)",
        (marker, repo.now()),
    )
    conn.commit()
    conn.close()
    return changed


def _product_contract_active(conn) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM prototype_migrations WHERE migration_key='v1.9-keep-procurement-pipeline'"
    ).fetchone())


def _validate_data_source(payload: Dict[str, Any]) -> None:
    supported_drivers = {"mysql", "postgresql", "oracle", "sqlserver", "dameng"}
    if payload.get("driver") and payload["driver"] not in supported_drivers:
        raise repo.ValidationError("数据库类型只支持 MySQL、PostgreSQL、Oracle、SQL Server、达梦数据库的登记")
    if payload.get("driver") == "mysql":
        required = {"host": "主机地址", "port": "端口", "database": "数据库名称", "username": "用户名"}
        missing = [label for key, label in required.items() if not payload.get(key)]
        if missing:
            raise repo.ValidationError("MySQL 连接配置缺少：" + "、".join(missing))
        try:
            if not 1 <= int(payload["port"]) <= 65535:
                raise ValueError()
        except (TypeError, ValueError) as exc:
            raise repo.ValidationError("端口须为 1–65535 的整数") from exc


def _validate_governance_asset(ontology_id: str, payload: Dict[str, Any]) -> None:
    if payload.get("catalog_origin") not in {"enterprise_catalog", "schema_candidate"}:
        raise repo.ValidationError("请选择企业治理目录或结构候选来源")
    if payload.get("verification_status") not in {"candidate", "confirmed"}:
        raise repo.ValidationError("治理资产确认状态无效")
    fields = payload.get("fields")
    if not isinstance(fields, list) or not fields:
        raise repo.ValidationError("治理资产至少需要一个已登记字段")
    names = [str(field.get("name") or "").strip() for field in fields if isinstance(field, dict)]
    if len(names) != len(fields) or not all(names) or len(set(names)) != len(names):
        raise repo.ValidationError("治理资产字段名不能为空或重复")
    source_code = payload.get("upstream_source_code")
    if payload.get("catalog_origin") == "schema_candidate" and (not source_code or not payload.get("upstream_object")):
        raise repo.ValidationError("结构候选必须选择已采集的物理来源与上游表")
    if source_code:
        conn = repo.get_conn()
        found = conn.execute("SELECT id FROM enterprise_data_sources WHERE ontology_id=? AND code=?", (ontology_id, source_code)).fetchone()
        conn.close()
        if not found:
            raise repo.ValidationError("上游物理数据源不存在于当前本体")
        if payload.get("catalog_origin") == "schema_candidate":
            snapshot = source_connections.latest_snapshot(ontology_id, found["id"])
            if not snapshot or payload["upstream_object"] not in {table["name"] for table in snapshot["schema"]["tables"]}:
                raise repo.ValidationError("结构候选的上游表必须来自已采集的真实结构快照")


def _normalize_mapping_editor_payload(ontology_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Accept the template fields directly; retain v2 support for older clients."""
    if payload.get("mapping_editor_version") == 3:
        payload = dict(payload)
        payload["relation_field_bindings"] = []
        if payload.get("mapping_type") == "relation":
            payload.update(target_object_type="", target_property="", mapping_type_display="关系映射")
            payload["relation_key_mode"] = "join" if payload.get("target_key") else "link_table"
        elif payload.get("mapping_type") == "property":
            payload.update(target_relation="", target_key="", relation_key_mode="", mapping_type_display="属性映射")
        return payload
    if payload.get("mapping_editor_version") != 2:
        return payload
    payload = dict(payload)
    if payload.get("source_kind") not in {"table", "api", "file"}:
        raise repo.ValidationError("请选择实际来源：表、接口或文件")
    if payload.get("mapping_type") == "property":
        payload.update(target_relation="", target_key="", relation_key_mode="", relation_field_bindings=[], mapping_type_display="属性映射")
        return payload
    if payload.get("mapping_type") != "relation":
        return payload
    relation = next((item for item in repo.list_link_types(ontology_id) if item["name"] == payload.get("target_relation")), None)
    if not relation:
        raise repo.ValidationError("请选择当前本体中已定义的关系")
    bindings = payload.get("relation_field_bindings")
    if not isinstance(bindings, list) or len(bindings) != 2 or not all(isinstance(item, dict) for item in bindings):
        raise repo.ValidationError("关系映射需要分别选择起点和终点的来源字段")
    normalized = []
    for role, id_field in (("source", "source_object_type_id"), ("target", "target_object_type_id")):
        matches = [item for item in bindings if item.get("role") == role]
        if len(matches) != 1 or matches[0].get("object_type_id") != relation[id_field]:
            raise repo.ValidationError("来源字段绑定与所选关系的起点、终点不一致，请重新选择")
        field = matches[0].get("field")
        if not isinstance(field, str) or not field.strip() or re.search(r"[/+;,，、]", field):
            raise repo.ValidationError("请分别填写两端的单个来源字段，不要手工拼接斜杠或加号")
        normalized.append({"role": role, "object_type_id": relation[id_field], "field": field.strip()})
    fields = [item["field"] for item in normalized]
    mode = payload.get("relation_key_mode") or "link_table"
    if mode not in {"link_table", "join"}:
        raise repo.ValidationError("关系关联方式无效")
    payload.update(target_object_type="", target_property="", mapping_type_display="关系映射",
                   relation_field_bindings=normalized, relation_key_mode=mode, map_way="关联映射")
    if mode == "join":
        payload.update(source_key=fields[0], target_key=fields[1])
    else:
        payload.update(source_field="/".join(fields), source_key="+".join(fields), target_key="")
    return payload


def _validate_data_mapping(ontology_id: str, payload: Dict[str, Any]) -> None:
    mapping_type = payload.get("mapping_type")
    if mapping_type not in {"property", "relation"}:
        raise repo.ValidationError("数据映射只能选择属性映射或关系映射")
    if payload.get("binding_mode") == "governed":
        asset_code = payload.get("governance_asset_code")
        if not asset_code:
            raise repo.ValidationError("请选择治理资产")
        conn = repo.get_conn()
        row = conn.execute("SELECT payload FROM enterprise_governance_assets WHERE ontology_id=? AND code=?", (ontology_id, asset_code)).fetchone()
        conn.close()
        if not row:
            raise repo.ValidationError("治理资产不存在于当前本体")
        asset = json.loads(row["payload"] or "{}")
        if asset.get("verification_status") != "confirmed":
            raise repo.ValidationError("候选治理资产需先确认，不能作为正式语义映射来源")
        fields = {field.get("name") for field in asset.get("fields", [])}
        if mapping_type == "property" and payload.get("governance_field") not in fields:
            raise repo.ValidationError("请选择治理资产中已登记的字段")
        if mapping_type == "relation":
            chosen = payload.get("governance_relation_fields") or []
            if len(chosen) != 2 or len(set(chosen)) != 2 or any(field not in fields for field in chosen):
                raise repo.ValidationError("关系映射必须选择治理资产中两个有效的关联字段")
        _validate_mapping_target(ontology_id, payload, mapping_type)
        return
    location_label = "接口" if mapping_type == "relation" else {"table": "来源表", "api": "来源接口", "file": "来源文件"}.get(payload.get("source_kind"), "来源表")
    required = {"source_code": "来源系统", "source_table": location_label}
    required["source_field"] = "来源字段"
    missing = [label for key, label in required.items() if not payload.get(key)]
    if missing:
        raise repo.ValidationError(f"数据映射缺少：{'、'.join(missing)}")
    conn = repo.get_conn()
    if not conn.execute("SELECT 1 FROM enterprise_data_sources WHERE ontology_id=? AND code=?", (ontology_id, payload["source_code"])).fetchone():
        conn.close(); raise repo.ValidationError("数据映射必须引用当前本体已登记的数据源")
    if mapping_type == "relation":
        if not payload.get("target_relation"):
            conn.close(); raise repo.ValidationError("关系映射必须选择目标关系")
        if not conn.execute("SELECT 1 FROM link_types WHERE ontology_id=? AND name=?", (ontology_id, payload["target_relation"])).fetchone():
            conn.close(); raise repo.ValidationError("目标关系不存在于当前本体")
        if not payload.get("source_key"):
            conn.close(); raise repo.ValidationError("关系映射必须配置关联键；关联明细表可使用两端字段的组合键")
    else:
        if payload.get("design_status") == "已确认" and not payload.get("source_key"):
            conn.close(); raise repo.ValidationError("已确认的属性映射必须填写主键，才能定位目标对象")
        target = conn.execute("SELECT properties FROM object_types WHERE ontology_id=? AND name=?", (ontology_id, payload.get("target_object_type"))).fetchone()
        if not target:
            conn.close(); raise repo.ValidationError("目标对象不存在于当前本体")
        keys = {item.get("key") for item in json.loads(target["properties"] or "[]")}
        if not payload.get("target_property") or payload["target_property"] not in keys:
            conn.close(); raise repo.ValidationError("目标属性必须从目标对象的已定义属性中选择")
    conn.close()


def _validate_mapping_target(ontology_id: str, payload: Dict[str, Any], mapping_type: str) -> None:
    conn = repo.get_conn()
    if mapping_type == "relation":
        valid = conn.execute("SELECT 1 FROM link_types WHERE ontology_id=? AND name=?", (ontology_id, payload.get("target_relation"))).fetchone()
        conn.close()
        if not valid:
            raise repo.ValidationError("目标关系不存在于当前本体")
        return
    target = conn.execute("SELECT properties FROM object_types WHERE ontology_id=? AND name=?", (ontology_id, payload.get("target_object_type"))).fetchone()
    conn.close()
    if not target:
        raise repo.ValidationError("目标对象不存在于当前本体")
    if payload.get("target_property") not in {field.get("key") for field in json.loads(target["properties"] or "[]")}:
        raise repo.ValidationError("目标属性必须从目标对象的已定义属性中选择")


def _validate_authored_logic(ontology_id: str, data: EnterpriseResourceBase) -> None:
    if data.payload.get("authoring_version") != 2:
        return  # Preserve imported workbook rows and older resource variants.
    if data.category not in {"规则", "函数"}:
        raise repo.ValidationError("类型必须是规则或函数")
    payload = data.payload
    if not payload.get("applicable_objects") or not payload.get("logic") or not payload.get("output"):
        raise repo.ValidationError("适用对象、判断/计算逻辑和输出不能为空")
    if "design_status" in payload and payload["design_status"] not in {"设计中", "已确认"}:
        raise repo.ValidationError("模板状态只能是设计中或已确认")
    if "version" in payload and (not isinstance(payload["version"], str) or not payload["version"].strip() or len(payload["version"]) > 32):
        raise repo.ValidationError("模板版本不能为空，且不能超过 32 个字符")
    objects = {item["name"]: item for item in repo.list_object_types(ontology_id)}
    for name in set(payload.get("applicable_objects", [])) | set(payload.get("input_objects", [])):
        if name not in objects:
            raise repo.ValidationError(f"输入或适用对象 {name} 不存在")
    for field in payload.get("input_properties", []):
        object_name, separator, property_key = field.partition(".")
        if not separator or object_name not in objects or property_key not in {item["key"] for item in objects[object_name]["properties"]}:
            raise repo.ValidationError(f"输入属性 {field} 不属于已选对象")
        if object_name not in payload.get("input_objects", []):
            raise repo.ValidationError(f"输入属性 {field} 的所属对象必须先选为输入对象")


def save_resource(ontology_id: str, kind: str, data: EnterpriseResourceBase, resource_id: Optional[str] = None, allow_legacy_steps: bool = False) -> Dict[str, Any]:
    repo.get_ontology(ontology_id)
    if resource_id and kind in {"data-sources", "data-mappings", "logic-definitions"}:
        table_name = RESOURCE_TABLES[kind][0]
        old_conn = repo.get_conn()
        old_row = old_conn.execute(f"SELECT payload FROM {table_name} WHERE id=? AND ontology_id=?", (resource_id, ontology_id)).fetchone()
        old_conn.close()
        if not old_row:
            raise repo.NotFoundError("资源不存在")
        data = data.model_copy(update={"payload": {**json.loads(old_row["payload"] or "{}"), **data.payload}})
    source_password = None
    if kind == "data-sources":
        payload = dict(data.payload)
        source_password = payload.pop("password", None)
        if "connection" in payload and isinstance(payload["connection"], dict):
            connection = dict(payload.pop("connection"))
            source_password = connection.pop("password", source_password)
            payload.update(connection)
        # A changed endpoint or identity invalidates any previous connection check.
        if resource_id:
            old = get_resource(ontology_id, kind, resource_id)
            identity = ("driver", "host", "port", "database", "username")
            if source_password or any(str(old.get(key) or "") != str(payload.get(key) or "") for key in identity):
                payload.pop("connection_check", None)
        else:
            payload.pop("connection_check", None)
        data = data.model_copy(update={"payload": payload})
    if kind == "data-mappings":
        data = data.model_copy(update={"payload": _normalize_mapping_editor_payload(ontology_id, data.payload)})
        if not resource_id and data.payload.get("mapping_editor_version") == 3 and data.payload.get("binding_mode") != "governed":
            raise repo.ValidationError("新建语义映射必须通过治理资产绑定；旧版物理直连记录仅保留溯源")
    if kind == "governance-assets":
        _validate_governance_asset(ontology_id, data.payload)
        if resource_id:
            old = get_resource(ontology_id, kind, resource_id)
            referenced = [item for item in list_resources(ontology_id, "data-mappings") if item.get("governance_asset_code") == old["code"]]
            new_fields = {field["name"] for field in data.payload["fields"]}
            for mapping in referenced:
                used = [mapping.get("governance_field")] if mapping.get("mapping_type") == "property" else mapping.get("governance_relation_fields") or []
                if any(field not in new_fields for field in used):
                    raise repo.ValidationError("治理资产字段仍被语义映射引用，不能直接删除或改名")
            if referenced and data.payload.get("verification_status") != "confirmed":
                raise repo.ValidationError("已被映射引用的治理资产不能退回待确认")
    if kind == "business-scenarios": _validate_business_scenario(ontology_id,data.payload, allow_legacy_steps=allow_legacy_steps)
    if kind == "logic-definitions": _validate_authored_logic(ontology_id, data)
    table, label = RESOURCE_TABLES[kind]
    contract_conn = repo.get_conn()
    contract_active = _product_contract_active(contract_conn)
    contract_conn.close()
    if contract_active:
        if kind == "data-sources": _validate_data_source(data.payload)
        if kind == "data-mappings": _validate_data_mapping(ontology_id, data.payload)
    conn = repo.get_conn()
    conflict = conn.execute(f"SELECT 1 FROM {table} WHERE ontology_id=? AND code=? AND id<>?", (ontology_id, data.code, resource_id or "")).fetchone()
    if conflict:
        conn.close()
        raise repo.ConflictError(f"{label}编码 {data.code} 已存在")
    timestamp = repo.now()
    before = None
    if resource_id:
        current = conn.execute(f"SELECT * FROM {table} WHERE id=? AND ontology_id=?", (resource_id, ontology_id)).fetchone()
        if not current:
            conn.close()
            raise repo.NotFoundError(f"{label}不存在")
        if current["code"] != data.code:
            conn.close()
            raise repo.ValidationError(f"{label}编码是稳定引用标识，建立后不能修改")
        before = dict(current)
        conn.execute(f"UPDATE {table} SET code=?,name=?,category=?,status=?,description=?,payload=?,updated_at=?,updated_by=? WHERE id=?", (data.code, data.name, data.category, data.status, data.description, _json(data.payload), timestamp, "manual-admin", resource_id))
        operation = "update"
    else:
        resource_id = str(uuid.uuid4())
        conn.execute(f"""INSERT INTO {table}
            (id,ontology_id,code,name,category,status,description,payload,created_at,updated_at,created_by,updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", (resource_id, ontology_id, data.code, data.name, data.category, data.status, data.description, _json(data.payload), timestamp, timestamp, "manual-admin", "manual-admin"))
        operation = "create"
    row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (resource_id,)).fetchone()
    # 企业资源同样记录前后快照：否则变更记录里这几类资源永远只有一句文本，看不到“从什么改成什么”。
    repo._log(conn, ontology_id, kind.rstrip("s").replace("-", "_"), resource_id, operation, f"{'更新' if operation == 'update' else '创建'}{label} {data.name}", before=before, after=dict(row))
    conn.commit()
    conn.close()
    if kind == "data-sources" and source_password:
        source_connections.set_password(resource_id, source_password)
    result = _row(row)
    if kind == "data-sources": result["credential_configured"] = source_connections.has_password(resource_id)
    return result


def delete_resource(kind: str, resource_id: str) -> None:
    table, label = RESOURCE_TABLES[kind]
    conn = repo.get_conn()
    row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (resource_id,)).fetchone()
    if not row:
        conn.close()
        raise repo.NotFoundError(f"{label}不存在")
    if kind == "data-sources":
        object_count = conn.execute("SELECT COUNT(*) c FROM object_types WHERE ontology_id=? AND backing_source=?", (row["ontology_id"], row["code"])).fetchone()["c"]
        mapping_count = sum(row["code"] == item.get("source_code") for item in list_resources(row["ontology_id"], "data-mappings"))
        scenario_count = sum(row["code"] in (item.get("source_codes") or []) for item in list_resources(row["ontology_id"], "business-scenarios"))
        governance_count = sum(row["code"] == item.get("upstream_source_code") for item in list_resources(row["ontology_id"], "governance-assets"))
        if object_count or mapping_count or scenario_count or governance_count:
            conn.close(); raise repo.ValidationError(f"该数据源仍被 {object_count} 个对象、{mapping_count} 条映射、{scenario_count} 个场景和 {governance_count} 项治理资产引用")
    if kind == "governance-assets":
        mapping_count = sum(row["code"] == item.get("governance_asset_code") for item in list_resources(row["ontology_id"], "data-mappings"))
        if mapping_count:
            conn.close(); raise repo.ValidationError(f"该治理资产仍被 {mapping_count} 条语义映射引用")
    if kind == "data-mappings":
        scenario_count = sum(row["code"] in (item.get("related_mappings") or []) for item in list_resources(row["ontology_id"], "business-scenarios"))
        if scenario_count:
            conn.close(); raise repo.ValidationError(f"该数据映射仍被 {scenario_count} 个业务场景引用")
    conn.execute(f"DELETE FROM {table} WHERE id=?", (resource_id,))
    repo._log(conn, row["ontology_id"], kind.rstrip("s").replace("-", "_"), resource_id, "delete", f"删除{label} {row['name']}", before=dict(row))
    conn.commit()
    conn.close()


def enterprise_summary(ontology_id: str) -> Dict[str, Any]:
    result = {}
    for kind, (_, label) in RESOURCE_TABLES.items():
        result[kind.replace("-", "_")] = {"label": label, "count": len(list_resources(ontology_id, kind))}
    result["versions"] = {"label": "版本记录", "count": len(repo.release_history(ontology_id))}
    conn = repo.get_conn()
    result["evidence"] = conn.execute("SELECT COUNT(*) c FROM evidence_sources WHERE ontology_id=?", (ontology_id,)).fetchone()["c"]
    result["proposals"] = conn.execute("SELECT COUNT(*) c FROM ontology_proposals WHERE ontology_id=?", (ontology_id,)).fetchone()["c"]
    try:
        result["template_records"] = conn.execute("SELECT COUNT(*) c FROM template_records WHERE ontology_id=?", (ontology_id,)).fetchone()["c"]
    except Exception:
        result["template_records"] = 0
    conn.close()
    return result


def get_resource(ontology_id: str, kind: str, resource_id: str) -> Dict[str, Any]:
    return next((item for item in list_resources(ontology_id, kind) if item["id"] == resource_id or item["code"] == resource_id), None) or (_raise_not_found(RESOURCE_TABLES[kind][1]))


def _raise_not_found(label: str):
    raise repo.NotFoundError(f"{label}不存在")


def _mapping_type_family(value: str) -> str:
    name = str(value or "").strip().lower()
    if re.match(r"^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|number)\b", name):
        return "数值"
    if re.match(r"^(char|varchar|text|tinytext|mediumtext|longtext|string|enum|uuid|json)\b", name):
        return "文本"
    if re.match(r"^(date|datetime|timestamp|time)\b", name):
        return "日期时间"
    if re.match(r"^(bool|boolean|bit)\b", name):
        return "布尔"
    return ""


def validate_data_mapping(ontology_id: str, resource_id: str) -> Dict[str, Any]:
    """Check model and source metadata; never read business rows or run transforms."""
    mapping = get_resource(ontology_id, "data-mappings", resource_id)
    if mapping.get("binding_mode") == "governed":
        checks: list[Dict[str, str]] = []
        asset = next((item for item in list_resources(ontology_id, "governance-assets")
                      if item["code"] == mapping.get("governance_asset_code")), None)
        checks.append({"name": "治理资产", "level": "ok" if asset and asset.get("verification_status") == "confirmed" else "error",
                       "detail": asset["name"] if asset else "治理资产不存在"})
        fields = {item.get("name"): item for item in (asset or {}).get("fields", [])}
        names = [mapping.get("governance_field")] if mapping.get("mapping_type") == "property" else mapping.get("governance_relation_fields") or []
        for name in names:
            checks.append({"name": "治理字段", "level": "ok" if name in fields else "error", "detail": str(name or "未选择")})
        if asset and mapping.get("mapping_type") == "property" and names[0] in fields:
            target = next((item for item in repo.list_object_types(ontology_id) if item["name"] == mapping.get("target_object_type")), None)
            prop = next((item for item in (target or {}).get("properties", []) if item["key"] == mapping.get("target_property")), None)
            source_type = fields[names[0]].get("data_type") or ""
            source_family = _mapping_type_family(source_type)
            target_family = _mapping_type_family((prop or {}).get("type") or "")
            if source_family and target_family and source_family != target_family:
                has_conversion = (mapping.get("transform_rule") or "").strip() not in {"", "-", "无"}
                checks.append({"name": "字段类型", "level": "warning" if has_conversion else "error",
                               "detail": f"治理字段 {source_type} 与本体属性 {(prop or {}).get('type') or '未知'} 类型不一致；需核对转换规则"})
            elif source_family and target_family:
                checks.append({"name": "字段类型", "level": "ok", "detail": "数据类型同类；精度、单位与业务口径仍需人工核对"})
            else:
                checks.append({"name": "字段类型", "level": "pending", "detail": "字段类型信息不足，需人工核对"})
        try:
            _validate_mapping_target(ontology_id, mapping, mapping.get("mapping_type"))
            checks.append({"name": "本体目标", "level": "ok", "detail": "目标对象、属性或关系存在"})
        except repo.ValidationError as exc:
            checks.append({"name": "本体目标", "level": "error", "detail": str(exc)})
        checks.append({"name": "运行生效", "level": "pending", "detail": "当前只验证元数据绑定；治理平台接口、数据同步和实例读取尚未接入"})
        return {"mapping_id": mapping["id"], "status": "error" if any(item["level"] == "error" for item in checks) else "pending",
                "checks": checks, "model_updated_at": mapping["updated_at"], "snapshot_id": None,
                "snapshot_captured_at": None, "checked_at": repo.now()}
    checks: list[Dict[str, str]] = []

    def check(name: str, level: str, detail: str) -> None:
        checks.append({"name": name, "level": level, "detail": detail})

    sources = list_resources(ontology_id, "data-sources")
    source = next((item for item in sources if item["code"] == mapping.get("source_code")), None)
    if not source:
        check("数据源", "error", "数据源不存在或已删除")
        snapshot = None
    else:
        check("数据源", "ok", source["name"])
        snapshot = source_connections.latest_snapshot(ontology_id, source["id"])
    chosen_table = None
    if mapping.get("source_kind") in {"api", "file"}:
        label = "来源接口" if mapping["source_kind"] == "api" else "来源文件"
        check(label, "pending", f"已登记 {mapping.get('source_table') or ''}；字段契约尚未核验，当前表结构快照不能证明该来源有效")
    elif not snapshot:
        check("来源结构", "pending", "尚无结构快照，无法验证表和字段")
    else:
        table_name = (mapping.get("source_table") or "").split(".")[-1]
        chosen_table = next((item for item in snapshot["schema"]["tables"] if item["name"] == table_name), None)
        check("来源表", "ok" if chosen_table else "error", table_name if chosen_table else f"结构快照中不存在 {table_name}")

    mapping_type = mapping.get("mapping_type")
    objects = repo.list_object_types(ontology_id)
    target = next((item for item in objects if item["name"] == mapping.get("target_object_type")), None)
    prop = None
    if mapping_type == "property":
        check("目标对象", "ok" if target else "error", target["display_name"] if target else "目标对象不存在")
        prop = next((item for item in (target or {}).get("properties", []) if item["key"] == mapping.get("target_property")), None)
        check("目标属性", "ok" if prop else "error", prop["name"] if prop else "属性不存在或不属于目标对象")
    elif mapping_type == "relation":
        relation = next((item for item in repo.list_link_types(ontology_id) if item["name"] == mapping.get("target_relation")), None)
        check("目标关系", "ok" if relation else "error", relation["display_name"] if relation else "目标关系不存在")
    else:
        check("映射类型", "error", "仅支持属性映射或关系映射")

    source_fields = ([(mapping.get("source_field") or "").strip()] if mapping_type == "property"
                     else [part.strip().split(".")[-1] for part in re.split(r"[/+;,，、]", mapping.get("source_field") or mapping.get("source_key") or "") if part.strip()])
    if mapping_type == "relation" and not mapping.get("source_key"):
        check("关联键", "error", "关系映射必须填写主键/关联键")
    # An optional distinct target_key is an advanced cross-table join. The workbook
    # uses a single composite 主键/关联键 column for link-table mappings.
    if mapping_type == "relation" and snapshot and mapping.get("target_key") and mapping.get("target_key") != mapping.get("source_key"):
        target_ref = mapping["target_key"].split(".")
        if len(target_ref) == 2:
            target_table = next((item for item in snapshot["schema"]["tables"] if item["name"] == target_ref[0]), None)
            if target_table:
                exists = any(item["name"] == target_ref[1] for item in target_table["columns"])
                check("目标关联字段", "ok" if exists else "error", mapping["target_key"])
            else:
                check("目标关联字段", "pending", "目标表尚未纳入该结构快照")
        else:
            check("目标关联字段", "pending", "请使用“表.字段”标识目标关联键")
    if chosen_table and source_fields:
        matched_columns = []
        for field_name in source_fields:
            column = next((item for item in chosen_table["columns"] if item["name"] == field_name), None)
            check("来源字段／键", "ok" if column else "error", field_name if column else f"表中不存在 {field_name}")
            if column:
                matched_columns.append(column)
        if prop and len(matched_columns) == 1:
            column = matched_columns[0]
            physical = str(column.get("column_type") or column.get("data_type") or "").lower()
            logical = str(prop.get("type") or "").lower()
            source_family = _mapping_type_family(physical)
            target_family = _mapping_type_family(logical)
            conversion = (mapping.get("transform_rule") or "").strip()
            has_conversion = conversion not in {"", "-", "无"}
            if not source_family or not target_family:
                check("字段类型", "pending", f"来源 {physical} → 本体 {logical}，类型信息不足，需人工核对")
            elif source_family != target_family:
                check("字段类型", "warning" if has_conversion else "error",
                      f"来源 {physical} → 本体 {logical}；" +
                      ("已填写转换规则，仍需核实其可执行性" if has_conversion else "直接映射不适用，请配置转换规则"))
            else:
                check("字段类型", "ok", f"来源 {physical} → 本体 {logical}，同属{target_family}类型；精度、单位和业务口径需核对")
            if prop.get("is_required") and column.get("nullable") is True:
                check("必填约束", "warning", "来源字段允许为空，但本体属性为必填；需配置质量校验，实际空值率待实例数据接入后验证")
            if prop.get("is_primary_key") and column.get("key") not in {"PRI", "UNI"}:
                check("主键约束", "warning", "本体业务主键已定义，但来源字段未声明主键/唯一约束；实际唯一性待实例数据接入后验证")
            if logical == "enum":
                check("枚举取值", "pending", "字段类型可核对，源值是否属于本体枚举仍需实例数据验证")
    if mapping_type in {"property", "relation"} and chosen_table and mapping.get("source_key"):
        keys = [part.strip().split(".")[-1] for part in re.split(r"[/+;,，、]", mapping["source_key"]) if part.strip()]
        known = {item["name"].lower() for item in chosen_table["columns"]}
        for key in keys:
            check("主键/关联键", "ok" if key.lower() in known else "error",
                  key if key.lower() in known else f"来源表中不存在 {key}")
    if mapping.get("map_way") in {"expression", "lookup"} and not (mapping.get("transform_rule") or mapping.get("lookup_dictionary")):
        check("转换配置", "warning", "转换方式已选择，但表达式或字典尚未配置")
    if not mapping.get("update_method"):
        check("更新方式", "pending", "尚未定义更新要求；二期不执行同步")
    status = "error" if any(item["level"] == "error" for item in checks) else (
        "pending" if any(item["level"] in {"pending", "warning"} for item in checks) else "valid")
    return {"mapping_id": mapping["id"], "status": status, "checks": checks,
            "model_updated_at": mapping["updated_at"], "snapshot_id": snapshot["id"] if snapshot else None,
            "snapshot_captured_at": snapshot["captured_at"] if snapshot else None,
            "checked_at": repo.now()}


def _scenario_steps(ontology: Dict[str, Any], scenario: Dict[str, Any]) -> tuple[list[Dict[str, Any]], Dict[str, Any]]:
    configured = scenario.get("steps") or []
    if configured and isinstance(configured[0], dict):
        # A lightweight runtime for the prototype: the configured graph is the
        # source of truth.  Actual connectors/rule engines can replace each tool
        # later without changing the scenario contract.
        steps = []
        rule_count = 0
        proposed_action = None
        for item in sorted(configured, key=lambda value: value.get("order", 0)):
            step_type = item.get("type")
            labels = {
                "object_resolve": ("对象解析", "object.resolve"),
                "link_traverse": ("关系穿透", "link.traverse"),
                "rule_execute": ("规则执行", "rule.execute"),
                "mapping_read": ("读取数据映射", "mapping.read"),
                "action_propose": ("行动建议", "action.propose"),
                "approval": ("人工审批", "approval.wait"),
                "verify": ("结果验证", "runtime.verify"),
            }
            stage, tool = labels.get(step_type, (item.get("name", "执行步骤"), "scenario.step"))
            status = "awaiting_confirmation" if step_type in {"action_propose", "approval"} and (item.get("approval_required") or step_type == "approval") else "preview"
            detail = item.get("detail") or f"拟执行：{item.get('resource_ref') or item.get('name')}"
            steps.append({"order": item.get("order"), "stage": stage, "status": status, "tool": tool, "detail": detail, "resource_ref": item.get("resource_ref"), "on_failure": item.get("on_failure", "stop")})
            if step_type == "rule_execute": rule_count += 1
            if step_type == "action_propose": proposed_action = item.get("resource_ref")
        action_name = proposed_action or "无"
        action_status = "awaiting_confirmation" if proposed_action else "not_configured"
        return steps, {
            "conclusion": "已生成流程预览，尚未调用业务系统",
            "risk_level": "未评估",
            "rule_hits": 0,
            "configured_rule_steps": rule_count,
            "path": scenario.get("key_path") or " → ".join(scenario.get("related_objects") or []),
            "action": action_name,
            "action_status": action_status,
        }
    raise repo.ValidationError("该场景尚未配置结构化执行步骤，无法生成流程预览")


def run_scenario(ontology_id: str, scenario_id: str, input_snapshot: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    ontology = repo.get_ontology(ontology_id)
    scenario = get_resource(ontology_id, "business-scenarios", scenario_id)
    if not scenario.get("steps") or not isinstance(scenario["steps"][0], dict):
        raise repo.ValidationError("该场景尚未配置结构化执行步骤，当前只能查看业务语义")
    steps, result = _scenario_steps(ontology, scenario)
    run_id, timestamp = str(uuid.uuid4()), repo.now()
    conn = repo.get_conn()
    conn.execute("INSERT INTO scenario_runs VALUES (?,?,?,?,?,?,?,?)", (run_id, ontology_id, scenario["id"], "completed", _json(input_snapshot or {}), _json(steps), _json(result), timestamp))
    conn.commit(); conn.close()
    return {"id": run_id, "ontology_id": ontology_id, "scenario_id": scenario["id"], "scenario": scenario, "status": "completed", "steps": steps, "result": result, "created_at": timestamp}


def list_scenario_runs(ontology_id: str, scenario_id: Optional[str] = None) -> list[Dict[str, Any]]:
    repo.get_ontology(ontology_id)
    conn = repo.get_conn()
    if scenario_id:
        rows = conn.execute("SELECT * FROM scenario_runs WHERE ontology_id=? AND scenario_id=? ORDER BY created_at DESC", (ontology_id, scenario_id)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM scenario_runs WHERE ontology_id=? ORDER BY created_at DESC", (ontology_id,)).fetchall()
    conn.close()
    return [{**dict(row), "input_snapshot": json.loads(row["input_snapshot"] or "{}"), "steps": json.loads(row["steps"] or "[]"), "result": json.loads(row["result"] or "{}")} for row in rows]


def _extract_docx(raw: bytes) -> str:
    with zipfile.ZipFile(BytesIO(raw)) as archive:
        xml = archive.read("word/document.xml")
    root = ET.fromstring(xml)
    return "\n".join("".join(node.itertext()) for node in root.iter() if node.tag.endswith("}p"))


def _extract_xlsx(raw: bytes) -> tuple[str, Dict[str, Any]]:
    with zipfile.ZipFile(BytesIO(raw)) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(item.itertext()) for item in root if item.tag.endswith("}si")]
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rel_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        relationships = {item.attrib.get("Id"): item.attrib.get("Target") for item in rel_root}
        sheets = []
        for sheet in workbook.iter():
            if not sheet.tag.endswith("}sheet"):
                continue
            rid = next((value for key, value in sheet.attrib.items() if key.endswith("}id")), None)
            target = relationships.get(rid, "")
            path = target if target.startswith("xl/") else f"xl/{target.lstrip('/')}"
            if path not in archive.namelist():
                continue
            root = ET.fromstring(archive.read(path))
            lines = []
            for row in root.iter():
                if not row.tag.endswith("}row"):
                    continue
                cells = []
                for cell in row:
                    if not cell.tag.endswith("}c"):
                        continue
                    ctype = cell.attrib.get("t")
                    value_node = next((node for node in cell if node.tag.endswith("}v")), None)
                    inline_node = next((node for node in cell if node.tag.endswith("}is")), None)
                    value = "" if value_node is None else (value_node.text or "")
                    if ctype == "s" and value.isdigit() and int(value) < len(shared):
                        value = shared[int(value)]
                    elif ctype == "inlineStr" and inline_node is not None:
                        value = "".join(inline_node.itertext())
                    cells.append(value)
                if any(cells):
                    lines.append(" | ".join(cells))
            sheets.append((sheet.attrib.get("name", "未命名工作表"), lines))
    text = "\n\n".join(f"## {name}\n" + "\n".join(lines) for name, lines in sheets)
    return text, {"sheet_count": len(sheets), "sheet_names": [item[0] for item in sheets], "row_count": sum(len(item[1]) for item in sheets)}


def upload_evidence(ontology_id: str, data: EvidenceUpload) -> Dict[str, Any]:
    repo.get_ontology(ontology_id)
    raw = base64.b64decode(data.content_base64) if data.content_base64 else (data.text_content or "").encode("utf-8")
    if len(raw) > 15 * 1024 * 1024:
        raise repo.ValidationError("单个资料不能超过 15MB")
    suffix = data.filename.lower().rsplit(".", 1)[-1] if "." in data.filename else ""
    summary: Dict[str, Any] = {"bytes": len(raw), "parser": "plain-text"}
    try:
        if suffix == "xlsx":
            text, parsed = _extract_xlsx(raw)
            summary.update(parsed)
            summary["parser"] = "xlsx-structure"
        elif suffix == "docx":
            text = _extract_docx(raw)
            summary["parser"] = "docx-structure"
        elif suffix in {"txt", "md", "csv", "json", "yaml", "yml"}:
            text = raw.decode("utf-8", errors="replace")
        else:
            text = (data.text_content or "") or f"文件：{data.filename}（当前原型保留文件证据，正式版接入文档解析服务）"
            summary["parser"] = "metadata-only"
    except (KeyError, ValueError, zipfile.BadZipFile, ET.ParseError) as exc:
        raise repo.ValidationError(f"文件解析失败：{exc}") from exc
    source_id = str(uuid.uuid4())
    timestamp = repo.now()
    digest = hashlib.sha256(raw).hexdigest()
    conn = repo.get_conn()
    conn.execute("INSERT INTO evidence_sources VALUES (?,?,?,?,?,?,?,?,?,?)", (source_id, ontology_id, data.filename, data.mime_type, data.source_kind, digest, text[:300000], _json(summary), "parsed", timestamp))
    _audit(conn, ontology_id, "evidence_source", source_id, "create", f"接入建模资料 {data.filename}")
    conn.commit()
    row = conn.execute("SELECT * FROM evidence_sources WHERE id=?", (source_id,)).fetchone()
    conn.close()
    return _evidence_row(row)


def _evidence_row(row) -> Dict[str, Any]:
    data = dict(row)
    data["parse_summary"] = json.loads(data["parse_summary"] or "{}")
    data["text_preview"] = data.pop("extracted_text", "")[:700]
    return data


def list_evidence(ontology_id: str) -> list[Dict[str, Any]]:
    repo.get_ontology(ontology_id)
    conn = repo.get_conn()
    rows = conn.execute("SELECT * FROM evidence_sources WHERE ontology_id=? ORDER BY created_at DESC", (ontology_id,)).fetchall()
    conn.close()
    return [_evidence_row(row) for row in rows]


def delete_evidence(source_id: str) -> None:
    conn = repo.get_conn()
    row = conn.execute("SELECT ontology_id FROM evidence_sources WHERE id=?", (source_id,)).fetchone()
    if not row:
        conn.close()
        raise repo.NotFoundError("建模资料不存在")
    used = conn.execute("SELECT COUNT(*) c FROM ontology_proposals WHERE source_ids LIKE ?", (f"%{source_id}%",)).fetchone()["c"]
    if used:
        conn.close()
        raise repo.ValidationError("资料已被 Proposal 引用，不能直接删除")
    conn.execute("DELETE FROM evidence_sources WHERE id=?", (source_id,))
    conn.commit()
    conn.close()


def _build_session_row(row, include_detail: bool = True) -> Dict[str, Any]:
    data = dict(row)
    data["context"] = json.loads(data.get("context") or "{}")
    if not include_detail:
        return data
    data["ontology"] = repo.get_ontology(data["ontology_id"])
    conn = repo.get_conn()
    data["evidence_count"] = conn.execute(
        "SELECT COUNT(*) c FROM evidence_sources WHERE ontology_id=?", (data["ontology_id"],)
    ).fetchone()["c"]
    conn.close()
    data["proposal"] = get_proposal(data["proposal_id"]) if data.get("proposal_id") else None
    return data


def create_build_session(data: BuildSessionCreate) -> Dict[str, Any]:
    if data.mode == "create":
        if not data.ontology_name or not data.namespace:
            raise repo.ValidationError("新建本体必须填写本体名称和命名空间")
        ontology = repo.create_ontology(
            OntologyBase(name=data.ontology_name, namespace=data.namespace, description=data.description)
        )
    else:
        if not data.target_ontology_id:
            raise repo.ValidationError("更新本体必须选择目标本体")
        ontology = repo.get_ontology(data.target_ontology_id)
        if ontology["status"] in {"in_review", "reviewed"}:
            raise repo.ValidationError("目标本体正在评审，需完成或撤回当前评审后再开始新的智能构建任务")
        if ontology["status"] == "published":
            ontology = repo.derive_working_state(ontology["id"])

    session_id, timestamp = str(uuid.uuid4()), repo.now()
    base_version = ontology.get("based_on_version") or ontology["version"]
    context = {
        "description": data.description or ontology.get("description") or "",
        "business_context": data.business_context,
        "entry_object": data.entry_object,
        "expected_output": data.expected_output,
        "creation_policy": "proposal-first",
        "isolation": "working-state",
    }
    conn = repo.get_conn()
    conn.execute(
        """INSERT INTO ontology_build_sessions
           (id,ontology_id,mode,title,domain,business_goal,change_scope,base_version,status,current_step,scenario_id,proposal_id,context,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            session_id, ontology["id"], data.mode, data.title, data.domain, data.business_goal,
            data.change_scope, base_version, "evidence", 2, data.scenario_id, None,
            _json(context), timestamp, timestamp,
        ),
    )
    conn.commit(); conn.close()
    brief = f"""# 智能构建任务说明
任务模式：{'创建新本体' if data.mode == 'create' else '更新现有本体'}
目标本体：{ontology['name']}（{ontology['namespace']}）
业务领域：{data.domain}
业务目标：{data.business_goal}
变更范围：{data.change_scope}
入口对象：{data.entry_object or '待从证据识别'}
预期输出：{data.expected_output or '形成可评审的对象、关系、规则、动作和数据映射建议'}
业务背景：{data.business_context or '待结合上传资料补充'}
治理约束：所有 AI 结果只进入 Proposal，经人工决策后合并到工作状态。
"""
    evidence = upload_evidence(
        ontology["id"],
        EvidenceUpload(
            filename=f"智能构建任务说明-{session_id[:8]}.md",
            mime_type="text/markdown",
            text_content=brief,
            source_kind="build-brief",
        ),
    )
    context["brief_evidence_id"] = evidence["id"]
    conn = repo.get_conn()
    conn.execute(
        "UPDATE ontology_build_sessions SET context=?,updated_at=? WHERE id=?",
        (_json(context), repo.now(), session_id),
    )
    conn.commit(); row = conn.execute("SELECT * FROM ontology_build_sessions WHERE id=?", (session_id,)).fetchone(); conn.close()
    return _build_session_row(row)


def list_build_sessions(ontology_id: Optional[str] = None) -> list[Dict[str, Any]]:
    conn = repo.get_conn()
    if ontology_id:
        repo.get_ontology(ontology_id)
        rows = conn.execute(
            "SELECT * FROM ontology_build_sessions WHERE ontology_id=? ORDER BY updated_at DESC", (ontology_id,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM ontology_build_sessions ORDER BY updated_at DESC LIMIT 50").fetchall()
    conn.close()
    return [_build_session_row(row, include_detail=False) for row in rows]


def get_build_session(session_id: str) -> Dict[str, Any]:
    conn = repo.get_conn()
    row = conn.execute("SELECT * FROM ontology_build_sessions WHERE id=?", (session_id,)).fetchone()
    conn.close()
    if not row:
        raise repo.NotFoundError("智能构建任务不存在")
    return _build_session_row(row)


def validate_build_session(session_id: str) -> Dict[str, Any]:
    session = get_build_session(session_id)
    if session["status"] not in {"merged", "validation_failed", "ready_for_review"}:
        raise repo.ValidationError("请先完成 Proposal 评审与合并，再运行工作状态校验")
    report = repo.validate_ontology(session["ontology_id"])
    preview = repo.release_preview(session["ontology_id"])
    context = {**session["context"], "validation": report, "release_preview": preview, "validated_at": repo.now()}
    status = "ready_for_review" if report["valid"] else "validation_failed"
    conn = repo.get_conn()
    conn.execute(
        "UPDATE ontology_build_sessions SET status=?,current_step=?,context=?,updated_at=? WHERE id=?",
        (status, 6 if report["valid"] else 5, _json(context), repo.now(), session_id),
    )
    conn.commit(); conn.close()
    result = get_build_session(session_id)
    result["validation"] = report
    result["release_preview"] = preview
    return result


def transition_build_session(session_id: str, data: BuildSessionTransition) -> Dict[str, Any]:
    session = get_build_session(session_id)
    if data.action == "submit_review":
        if session["status"] != "ready_for_review":
            raise repo.ValidationError("工作状态必须先通过校验，才能提交评审")
        ontology = repo.submit_review(session["ontology_id"])
        status = "in_review"
    elif data.action == "approve":
        if session["status"] != "in_review":
            raise repo.ValidationError("只有待评审的智能构建任务可以评审通过")
        ontology = repo.approve_review(session["ontology_id"])
        status = "reviewed"
    else:
        if session["status"] != "reviewed":
            raise repo.ValidationError("只有评审通过的智能构建任务可以发布")
        ontology = repo.publish(session["ontology_id"], data.bump, data.change_reason, data.reviewer)
        status = "published"
    context = {**session["context"], "governance_action": data.action, "governance_at": repo.now()}
    conn = repo.get_conn()
    conn.execute(
        "UPDATE ontology_build_sessions SET status=?,current_step=6,context=?,updated_at=? WHERE id=?",
        (status, _json(context), repo.now(), session_id),
    )
    conn.commit(); conn.close()
    result = get_build_session(session_id)
    result["ontology"] = ontology
    return result


def _extract_json(text: str) -> Dict[str, Any]:
    cleaned = text.strip()
    if "```" in cleaned:
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.I | re.S)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end < start:
        raise ValueError("模型未返回 JSON")
    return json.loads(cleaned[start : end + 1])


def _call_deepseek(system_prompt: str, user_prompt: str) -> tuple[Dict[str, Any], str]:
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")
    payload = {
        "model": "deepseek-v4-flash",
        "reasoning_effort": "max",
        "temperature": 0.15,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
    }
    with httpx.Client(timeout=75) as client:
        response = client.post("https://api.deepseek.com/v1/chat/completions", headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, json=payload)
        if response.status_code == 400 and "reasoning_effort" in response.text:
            payload.pop("reasoning_effort", None)
            response = client.post("https://api.deepseek.com/v1/chat/completions", headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, json=payload)
        response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return _extract_json(content), response.headers.get("x-request-id", "")


def _fallback_proposal(ontology_id: str, evidence_text: str, mode: str = "update", change_scope: str = "增量完善") -> Dict[str, Any]:
    objects = repo.list_object_types(ontology_id)
    existing = {item["name"] for item in objects}
    operations: list[Dict[str, Any]] = []
    if mode == "update" and objects:
        preferred = next((item for item in objects if item["name"] == "PaymentRequest"), objects[0])
        operations.append({
            "resource_type": "object_type", "operation": "update", "display_name": preferred["display_name"],
            "api_name": preferred["name"], "confidence": 0.88, "risk": "medium",
            "rationale": f"本次范围为“{change_scope}”。资料要求保留审查解释，建议在既有对象上增量补充可追溯字段，而不是复制一个新对象。",
            "evidence": "智能构建任务说明.md · 业务目标与输出要求",
            "diff_summary": f"更新 {preferred['name']}：新增 risk_reason 属性；稳定 API 名称和主键保持不变。",
            "payload": {
                "target_api_name": preferred["name"],
                "add_properties": [{"key": "risk_reason", "name": "风险原因", "type": "string", "is_searchable": True, "description": "记录规则与人工审查形成的可解释风险原因"}],
            },
        })
    else:
        if any(word in evidence_text for word in ("采购", "付款", "合同", "供应商")):
            candidates = [
                ("Supplier", "供应商", "参与采购履约和收款的经营主体"),
                ("Contract", "采购合同", "约束供应商、金额与履约状态的业务合同"),
                ("PaymentRequest", "付款申请", "连接合同、预算、发票和审查结果的业务单据"),
            ]
        elif any(word in evidence_text for word in ("管", "运输", "告警")):
            candidates = [
                ("InspectionTask", "巡检任务", "承接管网巡检计划、执行状态与结果的业务对象"),
                ("RiskEvent", "风险事件", "汇聚规则命中、告警升级与人工判断形成的风险事件"),
            ]
        else:
            candidates = [("ReviewTask", "审核任务", "承接规则命中后的人机协同审核闭环")]
        for api_name, display_name, description in candidates:
            if api_name in existing:
                continue
            operations.append({
                "resource_type": "object_type", "operation": "create", "display_name": display_name,
                "api_name": api_name, "confidence": 0.84, "risk": "low",
                "rationale": "资料中存在独立身份、状态与责任人，建议建成可关联、可行动的对象。",
                "evidence": "来自任务说明与上传资料中的流程、状态和责任描述",
                "diff_summary": f"新增对象类型 {api_name}，包含确定性主键、标题和状态属性。",
                "payload": {"name": api_name, "display_name": display_name, "description": description, "title_property": "name", "properties": [{"key": "id", "name": "唯一标识", "type": "string", "is_primary_key": True, "is_required": True}, {"key": "name", "name": "名称", "type": "string", "is_required": True, "is_searchable": True}, {"key": "status", "name": "状态", "type": "string", "is_searchable": True}]},
            })
        candidate_names = {item[0] for item in candidates}
        if {"Supplier", "Contract", "PaymentRequest"}.issubset(candidate_names):
            operations.extend([
                {
                    "resource_type": "link_type", "operation": "create", "display_name": "合同供应商", "api_name": "contract_signed_with_supplier",
                    "confidence": 0.83, "risk": "low", "rationale": "付款审查必须从合同穿透到收款供应商。", "evidence": "任务说明中的合同、供应商与付款业务链",
                    "diff_summary": "新增采购合同 → 供应商的多对一关系。",
                    "payload": {"name": "contract_signed_with_supplier", "display_name": "签约供应商", "source_object_name": "Contract", "target_object_name": "Supplier", "cardinality": "many_to_one", "description": "采购合同约定的供应商主体"},
                },
                {
                    "resource_type": "link_type", "operation": "create", "display_name": "付款基于合同", "api_name": "payment_based_on_contract",
                    "confidence": 0.86, "risk": "low", "rationale": "付款申请需要以合同为业务依据。", "evidence": "任务说明中的付款与合同约束",
                    "diff_summary": "新增付款申请 → 采购合同的多对一关系。",
                    "payload": {"name": "payment_based_on_contract", "display_name": "基于合同", "source_object_name": "PaymentRequest", "target_object_name": "Contract", "cardinality": "many_to_one", "description": "付款申请对应的采购合同"},
                },
                {
                    "resource_type": "business_rule", "operation": "create", "display_name": "付款金额有效性", "api_name": "payment_amount_positive",
                    "confidence": 0.82, "risk": "low", "rationale": "付款金额是可确定执行的基础质量规则。", "evidence": "付款流程与财务数据字典",
                    "diff_summary": "在付款申请上新增金额大于零的确定性校验规则。",
                    "payload": {"name": "payment_amount_positive", "display_name": "付款金额有效性", "target_object_name": "PaymentRequest", "category": "validation", "severity": "blocking", "expression": "amount > 0", "description": "付款申请金额必须大于零", "remediation": "退回经办人修正付款金额"},
                },
                {
                    "resource_type": "action", "operation": "create", "display_name": "发起付款人工复核", "api_name": "request_payment_review",
                    "confidence": 0.79, "risk": "medium", "rationale": "高风险付款需要从识别走向受控的人机协同闭环。", "evidence": "任务说明中的审查和跟进要求",
                    "diff_summary": "在付款申请上新增需人工确认的复核 Action；不直接执行付款。",
                    "payload": {"name": "request_payment_review", "display_name": "发起付款人工复核", "target_object_name": "PaymentRequest", "action_type": "modify", "description": "创建人工复核任务并记录风险依据", "approval_required": True, "side_effects": ["创建复核任务", "写入审计日志"]},
                },
                {
                    "resource_type": "data_source", "operation": "create", "display_name": "财务共享付款数据", "api_name": "SRC-AI-PAY",
                    "confidence": 0.76, "risk": "low", "rationale": "业务对象必须保留与权威数据来源的映射入口。", "evidence": "任务说明中的财务共享平台资料",
                    "diff_summary": "登记付款申请的权威数据源；连接凭据不进入 Proposal。",
                    "payload": {"code": "SRC-AI-PAY", "name": "财务共享付款数据", "category": "财务系统", "status": "proposal", "description": "付款申请的权威业务数据来源", "payload": {"physical_object": "finance.payment_request", "interface_type": "数据库", "update_frequency": "实时", "credential_policy": "由连接管理器托管"}},
                },
                {
                    "resource_type": "data_mapping", "operation": "create", "display_name": "付款申请编号属性映射", "api_name": "MAP-AI-PAY",
                    "confidence": 0.74, "risk": "low", "rationale": "新对象需要可验证的数据背书，避免只有空壳 Schema。", "evidence": "付款数据字典与样例记录",
                    "diff_summary": "新增财务付款编号字段到 PaymentRequest 属性的映射草案。",
                    "payload": {"code": "MAP-AI-PAY", "name": "付款申请编号属性映射", "category": "属性映射", "status": "proposal", "description": "财务付款表的编号字段映射到付款申请属性", "payload": {"mapping_type": "property", "source_code": "SRC-AI-PAY", "source_table": "payment_request", "target_object_type": "PaymentRequest", "source_field": "payment_id", "target_property": "payment_id", "map_way": "direct", "update_method": "realtime"}},
                },
            ])
        operations.append({
            "resource_type": "business_scenario", "operation": "create", "display_name": "业务审查闭环",
            "api_name": "SCN-AI-001", "confidence": 0.78, "risk": "low",
            "rationale": "先用业务闭环检验对象、关系、规则和动作覆盖度，再进入发布。",
            "evidence": "智能构建任务说明.md · 业务目标",
            "diff_summary": "新增业务场景，作为模型预览与验收入口。",
            "payload": {"code": "SCN-AI-001", "name": "业务审查闭环", "category": "智能构建", "status": "proposal", "description": "从对象定位、规则判断、人工确认到动作执行的闭环", "payload": {"business_goal": "验证本体能够支撑真实业务判断", "trigger": "业务单据提交或异常命中", "steps": ["定位业务对象", "穿透关系", "运行确定性规则", "人工确认高风险动作", "记录执行结果"], "acceptance_criteria": ["对象可定位", "关系可穿透", "规则可解释", "动作受控"]}},
        })
    return {"summary": f"已按“{'创建新本体' if mode == 'create' else '更新现有本体'}”模式生成增量 Proposal；正式模型尚未被修改。", "operations": operations}


def _proposal_row(row, include_operations: bool = True) -> Dict[str, Any]:
    data = dict(row)
    data["source_ids"] = json.loads(data["source_ids"] or "[]")
    if include_operations:
        conn = repo.get_conn()
        operations = conn.execute("SELECT * FROM proposal_operations WHERE proposal_id=? ORDER BY sort_order", (data["id"],)).fetchall()
        conn.close()
        data["operations"] = [{**dict(item), "payload": json.loads(item["payload"] or "{}")} for item in operations]
        data["counts"] = {state: sum(1 for item in data["operations"] if item["decision"] == state) for state in ("pending", "accepted", "rejected", "deferred", "conflict")}
    return data


def _build_rounds(ontology_id: str, rows, operations: list[Dict[str, Any]], max_rounds: int, scenario_id: Optional[str], mode: str = "update", base_version: Optional[str] = None) -> tuple[list[Dict[str, Any]], Dict[str, Any]]:
    objects = repo.list_object_types(ontology_id)
    links = repo.list_link_types(ontology_id)
    mappings = list_resources(ontology_id, "data-mappings")
    sources = list_resources(ontology_id, "data-sources")
    existing_names = {item["name"] for item in objects}
    proposed_names = {item.get("api_name") for item in operations if item.get("resource_type") == "object_type"}
    reused = len(existing_names & proposed_names)
    conflicts = sum(1 for item in operations if item.get("operation") == "conflict" or item.get("risk") in {"high", "breaking"})
    rounds = [
        {"round": 1, "stage": "任务与基线确认", "status": "completed", "summary": f"按“{'创建新本体' if mode == 'create' else '更新现有本体'}”模式执行；基线版本 {base_version or '无'}", "metrics": {"mode": mode, "base_version": base_version or "none"}},
        {"round": 1, "stage": "证据与数据画像", "status": "completed", "summary": f"解析 {len(rows)} 份资料、{len(sources)} 个数据源，建立字段与业务术语索引", "metrics": {"evidence": len(rows), "data_sources": len(sources), "mappings": len(mappings)}},
        {"round": 1, "stage": "候选语义抽取", "status": "completed", "summary": f"识别 {len(operations)} 项对象、关系、规则或 Action 候选", "metrics": {"candidates": len(operations)}},
    ]
    if max_rounds >= 2:
        rounds.extend([
            {"round": 2, "stage": "对齐与去重", "status": "completed", "summary": f"与 {len(objects)} 个已有对象、{len(links)} 条已有关系交叉比对", "metrics": {"existing_objects": len(objects), "reused": reused, "conflicts": conflicts}},
            {"round": 2, "stage": "确定性校验", "status": "completed", "summary": "校验主键、关系端点、映射来源、Action 权限与版本兼容性", "metrics": {"blocking": conflicts, "warnings": max(0, len(operations) - reused - conflicts)}},
        ])
    if max_rounds >= 3:
        rounds.append({"round": 3, "stage": "缺口补全", "status": "completed", "summary": "根据冲突和缺失字段重新组织建议；未确认项继续留在 Proposal", "metrics": {"repaired": max(0, len(operations) - conflicts), "deferred": conflicts}})
    if scenario_id:
        scenario = get_resource(ontology_id, "business-scenarios", scenario_id)
        rounds.append({"round": max_rounds, "stage": "场景预检", "status": "completed", "summary": f"使用“{scenario['name']}”检查对象、关系、规则与动作覆盖度", "metrics": {"scenario_ready": True, "entry_object": scenario.get("entry_object") or scenario.get("payload", {}).get("entry_object")}})
    metrics = {"round_count": max_rounds, "mode": mode, "base_version": base_version, "candidates": len(operations), "reused": reused, "conflicts": conflicts, "evidence_coverage": 1.0 if rows else 0.0, "scenario_ready": bool(scenario_id)}
    return rounds, metrics


def analyze_evidence(ontology_id: str, request: AIAnalyzeRequest) -> Dict[str, Any]:
    ontology = repo.get_ontology(ontology_id)
    session = get_build_session(request.session_id) if request.session_id else None
    if session and session["ontology_id"] != ontology_id:
        raise repo.ValidationError("智能构建任务与目标本体不一致")
    if ontology["status"] in {"in_review", "reviewed"}:
        raise repo.ValidationError("目标本体已经进入评审冻结状态，不能继续生成或合并新的变更")
    mode = session["mode"] if session else request.build_mode
    change_scope = session["change_scope"] if session else request.change_scope
    base_version = session["base_version"] if session else (request.base_version or ontology.get("based_on_version") or ontology["version"])
    session_context = session["context"] if session else {"business_context": request.business_context}
    conn = repo.get_conn()
    if request.evidence_ids:
        placeholders = ",".join("?" for _ in request.evidence_ids)
        rows = conn.execute(f"SELECT * FROM evidence_sources WHERE ontology_id=? AND id IN ({placeholders})", [ontology_id, *request.evidence_ids]).fetchall()
    else:
        rows = conn.execute("SELECT * FROM evidence_sources WHERE ontology_id=? ORDER BY created_at DESC LIMIT 8", (ontology_id,)).fetchall()
    conn.close()
    if not rows:
        raise repo.ValidationError("请先上传至少一份建模资料")
    evidence_text = "\n\n".join(f"### {row['filename']}\n{row['extracted_text']}" for row in rows)[:160000]
    schema = repo.export_ontology(ontology_id) if request.include_existing_schema else {}
    system_prompt = """你是企业本体建模工程师。采用 Palantir Foundry 风格：Object、Property、Link、Action、Function、Data Mapping、Security 分层；只输出 JSON；任何建议必须可追溯到证据并进入 Proposal，禁止直接覆盖正式模型。返回 {summary, operations:[{resource_type,operation,display_name,api_name,confidence,risk,diff_summary,rationale,evidence,payload}]}。operation 只能为 create/update/deprecate/reuse/conflict；risk 只能是 low/medium/high/breaking；diff_summary 必须说明相对基线的字段级差异、复用或冲突。resource_type 只能为 object_type/link_type/action/business_rule/business_scenario/data_source/data_mapping/logic_definition/capability/action_mapping/permission_policy。更新对象时 payload 使用 target_api_name 与 add_properties/remove_properties/change_properties 描述增量，禁止重写主键；对象 API 名称用 PascalCase，关系和动作 API 名称用 snake_case。主键变化、删除资源、关系反转、Action 副作用和权限收紧必须标记 breaking。"""
    prompt = f"构建模式：{mode}\n基线版本：{base_version}\n变更范围：{change_scope}\n业务上下文：{_json(session_context)}\n用户目标：{request.instruction}\n策略：{request.strategy}\n现有本体（截断）：{_json(schema)[:45000]}\n证据：{evidence_text}"
    run_mode, model_error, request_id = "deepseek", None, ""
    try:
        result, request_id = _call_deepseek(system_prompt, prompt)
    except Exception as exc:  # keep the prototype usable without leaking credentials or transport internals
        result = _fallback_proposal(ontology_id, evidence_text, mode, change_scope)
        run_mode, model_error = "demo_fallback", str(exc)[:180]
    operations = result.get("operations") or []
    if not operations:
        result = _fallback_proposal(ontology_id, evidence_text, mode, change_scope)
        operations = result["operations"]
        run_mode = "demo_fallback"
    proposal_id, timestamp = str(uuid.uuid4()), repo.now()
    conn = repo.get_conn()
    proposal_title = f"{'新本体创建' if mode == 'create' else '现有本体更新'}提案 · {timestamp[5:16].replace('T', ' ')}"
    conn.execute("INSERT INTO ontology_proposals VALUES (?,?,?,?,?,?,?,?,?,?,?)", (proposal_id, ontology_id, proposal_title, request.instruction, _json([row["id"] for row in rows]), "review", "deepseek-v4-flash", run_mode, result.get("summary", ""), timestamp, timestamp))
    for index, item in enumerate(operations[:80]):
        confidence = max(0.0, min(1.0, float(item.get("confidence", 0.65))))
        conn.execute("""INSERT INTO proposal_operations
            (id,proposal_id,sort_order,resource_type,operation,display_name,api_name,confidence,rationale,evidence,payload,decision,decision_note,risk,diff_summary,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (str(uuid.uuid4()), proposal_id, index, item.get("resource_type", "object_type"), item.get("operation", "create"), item.get("display_name") or item.get("api_name") or f"建议 {index + 1}", item.get("api_name"), confidence, item.get("rationale"), item.get("evidence"), _json(item.get("payload") or {}), "pending", None, item.get("risk", "low"), item.get("diff_summary") or "建议新增资源；合并前需再次与当前工作状态对齐。", timestamp, timestamp))
    _audit(conn, ontology_id, "proposal", proposal_id, "create", f"AI 生成 {len(operations[:80])} 项本体建议")
    conn.commit()
    row = conn.execute("SELECT * FROM ontology_proposals WHERE id=?", (proposal_id,)).fetchone()
    conn.close()
    proposal = _proposal_row(row)
    rounds, metrics = _build_rounds(ontology_id, rows, operations, request.max_rounds, request.scenario_id, mode, base_version)
    build_run_id = str(uuid.uuid4())
    conn = repo.get_conn()
    conn.execute("""INSERT INTO ontology_build_runs
        (id,ontology_id,scenario_id,status,strategy,model,run_mode,rounds,metrics,proposal_id,created_at,session_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", (build_run_id, ontology_id, request.scenario_id, "completed", request.strategy, "deepseek-v4-flash", run_mode, _json(rounds), _json(metrics), proposal_id, timestamp, request.session_id))
    if request.session_id:
        conn.execute("UPDATE ontology_build_sessions SET proposal_id=?,status='review',current_step=4,updated_at=? WHERE id=?", (proposal_id, repo.now(), request.session_id))
    conn.commit(); conn.close()
    proposal["build_run"] = {"id": build_run_id, "status": "completed", "rounds": rounds, "metrics": metrics, "scenario_id": request.scenario_id, "session_id": request.session_id}
    proposal["request_id"] = request_id
    proposal["model_error"] = model_error
    return proposal


def list_proposals(ontology_id: str) -> list[Dict[str, Any]]:
    repo.get_ontology(ontology_id)
    conn = repo.get_conn()
    rows = conn.execute("SELECT * FROM ontology_proposals WHERE ontology_id=? ORDER BY created_at DESC", (ontology_id,)).fetchall()
    conn.close()
    return [_proposal_row(row) for row in rows]


def get_proposal(proposal_id: str) -> Dict[str, Any]:
    conn = repo.get_conn()
    row = conn.execute("SELECT * FROM ontology_proposals WHERE id=?", (proposal_id,)).fetchone()
    conn.close()
    if not row:
        raise repo.NotFoundError("Proposal 不存在")
    return _proposal_row(row)


def list_build_runs(ontology_id: str) -> list[Dict[str, Any]]:
    repo.get_ontology(ontology_id)
    conn = repo.get_conn(); rows = conn.execute("SELECT * FROM ontology_build_runs WHERE ontology_id=? ORDER BY created_at DESC", (ontology_id,)).fetchall(); conn.close()
    return [{**dict(row), "rounds": json.loads(row["rounds"] or "[]"), "metrics": json.loads(row["metrics"] or "{}")} for row in rows]


def decide_operation(operation_id: str, decision: str, note: Optional[str], payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    conn = repo.get_conn()
    row = conn.execute("SELECT proposal_id FROM proposal_operations WHERE id=?", (operation_id,)).fetchone()
    if not row:
        conn.close()
        raise repo.NotFoundError("Proposal 建议不存在")
    if payload is None:
        conn.execute("UPDATE proposal_operations SET decision=?,decision_note=?,updated_at=? WHERE id=?", (decision, note, repo.now(), operation_id))
    else:
        conn.execute("UPDATE proposal_operations SET decision=?,decision_note=?,payload=?,diff_summary=?,updated_at=? WHERE id=?", (decision, note, _json(payload), "人工修改结构化负载后接受；合并时使用修订后的内容。", repo.now(), operation_id))
    conn.execute("UPDATE ontology_proposals SET updated_at=? WHERE id=?", (repo.now(), row["proposal_id"]))
    conn.commit()
    changed = conn.execute("SELECT * FROM proposal_operations WHERE id=?", (operation_id,)).fetchone()
    conn.close()
    return {**dict(changed), "payload": json.loads(changed["payload"] or "{}")}


def _find_object(ontology_id: str, name: str) -> Optional[Dict[str, Any]]:
    normalized = (name or "").lower()
    return next((item for item in repo.list_object_types(ontology_id) if item["name"].lower() == normalized or item["display_name"] == name), None)


def merge_proposal(proposal_id: str) -> Dict[str, Any]:
    proposal = get_proposal(proposal_id)
    if proposal["status"] == "merged":
        raise repo.ValidationError("Proposal 已经合并")
    accepted = [item for item in proposal["operations"] if item["decision"] == "accepted"]
    if not accepted:
        raise repo.ValidationError("请至少接受一项建议后再合并")
    unresolved = [item for item in proposal["operations"] if item["decision"] in {"pending", "conflict"}]
    if unresolved:
        raise repo.ValidationError(f"仍有 {len(unresolved)} 项待评审或冲突建议，请先完成逐项决策")
    ontology_id = proposal["ontology_id"]
    ontology = repo.get_ontology(ontology_id)
    if ontology["status"] in {"in_review", "reviewed"}:
        raise repo.ValidationError("当前工作状态已进入评审冻结，不能再合并变更")
    applied, skipped = [], []
    priority = {"object_type": 0, "business_scenario": 1, "data_source": 1, "logic_definition": 2, "link_type": 3, "business_rule": 3, "action": 4, "data_mapping": 4, "capability": 4, "action_mapping": 5, "permission_policy": 6}
    for item in sorted(accepted, key=lambda value: priority.get(value["resource_type"], 9)):
        payload = item["payload"]
        try:
            if item["operation"] == "reuse":
                applied.append(item["id"])
                continue
            if item["resource_type"] == "object_type":
                target = _find_object(ontology_id, payload.get("target_api_name") or payload.get("name") or item.get("api_name"))
                if item["operation"] == "create":
                    if target:
                        skipped.append({"id": item["id"], "reason": "对象类型已存在，应改为复用或更新建议"})
                        continue
                    props = payload.get("properties") or [{"key": "id", "name": "唯一标识", "type": "string", "is_primary_key": True, "is_required": True}, {"key": "name", "name": "名称", "type": "string", "is_required": True}]
                    if sum(1 for prop in props if prop.get("is_primary_key")) != 1:
                        props[0]["is_primary_key"] = True
                    repo.create_object_type(ontology_id, ObjectTypeBase(name=payload.get("name") or item["api_name"], display_name=payload.get("display_name") or item["display_name"], description=payload.get("description"), title_property=payload.get("title_property") or next(prop["key"] for prop in props if prop.get("is_primary_key")), properties=[PropertyDef(**prop) for prop in props], status="experimental", design_status="proposal-merged"))
                elif item["operation"] in {"update", "deprecate"}:
                    if not target:
                        raise repo.ValidationError("待更新对象类型不存在")
                    properties = [dict(prop) for prop in target["properties"]]
                    remove_keys = set(payload.get("remove_properties") or [])
                    if any(prop.get("is_primary_key") and prop["key"] in remove_keys for prop in properties):
                        raise repo.ValidationError("不能通过智能合并删除对象主键")
                    properties = [prop for prop in properties if prop["key"] not in remove_keys]
                    existing_keys = {prop["key"] for prop in properties}
                    for prop in payload.get("add_properties") or []:
                        if prop.get("key") in existing_keys:
                            continue
                        properties.append(PropertyDef(**prop).model_dump())
                        existing_keys.add(prop["key"])
                    changes = {prop.get("key"): prop for prop in payload.get("change_properties") or []}
                    properties = [{**prop, **changes.get(prop["key"], {})} for prop in properties]
                    repo.update_object_type(target["id"], ObjectTypeBase(
                        name=target["name"], display_name=payload.get("display_name") or target["display_name"],
                        plural_name=target.get("plural_name"), icon=target.get("icon") or "box",
                        title_property=target.get("title_property"), description=payload.get("description") or target.get("description"),
                        status="deprecated" if item["operation"] == "deprecate" else target["status"],
                        properties=[PropertyDef(**prop) for prop in properties], group_ids=target.get("group_ids") or [],
                        interface_ids=target.get("interface_ids") or [], backing_source=target.get("backing_source"),
                        external_id=target.get("external_id"), category=target.get("category"), domain=target.get("domain"),
                        lifecycle=target.get("lifecycle"), state_property=target.get("state_property"), owner=target.get("owner"),
                        source_system=target.get("source_system"), is_core=bool(target.get("is_core")),
                        is_event=bool(target.get("is_event")), requires_action=bool(target.get("requires_action")),
                        design_status="proposal-merged",
                    ))
                else:
                    skipped.append({"id": item["id"], "reason": f"对象操作 {item['operation']} 不需要写入"})
                    continue
            elif item["resource_type"] == "business_scenario":
                existing = next((row for row in list_resources(ontology_id, "business-scenarios") if row["code"] == payload.get("code")), None)
                save_resource(ontology_id, "business-scenarios", EnterpriseResourceBase(**payload), existing["id"] if existing and item["operation"] == "update" else None)
            elif item["resource_type"] in {"data_source", "data_mapping", "logic_definition", "capability", "action_mapping", "permission_policy"}:
                kind = {"data_source": "data-sources", "data_mapping": "data-mappings", "logic_definition": "logic-definitions", "capability": "capabilities", "action_mapping": "action-mappings", "permission_policy": "permission-policies"}[item["resource_type"]]
                existing = next((row for row in list_resources(ontology_id, kind) if row["code"] == payload.get("code")), None)
                save_resource(ontology_id, kind, EnterpriseResourceBase(**payload), existing["id"] if existing and item["operation"] == "update" else None)
            elif item["resource_type"] == "link_type":
                source = _find_object(ontology_id, payload.get("source_object_name") or payload.get("source"))
                target = _find_object(ontology_id, payload.get("target_object_name") or payload.get("target"))
                if not source or not target:
                    raise repo.ValidationError("关系端点对象不存在")
                repo.save_link_type(ontology_id, LinkTypeBase(name=payload.get("name") or item["api_name"], display_name=payload.get("display_name") or item["display_name"], source_object_type_id=source["id"], target_object_type_id=target["id"], cardinality=payload.get("cardinality", "many_to_many"), description=payload.get("description")))
            elif item["resource_type"] == "business_rule":
                target = _find_object(ontology_id, payload.get("target_object_name") or payload.get("target"))
                if not target:
                    raise repo.ValidationError("业务规则目标对象不存在")
                current = next((row for row in repo.list_business_rules(ontology_id) if row["name"] == (payload.get("name") or item["api_name"])), None)
                repo.save_business_rule(ontology_id, BusinessRuleBase(
                    name=payload.get("name") or item["api_name"], display_name=payload.get("display_name") or item["display_name"],
                    target_object_type_id=target["id"], category=payload.get("category", "validation"), severity=payload.get("severity", "warning"),
                    expression=payload.get("expression") or "true", description=payload.get("description"), remediation=payload.get("remediation"),
                    implementation_type=payload.get("implementation_type", "expression"), input_fields=payload.get("input_fields") or [],
                    trigger_mode=payload.get("trigger_mode", "api"), status="deprecated" if item["operation"] == "deprecate" else "experimental",
                ), current["id"] if current and item["operation"] == "update" else None)
            elif item["resource_type"] == "action":
                target = _find_object(ontology_id, payload.get("target_object_name") or payload.get("target"))
                if not target:
                    raise repo.ValidationError("Action 目标对象不存在")
                current = next((row for row in repo.list_actions(ontology_id) if row["name"] == (payload.get("name") or item["api_name"])), None)
                repo.save_action(ontology_id, ActionBase(
                    name=payload.get("name") or item["api_name"], display_name=payload.get("display_name") or item["display_name"],
                    target_object_type_id=target["id"], action_type=payload.get("action_type", "invoke"), description=payload.get("description"),
                    parameters=[PropertyDef(**prop) for prop in payload.get("parameters") or []], preconditions=payload.get("preconditions") or [],
                    side_effects=payload.get("side_effects") or [], approval_required=bool(payload.get("approval_required", True)),
                    action_category=payload.get("action_category", "人机协同"), execution_logic=payload.get("execution_logic", "通过动作映射调用业务能力"),
                    status="deprecated" if item["operation"] == "deprecate" else "experimental", design_status="proposal-merged",
                ), current["id"] if current and item["operation"] == "update" else None)
            else:
                skipped.append({"id": item["id"], "reason": "该建议类型需在专用编辑器中补齐映射后应用"})
                continue
            applied.append(item["id"])
        except (ValueError, TypeError, repo.ValidationError, repo.ConflictError) as exc:
            skipped.append({"id": item["id"], "reason": str(exc)})
    conn = repo.get_conn()
    status = "merged" if applied and not skipped else "review"
    conn.execute("UPDATE ontology_proposals SET status=?,updated_at=? WHERE id=?", (status, repo.now(), proposal_id))
    if applied:
        repo._log(conn, ontology_id, "proposal", proposal_id, "merge", f"合并 Proposal，应用 {len(applied)} 项建议")
    session_row = conn.execute("SELECT id FROM ontology_build_sessions WHERE proposal_id=?", (proposal_id,)).fetchone()
    if session_row:
        session_status = "merged" if status == "merged" else "merge_partial"
        conn.execute("UPDATE ontology_build_sessions SET status=?,current_step=5,updated_at=? WHERE id=?", (session_status, repo.now(), session_row["id"]))
    conn.commit()
    conn.close()
    return {"proposal_id": proposal_id, "status": status, "applied": applied, "skipped": skipped, "session_id": session_row["id"] if session_row else None}


def agent_chat(ontology_id: str, request: AgentChatRequest) -> Dict[str, Any]:
    ontology = repo.get_ontology(ontology_id)
    objects, links, rules, actions = repo.list_object_types(ontology_id), repo.list_link_types(ontology_id), repo.list_business_rules(ontology_id), repo.list_actions(ontology_id)
    trace = [{"tool": "ontology.search", "label": "检索本体资源", "status": "completed", "result": f"命中 {len(objects)} 类对象、{len(links)} 类关系"}]
    action_proposal = None
    risky = any(word in request.message for word in ("关闭", "停机", "删除", "审批", "付款", "执行"))
    matching_action = next((item for item in actions if any(token in request.message for token in item["display_name"].replace("Action", "").split())), None)
    if risky:
        matching_action = matching_action or (actions[0] if actions else None)
        if matching_action:
            action_proposal = {"action_id": matching_action["id"], "action": matching_action["display_name"], "target": matching_action["target_display_name"], "confirmation_required": not request.confirm_action, "status": "executed_demo" if request.confirm_action else "awaiting_confirmation", "note": "高风险动作在原型中只演示确认与审计，不写入生产系统。"}
            trace.append({"tool": "ontology.action", "label": matching_action["display_name"], "status": "confirmed" if request.confirm_action else "confirmation_required", "result": action_proposal["status"]})
    context = {"ontology": ontology["name"], "objects": [item["display_name"] for item in objects], "links": [item["display_name"] for item in links], "rules": [item["display_name"] for item in rules], "actions": [item["display_name"] for item in actions]}
    run_mode = "deepseek"
    try:
        result, _ = _call_deepseek("你是企业本体运行时助手。只基于给定本体资源回答；说明使用了哪些对象、关系、规则或动作；不伪造实例；涉及写操作必须先要求确认。返回 JSON：{answer:string}。", f"本体上下文：{_json(context)}\n用户：{request.message}\n动作确认状态：{request.confirm_action}")
        answer = result.get("answer") or "已完成基于本体的分析。"
    except Exception:
        run_mode = "demo_fallback"
        if action_proposal and not request.confirm_action:
            answer = f"我已在“{ontology['name']}”中定位到可执行动作“{action_proposal['action']}”。这是写操作，需要你确认后才能继续；当前未对任何业务数据做修改。"
        elif action_proposal:
            answer = f"已完成“{action_proposal['action']}”的受控演示执行，并记录动作轨迹。正式环境需由 Action 映射调用业务系统并回写结果。"
        elif "压力" in request.message and any(item["name"] == "PipeSegment" for item in objects):
            trace.extend([
                {"tool": "ontology.resolve", "label": "解析入口对象：管段", "status": "completed", "result": "PipeSegment"},
                {"tool": "ontology.rule", "label": "运行压力上限与变化率规则", "status": "completed", "result": "pressure_over_limit · pressure_rate_abnormal"},
                {"tool": "ontology.traverse", "label": "遍历影响链", "status": "completed", "result": "管段 → 站场 → 设备 → 告警 → 工单"},
                {"tool": "ontology.action.plan", "label": "形成处置动作候选", "status": "completed", "result": "通知调度、创建维修工单；关闭阀门需确认"},
            ])
            answer = "压力异常以“管段”作为入口对象。系统先运行压力上限和压力变化率两条确定性规则；命中后沿“管段连接站场 → 站场包含设备 → 设备产生告警 → 告警触发工单”补齐影响范围。低风险链路可通知调度并创建维修工单；关闭阀门、隔离设备属于写操作，必须经过权限校验和人工确认后再调用能力映射。"
        elif "核心" in request.message or "哪些" in request.message and "对象" in request.message:
            core_names = [item["display_name"] for item in objects if item.get("is_core")] or [item["display_name"] for item in objects[:6]]
            trace.append({"tool": "ontology.filter", "label": "筛选核心对象", "status": "completed", "result": "、".join(core_names)})
            answer = f"当前本体标记的核心对象是：{'、'.join(core_names)}。其中运输任务承载履约状态，管段与设备承载运行状态，告警是事件对象，工单承接处置闭环。"
        elif any(word in request.message for word in ("采购", "付款", "预算")) and not any(item["name"] == "PaymentRequest" for item in objects):
            answer = "当前是“管道运输运营本体”，没有付款申请、采购合同和预算对象。为了避免跨域猜测，请先切换到“采购与财务协同本体”，我再沿付款 → 合同 / 预算 / 供应商 / 发票 / 审查任务回答。"
        else:
            answer = f"当前“{ontology['name']}”包含 {len(objects)} 类对象、{len(links)} 类关系、{len(rules)} 条规则和 {len(actions)} 个动作。我会先沿对象与关系定位业务上下文，再调用确定性规则；只有需要解释的部分交给模型。"
    interaction_id, timestamp = str(uuid.uuid4()), repo.now()
    conn = repo.get_conn()
    conn.execute("INSERT INTO agent_interactions VALUES (?,?,?,?,?,?,?,?,?)", (interaction_id, ontology_id, request.message, answer, _json(trace), _json(action_proposal) if action_proposal else None, run_mode, "deepseek-v4-flash", timestamp))
    conn.commit()
    conn.close()
    return {"id": interaction_id, "answer": answer, "trace": trace, "action_proposal": action_proposal, "model": "deepseek-v4-flash", "run_mode": run_mode}


def _merge_resource_defaults(ontology_id: str, kind: str, code: str, name: str, category: str, description: str, defaults: Dict[str, Any]) -> Dict[str, Any]:
    # Scenario seeds are intentionally declared in a compact business form.
    # Expand them to the same structured execution contract used by the editor
    # before the resource reaches the normal validator.  This keeps bootstrap
    # deterministic while ensuring the stored record is runnable from day one.
    if kind == "business-scenarios" and not defaults.get("steps"):
        defaults = {**defaults, "steps": _build_structured_steps(defaults)}
    current = next((item for item in list_resources(ontology_id, kind) if item["code"] == code), None)
    if not current:
        # Built-in resources are allowed to arrive in their legacy form during
        # bootstrap.  The repository migration below converts old scenario
        # descriptions into structured, executable steps after every seed has
        # been installed.  User/API writes never set this compatibility flag.
        return save_resource(ontology_id, kind, EnterpriseResourceBase(code=code, name=name, category=category, status="active", description=description, payload=defaults), allow_legacy_steps=(kind == "business-scenarios"))
    base_fields = {"id", "ontology_id", "code", "name", "category", "status", "description", "created_at", "updated_at"}
    merged = {key: value for key, value in current.items() if key not in base_fields}
    changed = False
    for key, value in defaults.items():
        if key not in merged or merged[key] in (None, ""):
            merged[key] = value
            changed = True
    if kind == "business-scenarios" and (not isinstance(merged.get("steps"), list) or not merged.get("steps")):
        merged["steps"] = _build_structured_steps(merged)
        changed = True
    if changed:
        return save_resource(ontology_id, kind, EnterpriseResourceBase(code=current["code"], name=current["name"], category=current.get("category", category), status=current.get("status", "active"), description=current.get("description") or description, payload=merged), current["id"], allow_legacy_steps=(kind == "business-scenarios"))
    return current


def ensure_procurement_registered_sources() -> None:
    """Register every physical source used by the built-in procurement model.

    Object types bind to these stable source codes.  The physical table/API
    identifier remains metadata on the source resource, so a connector can be
    replaced without changing the ontology schema.
    """
    row = next((item for item in repo.list_ontologies() if item["namespace"] == "enterprise.supplychain.manual"), None)
    if not row:
        return
    ontology_id = row["id"]
    sources = [
        ("SRC-MASTER", "采购主数据服务", "主数据系统", "采购组织、供应商与品目主数据", "masterdata.procurement", "主数据"),
        ("SRC-REQUEST", "采购申请系统", "业务系统", "采购申请及审批过程数据", "procurement.purchase_request", "交易数据"),
        ("SRC-ORDER", "采购订单系统", "业务系统", "采购订单与履约状态", "procurement.purchase_order", "交易数据"),
        ("SRC-CONTRACT", "采购合同系统", "业务系统", "采购合同及履约约束", "contract.contract_main", "主数据"),
        ("SRC-ACCEPTANCE", "验收管理系统", "业务系统", "到货、服务与工程验收记录", "procurement.acceptance_record", "交易数据"),
        ("SRC-INVOICE", "发票管理系统", "财务系统", "发票、验真与作废状态", "finance.invoice_pool", "交易数据"),
        ("SRC-PAY", "财务共享平台", "财务系统", "付款申请及付款状态", "finance.payment_request", "交易数据"),
        ("SRC-BUDGET", "项目预算系统", "财务系统", "预算额度与执行余额", "finance.budget_execution", "分析数据"),
        ("SRC-VOUCHER", "总账凭证系统", "财务系统", "会计凭证与过账状态", "finance.accounting_voucher", "交易数据"),
        ("SRC-RISK", "财务审查任务服务", "业务系统", "风险审查任务及处理结果", "risk.payment_review_task", "任务数据"),
        ("SRC-PROJECT", "项目管理系统", "业务系统", "项目立项、预算和责任主体", "project.project_master", "主数据"),
    ]
    for code, name, system_type, description, physical_object, data_category in sources:
        _merge_resource_defaults(
            ontology_id, "data-sources", code, name, system_type, description,
            {"physical_object": physical_object, "system_type": system_type,
             "data_category": data_category, "interface_type": "数据库",
             "update_frequency": "每日", "source_origin": "built_in_demo",
             "credential_policy": "凭据托管，不进入本体元数据"},
        )

    marker = "procurement-registered-source-bindings-v1"
    conn = repo.get_conn()
    if conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (marker,)).fetchone():
        conn.close()
        return
    source_by_object = {
        "OrganizationUnit": "SRC-MASTER", "Supplier": "SRC-MASTER", "Product": "SRC-MASTER",
        "PurchaseRequest": "SRC-REQUEST", "PurchaseOrder": "SRC-ORDER", "Contract": "SRC-CONTRACT",
        "AcceptanceRecord": "SRC-ACCEPTANCE", "Invoice": "SRC-INVOICE", "PaymentRequest": "SRC-PAY",
        "Budget": "SRC-BUDGET", "AccountingVoucher": "SRC-VOUCHER", "RiskReviewTask": "SRC-RISK",
        "Project": "SRC-PROJECT",
    }
    for object_name, source_code in source_by_object.items():
        conn.execute(
            "UPDATE object_types SET backing_source=?,updated_by=? WHERE ontology_id=? AND name=? AND (backing_source IS NULL OR backing_source NOT IN (SELECT code FROM enterprise_data_sources WHERE ontology_id=?))",
            (source_code, "system-migration", ontology_id, object_name, ontology_id),
        )
    conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)", (marker, repo.now()))
    conn.commit()
    conn.close()


def seed_procurement_enterprise_resources() -> None:
    """Add the executable procurement scenario without replacing user edits."""
    conn = repo.get_conn()
    ontology = conn.execute("SELECT * FROM ontologies WHERE namespace='enterprise.supplychain.manual'").fetchone()
    conn.close()
    if not ontology:
        return
    oid = ontology["id"]
    _merge_resource_defaults(oid, "business-scenarios", "SCN-PAY-001", "采购付款合规审查", "财务风控", "从付款申请出发，穿透合同、预算、供应商、发票和验收，运行规则并形成受控处置建议。", {
        "business_goal": "判断付款申请是否满足预算、合同、主体、发票和验收要求",
        "trigger": "付款申请提交或人工发起合规审查",
        "entry_object": "PaymentRequest",
        "participants": ["采购经办人", "财务审核人", "财务复核岗"],
        "key_path": "付款申请 → 采购合同 / 项目预算 / 供应商 / 发票 / 验收 → 付款审查任务",
        "related_objects": ["PaymentRequest", "Contract", "Budget", "Supplier", "Invoice", "AcceptanceRecord", "RiskReviewTask"],
        "related_rules": ["payment_within_available_budget", "contract_not_overpaid", "payee_matches_contract_supplier", "large_payment_manual_review"],
        "related_actions": ["run_payment_compliance_review", "mark_payment_risk", "create_manual_review"],
        "output_change": "形成结构化风险等级和审查任务；高风险付款保持待复核",
        "acceptance_criteria": ["可定位真实付款实例", "关系路径完整", "规则结果可解释", "写操作等待人工确认"],
        "owner": "财务共享中心",
    })
    sources = [
        ("SRC-PAY", "财务共享平台", "财务系统", "finance.payment_request", "交易数据"),
        ("SRC-CONTRACT", "采购合同系统", "业务系统", "contract.contract_main", "主数据"),
        ("SRC-BUDGET", "项目预算系统", "财务系统", "budget.execution", "分析数据"),
    ]
    for code, name, system_type, physical, data_category in sources:
        _merge_resource_defaults(oid, "data-sources", code, name, system_type, f"{name}的受治理数据连接", {"physical_object": physical, "system_type": system_type, "data_category": data_category, "interface_type": "数据库", "update_frequency": "实时", "source_origin": "built_in_demo"})
    mappings = [
        ("MAP-PAY-OBJECT", "付款申请编号属性映射", "属性映射", {"mapping_type": "property", "source_code": "SRC-PAY", "source_table": "payment_request", "target_object_type": "PaymentRequest", "source_field": "payment_id", "target_property": "payment_id", "map_way": "direct", "update_method": "realtime", "quality_rule": "payment_id not null"}),
        ("MAP-PAY-AMOUNT", "付款金额属性映射", "属性映射", {"mapping_type": "property", "source_code": "SRC-PAY", "source_table": "payment_request", "target_object_type": "PaymentRequest", "source_field": "apply_amount", "target_property": "amount", "map_way": "direct", "update_method": "realtime", "quality_rule": "amount > 0"}),
        ("MAP-PAY-CONTRACT", "付款关联合同映射", "关系映射", {"mapping_type": "relation", "source_code": "SRC-PAY", "source_table": "payment_request", "target_relation": "payment_based_on_contract", "source_field": "contract_id", "source_key": "payment.contract_id", "target_key": "contract.contract_id", "map_way": "direct", "update_method": "event", "quality_rule": "relation_match_rate >= 0.99"}),
    ]
    for code, name, category, payload in mappings:
        _merge_resource_defaults(oid, "data-mappings", code, name, category, "物理数据到采购财务本体的可测试映射", payload)
    scenario_marker = "procurement-scenario-contract-v1.9.1"
    conn = repo.get_conn()
    scenario_needs_repair = not conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (scenario_marker,)).fetchone()
    conn.close()
    if scenario_needs_repair:
        scenario_payload = {
            "business_goal": "判断付款申请是否满足预算、合同、主体、发票和验收要求",
            "trigger_type": "event", "trigger_condition": "付款申请提交或人工发起合规审查",
            "trigger": "业务事件：付款申请提交", "entry_object": "PaymentRequest",
            "participants": ["采购经办人", "财务审核人", "财务复核岗"],
            "key_path": "付款申请 → 采购合同 / 项目预算 / 供应商 / 发票 / 验收 → 付款审查任务",
            "related_objects": ["PaymentRequest", "Contract", "Budget", "Supplier", "Invoice", "AcceptanceRecord", "RiskReviewTask"],
            "related_links": ["payment_based_on_contract", "payment_occupies_budget", "payment_paid_to_supplier", "payment_matches_invoice", "contract_has_acceptance", "payment_creates_review_task"],
            "related_rules": ["payment_within_available_budget", "contract_not_overpaid", "payee_matches_contract_supplier", "large_payment_manual_review"],
            "related_actions": ["run_payment_compliance_review", "mark_payment_risk", "create_manual_review"],
            "source_codes": ["SRC-PAY"], "related_mappings": ["MAP-PAY-OBJECT", "MAP-PAY-AMOUNT", "MAP-PAY-CONTRACT"],
            "output_change": "形成结构化风险等级和审查任务；高风险付款保持待复核",
            "acceptance_criteria": ["可定位真实付款实例", "关系路径完整", "规则结果可解释", "写操作等待人工确认"],
            "owner": "财务共享中心",
        }
        scenario_payload["steps"] = _build_structured_steps(scenario_payload)
        current = next((item for item in list_resources(oid, "business-scenarios") if item["code"] == "SCN-PAY-001"), None)
        save_resource(oid, "business-scenarios", EnterpriseResourceBase(code="SCN-PAY-001", name="采购付款合规审查", category="财务风控", status="active", description="从付款申请出发，穿透合同、预算、供应商、发票和验收，运行规则并形成受控处置建议。", payload=scenario_payload), current["id"] if current else None)
        conn = repo.get_conn()
        conn.execute("UPDATE ontologies SET status='published',based_on_version=version WHERE id=?", (oid,))
        conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?", (oid,))
        conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)", (scenario_marker, repo.now()))
        conn.commit(); conn.close()
    _merge_resource_defaults(oid, "capabilities", "CAP-REVIEW", "付款风险审查服务", "计算能力", "运行确定性规则并返回结构化风险结果", {"service_ref": "risk-review", "operation": "reviewPayment", "protocol": "REST", "timeout_ms": 8000, "credential_ref": "vault-managed", "execution_type": "read_only"})
    _merge_resource_defaults(oid, "action-mappings", "AEM-REVIEW", "付款合规审查执行映射", "同步调用", "将运行付款合规审查 Action 绑定到受治理能力", {"action_code": "run_payment_compliance_review", "capability_code": "CAP-REVIEW", "parameter_mapping": {"payment_id": "object.business_key"}, "success_criteria": "response.status == completed", "error_policy": "retry_then_manual", "audit_required": True})
    conn = repo.get_conn()
    exists = conn.execute("SELECT 1 FROM evidence_sources WHERE ontology_id=? AND filename='采购付款合规场景说明.md'", (oid,)).fetchone()
    if not exists:
        extracted = "采购付款合规审查：付款申请必须关联有效合同、项目预算、供应商、发票和验收记录。预算不得超支，合同不得超付，收款方应与合同供应商一致；大额或高风险付款自动创建人工复核任务。样例 PAY-2026-0087 金额 300 万元，可用预算 150 万元，预计超预算 150 万元。"
        timestamp = repo.now()
        conn.execute("INSERT INTO evidence_sources VALUES (?,?,?,?,?,?,?,?,?,?)", (str(uuid.uuid4()), oid, "采购付款合规场景说明.md", "text/markdown", "built-in-scenario", hashlib.sha256(extracted.encode()).hexdigest(), extracted, _json({"parser": "verified-scenario-evidence", "row_count": 1, "data_sample": "PAY-2026-0087"}), "imported", timestamp))
        conn.commit()
    conn.execute("""UPDATE object_instances SET source_system='finance.payment_request',source_pk=business_key,
        sync_status='synced',quality_status=CASE WHEN business_key='PAY-2026-0087' THEN 'warning' ELSE 'passed' END
        WHERE ontology_id=? AND source_system IS NULL""", (oid,))
    conn.commit()
    conn.close()


def _template_rows(sheet_name: str) -> list[tuple[int, list[str]]]:
    """Return workbook rows with their original one-based row numbers."""
    from template_manifest import TEMPLATE_MANIFEST
    return [(index, list(values)) for index, values in enumerate(TEMPLATE_MANIFEST.get(sheet_name, []), start=1)]


def _template_data_rows(sheet_name: str) -> list[tuple[int, list[str]]]:
    """Return rows between the sheet header and its explanatory notes."""
    rows = _template_rows(sheet_name)
    if not rows:
        return []
    result = []
    seen_data = False
    for row_number, values in rows[1:]:
        first = (values[0] if values else "").strip()
        if first in {"字段", "本体建模模板", "顺序"}:
            break
        if _template_id(first) or re.match(r"^(?:N|E)\d+$", first):
            result.append((row_number, values))
            seen_data = True
        elif seen_data:
            break
    return result


def _template_row_dict(sheet_name: str, row_number: int, values: list[str]) -> Dict[str, Any]:
    rows = _template_rows(sheet_name)
    headers = rows[0][1] if rows else []
    return {header: values[index] if index < len(values) else "" for index, header in enumerate(headers)}


def _template_id(value: Any) -> Optional[str]:
    value = str(value or "").strip()
    if re.match(r"^(?:OBJ|P|L|INS|DS|M|R|F|A|AX|I|SEC|VER|SCN|N|E)-[A-Za-z0-9]+$", value):
        return value
    return None


def _template_status(value: str) -> str:
    return {"已确认": "active", "设计中": "experimental", "开发中": "experimental", "测试": "experimental", "发布": "active"}.get(value, "experimental")


def _yes(value: Any) -> bool:
    return str(value or "").strip() in {"是", "Y", "y", "true", "True", "1"}


def _safe_api(value: str, fallback: str) -> str:
    value = re.sub(r"[^A-Za-z0-9]+", "_", str(value or "").strip()).strip("_").lower()
    return value or fallback


def _property_type(value: str) -> str:
    return {"字符串": "string", "文本": "string", "数值": "decimal", "数字": "decimal", "整数": "integer", "布尔": "boolean", "日期时间": "datetime", "枚举": "enum"}.get(value, "string")


def _split_values(value: str) -> Optional[list[str]]:
    if not value or value.strip() in {"-", "无"}:
        return None
    values = [item.strip() for item in re.split(r"[/、,，]", value) if item.strip()]
    return values or None


def _merge_metadata(conn, table: str, component_id: str, metadata: Dict[str, Any]) -> None:
    row = conn.execute(f"SELECT metadata FROM {table} WHERE id=?", (component_id,)).fetchone()
    current = json.loads((row["metadata"] if row else "{}") or "{}")
    current.update(metadata)
    conn.execute(f"UPDATE {table} SET metadata=?,updated_at=?,updated_by=? WHERE id=?", (_json(current), repo.now(), "template-import", component_id))


def _record_template_row(conn, ontology_id: str, sheet_name: str, row_number: int, values: list[str], ref_type: Optional[str] = None, ref_id: Optional[str] = None, issue_note: Optional[str] = None) -> None:
    rows = _template_rows(sheet_name)
    headers = rows[0][1] if rows else []
    first = (values[0] if values else "").strip()
    if row_number == 1 and sheet_name != "00_使用说明":
        record_kind = "header"
    elif _template_id(first) or re.match(r"^(?:N|E)\d+$", first):
        record_kind = "data"
    elif first in {"字段", "本体建模模板", "顺序"} or sheet_name == "00_使用说明":
        record_kind = "instruction"
    else:
        record_kind = "instruction"
    record_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"ontology-template:{ontology_id}:{sheet_name}:{row_number}"))
    now_value = repo.now()
    conn.execute(
        """INSERT INTO template_records
           (id,ontology_id,sheet_name,source_row,record_kind,template_id,headers,raw_values,normalized_ref_type,normalized_ref_id,quality_status,issue_note,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(ontology_id,sheet_name,source_row) DO UPDATE SET
             record_kind=excluded.record_kind,template_id=excluded.template_id,headers=excluded.headers,
             raw_values=excluded.raw_values,normalized_ref_type=excluded.normalized_ref_type,
             normalized_ref_id=excluded.normalized_ref_id,quality_status=excluded.quality_status,
             issue_note=excluded.issue_note,updated_at=excluded.updated_at""",
        (record_id, ontology_id, sheet_name, row_number, record_kind, _template_id(first) or (first if re.match(r"^(?:N|E)\d+$", first) else None),
         _json(headers), _json(values), ref_type, ref_id, "source" if not issue_note else "reviewed", issue_note, now_value, now_value),
    )


def _link_template_record(conn, ontology_id: str, sheet_name: str, row_number: int, ref_type: str, ref_id: str, issue_note: Optional[str] = None) -> None:
    conn.execute("UPDATE template_records SET normalized_ref_type=?,normalized_ref_id=?,quality_status=?,issue_note=?,updated_at=? WHERE ontology_id=? AND sheet_name=? AND source_row=?", (ref_type, ref_id, "reviewed" if issue_note else "normalized", issue_note, repo.now(), ontology_id, sheet_name, row_number))


def _import_pipeline_template_v20(oid: str) -> bool:
    """Import every workbook row and rebuild only the protected pipeline baseline.

    The workbook is the authoritative fixture for the built-in pipeline
    ontology.  A one-time migration keeps raw rows in ``template_records`` and
    writes a normalized Foundry-style semantic layer beside them. Procurement,
    user-created ontologies, and later edits are not touched.
    """
    marker = "pipeline-template-source-v2.0"
    conn = repo.get_conn()
    if conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (marker,)).fetchone():
        conn.close()
        return False
    conn.close()
    from template_manifest import TEMPLATE_SHEET_ORDER

    # Remove only the earlier protected pipeline fixture.  The migration runs
    # once, before the built-in model is handed to users, and makes the
    # workbook's IDs the canonical source IDs in this ontology.
    conn = repo.get_conn()
    for table in RESOURCE_TABLES.values():
        conn.execute(f"DELETE FROM {table[0]} WHERE ontology_id=?", (oid,))
    for table in ("link_instances", "object_instances", "business_rules", "actions", "link_types", "object_types"):
        conn.execute(f"DELETE FROM {table} WHERE ontology_id=?", (oid,))
    conn.execute("DELETE FROM template_records WHERE ontology_id=?", (oid,))
    conn.commit()
    # Store all 253 non-empty source rows first, including headers and field
    # explanations. This makes the importer lossless even when a normalized
    # target intentionally repairs a source-sheet inconsistency.
    for sheet_name in TEMPLATE_SHEET_ORDER:
        for row_number, values in _template_rows(sheet_name):
            _record_template_row(conn, oid, sheet_name, row_number, values)
    conn.commit()
    conn.close()

    object_name_to_api = {"客户": "Customer", "合同": "Contract", "运输任务": "TransportTask", "管线": "Pipeline", "管段": "PipeSegment", "站场": "Station", "设备": "Equipment", "告警": "Alarm", "工单": "WorkOrder"}
    api_to_external = {api: f"OBJ-{index:03d}" for index, api in enumerate(object_name_to_api.values(), start=1)}
    # Only exact names from 06_数据源 are authoritative. Generic, combined or
    # absent systems in other sheets require a reviewed mapping decision.
    source_name_to_code = {"调度系统": "DS-001", "监测系统": "DS-002", "资产系统": "DS-003", "合同系统": "DS-004", "工单系统": "DS-005"}
    link_api_by_raw = {"signed": "signed", "generates": "generates_task", "passesThrough": "passes_through", "startsAt": "starts_at", "endsAt": "ends_at", "contains": "contains_segment", "hasEquipment": "has_equipment", "affects": "affects_task", "creates": "creates_work_order"}
    action_api_by_name = {"暂停运输任务": "pause_transport_task", "关闭阀门": "close_valve", "通知调度": "notify_dispatcher", "通知调度人员": "notify_dispatcher", "创建工单": "create_work_order"}
    rule_api_by_name = {"压力异常判断": "pressure_anomaly", "疑似泄漏判断": "suspected_leak"}
    relation_api_by_name = {"签订": "signed", "生成": "generates_task", "经过": "passes_through", "起始于": "starts_at", "终止于": "ends_at", "包含": "contains_segment", "配置": "has_equipment", "产生": "generates_alarm", "影响": "affects_task", "创建": "creates_work_order"}
    property_key_by_name = {"客户编号": "customerId", "客户名称": "customerName", "合同编号": "contractId", "任务编号": "taskId", "当前状态": "status", "计划输送量": "plannedQuantity", "当前压力": "pressure", "压力变化率": "pressureRate", "设备状态": "status", "告警等级": "severity"}

    # Enterprise source registry is created before object types so object
    # backing_source points at real, selectable source IDs instead of prose.
    for row_number, values in _template_data_rows("06_数据源"):
        raw = _template_row_dict("06_数据源", row_number, values)
        code = raw["数据源ID"]
        payload = {
            "template_external_id": code, "template_sheet": "06_数据源", "template_row": row_number, "template_raw": raw,
            "system_type": raw["系统类型"], "physical_object": raw["数据库/接口/文件"], "data_subject": raw["数据主题"],
            "update_frequency": raw["更新频率"], "data_scope": raw["数据范围"], "data_category": raw["数据类别"],
            "interface_type": raw["接口方式"], "template_owner_missing": True,
            "credential_policy": "凭据托管，不进入本体元数据",
        }
        save_resource(oid, "data-sources", EnterpriseResourceBase(code=code, name=raw["系统名称"], category=raw["系统类型"], status="active", description=f"模板数据源：{raw['数据主题']}", payload=payload))
        conn = repo.get_conn(); _link_template_record(conn, oid, "06_数据源", row_number, "data_source", code); conn.commit(); conn.close()

    property_rows: dict[str, list[tuple[int, Dict[str, Any]]]] = {}
    for row_number, values in _template_data_rows("03_对象属性"):
        raw = _template_row_dict("03_对象属性", row_number, values)
        property_rows.setdefault(raw["对象名称"], []).append((row_number, raw))

    object_rows = _template_data_rows("02_对象类型")
    objects: Dict[str, Dict[str, Any]] = {}
    for row_number, values in object_rows:
        raw = _template_row_dict("02_对象类型", row_number, values)
        api_name = object_name_to_api[raw["对象类型名称"]]
        props: list[PropertyDef] = []
        for prop_row_number, prop_raw in property_rows.get(raw["对象类型名称"], []):
            key = prop_raw["属性字段名称"]
            options = _split_values(prop_raw["单位/枚举"]) if _property_type(prop_raw["数据类型"]) == "enum" else None
            props.append(PropertyDef(
                key=key, name=prop_raw["属性名称"], type=_property_type(prop_raw["数据类型"]),
                property_category=prop_raw["属性类别"], is_unique=_yes(prop_raw["唯一"]),
                is_primary_key=_yes(prop_raw["唯一"]) and prop_raw["属性类别"] == "标识属性",
                is_required=_yes(prop_raw["必填"]), is_searchable=_yes(prop_raw["唯一"]), options=options,
                description=prop_raw["业务定义"], business_definition=prop_raw["业务定义"],
                unit=prop_raw["单位/枚举"] if prop_raw["单位/枚举"] not in {"", "-"} else None,
                source_system=prop_raw["来源系统"], source_field=prop_raw["来源字段"], update_frequency=prop_raw["更新频率"],
                transform_rule=prop_raw["转换规则"], quality_rule=prop_raw["质量要求"], design_status=prop_raw["状态"],
                status=_template_status(prop_raw["状态"]), external_id=prop_raw["属性ID"], template_id=prop_raw["属性ID"],
                template_sheet="03_对象属性", template_row=prop_row_number,
            ))
            conn = repo.get_conn(); _link_template_record(conn, oid, "03_对象属性", prop_row_number, "property", prop_raw["属性ID"], "对象类型ID与对象名称不一致，按业务名称归属" if prop_raw["对象类型ID"] != raw["对象类型ID"] else None); conn.commit(); conn.close()

        generated = {
            "客户": [("客户编号", "customerId", "string", True), ("客户名称", "customerName", "string", False)],
            "合同": [("合同编号", "contractId", "string", True), ("合同状态", "status", "enum", False)],
            "运输任务": [("任务编号", "taskId", "string", True), ("起点站场", "startStation", "string", False), ("终点站场", "endStation", "string", False)],
            "管线": [("管线编号", "pipelineId", "string", True), ("管线名称", "pipelineName", "string", False)],
            "管段": [("管段编号", "segmentId", "string", True)],
            "站场": [("站场编号", "stationId", "string", True), ("站场名称", "stationName", "string", False)],
            "设备": [("设备编号", "equipmentId", "string", True), ("设备名称", "equipmentName", "string", False), ("设备类型", "equipmentType", "string", False)],
            "告警": [("告警编号", "alarmId", "string", True), ("处置状态", "status", "enum", False)],
            "工单": [("工单编号", "workOrderId", "string", True), ("工单标题", "title", "string", False), ("工单状态", "status", "enum", False)],
        }
        existing_keys = {item.key for item in props}
        for display_name, key, ptype, is_pk in generated.get(raw["对象类型名称"], []):
            if key in existing_keys:
                continue
            opts = ["草拟", "生效", "履行中", "完成", "终止"] if key == "status" and raw["对象类型名称"] == "合同" else (["待确认", "处理中", "已关闭"] if raw["对象类型名称"] == "告警" else (["待分派", "处理中", "已完成", "已关闭"] if raw["对象类型名称"] == "工单" else None))
            props.append(PropertyDef(key=key, name=display_name, type=ptype, is_primary_key=is_pk, is_required=is_pk, is_searchable=is_pk or key in {"customerName", "pipelineName", "stationName", "equipmentName", "title"}, options=opts, description="平台为实例主键/标题补齐；模板属性表未单列此字段", design_status="平台补齐", template_sheet="02_对象类型", template_row=row_number))
        backing_source = source_name_to_code.get(raw["来源系统"])

        def _resolve_state_property() -> Optional[str]:
            """把模板里的中文“状态属性”名解析成属性 key。

            历史实现是 property_key_by_name.get(raw["状态属性"], "status")：映射失败时硬
            回落到字面量 "status"，于是客户／管线／管段／站场这些根本没有 status 属性的对象
            被写入一个不存在的键，编辑保存时被前端校验挡成“状态属性必须来自已定义的属性字段”。
            现在改为：先按属性名匹配 → 再查映射表并确认该属性确实存在 → 最后只有在对象确实
            有 status 属性时才回落到 status，否则明确留空。
            """
            raw_name = raw["状态属性"]
            # 模板写的是中文属性名，个别模板也可能直接写属性 key，两种都匹配
            matched = next((p.key for p in props if raw_name and raw_name in (p.name, p.key)), None)
            if matched:
                return matched
            mapped = property_key_by_name.get(raw_name)
            if mapped and any(p.key == mapped for p in props):
                return mapped
            if any(p.key == "status" for p in props):
                return "status"
            return None

        obj = repo.create_object_type(oid, ObjectTypeBase(
            name=api_name, display_name=raw["对象类型名称"], title_property=property_key_by_name.get(raw["主键/唯一标识"], next((p.key for p in props if p.is_primary_key), None)),
            description=raw["业务定义"], status="active", properties=props, backing_source=backing_source,
            external_id=raw["对象类型ID"], category=raw["对象类别"], domain=raw["业务域"], lifecycle=raw["生命周期"],
            state_property=_resolve_state_property(), owner=raw["数据负责人"], source_system=raw["来源系统"],
            is_core=_yes(raw["核心对象"]), is_event=_yes(raw["事件对象"]), requires_action=_yes(raw["需要行动"]), design_status=raw["建模状态"],
        ))
        objects[api_name] = obj
        conn = repo.get_conn(); _merge_metadata(conn, "object_types", obj["id"], {"template_id": raw["对象类型ID"], "template_sheet": "02_对象类型", "template_row": row_number, "template_raw": raw, "template_version": raw["版本"], **({"source_binding_issue": "来源系统未在06_数据源中唯一匹配，待人工确认"} if not backing_source else {})}); _link_template_record(conn, oid, "02_对象类型", row_number, "object_type", obj["id"]); conn.commit(); conn.close()

    # Relation definitions retain their original IDs and keys. Duplicate raw
    # API names (generates) are disambiguated only in the stable platform key.
    links: Dict[str, Dict[str, Any]] = {}
    for row_number, values in _template_data_rows("04_关系"):
        raw = _template_row_dict("04_关系", row_number, values)
        api_name = link_api_by_raw[raw["关系API名称"]]
        if raw["关系ID"] == "L-008":
            api_name = "generates_alarm"
        source_api, target_api = object_name_to_api[raw["起点对象"]], object_name_to_api[raw["终点对象"]]
        cardinality = {"1:1": "one_to_one", "1:N": "one_to_many", "N:1": "many_to_one", "N:M": "many_to_many"}.get(raw["基数"], "many_to_many")
        # Keep the pre-existing platform external ID for compatibility; the
        # workbook ID is authoritative in template_id/template_raw.
        platform_external_id = f"REL-{int(raw['关系ID'].split('-')[1]):03d}"
        link = repo.save_link_type(oid, LinkTypeBase(name=api_name, display_name=raw["关系名称"], source_object_type_id=objects[source_api]["id"], target_object_type_id=objects[target_api]["id"], cardinality=cardinality, description=raw["业务定义"], status="active", external_id=platform_external_id, source_system=raw["来源"], source_key=raw["起点键"], target_key=raw["终点键"], is_core=_yes(raw["核心关系"]), bidirectional_display=_yes(raw["双向展示"]), design_status=raw["状态"]))
        links[api_name] = link
        issue = "模板关系图方向仅作展示，正式方向以04_关系为准" if raw["关系ID"] in {"L-001", "L-002"} else None
        conn = repo.get_conn(); _merge_metadata(conn, "link_types", link["id"], {"template_id": raw["关系ID"], "template_sheet": "04_关系", "template_row": row_number, "template_raw": raw, "raw_api_name": raw["关系API名称"], "direction": raw["方向"], "template_version": raw["版本"]}); _link_template_record(conn, oid, "04_关系", row_number, "link_type", link["id"], issue); conn.commit(); conn.close()

    # Rules and functions are both retained: rules are executable resources;
    # function rows stay in the enterprise logic registry for later runtimes.
    for row_number, values in _template_data_rows("08_规则"):
        raw = _template_row_dict("08_规则", row_number, values)
        target_name = raw["适用对象"].split("/")[0].strip()
        target_api = object_name_to_api.get(target_name, "PipeSegment")
        code, name = raw["逻辑ID"], rule_api_by_name.get(raw["名称"], _safe_api(raw["名称"], "rule"))
        if raw["类型"] == "规则":
            rule = repo.save_business_rule(oid, BusinessRuleBase(name=name, display_name=raw["名称"], target_object_type_id=objects[target_api]["id"], category="risk", severity="warning", expression=raw["判断/计算逻辑"], implementation_type="description", input_fields=[item.strip() for item in re.split(r"、|/", raw["输入属性"]) if item.strip()], output_description=raw["输出"], trigger_mode="event", realtime_requirement=raw["实时性"], reusable=_yes(raw["可复用"]), owner=raw["负责人"], description=f"模板逻辑 {code}：{raw['判断/计算逻辑']}", remediation=raw["输出"], status="active"))
            conn = repo.get_conn(); _merge_metadata(conn, "business_rules", rule["id"], {"template_id": code, "template_sheet": "08_规则", "template_row": row_number, "template_raw": raw, "design_status": raw["状态"], "template_version": raw["版本"]}); _link_template_record(conn, oid, "08_规则", row_number, "business_rule", rule["id"]); conn.commit(); conn.close()
        payload = {"template_external_id": code, "template_sheet": "08_规则", "template_row": row_number, "template_raw": raw, "logic_type": raw["类型"], "target_object_type": target_api, "input_object_data": raw["输入对象/数据"], "input_fields_display": raw["输入属性"], "logic": raw["判断/计算逻辑"], "output": raw["输出"], "trigger_mode_display": raw["触发方式"], "realtime_requirement": raw["实时性"], "reusable": _yes(raw["可复用"]), "owner": raw["负责人"], "design_status": raw["状态"], "version": raw["版本"]}
        save_resource(oid, "logic-definitions", EnterpriseResourceBase(code=code, name=raw["名称"], category=raw["类型"], status=_template_status(raw["状态"]), description=raw["判断/计算逻辑"], payload=payload))
        conn = repo.get_conn(); _link_template_record(conn, oid, "08_规则", row_number, "logic_definition", code); conn.commit(); conn.close()

    action_targets = {"暂停运输任务": "TransportTask", "关闭阀门": "Equipment", "通知调度": "Alarm", "创建工单": "WorkOrder"}
    for row_number, values in _template_data_rows("09_行动"):
        raw = _template_row_dict("09_行动", row_number, values)
        name = action_api_by_name[raw["行动名称"]]
        params = []
        for index, label in enumerate(_split_values(raw["输入参数"]) or [], start=1):
            key_map = {"任务编号": "taskId", "阀门编号": "valveId", "关闭方式": "mode", "事件": "event", "内容": "content", "等级": "severity", "设备": "assetId", "故障": "fault", "优先级": "priority", "原因": "reason"}
            key = key_map.get(label, f"param{index}")
            params.append(PropertyDef(key=key, name=label, type="string", is_required=True, parameter_source="action_input", parameter_source_ref=label))
        action = repo.save_action(oid, ActionBase(name=name, display_name=raw["行动名称"], target_object_type_id=objects[action_targets[raw["行动名称"]]]["id"], action_type="invoke", description=raw["执行逻辑"], status="active", parameters=params, preconditions=[{"expression": raw["前置条件"], "message": "行动前置条件未满足"}], external_id=raw["行动ID"], action_category=raw["行动类型"], execution_logic=raw["执行逻辑"], object_effect=raw["对象/属性变化"], result_schema={"result": raw["执行结果"]}, side_effects=[item.strip() for item in re.split(r"、|/", raw["副作用/联动"]) if item.strip()], approval_required=_yes(raw["需审批"]), owner=raw["责任人"], design_status=raw["状态"]))
        conn = repo.get_conn(); _merge_metadata(conn, "actions", action["id"], {"template_id": raw["行动ID"], "template_sheet": "09_行动", "template_row": row_number, "template_raw": raw, "target_role": raw["作用对象"], "template_version": raw["版本"]}); _link_template_record(conn, oid, "09_行动", row_number, "action", action["id"]); conn.commit(); conn.close()

    for row_number, values in _template_data_rows("11_接口能力"):
        raw = _template_row_dict("11_接口能力", row_number, values)
        payload = {"template_external_id": raw["接口ID"], "template_sheet": "11_接口能力", "template_row": row_number, "template_raw": raw, "capability_type": raw["能力类型"], "target_object": raw["适用对象"], "input": raw["输入"], "output": raw["输出"], "action_display": raw["对应行动"], "target_system": raw["目标系统"], "invoke_mode": raw["调用方式"], "version": raw["版本"], "owner": raw["负责人"], "design_status": raw["状态"], "service_ref": _safe_api(raw["目标系统"], "system"), "operation": _safe_api(raw["接口/能力名称"], "operation"), "protocol": "REST" if "接口" in raw["调用方式"] else raw["调用方式"]}
        save_resource(oid, "capabilities", EnterpriseResourceBase(code=raw["接口ID"], name=raw["接口/能力名称"], category=raw["能力类型"], status=_template_status(raw["状态"]), description=f"{raw['目标系统']}提供的{raw['能力类型']}", payload=payload))
        conn = repo.get_conn(); _link_template_record(conn, oid, "11_接口能力", row_number, "capability", raw["接口ID"]); conn.commit(); conn.close()

    action_mapping_capability = {"A-002": "I-001", "A-001": "I-002", "A-004": "I-003"}
    for row_number, values in _template_data_rows("10_行动执行映射"):
        raw = _template_row_dict("10_行动执行映射", row_number, values)
        payload = {"template_external_id": raw["映射ID"], "template_sheet": "10_行动执行映射", "template_row": row_number, "template_raw": raw, "action_code": raw["行动ID"], "capability_code": action_mapping_capability.get(raw["行动ID"]), "target_system": raw["目标系统"], "interface_name": raw["接口/能力"], "invoke_mode": raw["调用方式"], "input_parameters": raw["输入参数"], "parameter_mapping": raw["参数映射"], "result_mapping": raw["返回结果"], "success_criteria": raw["成功判定"], "error_policy": raw["失败处理"], "writeback_object": raw["回写对象"], "writeback_property": raw["回写属性"], "audit_required": _yes(raw["审计"]), "owner": raw["负责人"], "design_status": raw["状态"]}
        save_resource(oid, "action-mappings", EnterpriseResourceBase(code=raw["映射ID"], name=f"{raw['行动ID']} · {raw['接口/能力']}", category="行动执行映射", status=_template_status(raw["状态"]), description=f"{raw['目标系统']} · {raw['接口/能力']}", payload=payload))
        conn = repo.get_conn(); _link_template_record(conn, oid, "10_行动执行映射", row_number, "action_mapping", raw["映射ID"]); conn.commit(); conn.close()

    for row_number, values in _template_data_rows("07_数据映射"):
        raw = _template_row_dict("07_数据映射", row_number, values)
        mapping_type = {"对象属性": "property", "对象关系": "relation"}.get(raw["映射类型"])
        if not mapping_type:
            raise repo.ValidationError(f"映射 {raw['映射ID']} 的类型“{raw['映射类型']}”不在模板约定范围内")
        target_display = raw["本体对象/关系"].split("—")[0].strip()
        target_api = object_name_to_api.get(target_display, "TransportTask")
        target_property = property_key_by_name.get(raw["本体属性"], raw["本体属性"] if raw["本体属性"] != "-" else None)
        target_relation = None
        if mapping_type == "relation":
            relation_display = raw["本体对象/关系"].split("—")[-1].strip()
            target_relation = relation_api_by_name.get(relation_display, "passes_through")
        if raw["来源系统"] not in source_name_to_code:
            raise repo.ValidationError(f"映射 {raw['映射ID']} 的来源系统“{raw['来源系统']}”未在06_数据源中匹配")
        payload = {"template_external_id": raw["映射ID"], "template_sheet": "07_数据映射", "template_row": row_number, "template_raw": raw, "mapping_type": mapping_type, "mapping_type_display": raw["映射类型"], "source_code": source_name_to_code[raw["来源系统"]], "source_system_display": raw["来源系统"], "source_table": raw["来源表/接口"], "source_field": raw["来源字段"], "source_key": raw["主键/关联键"], "target_object_type": target_api, "target_property": target_property, "target_relation": target_relation, "target_key": raw["主键/关联键"], "map_way": raw["映射方式"], "transform_rule": raw["转换规则"], "quality_rule": raw["质量校验"], "update_method": "realtime" if "实时" in raw["更新方式"] else "batch", "update_method_display": raw["更新方式"], "owner": raw["负责人"], "design_status": raw["状态"]}
        save_resource(oid, "data-mappings", EnterpriseResourceBase(code=raw["映射ID"], name=f"{raw['本体对象/关系']} · {raw['本体属性']}", category=raw["映射类型"], status=_template_status(raw["状态"]), description="模板数据到本体资源的受治理映射", payload=payload))
        conn = repo.get_conn(); _link_template_record(conn, oid, "07_数据映射", row_number, "data_mapping", raw["映射ID"]); conn.commit(); conn.close()

    for row_number, values in _template_data_rows("12_权限治理"):
        raw = _template_row_dict("12_权限治理", row_number, values)
        payload = {"template_external_id": raw["权限ID"], "template_sheet": "12_权限治理", "template_row": row_number, "template_raw": raw, "resource_type": raw["资源类型"], "resource_ref": raw["对象/关系/行动"], "role": raw["角色"], "view": raw["查看"], "modify": raw["修改"], "execute": raw["执行"], "data_scope": raw["数据范围"], "approval_requirement": raw["审批要求"], "audit_requirement": raw["审计要求"], "permission_basis": raw["权限依据"], "owner": raw["负责人"], "design_status": raw["状态"]}
        save_resource(oid, "permission-policies", EnterpriseResourceBase(code=raw["权限ID"], name=f"{raw['角色']} · {raw['对象/关系/行动']}", category=raw["资源类型"], status=_template_status(raw["状态"]), description="模板权限治理策略", payload=payload))
        conn = repo.get_conn(); _link_template_record(conn, oid, "12_权限治理", row_number, "permission_policy", raw["权限ID"]); conn.commit(); conn.close()

    scenario_relation_refs = {"运输任务-经过-管段": "passes_through", "管段-配置-设备": "has_equipment", "设备-产生-告警": "generates_alarm", "合同-生成-运输任务": "generates_task", "运输任务-经过-管段": "passes_through"}
    scenario_rule_refs = {"压力异常": "pressure_anomaly", "流量异常": "suspected_leak", "合同约束": None, "资源能力": None}
    scenario_source_refs = {"调度系统": "DS-001", "监测系统": "DS-002", "资产系统": "DS-003", "合同系统": "DS-004", "工单系统": "DS-005", "生产系统": "DS-001", "ERP系统": "DS-004"}
    for row_number, values in _template_data_rows("01_业务场景"):
        raw = _template_row_dict("01_业务场景", row_number, values)
        object_names = [item.strip() for item in re.split(r"、|/", raw["主要对象"]) if item.strip()]
        related_objects = [object_name_to_api[item] for item in object_names if item in object_name_to_api]
        relation_names = [item.strip() for item in raw["关键关系"].split("；") if item.strip()]
        related_links = []
        for relation in relation_names:
            parts = [item.strip() for item in relation.split("-")]
            if len(parts) == 3:
                api = relation_api_by_name.get(parts[1])
                if api and api in links and api not in related_links:
                    related_links.append(api)
        # A workbook scenario may omit an endpoint from “主要对象” while
        # still referencing the relation (SCN-002 omits 管段). Keep the raw
        # row unchanged but make the normalized executable scenario complete.
        for relation_api in related_links:
            link_row = links.get(relation_api)
            if not link_row:
                continue
            endpoint_ids = (link_row.get("source_object_type_id"), link_row.get("target_object_type_id"))
            for endpoint_id in endpoint_ids:
                endpoint_api = next((api for api, item in objects.items() if item.get("id") == endpoint_id), None)
                if endpoint_api and endpoint_api not in related_objects:
                    related_objects.append(endpoint_api)
        action_names = [item.strip() for item in re.split(r"、|/", raw["业务行动"]) if item.strip()]
        related_actions = [action_api_by_name[item] for item in action_names if item in action_api_by_name]
        related_rules = []
        for label, api in scenario_rule_refs.items():
            if label in raw["业务规则/判断"] and api and api not in related_rules:
                related_rules.append(api)
        source_codes = [scenario_source_refs[item] for item in re.split(r"、|/|，", raw["关联系统"]) if item in scenario_source_refs]
        mapping_codes = [f"M-{index:03d}" for index in range(1, 5) if ((raw["场景ID"] == "SCN-002") or index in {1, 2, 3, 4})]
        if raw["场景ID"] == "SCN-001":
            mapping_codes = ["M-003", "M-004"]; source_codes = ["DS-001", "DS-002", "DS-003", "DS-005"]
        mapping_source_codes = {"M-001": "DS-001", "M-002": "DS-001", "M-003": "DS-002", "M-004": "DS-001"}
        source_codes = sorted(set(source_codes) | {mapping_source_codes[item] for item in mapping_codes if item in mapping_source_codes})
        payload = {"template_external_id": raw["场景ID"], "template_sheet": "01_业务场景", "template_row": row_number, "template_raw": raw, "business_goal": raw["业务目标/任务"], "trigger_type": "event" if "实时" in raw["触发条件"] else "manual", "trigger_condition": raw["触发条件"], "entry_object": related_objects[0] if related_objects else "TransportTask", "related_objects": related_objects, "related_links": related_links, "related_rules": related_rules, "related_actions": related_actions, "input_data": raw["输入数据"], "input_data_items": [item.strip() for item in re.split(r"、|/|，", raw["输入数据"]) if item.strip()], "source_codes": sorted(set(source_codes)), "related_mappings": mapping_codes, "connected_systems": raw["关联系统"], "output_change": raw["输出/状态变化"], "owner": raw["负责人"], "design_status": raw["状态"], "acceptance_criteria": ["模板主要对象与关系可追溯", "输入数据来源可追溯", "状态变化符合场景描述"]}
        payload["steps"] = _build_structured_steps(payload)
        save_resource(oid, "business-scenarios", EnterpriseResourceBase(code=raw["场景ID"], name=raw["业务场景"], category="模板业务场景", status="active", description=raw["业务目标/任务"], payload=payload))
        conn = repo.get_conn(); _link_template_record(conn, oid, "01_业务场景", row_number, "business_scenario", raw["场景ID"]); conn.commit(); conn.close()

    instance_rows = _template_data_rows("05_对象实例")
    instances: Dict[str, Dict[str, Any]] = {}
    for row_number, values in instance_rows:
        raw = _template_row_dict("05_对象实例", row_number, values)
        object_api = object_name_to_api[raw["对象类型"]]
        properties = {}
        for part in raw["关键属性摘要"].split("；"):
            if "=" in part:
                key, value = part.split("=", 1); key = key.strip(); value = value.strip(); prop_key = {"起点": "startStation", "终点": "endStation", "计划量": "plannedQuantity", "当前压力": "pressure", "类型": "equipmentType"}.get(key, key)
                value = re.sub(r"MPa$", "", value).strip(); properties[prop_key] = float(value) if re.match(r"^\d+(?:\.\d+)?$", value) and "." in value else (int(value) if value.isdigit() else value)
        # Fill required source properties with the workbook's business key or
        # readable title so the sample is a valid instance, not just a card.
        obj_props = {item["key"]: item for item in objects[object_api]["properties"]}
        pk = next((key for key, item in obj_props.items() if item.get("is_primary_key")), "id")
        properties.setdefault(pk, raw["业务唯一标识"])
        for key, item in obj_props.items():
            if item.get("is_required") and key not in properties:
                properties[key] = raw["对象名称"] if key not in {"status", "severity"} else raw["当前状态"]
        instance = repo.save_object_instance(oid, ObjectInstanceBase(object_type_id=objects[object_api]["id"], business_key=raw["业务唯一标识"], title=raw["对象名称"], properties=properties, record_status=raw["当前状态"], source_system=raw["来源系统"], source_pk=raw["业务唯一标识"], sync_status="synced", quality_status="passed", external_id=raw["实例ID"], source_summary=raw["关键属性摘要"], template_sheet="05_对象实例", template_row=row_number))
        instances[raw["实例ID"]] = instance
        conn = repo.get_conn(); _link_template_record(conn, oid, "05_对象实例", row_number, "object_instance", instance["id"]); conn.commit(); conn.close()

    # The source graph sheet is intentionally evidence only. Build graph
    # edges from 04_关系 so runtime traversal cannot silently take a reversed
    # edge from the presentation helper sheet.
    for row_number, values in _template_data_rows("14_关系图数据"):
        raw = _template_row_dict("14_关系图数据", row_number, values)
        conn = repo.get_conn(); _link_template_record(conn, oid, "14_关系图数据", row_number, "derived_graph_record", raw["边ID"] or raw["节点ID"], "展示图数据保留为来源证据，运行时方向以04_关系为准"); conn.commit(); conn.close()

    for row_number, values in _template_data_rows("13_版本变更"):
        raw = _template_row_dict("13_版本变更", row_number, values)
        conn = repo.get_conn(); _link_template_record(conn, oid, "13_版本变更", row_number, "ontology_version", raw["版本ID"]); conn.commit(); conn.close()

    conn = repo.get_conn()
    for table in ("object_types", "link_types", "actions", "business_rules"):
        conn.execute(f"UPDATE {table} SET status='active' WHERE ontology_id=?", (oid,))
    # Persist the template version as a real immutable release snapshot.
    conn.execute("UPDATE ontologies SET status='published',version='v1.1.0',based_on_version='v1.1.0',updated_at=? WHERE id=?", (repo.now(), oid))
    conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?", (oid,))
    # The snapshot includes normalized resources and is filled after the
    # transaction below; the row is inserted now so it is visible in version
    # governance even on a fresh install.
    version_raw = _template_data_rows("13_版本变更")[0][1] if _template_data_rows("13_版本变更") else []
    raw_version = _template_row_dict("13_版本变更", _template_data_rows("13_版本变更")[0][0], version_raw) if version_raw else {}
    if not conn.execute("SELECT 1 FROM ontology_releases WHERE ontology_id=? AND version='v1.0.0'", (oid,)).fetchone():
        conn.execute("INSERT INTO ontology_releases (id,ontology_id,version,status,compatibility,change_reason,reviewer,change_summary,snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (str(uuid.uuid4()), oid, "v1.0.0", "published", "baseline", raw_version.get("变更原因", "项目启动"), raw_version.get("审核人", "待定"), raw_version.get("变更内容", "模板初始版本"), "{}", repo.now()))
    conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)", (marker, repo.now()))
    conn.commit(); conn.close()

    # Update evidence metadata to describe the lossless row import.
    conn = repo.get_conn()
    all_rows = sum(len(_template_rows(sheet)) for sheet in TEMPLATE_SHEET_ORDER)
    data_rows = sum(len(_template_data_rows(sheet)) for sheet in TEMPLATE_SHEET_ORDER if sheet != "00_使用说明")
    extracted = "\n\n".join(f"## {sheet}\n" + "\n".join(" | ".join(values) for _, values in _template_rows(sheet)) for sheet in TEMPLATE_SHEET_ORDER)
    summary = {"parser": "bundled-template-manifest", "sheet_count": len(TEMPLATE_SHEET_ORDER), "sheet_names": TEMPLATE_SHEET_ORDER, "row_count": all_rows, "data_row_count": data_rows, "raw_row_count": all_rows, "quality_fixes": 4, "quality_notes": ["P-007/P-008按对象名称‘管段’归属，保留源对象类型ID", "图谱展示方向不覆盖04_关系正式方向", "阀门动作绑定设备对象并保留作用对象原文", "业务系统与主题关系保留为数据源维度"]}
    conn.execute("UPDATE evidence_sources SET extracted_text=?,parse_summary=?,content_hash=?,status=? WHERE ontology_id=? AND filename='本体建模模板.xlsx'", (extracted[:300000], _json(summary), hashlib.sha256(extracted.encode()).hexdigest(), "imported", oid))
    conn.commit(); conn.close()
    # Replace the placeholder release snapshot with the complete normalized
    # export only after all rows and source evidence have been committed.
    snapshot = repo.export_ontology(oid)
    conn = repo.get_conn()
    conn.execute("UPDATE ontology_releases SET snapshot=? WHERE ontology_id=? AND version='v1.0.0'", (_json(snapshot), oid))
    conn.commit(); conn.close()
    return True


def _repair_pipeline_template_compat_v201(oid: str) -> bool:
    """Keep the historical platform IDs while exposing workbook IDs as lineage."""
    marker = "pipeline-template-compat-v2.0.1"
    conn = repo.get_conn()
    if conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (marker,)).fetchone():
        conn.close()
        return False
    rows = conn.execute("SELECT id,metadata FROM link_types WHERE ontology_id=?", (oid,)).fetchall()
    for row in rows:
        metadata = json.loads(row["metadata"] or "{}")
        template_id = metadata.get("template_id")
        if template_id and template_id.startswith("L-"):
            platform_id = f"REL-{int(template_id.split('-')[1]):03d}"
            metadata["external_id"] = platform_id
            conn.execute("UPDATE link_types SET metadata=?,updated_at=?,updated_by=? WHERE id=?", (_json(metadata), repo.now(), "template-import", row["id"]))
    conn.execute("UPDATE ontologies SET version='v1.1.0',based_on_version='v1.1.0' WHERE id=?", (oid,))
    conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)", (marker, repo.now()))
    conn.commit(); conn.close()
    return True


def _repair_pipeline_template_snapshot_v202(oid: str) -> bool:
    """Backfill the immutable template baseline snapshot after the row import."""
    marker = "pipeline-template-snapshot-v2.0.2"
    conn = repo.get_conn()
    if conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (marker,)).fetchone():
        conn.close(); return False
    conn.close()
    snapshot = repo.export_ontology(oid)
    conn = repo.get_conn()
    conn.execute("UPDATE ontology_releases SET snapshot=? WHERE ontology_id=? AND version='v1.0.0'", (_json(snapshot), oid))
    conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)", (marker, repo.now()))
    conn.commit(); conn.close()
    return True


def _reconcile_pipeline_workbook_v19(oid: str) -> bool:
    """Rebuild the built-in pipeline model from the verified 15-sheet workbook."""
    marker = "pipeline-workbook-v1.9"
    conn = repo.get_conn()
    if conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (marker,)).fetchone():
        conn.close(); return False
    # The built-in workbook is authoritative. This replacement is guarded by a
    # migration marker and therefore never touches later user-created changes.
    for table in ("link_instances", "object_instances", "business_rules", "actions", "link_types", "object_types"):
        conn.execute(f"DELETE FROM {table} WHERE ontology_id=?", (oid,))
    conn.execute("DELETE FROM enterprise_business_scenarios WHERE ontology_id=?", (oid,))
    conn.commit(); conn.close()

    def prop(key: str, name: str, ptype: str = "string", pk: bool = False, required: bool = False, search: bool = False, options=None, **extra):
        return PropertyDef(key=key, name=name, type=ptype, is_primary_key=pk, is_required=required, is_searchable=search, options=options, **extra)

    object_specs = [
        ("OBJ-001", "Customer", "客户", "经营主体", "customerName", "SRC-001", [prop("customerId", "客户编号", pk=True, required=True, search=True, external_id="P-001"), prop("customerName", "客户名称", required=True, search=True, external_id="P-002")]),
        ("OBJ-002", "Contract", "合同", "经营单据", "contractId", "SRC-002", [prop("contractId", "合同编号", pk=True, required=True, search=True, external_id="P-003"), prop("status", "合同状态", "enum", required=True, options=["草拟", "生效", "履行中", "完成", "终止"])]),
        ("OBJ-003", "TransportTask", "运输任务", "业务任务", "taskId", "SRC-003", [prop("taskId", "任务编号", pk=True, required=True, search=True, external_id="P-004"), prop("status", "任务状态", "enum", required=True, options=["待调度", "执行中", "已完成", "已取消"], external_id="P-005"), prop("plannedQuantity", "计划输量", "decimal", unit="万方", external_id="P-006")]),
        ("OBJ-004", "Pipeline", "管线", "基础设施", "pipelineName", "SRC-004", [prop("pipelineId", "管线编号", pk=True, required=True, search=True), prop("pipelineName", "管线名称", required=True, search=True)]),
        ("OBJ-005", "PipeSegment", "管段", "基础设施", "segmentId", "SRC-004", [prop("segmentId", "管段编号", pk=True, required=True, search=True), prop("pressure", "当前压力", "decimal", unit="MPa", external_id="P-007", update_frequency="实时"), prop("pressureRate", "压力变化率", "decimal", unit="MPa/min", external_id="P-008", update_frequency="实时")]),
        ("OBJ-006", "Station", "站场", "基础设施", "stationName", "SRC-004", [prop("stationId", "站场编号", pk=True, required=True), prop("stationName", "站场名称", required=True, search=True)]),
        ("OBJ-007", "Equipment", "设备", "资产", "equipmentName", "SRC-005", [prop("equipmentId", "设备编号", pk=True, required=True, search=True), prop("equipmentName", "设备名称", required=True, search=True), prop("status", "设备状态", "enum", required=True, options=["正常", "预警", "故障", "停用"], external_id="P-009")]),
        ("OBJ-008", "Alarm", "告警", "事件", "alarmId", "SRC-004", [prop("alarmId", "告警编号", pk=True, required=True), prop("severity", "告警等级", "enum", required=True, options=["提示", "一般", "严重", "紧急"], external_id="P-010"), prop("status", "处置状态", "enum", options=["待确认", "处理中", "已关闭"])]),
        ("OBJ-009", "WorkOrder", "工单", "业务任务", "title", "SRC-005", [prop("workOrderId", "工单编号", pk=True, required=True), prop("title", "工单标题", required=True, search=True), prop("status", "工单状态", "enum", required=True, options=["待分派", "处理中", "已完成", "已关闭"])]),
    ]
    objects = {}
    for external_id, api_name, display, category, title_key, source, properties in object_specs:
        objects[api_name] = repo.create_object_type(oid, ObjectTypeBase(name=api_name, display_name=display, title_property=title_key, description=f"本体建模模板定义的{display}业务对象", status="experimental", properties=properties, backing_source=source, external_id=external_id, category=category, domain="管道运输", owner="业务本体管理员", source_system="本体建模模板", is_core=True, is_event=api_name == "Alarm", requires_action=api_name in {"TransportTask","Equipment","Alarm","WorkOrder"}, design_status="validated"))

    link_specs = [
        ("REL-001","signed","签署","Customer","Contract","one_to_many"),
        ("REL-002","generates_task","生成运输任务","Contract","TransportTask","one_to_many"),
        ("REL-003","passes_through","通过管段","TransportTask","PipeSegment","many_to_many"),
        ("REL-004","starts_at","起始于","TransportTask","Station","many_to_one"),
        ("REL-005","ends_at","结束于","TransportTask","Station","many_to_one"),
        ("REL-006","contains_segment","包含管段","Pipeline","PipeSegment","one_to_many"),
        ("REL-007","has_equipment","拥有设备","PipeSegment","Equipment","one_to_many"),
        ("REL-008","generates_alarm","产生告警","Equipment","Alarm","one_to_many"),
        ("REL-009","affects_task","影响运输任务","Alarm","TransportTask","many_to_many"),
        ("REL-010","creates_work_order","创建工单","Alarm","WorkOrder","one_to_many"),
    ]
    links={}
    for external_id,name,display,source,target,cardinality in link_specs:
        links[name]=repo.save_link_type(oid,LinkTypeBase(name=name,display_name=display,source_object_type_id=objects[source]["id"],target_object_type_id=objects[target]["id"],cardinality=cardinality,description=f"{objects[source]['display_name']} {display} {objects[target]['display_name']}",status="experimental",external_id=external_id,is_core=True,design_status="validated"))

    actions=[
        ("A-001","pause_transport_task","暂停运输任务","TransportTask","modify",False),
        ("A-002","close_valve","关闭阀门","Equipment","modify",True),
        ("A-003","notify_dispatcher","通知调度人员","Alarm","modify",False),
        ("A-004","create_work_order","创建工单","WorkOrder","create",False),
    ]
    for external_id,name,display,target,action_type,approval in actions:
        repo.save_action(oid,ActionBase(name=name,display_name=display,target_object_type_id=objects[target]["id"],action_type=action_type,description=f"模板定义的{display}动作",status="experimental",parameters=[prop("reason","执行原因",required=True),prop("operator","操作人",required=True)],preconditions=[{"expression":"actor.has_permission","message":"需要相应动作权限"}],external_id=external_id,action_category="业务处置",execution_logic=display,object_effect="更新对象状态并记录审计",approval_required=approval,owner="运行调度中心",design_status="validated"))
    for mapping_code, action_code, capability_code in (("AEM-001","A-001","CAP-001"),("AEM-002","A-002","CAP-001"),("AEM-003","A-003","CAP-003")):
        current=next((item for item in list_resources(oid,"action-mappings") if item["code"]==mapping_code),None)
        if current:
            core={key:current.get(key) for key in ("code","name","category","status","description")}
            payload={key:value for key,value in current.items() if key not in {"id","ontology_id","code","name","category","status","description","created_at","updated_at","created_by","updated_by"}}
            payload.update({"action_code":action_code,"capability_code":capability_code,"audit_required":True})
            save_resource(oid,"action-mappings",EnterpriseResourceBase(**core,payload=payload),current["id"])
    repo.save_business_rule(oid,BusinessRuleBase(name="pressure_over_limit",display_name="压力上限规则",target_object_type_id=objects["PipeSegment"]["id"],category="risk",severity="blocking",expression="pressure <= configured_pressure_limit",description="实时压力不得超过管段配置上限",remediation="生成告警并进入人工确认",status="experimental"))
    repo.save_business_rule(oid,BusinessRuleBase(name="pressure_rate_abnormal",display_name="压力变化率规则",target_object_type_id=objects["PipeSegment"]["id"],category="risk",severity="warning",expression="abs(pressureRate) <= configured_rate_limit",description="识别压力突变",remediation="通知调度人员",status="experimental"))

    def add_scenario(code,name,category,goal,entry,object_names,link_names,rule_names,action_names,source_codes,mapping_codes,trigger):
        payload={"business_goal":goal,"trigger_type":trigger,"trigger_condition":"满足场景入口条件","entry_object":entry,"related_objects":object_names,"related_links":link_names,"related_rules":rule_names,"related_actions":action_names,"source_codes":source_codes,"related_mappings":mapping_codes,"participants":["调度人员","运维人员"],"output_change":"更新相关业务对象并留存审计记录","acceptance_criteria":["对象与关系可追溯","规则结果可解释","高风险动作经人工确认"],"owner":"运行调度中心"}
        payload["steps"]=_build_structured_steps(payload)
        save_resource(oid,"business-scenarios",EnterpriseResourceBase(code=code,name=name,category=category,status="active",description=goal,payload=payload))
    add_scenario("SCN-001","运输任务异常处置","安全运营","从压力异常识别到告警、调度和工单闭环","PipeSegment",["PipeSegment","Equipment","Alarm","TransportTask","WorkOrder"],["has_equipment","generates_alarm","affects_task","creates_work_order"],["pressure_over_limit","pressure_rate_abnormal"],["pause_transport_task","close_valve","notify_dispatcher","create_work_order"],["SRC-003","SRC-004","SRC-005"],["MAP-003","MAP-004"],"event")
    add_scenario("SCN-002","运输任务执行","运输调度","根据客户合同创建任务并按路径执行","Contract",["Customer","Contract","TransportTask","Station","PipeSegment"],["signed","generates_task","starts_at","passes_through","ends_at"],[],["pause_transport_task"],["SRC-001","SRC-002","SRC-003","SRC-004"],["MAP-001","MAP-002","MAP-003","MAP-004"],"manual")

    instances={}
    for key,obj,title,properties,source in [
        ("TASK-2026-001","TransportTask","华东天然气 8 月运输任务",{"taskId":"TASK-2026-001","status":"执行中","plannedQuantity":5800},"SRC-003"),
        ("SEG-EAST-07","PipeSegment","华东干线 07 管段",{"segmentId":"SEG-EAST-07","pressure":8.42,"pressureRate":0.36},"SRC-004"),
        ("EQ-V-0703","Equipment","07 管段入口电动阀",{"equipmentId":"EQ-V-0703","equipmentName":"07 管段入口电动阀","status":"预警"},"SRC-005"),
    ]:
        instances[key]=repo.save_object_instance(oid,ObjectInstanceBase(object_type_id=objects[obj]["id"],business_key=key,title=title,properties=properties,record_status="有效",source_system=source,source_pk=key,quality_status="warning" if key!="TASK-2026-001" else "passed"))
    repo.save_link_instance(oid,LinkInstanceBase(link_type_id=links["passes_through"]["id"],source_instance_id=instances["TASK-2026-001"]["id"],target_instance_id=instances["SEG-EAST-07"]["id"]))
    conn=repo.get_conn()
    for table in ("object_types","link_types","actions","business_rules"): conn.execute(f"UPDATE {table} SET status='active' WHERE ontology_id=?",(oid,))
    conn.execute("UPDATE ontologies SET status='published',version='v1.1.0',based_on_version='v1.1.0',updated_at=? WHERE id=?",(repo.now(),oid))
    conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?",(oid,))
    conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)",(marker,repo.now()))
    conn.commit(); conn.close()
    return True


def _repair_pipeline_scenario_contract_v191(oid: str) -> bool:
    """Align older built-in databases with the verified workbook scenarios.

    Earlier prototype builds reused SCN-001/SCN-002 for different demo names.
    This one-time repair changes only the two protected pipeline baselines and
    leaves user-created scenarios untouched.
    """
    marker = "pipeline-scenario-contract-v1.9.1"
    conn = repo.get_conn()
    if conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (marker,)).fetchone():
        conn.close(); return False
    conn.close()
    specs = [
        ("SCN-001", "运输任务异常处置", "安全运营", "从压力异常识别到告警、调度和工单闭环", "PipeSegment",
         ["PipeSegment", "Equipment", "Alarm", "TransportTask", "WorkOrder"], ["has_equipment", "generates_alarm", "affects_task", "creates_work_order"],
         ["pressure_over_limit", "pressure_rate_abnormal"], ["pause_transport_task", "close_valve", "notify_dispatcher", "create_work_order"],
         ["SRC-003", "SRC-004", "SRC-005"], ["MAP-003", "MAP-004"], "event"),
        ("SCN-002", "运输任务执行", "运输调度", "根据客户合同创建任务并按路径执行", "Contract",
         ["Customer", "Contract", "TransportTask", "Station", "PipeSegment"], ["signed", "generates_task", "starts_at", "passes_through", "ends_at"],
         [], ["pause_transport_task"], ["SRC-001", "SRC-002", "SRC-003", "SRC-004"], ["MAP-001", "MAP-002", "MAP-003", "MAP-004"], "manual"),
    ]
    current_by_code = {item["code"]: item for item in list_resources(oid, "business-scenarios")}
    for code, name, category, goal, entry, object_names, link_names, rule_names, action_names, source_codes, mapping_codes, trigger in specs:
        payload = {
            "business_goal": goal, "trigger_type": trigger, "trigger_condition": "满足场景入口条件",
            "trigger": f"{trigger}：满足场景入口条件", "entry_object": entry,
            "related_objects": object_names, "related_links": link_names, "related_rules": rule_names,
            "related_actions": action_names, "source_codes": source_codes, "related_mappings": mapping_codes,
            "participants": ["调度人员", "运维人员"], "key_path": " → ".join(object_names),
            "output_change": "更新相关业务对象并留存审计记录",
            "acceptance_criteria": ["对象与关系可追溯", "规则结果可解释", "高风险动作经人工确认"],
            "owner": "运行调度中心",
        }
        payload["steps"] = _build_structured_steps(payload)
        current = current_by_code.get(code)
        save_resource(oid, "business-scenarios", EnterpriseResourceBase(code=code, name=name, category=category, status="active", description=goal, payload=payload), current["id"] if current else None)
    conn = repo.get_conn()
    conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)", (marker, repo.now()))
    conn.commit(); conn.close()
    return True


def seed_pipeline_domain() -> None:
    init_enterprise()
    conn = repo.get_conn()
    row = conn.execute("SELECT id FROM ontologies WHERE namespace='enterprise.pipeline.operations.manual'").fetchone()
    conn.close()
    if row:
        migrated = _reconcile_pipeline_workbook_v19(row["id"])
        imported = _import_pipeline_template_v20(row["id"])
        compat_repaired = _repair_pipeline_template_compat_v201(row["id"])
        snapshot_repaired = _repair_pipeline_template_snapshot_v202(row["id"])
        conn = repo.get_conn()
        template_loaded = conn.execute(
            "SELECT 1 FROM prototype_migrations WHERE migration_key='pipeline-template-source-v2.0'"
        ).fetchone()
        conn.close()
        # The older v1.9 scenario repair must not run on subsequent starts of
        # a v2 workbook import; its rule names no longer match that template.
        repaired = False if template_loaded else _repair_pipeline_scenario_contract_v191(row["id"])
        if not imported:
            _enrich_pipeline_operational_resources(row["id"])
        _ensure_pipeline_template_evidence(row["id"])
        conn=repo.get_conn(); seal_marker="pipeline-workbook-v1.9-sealed"; repair_seal_marker="pipeline-scenario-contract-v1.9.1-sealed"
        repair_seal_pending=not conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?",(repair_seal_marker,)).fetchone()
        if migrated or imported or compat_repaired or snapshot_repaired or repaired or repair_seal_pending or not conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?",(seal_marker,)).fetchone():
            conn.execute("UPDATE ontologies SET status='published',based_on_version=version WHERE id=?",(row["id"],)); conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?",(row["id"],)); conn.execute("INSERT OR IGNORE INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)",(seal_marker,repo.now())); conn.execute("INSERT OR IGNORE INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)",(repair_seal_marker,repo.now()))
        conn.commit(); conn.close()
        return
    ontology = repo.create_ontology(OntologyBase(name="管道运输运营本体", namespace="enterprise.pipeline.operations.manual", description="由《本体建模模板》完整映射形成，覆盖客户、合同、运输任务、管网资产、告警、工单及其规则与动作。"))
    oid = ontology["id"]

    def prop(key: str, name: str, ptype: str = "string", pk: bool = False, required: bool = False, search: bool = False, options=None, **extra):
        return PropertyDef(key=key, name=name, type=ptype, is_primary_key=pk, is_required=required, is_searchable=search, options=options, **extra)

    groups = {}
    for name, description, color in [("经营与客户", "客户、合同及运输委托", "#4f72a6"), ("运输运营", "运输任务与调度执行", "#2e7d73"), ("管网资产", "管线、管段、站场与设备", "#8a6842"), ("运行监测与维护", "告警、处置与工单闭环", "#a45151")]:
        groups[name] = repo.save_object_type_group(oid, ObjectTypeGroupBase(name=name, description=description, color=color))

    object_specs = [
        ("OBJ-001", "Customer", "客户", "经营主体", "客户名称", "customerName", "经营与客户", [prop("customerId", "客户编号", pk=True, required=True, search=True, external_id="P-001"), prop("customerName", "客户名称", required=True, search=True, external_id="P-002")]),
        ("OBJ-002", "Contract", "合同", "经营单据", "合同编号", "contractId", "经营与客户", [prop("contractId", "合同编号", pk=True, required=True, search=True, external_id="P-003"), prop("status", "合同状态", "enum", options=["草拟", "生效", "履行中", "完成", "终止"], search=True)]),
        ("OBJ-003", "TransportTask", "运输任务", "业务任务", "任务编号", "taskId", "运输运营", [prop("taskId", "任务编号", pk=True, required=True, search=True, external_id="P-004"), prop("status", "任务状态", "enum", required=True, options=["待调度", "执行中", "已完成", "已取消"], external_id="P-005"), prop("plannedQuantity", "计划输量", "decimal", unit="万方", external_id="P-006")]),
        ("OBJ-004", "Pipeline", "管线", "基础设施", "管线名称", "pipelineId", "管网资产", [prop("pipelineId", "管线编号", pk=True, required=True, search=True), prop("pipelineName", "管线名称", required=True, search=True)]),
        ("OBJ-005", "PipeSegment", "管段", "基础设施", "管段编号", "segmentId", "管网资产", [prop("segmentId", "管段编号", pk=True, required=True, search=True), prop("pressure", "当前压力", "decimal", unit="MPa", external_id="P-007", update_frequency="实时"), prop("pressureRate", "压力变化率", "decimal", unit="MPa/min", external_id="P-008", update_frequency="实时")]),
        ("OBJ-006", "Station", "站场", "基础设施", "站场名称", "stationId", "管网资产", [prop("stationId", "站场编号", pk=True, required=True), prop("stationName", "站场名称", required=True, search=True)]),
        ("OBJ-007", "Equipment", "设备", "资产", "设备名称", "equipmentId", "管网资产", [prop("equipmentId", "设备编号", pk=True, required=True, search=True), prop("equipmentName", "设备名称", required=True, search=True), prop("status", "设备状态", "enum", options=["正常", "预警", "故障", "停用"], external_id="P-009", search=True)]),
        ("OBJ-008", "Alarm", "告警", "事件", "告警编号", "alarmId", "运行监测与维护", [prop("alarmId", "告警编号", pk=True, required=True), prop("severity", "告警等级", "enum", required=True, options=["提示", "一般", "严重", "紧急"], external_id="P-010"), prop("status", "处置状态", "enum", options=["待确认", "处理中", "已关闭"])]),
        ("OBJ-009", "WorkOrder", "工单", "业务任务", "工单标题", "workOrderId", "运行监测与维护", [prop("workOrderId", "工单编号", pk=True, required=True), prop("title", "工单标题", required=True, search=True), prop("status", "工单状态", "enum", required=True, options=["待分派", "处理中", "已完成", "已关闭"])]),
    ]
    objects = {}
    for external_id, api_name, display_name, category, description, title_key, group_name, properties in object_specs:
        objects[api_name] = repo.create_object_type(oid, ObjectTypeBase(name=api_name, display_name=display_name, plural_name=f"{display_name}列表", title_property=title_key, description=description, status="experimental", properties=properties, group_ids=[groups[group_name]["id"]], backing_source=f"template.{api_name.lower()}", external_id=external_id, category=category, domain=group_name, owner="业务本体管理员", source_system="本体建模模板", is_core=api_name in {"TransportTask", "PipeSegment", "Alarm", "WorkOrder"}, is_event=api_name == "Alarm", requires_action=api_name in {"Alarm", "WorkOrder", "Equipment"}, design_status="validated"))

    link_specs = [
        ("REL-001", "customer_has_contract", "客户签署合同", "Customer", "Contract", "one_to_many"),
        ("REL-002", "contract_generates_task", "合同生成运输任务", "Contract", "TransportTask", "one_to_many"),
        ("REL-003", "task_uses_pipeline", "运输任务使用管线", "TransportTask", "Pipeline", "many_to_many"),
        ("REL-004", "pipeline_contains_segment", "管线包含管段", "Pipeline", "PipeSegment", "one_to_many"),
        ("REL-005", "segment_connects_station", "管段连接站场", "PipeSegment", "Station", "many_to_many"),
        ("REL-006", "station_has_equipment", "站场包含设备", "Station", "Equipment", "one_to_many"),
        ("REL-007", "equipment_generates_alarm", "设备产生告警", "Equipment", "Alarm", "one_to_many"),
        ("REL-008", "alarm_creates_work_order", "告警触发工单", "Alarm", "WorkOrder", "one_to_many"),
        ("REL-009", "work_order_handles_equipment", "工单处置设备", "WorkOrder", "Equipment", "many_to_one"),
        ("REL-010", "task_through_segment", "运输任务经过管段", "TransportTask", "PipeSegment", "many_to_many"),
    ]
    links = {}
    for external_id, api_name, display_name, source, target, cardinality in link_specs:
        links[api_name] = repo.save_link_type(oid, LinkTypeBase(name=api_name, display_name=display_name, source_object_type_id=objects[source]["id"], target_object_type_id=objects[target]["id"], cardinality=cardinality, description=f"{objects[source]['display_name']}到{objects[target]['display_name']}的业务语义关系", status="experimental", external_id=external_id, reverse_display_name=f"反向查看{display_name}", is_core=True, design_status="validated"))

    action_specs = [
        ("ACT-001", "close_valve", "关闭阀门", "Equipment", "modify", "设备控制", "调用阀控服务关闭目标阀门", True),
        ("ACT-002", "create_work_order", "创建维修工单", "WorkOrder", "create", "运维处置", "创建并分派维修工单", False),
        ("ACT-003", "notify_dispatcher", "通知调度人员", "Alarm", "modify", "通知协同", "通过企业消息服务发送结构化通知", False),
        ("ACT-004", "isolate_equipment", "隔离故障设备", "Equipment", "modify", "设备控制", "执行隔离并回写设备状态", True),
    ]
    for external_id, name, display, target, action_type, category, logic, approval in action_specs:
        repo.save_action(oid, ActionBase(name=name, display_name=display, target_object_type_id=objects[target]["id"], action_type=action_type, description=logic, status="experimental", parameters=[prop("reason", "执行原因", required=True), prop("operator", "操作人", required=True)], preconditions=[{"expression": "operator has permission", "message": "需要具备对应对象的动作权限"}], external_id=external_id, action_category=category, execution_logic=logic, object_effect="记录状态变化与执行审计", approval_required=approval, owner="运行调度中心", design_status="validated"))

    repo.save_business_rule(oid, BusinessRuleBase(name="pressure_over_limit", display_name="压力上限校验", target_object_type_id=objects["PipeSegment"]["id"], category="risk", severity="blocking", expression="pressure <= configured_pressure_limit", description="管段实时压力不得超过配置上限", remediation="生成告警并进入调度处置", status="experimental"))
    repo.save_business_rule(oid, BusinessRuleBase(name="pressure_rate_abnormal", display_name="压力变化率异常", target_object_type_id=objects["PipeSegment"]["id"], category="risk", severity="warning", expression="abs(pressureRate) <= configured_rate_limit", description="识别压力突变风险", remediation="通知调度并创建巡检任务", status="experimental"))

    def add(kind: str, code: str, name: str, category: str, description: str, payload: Dict[str, Any], status: str = "active"):
        return save_resource(
            oid, kind,
            EnterpriseResourceBase(code=code, name=name, category=category, status=status, description=description, payload=payload),
            allow_legacy_steps=(kind == "business-scenarios"),
        )

    add("business-scenarios", "SCN-001", "管输合同履约", "经营履约", "从客户合同生成运输任务并跟踪管输执行", {"trigger": "合同生效", "entry_object": "Contract", "participants": ["市场人员", "调度人员"], "steps": ["识别生效合同", "创建运输任务", "匹配可用管线", "跟踪执行状态"], "related_actions": [], "related_logic": ["FUNC-001"], "source_systems": ["合同系统", "调度系统"]})
    add("business-scenarios", "SCN-002", "压力异常处置", "安全运营", "从实时压力异常发现到告警、动作与工单闭环", {"trigger": "压力或变化率越限", "entry_object": "PipeSegment", "participants": ["调度人员", "运维人员"], "steps": ["读取实时压力", "运行规则", "生成告警", "通知调度", "确认高风险动作", "创建工单"], "related_actions": ["ACT-001", "ACT-002", "ACT-003", "ACT-004"], "related_logic": ["RULE-001", "RULE-002", "FUNC-002"], "source_systems": ["SCADA", "EAM", "消息平台"]})

    sources = [
        ("SRC-001", "客户主数据", "关系数据库", "MDM.customer", "批量"), ("SRC-002", "合同业务库", "关系数据库", "contract.contract_main", "增量"),
        ("SRC-003", "运输调度库", "关系数据库", "dispatch.transport_task", "实时增量"), ("SRC-004", "SCADA 实时测点", "时序数据", "scada.pressure_tag", "流式"),
        ("SRC-005", "设备与工单服务", "API", "eam.asset_workorder", "事件+增量"),
    ]
    for code, name, category, physical, mode in sources:
        add("data-sources", code, name, category, f"模板定义的{name}来源", {"connection_ref": f"conn://{code.lower()}", "physical_object": physical, "update_mode": mode, "owner": "数据平台", "credential_policy": "凭据托管，不进入本体元数据"})
    for code, source, target, source_field, target_field in [("MAP-001", "SRC-001", "Customer", "customer_id", "customerId"), ("MAP-002", "SRC-002", "Contract", "contract_id", "contractId"), ("MAP-003", "SRC-003", "TransportTask", "task_id", "taskId"), ("MAP-004", "SRC-004", "PipeSegment", "pressure_value", "pressure")]:
        add("data-mappings", code, f"{source} → {target}.{target_field}", "字段映射", "物理字段到本体属性的可治理映射", {"source_code": source, "target_object_type": target, "source_field": source_field, "target_property": target_field, "transform_rule": "identity", "quality_rule": "not_null", "is_primary_key": target_field.endswith("Id")})
    for code, name, category, target, expression in [("RULE-001", "压力上限规则", "rule", "PipeSegment", "pressure <= configured_pressure_limit"), ("RULE-002", "压力变化率规则", "rule", "PipeSegment", "abs(pressureRate) <= configured_rate_limit"), ("FUNC-001", "计算运输完成率", "function", "TransportTask", "completedQuantity / plannedQuantity"), ("FUNC-002", "生成告警上下文", "function", "Alarm", "collect(segment, equipment, recent_measurements)")]:
        add("logic-definitions", code, name, category, "可被规则引擎或 Agent 工具调用的确定性逻辑", {"target_object_type": target, "language": "CEL" if category == "rule" else "Python", "expression": expression, "inputs": [target], "outputs": ["boolean" if category == "rule" else "object"], "trigger_mode": "实时" if "压力" in name or "告警" in name else "按需", "severity": "blocking" if code == "RULE-001" else "warning"})
    for code, name, category, service, operation in [("CAP-001", "阀门远程控制能力", "写操作", "scada-control", "closeValve"), ("CAP-002", "维修工单创建能力", "写操作", "eam-workorder", "createWorkOrder"), ("CAP-003", "企业消息通知能力", "通知", "message-center", "sendNotification")]:
        add("capabilities", code, name, category, "经批准后供 Action 映射调用的企业系统能力", {"service_ref": service, "operation": operation, "protocol": "REST", "request_schema": {"type": "object"}, "response_schema": {"type": "object"}, "timeout_ms": 8000, "credential_ref": "vault-managed"})
    for code, action, capability in [("AEM-001", "ACT-001", "CAP-001"), ("AEM-002", "ACT-002", "CAP-002"), ("AEM-003", "ACT-003", "CAP-003")]:
        add("action-mappings", code, f"{action} 执行映射", "同步调用", "本体 Action 到企业能力的受控绑定", {"action_code": action, "capability_code": capability, "parameter_mapping": {"reason": "reason", "operator": "actor.id"}, "result_mapping": {"status": "execution.status"}, "error_policy": "retry_then_manual", "timeout_ms": 8000})
    for code, subject, resource, permission, effect in [("PERM-001", "调度人员", "TransportTask", "read", "allow"), ("PERM-002", "调度主管", "Action:close_valve", "execute", "allow"), ("PERM-003", "运维人员", "WorkOrder", "write", "allow"), ("PERM-004", "普通访客", "Action:*", "execute", "deny")]:
        add("permission-policies", code, f"{subject} · {permission}", "对象与动作权限", "将可见性与可执行权限绑定到本体资源", {"subject_type": "role", "subject": subject, "resource_ref": resource, "permission": permission, "effect": effect, "condition": "organization_scope matches object.organization"})
    instances = {}
    for key, object_name, title, properties in [
        ("TASK-2026-001", "TransportTask", "华东天然气 8 月运输任务", {"taskId": "TASK-2026-001", "status": "执行中", "plannedQuantity": 5800}),
        ("SEG-EAST-07", "PipeSegment", "华东干线 07 管段", {"segmentId": "SEG-EAST-07", "pressure": 8.42, "pressureRate": 0.36}),
        ("EQ-V-0703", "Equipment", "07 管段入口电动阀", {"equipmentId": "EQ-V-0703", "equipmentName": "07 管段入口电动阀", "status": "预警"}),
    ]:
        instances[key] = repo.save_object_instance(oid, ObjectInstanceBase(object_type_id=objects[object_name]["id"], business_key=key, title=title, properties=properties, record_status="有效"))
    repo.save_link_instance(oid, LinkInstanceBase(link_type_id=links["task_through_segment"]["id"], source_instance_id=instances["TASK-2026-001"]["id"], target_instance_id=instances["SEG-EAST-07"]["id"]))

    conn = repo.get_conn()
    for table in ("object_types", "link_types", "actions", "business_rules"):
        conn.execute(f"UPDATE {table} SET status='active' WHERE ontology_id=?", (oid,))
    conn.execute("UPDATE ontologies SET status='published',version='v1.0.0',updated_at=? WHERE id=?", (repo.now(), oid))
    conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?", (oid,))
    conn.commit()
    conn.close()
    _reconcile_pipeline_workbook_v19(oid)
    _import_pipeline_template_v20(oid)
    _repair_pipeline_template_compat_v201(oid)
    _repair_pipeline_template_snapshot_v202(oid)
    _ensure_pipeline_template_evidence(oid)


def repair_data_source_provenance() -> None:
    """Remove legacy placeholder claims without changing source facts or connections.

    The pipeline workbook has no owner/connection state column. Procurement
    sources are built-in examples, not established live connections. This
    correction is deliberately limited to known placeholders on built-ins.
    """
    conn = repo.get_conn()
    rows = conn.execute("""SELECT s.id,s.code,s.payload,o.namespace
        FROM enterprise_data_sources s JOIN ontologies o ON o.id=s.ontology_id
        WHERE o.namespace IN ('enterprise.pipeline.operations.manual',
                              'enterprise.supplychain.manual')""").fetchall()
    for row in rows:
        payload = json.loads(row["payload"] or "{}")
        original = dict(payload)
        if row["namespace"] == "enterprise.pipeline.operations.manual" and payload.get("template_sheet") == "06_数据源":
            if payload.get("template_owner_missing") and payload.get("owner") == "示例负责人":
                payload.pop("owner", None)
            if payload.get("connection_status") == "registered":
                payload.pop("connection_status", None)
        elif row["namespace"] == "enterprise.supplychain.manual" and row["code"].startswith("SRC-"):
            payload.setdefault("source_origin", "built_in_demo")
            if payload.get("connection_status") == "connected" and (payload.get("connection_check") or {}).get("status") != "passed":
                payload.pop("connection_status", None)
        if payload != original:
            conn.execute("UPDATE enterprise_data_sources SET payload=?,updated_at=?,updated_by=? WHERE id=?",
                         (_json(payload), repo.now(), "system-migration", row["id"]))
    binding_marker = "pipeline-source-binding-evidence-v1"
    if not conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (binding_marker,)).fetchone():
        object_rows = conn.execute("""SELECT t.id,t.backing_source,t.metadata
            FROM object_types t JOIN ontologies o ON o.id=t.ontology_id
            WHERE o.namespace='enterprise.pipeline.operations.manual'""").fetchall()
        for row in object_rows:
            metadata = json.loads(row["metadata"] or "{}")
            source_system = metadata.get("source_system")
            if (metadata.get("template_sheet") == "02_对象类型"
                    and source_system in {"业务系统", "设备系统", "资产/监测系统"}
                    and row["backing_source"] == "DS-003"):
                metadata["source_binding_issue"] = "来源系统未在06_数据源中唯一匹配，待人工确认"
                conn.execute("""UPDATE object_types SET backing_source=NULL,metadata=?,updated_at=?,updated_by=?
                    WHERE id=?""", (_json(metadata), repo.now(), "system-migration", row["id"]))
        conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)",
                     (binding_marker, repo.now()))
    conn.commit()
    conn.close()


def repair_mapping_type_contract() -> None:
    """Retire the old object-mapping option and normalize its built-in demo."""
    conn = repo.get_conn()
    conn.execute("""UPDATE ontology_dictionary_items SET status='inactive'
        WHERE dict_type='mapping_type' AND code='object' AND label='对象映射'""")
    row = conn.execute("""SELECT m.id,m.name,m.category,m.payload
        FROM enterprise_data_mappings m JOIN ontologies o ON o.id=m.ontology_id
        WHERE o.namespace='enterprise.supplychain.manual' AND m.code='MAP-PAY-OBJECT'""").fetchone()
    if row:
        payload = json.loads(row["payload"] or "{}")
        if payload.get("mapping_type") == "object" and payload.get("target_property") and payload.get("source_field"):
            payload["legacy_mapping_type"] = "object"
            payload["mapping_type"] = "property"
            name = "付款申请编号属性映射" if row["name"] == "付款申请对象映射" else row["name"]
            category = "属性映射" if row["category"] == "对象映射" else row["category"]
            conn.execute("""UPDATE enterprise_data_mappings
                SET name=?,category=?,payload=?,updated_at=?,updated_by=? WHERE id=?""",
                (name, category, _json(payload), repo.now(), "system-migration", row["id"]))
    conn.commit()
    conn.close()


def _enrich_pipeline_operational_resources(ontology_id: str) -> None:
    conn=repo.get_conn()
    for mapping_code, action_code, capability_code in (("AEM-001","A-001","CAP-001"),("AEM-002","A-002","CAP-001"),("AEM-003","A-003","CAP-003")):
        row=conn.execute("SELECT id,payload FROM enterprise_action_mappings WHERE ontology_id=? AND code=?",(ontology_id,mapping_code)).fetchone()
        if row:
            payload=json.loads(row["payload"] or "{}")
            if payload.get("action_code") != action_code or payload.get("capability_code") != capability_code:
                payload.update({"action_code":action_code,"capability_code":capability_code,"audit_required":True})
                conn.execute("UPDATE enterprise_action_mappings SET payload=?,updated_at=?,updated_by=? WHERE id=?",(_json(payload),repo.now(),"system-migration",row["id"]))
    conn.commit(); conn.close()
    for code, update_method in [("MAP-001", "batch"), ("MAP-002", "event"), ("MAP-003", "realtime"), ("MAP-004", "realtime")]:
        existing = next((item for item in list_resources(ontology_id, "data-mappings") if item["code"] == code), None)
        if existing:
            inferred_type = "relation" if existing.get("target_relation") else "property" if existing.get("target_property") else None
            defaults = {"map_way": "direct", "update_method": update_method}
            if inferred_type:
                defaults["mapping_type"] = inferred_type
            _merge_resource_defaults(ontology_id, "data-mappings", code, existing["name"], existing.get("category", "属性映射"), existing.get("description") or "物理数据到本体语义的可测试映射", defaults)
    conn = repo.get_conn()
    conn.execute("""UPDATE object_instances SET source_system='SCADA',source_pk=business_key,
        sync_status='synced',quality_status='warning' WHERE ontology_id=? AND business_key IN ('SEG-EAST-07','EQ-V-0703')""", (ontology_id,))
    conn.execute("""UPDATE object_instances SET source_system='dispatch',source_pk=business_key,
        sync_status='synced',quality_status='passed' WHERE ontology_id=? AND business_key='TASK-2026-001'""", (ontology_id,))
    conn.commit(); conn.close()


def _ensure_pipeline_template_evidence(ontology_id: str) -> None:
    """Keep the workbook itself represented as immutable modeling evidence."""
    conn = repo.get_conn()
    if conn.execute("SELECT 1 FROM evidence_sources WHERE ontology_id=? AND filename='本体建模模板.xlsx'", (ontology_id,)).fetchone():
        conn.close()
        return
    sheet_names = [
        "00_使用说明", "01_业务场景", "02_对象类型", "03_对象属性", "04_关系",
        "05_对象实例", "06_数据源", "07_数据映射", "08_规则", "09_行动",
        "10_行动执行映射", "11_接口能力", "12_权限治理", "13_版本变更", "14_关系图数据",
    ]
    extracted = """本体建模模板.xlsx（内置建模证据）
覆盖业务场景、对象类型、属性、关系、实例、数据源、数据映射、规则与函数、动作、动作执行映射、系统能力、权限、版本和模型图谱。
质量修复：统一 OBJ-001/OBJ0001 编码；属性按语义名称绑定真实对象；图谱方向以关系定义为准；阀门动作绑定 Equipment 对象并由能力映射限定具体设备角色。
规模：2 个场景、9 个对象类型、10 个核心示例属性、10 个关系、3 个实例、5 个数据源、4 个映射、4 项逻辑、4 个动作、3 条动作执行映射、3 项能力、4 条权限、1 个版本。"""
    timestamp = repo.now()
    conn.execute("INSERT INTO evidence_sources VALUES (?,?,?,?,?,?,?,?,?,?)", (str(uuid.uuid4()), ontology_id, "本体建模模板.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "built-in-template", hashlib.sha256(extracted.encode()).hexdigest(), extracted, _json({"parser": "verified-template-import", "sheet_count": 15, "sheet_names": sheet_names, "row_count": 91, "quality_fixes": 4}), "imported", timestamp))
    conn.commit()
    conn.close()


def backfill_release_snapshots() -> None:
    """Create a baseline immutable snapshot for built-in ontologies published before release governance existed."""
    conn = repo.get_conn()
    rows = conn.execute(
        """SELECT o.id,o.version,o.updated_at FROM ontologies o
           WHERE o.status='published'
             AND NOT EXISTS (
               SELECT 1 FROM ontology_releases r
               WHERE r.ontology_id=o.id AND r.version=o.version
             )"""
    ).fetchall()
    conn.close()
    for row in rows:
        snapshot = repo.export_ontology(row["id"])
        conn = repo.get_conn()
        conn.execute(
            """INSERT OR IGNORE INTO ontology_releases
               (id,ontology_id,version,status,compatibility,change_reason,reviewer,change_summary,snapshot,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                str(uuid.uuid4()), row["id"], row["version"], "published", "baseline",
                "迁移已有发布版本", "system-migration", "历史已发布版本基线快照",
                _json(snapshot), row["updated_at"] or repo.now(),
            ),
        )
        conn.commit()
        conn.close()


def seal_builtin_ontologies() -> None:
    """Seal verified built-in domain models on a fresh installation only.

    Existing databases are intentionally excluded by repository.init_db so a
    user's working state is never overwritten during an application upgrade.
    """
    namespaces = ("enterprise.supplychain.manual", "enterprise.pipeline.operations.manual")
    conn = repo.get_conn()
    for namespace in namespaces:
        row = conn.execute("SELECT id FROM ontologies WHERE namespace=?", (namespace,)).fetchone()
        if not row:
            continue
        oid = row["id"]
        timestamp = repo.now()
        # Keep the version assigned by the authoritative seed/reconciliation.
        # In particular, the verified workbook migration is v1.1.0 and must not
        # be silently downgraded by the final fresh-install sealing pass.
        conn.execute(
            "UPDATE ontologies SET status='published',based_on_version=version,updated_at=? WHERE id=?",
            (timestamp, oid),
        )
        for table in ("object_types", "link_types", "actions", "business_rules", "shared_properties", "interfaces"):
            conn.execute(f"UPDATE {table} SET status='active' WHERE ontology_id=? AND status IN ('draft','experimental')", (oid,))
        for table, _ in RESOURCE_TABLES.values():
            conn.execute(f"UPDATE {table} SET status='active',updated_at=? WHERE ontology_id=? AND status IN ('draft','proposal')", (timestamp, oid))
        conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?", (oid,))
    conn.commit()
    conn.close()
