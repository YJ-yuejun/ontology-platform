"""Read-only semantic quality and release comparison for the ontology workbench.

The verdict and differences are deterministic. A configured language model may
explain those results, but it cannot alter the recorded quality report or diff.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from typing import Any

import repository as repo


SECTIONS = (
    ("business_domains", "业务域"),
    ("subject_domains", "主题域"),
    ("object_types", "对象类型"),
    ("interfaces", "接口"),
    ("link_types", "关系类型"),
    ("business_rules", "业务规则"),
    ("actions", "动作类型"),
    ("business-scenarios", "业务场景"),
    ("data-sources", "数据源"),
    ("governance-assets", "治理资产"),
    ("data-mappings", "数据映射"),
    ("logic-definitions", "规则与函数"),
    ("capabilities", "系统能力"),
    ("action-mappings", "动作执行映射"),
    ("permission-policies", "权限策略"),
)
SEMANTIC_FIELDS = {
    "business_domains": ("code", "name", "description", "owner"),
    "subject_domains": ("code", "name", "description", "business_domain_id", "owner"),
    "object_types": ("name", "display_name", "description", "title_property", "subject_domain_id", "properties", "interface_ids", "backing_source", "is_core"),
    "interfaces": ("name", "display_name", "description", "properties"),
    "link_types": ("name", "display_name", "description", "source_object_type_id", "target_object_type_id", "cardinality", "properties", "source_key", "target_key"),
    "business_rules": ("name", "display_name", "description", "target_object_type_id", "expression", "severity", "trigger_mode"),
    "actions": ("name", "display_name", "description", "target_object_type_id", "parameters", "preconditions", "precondition_mode", "execution_logic", "action_category"),
    # Compare source metadata without exposing host, username or credentials.
    "data-sources": ("code", "name", "category", "description", "system_type", "database_type",
                     "data_topic", "data_scope", "data_category", "interface_type", "update_frequency", "physical_object"),
}
EXCLUDED_KEYS = {
    "id", "ontology_id", "created_at", "updated_at", "created_by", "updated_by",
    "status", "design_status", "effective_properties", "effective_property_count",
    "source_display_name", "target_display_name", "target_display_name", "object_count",
    "property_count", "instance_count", "version", "based_on_version", "metadata",
}
SECRET_TOKENS = ("password", "secret", "api_key", "access_token", "private_key")

# 质检可按维度分段执行。key 与 repository.validate_ontology 的 checks[].key 一一对应，
# 前端用它让用户选择“全部质检”或“只查某几项”。
QUALITY_DIMENSIONS = (
    ("object_type", "对象主键与标题属性", "对象必须有且只有一个主键，标题属性必须来自已定义属性"),
    ("link_type", "关系端点与状态一致", "关系两端对象存在，且关系状态与端点对象状态相容"),
    ("action", "动作目标与参数", "动作指向有效对象，改写类动作应定义参数"),
    ("business_rule", "业务规则目标与表达式", "规则指向有效对象且必须有表达式"),
    ("interface", "接口实现完整", "对象正确实现所选接口的属性契约"),
    ("classification", "业务域与主题域分类", "对象类型必须归入主题域"),
    ("ontology", "模型至少包含一个业务对象类型", "本体不能是空的"),
    ("data_mapping", "数据映射引用完整", "映射引用的治理资产、对象与属性必须存在"),
    ("logic_definition", "规则与函数依赖完整", "规则与函数的引用与实现配置必须完整"),
)
# 校验结果里的 component / 企业资源 kind → 质检维度 key
_COMPONENT_TO_DIMENSION = {
    "object_type": "object_type", "link_type": "link_type", "action": "action",
    "business_rule": "business_rule", "interface": "interface",
    "classification": "classification", "ontology": "ontology",
    "data-mappings": "data_mapping", "logic-definitions": "logic_definition",
}
DIMENSION_LABELS = {key: label for key, label, _ in QUALITY_DIMENSIONS}


def init_tables() -> None:
    conn = repo.get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ontology_quality_runs (
          id TEXT PRIMARY KEY,
          ontology_id TEXT NOT NULL,
          version_label TEXT NOT NULL,
          model_fingerprint TEXT NOT NULL,
          result TEXT NOT NULL,
          report_json TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(ontology_id) REFERENCES ontologies(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_quality_runs_ontology_created
          ON ontology_quality_runs(ontology_id, created_at DESC);
    """)
    conn.commit()
    conn.close()


def _clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _clean(item) for key, item in sorted(value.items())
                if key not in EXCLUDED_KEYS and not any(token in key.lower() for token in SECRET_TOKENS)}
    if isinstance(value, list):
        return [_clean(item) for item in value]
    return value


def _items(snapshot: dict[str, Any], section: str) -> list[dict[str, Any]]:
    if "-" in section:
        return snapshot.get("enterprise_resources", {}).get(section, []) or []
    return snapshot.get(section, []) or []


def _semantic_index(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for section, section_label in SECTIONS:
        for item in _items(snapshot, section):
            stable_id = (item.get("code") or item.get("id") or item.get("name")) if "-" in section else (item.get("id") or item.get("code") or item.get("name"))
            if not stable_id:
                continue
            index[f"{section}:{stable_id}"] = {
                "section": section, "section_label": section_label,
                "stable_id": str(stable_id),
                "name": item.get("display_name") or item.get("name") or item.get("code") or str(stable_id),
                "fields": _clean({key: item[key] for key in SEMANTIC_FIELDS[section] if key in item})
                          if section in SEMANTIC_FIELDS else _clean(item),
            }
    for kind, rows in (snapshot.get("model_dictionaries") or {}).items():
        for item in rows:
            code = item.get("code")
            if code:
                index[f"dictionary:{kind}:{code}"] = {
                    "section": "model_dictionaries", "section_label": "字典项",
                    "stable_id": f"{kind}:{code}", "name": item.get("name") or code,
                    "fields": _clean(item),
                }
    return index


def _fingerprint(snapshot: dict[str, Any]) -> str:
    semantic = {key: value["fields"] for key, value in _semantic_index(snapshot).items()}
    encoded = json.dumps(semantic, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _current_semantic_snapshot(ontology_id: str) -> dict[str, Any]:
    # Do not load business instances merely to inspect schema quality or diff.
    from enterprise import list_resources
    from dictionary_service import DICTIONARIES, items as dictionary_items
    return {
        "ontology": repo.get_ontology(ontology_id),
        "business_domains": repo.list_business_domains(ontology_id),
        "subject_domains": repo.list_subject_domains(ontology_id),
        "object_types": repo.list_object_types(ontology_id),
        "interfaces": repo.list_interfaces(ontology_id),
        "link_types": repo.list_link_types(ontology_id),
        "business_rules": repo.list_business_rules(ontology_id),
        "actions": repo.list_actions(ontology_id),
        "enterprise_resources": {section: list_resources(ontology_id, section)
                                 for section, _ in SECTIONS if "-" in section},
        "model_dictionaries": {kind: dictionary_items(kind, include_disabled=True)
                               for kind in DICTIONARIES},
    }


def current_fingerprint(ontology_id: str) -> str:
    return _fingerprint(_current_semantic_snapshot(ontology_id))


def latest_passing_quality(ontology_id: str) -> dict[str, Any] | None:
    """A report is usable only for the exact semantic state that was checked."""
    conn = repo.get_conn()
    row = conn.execute("""SELECT id,result,model_fingerprint,created_at FROM ontology_quality_runs
        WHERE ontology_id=? ORDER BY created_at DESC LIMIT 1""", (ontology_id,)).fetchone()
    conn.close()
    if not row or not row["result"].startswith("通过"):
        return None
    if row["model_fingerprint"] != current_fingerprint(ontology_id):
        return None
    return dict(row)


def _quality_payload(ontology_id: str, scope: list[str] | None = None) -> dict[str, Any]:
    ontology = repo.get_ontology(ontology_id)
    validation = repo.validate_ontology(ontology_id)
    checks = list(validation["checks"])
    issues = [
        {"severity": severity, "resource_type": item["component"], "resource_id": item["id"], "message": item["message"]}
        for severity, group in (("error", validation["errors"]), ("warning", validation["warnings"]))
        for item in group
    ]
    from enterprise import _validate_authored_logic, _validate_data_mapping, list_resources
    from models import EnterpriseResourceBase
    def logic_resource(item: dict[str, Any]) -> EnterpriseResourceBase:
        envelope = {"id", "ontology_id", "code", "name", "category", "status", "description",
                    "created_at", "updated_at", "created_by", "updated_by"}
        return EnterpriseResourceBase(
            code=item["code"], name=item["name"], category=item.get("category", ""),
            status=item.get("status", "draft"), description=item.get("description"),
            payload={key: value for key, value in item.items() if key not in envelope},
        )
    for kind, key, label, validator in (
        ("data-mappings", "data_mapping", "数据映射引用完整", lambda item: _validate_data_mapping(ontology_id, item)),
        ("logic-definitions", "logic_definition", "规则与函数依赖完整", lambda item: _validate_authored_logic(ontology_id, logic_resource(item))),
    ):
        resources = list_resources(ontology_id, kind)
        if not resources:
            continue
        failures = 0
        for item in resources:
            try:
                validator(item)
            except (repo.ValidationError, ValueError, TypeError, KeyError) as exc:
                failures += 1
                issues.append({"severity": "error", "resource_type": kind, "resource_id": item["id"],
                               "message": f"{item['name']}：{exc}"})
        checks.append({"key": key, "name": label, "passed": failures == 0})
    # 按维度裁剪：不传 scope 表示全部质检
    selected = [item for item in (scope or []) if item in DIMENSION_LABELS]
    if selected:
        chosen = set(selected)
        checks = [item for item in checks if item.get("key") in chosen]
        issues = [item for item in issues if _COMPONENT_TO_DIMENSION.get(item["resource_type"]) in chosen]
    errors = sum(item["severity"] == "error" for item in issues)
    warnings = sum(item["severity"] == "warning" for item in issues)
    passed = sum(1 for item in checks if item["passed"])
    scope_note = ("当前工作状态的本体语义定义；不检查实例数据或生产接口运行结果"
                  if not selected else
                  "当前工作状态的本体语义定义；不检查实例数据或生产接口运行结果。本次只检查："
                  + "、".join(DIMENSION_LABELS[item] for item in selected))
    return {
        "ontology_name": ontology["name"],
        "scope": scope_note,
        "scope_keys": selected,
        "method": "确定性模型规则检查",
        "result": "待修复" if errors else "通过（含警告）" if warnings else "通过",
        "summary": f"{passed}/{len(checks)} 项检查通过；{errors} 项错误，{warnings} 项警告。",
        "checks": checks, "issues": issues, "stats": validation["stats"],
    }


def _scope_label(scope: list[str] | None) -> str:
    """version_label 这一列现在承载“本次质检范围”，不再表达版本（产品已去掉版本概念）。"""
    selected = [item for item in (scope or []) if item in DIMENSION_LABELS]
    if not selected:
        return "全部维度"
    labels = [DIMENSION_LABELS[item] for item in selected]
    if len(labels) <= 3:
        return "、".join(labels)
    return f"{'、'.join(labels[:3])} 等 {len(labels)} 项"


def run_quality(ontology_id: str, scope: list[str] | None = None) -> dict[str, Any]:
    snapshot = _current_semantic_snapshot(ontology_id)
    payload = _quality_payload(ontology_id, scope)
    label = _scope_label(scope)
    run = {
        "id": str(uuid.uuid4()), "ontology_id": ontology_id,
        "version_label": label, "scope_label": label, "scope_keys": payload.get("scope_keys") or [],
        "model_fingerprint": _fingerprint(snapshot),
        "result": payload["result"], "report": payload,
        "created_by": repo.audit_actor(), "created_at": repo.now(), "stale": False,
    }
    conn = repo.get_conn()
    conn.execute("""INSERT INTO ontology_quality_runs
      (id,ontology_id,version_label,model_fingerprint,result,report_json,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?)""", (
        run["id"], ontology_id, run["version_label"], run["model_fingerprint"],
        run["result"], json.dumps(payload, ensure_ascii=False), run["created_by"], run["created_at"],
    ))
    conn.commit()
    conn.close()
    return run


def list_quality(ontology_id: str, limit: int = 10) -> list[dict[str, Any]]:
    snapshot = _current_semantic_snapshot(ontology_id)
    current_fingerprint = _fingerprint(snapshot)
    conn = repo.get_conn()
    rows = conn.execute("""SELECT * FROM ontology_quality_runs WHERE ontology_id=?
        ORDER BY created_at DESC LIMIT ?""", (ontology_id, limit)).fetchall()
    conn.close()
    return [
        {**{key: row[key] for key in row.keys() if key != "report_json"},
         "report": json.loads(row["report_json"]), "stale": row["model_fingerprint"] != current_fingerprint}
        for row in rows
    ]


def get_quality(ontology_id: str, run_id: str) -> dict[str, Any]:
    for run in list_quality(ontology_id, 100):
        if run["id"] == run_id:
            return run
    raise repo.NotFoundError("质检报告不存在")


def _snapshot_for(ontology_id: str, selection: str) -> tuple[dict[str, Any], str]:
    if selection == "working":
        return _current_semantic_snapshot(ontology_id), "当前工作状态"
    conn = repo.get_conn()
    row = conn.execute("SELECT version,snapshot FROM ontology_releases WHERE ontology_id=? AND id=?", (ontology_id, selection)).fetchone()
    conn.close()
    if not row:
        raise repo.NotFoundError("所选发布版本不存在")
    if not row["snapshot"]:
        raise repo.ValidationError("该历史版本缺少快照，无法对比")
    return json.loads(row["snapshot"]), row["version"]


def release_snapshot(ontology_id: str, release_id: str) -> dict[str, Any]:
    """Read a published semantic model, never an instance or connection export."""
    snapshot, label = _snapshot_for(ontology_id, release_id)
    resources = snapshot.get("enterprise_resources") or {}
    sources = []
    for item in resources.get("data-sources", []):
        sources.append({key: item.get(key) for key in (
            "id", "code", "name", "physical_object", "system_type", "data_topic",
            "data_scope", "data_category", "interface_type", "update_frequency")})
    return {
        "release_id": release_id, "version": label,
        "ontology": {key: snapshot.get("ontology", {}).get(key) for key in ("id", "name", "namespace", "description")},
        **{section: snapshot.get(section, []) for section, _ in SECTIONS if "-" not in section},
        "enterprise_resources": {
            **{key: value for key, value in resources.items() if key != "data-sources"},
            "data-sources": sources,
        },
        "model_dictionaries": snapshot.get("model_dictionaries") or {},
    }


def _reference_names(snapshot: dict[str, Any]) -> dict[str, str]:
    names = {}
    for section in ("business_domains", "subject_domains", "object_types", "interfaces", "link_types"):
        for item in _items(snapshot, section):
            if item.get("id"):
                names[item["id"]] = item.get("display_name") or item.get("name") or item["id"]
    return names


def compare_versions(ontology_id: str, left: str, right: str) -> dict[str, Any]:
    repo.get_ontology(ontology_id)
    if left == right:
        raise repo.ValidationError("请选择两个不同的版本或工作状态")
    left_snapshot, left_label = _snapshot_for(ontology_id, left)
    right_snapshot, right_label = _snapshot_for(ontology_id, right)
    before, after = _semantic_index(left_snapshot), _semantic_index(right_snapshot)
    rows = []
    for key in sorted(set(before) | set(after)):
        old, new = before.get(key), after.get(key)
        old_fields, new_fields = old["fields"] if old else {}, new["fields"] if new else {}
        changed = [field for field in sorted(set(old_fields) | set(new_fields)) if old_fields.get(field) != new_fields.get(field)]
        if not old:
            change = "added"
        elif not new:
            change = "removed"
        elif changed:
            change = "modified"
        else:
            continue
        record = new or old
        rows.append({
            "key": key, "section": record["section"], "section_label": record["section_label"],
            "name": record["name"], "stable_id": record["stable_id"], "change": change,
            "changed_fields": changed,
            "left": {field: old_fields.get(field) for field in changed},
            "right": {field: new_fields.get(field) for field in changed},
        })
    counts = {kind: sum(row["change"] == kind for row in rows) for kind in ("added", "modified", "removed")}
    return {
        "left": {"id": left, "label": left_label}, "right": {"id": right, "label": right_label},
        "reference_names": {"left": _reference_names(left_snapshot), "right": _reference_names(right_snapshot)},
        "counts": counts, "rows": rows, "total": len(rows),
        "method": "按资源稳定 ID 对比语义字段；忽略实例、操作时间和发布状态",
        "note": "删除项及字段变化需要人工确认下游影响；本页不自动判定兼容性，也不修改本体。",
    }


# ---------------------------------------------------------------------------
# 跨本体对比
#
# 产品已去掉“版本”概念：不再拿同一本体的两个发布快照比，而是直接拿两个本体比。
# 复制出来的分支里所有资源都是**新 UUID**，所以：
#   1) 匹配键必须换成业务稳定标识（对象/关系/接口/规则用 name，业务域/主题域与企业资源用 code）；
#   2) 引用字段（主题域、接口、对象端点）必须归一化成稳定标识，
#      否则同一条关系在两边会因为 UUID 不同而被判成“修改”。
# ---------------------------------------------------------------------------

_REFERENCE_FIELDS = {
    "subject_domains": {"business_domain_id": "business_domains"},
    "object_types": {"subject_domain_id": "subject_domains", "interface_ids": "interfaces"},
    "link_types": {"source_object_type_id": "object_types", "target_object_type_id": "object_types"},
    "business_rules": {"target_object_type_id": "object_types"},
    "actions": {"target_object_type_id": "object_types"},
}


def _stable_key(section: str, item: dict[str, Any]) -> str:
    if "-" in section or section in ("business_domains", "subject_domains"):
        return str(item.get("code") or item.get("name") or "")
    return str(item.get("name") or item.get("code") or "")


def _drop_none(value: Any) -> Any:
    """把值为 None 的键视为“未设置”。

    复制出来的本体经过 Pydantic 序列化会补出 template_id=None 这类键，而原体的原始 JSON
    里根本没有这些键；两者语义相同，不该被报成“已修改”。只在跨本体对比里使用，
    不动 _semantic_index，避免改变模型指纹让既有质检报告集体失效。
    """
    if isinstance(value, dict):
        return {key: _drop_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_drop_none(item) for item in value]
    return value


def _normalize_references(section: str, fields: dict[str, Any], key_of: dict[str, str]) -> dict[str, Any]:
    mapping = _REFERENCE_FIELDS.get(section)
    result = dict(fields)
    for field, _target in (mapping or {}).items():
        if field not in result:
            continue
        value = result[field]
        if isinstance(value, list):
            result[field] = sorted(str(key_of.get(item, item)) for item in value if item)
        elif value:
            result[field] = key_of.get(value, value)
    # 属性里的 shared_property_id 是运行时 UUID 引用，跨本体必须忽略，否则每条属性都会误报。
    if isinstance(result.get("properties"), list):
        result["properties"] = [
            {key: (None if key == "shared_property_id" else item) for key, item in prop.items()}
            if isinstance(prop, dict) else prop
            for prop in result["properties"]
        ]
    return result


def _stable_index(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    key_of: dict[str, str] = {}
    for section, _label in SECTIONS:
        for item in _items(snapshot, section):
            if item.get("id"):
                key_of[item["id"]] = _stable_key(section, item)
    index: dict[str, dict[str, Any]] = {}
    for section, section_label in SECTIONS:
        for item in _items(snapshot, section):
            stable_id = _stable_key(section, item)
            if not stable_id:
                continue
            raw = ({key: item[key] for key in SEMANTIC_FIELDS[section] if key in item}
                   if section in SEMANTIC_FIELDS else item)
            fields = _drop_none(_normalize_references(section, _clean(raw), key_of))
            index[f"{section}:{stable_id}"] = {
                "section": section, "section_label": section_label, "stable_id": stable_id,
                "name": item.get("display_name") or item.get("name") or item.get("code") or stable_id,
                "fields": fields,
            }
    return index


def compare_ontologies(left_oid: str, right_oid: str) -> dict[str, Any]:
    if left_oid == right_oid:
        raise repo.ValidationError("请选择两个不同的本体进行对比")
    left_ontology = repo.get_ontology(left_oid)
    right_ontology = repo.get_ontology(right_oid)
    left_snapshot = _current_semantic_snapshot(left_oid)
    right_snapshot = _current_semantic_snapshot(right_oid)
    before, after = _stable_index(left_snapshot), _stable_index(right_snapshot)
    rows = []
    for key in sorted(set(before) | set(after)):
        old, new = before.get(key), after.get(key)
        old_fields, new_fields = old["fields"] if old else {}, new["fields"] if new else {}
        changed = [field for field in sorted(set(old_fields) | set(new_fields)) if old_fields.get(field) != new_fields.get(field)]
        if not old:
            change = "added"
        elif not new:
            change = "removed"
        elif changed:
            change = "modified"
        else:
            continue
        record = new or old
        rows.append({
            "key": key, "section": record["section"], "section_label": record["section_label"],
            "name": record["name"], "stable_id": record["stable_id"], "change": change,
            "changed_fields": changed,
            "left": {field: old_fields.get(field) for field in changed},
            "right": {field: new_fields.get(field) for field in changed},
        })
    counts = {kind: sum(row["change"] == kind for row in rows) for kind in ("added", "modified", "removed")}
    return {
        "left": {"id": left_oid, "label": left_ontology["name"], "namespace": left_ontology.get("namespace")},
        "right": {"id": right_oid, "label": right_ontology["name"], "namespace": right_ontology.get("namespace")},
        "reference_names": {"left": _reference_names(left_snapshot), "right": _reference_names(right_snapshot)},
        "counts": counts, "rows": rows, "total": len(rows),
        "method": "按业务稳定标识（对象／关系／接口／规则用 name，业务域／主题域与企业资源用 code）跨本体对比语义字段；引用关系已归一到稳定标识",
        "note": "两个本体的资源 ID 不相同，本页只按业务标识配对；删除项及字段变化仍需人工确认下游影响。",
    }


def compare_ontologies_chat(left_oid: str, right_oid: str, message: str) -> dict[str, str]:
    result = compare_ontologies(left_oid, right_oid)
    return _diff_answer(result, message)


def _explain_with_model(system: str, evidence: dict[str, Any], message: str) -> dict[str, str] | None:
    # Sending enterprise semantics to an external model is opt-in, even if a
    # general-purpose key is already configured for other prototype features.
    if os.environ.get("ONTOLOGY_GOVERNANCE_AI_ENABLED") != "1":
        return None
    encoded_evidence = json.dumps(evidence, ensure_ascii=False)
    if len(encoded_evidence) > 16000:
        return None
    try:
        from enterprise import _call_deepseek
        response, _ = _call_deepseek(
            system + "只基于给定 JSON 证据回答。不得虚构检查、版本差异或生产运行结果。返回 JSON：{\"answer\":string}。",
            f"证据：{encoded_evidence}\n用户问题：{message[:1000]}",
        )
        answer = response.get("answer")
        if isinstance(answer, str) and answer.strip():
            return {"answer": answer.strip(), "mode": "ai_explanation"}
    except Exception:
        pass
    return None


def quality_chat(ontology_id: str, run_id: str, message: str) -> dict[str, str]:
    run = get_quality(ontology_id, run_id)
    report = run["report"]
    explained = _explain_with_model("你是本体语义质检报告解读助手。质检结论只能来自确定性报告，不能擅自改分或追加检查项。", report, message)
    if explained:
        return explained
    if run["stale"]:
        answer = "这份报告对应的模型已发生变化，请先重新运行质检，再解读当前模型的问题。"
    elif "检查" in message or "范围" in message:
        names = "、".join(item["name"] for item in report["checks"])
        answer = f"本次按{report['method']}执行：{names}。{report['scope']}。"
    elif ("修复" in message or "先" in message) and report["issues"]:
        first = next((item for item in report["issues"] if item["severity"] == "error"), report["issues"][0])
        guidance = {
            "object_type": "回到对象类型，核对主键、标题属性及属性定义",
            "link_type": "回到关系类型，核对两端对象与状态",
            "interface": "回到接口和对象类型，补齐要求的属性及数据类型",
            "classification": "回到业务域与主题域，为对象补齐归属",
            "data-mappings": "回到数据源与映射，核对治理资产、来源字段和目标引用",
            "logic-definitions": "回到规则，核对适用对象、输入属性和表达式",
        }.get(first["resource_type"], "回到对应资源页面核对定义")
        answer = f"建议先处理：{first['message']}。操作入口：{guidance}。保存后重新运行质检。"
    elif report["issues"]:
        issue_lines = "；".join(item["message"] for item in report["issues"][:5])
        answer = f"本次结论：{report['result']}。{report['summary']}优先处理：{issue_lines}。修复后重新运行质检。"
    else:
        answer = f"本次结论：{report['result']}。{report['summary']}当前检查范围内未发现语义结构问题；不代表实例数据或生产接口已验证。"
    return {"answer": answer, "mode": "rule_fallback"}


def _diff_answer(result: dict[str, Any], message: str) -> dict[str, str]:
    focused = [row for row in result["rows"] if row["name"] in message or row["stable_id"] in message][:5]
    evidence = {
        "left": result["left"], "right": result["right"], "total": result["total"], "counts": result["counts"],
        "changes": [{"section": row["section_label"], "name": row["name"], "change": row["change"],
                     "changed_fields": row["changed_fields"]} for row in result["rows"][:80]],
        "focused_details": focused, "truncated": result["total"] > 80,
    }
    explained = _explain_with_model("你是本体差异解读助手。只解释表中可核验的结构差异；不推断运行影响已发生。", evidence, message)
    if explained:
        return explained
    counts = result["counts"]
    if result["total"] == 0:
        answer = f"“{result['left']['label']}”与“{result['right']['label']}”在当前对比范围内没有语义字段差异。"
    else:
        removed = [row["name"] for row in result["rows"] if row["change"] == "removed"][:5]
        hit = next((row for row in result["rows"] if row["name"] in message or row["stable_id"] in message), None)
        if hit:
            answer = f"{hit['section_label']}“{hit['name']}”属于{ {'added': '新增', 'modified': '修改', 'removed': '删除'}[hit['change']]}项；差异字段：{'、'.join(hit['changed_fields'])}。请在左右栏核对字段原值和新值。"
        elif "删除" in message:
            answer = f"删除 {counts['removed']} 项：{'、'.join(removed) if removed else '无'}。删除可能影响引用方，需逐一核对下游依赖。"
        elif "新增" in message:
            names = [row["name"] for row in result["rows"] if row["change"] == "added"][:8]
            answer = f"新增 {counts['added']} 项：{'、'.join(names) if names else '无'}{'等' if counts['added'] > len(names) else ''}。"
        elif "影响" in message or "依赖" in message:
            answer = f"需要优先核对删除的 {counts['removed']} 项和修改的 {counts['modified']} 项所被引用的对象、映射、规则、场景与接口。本页未执行依赖图分析，不能直接断言已产生运行影响。"
        else:
            answer = f"{result['left']['label']} → {result['right']['label']}：新增 {counts['added']} 项、修改 {counts['modified']} 项、删除 {counts['removed']} 项。"
            if removed:
                answer += f" 建议优先核对删除项：{'、'.join(removed)}。"
            answer += "下游兼容性仍需结合依赖和业务场景人工确认。"
    return {"answer": answer, "mode": "rule_fallback"}


def compare_chat(ontology_id: str, left: str, right: str, message: str) -> dict[str, str]:
    return _diff_answer(compare_versions(ontology_id, left, right), message)
