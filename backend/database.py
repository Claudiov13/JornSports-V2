from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from config import settings # <-- Importa de nossa configuração centralizada

# Usa create_async_engine para operações assíncronas
engine = create_async_engine(settings.DATABASE_URL)

# Fábrica de sessões assíncronas
SessionLocal = sessionmaker(
    autocommit=False, 
    autoflush=False, 
    bind=engine, 
    class_=AsyncSession
)