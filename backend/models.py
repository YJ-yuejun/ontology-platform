from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


PropertyType = Literal["string", "integer", "decimal", "boolean", "datetime", "enum"]
Cardinality = Literal["one_to_one", "one_to_many", "many_to_one", "many_to_many"]
ActionType = Literal["invoke", "create", "modify", "delete", "create_or_modify"]
RuleCategory = Literal["validation", "calculation", "consistency", "risk"]
RuleSeverity = Literal["blocking", "warning", "info"]
RuleImplementation = Literal["description", "expression", "function", "workflow", "model"]
ResourceStatus = Literal["promoted", "active", "experimental", "deprecated", "example"]
StandardResourceStatus = Literal["active", "experimental", "deprecated", "example"]
ObjectKind = Literal["business_object", "abstract_type"]


class PropertyDef(BaseModel):
    key: str = Field(..., min_length=1, pattern=r"^[A-Za-z][A-Za-z0-9_]*$")
    name: str = Field(..., min_length=1)
    type: PropertyType = "string"
    # 模板中的“属性类别/唯一”与平台内部的主键、资源状态是不同维度。
    property_category: Optional[str] = None
    is_unique: bool = False
    is_primary_key: bool = False
    is_required: bool = False
    is_searchable: bool = False
    default: Optional[Any] = None
    options: Optional[List[str]] = None
    description: Optional[str] = None
    status: StandardResourceStatus = "experimental"
    shared_property_id: Optional[str] = None
    source_field: Optional[str] = None
    external_id: Optional[str] = None
    business_definition: Optional[str] = None
    unit: Optional[str] = None
    source_system: Optional[str] = None
    update_frequency: Optional[str] = None
    transform_rule: Optional[str] = None
    quality_rule: Optional[str] = None
    design_status: str = "draft"
    # Action 参数的来源契约，不再把 source_field 当作参数来源。
    parameter_source: Optional[str] = None
    parameter_source_ref: Optional[str] = None
    is_sensitive: bool = False
    # Source workbook lineage. These fields keep an imported row traceable
    # without making the stable API key depend on a spreadsheet row number.
    template_id: Optional[str] = None
    template_sheet: Optional[str] = None
    template_row: Optional[int] = None


class OntologyBase(BaseModel):
    name: str = Field(..., min_length=1)
    namespace: str = Field(..., min_length=1, pattern=r"^[a-z][a-z0-9_.-]*$")
    description: Optional[str] = None


class ObjectTypeBase(BaseModel):
    name: str = Field(..., min_length=1, pattern=r"^[A-Z][A-Za-z0-9]*$")
    display_name: str = Field(..., min_length=1)
    plural_name: Optional[str] = None
    icon: str = "box"
    title_property: Optional[str] = None
    description: Optional[str] = None
    status: ResourceStatus = "experimental"
    properties: List[PropertyDef] = Field(default_factory=list)
    subject_domain_id: Optional[str] = None
    # Legacy package fields are accepted during migration, but the v1.9 product
    # model only creates business objects and binds separate Interface resources.
    group_ids: List[str] = Field(default_factory=list)
    object_kind: ObjectKind = "business_object"
    parent_type_id: Optional[str] = None
    interface_ids: List[str] = Field(default_factory=list)
    backing_source: Optional[str] = None
    external_id: Optional[str] = None
    category: Optional[str] = None
    domain: Optional[str] = None
    lifecycle: Optional[str] = None
    state_property: Optional[str] = None
    owner: Optional[str] = None
    source_system: Optional[str] = None
    is_core: bool = False
    is_event: bool = False
    requires_action: bool = False
    design_status: str = "draft"


class LinkTypeBase(BaseModel):
    name: str = Field(..., min_length=1, pattern=r"^[a-z][a-z0-9_]*$")
    display_name: str = Field(..., min_length=1)
    source_object_type_id: str
    target_object_type_id: str
    cardinality: Cardinality = "many_to_many"
    description: Optional[str] = None
    status: StandardResourceStatus = "experimental"
    properties: List[PropertyDef] = Field(default_factory=list)
    external_id: Optional[str] = None
    reverse_display_name: Optional[str] = None
    reverse_name: Optional[str] = None
    source_system: Optional[str] = None
    source_key: Optional[str] = None
    target_key: Optional[str] = None
    is_core: bool = False
    bidirectional_display: bool = True
    design_status: str = "draft"


class ActionBase(BaseModel):
    name: str = Field(..., min_length=1, pattern=r"^[a-z][a-z0-9_]*$")
    display_name: str = Field(..., min_length=1)
    target_object_type_id: str
    action_type: ActionType = "invoke"
    description: Optional[str] = None
    status: StandardResourceStatus = "experimental"
    parameters: List[PropertyDef] = Field(default_factory=list)
    preconditions: List[Dict[str, Any]] = Field(default_factory=list)
    precondition_mode: Literal["all", "any"] = "all"
    external_id: Optional[str] = None
    action_category: Optional[str] = None
    execution_logic: Optional[str] = None
    object_effect: Optional[str] = None
    result_schema: Dict[str, Any] = Field(default_factory=dict)
    side_effects: List[str] = Field(default_factory=list)
    approval_required: bool = False
    owner: Optional[str] = None
    design_status: str = "draft"
    # 模板原文与内部结构化执行契约并存；页面按 09_行动 的字段呈现。
    target_role: Optional[str] = None
    input_parameters_text: Optional[str] = None
    precondition_text: Optional[str] = None
    result_text: Optional[str] = None
    side_effects_text: Optional[str] = None


class ImportRequest(BaseModel):
    payload: Dict[str, Any]


class SharedPropertyBase(BaseModel):
    name: str = Field(..., min_length=1, pattern=r"^[a-z][a-z0-9_]*$")
    display_name: str = Field(..., min_length=1)
    type: PropertyType = "string"
    description: Optional[str] = None
    status: StandardResourceStatus = "experimental"
    options: Optional[List[str]] = None


class InterfaceBase(BaseModel):
    name: str = Field(..., min_length=1, pattern=r"^[A-Z][A-Za-z0-9]*$")
    display_name: str = Field(..., min_length=1)
    description: Optional[str] = None
    status: StandardResourceStatus = "experimental"
    properties: List[PropertyDef] = Field(default_factory=list)


class ObjectTypeGroupBase(BaseModel):
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    color: str = Field(default="#4d73a8", pattern=r"^#[0-9A-Fa-f]{6}$")
    subject_domain_id: Optional[str] = None


class BusinessDomainBase(BaseModel):
    code: str = Field(..., min_length=1, pattern=r"^[A-Za-z][A-Za-z0-9_.-]*$")
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    owner: Optional[str] = None
    status: StandardResourceStatus = "experimental"


class SubjectDomainBase(BaseModel):
    business_domain_id: str
    code: str = Field(..., min_length=1, pattern=r"^[A-Za-z][A-Za-z0-9_.-]*$")
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    owner: Optional[str] = None
    status: StandardResourceStatus = "experimental"


class BusinessRuleBase(BaseModel):
    name: str = Field(..., min_length=1, pattern=r"^[a-z][a-z0-9_]*$")
    display_name: str = Field(..., min_length=1)
    target_object_type_id: str
    category: RuleCategory = "validation"
    severity: RuleSeverity = "warning"
    expression: str = Field(..., min_length=1)
    implementation_type: RuleImplementation = "expression"
    input_fields: List[str] = Field(default_factory=list)
    output_description: str = "boolean"
    trigger_mode: Literal["event", "scheduled", "manual", "api"] = "api"
    realtime_requirement: str = "按需"
    reusable: bool = True
    owner: Optional[str] = None
    test_case: Dict[str, Any] = Field(default_factory=dict)
    description: Optional[str] = None
    remediation: Optional[str] = None
    status: StandardResourceStatus = "experimental"


class ObjectInstanceBase(BaseModel):
    object_type_id: str
    business_key: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    properties: Dict[str, Any] = Field(default_factory=dict)
    record_status: str = "有效"
    sync_status: Literal["pending", "syncing", "synced", "failed", "stale", "disabled"] = "synced"
    source_system: Optional[str] = None
    source_pk: Optional[str] = None
    last_synced_at: Optional[str] = None
    sync_error: Optional[str] = None
    quality_status: Literal["passed", "warning", "failed", "unknown"] = "passed"
    external_id: Optional[str] = None
    source_summary: Optional[str] = None
    template_sheet: Optional[str] = None
    template_row: Optional[int] = None


class LinkInstanceBase(BaseModel):
    link_type_id: str
    source_instance_id: str
    target_instance_id: str
    properties: Dict[str, Any] = Field(default_factory=dict)


class EnterpriseResourceBase(BaseModel):
    """Workbook-aligned resource while keeping the API extensible for enterprise fields."""

    code: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    category: str = ""
    status: str = "draft"
    description: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class EvidenceUpload(BaseModel):
    filename: str = Field(..., min_length=1)
    mime_type: str = "application/octet-stream"
    text_content: Optional[str] = None
    content_base64: Optional[str] = None
    source_kind: str = "file"


class AIAnalyzeRequest(BaseModel):
    evidence_ids: List[str] = Field(default_factory=list)
    instruction: str = "识别业务对象、属性、关系、规则、函数和动作，并形成可审核的本体 Proposal。"
    strategy: Literal["conservative", "balanced", "exploratory"] = "balanced"
    include_existing_schema: bool = True
    scenario_id: Optional[str] = None
    max_rounds: int = Field(default=2, ge=1, le=3)
    session_id: Optional[str] = None
    build_mode: Literal["create", "update"] = "update"
    change_scope: str = "增量完善"
    business_context: str = ""
    base_version: Optional[str] = None


class BuildSessionCreate(BaseModel):
    mode: Literal["create", "update"]
    target_ontology_id: Optional[str] = None
    ontology_name: Optional[str] = None
    namespace: Optional[str] = None
    description: Optional[str] = None
    title: str = Field(..., min_length=1)
    domain: str = Field(..., min_length=1)
    business_goal: str = Field(..., min_length=1)
    change_scope: str = "增量完善"
    business_context: str = ""
    entry_object: str = ""
    expected_output: str = ""
    scenario_id: Optional[str] = None


class BuildSessionTransition(BaseModel):
    action: Literal["submit_review", "approve", "publish"]
    bump: Literal["major", "minor", "patch"] = "minor"
    change_reason: str = "智能构建变更发布"
    reviewer: str = "admin"


class ProposalDecision(BaseModel):
    decision: Literal["accepted", "rejected", "pending", "deferred", "conflict"]
    note: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None


class RuleTestRequest(BaseModel):
    sample_data: Dict[str, Any] = Field(default_factory=dict)


class MappingTestRequest(BaseModel):
    sample_data: Dict[str, Any] = Field(default_factory=dict)


class PublishRequest(BaseModel):
    bump: Literal["major", "minor", "patch"] = "minor"
    change_reason: str = "工作状态变更发布"
    reviewer: str = ""


class AgentChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    confirm_action: bool = False
    context: Dict[str, Any] = Field(default_factory=dict)
