from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("materials", "filename", new_column_name="title")
    op.add_column("materials", sa.Column("original_title", sa.Text(), nullable=True))
    op.add_column("materials", sa.Column("imported_at", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("materials", "imported_at")
    op.drop_column("materials", "original_title")
    op.alter_column("materials", "title", new_column_name="filename")
