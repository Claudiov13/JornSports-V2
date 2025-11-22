import csv
import io
from datetime import datetime, timedelta, timezone
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
from core.deps import get_db, get_current_user

router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# ------------------------------------------------------------------------------
# Utilitários para Ingestão/Normalização (CSV GPS/HRV)
# ------------------------------------------------------------------------------
KNOWN_DATE_KEYS = ["recorded_at","date","data","dia","datetime","timestamp","Date"]
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

@router.post("/csv")
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
