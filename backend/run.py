import logging
import sys

from waitress import create_server
from slide_notes import create_app


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    logger = logging.getLogger("slide_notes.startup")
    try:
        app = create_app()
        server = create_server(app, host="127.0.0.1", port=5001, threads=4)
    except Exception:
        logger.exception("后端启动失败，请检查端口占用、数据目录权限和依赖。")
        raise
    logger.info("访问地址：http://127.0.0.1:5001")
    logger.info("数据目录：%s", app.config["DATA_DIR"])
    try:
        server.run()
    except KeyboardInterrupt:
        logger.info("正在停止后端服务。")
    finally:
        server.close()


if __name__ == "__main__":
    main()
