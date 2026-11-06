# 后端接口列表

最后更新：2026-11-05（阶段 5.4，接口已核对）。本文件描述当前实现，每次阶段或迭代开发完成后更新。

## 请求约定与实现位置

- 本机服务基础地址：[http://127.0.0.1:5001](http://127.0.0.1:5001/)，仅监听本机；当前无账号与认证机制。
- 前端统一使用同源 `/api` 路径；开发时 Vite 将其代理到上述后端地址。
- `{material_id}` 和 `{page_id}` 是路径占位符，调用时替换为接口返回的真实 ID。课件 ID、页面 ID 均为稳定字符串 ID；原始页码从 1 开始，不能当作页面 ID 使用。
- JSON 请求使用 `Content-Type: application/json`，文件上传使用 `multipart/form-data`。
- 错误通常返回 `{"error": "错误说明"}`；版本冲突还返回 `current`。未预期的服务错误返回 500，不向前端泄露异常细节。

| 文件 | 作用 |
|---|---|
| [slide_notes/__init__.py](../backend/slide_notes/__init__.py) | `create_app`、路由、请求校验、事务及错误处理 |
| [models.py](../backend/slide_notes/models.py) | Course、Chapter、DirectoryState、Material、Page、PageNote、QAEntry 数据模型 |
| [storage.py](../backend/slide_notes/storage.py) | 数据库迁移初始化、SHA-256 计算、全量清空时的空数据库准备与文件切换／失败恢复 |
| [0002_material_fingerprint.py](../backend/migrations/versions/0002_material_fingerprint.py) | 文件指纹字段及唯一索引；为旧课件回填指纹，保留已有重复课件与笔记 |
| [test_import_reset.py](../backend/tests/test_import_reset.py) | 内容去重、并发导入、旧库迁移、清空确认／重建／失败恢复及与上传串行处理测试 |
| [0001_material_pages.py](../backend/migrations/versions/0001_material_pages.py) | 初始数据库表迁移 |
| [run.py](../backend/run.py) | 配置控制台 INFO 日志，创建 Waitress 服务，绑定成功后输出访问地址及数据目录，记录启动异常并处理停止清理 |
| [test_workflow.py](../backend/tests/test_workflow.py) | 上传、保存、冲突、持久化、清理及文件读取测试 |

## 阶段二数据迁移

`backend/migrations/versions/0003_complete_notes.py` 为 `page_notes` 增加 `summary`、`summary_version`，新增 `qa_entries` 表及页面索引。已有个人笔记、版本与页面 ID 保留；旧页面总结为空、问答为空。所有保存接口沿用数据锁及数据库事务。`backend/tests/test_complete_notes.py` 验证旧库升级、独立版本、持久化、问答删除／冲突和参数校验；该迁移在 `0004` 前执行；全量清空重建使用最新 `0005`。

## 阶段三目录数据与接口

[0004_course_structure.py](../backend/migrations/versions/0004_course_structure.py) 增加 `courses`、`chapters`、`directory_state`，为 `materials` 增加 `course_id`、可空 `chapter_id`、`position`。旧库有课件时创建“未分类课程”，按原文件名／ID 顺序归入课程直属；此为历史 `0004` 行为。后续 [0005_uncategorized_course.py](../backend/migrations/versions/0005_uncategorized_course.py) 为课程增加 `is_system`，创建固定 ID `00000000000000000000000000000000` 的系统“未分类”，固定在首位；将名称为“未分类课程”的旧容器及其章节／课件归并到系统分类，保留章节、课件、页、笔记和问答 ID。新库和清空后也始终存在这个系统分类；空库目录版本为 1。升级递增一次目录版本，避免旧窗口覆盖新结构；不修改已运行过的 `0004` 迁移。

以下接口实现在 [directory.py](../backend/slide_notes/directory.py) 的 `register_directory` 中，沿用 `create_app` 的 API 锁和错误处理；前端主入口为 `App.tsx`，操作 UI 为 `Directory.tsx`，导入弹窗为 `ImportDialog.tsx`。

| 方法 | 路径 | 处理函数 | 作用与参数 | 响应及主要错误 |
|---|---|---|---|---|
| GET | `/api/directory` | `directory` | 查询完整结构；无请求体 | 200：目录快照；500：存储错误 |
| POST | `/api/courses` | `create_course` | JSON `{revision, name}`；新课程追加末尾 | 201：新快照；400：版本／名称类型或长度非法；409：旧版本 |
| POST | `/api/chapters` | `create_chapter` | 目录「＋」及导入弹窗章节下拉共用；JSON `{revision, name, course_id}`；追加到课程末尾 | 201：新快照；400：名称／课程／版本非法；409：旧版本 |
| PATCH | `/api/courses/{id}` | `rename` | JSON `{revision, name}`；系统“未分类”不能改名 | 200：新快照；400：非法参数或系统分类；404：不存在；409：旧版本 |
| PATCH | `/api/chapters/{id}` | `rename` | JSON `{revision, name}`；不修改课程归属 | 同上 |
| PATCH | `/api/materials/{id}` | `rename` | JSON `{revision, filename}`；仅修改显示名称，不改原文件 | 同上 |
| DELETE | `/api/courses/{id}` | `delete_container` | JSON `{revision}`；仅普通空课程可删除，包括不能有空章节；系统分类永久保留 | 200：新快照；400：版本非法或系统分类保护；404：不存在；409：非空或旧版本 |
| DELETE | `/api/chapters/{id}` | `delete_container` | JSON `{revision}`；仅空章节可删除 | 同上 |
| GET | `/api/materials/{id}` | `material_details` | 查询删除影响；无请求体 | 200：课件字段及 `note_count`、`page_ids`；404：不存在 |
| DELETE | `/api/materials/{id}` | `delete_material` | JSON `{revision, confirmation: "课件ID"}`；删除课件及关联笔记／原文件 | 200：新快照；400：版本／确认非法；404：不存在；409：旧版本；500：文件／数据库错误 |
| PUT | `/api/directory/order` | `order` | 完整目录顺序和归属，见下文 | 200：新快照；400：集合不完整／重复／非法类型／章节跨课程／系统分类不在首位；409：旧版本或转移确认不匹配 |

所有名称去除首尾空白后须为 1–200 个字符，允许同名，ID 不变。目录写入需当前整数 `revision`，不接受布尔值；比较失败返回 409 和 `error`，客户端重新 GET 获取当前结构后再操作。每次成功创建／改名／删除／排序递增一次；笔记保存不改变目录版本。无数据变化的合法重排也会递增。JSON 写入均可返回 500，不回显异常详情。

目录快照示例：

```json
{
  "revision": 3,
  "courses": [{"id": "00000000000000000000000000000000", "name": "未分类", "position": 0, "is_system": true}, {"id": "course", "name": "数据结构", "position": 1, "is_system": false}],
  "chapters": [{"id": "chapter", "course_id": "course", "name": "第一章", "position": 0}],
  "materials": [{"id": "material", "filename": "课件.pdf", "page_count": 3, "course_id": "course", "chapter_id": "chapter", "position": 0}]
}
```

课程额外包含 `is_system` 布尔值，首项始终为固定“未分类”。课程、章节分别按 `position`／ID 升序；课件数组按 `position`／ID，使用其归属字段分组后即为组内顺序。课件在旧 GET `/api/materials`、上传及详情响应中同样新增 `course_id`、`chapter_id`、`position` 字段；下方旧材料响应示例展示基础字段，实际包含新增字段。`note_count` 为非空个人笔记数 + 非空总结数 + 未删除问答条数，问答的问题／回答合计一条；`page_ids` 用于前端清理该课件草稿。

排序请求示例（将课件从第一章移动为课程直属）：

```json
{
  "revision": 3,
  "course_ids": ["00000000000000000000000000000000", "course"],
  "chapter_ids": {"00000000000000000000000000000000": [], "course": ["chapter"]},
  "material_ids": {"00000000000000000000000000000000": [], "course": ["material"], "chapter": []},
  "transfers": []
}
```

必须完整包含所有现有课程和章节、所有组（包括空组）与全部课件；每个 ID 只能出现一次。`chapter_ids` 以课程 ID 为键，`material_ids` 以课程／章节 ID 为键。系统分类 ID 必须位于 `course_ids` 首项，实际请求须包含所有课程及其空组。章节仍只能在原课程内排序；课件允许跨课程移动，课程直属使用 `chapter_id: null`。跨课程移动需附带 `transfers` 列表，每条为 `{"material_id": "课件ID", "from_course_id": "源课程ID", "to_course_id": "目标课程ID"}`，必须精确匹配实际转移，不得重复、遗漏或额外声明；无转移时可省略或传 `[]`。确认列表类型／字段非法为 400，与实际变更不匹配为 409，均不写入。前端先经用户确认，再发送该列表。先验证全部集合及确认，再在单一事务中改课程、章节归属与位置；笔记、页面、问答 ID 与原始页码不变。

删除课件先将原文件目录暂存到 `tmp/`，数据库事务失败则移回原目录，成功后移除暂存；页面、总结、笔记和问答级联删除，旧保存请求返回 404，不能重建已删页。前端确认后暂停保存排队，成功清除对应页的本地草稿并忽略迟到响应，失败则保留编辑。测试见 [test_directory.py](../backend/tests/test_directory.py)。

## IDE 启动入口

PyCharm 仅保留共享配置 [`run`](../.run/run.run.xml)，使用项目 Node.js 依次执行 `frontend/package.json` 的 `npm ci`、`npm run build`，两项成功后使用项目 Python 虚拟环境运行 `backend/run.py`，提供上述 `127.0.0.1:5001` 服务。旧 `frontend_ci`、`frontend_build` 已删除，旧 `backend_run` 已替换为 `run`；请停用旧配置和旧进程，重新运行 `run` 并刷新页面。代码更新后同样需停止当前服务并重新运行；单独构建前端不会更新运行中的后端。脚本路径、解释器要求、环境变量、端口及命令方式不变，Python 依赖仍需单独安装。IDE 设置及等效命令见 [README 本地运行](../README.md#本地运行)。启动自动执行尚未应用的迁移（当前 `0006`，为旧页新增正文／正常属性及独立版本）。后端成功绑定端口后通过 Python 标准库 `webbrowser` 调用系统默认浏览器打开首页，IDE 与命令启动均生效；绑定失败不调用浏览器，浏览器调用失败记录警告并继续提供服务。页面、静态资源路由和业务接口未变更。

## 控制台诊断日志

后端入口启用带时间、级别及 logger 名称的 INFO 控制台日志。成功绑定端口后显示访问地址及数据目录；启动失败记录异常，不输出已就绪地址。请求完成时记录方法、路径、状态码和耗时（毫秒），不记录查询参数或笔记正文。PDF 导入成功记录课件 ID 与页数，读取失败记录异常栈，需要打开密码的拒绝记录原因。请求日志代码为 `start_request`、`log_request`，位于 [slide_notes/__init__.py](../backend/slide_notes/__init__.py)。

## 业务接口总表

下表代码位置均在 [slide_notes/__init__.py](../backend/slide_notes/__init__.py) 的对应函数中。

| 方法 | 请求链接（默认本机地址） | 处理函数 | 接口作用 | 前端调用位置 |
|---|---|---|---|---|
| GET | [运行状态](http://127.0.0.1:5001/api/status) | `runtime_status` | 检测服务并返回本次启动时间 | `SystemSettings.tsx` |
| GET | [http://127.0.0.1:5001/api/materials](http://127.0.0.1:5001/api/materials) | `list_materials` | 查询所有课件，按课程 ID、章节 ID、位置、ID 返回扁平列表；界面目录以 `/api/directory` 为准 | [App.tsx](../frontend/src/App.tsx) （兼容查询；当前界面使用 `/api/directory`） |
| POST | [http://127.0.0.1:5001/api/materials](http://127.0.0.1:5001/api/materials) | `upload` | 按内容识别重复文件；重复时返回已有课件，否则校验并创建课件及每页笔记记录 | [App.tsx](../frontend/src/App.tsx) 的 `upload` |
| GET | `http://127.0.0.1:5001/api/materials/{material_id}/pages` | `pages` | 按原始页码查询页面、总结、个人笔记与未删除问答 | [App.tsx](../frontend/src/App.tsx) 的课件加载 effect |
| PATCH | `http://127.0.0.1:5001/api/materials/{material_id}/page-settings` | `page_settings.py` 的 `save_page_settings` | 单页／批量分类及显示状态，独立版本校验，整批事务保存 | `Reader.tsx` 的 `saveSettings` |
| GET | `http://127.0.0.1:5001/api/materials/{material_id}/file` | `file` | 读取课件原始 PDF，供 PDF.js 展示 | [App.tsx](../frontend/src/App.tsx) 的 `getDocument` |
| POST | [http://127.0.0.1:5001/api/reset](http://127.0.0.1:5001/api/reset) | `reset_all_data` | 确认后清空全部课件、笔记和上传文件并重建空数据库 | [App.tsx](../frontend/src/App.tsx) 的 `resetAllData` |
| PUT | `http://127.0.0.1:5001/api/pages/{page_id}/note` | `save_note` | 按版本号保存个人笔记，防止旧版本覆盖 | [NoteEditor.tsx](../frontend/src/NoteEditor.tsx) 的保存状态组件及 `drafts.ts` 的 `save` |
| PUT | `http://127.0.0.1:5001/api/pages/{page_id}/summary` | `save_summary` | 独立版本号保存手动输入的 AI 总结 | `drafts.ts` 的 `save` |
| PUT | `http://127.0.0.1:5001/api/pages/{page_id}/qa/{entry_id}` | `save_qa` | 创建／修改／软删除一条问答，保留删除版本以防旧请求恢复 | `drafts.ts` 的 `save` |

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

表单字段：`file`（PDF）、`course_id`（所属课程 ID）、`chapter_id`（可选章节 ID，空字符串视为无章节）。新界面必须选择课程；为兼容旧调用，省略 `course_id` 时使用固定系统“未分类”，不按名称查找或创建普通课程。提供归属时，课程必须存在、章节必须属于该课程，否则 400；校验失败清理临时文件和本次原文件。重复内容优先返回已有课件，不修改原归属。新导入追加到目标组末尾并递增目录版本，重复导入不递增。

- 文件名须以 `.pdf` 结尾（不区分大小写）；实际内容须为可读取的 PDF。
- 允许空密码即可读取的权限保护 PDF，拒绝需要输入打开密码、损坏及零页 PDF；请求体上限为 100 MiB（界面文案为 100 MB，multipart 开销也计入后端请求上限）。
- 上传文件使用内部 ID 存储，原文件名仅用于展示；对上传原始字节计算 SHA-256，相同内容返回已有课件；同名但内容不同仍创建新课件。
- 校验或数据库写入失败会清理本次临时文件及未完成课件文件。

首次导入成功返回 201：

```json
{"id": "<material_id>", "filename": "课件.pdf", "page_count": 3}
```

重复导入返回 200，包含 `duplicate: true` 和 `location`（`course_name`、可空 `chapter_name`），直接提供已有课件所在位置；不创建新记录／文件，也不修改已有笔记：

```json
{"id": "<existing_material_id>", "filename": "原课件.pdf", "page_count": 3, "duplicate": true, "location": {"course_name": "数据结构", "chapter_name": "第一章"}}
```

数据库唯一指纹索引防止重复创建，同一后端进程内数据 API 串行处理。旧数据库升级时读取已有原文件回填指纹；对已有相同内容只给一条记录建立指纹入口，其余历史重复条目保留原 ID、文件及笔记，不做破坏性合并。缺失原文件的旧记录不参与指纹回填。

主要错误：400（缺少文件、类型不符、损坏、需要打开密码、零页）、413（请求过大）、500（文件或数据库操作异常）。

### GET /api/materials/{material_id}/pages

路径参数：`material_id`，来源于课件列表或上传结果。无需请求体。

成功返回 200，按原始页码升序排列：

```json
[
  {"id": "<page_id>", "number": 1, "category": "正文", "display": "normal", "settings_version": 0, "note": "", "version": 0, "summary": "", "summary_version": 0, "qa": []}
]
```

`note` 为个人笔记原文；`version` 用于个人笔记保存，`summary_version` 独立用于总结保存。`qa` 为按 `position`、ID 排序的未删除问答数组，条目字段见下方问答接口。课件不存在时返回 404。

### PATCH /api/materials/{material_id}/page-settings

代码：[page_settings.py](../backend/slide_notes/page_settings.py) 的 `register_page_settings`／`save_page_settings`。路径参数为课件 ID。

```json
{"pages": [{"id": "<page_id>", "version": 0}], "category": "未讲内容", "display": "collapsed"}
```

`pages` 为非空、不重复的页面 ID 与版本列表，所有页须属于路径课件；`version` 为页面 `settings_version`，须为非负整数（不接受布尔值）。请求仅允许 `pages`、`category`、`display`，后两者至少提供一个。分类枚举：正文、封面、目录、未讲内容、拓展知识、其他；显示枚举：`normal`、`collapsed`、`hidden`。省略某属性则保持原值；null／未知值无效。修改分类不隐式修改显示状态。

成功 200：按原始页码顺序返回本次修改页面的属性数组，每页 `settings_version` 加 1，即使值未改变亦递增。

```json
[{"id": "<page_id>", "number": 1, "category": "未讲内容", "display": "collapsed", "settings_version": 1}]
```

400：字段、枚举、版本、空列表或重复页非法；404：课件不存在或任一页不存在／不属于该课件；409：任一版本过期，整批回滚并返回 `error` 和 `current`（该课件全部页面的最新属性数组）；500：服务异常。版本更新使用数据库条件匹配，发生冲突时已更新的页也回滚。前端冲突后 GET 页面列表，仅合并属性，核对后显式重试；普通保存失败保留原属性，可重新选择重试。

属性版本独立于目录版本、个人笔记、总结、问答版本；不改变 PDF 原文件、页码、页面 ID 或内容对象。折叠／隐藏只是属性，不删除页面。GET 页面列表及笔记／总结成功或冲突中的完整页面对象均带 `category`、`display`、`settings_version`。旧数据库经迁移 `0006` 得到正文／正常／版本 0。

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

成功返回 200 和完整页面对象（包含 `summary`、`summary_version`、`qa`，结构同页面列表中的单页），`note` 为新文本、`version` 加 1；不修改总结或问答版本。

主要错误：400（参数或长度不合法）、404（页面不存在）、409（版本冲突）。冲突响应示例：

```json
{
  "error": "另一窗口已修改此页。你的内容仍保留，请复制备份后重新加载。",
  "current": {"id": "<page_id>", "number": 1, "category": "正文", "display": "normal", "settings_version": 0, "note": "服务器已有笔记", "version": 1, "summary": "", "summary_version": 0, "qa": []}
}
```

### PUT /api/pages/{page_id}/summary

`page_id` 来源于页面列表。请求体：`{"summary": "# 总结", "version": 0}`。

- `summary` 为字符串，允许空文本，最多 1,000,000 字符；`version` 必须是非负整数且不接受布尔值，与 `summary_version` 匹配。
- 成功 200 返回完整页面对象；仅 `summary_version` 加 1，不修改个人笔记和问答。更新使用版本条件避免并发覆盖。
- 400：参数／长度非法；404：页面不存在；409：版本冲突，`current` 为完整页面对象（读取其中的 `summary` 和 `summary_version`）；500：服务异常。
- 无 AI 调用，文本由用户手动输入。

### PUT /api/pages/{page_id}/qa/{entry_id}

`page_id` 来自页面列表；`entry_id` 是前端生成并在本地草稿保留的 32 位小写十六进制 ID。创建和重试均使用同一 ID，避免请求结果丢失后重复创建。

请求体：

```json
{"question": "为什么？", "answer": "**解释**", "version": 0, "deleted": false}
```

- 问题、回答均为必需字符串，各最多 1,000,000 字符，允许空文本。`deleted` 可省略，默认 `false`，提供时必须为布尔值。
- `version` 必须是非负整数且不接受布尔值。新 ID 仅接受版本 0；服务器创建为版本 1，位置追加到该页问答末尾。已有问答必须使用当前版本，每次成功加 1；不同问答版本独立。
- 删除使用同一 PUT，携带当前文本、版本号及 `deleted: true`。数据库保留删除标记与版本，页面列表排除该条记录；已删除 ID 不能恢复，也不能被旧的版本 0 创建请求重建。需要恢复内容时另建新 ID。
- 不支持排序修改；顺序为创建顺序，页面 ID 不可修改。跨页使用已有 ID 返回 404。

成功统一返回 200：

```json
{"id": "<entry_id>", "question": "为什么？", "answer": "**解释**", "position": 1, "version": 1, "deleted": false}
```

400：ID、参数或长度非法；404：页面不存在、问答不属于该页、非零版本对应的问答不存在；409：版本冲突或条目已删除，返回 `error` 和 `current`（结构同成功对象，可能 `deleted: true`）；500：服务异常。冲突不修改数据。清空后的旧页面请求返回 404，不创建记录。

### POST /api/reset

请求体必须为带明确确认值的 JSON：

```json
{"confirmation": "DELETE_ALL_DATA"}
```

成功返回 200：

```json
{"reset": true, "directory": {"revision": 1, "courses": [{"id": "00000000000000000000000000000000", "name": "未分类", "position": 0, "is_system": true}], "chapters": [], "materials": []}}
```

- 先在数据目录内部准备当前迁移版本的空数据库，再释放连接池、切换数据库与存储目录；删除旧数据库、关联 sidecar 文件、上传原文件和临时文件。
- 切换文件中途失败时恢复已移动的原数据库／目录并返回 500；成功时数据库仅保留固定系统“未分类”与初始化目录版本，以及空的 `materials/`、`tmp/`。如清理旧存储失败，接口仍返回 500 并记录异常，不提示清空成功。
- 不删除数据目录内的无关文件，不操作上传来源位置（例如下载目录）的原始文件。
- 通过后端进程内锁与其他数据 API 串行，等待先前上传／保存结束再清空；旧页面 ID 此后无法保存，必须重新导入。
- 该操作不可撤销。缺少或错误确认值返回 400；存储操作失败返回 500。普通 GET 不会触发清空。

## 页面与静态资源路由

下表代码位置同为 [slide_notes/__init__.py](../backend/slide_notes/__init__.py)，不属于业务 API。

| 方法 | 请求路径／链接 | 处理函数 | 作用与返回 |
|---|---|---|---|
| GET | [http://127.0.0.1:5001/](http://127.0.0.1:5001/) | `index` | 返回 `frontend/dist/index.html`；未构建时返回 503 和构建提示文本 |
| GET | `http://127.0.0.1:5001/{filename}` | `assets` | 在 `frontend/dist/` 内安全读取静态文件；包括 `/assets/…` 及 `/pdf/cmaps/…`、`/pdf/standard_fonts/…`、`/pdf/wasm/…`；`.mjs` 模块显式返回 `text/javascript`，文件不存在时返回 404 |

Flask 会为 GET 路由提供标准 HEAD 行为，并默认提供 OPTIONS 响应。后端为 `.mjs` 显式设置 `text/javascript`，不依赖 Windows 与 macOS 不同的本机 MIME 映射；PDF.js worker 可被浏览器按模块脚本加载。开发环境页面和 PDF 辅助资源由 Vite 提供，配置位置为 [vite.config.ts](../frontend/vite.config.ts)。

页面分类及显示状态通过下述属性接口保存；模式／阅读布局／筛选／临时展开由前端管理，没有对应写接口。前端页面对应关系见 [前端页面列表](frontend-pages.md)，验证步骤见 [阶段四开发与验收记录](devlog/step4-reading-modes.md)。

### GET /api/status

处理函数位于 `backend/slide_notes/__init__.py`。无参数或请求体。成功返回 200，例如 `{"status":"ok","started_at":"2026-11-05T02:00:00.000000+00:00"}`，响应禁止缓存。启动时间为本次应用实例创建时的 UTC 时间，刷新查询时保持一致。该接口只报告服务是否能够响应。后端离线时可能没有 HTTP 响应；顶栏断联重试也会查询此接口，成功后刷新目录并重试可恢复的保存请求。前端将连接失败、超时、非成功响应或无效响应显示为检测失败，允许手动重试。
