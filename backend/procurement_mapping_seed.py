"""Built-in procurement & finance mapping demonstration.

The prototype intentionally skips the data-governance middle layer on the
``/ontology/data/connections`` page: a physical table column maps directly to an
object property.  This module installs the deterministic demo model used by
that page:

* six additional business domains and their subject domains;
* nine additional physical systems (twenty in total, including the existing
  procurement sources);
* thirty additional object types (more than forty in the ontology);
* direct physical-column → object-property mappings and a set of relation
  mappings;
* mock physical schemas so the source browser and the mapping graph can show
  real table/column names.

Everything is additive and idempotent.  Re-running the seed never overwrites a
user edit and never duplicates a row.
"""

from __future__ import annotations

import json
from typing import Any

import repository as repo
import source_connections
from enterprise import list_resources, save_resource
from models import EnterpriseResourceBase, LinkInstanceBase, ObjectInstanceBase, ObjectTypeBase, PropertyDef, SubjectDomainBase, BusinessDomainBase, LinkTypeBase


NAMESPACE = "enterprise.supplychain.manual"
SOURCE_MARKER = "procurement-direct-mapping-demo-v1"
MAPPING_OWNER = "采购财务演示数据"


# ---------------------------------------------------------------------------
# Business / subject domains
# ---------------------------------------------------------------------------

DOMAINS = [
    ("procurement", "采购管理域", "负责采购计划、寻源、申请、订单、收货、合同履约与采购主数据。", "采购中心"),
    ("finance", "财务管理域", "负责预算、应付结算、付款、资金、税务和财务风控。", "财务共享中心"),
]

SUBJECTS = [
    ("procurement", "procurement.master", "采购主数据主题", "供应商、品目、品类、组织与采购基础主数据。"),
    ("procurement", "procurement.sourcing", "采购执行主题", "采购计划、寻源、申请、订单、交付与收货执行。"),
    ("procurement", "procurement.contract", "合同履约主题", "项目、合同、变更、里程碑与履约验收。"),
    ("finance", "finance.settlement", "应付结算主题", "发票、付款申请、付款计划与付款核销。"),
    ("finance", "finance.budget", "预算与成本主题", "预算、预算调整、成本中心、费用报销与资产折旧。"),
    ("finance", "finance.risk", "财务运营与风控主题", "会计凭证、资金账户、汇率税务、审计与风险预警。"),
]

OBJECT_SUBJECTS = {
    # 既有对象
    "Supplier": "procurement.master", "Product": "procurement.master",
    "ProductCopy": "procurement.master", "OrganizationUnit": "procurement.master",
    "Project": "procurement.contract", "Budget": "finance.budget",
    "PurchaseRequest": "procurement.sourcing", "PurchaseOrder": "procurement.sourcing",
    "PurchaseOrderCopy": "procurement.sourcing", "Contract": "procurement.contract",
    "AcceptanceRecord": "procurement.contract", "Invoice": "finance.settlement",
    "PaymentRequest": "finance.settlement", "AccountingVoucher": "finance.risk",
    "RiskReviewTask": "finance.risk",
    # 扩展对象
    "PurchasePlan": "procurement.sourcing", "SourcingEvent": "procurement.sourcing",
    "SupplierQuotation": "procurement.sourcing", "PurchaseCategory": "procurement.master",
    "PriceAgreement": "procurement.sourcing", "GoodsReceipt": "procurement.sourcing",
    "ReturnOrder": "procurement.sourcing", "DeliverySchedule": "procurement.sourcing",
    "SupplierQualification": "procurement.master", "SupplierPerformance": "procurement.master",
    "ContractAmendment": "procurement.contract", "ContractMilestone": "procurement.contract",
    "PaymentPlan": "finance.settlement", "PaymentAllocation": "finance.settlement",
    "BudgetLine": "finance.budget", "BudgetAdjustment": "finance.budget",
    "CostCenter": "finance.budget", "ExpenseClaim": "finance.budget",
    "ExpenseItem": "finance.budget", "AssetCard": "finance.budget",
    "DepreciationPlan": "finance.budget", "BankAccount": "finance.risk",
    "FundPlan": "finance.risk", "ExchangeRate": "finance.risk",
    "TaxRate": "finance.risk", "InvoiceLine": "finance.settlement",
    "ComplianceCheck": "finance.risk", "AuditFinding": "finance.risk",
    "RiskAlert": "finance.risk", "Employee": "procurement.master",
}



OBJECT_CATEGORIES = {
    "Supplier": "主数据", "Product": "主数据", "ProductCopy": "主数据",
    "OrganizationUnit": "主数据", "Employee": "主数据", "PurchaseCategory": "主数据",
    "SupplierQualification": "主数据", "BankAccount": "主数据", "ExchangeRate": "主数据",
    "TaxRate": "主数据", "CostCenter": "主数据",
    "Project": "业务实体", "Budget": "业务实体", "PriceAgreement": "业务实体",
    "PurchaseRequest": "业务单据", "PurchaseOrder": "业务单据", "PurchaseOrderCopy": "业务单据",
    "Contract": "业务单据", "AcceptanceRecord": "业务单据", "Invoice": "业务单据",
    "PaymentRequest": "业务单据", "AccountingVoucher": "业务单据", "PurchasePlan": "业务单据",
    "SupplierQuotation": "业务单据", "GoodsReceipt": "业务单据", "ReturnOrder": "业务单据",
    "DeliverySchedule": "业务单据", "ContractAmendment": "业务单据", "PaymentPlan": "业务单据",
    "PaymentAllocation": "业务单据", "BudgetAdjustment": "业务单据", "ExpenseClaim": "业务单据",
    "FundPlan": "业务单据",
    "SourcingEvent": "业务事件", "ContractMilestone": "业务事件", "AuditFinding": "业务事件",
    "RiskAlert": "业务事件",
    "RiskReviewTask": "业务任务", "ComplianceCheck": "业务任务",
    "AssetCard": "资产物料",
    "SupplierPerformance": "业务数据", "BudgetLine": "业务数据", "ExpenseItem": "业务数据",
    "DepreciationPlan": "业务数据", "InvoiceLine": "业务数据",
}


# ---------------------------------------------------------------------------
# Physical sources and mock schemas
# ---------------------------------------------------------------------------

def T(name: str, comment: str, columns: list[tuple[str, str, str, str]]) -> dict[str, Any]:
    """Build one mock table. columns: (name, data_type, key, comment)."""
    return {
        "name": name,
        "comment": comment,
        "type": "BASE TABLE",
        "columns": [
            {"name": column, "data_type": data_type, "key": key, "comment": comment_text,
             "nullable": key not in {"PRI", "UNI"}}
            for column, data_type, key, comment_text in columns
        ],
    }


SOURCES: list[dict[str, Any]] = [
    {
        "code": "SRC-MASTER", "name": "采购主数据服务", "system_type": "主数据系统",
        "physical_object": "masterdata.procurement", "data_category": "主数据",
        "description": "采购组织、供应商、品目、品类和供应商绩效主数据。",
        "tables": [
            T("org_unit", "组织单位主数据", [
                ("ORG_ID", "VARCHAR(64)", "PRI", "组织主键"), ("ORG_CODE", "VARCHAR(32)", "UNI", "组织编码"),
                ("ORG_NAME", "VARCHAR(128)", "", "组织名称"), ("ORG_LEVEL", "VARCHAR(32)", "", "组织层级"),
                ("MANAGER_NAME", "VARCHAR(64)", "", "负责人"), ("UPDATED_AT", "DATETIME", "", "更新时间"),
            ]),
            T("supplier", "供应商主数据", [
                ("SUPPLIER_ID", "VARCHAR(64)", "PRI", "供应商编号"), ("SUPPLIER_NAME", "VARCHAR(160)", "", "供应商名称"),
                ("RATING", "VARCHAR(16)", "", "供应商等级"), ("TAX_NO", "VARCHAR(64)", "", "纳税人识别号"),
                ("CONTACT_NAME", "VARCHAR(64)", "", "联系人"), ("STATUS", "VARCHAR(32)", "", "供应商状态"),
            ]),
            T("product", "采购品目主数据", [
                ("PRODUCT_ID", "VARCHAR(64)", "PRI", "产品编号"), ("PRODUCT_NAME", "VARCHAR(160)", "", "产品名称"),
                ("CATEGORY_CODE", "VARCHAR(32)", "", "品类编码"), ("CATEGORY_NAME", "VARCHAR(128)", "", "品类名称"),
                ("UNIT", "VARCHAR(16)", "", "计量单位"), ("STATUS", "VARCHAR(32)", "", "品目状态"),
            ]),
            T("product_category", "采购品类树", [
                ("CATEGORY_CODE", "VARCHAR(32)", "PRI", "品类编码"), ("CATEGORY_NAME", "VARCHAR(128)", "", "品类名称"),
                ("PARENT_CODE", "VARCHAR(32)", "", "父品类编码"), ("LEVEL_NO", "INT", "", "层级"),
                ("STATUS", "VARCHAR(32)", "", "状态"), ("OWNER", "VARCHAR(64)", "", "负责人"),
            ]),
            T("supplier_qualification", "供应商资质", [
                ("QUALIFICATION_ID", "VARCHAR(64)", "PRI", "资质主键"), ("SUPPLIER_ID", "VARCHAR(64)", "", "供应商编号"),
                ("QUALIFICATION_TYPE", "VARCHAR(64)", "", "资质类型"), ("CERT_NO", "VARCHAR(64)", "UNI", "证书编号"),
                ("VALID_FROM", "DATE", "", "生效日期"), ("VALID_TO", "DATE", "", "失效日期"), ("STATUS", "VARCHAR(32)", "", "资质状态"),
            ]),
            T("supplier_performance", "供应商绩效", [
                ("PERFORMANCE_ID", "VARCHAR(64)", "PRI", "绩效主键"), ("SUPPLIER_ID", "VARCHAR(64)", "", "供应商编号"),
                ("PERIOD", "VARCHAR(16)", "", "评价期间"), ("DELIVERY_SCORE", "DECIMAL(5,2)", "", "交付得分"),
                ("QUALITY_SCORE", "DECIMAL(5,2)", "", "质量得分"), ("TOTAL_SCORE", "DECIMAL(5,2)", "", "综合得分"),
                ("LEVEL", "VARCHAR(16)", "", "绩效等级"),
            ]),
        ],
    },
    {
        "code": "SRC-REQUEST", "name": "采购申请系统", "system_type": "业务系统",
        "physical_object": "procurement.purchase_request", "data_category": "交易数据",
        "description": "采购计划、采购申请及审批过程数据。",
        "tables": [
            T("purchase_plan", "采购计划", [
                ("PLAN_ID", "VARCHAR(64)", "PRI", "计划主键"), ("PLAN_NO", "VARCHAR(32)", "UNI", "计划单号"),
                ("PLAN_NAME", "VARCHAR(160)", "", "计划名称"), ("FISCAL_YEAR", "INT", "", "计划年度"),
                ("AMOUNT", "DECIMAL(18,2)", "", "计划金额"), ("STATUS", "VARCHAR(32)", "", "计划状态"),
                ("ORG_ID", "VARCHAR(64)", "", "组织主键"), ("OWNER", "VARCHAR(64)", "", "计划负责人"),
            ]),
            T("purchase_request", "采购申请", [
                ("REQUEST_ID", "VARCHAR(64)", "PRI", "申请主键"), ("REQUEST_NO", "VARCHAR(32)", "UNI", "申请单号"),
                ("REQUEST_NAME", "VARCHAR(160)", "", "采购事项"), ("AMOUNT", "DECIMAL(18,2)", "", "申请金额"),
                ("STATUS", "VARCHAR(32)", "", "申请状态"), ("REQUESTER", "VARCHAR(64)", "", "经办人"),
                ("REQUEST_DATE", "DATETIME", "", "申请日期"), ("PURCHASE_METHOD", "VARCHAR(32)", "", "采购方式"),
                ("PROJECT_CODE", "VARCHAR(32)", "", "项目编码"), ("PLAN_ID", "VARCHAR(64)", "", "采购计划主键"),
            ]),
        ],
    },
    {
        "code": "SRC-ORDER", "name": "采购订单系统", "system_type": "业务系统",
        "physical_object": "procurement.purchase_order", "data_category": "交易数据",
        "description": "采购订单、订单行和履约状态。",
        "tables": [
            T("purchase_order", "采购订单", [
                ("ORDER_ID", "VARCHAR(64)", "PRI", "订单主键"), ("ORDER_NO", "VARCHAR(32)", "UNI", "采购单号"),
                ("STATUS", "VARCHAR(32)", "", "履约状态"), ("AMOUNT", "DECIMAL(18,2)", "", "订单金额"),
                ("SUPPLIER_ID", "VARCHAR(64)", "", "供应商编号"), ("REQUEST_ID", "VARCHAR(64)", "", "申请主键"),
                ("ORDER_DATE", "DATETIME", "", "下单日期"),
            ]),
            T("purchase_order_line", "采购订单行", [
                ("LINE_ID", "VARCHAR(64)", "PRI", "行主键"), ("ORDER_ID", "VARCHAR(64)", "", "订单主键"),
                ("LINE_NO", "INT", "", "行号"), ("PRODUCT_ID", "VARCHAR(64)", "", "品目编号"),
                ("QUANTITY", "DECIMAL(18,3)", "", "数量"), ("UNIT_PRICE", "DECIMAL(18,4)", "", "单价"),
                ("AMOUNT", "DECIMAL(18,2)", "", "行金额"),
            ]),
        ],
    },
    {
        "code": "SRC-CONTRACT", "name": "采购合同系统", "system_type": "业务系统",
        "physical_object": "contract.contract_main", "data_category": "主数据",
        "description": "采购合同、合同变更与合同里程碑。",
        "tables": [
            T("contract_main", "采购合同主表", [
                ("CONTRACT_ID", "VARCHAR(64)", "PRI", "合同主键"), ("CONTRACT_NO", "VARCHAR(32)", "UNI", "合同编号"),
                ("CONTRACT_NAME", "VARCHAR(160)", "", "合同名称"), ("AMOUNT", "DECIMAL(18,2)", "", "合同金额"),
                ("PAID_AMOUNT", "DECIMAL(18,2)", "", "累计已付"), ("STATUS", "VARCHAR(32)", "", "合同状态"),
                ("SIGN_DATE", "DATETIME", "", "签署日期"), ("SUPPLIER_ID", "VARCHAR(64)", "", "供应商编号"),
                ("PROJECT_CODE", "VARCHAR(32)", "", "项目编码"),
            ]),
            T("contract_amendment", "合同变更", [
                ("AMENDMENT_ID", "VARCHAR(64)", "PRI", "变更主键"), ("CONTRACT_ID", "VARCHAR(64)", "", "合同主键"),
                ("AMENDMENT_NO", "VARCHAR(32)", "UNI", "变更编号"), ("CHANGE_AMOUNT", "DECIMAL(18,2)", "", "变更金额"),
                ("REASON", "VARCHAR(512)", "", "变更原因"), ("STATUS", "VARCHAR(32)", "", "变更状态"),
                ("EFFECTIVE_DATE", "DATE", "", "生效日期"),
            ]),
            T("contract_milestone", "合同里程碑", [
                ("MILESTONE_ID", "VARCHAR(64)", "PRI", "里程碑主键"), ("CONTRACT_ID", "VARCHAR(64)", "", "合同主键"),
                ("MILESTONE_NAME", "VARCHAR(128)", "", "里程碑名称"), ("PLAN_DATE", "DATE", "", "计划日期"),
                ("ACTUAL_DATE", "DATE", "", "实际日期"), ("AMOUNT", "DECIMAL(18,2)", "", "里程碑金额"),
                ("STATUS", "VARCHAR(32)", "", "里程碑状态"),
            ]),
        ],
    },
    {
        "code": "SRC-ACCEPTANCE", "name": "验收管理系统", "system_type": "业务系统",
        "physical_object": "procurement.acceptance_record", "data_category": "交易数据",
        "description": "到货、服务与工程验收记录。",
        "tables": [
            T("acceptance_record", "履约验收单", [
                ("ACCEPTANCE_ID", "VARCHAR(64)", "PRI", "验收主键"), ("ACCEPTANCE_NO", "VARCHAR(32)", "UNI", "验收单号"),
                ("CONTRACT_ID", "VARCHAR(64)", "", "合同主键"), ("AMOUNT", "DECIMAL(18,2)", "", "本次验收金额"),
                ("STATUS", "VARCHAR(32)", "", "验收状态"), ("ACCEPTANCE_DATE", "DATETIME", "", "验收日期"),
                ("ACCEPTOR", "VARCHAR(64)", "", "验收人"), ("SUMMARY", "VARCHAR(512)", "", "验收说明"),
            ]),
        ],
    },
    {
        "code": "SRC-INVOICE", "name": "发票管理系统", "system_type": "财务系统",
        "physical_object": "finance.invoice_pool", "data_category": "交易数据",
        "description": "发票、发票明细、验真与作废状态。",
        "tables": [
            T("invoice_pool", "发票池", [
                ("INVOICE_ID", "VARCHAR(64)", "PRI", "发票主键"), ("INVOICE_NO", "VARCHAR(32)", "UNI", "发票号码"),
                ("AMOUNT", "DECIMAL(18,2)", "", "价税合计"), ("TAX_AMOUNT", "DECIMAL(18,2)", "", "税额"),
                ("STATUS", "VARCHAR(32)", "", "发票状态"), ("ISSUER", "VARCHAR(160)", "", "开票方"),
                ("BUYER", "VARCHAR(160)", "", "购方主体"), ("ISSUE_DATE", "DATETIME", "", "开票日期"),
                ("CONTRACT_ID", "VARCHAR(64)", "", "合同主键"),
            ]),
            T("invoice_line", "发票明细", [
                ("LINE_ID", "VARCHAR(64)", "PRI", "明细主键"), ("INVOICE_ID", "VARCHAR(64)", "", "发票主键"),
                ("ITEM_NAME", "VARCHAR(160)", "", "货物或服务名称"), ("QUANTITY", "DECIMAL(18,3)", "", "数量"),
                ("UNIT_PRICE", "DECIMAL(18,4)", "", "单价"), ("AMOUNT", "DECIMAL(18,2)", "", "金额"),
                ("TAX_RATE", "DECIMAL(6,4)", "", "税率"),
            ]),
        ],
    },
    {
        "code": "SRC-PAY", "name": "财务共享平台", "system_type": "财务系统",
        "physical_object": "finance.payment_request", "data_category": "交易数据",
        "description": "付款申请、付款状态和付款核销数据。",
        "tables": [
            T("payment_request", "付款申请", [
                ("PAYMENT_ID", "VARCHAR(64)", "PRI", "付款主键"), ("PAYMENT_NO", "VARCHAR(32)", "UNI", "付款单号"),
                ("PAYMENT_TITLE", "VARCHAR(160)", "", "付款事项"), ("AMOUNT", "DECIMAL(18,2)", "", "申请金额"),
                ("STATUS", "VARCHAR(32)", "", "付款状态"), ("PAYEE_NAME", "VARCHAR(160)", "", "收款方"),
                ("APPLY_DATE", "DATETIME", "", "申请日期"), ("RISK_LEVEL", "VARCHAR(16)", "", "风险等级"),
                ("REVIEW_RESULT", "VARCHAR(256)", "", "审查结论"), ("CONTRACT_ID", "VARCHAR(64)", "", "合同主键"),
                ("BUDGET_ID", "VARCHAR(64)", "", "预算主键"),
            ]),
        ],
    },
    {
        "code": "SRC-BUDGET", "name": "项目预算系统", "system_type": "财务系统",
        "physical_object": "finance.budget_execution", "data_category": "分析数据",
        "description": "预算额度、预算明细、执行余额与预算调整。",
        "tables": [
            T("budget_execution", "预算执行", [
                ("BUDGET_ID", "VARCHAR(64)", "PRI", "预算主键"), ("BUDGET_NAME", "VARCHAR(160)", "", "预算名称"),
                ("FISCAL_YEAR", "INT", "", "预算年度"), ("TOTAL_AMOUNT", "DECIMAL(18,2)", "", "预算金额"),
                ("EXECUTED_AMOUNT", "DECIMAL(18,2)", "", "已执行金额"), ("AVAILABLE_AMOUNT", "DECIMAL(18,2)", "", "可用预算"),
                ("STATUS", "VARCHAR(32)", "", "预算状态"), ("PROJECT_CODE", "VARCHAR(32)", "", "项目编码"),
                ("COST_CENTER_ID", "VARCHAR(64)", "", "成本中心主键"),
            ]),
            T("budget_line", "预算明细", [
                ("LINE_ID", "VARCHAR(64)", "PRI", "明细主键"), ("BUDGET_ID", "VARCHAR(64)", "", "预算主键"),
                ("SUBJECT_CODE", "VARCHAR(32)", "", "预算科目编码"), ("SUBJECT_NAME", "VARCHAR(128)", "", "预算科目名称"),
                ("LINE_AMOUNT", "DECIMAL(18,2)", "", "预算行金额"), ("USED_AMOUNT", "DECIMAL(18,2)", "", "已使用金额"),
            ]),
            T("budget_adjustment", "预算调整", [
                ("ADJUSTMENT_ID", "VARCHAR(64)", "PRI", "调整主键"), ("BUDGET_ID", "VARCHAR(64)", "", "预算主键"),
                ("ADJUST_NO", "VARCHAR(32)", "UNI", "调整单号"), ("ADJUST_AMOUNT", "DECIMAL(18,2)", "", "调整金额"),
                ("REASON", "VARCHAR(512)", "", "调整原因"), ("STATUS", "VARCHAR(32)", "", "调整状态"),
                ("APPROVED_DATE", "DATE", "", "批准日期"),
            ]),
        ],
    },
    {
        "code": "SRC-VOUCHER", "name": "总账凭证系统", "system_type": "财务系统",
        "physical_object": "finance.accounting_voucher", "data_category": "交易数据",
        "description": "会计凭证、凭证分录与过账状态。",
        "tables": [
            T("accounting_voucher", "会计凭证", [
                ("VOUCHER_ID", "VARCHAR(64)", "PRI", "凭证主键"), ("VOUCHER_NO", "VARCHAR(32)", "UNI", "凭证编号"),
                ("AMOUNT", "DECIMAL(18,2)", "", "凭证金额"), ("STATUS", "VARCHAR(32)", "", "过账状态"),
                ("POSTING_DATE", "DATETIME", "", "过账日期"), ("SUMMARY", "VARCHAR(512)", "", "凭证摘要"),
                ("PAYMENT_ID", "VARCHAR(64)", "", "付款主键"),
            ]),
            T("voucher_entry", "凭证分录", [
                ("ENTRY_ID", "VARCHAR(64)", "PRI", "分录主键"), ("VOUCHER_ID", "VARCHAR(64)", "", "凭证主键"),
                ("ACCOUNT_CODE", "VARCHAR(32)", "", "会计科目编码"), ("ACCOUNT_NAME", "VARCHAR(128)", "", "会计科目名称"),
                ("DEBIT_AMOUNT", "DECIMAL(18,2)", "", "借方金额"), ("CREDIT_AMOUNT", "DECIMAL(18,2)", "", "贷方金额"),
            ]),
            T("gl_account", "会计科目", [
                ("ACCOUNT_CODE", "VARCHAR(32)", "PRI", "科目编码"), ("ACCOUNT_NAME", "VARCHAR(128)", "", "科目名称"),
                ("ACCOUNT_TYPE", "VARCHAR(32)", "", "科目类型"), ("PARENT_CODE", "VARCHAR(32)", "", "父级科目"),
                ("STATUS", "VARCHAR(32)", "", "科目状态"),
            ]),
        ],
    },
    {
        "code": "SRC-RISK", "name": "财务审查任务服务", "system_type": "业务系统",
        "physical_object": "risk.payment_review_task", "data_category": "任务数据",
        "description": "风险审查任务、处理意见和复核结果。",
        "tables": [
            T("payment_review_task", "付款审查任务", [
                ("TASK_ID", "VARCHAR(64)", "PRI", "任务主键"), ("TASK_TITLE", "VARCHAR(160)", "", "任务标题"),
                ("STATUS", "VARCHAR(32)", "", "任务状态"), ("RISK_LEVEL", "VARCHAR(16)", "", "风险等级"),
                ("ASSIGNEE", "VARCHAR(64)", "", "处理人"), ("REASON", "VARCHAR(512)", "", "风险依据"),
                ("OPINION", "VARCHAR(512)", "", "审查意见"), ("DECISION", "VARCHAR(32)", "", "复核决定"),
                ("PAYMENT_ID", "VARCHAR(64)", "", "付款主键"),
            ]),
        ],
    },
    {
        "code": "SRC-PROJECT", "name": "项目管理系统", "system_type": "业务系统",
        "physical_object": "project.project_master", "data_category": "主数据",
        "description": "项目立项、预算责任主体和项目状态。",
        "tables": [
            T("project_master", "项目主数据", [
                ("PROJECT_ID", "VARCHAR(64)", "PRI", "项目主键"), ("PROJECT_CODE", "VARCHAR(32)", "UNI", "项目编码"),
                ("PROJECT_NAME", "VARCHAR(160)", "", "项目名称"), ("STATUS", "VARCHAR(32)", "", "项目状态"),
                ("TOTAL_BUDGET", "DECIMAL(18,2)", "", "项目总预算"), ("MANAGER", "VARCHAR(64)", "", "项目经理"),
                ("START_DATE", "DATETIME", "", "开始日期"), ("ORG_ID", "VARCHAR(64)", "", "组织主键"),
            ]),
        ],
    },
    {
        "code": "SRC-SOURCING", "name": "寻源与报价平台", "system_type": "业务系统",
        "physical_object": "sourcing.sourcing_event", "data_category": "交易数据",
        "description": "寻源事件、供应商报价与价格协议。",
        "tables": [
            T("sourcing_event", "寻源事件", [
                ("EVENT_ID", "VARCHAR(64)", "PRI", "事件主键"), ("EVENT_NO", "VARCHAR(32)", "UNI", "事件编号"),
                ("EVENT_NAME", "VARCHAR(160)", "", "事件名称"), ("SOURCING_TYPE", "VARCHAR(32)", "", "寻源方式"),
                ("STATUS", "VARCHAR(32)", "", "事件状态"), ("START_DATE", "DATETIME", "", "开始日期"),
                ("END_DATE", "DATETIME", "", "结束日期"), ("OWNER", "VARCHAR(64)", "", "负责人"),
            ]),
            T("supplier_quotation", "供应商报价", [
                ("QUOTATION_ID", "VARCHAR(64)", "PRI", "报价主键"), ("EVENT_ID", "VARCHAR(64)", "", "寻源事件主键"),
                ("SUPPLIER_ID", "VARCHAR(64)", "", "供应商编号"), ("QUOTED_AMOUNT", "DECIMAL(18,2)", "", "报价金额"),
                ("TAX_RATE", "DECIMAL(6,4)", "", "税率"), ("VALID_UNTIL", "DATE", "", "报价有效期"),
                ("STATUS", "VARCHAR(32)", "", "报价状态"),
            ]),
            T("price_agreement", "价格协议", [
                ("AGREEMENT_ID", "VARCHAR(64)", "PRI", "协议主键"), ("AGREEMENT_NO", "VARCHAR(32)", "UNI", "协议编号"),
                ("SUPPLIER_ID", "VARCHAR(64)", "", "供应商编号"), ("PRODUCT_ID", "VARCHAR(64)", "", "品目编号"),
                ("AGREED_PRICE", "DECIMAL(18,4)", "", "协议单价"), ("START_DATE", "DATE", "", "生效日期"),
                ("END_DATE", "DATE", "", "失效日期"), ("STATUS", "VARCHAR(32)", "", "协议状态"),
            ]),
        ],
    },
    {
        "code": "SRC-WAREHOUSE", "name": "仓储与收货系统", "system_type": "业务系统",
        "physical_object": "warehouse.goods_receipt", "data_category": "交易数据",
        "description": "收货单、收货明细、退货单与交付计划。",
        "tables": [
            T("goods_receipt", "收货单", [
                ("RECEIPT_ID", "VARCHAR(64)", "PRI", "收货主键"), ("RECEIPT_NO", "VARCHAR(32)", "UNI", "收货单号"),
                ("ORDER_ID", "VARCHAR(64)", "", "订单主键"), ("RECEIPT_DATE", "DATETIME", "", "收货日期"),
                ("WAREHOUSE_ID", "VARCHAR(64)", "", "仓库主键"), ("STATUS", "VARCHAR(32)", "", "收货状态"),
                ("RECEIVED_BY", "VARCHAR(64)", "", "收货人"),
            ]),
            T("goods_receipt_line", "收货明细", [
                ("LINE_ID", "VARCHAR(64)", "PRI", "明细主键"), ("RECEIPT_ID", "VARCHAR(64)", "", "收货主键"),
                ("PRODUCT_ID", "VARCHAR(64)", "", "品目编号"), ("QUANTITY", "DECIMAL(18,3)", "", "收货数量"),
                ("BATCH_NO", "VARCHAR(64)", "", "批次号"), ("QUALITY_STATUS", "VARCHAR(32)", "", "质量状态"),
            ]),
            T("return_order", "退货单", [
                ("RETURN_ID", "VARCHAR(64)", "PRI", "退货主键"), ("RETURN_NO", "VARCHAR(32)", "UNI", "退货单号"),
                ("RECEIPT_ID", "VARCHAR(64)", "", "收货主键"), ("RETURN_DATE", "DATETIME", "", "退货日期"),
                ("QUANTITY", "DECIMAL(18,3)", "", "退货数量"), ("REASON", "VARCHAR(512)", "", "退货原因"),
                ("STATUS", "VARCHAR(32)", "", "退货状态"),
            ]),
            T("delivery_schedule", "交付计划", [
                ("SCHEDULE_ID", "VARCHAR(64)", "PRI", "计划主键"), ("ORDER_ID", "VARCHAR(64)", "", "订单主键"),
                ("PLAN_DATE", "DATE", "", "计划交付日期"), ("QUANTITY", "DECIMAL(18,3)", "", "计划交付数量"),
                ("STATUS", "VARCHAR(32)", "", "交付状态"), ("CARRIER", "VARCHAR(128)", "", "承运商"),
            ]),
        ],
    },
    {
        "code": "SRC-EXPENSE", "name": "费用报销系统", "system_type": "财务系统",
        "physical_object": "expense.expense_claim", "data_category": "交易数据",
        "description": "员工费用报销单、报销明细和费用审核状态。",
        "tables": [
            T("expense_claim", "费用报销单", [
                ("CLAIM_ID", "VARCHAR(64)", "PRI", "报销主键"), ("CLAIM_NO", "VARCHAR(32)", "UNI", "报销单号"),
                ("CLAIM_TITLE", "VARCHAR(160)", "", "报销事由"), ("EMPLOYEE_ID", "VARCHAR(64)", "", "员工编号"),
                ("AMOUNT", "DECIMAL(18,2)", "", "报销金额"), ("STATUS", "VARCHAR(32)", "", "报销状态"),
                ("SUBMIT_DATE", "DATETIME", "", "提交日期"), ("COST_CENTER_ID", "VARCHAR(64)", "", "成本中心主键"),
            ]),
            T("expense_item", "报销明细", [
                ("ITEM_ID", "VARCHAR(64)", "PRI", "明细主键"), ("CLAIM_ID", "VARCHAR(64)", "", "报销主键"),
                ("EXPENSE_TYPE", "VARCHAR(32)", "", "费用类型"), ("AMOUNT", "DECIMAL(18,2)", "", "明细金额"),
                ("INVOICE_ID", "VARCHAR(64)", "", "发票主键"), ("DESCRIPTION", "VARCHAR(512)", "", "费用说明"),
            ]),
        ],
    },
    {
        "code": "SRC-ASSET", "name": "固定资产系统", "system_type": "资产系统",
        "physical_object": "asset.asset_card", "data_category": "资产数据",
        "description": "资产卡片、折旧计划和资产使用状态。",
        "tables": [
            T("asset_card", "资产卡片", [
                ("ASSET_ID", "VARCHAR(64)", "PRI", "资产主键"), ("ASSET_NO", "VARCHAR(32)", "UNI", "资产编号"),
                ("ASSET_NAME", "VARCHAR(160)", "", "资产名称"), ("CATEGORY", "VARCHAR(32)", "", "资产类别"),
                ("ORIGINAL_VALUE", "DECIMAL(18,2)", "", "原值"), ("ACCUM_DEPRECIATION", "DECIMAL(18,2)", "", "累计折旧"),
                ("STATUS", "VARCHAR(32)", "", "资产状态"), ("DEPARTMENT_ID", "VARCHAR(64)", "", "使用部门"),
                ("START_DATE", "DATE", "", "启用日期"),
            ]),
            T("depreciation_plan", "折旧计划", [
                ("PLAN_ID", "VARCHAR(64)", "PRI", "计划主键"), ("ASSET_ID", "VARCHAR(64)", "", "资产主键"),
                ("PERIOD", "VARCHAR(16)", "", "折旧期间"), ("DEPRECIATION_AMOUNT", "DECIMAL(18,2)", "", "本期折旧额"),
                ("ACCUMULATED_AMOUNT", "DECIMAL(18,2)", "", "累计折旧额"), ("STATUS", "VARCHAR(32)", "", "折旧状态"),
            ]),
        ],
    },
    {
        "code": "SRC-TREASURY", "name": "资金管理平台", "system_type": "财务系统",
        "physical_object": "treasury.fund", "data_category": "交易数据",
        "description": "银行账户、资金计划、付款核销、预付款和保证金。",
        "tables": [
            T("bank_account", "银行账户", [
                ("ACCOUNT_ID", "VARCHAR(64)", "PRI", "账户主键"), ("ACCOUNT_NO", "VARCHAR(64)", "UNI", "银行账号"),
                ("BANK_NAME", "VARCHAR(160)", "", "开户银行"), ("ACCOUNT_NAME", "VARCHAR(160)", "", "账户名称"),
                ("CURRENCY", "VARCHAR(8)", "", "币种"), ("BALANCE", "DECIMAL(18,2)", "", "账户余额"),
                ("STATUS", "VARCHAR(32)", "", "账户状态"),
            ]),
            T("fund_plan", "资金计划", [
                ("PLAN_ID", "VARCHAR(64)", "PRI", "计划主键"), ("PLAN_NO", "VARCHAR(32)", "UNI", "计划编号"),
                ("PLAN_MONTH", "VARCHAR(16)", "", "计划月份"), ("INFLOW_AMOUNT", "DECIMAL(18,2)", "", "计划流入"),
                ("OUTFLOW_AMOUNT", "DECIMAL(18,2)", "", "计划流出"), ("STATUS", "VARCHAR(32)", "", "计划状态"),
                ("OWNER", "VARCHAR(64)", "", "负责人"),
            ]),
            T("payment_allocation", "付款核销", [
                ("ALLOCATION_ID", "VARCHAR(64)", "PRI", "核销主键"), ("PAYMENT_ID", "VARCHAR(64)", "", "付款主键"),
                ("INVOICE_ID", "VARCHAR(64)", "", "发票主键"), ("ALLOCATED_AMOUNT", "DECIMAL(18,2)", "", "核销金额"),
                ("ALLOCATION_DATE", "DATETIME", "", "核销日期"),
            ]),
            T("exchange_rate", "汇率", [
                ("RATE_ID", "VARCHAR(64)", "PRI", "汇率主键"), ("CURRENCY_PAIR", "VARCHAR(16)", "", "币种对"),
                ("RATE_VALUE", "DECIMAL(18,6)", "", "汇率"), ("EFFECTIVE_DATE", "DATE", "", "生效日期"),
                ("SOURCE", "VARCHAR(64)", "", "汇率来源"), ("STATUS", "VARCHAR(32)", "", "状态"),
            ]),
            T("prepayment", "预付款", [
                ("PREPAYMENT_ID", "VARCHAR(64)", "PRI", "预付款主键"), ("PREPAYMENT_NO", "VARCHAR(32)", "UNI", "预付款单号"),
                ("CONTRACT_ID", "VARCHAR(64)", "", "合同主键"), ("AMOUNT", "DECIMAL(18,2)", "", "预付款金额"),
                ("PAID_DATE", "DATE", "", "支付日期"), ("STATUS", "VARCHAR(32)", "", "预付款状态"),
            ]),
            T("guarantee_deposit", "保证金", [
                ("DEPOSIT_ID", "VARCHAR(64)", "PRI", "保证金主键"), ("DEPOSIT_NO", "VARCHAR(32)", "UNI", "保证金单号"),
                ("CONTRACT_ID", "VARCHAR(64)", "", "合同主键"), ("AMOUNT", "DECIMAL(18,2)", "", "保证金金额"),
                ("DEPOSIT_TYPE", "VARCHAR(32)", "", "保证金类型"), ("STATUS", "VARCHAR(32)", "", "保证金状态"),
                ("REFUND_DATE", "DATE", "", "退还日期"),
            ]),
        ],
    },
    {
        "code": "SRC-TAX", "name": "税务管理系统", "system_type": "财务系统",
        "physical_object": "tax.tax_management", "data_category": "主数据",
        "description": "税率、税金计算和纳税申报状态。",
        "tables": [
            T("tax_rate", "税率", [
                ("TAX_RATE_ID", "VARCHAR(64)", "PRI", "税率主键"), ("TAX_TYPE", "VARCHAR(32)", "", "税种"),
                ("RATE_VALUE", "DECIMAL(8,4)", "", "税率"), ("EFFECTIVE_DATE", "DATE", "", "生效日期"),
                ("STATUS", "VARCHAR(32)", "", "税率状态"),
            ]),
            T("tax_filing", "纳税申报", [
                ("FILING_ID", "VARCHAR(64)", "PRI", "申报主键"), ("FILING_NO", "VARCHAR(32)", "UNI", "申报编号"),
                ("TAX_PERIOD", "VARCHAR(16)", "", "税款期间"), ("TAX_AMOUNT", "DECIMAL(18,2)", "", "申报税额"),
                ("STATUS", "VARCHAR(32)", "", "申报状态"), ("FILING_DATE", "DATE", "", "申报日期"),
            ]),
        ],
    },
    {
        "code": "SRC-AUDIT", "name": "审计与合规系统", "system_type": "业务系统",
        "physical_object": "audit.compliance", "data_category": "任务数据",
        "description": "合规检查、审计发现和风险预警。",
        "tables": [
            T("compliance_check", "合规检查", [
                ("CHECK_ID", "VARCHAR(64)", "PRI", "检查主键"), ("CHECK_NO", "VARCHAR(32)", "UNI", "检查编号"),
                ("CHECK_NAME", "VARCHAR(160)", "", "检查名称"), ("CHECK_TYPE", "VARCHAR(32)", "", "检查类型"),
                ("RESULT", "VARCHAR(32)", "", "检查结果"), ("CHECK_DATE", "DATE", "", "检查日期"),
                ("OWNER", "VARCHAR(64)", "", "检查人"),
            ]),
            T("audit_finding", "审计发现", [
                ("FINDING_ID", "VARCHAR(64)", "PRI", "发现主键"), ("FINDING_NO", "VARCHAR(32)", "UNI", "发现编号"),
                ("CHECK_ID", "VARCHAR(64)", "", "检查主键"), ("FINDING_TITLE", "VARCHAR(160)", "", "发现标题"),
                ("SEVERITY", "VARCHAR(16)", "", "严重程度"), ("STATUS", "VARCHAR(32)", "", "整改状态"),
                ("OWNER", "VARCHAR(64)", "", "责任人"),
            ]),
            T("risk_alert", "风险预警", [
                ("ALERT_ID", "VARCHAR(64)", "PRI", "预警主键"), ("ALERT_NO", "VARCHAR(32)", "UNI", "预警编号"),
                ("ALERT_TITLE", "VARCHAR(160)", "", "预警标题"), ("RISK_LEVEL", "VARCHAR(16)", "", "风险等级"),
                ("STATUS", "VARCHAR(32)", "", "预警状态"), ("TRIGGERED_AT", "DATETIME", "", "触发时间"),
                ("OWNER", "VARCHAR(64)", "", "处理人"),
            ]),
        ],
    },
    {
        "code": "SRC-HR", "name": "人力资源系统", "system_type": "业务系统",
        "physical_object": "hr.employee", "data_category": "主数据",
        "description": "员工、部门归属和成本中心责任信息。",
        "tables": [
            T("employee", "员工主数据", [
                ("EMPLOYEE_ID", "VARCHAR(64)", "PRI", "员工编号"), ("EMPLOYEE_NO", "VARCHAR(32)", "UNI", "工号"),
                ("EMPLOYEE_NAME", "VARCHAR(64)", "", "员工姓名"), ("DEPARTMENT_ID", "VARCHAR(64)", "", "部门主键"),
                ("POSITION", "VARCHAR(64)", "", "岗位"), ("STATUS", "VARCHAR(32)", "", "在职状态"),
                ("JOIN_DATE", "DATE", "", "入职日期"),
            ]),
            T("cost_center", "成本中心", [
                ("COST_CENTER_ID", "VARCHAR(64)", "PRI", "成本中心主键"), ("COST_CENTER_CODE", "VARCHAR(32)", "UNI", "成本中心编码"),
                ("COST_CENTER_NAME", "VARCHAR(128)", "", "成本中心名称"), ("ORG_ID", "VARCHAR(64)", "", "组织主键"),
                ("OWNER", "VARCHAR(64)", "", "负责人"), ("STATUS", "VARCHAR(32)", "", "状态"),
            ]),
        ],
    },
    {
        "code": "SRC-SETTLEMENT", "name": "供应商结算平台", "system_type": "财务系统",
        "physical_object": "settlement.supplier_statement", "data_category": "交易数据",
        "description": "供应商往来对账、付款计划和审批任务。",
        "tables": [
            T("supplier_statement", "供应商对账单", [
                ("STATEMENT_ID", "VARCHAR(64)", "PRI", "对账主键"), ("STATEMENT_NO", "VARCHAR(32)", "UNI", "对账单号"),
                ("SUPPLIER_ID", "VARCHAR(64)", "", "供应商编号"), ("PERIOD", "VARCHAR(16)", "", "对账期间"),
                ("AMOUNT", "DECIMAL(18,2)", "", "对账金额"), ("STATUS", "VARCHAR(32)", "", "对账状态"),
                ("CONFIRMED_DATE", "DATE", "", "确认日期"),
            ]),
            T("payment_plan", "付款计划", [
                ("PLAN_ID", "VARCHAR(64)", "PRI", "计划主键"), ("PLAN_NO", "VARCHAR(32)", "UNI", "计划编号"),
                ("CONTRACT_ID", "VARCHAR(64)", "", "合同主键"), ("PLAN_DATE", "DATE", "", "计划付款日期"),
                ("PLAN_AMOUNT", "DECIMAL(18,2)", "", "计划付款金额"), ("STATUS", "VARCHAR(32)", "", "计划状态"),
                ("OWNER", "VARCHAR(64)", "", "负责人"),
            ]),
            T("approval_task", "审批任务", [
                ("TASK_ID", "VARCHAR(64)", "PRI", "任务主键"), ("TASK_NO", "VARCHAR(32)", "UNI", "任务编号"),
                ("BUSINESS_TYPE", "VARCHAR(32)", "", "业务类型"), ("BUSINESS_ID", "VARCHAR(64)", "", "业务主键"),
                ("STATUS", "VARCHAR(32)", "", "审批状态"), ("ASSIGNEE", "VARCHAR(64)", "", "审批人"),
                ("CREATED_AT", "DATETIME", "", "创建时间"),
            ]),
        ],
    },
]


# ---------------------------------------------------------------------------
# Object types
# ---------------------------------------------------------------------------

def P(key: str, name: str, data_type: str = "string", *, pk: bool = False,
      required: bool = False, options: list[str] | None = None,
      column: str | None = None, mapped: bool = False, quality: str = "",
      transform: str = "", update: str = "batch", search: bool = False,
      description: str = "") -> dict[str, Any]:
    return {"key": key, "name": name, "type": data_type, "pk": pk, "required": required,
            "options": options, "column": column, "mapped": mapped, "quality": quality,
            "transform": transform, "update": update, "search": search, "description": description}


def O(name: str, display_name: str, icon: str, subject: str, source: str, table: str,
      description: str, props: list[dict[str, Any]]) -> dict[str, Any]:
    return {"name": name, "display_name": display_name, "icon": icon, "subject": subject,
            "source": source, "table": table, "description": description, "props": props}


OBJECTS: list[dict[str, Any]] = [
    O("PurchasePlan", "采购计划", "order", "procurement.planning", "SRC-REQUEST", "purchase_plan",
      "按组织、年度和预算安排形成的采购需求计划。", [
          P("plan_id", "计划主键", pk=True, required=True, column="PLAN_ID", mapped=True, quality="非空+唯一", search=True),
          P("plan_no", "计划单号", required=True, column="PLAN_NO", mapped=True, quality="非空+唯一", search=True),
          P("plan_name", "计划名称", required=True, column="PLAN_NAME", mapped=True, search=True),
          P("fiscal_year", "计划年度", "integer", column="FISCAL_YEAR"),
          P("amount", "计划金额", "decimal", column="AMOUNT", transform="金额单位：元", quality="金额 >= 0"),
          P("status", "计划状态", "enum", column="STATUS", options=["草拟", "已下达", "已关闭"]),
          P("owner", "计划负责人", column="OWNER"),
    ]),
    O("SourcingEvent", "寻源事件", "event", "procurement.sourcing", "SRC-SOURCING", "sourcing_event",
      "公开招标、询价或竞争性谈判等寻源活动的过程记录。", [
          P("event_id", "事件主键", pk=True, required=True, column="EVENT_ID", mapped=True, quality="非空+唯一"),
          P("event_no", "事件编号", required=True, column="EVENT_NO", mapped=True, quality="非空+唯一", search=True),
          P("event_name", "事件名称", required=True, column="EVENT_NAME", mapped=True, search=True),
          P("sourcing_type", "寻源方式", "enum", column="SOURCING_TYPE", options=["公开招标", "邀请招标", "竞争性谈判", "询价", "单一来源"]),
          P("status", "事件状态", "enum", column="STATUS", options=["草拟", "进行中", "已定标", "已取消"]),
          P("start_date", "开始日期", "datetime", column="START_DATE"),
          P("end_date", "结束日期", "datetime", column="END_DATE", mapped=False),
          P("owner", "负责人", column="OWNER"),
    ]),
    O("SupplierQuotation", "供应商报价", "document", "procurement.sourcing", "SRC-SOURCING", "supplier_quotation",
      "供应商针对寻源事件提交的报价与有效期。", [
          P("quotation_id", "报价主键", pk=True, required=True, column="QUOTATION_ID", mapped=True, quality="非空+唯一"),
          P("event_id", "寻源事件主键", column="EVENT_ID", mapped=True),
          P("supplier_id", "供应商编号", column="SUPPLIER_ID", mapped=True),
          P("quoted_amount", "报价金额", "decimal", column="QUOTED_AMOUNT", transform="金额单位：元"),
          P("tax_rate", "税率", "decimal", column="TAX_RATE"),
          P("valid_until", "报价有效期", "datetime", column="VALID_UNTIL"),
          P("status", "报价状态", "enum", column="STATUS", options=["待评审", "已中标", "未中标", "已失效"]),
    ]),
    O("PurchaseCategory", "采购品类", "box", "procurement.master", "SRC-MASTER", "product_category",
      "用于采购策略、供应商分组和支出分析的品类树节点。", [
          P("category_code", "品类编码", pk=True, required=True, column="CATEGORY_CODE", mapped=True, quality="非空+唯一"),
          P("category_name", "品类名称", required=True, column="CATEGORY_NAME", mapped=True, search=True),
          P("parent_code", "父级品类", column="PARENT_CODE"),
          P("level_no", "品类层级", "integer", column="LEVEL_NO", mapped=True),
          P("status", "品类状态", "enum", column="STATUS", options=["启用", "停用"]),
          P("owner", "品类负责人", column="OWNER"),
    ]),
    O("PriceAgreement", "价格协议", "document", "procurement.sourcing", "SRC-SOURCING", "price_agreement",
      "与供应商约定的品目价格、有效期和适用条件。", [
          P("agreement_id", "协议主键", pk=True, required=True, column="AGREEMENT_ID", mapped=True, quality="非空+唯一"),
          P("agreement_no", "协议编号", required=True, column="AGREEMENT_NO", mapped=True, search=True),
          P("supplier_id", "供应商编号", column="SUPPLIER_ID", mapped=True),
          P("product_id", "品目编号", column="PRODUCT_ID"),
          P("agreed_price", "协议单价", "decimal", column="AGREED_PRICE"),
          P("start_date", "生效日期", "datetime", column="START_DATE"),
          P("end_date", "失效日期", "datetime", column="END_DATE"),
          P("status", "协议状态", "enum", column="STATUS", options=["草拟", "生效", "失效", "终止"]),
    ]),
    O("GoodsReceipt", "收货单", "package", "procurement.receiving", "SRC-WAREHOUSE", "goods_receipt",
      "供应商交付到仓库后形成的收货与入库记录。", [
          P("receipt_id", "收货主键", pk=True, required=True, column="RECEIPT_ID", mapped=True, quality="非空+唯一"),
          P("receipt_no", "收货单号", required=True, column="RECEIPT_NO", mapped=True, quality="非空+唯一", search=True),
          P("order_id", "采购订单主键", column="ORDER_ID", mapped=True),
          P("receipt_date", "收货日期", "datetime", column="RECEIPT_DATE"),
          P("warehouse_id", "仓库主键", column="WAREHOUSE_ID"),
          P("status", "收货状态", "enum", column="STATUS", options=["待收货", "部分收货", "已收货", "已退回"]),
          P("received_by", "收货人", column="RECEIVED_BY"),
    ]),
    O("ReturnOrder", "退货单", "package", "procurement.receiving", "SRC-WAREHOUSE", "return_order",
      "因质量、数量或规格不符而发起的退货处理记录。", [
          P("return_id", "退货主键", pk=True, required=True, column="RETURN_ID", mapped=True, quality="非空+唯一"),
          P("return_no", "退货单号", required=True, column="RETURN_NO", mapped=True, search=True),
          P("receipt_id", "收货主键", column="RECEIPT_ID", mapped=True),
          P("return_date", "退货日期", "datetime", column="RETURN_DATE"),
          P("quantity", "退货数量", "decimal", column="QUANTITY"),
          P("reason", "退货原因", column="REASON"),
          P("status", "退货状态", "enum", column="STATUS", options=["申请中", "已批准", "已退货", "已关闭"]),
    ]),
    O("DeliverySchedule", "交付计划", "vehicle", "procurement.ordering", "SRC-WAREHOUSE", "delivery_schedule",
      "采购订单约定的分批交付时间、数量和承运安排。", [
          P("schedule_id", "计划主键", pk=True, required=True, column="SCHEDULE_ID", mapped=True, quality="非空+唯一"),
          P("order_id", "采购订单主键", column="ORDER_ID", mapped=True),
          P("plan_date", "计划交付日期", "datetime", column="PLAN_DATE", mapped=True),
          P("quantity", "计划交付数量", "decimal", column="QUANTITY"),
          P("status", "交付状态", "enum", column="STATUS", options=["待交付", "交付中", "已交付", "逾期"]),
          P("carrier", "承运商", column="CARRIER"),
    ]),
    O("SupplierQualification", "供应商资质", "document", "masterdata.supplier", "SRC-MASTER", "supplier_qualification",
      "供应商营业执照、行业许可和认证等准入资质。", [
          P("qualification_id", "资质主键", pk=True, required=True, column="QUALIFICATION_ID", mapped=True, quality="非空+唯一"),
          P("supplier_id", "供应商编号", column="SUPPLIER_ID", mapped=True),
          P("qualification_type", "资质类型", column="QUALIFICATION_TYPE", mapped=True),
          P("cert_no", "证书编号", column="CERT_NO", quality="非空+唯一"),
          P("valid_from", "生效日期", "datetime", column="VALID_FROM"),
          P("valid_to", "失效日期", "datetime", column="VALID_TO"),
          P("status", "资质状态", "enum", column="STATUS", options=["有效", "即将到期", "已过期", "已吊销"]),
    ]),
    O("SupplierPerformance", "供应商绩效", "chart", "masterdata.supplier", "SRC-MASTER", "supplier_performance",
      "按期间评价供应商交付、质量、价格与配合度的绩效结果。", [
          P("performance_id", "绩效主键", pk=True, required=True, column="PERFORMANCE_ID", mapped=True, quality="非空+唯一"),
          P("supplier_id", "供应商编号", column="SUPPLIER_ID", mapped=True),
          P("period", "评价期间", column="PERIOD", mapped=True, search=True),
          P("delivery_score", "交付得分", "decimal", column="DELIVERY_SCORE"),
          P("quality_score", "质量得分", "decimal", column="QUALITY_SCORE"),
          P("total_score", "综合得分", "decimal", column="TOTAL_SCORE"),
          P("level", "绩效等级", "enum", column="LEVEL", options=["A", "B", "C", "D"]),
    ]),
    O("ContractAmendment", "合同变更", "document", "contract.lifecycle", "SRC-CONTRACT", "contract_amendment",
      "合同金额、范围、期限或条款发生变化时的正式变更记录。", [
          P("amendment_id", "变更主键", pk=True, required=True, column="AMENDMENT_ID", mapped=True, quality="非空+唯一"),
          P("contract_id", "合同主键", column="CONTRACT_ID", mapped=True),
          P("amendment_no", "变更编号", required=True, column="AMENDMENT_NO", mapped=True, search=True),
          P("change_amount", "变更金额", "decimal", column="CHANGE_AMOUNT"),
          P("reason", "变更原因", column="REASON"),
          P("status", "变更状态", "enum", column="STATUS", options=["草拟", "审批中", "已生效", "已驳回"]),
          P("effective_date", "生效日期", "datetime", column="EFFECTIVE_DATE"),
    ]),
    O("ContractMilestone", "合同里程碑", "event", "contract.performance", "SRC-CONTRACT", "contract_milestone",
      "合同履约过程中的关键交付、验收或付款节点。", [
          P("milestone_id", "里程碑主键", pk=True, required=True, column="MILESTONE_ID", mapped=True, quality="非空+唯一"),
          P("contract_id", "合同主键", column="CONTRACT_ID", mapped=True),
          P("milestone_name", "里程碑名称", required=True, column="MILESTONE_NAME", mapped=True, search=True),
          P("plan_date", "计划日期", "datetime", column="PLAN_DATE"),
          P("actual_date", "实际日期", "datetime", column="ACTUAL_DATE"),
          P("amount", "里程碑金额", "decimal", column="AMOUNT"),
          P("status", "完成状态", "enum", column="STATUS", options=["未开始", "进行中", "已完成", "已逾期"]),
    ]),
    O("PaymentPlan", "付款计划", "database", "finance.payment", "SRC-SETTLEMENT", "payment_plan",
      "按合同和资金安排形成的计划付款节点。", [
          P("plan_id", "计划主键", pk=True, required=True, column="PLAN_ID", mapped=True, quality="非空+唯一"),
          P("plan_no", "计划编号", required=True, column="PLAN_NO", mapped=True, search=True),
          P("contract_id", "合同主键", column="CONTRACT_ID", mapped=True),
          P("plan_date", "计划付款日期", "datetime", column="PLAN_DATE"),
          P("plan_amount", "计划付款金额", "decimal", column="PLAN_AMOUNT"),
          P("status", "计划状态", "enum", column="STATUS", options=["待付款", "部分付款", "已付款", "已取消"]),
          P("owner", "负责人", column="OWNER"),
    ]),
    O("PaymentAllocation", "付款核销", "database", "finance.payment", "SRC-TREASURY", "payment_allocation",
      "付款申请与发票之间的核销关系及核销金额。", [
          P("allocation_id", "核销主键", pk=True, required=True, column="ALLOCATION_ID", mapped=True, quality="非空+唯一"),
          P("payment_id", "付款主键", column="PAYMENT_ID", mapped=True),
          P("invoice_id", "发票主键", column="INVOICE_ID", mapped=True),
          P("allocated_amount", "核销金额", "decimal", column="ALLOCATED_AMOUNT"),
          P("allocation_date", "核销日期", "datetime", column="ALLOCATION_DATE"),
    ]),
    O("BudgetLine", "预算明细", "database", "finance.budget", "SRC-BUDGET", "budget_line",
      "预算按科目拆分的额度与使用明细。", [
          P("line_id", "明细主键", pk=True, required=True, column="LINE_ID", mapped=True, quality="非空+唯一"),
          P("budget_id", "预算主键", column="BUDGET_ID", mapped=True),
          P("subject_code", "预算科目编码", column="SUBJECT_CODE", mapped=True),
          P("subject_name", "预算科目名称", column="SUBJECT_NAME"),
          P("line_amount", "预算行金额", "decimal", column="LINE_AMOUNT"),
          P("used_amount", "已使用金额", "decimal", column="USED_AMOUNT"),
    ]),
    O("BudgetAdjustment", "预算调整", "document", "finance.budget", "SRC-BUDGET", "budget_adjustment",
      "预算追加、调减或科目间调剂形成的调整记录。", [
          P("adjustment_id", "调整主键", pk=True, required=True, column="ADJUSTMENT_ID", mapped=True, quality="非空+唯一"),
          P("budget_id", "预算主键", column="BUDGET_ID", mapped=True),
          P("adjust_no", "调整单号", required=True, column="ADJUST_NO", mapped=True),
          P("adjust_amount", "调整金额", "decimal", column="ADJUST_AMOUNT"),
          P("reason", "调整原因", column="REASON"),
          P("status", "调整状态", "enum", column="STATUS", options=["草拟", "审批中", "已生效", "已驳回"]),
          P("approved_date", "批准日期", "datetime", column="APPROVED_DATE"),
    ]),
    O("CostCenter", "成本中心", "building", "finance.accounting", "SRC-HR", "cost_center",
      "承担费用归集和预算责任的成本中心。", [
          P("cost_center_id", "成本中心主键", pk=True, required=True, column="COST_CENTER_ID", mapped=True, quality="非空+唯一"),
          P("cost_center_code", "成本中心编码", required=True, column="COST_CENTER_CODE", mapped=True, search=True),
          P("cost_center_name", "成本中心名称", column="COST_CENTER_NAME"),
          P("org_id", "组织主键", column="ORG_ID", mapped=True),
          P("owner", "负责人", column="OWNER"),
          P("status", "状态", "enum", column="STATUS", options=["启用", "停用"]),
    ]),
    O("ExpenseClaim", "费用报销单", "document", "expense.reimbursement", "SRC-EXPENSE", "expense_claim",
      "员工提交的差旅、招待、办公等费用报销申请。", [
          P("claim_id", "报销主键", pk=True, required=True, column="CLAIM_ID", mapped=True, quality="非空+唯一"),
          P("claim_no", "报销单号", required=True, column="CLAIM_NO", mapped=True, search=True),
          P("claim_title", "报销事由", required=True, column="CLAIM_TITLE", mapped=True, search=True),
          P("employee_id", "员工编号", column="EMPLOYEE_ID"),
          P("amount", "报销金额", "decimal", column="AMOUNT"),
          P("status", "报销状态", "enum", column="STATUS", options=["草拟", "审批中", "已通过", "已驳回", "已支付"]),
          P("submit_date", "提交日期", "datetime", column="SUBMIT_DATE"),
          P("cost_center_id", "成本中心主键", column="COST_CENTER_ID"),
    ]),
    O("ExpenseItem", "报销明细", "document", "expense.reimbursement", "SRC-EXPENSE", "expense_item",
      "报销单下按费用类型拆分的明细行。", [
          P("item_id", "明细主键", pk=True, required=True, column="ITEM_ID", mapped=True, quality="非空+唯一"),
          P("claim_id", "报销主键", column="CLAIM_ID", mapped=True),
          P("expense_type", "费用类型", column="EXPENSE_TYPE", mapped=True),
          P("amount", "明细金额", "decimal", column="AMOUNT"),
          P("invoice_id", "发票主键", column="INVOICE_ID"),
          P("description", "费用说明", column="DESCRIPTION"),
    ]),
    O("AssetCard", "资产卡片", "package", "expense.asset", "SRC-ASSET", "asset_card",
      "固定资产从入账、使用到处置的资产主记录。", [
          P("asset_id", "资产主键", pk=True, required=True, column="ASSET_ID", mapped=True, quality="非空+唯一"),
          P("asset_no", "资产编号", required=True, column="ASSET_NO", mapped=True, search=True),
          P("asset_name", "资产名称", required=True, column="ASSET_NAME", mapped=True, search=True),
          P("category", "资产类别", "enum", column="CATEGORY", options=["机器设备", "电子设备", "运输工具", "房屋建筑物", "其他"]),
          P("original_value", "资产原值", "decimal", column="ORIGINAL_VALUE"),
          P("accum_depreciation", "累计折旧", "decimal", column="ACCUM_DEPRECIATION"),
          P("status", "资产状态", "enum", column="STATUS", options=["在用", "闲置", "维修", "已处置"]),
          P("department_id", "使用部门", column="DEPARTMENT_ID"),
          P("start_date", "启用日期", "datetime", column="START_DATE"),
    ]),
    O("DepreciationPlan", "折旧计划", "database", "expense.asset", "SRC-ASSET", "depreciation_plan",
      "按期间计提的资产折旧计划和累计折旧。", [
          P("plan_id", "计划主键", pk=True, required=True, column="PLAN_ID", mapped=True, quality="非空+唯一"),
          P("asset_id", "资产主键", column="ASSET_ID", mapped=True),
          P("period", "折旧期间", column="PERIOD", mapped=True),
          P("depreciation_amount", "本期折旧额", "decimal", column="DEPRECIATION_AMOUNT"),
          P("accumulated_amount", "累计折旧额", "decimal", column="ACCUMULATED_AMOUNT"),
          P("status", "折旧状态", "enum", column="STATUS", options=["待计提", "已计提", "已调整"]),
    ]),
    O("BankAccount", "银行账户", "building", "treasury.fund", "SRC-TREASURY", "bank_account",
      "企业用于收付款和资金归集的银行账户。", [
          P("account_id", "账户主键", pk=True, required=True, column="ACCOUNT_ID", mapped=True, quality="非空+唯一"),
          P("account_no", "银行账号", required=True, column="ACCOUNT_NO", mapped=True, search=True),
          P("bank_name", "开户银行", column="BANK_NAME", mapped=True),
          P("account_name", "账户名称", column="ACCOUNT_NAME"),
          P("currency", "币种", column="CURRENCY"),
          P("balance", "账户余额", "decimal", column="BALANCE"),
          P("status", "账户状态", "enum", column="STATUS", options=["正常", "冻结", "销户"]),
    ]),
    O("FundPlan", "资金计划", "database", "treasury.fund", "SRC-TREASURY", "fund_plan",
      "按月编制的资金流入、流出和余额安排。", [
          P("plan_id", "计划主键", pk=True, required=True, column="PLAN_ID", mapped=True, quality="非空+唯一"),
          P("plan_no", "计划编号", required=True, column="PLAN_NO", mapped=True, search=True),
          P("plan_month", "计划月份", column="PLAN_MONTH", mapped=True),
          P("inflow_amount", "计划流入", "decimal", column="INFLOW_AMOUNT"),
          P("outflow_amount", "计划流出", "decimal", column="OUTFLOW_AMOUNT"),
          P("status", "计划状态", "enum", column="STATUS", options=["草拟", "已审批", "执行中", "已关闭"]),
          P("owner", "负责人", column="OWNER"),
    ]),
    O("ExchangeRate", "汇率", "database", "treasury.fund", "SRC-TREASURY", "exchange_rate",
      "外币业务折算使用的币种汇率及生效日期。", [
          P("rate_id", "汇率主键", pk=True, required=True, column="RATE_ID", mapped=True, quality="非空+唯一"),
          P("currency_pair", "币种对", required=True, column="CURRENCY_PAIR", mapped=True, search=True),
          P("rate_value", "汇率", "decimal", column="RATE_VALUE"),
          P("effective_date", "生效日期", "datetime", column="EFFECTIVE_DATE"),
          P("source", "汇率来源", column="SOURCE"),
          P("status", "状态", "enum", column="STATUS", options=["启用", "停用"]),
    ]),
    O("TaxRate", "税率", "database", "treasury.tax", "SRC-TAX", "tax_rate",
      "按税种和生效日期维护的法定税率。", [
          P("tax_rate_id", "税率主键", pk=True, required=True, column="TAX_RATE_ID", mapped=True, quality="非空+唯一"),
          P("tax_type", "税种", required=True, column="TAX_TYPE", mapped=True, search=True),
          P("rate_value", "税率", "decimal", column="RATE_VALUE", mapped=True),
          P("effective_date", "生效日期", "datetime", column="EFFECTIVE_DATE"),
          P("status", "税率状态", "enum", column="STATUS", options=["启用", "停用"]),
    ]),
    O("InvoiceLine", "发票明细", "document", "finance.settlement", "SRC-INVOICE", "invoice_line",
      "发票下按货物或服务拆分的明细行。", [
          P("line_id", "明细主键", pk=True, required=True, column="LINE_ID", mapped=True, quality="非空+唯一"),
          P("invoice_id", "发票主键", column="INVOICE_ID", mapped=True),
          P("item_name", "货物或服务名称", required=True, column="ITEM_NAME", mapped=True, search=True),
          P("quantity", "数量", "decimal", column="QUANTITY"),
          P("unit_price", "单价", "decimal", column="UNIT_PRICE"),
          P("amount", "金额", "decimal", column="AMOUNT"),
          P("tax_rate", "税率", "decimal", column="TAX_RATE"),
    ]),
    O("ComplianceCheck", "合规检查", "clipboard", "risk.compliance", "SRC-AUDIT", "compliance_check",
      "围绕采购、合同、付款等业务开展的合规检查。", [
          P("check_id", "检查主键", pk=True, required=True, column="CHECK_ID", mapped=True, quality="非空+唯一"),
          P("check_no", "检查编号", required=True, column="CHECK_NO", mapped=True, search=True),
          P("check_name", "检查名称", required=True, column="CHECK_NAME", mapped=True, search=True),
          P("check_type", "检查类型", "enum", column="CHECK_TYPE", options=["例行检查", "专项检查", "飞行检查", "自查"]),
          P("result", "检查结果", "enum", column="RESULT", options=["通过", "关注", "不通过"]),
          P("check_date", "检查日期", "datetime", column="CHECK_DATE"),
          P("owner", "检查人", column="OWNER"),
    ]),
    O("AuditFinding", "审计发现", "clipboard", "risk.compliance", "SRC-AUDIT", "audit_finding",
      "检查发现的违规、缺陷或控制失效问题及整改状态。", [
          P("finding_id", "发现主键", pk=True, required=True, column="FINDING_ID", mapped=True, quality="非空+唯一"),
          P("finding_no", "发现编号", required=True, column="FINDING_NO", mapped=True, search=True),
          P("check_id", "检查主键", column="CHECK_ID", mapped=True),
          P("finding_title", "发现标题", required=True, column="FINDING_TITLE", mapped=True, search=True),
          P("severity", "严重程度", "enum", column="SEVERITY", options=["低", "中", "高", "重大"]),
          P("status", "整改状态", "enum", column="STATUS", options=["待整改", "整改中", "已关闭", "已升级"]),
          P("owner", "责任人", column="OWNER"),
    ]),
    O("RiskAlert", "风险预警", "alert", "risk.compliance", "SRC-AUDIT", "risk_alert",
      "由规则或模型触发的采购财务风险提示。", [
          P("alert_id", "预警主键", pk=True, required=True, column="ALERT_ID", mapped=True, quality="非空+唯一"),
          P("alert_no", "预警编号", required=True, column="ALERT_NO", mapped=True, search=True),
          P("alert_title", "预警标题", required=True, column="ALERT_TITLE", mapped=True, search=True),
          P("risk_level", "风险等级", "enum", column="RISK_LEVEL", options=["低", "中", "高", "重大"]),
          P("status", "预警状态", "enum", column="STATUS", options=["待处理", "处理中", "已关闭", "已升级"]),
          P("triggered_at", "触发时间", "datetime", column="TRIGGERED_AT"),
          P("owner", "处理人", column="OWNER"),
    ]),
    O("Employee", "员工", "person", "masterdata.organization", "SRC-HR", "employee",
      "提出采购需求、报销费用或承担审批职责的员工。", [
          P("employee_id", "员工编号", pk=True, required=True, column="EMPLOYEE_ID", mapped=True, quality="非空+唯一"),
          P("employee_no", "工号", required=True, column="EMPLOYEE_NO", mapped=True, quality="非空+唯一", search=True),
          P("employee_name", "员工姓名", required=True, column="EMPLOYEE_NAME", mapped=True, search=True),
          P("department_id", "部门主键", column="DEPARTMENT_ID"),
          P("position", "岗位", column="POSITION"),
          P("status", "在职状态", "enum", column="STATUS", options=["在职", "离职", "借调"]),
          P("join_date", "入职日期", "datetime", column="JOIN_DATE"),
    ]),
]


# A few key mappings for the thirteen pre-existing object types, so the demo
# graph covers the original procurement chain too.
EXTRA_MAPPINGS: list[dict[str, Any]] = [
    {"object": "Supplier", "source": "SRC-MASTER", "table": "supplier", "key": "SUPPLIER_ID",
     "props": [("supplier_id", "SUPPLIER_ID", "direct", "非空+唯一"), ("supplier_name", "SUPPLIER_NAME", "direct", "非空"),
               ("rating", "RATING", "enum_map", "枚举合法")]},
    {"object": "Product", "source": "SRC-MASTER", "table": "product", "key": "PRODUCT_ID",
     "props": [("product_id", "PRODUCT_ID", "direct", "非空+唯一"), ("product_name", "PRODUCT_NAME", "direct", "非空"),
               ("category", "CATEGORY_NAME", "direct", "非空")]},
    {"object": "OrganizationUnit", "source": "SRC-MASTER", "table": "org_unit", "key": "ORG_ID",
     "props": [("org_id", "ORG_ID", "direct", "非空+唯一"), ("org_name", "ORG_NAME", "direct", "非空"),
               ("org_level", "ORG_LEVEL", "enum_map", "枚举合法")]},
    {"object": "Project", "source": "SRC-PROJECT", "table": "project_master", "key": "PROJECT_ID",
     "props": [("project_id", "PROJECT_ID", "direct", "非空+唯一"), ("project_name", "PROJECT_NAME", "direct", "非空"),
               ("status", "STATUS", "enum_map", "枚举合法")]},
    {"object": "Budget", "source": "SRC-BUDGET", "table": "budget_execution", "key": "BUDGET_ID",
     "props": [("budget_id", "BUDGET_ID", "direct", "非空+唯一"), ("budget_name", "BUDGET_NAME", "direct", "非空"),
               ("available_amount", "AVAILABLE_AMOUNT", "unit", "金额 >= 0")]},
    {"object": "PurchaseRequest", "source": "SRC-REQUEST", "table": "purchase_request", "key": "REQUEST_ID",
     "props": [("request_id", "REQUEST_ID", "direct", "非空+唯一"), ("request_no", "REQUEST_NO", "direct", "非空+唯一"),
               ("amount", "AMOUNT", "unit", "金额 > 0")]},
    {"object": "PurchaseOrder", "source": "SRC-ORDER", "table": "purchase_order", "key": "ORDER_ID",
     "props": [("order_id", "ORDER_ID", "direct", "非空+唯一"), ("order_no", "ORDER_NO", "direct", "非空+唯一"),
               ("amount", "AMOUNT", "unit", "金额 > 0")]},
    {"object": "Contract", "source": "SRC-CONTRACT", "table": "contract_main", "key": "CONTRACT_ID",
     "props": [("contract_id", "CONTRACT_ID", "direct", "非空+唯一"), ("contract_no", "CONTRACT_NO", "direct", "非空+唯一"),
               ("amount", "AMOUNT", "unit", "金额 > 0")]},
    {"object": "AcceptanceRecord", "source": "SRC-ACCEPTANCE", "table": "acceptance_record", "key": "ACCEPTANCE_ID",
     "props": [("acceptance_id", "ACCEPTANCE_ID", "direct", "非空+唯一"), ("acceptance_no", "ACCEPTANCE_NO", "direct", "非空+唯一"),
               ("amount", "AMOUNT", "unit", "金额 > 0")]},
    {"object": "Invoice", "source": "SRC-INVOICE", "table": "invoice_pool", "key": "INVOICE_ID",
     "props": [("invoice_id", "INVOICE_ID", "direct", "非空+唯一"), ("invoice_no", "INVOICE_NO", "direct", "非空+唯一"),
               ("amount", "AMOUNT", "unit", "金额 >= 0")]},
    {"object": "PaymentRequest", "source": "SRC-PAY", "table": "payment_request", "key": "PAYMENT_ID",
     "props": [("payment_no", "PAYMENT_NO", "direct", "非空+唯一"), ("status", "STATUS", "enum_map", "枚举合法")]},
    {"object": "AccountingVoucher", "source": "SRC-VOUCHER", "table": "accounting_voucher", "key": "VOUCHER_ID",
     "props": [("voucher_id", "VOUCHER_ID", "direct", "非空+唯一"), ("voucher_no", "VOUCHER_NO", "direct", "非空+唯一"),
               ("amount", "AMOUNT", "unit", "金额 >= 0")]},
    {"object": "RiskReviewTask", "source": "SRC-RISK", "table": "payment_review_task", "key": "TASK_ID",
     "props": [("task_id", "TASK_ID", "direct", "非空+唯一"), ("task_title", "TASK_TITLE", "direct", "非空"),
               ("risk_level", "RISK_LEVEL", "enum_map", "枚举合法")]},
]


LINKS = [
    ("plan_generates_request", "生成采购申请", "PurchasePlan", "PurchaseRequest", "one_to_many", "采购计划下推形成的采购申请"),
    ("request_triggers_sourcing", "发起寻源", "PurchaseRequest", "SourcingEvent", "one_to_many", "采购申请对应的寻源事件"),
    ("sourcing_has_quotation", "收到报价", "SourcingEvent", "SupplierQuotation", "one_to_many", "寻源事件收到的供应商报价"),
    ("quotation_from_supplier", "报价供应商", "SupplierQuotation", "Supplier", "many_to_one", "提交报价的供应商"),
    ("sourcing_results_agreement", "形成价格协议", "SourcingEvent", "PriceAgreement", "one_to_many", "寻源结果形成的价格协议"),
    ("agreement_for_product", "协议品目", "PriceAgreement", "Product", "many_to_one", "价格协议约定的采购品目"),
    ("order_has_delivery_schedule", "交付计划", "PurchaseOrder", "DeliverySchedule", "one_to_many", "采购订单的分批交付计划"),
    ("order_receives_goods", "收货记录", "PurchaseOrder", "GoodsReceipt", "one_to_many", "采购订单对应的收货单"),
    ("goods_receipt_has_return", "退货记录", "GoodsReceipt", "ReturnOrder", "one_to_many", "收货后发现问题的退货单"),
    ("supplier_has_qualification", "持有资质", "Supplier", "SupplierQualification", "one_to_many", "供应商持有的准入资质"),
    ("supplier_has_performance", "绩效评价", "Supplier", "SupplierPerformance", "one_to_many", "供应商的期间绩效评价"),
    ("contract_has_amendment", "合同变更", "Contract", "ContractAmendment", "one_to_many", "合同签署后的正式变更"),
    ("contract_has_milestone", "合同里程碑", "Contract", "ContractMilestone", "one_to_many", "合同履约的关键节点"),
    ("contract_has_payment_plan", "付款计划", "Contract", "PaymentPlan", "one_to_many", "合同项下的计划付款安排"),
    ("payment_has_allocation", "付款核销", "PaymentRequest", "PaymentAllocation", "one_to_many", "付款与发票的核销记录"),
    ("allocation_matches_invoice", "核销发票", "PaymentAllocation", "Invoice", "many_to_one", "核销对应的发票"),
    ("budget_has_line", "预算明细", "Budget", "BudgetLine", "one_to_many", "预算按科目拆分的明细"),
    ("budget_has_adjustment", "预算调整", "Budget", "BudgetAdjustment", "one_to_many", "预算执行过程中的调整"),
    ("budget_uses_cost_center", "成本中心", "Budget", "CostCenter", "many_to_one", "预算归集的成本中心"),
    ("employee_submits_expense", "提交报销", "Employee", "ExpenseClaim", "one_to_many", "员工提交的费用报销"),
    ("expense_has_item", "报销明细", "ExpenseClaim", "ExpenseItem", "one_to_many", "报销单下的费用明细"),
    ("expense_item_uses_invoice", "关联发票", "ExpenseItem", "Invoice", "many_to_one", "报销明细对应的发票"),
    ("invoice_has_line", "发票明细", "Invoice", "InvoiceLine", "one_to_many", "发票下的货物或服务明细"),
    ("asset_has_depreciation", "折旧计划", "AssetCard", "DepreciationPlan", "one_to_many", "资产卡片的期间折旧计划"),
    ("cost_center_owns_asset", "使用资产", "CostCenter", "AssetCard", "one_to_many", "成本中心使用的固定资产"),
    ("payment_uses_bank_account", "付款账户", "PaymentRequest", "BankAccount", "many_to_one", "执行付款的银行账户"),
    ("fund_plan_covers_payment", "资金计划覆盖", "FundPlan", "PaymentRequest", "one_to_many", "资金计划覆盖的付款申请"),
    ("payment_uses_exchange_rate", "折算汇率", "PaymentRequest", "ExchangeRate", "many_to_one", "外币付款使用的汇率"),
    ("invoice_uses_tax_rate", "适用税率", "Invoice", "TaxRate", "many_to_one", "发票适用的税率"),
    ("compliance_check_finds_finding", "检查发现", "ComplianceCheck", "AuditFinding", "one_to_many", "合规检查形成的审计发现"),
    ("compliance_check_checks_contract", "检查合同", "ComplianceCheck", "Contract", "many_to_many", "合规检查覆盖的采购合同"),
    ("risk_alert_targets_payment", "预警付款", "RiskAlert", "PaymentRequest", "many_to_one", "风险预警指向的付款申请"),
    ("payment_plan_generates_payment", "生成付款申请", "PaymentPlan", "PaymentRequest", "one_to_many", "付款计划下推形成的付款申请"),
]


RELATION_MAPPINGS = [
    ("MAP-PROC-REL-001", "寻源报价关系映射", "SRC-SOURCING", "supplier_quotation", "EVENT_ID/QUOTATION_ID", "EVENT_ID+QUOTATION_ID", "sourcing_has_quotation", "one_to_many"),
    ("MAP-PROC-REL-002", "订单收货关系映射", "SRC-WAREHOUSE", "goods_receipt", "ORDER_ID/RECEIPT_ID", "ORDER_ID+RECEIPT_ID", "order_receives_goods", "one_to_many"),
    ("MAP-PROC-REL-003", "合同变更关系映射", "SRC-CONTRACT", "contract_amendment", "CONTRACT_ID/AMENDMENT_ID", "CONTRACT_ID+AMENDMENT_ID", "contract_has_amendment", "one_to_many"),
    ("MAP-PROC-REL-004", "供应商资质关系映射", "SRC-MASTER", "supplier_qualification", "SUPPLIER_ID/QUALIFICATION_ID", "SUPPLIER_ID+QUALIFICATION_ID", "supplier_has_qualification", "one_to_many"),
    ("MAP-PROC-REL-005", "付款核销关系映射", "SRC-TREASURY", "payment_allocation", "PAYMENT_ID/INVOICE_ID", "PAYMENT_ID+INVOICE_ID", "payment_has_allocation", "one_to_many"),
    ("MAP-PROC-REL-006", "报销发票关系映射", "SRC-EXPENSE", "expense_item", "INVOICE_ID/ITEM_ID", "INVOICE_ID+ITEM_ID", "expense_item_uses_invoice", "many_to_one"),
    ("MAP-PROC-REL-007", "预算明细关系映射", "SRC-BUDGET", "budget_line", "BUDGET_ID/LINE_ID", "BUDGET_ID+LINE_ID", "budget_has_line", "one_to_many"),
    ("MAP-PROC-REL-008", "检查发现关系映射", "SRC-AUDIT", "audit_finding", "CHECK_ID/FINDING_ID", "CHECK_ID+FINDING_ID", "compliance_check_finds_finding", "one_to_many"),
]


# ---------------------------------------------------------------------------
# Installation helpers
# ---------------------------------------------------------------------------

def _existing_codes(ontology_id: str, table: str) -> dict[str, str]:
    conn = repo.get_conn()
    rows = conn.execute(f"SELECT id,code FROM {table} WHERE ontology_id=?", (ontology_id,)).fetchall()
    conn.close()
    return {row["code"]: row["id"] for row in rows}


def _existing_names(ontology_id: str, table: str) -> dict[str, str]:
    conn = repo.get_conn()
    rows = conn.execute(f"SELECT id,name FROM {table} WHERE ontology_id=?", (ontology_id,)).fetchall()
    conn.close()
    return {row["name"]: row["id"] for row in rows}


def _ensure_domains(ontology_id: str) -> dict[str, dict[str, Any]]:
    existing = {item["code"]: item for item in repo.list_business_domains(ontology_id)}
    result: dict[str, dict[str, Any]] = {}
    for code, name, description, owner in DOMAINS:
        result[code] = existing.get(code) or repo.save_business_domain(
            ontology_id, BusinessDomainBase(code=code, name=name, description=description, owner=owner, status="active"))
    return result


def _ensure_subjects(ontology_id: str, domains: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    existing = {item["code"]: item for item in repo.list_subject_domains(ontology_id)}
    result: dict[str, dict[str, Any]] = {}
    for domain_code, code, name, description in SUBJECTS:
        result[code] = existing.get(code) or repo.save_subject_domain(
            ontology_id, SubjectDomainBase(business_domain_id=domains[domain_code]["id"], code=code,
                                           name=name, description=description, owner="领域建模负责人", status="active"))
    return result


def _ensure_sources(ontology_id: str) -> dict[str, dict[str, Any]]:
    existing = {item["code"]: item for item in list_resources(ontology_id, "data-sources")}
    result: dict[str, dict[str, Any]] = {}
    for spec in SOURCES:
        code = spec["code"]
        record = existing.get(code)
        if not record:
            payload = {
                "physical_object": spec["physical_object"], "system_type": spec["system_type"],
                "data_category": spec["data_category"], "interface_type": "数据库",
                "update_frequency": "每日", "source_origin": "built_in_demo",
                "credential_policy": "演示数据，不配置真实凭据", "demo_marker": SOURCE_MARKER,
            }
            record = save_resource(ontology_id, "data-sources", EnterpriseResourceBase(
                code=code, name=spec["name"], category=spec["system_type"], status="active",
                description=spec["description"], payload=payload))
        result[code] = record
    return result


def _schema_tables(spec: dict[str, Any]) -> dict[str, Any]:
    return {"origin": "built-in-procurement-mapping-demo", "tables": spec["tables"]}


def _ensure_snapshots(ontology_id: str, sources: dict[str, dict[str, Any]]) -> None:
    for spec in SOURCES:
        source = sources[spec["code"]]
        if source_connections.latest_snapshot(ontology_id, source["id"]):
            continue
        source_connections.save_snapshot(ontology_id, source["id"], _schema_tables(spec))


def _ensure_objects(ontology_id: str, subjects: dict[str, dict[str, Any]], domains: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    existing = {item["name"]: item for item in repo.list_object_types(ontology_id)}
    result: dict[str, dict[str, Any]] = dict(existing)
    for spec in OBJECTS:
        if spec["name"] in result:
            continue
        properties = [
            PropertyDef(
                key=prop["key"], name=prop["name"], type=prop["type"],
                is_primary_key=prop["pk"], is_required=prop["required"], is_searchable=prop["search"],
                options=prop["options"], description=prop["description"] or None,
                source_field=prop["column"] or None,
                source_system=spec["source"], design_status="已确认",
            )
            for prop in spec["props"]
        ]
        subject_code = OBJECT_SUBJECTS.get(spec["name"], "procurement.master")
        domain_code = next(code for code, subject_cd, *_ in SUBJECTS if subject_cd == subject_code)
        record = repo.create_object_type(ontology_id, ObjectTypeBase(
            name=spec["name"], display_name=spec["display_name"], icon=spec["icon"],
            description=spec["description"], status="active", properties=properties,
            category=OBJECT_CATEGORIES.get(spec["name"], "业务实体"),
            subject_domain_id=subjects[subject_code]["id"], domain=domains[domain_code]["name"],
            backing_source=spec["source"], design_status="已确认",
        ))
        result[spec["name"]] = record
    return result


def _normalize_taxonomy(ontology_id: str, domains: dict[str, dict[str, Any]], subjects: dict[str, dict[str, Any]]) -> None:
    """Collapse the demo ontology to two business domains and six subject domains.

    Object classifications are reassigned before the extra classifications are
    removed. The function is deliberately written as a direct SQL reconciliation:
    this is built-in prototype cleanup, not a user edit, so it should not create a
    pending change for every object it touches.
    """
    allowed_domains = [code for code, *_ in DOMAINS]
    allowed_subjects = [code for _, code, *_ in SUBJECTS]
    domain_placeholders = ",".join("?" for _ in allowed_domains)
    subject_placeholders = ",".join("?" for _ in allowed_subjects)
    timestamp = repo.now()
    conn = repo.get_conn()
    for code, name, description, owner in DOMAINS:
        conn.execute("""UPDATE business_domains SET name=?,description=?,owner=?,status='active',updated_at=?,updated_by='system-bootstrap'
            WHERE ontology_id=? AND code=?""", (name, description, owner, timestamp, ontology_id, code))
    subject_parent = {}
    for domain_code, code, name, description in SUBJECTS:
        domain_id = domains[domain_code]["id"]
        subject_parent[code] = (domain_id, domains[domain_code]["name"])
        conn.execute("""UPDATE subject_domains SET business_domain_id=?,name=?,description=?,owner=?,status='active',updated_at=?,updated_by='system-bootstrap'
            WHERE ontology_id=? AND code=?""", (domain_id, name, description, "领域建模负责人", timestamp, ontology_id, code))
    subject_rows = conn.execute("SELECT id,code FROM subject_domains WHERE ontology_id=?", (ontology_id,)).fetchall()
    subject_ids = {row["code"]: row["id"] for row in subject_rows}
    fallback_subject = subject_ids.get("procurement.master")
    for row in conn.execute("SELECT id,name,metadata FROM object_types WHERE ontology_id=?", (ontology_id,)).fetchall():
        code = OBJECT_SUBJECTS.get(row["name"], "procurement.master")
        target = subject_ids.get(code) or fallback_subject
        if not target:
            continue
        domain_id, domain_name = subject_parent.get(code, next(iter(subject_parent.values())))
        metadata = json.loads(row["metadata"] or "{}")
        metadata["domain"] = domain_name
        metadata["category"] = OBJECT_CATEGORIES.get(row["name"], "业务实体")
        conn.execute("""UPDATE object_types SET subject_domain_id=?,metadata=?,updated_at=?,updated_by='system-bootstrap'
            WHERE id=? AND (subject_domain_id IS NULL OR subject_domain_id<>? OR metadata<>?)""",
            (target, json.dumps(metadata, ensure_ascii=False), timestamp, row["id"], target, json.dumps(metadata, ensure_ascii=False)))
    # Legacy groups and source registrations may still point at removed subjects.
    conn.execute(f"""UPDATE object_type_groups SET subject_domain_id=NULL
        WHERE ontology_id=? AND subject_domain_id IN (
            SELECT id FROM subject_domains WHERE ontology_id=? AND code NOT IN ({subject_placeholders})
        )""", (ontology_id, ontology_id, *allowed_subjects))
    for row in conn.execute("SELECT id,payload FROM enterprise_data_sources WHERE ontology_id=?", (ontology_id,)).fetchall():
        payload = json.loads(row["payload"] or "{}")
        if payload.get("subject_domain_code") and payload["subject_domain_code"] not in allowed_subjects:
            payload["subject_domain_code"] = None
            conn.execute("UPDATE enterprise_data_sources SET payload=?,updated_at=? WHERE id=?",
                         (json.dumps(payload, ensure_ascii=False), timestamp, row["id"]))
    conn.execute(f"DELETE FROM subject_domains WHERE ontology_id=? AND code NOT IN ({subject_placeholders})",
                 (ontology_id, *allowed_subjects))
    conn.execute(f"DELETE FROM business_domains WHERE ontology_id=? AND code NOT IN ({domain_placeholders})",
                 (ontology_id, *allowed_domains))
    conn.commit()
    conn.close()



def _ensure_links(ontology_id: str, objects: dict[str, dict[str, Any]]) -> None:
    existing = {item["name"] for item in repo.list_link_types(ontology_id)}
    for name, display_name, source, target, cardinality, description in LINKS:
        if name in existing or source not in objects or target not in objects:
            continue
        repo.save_link_type(ontology_id, LinkTypeBase(
            name=name, display_name=display_name, source_object_type_id=objects[source]["id"],
            target_object_type_id=objects[target]["id"], cardinality=cardinality,
            description=description, status="active",
        ))


def _ensure_mappings(ontology_id: str, objects: dict[str, dict[str, Any]]) -> int:
    existing = {item["code"] for item in list_resources(ontology_id, "data-mappings")}
    created = 0
    sequence = 0

    def create_mapping(code: str, name: str, payload: dict[str, Any], category: str) -> None:
        nonlocal created
        if code in existing:
            return
        save_resource(ontology_id, "data-mappings", EnterpriseResourceBase(
            code=code, name=name, category=category, status="active",
            description="物理表字段到本体对象属性的直连映射（原型模拟数据）。",
            payload=payload,
        ))
        existing.add(code)
        created += 1

    for spec in OBJECTS:
        sequence += 1
        key_column = next((prop["column"] for prop in spec["props"] if prop["pk"]), None)
        for prop in spec["props"]:
            if not prop["mapped"] or not prop["column"]:
                continue
            code = f"MAP-DIR-{sequence:03d}-{prop['key'].upper()[:18]}"
            if len(code) > 64:
                code = code[:64]
            create_mapping(code, f"{spec['display_name']} · {prop['name']}", {
                "mapping_type": "property", "mapping_type_display": "属性映射",
                "binding_mode": "direct", "source_code": spec["source"], "source_kind": "table",
                "source_table": spec["table"], "source_field": prop["column"],
                "source_key": key_column, "target_key": "",
                "target_object_type": spec["name"], "target_property": prop["key"],
                "target_relation": "", "map_way": "enum_map" if prop["type"] == "enum" else ("unit" if prop["type"] == "decimal" else "direct"),
                "transform_rule": prop["transform"] or ("-" if prop["type"] != "enum" else "按本体枚举值做标准映射"),
                "quality_rule": prop["quality"] or ("非空" if prop["required"] else ""),
                "update_method": prop["update"], "owner": MAPPING_OWNER, "design_status": "已确认",
            }, "属性映射")

    for spec in EXTRA_MAPPINGS:
        sequence += 1
        for prop_key, column, map_way, quality in spec["props"]:
            code = f"MAP-DIR-{sequence:03d}-{prop_key.upper()[:18]}"
            if len(code) > 64:
                code = code[:64]
            display = next((item["display_name"] for item in objects.values() if item["name"] == spec["object"]), spec["object"])
            create_mapping(code, f"{display} · {prop_key}", {
                "mapping_type": "property", "mapping_type_display": "属性映射",
                "binding_mode": "direct", "source_code": spec["source"], "source_kind": "table",
                "source_table": spec["table"], "source_field": column,
                "source_key": spec["key"], "target_key": "",
                "target_object_type": spec["object"], "target_property": prop_key,
                "target_relation": "", "map_way": map_way,
                "transform_rule": "-" if map_way == "direct" else "按本体枚举值做标准映射",
                "quality_rule": quality, "update_method": "batch",
                "owner": MAPPING_OWNER, "design_status": "已确认",
            }, "属性映射")

    for code, name, source_code, table, source_field, source_key, relation, _cardinality in RELATION_MAPPINGS:
        create_mapping(code, name, {
            "mapping_type": "relation", "mapping_type_display": "关系映射",
            "binding_mode": "direct", "source_code": source_code, "source_kind": "table",
            "source_table": table, "source_field": source_field, "source_key": source_key,
            "target_key": "", "target_object_type": "", "target_property": "",
            "target_relation": relation, "map_way": "link", "transform_rule": "-",
            "quality_rule": "两端对象均存在", "update_method": "event",
            "owner": MAPPING_OWNER, "design_status": "已确认",
        }, "关系映射")

    return created


def _seal_seed_changes(ontology_id: str) -> None:
    """Keep the built-in mapping demo out of the user's pending review queue."""
    conn = repo.get_conn()
    conn.execute(
        """UPDATE change_log SET pending=0
           WHERE ontology_id=? AND actor='system-bootstrap'
             AND component_type IN ('object_type','link_type','business_domain','subject_domain','data_source','data_mapping')""",
        (ontology_id,),
    )
    conn.commit()
    conn.close()


INSTANCE_SAMPLES = [
    ("PurchaseOrder", "PO-2026-0101", "2026年度办公用品采购订单", {"order_id": "PO-2026-0101", "order_no": "PO-2026-0101", "status": "已完成", "amount": 128000}, "有效", "synced", "passed", "SRC-PO"),
    ("PurchaseOrder", "PO-2026-0102", "服务器扩容采购订单", {"order_id": "PO-2026-0102", "order_no": "PO-2026-0102", "status": "履约中", "amount": 486000}, "有效", "synced", "passed", "SRC-PO"),
    ("PurchaseOrder", "PO-2026-0103", "产线备件采购订单", {"order_id": "PO-2026-0103", "order_no": "PO-2026-0103", "status": "已下达", "amount": 92000}, "有效", "synced", "passed", "SRC-PO"),
    ("PurchaseOrder", "PO-2026-0104", "园区安防改造采购订单", {"order_id": "PO-2026-0104", "order_no": "PO-2026-0104", "status": "草拟", "amount": 350000}, "有效", "pending", "unknown", "SRC-PO"),
    ("PurchaseOrder", "PO-2026-0105", "设备维保服务采购订单", {"order_id": "PO-2026-0105", "order_no": "PO-2026-0105", "status": "已完成", "amount": 260000}, "有效", "synced", "passed", "SRC-PO"),
    ("PurchaseOrder", "PO-2026-0106", "实验室耗材采购订单", {"order_id": "PO-2026-0106", "order_no": "PO-2026-0106", "status": "已取消", "amount": 18000}, "历史", "synced", "warning", "SRC-PO"),

    ("PaymentRequest", "PAY-2026-0091", "服务器扩容合同进度款", {"payment_id": "PAY-2026-0091", "payment_no": "PAY-2026-0091", "payment_title": "服务器扩容合同进度款", "amount": 3000000, "status": "审查中", "payee_name": "华东供应链有限公司", "apply_date": "2026-10-18", "risk_level": "高", "review_result": "预算占用超限，待复核", "source_system": "finance.payment_request"}, "有效", "synced", "warning", "SRC-PAY"),
    ("PaymentRequest", "PAY-2026-0092", "服务器扩容尾款", {"payment_id": "PAY-2026-0092", "payment_no": "PAY-2026-0092", "payment_title": "服务器扩容尾款", "amount": 486000, "status": "待复核", "payee_name": "中科服务器有限公司", "apply_date": "2026-10-17", "risk_level": "中", "review_result": "合同与验收单已核对", "source_system": "finance.payment_request"}, "有效", "synced", "passed", "SRC-PAY"),
    ("PaymentRequest", "PAY-2026-0093", "办公用品采购付款", {"payment_id": "PAY-2026-0093", "payment_no": "PAY-2026-0093", "payment_title": "办公用品采购付款", "amount": 128000, "status": "已批准", "payee_name": "华东供应链有限公司", "apply_date": "2026-10-15", "risk_level": "低", "review_result": "预算充足，自动通过", "source_system": "finance.payment_request"}, "有效", "synced", "passed", "SRC-PAY"),
    ("PaymentRequest", "PAY-2026-0094", "产线备件采购付款", {"payment_id": "PAY-2026-0094", "payment_no": "PAY-2026-0094", "payment_title": "产线备件采购付款", "amount": 92000, "status": "已支付", "payee_name": "精工备件有限公司", "apply_date": "2026-10-12", "risk_level": "低", "review_result": "已支付并核销", "source_system": "finance.payment_request"}, "有效", "synced", "passed", "SRC-PAY"),
    ("PaymentRequest", "PAY-2026-0095", "园区安防改造预付款", {"payment_id": "PAY-2026-0095", "payment_no": "PAY-2026-0095", "payment_title": "园区安防改造预付款", "amount": 175000, "status": "草拟", "payee_name": "安盾安防科技有限公司", "apply_date": "2026-10-20", "risk_level": "中", "review_result": "", "source_system": "finance.payment_request"}, "有效", "pending", "unknown", "SRC-PAY"),
    ("PaymentRequest", "PAY-2026-0096", "设备维保服务费", {"payment_id": "PAY-2026-0096", "payment_no": "PAY-2026-0096", "payment_title": "设备维保服务费", "amount": 260000, "status": "已驳回", "payee_name": "绿源物业服务有限公司", "apply_date": "2026-10-11", "risk_level": "低", "review_result": "发票验真未通过", "source_system": "finance.payment_request"}, "有效", "synced", "warning", "SRC-PAY"),
    ("PaymentRequest", "PAY-2026-0097", "实验室耗材付款", {"payment_id": "PAY-2026-0097", "payment_no": "PAY-2026-0097", "payment_title": "实验室耗材付款", "amount": 18000, "status": "已支付", "payee_name": "博远实验用品有限公司", "apply_date": "2026-10-09", "risk_level": "低", "review_result": "已支付", "source_system": "finance.payment_request"}, "有效", "synced", "passed", "SRC-PAY"),
    ("PaymentRequest", "PAY-2026-0098", "运输服务费付款", {"payment_id": "PAY-2026-0098", "payment_no": "PAY-2026-0098", "payment_title": "运输服务费付款", "amount": 45000, "status": "待复核", "payee_name": "华东供应链有限公司", "apply_date": "2026-10-19", "risk_level": "高", "review_result": "收款方与合同主体不一致", "source_system": "finance.payment_request"}, "冻结", "failed", "failed", "SRC-PAY"),

    ("Contract", "CT-2026-001", "年度办公用品框架合同", {"contract_id": "CT-2026-001", "contract_no": "CT-2026-001", "contract_name": "年度办公用品框架合同", "amount": 500000, "paid_amount": 128000, "status": "履行中", "supplier_name": "华东供应链有限公司", "project_code": "PRJ-ADMIN-2026", "sign_date": "2026-01-08"}, "有效", "synced", "passed", "SRC-CONTRACT"),
    ("Contract", "CT-2026-002", "服务器扩容采购合同", {"contract_id": "CT-2026-002", "contract_no": "CT-2026-002", "contract_name": "服务器扩容采购合同", "amount": 486000, "paid_amount": 0, "status": "履行中", "supplier_name": "中科服务器有限公司", "project_code": "PRJ-IT-2026", "sign_date": "2026-09-20"}, "有效", "synced", "passed", "SRC-CONTRACT"),
    ("Contract", "CT-2026-003", "产线备件采购合同", {"contract_id": "CT-2026-003", "contract_no": "CT-2026-003", "contract_name": "产线备件采购合同", "amount": 200000, "paid_amount": 92000, "status": "履行中", "supplier_name": "精工备件有限公司", "project_code": "PRJ-MFG-2026", "sign_date": "2026-06-12"}, "有效", "synced", "passed", "SRC-CONTRACT"),
    ("Contract", "CT-2026-004", "园区安防改造合同", {"contract_id": "CT-2026-004", "contract_no": "CT-2026-004", "contract_name": "园区安防改造合同", "amount": 350000, "paid_amount": 175000, "status": "履行中", "supplier_name": "安盾安防科技有限公司", "project_code": "PRJ-SEC-2026", "sign_date": "2026-08-01"}, "有效", "synced", "passed", "SRC-CONTRACT"),
    ("Contract", "CT-2026-005", "设备维保服务合同", {"contract_id": "CT-2026-005", "contract_no": "CT-2026-005", "contract_name": "设备维保服务合同", "amount": 260000, "paid_amount": 260000, "status": "已完成", "supplier_name": "绿源物业服务有限公司", "project_code": "PRJ-OPS-2026", "sign_date": "2026-02-15"}, "有效", "synced", "passed", "SRC-CONTRACT"),
    ("Contract", "CT-2026-006", "实验室耗材采购合同", {"contract_id": "CT-2026-006", "contract_no": "CT-2026-006", "contract_name": "实验室耗材采购合同", "amount": 18000, "paid_amount": 18000, "status": "已完成", "supplier_name": "博远实验用品有限公司", "project_code": "PRJ-LAB-2026", "sign_date": "2026-03-05"}, "历史", "synced", "warning", "SRC-CONTRACT"),

    ("Supplier", "SUP-2026-001", "华东供应链有限公司", {"supplier_id": "SUP-2026-001", "supplier_name": "华东供应链有限公司", "rating": "战略"}, "有效", "synced", "passed", "SRC-SUPPLIER"),
    ("Supplier", "SUP-2026-002", "中科服务器有限公司", {"supplier_id": "SUP-2026-002", "supplier_name": "中科服务器有限公司", "rating": "优选"}, "有效", "synced", "passed", "SRC-SUPPLIER"),
    ("Supplier", "SUP-2026-003", "精工备件有限公司", {"supplier_id": "SUP-2026-003", "supplier_name": "精工备件有限公司", "rating": "合格"}, "有效", "synced", "passed", "SRC-SUPPLIER"),
    ("Supplier", "SUP-2026-004", "安盾安防科技有限公司", {"supplier_id": "SUP-2026-004", "supplier_name": "安盾安防科技有限公司", "rating": "优选"}, "有效", "synced", "passed", "SRC-SUPPLIER"),
    ("Supplier", "SUP-2026-005", "绿源物业服务有限公司", {"supplier_id": "SUP-2026-005", "supplier_name": "绿源物业服务有限公司", "rating": "观察"}, "有效", "synced", "warning", "SRC-SUPPLIER"),
    ("Supplier", "SUP-2026-006", "博远实验用品有限公司", {"supplier_id": "SUP-2026-006", "supplier_name": "博远实验用品有限公司", "rating": "合格"}, "有效", "synced", "passed", "SRC-SUPPLIER"),

    ("Invoice", "INV-2026-001", "办公用品增值税发票", {"invoice_id": "INV-2026-001", "invoice_no": "INV-2026-001", "amount": 128000, "tax_amount": 14725.66, "status": "已验真", "issuer": "华东供应链有限公司", "buyer": "乾知智能科技有限公司", "issue_date": "2026-10-10"}, "有效", "synced", "passed", "SRC-INVOICE"),
    ("Invoice", "INV-2026-002", "服务器采购增值税发票", {"invoice_id": "INV-2026-002", "invoice_no": "INV-2026-002", "amount": 486000, "tax_amount": 55911.50, "status": "已验真", "issuer": "中科服务器有限公司", "buyer": "乾知智能科技有限公司", "issue_date": "2026-10-16"}, "有效", "synced", "passed", "SRC-INVOICE"),
    ("Invoice", "INV-2026-003", "备件采购增值税发票", {"invoice_id": "INV-2026-003", "invoice_no": "INV-2026-003", "amount": 92000, "tax_amount": 10584.07, "status": "待验真", "issuer": "精工备件有限公司", "buyer": "乾知智能科技有限公司", "issue_date": "2026-10-13"}, "有效", "pending", "unknown", "SRC-INVOICE"),
    ("Invoice", "INV-2026-004", "安防改造增值税发票", {"invoice_id": "INV-2026-004", "invoice_no": "INV-2026-004", "amount": 350000, "tax_amount": 40265.49, "status": "异常", "issuer": "安盾安防科技有限公司", "buyer": "乾知智能科技有限公司", "issue_date": "2026-10-18"}, "有效", "failed", "failed", "SRC-INVOICE"),
    ("Invoice", "INV-2026-005", "维保服务增值税发票", {"invoice_id": "INV-2026-005", "invoice_no": "INV-2026-005", "amount": 260000, "tax_amount": 29911.50, "status": "已验真", "issuer": "绿源物业服务有限公司", "buyer": "乾知智能科技有限公司", "issue_date": "2026-10-11"}, "有效", "synced", "warning", "SRC-INVOICE"),
    ("Invoice", "INV-2026-006", "实验室耗材增值税发票", {"invoice_id": "INV-2026-006", "invoice_no": "INV-2026-006", "amount": 18000, "tax_amount": 2070.80, "status": "已作废", "issuer": "博远实验用品有限公司", "buyer": "乾知智能科技有限公司", "issue_date": "2026-10-09"}, "历史", "synced", "passed", "SRC-INVOICE"),

    ("PurchaseRequest", "PR-2026-001", "办公用品采购申请", {"request_id": "PR-2026-001", "request_no": "PR-2026-001", "request_name": "办公用品采购申请", "amount": 128000, "status": "已批准", "requester": "行政部 · 李敏", "request_date": "2026-10-08", "purchase_method": "询价"}, "有效", "synced", "passed", "SRC-PR"),
    ("PurchaseRequest", "PR-2026-002", "服务器扩容采购申请", {"request_id": "PR-2026-002", "request_no": "PR-2026-002", "request_name": "服务器扩容采购申请", "amount": 486000, "status": "审批中", "requester": "信息部 · 王磊", "request_date": "2026-10-12", "purchase_method": "公开招标"}, "有效", "synced", "passed", "SRC-PR"),
    ("PurchaseRequest", "PR-2026-003", "产线备件采购申请", {"request_id": "PR-2026-003", "request_no": "PR-2026-003", "request_name": "产线备件采购申请", "amount": 92000, "status": "已转订单", "requester": "生产部 · 赵强", "request_date": "2026-09-28", "purchase_method": "竞争性谈判"}, "有效", "synced", "passed", "SRC-PR"),
    ("PurchaseRequest", "PR-2026-004", "园区安防改造采购申请", {"request_id": "PR-2026-004", "request_no": "PR-2026-004", "request_name": "园区安防改造采购申请", "amount": 350000, "status": "草拟", "requester": "安保部 · 周宁", "request_date": "2026-10-19", "purchase_method": "邀请招标"}, "有效", "pending", "unknown", "SRC-PR"),
    ("PurchaseRequest", "PR-2026-005", "实验室耗材采购申请", {"request_id": "PR-2026-005", "request_no": "PR-2026-005", "request_name": "实验室耗材采购申请", "amount": 18000, "status": "已驳回", "requester": "研发部 · 陈晨", "request_date": "2026-10-07", "purchase_method": "单一来源"}, "历史", "synced", "warning", "SRC-PR"),
]


def _ensure_instance_samples(ontology_id: str, objects: dict[str, dict[str, Any]]) -> None:
    marker = "procurement-instance-samples-v1"
    conn = repo.get_conn()
    if conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (marker,)).fetchone():
        conn.close()
        return
    existing = {row["business_key"] for row in conn.execute("SELECT business_key FROM object_instances WHERE ontology_id=?", (ontology_id,)).fetchall()}
    conn.close()
    for object_name, business_key, title, properties, record_status, sync_status, quality_status, source_system in INSTANCE_SAMPLES:
        object_type = objects.get(object_name)
        if not object_type or business_key in existing:
            continue
        repo.save_object_instance(ontology_id, ObjectInstanceBase(
            object_type_id=object_type["id"], business_key=business_key, title=title,
            properties=properties, record_status=record_status, sync_status=sync_status,
            quality_status=quality_status, source_system=source_system, source_pk=business_key,
        ))
    conn = repo.get_conn()
    conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=? AND component_type='object_instance'", (ontology_id,))
    conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)", (marker, repo.now()))
    conn.commit(); conn.close()


INSTANCE_LINKS = [
    ("order_placed_with_supplier", "PO-2026-0101", "SUP-2026-001"),
    ("order_placed_with_supplier", "PO-2026-0102", "SUP-2026-002"),
    ("order_forms_contract", "PO-2026-0101", "CT-2026-001"),
    ("order_forms_contract", "PO-2026-0102", "CT-2026-002"),
    ("request_generates_order", "PR-2026-001", "PO-2026-0101"),
    ("request_generates_order", "PR-2026-002", "PO-2026-0102"),
    ("contract_signed_with_supplier", "CT-2026-001", "SUP-2026-001"),
    ("contract_signed_with_supplier", "CT-2026-002", "SUP-2026-002"),
    ("contract_receives_invoice", "CT-2026-001", "INV-2026-001"),
    ("contract_receives_invoice", "CT-2026-002", "INV-2026-002"),
    ("payment_based_on_contract", "PAY-2026-0091", "CT-2026-002"),
    ("payment_based_on_contract", "PAY-2026-0092", "CT-2026-002"),
    ("payment_based_on_contract", "PAY-2026-0093", "CT-2026-001"),
    ("payment_paid_to_supplier", "PAY-2026-0091", "SUP-2026-002"),
    ("payment_paid_to_supplier", "PAY-2026-0093", "SUP-2026-001"),
    ("payment_matches_invoice", "PAY-2026-0091", "INV-2026-002"),
    ("payment_matches_invoice", "PAY-2026-0093", "INV-2026-001"),
]


def _ensure_instance_links(ontology_id: str) -> None:
    marker = "procurement-instance-links-v1"
    conn = repo.get_conn()
    if conn.execute("SELECT 1 FROM prototype_migrations WHERE migration_key=?", (marker,)).fetchone():
        conn.close()
        return
    instances = {row["business_key"]: row["id"] for row in conn.execute("SELECT id,business_key FROM object_instances WHERE ontology_id=?", (ontology_id,)).fetchall()}
    conn.close()
    links = {item["name"]: item for item in repo.list_link_types(ontology_id)}
    for link_name, source_key, target_key in INSTANCE_LINKS:
        link = links.get(link_name)
        source, target = instances.get(source_key), instances.get(target_key)
        if not link or not source or not target:
            continue
        try:
            repo.save_link_instance(ontology_id, LinkInstanceBase(link_type_id=link["id"], source_instance_id=source, target_instance_id=target))
        except Exception:
            continue
    conn = repo.get_conn()
    conn.execute("UPDATE change_log SET pending=0 WHERE ontology_id=? AND component_type='link_instance'", (ontology_id,))
    conn.execute("INSERT INTO prototype_migrations (migration_key,applied_at) VALUES (?,?)", (marker, repo.now()))
    conn.commit(); conn.close()


def seed_procurement_mapping_demo() -> None:
    conn = repo.get_conn()
    ontology = conn.execute("SELECT id,name FROM ontologies WHERE namespace=?", (NAMESPACE,)).fetchone()
    conn.close()
    if not ontology:
        return
    oid = ontology["id"]
    domains = _ensure_domains(oid)
    subjects = _ensure_subjects(oid, domains)
    sources = _ensure_sources(oid)
    _ensure_snapshots(oid, sources)
    objects = _ensure_objects(oid, subjects, domains)
    _normalize_taxonomy(oid, domains, subjects)
    _ensure_links(oid, objects)
    _ensure_mappings(oid, objects)
    _ensure_instance_samples(oid, objects)
    _ensure_instance_links(oid)
    _seal_seed_changes(oid)
