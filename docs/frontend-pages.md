# 前端页面列表

2026-11-11 更新，包含 Windows 维护改动。阶段六发布版本为 v1.0。

## 页面与页面内状态

日常地址：[http://127.0.0.1:5001/](http://127.0.0.1:5001/)。开发地址以 Vite 控制台为准；所有视图均在 `/` 内切换，不增加独立路由。

| 页面／视图 | 进入方式与作用 | 主要操作 | 代码文件 | 关联接口 |
|---|---|---|---|---|
| 工作台初始视图 `/` | 首次进入、没有选中课件或清空后 | 固定“未分类”、创建普通课程、导入 PDF、打开目录内课件、收起目录 | `frontend/src/App.tsx` | GET `/api/directory`、POST `/api/courses` |
| 课件整理视图 `/` | 点击课件或完成导入；连续显示原始页码与该页笔记 | 查看 PDF、逐页编辑、折叠笔记区、预览 Markdown、逐页折叠／展开 | `App.tsx`、`Reader.tsx`、`PdfPage.tsx`、`NoteEditor.tsx` | GET `/api/materials/{id}/pages`、GET `/api/materials/{id}/file` |
| 复习连续视图 `/` | 顶部「复习」，首次默认连续；同一路由内状态 | 逐页 PDF 与 Markdown 只读预览、笔记区临时折叠、逐页折叠与独立全屏；禁止笔记、目录、导入／删除／清空修改 | `App.tsx`、`Reader.tsx`、`NoteEditor.tsx` 的 `NotePreview` | 共用页面／文件 GET；先前编辑仍由 `drafts.ts` 保存 |
| 复习单页视图 `/` | 复习工具栏「单页阅读」 | 保留当前页，顶栏页码可输入并回车跳转，上一／下一页、←／↑ 上一页与 →／↓ 下一页、缩放／适应页面；返回连续时恢复页与页内位置，全屏与布局互不改变 | `Reader.tsx`、`App.tsx`、`reading.ts`、`PdfPage.tsx` | 共用页面／文件 GET，无新的模式 API |
| 沉浸整理视图 `/` | 顶部「沉浸整理」，目录默认收起，可用顶栏菜单键展开 | 单页编辑、翻页、跳转、缩放、适应页面、逐页折叠／展开、全屏；退出沉浸回到整理 | `App.tsx`、`Reader.tsx`、`NoteEditor.tsx`、`PdfPage.tsx` | 共用笔记 PUT；PATCH `/api/materials/{id}/page-settings` |
| 页面折叠／显示 | 每页页码左侧图标，宽屏悬停／聚焦显示，窄窗口及触屏常显 | 三模式均保存 normal／collapsed，折叠保留页码条；失败保持原状态，冲突读取最新状态后显式重试 | `Reader.tsx` 的 `togglePage` | PATCH `/api/materials/{id}/page-settings`；冲突时 GET `/api/materials/{id}/pages`，只合并显示属性 |
| 课程目录 | 左侧课程 → 课程直属课件／章节 → 课件，标题最多两行，均为 `/` 内状态 | 创建课程、添加章节、折叠、改名、上移下移、拖动排序、跨章节／课程移动，跨课程需确认；普通空容器删除 | `Directory.tsx`、`directoryOrder.ts`、`directoryTree.ts`、`App.tsx` | GET `/api/directory`；POST `/api/courses`、`/api/chapters`；PATCH／DELETE `/api/courses/{id}`、`/api/chapters/{id}`；PATCH `/api/materials/{id}`；PUT `/api/directory/order` |
| 导入归属弹窗 | 导入按钮或将 PDF 拖入工作区，Ant Design 弹窗 | 选入 PDF 后立即并行检查文件可读性、加密状态、页数及内容重复；文件信息行同步显示页数。错误、加密和重复结果均在确认前反馈；重新选择文件时重做检查 | `ImportDialog.tsx`、`App.tsx` | GET `/api/materials/duplicates`；确认后 POST `/api/materials`；POST `/api/courses`、`/api/chapters` |
| 跨课程转移确认 | 课件拖到另一课程／章节标题或课件间隙，或菜单选择另一课程目标 | 展示源位置与目标位置；取消不请求，确认后更新归属，保留页 ID 和笔记；目标折叠时自动展开 | `TransferDialog.tsx`、`Directory.tsx`、`directoryOrder.ts` | PUT `/api/directory/order`，包含 `transfers` 确认列表 |
| 重复课件提示 | 选择文件后的查重返回匹配，或上传时发现新出现的重复课件 | 显示“课件已存在”和完整位置，可打开已有课件、在所选目录创建独立副本或取消 | `ImportDialog.tsx`、`App.tsx` | GET `/api/materials/duplicates`；创建副本时 POST `/api/materials` 并发送 `create_copy=true` |
| 删除课件确认 | 课件「⋯」菜单，先查询删除影响再显示确认框 | 显示页数、已保存笔记／问答数、当前未保存编辑数；取消保留，确认后清理对应页草稿与迟到响应 | `Directory.tsx`、`App.tsx`、`drafts.ts` | GET／DELETE `/api/materials/{id}` |
| 目录保存失败／版本冲突 | 修改目录失败或其他窗口已变更目录 | 保持原结构、提示错误；重新加载目录后重做操作，保留笔记草稿 | `App.tsx`、`ImportDialog.tsx` | GET `/api/directory`；原目录写接口 |
| AI 解释与总结区 | 每页右侧第一个独立折叠区 | 手动输入／粘贴总结，源码编辑与预览，标题提示有无内容 | `NoteEditor.tsx` | PUT `/api/pages/{page_id}/summary` |
| 个人笔记区 | 每页右侧第二个独立折叠区 | Markdown 编辑与预览，保留阶段一已有笔记 | `NoteEditor.tsx` | PUT `/api/pages/{page_id}/note` |
| 追问与 AI 解答区 | 每页右侧第三个独立折叠区；标题显示问答数 | 添加多条问答，分别编辑／预览问题与回答，确认后删除 | `NoteEditor.tsx` | PUT `/api/pages/{page_id}/qa/{entry_id}` |
| 保存失败／版本冲突状态 | 网络错误、服务错误或多窗口版本冲突 | 保留输入，重试；对比服务器内容后选择使用服务器版本或以草稿重新保存（均需确认） | `drafts.ts`、`NoteEditor.tsx` | 对应 PUT；冲突响应携带 `current` |
| 冲突页整理 | 顶栏 Alert 的「查看冲突」，同一路由内临时显示原始页 | 展开对应笔记／总结／问答、核对双方版本、确认或返回原阅读位置 | `ConflictPage.tsx`、`NoteEditor.tsx` | GET 课件原文件及原有笔记 PUT |
| 顶栏保存日志与恢复 | 悬停、点按或聚焦状态入口 | 当前会话跨课件最近五条结果，手动保存标记「（手动）」；可在失败通知和日志中重试，断联时显示自动重连倒计时 | `App.tsx`、`drafts.ts` | GET `/api/status`、`/api/directory` 及原保存接口 |
| 系统设置 | 在 `/` 内从目录底部打开 Ant Design 弹窗 | 选择并记住显示模式，打开或刷新时检测后端；查看前端构建时间、后端启动时间和系统版本 | `SystemSettings.tsx`、`theme.tsx` | GET `/api/status` |
| 原始 PDF 补回 | 课件打开时发现原文件丢失或不可读 | 阅读区显示提示，顶栏提供「重新导入原文件」 | `App.tsx` | GET、PUT `/api/materials/{id}/file` |
| 从备份恢复 | 整理模式 → 系统设置 → 从备份恢复 | 选择备份并确认覆盖，成功后重载目录并清除浏览器草稿 | `SystemSettings.tsx`、`App.tsx` | GET `/api/backups`、POST `/api/backups/{id}/restore` |
| 清空全部数据确认 | 整理模式中，系统设置内的按钮打开二次确认弹窗；复习模式禁用，悬停或键盘聚焦可查看原因 | 可勾选备份数据库和原始 PDF，再确认清空；成功回到首次使用状态 | `App.tsx`、`drafts.ts` | POST `/api/reset` |

以上源码路径均相对项目根目录，前端文件均位于 `frontend/src/`。API 请求封装在 `api.ts`，样式在 `styles.css`。

## 目录交互

- 桌面拖动目录右侧分隔线调宽；窄屏点菜单打开抽屉，选中课件即关闭。标题区用于拖动或点选，左侧箭头独立展开。添加章节收入课程「⋯」菜单第一项，目录标题「＋」用于创建课程，普通课程、章节和课件使用「⋯」中的重命名项。复习时保留目录浏览。
- 顶栏全屏图标在 Tabs 模式切换左侧，当前模式以蓝色下划线标识。点击窄屏保存状态点可查看现有保存说明。
- 将鼠标移到目录或顶栏的课件名上时，Tooltip 显示完整文件名。
- 顶栏「当前页 / 总页数」紧跟文件路径并保留独立宽度；空间不足时省略路径，点击当前页输入数字并按回车跳转。单页模式另提供翻页及缩放；分类、隐藏、筛选和批量入口已移除。宽屏各页共用一个 PDF 栏比例；拖动或左右键调整后保存到浏览器，空间较窄时改为上下排列。`ReadingControls.tsx` 提供分隔线及尺寸偏好。

- Ant Design Tree 提供原生拖放、展开和落点反馈；普通课程排序、同课程章节排序、课件排序及跨章节／课程移动由单次目录事务提交。可放到课程／章节标题（包括折叠状态）、课件间隙；空课程／章节可通过标题接收课件；跨课程先展示确认弹窗，确认前不提交。全部菜单操作均可用键盘完成。
- 放下后按目标立即投影显示新目录，等待响应期间禁用其他目录变更；成功采用服务器快照，失败恢复原结构。使用 Tree 原生拖放反馈，不再叠加旧 dnd-kit 浮层或位移动画。
- 系统“未分类”初始化即存在，固定在首位，不提供改名／删除／排序操作，但可接收及移出课件。清空后服务返回含此系统分类的快照，前端立即保留它。
- Tree 课件节点与更多 Dropdown 操作菜单分开；上移／下移在边界禁用，“移动到…”弹窗内 Select 以课程名为分组标题，组内仅列「课程直属」与章节名，跨课程选择同样先确认。目录请求进行中禁用目录操作，错误不假装已保存。
- 当前课件只在 ID 变化或显式重载时重新读取页面与 PDF；改名、排序与移动只更新目录／面包屑，编辑器及草稿继续工作。
- 目录折叠状态仅留在当前组件会话，不写入数据库；排序和归属持久化。每个课程先显示直属课件，再显示按顺序排列的章节。

## 保存与草稿行为

- 三个笔记区独立展开／折叠，默认仅展开 AI 解释与总结，个人笔记和追问解答默认折叠；折叠不会停止保存。每条问答的问题和回答组成一个保存对象，总结与个人笔记各自保存，版本互不影响。
- 停止输入约 800ms 后保存；输入框内 `⌘S`／`Ctrl+S` 可立即提交。每个对象串行请求，保存中继续输入时保留新内容，上一请求返回后再保存。
- `drafts.ts` 在工作台级别管理队列。切换课件后队列仍工作，草稿绑定稳定页面／问答 ID，顶部显示未保存页数；关闭或刷新时若仍未保存会提示。
- 草稿写入当前站点的 localStorage，使用 sessionStorage 中的标签页标识隔离普通独立标签页。**在同一标签页、同一访问地址刷新并重新打开对应课件**可恢复；服务器版本未变则继续自动保存，版本已变则等待选择。新标签页不会自动导入其他标签页的草稿；清理浏览器存储或改变端口／主机会影响恢复。浏览器“复制标签页”可能复制会话标识，验收多窗口冲突请从新建空白标签页访问地址。
- 存储不可用／空间不足会显示错误，内存输入仍保留，请保持页面打开并保存或复制内容。断网或后端不可用时保留草稿。工作台每隔 5 秒检查后端，断联时显示倒计时，暂缓发送保存请求；连接检查成功后刷新目录并自动补保存。也可点击失败通知或保存日志中的「重试」。
- 冲突不静默覆盖。显示服务器版本供比较；选择保留草稿后使用最新版本号提交，再次发生并发修改仍会再次提示。服务器已删除问答不能用旧 ID 恢复，可先复制草稿再采用服务器删除结果；孤立草稿可复制后丢弃。
- 顶栏显示全局保存状态。笔记板块标题右侧仅在未保存或保存失败时显示圆点，分别用黄色和红色区分，全部保存成功后消失。草稿恢复、保存失败和冲突在对应对象内另有提示。带「重试」的通知在对应保存成功后关闭，也可手动关闭。普通错误通知约 5 秒后消失。问答删除失败时保留原问答条数及输入，重试成功后移除该问答。
- Markdown 支持基础语法、表格、代码块、任务列表。代码块显示开头反引号后标注的语言，常用语言按关键字、字符串、数字、注释等分色；未知语言保留标签和原文，无语言时显示“纯文本”，行内代码不添加语言栏。预览不执行原始 HTML，图片以占位文字代替且不发出图片请求；安全链接在新标签页打开。
- AI 总结和解答由用户手动输入或粘贴，本阶段不调用 AI API。
- PDF 按文件内容匹配，重复时可从导入弹窗打开已有课件或创建副本。备份只包含已保存数据。清空或恢复前请关闭其他标签页，操作成功后清除站点草稿。

## 界面主题

默认跟随系统；手动选择浅色或深色后固定该模式。工作台与弹窗共用主题，PDF 页面保留原色。首屏在加载工作台前读取主题。切换时工作台和设置弹窗共同淡化；减少动态效果或缺少视图过渡支持时直接切换。

## 构建与启动

PyCharm 使用共享配置 [`run`](../.run/run.run.xml) 依次安装前端依赖、构建并启动后端。已有最新前端构建时，可使用 [`run_backend`](../.run/run_backend.run.xml)。后端启动自动迁移到 `0008`，继续使用原有课件和笔记。

命令方式（项目根目录）：

```sh
npm --prefix frontend ci
npm --prefix frontend run build
backend/.venv/bin/python backend/run.py
```

接口详情见 [后端接口列表](backend-apis.md)，当前启动与主题人工验收步骤见 [阶段五记录](devlog/step5-ui-redesign.md)。

## 阅读位置与只读边界

模式、复习布局及缩放属于当前课件阅读会话的前端状态，页面折叠／展开通过接口持久化，无独立路由或后端模式开关。切换模式保留稳定页面 ID 对应的草稿，连续布局记录可见原始页码与页内偏移；单页按原始页码浏览所有页面，包括折叠页；折叠页仍可展开。首次打开课件不强制滚动到第一篇正文。连续模式保留页码和页高占位，在视口邻近区域挂载笔记面板，焦点所在面板继续保留；草稿与保存由工作台管理，离屏卸载不会丢弃编辑。

复习预览读取工作台草稿，先前编辑仍可完成自动保存；没有 textarea、添加／删除问答入口（页面折叠／展开仍可保存）。目录可选课件并临时折叠，拖动和变更菜单禁用／移除，导入与清空禁用。保存冲突可从顶栏告警直接进入冲突页整理视图。全屏失败显示可继续使用窗口布局的提示；Esc 只改变浏览器全屏状态。

单页复习与沉浸整理共用四向方向键快捷键，工具栏显示说明。普通按钮聚焦（例如点击单页阅读后）仍可使用；文本框、选择框、可编辑内容、弹窗和文本输入类 ARIA 控件聚焦时保留自身键盘行为。输入法组词、修饰键组合及已被其他控件处理的事件不触发翻页。连续模式不注册此翻页处理，翻页仍使用原始页码顺序，包括折叠页。

## 阶段 5.5 外观更新（人工验收通过）

独立路由仍仅 `/`，所有阅读／整理状态及接口保持原有约定。目录更多操作使用 Dropdown，“移动到…”先打开分组 Select 弹窗，再按需要确认跨课程转移；顶栏采用 Breadcrumb 与 Tabs，导入使用手动提交的 Upload.Dragger。页码指示位于面包屑旁，用 InputNumber 融合当前页与跳转，单页缩放用 Select，页码左侧悬停图标持久保存折叠／显示且不改变页码位置，阅读布局和编辑预览用 Segmented。笔记三区使用保留内容的无边框 Collapse、轻底色画布内自适应高度的 Input.TextArea 与 Alert；空状态仅在无内容时显示，问答始终保留条数。问答删除通过点击触发确认，保存记录以状态时间线呈现。

应用图标全部来自 @ant-design/icons；专用 Grid、PDF.js、Markdown、草稿及分隔线保留。各实现位置沿用上表，组件映射见下表。启动配置未变，新增图标直接依赖后需 ci、build，重新运行 PyCharm run 完成统一验收。

### Ant Design 组件清单

| 界面区域／入口 | 组件与设计 | 实现位置 |
|---|---|---|
| 明暗主题、跟随系统、减少动态效果 | ConfigProvider、主题算法、Design Token 及根节点 CSS 变量桥接 | frontend/src/theme.tsx |
| 目录行、展开、创建与添加章节 | Tree、Button、Tooltip；原生层级、选中、展开与拖放 | frontend/src/Directory.tsx |
| 目录“更多”与移动目标 | Dropdown 菜单、Modal、分组 Select；跨课程仍二次确认 | frontend/src/Directory.tsx、TransferDialog.tsx |
| 顶栏 | Breadcrumb、Typography、Tabs、Tooltip、Button；共用阅读器 | frontend/src/App.tsx |
| 保存状态与日志 | Badge、Popover、Divider；最近五条真实记录 | frontend/src/App.tsx |
| 导入课件 | Modal、Upload.Dragger、Select、Input、Button、Alert；禁止自动上传，确认后请求 | frontend/src/ImportDialog.tsx |
| 页码、缩放、翻页与页面折叠 | Select、InputNumber、Button、Tooltip、Space.Compact | frontend/src/Reader.tsx |
| 连续／单页阅读 | Segmented | frontend/src/Reader.tsx |
| 三个笔记区、编辑／预览 | 无边框 Collapse、Segmented、无边框自适应 Input.TextArea；保留 Markdown 渲染和草稿队列 | frontend/src/NoteEditor.tsx |
| 保存、问答删除及冲突恢复 | Button、Popconfirm、Alert | frontend/src/NoteEditor.tsx |
| 初始空态、无页面与加载 | Empty、Spin、Ant 图标 | frontend/src/App.tsx、Reader.tsx、ConflictPage.tsx |
| 后端状态、显示模式及运行时间 | Modal、Badge、Radio.Group、Descriptions、Button；清空仍二次确认 | frontend/src/SystemSettings.tsx |
| 失败、断联与冲突通知 | notification、Alert、Button，使用真实请求结果 | frontend/src/App.tsx、PdfPage.tsx、ConflictPage.tsx |
| 窄屏目录 | Drawer | frontend/src/App.tsx |

课程直属归属仍持久化，目录仅隐藏“课程直属”和其空课件提示；移动弹窗仍可明确选择“课程直属”。Tree 内方向键浏览，菜单支持键盘排序／移动。

2026-11-06 更新：笔记板块底部保存状态与按钮已移除，手动保存仅使用 Ctrl／⌘ + S 并通过 toast 返回结果；自动保存失败同样提示。深色主题使用灰蓝背景层级；目录箭头和页面折叠提供过渡，页面显示状态保存成功不弹 toast。

页码输入框以三位数为基准收紧左右内边距，超过三位时按总页数扩宽，数字居中显示；笔记编辑器聚焦时仅显示柔和的外层边框，内部 textarea 不重复绘制焦点框。

深色主题恢复阶段 5.5 前的深蓝灰背景（画布 #1B2028、容器 #242B35），通过 Ant 主题令牌统一；Markdown 编辑预览左右留白为 24px，复习预览同步增加内边距。
