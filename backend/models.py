import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base


Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="coach")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Player(Base):
    __tablename__ = "players"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    first_name = Column(String)
    last_name = Column(String)
    external_ids = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Measurement(Base):
    __tablename__ = "measurements"

    id = Column(Integer, primary_key=True)
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id"))
    metric = Column(String)
    value = Column(Float)
    unit = Column(String)
    recorded_at = Column(DateTime(timezone=True))
    meta = Column(JSON, default={})


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id"))
    level = Column(String)
    metric = Column(String)
    message = Column(String)
    generated_at = Column(DateTime(timezone=True), server_default=func.now())
    payload = Column(JSON, default={})
    acknowledged = Column(Integer, default=0)


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    athlete_name = Column(String, nullable=False)
    dados_atleta = Column(JSON, default={})
    analysis = Column(JSON, default={})
    date = Column(DateTime(timezone=True), server_default=func.now())
