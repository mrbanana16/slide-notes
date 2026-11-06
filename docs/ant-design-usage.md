# Ant Design 使用清单

阶段 5.4 核对。当前工作台采用自定义阅读布局，弹窗、选择、确认与系统反馈使用 Ant Design。下面按实际交互列出入口，便于在决定整体外观前逐项体验。

| 在界面上如何查看 | 使用的 Ant Design 元素 | 实现位置 |
|---|---|---|
| 打开系统设置，切换浅色、深色、跟随系统 | `ConfigProvider`、`theme.defaultAlgorithm`、`theme.darkAlgorithm`、简体中文 locale。浮层共用挂载位置，减少动态效果时关闭组件动效 | [theme.tsx](../frontend/src/theme.tsx) |
| 系统设置中检测后端、切换显示模式、清空测试数据 | `Modal` 设置及二次确认，`Radio.Group` 选择主题，`Button` 刷新及清空，`Tooltip` 解释复习模式禁用原因。运行状态圆点和时间行由项目绘制 | [SystemSettings.tsx](../frontend/src/SystemSettings.tsx) |
| 窄屏呼出目录，或删除一份课件 | `Drawer` 容纳现有目录树，`Modal.useModal().confirm` 展示课件删除影响 | [App.tsx](../frontend/src/App.tsx) |
| 创建课程／章节、改名、删除空目录，悬停课程行「＋」 | `Modal`、`Input`、`Modal.useModal().confirm`、`Tooltip` | [Directory.tsx](../frontend/src/Directory.tsx) |
| 跨课程拖动，检查来源和目标 | `Modal` 转移确认 | [TransferDialog.tsx](../frontend/src/TransferDialog.tsx) |
| 导入 PDF，选择归属或在下拉末尾创建 | `Modal`、`Select`、`Input`、`Button`。文件拖入区、文件详情和 PDF 图标由项目绘制 | [ImportDialog.tsx](../frontend/src/ImportDialog.tsx) |
| 删除问答、解决版本冲突、丢弃失效草稿 | `Popconfirm` 就地二次确认 | [NoteEditor.tsx](../frontend/src/NoteEditor.tsx) |
| 悬停或点按顶栏保存状态，查看最近五条记录 | `Popover` 承载日志。状态点、文案、课件名、页码及时间来自项目保存流程 | [App.tsx](../frontend/src/App.tsx) |
| 完成目录或页面操作，或模拟断联、保存冲突 | `notification.useNotification` 实现顶部 Toast；`Alert` 和链接样式 `Button` 提供重试或定位冲突的操作；冲突页用 `Button` 返回 | [App.tsx](../frontend/src/App.tsx)、[ConflictPage.tsx](../frontend/src/ConflictPage.tsx) |

## 整体外观评估时可对照的自定义区域

- **目录**的缩进、整行高亮、更多菜单、桌面宽度调节、齿轮入口及标题拖动使用项目 CSS 和 dnd-kit。使用 Ant Drawer 仅覆盖窄屏容器。
- **顶栏与阅读工具**的模式下划线、波纹、全屏、筛选和批量面板、页码输入及分隔线由项目实现。导入归属采用 Ant Select，阅读区和移动菜单内的选择框使用原生表单。
- **阅读与笔记**由 PDF.js、Markdown 渲染、源码输入框、自定义折叠标题及代码高亮构成。其颜色通过项目 CSS 变量与 Ant 主题同步。
- **图标**方面，Ant 组件提供自身的状态、关闭、选择等图标。工作台自绘的 PDF、全屏、垃圾桶图形以及目录菜单符号属于项目自身。当前业务源码没有直接导入 `@ant-design/icons`。
