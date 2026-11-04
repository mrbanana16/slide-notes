from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("pages", sa.Column("category", sa.Text(), nullable=False, server_default="正文"))
    op.add_column("pages", sa.Column("display", sa.Text(), nullable=False, server_default="normal"))
    op.add_column("pages", sa.Column("settings_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    for name in ("settings_version", "display", "category"):
        op.drop_column("pages", name)
