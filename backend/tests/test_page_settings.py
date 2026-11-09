from io import BytesIO

import pytest

from slide_notes import create_app
from test_workflow import app, pdf_bytes


def setup_pages(client, count=3):
    material = client.post('/api/materials', data={'file': (BytesIO(pdf_bytes(count)), 'pages.pdf')}).get_json()
    url = f'/api/materials/{material["id"]}/pages'
    return material, url, client.get(url).get_json()


def payload(pages, **changes):
    return {'pages': [{'id': page['id'], 'version': page['settings_version']} for page in pages], **changes}


def test_display_settings_keep_ids_notes_qa_and_survive_restart(app):
    client = app.test_client()
    material, url, pages = setup_pages(client)
    first = pages[0]
    client.put(f'/api/pages/{first["id"]}/note', json={'note': 'stable note', 'version': 0})
    client.put(f'/api/pages/{first["id"]}/summary', json={'summary': 'summary', 'version': 0})
    client.put(f'/api/pages/{first["id"]}/qa/{"a" * 32}', json={'question': 'Q', 'answer': 'A', 'version': 0})
    settings_url = f'/api/materials/{material["id"]}/page-settings'
    result = client.patch(settings_url, json=payload(pages[:1], display='collapsed'))
    assert result.status_code == 200
    assert [page['settings_version'] for page in result.get_json()] == [1]
    assert client.patch(settings_url, json=payload(result.get_json(), display='normal')).status_code == 200
    app.extensions['engine'].dispose()
    restarted = create_app(app.config['DATA_DIR'])
    try:
        restored = restarted.test_client().get(url).get_json()
        assert [p['id'] for p in restored] == [p['id'] for p in pages]
        assert [p['number'] for p in restored] == [1, 2, 3]
        assert restored[0]['note'] == 'stable note'
        assert restored[0]['summary'] == 'summary'
        assert restored[0]['qa'][0]['answer'] == 'A'
        assert restored[0]['version'] == restored[0]['summary_version'] == 1
        assert restored[0]['settings_version'] == 2
        assert 'category' not in restored[0]
        assert restored[0]['display'] == 'normal'
        assert restored[2]['display'] == 'normal'
    finally:
        restarted.extensions['engine'].dispose()


def test_stale_display_does_not_affect_notes(app):
    client = app.test_client()
    material, url, pages = setup_pages(client)
    target = f'/api/materials/{material["id"]}/page-settings'
    assert client.patch(target, json=payload(pages[:1], display='collapsed')).status_code == 200
    result = client.patch(target, json=payload(pages[:1], display='normal'))
    assert result.status_code == 409
    current = client.get(url).get_json()
    assert current[0]['display'] == 'collapsed'
    assert current[0]['settings_version'] == 1
    assert client.patch(target, json=payload(current[:1], display='normal')).status_code == 200
    assert client.put(f'/api/pages/{pages[0]["id"]}/note', json={'note': 'independent', 'version': 0}).status_code == 200


@pytest.mark.parametrize('change', [
    {}, {'category': 'unknown'}, {'display': 'delete'}, {'category': None},
    {'display': True}, {'display': 'hidden'}, {'note': 'should not edit'}, {'category': []},
])
def test_invalid_changes_do_not_write(app, change):
    client = app.test_client()
    material, url, pages = setup_pages(client)
    assert client.patch(f'/api/materials/{material["id"]}/page-settings', json=payload(pages[:1], **change)).status_code == 400
    assert client.get(url).get_json() == pages


def test_wrong_material_duplicate_ids_and_invalid_versions_are_atomic(app):
    client = app.test_client()
    material, url, pages = setup_pages(client)
    other, _, other_pages = setup_pages(client, 2)
    target = f'/api/materials/{material["id"]}/page-settings'
    assert client.patch(target, json=payload(other_pages[:1], display='collapsed')).status_code == 404
    assert client.patch(target, json=payload([pages[0], pages[0]], display='collapsed')).status_code == 400
    for bad in (True, -1, '0', None, 2**63 - 1, 2**63):
        assert client.patch(target, json={'pages': [{'id': pages[0]['id'], 'version': bad}], 'display': 'collapsed'}).status_code == 400
    assert client.patch(target, json={'pages': [], 'display': 'collapsed'}).status_code == 400
    assert client.patch('/api/materials/missing/page-settings', json=payload(pages[:1], display='collapsed')).status_code == 404
    assert client.get(url).get_json() == pages


def test_upgrade_restores_hidden_pages_and_retains_collapsed_pages(app):
    from sqlalchemy import text

    client = app.test_client()
    material, url, pages = setup_pages(client)
    client.put(f'/api/pages/{pages[0]["id"]}/note', json={'note': 'legacy note', 'version': 0})
    with app.extensions['engine'].begin() as connection:
        connection.execute(text("ALTER TABLE pages ADD COLUMN category TEXT NOT NULL DEFAULT '正文'"))
        connection.execute(text("UPDATE pages SET display='hidden' WHERE id=:id"), {'id': pages[0]['id']})
        connection.execute(text("UPDATE pages SET display='collapsed' WHERE id=:id"), {'id': pages[1]['id']})
        connection.execute(text("UPDATE alembic_version SET version_num='0006'"))
    app.extensions['engine'].dispose()
    restarted = create_app(app.config['DATA_DIR'])
    try:
        restored = restarted.test_client().get(url).get_json()
        assert [page['id'] for page in restored] == [page['id'] for page in pages]
        assert [page['display'] for page in restored] == ['normal', 'collapsed', 'normal']
        assert restored[0]['note'] == 'legacy note'
        assert restored[0]['settings_version'] == 1
        assert all('category' not in page for page in restored)
    finally:
        restarted.extensions['engine'].dispose()
