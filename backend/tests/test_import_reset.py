from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import create_engine, text

from slide_notes import create_app
from test_workflow import pdf_bytes, upload


@pytest.fixture
def app(tmp_path):
    app = create_app(tmp_path / 'data')
    yield app
    app.extensions['engine'].dispose()


def test_duplicate_content_preserves_pages_notes_and_file(app):
    client = app.test_client()
    first = upload(client).get_json()
    pages_url = f'/api/materials/{first["id"]}/pages'
    pages = client.get(pages_url).get_json()
    client.put(f'/api/pages/{pages[0]["id"]}/note', json={'note': 'keep this', 'version': 0})
    response = upload(client, filename='renamed.pdf')
    assert response.status_code == 200
    assert response.get_json() == {**first, 'duplicate': True, 'location': {'course_name': '未分类', 'chapter_name': None}}
    assert client.get('/api/materials').get_json() == [first]
    assert client.get(pages_url).get_json()[0]['note'] == 'keep this'
    assert len(list((app.config['DATA_DIR'] / 'materials').iterdir())) == 1
    assert list((app.config['DATA_DIR'] / 'tmp').iterdir()) == []
    changed = upload(client, pdf_bytes(pages=2), filename=first['filename'])
    assert changed.status_code == 201
    assert changed.get_json()['id'] != first['id']


def test_concurrent_duplicate_uploads_create_one_material(app):
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: upload(app.test_client()), range(2)))
    assert sorted(response.status_code for response in results) == [200, 201]
    assert len({response.get_json()['id'] for response in results}) == 1
    assert len(app.test_client().get('/api/materials').get_json()) == 1
    assert len(list((app.config['DATA_DIR'] / 'materials').iterdir())) == 1


def test_reset_rebuilds_database_removes_files_and_can_import_again(app):
    client = app.test_client()
    material = upload(client).get_json()
    page = client.get(f'/api/materials/{material["id"]}/pages').get_json()[0]
    client.put(f'/api/pages/{page["id"]}/note', json={'note': 'private content', 'version': 0})
    data = app.config['DATA_DIR']
    (data / 'tmp' / 'leftover.pdf').write_bytes(b'leftover upload')
    (data / 'unmanaged.txt').write_text('do not delete unrelated files')
    result = client.post('/api/reset', json={'confirmation': 'DELETE_ALL_DATA'}).get_json()
    assert result['reset'] is True
    assert result['directory'] == client.get('/api/directory').get_json()
    assert result['directory']['courses'][0]['is_system'] is True
    assert client.get('/api/materials').get_json() == []
    assert client.get(f'/api/materials/{material["id"]}/file').status_code == 404
    assert client.put(f'/api/pages/{page["id"]}/note', json={'note': 'late save', 'version': 1}).status_code == 404
    assert list((data / 'materials').iterdir()) == []
    assert list((data / 'tmp').iterdir()) == []
    assert not list(data.glob('.reset-*'))
    assert (data / 'unmanaged.txt').read_text() == 'do not delete unrelated files'
    assert b'private content' not in (data / 'app.sqlite3').read_bytes()
    with app.extensions['engine'].connect() as connection:
        for table in ('materials', 'pages', 'page_notes', 'qa_entries'):
            assert connection.scalar(text(f'SELECT count(*) FROM {table}')) == 0
        assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '0007'
    restarted = create_app(data)
    try:
        assert restarted.test_client().get('/api/materials').get_json() == []
        response = upload(restarted.test_client())
        assert response.status_code == 201
        assert response.get_json()['id'] != material['id']
    finally:
        restarted.extensions['engine'].dispose()


@pytest.mark.parametrize('body', [None, {}, {'confirmation': False}, {'confirmation': 'wrong'}])
def test_reset_requires_explicit_confirmation(app, body):
    client = app.test_client()
    material = upload(client).get_json()
    assert client.post('/api/reset', json=body).status_code == 400
    assert client.get('/api/reset').status_code in (404, 405)
    assert client.get('/api/materials').get_json() == [material]


def test_reset_rename_failure_restores_original_database_and_files(app, monkeypatch):
    client = app.test_client()
    material = upload(client).get_json()
    replace = Path.replace
    def fail_once(path, target):
        if path == app.config['DATA_DIR'] / 'materials':
            raise OSError('simulated move failure')
        return replace(path, target)
    monkeypatch.setattr(Path, 'replace', fail_once)
    assert client.post('/api/reset', json={'confirmation': 'DELETE_ALL_DATA'}).status_code == 500
    assert client.get('/api/materials').get_json() == [material]
    response = client.get(f'/api/materials/{material["id"]}/file')
    assert response.data == pdf_bytes()
    response.close()
    assert not list(app.config['DATA_DIR'].glob('.reset-*'))


def test_fingerprint_migration_keeps_legacy_duplicates_and_notes(tmp_path):
    data = tmp_path / 'data'
    data.mkdir()
    engine = create_engine('sqlite:///' + str(data / 'app.sqlite3'))
    config = Config()
    config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'migrations'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, '0001')
    engine.dispose()
    with sqlite3.connect(data / 'app.sqlite3') as connection:
        for i in range(2):
            material_id = f'old-{i}'
            directory = data / 'materials' / material_id
            directory.mkdir(parents=True)
            (directory / 'original.pdf').write_bytes(pdf_bytes(pages=1))
            connection.execute('INSERT INTO materials VALUES (?, ?, ?)', (material_id, 'old.pdf', 1))
            connection.execute('INSERT INTO pages VALUES (?, ?, ?)', (f'page-{i}', material_id, 1))
            connection.execute('INSERT INTO page_notes VALUES (?, ?, ?)', (f'page-{i}', f'note-{i}', 1))
    app = create_app(data)
    try:
        client = app.test_client()
        assert len(client.get('/api/materials').get_json()) == 2
        response = upload(client, pdf_bytes(pages=1))
        assert response.status_code == 200
        assert response.get_json()['id'] == 'old-0'
        for i in range(2):
            assert client.get(f'/api/materials/old-{i}/pages').get_json()[0]['note'] == f'note-{i}'
    finally:
        app.extensions['engine'].dispose()


def test_reset_waits_for_inflight_upload_before_removing_data(app, monkeypatch):
    from threading import Event
    import slide_notes
    original_hash = slide_notes.file_hash
    hashing = Event()
    release = Event()
    resetting = Event()
    def paused_hash(path):
        hashing.set()
        assert release.wait(5)
        return original_hash(path)
    def reset():
        resetting.set()
        return app.test_client().post('/api/reset', json={'confirmation': 'DELETE_ALL_DATA'})
    monkeypatch.setattr(slide_notes, 'file_hash', paused_hash)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending_upload = pool.submit(upload, app.test_client())
        assert hashing.wait(5)
        pending_reset = pool.submit(reset)
        assert resetting.wait(5)
        release.set()
        assert pending_upload.result().status_code == 201
        assert pending_reset.result().status_code == 200
    assert app.test_client().get('/api/materials').get_json() == []
    assert list((app.config['DATA_DIR'] / 'materials').iterdir()) == []
    assert list((app.config['DATA_DIR'] / 'tmp').iterdir()) == []
