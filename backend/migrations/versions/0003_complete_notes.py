from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("page_notes", sa.Column("summary", sa.Text(), nullable=False, server_default=""))
    op.add_column("page_notes", sa.Column("summary_version", sa.Integer(), nullable=False, server_default="0"))
    op.create_table("qa_entries",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("page_id", sa.String(32), sa.ForeignKey("pages.id"), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_qa_entries_page_id", "qa_entries", ["page_id"])


def downgrade():
    op.drop_table("qa_entries")
    op.drop_column("page_notes", "summary_version")
    op.drop_column("page_notes", "summary")
