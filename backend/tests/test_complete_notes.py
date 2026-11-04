import pytest
from sqlalchemy import create_engine, text
from alembic import command
from alembic.config import Config
from pathlib import Path

from slide_notes import create_app
from test_workflow import app, upload


def first_page(client):
    material = upload(client).get_json()
    return material, client.get(f'/api/materials/{material["id"]}/pages').get_json()[0]


def test_summary_note_qa_independent_versions_and_restart(app):
    client = app.test_client()
    material, page = first_page(client)
    base = f'/api/pages/{page["id"]}'
    assert client.put(base + '/note', json={'note': 'old notes', 'version': 0}).status_code == 200
    assert client.put(base + '/summary', json={'summary': '# 总结\n\n|a|b|\n|-|-|\n|1|2|', 'version': 0}).get_json()['summary_version'] == 1
    for index in range(3):
        result = client.put(base + '/qa/' + str(index) * 32, json={'question': f'问题{index}', 'answer': '**回答**', 'version': 0})
        assert result.status_code == 200
        assert result.get_json()['version'] == 1
    restarted = create_app(app.config['DATA_DIR'])
    try:
        restored = restarted.test_client().get(f'/api/materials/{material["id"]}/pages').get_json()
        assert restored[0]['note'] == 'old notes'
        assert restored[0]['version'] == restored[0]['summary_version'] == 1
        assert [entry['question'] for entry in restored[0]['qa']] == ['问题0', '问题1', '问题2']
        assert restored[1]['qa'] == []
        assert restored[1]['summary'] == ''
    finally:
        restarted.extensions['engine'].dispose()


def test_qa_conflict_delete_tombstone_and_page_binding(app):
    client = app.test_client()
    material, page = first_page(client)
    other = client.get(f'/api/materials/{material["id"]}/pages').get_json()[1]
    url = f'/api/pages/{page["id"]}/qa/' + 'a' * 32
    body = {'question': 'q', 'answer': 'a', 'version': 0}
    assert client.put(url, json=body).status_code == 200
    conflict = client.put(url, json=body)
    assert conflict.status_code == 409
    assert conflict.get_json()['current']['answer'] == 'a'
    assert client.put(f'/api/pages/{other["id"]}/qa/' + 'a' * 32, json=body).status_code == 404
    assert client.put(url, json={**body, 'version': 1, 'deleted': True}).get_json()['deleted'] is True
    assert client.get(f'/api/materials/{material["id"]}/pages').get_json()[0]['qa'] == []
    stale = client.put(url, json={**body, 'version': 2})
    assert stale.status_code == 409
    assert stale.get_json()['current']['deleted'] is True
    assert client.put(url, json=body).status_code == 409
    client.post('/api/reset', json={'confirmation': 'DELETE_ALL_DATA'})
    assert client.put(url, json=body).status_code == 404


def test_summary_conflict_and_clear(app):
    client = app.test_client()
    _, page = first_page(client)
    url = f'/api/pages/{page["id"]}/summary'
    assert client.put(url, json={'summary': 'first', 'version': 0}).status_code == 200
    conflict = client.put(url, json={'summary': 'second', 'version': 0})
    assert conflict.status_code == 409
    assert conflict.get_json()['current']['summary'] == 'first'
    assert client.put(url, json={'summary': '', 'version': 1}).get_json()['summary'] == ''


@pytest.mark.parametrize('body', [None, [], {}, {'summary': 2, 'version': 0}, {'summary': '', 'version': True}, {'summary': '', 'version': -1}, {'summary': 'x' * 1_000_001, 'version': 0}])
def test_summary_validation(app, body):
    assert app.test_client().put('/api/pages/missing/summary', json=body).status_code == 400


@pytest.mark.parametrize('body', [None, [], {}, {'question': '', 'answer': '', 'version': True}, {'question': '', 'answer': '', 'version': -1}, {'question': '', 'answer': '', 'version': 0, 'deleted': 'yes'}, {'question': 1, 'answer': '', 'version': 0}, {'question': '', 'answer': 'x' * 1_000_001, 'version': 0}])
def test_qa_validation(app, body):
    assert app.test_client().put('/api/pages/missing/qa/' + 'a' * 32, json=body).status_code == 400


def test_missing_and_invalid_qa_ids(app):
    client = app.test_client()
    body = {'question': '', 'answer': '', 'version': 0}
    assert client.put('/api/pages/missing/qa/bad', json=body).status_code == 400
    assert client.put('/api/pages/missing/qa/' + 'a' * 32, json=body).status_code == 404
    assert client.put('/api/pages/missing/summary', json={'summary': '', 'version': 0}).status_code == 404
    _, page = first_page(client)
    assert client.put(f'/api/pages/{page["id"]}/qa/' + 'a' * 32, json={**body, 'version': 1}).status_code == 404


def test_upgrade_preserves_step1_notes(tmp_path):
    data = tmp_path / 'data'
    data.mkdir()
    path = data / 'app.sqlite3'
    config = Config()
    config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'migrations'))
    config.attributes['data_dir'] = data
    engine = create_engine(f'sqlite:///{path}')
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, '0002')
        connection.execute(text("INSERT INTO materials VALUES ('m', 'old.pdf', 1, NULL)"))
        connection.execute(text("INSERT INTO pages VALUES ('p', 'm', 1)"))
        connection.execute(text("INSERT INTO page_notes VALUES ('p', '原笔记', 7)"))
    engine.dispose()
    app = create_app(data)
    try:
        page = app.test_client().get('/api/materials/m/pages').get_json()[0]
        assert page == {'category': '正文', 'display': 'normal', 'settings_version': 0, 'id': 'p', 'number': 1, 'note': '原笔记', 'version': 7, 'summary': '', 'summary_version': 0, 'qa': []}
    finally:
        app.extensions['engine'].dispose()
