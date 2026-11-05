import logging
from unittest.mock import Mock

import pytest

import run


@pytest.fixture(autouse=True)
def open_browser(monkeypatch):
    browser = Mock(return_value=True)
    monkeypatch.setattr(run.webbrowser, 'open', browser)
    return browser


def test_startup_logs_address_after_binding_and_closes_server(monkeypatch, caplog, tmp_path, open_browser):
    app = Mock(config={'DATA_DIR': tmp_path})
    server = Mock()
    server.run.side_effect = KeyboardInterrupt
    monkeypatch.setattr(run, 'create_app', lambda: app)
    def bind_server(*args, **kwargs):
        open_browser.assert_not_called()
        return server

    create_server = Mock(side_effect=bind_server)
    monkeypatch.setattr(run, 'create_server', create_server)
    caplog.set_level(logging.INFO)
    run.main()
    create_server.assert_called_once_with(app, host='127.0.0.1', port=5001, threads=4)
    open_browser.assert_called_once_with('http://127.0.0.1:5001', new=2)
    server.run.assert_called_once()
    server.close.assert_called_once()
    assert '访问地址：http://127.0.0.1:5001' in caplog.text
    assert str(tmp_path) in caplog.text
    assert '正在停止后端服务' in caplog.text


def test_bind_failure_logs_error_without_claiming_server_is_ready(monkeypatch, caplog, open_browser):
    monkeypatch.setattr(run, 'create_app', Mock())
    monkeypatch.setattr(run, 'create_server', Mock(side_effect=OSError('Address already in use')))
    with pytest.raises(OSError):
        run.main()
    assert '后端启动失败' in caplog.text
    assert 'Address already in use' in caplog.text
    assert '访问地址' not in caplog.text
    open_browser.assert_not_called()


@pytest.mark.parametrize('failure', [False, OSError('No browser available')])
def test_browser_failure_keeps_server_running(monkeypatch, caplog, tmp_path, open_browser, failure):
    monkeypatch.setattr(run, 'create_app', lambda: Mock(config={'DATA_DIR': tmp_path}))
    server = Mock()
    monkeypatch.setattr(run, 'create_server', Mock(return_value=server))
    if isinstance(failure, Exception):
        open_browser.side_effect = failure
    else:
        open_browser.return_value = failure
    run.main()
    server.run.assert_called_once()
    server.close.assert_called_once()
    assert '请手动访问 http://127.0.0.1:5001' in caplog.text
