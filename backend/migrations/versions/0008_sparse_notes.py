import hashlib
from pathlib import Path

from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index("uq_materials_content_hash", table_name="materials")
    op.create_index("ix_materials_content_hash", "materials", ["content_hash"])
    connection = op.get_bind()
    root = Path(op.get_context().config.attributes["data_dir"]) / "materials"
    for material_id in connection.execute(sa.text("SELECT id FROM materials WHERE content_hash IS NULL")).scalars().all():
        try:
            with (root / material_id / "original.pdf").open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
        except OSError:
            continue
        connection.execute(sa.text("UPDATE materials SET content_hash = :digest WHERE id = :id"),
                           {"digest": digest, "id": material_id})
    for column in ("personal_note_version", "ai_summary_version"):
        op.add_column("pages", sa.Column(column, sa.Integer(), nullable=False, server_default="0"))
    op.execute("""
        UPDATE pages SET (personal_note_version, ai_summary_version) =
            (SELECT version, summary_version FROM page_notes WHERE page_id = pages.id)
        WHERE id IN (SELECT page_id FROM page_notes)
    """)
    op.execute("DELETE FROM page_notes WHERE content = '' AND summary = ''")
    op.alter_column("page_notes", "content", new_column_name="personal_note")
    op.alter_column("page_notes", "summary", new_column_name="ai_summary")
    op.drop_column("page_notes", "version")
    op.drop_column("page_notes", "summary_version")


def downgrade():
    op.add_column("page_notes", sa.Column("version", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("page_notes", sa.Column("summary_version", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("page_notes", "personal_note", new_column_name="content")
    op.alter_column("page_notes", "ai_summary", new_column_name="summary")
    op.execute("INSERT INTO page_notes (page_id, content, summary) SELECT id, '', '' FROM pages WHERE id NOT IN (SELECT page_id FROM page_notes)")
    op.execute("""
        UPDATE page_notes SET (version, summary_version) =
            (SELECT personal_note_version, ai_summary_version FROM pages WHERE id = page_notes.page_id)
    """)
    op.drop_column("pages", "personal_note_version")
    op.drop_column("pages", "ai_summary_version")
    op.drop_index("ix_materials_content_hash", table_name="materials")
    op.execute("UPDATE materials SET content_hash = NULL WHERE content_hash IS NOT NULL AND id NOT IN (SELECT min(id) FROM materials GROUP BY content_hash)")
    op.create_index("uq_materials_content_hash", "materials", ["content_hash"], unique=True)
