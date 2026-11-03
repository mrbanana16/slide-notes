import logging
import os
import shutil
from pathlib import Path
from threading import RLock
from time import perf_counter
from uuid import uuid4

from flask import Flask, g, jsonify, request, send_file, send_from_directory
from pypdf import PdfReader
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from werkzeug.exceptions import HTTPException

from .models import Material, Page, PageNote
from .storage import file_hash, migrate_database, reset_storage

BACKEND = Path(__file__).resolve().parents[1]


def create_app(data_dir=None):
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
        if request.path.startswith("/api/"):
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

    def material_json(material):
        return {"id": material.id, "filename": material.filename, "page_count": material.page_count}

    def page_json(page):
        return {"id": page.id, "number": page.number, "note": page.note.content, "version": page.note.version}

    @app.errorhandler(HTTPException)
    def http_error(error):
        message = "文件超过 100 MB 限制。" if error.code == 413 else error.description
        return jsonify(error=message), error.code

    @app.errorhandler(Exception)
    def unexpected_error(error):
        app.logger.exception("Request failed")
        return jsonify(error="服务暂时无法完成操作，请重试。"), 500

    @app.get("/api/materials")
    def list_materials():
        with Session(engine) as session:
            return jsonify([material_json(m) for m in session.scalars(select(Material).order_by(Material.filename, Material.id))])

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
                existing = session.scalar(select(Material).where(Material.content_hash == digest))
                if existing is not None:
                    app.logger.info("Duplicate PDF: material=%s", existing.id)
                    return jsonify(**material_json(existing), duplicate=True), 200
            try:
                with temp.open("rb") as stream:
                    if stream.read(5) != b"%PDF-":
                        return jsonify(error="文件不是有效的 PDF。"), 400
                    stream.seek(0)
                    reader = PdfReader(stream, strict=True)
                    if reader.is_encrypted and not reader.decrypt(""):
                        app.logger.warning("PDF import rejected: opening password required")
                        return jsonify(error="此 PDF 需要打开密码，请先解除密码保护再导入。"), 400
                    count = len(reader.pages)
                    if count == 0:
                        return jsonify(error="PDF 中没有页面。"), 400
                    for page in reader.pages:
                        _ = page.mediabox
            except Exception:
                app.logger.warning("PDF validation failed", exc_info=True)
                return jsonify(error="PDF 已损坏或无法读取，请重新导出后导入。"), 400
            material_id = uuid4().hex
            destination = data / "materials" / material_id
            destination.mkdir()
            temp.replace(destination / "original.pdf")
            with Session(engine) as session, session.begin():
                material = Material(id=material_id, filename=uploaded.filename.replace("\\", "/").split("/")[-1], page_count=count, content_hash=digest)
                material.pages = [Page(number=i, note=PageNote()) for i in range(1, count + 1)]
                session.add(material)
                session.flush()
                result = material_json(material)
            committed = True
            app.logger.info("PDF imported: material=%s pages=%s", material_id, count)
            return jsonify(result), 201
        except IntegrityError:
            with Session(engine) as session:
                existing = session.scalar(select(Material).where(Material.content_hash == digest))
                if existing is not None:
                    return jsonify(**material_json(existing), duplicate=True), 200
            raise
        finally:
            temp.unlink(missing_ok=True)
            if destination is not None and not committed:
                shutil.rmtree(destination, ignore_errors=True)

    @app.post("/api/reset")
    def reset_all_data():
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or body.get("confirmation") != "DELETE_ALL_DATA":
            return jsonify(error="请确认清空全部数据。"), 400
        reset_storage(data, engine)
        app.logger.warning("All application data reset")
        return jsonify(reset=True)

    @app.get("/api/materials/<material_id>/pages")
    def pages(material_id):
        with Session(engine) as session:
            material = session.get(Material, material_id)
            if material is None:
                return jsonify(error="课件不存在。"), 404
            return jsonify([page_json(p) for p in material.pages])

    @app.get("/api/materials/<material_id>/file")
    def file(material_id):
        with Session(engine) as session:
            if session.get(Material, material_id) is None:
                return jsonify(error="课件不存在。"), 404
        return send_file(data / "materials" / material_id / "original.pdf", mimetype="application/pdf", conditional=True)

    @app.put("/api/pages/<page_id>/note")
    def save_note(page_id):
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get("note"), str) or type(body.get("version")) is not int or body["version"] < 0:
            return jsonify(error="请提供笔记文本和有效版本号。"), 400
        if len(body["note"]) > 1_000_000:
            return jsonify(error="笔记不能超过 100 万字符。"), 400
        with Session(engine) as session, session.begin():
            result = session.execute(update(PageNote).where(PageNote.page_id == page_id, PageNote.version == body["version"]).values(content=body["note"], version=PageNote.version + 1))
            if result.rowcount == 0:
                page = session.get(Page, page_id)
                if page is None:
                    return jsonify(error="页面不存在。"), 404
                return jsonify(error="另一窗口已修改此页。你的内容仍保留，请复制备份后重新加载。", current=page_json(page)), 409
            page = session.get(Page, page_id)
            return jsonify(page_json(page))

    dist = BACKEND.parent / "frontend" / "dist"

    @app.get("/")
    def index():
        if not (dist / "index.html").exists():
            return "请先在 frontend 目录执行 npm run build，或启动 Vite 开发服务器。", 503
        return send_from_directory(dist, "index.html")

    @app.get("/<path:filename>")
    def assets(filename):
        return send_from_directory(dist, filename)

    return app
