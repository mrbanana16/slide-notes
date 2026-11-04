import shutil
from uuid import uuid4

from flask import Blueprint, abort, jsonify, request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Chapter, Course, DirectoryState, Material

SYSTEM_COURSE_ID = "00000000000000000000000000000000"


def material_json(material):
    return {"id": material.id, "filename": material.filename, "page_count": material.page_count,
            "course_id": material.course_id, "chapter_id": material.chapter_id, "position": material.position}


def duplicate_json(session, material):
    course = session.get(Course, material.course_id)
    chapter = session.get(Chapter, material.chapter_id) if material.chapter_id else None
    return {**material_json(material), "duplicate": True,
            "location": {"course_name": course.name, "chapter_name": chapter.name if chapter else None}}


def snapshot(session):
    return {"revision": session.get(DirectoryState, 1).revision,
            "courses": [{"id": c.id, "name": c.name, "position": c.position, "is_system": c.is_system} for c in session.scalars(select(Course).order_by(Course.position, Course.id))],
            "chapters": [{"id": c.id, "course_id": c.course_id, "name": c.name, "position": c.position} for c in session.scalars(select(Chapter).order_by(Chapter.position, Chapter.id))],
            "materials": [material_json(m) for m in session.scalars(select(Material).order_by(Material.position, Material.id))]}


def bump(session):
    session.get(DirectoryState, 1).revision += 1


def destination(session, course_id, chapter_id):
    if not isinstance(course_id, str) or session.get(Course, course_id) is None:
        abort(400, description="请选择存在的课程。")
    if chapter_id is not None:
        chapter = session.get(Chapter, chapter_id) if isinstance(chapter_id, str) else None
        if chapter is None or chapter.course_id != course_id:
            abort(400, description="章节必须属于所选课程。")


def register_directory(app, engine, data):
    routes = Blueprint("directory", __name__)

    def body_checked(session):
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or type(body.get("revision")) is not int:
            abort(400, description="请提供目录版本号。")
        if body["revision"] != session.get(DirectoryState, 1).revision:
            abort(409, description="目录已在其他窗口更新，请重新加载目录后再操作；笔记草稿仍保留。")
        return body

    def name_checked(body, key="name"):
        name = body.get(key)
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 200:
            abort(400, description="名称须为 1 至 200 个字符。")
        return name.strip()

    @routes.get("/api/directory")
    def directory():
        with Session(engine) as session:
            return jsonify(snapshot(session))

    @routes.post("/api/courses")
    def create_course():
        with Session(engine) as session, session.begin():
            body = body_checked(session)
            position = session.scalar(select(func.max(Course.position)))
            session.add(Course(name=name_checked(body), position=(position if position is not None else -1) + 1))
            bump(session)
            session.flush()
            return jsonify(snapshot(session)), 201

    @routes.post("/api/chapters")
    def create_chapter():
        with Session(engine) as session, session.begin():
            body = body_checked(session)
            course_id = body.get("course_id")
            destination(session, course_id, None)
            position = session.scalar(select(func.max(Chapter.position)).where(Chapter.course_id == course_id))
            session.add(Chapter(course_id=course_id, name=name_checked(body), position=(position if position is not None else -1) + 1))
            bump(session)
            session.flush()
            return jsonify(snapshot(session)), 201

    @routes.patch("/api/courses/<resource_id>")
    @routes.patch("/api/chapters/<resource_id>")
    @routes.patch("/api/materials/<resource_id>")
    def rename(resource_id):
        model = {"courses": Course, "chapters": Chapter, "materials": Material}[request.path.split("/")[2]]
        with Session(engine) as session, session.begin():
            body = body_checked(session)
            resource = session.get(model, resource_id)
            if resource is None:
                abort(404, description="目录条目不存在。")
            if model is Course and resource.is_system:
                abort(400, description="系统“未分类”固定存在，不能重命名。")
            if model is Material:
                resource.filename = name_checked(body, "filename")
            else:
                resource.name = name_checked(body)
            bump(session)
            session.flush()
            return jsonify(snapshot(session))

    @routes.delete("/api/courses/<resource_id>")
    @routes.delete("/api/chapters/<resource_id>")
    def delete_container(resource_id):
        model = Course if request.path.split("/")[2] == "courses" else Chapter
        with Session(engine) as session, session.begin():
            body_checked(session)
            resource = session.get(model, resource_id)
            if resource is None:
                abort(404, description="目录条目不存在。")
            if model is Course and resource.is_system:
                abort(400, description="系统“未分类”固定存在，不能删除。")
            condition = Material.course_id == resource_id if model is Course else Material.chapter_id == resource_id
            if session.scalar(select(Material.id).where(condition).limit(1)) or (model is Course and session.scalar(select(Chapter.id).where(Chapter.course_id == resource_id).limit(1))):
                abort(409, description="非空课程或章节不能删除，请先移动或删除其内容。")
            session.delete(resource)
            bump(session)
            session.flush()
            return jsonify(snapshot(session))

    @routes.get("/api/materials/<material_id>")
    def material_details(material_id):
        with Session(engine) as session:
            material = session.get(Material, material_id)
            if material is None:
                abort(404, description="课件不存在。")
            notes = sum(bool(p.note.content) + bool(p.note.summary) + sum(not q.deleted for q in p.qa) for p in material.pages)
            return jsonify(**material_json(material), note_count=notes, page_ids=[p.id for p in material.pages])

    @routes.delete("/api/materials/<material_id>")
    def delete_material(material_id):
        source = data / "materials" / material_id
        staged = data / "tmp" / ("delete-" + uuid4().hex)
        moved = False
        committed = False
        try:
            with Session(engine) as session, session.begin():
                body = body_checked(session)
                material = session.get(Material, material_id)
                if material is None:
                    abort(404, description="课件不存在。")
                if body.get("confirmation") != material_id:
                    abort(400, description="请确认删除此课件及其笔记。")
                if source.exists():
                    source.replace(staged)
                    moved = True
                session.delete(material)
                bump(session)
                session.flush()
                result = snapshot(session)
            committed = True
        finally:
            if moved and not committed:
                staged.replace(source)
        if moved:
            shutil.rmtree(staged)
        return jsonify(result)

    @routes.put("/api/directory/order")
    def order():
        with Session(engine) as session, session.begin():
            body = body_checked(session)
            courses = list(session.scalars(select(Course)))
            chapters = list(session.scalars(select(Chapter)))
            materials = list(session.scalars(select(Material)))
            course_ids = body.get("course_ids")
            chapter_ids = body.get("chapter_ids")
            material_ids = body.get("material_ids")

            def exact(ids, expected):
                return isinstance(ids, list) and all(isinstance(i, str) for i in ids) and len(ids) == len(set(ids)) and set(ids) == set(expected)

            if not exact(course_ids, [c.id for c in courses]) or not isinstance(chapter_ids, dict) or not isinstance(material_ids, dict):
                abort(400, description="排序必须完整包含当前目录且不能重复。")
            if set(chapter_ids) != {c.id for c in courses} or set(material_ids) != {c.id for c in courses} | {c.id for c in chapters}:
                abort(400, description="排序的课程或章节集合不完整。")
            if not course_ids or course_ids[0] != SYSTEM_COURSE_ID:
                abort(400, description="系统“未分类”须固定在目录首位。")
            for course in courses:
                owned = [c.id for c in chapters if c.course_id == course.id]
                if not exact(chapter_ids[course.id], owned):
                    abort(400, description="章节不能跨课程移动，且必须完整排序。")
                groups = [course.id, *owned]
                if any(not isinstance(material_ids[key], list) for key in groups):
                    abort(400, description="课件排序必须为列表。")
            flattened = [item for ids in material_ids.values() for item in ids]
            if not exact(flattened, [m.id for m in materials]):
                abort(400, description="课件排序不能遗漏或重复。")
            parent_courses = {c.id: c.id for c in courses} | {c.id: c.course_id for c in chapters}
            material_courses = {m.id: m.course_id for m in materials}
            transfers = [{"material_id": material_id, "from_course_id": material_courses[material_id], "to_course_id": parent_courses[parent_id]}
                         for parent_id, ids in material_ids.items() for material_id in ids if material_courses[material_id] != parent_courses[parent_id]]
            confirmed = body.get("transfers", [])
            if not isinstance(confirmed, list) or any(not isinstance(item, dict) or set(item) != {"material_id", "from_course_id", "to_course_id"} or not all(isinstance(value, str) for value in item.values()) for item in confirmed):
                abort(400, description="请提供有效的跨课程转移确认。")
            if sorted(confirmed, key=lambda item: item["material_id"]) != sorted(transfers, key=lambda item: item["material_id"]):
                abort(409, description="跨课程移动需要确认课件的源课程与目标课程。")
            for index, resource_id in enumerate(course_ids):
                session.get(Course, resource_id).position = index
            for ids in chapter_ids.values():
                for index, resource_id in enumerate(ids):
                    session.get(Chapter, resource_id).position = index
            chapter_set = {c.id for c in chapters}
            for parent_id, ids in material_ids.items():
                for index, resource_id in enumerate(ids):
                    material = session.get(Material, resource_id)
                    material.course_id = parent_courses[parent_id]
                    material.chapter_id = parent_id if parent_id in chapter_set else None
                    material.position = index
            bump(session)
            session.flush()
            return jsonify(snapshot(session))

    app.register_blueprint(routes)
