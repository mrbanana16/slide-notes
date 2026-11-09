from flask import jsonify, request
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .models import Material, Page, valid_version

DISPLAYS = ("normal", "collapsed")

def settings_json(page):
    return {"id": page.id, "number": page.number,
            "display": page.display, "settings_version": page.settings_version}


def register_page_settings(app, engine):
    @app.patch("/api/materials/<material_id>/page-settings")
    def save_page_settings(material_id):
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or set(body) - {"pages", "display"}:
            return jsonify(error="请提供单页版本与折叠或显示状态。"), 400
        if body.get("display") not in DISPLAYS:
            return jsonify(error="页面状态仅支持 normal 或 collapsed。"), 400
        changes = {"display": body["display"]}
        items = body.get("pages")
        if not isinstance(items, list) or len(items) != 1 or any(not isinstance(item, dict) or set(item) != {"id", "version"} or not isinstance(item["id"], str) or not valid_version(item["version"]) for item in items):
            return jsonify(error="请提供一个页面及有效版本号。"), 400
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
                    return jsonify(error="另一窗口已修改页面显示状态，本次未保存。请核对最新状态后重试。", current=[settings_json(page) for page in current]), 409
            session.commit()
            return jsonify([settings_json(page) for page in pages])
