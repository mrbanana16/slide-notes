import logging
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from time import perf_counter
from uuid import uuid4

from flask import Flask, g, jsonify, request, send_file, send_from_directory
from pypdf import PdfReader
from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session, joinedload, selectinload
from werkzeug.exceptions import HTTPException

from .models import Material, Page, PageNote, QAEntry, valid_version
from .directory import SYSTEM_COURSE_ID, bump, destination as validate_destination, duplicate_json, material_json, register_directory, snapshot
from .page_settings import register_page_settings, settings_json
from .storage import create_backup, file_hash, migrate_database, reset_storage

BACKEND = Path(__file__).resolve().parents[1]
BACKUP_ID = re.compile(r"\d{8}T\d{6}Z-[0-9a-f]{32}")


def find_duplicate(session, digest):
    return session.scalar(select(Material).where(Material.content_hash == digest).order_by(Material.id).limit(1))


def pdf_page_count(path):
    with path.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            raise ValueError("文件不是有效的 PDF。")
        stream.seek(0)
        reader = PdfReader(stream, strict=True)
        if reader.is_encrypted and not reader.decrypt(""):
            raise ValueError("此 PDF 需要打开密码，请先解除密码保护再导入。")
        count = len(reader.pages)
        if count == 0:
            raise ValueError("PDF 中没有页面。")
        for page in reader.pages:
            _ = page.mediabox
        return count


def create_app(data_dir=None):
    started_at = datetime.now(timezone.utc).isoformat()
    data = Path(data_dir or os.environ.get("SLIDE_NOTES_DATA", BACKEND / "data")).resolve()
    data.mkdir(parents=True, exist_ok=True)
    for name in ("materials", "tmp"):
        (data / name).mkdir(exist_ok=True)
    engine = migrate_database(data / "app.sqlite3")
    storage_lock = RLock()
    app = Flask(__name__, static_folder=None)
    app.config.update(MAX_CONTENT_LENGTH=100 * 1024 * 1024)
    app.extensions["engine"] = engine
    app.config["DATA_DIR"] = data

    @app.before_request
    def start_request():
        g.request_started = perf_counter()
        if request.path.startswith("/api/") and request.path != "/api/status":
            storage_lock.acquire()
            g.storage_locked = True

    @app.teardown_request
    def release_storage_lock(error):
        if g.pop("storage_locked", False):
            storage_lock.release()

    @app.after_request
    def log_request(response):
        elapsed = (perf_counter() - g.request_started) * 1000
        level = logging.ERROR if response.status_code >= 500 else logging.WARNING if response.status_code >= 400 else logging.INFO
        app.logger.log(level, "%s %s %s %.1fms", request.method, request.path, response.status_code, elapsed)
        return response

    def qa_json(entry):
        return {"id": entry.id, "question": entry.question, "answer": entry.answer,
                "position": entry.position, "version": entry.version, "deleted": entry.deleted}

    def page_json(page):
        return {**settings_json(page), "note": page.note.personal_note if page.note else "",
                "version": page.personal_note_version, "summary": page.note.ai_summary if page.note else "",
                "summary_version": page.ai_summary_version,
                "qa": [qa_json(entry) for entry in page.qa if not entry.deleted]}

    @app.errorhandler(HTTPException)
    def http_error(error):
        message = "文件超过 100 MB 限制。" if error.code == 413 else error.description
        return jsonify(error=message), error.code

    @app.errorhandler(Exception)
    def unexpected_error(error):
        app.logger.exception("Request failed")
        return jsonify(error="服务暂时无法完成操作，请重试。"), 500

    @app.get("/api/status")
    def runtime_status():
        response = jsonify(status="ok", started_at=started_at)
        response.cache_control.no_store = True
        return response

    @app.get("/api/materials")
    def list_materials():
        with Session(engine) as session:
            return jsonify([material_json(m) for m in session.scalars(select(Material).order_by(Material.course_id, Material.chapter_id, Material.position, Material.id))])

    @app.get("/api/materials/duplicates")
    def check_duplicate():
        digest = request.args.get("sha256", "")
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            return jsonify(error="请提供有效的 SHA-256 文件指纹。"), 400
        with Session(engine) as session:
            existing = find_duplicate(session, digest)
            response = jsonify(duplicate_json(session, existing) if existing is not None else None)
        response.cache_control.no_store = True
        return response

    @app.post("/api/materials")
    def upload():
        uploaded = request.files.get("file")
        if uploaded is None or not uploaded.filename or not uploaded.filename.lower().endswith(".pdf"):
            return jsonify(error="请选择 PDF 文件。"), 400
        temp = data / "tmp" / (uuid4().hex + ".pdf")
        destination = None
        committed = False
        try:
            uploaded.save(temp)
            digest = file_hash(temp)
            with Session(engine) as session:
                existing = find_duplicate(session, digest)
                if existing is not None and request.form.get("create_copy") != "true":
                    app.logger.info("Duplicate PDF: material=%s", existing.id)
                    return jsonify(duplicate_json(session, existing)), 200
            try:
                count = pdf_page_count(temp)
            except ValueError as error:
                return jsonify(error=str(error)), 400
            except Exception:
                app.logger.warning("PDF validation failed", exc_info=True)
                return jsonify(error="PDF 已损坏或无法读取，请重新导出后导入。"), 400
            material_id = uuid4().hex
            destination = data / "materials" / material_id
            destination.mkdir()
            temp.replace(destination / "original.pdf")
            with Session(engine) as session, session.begin():
                course_id = request.form.get("course_id")
                chapter_id = request.form.get("chapter_id") or None
                if course_id is None:
                    course_id = SYSTEM_COURSE_ID
                validate_destination(session, course_id, chapter_id)
                position = session.scalar(select(func.max(Material.position)).where(Material.course_id == course_id, Material.chapter_id == chapter_id))
                filename = uploaded.filename.replace("\\", "/").split("/")[-1]
                if existing is not None:
                    names = {name.casefold() for name in session.scalars(select(Material.filename).where(
                        Material.course_id == course_id, Material.chapter_id == chapter_id))}
                    stem = filename[:-4]
                    number = 1
                    filename = f"{stem}（副本 {number}）.pdf"
                    while filename.casefold() in names:
                        number += 1
                        filename = f"{stem}（副本 {number}）.pdf"
                material = Material(course_id=course_id, chapter_id=chapter_id, position=(position if position is not None else -1) + 1, id=material_id, filename=filename, page_count=count, content_hash=digest)
                session.add(material)
                bump(session)
                session.flush()
                session.execute(insert(Page), [{"material_id": material_id, "number": number} for number in range(1, count + 1)])
                result = material_json(material)
            committed = True
            app.logger.info("PDF imported: material=%s pages=%s", material_id, count)
            return jsonify(result), 201
        finally:
            temp.unlink(missing_ok=True)
            if destination is not None and not committed:
                shutil.rmtree(destination, ignore_errors=True)

    @app.post("/api/reset")
    def reset_all_data():
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or body.get("confirmation") != "DELETE_ALL_DATA":
            return jsonify(error="请确认清空全部数据。"), 400
        if type(body.get("backup", False)) is not bool:
            return jsonify(error="请选择是否创建备份。"), 400
        backup_id = create_backup(data) if body.get("backup") else None
        reset_storage(data, engine)
        app.logger.warning("All application data reset")
        with Session(engine) as session:
            result = {"reset": True, "directory": snapshot(session)}
            if backup_id:
                result["backup_id"] = backup_id
            return jsonify(result)

    @app.get("/api/backups")
    def list_backups():
        root = data / "backups"
        paths = root.iterdir() if root.is_dir() else ()
        return jsonify(sorted((path.name for path in paths if path.is_dir() and BACKUP_ID.fullmatch(path.name)
                               and (path / "app.sqlite3").is_file() and (path / "materials").is_dir()), reverse=True))

    @app.post("/api/backups/<backup_id>/restore")
    def restore_backup(backup_id):
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or body.get("confirmation") != "RESTORE_BACKUP":
            return jsonify(error="请确认用备份替换当前数据。"), 400
        backup = data / "backups" / backup_id
        if not BACKUP_ID.fullmatch(backup_id) or not (backup / "app.sqlite3").is_file() or not (backup / "materials").is_dir():
            return jsonify(error="备份不存在或不完整。"), 404
        reset_storage(data, engine, restore_from=backup)
        with Session(engine) as session:
            return jsonify(directory=snapshot(session))

    @app.get("/api/materials/<material_id>/pages")
    def pages(material_id):
        with Session(engine) as session:
            material = session.get(Material, material_id)
            if material is None:
                return jsonify(error="课件不存在。"), 404
            pages = session.scalars(select(Page).where(Page.material_id == material_id).order_by(Page.number)
                                    .options(joinedload(Page.note), selectinload(Page.qa)))
            return jsonify([page_json(page) for page in pages])

    @app.get("/api/materials/<material_id>/file")
    def file(material_id):
        with Session(engine) as session:
            if session.get(Material, material_id) is None:
                return jsonify(error="课件不存在。"), 404
        path = data / "materials" / material_id / "original.pdf"
        try:
            with path.open("rb") as stream:
                readable = stream.read(5) == b"%PDF-"
            if readable:
                return send_file(path, mimetype="application/pdf", conditional=True)
        except OSError:
            pass
        response = jsonify(error="原始 PDF 丢失或无法读取。")
        response.cache_control.no_store = True
        return response, 410

    @app.put("/api/materials/<material_id>/file")
    def replace_original(material_id):
        uploaded = request.files.get("file")
        if uploaded is None:
            return jsonify(error="请选择原始 PDF 文件。"), 400
        temp = data / "tmp" / (uuid4().hex + ".pdf")
        try:
            with Session(engine) as session, session.begin():
                material = session.get(Material, material_id)
                if material is None:
                    return jsonify(error="课件不存在。"), 404
                uploaded.save(temp)
                digest = file_hash(temp)
                if material.content_hash and material.content_hash != digest:
                    return jsonify(error="所选文件与原始 PDF 内容不一致。"), 409
                try:
                    count = pdf_page_count(temp)
                except Exception:
                    return jsonify(error="所选 PDF 无法读取。"), 400
                if count != material.page_count:
                    return jsonify(error="所选 PDF 页数与原课件不一致。"), 409
                if material.content_hash is None:
                    material.content_hash = digest
                    session.flush()
                folder = data / "materials" / material_id
                folder.mkdir(exist_ok=True)
                temp.replace(folder / "original.pdf")
                return jsonify(restored=True)
        finally:
            temp.unlink(missing_ok=True)

    @app.put("/api/pages/<page_id>/note", defaults={"field": "note"})
    @app.put("/api/pages/<page_id>/summary", defaults={"field": "summary"})
    def save_page_text(page_id, field):
        body = request.get_json(silent=True)
        label = "笔记" if field == "note" else "总结"
        if not isinstance(body, dict) or not isinstance(body.get(field), str) or not valid_version(body.get("version")):
            return jsonify(error=f"请提供{label}文本和有效版本号。"), 400
        if len(body[field]) > 1_000_000:
            return jsonify(error=f"{label}不能超过 100 万字符。"), 400
        column = "personal_note" if field == "note" else "ai_summary"
        version = getattr(Page, column + "_version")
        with Session(engine) as session, session.begin():
            result = session.execute(update(Page).where(Page.id == page_id, version == body["version"]).values({version: version + 1}))
            page = session.get(Page, page_id)
            if page is None:
                return jsonify(error="页面不存在。"), 404
            if result.rowcount == 0:
                return jsonify(error=f"另一窗口已修改{label}，请处理版本冲突。", current=page_json(page)), 409
            if page.note is None and body[field]:
                page.note = PageNote(personal_note="", ai_summary="")
            if page.note is not None:
                setattr(page.note, column, body[field])
                if not page.note.personal_note and not page.note.ai_summary:
                    page.note = None
            return jsonify(page_json(page))


    @app.put("/api/pages/<page_id>/qa/<entry_id>")
    def save_qa(page_id, entry_id):
        body = request.get_json(silent=True)
        if not re.fullmatch(r"[0-9a-f]{32}", entry_id):
            return jsonify(error="问答 ID 必须是 32 位小写十六进制字符串。"), 400
        if not isinstance(body, dict) or not valid_version(body.get("version")) or not all(isinstance(body.get(key), str) and len(body[key]) <= 1_000_000 for key in ("question", "answer")) or type(body.get("deleted", False)) is not bool:
            return jsonify(error="请提供问题、回答、有效版本号和可选删除标记，文本各不超过 100 万字符。"), 400
        with Session(engine) as session, session.begin():
            if session.get(Page, page_id) is None:
                return jsonify(error="页面不存在。"), 404
            entry = session.get(QAEntry, entry_id)
            if entry is not None and entry.page_id != page_id:
                return jsonify(error="问答不属于此页。"), 404
            if entry is None:
                if body["version"] != 0:
                    return jsonify(error="问答不存在。"), 404
                position = session.scalar(select(func.max(QAEntry.position)).where(QAEntry.page_id == page_id))
                entry = QAEntry(id=entry_id, page_id=page_id, position=(position or 0) + 1,
                                question=body["question"], answer=body["answer"], version=1, deleted=body.get("deleted", False))
                session.add(entry)
                session.flush()
            else:
                result = session.execute(update(QAEntry).where(QAEntry.id == entry_id, QAEntry.version == body["version"], QAEntry.deleted.is_(False)).values(question=body["question"], answer=body["answer"], deleted=body.get("deleted", False), version=QAEntry.version + 1))
                if result.rowcount == 0:
                    session.refresh(entry)
                    return jsonify(error="另一窗口已修改或删除问答，请处理版本冲突。", current=qa_json(entry)), 409
                session.refresh(entry)
            return jsonify(qa_json(entry))

    register_directory(app, engine, data)
    register_page_settings(app, engine)

    dist = BACKEND.parent / "frontend" / "dist"

    @app.get("/")
    def index():
        if not (dist / "index.html").exists():
            return "请先在 frontend 目录执行 npm run build，或启动 Vite 开发服务器。", 503
        return send_from_directory(dist, "index.html")

    @app.get("/<path:filename>")
    def assets(filename):
        mimetype = "text/javascript" if filename.lower().endswith(".mjs") or filename.lower().endswith(".js") else None
        return send_from_directory(dist, filename, mimetype=mimetype)

    return app
