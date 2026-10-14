"""Add clearly marked, repeatable governance-layer demo data to the pipeline ontology.

This is a prototype fixture, not a claim that an enterprise data platform is connected.
It preserves the four workbook mappings as historical physical-source evidence.
Run from this directory with: ../.venv/bin/python seed_pipeline_mapping_demo.py
"""

from __future__ import annotations

import argparse

import repository as repo
from enterprise import list_resources, save_resource
from models import EnterpriseResourceBase


NAMESPACE = "enterprise.pipeline.operations.manual"
MARKER = "pipeline-governance-graph-demo-v1"
OWNER = "原型演示"


ASSETS = [
    (
        "DEMO-GA-TASK", "【演示】运输任务治理实体", "数据实体", "运输调度",
        "DS-001", "运输任务表",
        [("TASK_ID", "VARCHAR(64)", True), ("STATUS", "VARCHAR(32)", False), ("PLAN_QTY", "DECIMAL(18,2)", False)],
    ),
    (
        "DEMO-GA-ROUTE", "【演示】任务线路治理关系", "治理视图", "运输调度",
        "DS-001", "任务线路明细",
        [("TASK_ID", "VARCHAR(64)", True), ("PIPE_ID", "VARCHAR(64)", True)],
    ),
    (
        "DEMO-GA-MONITOR", "【演示】管段运行监测实体", "数据实体", "运行监测",
        "DS-002", "实时接口",
        [("PIPE_ID", "VARCHAR(64)", True), ("PRESSURE", "DECIMAL(10,3)", False)],
    ),
    (
        "DEMO-GA-PIPELINE", "【演示】管线治理实体", "数据实体", "管网资产",
        "DS-003", "资产台账",
        [("PIPE_ID", "VARCHAR(64)", True)],
    ),
    (
        "DEMO-GA-EQUIPMENT", "【演示】设备治理实体", "数据实体", "管网资产",
        "DS-003", "资产台账",
        [("EQUIPMENT_ID", "VARCHAR(64)", True), ("STATUS", "VARCHAR(32)", False)],
    ),
    (
        "DEMO-GA-CONTRACT", "【演示】合同治理实体", "数据实体", "合同管理",
        "DS-004", "合同表/接口",
        [("CONTRACT_ID", "VARCHAR(64)", True), ("STATUS", "VARCHAR(32)", False)],
    ),
    (
        "DEMO-GA-WORKORDER", "【演示】工单治理实体", "数据实体", "运维工单",
        "DS-005", "工单接口",
        [("WORK_ORDER_ID", "VARCHAR(64)", True), ("STATUS", "VARCHAR(32)", False)],
    ),
]

# code, governed asset, governed field(s), semantic target, physical source,
# original source location/field, mapping method, quality check.
MAPPINGS = [
    ("DEMO-MAP-001", "DEMO-GA-TASK", "TASK_ID", "TransportTask.taskId", "DS-001", "运输任务表", "TASK_ID", "直接映射", "非空+唯一"),
    ("DEMO-MAP-002", "DEMO-GA-TASK", "STATUS", "TransportTask.status", "DS-001", "运输任务表", "STATUS", "枚举映射", "枚举合法"),
    ("DEMO-MAP-003", "DEMO-GA-TASK", "PLAN_QTY", "TransportTask.plannedQuantity", "DS-001", "运输任务表", "PLAN_QTY", "字段/单位映射", "单位与范围核对"),
    ("DEMO-MAP-004", "DEMO-GA-ROUTE", ("TASK_ID", "PIPE_ID"), "relation:passes_through", "DS-001", "任务线路明细", "TASK_ID/PIPE_ID", "关联映射", "两端对象均存在"),
    ("DEMO-MAP-005", "DEMO-GA-MONITOR", "PRESSURE", "PipeSegment.pressure", "DS-002", "实时接口", "PRESSURE", "字段/单位映射", "范围与时间完整性"),
    ("DEMO-MAP-006", "DEMO-GA-PIPELINE", "PIPE_ID", "Pipeline.pipelineId", "DS-003", "资产台账", "PIPE_ID", "直接映射", "非空+唯一"),
    ("DEMO-MAP-007", "DEMO-GA-EQUIPMENT", "EQUIPMENT_ID", "Equipment.equipmentId", "DS-003", "资产台账", "EQUIPMENT_ID", "直接映射", "非空+唯一"),
    ("DEMO-MAP-008", "DEMO-GA-EQUIPMENT", "STATUS", "Equipment.status", "DS-003", "资产台账", "STATUS", "枚举映射", "枚举合法"),
    ("DEMO-MAP-009", "DEMO-GA-CONTRACT", "CONTRACT_ID", "Contract.contractId", "DS-004", "合同表/接口", "CONTRACT_ID", "直接映射", "非空+唯一"),
    ("DEMO-MAP-010", "DEMO-GA-WORKORDER", "WORK_ORDER_ID", "WorkOrder.workOrderId", "DS-005", "工单接口", "WORK_ORDER_ID", "直接映射", "非空+唯一"),
]

ASSET_KEYS = {
    "DEMO-GA-TASK": "TASK_ID", "DEMO-GA-ROUTE": "TASK_ID+PIPE_ID",
    "DEMO-GA-MONITOR": "PIPE_ID", "DEMO-GA-PIPELINE": "PIPE_ID",
    "DEMO-GA-EQUIPMENT": "EQUIPMENT_ID", "DEMO-GA-CONTRACT": "CONTRACT_ID",
    "DEMO-GA-WORKORDER": "WORK_ORDER_ID",
}


def main(dry_run: bool = False) -> None:
    conn = repo.get_conn()
    ontology = conn.execute("SELECT id,name FROM ontologies WHERE namespace=?", (NAMESPACE,)).fetchone()
    conn.close()
    if not ontology:
        raise SystemExit("找不到管道运输运营本体；未改动任何数据。")
    oid = ontology["id"]
    sources = {item["code"] for item in list_resources(oid, "data-sources")}
    objects = {item["name"]: {prop["key"] for prop in item["properties"]} for item in repo.list_object_types(oid)}
    relations = {item["name"] for item in repo.list_link_types(oid)}
    asset_specs = {item[0]: item for item in ASSETS}
    for code, _, _, _, source_code, _, _ in ASSETS:
        if source_code not in sources:
            raise SystemExit(f"缺少来源 {source_code}（{code}）；未开始写入。")
    for code, asset_code, fields, target, *_ in MAPPINGS:
        if asset_code not in asset_specs:
            raise SystemExit(f"{code} 引用了未定义治理资产 {asset_code}。")
        available = {field[0] for field in asset_specs[asset_code][6]}
        if not set(fields if isinstance(fields, tuple) else [fields]) <= available:
            raise SystemExit(f"{code} 的治理字段不存在。")
        if target.startswith("relation:"):
            if target.removeprefix("relation:") not in relations:
                raise SystemExit(f"{code} 的本体关系不存在。")
        else:
            object_name, property_key = target.split(".", 1)
            if property_key not in objects.get(object_name, set()):
                raise SystemExit(f"{code} 的目标属性不存在。")

    existing_assets = {item["code"]: item for item in list_resources(oid, "governance-assets")}
    existing_mappings = {item["code"]: item for item in list_resources(oid, "data-mappings")}
    for kind, specs, existing in (("治理资产", ASSETS, existing_assets), ("语义映射", MAPPINGS, existing_mappings)):
        for spec in specs:
            old = existing.get(spec[0])
            if old and old.get("demo_marker") != MARKER:
                raise SystemExit(f"{kind}编码 {spec[0]} 已被非本演示数据占用；未开始写入。")
    additions = (sum(item[0] not in existing_assets for item in ASSETS),
                 sum(item[0] not in existing_mappings for item in MAPPINGS))
    if dry_run:
        print(f"目标：{ontology['name']}；拟新增 {additions[0]} 个演示治理资产、{additions[1]} 条演示语义映射；保留模板映射。")
        return

    for code, name, asset_kind, subject, source_code, upstream_object, fields in ASSETS:
        if code in existing_assets:
            continue
        payload = {
            "demo_marker": MARKER, "catalog_origin": "enterprise_catalog", "verification_status": "confirmed",
            "asset_kind": asset_kind, "governance_subject": subject, "asset_version": "DEMO-1",
            "upstream_source_code": source_code, "upstream_object": upstream_object,
            "fields": [{"name": field_name, "data_type": data_type, "is_key": is_key}
                       for field_name, data_type, is_key in fields],
        }
        save_resource(oid, "governance-assets", EnterpriseResourceBase(
            code=code, name=name, category=asset_kind, status="example",
            description="原型模拟治理目录资产，用于演示三层映射；‘已确认’仅表示原型字段契约可被映射选择，不代表真实数据中台核验或实例接入。",
            payload=payload))

    for code, asset_code, fields, target, source_code, location, source_field, map_way, quality_rule in MAPPINGS:
        if code in existing_mappings:
            continue
        relation = target.startswith("relation:")
        object_name, property_key = ("", "") if relation else target.split(".", 1)
        target_name = target.removeprefix("relation:") if relation else f"{object_name}.{property_key}"
        payload = {
            "demo_marker": MARKER, "mapping_type": "relation" if relation else "property",
            "mapping_type_display": "关系映射" if relation else "属性映射", "binding_mode": "governed",
            "governance_asset_code": asset_code,
            "governance_relation_fields": list(fields) if relation else [],
            "governance_field": "" if relation else fields,
            "target_relation": target_name if relation else "",
            "target_object_type": "" if relation else object_name,
            "target_property": "" if relation else property_key,
            "source_code": source_code, "source_kind": "api" if relation else "table",
            "source_table": location, "source_field": source_field,
            "source_key": ASSET_KEYS[asset_code],
            "map_way": map_way, "transform_rule": "待按企业口径确认", "quality_rule": quality_rule,
            "update_method": "realtime" if source_code in {"DS-001", "DS-002", "DS-005"} else "batch",
            "owner": OWNER, "design_status": "设计中",
        }
        save_resource(oid, "data-mappings", EnterpriseResourceBase(
            code=code, name=f"【演示】{target_name} ← {asset_code}",
            category="关系映射" if relation else "属性映射", status="example",
            description="原型模拟语义映射；仅展示治理资产与本体的结构关系，未连接真实中台、未导入实例。",
            payload=payload))
    print(f"已为 {ontology['name']} 新增 {additions[0]} 个演示治理资产、{additions[1]} 条演示语义映射；模板映射未改动。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="只检查目标与计划，不写入")
    main(parser.parse_args().dry_run)
