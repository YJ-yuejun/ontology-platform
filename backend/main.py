from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional
from pydantic import BaseModel, Field

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import repository as repo
import enterprise
import source_connections
import dictionary_service
import governance_insights
from models import (
    ActionBase,
    AgentChatRequest,
    AIAnalyzeRequest,
    BuildSessionCreate,
    BuildSessionTransition,
    BusinessDomainBase,
    BusinessRuleBase,
    EnterpriseResourceBase,
    EvidenceUpload,
    ImportRequest,
    InterfaceBase,
    LinkTypeBase,
    LinkInstanceBase,
    ObjectInstanceBase,
    ObjectTypeBase,
    OntologyBase,
    SubjectDomainBase,
    ProposalDecision,
    PublishRequest,
    RuleTestRequest,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    repo.init_db()
    yield


app = FastAPI(
    title="企业本体 Studio API",
    description="Foundry 风格的企业本体建模、数据映射、Proposal 治理与智能体运行服务。",
    version="1.9.0",
    lifespan=lifespan,
)


class VersionCompareRequest(BaseModel):
    left: str = Field(min_length=1)
    right: str = Field(min_length=1)


class GovernanceChatRequest(VersionCompareRequest):
    message: str = Field(min_length=1, max_length=1000)


class QualityChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class OntologyCopyRequest(BaseModel):
    # 留空则默认「原名_copy」，命名空间自动加后缀保证唯一
    name: Optional[str] = Field(default=None, max_length=100)
    namespace: Optional[str] = Field(default=None, max_length=100)


class QualityRunRequest(BaseModel):
    # 空数组或省略表示全部维度质检
    scope: list[str] = Field(default_factory=list)


class OntologyCompareRequest(BaseModel):
    other_id: str = Field(min_length=1)


class OntologyCompareChatRequest(OntologyCompareRequest):
    message: str = Field(min_length=1, max_length=1000)


@app.exception_handler(repo.NotFoundError)
async def not_found_handler(_, exc: repo.NotFoundError):
    return _error(404, str(exc))


@app.exception_handler(repo.ConflictError)
async def conflict_handler(_, exc: repo.ConflictError):
    return _error(409, str(exc))


@app.exception_handler(repo.ValidationError)
async def validation_handler(_, exc: repo.ValidationError):
    return _error(400, str(exc))


@app.exception_handler(RequestValidationError)
async def request_validation_handler(request: Request, exc: RequestValidationError):
    """Turn Pydantic's raw English validation output into an actionable message.

    The model contract intentionally keeps machine identifiers strict, but the
    old default 422 response exposed the regex itself. That made a perfectly
    expected form mistake look like a server failure, especially in the object
    type wizard's final save step.
    """
    is_object_type = "/object-types" in request.url.path
    messages = []
    for item in exc.errors():
        loc = [str(value) for value in item.get("loc", ()) if value not in {"body", "query", "path"}]
        field = ".".join(loc)
        raw = item.get("msg", "字段校验未通过")
        if is_object_type and field == "name" and "pattern" in raw:
            message = "稳定标识（API 名称）必须以大写英文字母开头，只能包含英文字母和数字，例如 PurchaseContract"
        elif is_object_type and field.startswith("properties.") and field.endswith(".key") and "pattern" in raw:
            message = "属性字段名称必须以英文字母开头，只能包含英文字母、数字和下划线"
        elif is_object_type and field.startswith("properties.") and field.endswith(".name"):
            message = "属性中文名称不能为空"
        elif "Field required" in raw:
            message = f"{field or '请求字段'}不能为空"
        else:
            message = f"{field + '：' if field else ''}{raw}"
        if message not in messages:
            messages.append(message)
    return _error(422, "；".join(messages) or "请求参数校验未通过")


def _error(status: int, detail: str):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=status, content={"detail": detail})


@app.get("/api/system/status")
def system_status():
    import os
    return {
        "service": "enterprise-ontology-studio",
        "version": "1.9.0",
        "mode": "hybrid-ontology-development",
        "database": "connected",
        "ai_enabled": bool(os.environ.get("DEEPSEEK_API_KEY")),
        "model": "deepseek-v4-flash",
        "ai_policy": "proposal-first",
        "layers": ["schema", "mapping", "logic", "action", "security", "runtime"],
    }


@app.get("/api/dictionaries")
def list_dictionary_types():
    return enterprise.list_dictionary_types()


@app.get("/api/dictionaries/{dict_type}")
def list_dictionary_items(dict_type: str):
    return enterprise.list_dictionary_items(dict_type)


@app.get("/api/model-dictionaries")
def list_model_dictionary_types():
    return dictionary_service.types()


@app.get("/api/model-dictionaries/{dict_type}")
def list_model_dictionary_items(dict_type: str, include_disabled: bool = False):
    return dictionary_service.items(dict_type, include_disabled)


@app.post("/api/model-dictionaries/{dict_type}", status_code=201)
def create_model_dictionary_item(dict_type: str, data: dict[str, Any]):
    return dictionary_service.save(dict_type, data)


@app.put("/api/model-dictionaries/{dict_type}/{item_id}")
def update_model_dictionary_item(dict_type: str, item_id: str, data: dict[str, Any]):
    return dictionary_service.save(dict_type, data, item_id)


@app.delete("/api/model-dictionaries/{dict_type}/{item_id}", status_code=204)
def delete_model_dictionary_item(dict_type: str, item_id: str):
    dictionary_service.remove(dict_type, item_id)


@app.get("/api/ontologies")
def list_ontologies():
    return repo.list_ontologies()


@app.post("/api/ontologies", status_code=201)
def create_ontology(data: OntologyBase):
    return repo.create_ontology(data)


@app.post("/api/ontologies/import", status_code=201)
def import_ontology(data: ImportRequest):
    return repo.import_ontology(data.payload)


@app.post("/api/ontologies/{ontology_id}/copy", status_code=201)
def copy_ontology(ontology_id: str, data: Optional[OntologyCopyRequest] = None):
    """整体复制一个本体作为新分支（用于迭代；产品已去掉版本概念）。"""
    return repo.copy_ontology(ontology_id, data.name if data else None, data.namespace if data else None)


@app.get("/api/ontologies/{ontology_id}")
def get_ontology(ontology_id: str):
    return repo.get_ontology(ontology_id)


@app.put("/api/ontologies/{ontology_id}")
def update_ontology(ontology_id: str, data: OntologyBase):
    return repo.update_ontology(ontology_id, data)


@app.delete("/api/ontologies/{ontology_id}", status_code=204)
def delete_ontology(ontology_id: str):
    repo.delete_ontology(ontology_id)


@app.get("/api/ontologies/{ontology_id}/overview")
def get_overview(ontology_id: str):
    return repo.overview(ontology_id)


@app.get("/api/ontologies/{ontology_id}/catalog")
def get_catalog(ontology_id: str):
    return repo.catalog(ontology_id)


@app.get("/api/ontologies/{ontology_id}/object-types")
def list_object_types(ontology_id: str, include_abstract: bool = True):
    return repo.list_object_types(ontology_id, include_abstract)


@app.post("/api/ontologies/{ontology_id}/object-types", status_code=201)
def create_object_type(ontology_id: str, data: ObjectTypeBase):
    return repo.create_object_type(ontology_id, data)


@app.get("/api/object-types/{component_id}")
def get_object_type(component_id: str):
    return repo.get_object_type(component_id)


@app.put("/api/object-types/{component_id}")
def update_object_type(component_id: str, data: ObjectTypeBase):
    return repo.update_object_type(component_id, data)


@app.delete("/api/object-types/{component_id}", status_code=204)
def delete_object_type(component_id: str):
    repo.delete_object_type(component_id)


@app.get("/api/ontologies/{ontology_id}/business-domains")
def list_business_domains(ontology_id: str):
    return repo.list_business_domains(ontology_id)


@app.post("/api/ontologies/{ontology_id}/business-domains", status_code=201)
def create_business_domain(ontology_id: str, data: BusinessDomainBase):
    return repo.save_business_domain(ontology_id, data)


@app.put("/api/business-domains/{component_id}")
def update_business_domain(component_id: str, data: BusinessDomainBase):
    current = repo.get_business_domain(component_id)
    return repo.save_business_domain(current["ontology_id"], data, component_id)


@app.delete("/api/business-domains/{component_id}", status_code=204)
def delete_business_domain(component_id: str):
    repo.delete_business_domain(component_id)


@app.get("/api/ontologies/{ontology_id}/subject-domains")
def list_subject_domains(ontology_id: str, business_domain_id: Optional[str] = None):
    return repo.list_subject_domains(ontology_id, business_domain_id)


@app.post("/api/ontologies/{ontology_id}/subject-domains", status_code=201)
def create_subject_domain(ontology_id: str, data: SubjectDomainBase):
    return repo.save_subject_domain(ontology_id, data)


@app.put("/api/subject-domains/{component_id}")
def update_subject_domain(component_id: str, data: SubjectDomainBase):
    current = repo.get_subject_domain(component_id)
    return repo.save_subject_domain(current["ontology_id"], data, component_id)


@app.delete("/api/subject-domains/{component_id}", status_code=204)
def delete_subject_domain(component_id: str):
    repo.delete_subject_domain(component_id)


@app.get("/api/ontologies/{ontology_id}/link-types")
def list_link_types(ontology_id: str):
    return repo.list_link_types(ontology_id)


@app.post("/api/ontologies/{ontology_id}/link-types", status_code=201)
def create_link_type(ontology_id: str, data: LinkTypeBase):
    return repo.save_link_type(ontology_id, data)


@app.get("/api/link-types/{component_id}")
def get_link_type(component_id: str):
    return repo.get_link_type(component_id)


@app.put("/api/link-types/{component_id}")
def update_link_type(component_id: str, data: LinkTypeBase):
    current = repo.get_link_type(component_id)
    return repo.save_link_type(current["ontology_id"], data, component_id)


@app.delete("/api/link-types/{component_id}", status_code=204)
def delete_link_type(component_id: str):
    repo.delete_link_type(component_id)


@app.get("/api/ontologies/{ontology_id}/actions")
def list_actions(ontology_id: str):
    return repo.list_actions(ontology_id)


@app.post("/api/ontologies/{ontology_id}/actions", status_code=201)
def create_action(ontology_id: str, data: ActionBase):
    return repo.save_action(ontology_id, data)


@app.get("/api/actions/{component_id}")
def get_action(component_id: str):
    return repo.get_action(component_id)


@app.put("/api/actions/{component_id}")
def update_action(component_id: str, data: ActionBase):
    current = repo.get_action(component_id)
    return repo.save_action(current["ontology_id"], data, component_id)


@app.delete("/api/actions/{component_id}", status_code=204)
def delete_action(component_id: str):
    repo.delete_action(component_id)


@app.get("/api/ontologies/{ontology_id}/interfaces")
def list_interfaces(ontology_id: str):
    return repo.list_interfaces(ontology_id)


@app.post("/api/ontologies/{ontology_id}/interfaces", status_code=201)
def create_interface(ontology_id: str, data: InterfaceBase):
    return repo.save_interface(ontology_id,data)


@app.put("/api/interfaces/{component_id}")
def update_interface(component_id: str, data: InterfaceBase):
    current=repo.get_interface(component_id)
    return repo.save_interface(current["ontology_id"],data,component_id)


@app.delete("/api/interfaces/{component_id}", status_code=204)
def delete_interface(component_id: str):
    repo.delete_interface(component_id)


@app.get("/api/ontologies/{ontology_id}/business-rules")
def list_business_rules(ontology_id: str):
    return repo.list_business_rules(ontology_id)


@app.post("/api/ontologies/{ontology_id}/business-rules", status_code=201)
def create_business_rule(ontology_id: str, data: BusinessRuleBase):
    return repo.save_business_rule(ontology_id, data)


@app.put("/api/business-rules/{component_id}")
def update_business_rule(component_id: str, data: BusinessRuleBase):
    current=repo.get_business_rule(component_id)
    return repo.save_business_rule(current["ontology_id"],data,component_id)


@app.delete("/api/business-rules/{component_id}", status_code=204)
def delete_business_rule(component_id: str):
    repo.delete_business_rule(component_id)


@app.post("/api/business-rules/{component_id}/test")
def test_business_rule(component_id: str, data: RuleTestRequest):
    return repo.test_business_rule(component_id, data.sample_data)


@app.get("/api/ontologies/{ontology_id}/instances")
def list_object_instances(ontology_id: str, object_type_id: Optional[str] = None):
    return repo.list_object_instances(ontology_id, object_type_id)


@app.post("/api/ontologies/{ontology_id}/instances", status_code=201)
def create_object_instance(ontology_id: str, data: ObjectInstanceBase):
    return repo.save_object_instance(ontology_id, data)


@app.get("/api/instances/{component_id}")
def get_object_instance(component_id: str):
    return repo.get_object_instance(component_id)


@app.put("/api/instances/{component_id}")
def update_object_instance(component_id: str, data: ObjectInstanceBase):
    current=repo.get_object_instance(component_id)
    return repo.save_object_instance(current["ontology_id"],data,component_id)


@app.delete("/api/instances/{component_id}", status_code=204)
def delete_object_instance(component_id: str):
    repo.delete_object_instance(component_id)


@app.get("/api/ontologies/{ontology_id}/instance-links")
def list_link_instances(ontology_id: str):
    return repo.list_link_instances(ontology_id)


@app.post("/api/ontologies/{ontology_id}/instance-links", status_code=201)
def create_link_instance(ontology_id: str, data: LinkInstanceBase):
    return repo.save_link_instance(ontology_id,data)


@app.delete("/api/instance-links/{component_id}", status_code=204)
def delete_link_instance(component_id: str):
    repo.delete_link_instance(component_id)


@app.get("/api/ontologies/{ontology_id}/graph")
def get_graph(ontology_id: str):
    return repo.graph(ontology_id)


@app.post("/api/ontologies/{ontology_id}/validate")
def validate_ontology(ontology_id: str):
    return repo.validate_ontology(ontology_id)


@app.get("/api/ontologies/{ontology_id}/quality-runs")
def quality_runs(ontology_id: str, limit: int = Query(default=10, ge=1, le=100)):
    return governance_insights.list_quality(ontology_id, limit)


@app.get("/api/quality-dimensions")
def quality_dimensions():
    """质检可选维度，供对话式质检页做范围引导。"""
    return [{"key": key, "label": label, "description": copy}
            for key, label, copy in governance_insights.QUALITY_DIMENSIONS]


@app.post("/api/ontologies/{ontology_id}/quality-runs")
def run_quality(ontology_id: str, data: Optional[QualityRunRequest] = None):
    return governance_insights.run_quality(ontology_id, data.scope if data else None)


@app.post("/api/ontologies/{ontology_id}/quality-runs/{run_id}/chat")
def quality_chat(ontology_id: str, run_id: str, data: QualityChatRequest):
    return governance_insights.quality_chat(ontology_id, run_id, data.message)


@app.post("/api/ontologies/{ontology_id}/compare-with")
def compare_with_ontology(ontology_id: str, data: OntologyCompareRequest):
    """跨本体对比：产品已去掉版本概念，改为拿两个本体直接比。"""
    return governance_insights.compare_ontologies(ontology_id, data.other_id)


@app.post("/api/ontologies/{ontology_id}/compare-with/chat")
def compare_with_ontology_chat(ontology_id: str, data: OntologyCompareChatRequest):
    return governance_insights.compare_ontologies_chat(ontology_id, data.other_id, data.message)


@app.post("/api/ontologies/{ontology_id}/version-compare")
def compare_versions(ontology_id: str, data: VersionCompareRequest):
    return governance_insights.compare_versions(ontology_id, data.left, data.right)


@app.post("/api/ontologies/{ontology_id}/version-compare/chat")
def compare_versions_chat(ontology_id: str, data: GovernanceChatRequest):
    return governance_insights.compare_chat(ontology_id, data.left, data.right, data.message)


@app.get("/api/ontologies/{ontology_id}/release-preview")
def release_preview(ontology_id: str):
    return repo.release_preview(ontology_id)


@app.post("/api/ontologies/{ontology_id}/review/submit")
def submit_review(ontology_id: str):
    return repo.submit_review(ontology_id)


@app.post("/api/ontologies/{ontology_id}/review/approve")
def approve_review(ontology_id: str):
    return repo.approve_review(ontology_id)


@app.post("/api/ontologies/{ontology_id}/derive")
def derive_working_state(ontology_id: str):
    return repo.derive_working_state(ontology_id)


@app.get("/api/ontologies/{ontology_id}/releases")
def release_history(ontology_id: str):
    return repo.release_history(ontology_id)


@app.get("/api/ontologies/{ontology_id}/releases/{release_id}/snapshot")
def release_snapshot(ontology_id: str, release_id: str):
    return governance_insights.release_snapshot(ontology_id, release_id)


@app.post("/api/ontologies/{ontology_id}/publish")
def publish_ontology(ontology_id: str, data: Optional[PublishRequest] = None):
    request = data or PublishRequest()
    return repo.publish(ontology_id, request.bump, request.change_reason, request.reviewer)


@app.get("/api/ontologies/{ontology_id}/changes")
def get_changes(ontology_id: str, limit: int = Query(default=80, ge=1, le=500), pending_only: bool = False):
    return repo.changes(ontology_id, limit, pending_only)


@app.get("/api/ontologies/{ontology_id}/model-changes")
def get_model_changes(ontology_id: str, page: int = Query(default=1, ge=1),
                      page_size: int = Query(default=20, ge=1, le=300),
                      pending: str = "all", resource_type: str = "", keyword: str = "",
                      include_system: bool = False, resource_id: str = "", operation: str = ""):
    return repo.model_changes_page(ontology_id, page, page_size, pending, resource_type,
                                   keyword, include_system, resource_id, operation)


@app.get("/api/ontologies/{ontology_id}/activity")
def get_activity(ontology_id: str, page: int = Query(default=1, ge=1),
                 page_size: int = Query(default=20, ge=1, le=300),
                 include_system: bool = False, keyword: str = ""):
    return repo.activity_page(ontology_id, page, page_size, include_system, keyword)


@app.get("/api/ontologies/{ontology_id}/export")
def export_ontology(ontology_id: str):
    return repo.export_ontology(ontology_id)


def _enterprise_kind(kind: str) -> str:
    if kind not in enterprise.RESOURCE_TABLES and kind != "versions":
        raise HTTPException(status_code=404, detail="企业本体资源类型不存在")
    return kind


@app.get("/api/ontologies/{ontology_id}/enterprise-summary")
def get_enterprise_summary(ontology_id: str):
    return enterprise.enterprise_summary(ontology_id)


@app.get("/api/ontologies/{ontology_id}/enterprise/{kind}")
def list_enterprise_resources(ontology_id: str, kind: str):
    return enterprise.list_resources(ontology_id, _enterprise_kind(kind))


@app.post("/api/ontologies/{ontology_id}/enterprise/{kind}", status_code=201)
def create_enterprise_resource(ontology_id: str, kind: str, data: EnterpriseResourceBase):
    normalized = _enterprise_kind(kind)
    if normalized == "versions":
        raise HTTPException(status_code=400, detail="版本记录由发布流程自动生成，不能手工新建")
    return enterprise.save_resource(ontology_id, normalized, data)


@app.put("/api/ontologies/{ontology_id}/enterprise/{kind}/{resource_id}")
def update_enterprise_resource(ontology_id: str, kind: str, resource_id: str, data: EnterpriseResourceBase):
    normalized = _enterprise_kind(kind)
    if normalized == "versions":
        raise HTTPException(status_code=400, detail="正式版本不可修改")
    return enterprise.save_resource(ontology_id, normalized, data, resource_id)


@app.delete("/api/enterprise/{kind}/{resource_id}", status_code=204)
def delete_enterprise_resource(kind: str, resource_id: str):
    normalized = _enterprise_kind(kind)
    if normalized == "versions":
        raise HTTPException(status_code=400, detail="正式版本不可删除")
    enterprise.delete_resource(normalized, resource_id)


class SchemaCaptureRequest(BaseModel):
    table_names: list[str] = Field(default_factory=list)


class SchemaImportRequest(BaseModel):
    schema_data: dict


class DdlImportRequest(BaseModel):
    ddl_text: str = Field(..., min_length=1)


@app.post("/api/ontologies/{ontology_id}/enterprise/data-sources/{resource_id}/test-connection")
def test_source_connection(ontology_id: str, resource_id: str):
    return source_connections.test_connection(ontology_id, resource_id)


@app.get("/api/ontologies/{ontology_id}/enterprise/data-sources/{resource_id}/tables")
def list_source_tables(ontology_id: str, resource_id: str):
    return source_connections.list_remote_tables(ontology_id, resource_id)


@app.post("/api/ontologies/{ontology_id}/enterprise/data-sources/{resource_id}/capture-schema")
def capture_source_schema(ontology_id: str, resource_id: str, data: SchemaCaptureRequest):
    return source_connections.discover_schema(ontology_id, resource_id, data.table_names)


@app.post("/api/ontologies/{ontology_id}/enterprise/data-sources/{resource_id}/import-schema")
def import_source_schema(ontology_id: str, resource_id: str, data: SchemaImportRequest):
    return source_connections.save_snapshot(ontology_id, resource_id, data.schema_data)


@app.post("/api/ontologies/{ontology_id}/enterprise/data-sources/{resource_id}/import-ddl")
def import_source_ddl(ontology_id: str, resource_id: str, data: DdlImportRequest):
    return source_connections.save_snapshot(ontology_id, resource_id, source_connections.parse_mysql_ddl(data.ddl_text))


@app.get("/api/ontologies/{ontology_id}/enterprise/data-sources/{resource_id}/schema")
def get_source_schema(ontology_id: str, resource_id: str):
    return source_connections.latest_snapshot(ontology_id, resource_id) or {"schema": {"tables": []}}


@app.post("/api/ontologies/{ontology_id}/enterprise/data-mappings/{resource_id}/validate")
def validate_mapping(ontology_id: str, resource_id: str):
    return enterprise.validate_data_mapping(ontology_id, resource_id)


@app.get("/api/ontologies/{ontology_id}/evidence")
def list_evidence(ontology_id: str):
    return enterprise.list_evidence(ontology_id)


@app.get("/api/ontologies/{ontology_id}/template-records")
def list_template_records(ontology_id: str, sheet_name: Optional[str] = None):
    """Inspect the exact rows imported from the bundled modeling workbook."""
    return enterprise.list_template_records(ontology_id, sheet_name)


@app.get("/api/ontology-build-sessions")
def list_ontology_build_sessions(ontology_id: Optional[str] = None):
    return enterprise.list_build_sessions(ontology_id)


@app.post("/api/ontology-build-sessions", status_code=201)
def create_ontology_build_session(data: BuildSessionCreate):
    return enterprise.create_build_session(data)


@app.get("/api/ontology-build-sessions/{session_id}")
def get_ontology_build_session(session_id: str):
    return enterprise.get_build_session(session_id)


@app.post("/api/ontology-build-sessions/{session_id}/validate")
def validate_ontology_build_session(session_id: str):
    return enterprise.validate_build_session(session_id)


@app.post("/api/ontology-build-sessions/{session_id}/transition")
def transition_ontology_build_session(session_id: str, data: BuildSessionTransition):
    return enterprise.transition_build_session(session_id, data)


@app.post("/api/ontologies/{ontology_id}/evidence", status_code=201)
def upload_evidence(ontology_id: str, data: EvidenceUpload):
    return enterprise.upload_evidence(ontology_id, data)


@app.delete("/api/evidence/{source_id}", status_code=204)
def delete_evidence(source_id: str):
    enterprise.delete_evidence(source_id)


@app.post("/api/ontologies/{ontology_id}/ai/analyze", status_code=201)
def analyze_evidence(ontology_id: str, data: AIAnalyzeRequest):
    return enterprise.analyze_evidence(ontology_id, data)


@app.get("/api/ontologies/{ontology_id}/build-runs")
def list_build_runs(ontology_id: str):
    return enterprise.list_build_runs(ontology_id)


@app.post("/api/ontologies/{ontology_id}/scenarios/{scenario_id}/run", status_code=201)
def run_scenario(ontology_id: str, scenario_id: str, data: Optional[MappingTestRequest] = None):
    return enterprise.run_scenario(ontology_id, scenario_id, data.sample_data if data else {})


@app.get("/api/ontologies/{ontology_id}/scenario-runs")
def list_scenario_runs(ontology_id: str, scenario_id: Optional[str] = None):
    return enterprise.list_scenario_runs(ontology_id, scenario_id)


@app.get("/api/ontologies/{ontology_id}/proposals")
def list_proposals(ontology_id: str):
    return enterprise.list_proposals(ontology_id)


@app.get("/api/proposals/{proposal_id}")
def get_proposal(proposal_id: str):
    return enterprise.get_proposal(proposal_id)


@app.put("/api/proposal-operations/{operation_id}/decision")
def decide_proposal_operation(operation_id: str, data: ProposalDecision):
    return enterprise.decide_operation(operation_id, data.decision, data.note, data.payload)


@app.post("/api/proposals/{proposal_id}/merge")
def merge_proposal(proposal_id: str):
    return enterprise.merge_proposal(proposal_id)


@app.post("/api/ontologies/{ontology_id}/agent/chat")
def ontology_agent_chat(ontology_id: str, data: AgentChatRequest):
    return enterprise.agent_chat(ontology_id, data)


FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.get("/")
def serve_index():
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        raise HTTPException(status_code=503, detail="前端尚未构建，请先执行 npm run build")
    return FileResponse(index)


@app.get("/{path:path}", include_in_schema=False)
def serve_spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(status_code=404, detail="接口不存在")
    candidate = (FRONTEND_DIST / path).resolve()
    try:
        candidate.relative_to(FRONTEND_DIST.resolve())
    except ValueError:
        candidate = FRONTEND_DIST / "__invalid_static_path__"
    if candidate.is_file():
        return FileResponse(candidate)
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        raise HTTPException(status_code=503, detail="前端尚未构建，请先执行 npm run build")
    return FileResponse(index)
