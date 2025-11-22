import logging
import os
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from models import Base
from database import engine
from core.config import settings
from routers import auth, reports, players, ingest, ai

# ------------------------------------------------------------------------------
# Configuração Básica
# ------------------------------------------------------------------------------

app = FastAPI(title="Jorn Sports API", version="1.0.0")
logger = logging.getLogger("uvicorn")

# Servir arquivos estáticos
app.mount("/public", StaticFiles(directory="../public"), name="public")

# Rota raiz para servir o index.html
@app.get("/")
async def read_index():
    return FileResponse(os.path.join("../public", "index.html"))

@app.on_event("startup")
async def on_startup():
    logger.info("Verificando e criando tabelas do banco de dados...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Tabelas do banco de dados prontas.")
    
    logger.info(f"GEMINI_API_URL em uso: {settings.GEMINI_API_URL}")
    if "/v1beta/" in settings.GEMINI_API_URL:
        logger.warning("GEMINI_API_URL está em v1beta. Verifique se isso é intencional.")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth.router)
app.include_router(reports.router)
app.include_router(players.router)
app.include_router(ingest.router)
app.include_router(ai.router)
