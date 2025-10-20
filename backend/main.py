import os
import csv, io
import json
import logging
import re
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

from sqlalchemy import select, text, func, or_
from sqlalchemy.sql import and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc

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
KNOWN_SINGLE_PLAYER_KEYS = ["athlete","player","jogador","Atleta","Player","Athlete"]

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
    """RETORNA O VALOR da primeira chave encontrada."""
    for k in keys:
        if k in d and str(d[k]).strip():
            return str(d[k]).strip()
    return None

def first_present_key(d: dict, candidates: list[str]) -> str | None:
    """RETORNA O NOME DA COLUNA presente (não o valor)."""
    for k in candidates:
        if k in d and str(d[k]).strip():
            return k
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
    athlete: str | None = None,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Busca todos os relatórios salvos no banco de dados (opcional: ?athlete=)."""
    query = select(models.Report).order_by(models.Report.date.desc())
    if athlete:
        query = query.where(func.lower(models.Report.athlete_name) == func.lower(athlete))
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
async def _find_or_create_player(
    db: AsyncSession,
    first,
    last,
    external_id=None,
    owner_email: str | None = None,
):
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
        if owner_email:
            ext = dict(p.external_ids or {})
            if not ext.get("owner_email"):
                ext["owner_email"] = owner_email.lower()
                p.external_ids = ext
                await db.commit()
                await db.refresh(p)
        return p

    p = models.Player(
        first_name=first,
        last_name=last,
        external_ids={
            **({"prosoccer": external_id} if external_id else {}),
            **({"owner_email": owner_email.lower()} if owner_email else {}),
        },
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
async def ingest_csv(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    CSV esperado:
      first_name,last_name,external_id,metric,value,unit,recorded_at (ISO-8601 com Z)
    Sem transação aninhada. Faz flush por linha e commit 1x no final.
    """
    # 1) Lê/decodifica robusto
    try:
        raw = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Não foi possível ler o arquivo: {e}")

    text = None
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except Exception:
            continue
    if text is None:
        raise HTTPException(status_code=400, detail="Falha ao decodificar o arquivo (tente UTF-8).")

    # 2) Detecta delimitador , ou ;
    try:
        sample = text[:4096]
        dialect = csv.Sniffer().sniff(sample, delimiters=",;")
    except Exception:
        class _D: delimiter = ","
        dialect = _D()

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)

    required = {"first_name","last_name","external_id","metric","value","unit","recorded_at"}
    found = set([h.strip() for h in (reader.fieldnames or [])])
    missing = required - found
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Colunas ausentes: {', '.join(sorted(missing))}. Cabeçalhos: {', '.join(sorted(found))}"
        )

    inserted = 0
    errors = []

    # 3) Processa linhas sem abrir db.begin()
    for _ in reader:
        row = {k: (_ or "").strip() for k, _ in _.items()}  # trim seguro
        try:
            p = await _find_or_create_player(
                db,
                row["first_name"], row["last_name"],
                row["external_id"] or None,
                owner_email=current_user.email if current_user else None,
            )

            # Data/valor
            try:
                ts = datetime.fromisoformat(row["recorded_at"].replace("Z","+00:00"))
            except Exception as e:
                raise ValueError(f"recorded_at inválido: '{row['recorded_at']}' ({e})")
            try:
                val = float(str(row["value"]).replace(",", "."))
            except Exception:
                raise ValueError(f"value inválido: '{row['value']}'")

            m = models.Measurement(
                player_id=p.id,
                metric=row["metric"],
                value=val,
                unit=row.get("unit") or "",
                recorded_at=ts,
                meta={"source": "csv"}
            )
            db.add(m)
            # garante PK/visibilidade para selects subsequentes
            await db.flush()

            # gera alerta simples (essa função pode dar commit; tudo bem)
            await _process_after_insert(
                db, p.id, row["metric"], val, ts,
                higher_better=(row["metric"].upper() not in {"LDH","CORTISOL","AST","GLICOSE"})
            )

            inserted += 1

        except Exception as e:
            errors.append({"row": reader.line_num, "error": str(e), "row_data": row})

    # 4) Um commit no final (as linhas válidas ficam)
    await db.commit()
    return {"inserted": inserted, "errors": errors}

# ------------------------------------------------------------------------------
# Cadastro manual de atletas e códigos operacionais
# ------------------------------------------------------------------------------

class ManualPlayerCreate(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=60)
    last_name: str | None = Field(default=None, max_length=80)
    club_name: str = Field(..., min_length=2, max_length=120)
    coach_name: str = Field(..., min_length=2, max_length=120)
    club_code: str | None = Field(default=None, max_length=10)
    coach_code: str | None = Field(default=None, max_length=10)

class ManualPlayerResponse(BaseModel):
    id: UUID
    first_name: str | None = None
    last_name: str | None = None
    player_code: str
    club_name: str
    club_code: str
    coach_name: str
    coach_code: str
    created_at: datetime

def _normalize_code(source: str | None, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", (source or "")).upper()
    if not cleaned:
        cleaned = fallback
    if len(cleaned) < 3:
        cleaned = (cleaned + fallback).upper()
    return cleaned[:3]

def _extract_manual_info(player: models.Player) -> dict:
    ext = player.external_ids or {}
    manual = dict(ext.get("manual") or {})
    for key in ("player_code", "club_name", "club_code", "coach_name", "coach_code", "owner_email", "sequence"):
        if key not in manual and key in ext:
            manual[key] = ext.get(key)
    return manual

def _ensure_external_ids(player: models.Player, manual_info: dict) -> dict:
    ext = dict(player.external_ids or {})
    ext.update({
        "player_code": manual_info.get("player_code"),
        "club_name": manual_info.get("club_name"),
        "club_code": manual_info.get("club_code"),
        "coach_name": manual_info.get("coach_name"),
        "coach_code": manual_info.get("coach_code"),
        "owner_email": manual_info.get("owner_email"),
    })
    ext["manual"] = manual_info
    return ext

def _existing_codes_and_max_seq(players: list[models.Player], club_code: str, coach_code: str, owner_email: str) -> tuple[set[str], int]:
    existing_codes: set[str] = set()
    max_seq = 0
    for player in players:
        manual = _extract_manual_info(player)
        if not manual:
            continue
        if manual.get("club_code") != club_code:
            continue
        if manual.get("coach_code") != coach_code:
            continue
        owner = (manual.get("owner_email") or "").lower()
        if owner and owner != owner_email:
            continue
        code = manual.get("player_code")
        if code:
            existing_codes.add(code)
            match = re.search(r"(\d+)$", code)
            if match:
                max_seq = max(max_seq, int(match.group(1)))
    return existing_codes, max_seq

@app.post("/api/players/manual", response_model=ManualPlayerResponse, status_code=status.HTTP_201_CREATED)
async def create_manual_player(
    payload: ManualPlayerCreate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    owner_email = current_user.email.lower()
    first_name = payload.first_name.strip()
    last_name = (payload.last_name or "").strip() or None
    if not first_name:
        raise HTTPException(status_code=400, detail="Nome do atleta eh obrigatorio.")

    club_name = payload.club_name.strip()
    coach_name = payload.coach_name.strip()
    if not club_name:
        raise HTTPException(status_code=400, detail="Clube eh obrigatorio.")
    if not coach_name:
        raise HTTPException(status_code=400, detail="Tecnico eh obrigatorio.")

    club_code = _normalize_code(payload.club_code or club_name, "CLB")
    coach_code = _normalize_code(payload.coach_code or coach_name, "COA")

    players_res = await db.execute(select(models.Player))
    players = players_res.scalars().all()
    existing_codes, max_seq = _existing_codes_and_max_seq(players, club_code, coach_code, owner_email)

    seq = max_seq + 1
    player_code = f"{club_code}{coach_code}{seq:03d}"
    while player_code in existing_codes:
        seq += 1
        player_code = f"{club_code}{coach_code}{seq:03d}"

    player = models.Player(
        first_name=first_name,
        last_name=last_name,
        external_ids={},
    )
    manual_info = {
        "player_code": player_code,
        "club_name": club_name,
        "club_code": club_code,
        "coach_name": coach_name,
        "coach_code": coach_code,
        "owner_email": owner_email,
        "sequence": seq,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    player.external_ids = _ensure_external_ids(player, manual_info)

    db.add(player)
    await db.commit()
    await db.refresh(player)

    return ManualPlayerResponse(
        id=player.id,
        first_name=player.first_name,
        last_name=player.last_name,
        player_code=player_code,
        club_name=club_name,
        club_code=club_code,
        coach_name=coach_name,
        coach_code=coach_code,
        created_at=datetime.fromisoformat(manual_info["created_at"]),
    )

class GenerateAlertsRequest(BaseModel):
    player_id: UUID | None = None
    player_code: str | None = None

async def _find_player_by_code(
    db: AsyncSession,
    code: str,
    owner_email: str | None = None,
) -> models.Player | None:
    code = (code or "").strip().upper()
    if not code:
        return None
    res = await db.execute(select(models.Player))
    players = res.scalars().all()
    for player in players:
        manual = _extract_manual_info(player)
        ext = player.external_ids or {}
        candidate = (manual.get("player_code") or ext.get("player_code") or "").upper()
        if candidate != code:
            continue
        owner = (manual.get("owner_email") or ext.get("owner_email") or "").lower()
        if owner_email and owner and owner != owner_email.lower():
            continue
        return player
    return None

async def _players_with_measurements(
    db: AsyncSession,
    owner_email: str | None = None,
) -> list[UUID]:
    q = await db.execute(select(models.Measurement.player_id).distinct())
    player_ids: list[UUID] = []
    for row in q.all():
        player_id = row[0]
        player = await db.get(models.Player, player_id)
        if not player:
            continue
        manual = _extract_manual_info(player)
        ext = player.external_ids or {}
        owner = (manual.get("owner_email") or ext.get("owner_email") or "").lower()
        if owner_email and owner and owner != owner_email.lower():
            continue
        player_ids.append(player_id)
    return player_ids

async def _metric_sum(
    db: AsyncSession,
    player_id: UUID,
    metric: str,
    start: datetime,
    end: datetime,
) -> float:
    q = await db.execute(
        select(func.sum(models.Measurement.value)).where(
            models.Measurement.player_id == player_id,
            models.Measurement.metric == metric,
            models.Measurement.recorded_at >= start,
            models.Measurement.recorded_at < end,
        )
    )
    v = q.scalar()
    return float(v or 0.0)

async def _metric_avg(
    db: AsyncSession,
    player_id: UUID,
    metric: str,
    start: datetime,
    end: datetime,
) -> float:
    q = await db.execute(
        select(func.avg(models.Measurement.value)).where(
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
    payload: GenerateAlertsRequest | None = None,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    owner_email = (_current_user.email or "").lower()
    target_ids: list[UUID]

    if payload and (payload.player_id or payload.player_code):
        player: models.Player | None = None
        if payload.player_id:
            player = await db.get(models.Player, payload.player_id)
        elif payload.player_code:
            player = await _find_player_by_code(db, payload.player_code, owner_email=owner_email)
        if not player:
            raise HTTPException(status_code=404, detail="Atleta nao encontrado para gerar alertas.")
        manual = _extract_manual_info(player)
        ext = player.external_ids or {}
        owner = (manual.get("owner_email") or ext.get("owner_email") or "").lower()
        if owner and owner != owner_email:
            raise HTTPException(status_code=403, detail="Atleta nao vinculado ao treinador atual.")
        target_ids = [player.id]
    else:
        target_ids = await _players_with_measurements(db, owner_email=owner_email)

    if not target_ids:
        return {"created": 0}

    now = datetime.now(timezone.utc)
    d7 = now - timedelta(days=7)
    d35 = now - timedelta(days=35)
    d3 = now - timedelta(days=3)
    d24 = now - timedelta(days=24)

    created = 0
    for pid in target_ids:
        load_metric = "high_speed_distance"
        last7 = await _metric_sum(db, pid, load_metric, d7, now)
        if last7 == 0:
            load_metric = "total_distance"
            last7 = await _metric_sum(db, pid, load_metric, d7, now)

        prev28 = await _metric_sum(db, pid, load_metric, d35, d7)
        weekly_avg_prev4 = (prev28 / 4.0) if prev28 > 0 else 0.0

        if weekly_avg_prev4 > 0 and last7 > 1.5 * weekly_avg_prev4:
            db.add(models.Alert(
                player_id=pid,
                level="alto",
                metric=load_metric,
                message=(
                    f"Pico de carga: ultimos 7d={last7:.0f} > 150% da media semanal anterior "
                    f"({weekly_avg_prev4:.0f})."
                ),
                payload={
                    "last7": last7,
                    "weekly_avg_prev4": weekly_avg_prev4,
                    "rule": "overload_150pc",
                },
            ))
            created += 1

        last3_avg = await _metric_avg(db, pid, "hrv_rmssd", d3, now)
        prev21_avg = await _metric_avg(db, pid, "hrv_rmssd", d24, d3)

        if prev21_avg > 0 and last3_avg < 0.8 * prev21_avg:
            db.add(models.Alert(
                player_id=pid,
                level="alto",
                metric="hrv_rmssd",
                message=(
                    f"Queda de HRV: media 3d={last3_avg:.1f} < 80% da media 21d ({prev21_avg:.1f})."
                ),
                payload={
                    "last3_avg": last3_avg,
                    "prev21_avg": prev21_avg,
                    "rule": "hrv_drop_20pc",
                },
            ))
            created += 1

    await db.commit()
    return {"created": created}

# ================================
# PLAYERS API (lista, detalhes)
# ================================

class PlayerSummary(BaseModel):
    id: UUID
    first_name: str | None = None
    last_name: str | None = None
    metrics_count: int = 0
    last_measurement_at: datetime | None = None
    alerts_unread: int = 0
    player_code: str | None = None
    club_name: str | None = None
    club_code: str | None = None
    coach_name: str | None = None
    coach_code: str | None = None

class PlayerDetail(BaseModel):
    id: UUID
    first_name: str | None = None
    last_name: str | None = None
    age: int | None = None  # se nao tiver no modelo, permanece None
    player_code: str | None = None
    club_name: str | None = None
    club_code: str | None = None
    coach_name: str | None = None
    coach_code: str | None = None

def _full_name(p: models.Player) -> str:
    return f"{(p.first_name or '').strip()} {(p.last_name or '').strip()}".strip()

@app.get("/api/players", response_model=list[PlayerSummary])
async def list_players(
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    club_code: str | None = None,
    coach_code: str | None = None,
    q: str | None = None,
):
    # todos os players que já têm medição OU alerta OU relatório
    user_email = (_current_user.email or "").lower()
    players_res = await db.execute(select(models.Player))
    players = players_res.scalars().all()
    club_code = (club_code or "").strip().upper() or None
    coach_code = (coach_code or "").strip().upper() or None
    search = (q or "").strip().lower() or None

    out: list[PlayerSummary] = []
    for p in players:
        manual = _extract_manual_info(p)
        ext = p.external_ids or {}
        owner = (manual.get("owner_email") or ext.get("owner_email") or "").lower()
        if owner and owner != user_email:
            continue
        manual_club = (manual.get("club_code") or ext.get("club_code") or "").upper()
        manual_coach = (manual.get("coach_code") or ext.get("coach_code") or "").upper()
        if club_code and manual_club != club_code:
            continue
        if coach_code and manual_coach != coach_code:
            continue
        if search:
            full_name = f"{(p.first_name or '').lower()} {(p.last_name or '').lower()}".strip()
            code_value = (manual.get("player_code") or ext.get("player_code") or "").lower()
            if search not in full_name and search not in code_value:
                continue
        # contagem de métricas e última medição
        m_agg = await db.execute(
            select(
                func.count(models.Measurement.id),
                func.max(models.Measurement.recorded_at)
            ).where(models.Measurement.player_id == p.id)
        )
        m_count, m_last = m_agg.first() or (0, None)

        # não lidos
        a_agg = await db.execute(
            select(func.count(models.Alert.id)).where(
                models.Alert.player_id == p.id,
                (models.Alert.acknowledged == 0) | (models.Alert.acknowledged.is_(None))
            )
        )
        a_unread = a_agg.scalar() or 0

        out.append(PlayerSummary(
            id=p.id,
            first_name=p.first_name,
            last_name=p.last_name,
            metrics_count=int(m_count or 0),
            last_measurement_at=m_last,
            alerts_unread=int(a_unread),
            player_code=manual.get("player_code") or ext.get("player_code"),
            club_name=manual.get("club_name") or ext.get("club_name"),
            club_code=manual_club or None,
            coach_name=manual.get("coach_name") or ext.get("coach_name"),
            coach_code=manual_coach or None,
        ))
    # ordena por última medição desc
    out.sort(key=lambda r: (r.last_measurement_at or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    return out

@app.get("/api/players/{player_id}", response_model=PlayerDetail)
async def get_player(
    player_id: UUID,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    p = await db.get(models.Player, player_id)
    if not p:
        raise HTTPException(404, "Atleta nao encontrado")
    manual = _extract_manual_info(p)
    ext = p.external_ids or {}
    owner = (manual.get("owner_email") or ext.get("owner_email") or "").lower()
    user_email = (_current_user.email or "").lower()
    if owner and owner != user_email:
        raise HTTPException(status_code=403, detail="Atleta nao vinculado a este treinador.")
    age = getattr(p, "age", None)
    return PlayerDetail(
        id=p.id,
        first_name=p.first_name,
        last_name=p.last_name,
        age=age,
        player_code=manual.get("player_code") or ext.get("player_code"),
        club_name=manual.get("club_name") or ext.get("club_name"),
        club_code=manual.get("club_code") or ext.get("club_code"),
        coach_name=manual.get("coach_name") or ext.get("coach_name"),
        coach_code=manual.get("coach_code") or ext.get("coach_code"),
    )

@app.get("/api/players/by-code/{player_code}", response_model=PlayerDetail)
async def get_player_by_code(
    player_code: str,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    owner_email = (_current_user.email or "").lower()
    player = await _find_player_by_code(db, player_code, owner_email=owner_email)
    if not player:
        raise HTTPException(status_code=404, detail="Atleta nao encontrado")
    return await get_player(player.id, _current_user=_current_user, db=db)

@app.get("/api/players/{player_id}/measurements")
async def get_player_measurements(
    player_id: UUID,
    metric: str | None = None,
    limit: int = 500,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(models.Measurement).where(models.Measurement.player_id == player_id)
    if metric:
        q = q.where(models.Measurement.metric == metric)
    q = q.order_by(desc(models.Measurement.recorded_at)).limit(limit)
    r = await db.execute(q)
    items = r.scalars().all()
    # resposta enxuta
    return [
        {
            "id": str(m.id),
            "metric": m.metric,
            "value": m.value,
            "unit": m.unit,
            "recorded_at": m.recorded_at,
        }
        for m in items
    ]

@app.get("/api/players/{player_id}/alerts")
async def get_player_alerts(
    player_id: UUID,
    limit: int = 100,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(models.Alert).where(models.Alert.player_id == player_id).order_by(desc(models.Alert.generated_at)).limit(limit)
    r = await db.execute(q)
    return r.scalars().all()

@app.get("/api/players/{player_id}/reports")
async def get_player_reports(
    player_id: UUID,
    limit: int = 50,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Fallback: se Report tiver .player_id, filtra por ele.
    Se não, tenta conciliar por athlete_name ≈ 'First Last%'.
    """
    # tenta coluna player_id (se existir no seu modelo)
    by_fk_ok = False
    if hasattr(models.Report, "player_id"):
        q = select(models.Report).where(models.Report.player_id == player_id).order_by(desc(models.Report.date)).limit(limit)
        r = await db.execute(q)
        reports = r.scalars().all()
        if reports:
            by_fk_ok = True
            return reports

    # fallback por nome
    p = await db.get(models.Player, player_id)
    if not p:
        raise HTTPException(404, "Atleta não encontrado")
    name = _full_name(p)
    if not name:
        return []
    like = f"{name}%"
    q = select(models.Report).where(func.lower(models.Report.athlete_name).like(func.lower(like))).order_by(desc(models.Report.date)).limit(limit)
    r = await db.execute(q)
    return r.scalars().all()
