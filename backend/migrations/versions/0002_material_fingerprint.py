import hashlib
from pathlib import Path

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("materials", sa.Column("content_hash", sa.String(64), nullable=True))
    connection = op.get_bind()
    data = Path(op.get_context().config.attributes["data_dir"])
    seen = set()
    for material_id in connection.execute(sa.text("SELECT id FROM materials ORDER BY id")).scalars():
        path = data / "materials" / material_id / "original.pdf"
        if not path.is_file():
            continue
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest not in seen:
            connection.execute(sa.text("UPDATE materials SET content_hash = :digest WHERE id = :id"), {"digest": digest, "id": material_id})
            seen.add(digest)
    op.create_index("uq_materials_content_hash", "materials", ["content_hash"], unique=True)


def downgrade():
    op.drop_index("uq_materials_content_hash", table_name="materials")
    op.drop_column("materials", "content_hash")
