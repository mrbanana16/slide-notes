from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

SYSTEM_COURSE_ID = "00000000000000000000000000000000"


def upgrade():
    op.add_column("courses", sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()))
    connection = op.get_bind()
    connection.execute(sa.text("UPDATE courses SET position = position + 1"))
    connection.execute(sa.text("INSERT INTO courses (id, name, position, is_system) VALUES (:id, '未分类', 0, 1)"), {"id": SYSTEM_COURSE_ID})
    old_courses = connection.execute(sa.text("SELECT id FROM courses WHERE name = '未分类课程' AND is_system = 0 ORDER BY position, id")).scalars().all()
    position = 0
    chapter_position = 0
    for old_id in old_courses:
        materials = connection.execute(sa.text("SELECT id FROM materials WHERE course_id = :id AND chapter_id IS NULL ORDER BY position, id"), {"id": old_id}).scalars().all()
        for material_id in materials:
            connection.execute(sa.text("UPDATE materials SET position = :position WHERE id = :id"), {"id": material_id, "position": position})
            position += 1
        chapters = connection.execute(sa.text("SELECT id FROM chapters WHERE course_id = :id ORDER BY position, id"), {"id": old_id}).scalars().all()
        for chapter_id in chapters:
            connection.execute(sa.text("UPDATE chapters SET course_id = :course, position = :position WHERE id = :id"), {"course": SYSTEM_COURSE_ID, "id": chapter_id, "position": chapter_position})
            chapter_position += 1
        connection.execute(sa.text("UPDATE materials SET course_id = :course WHERE course_id = :old"), {"course": SYSTEM_COURSE_ID, "old": old_id})
        connection.execute(sa.text("DELETE FROM courses WHERE id = :id"), {"id": old_id})
    connection.execute(sa.text("UPDATE directory_state SET revision = revision + 1"))


def downgrade():
    op.drop_column("courses", "is_system")
