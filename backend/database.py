from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# URL de conexão com o banco de dados PostgreSQL que está no Docker
DATABASE_URL = "postgresql://jornuser:jornpassword@localhost/jornsports"

# Cria o "motor" de conexão do SQLAlchemy
engine = create_engine(DATABASE_URL)

# Cria uma fábrica de sessões para interagir com o banco
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Cria uma classe Base para nossos modelos de tabela
Base = declarative_base()