from copy import deepcopy
from io import BytesIO
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from slide_notes import create_app
from slide_notes.directory import SYSTEM_COURSE_ID

SYSTEM_COURSE = {"id": SYSTEM_COURSE_ID, "name": "未分类", "position": 0, "is_system": True}
from test_workflow import app, pdf_bytes


def read(client):
    return client.get('/api/directory').get_json()


def write(client, method, url, **body):
    return getattr(client, method)(url, json={'revision': read(client)['revision'], **body})


def course(client, name='课程'):
    result = write(client, 'post', '/api/courses', name=name)
    assert result.status_code == 201
    return result.get_json()['courses'][-1]['id']


def chapter(client, owner, name='章节'):
    result = write(client, 'post', '/api/chapters', name=name, course_id=owner)
    assert result.status_code == 201
    return next(c['id'] for c in result.get_json()['chapters'] if c['name'] == name and c['course_id'] == owner)


def upload_to(client, owner, section=None, pages=1):
    return client.post('/api/materials', data={'file': (BytesIO(pdf_bytes(pages)), '课件.pdf'), 'course_id': owner, 'chapter_id': section or ''})


def order(data):
    return {'revision': data['revision'], 'course_ids': [c['id'] for c in data['courses']],
            'chapter_ids': {c['id']: [ch['id'] for ch in data['chapters'] if ch['course_id'] == c['id']] for c in data['courses']},
            'material_ids': {**{c['id']: [m['id'] for m in data['materials'] if m['course_id'] == c['id'] and m['chapter_id'] is None] for c in data['courses']},
                             **{c['id']: [m['id'] for m in data['materials'] if m['chapter_id'] == c['id']] for c in data['chapters']}}}


def test_structure_order_move_rename_and_restart_keeps_notes(app):
    client = app.test_client()
    c1, c2 = course(client), course(client, '另一课程')
    ch1, ch2 = chapter(client, c1), chapter(client, c1, '第二章')
    m1 = upload_to(client, c1, ch1).get_json()
    m2 = upload_to(client, c1, None, 2).get_json()
    pages = client.get(f'/api/materials/{m1["id"]}/pages').get_json()
    client.put(f'/api/pages/{pages[0]["id"]}/note', json={'version': 0, 'note': '原页笔记'})
    payload = order(read(client))
    payload['course_ids'] = [SYSTEM_COURSE_ID, c2, c1]
    payload['chapter_ids'][c1] = [ch2, ch1]
    payload['material_ids'][ch1] = []
    payload['material_ids'][c1] = []
    payload['material_ids'][ch2] = [m2['id'], m1['id']]
    assert client.put('/api/directory/order', json=payload).status_code == 200
    for kind, resource_id, key in [('courses', c1, 'name'), ('chapters', ch2, 'name'), ('materials', m1['id'], 'filename')]:
        assert write(client, 'patch', f'/api/{kind}/{resource_id}', **{key: '新名称'}).status_code == 200
    restarted = create_app(app.config['DATA_DIR'])
    try:
        restored = restarted.test_client()
        data = read(restored)
        assert [c['id'] for c in data['courses']] == [SYSTEM_COURSE_ID, c2, c1]
        assert [ch['id'] for ch in data['chapters'] if ch['course_id'] == c1] == [ch2, ch1]
        assert [m['id'] for m in data['materials'] if m['chapter_id'] == ch2] == [m2['id'], m1['id']]
        page = restored.get(f'/api/materials/{m1["id"]}/pages').get_json()[0]
        assert page['id'] == pages[0]['id'] and page['note'] == '原页笔记'
        assert restored.get(f'/api/materials/{m1["id"]}/file').data == pdf_bytes(1)
    finally:
        restarted.extensions['engine'].dispose()


def test_reject_invalid_or_stale_order_without_partial_changes(app):
    client = app.test_client()
    c1, c2 = course(client), course(client, '另一课程')
    ch1, ch2 = chapter(client, c1), chapter(client, c2)
    m = upload_to(client, c1, ch1).get_json()['id']
    before = read(client)
    valid = order(before)
    bad = []
    for ids in [[], [c1, c1], [c1, []]]:
        payload = deepcopy(valid); payload['course_ids'] = ids; bad.append(payload)
    payload = deepcopy(valid); payload['chapter_ids'][c1] = [ch2]; payload['chapter_ids'][c2] = [ch1]; bad.append(payload)
    payload = deepcopy(valid); payload['material_ids'][c1] = [m]; bad.append(payload)
    payload = deepcopy(valid); payload['material_ids'][ch1] = [['bad']]; bad.append(payload)
    payload = deepcopy(valid); del payload['material_ids'][ch2]; bad.append(payload)
    payload = deepcopy(valid); payload['material_ids'][ch1] = 'bad'; bad.append(payload)
    for payload in bad:
        assert client.put('/api/directory/order', json=payload).status_code == 400
        assert read(client) == before
    course(client, '并发创建')
    assert client.put('/api/directory/order', json=valid).status_code == 409
    assert client.patch(f'/api/courses/{c1}', json={'revision': before['revision'], 'name': '过期'}).status_code == 409


def test_upload_belongs_to_course_and_duplicate_does_not_move(app):
    client = app.test_client()
    c1, c2 = course(client), course(client, '另一课程')
    ch = chapter(client, c2)
    assert upload_to(client, c1, ch).status_code == 400
    assert upload_to(client, 'missing').status_code == 400
    assert read(client)['materials'] == []
    assert list((app.config['DATA_DIR'] / 'materials').iterdir()) == []
    material = upload_to(client, c1).get_json()
    duplicate = upload_to(client, c2, ch)
    assert duplicate.status_code == 200
    assert duplicate.get_json()['duplicate'] is True
    assert duplicate.get_json()['course_id'] == c1
    assert duplicate.get_json()['id'] == material['id']


@pytest.mark.parametrize('name', ['', '   ', 2, None, 'x' * 201])
def test_name_validation(app, name):
    client = app.test_client()
    assert write(client, 'post', '/api/courses', name=name).status_code == 400
    assert read(client)['courses'] == [SYSTEM_COURSE]


def test_delete_counts_nonempty_guards_and_old_saves_cannot_restore(app):
    client = app.test_client()
    c = course(client); ch = chapter(client, c)
    material = upload_to(client, c, ch).get_json()
    mid = material['id']
    page = client.get(f'/api/materials/{mid}/pages').get_json()[0]
    base = f'/api/pages/{page["id"]}'
    client.put(base + '/note', json={'note': '笔记', 'version': 0})
    client.put(base + '/summary', json={'summary': '总结', 'version': 0})
    client.put(base + '/qa/' + 'a' * 32, json={'question': '问题', 'answer': '回答', 'version': 0})
    detail = client.get(f'/api/materials/{mid}').get_json()
    assert detail['note_count'] == 3 and detail['page_ids'] == [page['id']]
    assert write(client, 'delete', f'/api/courses/{c}').status_code == 409
    assert write(client, 'delete', f'/api/chapters/{ch}').status_code == 409
    assert write(client, 'delete', f'/api/materials/{mid}').status_code == 400
    assert write(client, 'delete', f'/api/materials/{mid}', confirmation=mid).status_code == 200
    assert client.get(f'/api/materials/{mid}/file').status_code == 404
    assert client.put(base + '/note', json={'note': '迟到', 'version': 1}).status_code == 404
    assert client.put(base + '/qa/' + 'b' * 32, json={'question': '', 'answer': '', 'version': 0}).status_code == 404
    assert not (app.config['DATA_DIR'] / 'materials' / mid).exists()
    assert write(client, 'delete', f'/api/courses/{c}').status_code == 409
    assert write(client, 'delete', f'/api/chapters/{ch}').status_code == 200
    assert write(client, 'delete', f'/api/courses/{c}').status_code == 200
    assert read(client)['courses'] == [SYSTEM_COURSE]
    assert upload_to(client, course(client)).status_code == 201


def test_delete_failure_restores_original(app, monkeypatch):
    client = app.test_client(); c = course(client)
    mid = upload_to(client, c).get_json()['id']
    original = Session.flush
    def fail(session, *args, **kwargs):
        if session.deleted:
            raise RuntimeError('simulated database failure')
        return original(session, *args, **kwargs)
    monkeypatch.setattr(Session, 'flush', fail)
    assert write(client, 'delete', f'/api/materials/{mid}', confirmation=mid).status_code == 500
    assert client.get(f'/api/materials/{mid}/file').data == pdf_bytes(1)
    assert read(client)['materials'][0]['id'] == mid


def test_migration_from_step2_keeps_ids_summary_qa_and_order(tmp_path):
    data = tmp_path / 'data'; data.mkdir()
    config = Config(); config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'migrations'))
    config.attributes['data_dir'] = data
    engine = create_engine(f'sqlite:///{data / "app.sqlite3"}')
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, '0003')
        connection.execute(text("INSERT INTO materials VALUES ('m', 'old.pdf', 1, NULL)"))
        connection.execute(text("INSERT INTO pages VALUES ('p', 'm', 1)"))
        connection.execute(text("INSERT INTO page_notes VALUES ('p', '笔记', 7, '总结', 4)"))
        connection.execute(text("INSERT INTO qa_entries VALUES ('q', 'p', '问题', '回答', 0, 2, 0)"))
    engine.dispose()
    upgraded = create_app(data)
    try:
        client = upgraded.test_client(); directory = read(client)
        assert directory['courses'][0]['name'] == '未分类'
        assert directory['materials'][0]['id'] == 'm'
        page = client.get('/api/materials/m/pages').get_json()[0]
        assert (page['id'], page['note'], page['version'], page['summary'], page['summary_version']) == ('p', '笔记', 7, '总结', 4)
        assert page['qa'][0]['id'] == 'q'
        client.post('/api/reset', json={'confirmation': 'DELETE_ALL_DATA'})
        assert read(client) == {'revision': 1, 'courses': [SYSTEM_COURSE], 'chapters': [], 'materials': []}
    finally:
        upgraded.extensions['engine'].dispose()


def test_system_uncategorized_exists_is_protected_and_survives_reset(app):
    client = app.test_client()
    before = read(client)
    assert before['courses'] == [SYSTEM_COURSE]
    assert write(client, 'patch', f'/api/courses/{SYSTEM_COURSE_ID}', name='改名').status_code == 400
    assert write(client, 'delete', f'/api/courses/{SYSTEM_COURSE_ID}').status_code == 400
    c = course(client)
    payload = order(read(client)); payload['course_ids'] = [c, SYSTEM_COURSE_ID]
    assert client.put('/api/directory/order', json=payload).status_code == 400
    upload_to(client, SYSTEM_COURSE_ID)
    client.post('/api/reset', json={'confirmation': 'DELETE_ALL_DATA'})
    assert read(client) == before
    assert write(client, 'delete', f'/api/courses/{SYSTEM_COURSE_ID}').status_code == 400
    restarted = create_app(app.config['DATA_DIR'])
    try:
        assert read(restarted.test_client()) == before
    finally:
        restarted.extensions['engine'].dispose()


def test_cross_course_move_needs_exact_confirmation_and_keeps_all_page_content(app):
    client = app.test_client()
    c = course(client); ch = chapter(client, c)
    material = upload_to(client, SYSTEM_COURSE_ID).get_json()
    mid = material['id']
    page = client.get(f'/api/materials/{mid}/pages').get_json()[0]
    base = f'/api/pages/{page["id"]}'
    client.put(base + '/note', json={'note': '原笔记', 'version': 0})
    client.put(base + '/summary', json={'summary': '原总结', 'version': 0})
    client.put(base + '/qa/' + 'a' * 32, json={'question': '问题', 'answer': '回答', 'version': 0})
    before_pages = client.get(f'/api/materials/{mid}/pages').get_json()
    before = read(client)
    payload = order(before)
    payload['material_ids'][SYSTEM_COURSE_ID] = []
    payload['material_ids'][ch] = [mid]
    assert client.put('/api/directory/order', json=payload).status_code == 409
    assert read(client) == before
    for transfers, status in [
        (True, 400), ([{}], 400),
        ([{'material_id': mid, 'from_course_id': c, 'to_course_id': SYSTEM_COURSE_ID}], 409),
        ([{'material_id': mid, 'from_course_id': SYSTEM_COURSE_ID, 'to_course_id': 'missing'}], 409),
    ]:
        assert client.put('/api/directory/order', json={**payload, 'transfers': transfers}).status_code == status
        assert read(client) == before
    transfer = {'material_id': mid, 'from_course_id': SYSTEM_COURSE_ID, 'to_course_id': c}
    assert client.put('/api/directory/order', json={**payload, 'transfers': [transfer, transfer]}).status_code == 409
    response = client.put('/api/directory/order', json={**payload, 'transfers': [transfer]})
    assert response.status_code == 200
    moved = response.get_json()['materials'][0]
    assert (moved['course_id'], moved['chapter_id']) == (c, ch)
    assert client.get(f'/api/materials/{mid}/pages').get_json() == before_pages
    duplicate = upload_to(client, SYSTEM_COURSE_ID).get_json()
    assert duplicate['location'] == {'course_name': '课程', 'chapter_name': '章节'}
    assert duplicate['id'] == mid
    back = order(read(client)); back['material_ids'][ch] = []; back['material_ids'][SYSTEM_COURSE_ID] = [mid]
    back['transfers'] = [{'material_id': mid, 'from_course_id': c, 'to_course_id': SYSTEM_COURSE_ID}]
    assert client.put('/api/directory/order', json=back).status_code == 200
    assert client.get(f'/api/materials/{mid}/pages').get_json() == before_pages


def test_0004_upgrade_merges_legacy_unclassified_without_losing_chapters_or_notes(tmp_path):
    data = tmp_path / 'data'; data.mkdir()
    config = Config(); config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'migrations'))
    config.attributes['data_dir'] = data
    engine = create_engine(f'sqlite:///{data / "app.sqlite3"}')
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, '0004')
        connection.execute(text("INSERT INTO courses VALUES ('old', '未分类课程', 0), ('other', '正常课程', 1)"))
        connection.execute(text("INSERT INTO chapters VALUES ('chapter', 'old', '旧章节', 0)"))
        connection.execute(text("INSERT INTO materials VALUES ('m', 'old.pdf', 1, NULL, 'old', 'chapter', 0)"))
        connection.execute(text("INSERT INTO pages VALUES ('p', 'm', 1)"))
        connection.execute(text("INSERT INTO page_notes VALUES ('p', '原笔记', 7, '原总结', 4)"))
    engine.dispose()
    upgraded = create_app(data)
    try:
        client = upgraded.test_client(); current = read(client)
        assert current['courses'][0] == SYSTEM_COURSE
        assert [c['id'] for c in current['courses']] == [SYSTEM_COURSE_ID, 'other']
        assert current['chapters'][0]['id'] == 'chapter'
        assert current['chapters'][0]['course_id'] == SYSTEM_COURSE_ID
        assert current['materials'][0]['course_id'] == SYSTEM_COURSE_ID
        assert current['materials'][0]['chapter_id'] == 'chapter'
        page = client.get('/api/materials/m/pages').get_json()[0]
        assert (page['id'], page['note'], page['version'], page['summary'], page['summary_version']) == ('p', '原笔记', 7, '原总结', 4)
    finally:
        upgraded.extensions['engine'].dispose()
