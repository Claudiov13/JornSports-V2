from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

import models
from core.deps import get_db, get_current_user

router = APIRouter(prefix="/api/reports", tags=["reports"])

class ReportCreate(BaseModel):
    athleteName: str
    dados: dict
    analysis: dict

@router.post("", status_code=201)
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

@router.get("")
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

@router.delete("/{report_id}")
async def delete_report(
    report_id: int,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Deleta um relatório específico do banco de dados."""
    result = await db.get(models.Report, report_id)
    if not result:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")
    await db.delete(result)
    await db.commit()
    return {"detail": "Relatório deletado com sucesso"}
