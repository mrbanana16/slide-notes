from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("materials", sa.Column("id", sa.String(32), primary_key=True), sa.Column("filename", sa.Text(), nullable=False), sa.Column("page_count", sa.Integer(), nullable=False))
    op.create_table("pages", sa.Column("id", sa.String(32), primary_key=True), sa.Column("material_id", sa.String(32), sa.ForeignKey("materials.id"), nullable=False), sa.Column("number", sa.Integer(), nullable=False), sa.UniqueConstraint("material_id", "number"))
    op.create_table("page_notes", sa.Column("page_id", sa.String(32), sa.ForeignKey("pages.id"), primary_key=True), sa.Column("content", sa.Text(), nullable=False), sa.Column("version", sa.Integer(), nullable=False))


def downgrade():
    op.drop_table("page_notes")
    op.drop_table("pages")
    op.drop_table("materials")
