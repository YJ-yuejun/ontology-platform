from __future__ import annotations

import ast
import functools
import json
import os
import re
import sqlite3
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from models import (
    ActionBase,
    BusinessDomainBase,
    BusinessRuleBase,
    InterfaceBase,
    LinkInstanceBase,
    LinkTypeBase,
    ObjectInstanceBase,
    ObjectTypeBase,
    ObjectTypeGroupBase,
    OntologyBase,
    PropertyDef,
    SharedPropertyBase,
    SubjectDomainBase,
)


DB_PATH = os.environ.get(
    "ONTOLOGY_MANUAL_DB",
    str(Path(__file__).resolve().parents[1] / "data" / "ontology_manual.db"),
)

_audit_actor: ContextVar[str] = ContextVar("ontology_audit_actor", default="manual-admin")


def audit_actor() -> str:
    return _audit_actor.get()


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class ValidationError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


_open_conns: ContextVar[tuple] = ContextVar("ontology_open_conns", default=())


def get_conn() -> sqlite3.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    _open_conns.set(_open_conns.get() + (conn,))
    return conn


def _no_leak(fn):
    """入口函数退出时兜底关闭本次调用打开的连接。

    业务校验函数（_ensure_object_in_ontology、_validate_link_status 等）在连接
    已打开后抛错时，原有的 `conn.close(); raise` 写法覆盖不到，会泄漏文件描述符。
    这里不改动各函数体，只在入口处统一收口；重复 close 对 sqlite3 是空操作。
    """
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        token = _open_conns.set(())
        try:
            return fn(*args, **kwargs)
        finally:
            for conn in _open_conns.get():
                try:
                    conn.close()
                except sqlite3.Error:
                    pass
            _open_conns.reset(token)
    return wrapper


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db() -> None:
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS ontologies (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          namespace TEXT NOT NULL UNIQUE,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          version TEXT NOT NULL DEFAULT 'v0.1.0',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS business_domains (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          owner TEXT,
          status TEXT NOT NULL DEFAULT 'experimental',
          created_by TEXT NOT NULL DEFAULT 'system',
          updated_by TEXT NOT NULL DEFAULT 'system',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, code),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS subject_domains (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          business_domain_id TEXT NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          owner TEXT,
          status TEXT NOT NULL DEFAULT 'experimental',
          created_by TEXT NOT NULL DEFAULT 'system',
          updated_by TEXT NOT NULL DEFAULT 'system',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, code),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE,
          FOREIGN KEY(business_domain_id) REFERENCES business_domains(id)
        );
        CREATE TABLE IF NOT EXISTS prototype_migrations (
          migration_key TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS object_types (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          plural_name TEXT,
          icon TEXT NOT NULL,
          title_property TEXT,
          description TEXT,
          status TEXT NOT NULL,
          properties TEXT NOT NULL,
          group_ids TEXT NOT NULL DEFAULT '[]',
          object_kind TEXT NOT NULL DEFAULT 'business_object',
          parent_type_id TEXT,
          interface_ids TEXT NOT NULL DEFAULT '[]',
          backing_source TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, name),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS link_types (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          source_object_type_id TEXT NOT NULL,
          target_object_type_id TEXT NOT NULL,
          cardinality TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          properties TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, name),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE,
          FOREIGN KEY(source_object_type_id) REFERENCES object_types(id),
          FOREIGN KEY(target_object_type_id) REFERENCES object_types(id)
        );
        CREATE TABLE IF NOT EXISTS actions (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          target_object_type_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          parameters TEXT NOT NULL,
          preconditions TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, name),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE,
          FOREIGN KEY(target_object_type_id) REFERENCES object_types(id)
        );
        CREATE TABLE IF NOT EXISTS change_log (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          component_type TEXT NOT NULL,
          component_id TEXT,
          operation TEXT NOT NULL,
          summary TEXT NOT NULL,
          actor TEXT NOT NULL,
          created_at TEXT NOT NULL,
          pending INTEGER NOT NULL DEFAULT 1,
          before_data TEXT,
          after_data TEXT,
          change_note TEXT,
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS shared_properties (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          data_type TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          options TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, name),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS interfaces (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          properties TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, name),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS object_type_groups (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          color TEXT NOT NULL,
          subject_domain_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, name),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE,
          FOREIGN KEY(subject_domain_id) REFERENCES subject_domains(id)
        );
        CREATE TABLE IF NOT EXISTS business_rules (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          target_object_type_id TEXT NOT NULL,
          category TEXT NOT NULL,
          severity TEXT NOT NULL,
          expression TEXT NOT NULL,
          description TEXT,
          remediation TEXT,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, name),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE,
          FOREIGN KEY(target_object_type_id) REFERENCES object_types(id)
        );
        CREATE TABLE IF NOT EXISTS object_instances (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          object_type_id TEXT NOT NULL,
          business_key TEXT NOT NULL,
          title TEXT NOT NULL,
          properties TEXT NOT NULL,
          record_status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(ontology_id, object_type_id, business_key),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE,
          FOREIGN KEY(object_type_id) REFERENCES object_types(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS link_instances (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          link_type_id TEXT NOT NULL,
          source_instance_id TEXT NOT NULL,
          target_instance_id TEXT NOT NULL,
          properties TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(link_type_id, source_instance_id, target_instance_id),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE,
          FOREIGN KEY(link_type_id) REFERENCES link_types(id) ON DELETE CASCADE,
          FOREIGN KEY(source_instance_id) REFERENCES object_instances(id) ON DELETE CASCADE,
          FOREIGN KEY(target_instance_id) REFERENCES object_instances(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ontology_releases (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          version TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'published',
          compatibility TEXT NOT NULL DEFAULT 'compatible',
          change_reason TEXT NOT NULL,
          reviewer TEXT NOT NULL,
          change_summary TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(ontology_id, version),
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_object_types_ontology ON object_types(ontology_id);
        CREATE INDEX IF NOT EXISTS idx_business_domains_ontology ON business_domains(ontology_id);
        CREATE INDEX IF NOT EXISTS idx_subject_domains_ontology_domain ON subject_domains(ontology_id, business_domain_id);
        CREATE INDEX IF NOT EXISTS idx_link_types_ontology ON link_types(ontology_id);
        CREATE INDEX IF NOT EXISTS idx_actions_ontology ON actions(ontology_id);
        CREATE INDEX IF NOT EXISTS idx_change_log_ontology_created ON change_log(ontology_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_shared_properties_ontology ON shared_properties(ontology_id);
        CREATE INDEX IF NOT EXISTS idx_interfaces_ontology ON interfaces(ontology_id);
        CREATE INDEX IF NOT EXISTS idx_object_type_groups_ontology ON object_type_groups(ontology_id);
        CREATE INDEX IF NOT EXISTS idx_business_rules_ontology ON business_rules(ontology_id);
        CREATE INDEX IF NOT EXISTS idx_object_instances_ontology_type ON object_instances(ontology_id, object_type_id);
        CREATE INDEX IF NOT EXISTS idx_link_instances_ontology ON link_instances(ontology_id);
        """
    )
    _ensure_column(conn, "object_types", "group_ids", "TEXT NOT NULL DEFAULT '[]'")
    _ensure_column(conn, "object_types", "object_kind", "TEXT NOT NULL DEFAULT 'business_object'")
    _ensure_column(conn, "object_types", "parent_type_id", "TEXT")
    _ensure_column(conn, "object_types", "interface_ids", "TEXT NOT NULL DEFAULT '[]'")
    _ensure_column(conn, "object_types", "subject_domain_id", "TEXT")
    _ensure_column(conn, "object_types", "backing_source", "TEXT")
    _ensure_column(conn, "object_types", "metadata", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(conn, "link_types", "metadata", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(conn, "actions", "metadata", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(conn, "change_log", "pending", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(conn, "change_log", "before_data", "TEXT")
    _ensure_column(conn, "change_log", "after_data", "TEXT")
    _ensure_column(conn, "change_log", "change_note", "TEXT")
    _init_model_change_table(conn)
    _ensure_column(conn, "object_type_groups", "subject_domain_id", "TEXT")
    _ensure_column(conn, "ontologies", "based_on_version", "TEXT")
    # 分支来源：整体复制出来的本体记录它从哪个本体复制而来（产品已去掉版本概念，用本体名区分分支）
    _ensure_column(conn, "ontologies", "origin_ontology_id", "TEXT")
    _ensure_column(conn, "business_rules", "implementation_type", "TEXT NOT NULL DEFAULT 'expression'")
    _ensure_column(conn, "business_rules", "input_fields", "TEXT NOT NULL DEFAULT '[]'")
    _ensure_column(conn, "business_rules", "output_description", "TEXT NOT NULL DEFAULT 'boolean'")
    _ensure_column(conn, "business_rules", "trigger_mode", "TEXT NOT NULL DEFAULT 'api'")
    _ensure_column(conn, "business_rules", "realtime_requirement", "TEXT NOT NULL DEFAULT '按需'")
    _ensure_column(conn, "business_rules", "reusable", "INTEGER NOT NULL DEFAULT 1")
    _ensure_column(conn, "business_rules", "owner", "TEXT")
    _ensure_column(conn, "business_rules", "test_case", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(conn, "business_rules", "metadata", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(conn, "object_instances", "sync_status", "TEXT NOT NULL DEFAULT 'synced'")
    _ensure_column(conn, "object_instances", "source_system", "TEXT")
    _ensure_column(conn, "object_instances", "source_pk", "TEXT")
    _ensure_column(conn, "object_instances", "last_synced_at", "TEXT")
    _ensure_column(conn, "object_instances", "sync_error", "TEXT")
    _ensure_column(conn, "object_instances", "quality_status", "TEXT NOT NULL DEFAULT 'passed'")
    _ensure_column(conn, "object_instances", "metadata", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(conn, "link_instances", "metadata", "TEXT NOT NULL DEFAULT '{}'")
    # Every mutable core resource retains only the latest editor/timestamp. Full
    # history and modification notes live in change_log.
    for table in (
        "ontologies", "object_types", "link_types", "actions", "shared_properties",
        "interfaces", "object_type_groups", "business_rules", "object_instances",
        "link_instances", "ontology_releases", "business_domains", "subject_domains",
    ):
        _ensure_column(conn, table, "created_by", "TEXT NOT NULL DEFAULT 'system-migration'")
        _ensure_column(conn, table, "updated_by", "TEXT NOT NULL DEFAULT 'system-migration'")

    conn.execute("UPDATE ontologies SET based_on_version=version WHERE based_on_version IS NULL")
    for table in ("object_types", "link_types", "actions"):
        conn.execute(f"UPDATE {table} SET status='experimental' WHERE status='draft'")
    conn.execute("PRAGMA optimize")
    conn.commit()
    count = conn.execute("SELECT COUNT(*) AS c FROM ontologies").fetchone()["c"]
    fresh_install = count == 0
    conn.close()
    token = _audit_actor.set("system-bootstrap")
    try:
        if fresh_install:
            seed_demo()
        seed_additional_demo_ontologies()
        seed_procurement_domain()
        # Enterprise extensions are initialized here so tests, scripts and the API all see
        # the same workbook-aligned schema and the additional pipeline-domain ontology.
        from enterprise import backfill_release_snapshots, init_enterprise, migrate_legacy_scenario_steps, repair_data_source_provenance, repair_mapping_type_contract, seal_builtin_ontologies, seed_pipeline_domain
        init_enterprise()
        from dictionary_service import init_tables as init_model_dictionaries
        init_model_dictionaries()
        from governance_insights import init_tables as init_governance_insights
        init_governance_insights()
        seed_pipeline_domain()
        from procurement_mapping_seed import seed_procurement_mapping_demo
        seed_procurement_mapping_demo()
        repair_data_source_provenance()
        repair_mapping_type_contract()
        migrate_mapping_way_codes()
        seed_domain_hierarchy()
        repair_object_state_property()
        migrate_legacy_scenario_steps()
        apply_v19_product_model()
        if fresh_install:
            seal_builtin_ontologies()
        backfill_release_snapshots()
    finally:
        _audit_actor.reset(token)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _props(raw: str) -> list[dict]:
    values = json.loads(raw or "[]")
    for item in values:
        item.setdefault("property_category", None)
        item.setdefault("is_unique", False)
        item.setdefault("status", "experimental")
        item.setdefault("shared_property_id", None)
        item.setdefault("source_field", None)
        item.setdefault("external_id", None)
        item.setdefault("business_definition", None)
        item.setdefault("unit", None)
        item.setdefault("source_system", None)
        item.setdefault("update_frequency", None)
        item.setdefault("transform_rule", None)
        item.setdefault("quality_rule", None)
        item.setdefault("design_status", "draft")
        item.setdefault("parameter_source", None)
        item.setdefault("parameter_source_ref", None)
        item.setdefault("is_sensitive", False)
    return values


def _row_ontology(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row)


def _row_object(row: sqlite3.Row) -> Dict[str, Any]:
    data = dict(row)
    data["properties"] = _props(data["properties"])
    data["group_ids"] = json.loads(data.get("group_ids") or "[]")
    data["interface_ids"] = json.loads(data.get("interface_ids") or "[]")
    data["object_kind"] = "business_object"
    data["parent_type_id"] = None
    data.update(json.loads(data.pop("metadata", "{}") or "{}"))
    return data


def _enrich_object_inheritance(rows: Iterable[sqlite3.Row]) -> list[Dict[str, Any]]:
    """Return the v1.9 object view; Interface contracts stay separate resources."""
    objects = [_row_object(row) for row in rows]
    for item in objects:
        item["parent_chain"] = []
        item["inherited_properties"] = []
        item["effective_properties"] = [{**prop, "inherited": False} for prop in item["properties"]]
        item["child_type_count"] = 0
        item["effective_property_count"] = len(item["properties"])
    return objects


def _row_link(row: sqlite3.Row) -> Dict[str, Any]:
    data = dict(row)
    data["properties"] = _props(data["properties"])
    data.update(json.loads(data.pop("metadata", "{}") or "{}"))
    return data


def _row_action(row: sqlite3.Row) -> Dict[str, Any]:
    data = dict(row)
    data["parameters"] = _props(data["parameters"])
    data["preconditions"] = json.loads(data["preconditions"] or "[]")
    data.update(json.loads(data.pop("metadata", "{}") or "{}"))
    data.setdefault("precondition_mode", "all")
    return data


def _log(
    conn: sqlite3.Connection,
    ontology_id: str,
    component_type: str,
    component_id: Optional[str],
    operation: str,
    summary: str,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    change_note: Optional[str] = None,
) -> None:
    if change_note is None:
        change_note = summary
        if before is not None and after is not None:
            ignored = {"created_at", "updated_at", "created_by", "updated_by"}
            changed = sorted(
                key for key in set(before) | set(after)
                if key not in ignored and before.get(key) != after.get(key)
            )
            if changed:
                change_note = f"{summary}；变更字段：{', '.join(changed)}"
        elif after is not None:
            change_note = f"{summary}；已保存创建后快照"
        elif before is not None:
            change_note = f"{summary}；已保存删除前快照"
    log_id = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO change_log
        (id,ontology_id,component_type,component_id,operation,summary,actor,created_at,pending,before_data,after_data,change_note)
        VALUES (?,?,?,?,?,?,?,?,1,?,?,?)""",
        (
            log_id, ontology_id, component_type, component_id, operation, summary,
            _audit_actor.get(), now(), _json(before) if before is not None else None,
            _json(after) if after is not None else None, change_note,
        ),
    )
    if operation == 'update' and before is not None and after is not None:
        changes = _model_change_build_changes(before, after)
        if component_type == 'object_type':
            for change in changes:
                if change['field'] == 'display_name':
                    change['label'] = '对象名称'
        if changes:
            resource_label = {'ontology': '本体', 'object_type': '对象类型', 'link_type': '关系类型',
                              'action': '动作类型', 'interface': '接口', 'business_domain': '业务域',
                              'subject_domain': '主题域', 'data_source': '数据源', 'data_mapping': '数据映射',
                              'governance_asset': '治理资产', 'logic_definition': '规则',
                              'business_rule': '规则', 'business_scenario': '业务场景'}.get(component_type, '资源')
            resource = _model_change_flat_snapshot(after)
            resource_name = resource.get('display_name') or resource.get('name') or component_id
            content = f'修改{resource_label}「{resource_name}」：' + '；'.join(
                f"{change['label']}：{_model_change_text_value(change['before'])} → {_model_change_text_value(change['after'])}"
                for change in changes
            )
            conn.execute(
                'UPDATE mdl_ver_chg SET mvc_extend_params=?,mvc_chg_content=? WHERE mvc_legacy_change_id=?',
                (_json({'changes': changes}), content, log_id),
            )
    # Published releases are immutable snapshots. Any subsequent edit derives a
    # new working state from the latest published version instead of mutating it.
    conn.execute(
        """UPDATE ontologies
           SET status='draft', based_on_version=COALESCE(based_on_version, version), updated_at=?
           WHERE id=? AND status IN ('published','reviewed','in_review')""",
        (now(), ontology_id),
    )


def _validate_properties(properties: Iterable[PropertyDef], require_pk: bool) -> None:
    props = list(properties)
    keys = [item.key for item in props]
    if len(keys) != len(set(keys)):
        raise ValidationError("属性 key 不能重复")
    pks = [item for item in props if item.is_primary_key]
    if require_pk and len(pks) != 1:
        raise ValidationError("对象类型必须且只能有一个主键属性")
    if not require_pk and len(pks) > 1:
        raise ValidationError("关系属性或 Action 参数最多一个主键标记")
    for item in props:
        if item.type == "enum" and not item.options:
            raise ValidationError(f"枚举属性 {item.key} 必须提供选项")


@_no_leak
def create_ontology(data: OntologyBase) -> Dict[str, Any]:
    conn = get_conn()
    if conn.execute("SELECT 1 FROM ontologies WHERE namespace=?", (data.namespace,)).fetchone():
        conn.close()
        raise ConflictError(f"命名空间 {data.namespace} 已存在")
    oid, timestamp = str(uuid.uuid4()), now()
    conn.execute(
        """INSERT INTO ontologies
        (id,name,namespace,description,status,version,created_at,updated_at,based_on_version,created_by,updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (oid, data.name, data.namespace, data.description, "draft", "v0.1.0", timestamp, timestamp, "v0.1.0", "manual-admin", "manual-admin"),
    )
    after=conn.execute("SELECT * FROM ontologies WHERE id=?",(oid,)).fetchone()
    _log(conn, oid, "ontology", oid, "create", f"创建本体 {data.name}", after=dict(after))
    conn.commit()
    row = conn.execute("SELECT * FROM ontologies WHERE id=?", (oid,)).fetchone()
    conn.close()
    return _row_ontology(row)


def list_ontologies() -> list[Dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute(
        """SELECT o.*,
        (SELECT COUNT(*) FROM object_types x WHERE x.ontology_id=o.id AND COALESCE(x.object_kind,'business_object')<>'abstract_type') AS object_type_count,
        (SELECT COUNT(*) FROM link_types x WHERE x.ontology_id=o.id) AS link_type_count,
        (SELECT COUNT(*) FROM actions x WHERE x.ontology_id=o.id) AS action_count,
        (SELECT COUNT(*) FROM business_rules x WHERE x.ontology_id=o.id) AS business_rule_count,
        (SELECT COUNT(*) FROM object_instances x WHERE x.ontology_id=o.id) AS instance_count,
        0 AS shared_property_count,
        (SELECT COUNT(*) FROM interfaces x WHERE x.ontology_id=o.id) AS interface_count,
        (SELECT COUNT(*) FROM business_domains x WHERE x.ontology_id=o.id) AS business_domain_count,
        (SELECT COUNT(*) FROM subject_domains x WHERE x.ontology_id=o.id) AS subject_domain_count
        ,(SELECT COUNT(*) FROM enterprise_business_scenarios x WHERE x.ontology_id=o.id) AS scenario_count
        ,(SELECT COUNT(*) FROM enterprise_data_sources x WHERE x.ontology_id=o.id) AS data_source_count
        ,(SELECT COUNT(*) FROM enterprise_data_mappings x WHERE x.ontology_id=o.id) AS data_mapping_count
        ,(SELECT COUNT(*) FROM enterprise_logic_definitions x WHERE x.ontology_id=o.id) AS logic_definition_count
        ,(SELECT COUNT(*) FROM enterprise_capabilities x WHERE x.ontology_id=o.id) AS capability_count
        ,(SELECT COUNT(*) FROM enterprise_action_mappings x WHERE x.ontology_id=o.id) AS action_mapping_count
        ,(SELECT COUNT(*) FROM enterprise_permission_policies x WHERE x.ontology_id=o.id) AS permission_policy_count
        ,(SELECT COUNT(*) FROM ontology_proposals x WHERE x.ontology_id=o.id) AS proposal_count
        FROM ontologies o ORDER BY o.updated_at DESC"""
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_ontology(oid: str) -> Dict[str, Any]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM ontologies WHERE id=?", (oid,)).fetchone()
    conn.close()
    if not row:
        raise NotFoundError("本体不存在")
    return _row_ontology(row)


@_no_leak
def update_ontology(oid: str, data: OntologyBase) -> Dict[str, Any]:
    before=get_ontology(oid)
    conn = get_conn()
    conflict = conn.execute("SELECT 1 FROM ontologies WHERE namespace=? AND id<>?", (data.namespace, oid)).fetchone()
    if conflict:
        conn.close(); raise ConflictError("命名空间已存在")
    conn.execute("UPDATE ontologies SET name=?,namespace=?,description=?,updated_at=?,updated_by=? WHERE id=?", (data.name, data.namespace, data.description, now(), "manual-admin", oid))
    after = dict(conn.execute('SELECT * FROM ontologies WHERE id=?', (oid,)).fetchone())
    _log(conn, oid, "ontology", oid, "update", f"更新本体信息：{data.name}", before=before, after=after)
    conn.commit(); conn.close()
    return get_ontology(oid)


def delete_ontology(oid: str) -> None:
    current=get_ontology(oid)
    if current["namespace"] in {"enterprise.supplychain.manual", "enterprise.pipeline.operations.manual"}:
        raise ValidationError("采购财务与管网本体是内置业务基线，不能直接删除；可派生工作状态进行调整")
    conn = get_conn(); conn.execute("DELETE FROM ontologies WHERE id=?", (oid,)); conn.commit(); conn.close()


def list_object_types(oid: str, include_abstract: bool = True) -> list[Dict[str, Any]]:
    get_ontology(oid)
    conn = get_conn(); rows = conn.execute("""SELECT o.*,s.name subject_domain_name,s.code subject_domain_code,
        d.id business_domain_id,d.name business_domain_name,d.code business_domain_code
        FROM object_types o
        LEFT JOIN subject_domains s ON s.id=o.subject_domain_id
        LEFT JOIN business_domains d ON d.id=s.business_domain_id
        WHERE o.ontology_id=? AND COALESCE(o.object_kind,'business_object')<>'abstract_type'
        ORDER BY d.code,s.code,o.name""", (oid,)).fetchall(); conn.close()
    items = _enrich_object_inheritance(rows)
    return items


def get_object_type(component_id: str) -> Dict[str, Any]:
    conn = get_conn(); row = conn.execute("SELECT ontology_id FROM object_types WHERE id=?", (component_id,)).fetchone(); conn.close()
    if not row: raise NotFoundError("对象类型不存在")
    return next(item for item in list_object_types(row["ontology_id"]) if item["id"] == component_id)


def _validate_object_definition(conn: sqlite3.Connection, oid: str, data: ObjectTypeBase, component_id: Optional[str] = None) -> tuple[Optional[str], list[PropertyDef], Optional[str]]:
    if data.object_kind == "abstract_type" or data.parent_type_id:
        raise ValidationError("抽象契约请在“接口”中维护，对象类型不再承载父类继承")
    effective = list(data.properties)
    _validate_properties(effective, True)
    keys = {item.key for item in effective}
    title = data.title_property or next((item.key for item in effective if item.is_primary_key), None)
    if title and title not in keys:
        raise ValidationError("标题属性必须引用已定义属性")
    if data.state_property and data.state_property not in keys:
        raise ValidationError("状态属性必须引用已定义属性")
    return None, effective, title


@_no_leak
def create_object_type(oid: str, data: ObjectTypeBase, legacy_source: Optional[str] = None,
                       legacy_domain_binding: Optional[tuple] = None) -> Dict[str, Any]:
    """legacy_source / legacy_domain_binding 供整体复制本体时照搬源对象的既有绑定，
    与 update_object_type 的口径一致；普通新建不传，行为不变。"""
    get_ontology(oid)
    conn = get_conn()
    parent_id, _, title = _validate_object_definition(conn, oid, data)
    _validate_object_bindings(conn, oid, data, legacy_source, legacy_domain_binding)
    if conn.execute("SELECT 1 FROM object_types WHERE ontology_id=? AND name=?", (oid, data.name)).fetchone():
        conn.close(); raise ConflictError("对象类型标识已存在")
    cid, timestamp = str(uuid.uuid4()), now()
    metadata={key:getattr(data,key) for key in ("external_id","category","domain","lifecycle","state_property","owner","source_system","is_core","is_event","requires_action","design_status")}
    conn.execute("""INSERT INTO object_types
        (id,ontology_id,name,display_name,plural_name,icon,title_property,description,status,properties,group_ids,object_kind,parent_type_id,interface_ids,backing_source,subject_domain_id,created_at,updated_at,metadata,created_by,updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (cid,oid,data.name,data.display_name,None,data.icon,title,data.description,data.status,_json([p.model_dump(exclude={"shared_property_id"}) for p in data.properties]),"[]","business_object",None,_json(data.interface_ids),data.backing_source,data.subject_domain_id,timestamp,timestamp,_json(metadata),"manual-admin","manual-admin"))
    after=conn.execute("SELECT * FROM object_types WHERE id=?",(cid,)).fetchone()
    conn.execute("UPDATE ontologies SET updated_at=? WHERE id=?", (timestamp,oid)); _log(conn,oid,"object_type",cid,"create",f"创建对象类型 {data.display_name}",after=dict(after))
    conn.commit(); conn.close(); return get_object_type(cid)


@_no_leak
def update_object_type(component_id: str, data: ObjectTypeBase) -> Dict[str, Any]:
    current=get_object_type(component_id)
    if current["status"] in ("active", "promoted") and data.name != current["name"]:
        raise ValidationError("Active 或 Promoted 对象类型不能修改 API 名称")
    conn=get_conn()
    parent_id, _, title = _validate_object_definition(conn, current["ontology_id"], data, component_id)
    _validate_object_bindings(conn, current["ontology_id"], data, current.get("backing_source"), (current.get("subject_domain_id"), current.get("domain")))
    if conn.execute("SELECT 1 FROM object_types WHERE ontology_id=? AND name=? AND id<>?",(current["ontology_id"],data.name,component_id)).fetchone(): conn.close(); raise ConflictError("对象类型标识已存在")
    before=conn.execute("SELECT * FROM object_types WHERE id=?",(component_id,)).fetchone()
    metadata=json.loads(before["metadata"] or "{}")
    metadata.update({key:getattr(data,key) for key in ("external_id","category","domain","lifecycle","state_property","owner","source_system","is_core","is_event","requires_action","design_status")})
    if data.backing_source:
        metadata.pop("source_binding_issue", None)
    timestamp=now(); conn.execute("UPDATE object_types SET name=?,display_name=?,plural_name=NULL,icon=?,title_property=?,description=?,status=?,properties=?,group_ids='[]',object_kind='business_object',parent_type_id=NULL,interface_ids=?,backing_source=?,subject_domain_id=?,metadata=?,updated_at=?,updated_by=? WHERE id=?",(data.name,data.display_name,data.icon,title,data.description,data.status,_json([prop.model_dump(exclude={"shared_property_id"}) for prop in data.properties]),_json(data.interface_ids),data.backing_source,data.subject_domain_id,_json(metadata),timestamp,"manual-admin",component_id))
    if data.status in ("experimental", "deprecated", "example"):
        conn.execute("UPDATE link_types SET status=? WHERE source_object_type_id=? OR target_object_type_id=?",(data.status,component_id,component_id))
    after=conn.execute("SELECT * FROM object_types WHERE id=?",(component_id,)).fetchone()
    conn.execute("UPDATE ontologies SET updated_at=? WHERE id=?",(timestamp,current["ontology_id"])); _log(conn,current["ontology_id"],"object_type",component_id,"update",f"更新对象类型 {data.display_name}",before=dict(before),after=dict(after))
    conn.commit(); conn.close(); return get_object_type(component_id)


@_no_leak
def delete_object_type(component_id: str) -> None:
    current=get_object_type(component_id); conn=get_conn()
    if current["status"] in ("active", "promoted"):
        conn.close(); raise ValidationError("Active 或 Promoted 对象类型不能直接删除，请先标记为 Deprecated")
    links=conn.execute("SELECT COUNT(*) c FROM link_types WHERE source_object_type_id=? OR target_object_type_id=?",(component_id,component_id)).fetchone()["c"]
    actions=conn.execute("SELECT COUNT(*) c FROM actions WHERE target_object_type_id=?",(component_id,)).fetchone()["c"]
    rules=conn.execute("SELECT COUNT(*) c FROM business_rules WHERE target_object_type_id=?",(component_id,)).fetchone()["c"]
    instances=conn.execute("SELECT COUNT(*) c FROM object_instances WHERE object_type_id=?",(component_id,)).fetchone()["c"]
    if links or actions or rules or instances: conn.close(); raise ValidationError(f"该对象类型仍被 {links} 个关系、{actions} 个动作、{rules} 个规则引用，并包含 {instances} 条实例")
    conn.execute("DELETE FROM object_types WHERE id=?",(component_id,)); _log(conn,current["ontology_id"],"object_type",component_id,"delete",f"删除对象类型 {current['display_name']}",before=current); conn.commit(); conn.close()


def _ensure_object_in_ontology(conn: sqlite3.Connection, oid: str, component_id: str) -> None:
    if not conn.execute("SELECT 1 FROM object_types WHERE id=? AND ontology_id=?",(component_id,oid)).fetchone(): raise ValidationError("关系端点或 Action 目标不属于当前本体")


def _validate_backing_source(
    conn: sqlite3.Connection,
    oid: str,
    source_code: Optional[str],
    legacy_source: Optional[str] = None,
) -> None:
    """Require object mappings to point at a registered enterprise data source.

    Pre-v1.9 built-ins may still contain physical table names in this column;
    those remain readable and editable without a forced data migration.  New
    bindings, however, must use a source code from the current ontology.
    """
    if not source_code:
        return
    table_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='enterprise_data_sources'"
    ).fetchone()
    if not table_exists:
        return
    # Core and workbook seeds run before the v1.9 product migration is sealed.
    # Runtime API calls occur after this marker exists and are validated below.
    product_contract_active = conn.execute(
        "SELECT 1 FROM prototype_migrations WHERE migration_key='v1.9-keep-procurement-pipeline'"
    ).fetchone()
    if not product_contract_active:
        return
    if legacy_source and source_code == legacy_source:
        return
    if not conn.execute(
        "SELECT 1 FROM enterprise_data_sources WHERE ontology_id=? AND code=?",
        (oid, source_code),
    ).fetchone():
        raise ValidationError("映射数据源必须选择当前本体已登记的数据源")


def _validate_object_bindings(
    conn: sqlite3.Connection,
    oid: str,
    data: ObjectTypeBase,
    legacy_source: Optional[str] = None,
    legacy_domain_binding: Optional[tuple[Optional[str], Optional[str]]] = None,
) -> None:
    if data.subject_domain_id:
        subject = conn.execute("""SELECT d.name business_domain_name FROM subject_domains s
            JOIN business_domains d ON d.id=s.business_domain_id
            WHERE s.id=? AND s.ontology_id=?""", (data.subject_domain_id, oid)).fetchone()
        if not subject:
            raise ValidationError("所属主题域不存在")
        if not data.domain:
            data.domain = subject["business_domain_name"]
        if subject["business_domain_name"] != data.domain and legacy_domain_binding != (data.subject_domain_id, data.domain):
            raise ValidationError("主题域必须属于对象选择的业务域")
    _validate_backing_source(conn, oid, data.backing_source, legacy_source)
    local = {prop.key: prop for prop in data.properties}
    for interface_id in data.interface_ids:
        interface = conn.execute("SELECT * FROM interfaces WHERE id=? AND ontology_id=?",(interface_id,oid)).fetchone()
        if not interface:
            raise ValidationError("所选接口不属于当前本体")
        for required in _props(interface["properties"]):
            actual = local.get(required["key"])
            if not actual:
                raise ValidationError(f"实现接口 {interface['display_name']} 需要定义属性 {required['name']}")
            if actual.type != required["type"]:
                raise ValidationError(f"接口属性 {required['name']} 要求 {required['type']}，当前为 {actual.type}")


def list_link_types(oid: str) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn(); rows=conn.execute("""SELECT l.*,s.display_name source_display_name,t.display_name target_display_name FROM link_types l JOIN object_types s ON s.id=l.source_object_type_id JOIN object_types t ON t.id=l.target_object_type_id WHERE l.ontology_id=? ORDER BY l.name""",(oid,)).fetchall(); conn.close(); return [_row_link(row) for row in rows]


def get_link_type(component_id: str) -> Dict[str, Any]:
    conn=get_conn(); row=conn.execute("SELECT * FROM link_types WHERE id=?",(component_id,)).fetchone(); conn.close()
    if not row: raise NotFoundError("关系类型不存在")
    return _row_link(row)


@_no_leak
def save_link_type(oid: str, data: LinkTypeBase, component_id: Optional[str]=None) -> Dict[str, Any]:
    get_ontology(oid); _validate_properties(data.properties,False); conn=get_conn(); _ensure_object_in_ontology(conn,oid,data.source_object_type_id); _ensure_object_in_ontology(conn,oid,data.target_object_type_id)
    conflict=conn.execute("SELECT 1 FROM link_types WHERE ontology_id=? AND name=? AND id<>?",(oid,data.name,component_id or "")).fetchone()
    if conflict: conn.close(); raise ConflictError("关系类型标识已存在")
    timestamp=now(); metadata={key:getattr(data,key) for key in ("external_id","reverse_display_name","reverse_name","source_system","source_key","target_key","is_core","bidirectional_display","design_status")}
    before=None
    if component_id:
        current=conn.execute("SELECT ontology_id FROM link_types WHERE id=?",(component_id,)).fetchone()
        if not current:
            conn.close(); raise NotFoundError("关系类型不存在")
        if current["ontology_id"] != oid:
            conn.close(); raise ValidationError("关系类型不属于当前本体")
        current_full=conn.execute("SELECT * FROM link_types WHERE id=?",(component_id,)).fetchone()
        before=dict(current_full)
        if current_full["status"] == "active" and current_full["name"] != data.name:
            conn.close(); raise ValidationError("Active 关系类型不能修改 API 名称")
        _validate_link_status(conn, data)
        conn.execute("UPDATE link_types SET name=?,display_name=?,source_object_type_id=?,target_object_type_id=?,cardinality=?,description=?,status=?,properties=?,metadata=?,updated_at=?,updated_by=? WHERE id=?",(data.name,data.display_name,data.source_object_type_id,data.target_object_type_id,data.cardinality,data.description,data.status,_json([p.model_dump() for p in data.properties]),_json(metadata),timestamp,"manual-admin",component_id)); op="update"
    else:
        _validate_link_status(conn, data)
        component_id=str(uuid.uuid4()); conn.execute("""INSERT INTO link_types
            (id,ontology_id,name,display_name,source_object_type_id,target_object_type_id,cardinality,description,status,properties,created_at,updated_at,metadata,created_by,updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",(component_id,oid,data.name,data.display_name,data.source_object_type_id,data.target_object_type_id,data.cardinality,data.description,data.status,_json([p.model_dump() for p in data.properties]),timestamp,timestamp,_json(metadata),"manual-admin","manual-admin")); op="create"
    after=dict(conn.execute("SELECT * FROM link_types WHERE id=?",(component_id,)).fetchone())
    conn.execute("UPDATE ontologies SET updated_at=? WHERE id=?",(timestamp,oid)); _log(conn,oid,"link_type",component_id,op,f"{'更新' if op=='update' else '创建'}关系类型 {data.display_name}",before=before,after=after); conn.commit(); conn.close(); return get_link_type(component_id)


@_no_leak
def delete_link_type(component_id: str) -> None:
    current=get_link_type(component_id); conn=get_conn()
    if current["status"] == "active": conn.close(); raise ValidationError("Active 关系类型不能直接删除，请先标记为 Deprecated")
    conn.execute("DELETE FROM link_types WHERE id=?",(component_id,)); _log(conn,current["ontology_id"],"link_type",component_id,"delete",f"删除关系类型 {current['display_name']}",before=current); conn.commit(); conn.close()


def _validate_link_status(conn: sqlite3.Connection, data: LinkTypeBase) -> None:
    if data.status != "active": return
    statuses=[conn.execute("SELECT status FROM object_types WHERE id=?",(cid,)).fetchone()["status"] for cid in (data.source_object_type_id,data.target_object_type_id)]
    if any(status not in ("active","promoted") for status in statuses):
        raise ValidationError("Active 关系的两端对象必须是 Active 或 Promoted")


def list_actions(oid: str) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn(); rows=conn.execute("""SELECT a.*,o.display_name target_display_name FROM actions a JOIN object_types o ON o.id=a.target_object_type_id WHERE a.ontology_id=? ORDER BY a.name""",(oid,)).fetchall(); conn.close(); return [_row_action(row) for row in rows]


def get_action(component_id: str) -> Dict[str, Any]:
    conn=get_conn(); row=conn.execute("SELECT * FROM actions WHERE id=?",(component_id,)).fetchone(); conn.close()
    if not row: raise NotFoundError("Action 不存在")
    return _row_action(row)


@_no_leak
def _validate_restored_action_mappings(oid):
    actions = list_actions(oid)
    conn = get_conn()
    for item in actions:
        _validate_action_mapping(conn, oid, ActionBase(**item), item["id"])
    conn.close()


def _validate_action_mapping(conn, oid, data, component_id=None):
    mapping_code = (data.definition_config or {}).get("action_mapping_code")
    if mapping_code:
        if not isinstance(mapping_code, str): raise ValidationError("执行映射编号必须为文本")
        mapping = conn.execute("SELECT payload FROM enterprise_action_mappings WHERE ontology_id=? AND code=?", (oid, mapping_code)).fetchone()
        identifiers = {component_id, data.name, data.external_id, data.display_name}
        binding = json.loads(mapping["payload"] or "{}") if mapping else {}
        if not mapping or (binding.get("action_code") or binding.get("action_id")) not in identifiers:
            raise ValidationError("执行映射不存在或不属于当前动作")


@_no_leak
def save_action(oid: str, data: ActionBase, component_id: Optional[str]=None, *, defer_mapping_validation: bool=False) -> Dict[str, Any]:
    from action_definitions import merge_config, validate_definition
    get_ontology(oid)
    conn = get_conn()
    conn.execute("BEGIN IMMEDIATE")
    current = conn.execute("SELECT * FROM actions WHERE id=?", (component_id,)).fetchone() if component_id else None
    if component_id and not current:
        raise NotFoundError("Action 不存在")
    previous = _row_action(current) if current else None
    if previous:
        if previous["ontology_id"] != oid:
            raise ValidationError("Action 不属于当前本体")
        supplied = data.model_dump(exclude_unset=True)
        if supplied.get("expected_updated_at") and supplied["expected_updated_at"] != previous["updated_at"]:
            raise ConflictError("动作已被其他操作修改，请刷新后再编辑")
        if "definition_config" in supplied:
            if supplied["definition_config"] is None and previous.get("definition_config") is not None:
                raise ValidationError("不能清除动作配置，请选择文字规则并填写说明")
            if supplied["definition_config"] is not None:
                supplied["definition_config"] = merge_config(previous.get("definition_config"), supplied["definition_config"])
        data = ActionBase(**{**previous, **supplied})
    # Normalize identity strings without rewriting source evidence or multiline text.
    for key in ("name", "display_name", "external_id", "action_category", "owner"):
        value = getattr(data, key)
        if isinstance(value, str): setattr(data, key, value.strip())
    if not data.display_name:
        raise ValidationError("行动名称不能为空")
    if previous and (previous["name"] != data.name or (previous.get("external_id") and previous["external_id"] != data.external_id)):
        raise ValidationError("行动编号和 API 名称创建后不可修改")
    _validate_properties(data.parameters, False)
    _ensure_object_in_ontology(conn, oid, data.target_object_type_id)
    # Dictionary names are accepted for legacy imports; new v1 records use codes.
    if data.action_category:
        dictionary_exists = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dic_action_type'").fetchone()
        matches = conn.execute("SELECT dat_code,dat_status FROM dic_action_type WHERE dat_code=? OR dat_name=?",
                               (data.action_category, data.action_category)).fetchall() if dictionary_exists else []
        if len(matches) == 1:
            if not matches[0]["dat_status"] and data.definition_config is not None and (not previous or previous.get("action_category") != data.action_category):
                raise ValidationError("不能选择已禁用的行动类型")
            data.action_category = matches[0]["dat_code"]
        elif data.definition_config is not None and (not previous or previous.get("action_category") != data.action_category):
            raise ValidationError("请选择有效的行动类型字典项")
    if not defer_mapping_validation:
        _validate_action_mapping(conn, oid, data, component_id)
    try:
        validate_definition(data, previous)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    rows = conn.execute("SELECT * FROM actions WHERE ontology_id=? AND id<>?", (oid, component_id or "")).fetchall()
    for row in rows:
        other = _row_action(row)
        for key, title in (("name", "API 名称"), ("display_name", "行动名称"), ("external_id", "行动编号")):
            value = getattr(data, key)
            if value and str(other.get(key) or "").strip() == value:
                raise ConflictError(f"同一本体中{title}已存在")
    fields = ("external_id", "action_category", "execution_logic", "object_effect", "result_schema", "side_effects",
              "approval_required", "owner", "design_status", "precondition_mode", "target_role", "input_parameters_text",
              "precondition_text", "result_text", "side_effects_text", "definition_config", "definition_version")
    metadata = json.loads(current["metadata"] or "{}") if current else {}
    metadata.update({key: getattr(data, key) for key in fields if getattr(data, key) is not None or key in data.model_fields_set})
    timestamp = now()
    values = (data.name, data.display_name, data.target_object_type_id, data.action_type, data.description, data.status,
              _json([p.model_dump() for p in data.parameters]), _json(data.preconditions), _json(metadata), timestamp, audit_actor())
    if current:
        conn.execute("UPDATE actions SET name=?,display_name=?,target_object_type_id=?,action_type=?,description=?,status=?,parameters=?,preconditions=?,metadata=?,updated_at=?,updated_by=? WHERE id=?", (*values, component_id))
        op = "update"
    else:
        component_id = str(uuid.uuid4())
        conn.execute("INSERT INTO actions (name,display_name,target_object_type_id,action_type,description,status,parameters,preconditions,metadata,updated_at,updated_by,id,ontology_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (*values, component_id, oid, timestamp, audit_actor()))
        op = "create"
    after = dict(conn.execute("SELECT * FROM actions WHERE id=?", (component_id,)).fetchone())
    conn.execute("UPDATE ontologies SET updated_at=? WHERE id=?", (timestamp, oid))
    _log(conn, oid, "action", component_id, op, f"{'更新' if current else '创建'} Action {data.display_name}", before=dict(current) if current else None, after=after)
    conn.commit()
    conn.close()
    return get_action(component_id)


@_no_leak
def delete_action(component_id: str) -> None:
    from action_definitions import references_action
    conn = get_conn()
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute("SELECT * FROM actions WHERE id=?", (component_id,)).fetchone()
    if not row: raise NotFoundError("Action 不存在")
    current = _row_action(row)
    if current["status"] == "active":
        raise ValidationError("已启用动作不能直接删除，请通过本体治理标记为已弃用")
    identifiers = {str(value) for value in (component_id, current["name"], current.get("external_id"), current["display_name"]) if value}
    references = []
    for table, label in (("enterprise_business_scenarios", "业务场景"), ("enterprise_action_mappings", "动作执行映射"), ("enterprise_permission_policies", "权限策略")):
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone(): continue
        for resource in conn.execute(f"SELECT name,payload FROM {table} WHERE ontology_id=?", (current["ontology_id"],)).fetchall():
            if references_action(json.loads(resource["payload"] or "{}"), identifiers):
                references.append(f"{label}「{resource['name']}」")
    if references:
        raise ConflictError("动作仍被引用，不能删除：" + "、".join(references))
    conn.execute("DELETE FROM actions WHERE id=?", (component_id,))
    _log(conn, current["ontology_id"], "action", component_id, "delete", f"删除 Action {current['display_name']}", before=current)
    conn.commit()
    conn.close()


def list_shared_properties(oid: str) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn(); rows=conn.execute("SELECT * FROM shared_properties WHERE ontology_id=? ORDER BY name",(oid,)).fetchall(); conn.close()
    return [{**dict(row),"type":row["data_type"],"options":json.loads(row["options"] or "[]")} for row in rows]


def get_shared_property(component_id: str) -> Dict[str, Any]:
    conn=get_conn(); row=conn.execute("SELECT * FROM shared_properties WHERE id=?",(component_id,)).fetchone(); conn.close()
    if not row: raise NotFoundError("共享属性不存在")
    return {**dict(row),"type":row["data_type"],"options":json.loads(row["options"] or "[]")}


@_no_leak
def save_shared_property(oid: str, data: SharedPropertyBase, component_id: Optional[str]=None) -> Dict[str, Any]:
    get_ontology(oid)
    if data.type == "enum" and not data.options: raise ValidationError("枚举共享属性必须提供选项")
    conn=get_conn(); conflict=conn.execute("SELECT 1 FROM shared_properties WHERE ontology_id=? AND name=? AND id<>?",(oid,data.name,component_id or "")).fetchone()
    if conflict: conn.close(); raise ConflictError("共享属性 API 名称已存在")
    timestamp=now()
    before=None
    if component_id:
        current=conn.execute("SELECT * FROM shared_properties WHERE id=? AND ontology_id=?",(component_id,oid)).fetchone()
        if not current: conn.close(); raise NotFoundError("共享属性不存在")
        before=dict(current)
        if current["status"] == "active" and (current["name"] != data.name or current["data_type"] != data.type): conn.close(); raise ValidationError("Active 共享属性不能修改 API 名称或数据类型")
        conn.execute("UPDATE shared_properties SET name=?,display_name=?,data_type=?,description=?,status=?,options=?,updated_at=?,updated_by=? WHERE id=?",(data.name,data.display_name,data.type,data.description,data.status,_json(data.options or []),timestamp,"manual-admin",component_id)); op="update"
    else:
        component_id=str(uuid.uuid4()); conn.execute("""INSERT INTO shared_properties
            (id,ontology_id,name,display_name,data_type,description,status,options,created_at,updated_at,created_by,updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",(component_id,oid,data.name,data.display_name,data.type,data.description,data.status,_json(data.options or []),timestamp,timestamp,"manual-admin","manual-admin")); op="create"
    after=dict(conn.execute("SELECT * FROM shared_properties WHERE id=?",(component_id,)).fetchone())
    _log(conn,oid,"shared_property",component_id,op,f"{'更新' if op=='update' else '创建'}共享属性 {data.display_name}",before=before,after=after); conn.execute("UPDATE ontologies SET updated_at=? WHERE id=?",(timestamp,oid)); conn.commit(); conn.close(); return get_shared_property(component_id)


def delete_shared_property(component_id: str) -> None:
    current=get_shared_property(component_id)
    if current["status"] == "active": raise ValidationError("Active 共享属性不能直接删除，请先标记为 Deprecated")
    for obj in list_object_types(current["ontology_id"]):
        if any(prop.get("shared_property_id") == component_id for prop in obj["properties"]): raise ValidationError(f"共享属性仍被对象类型 {obj['display_name']} 使用")
    conn=get_conn(); conn.execute("DELETE FROM shared_properties WHERE id=?",(component_id,)); _log(conn,current["ontology_id"],"shared_property",component_id,"delete",f"删除共享属性 {current['display_name']}",before=current); conn.commit(); conn.close()


def _row_interface(row: sqlite3.Row) -> Dict[str, Any]:
    data=dict(row); data["properties"]=_props(data["properties"]); return data


def list_interfaces(oid: str) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn()
    rows=conn.execute("SELECT * FROM interfaces WHERE ontology_id=? ORDER BY name",(oid,)).fetchall()
    conn.close(); return [_row_interface(row) for row in rows]


def get_interface(component_id: str) -> Dict[str, Any]:
    conn=get_conn(); row=conn.execute("SELECT * FROM interfaces WHERE id=?",(component_id,)).fetchone(); conn.close()
    if not row: raise NotFoundError("接口不存在")
    return _row_interface(row)


@_no_leak
def save_interface(oid: str, data: InterfaceBase, component_id: Optional[str]=None) -> Dict[str, Any]:
    get_ontology(oid); _validate_properties(data.properties,False); conn=get_conn()
    conflict=conn.execute("SELECT 1 FROM interfaces WHERE ontology_id=? AND name=? AND id<>?",(oid,data.name,component_id or "")).fetchone()
    if conflict: conn.close(); raise ConflictError("接口 API 名称已存在")
    timestamp=now(); before=None
    if component_id:
        before=conn.execute("SELECT * FROM interfaces WHERE id=? AND ontology_id=?",(component_id,oid)).fetchone()
        if not before: conn.close(); raise NotFoundError("接口不存在")
        if before["status"] == "active" and before["name"] != data.name:
            conn.close(); raise ValidationError("已发布接口不能修改 API 名称")
        conn.execute("UPDATE interfaces SET name=?,display_name=?,description=?,status=?,properties=?,updated_at=?,updated_by=? WHERE id=?",(data.name,data.display_name,data.description,data.status,_json([p.model_dump(exclude={"shared_property_id"}) for p in data.properties]),timestamp,"manual-admin",component_id)); op="update"
    else:
        component_id=str(uuid.uuid4())
        conn.execute("""INSERT INTO interfaces (id,ontology_id,name,display_name,description,status,properties,created_at,updated_at,created_by,updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",(component_id,oid,data.name,data.display_name,data.description,data.status,_json([p.model_dump(exclude={"shared_property_id"}) for p in data.properties]),timestamp,timestamp,"manual-admin","manual-admin")); op="create"
    after=conn.execute("SELECT * FROM interfaces WHERE id=?",(component_id,)).fetchone()
    _log(conn,oid,"interface",component_id,op,f"{'更新' if op=='update' else '创建'}接口 {data.display_name}",before=dict(before) if before else None,after=dict(after))
    conn.execute("UPDATE ontologies SET updated_at=? WHERE id=?",(timestamp,oid)); conn.commit(); conn.close(); return get_interface(component_id)


@_no_leak
def delete_interface(component_id: str) -> None:
    current=get_interface(component_id); conn=get_conn()
    used=[]
    for row in conn.execute("SELECT id,display_name,interface_ids FROM object_types WHERE ontology_id=?",(current["ontology_id"],)).fetchall():
        if component_id in json.loads(row["interface_ids"] or "[]"): used.append(row["display_name"])
    if used: conn.close(); raise ValidationError(f"接口仍被 {len(used)} 个对象类型实现：{'、'.join(used[:5])}")
    if current["status"] == "active": conn.close(); raise ValidationError("已发布接口不能直接删除")
    conn.execute("DELETE FROM interfaces WHERE id=?",(component_id,)); _log(conn,current["ontology_id"],"interface",component_id,"delete",f"删除接口 {current['display_name']}",before=current); conn.commit(); conn.close()


def _row_business_domain(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row)


def list_business_domains(oid: str) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn()
    rows=conn.execute("""SELECT d.*,
        (SELECT COUNT(*) FROM subject_domains s WHERE s.business_domain_id=d.id) subject_count
        FROM business_domains d WHERE d.ontology_id=? ORDER BY d.code""",(oid,)).fetchall()
    conn.close(); return [_row_business_domain(row) for row in rows]


def get_business_domain(component_id: str) -> Dict[str, Any]:
    conn=get_conn(); row=conn.execute("SELECT * FROM business_domains WHERE id=?",(component_id,)).fetchone(); conn.close()
    if not row: raise NotFoundError("业务域不存在")
    return next(item for item in list_business_domains(row["ontology_id"]) if item["id"] == component_id)


@_no_leak
def save_business_domain(oid: str, data: BusinessDomainBase, component_id: Optional[str]=None) -> Dict[str, Any]:
    get_ontology(oid); conn=get_conn()
    if conn.execute("SELECT 1 FROM business_domains WHERE ontology_id=? AND code=? AND id<>?",(oid,data.code,component_id or "")).fetchone():
        conn.close(); raise ConflictError("业务域编码已存在")
    timestamp=now()
    if component_id:
        before=conn.execute("SELECT * FROM business_domains WHERE id=? AND ontology_id=?",(component_id,oid)).fetchone()
        if not before: conn.close(); raise NotFoundError("业务域不存在")
        conn.execute("UPDATE business_domains SET code=?,name=?,description=?,owner=?,status=?,updated_at=?,updated_by=? WHERE id=?",(data.code,data.name,data.description,data.owner,data.status,timestamp,"manual-admin",component_id)); op="update"
    else:
        component_id=str(uuid.uuid4()); before=None
        conn.execute("""INSERT INTO business_domains
            (id,ontology_id,code,name,description,owner,status,created_by,updated_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",(component_id,oid,data.code,data.name,data.description,data.owner,data.status,"manual-admin","manual-admin",timestamp,timestamp)); op="create"
    after=conn.execute("SELECT * FROM business_domains WHERE id=?",(component_id,)).fetchone()
    _log(conn,oid,"business_domain",component_id,op,f"{'更新' if op=='update' else '创建'}业务域 {data.name}",before=dict(before) if before else None,after=dict(after))
    conn.commit(); conn.close(); return get_business_domain(component_id)


def delete_business_domain(component_id: str) -> None:
    current=get_business_domain(component_id); conn=get_conn()
    subject_rows=conn.execute("SELECT id,code FROM subject_domains WHERE business_domain_id=?",(component_id,)).fetchall()
    subject_ids=[row["id"] for row in subject_rows]
    object_count=0
    if subject_ids:
        placeholders=",".join("?" for _ in subject_ids)
        object_count=conn.execute(f"SELECT COUNT(*) c FROM object_types WHERE subject_domain_id IN ({placeholders})",subject_ids).fetchone()["c"]
        conn.execute(f"UPDATE object_types SET subject_domain_id=NULL,updated_at=?,updated_by=? WHERE subject_domain_id IN ({placeholders})",(now(),"manual-admin",*subject_ids))
        conn.execute(f"UPDATE object_type_groups SET subject_domain_id=NULL,updated_at=?,updated_by=? WHERE subject_domain_id IN ({placeholders})",(now(),"manual-admin",*subject_ids))
        _clear_data_source_subject_codes(conn,current["ontology_id"],{row["code"] for row in subject_rows})
        conn.execute("DELETE FROM subject_domains WHERE business_domain_id=?",(component_id,))
    conn.execute("DELETE FROM business_domains WHERE id=?",(component_id,)); _log(conn,current["ontology_id"],"business_domain",component_id,"delete",f"删除业务域 {current['name']}，移除 {len(subject_ids)} 个主题域分类，{object_count} 个对象转为未分类",before=current)
    conn.commit(); conn.close()


def list_subject_domains(oid: str, business_domain_id: Optional[str]=None) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn()
    where="s.ontology_id=?"; params: list[Any]=[oid]
    if business_domain_id: where += " AND s.business_domain_id=?"; params.append(business_domain_id)
    rows=conn.execute(f"""SELECT s.*,d.name business_domain_name,d.code business_domain_code,
        (SELECT COUNT(*) FROM object_types o WHERE o.subject_domain_id=s.id AND COALESCE(o.object_kind,'business_object')='business_object') object_count
        FROM subject_domains s JOIN business_domains d ON d.id=s.business_domain_id
        WHERE {where} ORDER BY d.code,s.code""",params).fetchall()
    conn.close(); return [dict(row) for row in rows]


def get_subject_domain(component_id: str) -> Dict[str, Any]:
    conn=get_conn(); row=conn.execute("SELECT ontology_id FROM subject_domains WHERE id=?",(component_id,)).fetchone(); conn.close()
    if not row: raise NotFoundError("主题域不存在")
    return next(item for item in list_subject_domains(row["ontology_id"]) if item["id"] == component_id)


@_no_leak
def save_subject_domain(oid: str, data: SubjectDomainBase, component_id: Optional[str]=None) -> Dict[str, Any]:
    get_ontology(oid); conn=get_conn()
    if not conn.execute("SELECT 1 FROM business_domains WHERE id=? AND ontology_id=?",(data.business_domain_id,oid)).fetchone():
        conn.close(); raise ValidationError("所属业务域不存在")
    if conn.execute("SELECT 1 FROM subject_domains WHERE ontology_id=? AND code=? AND id<>?",(oid,data.code,component_id or "")).fetchone():
        conn.close(); raise ConflictError("主题域编码已存在")
    timestamp=now()
    if component_id:
        before=conn.execute("SELECT * FROM subject_domains WHERE id=? AND ontology_id=?",(component_id,oid)).fetchone()
        if not before: conn.close(); raise NotFoundError("主题域不存在")
        conn.execute("UPDATE subject_domains SET business_domain_id=?,code=?,name=?,description=?,owner=?,status=?,updated_at=?,updated_by=? WHERE id=?",(data.business_domain_id,data.code,data.name,data.description,data.owner,data.status,timestamp,"manual-admin",component_id)); op="update"
    else:
        component_id=str(uuid.uuid4()); before=None
        conn.execute("""INSERT INTO subject_domains
            (id,ontology_id,business_domain_id,code,name,description,owner,status,created_by,updated_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",(component_id,oid,data.business_domain_id,data.code,data.name,data.description,data.owner,data.status,"manual-admin","manual-admin",timestamp,timestamp)); op="create"
    after=conn.execute("SELECT * FROM subject_domains WHERE id=?",(component_id,)).fetchone()
    _log(conn,oid,"subject_domain",component_id,op,f"{'更新' if op=='update' else '创建'}主题域 {data.name}",before=dict(before) if before else None,after=dict(after))
    conn.commit(); conn.close(); return get_subject_domain(component_id)


def delete_subject_domain(component_id: str) -> None:
    current=get_subject_domain(component_id); conn=get_conn()
    count=conn.execute("SELECT COUNT(*) c FROM object_types WHERE subject_domain_id=?",(component_id,)).fetchone()["c"]
    conn.execute("UPDATE object_types SET subject_domain_id=NULL,updated_at=?,updated_by=? WHERE subject_domain_id=?",(now(),"manual-admin",component_id))
    conn.execute("UPDATE object_type_groups SET subject_domain_id=NULL,updated_at=?,updated_by=? WHERE subject_domain_id=?",(now(),"manual-admin",component_id))
    _clear_data_source_subject_codes(conn,current["ontology_id"],{current["code"]})
    conn.execute("DELETE FROM subject_domains WHERE id=?",(component_id,)); _log(conn,current["ontology_id"],"subject_domain",component_id,"delete",f"删除主题域 {current['name']}，{count} 个对象转为未分类",before=current)
    conn.commit(); conn.close()


def _clear_data_source_subject_codes(conn: sqlite3.Connection, ontology_id: str, subject_codes: set[str]) -> None:
    if not subject_codes or not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='enterprise_data_sources'").fetchone(): return
    for row in conn.execute("SELECT id,payload FROM enterprise_data_sources WHERE ontology_id=?",(ontology_id,)).fetchall():
        payload=json.loads(row["payload"] or "{}")
        if payload.get("subject_domain_code") not in subject_codes: continue
        payload["subject_domain_code"]=None
        conn.execute("UPDATE enterprise_data_sources SET payload=?,updated_at=?,updated_by=? WHERE id=?",(_json(payload),now(),"manual-admin",row["id"]))


def list_object_type_groups(oid: str) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn(); rows=conn.execute("""SELECT g.*,s.name subject_domain_name,s.code subject_domain_code,
        d.id business_domain_id,d.name business_domain_name,d.code business_domain_code
        FROM object_type_groups g
        LEFT JOIN subject_domains s ON s.id=g.subject_domain_id
        LEFT JOIN business_domains d ON d.id=s.business_domain_id
        WHERE g.ontology_id=? ORDER BY d.code,s.code,g.name""",(oid,)).fetchall(); object_rows=conn.execute("SELECT display_name,group_ids FROM object_types WHERE ontology_id=? ORDER BY display_name",(oid,)).fetchall(); conn.close()
    members={row["id"]:[] for row in rows}
    for obj in object_rows:
        for group_id in json.loads(obj["group_ids"] or "[]"):
            if group_id in members: members[group_id].append(obj["display_name"])
    return [{**dict(row),"member_count":len(members[row["id"]]),"member_names":members[row["id"]]} for row in rows]


def get_object_type_group(component_id: str) -> Dict[str, Any]:
    conn=get_conn(); row=conn.execute("SELECT * FROM object_type_groups WHERE id=?",(component_id,)).fetchone(); conn.close()
    if not row: raise NotFoundError("对象类型组不存在")
    return next(item for item in list_object_type_groups(row["ontology_id"]) if item["id"]==component_id)


@_no_leak
def save_object_type_group(oid: str, data: ObjectTypeGroupBase, component_id: Optional[str]=None) -> Dict[str, Any]:
    get_ontology(oid); conn=get_conn(); conflict=conn.execute("SELECT 1 FROM object_type_groups WHERE ontology_id=? AND name=? AND id<>?",(oid,data.name,component_id or "")).fetchone()
    if conflict: conn.close(); raise ConflictError("对象类型组名称已存在")
    if data.subject_domain_id and not conn.execute("SELECT 1 FROM subject_domains WHERE id=? AND ontology_id=?",(data.subject_domain_id,oid)).fetchone():
        conn.close(); raise ValidationError("所属主题域不存在")
    timestamp=now()
    before=None
    if component_id:
        current=conn.execute("SELECT * FROM object_type_groups WHERE id=? AND ontology_id=?",(component_id,oid)).fetchone()
        if not current: conn.close(); raise NotFoundError("对象类型组不存在")
        before=dict(current)
        conn.execute("UPDATE object_type_groups SET name=?,description=?,color=?,subject_domain_id=?,updated_at=?,updated_by=? WHERE id=?",(data.name,data.description,data.color,data.subject_domain_id,timestamp,"manual-admin",component_id)); op="update"
    else:
        component_id=str(uuid.uuid4()); conn.execute("""INSERT INTO object_type_groups
            (id,ontology_id,name,description,color,subject_domain_id,created_at,updated_at,created_by,updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?)""",(component_id,oid,data.name,data.description,data.color,data.subject_domain_id,timestamp,timestamp,"manual-admin","manual-admin")); op="create"
    after=dict(conn.execute("SELECT * FROM object_type_groups WHERE id=?",(component_id,)).fetchone())
    _log(conn,oid,"object_type_group",component_id,op,f"{'更新' if op=='update' else '创建'}对象类型组 {data.name}",before=before,after=after); conn.commit(); conn.close(); return get_object_type_group(component_id)


def delete_object_type_group(component_id: str) -> None:
    current=get_object_type_group(component_id); used=[obj for obj in list_object_types(current["ontology_id"]) if component_id in obj["group_ids"]]
    if used: raise ValidationError(f"对象类型组仍包含 {len(used)} 个对象类型")
    conn=get_conn(); conn.execute("DELETE FROM object_type_groups WHERE id=?",(component_id,)); _log(conn,current["ontology_id"],"object_type_group",component_id,"delete",f"删除对象类型组 {current['name']}",before=current); conn.commit(); conn.close()


def _row_business_rule(row: sqlite3.Row) -> Dict[str, Any]:
    data = dict(row)
    data["input_fields"] = json.loads(data.get("input_fields") or "[]")
    data["test_case"] = json.loads(data.get("test_case") or "{}")
    data["reusable"] = bool(data.get("reusable", 1))
    data.update(json.loads(data.pop("metadata", "{}") or "{}"))
    return data


def list_business_rules(oid: str) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn()
    rows=conn.execute("""SELECT r.*,o.display_name target_display_name
        FROM business_rules r JOIN object_types o ON o.id=r.target_object_type_id
        WHERE r.ontology_id=? ORDER BY r.severity,r.name""",(oid,)).fetchall()
    conn.close(); return [_row_business_rule(row) for row in rows]


def get_business_rule(component_id: str) -> Dict[str, Any]:
    conn=get_conn(); row=conn.execute("SELECT * FROM business_rules WHERE id=?",(component_id,)).fetchone(); conn.close()
    if not row: raise NotFoundError("业务规则不存在")
    return _row_business_rule(row)


@_no_leak
def save_business_rule(oid: str, data: BusinessRuleBase, component_id: Optional[str]=None) -> Dict[str, Any]:
    get_ontology(oid); conn=get_conn(); _ensure_object_in_ontology(conn,oid,data.target_object_type_id)
    conflict=conn.execute("SELECT 1 FROM business_rules WHERE ontology_id=? AND name=? AND id<>?",(oid,data.name,component_id or "")).fetchone()
    if conflict: conn.close(); raise ConflictError("业务规则 API 名称已存在")
    timestamp=now()
    before=None
    if component_id:
        current=conn.execute("SELECT * FROM business_rules WHERE id=? AND ontology_id=?",(component_id,oid)).fetchone()
        if not current: conn.close(); raise NotFoundError("业务规则不存在")
        before=dict(current)
        if current["status"] == "active" and current["name"] != data.name: conn.close(); raise ValidationError("Active 业务规则不能修改 API 名称")
        conn.execute("""UPDATE business_rules SET name=?,display_name=?,target_object_type_id=?,category=?,severity=?,expression=?,
            implementation_type=?,input_fields=?,output_description=?,trigger_mode=?,realtime_requirement=?,reusable=?,owner=?,test_case=?,
            description=?,remediation=?,status=?,updated_at=?,updated_by=? WHERE id=?""",
            (data.name,data.display_name,data.target_object_type_id,data.category,data.severity,data.expression,
             data.implementation_type,_json(data.input_fields),data.output_description,data.trigger_mode,data.realtime_requirement,int(data.reusable),data.owner,_json(data.test_case),
             data.description,data.remediation,data.status,timestamp,"manual-admin",component_id)); op="update"
    else:
        component_id=str(uuid.uuid4())
        conn.execute("""INSERT INTO business_rules
            (id,ontology_id,name,display_name,target_object_type_id,category,severity,expression,description,remediation,status,created_at,updated_at,
             implementation_type,input_fields,output_description,trigger_mode,realtime_requirement,reusable,owner,test_case,created_by,updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (component_id,oid,data.name,data.display_name,data.target_object_type_id,data.category,data.severity,data.expression,data.description,data.remediation,data.status,timestamp,timestamp,
             data.implementation_type,_json(data.input_fields),data.output_description,data.trigger_mode,data.realtime_requirement,int(data.reusable),data.owner,_json(data.test_case),"manual-admin","manual-admin")); op="create"
    after=dict(conn.execute("SELECT * FROM business_rules WHERE id=?",(component_id,)).fetchone())
    _log(conn,oid,"business_rule",component_id,op,f"{'更新' if op=='update' else '创建'}业务规则 {data.display_name}",before=before,after=after)
    conn.execute("UPDATE ontologies SET updated_at=? WHERE id=?",(timestamp,oid)); conn.commit(); conn.close(); return get_business_rule(component_id)


def delete_business_rule(component_id: str) -> None:
    current=get_business_rule(component_id)
    if current["status"] == "active": raise ValidationError("Active 业务规则不能直接删除，请先标记为 Deprecated")
    conn=get_conn(); conn.execute("DELETE FROM business_rules WHERE id=?",(component_id,)); _log(conn,current["ontology_id"],"business_rule",component_id,"delete",f"删除业务规则 {current['display_name']}",before=current); conn.commit(); conn.close()


# 规则表达式在进程内 eval，必须先把能造成指数级膨胀的写法挡掉：
# `9**9**9` 会算出约 3.7 亿位整数，`"a"*999999999` 会撑爆内存，两者都能挂死请求。
RULE_EXPRESSION_MAX_LENGTH = 2000
RULE_CONSTANT_MAX_INT_BITS = 64
RULE_CONSTANT_MAX_STR_LENGTH = 1000


def _evaluate_rule_expression(expression: str, sample_data: Dict[str, Any]) -> Any:
    """Evaluate the tiny, deterministic expression subset used by the prototype."""
    if len(expression) > RULE_EXPRESSION_MAX_LENGTH:
        raise ValidationError(f"规则表达式过长（上限 {RULE_EXPRESSION_MAX_LENGTH} 字符）")
    flattened: Dict[str, Any] = {}

    def walk(prefix: str, value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                walk(f"{prefix}.{key}" if prefix else key, child)
        else:
            flattened[prefix] = value

    walk("", sample_data)
    normalized = expression.replace("&&", " and ").replace("||", " or ")
    normalized = re.sub(r"\btrue\b", "True", normalized, flags=re.I)
    normalized = re.sub(r"\bfalse\b", "False", normalized, flags=re.I)
    bindings: Dict[str, Any] = {}
    protected = {"and", "or", "not", "in", "True", "False", "None", "abs", "min", "max", "sum", "round"}

    def replace_token(match: re.Match[str]) -> str:
        token = match.group(0)
        if token in protected or token.isdigit():
            return token
        if token not in flattened:
            return token
        placeholder = f"_v{len(bindings)}"
        bindings[placeholder] = flattened[token]
        return placeholder

    normalized = re.sub(r"\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\b", replace_token, normalized)
    tree = ast.parse(normalized, mode="eval")
    allowed = (
        ast.Expression, ast.BoolOp, ast.BinOp, ast.UnaryOp, ast.Compare, ast.Name, ast.Load,
        ast.Constant, ast.List, ast.Tuple, ast.And, ast.Or, ast.Not, ast.Add, ast.Sub,
        ast.Mult, ast.Div, ast.Mod, ast.USub, ast.UAdd, ast.Eq, ast.NotEq,
        ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn, ast.Call,
    )
    for node in ast.walk(tree):
        if isinstance(node, ast.Pow):
            raise ValidationError("规则表达式不支持幂运算（**），请改用乘法")
        if isinstance(node, ast.Constant):
            value = node.value
            if isinstance(value, int) and not isinstance(value, bool) and value.bit_length() > RULE_CONSTANT_MAX_INT_BITS:
                raise ValidationError("规则表达式的整数常量过大")
            if isinstance(value, str) and len(value) > RULE_CONSTANT_MAX_STR_LENGTH:
                raise ValidationError("规则表达式的字符串常量过长")
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
            # `"a" * 999999999` 逐字面量膨胀，必须在求值前拦下。
            for side in (node.left, node.right):
                if isinstance(side, ast.Constant) and isinstance(side.value, (str, bytes, list, tuple)):
                    raise ValidationError("规则表达式不能用常量序列做乘法")
        if not isinstance(node, allowed):
            raise ValidationError(f"规则表达式包含不支持的语法：{type(node).__name__}")
        if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or node.func.id not in {"abs", "min", "max", "sum", "round"}):
            raise ValidationError("规则函数只允许 abs、min、max、sum、round")
        if isinstance(node, ast.Name) and node.id not in bindings and node.id not in protected:
            raise ValidationError(f"测试数据缺少字段：{node.id}")
    safe_functions = {"abs": abs, "min": min, "max": max, "sum": sum, "round": round}
    return eval(compile(tree, "<ontology-rule>", "eval"), {"__builtins__": {}}, {**safe_functions, **bindings})


def test_business_rule(component_id: str, sample_data: Dict[str, Any]) -> Dict[str, Any]:
    rule = get_business_rule(component_id)
    data = sample_data or rule.get("test_case") or {}
    if not data:
        instances = list_object_instances(rule["ontology_id"], rule["target_object_type_id"])
        if instances:
            data = {instances[0]["object_type_name"].replace("Request", "").lower(): instances[0]["properties"], **instances[0]["properties"]}
    if rule["implementation_type"] in {"description", "workflow", "model"}:
        return {"status": "not_executable", "passed": None, "result": None, "input": data, "trace": ["当前实现方式需要外部执行器，未将文字说明伪装成可执行规则。"]}
    try:
        result = _evaluate_rule_expression(rule["expression"], data)
        return {"status": "completed", "passed": bool(result), "result": result, "input": data, "trace": ["解析受限表达式", "绑定样例字段", "执行确定性计算", "返回布尔或计算结果"]}
    except (SyntaxError, TypeError, ValueError, ValidationError) as exc:
        return {"status": "failed", "passed": False, "result": None, "input": data, "error": str(exc), "trace": ["解析受限表达式", "执行前校验失败"]}


def _row_instance(row: sqlite3.Row) -> Dict[str, Any]:
    data=dict(row)
    data["properties"]=json.loads(data.get("properties") or "{}")
    data.update(json.loads(data.pop("metadata", "{}") or "{}"))
    data.setdefault("sync_status", "synced")
    data.setdefault("quality_status", "passed")
    return data


def list_object_instances(oid: str, object_type_id: Optional[str]=None) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn(); params=[oid]
    where="i.ontology_id=?"
    if object_type_id:
        _ensure_object_in_ontology(conn,oid,object_type_id); where+=" AND i.object_type_id=?"; params.append(object_type_id)
    rows=conn.execute(f"""SELECT i.*,o.display_name object_type_display_name,o.name object_type_name,o.icon object_type_icon
        FROM object_instances i JOIN object_types o ON o.id=i.object_type_id
        WHERE {where} ORDER BY o.display_name,i.title""",params).fetchall()
    conn.close(); return [_row_instance(row) for row in rows]


@_no_leak
def get_object_instance(component_id: str) -> Dict[str, Any]:
    conn=get_conn(); row=conn.execute("""SELECT i.*,o.display_name object_type_display_name,o.name object_type_name,o.icon object_type_icon
        FROM object_instances i JOIN object_types o ON o.id=i.object_type_id WHERE i.id=?""",(component_id,)).fetchone()
    if not row: conn.close(); raise NotFoundError("对象实例不存在")
    data=_row_instance(row)
    related=conn.execute("""SELECT li.id,li.link_type_id,lt.display_name link_display_name,lt.name link_name,
        CASE WHEN li.source_instance_id=? THEN 'outgoing' ELSE 'incoming' END direction,
        other.id related_instance_id,other.title related_title,other.business_key related_business_key,
        ot.display_name related_object_type,ot.icon related_object_icon
        FROM link_instances li JOIN link_types lt ON lt.id=li.link_type_id
        JOIN object_instances other ON other.id=CASE WHEN li.source_instance_id=? THEN li.target_instance_id ELSE li.source_instance_id END
        JOIN object_types ot ON ot.id=other.object_type_id
        WHERE li.source_instance_id=? OR li.target_instance_id=? ORDER BY lt.display_name,other.title""",(component_id,component_id,component_id,component_id)).fetchall()
    conn.close(); data["related"]=[dict(item) for item in related]; return data


def _validate_instance_properties(obj: Dict[str, Any], properties: Dict[str, Any]) -> None:
    definitions={item["key"]:item for item in obj.get("effective_properties", obj["properties"])}
    unknown=set(properties)-set(definitions)
    if unknown: raise ValidationError(f"实例包含未定义属性：{', '.join(sorted(unknown))}")
    missing=[item["name"] for item in definitions.values() if item.get("is_required") and properties.get(item["key"]) in (None,"")]
    if missing: raise ValidationError(f"实例缺少必填属性：{'、'.join(missing)}")


@_no_leak
def save_object_instance(oid: str, data: ObjectInstanceBase, component_id: Optional[str]=None) -> Dict[str, Any]:
    get_ontology(oid); conn=get_conn(); _ensure_object_in_ontology(conn,oid,data.object_type_id); conn.close()
    obj=get_object_type(data.object_type_id)
    if obj["object_kind"] == "abstract_type": raise ValidationError("抽象类型不能直接创建实例")
    _validate_instance_properties(obj,data.properties)
    conn=get_conn(); conflict=conn.execute("SELECT 1 FROM object_instances WHERE ontology_id=? AND object_type_id=? AND business_key=? AND id<>?",(oid,data.object_type_id,data.business_key,component_id or "")).fetchone()
    if conflict: conn.close(); raise ConflictError("该对象类型下的业务主键已存在")
    timestamp=now()
    if component_id:
        current=conn.execute("SELECT 1 FROM object_instances WHERE id=? AND ontology_id=?",(component_id,oid)).fetchone()
        if not current: conn.close(); raise NotFoundError("对象实例不存在")
        conn.execute("""UPDATE object_instances SET object_type_id=?,business_key=?,title=?,properties=?,record_status=?,
            sync_status=?,source_system=?,source_pk=?,last_synced_at=?,sync_error=?,quality_status=?,metadata=?,updated_at=?,updated_by=? WHERE id=?""",
            (data.object_type_id,data.business_key,data.title,_json(data.properties),data.record_status,
             data.sync_status,data.source_system,data.source_pk or data.business_key,data.last_synced_at or timestamp,data.sync_error,data.quality_status,
             _json({"external_id": data.external_id, "source_summary": data.source_summary, "template_sheet": data.template_sheet, "template_row": data.template_row}),timestamp,"manual-admin",component_id)); op="update"
    else:
        component_id=str(uuid.uuid4())
        conn.execute("""INSERT INTO object_instances
            (id,ontology_id,object_type_id,business_key,title,properties,record_status,created_at,updated_at,
             sync_status,source_system,source_pk,last_synced_at,sync_error,quality_status,metadata,created_by,updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (component_id,oid,data.object_type_id,data.business_key,data.title,_json(data.properties),data.record_status,timestamp,timestamp,
             data.sync_status,data.source_system,data.source_pk or data.business_key,data.last_synced_at or timestamp,data.sync_error,data.quality_status,
             _json({"external_id": data.external_id, "source_summary": data.source_summary, "template_sheet": data.template_sheet, "template_row": data.template_row}),"manual-admin","manual-admin")); op="create"
    _log(conn,oid,"object_instance",component_id,op,f"{'更新' if op=='update' else '创建'}实例 {data.title}"); conn.commit(); conn.close(); return get_object_instance(component_id)


def delete_object_instance(component_id: str) -> None:
    current=get_object_instance(component_id); conn=get_conn(); conn.execute("DELETE FROM object_instances WHERE id=?",(component_id,)); _log(conn,current["ontology_id"],"object_instance",component_id,"delete",f"删除实例 {current['title']}"); conn.commit(); conn.close()


def list_link_instances(oid: str) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn(); rows=conn.execute("""SELECT li.*,lt.display_name link_display_name,
        s.title source_title,t.title target_title FROM link_instances li
        JOIN link_types lt ON lt.id=li.link_type_id JOIN object_instances s ON s.id=li.source_instance_id
        JOIN object_instances t ON t.id=li.target_instance_id WHERE li.ontology_id=? ORDER BY lt.display_name,s.title""",(oid,)).fetchall(); conn.close()
    return [{**dict(row),"properties":json.loads(row["properties"] or "{}")} for row in rows]


@_no_leak
def save_link_instance(oid: str, data: LinkInstanceBase) -> Dict[str, Any]:
    get_ontology(oid); conn=get_conn()
    link=conn.execute("SELECT * FROM link_types WHERE id=? AND ontology_id=?",(data.link_type_id,oid)).fetchone()
    source=conn.execute("SELECT * FROM object_instances WHERE id=? AND ontology_id=?",(data.source_instance_id,oid)).fetchone()
    target=conn.execute("SELECT * FROM object_instances WHERE id=? AND ontology_id=?",(data.target_instance_id,oid)).fetchone()
    if not link or not source or not target: conn.close(); raise ValidationError("关系或实例不属于当前本体")
    if source["object_type_id"] != link["source_object_type_id"] or target["object_type_id"] != link["target_object_type_id"]:
        conn.close(); raise ValidationError("实例类型与关系端点定义不一致")
    existing=conn.execute("SELECT id FROM link_instances WHERE link_type_id=? AND source_instance_id=? AND target_instance_id=?",(data.link_type_id,data.source_instance_id,data.target_instance_id)).fetchone()
    if existing: conn.close(); return next(item for item in list_link_instances(oid) if item["id"]==existing["id"])
    cid,timestamp=str(uuid.uuid4()),now(); conn.execute("""INSERT INTO link_instances
        (id,ontology_id,link_type_id,source_instance_id,target_instance_id,properties,created_at,updated_at,created_by,updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)""",(cid,oid,data.link_type_id,data.source_instance_id,data.target_instance_id,_json(data.properties),timestamp,timestamp,"manual-admin","manual-admin")); conn.commit(); conn.close()
    return next(item for item in list_link_instances(oid) if item["id"]==cid)


@_no_leak
def delete_link_instance(component_id: str) -> None:
    conn=get_conn(); row=conn.execute("SELECT * FROM link_instances WHERE id=?",(component_id,)).fetchone()
    if not row: conn.close(); raise NotFoundError("关系实例不存在")
    conn.execute("DELETE FROM link_instances WHERE id=?",(component_id,)); conn.commit(); conn.close()


def graph(oid: str) -> Dict[str, Any]:
    objects=list_object_types(oid); links=list_link_types(oid)
    relation_edges=[{"id":l["id"],"from":l["source_object_type_id"],"to":l["target_object_type_id"],"label":l["display_name"],"cardinality":l["cardinality"],"kind":"link"} for l in links]
    return {"nodes":[{
        "id":o["id"], "label":o["display_name"], "name":o["name"], "icon":o["icon"],
        "status":o["status"], "object_kind":o.get("object_kind", "business_object"),
        "property_count":o["effective_property_count"], "external_id":o.get("external_id"),
        "category":o.get("category"), "domain":o.get("domain"),
        "business_domain_id":o.get("business_domain_id"), "business_domain_name":o.get("business_domain_name"),
        "business_domain_code":o.get("business_domain_code"), "subject_domain_id":o.get("subject_domain_id"),
        "subject_domain_name":o.get("subject_domain_name"), "subject_domain_code":o.get("subject_domain_code"),
        "design_status":o.get("design_status"), "is_core":o.get("is_core", False),
    } for o in objects],"edges":relation_edges}


def validate_ontology(oid: str) -> Dict[str, Any]:
    objects=list_object_types(oid); interfaces=list_interfaces(oid)
    links=list_link_types(oid); actions=list_actions(oid); rules=list_business_rules(oid); errors=[]; warnings=[]
    for obj in objects:
        props=obj["effective_properties"]; pks=[p for p in props if p.get("is_primary_key")]
        if len(pks)!=1: errors.append({"component":"object_type","id":obj["id"],"message":f"{obj['display_name']} 必须有且只有一个主键"})
        if obj["title_property"] not in {p["key"] for p in props}: errors.append({"component":"object_type","id":obj["id"],"message":f"{obj['display_name']} 的标题属性无效"})
        if not obj["description"]: warnings.append({"component":"object_type","id":obj["id"],"message":f"{obj['display_name']} 缺少业务说明"})
        local={prop["key"]:prop for prop in obj["properties"]}
        for interface_id in obj.get("interface_ids",[]):
            interface=next((item for item in interfaces if item["id"]==interface_id),None)
            if not interface: errors.append({"component":"interface","id":obj["id"],"message":f"{obj['display_name']} 引用了不存在的接口"}); continue
            for required in interface["properties"]:
                if required["key"] not in local or local[required["key"]]["type"] != required["type"]:
                    errors.append({"component":"interface","id":obj["id"],"message":f"{obj['display_name']} 未正确实现接口 {interface['display_name']} 的属性 {required['name']}"})
    known={o["id"] for o in objects}
    for link in links:
        if link["source_object_type_id"] not in known or link["target_object_type_id"] not in known: errors.append({"component":"link_type","id":link["id"],"message":f"{link['display_name']} 存在无效端点"})
        endpoint_statuses=[next((obj["status"] for obj in objects if obj["id"]==cid),None) for cid in (link["source_object_type_id"],link["target_object_type_id"])]
        if link["status"] == "active" and any(status not in ("active","promoted") for status in endpoint_statuses): errors.append({"component":"link_type","id":link["id"],"message":f"{link['display_name']} 为 Active，但端点对象尚未 Active"})
    for action in actions:
        if action["target_object_type_id"] not in known: errors.append({"component":"action","id":action["id"],"message":f"{action['display_name']} 目标对象无效"})
        if action["action_type"]=="modify" and not action["parameters"]: warnings.append({"component":"action","id":action["id"],"message":f"{action['display_name']} 没有参数"})
    for rule in rules:
        if rule["target_object_type_id"] not in known: errors.append({"component":"business_rule","id":rule["id"],"message":f"{rule['display_name']} 目标对象无效"})
        if not rule["expression"].strip(): errors.append({"component":"business_rule","id":rule["id"],"message":f"{rule['display_name']} 缺少规则表达式"})
    unclassified=[item for item in objects if not item.get("subject_domain_id")]
    if unclassified: errors.append({"component":"classification","id":unclassified[0]["id"],"message":f"{len(unclassified)} 个对象类型尚未归入主题域，不能发布"})
    # key 供质检按维度分段执行（见 governance_insights.QUALITY_DIMENSIONS）；name 是给人看的标签。
    checks=[{"key":"object_type","name":"对象主键与标题属性","passed":not any(e["component"]=="object_type" for e in errors)},{"key":"link_type","name":"关系端点与状态一致","passed":not any(e["component"]=="link_type" for e in errors)},{"key":"action","name":"动作目标与参数","passed":not any(e["component"]=="action" for e in errors)},{"key":"business_rule","name":"业务规则目标与表达式","passed":not any(e["component"]=="business_rule" for e in errors)},{"key":"interface","name":"接口实现完整","passed":not any(e["component"]=="interface" for e in errors)},{"key":"classification","name":"业务域与主题域分类","passed":not unclassified},{"key":"ontology","name":"模型至少包含一个业务对象类型","passed":bool(objects)}]
    if not objects: errors.append({"component":"ontology","id":oid,"message":"本体至少需要一个对象类型"})
    return {"valid":not errors,"checks":checks,"errors":errors,"warnings":warnings,"stats":{"object_types":len(objects),"link_types":len(links),"actions":len(actions),"business_rules":len(rules),"interfaces":len(interfaces),"business_domains":len(list_business_domains(oid)),"subject_domains":len(list_subject_domains(oid))}}


def release_preview(oid: str) -> Dict[str, Any]:
    current = get_ontology(oid)
    pending = changes(oid, None, True)
    breaking = [item for item in pending if item["operation"] == "delete" or any(token in item["summary"] for token in ("主键", "API 名称", "反转", "收紧"))]
    impacted_types = sorted({item["component_type"] for item in pending})
    scenarios = []
    from enterprise import list_resources
    scenarios = [item["name"] for item in list_resources(oid, "business-scenarios")]
    compatibility = "breaking" if breaking else ("additive" if any(item["operation"] == "create" for item in pending) else "compatible")
    return {
        "ontology": current,
        "pending": pending,
        "compatibility": compatibility,
        "breaking_changes": breaking,
        "impacted_resource_types": impacted_types,
        "impacted_scenarios": scenarios if pending else [],
        "recommended_bump": "major" if breaking else ("minor" if compatibility == "additive" else "patch"),
    }


def submit_review(oid: str) -> Dict[str, Any]:
    current = get_ontology(oid)
    if current["status"] != "draft":
        raise ValidationError("只有设计中的工作状态可以提交评审")
    if not changes(oid, 1, True):
        raise ValidationError("当前没有待评审变更")
    report = validate_ontology(oid)
    if not report["valid"]:
        raise ValidationError("本体校验未通过，不能提交评审")
    from governance_insights import latest_passing_quality
    if not latest_passing_quality(oid):
        raise ValidationError("请先对当前模型运行并通过本体质检")
    conn = get_conn()
    timestamp = now()
    conn.execute("UPDATE ontologies SET status='in_review',updated_at=? WHERE id=?", (timestamp, oid))
    _record_workflow_event(conn, oid, "review_submit", "提交本体工作状态评审", timestamp)
    conn.commit(); conn.close()
    return get_ontology(oid)


def approve_review(oid: str) -> Dict[str, Any]:
    current = get_ontology(oid)
    if current["status"] != "in_review":
        raise ValidationError("只有待评审状态可以完成评审")
    report = validate_ontology(oid)
    if not report["valid"]:
        raise ValidationError("本体校验未通过，不能完成评审")
    from governance_insights import latest_passing_quality
    if not latest_passing_quality(oid):
        raise ValidationError("质检结果已过期或未通过，请重新质检")
    conn = get_conn()
    timestamp = now()
    conn.execute("UPDATE ontologies SET status='reviewed',updated_at=? WHERE id=?", (timestamp, oid))
    _record_workflow_event(conn, oid, "review_approve", "本体工作状态评审通过", timestamp)
    conn.commit(); conn.close()
    return get_ontology(oid)


def derive_working_state(oid: str) -> Dict[str, Any]:
    current = get_ontology(oid)
    if current["status"] != "published":
        return current
    conn = get_conn()
    timestamp = now()
    conn.execute("UPDATE ontologies SET status='draft',based_on_version=version,updated_at=? WHERE id=?", (timestamp, oid))
    _record_workflow_event(conn, oid, "derive", f"从 {current['version']} 派生工作状态", timestamp)
    conn.commit(); conn.close()
    return get_ontology(oid)


def _record_workflow_event(conn: sqlite3.Connection, oid: str, operation: str, summary: str, timestamp: str) -> None:
    """Review transitions are audit events, not unpublished model edits."""
    conn.execute("""INSERT INTO change_log
        (id,ontology_id,component_type,component_id,operation,summary,actor,created_at,pending)
        VALUES (?,?,?,?,?,?,?,?,0)""",
        (str(uuid.uuid4()), oid, "ontology", oid, operation, summary, audit_actor(), timestamp))


def release_history(oid: str) -> list[Dict[str, Any]]:
    get_ontology(oid)
    conn = get_conn()
    rows = conn.execute("SELECT id,ontology_id,version,status,compatibility,change_reason,reviewer,change_summary,created_at FROM ontology_releases WHERE ontology_id=? ORDER BY created_at DESC", (oid,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@_no_leak
def publish(oid: str, bump: str="minor", change_reason: str="工作状态变更发布", reviewer: str="") -> Dict[str, Any]:
    pending = changes(oid,None,True)
    if not pending: raise ValidationError("当前没有需要发布的本体变更")
    report=validate_ontology(oid)
    if not report["valid"]: raise ValidationError("本体校验未通过，无法发布")
    current=get_ontology(oid)
    if current["status"] != "reviewed":
        raise ValidationError("请先提交并通过评审，再发布本体")
    from governance_insights import _current_semantic_snapshot, _fingerprint, latest_passing_quality
    quality = latest_passing_quality(oid)
    if not quality:
        raise ValidationError("请对当前模型运行并通过本体质检，再发布本体")
    parts=[int(x) for x in current["version"].lstrip("v").split(".")]
    while len(parts)<3: parts.append(0)
    if bump == "major": parts=[parts[0]+1,0,0]
    elif bump == "patch": parts[2]+=1
    else: parts=[parts[0],parts[1]+1,0]
    version="v"+".".join(map(str,parts)); timestamp=now()
    preview=release_preview(oid)
    summary=f"{len(pending)} 项变更；影响 {len(preview['impacted_resource_types'])} 类资源；兼容性 {preview['compatibility']}"
    conn=get_conn(); conn.execute("BEGIN IMMEDIATE")
    if conn.execute("SELECT status FROM ontologies WHERE id=?", (oid,)).fetchone()["status"] != "reviewed":
        conn.rollback(); conn.close()
        raise ValidationError("模型状态已发生变化，请刷新后重新评审")
    snapshot=_current_semantic_snapshot(oid)
    if _fingerprint(snapshot) != quality["model_fingerprint"]:
        conn.rollback(); conn.close()
        raise ValidationError("质检后模型已有变化，请重新质检")
    review_event = conn.execute("""SELECT actor FROM change_log WHERE ontology_id=?
        AND operation='review_approve' ORDER BY created_at DESC LIMIT 1""", (oid,)).fetchone()
    reviewer = reviewer.strip() or (review_event["actor"] if review_event else audit_actor())
    snapshot["ontology"]={**snapshot["ontology"],"status":"published","version":version,"based_on_version":version}
    for section in ("object_types", "link_types", "actions", "business_rules", "interfaces"):
        for item in snapshot.get(section, []):
            if item.get("status") == "experimental": item["status"] = "active"
    for rows in snapshot.get("enterprise_resources", {}).values():
        for item in rows:
            if item.get("status") in ("draft", "proposal"): item["status"] = "active"
    conn.execute("UPDATE ontologies SET status='published',version=?,based_on_version=?,updated_at=? WHERE id=?",(version,version,timestamp,oid)); conn.execute("UPDATE object_types SET status='active' WHERE ontology_id=? AND status='experimental'",(oid,)); conn.execute("UPDATE link_types SET status='active' WHERE ontology_id=? AND status='experimental'",(oid,)); conn.execute("UPDATE actions SET status='active' WHERE ontology_id=? AND status='experimental'",(oid,)); conn.execute("UPDATE business_rules SET status='active' WHERE ontology_id=? AND status='experimental'",(oid,)); conn.execute("UPDATE shared_properties SET status='active' WHERE ontology_id=? AND status='experimental'",(oid,)); conn.execute("UPDATE interfaces SET status='active' WHERE ontology_id=? AND status='experimental'",(oid,))
    conn.execute("""INSERT INTO ontology_releases
        (id,ontology_id,version,status,compatibility,change_reason,reviewer,change_summary,snapshot,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (str(uuid.uuid4()),oid,version,"published",preview["compatibility"],change_reason,reviewer,summary,_json(snapshot),timestamp))
    # 这里不能吞异常：企业资源（数据源、映射、场景等）没被置为 active 却照样发布，
    # 会得到"发布成功但工作状态与版本不一致"的结果。
    from enterprise import RESOURCE_TABLES
    for table,_ in RESOURCE_TABLES.values(): conn.execute(f"UPDATE {table} SET status='active',updated_at=? WHERE ontology_id=? AND status IN ('draft','proposal')",(timestamp,oid))
    conn.execute("UPDATE mdl_ver_chg SET mvc_ver_no=?,mvc_pub_date=?,mvc_reviewer=?,mvc_chg_reason=? WHERE mvc_ontology_id=? AND mvc_pending=1",
                 (version, timestamp[:10], reviewer, change_reason, oid))
    conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=? AND pending=1",(oid,))
    # Cover rows projected before the local legacy-ID bridge was introduced.
    conn.execute("UPDATE mdl_ver_chg SET mvc_pending=0,mvc_status='已发布',mvc_updated_at=? WHERE mvc_ontology_id=? AND mvc_pending=1",(timestamp,oid))
    conn.execute("""INSERT INTO change_log
        (id,ontology_id,component_type,component_id,operation,summary,actor,created_at,pending)
        VALUES (?,?,?,?,?,?,?,?,0)""",
        (str(uuid.uuid4()),oid,"ontology",oid,"publish",f"发布本体版本 {version}",audit_actor(),timestamp))
    conn.execute("""UPDATE mdl_ver_chg SET mvc_ver_no=?,mvc_pub_date=?,mvc_reviewer=?,
           mvc_chg_reason=?,mvc_chg_content=?,mvc_status='已发布'
           WHERE mvc_id=(SELECT mvc_id FROM mdl_ver_chg WHERE mvc_ontology_id=? AND mvc_chg_type='发布' ORDER BY mvc_id DESC LIMIT 1)""",
           (version, timestamp[:10], reviewer, change_reason, summary, oid))
    conn.commit(); conn.close()
    result=get_ontology(oid); result["release"]={"version":version,"compatibility":preview["compatibility"],"change_summary":summary}; return result


def _init_model_change_table(conn: sqlite3.Connection) -> None:
    """Local V4.5.3 projection, kept in the same transaction as legacy writes."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS mdl_ver_chg (
          mvc_id INTEGER PRIMARY KEY AUTOINCREMENT,
          mvc_ver_no TEXT, mvc_pending INTEGER NOT NULL DEFAULT 1,
          mvc_res_type TEXT, mvc_chg_date TEXT, mvc_chg_obj TEXT,
          mvc_chg_type TEXT, mvc_chg_content TEXT, mvc_chg_reason TEXT,
          mvc_impact_scn TEXT, mvc_impact_elem TEXT, mvc_reviewer TEXT,
          mvc_pub_date TEXT, mvc_remark TEXT, mvc_status TEXT,
          mvc_source TEXT, mvc_quality_issues_resolved TEXT,
          mvc_ontology_id TEXT NOT NULL, mvc_created_by TEXT,
          mvc_created_at TEXT, mvc_updated_by TEXT, mvc_updated_at TEXT,
          mvc_extend_params TEXT, mvc_change_note TEXT,
          mvc_legacy_change_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_mvc_ontology_created ON mdl_ver_chg(mvc_ontology_id,mvc_created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_mvc_resource ON mdl_ver_chg(mvc_ontology_id,mvc_res_type,mvc_chg_obj,mvc_id DESC);
    """)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(mdl_ver_chg)").fetchall()}
    if "mvc_legacy_change_id" not in columns:
        conn.execute("ALTER TABLE mdl_ver_chg ADD COLUMN mvc_legacy_change_id TEXT")
    migrated = conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key='v4-model-changes-backfill'").fetchone()
    if not migrated:
        conn.execute("""INSERT INTO mdl_ver_chg
            (mvc_pending,mvc_res_type,mvc_chg_date,mvc_chg_obj,mvc_chg_type,mvc_chg_content,
             mvc_status,mvc_ontology_id,mvc_created_by,mvc_created_at,mvc_change_note,mvc_legacy_change_id)
            SELECT pending,component_type,substr(created_at,1,10),component_id,
                   CASE operation WHEN 'create' THEN '新增' WHEN 'update' THEN '修改'
                     WHEN 'delete' THEN '删除' WHEN 'publish' THEN '发布'
                     WHEN 'import' THEN '导入' ELSE operation END,
                   summary,CASE WHEN operation='publish' THEN '已发布' WHEN pending=1 THEN '设计中' ELSE NULL END,
                   ontology_id,actor,created_at,change_note,id FROM change_log ORDER BY created_at""")
        conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)",
                     ("v4-model-changes-backfill", now()))
    conn.executescript("""
        DROP TRIGGER IF EXISTS trg_change_log_to_mvc_insert;
        DROP TRIGGER IF EXISTS trg_change_log_to_mvc_archive;
        CREATE TRIGGER IF NOT EXISTS trg_change_log_to_mvc_insert AFTER INSERT ON change_log
        BEGIN
          INSERT INTO mdl_ver_chg
            (mvc_pending,mvc_res_type,mvc_chg_date,mvc_chg_obj,mvc_chg_type,mvc_chg_content,
             mvc_status,mvc_ontology_id,mvc_created_by,mvc_created_at,mvc_change_note,mvc_legacy_change_id)
          VALUES (NEW.pending,NEW.component_type,substr(NEW.created_at,1,10),NEW.component_id,
             CASE NEW.operation WHEN 'create' THEN '新增' WHEN 'update' THEN '修改'
               WHEN 'delete' THEN '删除' WHEN 'publish' THEN '发布'
               WHEN 'import' THEN '导入' ELSE NEW.operation END,
             NEW.summary,CASE WHEN NEW.operation='publish' THEN '已发布' WHEN NEW.pending=1 THEN '设计中' ELSE NULL END,
             NEW.ontology_id,NEW.actor,NEW.created_at,NEW.change_note,NEW.id);
        END;
        CREATE TRIGGER IF NOT EXISTS trg_change_log_to_mvc_archive
        AFTER UPDATE OF pending ON change_log WHEN OLD.pending=1 AND NEW.pending=0
        BEGIN
          UPDATE mdl_ver_chg SET mvc_pending=0,mvc_status='已发布',mvc_updated_at=CURRENT_TIMESTAMP
          WHERE mvc_legacy_change_id=NEW.id AND mvc_pending=1;
        END;
    """)


_MODEL_CHANGE_TYPE_ALIASES = {
    "ontology": ("ontology", "本体"),
    "business_domain": ("business_domain", "业务域"),
    "subject_domain": ("subject_domain", "主题域"),
    "object_type": ("object_type", "对象"),
    "property": ("property", "属性"),
    "link_type": ("link_type", "关系"),
    "business_rule": ("business_rule", "logic_definition", "规则"),
    "data_source": ("data_source", "数据源"),
    "data_mapping": ("data_mapping", "映射"),
    "governance_asset": ("governance_asset",),
    "business_scenario": ("business_scenario",),
    "capability": ("capability", "capabilitie"),
    "action_mapping": ("action_mapping",),
    "permission_policy": ("permission_policy", "permission_policie"),
}
_MODEL_CHANGE_OPERATIONS = {
    "create": ("新增", "create"),
    "update": ("修改", "update"),
    "delete": ("删除", "delete"),
}


def _model_change_time(value: str | None) -> str | None:
    """The imported V4 log uses day/month/year; local writes use ISO 8601."""
    if not value:
        return value
    for pattern in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, pattern).isoformat()
        except ValueError:
            pass
    return value


def _model_change_safe_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _model_change_safe_value(part) for key, part in value.items()
                if not _model_change_sensitive_key(key)}
    if isinstance(value, list):
        return [_model_change_safe_value(part) for part in value]
    return value


_MODEL_CHANGE_INTERNAL_FIELDS = {
    "id", "ontology_id", "created_at", "created_by", "updated_at", "updated_by",
    "metadata", "mvc_id", "mvc_ontology_id",
}
_MODEL_CHANGE_SNAPSHOT_FIELDS = (
    "display_name", "name", "code", "external_id", "description", "status",
    "object_kind", "title_property", "subject_domain_id", "business_domain_id",
    "source_object_type_id", "target_object_type_id", "cardinality", "action_type",
    "data_type", "mapping_type", "owner", "properties",
)


def _model_change_sensitive_key(key: str) -> bool:
    return any(token in key.lower() for token in (
        "password", "secret", "token", "api_key", "credential", "private_key",
        "access_key", "authorization",
    ))


def _model_change_snapshot(value: str | None) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def _model_change_brief(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith(("[", "{")):
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, (list, dict)):
                    return f"{len(parsed)} 项"
            except ValueError:
                pass
        return value if len(value) <= 180 else f"{value[:180]}…（内容较长）"
    if isinstance(value, (list, dict)):
        return f"{len(value)} 项"
    return value


def _model_change_properties(value: Any) -> list[dict[str, Any]] | None:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return None
    return value if isinstance(value, list) and all(isinstance(part, dict) for part in value) else None


def _model_change_property_label(item: dict[str, Any]) -> str:
    name = str(item.get('name') or item.get('key') or '未命名属性')
    key = str(item.get('key') or '')
    return f'{name}（{key}）' if key and key != name else name


def _model_change_property_details(before_value: Any, after_value: Any) -> list[str]:
    before_items = _model_change_properties(before_value)
    after_items = _model_change_properties(after_value)
    if before_items is None or after_items is None:
        return []
    before = {str(item.get('key')): item for item in before_items if item.get('key')}
    after = {str(item.get('key')): item for item in after_items if item.get('key')}
    if not before and not after:
        return []
    details = [f'新增属性：{_model_change_property_label(after[key])}' for key in after if key not in before]
    details += [f'删除属性：{_model_change_property_label(before[key])}' for key in before if key not in after]
    labels = {'name': '名称', 'type': '类型', 'is_required': '必填', 'is_primary_key': '主键',
              'status': '状态', 'description': '说明', 'default': '默认值', 'unit': '单位'}
    def readable(value: Any) -> str:
        if value is None or value == '':
            return '无'
        if isinstance(value, bool):
            return '是' if value else '否'
        return str(_model_change_brief(value))
    for key in after:
        if key not in before:
            continue
        changes = [f'{label}：{readable(before[key].get(field))} → {readable(after[key].get(field))}'
                   for field, label in labels.items() if before[key].get(field) != after[key].get(field)]
        if changes:
            details.append(f'修改属性 {_model_change_property_label(after[key])}：' + '；'.join(changes[:3]))
    return details[:12]


_MODEL_CHANGE_FIELD_LABELS = {
    'display_name': '名称', 'name': '名称 / 标识', 'description': '业务说明', 'owner': '负责人',
    'status': '资源使用状态', 'design_status': '建模状态', 'code': '编码', 'namespace': '命名空间',
    'external_id': '模板 ID', 'icon': '图标', 'title_property': '标题属性', 'category': '类别',
    'subject_domain_id': '所属主题域', 'business_domain_id': '所属业务域', 'domain': '业务域',
    'source_system': '来源系统', 'source_field': '来源字段', 'source_table': '来源表 / 接口',
    'target_property': '本体属性', 'mapping_type': '映射类型', 'quality_rule': '质量校验',
    'transform_rule': '转换规则', 'type': '数据类型', 'is_required': '必填',
    'is_primary_key': '主键', 'is_unique': '唯一', 'is_searchable': '可搜索',
    'default': '默认值', 'unit': '单位', 'properties': '属性', 'interface_ids': '实现接口',
}


def _model_change_flat_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    result = dict(snapshot)
    for field in ('metadata', 'payload'):
        extra = _model_change_snapshot(result.pop(field, None))
        for key, value in extra.items():
            result.setdefault(key, value)
    return result


def repair_object_state_property() -> int:
    """Remove broken state references while retaining their original value and template evidence."""
    conn = get_conn()
    repaired = 0
    for row in conn.execute('SELECT id,properties,metadata FROM object_types').fetchall():
        metadata = _model_change_snapshot(row['metadata'])
        properties = _model_change_properties(row['properties']) or []
        old = metadata.get('state_property')
        if not old or old in {item.get('key') for item in properties}:
            continue
        metadata.setdefault('state_property_original', old)
        metadata['state_property'] = None
        metadata['state_property_issue'] = f'原状态属性“{old}”未对应到已定义属性，已设为未指定；模板原值仍保留。'
        conn.execute('UPDATE object_types SET metadata=? WHERE id=?', (_json(metadata), row['id']))
        repaired += 1
    if repaired:
        conn.commit()
    conn.close()
    return repaired


def _model_change_values_equal(left: Any, right: Any) -> bool:
    """None 与空字符串都表示“未设置”。

    二者在前端都会渲染成“无”，若直接按 != 比较就会产生“无 → 无”这种没有内容的变化。
    """
    if left == right:
        return True
    return left in (None, "") and right in (None, "")


def _model_change_build_changes(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    before, after = _model_change_flat_snapshot(before), _model_change_flat_snapshot(after)
    changes = []
    def append(field: str, label: str, old: Any, new: Any) -> None:
        if not _model_change_values_equal(old, new):
            changes.append({'field': field, 'label': label,
                            'before': _model_change_safe_value(old), 'after': _model_change_safe_value(new)})
    for key in sorted(set(before) | set(after)):
        if key in _MODEL_CHANGE_INTERNAL_FIELDS or _model_change_sensitive_key(key):
            continue
        old, new = before.get(key), after.get(key)
        if _model_change_values_equal(old, new):
            continue
        old_properties, new_properties = _model_change_properties(old), _model_change_properties(new)
        if key == 'properties' and old_properties is not None and new_properties is not None:
            old_by_key = {item['key']: item for item in old_properties if item.get('key')}
            new_by_key = {item['key']: item for item in new_properties if item.get('key')}
            for property_key in sorted(set(old_by_key) | set(new_by_key)):
                previous, current = old_by_key.get(property_key), new_by_key.get(property_key)
                label = '属性 · ' + _model_change_property_label(current or previous)
                path = f'properties.{property_key}'
                if previous is None or current is None:
                    append(path, label, previous, current)
                    continue
                for field in sorted(set(previous) | set(current)):
                    if field in _MODEL_CHANGE_INTERNAL_FIELDS or _model_change_sensitive_key(field):
                        continue
                    append(f'{path}.{field}', f'{label} · {_MODEL_CHANGE_FIELD_LABELS.get(field, field)}',
                           previous.get(field), current.get(field))
        else:
            append(key, _MODEL_CHANGE_FIELD_LABELS.get(key, key), old, new)
    return changes


def _model_change_text_value(value: Any) -> str:
    if value is None or value == '':
        return '无'
    if isinstance(value, bool):
        return '是' if value else '否'
    if isinstance(value, dict) and value.get('key'):
        return _model_change_property_label(value)
    return str(_model_change_brief(value))


def _model_change_extension_changes(value: Any) -> list[dict[str, Any]]:
    changes = _model_change_snapshot(value).get('changes')
    if not isinstance(changes, list):
        return []
    return [{'field': change['field'],
             'label': change.get('label') if isinstance(change.get('label'), str) and change['label'] else _MODEL_CHANGE_FIELD_LABELS.get(change['field'], change['field']),
             'before': _model_change_safe_value(change.get('before')), 'after': _model_change_safe_value(change.get('after'))}
            for change in changes if isinstance(change, dict) and isinstance(change.get('field'), str)
            and not _model_change_sensitive_key(change['field'])
            and ('before' in change or 'after' in change)
            and not _model_change_values_equal(change.get('before'), change.get('after'))]


def _model_change_text_changes(content: str) -> list[dict[str, Any]]:
    # Only split explicit old → new pairs; descriptions without a pair stay intact.
    body = re.sub(r'^.*?」[：:]\s*', '', content, count=1)
    changes = []
    for part in re.split(r'[；\n]+', body):
        if part.count('→') != 1:
            continue
        match = re.fullmatch(r'\s*([^：:\n]+)[：:]\s*(.*?)\s*→\s*(.*?)\s*', part)
        if match:
            label, old, new = match.groups()
            changes.append({'field': label.strip(), 'label': label.strip(), 'before': old.strip(), 'after': new.strip()})
    return changes


def _model_change_display(row: sqlite3.Row) -> Dict[str, Any]:
    item = dict(row)
    item["mvc_created_at"] = _model_change_time(item.get("mvc_created_at"))
    item["mvc_updated_at"] = _model_change_time(item.get("mvc_updated_at"))
    content = item.get("mvc_chg_content") or ""
    name_match = re.search(r'(?:新增|创建|修改|删除|更新)\s*(?:对象类型组|共享属性|对象类型|关系类型|动作类型|数据映射|治理资产|业务场景|业务域|主题域|数据源|本体|对象|属性|关系|规则|行动|接口)\s*「([^」]+)」', content)
    if not name_match:
        name_match = re.search(r"「([^」]+)」", content)
    item["mvc_resource_name"] = name_match.group(1) if name_match else ""
    if not item["mvc_resource_name"] and not content.startswith("{"):
        heading = content.split("：", 1)[0]
        inferred = re.sub(
            r"^(?:新增|创建|修改|删除|更新)\s*(?:对象类型组|共享属性|对象类型|关系类型|动作类型|数据映射|治理资产|业务场景|业务域|主题域|数据源|本体|对象|属性|关系|规则|行动|接口)\s*",
            "", heading,
        ).strip()
        if inferred != heading and len(inferred) <= 100:
            item["mvc_resource_name"] = inferred
    item["mvc_field_changes"] = _model_change_extension_changes(item.get('mvc_extend_params'))
    item["mvc_snapshot_fields"] = []
    if content.startswith("{"):
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                fields = parsed.get("fields") or {}
                if isinstance(fields, dict) and not item["mvc_resource_name"]:
                    item["mvc_resource_name"] = str(fields.get("oop_name") or fields.get("name") or "")
                old_new = parsed.get("old_new") or {}
                before, after = old_new.get("旧"), old_new.get("新")
                if not item['mvc_field_changes'] and (isinstance(before, dict) or isinstance(after, dict)):
                    before, after = before or {}, after or {}
                    item["mvc_field_changes"] = [
                        {"field": key, "before": _model_change_brief(_model_change_safe_value(before.get(key))),
                         "after": _model_change_brief(_model_change_safe_value(after.get(key))),
                         "details": _model_change_property_details(before.get(key), after.get(key)) if key == 'properties' else []}
                        for key in sorted(set(before) | set(after)) if before.get(key) != after.get(key)
                        and key not in _MODEL_CHANGE_INTERNAL_FIELDS and not _model_change_sensitive_key(key)
                    ]
                item["mvc_chg_content"] = f"{item['mvc_chg_type'] or '变更'}{item['mvc_res_type'] or '资源'}「{item['mvc_resource_name'] or item['mvc_chg_obj']}」"
        except (TypeError, ValueError):
            pass
    before = _model_change_snapshot(item.get("legacy_before_data"))
    after = _model_change_snapshot(item.get("legacy_after_data"))
    if item.get('mvc_res_type') in ('ontology', '本体') and after and set(after) <= {'name', 'namespace', 'description'}:
        before = {key: before.get(key) for key in after}
    if not item["mvc_field_changes"] and before and after:
        item["mvc_field_changes"] = _model_change_build_changes(before, after)
    if not item['mvc_field_changes'] and item.get('mvc_chg_type') in ('修改', 'update'):
        item['mvc_field_changes'] = _model_change_text_changes(content)
    if not item["mvc_field_changes"] and (after or before):
        snapshot = _model_change_flat_snapshot(after if after else before)
        item["mvc_snapshot_fields"] = [
            {"field": key, "value": _model_change_brief(snapshot[key])}
            for key in _MODEL_CHANGE_SNAPSHOT_FIELDS if key in snapshot
            and snapshot[key] not in (None, "") and not _model_change_sensitive_key(key)
        ][:10]
    if not item["mvc_resource_name"]:
        snapshot = after if after else before
        item["mvc_resource_name"] = str(snapshot.get("display_name") or snapshot.get("name") or "")
    return {key: item.get(key) for key in (
        "mvc_id", "mvc_ontology_id", "mvc_ver_no", "mvc_pending", "mvc_res_type", "mvc_chg_obj", "mvc_chg_type",
        "mvc_chg_content", "mvc_chg_reason", "mvc_created_by", "mvc_created_at",
        "mvc_updated_by", "mvc_updated_at", "mvc_source", "mvc_remark",
        "mvc_change_note", "mvc_resource_name", "mvc_field_changes", "mvc_snapshot_fields",
    )}


def model_changes_page(oid: str, page: int = 1, page_size: int = 20,
                       pending: str = "all", resource_type: str = "", keyword: str = "",
                       include_system: bool = False, resource_id: str = "",
                       operation: str = "") -> Dict[str, Any]:
    get_ontology(oid)
    clauses = ["mvc_ontology_id=?"]
    params: list[Any] = [oid]
    if not include_system:
        clauses.append("(mvc_created_by IS NULL OR mvc_created_by NOT IN ('system','system-bootstrap','system-migration'))")
    if pending in {"0", "1"}:
        clauses.append("mvc_pending=?")
        params.append(int(pending))
    if resource_type:
        aliases = _MODEL_CHANGE_TYPE_ALIASES.get(resource_type, (resource_type,))
        clauses.append(f"mvc_res_type IN ({','.join('?' for _ in aliases)})")
        params.extend(aliases)
    if resource_id:
        clauses.append("mvc_chg_obj=?")
        params.append(resource_id)
    if operation:
        aliases = _MODEL_CHANGE_OPERATIONS.get(operation, (operation,))
        clauses.append(f"mvc_chg_type IN ({','.join('?' for _ in aliases)})")
        params.extend(aliases)
    if keyword.strip():
        clauses.append("(mvc_chg_content LIKE ? OR mvc_chg_obj LIKE ? OR mvc_created_by LIKE ?)")
        term = f"%{keyword.strip()}%"
        params.extend([term] * 3)
    where = " AND ".join(clauses)
    conn = get_conn()
    conn.create_function("history_sort_time", 1, lambda value: _model_change_time(value) or "")
    total = conn.execute(f"SELECT COUNT(*) FROM mdl_ver_chg WHERE {where}", params).fetchone()[0]
    rows = conn.execute(f"""SELECT m.*, c.before_data AS legacy_before_data,
                        c.after_data AS legacy_after_data
                        FROM mdl_ver_chg m LEFT JOIN change_log c ON c.id=m.mvc_legacy_change_id
                        WHERE {where} ORDER BY history_sort_time(m.mvc_created_at) DESC,m.mvc_id DESC LIMIT ? OFFSET ?""",
                        [*params, page_size, (page - 1) * page_size]).fetchall()
    conn.close()
    return {"items": [_model_change_display(row) for row in rows], "total": total, "page": page, "page_size": page_size}


def changes(oid: str, limit: int | None=80, pending_only: bool=False) -> list[Dict[str, Any]]:
    get_ontology(oid); conn=get_conn()
    sql = "SELECT * FROM change_log WHERE ontology_id=?"
    if pending_only: sql += " AND pending=1"
    sql += " ORDER BY created_at DESC"
    if limit is None: rows=conn.execute(sql,(oid,)).fetchall()
    else: rows=conn.execute(sql+" LIMIT ?",(oid,limit)).fetchall()
    conn.close()
    result=[]
    for row in rows:
        item=dict(row)
        for key in ("before_data","after_data"):
            if item.get(key):
                try: item[key]=json.loads(item[key])
                except json.JSONDecodeError: pass
        result.append(item)
    return result


def activity_page(oid: str, page: int = 1, page_size: int = 20,
                  include_system: bool = False, keyword: str = "") -> Dict[str, Any]:
    """Page audit metadata without exposing resource snapshots or connection secrets."""
    get_ontology(oid)
    clauses = ["ontology_id=?"]
    params: list[Any] = [oid]
    if not include_system:
        clauses.append("actor NOT IN ('system', 'system-bootstrap', 'system-migration')")
        # These retired resources were repeatedly recreated by an old startup seed.
        clauses.append("component_type NOT IN ('object_type_group', 'shared_property')")
    if keyword.strip():
        clauses.append("(summary LIKE ? OR change_note LIKE ? OR actor LIKE ?)")
        term = f"%{keyword.strip()}%"
        params.extend([term, term, term])
    where = " AND ".join(clauses)
    conn = get_conn()
    total = conn.execute(f"SELECT COUNT(*) FROM change_log WHERE {where}", params).fetchone()[0]
    rows = conn.execute(
        f"""SELECT id, ontology_id, component_type, component_id, operation,
                   summary, actor, created_at, pending, change_note
              FROM change_log WHERE {where}
             ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?""",
        [*params, page_size, (page - 1) * page_size],
    ).fetchall()
    conn.close()
    return {"items": [dict(row) for row in rows], "total": total,
            "page": page, "page_size": page_size}


def export_ontology(oid: str) -> Dict[str, Any]:
    payload={"schema_version":"enterprise-ontology/1.9","exported_at":now(),"ontology":get_ontology(oid),"business_domains":list_business_domains(oid),"subject_domains":list_subject_domains(oid),"interfaces":list_interfaces(oid),"object_types":list_object_types(oid),"link_types":list_link_types(oid),"actions":list_actions(oid),"business_rules":list_business_rules(oid),"object_instances":list_object_instances(oid),"link_instances":list_link_instances(oid)}
    # 导出包缺企业资源却静默成功，用户拿到的是一份不完整的数据包，所以这里显式失败。
    from enterprise import RESOURCE_TABLES, list_evidence, list_resources, list_template_records
    payload["enterprise_resources"]={kind:list_resources(oid,kind) for kind in RESOURCE_TABLES}
    payload["evidence_manifest"]=list_evidence(oid)
    payload["template_records"]=list_template_records(oid)
    return payload


def overview(oid: str) -> Dict[str, Any]:
    ontology=get_ontology(oid); objects=list_object_types(oid); links=list_link_types(oid); actions=list_actions(oid); rules=list_business_rules(oid); interfaces=list_interfaces(oid); instances=list_object_instances(oid); report=validate_ontology(oid)
    # 工作台把数据映射/数据源数量直接来自这里；静默返回 0 会让"没有映射"和"统计失败"长得一样。
    from enterprise import enterprise_summary
    enterprise_stats=enterprise_summary(oid)
    resources=objects+interfaces+links+actions+rules
    status_counts={status:sum(1 for item in resources if item.get("status")==status) for status in ("promoted","active","experimental","deprecated","example")}
    return {"ontology":ontology,"stats":{"object_types":len(objects),"properties":sum(len(o["effective_properties"]) for o in objects),"link_types":len(links),"actions":len(actions),"business_rules":len(rules),"instances":len(instances),"interfaces":len(interfaces),"business_domains":len(list_business_domains(oid)),"subject_domains":len(list_subject_domains(oid)),"resources":len(resources)},"enterprise":enterprise_stats,"status_counts":status_counts,"pending_changes":len(changes(oid,500,True)),"quality":{"valid":report["valid"],"checks_passed":sum(1 for c in report["checks"] if c["passed"]),"checks_total":len(report["checks"]),"warnings":len(report["warnings"]),"errors":len(report["errors"])},"recent_changes":activity_page(oid, page_size=5)["items"]}


def catalog(oid: str) -> list[Dict[str, Any]]:
    entries=[]
    for item in list_object_types(oid): entries.append({"id":item["id"],"resource_type":"object_type","display_name":item["display_name"],"name":item["name"],"description":item.get("description"),"status":item["status"],"updated_at":item["updated_at"],"detail":f"{item['effective_property_count']} 个属性","groups":[]})
    for item in list_interfaces(oid): entries.append({"id":item["id"],"resource_type":"interface","display_name":item["display_name"],"name":item["name"],"description":item.get("description"),"status":item["status"],"updated_at":item["updated_at"],"detail":f"{len(item['properties'])} 个契约属性","groups":[]})
    for item in list_link_types(oid): entries.append({"id":item["id"],"resource_type":"link_type","display_name":item["display_name"],"name":item["name"],"description":item.get("description"),"status":item["status"],"updated_at":item["updated_at"],"detail":f"{item['source_display_name']} → {item['target_display_name']}","groups":[]})
    for item in list_actions(oid): entries.append({"id":item["id"],"resource_type":"action","display_name":item["display_name"],"name":item["name"],"description":item.get("description"),"status":item["status"],"updated_at":item["updated_at"],"detail":f"{item['target_display_name']} · {item.get('action_category') or '业务动作'}","groups":[]})
    for item in list_business_rules(oid): entries.append({"id":item["id"],"resource_type":"business_rule","display_name":item["display_name"],"name":item["name"],"description":item.get("description"),"status":item["status"],"updated_at":item["updated_at"],"detail":f"{item['target_display_name']} · {item['severity']}","groups":[]})
    return sorted(entries,key=lambda item:item["updated_at"],reverse=True)


def import_ontology(payload: Dict[str, Any]) -> Dict[str, Any]:
    source=payload.get("ontology") or {}; base=OntologyBase(name=f"{source.get('name','导入本体')}（导入）",namespace=f"{source.get('namespace','imported.ontology')}.{uuid.uuid4().hex[:6]}",description=source.get("description")); created=create_ontology(base); oid=created["id"]; id_map={}; interface_map={}; instance_map={}; link_map={}; domain_map={}; subject_map={}; action_map={}
    for item in payload.get("business_domains",[]):
        data=BusinessDomainBase(**{k:v for k,v in item.items() if k in BusinessDomainBase.model_fields}); saved=save_business_domain(oid,data); domain_map[item.get("id")]=saved["id"]
    if not domain_map:
        fallback=save_business_domain(oid,BusinessDomainBase(code="imported",name="导入业务域",description="兼容旧版本数据包自动补充")); domain_map[None]=fallback["id"]
    for item in payload.get("subject_domains",[]):
        data={k:v for k,v in item.items() if k in SubjectDomainBase.model_fields}; data["business_domain_id"]=domain_map.get(item.get("business_domain_id"),next(iter(domain_map.values()))); saved=save_subject_domain(oid,SubjectDomainBase(**data)); subject_map[item.get("id")]=saved["id"]
    if not subject_map:
        fallback=save_subject_domain(oid,SubjectDomainBase(business_domain_id=next(iter(domain_map.values())),code="imported.model",name="导入业务主题",description="兼容旧版本数据包自动补充")); subject_map[None]=fallback["id"]
    for item in payload.get("interfaces",[]):
        data=InterfaceBase(**{k:v for k,v in item.items() if k in InterfaceBase.model_fields}); saved=save_interface(oid,data); interface_map[item.get("id")]=saved["id"]
    # v1.8 exports represented interfaces as abstract object types; promote them
    # into the independent interface registry during import.
    for item in payload.get("object_types",[]):
        if item.get("object_kind") != "abstract_type": continue
        data=InterfaceBase(**{k:v for k,v in item.items() if k in InterfaceBase.model_fields}); saved=save_interface(oid,data); interface_map[item.get("id")]=saved["id"]
    for item in payload.get("object_types",[]):
        if item.get("object_kind") == "abstract_type": continue
        data={k:v for k,v in item.items() if k in ObjectTypeBase.model_fields}
        data["object_kind"]="business_object"; data["parent_type_id"]=None; data["group_ids"]=[]
        data["subject_domain_id"]=subject_map.get(item.get("subject_domain_id"),next(iter(subject_map.values())))
        legacy_refs=list(item.get("interface_ids") or [])
        if item.get("parent_type_id"): legacy_refs.append(item["parent_type_id"])
        data["interface_ids"]=[interface_map[value] for value in legacy_refs if value in interface_map]
        data["properties"]=[{**prop,"shared_property_id":None} for prop in item.get("properties",[])]
        saved=create_object_type(oid,ObjectTypeBase(**data)); id_map[item.get("id")]=saved["id"]
    for item in payload.get("link_types",[]):
        data={k:v for k,v in item.items() if k in LinkTypeBase.model_fields}; data["source_object_type_id"]=id_map.get(item.get("source_object_type_id"),item.get("source_object_type_id")); data["target_object_type_id"]=id_map.get(item.get("target_object_type_id"),item.get("target_object_type_id")); saved=save_link_type(oid,LinkTypeBase(**data)); link_map[item.get("id")]=saved["id"]
    for item in payload.get("actions",[]):
        data={k:v for k,v in item.items() if k in ActionBase.model_fields}; data["target_object_type_id"]=id_map.get(item.get("target_object_type_id"),item.get("target_object_type_id")); saved=save_action(oid,ActionBase(**data),defer_mapping_validation=True); action_map[item.get("id")]=saved["id"]
    for item in payload.get("business_rules",[]):
        data={k:v for k,v in item.items() if k in BusinessRuleBase.model_fields}; data["target_object_type_id"]=id_map.get(item.get("target_object_type_id"),item.get("target_object_type_id")); save_business_rule(oid,BusinessRuleBase(**data))
    for item in payload.get("object_instances",[]):
        data={k:v for k,v in item.items() if k in ObjectInstanceBase.model_fields}; data["object_type_id"]=id_map.get(item.get("object_type_id"),item.get("object_type_id")); saved=save_object_instance(oid,ObjectInstanceBase(**data)); instance_map[item.get("id")]=saved["id"]
    for item in payload.get("link_instances",[]):
        data={k:v for k,v in item.items() if k in LinkInstanceBase.model_fields}; data["link_type_id"]=link_map.get(item.get("link_type_id"),item.get("link_type_id")); data["source_instance_id"]=instance_map.get(item.get("source_instance_id"),item.get("source_instance_id")); data["target_instance_id"]=instance_map.get(item.get("target_instance_id"),item.get("target_instance_id")); save_link_instance(oid,LinkInstanceBase(**data))
    # 导入时丢掉企业资源是静默数据丢失，必须报错让调用方知道导入不完整。
    from enterprise import RESOURCE_TABLES, save_resource
    from models import EnterpriseResourceBase
    for kind, items in (payload.get("enterprise_resources") or {}).items():
        if kind not in RESOURCE_TABLES: continue
        for item in items:
            core={key:item.get(key) for key in ("code","name","category","status","description")}
            excluded={"id","ontology_id","code","name","category","status","description","created_at","updated_at"}
            core["payload"]={key:value for key,value in item.items() if key not in excluded}
            if kind == "action-mappings":
                for key in ("action_code", "action_id"):
                    if core["payload"].get(key) in action_map: core["payload"][key] = action_map[core["payload"][key]]
            save_resource(oid,kind,EnterpriseResourceBase(**core))
    _validate_restored_action_mappings(oid)
    return get_ontology(oid)


# 复制本体时不搬运的表：它们是**原体的历史与运行痕迹**，不是本体的语义定义。
# 发布版本 / 变更流水 / 质检报告 / 提案与智能构建会话 / 场景运行记录 /
# 智能体交互 / 数据源密码 / 结构快照 / 智能构建证据，都留在原体。
# 模板原始行（template_records）也不搬；每个对象自己的 metadata.template_raw 已随对象复制。
COPY_ONTOLOGY_SKIPPED = (
    "ontology_releases", "change_log", "mdl_ver_chg", "ontology_quality_runs",
    "ontology_proposals", "proposal_operations", "ontology_build_runs",
    "ontology_build_sessions", "scenario_runs", "agent_interactions",
    "source_connection_secrets", "source_schema_snapshots", "evidence_sources",
    "template_records", "object_type_groups", "shared_properties",
)

# 复制顺序不是随便排的：
#   1. 数据源 / 治理资产必须**先于**对象类型，否则对象的 backing_source 会因
#      “当前本体尚未登记该数据源”而校验失败（旧 import 就是栽在这里）；
#   2. 接口必须先于对象类型，对象要引用接口；
#   3. 关系 / 动作 / 规则依赖对象，实例关系依赖实例。
COPY_ONTOLOGY_ENTERPRISE_FIRST = ("data-sources", "governance-assets")
COPY_ONTOLOGY_ENTERPRISE_REST = (
    "data-mappings", "logic-definitions", "capabilities",
    "action-mappings", "permission-policies", "business-scenarios",
)


# list_resources 会把 payload 摊平到顶层，所以复制时要按“信封字段”反推回 payload。
# 其中 credential_configured / schema_snapshot 是运行时计算值，password 是凭据，都不入 payload。
ENTERPRISE_ENVELOPE_KEYS = frozenset({
    "id", "ontology_id", "code", "name", "category", "status", "description",
    "created_at", "updated_at", "created_by", "updated_by",
    "credential_configured", "schema_snapshot", "password",
})


def _enterprise_resource_base(item: Dict[str, Any]):
    from models import EnterpriseResourceBase
    return EnterpriseResourceBase(
        code=item["code"], name=item["name"], category=item.get("category", ""),
        status=item.get("status", "draft"), description=item.get("description"),
        payload={key: value for key, value in item.items() if key not in ENTERPRISE_ENVELOPE_KEYS},
    )


def _remap_reference(value: Any, mapping: Dict[str, str]) -> Any:
    """把源资源引用换成副本里的新 id。

    空值（None / ""）原样保留：源对象可能显式存了空字符串，而 mapping.get("") 会变成 None，
    复制后就会凭空产生一处差异。"""
    if not value:
        return value
    return mapping.get(value)


def _source_metadata_map(table: str, oid: str) -> Dict[str, Any]:
    conn = get_conn()
    rows = conn.execute(f"SELECT id, metadata FROM {table} WHERE ontology_id=?", (oid,)).fetchall()
    conn.close()
    return {row["id"]: row["metadata"] for row in rows}


def _carry_over_metadata(table: str, new_id: str, source_metadata: Any, drop_synthesized: bool = False) -> None:
    """让副本的 metadata 与源严格对齐。

    create_object_type / save_link_type / save_action / save_business_rule 只按固定字段列表
    重建 metadata；模板导入是**事后**用 _merge_metadata 补上 template_raw 等证据的。复制时
    必须同样补一次，否则分支会丢掉模板可追溯性（这正是原型最看重的部分）。

    drop_synthesized=True 时，还会删掉“源里没有、但创建接口按模型默认值补出来”的键
    （例如源对象没有 is_core 键，模型会补成 False），使副本不凭空多出字段。
    """
    try:
        source = json.loads(source_metadata or "{}")
    except (TypeError, ValueError):
        source = {}
    if not isinstance(source, dict):
        return
    conn = get_conn()
    row = conn.execute(f"SELECT metadata FROM {table} WHERE id=?", (new_id,)).fetchone()
    if not row:
        conn.close()
        return
    target = json.loads(row["metadata"] or "{}")
    changed = False
    for key, value in source.items():
        if key not in target:
            target[key] = value
            changed = True
    if drop_synthesized:
        for key in [key for key in target if key not in source]:
            del target[key]
            changed = True
    if changed:
        conn.execute(f"UPDATE {table} SET metadata=? WHERE id=?", (_json(target), new_id))
        conn.commit()
    conn.close()


def copy_ontology(oid: str, name: Optional[str] = None, namespace: Optional[str] = None) -> Dict[str, Any]:
    """把一个本体整体复制成新的分支本体。

    与 export→import 的区别：
    - 顺序按外键与校验要求排列（数据源 / 治理资产先于对象类型）；
    - 模板里的“业务域”与平台两级分类不一致时，按源对象的既有绑定放行，不改写模板原值；
    - 所有资源拿新 UUID，但 name / code / 模板 ID 等业务标识保留，因此
      “本体对比”能按业务标识配对，复制出来的分支与原体的差异应为 0。

    不复制：发布版本、变更流水、质检报告、提案 / 智能构建会话、场景运行记录、
    智能体交互、数据源密码、结构快照、智能构建证据、模板原始行。
    """
    from enterprise import list_resources, save_resource
    source = get_ontology(oid)
    created = create_ontology(OntologyBase(
        name=(name or f"{source['name']}_copy").strip(),
        namespace=(namespace or f"{source['namespace']}.copy{uuid.uuid4().hex[:4]}").strip(),
        description=source.get("description"),
    ))
    new_id = created["id"]
    conn = get_conn()
    conn.execute("UPDATE ontologies SET origin_ontology_id=? WHERE id=?", (oid, new_id))
    conn.commit()
    conn.close()

    domain_map: Dict[str, str] = {}
    subject_map: Dict[str, str] = {}
    interface_map: Dict[str, str] = {}
    object_map: Dict[str, str] = {}
    link_map: Dict[str, str] = {}
    instance_map: Dict[str, str] = {}
    # 模板证据只存在 metadata 里，创建接口不会带上，需要事后补
    metadata_maps = {table: _source_metadata_map(table, oid)
                     for table in ("object_types", "link_types", "actions", "business_rules")}

    for item in list_business_domains(oid):
        saved = save_business_domain(new_id, BusinessDomainBase(
            **{k: v for k, v in item.items() if k in BusinessDomainBase.model_fields}))
        domain_map[item["id"]] = saved["id"]

    for item in list_subject_domains(oid):
        data = {k: v for k, v in item.items() if k in SubjectDomainBase.model_fields}
        data["business_domain_id"] = _remap_reference(item["business_domain_id"], domain_map)
        saved = save_subject_domain(new_id, SubjectDomainBase(**data))
        subject_map[item["id"]] = saved["id"]

    for kind in COPY_ONTOLOGY_ENTERPRISE_FIRST:
        for item in list_resources(oid, kind):
            save_resource(new_id, kind, _enterprise_resource_base(item))

    for item in list_interfaces(oid):
        saved = save_interface(new_id, InterfaceBase(
            **{k: v for k, v in item.items() if k in InterfaceBase.model_fields}))
        interface_map[item["id"]] = saved["id"]

    for item in list_object_types(oid, include_abstract=False):
        data = {k: v for k, v in item.items() if k in ObjectTypeBase.model_fields}
        data["subject_domain_id"] = _remap_reference(item.get("subject_domain_id"), subject_map)
        data["interface_ids"] = [interface_map[v] for v in (item.get("interface_ids") or []) if v in interface_map]
        data["parent_type_id"] = None
        data["group_ids"] = []
        saved = create_object_type(
            new_id, ObjectTypeBase(**data),
            legacy_source=item.get("backing_source"),
            legacy_domain_binding=(data["subject_domain_id"], data.get("domain")),
        )
        _carry_over_metadata("object_types", saved["id"], metadata_maps["object_types"].get(item["id"]), drop_synthesized=True)
        object_map[item["id"]] = saved["id"]

    for item in list_link_types(oid):
        data = {k: v for k, v in item.items() if k in LinkTypeBase.model_fields}
        data["source_object_type_id"] = _remap_reference(item["source_object_type_id"], object_map)
        data["target_object_type_id"] = _remap_reference(item["target_object_type_id"], object_map)
        saved = save_link_type(new_id, LinkTypeBase(**data))
        _carry_over_metadata("link_types", saved["id"], metadata_maps["link_types"].get(item["id"]), drop_synthesized=True)
        link_map[item["id"]] = saved["id"]

    action_map = {}
    for item in list_actions(oid):
        data = {k: v for k, v in item.items() if k in ActionBase.model_fields}
        data["target_object_type_id"] = _remap_reference(item["target_object_type_id"], object_map)
        saved = save_action(new_id, ActionBase(**data), defer_mapping_validation=True)
        action_map[item["id"]] = saved["id"]
        _carry_over_metadata("actions", saved["id"], metadata_maps["actions"].get(item["id"]), drop_synthesized=True)

    for item in list_business_rules(oid):
        data = {k: v for k, v in item.items() if k in BusinessRuleBase.model_fields}
        data["target_object_type_id"] = _remap_reference(item["target_object_type_id"], object_map)
        saved = save_business_rule(new_id, BusinessRuleBase(**data))
        _carry_over_metadata("business_rules", saved["id"], metadata_maps["business_rules"].get(item["id"]), drop_synthesized=True)

    for kind in COPY_ONTOLOGY_ENTERPRISE_REST:
        for item in list_resources(oid, kind):
            resource = _enterprise_resource_base(item)
            if kind == "action-mappings":
                for key in ("action_code", "action_id"):
                    if resource.payload.get(key) in action_map: resource.payload[key] = action_map[resource.payload[key]]
            save_resource(new_id, kind, resource)

    for item in list_object_instances(oid):
        data = {k: v for k, v in item.items() if k in ObjectInstanceBase.model_fields}
        data["object_type_id"] = _remap_reference(item["object_type_id"], object_map)
        saved = save_object_instance(new_id, ObjectInstanceBase(**data))
        instance_map[item["id"]] = saved["id"]

    for item in list_link_instances(oid):
        data = {k: v for k, v in item.items() if k in LinkInstanceBase.model_fields}
        data["link_type_id"] = _remap_reference(item["link_type_id"], link_map)
        data["source_instance_id"] = _remap_reference(item["source_instance_id"], instance_map)
        data["target_instance_id"] = _remap_reference(item["target_instance_id"], instance_map)
        save_link_instance(new_id, LinkInstanceBase(**data))

    _validate_restored_action_mappings(new_id)
    result = get_ontology(new_id)
    result["origin_ontology_id"] = oid
    result["copied"] = {
        "business_domains": len(domain_map), "subject_domains": len(subject_map),
        "interfaces": len(interface_map), "object_types": len(object_map),
        "link_types": len(link_map), "instances": len(instance_map),
    }
    return result


def seed_domain_hierarchy() -> None:
    """Create the two-level governance taxonomy and classify objects directly."""
    plans = {
        "enterprise.supplychain.manual": [
            ("procurement", "采购管理域", "procurement.master", "采购主数据主题",
             ["Supplier", "OrganizationUnit", "Product", "ProductCopy", "PurchaseCategory", "SupplierQualification", "SupplierPerformance", "Employee"]),
            ("procurement", "采购管理域", "procurement.sourcing", "采购执行主题",
             ["PurchasePlan", "SourcingEvent", "SupplierQuotation", "PriceAgreement", "PurchaseRequest", "PurchaseOrder", "PurchaseOrderCopy", "DeliverySchedule", "GoodsReceipt", "ReturnOrder"]),
            ("procurement", "采购管理域", "procurement.contract", "合同履约主题",
             ["Contract", "AcceptanceRecord", "Project", "ContractAmendment", "ContractMilestone"]),
            ("finance", "财务管理域", "finance.settlement", "应付结算主题",
             ["Invoice", "InvoiceLine", "PaymentRequest", "PaymentPlan", "PaymentAllocation"]),
            ("finance", "财务管理域", "finance.budget", "预算与成本主题",
             ["Budget", "BudgetLine", "BudgetAdjustment", "CostCenter", "ExpenseClaim", "ExpenseItem", "AssetCard", "DepreciationPlan"]),
            ("finance", "财务管理域", "finance.risk", "财务运营与风控主题",
             ["AccountingVoucher", "RiskReviewTask", "BankAccount", "FundPlan", "ExchangeRate", "TaxRate", "ComplianceCheck", "AuditFinding", "RiskAlert"]),
        ],
        "enterprise.pipeline.operations.manual": [
            ("commercial", "经营管理域", "commercial.contract", "客户合同主题", ["Customer","Contract"]),
            ("pipeline", "管网运营域", "pipeline.dispatch", "运输调度主题", ["TransportTask"]),
            ("pipeline", "管网运营域", "pipeline.asset", "管网资产主题", ["Pipeline","PipeSegment","Station","Equipment"]),
            ("pipeline", "管网运营域", "pipeline.maintenance", "监测运维主题", ["Alarm","WorkOrder"]),
        ],
    }
    conn = get_conn()
    ontology_rows = conn.execute("SELECT id,namespace FROM ontologies").fetchall()
    conn.close()
    for ontology in ontology_rows:
        oid, namespace = ontology["id"], ontology["namespace"]
        spec = plans.get(namespace)
        if not spec: continue
        domain_cache: Dict[str, Dict[str, Any]] = {}
        subject_cache: Dict[str, Dict[str, Any]] = {}
        for domain_code, domain_name, subject_code, subject_name, object_names in spec:
            if domain_code not in domain_cache:
                existing = next((item for item in list_business_domains(oid) if item["code"] == domain_code), None)
                domain_cache[domain_code] = existing or save_business_domain(
                    oid, BusinessDomainBase(code=domain_code, name=domain_name, description=f"{domain_name}的治理边界", owner="本体管理员")
                )
            existing_subject = next((item for item in list_subject_domains(oid) if item["code"] == subject_code), None)
            subject_cache[subject_code] = existing_subject or save_subject_domain(
                oid, SubjectDomainBase(
                    business_domain_id=domain_cache[domain_code]["id"], code=subject_code,
                    name=subject_name, description=f"{domain_name}下的{subject_name}", owner="领域建模负责人",
                )
            )
            if object_names:
                conn = get_conn()
                placeholders = ",".join("?" for _ in object_names)
                conn.execute(
                    f"UPDATE object_types SET subject_domain_id=?,updated_by=? WHERE ontology_id=? AND name IN ({placeholders})",
                    (subject_cache[subject_code]["id"], "system-migration", oid, *object_names),
                )
                conn.commit(); conn.close()
        # Keep new or workbook-derived objects discoverable under the first subject.
        fallback_subject = next(iter(subject_cache.values()))
        conn = get_conn()
        conn.execute(
            "UPDATE object_types SET subject_domain_id=?,updated_by=? WHERE ontology_id=? AND subject_domain_id IS NULL AND COALESCE(object_kind,'business_object')='business_object'",
            (fallback_subject["id"], "system-migration", oid),
        )
        conn.commit(); conn.close()


# map_way 曾经按显示名称存储（前端 DictionaryField 默认回写 name），
# 与按 code 存储的记录混在同一列里。这里一次性收敛为 code。
MAPPING_WAY_CODES = {
    "直接映射": "direct", "枚举映射": "enum_map", "公式计算": "expr",
    "脚本计算": "script", "常量映射": "constant", "自定义流程": "workflow",
    "关联映射": "link", "字段/单位映射": "unit",
}


def migrate_mapping_way_codes() -> int:
    """把 enterprise_data_mappings.payload.map_way 的历史中文值改写为字典 code。"""
    conn = get_conn()
    marker = "v1.9-mapping-way-code-normalization"
    if conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (marker,)).fetchone():
        conn.close()
        return 0
    changed = 0
    rows = conn.execute("SELECT id,payload FROM enterprise_data_mappings").fetchall()
    for row in rows:
        try:
            payload = json.loads(row["payload"] or "{}")
        except json.JSONDecodeError:
            continue
        current = payload.get("map_way")
        if not isinstance(current, str) or current not in MAPPING_WAY_CODES:
            continue
        payload["map_way"] = MAPPING_WAY_CODES[current]
        conn.execute("UPDATE enterprise_data_mappings SET payload=? WHERE id=?", (_json(payload), row["id"]))
        changed += 1
    conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)", (marker, now()))
    conn.commit()
    conn.close()
    return changed


def apply_v19_product_model() -> None:
    """One-time demo cleanup plus idempotent retirement of legacy group/shared/abstract data."""
    conn=get_conn()
    marker="v1.9-keep-procurement-pipeline"
    applied=conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?",(marker,)).fetchone()
    if not applied:
        keep=("enterprise.supplychain.manual","enterprise.pipeline.operations.manual")
        unwanted=conn.execute("SELECT id FROM ontologies WHERE namespace NOT IN (?,?)",keep).fetchall()
        for row in unwanted:
            conn.execute("DELETE FROM ontologies WHERE id=?",(row["id"],))
        conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)",(marker,now()))
    # Migrate legacy abstract types to independent interfaces before deleting them.
    abstracts=conn.execute("SELECT * FROM object_types WHERE object_kind='abstract_type'").fetchall()
    for abstract in abstracts:
        existing=conn.execute("SELECT id FROM interfaces WHERE ontology_id=? AND name=?",(abstract["ontology_id"],abstract["name"])).fetchone()
        interface_id=existing["id"] if existing else str(uuid.uuid4())
        if not existing:
            conn.execute("""INSERT INTO interfaces (id,ontology_id,name,display_name,description,status,properties,created_at,updated_at,created_by,updated_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",(interface_id,abstract["ontology_id"],abstract["name"],abstract["display_name"],abstract["description"],abstract["status"],abstract["properties"],abstract["created_at"],now(),"system-migration","system-migration"))
        children=conn.execute("SELECT id,interface_ids FROM object_types WHERE parent_type_id=?",(abstract["id"],)).fetchall()
        for child in children:
            ids=json.loads(child["interface_ids"] or "[]")
            ids=[value for value in ids if value != abstract["id"]]
            if interface_id not in ids: ids.append(interface_id)
            conn.execute("UPDATE object_types SET interface_ids=?,parent_type_id=NULL WHERE id=?",(_json(ids),child["id"]))
        conn.execute("DELETE FROM object_types WHERE id=?",(abstract["id"],))
    # These two concepts are retired in v1.9. Tables remain only so old exports can be read.
    rows=conn.execute("SELECT id,properties FROM object_types").fetchall()
    for row in rows:
        props=_props(row["properties"])
        for prop in props: prop["shared_property_id"]=None
        conn.execute("UPDATE object_types SET properties=?,group_ids='[]',object_kind='business_object',parent_type_id=NULL WHERE id=?",(_json(props),row["id"]))
    conn.execute("DELETE FROM shared_properties")
    conn.execute("DELETE FROM object_type_groups")
    conn.commit(); conn.close()
    seed_domain_hierarchy()


def seed_demo() -> None:
    ontology=create_ontology(OntologyBase(name="资产运营本体",namespace="enterprise.asset.manual",description="用于手工建模演示的资产运营语义模型")); oid=ontology["id"]
    def prop(key,name,type="string",pk=False,required=False,search=False,options=None): return PropertyDef(key=key,name=name,type=type,is_primary_key=pk,is_required=required,is_searchable=search,options=options)
    operations=save_object_type_group(oid,ObjectTypeGroupBase(name="资产运营",description="资产、地点与维修业务对象",color="#3b6ea8"))
    master=save_object_type_group(oid,ObjectTypeGroupBase(name="组织主数据",description="稳定复用的组织类对象",color="#527a63"))
    work_item=save_interface(oid,InterfaceBase(name="WorkItem",display_name="工作项",description="可分派、可流转的业务工作项",properties=[prop("status","状态","enum",required=True,options=["待处理","处理中","已完成"])]))
    save_shared_property(oid,SharedPropertyBase(name="last_updated_at",display_name="最后更新时间",type="datetime",description="跨对象统一使用的更新时间元数据"))
    asset=create_object_type(oid,ObjectTypeBase(name="Asset",display_name="资产",plural_name="资产列表",icon="资",title_property="asset_name",description="企业可管理的固定资产",backing_source="dataset.asset_master",group_ids=[operations["id"]],properties=[prop("asset_id","资产编号",pk=True,required=True,search=True),prop("asset_name","资产名称",required=True,search=True),prop("status","资产状态","enum",required=True,options=["在用","闲置","维修中","已报废"]),prop("purchase_value","采购原值","decimal")]))
    dept=create_object_type(oid,ObjectTypeBase(name="Department",display_name="部门",plural_name="部门列表",icon="部",title_property="department_name",description="资产责任归属部门",group_ids=[master["id"]],properties=[prop("department_id","部门编号",pk=True,required=True,search=True),prop("department_name","部门名称",required=True,search=True),prop("manager","负责人")]))
    location=create_object_type(oid,ObjectTypeBase(name="Location",display_name="存放地点",plural_name="存放地点",icon="地",title_property="location_name",description="资产的物理存放位置",group_ids=[operations["id"]],properties=[prop("location_id","地点编号",pk=True,required=True),prop("location_name","地点名称",required=True,search=True),prop("building","楼宇")]))
    order=create_object_type(oid,ObjectTypeBase(name="MaintenanceOrder",display_name="维修工单",plural_name="维修工单",icon="修",title_property="order_title",description="资产维修处置记录",group_ids=[operations["id"]],interface_ids=[work_item["id"]],properties=[prop("order_id","工单编号",pk=True,required=True),prop("order_title","工单标题",required=True),prop("status","工单状态","enum",required=True,options=["待处理","处理中","已完成"]),prop("assignee","处理人")]))
    save_link_type(oid,LinkTypeBase(name="asset_belongs_to_department",display_name="归属部门",source_object_type_id=asset["id"],target_object_type_id=dept["id"],cardinality="many_to_one",description="每项资产归属一个责任部门"))
    save_link_type(oid,LinkTypeBase(name="asset_located_at",display_name="存放于",source_object_type_id=asset["id"],target_object_type_id=location["id"],cardinality="many_to_one",description="资产的当前物理位置"))
    save_link_type(oid,LinkTypeBase(name="asset_has_maintenance_order",display_name="产生工单",source_object_type_id=asset["id"],target_object_type_id=order["id"],cardinality="one_to_many",description="资产关联的维修工单"))
    save_action(oid,ActionBase(name="change_asset_status",display_name="变更资产状态",target_object_type_id=asset["id"],action_type="modify",description="受控修改资产状态",parameters=[prop("status","目标状态","enum",required=True,options=["在用","闲置","维修中","已报废"])],preconditions=[{"expression":"status != '已报废'","message":"已报废资产不能再次变更状态"}]))
    save_action(oid,ActionBase(name="create_maintenance_order",display_name="创建维修工单",target_object_type_id=order["id"],action_type="create",description="为资产建立维修处置记录",parameters=[prop("order_title","工单标题",required=True),prop("assignee","处理人")]))
    conn=get_conn(); conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?",(oid,)); conn.commit(); conn.close()


def seed_extended_demo_resources() -> None:
    conn=get_conn(); ontology=conn.execute("SELECT id FROM ontologies WHERE namespace='enterprise.asset.manual' LIMIT 1").fetchone()
    if not ontology: conn.close(); return
    oid=ontology["id"]
    if conn.execute("SELECT 1 FROM object_type_groups WHERE ontology_id=? LIMIT 1",(oid,)).fetchone():
        sources={"Asset":"dataset.asset_master","Department":"dataset.organization_department","Location":"dataset.facility_location","MaintenanceOrder":"dataset.maintenance_order"}
        for name,source in sources.items(): conn.execute("UPDATE object_types SET backing_source=COALESCE(backing_source,?) WHERE ontology_id=? AND name=?",(source,oid,name))
        conn.commit(); conn.close(); return
    conn.close()
    def prop(key,name,type="string",required=False,options=None): return PropertyDef(key=key,name=name,type=type,is_required=required,options=options)
    operations=save_object_type_group(oid,ObjectTypeGroupBase(name="资产运营",description="资产、地点与维修业务对象",color="#3b6ea8"))
    master=save_object_type_group(oid,ObjectTypeGroupBase(name="组织主数据",description="稳定复用的组织类对象",color="#527a63"))
    work_item=save_interface(oid,InterfaceBase(name="WorkItem",display_name="工作项",description="可分派、可流转的业务工作项",properties=[prop("status","状态","enum",True,["待处理","处理中","已完成"])]))
    save_shared_property(oid,SharedPropertyBase(name="last_updated_at",display_name="最后更新时间",type="datetime",description="跨对象统一使用的更新时间元数据"))
    conn=get_conn()
    for name in ("Asset","Location"):
        conn.execute("UPDATE object_types SET group_ids=? WHERE ontology_id=? AND name=?",(_json([operations["id"]]),oid,name))
    conn.execute("UPDATE object_types SET group_ids=? WHERE ontology_id=? AND name='Department'",(_json([master["id"]]),oid))
    conn.execute("UPDATE object_types SET group_ids=?,interface_ids=? WHERE ontology_id=? AND name='MaintenanceOrder'",(_json([operations["id"]]),_json([work_item["id"]]),oid))
    sources={"Asset":"dataset.asset_master","Department":"dataset.organization_department","Location":"dataset.facility_location","MaintenanceOrder":"dataset.maintenance_order"}
    for name,source in sources.items(): conn.execute("UPDATE object_types SET backing_source=COALESCE(backing_source,?) WHERE ontology_id=? AND name=?",(source,oid,name))
    conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?",(oid,)); conn.commit(); conn.close()


def seed_additional_demo_ontologies() -> None:
    """Create independent business-domain ontologies so multi-ontology navigation is testable."""
    conn=get_conn()
    existing={row["namespace"] for row in conn.execute("SELECT namespace FROM ontologies").fetchall()}
    conn.close()
    def prop(key,name,type="string",pk=False,required=False,search=False,options=None):
        return PropertyDef(key=key,name=name,type=type,is_primary_key=pk,is_required=required,is_searchable=search,options=options)
    if "enterprise.supplychain.manual" not in existing:
        ontology=create_ontology(OntologyBase(name="供应链协同本体",namespace="enterprise.supplychain.manual",description="统一供应商、产品与采购订单的业务语义和协同关系")); oid=ontology["id"]
        core=save_object_type_group(oid,ObjectTypeGroupBase(name="供应链核心",description="采购履约链路中的核心对象",color="#3d6f9e"))
        partner=save_object_type_group(oid,ObjectTypeGroupBase(name="合作伙伴",description="外部供应商与服务伙伴",color="#657f57"))
        supplier=create_object_type(oid,ObjectTypeBase(name="Supplier",display_name="供应商",plural_name="供应商列表",icon="building",title_property="supplier_name",description="提供产品或服务的外部合作伙伴",group_ids=[partner["id"]],backing_source="dataset.supplier_master",properties=[prop("supplier_id","供应商编号",pk=True,required=True,search=True),prop("supplier_name","供应商名称",required=True,search=True),prop("rating","供应商等级","enum",options=["战略","优选","合格","观察"])]))
        product=create_object_type(oid,ObjectTypeBase(name="Product",display_name="产品",plural_name="产品目录",icon="product",title_property="product_name",description="可被采购和交付的产品主数据",group_ids=[core["id"]],backing_source="dataset.product_master",properties=[prop("product_id","产品编号",pk=True,required=True,search=True),prop("product_name","产品名称",required=True,search=True),prop("category","产品分类",search=True)]))
        order=create_object_type(oid,ObjectTypeBase(name="PurchaseOrder",display_name="采购订单",plural_name="采购订单",icon="order",title_property="order_no",description="面向供应商下达并跟踪履约的采购单据",group_ids=[core["id"]],backing_source="dataset.purchase_order",properties=[prop("order_id","订单主键",pk=True,required=True),prop("order_no","采购单号",required=True,search=True),prop("status","履约状态","enum",required=True,options=["草拟","已下达","履约中","已完成","已取消"]),prop("amount","订单金额","decimal")]))
        save_link_type(oid,LinkTypeBase(name="supplier_provides_product",display_name="供应产品",source_object_type_id=supplier["id"],target_object_type_id=product["id"],cardinality="many_to_many",description="供应商可提供的产品范围"))
        save_link_type(oid,LinkTypeBase(name="order_placed_with_supplier",display_name="下达给",source_object_type_id=order["id"],target_object_type_id=supplier["id"],cardinality="many_to_one",description="采购订单的履约供应商"))
        save_action(oid,ActionBase(name="update_order_status",display_name="更新订单状态",target_object_type_id=order["id"],action_type="modify",description="推进采购订单履约状态",parameters=[prop("status","目标状态","enum",required=True,options=["已下达","履约中","已完成","已取消"])]))
        conn=get_conn(); conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?",(oid,)); conn.commit(); conn.close()


def seed_procurement_domain() -> None:
    """Upgrade the lightweight supply-chain sample into an operational procurement ontology.

    The seed is additive and idempotent so existing user edits are never replaced.  It gives the
    prototype a realistic object → relationship → rule → action → instance chain without AI calls.
    """
    conn=get_conn()
    ontology=conn.execute("SELECT * FROM ontologies WHERE namespace='enterprise.supplychain.manual'").fetchone()
    product_model_applied=conn.execute(
        "SELECT 1 FROM prototype_migrations WHERE migration_key='v1.9-keep-procurement-pipeline'"
    ).fetchone()
    seeded=ontology and conn.execute(
        "SELECT 1 FROM object_types WHERE ontology_id=? AND name='RiskReviewTask'", (ontology["id"],)
    ).fetchone()
    conn.close()
    # The v1.9 model retired groups and shared properties. Re-running this old
    # additive seed on every startup recreated them and produced false user logs.
    if product_model_applied and seeded: return
    if not ontology: return
    oid=ontology["id"]
    conn=get_conn(); conn.execute("UPDATE ontologies SET name=?,description=? WHERE id=?",(
        "采购与财务协同本体",
        "贯通组织、项目、预算、采购申请、订单、合同、验收、发票、付款与凭证，支撑合规审查和业务行动。",
        oid,
    )); conn.commit(); conn.close()

    def prop(key,name,type="string",pk=False,required=False,search=False,options=None,description=None):
        return PropertyDef(key=key,name=name,type=type,is_primary_key=pk,is_required=required,is_searchable=search,options=options,description=description)

    def existing(table: str, name: str):
        conn=get_conn(); row=conn.execute(f"SELECT * FROM {table} WHERE ontology_id=? AND name=?",(oid,name)).fetchone(); conn.close(); return dict(row) if row else None

    def ensure_group(name,description,color):
        item=existing("object_type_groups",name)
        return item or save_object_type_group(oid,ObjectTypeGroupBase(name=name,description=description,color=color))

    groups={
        "master":ensure_group("组织与主数据","组织、项目、供应商和物料等稳定主数据","#526f87"),
        "source":ensure_group("采购寻源","从采购需求到订单下达的业务对象","#3974a8"),
        "contract":ensure_group("合同与履约","合同签署、交付和验收业务对象","#5d778c"),
        "finance":ensure_group("财务与结算","预算、发票、付款和会计凭证业务对象","#487b68"),
        "risk":ensure_group("审查与风控","风险识别、审查和人工复核工作对象","#9a6840"),
    }

    def ensure_shared(name,display_name,type,description,options=None):
        item=existing("shared_properties",name)
        return item or save_shared_property(oid,SharedPropertyBase(name=name,display_name=display_name,type=type,description=description,status="experimental",options=options))

    ensure_shared("source_system","来源系统","string","记录实例的权威来源系统")
    ensure_shared("last_updated_at","最后更新时间","datetime","跨系统同步使用的统一更新时间")
    ensure_shared("risk_level","风险等级","enum","统一的业务风险分级",["低","中","高","重大"])

    def ensure_interface(name,display_name,description,properties):
        item=existing("interfaces",name)
        return item or save_interface(oid,InterfaceBase(name=name,display_name=display_name,description=description,status="experimental",properties=properties))

    work=ensure_interface("ReviewableWorkItem","可审查工作项","具备状态、风险等级和处理人的审查工作",[
        prop("status","状态","enum",required=True,options=["待审查","审查中","已通过","已驳回"]),
        prop("risk_level","风险等级","enum",required=True,options=["低","中","高","重大"]),
        prop("assignee","处理人"),
    ])
    ensure_interface("AmountDocument","金额单据","具有金额和状态的采购财务单据",[
        prop("amount","金额","decimal",required=True),prop("status","状态","enum",required=True,options=["草拟","处理中","已完成"]),
    ])

    def ensure_object(name,display_name,icon,title_property,description,group_key,source,properties,interfaces=None):
        item=existing("object_types",name)
        if item: return get_object_type(item["id"])
        return create_object_type(oid,ObjectTypeBase(name=name,display_name=display_name,plural_name=f"{display_name}列表",icon=icon,title_property=title_property,description=description,status="experimental",backing_source=source,group_ids=[groups[group_key]["id"]],interface_ids=interfaces or [],properties=properties))

    objects={}
    for name in ("Supplier","Product","PurchaseOrder"):
        item=existing("object_types",name)
        if item: objects[name]=get_object_type(item["id"])
    conn=get_conn()
    conn.execute("UPDATE object_types SET display_name='采购品目',plural_name='采购品目目录',description='可被采购、交付和验收的货物或服务品目' WHERE ontology_id=? AND name='Product' AND display_name='产品'",(oid,))
    for name,group_key in (("Supplier","master"),("Product","master"),("PurchaseOrder","source")):
        obj=objects[name]; group_ids=list(dict.fromkeys([*obj["group_ids"],groups[group_key]["id"]])); conn.execute("UPDATE object_types SET group_ids=? WHERE id=?",(_json(group_ids),obj["id"])); obj["group_ids"]=group_ids
    conn.commit(); conn.close(); objects["Product"]=get_object_type(objects["Product"]["id"])
    objects["OrganizationUnit"]=ensure_object("OrganizationUnit","组织单位","building","org_name","集团及各级采购、财务责任主体","master","masterdata.organization_unit",[
        prop("org_id","组织主键",pk=True,required=True),prop("org_code","组织编码",required=True,search=True),prop("org_name","组织名称",required=True,search=True),prop("org_level","组织层级","enum",options=["集团","二级单位","部门"]),prop("manager","负责人")])
    objects["Project"]=ensure_object("Project","项目","box","project_name","承载预算、采购、合同和付款的经营项目","master","project.project_master",[
        prop("project_id","项目主键",pk=True,required=True),prop("project_code","项目编码",required=True,search=True),prop("project_name","项目名称",required=True,search=True),prop("status","项目状态","enum",required=True,options=["立项","执行中","已完成","已终止"]),prop("total_budget","项目总预算","decimal"),prop("manager","项目经理"),prop("start_date","开始日期","datetime")])
    objects["Budget"]=ensure_object("Budget","项目预算","database","budget_name","按项目和年度控制采购支出的预算额度","finance","finance.budget_execution",[
        prop("budget_id","预算主键",pk=True,required=True),prop("budget_name","预算名称",required=True,search=True),prop("fiscal_year","预算年度","integer",required=True),prop("total_amount","预算金额","decimal",required=True),prop("executed_amount","已执行金额","decimal",required=True),prop("available_amount","可用预算","decimal",required=True),prop("status","预算状态","enum",required=True,options=["草拟","已下达","冻结","关闭"])])
    objects["PurchaseRequest"]=ensure_object("PurchaseRequest","采购申请","order","request_no","业务部门提出并进入审批的采购需求","source","procurement.purchase_request",[
        prop("request_id","申请主键",pk=True,required=True),prop("request_no","申请单号",required=True,search=True),prop("request_name","采购事项",required=True,search=True),prop("amount","申请金额","decimal",required=True),prop("status","申请状态","enum",required=True,options=["草拟","审批中","已批准","已驳回","已转订单"]),prop("requester","经办人",required=True),prop("request_date","申请日期","datetime"),prop("purchase_method","采购方式","enum",options=["公开招标","邀请招标","竞争性谈判","询价","单一来源"])])
    objects["Contract"]=ensure_object("Contract","采购合同","document","contract_name","采购订单形成的对外法律与履约约束","contract","contract.contract_main",[
        prop("contract_id","合同主键",pk=True,required=True),prop("contract_no","合同编号",required=True,search=True),prop("contract_name","合同名称",required=True,search=True),prop("amount","合同金额","decimal",required=True),prop("paid_amount","累计已付","decimal",required=True),prop("status","合同状态","enum",required=True,options=["拟定中","履行中","已完成","已终止","已过期"]),prop("sign_date","签署日期","datetime"),prop("supplier_name","合同供应商",required=True),prop("project_code","项目编码",required=True)])
    objects["AcceptanceRecord"]=ensure_object("AcceptanceRecord","履约验收单","order","acceptance_no","对货物、服务或工程履约结果的验收记录","contract","procurement.acceptance_record",[
        prop("acceptance_id","验收主键",pk=True,required=True),prop("acceptance_no","验收单号",required=True,search=True),prop("amount","本次验收金额","decimal",required=True),prop("status","验收状态","enum",required=True,options=["待验收","部分通过","已通过","不通过"]),prop("acceptance_date","验收日期","datetime"),prop("acceptor","验收人"),prop("summary","验收说明")])
    objects["Invoice"]=ensure_object("Invoice","采购发票","document","invoice_no","供应商开具并经税务验真的结算凭证","finance","finance.invoice_pool",[
        prop("invoice_id","发票主键",pk=True,required=True),prop("invoice_no","发票号码",required=True,search=True),prop("amount","价税合计","decimal",required=True),prop("tax_amount","税额","decimal"),prop("status","发票状态","enum",required=True,options=["待验真","已验真","异常","已作废"]),prop("issuer","开票方",required=True),prop("buyer","购方主体",required=True),prop("issue_date","开票日期","datetime")])
    objects["PaymentRequest"]=ensure_object("PaymentRequest","付款申请","order","payment_title","依据合同、验收和发票发起的对外付款工作对象","finance","finance.payment_request",[
        prop("payment_id","付款主键",pk=True,required=True),prop("payment_no","付款单号",required=True,search=True),prop("payment_title","付款事项",required=True,search=True),prop("amount","申请金额","decimal",required=True),prop("status","付款状态","enum",required=True,options=["草拟","审查中","待复核","已批准","已支付","已驳回"]),prop("payee_name","收款方",required=True),prop("apply_date","申请日期","datetime"),prop("risk_level","风险等级","enum",required=True,options=["低","中","高","重大"]),prop("review_result","审查结论"),prop("source_system","来源系统")])
    objects["AccountingVoucher"]=ensure_object("AccountingVoucher","会计凭证","document","voucher_no","付款入账后在财务系统形成的会计凭证","finance","finance.accounting_voucher",[
        prop("voucher_id","凭证主键",pk=True,required=True),prop("voucher_no","凭证编号",required=True,search=True),prop("amount","凭证金额","decimal",required=True),prop("status","过账状态","enum",required=True,options=["待过账","已过账","已冲销"]),prop("posting_date","过账日期","datetime"),prop("summary","凭证摘要")])
    objects["RiskReviewTask"]=ensure_object("RiskReviewTask","付款审查任务","order","task_title","围绕付款合规风险形成的可分派审查工作项","risk","risk.payment_review_task",[
        prop("task_id","任务主键",pk=True,required=True),prop("task_title","任务标题",required=True,search=True),prop("status","状态","enum",required=True,options=["待审查","审查中","已通过","已驳回"]),prop("risk_level","风险等级","enum",required=True,options=["低","中","高","重大"]),prop("assignee","处理人"),prop("reason","风险依据"),prop("opinion","审查意见"),prop("decision","复核决定","enum",options=["待定","通过","驳回","补充材料"])],[work["id"]])

    def ensure_link(name,display_name,source,target,cardinality,description):
        item=existing("link_types",name)
        return get_link_type(item["id"]) if item else save_link_type(oid,LinkTypeBase(name=name,display_name=display_name,source_object_type_id=objects[source]["id"],target_object_type_id=objects[target]["id"],cardinality=cardinality,description=description,status="experimental",properties=[]))

    links={}
    for name,display_name,source,target,cardinality,description in [
        ("organization_manages_project","管理项目","OrganizationUnit","Project","one_to_many","组织单位负责的经营项目"),
        ("project_has_budget","拥有预算","Project","Budget","one_to_many","项目按年度和科目拥有预算额度"),
        ("request_belongs_to_project","属于项目","PurchaseRequest","Project","many_to_one","采购申请归属的经营项目"),
        ("request_generates_order","转为采购订单","PurchaseRequest","PurchaseOrder","one_to_many","批准后的采购需求生成采购订单"),
        ("order_contains_product","采购品目","PurchaseOrder","Product","many_to_many","采购订单包含的货物或服务品目"),
        ("order_forms_contract","形成合同","PurchaseOrder","Contract","one_to_many","采购订单进一步签署采购合同"),
        ("contract_signed_with_supplier","签约供应商","Contract","Supplier","many_to_one","合同约定的供应商主体"),
        ("contract_belongs_to_project","服务于项目","Contract","Project","many_to_one","采购合同归属的项目"),
        ("contract_has_acceptance","履约验收","Contract","AcceptanceRecord","one_to_many","合同项下的阶段性或最终验收"),
        ("contract_receives_invoice","取得发票","Contract","Invoice","one_to_many","合同履约后取得的供应商发票"),
        ("payment_based_on_contract","基于合同付款","PaymentRequest","Contract","many_to_one","付款申请的合同依据"),
        ("payment_occupies_budget","占用预算","PaymentRequest","Budget","many_to_one","付款申请占用的项目预算"),
        ("payment_paid_to_supplier","支付给供应商","PaymentRequest","Supplier","many_to_one","付款收款方对应的供应商"),
        ("payment_matches_invoice","核销发票","PaymentRequest","Invoice","many_to_many","付款申请核销的一张或多张发票"),
        ("payment_generates_voucher","形成会计凭证","PaymentRequest","AccountingVoucher","one_to_many","付款完成后形成的会计凭证"),
        ("payment_creates_review_task","触发审查任务","PaymentRequest","RiskReviewTask","one_to_many","风险规则命中后形成的人工审查任务"),
    ]:
        links[name]=ensure_link(name,display_name,source,target,cardinality,description)
    for name in ("supplier_provides_product","order_placed_with_supplier"):
        item=existing("link_types",name)
        if item: links[name]=get_link_type(item["id"])

    def ensure_action(name,display_name,target,action_type,description,parameters,preconditions=None):
        item=existing("actions",name)
        return get_action(item["id"]) if item else save_action(oid,ActionBase(name=name,display_name=display_name,target_object_type_id=objects[target]["id"],action_type=action_type,description=description,status="experimental",parameters=parameters,preconditions=preconditions or []))

    ensure_action("submit_purchase_request","提交采购申请","PurchaseRequest","modify","将完整的采购需求送入审批",[prop("status","目标状态","enum",required=True,options=["审批中"])],[{"expression":"amount > 0 and project != null","message":"采购金额和归属项目必须完整"}])
    ensure_action("approve_purchase_request","审批采购申请","PurchaseRequest","modify","审批或驳回采购需求",[prop("decision","审批决定","enum",required=True,options=["已批准","已驳回"]),prop("comment","审批意见")])
    ensure_action("register_contract","登记采购合同","Contract","create","依据采购结果登记合同及关键金额条款",[prop("contract_no","合同编号",required=True),prop("amount","合同金额","decimal",required=True),prop("supplier_name","供应商",required=True)])
    ensure_action("record_acceptance","登记履约验收","AcceptanceRecord","create","记录合同履约验收结果",[prop("amount","验收金额","decimal",required=True),prop("status","验收结论","enum",required=True,options=["部分通过","已通过","不通过"])])
    ensure_action("run_payment_compliance_review","运行付款合规审查","PaymentRequest","modify","按预算、合同、供应商、发票和验收规则检查付款",[prop("review_scope","审查范围","enum",required=True,options=["全部规则","金额规则","主体规则","票据规则"])])
    ensure_action("mark_payment_risk","标记付款风险","PaymentRequest","modify","写入结构化风险等级和审查结论",[prop("risk_level","风险等级","enum",required=True,options=["低","中","高","重大"]),prop("review_result","审查结论",required=True)])
    ensure_action("create_manual_review","发起人工复核","RiskReviewTask","create","对规则命中或语义不确定的付款创建人工审查任务",[prop("task_title","任务标题",required=True),prop("risk_level","风险等级","enum",required=True,options=["低","中","高","重大"]),prop("assignee","处理人")])
    ensure_action("write_review_opinion","生成审查意见","RiskReviewTask","modify","记录风险依据、审查意见和处理建议",[prop("opinion","审查意见",required=True),prop("decision","复核决定","enum",required=True,options=["通过","驳回","补充材料"])])
    ensure_action("approve_payment","审批付款申请","PaymentRequest","modify","在规则校验和人工复核通过后批准付款",[prop("status","目标状态","enum",required=True,options=["已批准","已驳回"])],[{"expression":"risk_level in ['低','中'] or manual_review.decision == '通过'","message":"高风险付款必须完成人工复核"}])

    def ensure_rule(name,display_name,target,category,severity,expression,description,remediation):
        item=existing("business_rules",name)
        return get_business_rule(item["id"]) if item else save_business_rule(oid,BusinessRuleBase(name=name,display_name=display_name,target_object_type_id=objects[target]["id"],category=category,severity=severity,expression=expression,description=description,remediation=remediation,status="experimental"))

    ensure_rule("payment_within_available_budget","可用预算约束","PaymentRequest","calculation","blocking","payment.amount <= budget.available_amount","付款后不得突破项目可用预算","调整付款金额、追加预算或选择其他有效预算")
    ensure_rule("contract_not_overpaid","合同金额约束","PaymentRequest","calculation","blocking","contract.paid_amount + payment.amount <= contract.amount","合同累计付款不得超过合同总额","核实历史付款或发起合同变更")
    ensure_rule("payment_requires_valid_contract","有效合同约束","PaymentRequest","validation","blocking","contract.status in ['履行中','已完成']","付款申请必须关联有效且未终止的合同","补充有效合同或终止本次付款")
    ensure_rule("payee_matches_contract_supplier","收款方主体一致","PaymentRequest","consistency","blocking","payment.payee_name == contract.supplier_name","付款收款方必须与合同供应商一致","更正收款方或补充经审批的主体变更依据")
    ensure_rule("invoice_matches_payment","发票与付款一致","PaymentRequest","consistency","warning","invoice.status == '已验真' and invoice.amount >= payment.amount","发票状态、金额和付款之间必须满足一致性要求","补充或更换有效发票后重新审查")
    ensure_rule("acceptance_covers_payment","履约验收覆盖付款","PaymentRequest","consistency","warning","sum(acceptance.amount where status == '已通过') >= payment.amount","原则上付款金额不应超过已验收金额","完成验收或提交预付款条款作为例外依据")
    ensure_rule("invoice_number_unique","发票号码唯一","Invoice","risk","blocking","count(invoice.invoice_no) == 1","同一发票号码不得重复报销或重复核销","冻结付款并由财务核查重复票据")
    ensure_rule("large_payment_manual_review","大额付款人工复核","PaymentRequest","risk","warning","payment.amount < 3000000 or manual_review.decision == '通过'","达到 300 万元的大额付款需完成人工复核","自动创建审查任务并由指定复核人处理")

    def ensure_instance(object_name,key,title,properties,status="有效"):
        conn=get_conn(); row=conn.execute("SELECT id FROM object_instances WHERE ontology_id=? AND object_type_id=? AND business_key=?",(oid,objects[object_name]["id"],key)).fetchone(); conn.close()
        return get_object_instance(row["id"]) if row else save_object_instance(oid,ObjectInstanceBase(object_type_id=objects[object_name]["id"],business_key=key,title=title,properties=properties,record_status=status))

    instances={
        "org":ensure_instance("OrganizationUnit","ORG-02","装备制造二级单位",{"org_id":"ORG-02","org_code":"EQUIP-02","org_name":"装备制造二级单位","org_level":"二级单位","manager":"张立"}),
        "project":ensure_instance("Project","PRJ-2026-017","智能产线改造项目",{"project_id":"PRJ-2026-017","project_code":"PRJ-2026-017","project_name":"智能产线改造项目","status":"执行中","total_budget":10000000,"manager":"周工","start_date":"2026-01-10"}),
        "budget":ensure_instance("Budget","BUD-2026-017","智能产线项目 2026 年设备预算",{"budget_id":"BUD-2026-017","budget_name":"智能产线项目 2026 年设备预算","fiscal_year":2026,"total_amount":10000000,"executed_amount":8500000,"available_amount":1500000,"status":"已下达"}),
        "request":ensure_instance("PurchaseRequest","PR-2026-0048","产线视觉检测设备采购申请",{"request_id":"PR-2026-0048","request_no":"PR-2026-0048","request_name":"产线视觉检测设备采购","amount":5000000,"status":"已转订单","requester":"李晨","request_date":"2026-03-05","purchase_method":"公开招标"}),
        "supplier":ensure_instance("Supplier","SUP-0088","华东智造科技有限公司",{"supplier_id":"SUP-0088","supplier_name":"华东智造科技有限公司","rating":"优选"}),
        "product":ensure_instance("Product","MAT-VIS-01","工业视觉检测系统",{"product_id":"MAT-VIS-01","product_name":"工业视觉检测系统","category":"智能制造设备"}),
        "order":ensure_instance("PurchaseOrder","PO-2026-0091","智能产线视觉设备采购订单",{"order_id":"PO-2026-0091","order_no":"PO-2026-0091","status":"履约中","amount":5000000}),
        "contract":ensure_instance("Contract","CT-2026-0036","智能产线视觉系统采购合同",{"contract_id":"CT-2026-0036","contract_no":"CT-2026-0036","contract_name":"智能产线视觉系统采购合同","amount":5000000,"paid_amount":2800000,"status":"履行中","sign_date":"2026-04-18","supplier_name":"华东智造科技有限公司","project_code":"PRJ-2026-017"}),
        "acceptance":ensure_instance("AcceptanceRecord","AC-2026-0062","视觉系统第一阶段验收",{"acceptance_id":"AC-2026-0062","acceptance_no":"AC-2026-0062","amount":2500000,"status":"已通过","acceptance_date":"2026-07-26","acceptor":"王华","summary":"硬件到货并完成基础联调"}),
        "invoice":ensure_instance("Invoice","INV-31002688","增值税专用发票 31002688",{"invoice_id":"INV-31002688","invoice_no":"31002688","amount":3000000,"tax_amount":345132.74,"status":"已验真","issuer":"华东智造科技有限公司","buyer":"装备制造二级单位","issue_date":"2026-08-02"}),
        "payment":ensure_instance("PaymentRequest","PAY-2026-0087","视觉系统第二期付款申请",{"payment_id":"PAY-2026-0087","payment_no":"PAY-2026-0087","payment_title":"视觉系统第二期付款申请","amount":3000000,"status":"待复核","payee_name":"华东智造科技有限公司","apply_date":"2026-08-11","risk_level":"高","review_result":"预计超预算 150 万，且累计付款将超合同 80 万","source_system":"财务共享平台"}),
        "voucher":ensure_instance("AccountingVoucher","VCH-2026-0817","8 月采购付款暂存凭证",{"voucher_id":"VCH-2026-0817","voucher_no":"记-2026-0817","amount":3000000,"status":"待过账","posting_date":"2026-08-17","summary":"智能产线视觉系统第二期付款"}),
        "review":ensure_instance("RiskReviewTask","REV-2026-0029","复核视觉系统大额付款",{"task_id":"REV-2026-0029","task_title":"复核视觉系统大额付款","status":"审查中","risk_level":"高","assignee":"财务复核岗","reason":"可用预算仅 150 万；合同累计付款预计 580 万，超过合同额 80 万","opinion":"建议暂停付款，核实预算追加与合同变更依据","decision":"补充材料"}),
    }

    def ensure_instance_link(link_name,source_key,target_key):
        if link_name in links: save_link_instance(oid,LinkInstanceBase(link_type_id=links[link_name]["id"],source_instance_id=instances[source_key]["id"],target_instance_id=instances[target_key]["id"]))

    for relation in [
        ("organization_manages_project","org","project"),("project_has_budget","project","budget"),("request_belongs_to_project","request","project"),
        ("request_generates_order","request","order"),("order_placed_with_supplier","order","supplier"),("order_contains_product","order","product"),
        ("supplier_provides_product","supplier","product"),("order_forms_contract","order","contract"),("contract_signed_with_supplier","contract","supplier"),
        ("contract_belongs_to_project","contract","project"),("contract_has_acceptance","contract","acceptance"),("contract_receives_invoice","contract","invoice"),
        ("payment_based_on_contract","payment","contract"),("payment_occupies_budget","payment","budget"),("payment_paid_to_supplier","payment","supplier"),
        ("payment_matches_invoice","payment","invoice"),("payment_generates_voucher","payment","voucher"),("payment_creates_review_task","payment","review"),
    ]: ensure_instance_link(*relation)

    conn=get_conn()
    for table in ("object_types","link_types","actions","business_rules","shared_properties","interfaces"):
        conn.execute(f"UPDATE {table} SET status='active' WHERE ontology_id=? AND status='experimental'",(oid,))
    conn.execute("UPDATE ontologies SET status='published',version='v1.0.0',updated_at=? WHERE id=?",(now(),oid))
    conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?",(oid,)); conn.commit(); conn.close()


def seed_customer_demo() -> None:
    conn=get_conn(); found=conn.execute("SELECT 1 FROM ontologies WHERE namespace='enterprise.customer.service.manual'").fetchone(); conn.close()
    if found: return
    def prop(key,name,type="string",pk=False,required=False,search=False,options=None):
        return PropertyDef(key=key,name=name,type=type,is_primary_key=pk,is_required=required,is_searchable=search,options=options)
    ontology=create_ontology(OntologyBase(name="客户服务本体",namespace="enterprise.customer.service.manual",description="统一客户、服务工单与服务人员的业务语义")); oid=ontology["id"]
    service=save_object_type_group(oid,ObjectTypeGroupBase(name="客户服务",description="客户服务受理与处置对象",color="#8064a2"))
    work_item=save_interface(oid,InterfaceBase(name="AssignableWork",display_name="可分派工作",description="具备状态与受理人的可分派工作对象",properties=[prop("status","状态","enum",required=True,options=["待受理","处理中","已解决","已关闭"]) ]))
    customer=create_object_type(oid,ObjectTypeBase(name="Customer",display_name="客户",plural_name="客户列表",icon="person",title_property="customer_name",description="购买产品或接受服务的个人与组织客户",group_ids=[service["id"]],properties=[prop("customer_id","客户编号",pk=True,required=True,search=True),prop("customer_name","客户名称",required=True,search=True),prop("level","客户等级","enum",options=["普通","重要","战略"])]))
    agent=create_object_type(oid,ObjectTypeBase(name="ServiceAgent",display_name="服务人员",plural_name="服务人员",icon="team",title_property="agent_name",description="受理和处置客户问题的服务人员",group_ids=[service["id"]],properties=[prop("agent_id","人员编号",pk=True,required=True),prop("agent_name","人员姓名",required=True,search=True),prop("skill_group","技能组",search=True)]))
    case=create_object_type(oid,ObjectTypeBase(name="ServiceCase",display_name="服务工单",plural_name="服务工单",icon="order",title_property="case_title",description="客户问题从受理到关闭的处置记录",group_ids=[service["id"]],interface_ids=[work_item["id"]],properties=[prop("case_id","工单编号",pk=True,required=True),prop("case_title","问题标题",required=True,search=True),prop("status","状态","enum",required=True,options=["待受理","处理中","已解决","已关闭"]),prop("assignee","受理人")]))
    save_link_type(oid,LinkTypeBase(name="customer_opens_case",display_name="发起工单",source_object_type_id=customer["id"],target_object_type_id=case["id"],cardinality="one_to_many",description="客户发起的服务请求"))
    save_link_type(oid,LinkTypeBase(name="case_assigned_to_agent",display_name="分派给",source_object_type_id=case["id"],target_object_type_id=agent["id"],cardinality="many_to_one",description="服务工单的当前受理人"))
    save_action(oid,ActionBase(name="assign_service_case",display_name="分派服务工单",target_object_type_id=case["id"],action_type="modify",description="将服务工单分派给服务人员",parameters=[prop("assignee","受理人",required=True)]))
    conn=get_conn(); conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=?",(oid,)); conn.commit(); conn.close()
