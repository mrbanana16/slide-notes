# 后端接口列表

最后更新：2026-11-03（阶段一，人工验收通过）。本文件描述当前实现，每次阶段或迭代开发完成后更新。

## 请求约定与实现位置

- 本机服务基础地址：[http://127.0.0.1:5001](http://127.0.0.1:5001/)，仅监听本机；当前无账号与认证机制。
- 前端统一使用同源 `/api` 路径；开发时 Vite 将其代理到上述后端地址。
- `{material_id}` 和 `{page_id}` 是路径占位符，调用时替换为接口返回的真实 ID。课件 ID、页面 ID 均为稳定字符串 ID；原始页码从 1 开始，不能当作页面 ID 使用。
- JSON 请求使用 `Content-Type: application/json`，文件上传使用 `multipart/form-data`。
- 错误通常返回 `{"error": "错误说明"}`；版本冲突还返回 `current`。未预期的服务错误返回 500，不向前端泄露异常细节。

| 文件 | 作用 |
|---|---|
| [slide_notes/__init__.py](../backend/slide_notes/__init__.py) | `create_app`、路由、请求校验、事务及错误处理 |
| [models.py](../backend/slide_notes/models.py) | Material、Page、PageNote 数据模型 |
| [storage.py](../backend/slide_notes/storage.py) | 数据库迁移初始化、SHA-256 计算、全量清空时的空数据库准备与文件切换／失败恢复 |
| [0002_material_fingerprint.py](../backend/migrations/versions/0002_material_fingerprint.py) | 文件指纹字段及唯一索引；为旧课件回填指纹，保留已有重复课件与笔记 |
| [test_import_reset.py](../backend/tests/test_import_reset.py) | 内容去重、并发导入、旧库迁移、清空确认／重建／失败恢复及与上传串行处理测试 |
| [0001_material_pages.py](../backend/migrations/versions/0001_material_pages.py) | 初始数据库表迁移 |
| [run.py](../backend/run.py) | 配置控制台 INFO 日志，创建 Waitress 服务，绑定成功后输出访问地址及数据目录，记录启动异常并处理停止清理 |
| [test_workflow.py](../backend/tests/test_workflow.py) | 上传、保存、冲突、持久化、清理及文件读取测试 |

## IDE 启动入口

PyCharm 共享配置为 [.run/run backend.run.xml](../.run/run%20backend.run.xml)，使用项目虚拟环境运行 `backend/run.py`，提供上述 `127.0.0.1:5001` 服务。先运行 `frontend build` 构建页面，再运行 `run backend`；两份配置没有自动串联。IDE 设置及其下方保留的命令方式见 [README 本地运行](../README.md#本地运行)。`.run` 配置与命令未变更；升级本轮代码时需要重新构建前端并停止旧后端后重启，启动自动执行 `0002` 指纹迁移。

## 控制台诊断日志

后端入口启用带时间、级别及 logger 名称的 INFO 控制台日志。成功绑定端口后显示访问地址及数据目录；启动失败记录异常，不输出已就绪地址。请求完成时记录方法、路径、状态码和耗时（毫秒），不记录查询参数或笔记正文。PDF 导入成功记录课件 ID 与页数，读取失败记录异常栈，需要打开密码的拒绝记录原因。请求日志代码为 `start_request`、`log_request`，位于 [slide_notes/__init__.py](../backend/slide_notes/__init__.py)。

## 业务接口总表

下表代码位置均在 [slide_notes/__init__.py](../backend/slide_notes/__init__.py) 的对应函数中。

| 方法 | 请求链接（默认本机地址） | 处理函数 | 接口作用 | 前端调用位置 |
|---|---|---|---|---|
| GET | [http://127.0.0.1:5001/api/materials](http://127.0.0.1:5001/api/materials) | `list_materials` | 查询所有课件，按文件名、ID 排序 | [App.tsx](../frontend/src/App.tsx) 的 `loadMaterials` |
| POST | [http://127.0.0.1:5001/api/materials](http://127.0.0.1:5001/api/materials) | `upload` | 按内容识别重复文件；重复时返回已有课件，否则校验并创建课件及每页笔记记录 | [App.tsx](../frontend/src/App.tsx) 的 `upload` |
| GET | `http://127.0.0.1:5001/api/materials/{material_id}/pages` | `pages` | 按原始页码查询课件页面及个人笔记 | [App.tsx](../frontend/src/App.tsx) 的课件加载 effect |
| GET | `http://127.0.0.1:5001/api/materials/{material_id}/file` | `file` | 读取课件原始 PDF，供 PDF.js 展示 | [App.tsx](../frontend/src/App.tsx) 的 `getDocument` |
| POST | [http://127.0.0.1:5001/api/reset](http://127.0.0.1:5001/api/reset) | `reset_all_data` | 确认后清空全部课件、笔记和上传文件并重建空数据库 | [App.tsx](../frontend/src/App.tsx) 的 `resetAllData` |
| PUT | `http://127.0.0.1:5001/api/pages/{page_id}/note` | `save_note` | 按版本号保存个人笔记，防止旧版本覆盖 | [NoteEditor.tsx](../frontend/src/NoteEditor.tsx) 的 `save` |

链接只表示请求地址；POST 和 PUT 需要用相应方法及请求体调用，点击链接不会执行写入。

## 请求与响应详情

### GET /api/materials

无需请求体。成功返回 200 和课件数组，无课件时为 `[]`。

```json
[
  {"id": "<material_id>", "filename": "课件.pdf", "page_count": 3}
]
```

### POST /api/materials

表单字段：`file`，值为 PDF 文件。

- 文件名须以 `.pdf` 结尾（不区分大小写）；实际内容须为可读取的 PDF。
- 允许空密码即可读取的权限保护 PDF，拒绝需要输入打开密码、损坏及零页 PDF；请求体上限为 100 MiB（界面文案为 100 MB，multipart 开销也计入后端请求上限）。
- 上传文件使用内部 ID 存储，原文件名仅用于展示；对上传原始字节计算 SHA-256，相同内容返回已有课件；同名但内容不同仍创建新课件。
- 校验或数据库写入失败会清理本次临时文件及未完成课件文件。

首次导入成功返回 201：

```json
{"id": "<material_id>", "filename": "课件.pdf", "page_count": 3}
```

重复导入返回 200，包含 `duplicate: true`，不创建新记录／文件，也不修改已有笔记：

```json
{"id": "<existing_material_id>", "filename": "原课件.pdf", "page_count": 3, "duplicate": true}
```

数据库唯一指纹索引防止重复创建，同一后端进程内数据 API 串行处理。旧数据库升级时读取已有原文件回填指纹；对已有相同内容只给一条记录建立指纹入口，其余历史重复条目保留原 ID、文件及笔记，不做破坏性合并。缺失原文件的旧记录不参与指纹回填。

主要错误：400（缺少文件、类型不符、损坏、需要打开密码、零页）、413（请求过大）、500（文件或数据库操作异常）。

### GET /api/materials/{material_id}/pages

路径参数：`material_id`，来源于课件列表或上传结果。无需请求体。

成功返回 200，按原始页码升序排列：

```json
[
  {"id": "<page_id>", "number": 1, "note": "", "version": 0}
]
```

`note` 为个人笔记原文；`version` 用于后续保存。课件不存在时返回 404。

### GET /api/materials/{material_id}/file

路径参数：`material_id`。无需请求体。

返回 PDF 二进制，类型为 `application/pdf`；完整读取通常为 200，支持条件请求和 HTTP Range，范围读取可返回 206。课件不存在时返回 404；文件读取异常按错误处理逻辑响应。

### PUT /api/pages/{page_id}/note

路径参数：`page_id`，取自页面列表中的 `id`。

请求体：

```json
{"note": "# 本页重点\n个人理解", "version": 0}
```

- `note` 必须是字符串，允许空字符串以清空笔记，最多 1,000,000 个字符。
- `version` 必须是非负整数（不接受布尔值），且等于服务器当前版本。
- 更新在数据库中按 ID 和版本号同时匹配，成功后版本号加 1。

成功返回 200：

```json
{"id": "<page_id>", "number": 1, "note": "# 本页重点\n个人理解", "version": 1}
```

主要错误：400（参数或长度不合法）、404（页面不存在）、409（版本冲突）。冲突响应示例：

```json
{
  "error": "另一窗口已修改此页。你的内容仍保留，请复制备份后重新加载。",
  "current": {"id": "<page_id>", "number": 1, "note": "服务器已有笔记", "version": 1}
}
```

### POST /api/reset

请求体必须为带明确确认值的 JSON：

```json
{"confirmation": "DELETE_ALL_DATA"}
```

成功返回 200：

```json
{"reset": true}
```

- 先在数据目录内部准备当前迁移版本的空数据库，再释放连接池、切换数据库与存储目录；删除旧数据库、关联 sidecar 文件、上传原文件和临时文件。
- 切换文件中途失败时恢复已移动的原数据库／目录并返回 500；成功时只保留空数据库及空的 `materials/`、`tmp/`。如清理旧存储失败，接口仍返回 500 并记录异常，不提示清空成功。
- 不删除数据目录内的无关文件，不操作上传来源位置（例如下载目录）的原始文件。
- 通过后端进程内锁与其他数据 API 串行，等待先前上传／保存结束再清空；旧页面 ID 此后无法保存，必须重新导入。
- 该操作不可撤销。缺少或错误确认值返回 400；存储操作失败返回 500。普通 GET 不会触发清空。

## 页面与静态资源路由

下表代码位置同为 [slide_notes/__init__.py](../backend/slide_notes/__init__.py)，不属于业务 API。

| 方法 | 请求路径／链接 | 处理函数 | 作用与返回 |
|---|---|---|---|
| GET | [http://127.0.0.1:5001/](http://127.0.0.1:5001/) | `index` | 返回 `frontend/dist/index.html`；未构建时返回 503 和构建提示文本 |
| GET | `http://127.0.0.1:5001/{filename}` | `assets` | 在 `frontend/dist/` 内安全读取静态文件；包括 `/assets/…` 及 `/pdf/cmaps/…`、`/pdf/standard_fonts/…`、`/pdf/wasm/…`；文件不存在时返回 404 |

Flask 会为 GET 路由提供标准 HEAD 行为，并默认提供 OPTIONS 响应。开发环境页面和 PDF 辅助资源由 Vite 提供，配置位置为 [vite.config.ts](../frontend/vite.config.ts)。

课程、章节、课件改名／删除、问答、分类、隐藏及排序接口尚未实现。前端页面对应关系见 [前端页面列表](frontend-pages.md)，验证步骤见 [阶段一开发与验收记录](devlog/step1-minimal-workflow.md)。
