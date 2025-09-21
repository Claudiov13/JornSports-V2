from sqlalchemy import Column, Integer, String, JSON, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()

class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    athlete_name = Column(String, index=True)
    date = Column(DateTime(timezone=True), server_default=func.now())
    dados_atleta = Column(JSON)
    analysis = Column(JSON)