import bleach
import os
import httpx
import json
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import Literal
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import UploadFile, File
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import csv, io
from datetime import datetime, timezone, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import insert, select
import logging
from models import Base            # <- para usar Base.metadata.create_all no startup
from database import engine 

# Importa as configurações do banco de dados e os modelos de tabela
import models
from database import engine, SessionLocal

#Funçao lógica agora importada em local diferente para fácil manuntenção
from services.evaluation import evaluate_athlete

from config import settings

# Carrega as variáveis de ambiente do arquivo .env (ex: GEMINI_API_KEY)
load_dotenv()

# Inicia a aplicação FastAPI
app = FastAPI()

logger = logging.getLogger("uvicorn")

app.mount("/public", StaticFiles(directory="../public"), name="public")

# rota raiz para servir o index.html
@app.get("/")
async def read_index():
    return FileResponse(os.path.join("../public", "index.html"))
    
@app.on_event("startup")
async def on_startup():
    logger.info("Verificando e criando tabelas do banco de dados...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Tabelas do banco de dados prontas.")
    # 👇 LOG ÚTIL: confirma que está em v1 (e não v1beta)
    logger.info(f"GEMINI_API_URL em uso: {settings.GEMINI_API_URL}")
    if "/v1beta/" in settings.GEMINI_API_URL:
        logger.error("GEMINI_API_URL está em v1beta — isso vai dar 404. Corrija o .env para /v1/ ...")
    """
    Esta função será executada uma vez, quando o servidor FastAPI iniciar.
    Ela cria as tabelas do banco de dados de forma assíncrona.
    """
    print("INFO:     Verificando e criando tabelas do banco de dados...")
    async with engine.begin() as conn:
        # A forma correta de rodar a criação de tabelas com um engine assíncrono
        await conn.run_sync(models.Base.metadata.create_all)
    print("INFO:     Tabelas do banco de dados prontas.")

# 1. Lemos a string do arquivo de configuração.
# 2. Usamos .split() para criar a lista de origens.
origins = settings.ALLOWED_ORIGINS.split()

# Configuração do CORS para permitir a comunicação com o frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # 3. Usamos a lista que acabamos de criar.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# DEPENDÊNCIA DO BANCO DE DADOS
# ==============================================================================

# Função que fornece uma sessão do banco de dados para as rotas da API
async def get_db():
    async with SessionLocal() as session:
        yield session
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)
ACCESS_TOKEN_EXPIRE_HOURS = 8


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except ValueError:
        return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire_delta = expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    expire = datetime.now(timezone.utc) + expire_delta
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


async def get_user_by_email(db: AsyncSession, email: str):
    normalized_email = email.lower()
    result = await db.execute(select(models.User).where(models.User.email == normalized_email))
    return result.scalar_one_or_none()


async def authenticate_user(db: AsyncSession, email: str, password: str):
    user = await get_user_by_email(db, email)
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    email = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = await get_user_by_email(db, email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user

# ==============================================================================
# MODELOS PYDantic (Estrutura de Dados para a API)
# ==============================================================================

# Modelo para criar um novo relatório no banco de dados
class ReportCreate(BaseModel):
    athleteName: str
    dados: dict
    analysis: dict
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int

# Modelo para receber os dados do formulário para a análise da IA
class AthleteData(BaseModel):
    # Dados obrigatórios com validação de regras
    nome: str = Field(..., min_length=2, pattern=r"^[a-zA-Z\s]+$")
    sobrenome: str = Field(..., min_length=2, pattern=r"^[a-zA-Z\s]+$")
    idade: int = Field(..., gt=4, lt=50)
    posicao_atual: Literal[
        "goleiro", "zagueiro", "lateral", "volante", "meia", "ponta", "atacante"
    ]
    altura: int = Field(..., gt=100, lt=230, title="Altura em centímetros")
    peso: float = Field(..., gt=20, lt=150, title="Peso em quilogramas")
    pe_dominante: Literal["direito", "esquerdo", "ambidestro"]
    
    # Habilidades técnicas (0 a 10)
    controle_bola: int = Field(..., ge=0, le=10)
    drible: int = Field(..., ge=0, le=10)
    passe_curto: int = Field(..., ge=0, le=10)
    passe_longo: int = Field(..., ge=0, le=10)
    finalizacao: int = Field(..., ge=0, le=10)
    cabeceio: int = Field(..., ge=0, le=10)
    desarme: int = Field(..., ge=0, le=10)
    visao_jogo: int = Field(..., ge=0, le=10)
    compostura: int = Field(..., ge=0, le=10)
    agressividade: int = Field(..., ge=0, le=10)

    # Dados Opcionais
    envergadura: int | None = Field(None, gt=100, lt=250)
    percentual_gordura: float | None = Field(None, gt=2, lt=50)
    velocidade_sprint: float | None = Field(None, gt=1, lt=10)
    salto_vertical: int | None = Field(None, gt=10, lt=150)
    agilidade: float | None = Field(None, gt=5, lt=20)
    resistencia: str | None = Field(None, max_length=50)

# ==============================================================================
# ROTAS (ENDPOINTS) DA API
# ==============================================================================

# --- ROTAS PARA GERENCIAR RELATÓRIOS NO BANCO DE DADOS ---

@app.post("/api/reports", status_code=201)
# Rota agora é 'async def', e a dependência é AsyncSession
async def create_report(
    report_data: ReportCreate,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ Salva um novo relatório no banco de dados. """
    new_report = models.Report(
        athlete_name=report_data.athleteName,
        dados_atleta=report_data.dados,
        analysis=report_data.analysis
    )
    db.add(new_report)
    await db.commit()  # <-- Adicionado await
    await db.refresh(new_report)  # <-- Adicionado await
    return new_report



@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register_coach(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    email = payload.email.lower()
    existing_user = await get_user_by_email(db, email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = models.User(
        email=email,
        password_hash=get_password_hash(payload.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {
        "id": str(user.id),
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at,
    }


@app.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, payload.email.lower(), payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    expires_delta = timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    token = create_access_token({"sub": user.email, "role": user.role}, expires_delta)
    return TokenResponse(
        access_token=token,
        expires_in=int(expires_delta.total_seconds()),
    )


@app.get("/api/me")
async def read_me(current_user: models.User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "role": current_user.role,
        "created_at": current_user.created_at,
    }

@app.get("/api/reports")
# Rota agora é 'async def'
async def get_reports(
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ Busca todos os relatórios salvos no banco de dados. """
    # Nova sintaxe com 'select' e 'await db.execute'
    query = select(models.Report).order_by(models.Report.date.desc())
    result = await db.execute(query)
    reports = result.scalars().all()
    return reports

@app.delete("/api/reports/{report_id}")
# Rota agora é 'async def'
async def delete_report(
    report_id: int,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ Deleta um relatório específico do banco de dados. """
    # Nova sintaxe para buscar um único item
    result = await db.get(models.Report, report_id)
    report_to_delete = result
    
    if not report_to_delete:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")
    
    await db.delete(report_to_delete)
    await db.commit()  # <-- Adicionado await
    return {"detail": "Relatório deletado com sucesso"}

# --- ROTA PARA ANÁLISE COM A IA ---

@app.post("/api/analyze")
async def analyze_athlete(
    data: AthleteData,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Gera avaliação + relatório via Gemini. (VERSÃO CORRIGIDA)
    """
    # 1) Monta prompt (seu código aqui estava perfeito)
    athlete_dict = data.model_dump()
    eval_dict = evaluate_athlete(athlete_dict)
    prompt = f"""
Você é um olheiro profissional e analista de performance. Analise o atleta combinando os dados brutos e a avaliação numérica do nosso sistema. 
Responda **exclusivamente** com **um único JSON** no formato:
{{
  "relatorio": "<p>...texto curto em HTML...</p>",
  "comparacao": "<p>...texto curto em HTML...</p>",
  "plano_treino": "<ul><li>...</li>...</ul>"
}}
Se não tiver certeza de algo, **ainda assim** preencha as chaves com um texto curto apropriado. **Não inclua nada fora do JSON** (sem comentários, sem markdown, sem explicações adicionais).

DADOS DO ATLETA:
- Nome: {data.nome} {data.sobrenome}, {data.idade} anos
- Posição atual: {data.posicao_atual}
- Físico: {data.altura} cm, {data.peso} kg
- Habilidades (0-10): Controle de Bola ({data.controle_bola}), Drible ({data.drible}), Passe Curto ({data.passe_curto}), Passe Longo ({data.passe_longo}), Finalização ({data.finalizacao}), Cabeceio ({data.cabeceio}), Desarme ({data.desarme}), Visão de Jogo ({data.visao_jogo}), Compostura ({data.compostura}), Agressividade ({data.agressividade})
- Pé dominante: {data.pe_dominante}

AVALIAÇÃO NUMÉRICA DO SISTEMA:
- Melhor posição sugerida: {eval_dict['best_position']}
- Score de potencial (0-100): {eval_dict['potential_score']}
- Risco de lesão: {eval_dict['injury_risk_label']} (score {eval_dict['injury_risk_score']}/100)
- Observações: {', '.join(eval_dict['notes']) if eval_dict['notes'] else 'Nenhuma'}

INSTRUÇÕES DE SAÍDA:
1) "relatorio": **1 parágrafo curto em HTML** com: pontos fortes 2–3 bullets embutidos (concisos), 1–2 fragilidades e se você **concorda/discorda** da posição sugerida, justificando rapidamente.
2) "comparacao": **1 parágrafo curto em HTML** dizendo a qual estilo de jogador profissional o atleta mais se aproxima e por quê (foco em 2–3 traços: velocidade, leitura, agressividade, etc.).
3) "plano_treino": **lista `<ul><li>` com 4–5 itens** equilibrando físico (ex.: força de core, resistência), técnico (ex.: passe longo sob pressão) e tático/mental (ex.: tomada de decisão no terço final). Cada `<li>` comece com um verbo no infinitivo (ex.: “Aprimorar…”, “Aumentar…”).

Lembrete final: devolva **apenas** o JSON pedido acima, sem ``` e sem texto extra.
""".strip()

    # 2) Chamada HTTP (código que você já tinha corrigido)
    api_url_com_chave = f"{settings.GEMINI_API_URL}?key={settings.GEMINI_API_KEY}"
    payload = {"contents": [{"parts": [{"text": prompt}]}]}
    headers = {"Content-Type": "application/json"}

    # 3) Chama o Gemini e trata erros
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(api_url_com_chave, json=payload, headers=headers)
            resp.raise_for_status()  # Lança exceção para erros 4xx/5xx
    except httpx.HTTPStatusError as e:
        detail_body = e.response.text[:500]
        # Este print é crucial para vermos o erro exato no terminal
        print(f"--> Erro HTTP do Gemini: {e.response.status_code} | Corpo: {detail_body}")
        raise HTTPException(
            status_code=502,
            detail=f"Erro ao chamar a API do Gemini: {e}. Corpo: {detail_body}"
        )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Erro de rede ao chamar o Gemini: {e}")

    # ================================================================
    # ✅ INÍCIO DA CORREÇÃO CRÍTICA
    # ================================================================
    try:
        data_ai = resp.json()
        # O Gemini aninha a resposta dentro de candidates -> content -> parts
        # Esta é a forma correta e segura de extrair o texto.
        ai_analysis_text = data_ai["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        # Se a estrutura da resposta for inesperada, ou não for JSON, o erro cairá aqui.
        raise HTTPException(
            status_code=500, 
            detail=f"Não foi possível extrair o texto da resposta da IA. Erro: {e}. Resposta recebida: {resp.text[:500]}"
        )
    # ================================================================
    # ✅ FIM DA CORREÇÃO CRÍTICA
    # ================================================================

    # 4) Parse do JSON com fallback (seu código aqui estava perfeito)
    try:
        final_response = json.loads(ai_analysis_text)
    except json.JSONDecodeError:
        start = ai_analysis_text.find("{")
        end = ai_analysis_text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                final_response = json.loads(ai_analysis_text[start:end+1])
            except json.JSONDecodeError as e:
                raise HTTPException(status_code=500, detail=f"Resposta da IA não é JSON válido: {e}")
        else:
            raise HTTPException(status_code=500, detail="Resposta da IA não contém JSON.")
    
    # 5) Sanitização de HTML (seu código aqui estava perfeito)
    _allowed_tags = ["p", "ul", "li", "strong", "em", "br", "span"]
    def _sanitize(html: str | None) -> str:
        return bleach.clean(html or "", tags=_allowed_tags, attributes={}, strip=True)
    for k in ("relatorio", "comparacao", "plano_treino"):
        if k in final_response:
            final_response[k] = _sanitize(final_response[k])

    # 6) Anexa a avaliação numérica calculada
    final_response["evaluation"] = eval_dict
    return final_response

async def _find_or_create_player(db: AsyncSession, first, last, external_id=None):
    """Tenta achar por external_id (prosoccer) ou por (nome, sobrenome).
       Se não existir, cria o jogador.
    """
    if external_id:
        q = select(models.Player).where(
            models.Player.external_ids["prosoccer"].as_string() == external_id
        )
        r = await db.execute(q)
        p = r.scalar_one_or_none()
        if p:
            return p

    q = select(models.Player).where(
        models.Player.first_name == first,
        models.Player.last_name == last
    )
    r = await db.execute(q)
    p = r.scalar_one_or_none()
    if p:
        return p

    p = models.Player(
        first_name=first,
        last_name=last,
        external_ids={"prosoccer": external_id} if external_id else {}
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


def _score_from_window(value, window_values, higher_better=True):
    """Transforma um valor em score 0..100 baseado em z-score + CDF normal."""
    import math, statistics
    if not window_values:
        return 50.0
    mu = statistics.mean(window_values)
    sd = statistics.pstdev(window_values) or 1e-6
    z = (value - mu) / sd
    if not higher_better:
        z = -z
    pct = 0.5 * (1 + math.erf(z / math.sqrt(2)))
    return round(100 * pct, 2)


async def _process_after_insert(db: AsyncSession, player_id, metric, value, ts, higher_better=True):
    """Após inserir uma medição: calcula score da janela e gera alertas simples."""
    since = ts - timedelta(days=14)
    q = select(models.Measurement.value).where(
        models.Measurement.player_id == player_id,
        models.Measurement.metric == metric,
        models.Measurement.recorded_at >= since
    ).order_by(models.Measurement.recorded_at)
    r = await db.execute(q)
    window = [row[0] for row in r.all()]
    score = _score_from_window(value, window, higher_better=higher_better)

    # Regras simples de alerta (exemplo)
    alert = None
    if metric.upper() == "HRV" and score < 30:
        alert = models.Alert(
            player_id=player_id,
            level="WARNING",
            metric=metric,
            message=f"HRV baixo (score {score})",
            payload={"value": value, "ts": ts.isoformat()}
        )
    if metric.upper() == "LDH" and value > 250:
        alert = models.Alert(
            player_id=player_id,
            level="CRITICAL",
            metric=metric,
            message=f"LDH elevado ({value})",
            payload={"ts": ts.isoformat()}
        )

    if alert:
        db.add(alert)
        await db.commit()

    return score

@app.post("/api/ingest/csv")
async def ingest_csv(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """
    CSV esperado com colunas:
    first_name,last_name,external_id,metric,value,unit,recorded_at
    recorded_at em ISO-8601 (ex.: 2025-03-20T10:30:00Z)
    """
    raw = await file.read()
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8")))
    inserted = 0
    for row in reader:
        p = await _find_or_create_player(
            db,
            row.get("first_name") or "",
            row.get("last_name") or "",
            row.get("external_id") or None
        )
        ts = datetime.fromisoformat(row["recorded_at"].replace("Z","+00:00"))
        m = models.Measurement(
            player_id=p.id,
            metric=row["metric"],
            value=float(row["value"]),
            unit=row.get("unit") or "",
            recorded_at=ts,
            meta={"source":"csv"}
        )
        db.add(m)
        await db.commit(); await db.refresh(m)
        # pós-processa (score+alerta)
        await _process_after_insert(db, p.id, row["metric"], float(row["value"]), ts,
                                    higher_better=(row["metric"].upper() not in {"LDH","CORTISOL","AST","GLICOSE"}))
        inserted += 1
    return {"inserted": inserted}


