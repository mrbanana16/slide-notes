from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("courses",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_table("chapters",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("course_id", sa.String(32), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_table("directory_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
    )
    op.execute(sa.text("INSERT INTO directory_state VALUES (1, 0)"))
    connection = op.get_bind()
    old = connection.execute(sa.text("SELECT id FROM materials ORDER BY filename, id")).scalars().all()
    course_id = uuid4().hex
    if old:
        connection.execute(sa.text("INSERT INTO courses VALUES (:id, '未分类课程', 0)"), {"id": course_id})
    with op.batch_alter_table("materials") as batch:
        batch.add_column(sa.Column("course_id", sa.String(32), nullable=True))
        batch.add_column(sa.Column("chapter_id", sa.String(32), nullable=True))
        batch.add_column(sa.Column("position", sa.Integer(), nullable=False, server_default="0"))
        batch.create_foreign_key("fk_material_course", "courses", ["course_id"], ["id"])
        batch.create_foreign_key("fk_material_chapter", "chapters", ["chapter_id"], ["id"])
    for index, material_id in enumerate(old):
        connection.execute(sa.text("UPDATE materials SET course_id=:course, position=:position WHERE id=:id"),
                           {"course": course_id, "position": index, "id": material_id})
    with op.batch_alter_table("materials") as batch:
        batch.alter_column("course_id", nullable=False, existing_type=sa.String(32))


def downgrade():
    with op.batch_alter_table("materials") as batch:
        batch.drop_constraint("fk_material_course", type_="foreignkey")
        batch.drop_constraint("fk_material_chapter", type_="foreignkey")
        batch.drop_column("course_id")
        batch.drop_column("chapter_id")
        batch.drop_column("position")
    op.drop_table("directory_state")
    op.drop_table("chapters")
    op.drop_table("courses")
