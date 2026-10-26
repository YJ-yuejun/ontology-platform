# Palantir 实例显示调研与重构方案

> 日期：2026-10-23  
> 结论：上一版把“实例数据”做成了**单对象类型 + 通用表格 + 详情抽屉**。这只对应 Palantir 的 **Results View（结果表）** 这一层，不能代表 Palantir 的实例显示模型。  
> Palantir 的核心是 **Object Explorer（对象探索）+ Object View（对象视图）**，表格只是探索过程中的一个结果视图。
>
> **落地状态（2026-10-23）**：Phase 1 已在原型落地，见 [对象探索与对象视图 PRD](prd/08-PRD-对象探索与对象视图.md)；实现为 `frontend/src/pages/ObjectExplorer.jsx`。

## 一、Palantir 到底怎么显示“实例”

Palantir 不把对象实例当成数据库行来展示，而是把每个实例当作 **Object（对象）**，围绕对象做三件事：

```text
找对象：Object Explorer 首页 / 全局搜索 / 对象类型分组
看一组对象：Exploration 探索 → charts 筛选 → Results 结果表
看一个对象：Object View 对象视图 → 显著属性 / 关联对象 / 应用与操作
```

### 1. Object Explorer 首页

- 全局搜索：对象、对象类型、已保存探索、对象应用。
- 对象类型分组：按配置分组展示所有可访问对象类型；支持收藏。
- 对象类型预览：查看描述、属性、关联对象类型。
- 已保存的 Explorations / Lists 置顶。
- 可从对象类型卡片直接开始探索。

来源：[Object Explorer Overview](https://www.palantir.com/docs/foundry/object-explorer/overview)、[Getting started](https://www.palantir.com/docs/foundry/object-explorer/getting-started)

### 2. Exploration 探索

选中对象类型后，进入的是 Exploration，不是直接一张表：

- 搜索栏是筛选中心：属性筛选、关键词、AND/OR 嵌套、关联对象属性筛选、Has Link。
- 默认图表：每个 prominent property 一个 chart。
- 图表类型：Listogram、Pie、Histogram、Grid Plot、Single Statistic 等。
- 点图表值直接过滤对象集。
- 可 Pivot 到关联对象类型，继续探索。
- 可 Compare 两个 object set（当前集合 vs 已保存探索/全量/动态筛选）。
- 可保存 Exploration；支持私有/公开、搜索、复用。
- 可对当前对象集执行 Actions、Open In、Export。

来源：[Filter results](https://www.palantir.com/docs/foundry/object-explorer/filter-results)、[Explore with charts](https://www.palantir.com/docs/foundry/object-explorer/explore-charts)、[Pivot to linked objects](https://www.palantir.com/docs/foundry/object-explorer/pivot-linked)、[Compare object sets](https://www.palantir.com/docs/foundry/object-explorer/compare-object-sets)、[Save explorations](https://www.palantir.com/docs/foundry/object-explorer/save-explorations)、[Apply Actions](https://www.palantir.com/docs/foundry/object-explorer/apply-actions)

### 3. Results View 结果表

这是上一版只做到的那一层，但 Palantir 的结果表有一整套桌面数据工具能力：

- 多列排序：先选的列优先级低，后选的列优先级高；显示排序序号，可 Clear All Sorts。
- 列配置：拖拽改列顺序、冻结左侧 X 列、拖拽调整列宽、隐藏列、批量配置列、搜索列。
- 文本换行：可选择“不截断文本”，长文本自动换行。
- 滚动加载：向下滚动加载更多对象。
- 行选择与预览：
  - 点击 Title 列：在新标签页打开该对象的 Object View；
  - 点击复选框/其他列：选中对象，右侧打开 Selection Preview（对象视图的面板形态）；
  - 多选时，最多前 20 个对象可以切换预览；
  - 支持 Compare objects 对比两个对象。
- 时间序列属性：表格里显示最近值 + sparkline。
- Inline edit：配置了 inline edit action 的属性，hover 出现铅笔，直接在单元格里编辑并提交。

来源：[View results](https://www.palantir.com/docs/foundry/object-explorer/view-results)

### 4. Object View 对象视图

对象视图不是“属性抽屉”，而是可配置的对象主页：

- **Standard Object View**：对象类型创建后自动生成。
  - Prominent properties 置顶，用卡片、图表、地图、媒体查看器显示；
  - 其余 normal properties 用表格显示；
  - hidden properties 不显示；
  - Linked objects 组件：按 link type 分组、内联预览、打开子集、在侧栏预览关联对象。
- **Configured Object View**：用 Workshop 配置，可完全自定义。
  - Full Object View：完整的对象主页；
  - Panel Object View：用于其他应用嵌入的精简视图；
  - Tabs：每个 tab 是一个 Workshop module，可条件可见、跨 tab 过滤；
  - Applications sidebar：嵌入 Workshop/Quiver/Slate/Action/外部链接；
  - 支持评论、操作、权限。

来源：[Object Views Overview](https://www.palantir.com/docs/foundry/object-views/overview)、[Standard Object Views](https://www.palantir.com/docs/foundry/object-views/standard-object-views)、[Properties and Links](https://www.palantir.com/docs/foundry/object-views/widgets-properties-links)、[Configure tabs](https://www.palantir.com/docs/foundry/object-views/config-tabs)、[Applications sidebar](https://www.palantir.com/docs/foundry/object-views/config-app-sidebar)

## 二、上一版的问题

| Palantir | 上一版 | 问题 |
|---|---|---|
| Object Explorer 首页 / 对象类型分组 | 直接进入对象类型表格 | 缺少“发现对象类型”的入口 |
| Exploration / object set | 没有对象集概念 | 筛选只是表格过滤，不能保存/比较/复用 |
| 图表筛选 | 无 | 不能按分布/枚举/数值区间探索 |
| 关联对象筛选与 Pivot | 无 | 只能看当前类型，不能沿关系换主对象 |
| Results View 表格 | 做成了整页 | 表格本身可用，但被当成实例显示的全部 |
| 标题打开 Object View | 行点击打开抽屉 | 对象视图被压缩成属性列表 |
| Standard/Configured Object View | 通用抽屉 | 没有 prominent/normal/hidden 语义，没有 tabs/apps |
| 行选择预览 / 多选对比 | 单行抽屉 | 没有 selection preview、对象对比、批量操作 |
| Actions / 批量 / Inline edit | 只有新建/编辑/删除 | 没有对象集级操作、内联编辑 |
| Saved exploration / list | 无 | 不能保存和分享探索视图 |
| 权限 / 隐藏属性 | 无 | 所有属性都可能暴露给所有人 |

结论：**表格不是错的，错在把 Results View 当成了整个实例页。**

## 三、建议的正确信息架构

```text
对象探索（替换“实例数据”）
├─ 探索首页
│  ├─ 全局搜索
│  ├─ 对象类型分组 / 收藏
│  ├─ 最近探索 / 已保存视图
│  └─ 对象类型预览
├─ 探索工作台（选中对象类型后）
│  ├─ 对象集栏：当前筛选摘要 / 保存 / 比较 / 操作 / 导出
│  ├─ 图表筛选区（Listogram / Histogram / Single Stat）
│  ├─ Results 表格（列配置、冻结、排序、选择）
│  └─ 右侧 Selection Preview（对象视图 panel 形态）
└─ 对象视图（点击标题进入）
   ├─ 标题栏 + 对象类型 + Actions
   ├─ Prominent 属性卡片（状态/金额/风险/时间序列/地图/媒体）
   ├─ Normal 属性分组 + 长文本 + 关键词
   ├─ Linked Objects（按 link type 分组）
   ├─ Tabs / Applications Sidebar
   └─ 活动、评论、审计
```

### 与现有原型的映射

| 现有页面/组件 | 新定位 |
|---|---|
| 对象类型栏 | 保留为探索首页的“对象类型分组”或探索内的切换器 |
| 动态表格 | 降级为 **Results View**，保留列/排序/筛选/选择 |
| 详情抽屉 | 改为 **Selection Preview**，并新增可打开的完整 Object View |
| 新建/编辑弹窗 | 保留，后续接入 Action 表单 |
| 列设置 | 扩展为“列配置”：顺序/宽度/冻结/隐藏/默认布局 |
| CSV 导出 | 保留，后续支持 Excel / 复制对象 ID |
| 没有的 | charts、object set、pivot、compare、saved exploration、actions |

## 四、分阶段落地

### Phase 1：先纠正页面骨架

- 把“实例数据”改成“对象探索”（或“对象浏览器”）。
- 增加探索首页：对象类型分组、搜索、收藏、最近探索。
- 点击对象类型进入 Exploration：
  - 搜索/筛选对象集；
  - Results 表格；
  - 右侧 Selection Preview；
  - 点击标题打开完整 Object View。
- Object View 先做 Standard 形态：
  - 显著属性卡片；
  - normal 属性表格；
  - linked objects 分组；
  - 操作按钮（编辑/删除/后续 Action）。
- 在对象属性上加 `prominent / normal / hidden` 显示级别。

### Phase 2：把 exploration 做完整

- 图表筛选：枚举 Listogram、数值 Histogram、Single Stat。
- 关联对象属性筛选、Has Link、Pivot。
- 对象集保存/复用。
- 两对象对比（Compare objects）。
- 对象集对比（Compare object sets）。
- 批量 Actions、导出 Excel、复制对象 ID。

### Phase 3：配置化对象视图

- Configured Full / Panel Object View。
- Tabs（Workshop 风格）与 Applications Sidebar。
- 权限、条件可见性、评论/审计。
- 列布局的全局默认与个人默认。

## 五、对当前原型的直接修改建议

不建议继续在当前页面上叠交互，建议按以下顺序改：

1. 保留现有动态表格，作为 **Results View**，不再把它当整页。
2. 新增对象探索首页与对象类型分组。
3. 新增完整 Object View 页面（先 Standard 形态）。
4. 行点击改成 **选中 + 右侧 Preview**；标题点击打开 Object View。
5. 增加显著属性显示级别（对象属性元数据）。
6. 增加至少两类图表筛选（枚举分布、数值区间）。
7. 增加保存视图（先 localStorage，后续服务端）。
8. 最后再做 Actions / 批量 / Pivot / Compare。

## 六、需要确认的产品决策

1. 我们的产品是否要采用 Palantir 的 “Object Explorer + Object View” 两层，而不是“实例数据表”？
2. 对象属性是否增加 `prominent / normal / hidden` 配置？谁来配？
3. 详情默认打开侧栏 Preview，还是直接全页 Object View？
4. 是否本期就做图表筛选，还是先做表格 + 对象视图？
5. 保存探索/视图先本地还是服务端？
6. 现有“实例”术语是否改为“对象”？建议对外用“对象”，内部表名可保留 instance。

## 七、参考文档

- [Object Explorer Overview](https://www.palantir.com/docs/foundry/object-explorer/overview)
- [Object Explorer Getting started](https://www.palantir.com/docs/foundry/object-explorer/getting-started)
- [View results](https://www.palantir.com/docs/foundry/object-explorer/view-results)
- [Filter results](https://www.palantir.com/docs/foundry/object-explorer/filter-results)
- [Explore with charts](https://www.palantir.com/docs/foundry/object-explorer/explore-charts)
- [Pivot to explore linked objects](https://www.palantir.com/docs/foundry/object-explorer/pivot-linked)
- [Compare object sets](https://www.palantir.com/docs/foundry/object-explorer/compare-object-sets)
- [Save explorations](https://www.palantir.com/docs/foundry/object-explorer/save-explorations)
- [Apply Actions](https://www.palantir.com/docs/foundry/object-explorer/apply-actions)
- [Object Views Overview](https://www.palantir.com/docs/foundry/object-views/overview)
- [Standard Object Views](https://www.palantir.com/docs/foundry/object-views/standard-object-views)
- [Properties and Links](https://www.palantir.com/docs/foundry/object-views/widgets-properties-links)
- [Configure tabs](https://www.palantir.com/docs/foundry/object-views/config-tabs)
- [Applications sidebar](https://www.palantir.com/docs/foundry/object-views/config-app-sidebar)
