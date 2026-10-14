"""生成本体对比 / 本体质检的设计说明与验收标准文档。"""
from pathlib import Path
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

BRANCH = Path('/Users/yuejun/work/project/ontology-studio-manual-branch')
ASSETS = BRANCH / 'docs' / 'prd-assets'
OUT = BRANCH / 'docs'
FONT = 'PingFang SC'

doc = Document()
normal = doc.styles['Normal']
normal.font.name = FONT
normal.font.size = Pt(10.5)
normal.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'), FONT)
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.25
for name in ('Heading 1', 'Heading 2', 'Heading 3', 'Title'):
    try:
        st = doc.styles[name]
    except KeyError:
        continue
    st.font.name = FONT
    st.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'), FONT)
    st.font.color.rgb = RGBColor(0x1F, 0x3A, 0x53)
for section in doc.sections:
    section.top_margin = section.bottom_margin = Inches(0.7)
    section.left_margin = section.right_margin = Inches(0.8)


def p(text, bold=False, italic=False, size=None):
    para = doc.add_paragraph()
    run = para.add_run(text)
    run.bold = bold
    run.italic = italic
    if size:
        run.font.size = Pt(size)
    return para


def bullets(items):
    for item in items:
        doc.add_paragraph(item, style='List Bullet')


def numbers(items):
    for item in items:
        doc.add_paragraph(item, style='List Number')


def table(header, rows, widths=None, style='Light Grid Accent 1'):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = style
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, text in enumerate(header):
        cell = t.rows[0].cells[i]
        cell.text = ''
        run = cell.paragraphs[0].add_run(text)
        run.bold = True
        run.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = ''
            run = cells[i].paragraphs[0].add_run(str(text))
            run.font.size = Pt(9.5)
            run.font.name = FONT
            run.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Inches(w)
    doc.add_paragraph()
    return t


def figure(filename, caption, width_in):
    path = ASSETS / filename
    if not path.exists():
        p(f'（缺少截图：{filename}）', italic=True)
        return
    doc.add_picture(str(path), width=Inches(width_in))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = cap.add_run(caption)
    run.italic = True
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0x6B, 0x7C, 0x8C)


# ===========================================================================
doc.add_heading('本体对比 与 本体质检 · 设计说明与验收标准', level=0)
p('本文说明两项能力的设计逻辑与验收口径：如何配对、如何判定、如何保证结论可信，以及做到什么程度算完成。', italic=True)
table(['项目', '内容'], [
    ['覆盖范围', '本体对比（跨本体结构差异）、本体质检（语义模型规则检查）'],
    ['所属模块', '本体中心 → 变更与发布'],
    ['实现位置', 'backend/governance_insights.py（核心）、backend/repository.py（校验规则）'],
    ['文档状态', '评审中'],
    ['更新日期', '2026-10-12'],
], widths=[1.3, 5.0])

# ---------------------------------------------------------------- 共同前提
doc.add_heading('一、共同设计前提', level=1)

doc.add_heading('1.1 产品前提：不再有“版本”概念', level=2)
p('本体建好之后要迭代，就整体复制一份出来，用本体名区分分支（如“管道运输运营本体_copy”）。因此：')
bullets([
    '对比的对象是「两个本体」，不是同一个本体的两个版本快照。',
    '发布快照机制不再作为对比的数据来源，对比直接读取本体的当前语义状态。',
    '这一前提直接决定了对比的配对算法——见 2.2。',
])

doc.add_heading('1.2 一条铁律：结论必须确定性可复现', level=2)
p('两项能力都由同一套原则约束：')
table(['原则', '含义', '落到实现'], [
    ['结论来自规则，不来自模型', '质检结论与差异清单必须由确定性规则产生，同样输入必然同样输出', '质检由校验规则计算；差异由字段值比较计算'],
    ['模型只能解释，不能改写', '语言模型只负责把已生成的结果讲清楚', '模型返回的解释不参与 result / counts / rows 的生成'],
    ['默认不开启模型', '涉及企业内部语义，外发必须显式授权', '默认走本地规则解读；仅在 ONTOLOGY_GOVERNANCE_AI_ENABLED=1 且配置密钥时才外发'],
    ['不推断未记录的内容', '没有证据就不给结论', '历史记录缺快照时明确说明“不推断未记录的旧值”'],
], widths=[1.5, 2.6, 2.2])

doc.add_heading('1.3 共用的底层能力', level=2)
table(['能力', '作用', '被谁使用'], [
    ['语义快照 snapshot', '按固定资源段读取一个本体的当前语义状态（不含实例数据）', '对比、质检、质检指纹'],
    ['稳定索引 index', '把资源按业务标识建索引，供配对与指纹计算', '对比、质检指纹'],
    ['字段口径 clean', '统一剔除内部字段与密钥字段，并按固定顺序序列化', '对比、质检指纹'],
], widths=[1.4, 3.4, 1.5])

# ---------------------------------------------------------------- 本体对比
doc.add_heading('二、本体对比', level=1)

doc.add_heading('2.1 目标与非目标', level=2)
table(['', '内容'], [
    ['目标', '把两个本体的语义结构差异完整、可核对地列出来，并支持逐资源左右对照'],
    ['目标', '复制出来的分支与原体对比时，结果应为 0 差异（这是配对算法正确性的判据）'],
    ['非目标', '不判定“哪个更好”，不做自动合并，不写回任何本体'],
    ['非目标', '不做依赖图分析，不推断运行期影响是否已经发生'],
], widths=[0.9, 5.4])

doc.add_heading('2.2 核心难题：副本的资源 ID 全都是新的', level=2)
p('整体复制本体时，所有资源都会获得新的 UUID，只有业务标识（name / code）被保留。'
  '如果按 ID 配对，副本里的每条资源都会被认为是“新增”，原体的每条被认为是“删除”。')
p('实测对比（以管道运输运营本体为例，70 个资源）：', bold=True)
table(['配对方式', '对比结果', '结论'], [
    ['按 UUID 配对（旧做法）', '62 条差异（31 新增 + 31 删除）', '把整本报成删掉重建，不可用'],
    ['按业务稳定标识配对（现设计）', '0 条差异', '正确识别为“完全一致”'],
], widths=[1.8, 2.6, 1.9])

doc.add_heading('2.3 设计逻辑', level=2)

p('（1）配对键：按资源类型选择稳定标识', bold=True)
table(['资源段', '配对键', '理由'], [
    ['业务域、主题域', 'code', '分类实体以编码为稳定引用'],
    ['对象类型、接口、关系类型、业务规则、动作类型', 'name', 'API 名称是运行时稳定引用'],
    ['8 类企业资源（数据源、治理资产、数据映射、规则与函数、系统能力、动作执行映射、权限策略、业务场景）', 'code', '资源编码创建后不可修改'],
], widths=[3.0, 0.9, 2.4])

p('（2）引用归一化：把 UUID 引用换成稳定标识', bold=True)
p('只配对资源本身还不够。资源之间的引用存的是 UUID，副本里这些 UUID 同样变了。'
  '若归一化，每条关系都会被判成“已修改”。因此比较前先把引用字段换成对方本体内部的稳定标识：')
table(['资源段', '引用字段', '归一化为'], [
    ['主题域', 'business_domain_id', '业务域的 code'],
    ['对象类型', 'subject_domain_id', '主题域的 code'],
    ['对象类型', 'interface_ids', '接口的 name 列表（排序后比较）'],
    ['关系类型', 'source_object_type_id / target_object_type_id', '对象类型的 name'],
    ['业务规则、动作类型', 'target_object_type_id', '对象类型的 name'],
    ['对象类型、接口的属性列表', 'properties[].shared_property_id', '置空（运行时引用，跨本体无意义）'],
], widths=[1.9, 2.5, 1.9])

p('（3）空值口径：None 与空字符串都视为“未设置”', bold=True)
p('副本经序列化会补出一些值为 null 的键（例如 template_id = null），而原体的原始 JSON 里可能根本没有这个键；'
  '同理，源数据里也可能显式存了空字符串。这两种情况语义相同，不应报成差异。'
  '因此比较前递归去掉值为 null 的键，并让空字符串与 null 等价。')
p('注意：这条口径只在跨本体对比里生效，不修改模型指纹算法，避免既有质检报告集体失效。', italic=True)

p('（4）比较范围：15 类资源，两类口径', bold=True)
table(['口径', '资源段'], [
    ['按字段白名单比较（8 类）', '业务域、主题域、对象类型、接口、关系类型、业务规则、动作类型、数据源'],
    ['按全部字段比较（7 类）', '业务场景、治理资产、数据映射、规则与函数、系统能力、动作执行映射、权限策略'],
    ['一律排除', 'id、ontology_id、创建/更新时间与操作人、状态与建模状态、各种计数字段、metadata 容器'],
    ['密钥保护', '字段名含 password / secret / api_key / access_token / private_key 的一律不参与比较与输出'],
], widths=[1.6, 4.7])

p('（5）差异分类与结果结构', bold=True)
p('逐资源比较后分为三类：新增（只在右侧）、删除（只在左侧）、修改（两侧都有且存在差异字段）。'
  '修改会列出具体差异字段，并给出左右两侧的原值供核对。结果结构：')
table(['字段', '说明'], [
    ['left / right', '两个本体的 id、名称、命名空间'],
    ['counts', 'added / modified / removed 三类计数'],
    ['rows[]', '每条差异：所属资源段、资源名、稳定标识、change 类型、changed_fields、左右原值'],
    ['reference_names', '左右两侧的 id → 名称映射，供前端把引用显示成可读名称'],
    ['method / note', '对比口径说明与人工确认提醒'],
], widths=[1.3, 5.0])

doc.add_heading('2.4 交互设计', level=2)
p('选择「基准本体 / 对比本体」两个本体 → 开始对比 → 差异列表（可按变化类型、资源段筛选与搜索）'
  '→ 右侧左右字段对照 → 对话追问差异含义。')
figure('D1-本体对比-整页.png', '图 1　本体对比：原体与复制出来的分支对比，结果为 0 差异', 6.4)

doc.add_heading('2.5 关键决策与理由', level=2)
table(['决策', '理由'], [
    ['用业务稳定标识而非 UUID 配对', '复制分支必然换 UUID；按 UUID 配对会把整本报成重建'],
    ['比较前归一化引用字段', '否则每条关系、每个对象都会因引用 UUID 变化而被判成“已修改”'],
    ['null 与空字符串等价', '两者都表示未设置，报成差异是噪声'],
    ['只读取当前状态，不依赖发布快照', '产品已去掉版本概念，对比不应被“必须发布过”限制'],
    ['对比只读，不提供自动合并', '跨本体合并涉及人工判断，自动化风险高于收益'],
], widths=[2.0, 4.3])

doc.add_heading('2.6 边界与已知限制', level=2)
bullets([
    '实例数据不参与对比（对比的是语义定义，不是数据内容）。',
    '不做依赖图分析，删除项的下游影响需人工核对。',
    '两个本体的资源名相同但语义不同（例如都叫 Contract 但业务含义不同）时会被配对为同一资源，需要人工判断。',
    '若某类资源缺少稳定标识（既无 name 也无 code），该资源会被跳过而不是误配。',
])

doc.add_heading('2.7 验收标准', level=2)
table(['编号', '验收项', '判定方式'], [
    ['C1', '复制本体后与原体对比，差异总数为 0', '自动化：复制内置管网本体后调用对比接口，断言 total == 0'],
    ['C2', '改一个字段后能定位到该资源与该字段', '手工/自动化：修改对象描述，断言 rows 中出现该资源且 changed_fields 含 description'],
    ['C3', '新增与删除能正确分类', '自动化：各增删一个对象类型，断言计数分别 +1'],
    ['C4', '引用变化不产生假差异', '自动化：仅因复制导致的 UUID 变化不得出现在 rows 中'],
    ['C5', 'null 与空字符串的差异不出现', '自动化：把某字段在两侧分别设为 null 与空串，断言不产生差异'],
    ['C6', '密钥字段不进入结果', '自动化：数据源含密码相关字段时，断言结果中不含该字段与取值'],
    ['C7', '选中两个相同本体时被拒绝', '自动化：传相同 id，断言返回参数错误'],
    ['C8', '对话解读与差异表一致', '手工：追问“哪些被删除”，回答中的数量与名称必须与 counts / rows 一致'],
], widths=[0.6, 3.0, 2.7])

# ---------------------------------------------------------------- 质检
doc.add_heading('三、本体质检', level=1)

doc.add_heading('3.1 目标与非目标', level=2)
table(['', '内容'], [
    ['目标', '用确定性规则检查本体的语义结构，产出可追溯、可分段执行的质检报告'],
    ['目标', '报告能区分“是否仍然对应当前模型”（过期判定），避免拿旧结论当现状'],
    ['非目标', '不检查实例数据内容，不检查生产接口运行结果'],
    ['非目标', '不由模型打分或给出主观评分'],
], widths=[0.9, 5.4])

doc.add_heading('3.2 设计逻辑', level=2)

p('（1）两级结构：检查项 + 问题', bold=True)
p('报告由两部分组成，二者一一对应：')
table(['结构', '含', '用途'], [
    ['检查项 checks', 'key（维度标识）、name（检查项名称）、passed（是否通过）', '给出“查了哪几项、过没过”的总体视图'],
    ['问题 issues', 'severity（error / warning）、resource_type、resource_id、message', '给出“哪条资源、错在哪”的可操作清单'],
], widths=[1.3, 3.3, 1.7])

p('（2）九个检查维度', bold=True)
table(['维度 key', '检查项', '判定要点'], [
    ['object_type', '对象主键与标题属性', '对象有且只有一个主键；标题属性必须来自已定义属性'],
    ['link_type', '关系端点与状态一致', '两端对象存在；关系为 Active 时端点对象也应处于可用状态'],
    ['action', '动作目标与参数', '动作指向有效对象；改写类动作应定义参数'],
    ['business_rule', '业务规则目标与表达式', '规则指向有效对象且必须有表达式'],
    ['interface', '接口实现完整', '对象正确实现所选接口的属性契约（属性存在且类型一致）'],
    ['classification', '业务域与主题域分类', '对象类型必须归入主题域'],
    ['ontology', '模型至少包含一个业务对象类型', '本体不能为空'],
    ['data_mapping', '数据映射引用完整', '映射引用的治理资产、对象与属性必须存在'],
    ['logic_definition', '规则与函数依赖完整', '规则与函数的引用与实现配置必须完整'],
], widths=[1.1, 2.0, 3.2])

p('（3）范围裁剪', bold=True)
p('质检支持只检查其中若干维度：传入 scope 后，检查项与问题会被同时裁剪到所选维度，'
  '避免出现“报告里写着某项未通过，但那一项其实没查”的矛盾。不传 scope 即全部维度。')

p('（4）结论口径', bold=True)
table(['条件', '结论'], [
    ['存在 error 级问题', '待修复'],
    ['无 error 但有 warning', '通过（含警告）'],
    ['无 error 也无 warning', '通过'],
], widths=[2.4, 3.9])
p('摘要统一为「N/M 项检查通过；X 项错误，Y 项警告」，数字均来自本次范围内的问题集合。')

p('（5）模型指纹与过期判定', bold=True)
p('这是让报告可信的关键设计：')
numbers([
    '把本体的语义索引（资源 + 参与比较的字段）按固定顺序序列化后取 SHA-256，得到模型指纹。',
    '每次质检把指纹与报告一起存下来。',
    '读取报告时重新计算当前指纹，与存档指纹不一致即标记为「过期」。',
    '过期的报告在界面上明确提示“本体已发生变化，此报告不是当前状态的结论”，并且不参与放行判断。',
])
p('指纹只覆盖语义字段，因此改一个描述文字也会让报告过期——这是刻意的：'
  '报告必须能被追溯到它检查的那个确切状态。')

p('（6）报告持久化', bold=True)
p('每次质检生成一条不可变的报告记录（本体、检查范围、模型指纹、结论、完整报告 JSON、执行人、执行时间）。'
  '历史报告保留，可切换查看；报告不因模型后续变化而被改写。')

p('（7）与发布流程的关系', bold=True)
p('质检报告是发布前的证据之一：只有结论为“通过”且指纹仍然匹配当前模型的报告，才被视为有效证据；'
  '模型一旦再被修改，原报告立即失效，需要重新质检。')

doc.add_heading('3.3 交互设计', level=2)
p('页面主体是对话，而不是报告：')
bullets([
    '对话区顶部是范围引导（“全部质检” + 九个维度），可多选；不选即全部维度。',
    '确认范围后说「开始质检」，报告从右侧滑出，可收起、可重新打开。',
    '报告包含结论、检查范围、检查项列表与问题清单，并可下载为独立文件。',
    '没出报告时，对话先引导确认范围；已有报告时，可以直接围绕报告追问。',
    '对话中的解读标注来源（规则解读 / AI 解读），用户能分辨结论从哪来。',
])
figure('E1-本体质检-整页.png', '图 2　对话式质检：范围引导 + 报告从右侧滑出', 6.4)

doc.add_heading('3.4 关键决策与理由', level=2)
table(['决策', '理由'], [
    ['用确定性规则而不是模型打分', '质检结论要能作为发布证据，必须可复现、可解释、可审计'],
    ['对话优先而不是报告优先', '用户先要确认“查什么”，报告是结果而不是入口'],
    ['支持按维度分段检查', '全量检查在大型本体上噪声大，分段检查便于聚焦'],
    ['指纹绑定报告与模型状态', '避免拿旧结论当现状，这是报告可信的前提'],
    ['范围同时裁剪检查项与问题', '否则报告的结论与检查范围自相矛盾'],
], widths=[2.0, 4.3])

doc.add_heading('3.5 边界与已知限制', level=2)
bullets([
    '只检查语义定义，不检查实例数据内容与生产接口运行结果；报告中会明确写出这一点。',
    '检查项依赖规则引擎已覆盖的校验规则；新增校验规则需要同步登记为质检维度。',
    '模型解读默认关闭；开启后会把报告证据发送到配置的模型服务，需事先获得授权。',
    '质检是只读检查，不自动修复问题，只给出问题位置与修复方向。',
])

doc.add_heading('3.6 验收标准', level=2)
table(['编号', '验收项', '判定方式'], [
    ['Q1', '全部维度质检产出九项检查', '自动化：不传 scope 运行，断言 checks 覆盖九个维度'],
    ['Q2', '按维度裁剪同时作用于检查项与问题', '自动化：只传两个维度，断言 checks 与 issues 均被裁剪且数量一致'],
    ['Q3', '结论口径正确', '自动化：构造仅含警告的模型，断言结论为“通过（含警告）”；构造错误则断言“待修复”'],
    ['Q4', '摘要数字与问题集合一致', '自动化：断言 summary 中的错误/警告数与 issues 统计相同'],
    ['Q5', '报告在模型变化后被标记为过期', '自动化：质检后修改任一语义字段，读取报告断言 stale 为真'],
    ['Q6', '过期报告不参与放行判断', '自动化：构造过期报告，断言不返回可用结论'],
    ['Q7', '报告可持久化与回看', '自动化：连续质检两次，断言历史均保留且各自指纹不同'],
    ['Q8', '对话解读不改变报告结论', '手工：追问多个问题，断言报告中的 result 与问题清单不变'],
    ['Q9', '范围引导的维度与后端一致', '自动化：断言引导列表与后端维度定义一一对应'],
], widths=[0.6, 3.0, 2.7])

# ---------------------------------------------------------------- 汇总
doc.add_heading('四、验收执行建议', level=1)
table(['层次', '内容', '建议方式'], [
    ['算法层', '稳定键配对、引用归一化、空值口径、差异分类', '后端单元测试，构造两侧快照直接比对'],
    ['契约层', '接口入参出参、结论口径、范围裁剪、指纹与过期', '接口测试，覆盖本文 C1–C8、Q1–Q9'],
    ['交互层', '选本体对比、范围引导、报告侧滑、追问', '实机回归，建议逐条走查验收表'],
    ['数据层', '复制本体后零差异、密钥不外泄', '针对内置管网本体跑一次端到端'],
], widths=[1.1, 3.4, 1.8])

p('说明：本文的验收项均设计为可判定，不依赖主观评价；“判定方式”一列即为可执行的检查手段。', italic=True)

doc.save(OUT / '设计说明-本体对比与本体质检.docx')
print('已生成 设计说明-本体对比与本体质检.docx')
