import re
from datetime import datetime, timezone, timedelta
from uuid import UUID
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

import models
from core.deps import get_db, get_current_user

router = APIRouter(prefix="/api/players", tags=["players"])

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

class PlayerListResponse(BaseModel):
    id: UUID
    first_name: str | None
    last_name: str | None
    player_code: str | None
    club_name: str | None
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

@router.get("", response_model=List[PlayerListResponse])
async def list_players(
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista todos os jogadores cadastrados."""
    # TODO: Filtrar por owner_email se quiser restringir ao técnico logado
    result = await db.execute(select(models.Player).order_by(desc(models.Player.created_at)))
    players = result.scalars().all()
    
    response = []
    for p in players:
        manual = _extract_manual_info(p)
        response.append(PlayerListResponse(
            id=p.id,
            first_name=p.first_name,
            last_name=p.last_name,
            player_code=manual.get("player_code"),
            club_name=manual.get("club_name"),
            created_at=p.created_at
        ))
    return response

@router.post("/manual", response_model=ManualPlayerResponse, status_code=status.HTTP_201_CREATED)
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

# ------------------------------------------------------------------------------
# Novos Endpoints para Perfil do Atleta
# ------------------------------------------------------------------------------

class AssessmentUpdate(BaseModel):
    # Dados físicos
    altura: int = Field(..., gt=100, lt=230)
    peso: float = Field(..., gt=20, lt=150)
    posicao: str
    pe_dominante: str
    
    # Skills (0-10)
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

@router.put("/{player_id}/assessment")
async def update_assessment(
    player_id: UUID,
    data: AssessmentUpdate,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Salva/Atualiza a avaliação técnica e física do atleta."""
    player = await db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")

    ext = dict(player.external_ids or {})
    ext["assessment"] = data.model_dump()
    player.external_ids = ext
    
    db.add(player)
    await db.commit()
    return {"status": "success", "assessment": ext["assessment"]}

@router.get("/{player_id}/history")
async def get_player_history(
    player_id: UUID,
    days: int = 28,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retorna histórico de GPS/HRV para gráficos."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    
    q = select(models.Measurement).where(
        models.Measurement.player_id == player_id,
        models.Measurement.recorded_at >= since
    ).order_by(models.Measurement.recorded_at)
    
    result = await db.execute(q)
    measurements = result.scalars().all()
    
    # Agrupar por métrica
    history = {}
    for m in measurements:
        if m.metric not in history:
            history[m.metric] = []
        history[m.metric].append({
            "date": m.recorded_at.isoformat(),
            "value": m.value
        })
        
    return history
