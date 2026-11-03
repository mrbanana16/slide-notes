# 前端页面列表

最后更新：2026-11-03（阶段一，人工验收通过）。本文件描述当前实现，每次阶段或迭代开发完成后更新。

## 访问入口

- 本地构建版：[课件笔记工作台](http://127.0.0.1:5001/)。由 Flask 托管前端构建产物。
- 开发版：[Vite 开发入口](http://127.0.0.1:5173/)。实际端口以 Vite 输出为准；`/api` 代理到 `http://127.0.0.1:5001`。
- 当前为单页应用，仅有 `/` 页面；选择课件和编辑笔记通过页面内状态切换，不生成独立 URL，也不支持通过 URL 直接定位某份课件或某页笔记。

## IDE 构建入口

PyCharm 共享配置为 [.run/frontend build.run.xml](../.run/frontend%20build.run.xml)，运行 `frontend/package.json` 的 `build`。本地构建版按“先 `frontend build` 成功、再 `run backend`”的顺序启动；此配置不启动 Vite。IDE 设置及其下方保留的命令方式见 [README 本地运行](../README.md#本地运行)。`.run` 配置和命令未变更；本次更新包含前端去重提示、清空入口及后端迁移，需重新运行 `frontend build`、重启 `run backend` 并刷新页面，详见阶段一日志中的启动复验待办。

## 页面与页面内视图

| 页面／视图 | 访问路径与进入方式 | 代码文件位置 | 作用与主要操作 | 关联接口 |
|---|---|---|---|---|
| 学习工作台／未选择课件 | `/`，首次打开或尚未选择课件时显示 | [App.tsx](../frontend/src/App.tsx)，[main.tsx](../frontend/src/main.tsx) | 展示课件目录与空白引导；选择文件或拖入 PDF；打开已有课件 | `GET /api/materials`、`POST /api/materials` |
| 逐页整理视图 | 同一 `/` 页面，点击目录课件或导入成功后进入 | [App.tsx](../frontend/src/App.tsx)，[PdfPage.tsx](../frontend/src/PdfPage.tsx) | 连续展示课件原始页面、页码及对应笔记；按可视区域渲染 PDF，支持文字选择；切换课件、收起目录 | `GET /api/materials/{material_id}/pages`、`GET /api/materials/{material_id}/file` |
| 清空全部数据操作 | 同一 `/` 页面，目录底部按钮，浏览器确认后执行 | [App.tsx](../frontend/src/App.tsx) 的 `resetAllData` | 清空课件、笔记、当前窗口草稿及后端存储；成功回到初始页，取消不发请求，失败显示错误 | `POST /api/reset` |
| 每页个人笔记区 | 逐页整理视图内，每页 PDF 旁；窄屏时位于其下方 | [NoteEditor.tsx](../frontend/src/NoteEditor.tsx)，草稿由 [App.tsx](../frontend/src/App.tsx) 管理 | 编辑纯文本或 Markdown 源码，手动保存、快捷键保存、失败重试与冲突提示；显示保存状态 | `PUT /api/pages/{page_id}/note` |

上述页面内视图不是独立路由。课程／章节管理、Markdown 预览、AI 总结、问答、复习及沉浸模式尚未实现。

## 公共实现位置

| 文件 | 作用 |
|---|---|
| [index.html](../frontend/index.html) | HTML 页面入口与挂载节点 |
| [main.tsx](../frontend/src/main.tsx) | React 应用挂载 |
| [api.ts](../frontend/src/api.ts) | 课件与页面类型定义、JSON 请求和错误处理 |
| [styles.css](../frontend/src/styles.css) | 工作台布局、响应式样式、焦点及减少动态效果规则 |
| [vite.config.ts](../frontend/vite.config.ts) | 开发 API 代理、PDF 字体／CMap／WASM 资源提供与构建复制 |
| [App.test.tsx](../frontend/src/App.test.tsx) | 导入、重复导入提示、课件切换、草稿绑定、关闭提醒、清空确认／取消／失败及迟到保存响应测试 |
| [NoteEditor.test.tsx](../frontend/src/NoteEditor.test.tsx) | 保存期间编辑、失败重试及冲突保留测试 |

## 当前交互约定

- PDF 文件选择和拖入均在工作台内完成，无独立上传页；导入时检查扩展名和文件大小，后端再校验 PDF 内容。可用空密码读取的权限保护课件允许导入；需要打开密码的文件仍被拒绝。
- 重复文件按内容识别，显示“该课件已导入”，打开已有课件且不增加目录项；历史重复条目不自动合并。
- 清空全部数据需要浏览器二次确认；导入或清空过程中禁用清空按钮，成功后清除页面和当前窗口草稿。其他标签页需刷新，旧页面保存不会重建已删除数据。
- 保存快捷键为笔记输入框内的 `⌘S` / `Ctrl+S`；当前尚无自动保存和刷新后草稿恢复。
- 未保存草稿保留在当前窗口内，切换课件后可返回继续编辑；刷新或关闭前会提示。
- 多窗口冲突时保留输入并提示复制备份，再刷新读取最新版本；当前没有独立冲突处理页面。

后端请求与响应详见 [后端接口列表](backend-apis.md)，验证步骤和验收状态见 [阶段一开发与验收记录](devlog/step1-minimal-workflow.md)。
