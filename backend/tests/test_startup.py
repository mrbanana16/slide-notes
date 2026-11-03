import logging
from unittest.mock import Mock

import pytest

import run


def test_startup_logs_address_after_binding_and_closes_server(monkeypatch, caplog, tmp_path):
    app = Mock(config={'DATA_DIR': tmp_path})
    server = Mock()
    server.run.side_effect = KeyboardInterrupt
    monkeypatch.setattr(run, 'create_app', lambda: app)
    create_server = Mock(return_value=server)
    monkeypatch.setattr(run, 'create_server', create_server)
    caplog.set_level(logging.INFO)
    run.main()
    create_server.assert_called_once_with(app, host='127.0.0.1', port=5001, threads=4)
    server.run.assert_called_once()
    server.close.assert_called_once()
    assert '访问地址：http://127.0.0.1:5001' in caplog.text
    assert str(tmp_path) in caplog.text
    assert '正在停止后端服务' in caplog.text


def test_bind_failure_logs_error_without_claiming_server_is_ready(monkeypatch, caplog):
    monkeypatch.setattr(run, 'create_app', Mock())
    monkeypatch.setattr(run, 'create_server', Mock(side_effect=OSError('Address already in use')))
    with pytest.raises(OSError):
        run.main()
    assert '后端启动失败' in caplog.text
    assert 'Address already in use' in caplog.text
    assert '访问地址' not in caplog.text
