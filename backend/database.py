from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from core.config import settings

# Fix for Supabase/Render URLs that use postgres:// instead of postgresql://
db_url = settings.DATABASE_URL
if db_url and db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif db_url and db_url.startswith("postgresql://"):
     db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

# Usa create_async_engine para operações assíncronas
engine = create_async_engine(db_url)

# Fábrica de sessões assíncronas
SessionLocal = sessionmaker(
    autocommit=False, 
    autoflush=False, 
    bind=engine, 
    class_=AsyncSession
)