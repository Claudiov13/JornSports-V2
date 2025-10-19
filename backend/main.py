import os
import csv, io
import json
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from uuid import UUID

import bleach
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from typing import Literal

from sqlalchemy import select, text, func
from sqlalchemy.sql import and_
from sqlalchemy.ext.asyncio import AsyncSession

# Importa as configurações do banco de dados e os modelos de tabela
import models
from models import Base            # <- para usar Base.metadata.create_all no startup
from database import engine, SessionLocal

# Função lógica agora importada em local diferente para fácil manutenção
from services.evaluation import evaluate_athlete

from config import settings

# ------------------------------------------------------------------------------
# Configuração Básica
# ------------------------------------------------------------------------------
load_dotenv()

app = FastAPI()
logger = logging.getLogger("uvicorn")

# Servir arquivos estáticos (ajuste o caminho se necessário)
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
    # LOG ÚTIL: confirma que está em v1 (e não v1beta)
    logger.info(f"GEMINI_API_URL em uso: {settings.GEMINI_API_URL}")
    if "/v1beta/" in settings.GEMINI_API_URL:
        logger.error("GEMINI_API_URL está em v1beta — isso vai dar 404. Corrija o .env para /v1/ ...")

# CORS
origins = settings.ALLOWED_ORIGINS.split()
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------------------
# Dependências / Auth
# ------------------------------------------------------------------------------
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

# ------------------------------------------------------------------------------
# Utilitários para Ingestão/Normalização (CSV GPS/HRV)
# ------------------------------------------------------------------------------
KNOWN_DATE_KEYS = ["recorded_at","date","data","dia","datetime","timestamp","Date"]
KNOWN_PLAYER_KEYS = [
    ("first_name","last_name"),
    ("nome","sobrenome"),
    ("First Name","Last Name"),
]
KNOWN_SINGLE_PLAYER_KEYS = ["athlete","player","jogador","Atleta","Player"]

# mapeia nomes comuns de colunas para métricas "canônicas"
METRIC_ALIASES = {
    "Total Distance": "total_distance",
    "total_distance": "total_distance",
    "High Speed Running Distance": "high_speed_distance",
    "HSR Distance": "high_speed_distance",
    "HMLD": "high_metabolic_load_distance",
    "Sprint Distance": "sprint_distance",
    "rMSSD": "hrv_rmssd",
    "HRV": "hrv_rmssd",
    "avg_hrv": "hrv_rmssd",
    "ACWR": "acwr",
    "session_load": "session_load",
}

def norm_metric(name: str) -> str:
    if not name:
        return ""
    n = name.strip()
    return METRIC_ALIASES.get(n, n.lower().replace(" ", "_"))

def coerce_float(v):
    if v is None:
        return None
    if isinstance(v,(int,float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None

def coerce_uuid(s: str) -> UUID | None:
    try:
        return UUID(str(s))
    except Exception:
        return None

def pick_first(d: dict, keys: list[str]) -> str | None:
    for k in keys:
        if k in d and str(d[k]).strip():
            return str(d[k]).strip()
    return None

def parse_date_from_row(row: dict) -> datetime | None:
    # tenta ISO-8601
    for k in KNOWN_DATE_KEYS:
        if k in row and str(row[k]).strip():
            try:
                return datetime.fromisoformat(
                    str(row[k]).strip().replace("Z","")
                ).replace(tzinfo=timezone.utc)
            except Exception:
                pass
    # fallback: dd/mm/yyyy
    if "Date" in row:
        try:
            return datetime.strptime(row["Date"], "%d/%m/%Y").replace(tzinfo=timezone.utc)
        except Exception:
            pass
    return None

# ------------------------------------------------------------------------------
# Modelos Pydantic
# ------------------------------------------------------------------------------
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

class AthleteData(BaseModel):
    # Dados obrigatórios
    nome: str = Field(..., min_length=2, pattern=r"^[a-zA-Z\s]+$")
    sobrenome: str = Field(..., min_length=2, pattern=r"^[a-zA-Z\s]+$")
    idade: int = Field(..., gt=4, lt=50)
    posicao_atual: Literal["goleiro", "zagueiro", "lateral", "volante", "meia", "ponta", "atacante"]
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

    # Opcionais
    envergadura: int | None = Field(None, gt=100, lt=250)
    percentual_gordura: float | None = Field(None, gt=2, lt=50)
    velocidade_sprint: float | None = Field(None, gt=1, lt=10)
    salto_vertical: int | None = Field(None, gt=10, lt=150)
    agilidade: float | None = Field(None, gt=5, lt=20)
    resistencia: str | None = Field(None, max_length=50)

# ------------------------------------------------------------------------------
# Rotas já existentes (Relatórios / Auth / Me / Analyze / Ingest CSV antigo)
# ------------------------------------------------------------------------------

@app.post("/api/reports", status_code=201)
async def create_report(
    report_data: ReportCreate,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Salva um novo relatório no banco de dados."""
    new_report = models.Report(
        athlete_name=report_data.athleteName,
        dados_atleta=report_data.dados,
        analysis=report_data.analysis
    )
    db.add(new_report)
    await db.commit()
    await db.refresh(new_report)
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
    user = models.User(email=email, password_hash=get_password_hash(payload.password))
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
    return TokenResponse(access_token=token, expires_in=int(expires_delta.total_seconds()))

@app.get("/api/me")
async def read_me(current_user: models.User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "role": current_user.role,
        "created_at": current_user.created_at,
    }

@app.get("/api/reports")
async def get_reports(
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Busca todos os relatórios salvos no banco de dados."""
    query = select(models.Report).order_by(models.Report.date.desc())
    result = await db.execute(query)
    reports = result.scalars().all()
    return reports

@app.delete("/api/reports/{report_id}")
async def delete_report(
    report_id: int,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Deleta um relatório específico do banco de dados."""
    result = await db.get(models.Report, report_id)
    report_to_delete = result
    if not report_to_delete:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")
    await db.delete(report_to_delete)
    await db.commit()
    return {"detail": "Relatório deletado com sucesso"}

@app.post("/api/analyze")
async def analyze_athlete(
    data: AthleteData,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Gera avaliação + relatório via Gemini. (VERSÃO CORRIGIDA)
    """
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

    api_url_com_chave = f"{settings.GEMINI_API_URL}?key={settings.GEMINI_API_KEY}"
    payload = {"contents": [{"parts": [{"text": prompt}]}]}
    headers = {"Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(api_url_com_chave, json=payload, headers=headers)
            resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        detail_body = e.response.text[:500]
        print(f"--> Erro HTTP do Gemini: {e.response.status_code} | Corpo: {detail_body}")
        raise HTTPException(
            status_code=502,
            detail=f"Erro ao chamar a API do Gemini: {e}. Corpo: {detail_body}"
        )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Erro de rede ao chamar o Gemini: {e}")

    try:
        data_ai = resp.json()
        ai_analysis_text = data_ai["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Não foi possível extrair o texto da resposta da IA. Erro: {e}. Resposta recebida: {resp.text[:500]}"
        )

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
    
    _allowed_tags = ["p", "ul", "li", "strong", "em", "br", "span"]
    def _sanitize(html: str | None) -> str:
        return bleach.clean(html or "", tags=_allowed_tags, attributes={}, strip=True)
    for k in ("relatorio", "comparacao", "plano_treino"):
        if k in final_response:
            final_response[k] = _sanitize(final_response[k])

    final_response["evaluation"] = eval_dict
    return final_response

# Helpers existentes do seu ingest "antigo"
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
        await _process_after_insert(
            db, p.id, row["metric"], float(row["value"]), ts,
            higher_better=(row["metric"].upper() not in {"LDH","CORTISOL","AST","GLICOSE"})
        )
        inserted += 1
    return {"inserted": inserted}

# ------------------------------------------------------------------------------
# NOVOS ENDPOINTS — Upload CSV (GPS/HRV) no formato flexível (largo/longo)
# ------------------------------------------------------------------------------

class UploadResponse(BaseModel):
    inserted: int
    players_touched: int
    metrics_detected: list[str]

@app.post("/api/measurements/upload", response_model=UploadResponse)
async def upload_measurements(
    file: UploadFile = File(...),
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Aceita um CSV em dois formatos:

      (A) Formato "longo": Athlete, Date, metric, value, unit
      (B) Formato "largo": Athlete, Date, Total Distance, HSR Distance, rMSSD, ...

    - Cria Player automaticamente (por nome) se não existir.
    - Insere linhas em 'measurements' normalizando nomes de métricas.
    """
    raw = await file.read()
    try:
        txt = raw.decode("utf-8")
    except UnicodeDecodeError:
        txt = raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(txt))

    inserted = 0
    players_touched = set()
    metrics_detected = set()

    async def get_or_create_player(row: dict):
        # 1) se vier player_id explícito
        pid = pick_first(row, ["player_id","PlayerId","playerId"])
        if pid:
            u = coerce_uuid(pid)
            if u:
                return u

        # 2) tentar pares first_name/last_name
        for a,b in KNOWN_PLAYER_KEYS:
            if a in row and b in row and row[a] and row[b]:
                first = str(row[a]).strip()
                last  = str(row[b]).strip()
                q = await db.execute(
                    select(models.Player).where(
                        models.Player.first_name==first, 
                        models.Player.last_name==last
                    )
                )
                p = q.scalar_one_or_none()
                if not p:
                    p = models.Player(first_name=first, last_name=last, external_ids={})
                    db.add(p)
                    await db.flush()  # gera o id
                return p.id

        # 3) nome completo em uma coluna
        single = pick_first(row, KNOWN_SINGLE_PLAYER_KEYS)
        if single:
            parts = [x for x in single.split() if x.strip()]
            first = parts[0]
            last  = " ".join(parts[1:]) if len(parts)>1 else ""
            q = await db.execute(
                select(models.Player).where(
                    models.Player.first_name==first, 
                    models.Player.last_name==last
                )
            )
            p = q.scalar_one_or_none()
            if not p:
                p = models.Player(first_name=first, last_name=last, external_ids={})
                db.add(p)
                await db.flush()
            return p.id

        return None

    async with db.begin():
        for row in reader:
            player_id = await get_or_create_player(row)
            if not player_id:
                # pula linhas que não conseguimos relacionar a um atleta
                continue

            recorded_at = parse_date_from_row(row) or datetime.now(timezone.utc)

            # (A) formato "longo": metric/value/unit por linha
            metric_key = pick_first(row, ["metric","Metric","metrica"])
            value_key  = pick_first(row, ["value","Value","valor"])
            unit_key   = pick_first(row, ["unit","Unit","unidade"])

            if metric_key and value_key:
                mname = norm_metric(row[metric_key])
                val   = coerce_float(row[value_key])
                unit  = row.get(unit_key) if unit_key else None
                if mname and val is not None:
                    m = models.Measurement(
                        player_id=player_id, metric=mname, value=val,
                        unit=unit or "", recorded_at=recorded_at, meta={}
                    )
                    db.add(m)
                    inserted += 1
                    players_touched.add(player_id)
                    metrics_detected.add(mname)
                continue

            # (B) formato "largo": várias colunas numéricas -> 1 Measurement por coluna
            ignore_cols = set(KNOWN_DATE_KEYS)
            for a,b in KNOWN_PLAYER_KEYS:
                ignore_cols.add(a); ignore_cols.add(b)
            ignore_cols.update(KNOWN_SINGLE_PLAYER_KEYS)

            for col, val in row.items():
                if col in ignore_cols:
                    continue
                fval = coerce_float(val)
                if fval is None:
                    continue
                mname = norm_metric(col)
                m = models.Measurement(
                    player_id=player_id, metric=mname, value=fval,
                    unit="", recorded_at=recorded_at, meta={}
                )
                db.add(m)
                inserted += 1
                players_touched.add(player_id)
                metrics_detected.add(mname)

    await db.commit()
    return UploadResponse(
        inserted=inserted,
        players_touched=len(players_touched),
        metrics_detected=sorted(metrics_detected),
    )

# ------------------------------------------------------------------------------
# NOVOS ENDPOINTS — Motor de Alertas (Sobrecarga & HRV)
# ------------------------------------------------------------------------------

def _now_utc():
    return datetime.now(timezone.utc)

async def _players_with_measurements(db: AsyncSession) -> list[UUID]:
    q = await db.execute(select(models.Measurement.player_id).distinct())
    return [r[0] for r in q.all()]

async def _metric_sum(db, player_id, metric, start, end):
    q = await db.execute(
        select(func.sum(models.Measurement.value))
        .where(
            models.Measurement.player_id == player_id,
            models.Measurement.metric == metric,
            models.Measurement.recorded_at >= start,
            models.Measurement.recorded_at < end,
        )
    )
    v = q.scalar()
    return float(v or 0.0)

async def _metric_avg(db, player_id, metric, start, end):
    q = await db.execute(
        select(func.avg(models.Measurement.value))
        .where(
            models.Measurement.player_id == player_id,
            models.Measurement.metric == metric,
            models.Measurement.recorded_at >= start,
            models.Measurement.recorded_at < end,
        )
    )
    v = q.scalar()
    return float(v or 0.0)

@app.post("/api/alerts/generate")
async def generate_alerts(
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Regras:
      - Sobrecarga (carga externa): soma de high_speed_distance (fallback total_distance)
        nos últimos 7 dias > 150% da média semanal das 4 semanas anteriores.
      - HRV: média rMSSD últimos 3 dias < 80% da média dos 21 dias anteriores.
    """
    now = _now_utc()
    d7  = now - timedelta(days=7)
    d35 = now - timedelta(days=35)
    d3  = now - timedelta(days=3)
    d24 = now - timedelta(days=24)

    created = 0
    players = await _players_with_measurements(db)

    async with db.begin():
        for pid in players:
            # -----------------------------
            # Regra 1: Sobrecarga (carga externa)
            # -----------------------------
            load_metric = "high_speed_distance"
            last7 = await _metric_sum(db, pid, load_metric, d7, now)
            if last7 == 0:
                load_metric = "total_distance"
                last7 = await _metric_sum(db, pid, load_metric, d7, now)

            # média semanal das 4 semanas anteriores (janela -35:-7)
            prev28 = await _metric_sum(db, pid, load_metric, d35, d7)
            weekly_avg_prev4 = (prev28 / 4.0) if prev28 > 0 else 0.0

            if weekly_avg_prev4 > 0 and last7 > 1.5 * weekly_avg_prev4:
                db.add(models.Alert(
                    player_id=pid,
                    level="alto",
                    metric=load_metric,
                    message=f"Pico de carga: últimos 7d={last7:.0f} > 150% da média semanal anterior ({weekly_avg_prev4:.0f}).",
                    payload={"last7": last7, "weekly_avg_prev4": weekly_avg_prev4, "rule": "overload_150pc"},
                ))
                created += 1

            # -----------------------------
            # Regra 2: HRV (resposta interna)
            # -----------------------------
            last3_avg  = await _metric_avg(db, pid, "hrv_rmssd", d3, now)
            prev21_avg = await _metric_avg(db, pid, "hrv_rmssd", d24, d3)

            if prev21_avg > 0 and last3_avg < 0.8 * prev21_avg:
                db.add(models.Alert(
                    player_id=pid,
                    level="alto",
                    metric="hrv_rmssd",
                    message=f"Queda de HRV: média 3d={last3_avg:.1f} < 80% da média 21d ({prev21_avg:.1f}).",
                    payload={"last3_avg": last3_avg, "prev21_avg": prev21_avg, "rule": "hrv_drop_20pc"},
                ))
                created += 1

    await db.commit()
    return {"created": created}

@app.get("/api/alerts")
async def list_alerts(
    limit: int = 100,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(models.Alert).order_by(models.Alert.generated_at.desc()).limit(limit)
    res = await db.execute(q)
    return res.scalars().all()

class AckPayload(BaseModel):
    acknowledged: bool = True

@app.patch("/api/alerts/{alert_id}/ack")
async def ack_alert(
    alert_id: str,
    payload: AckPayload,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    alert = await db.get(models.Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta não encontrado")
    alert.acknowledged = 1 if payload.acknowledged else 0
    await db.commit()
    await db.refresh(alert)
    return {"detail": "ok", "acknowledged": alert.acknowledged}
