from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
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


def test_duplicate_lookup_returns_location_without_importing(app):
    client = app.test_client()
    digest = sha256(pdf_bytes()).hexdigest()
    url = f'/api/materials/duplicates?sha256={digest}'
    assert client.get(url).get_json() is None
    assert client.get('/api/materials/duplicates?sha256=bad').status_code == 400
    original = upload(client).get_json()
    directory = client.get('/api/directory').get_json()
    match = client.get(url)
    assert match.get_json() == {**original, 'duplicate': True, 'location': {'course_name': '未分类', 'chapter_name': None}}
    assert match.cache_control.no_store
    assert client.get('/api/directory').get_json() == directory


def test_explicit_copies_have_distinct_names_pages_and_notes(app):
    client = app.test_client()
    original = upload(client, filename='lecture.pdf').get_json()
    original_page = client.get(f'/api/materials/{original["id"]}/pages').get_json()[0]
    client.put(f'/api/pages/{original_page["id"]}/note', json={'note': 'original only', 'version': 0})
    copies = []
    for number in (1, 2):
        response = client.post('/api/materials', data={
            'file': (BytesIO(pdf_bytes()), 'lecture.pdf'), 'create_copy': 'true',
        })
        assert response.status_code == 201
        copy = response.get_json()
        assert copy['filename'] == f'lecture（副本 {number}）.pdf'
        page = client.get(f'/api/materials/{copy["id"]}/pages').get_json()[0]
        assert page['id'] != original_page['id'] and page['note'] == ''
        copies.append(copy)
    response = client.delete(f'/api/materials/{original["id"]}', json={
        'revision': client.get('/api/directory').get_json()['revision'], 'confirmation': original['id'],
    })
    assert response.status_code == 200
    assert upload(client).get_json()['id'] in {copy['id'] for copy in copies}


def test_reset_backup_restores_database_and_original_pdf(app):
    client = app.test_client()
    original = upload(client).get_json()
    url = f'/api/materials/{original["id"]}'
    pages = client.get(url + '/pages').get_json()
    client.put(f'/api/pages/{pages[0]["id"]}/note', json={'note': 'backed up', 'version': 0})
    result = client.post('/api/reset', json={'confirmation': 'DELETE_ALL_DATA', 'backup': True})
    assert result.status_code == 200
    backup_id = result.get_json()['backup_id']
    assert client.get('/api/backups').get_json() == [backup_id]
    assert client.get('/api/materials').get_json() == []
    assert upload(client, filename='replacement.pdf').status_code == 201
    restore_url = f'/api/backups/{backup_id}/restore'
    assert client.post(restore_url, json={}).status_code == 400
    assert client.post(restore_url, json={'confirmation': 'RESTORE_BACKUP'}).status_code == 200
    assert client.get('/api/materials').get_json() == [original]
    assert client.get(url + '/pages').get_json()[0]['note'] == 'backed up'
    with client.get(url + '/file') as response:
        assert response.data == pdf_bytes()
    assert client.get('/api/backups').get_json() == [backup_id]


def test_missing_original_can_be_restored_without_recreating_pages(app):
    client = app.test_client()
    material = upload(client).get_json()
    base = f'/api/materials/{material["id"]}'
    pages = client.get(base + '/pages').get_json()
    original = app.config['DATA_DIR'] / 'materials' / material['id'] / 'original.pdf'
    original.unlink()
    assert client.get(base + '/file').status_code == 410
    original.write_bytes(b'unreadable PDF')
    assert client.get(base + '/file').status_code == 410
    assert client.put(base + '/file', data={'file': (BytesIO(pdf_bytes(pages=2)), 'wrong.pdf')}).status_code == 409
    assert client.put(base + '/file', data={'file': (BytesIO(pdf_bytes()), 'original.pdf')}).status_code == 200
    assert client.get(base + '/pages').get_json() == pages
    with client.get(base + '/file') as response:
        assert response.data == pdf_bytes()


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
        assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '0008'
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
