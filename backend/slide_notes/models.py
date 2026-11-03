from uuid import uuid4

from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def new_id():
    return uuid4().hex


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = (Index("uq_materials_content_hash", "content_hash", unique=True),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    filename: Mapped[str] = mapped_column(Text)
    page_count: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pages: Mapped[list["Page"]] = relationship(cascade="all, delete-orphan", order_by="Page.number")


class Page(Base):
    __tablename__ = "pages"
    __table_args__ = (UniqueConstraint("material_id", "number"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    material_id: Mapped[str] = mapped_column(ForeignKey("materials.id"))
    number: Mapped[int] = mapped_column(Integer)
    note: Mapped["PageNote"] = relationship(cascade="all, delete-orphan", single_parent=True)


class PageNote(Base):
    __tablename__ = "page_notes"
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id"), primary_key=True)
    content: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=0)
