# slide-notes · 课件笔记整理助手

运行在本机的个人学习工作台，围绕 PDF 课件逐页整理与复习笔记。计划支持课程与章节管理、逐页 Markdown 笔记、多条问答、页面分类及折叠隐藏，并提供整理、复习和沉浸整理三种模式。

前端采用 React、TypeScript、Vite 与 PDF.js；后端采用 Flask、SQLAlchemy、Alembic 和 SQLite，日常运行由 Waitress 托管。首版面向本机单人使用，不包含账号、云同步或 AI API 集成。

完整范围与阶段验收标准见 [PLAN.md](PLAN.md)，开发协作规则见 [AGENTS.md](AGENTS.md)。

开发记录、自动化验证与人工验收清单按阶段维护在 [docs/devlog](docs/devlog/)，参见 [阶段一开发与验收记录](docs/devlog/step1-minimal-workflow.md) 和 [阶段二开发与验收记录](docs/devlog/step2-complete-notes.md)。

当前阶段二已获用户确认验收基本通过；功能与验证记录见上述阶段二记录。

## 环境与安装

使用 Python 3.11+ 和 Node.js 22.13+。在项目根目录运行：

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.lock
npm --prefix frontend ci
```

## 本地运行

### 使用 PyCharm 等 IDE 启动

先完成上方依赖安装，再用 PyCharm 打开项目根目录。项目已提供三份共享运行配置：

| 运行配置 | 配置文件 | 作用 |
|---|---|---|
| `frontend_ci` | [.run/frontend_ci.run.xml](.run/frontend_ci.run.xml) | 使用项目 Node.js 执行 `npm ci`，按锁文件安装前端依赖，不构建或启动服务 |
| `frontend_build` | [.run/frontend_build.run.xml](.run/frontend_build.run.xml) | 使用项目 Node.js 运行 `frontend/package.json` 中的 `build`，生成前端静态资源 |
| `backend_run` | [.run/backend_run.run.xml](.run/backend_run.run.xml) | 使用 `Python 3.11 (slide-notes)` 解释器运行 `backend/run.py`，启动 Waitress |

1. 确认后端配置的 Python 解释器指向本项目的 `backend/.venv/bin/python`；重建虚拟环境后，需在 IDE 中重新关联解释器。
2. 确认前端配置的 `project` Node.js 解释器已设置为 Node.js 22.13+。首次导入项目后，在 IDE 的 JavaScript Runtime 设置中确认项目默认 Node.js，不能仅依赖终端 PATH。
3. 首次安装或依赖锁文件变化后先运行 `frontend_ci`，等待安装结束；再运行 `frontend_build`，等待成功退出，再运行 `backend_run`。三份配置没有自动串联；前端代码变化后需重新构建，后端代码变化后需重启后端。
4. 打开 <http://127.0.0.1:5001>。停止服务使用 IDE 的 Stop 按钮。

后端成功绑定端口后，Run 控制台会输出访问地址和数据目录；请求日志包含方法、路径、状态码及耗时，异常另有诊断信息。后端修改后应停止旧进程并重新运行 `backend_run`。

（`frontend_build` 只构建，不会启动 Vite 开发服务器）

### 使用命令启动

先构建前端，再运行本机服务：

```sh
npm --prefix frontend run build
backend/.venv/bin/python backend/run.py
```

打开 <http://127.0.0.1:5001>。服务仅监听本机，使用 Waitress，不启用 Flask 调试模式。每次启动自动执行尚未应用的 Alembic 迁移；升级阶段二后会执行 `0003`，保留已有个人笔记。按 `Ctrl+C` 停止后，用同一命令重启，课件与已保存笔记仍在。

启动后终端会显示访问地址与数据目录，操作时会输出请求日志。后端代码修改后，先停止旧进程，再执行同一启动命令。

开发时分别在两个终端运行：

```sh
backend/.venv/bin/python backend/run.py
```

```sh
npm --prefix frontend run dev
```

开发界面地址以 Vite 输出为准。

## PDF 导入

支持无需输入打开密码即可阅读的 PDF，包括内部带加密标记但可用空密码读取的课件。需要打开密码的文件须先解除密码保护再导入。系统保留上传文件的原始内容。重复导入按文件内容识别，自动打开已有课件并保留笔记；即使改名也不会重复创建。同名但内容不同的文件仍可独立导入。

## 逐页笔记

每页提供「AI 解释与总结」「个人笔记」「追问与 AI 解答」三个独立折叠区，默认仅展开 AI 解释区。总结和回答由你手动输入或粘贴，不调用 AI 服务。问答可添加多条，删除前需确认。

输入框支持 Markdown 源码，点「预览」查看基础排版、表格和代码块；代码块在开头的三个反引号后注明 `python`、`js`、`java` 等语言，即可显示语言标签和语法高亮，未注明或未支持的语言保留原文。预览不执行 HTML、不加载图片。停止输入约 800ms 自动保存，也可使用保存按钮或输入框内的 `⌘S`／`Ctrl+S`。每个笔记对象在本次打开后首次实际编辑前隐藏底部保存提示和按钮，编辑后显示；保存失败以红色提示，恢复草稿与异常状态也会显示。

保存中可继续输入、折叠区域或切换课件；顶部显示未保存页数。网络或服务恢复后点击「重试保存」。未保存草稿留在浏览器本地，在同一标签页、同一地址刷新后重新打开课件可恢复；请保留该标签页，勿清理站点存储。存储失败时会提示，请先保存或复制内容。

多窗口修改同一对象时显示版本冲突和服务器内容，保留你的输入，等待你确认使用服务器版本或用草稿重新保存。已在另一窗口删除的问答不能覆盖恢复，可复制草稿后新建问答。

## 数据位置

默认数据目录固定为 `backend/data/`，不随启动工作目录改变：

```text
backend/data/
├── app.sqlite3
├── materials/<内部课件ID>/original.pdf
└── tmp/
```

可以通过 `SLIDE_NOTES_DATA` 环境变量指定其他绝对路径。升级前已经存在的重复课件会保留，避免丢失各自笔记；升级后继续导入相同内容时会打开其中一份已有课件。文件、数据库和环境文件均在 Git 忽略范围内；请勿将个人课件放入源码目录。

PDF.js worker、中文字体映射、标准字体和 WASM 资源随构建产物本地提供，安装依赖后，日常运行不需要联网。


## 清空全部数据

为方便测试，目录底部提供「清空全部数据」。点击后需再次确认，才会删除所有课件、原始 PDF、已保存笔记和当前窗口草稿，重建空数据库并清理上传临时文件，返回初始页面。该操作无法撤销；取消确认不会删除数据。下载目录中的源文件不受影响。

清空期间暂停当前窗口导入，完成后可以重新导入课件。其他已打开的标签页请刷新，旧页面保存会因记录已删除而失败。清空只处理系统管理的数据库及 `materials/`、`tmp/`，不会删除数据目录中的无关文件。
