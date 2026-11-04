from flask import jsonify, request
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .models import Material, Page

CATEGORIES = ("正文", "封面", "目录", "未讲内容", "拓展知识", "其他")
DISPLAYS = ("normal", "collapsed", "hidden")


def settings_json(page):
    return {"id": page.id, "number": page.number, "category": page.category,
            "display": page.display, "settings_version": page.settings_version}


def register_page_settings(app, engine):
    @app.patch("/api/materials/<material_id>/page-settings")
    def save_page_settings(material_id):
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or set(body) - {"pages", "category", "display"}:
            return jsonify(error="请提供页面版本列表与分类或显示状态。"), 400
        changes = {key: body[key] for key in ("category", "display") if key in body}
        if not changes or ("category" in changes and changes["category"] not in CATEGORIES) or ("display" in changes and changes["display"] not in DISPLAYS):
            return jsonify(error="分类或显示状态无效。"), 400
        items = body.get("pages")
        if not isinstance(items, list) or not items or any(not isinstance(item, dict) or set(item) != {"id", "version"} or not isinstance(item["id"], str) or type(item["version"]) is not int or item["version"] < 0 for item in items):
            return jsonify(error="请提供非空页面列表及有效版本号。"), 400
        ids = [item["id"] for item in items]
        if len(ids) != len(set(ids)):
            return jsonify(error="页面不能重复。"), 400
        with Session(engine) as session:
            if session.get(Material, material_id) is None:
                return jsonify(error="课件不存在。"), 404
            pages = list(session.scalars(select(Page).where(Page.material_id == material_id, Page.id.in_(ids)).order_by(Page.number)))
            if len(pages) != len(ids):
                return jsonify(error="页面不存在或不属于此课件。"), 404
            for item in items:
                result = session.execute(update(Page).where(Page.id == item["id"], Page.settings_version == item["version"]).values(**changes, settings_version=Page.settings_version + 1))
                if result.rowcount != 1:
                    session.rollback()
                    current = list(session.scalars(select(Page).where(Page.material_id == material_id).order_by(Page.number)))
                    return jsonify(error="另一窗口已修改页面属性，本次全部未保存。请核对最新属性后重试。", current=[settings_json(page) for page in current]), 409
            session.commit()
            return jsonify([settings_json(page) for page in pages])
