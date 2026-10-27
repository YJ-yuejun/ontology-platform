"""生成《本体治理方案》的结构示意图（PNG）。

输出到 docs/diagram-assets/，供 DOCX 版本内嵌；Markdown 版本仍保留等宽文字图。
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent
OUT = BASE / "diagram-assets"
OUT.mkdir(exist_ok=True)

FONT_PATH = "/System/Library/Fonts/Hiragino Sans GB.ttc"
W = 1800

INK = (31, 58, 83)
ACCENT = (31, 111, 139)
BODY = (51, 71, 91)
MUTED = (122, 136, 148)
EDGE = (188, 201, 212)
FILL = (247, 249, 251)
SRC = (237, 242, 246)
PILL = (234, 241, 246)

_cache = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(FONT_PATH, size, index=2 if bold else 0)
    return _cache[key]


def canvas(height):
    img = Image.new("RGB", (W, height), "white")
    return img, ImageDraw.Draw(img)


def box(draw, xy, *, fill=FILL, edge=EDGE, width=3, radius=14, accent=None):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=edge, width=width)
    if accent:
        x0, y0, x1, y1 = xy
        draw.rounded_rectangle(
            (x0, y0 + 10, x0 + 12, y1 - 10), radius=6, fill=accent
        )


def text(draw, xy, s, *, size=36, bold=False, color=BODY, anchor="la"):
    draw.text(xy, s, font=font(size, bold), fill=color, anchor=anchor)


def varrow(draw, x, y0, y1, label=None, *, color=ACCENT, up=False):
    if up:
        draw.line([(x, y1), (x, y0 + 16)], fill=color, width=4)
        draw.polygon([(x - 12, y0 + 18), (x + 12, y0 + 18), (x, y0)], fill=color)
    else:
        draw.line([(x, y0), (x, y1 - 16)], fill=color, width=4)
        draw.polygon([(x - 12, y1 - 18), (x + 12, y1 - 18), (x, y1)], fill=color)
    if label:
        draw.text(((x + 26), (y0 + y1) // 2), label, font=font(32), fill=MUTED, anchor="lm")


def save(img, name):
    path = OUT / name
    img.save(path, "PNG")
    print("saved", path)


# ---------- 图 1：语义层三层架构 ----------

img, d = canvas(1000)
d.rounded_rectangle((160, 24, 1640, 116), radius=10, fill=SRC, outline=EDGE, width=3)
text(d, (900, 70), "业务制度 / 合同模板 / 报表口径 / DDL / 接口文档", size=32, color=MUTED, anchor="mm")
varrow(d, 900, 116, 180, "抽取 · 对齐 · 提案")

layers3 = [
    ("语义层（本体）", "对象 · 属性 · 关系 · 接口 · 字典 · 规则 · Action · 场景", "标准 = 定义 + 契约"),
    ("物理层（数据源）", "连接 · 表 · 字段 · 主键 · 实体解析 · 同步", "标准 = 映射 + 血缘"),
    ("运行层（消费）", "实例 · 质检 · 版本 · 场景 · 报表 · 应用 · 智能体", "标准 = 验证 + 服务"),
]
y = 180
for idx, (title, line, accent_text) in enumerate(layers3):
    box(d, (120, y, 1680, y + 220), accent=ACCENT)
    text(d, (190, y + 38), title, size=44, bold=True, color=INK)
    text(d, (190, y + 110), line, size=34, color=BODY)
    text(d, (190, y + 168), accent_text, size=36, bold=True, color=ACCENT)
    if idx < 2:
        label = ["映射（落标）", "实例化 + 质检"][idx]
        varrow(d, 900, y + 220, y + 284, label)
    y += 284
save(img, "arch-three-layers.png")


# ---------- 图 2：四层治理架构（自下而上） ----------

img, d = canvas(1250)
layers4 = [
    ("消费层", "报表 · 指标 · 应用接口 · 业务场景 · 治理智能体", "向上服务"),
    ("语义层（本体）", "对象 · 属性 · 关系 · 接口 · 字典 · 规则 · Action", "唯一语义基线"),
    ("物理层（数据源）", "数据源 · 表 · 字段 · 主键 · 关系映射 · 转换规则", "向下落标"),
    ("源系统", "广告投放 · 合同 · 播出 · 财务 · 预算 · 成本 · 人力", "数据来源"),
]
y = 30
for idx, (title, line, tag) in enumerate(layers4):
    box(d, (140, y, 1660, y + 230), accent=ACCENT if idx in (1, 2) else None)
    text(d, (210, y + 40), title, size=44, bold=True, color=INK)
    text(d, (210, y + 118), line, size=34, color=BODY)
    text(d, (1620, y + 40), tag, size=30, color=MUTED, anchor="ra")
    if idx < 3:
        arrow_label = ["服务与消费", "语义查询", "落标与同步"][idx]
        varrow(d, 900, y + 230, y + 326, arrow_label, up=True)
    y += 326
save(img, "arch-four-layers.png")


# ---------- 图 3：治理智能体架构 ----------

img, d = canvas(1400)
blocks = [
    (30, 200, "会话与任务编排", ["目标绑定 · 资源范围 · 证据集 · 权限 · 修订号"], None),
    (310, 230, "治理智能体（五种工作模式）",
     ["建模副驾 · 落标副驾 · 质检官 · 口径管家 · 变更分析师"], "提案与解释，不改事实"),
    (620, 260, "工具层（默认只读）",
     ["本体检索 · 对象读取 · 关系穿透 · 映射查询",
      "规则与质检 · 版本差异 · 证据检索 · 影响分析"], "写操作走提案与 Action 网关"),
    (960, 230, "本体工作副本 ＋ 证据库",
     ["制度文件 · 合同模板 · DDL · 报表 SQL · 接口文档"], "证据带出处，提案可回放"),
]
centers = []
for top, height, title, lines, accent_text in blocks:
    box(d, (120, top, 1680, top + height), accent=ACCENT)
    text(d, (190, top + 38), title, size=44, bold=True, color=INK)
    off = top + 112
    for line in lines:
        text(d, (190, off), line, size=32, color=BODY)
        off += 46
    if accent_text:
        text(d, (1620, top + 40), accent_text, size=28, color=MUTED, anchor="ra")
    centers.append(top + height)

for i in range(len(centers) - 1):
    varrow(d, 900, centers[i], blocks[i + 1][0], None)

# 底部人工卡点链条
varrow(d, 900, 1190, 1250, "四道关卡")
pill_y = 1250
pill_labels = ["人工卡点", "提案入库", "质检", "评审", "发布快照"]
usable = 1560
gap = 40
pill_w = (usable - gap * (len(pill_labels) - 1)) / len(pill_labels)
x = 120
for idx, label in enumerate(pill_labels):
    d.rounded_rectangle((x, pill_y, x + pill_w, pill_y + 80), radius=40, fill=PILL, outline=ACCENT, width=3)
    text(d, (x + pill_w / 2, pill_y + 40), label, size=32, bold=True, color=INK, anchor="mm")
    if idx < len(pill_labels) - 1:
        ax = x + pill_w + 6
        d.line([(ax, pill_y + 40), (ax + gap - 14, pill_y + 40)], fill=ACCENT, width=4)
        d.polygon([(ax + gap - 10, pill_y + 31), (ax + gap - 10, pill_y + 49), (ax + gap - 3, pill_y + 40)], fill=ACCENT)
    x += pill_w + gap

save(img, "agent-architecture.png")


# ---------- 图 4：工作流智能体的四层结构 ----------

img, d = canvas(1450)
layers_wf = [
    (30, 200, "接入层", ["会话入口 · 任务中心 · 定时触发 · 事件触发"], None),
    (325, 280, "编排层",
     ["WF-01 口径问答 · WF-02 质检整改 · WF-03 建模提案",
      "WF-04 落标映射 · WF-05 变更影响",
      "公共子流程：证据检索 · 权限校验 · 提案写入"], None),
    (700, 280, "技能层",
     ["只读：对象查询 · 属性检索 · 关系穿透 · 映射建议 · 质检 · 差异 · 影响分析",
      "受控写：提案创建 · 提案提交 · 工单创建 · 映射写入"], None),
    (1075, 220, "本体与证据库",
     ["本体工作副本 · 发布快照 · 映射台账 · 证据库 · 实例"], None),
]
for top, height, title, lines, _ in layers_wf:
    box(d, (120, top, 1680, top + height), accent=ACCENT)
    text(d, (190, top + 38), title, size=42, bold=True, color=INK)
    off = top + 116
    for line in lines:
        text(d, (190, off), line, size=30, color=BODY)
        off += 46

for y0, y1, label in [(230, 325, "任务下发"), (605, 700, "节点调用"), (980, 1075, "受控读写")]:
    varrow(d, 900, y0, y1, label)

d.rounded_rectangle((120, 1340, 1680, 1410), radius=35, fill=PILL, outline=EDGE, width=3)
text(d, (900, 1375), "横切能力：权限策略 · 版本与快照 · 审计与回放 · 评测集", size=30, color=MUTED, anchor="mm")

save(img, "workflow-layers.png")
