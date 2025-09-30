from sqlalchemy import Column, Integer, String, JSON, DateTime
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON, func
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
import uuid
from sqlalchemy import Text

Base = declarative_base()

class Player(Base):
    __tablename__ = "players"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    first_name = Column(String)
    last_name = Column(String)
    external_ids = Column(JSON, default={})  # prosoccer_id etc.
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Measurement(Base):
    __tablename__ = "measurements"
    id = Column(Integer, primary_key=True)
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id"))
    metric = Column(String)              # "HRV", "LDH", "CORTISOL", "GPS_SPEED"...
    value = Column(Float)
    unit = Column(String)                # "ms", "U/L", "ng/mL", "km/h"...
    recorded_at = Column(DateTime(timezone=True))
    meta = Column(JSON, default={})  # {source: "labA", sample_id: "..."}

class Alert(Base):
    __tablename__ = "alerts"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id"))
    level = Column(String)       # INFO / WARNING / CRITICAL
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