# 阶段 5.5：整体统一为 Ant Design 外观

2026-11-06，用户确认计划。整体作为阶段 5.5 一次开发、一次日志与统一人工验收；内部保留四步顺序，连续完成，不设置步骤间人工验收门槛。整个 5.5 人工验收通过后才能进入阶段六。

## 目标与整体样式

采用标准 Ant Design 蓝色、明暗主题、控件、线性图标与状态反馈。左侧课程目录、顶部面包屑／全屏／三模式标签／保存状态、阅读工具区和逐页 PDF／笔记布局形成统一工作台。浅色为中性灰背景、白色容器；深色使用 darkAlgorithm；PDF 保持原色。界面控件基准 14px／32px，笔记正文 16px、约 1.65 行高；4px 间距体系、标准圆角、轻分隔，仅浮层使用明显阴影。窄屏目录使用 Drawer，PDF 与笔记上下排列。

不添加统计仪表盘、装饰卡片或新导航层级；主要操作保留文字与明确反馈。

## 原始元素与替换方案

| 原始元素 | 替换组件／设计 | 主要更新 |
|---|---|---|
| 独立明暗色、通用控件 CSS | ConfigProvider、主题算法、Design Token | 统一背景、文字、边框、选中、焦点与状态色，Markdown／代码区与 PDF 衬底跟随主题 |
| 工作台与侧栏容器 | Ant Layout 视觉规范与令牌 | 保留当前 Grid、滚动结构与响应式布局 |
| 自绘 P、纸张空态 | ReadOutlined、Empty | 保留品牌文字、导入与打开已有课件提示 |
| 目录条目 | Ant Tree + Button／Tooltip／图标／主题令牌 | 保留缩进、长名称、页数、标题拖动及独立展开箭头 |
| 原生 details 更多菜单 | Dropdown 菜单 | 重命名、移序、移动与删除统一，外点及 Esc 关闭 |
| 菜单内移动目标 select | “移动到…”Modal + 分组 Select | 按课程分组，列直属／章节；跨课程继续原确认 |
| 创建、导入、设置入口 | Button、Tooltip | 主操作使用主按钮，辅助操作文字按钮 |
| 拼接文字面包屑 | Breadcrumb、Typography.Text | 长名称省略，可查看全文，不添加无目标链接 |
| 三模式自定义按钮 | Tabs 下划线样式 | 共用一个 Reader，只改变模式状态，保留草稿与位置 |
| 全屏、目录开关 | 图标 Button、Tooltip | 与真实全屏及目录状态同步 |
| 保存状态点与日志 | Badge、Popover、Typography、Divider | 保留真实状态、失败优先及最近五条日志 |
| 连续／单页按钮 | Segmented | 二选一，保留当前页 |
| 页码、缩放、翻页 | InputNumber、Select、Button、Space.Compact | 保留原始页码、档位、适应页面和边界禁用 |
| 页面属性下拉框 | 页码左侧悬停／聚焦显示的折叠按钮 | 只保留 normal／collapsed，三模式持久保存，移除分类／隐藏／筛选／批量 |
| 临时展开、退出沉浸等 | Button | 保留行为与可访问名称 |
| 自定义笔记折叠结构 | 无边框 Collapse，非手风琴 | 简洁标题、细分隔、三块独立展开；默认总结展开，隐藏不销毁 |
| textarea | 无边框 Input.TextArea、自适应高度的轻底色编辑画布 | 紧凑工具栏与编辑／预览切换，保留中文输入、快捷保存与 DraftStore |
| 编辑／预览 | 小尺寸 Segmented | 明示状态，保留原 Markdown 渲染 |
| 保存、重试、问答操作 | Button、现有 Popconfirm | 统一忙碌、危险操作与确认反馈 |
| 恢复、错误、冲突盒子 | Alert、Typography、Button | 服务器内容纯文本展示，保留比较、确认、重试与丢弃 |
| 导入拖放及文件选择 | Upload.Dragger | 禁止自动上传；核对文件后确认才走现有上传接口 |
| 重复课件、导入失败 | Alert + 操作按钮 | 保留位置、打开已有课件与重新加载目录 |
| 设置状态与时间列表 | Badge、Descriptions | 保留现有 Modal、Radio.Group 及二次确认 |
| 加载、筛选无结果、拖入覆盖提示 | Spin、Empty、Ant 图标与令牌 | 提供真实状态及恢复入口，无虚假进度 |
| 现有 Ant 弹窗、抽屉、通知 | 保留并统一主题与尺寸 | 不重复改写业务流程 |

2026-11-06 根据人工反馈改用 Ant Tree，替换原 dnd-kit 目录；课程下直接显示直属课件，不显示“课程直属”和空课件提示。使用原生 Tree 拖放和键盘浏览，排序／移动菜单提供键盘操作，继续复用目录事务、跨课程确认和失败回滚。侧栏及逐页双栏分隔线保留拖动／键盘与共享比例机制，接入 Ant 视觉，不引入 Splitter 改变 PDF 测量和滚动结构。

## 图标与动效

直接声明 @ant-design/icons，具名导入。应用自绘 SVG、CSS 图形图标与图标用途的 Unicode 全部替换；PDF、用户 Markdown 内容和快捷键文字不属于替换范围。

| 用途 | Ant 图标 |
|---|---|
| 品牌、PDF、导入／拖放 | ReadOutlined、FilePdfOutlined、UploadOutlined、InboxOutlined |
| 展开、课程／章节 | RightOutlined（展开旋转）、FolderOutlined／FolderOpenOutlined |
| 添加、更多、设置 | PlusOutlined、EllipsisOutlined、SettingOutlined |
| 目录开关、全屏 | MenuFoldOutlined／MenuUnfoldOutlined、FullscreenOutlined／FullscreenExitOutlined |
| 改名、删除、移动、移序 | EditOutlined、DeleteOutlined、FolderOpenOutlined、ArrowUpOutlined／ArrowDownOutlined |
| 筛选、批量、翻页 | FilterOutlined、ProfileOutlined、LeftOutlined／RightOutlined |
| 保存、刷新、预览 | SaveOutlined、ReloadOutlined、EyeOutlined |

纯图标操作提供可访问名称与 Tooltip。按钮使用 Ant 自带反馈，移除手动 DOM ripple。状态过渡约 100ms，折叠与切换约 200ms，弹窗／抽屉最长约 300ms。Tabs 仅下划线移动，阅读内容不滑动、缩放或模拟翻书。拖拽保留落点线与轻阴影，不做回旧位置动画；拖动尺寸不缓动；折叠不触发滚动恢复。减少动态效果时关闭非必要动画，保留文字和焦点反馈。

## 实施与兼容

| 实施顺序 | 内容 | 验证重点 |
|---|---|---|
| 1 | 主题、全量图标、基础 Button／状态／空态，记录包体积 | 明暗主题、图标、基础反馈及现有功能回归 |
| 2 | 目录、顶栏、导入、设置 | 拖拽、移动确认、全屏、重复导入及只读 |
| 3 | 阅读工具、逐页折叠、笔记面板 | 草稿、定位、快捷键、折叠与冲突恢复 |
| 4 | 遗留样式清理、窄屏／全屏收敛、整体回归 | 完整学习流程、兼容性与动效 |

以当前 Ant 6.7.0 为基准，不同时升级框架。目录与笔记接口、页面 ID、草稿格式和浏览器偏好键保留；页面显示接口简化为单页 normal／collapsed，数据库通过 0007 移除分类并恢复旧隐藏页，无新增路由。保留 PDF.js、Markdown 安全策略、保存队列与全屏浮层容器；Ant Form 不接管 DraftStore。新增控件保护方向键、浮层操作和输入法，避免误翻页。清理会覆盖 Ant 的通用样式，保留专用布局。不得修改用户代码注释。

## 验证、记录与启动

按顺序实施并运行相关 Vitest、TypeScript／Vite 构建、antd lint；最终运行后端 pytest。重点覆盖模式与页码保留、复习只读、目录回滚、文件不自动上传且确认一次、文字拖动不误导入、折叠保留保存队列、隐藏控件焦点、跨课件保存、冲突恢复、方向键保护、主题不重建阅读器和减少动态效果。记录 JS／CSS 和 gzip 体积，避免整包图标及新动画库。约 200 页性能专项留阶段六。

Safari 和 Chromium 由用户人工验证：长名称／窄屏／全屏浮层，持续缩放与分隔线调整、PDF 文字层对齐，折叠无字号跳变或尾部抖动，导入／整理／阅读／保存／断联重试／冲突处理完整可用。无授权不连接浏览器自动化。

整个 5.5 合为一条初次开发日志，追加现有阶段五日志，首条日志不加 *fix，后续修复才加；标题后首段用一句话概括功能或 bug 更新；人工待办用【】标题与复选框，明确待人工验收。更新 Ant 使用说明、页面及接口现状清单，不提前宣称后续批次完成。

启动优先使用 PyCharm 共享 run：npm ci → npm run build → backend/run.py。等效命令：npm --prefix frontend ci；npm --prefix frontend run build；backend/.venv/bin/python backend/run.py。地址 http://127.0.0.1:5001/。 新增依赖后重新安装、构建，停止旧进程再重启；配置与端口预计不变。不单列启动配置待办；在【人工验收】第一行用一句话说明本轮所需 ci／build／python 步骤，实际配置变化简述于实现记录。

2026-11-06 最新反馈：添加章节改到课程菜单第一项，创建课程只显示＋；Tree 折叠箭头朝右、展开朝下；目录操作按钮隐藏时不占行宽，显示时长名称收窄。侧栏上方水平留白增大以匹配底部系统设置入口。页码折叠按钮置于页码左侧并悬停显示，不影响页码原位置；顶栏「当前页 / 总页数」紧跟文件名，当前页可输入并回车跳转。页面状态简化为 normal／collapsed，三模式均保存；移除分类、隐藏、筛选、批量和跳过提示。迁移 0007 移除分类列并将历史隐藏页恢复显示。

2026-11-06 再次反馈：覆盖 Ant Tree 内部 SVG 对折叠图标的默认旋转，确保箭头方向；笔记标题仅空内容显示提示，问答保留条数且右侧增加内边距；删除问答改为点击确认，结果 toast 提示；保存历史改用左侧灰色时间线、状态点、时间状态和次行课件页码，底部快捷提示弱化。
