from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE pages SET display = 'normal', settings_version = settings_version + 1 WHERE display = 'hidden'")
    op.drop_column("pages", "category")


def downgrade():
    op.add_column("pages", sa.Column("category", sa.Text(), nullable=False, server_default="正文"))
