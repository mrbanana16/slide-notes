from datetime import datetime
from io import BytesIO
from pathlib import Path

import pytest
from pypdf import PdfWriter
from sqlalchemy import select
from sqlalchemy.orm import Session

from slide_notes import create_app
from slide_notes.models import Material


def pdf_bytes(pages=3, encrypted=False):
    writer = PdfWriter()
    for i in range(pages):
        writer.add_blank_page(width=600 if i % 2 else 400, height=400 if i % 2 else 600)
    if encrypted:
        writer.encrypt("test-password")
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


@pytest.fixture
def app(tmp_path):
    app = create_app(tmp_path / "data")
    app.config["TESTING"] = True
    yield app
    app.extensions["engine"].dispose()


def upload(client, content=None, filename="课件.pdf"):
    return client.post("/api/materials", data={"file": (BytesIO(content if content is not None else pdf_bytes()), filename)})


def test_import_save_and_restart(app):
    client = app.test_client()
    material = upload(client).get_json()
    assert material["filename"] == "课件.pdf"
    assert material["page_count"] == 3
    pages = client.get(f'/api/materials/{material["id"]}/pages').get_json()
    assert [page["number"] for page in pages] == [1, 2, 3]
    assert len({page["id"] for page in pages}) == 3
    text = "# 第二页\n理解：中文笔记与 <script>原文</script>"
    response = client.put(f'/api/pages/{pages[1]["id"]}/note', json={"note": text, "version": 0})
    assert response.status_code == 200
    assert response.get_json()["version"] == 1
    app.extensions["engine"].dispose()
    restarted = create_app(app.config["DATA_DIR"])
    try:
        client = restarted.test_client()
        assert client.get('/api/materials').get_json() == [material]
        restored = client.get(f'/api/materials/{material["id"]}/pages').get_json()
        assert [page["id"] for page in restored] == [page["id"] for page in pages]
        assert [page["note"] for page in restored] == ["", text, ""]
        response = client.get(f'/api/materials/{material["id"]}/file')
        assert response.data == pdf_bytes()
        assert response.mimetype == 'application/pdf'
    finally:
        restarted.extensions["engine"].dispose()


@pytest.mark.parametrize("content,filename", [(b'not a pdf', 'fake.pdf'), (b'%PDF-1.7\nbroken', 'broken.pdf'), (pdf_bytes(encrypted=True), 'locked.pdf'), (pdf_bytes(0), 'empty.pdf'), (pdf_bytes(), 'wrong.txt')])
def test_invalid_import_leaves_no_partial_material(app, content, filename):
    client = app.test_client()
    assert upload(client, content, filename).status_code == 400
    assert client.get('/api/materials').get_json() == []
    assert list((app.config['DATA_DIR'] / 'tmp').iterdir()) == []
    assert list((app.config['DATA_DIR'] / 'materials').iterdir()) == []


def test_database_failure_cleans_file(app, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError('simulated database failure')
    monkeypatch.setattr(Session, 'flush', fail)
    assert upload(app.test_client()).status_code == 500
    assert list((app.config['DATA_DIR'] / 'materials').iterdir()) == []
    assert list((app.config['DATA_DIR'] / 'tmp').iterdir()) == []


def test_conflict_preserves_first_save_and_page_binding(app):
    client = app.test_client()
    first = upload(client).get_json()
    second = upload(client, pdf_bytes(pages=2)).get_json()
    page = client.get(f'/api/materials/{first["id"]}/pages').get_json()[0]
    url = f'/api/pages/{page["id"]}/note'
    assert client.put(url, json={"note": "first", "version": 0}).status_code == 200
    response = client.put(url, json={"note": "stale", "version": 0})
    assert response.status_code == 409
    assert response.get_json()['current']['note'] == 'first'
    assert client.get(f'/api/materials/{second["id"]}/pages').get_json()[0]['note'] == ''
    assert client.put(url, json={"note": "", "version": 1}).get_json()['note'] == ''


@pytest.mark.parametrize('body', [None, [], {}, {'note': 123, 'version': 0}, {'note': 'x', 'version': True}, {'note': 'x', 'version': -1}])
def test_invalid_note_payload(app, body):
    assert app.test_client().put('/api/pages/absent/note', json=body).status_code == 400


def test_missing_resources_and_upload_limit(app):
    client = app.test_client()
    assert client.get('/api/materials/absent/pages').status_code == 404
    assert client.get('/api/materials/absent/file').status_code == 404
    assert client.put('/api/pages/absent/note', json={'note': '', 'version': 0}).status_code == 404
    assert client.post('/api/materials').status_code == 400
    app.config['MAX_CONTENT_LENGTH'] = 100
    assert upload(client).status_code == 413


def test_fixed_default_data_path_and_migration(app, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    restarted = create_app(app.config['DATA_DIR'])
    with Session(restarted.extensions['engine']) as session:
        assert list(session.scalars(select(Material))) == []
    restarted.extensions['engine'].dispose()
    assert Path(app.config['DATA_DIR'], 'app.sqlite3').exists()


def test_pdf_range_requests_and_internal_filename(app):
    client = app.test_client()
    material = upload(client, filename='../../课件.pdf').get_json()
    assert material['filename'] == '课件.pdf'
    response = client.get(f'/api/materials/{material["id"]}/file', headers={'Range': 'bytes=0-4'})
    assert response.status_code == 206
    assert response.data == b'%PDF-'
    assert (app.config['DATA_DIR'] / 'materials' / material['id'] / 'original.pdf').exists()


def test_module_assets_use_javascript_mime(app, monkeypatch):
    import slide_notes

    called = {}

    def send_asset(directory, filename, *, mimetype=None):
        called.update(directory=directory, filename=filename, mimetype=mimetype)
        return app.response_class('export {}', content_type=mimetype)

    monkeypatch.setattr(slide_notes, 'send_from_directory', send_asset)
    response = app.test_client().get('/assets/pdf.worker.min-test.MJS')
    assert response.status_code == 200
    assert response.mimetype == 'text/javascript'
    assert called['filename'] == 'assets/pdf.worker.min-test.MJS'
    assert called['mimetype'] == 'text/javascript'


@pytest.mark.parametrize('user_password', ['', 'required-password'])
def test_pdf_open_password_distinct_from_owner_password(app, user_password):
    writer = PdfWriter()
    writer.add_blank_page(width=400, height=600)
    writer.encrypt(user_password=user_password, owner_password='owner-password')
    stream = BytesIO()
    writer.write(stream)
    response = upload(app.test_client(), stream.getvalue())
    if user_password:
        assert response.status_code == 400
        assert '打开密码' in response.get_json()['error']
        assert list((app.config['DATA_DIR'] / 'materials').iterdir()) == []
    else:
        assert response.status_code == 201
        material = response.get_json()
        assert material['page_count'] == 1
        stored = app.test_client().get(f'/api/materials/{material["id"]}/file')
        assert stored.data == stream.getvalue()
        stored.close()


def test_request_and_pdf_diagnostic_logs(app, caplog):
    import logging
    caplog.set_level(logging.INFO)
    client = app.test_client()
    client.get('/api/materials?secret=not-for-logs')
    assert 'GET /api/materials 200' in caplog.text
    assert 'ms' in caplog.text
    assert 'not-for-logs' not in caplog.text
    upload(client, b'%PDF-1.7\nbroken')
    assert 'PDF validation failed' in caplog.text
    assert 'POST /api/materials 400' in caplog.text
    caplog.clear()
    assert upload(client).status_code == 201
    assert 'PDF imported:' in caplog.text
    assert 'pages=3' in caplog.text

def test_runtime_status_reports_one_timezone_aware_start_time(app):
    client = app.test_client()
    response = client.get("/api/status")
    assert response.status_code == 200
    assert response.cache_control.no_store
    data = response.get_json()
    assert data["status"] == "ok"
    assert datetime.fromisoformat(data["started_at"]).utcoffset() is not None
    assert client.get("/api/status").get_json() == data
