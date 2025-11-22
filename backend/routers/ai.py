import json
import bleach
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy.ext.asyncio import AsyncSession

import models
from core.deps import get_db, get_current_user
from core.config import settings
from services.evaluation import evaluate_athlete

router = APIRouter(prefix="/api/analyze", tags=["ai"])

import json
import bleach
import httpx
import statistics
from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

import models
from core.deps import get_db, get_current_user
from core.config import settings
from services.evaluation import evaluate_athlete

router = APIRouter(prefix="/api/analyze", tags=["ai"])

class AIAnalysisRequest(BaseModel):
    player_id: UUID

async def _get_metrics_summary(db: AsyncSession, player_id: UUID):
    """
    Calcula métricas avançadas (HRV drop, ACWR) baseadas no histórico.
    """
    # Buscar últimos 28 dias
    since = datetime.now(timezone.utc) - timedelta(days=28)
    q = select(models.Measurement).where(
        models.Measurement.player_id == player_id,
        models.Measurement.recorded_at >= since
    ).order_by(desc(models.Measurement.recorded_at))
    
    result = await db.execute(q)
    measurements = result.scalars().all()
    
    # Organizar por métrica
    data = {}
    for m in measurements:
        if m.metric not in data:
            data[m.metric] = []
        data[m.metric].append((m.recorded_at, m.value))

    alerts = []
    summary = []

    # 1. Regra de Ouro: HRV (rMSSD)
    # Se a média dos últimos 3 dias for 20% menor que a média dos últimos 21 dias -> Fadiga
    if "hrv_rmssd" in data:
        vals = sorted(data["hrv_rmssd"], key=lambda x: x[0], reverse=True) # mais recente primeiro
        if len(vals) >= 3:
            recent_3 = [v[1] for v in vals[:3]]
            avg_3 = statistics.mean(recent_3)
            
            # Baseline (até 21 dias atrás, excluindo os 3 recentes se quiser ser estrito, 
            # mas aqui pegaremos tudo exceto os 3 recentes para comparar)
            rest = [v[1] for v in vals[3:]]
            if len(rest) >= 5: # precisa de um mínimo de histórico
                avg_chronic = statistics.mean(rest)
                drop_pct = (avg_chronic - avg_3) / avg_chronic * 100
                
                summary.append(f"HRV Recente (3d): {avg_3:.1f}ms | Basal: {avg_chronic:.1f}ms")
                
                if drop_pct > 20:
                    alerts.append(f"ALERTA CRÍTICO: Queda de {drop_pct:.1f}% no HRV. Sinal forte de fadiga acumulada ou má recuperação.")
                elif drop_pct > 10:
                     alerts.append(f"ATENÇÃO: Queda de {drop_pct:.1f}% no HRV. Monitorar carga.")
            else:
                summary.append(f"HRV Recente: {avg_3:.1f}ms (Sem histórico suficiente para baseline)")

    # 2. ACWR (Total Distance ou Load)
    # Razão Aguda (7 dias) / Crônica (28 dias)
    metric_load = "total_distance" # ou session_load se tiver
    if metric_load in data:
        vals = sorted(data[metric_load], key=lambda x: x[0], reverse=True)
        now = datetime.now(timezone.utc)
        
        acute_vals = [v[1] for v in vals if (now - v[0]).days <= 7]
        chronic_vals = [v[1] for v in vals if (now - v[0]).days <= 28]
        
        if chronic_vals:
            acute_load = sum(acute_vals)
            chronic_avg = sum(chronic_vals) / 4 # média semanal do mês
            
            if chronic_avg > 0:
                acwr = acute_load / chronic_avg
                summary.append(f"ACWR (Carga Aguda/Crônica): {acwr:.2f}")
                
                if acwr > 1.5:
                    alerts.append(f"RISCO DE LESÃO: ACWR de {acwr:.2f} (Muito alto). Pico agudo de carga.")
                elif acwr < 0.8:
                    alerts.append(f"Destreinamento: ACWR de {acwr:.2f} (Baixo).")
    
    return "\n".join(summary), "\n".join(alerts)

@router.post("")
async def analyze_athlete(
    payload: AIAnalysisRequest,
    _current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Gera relatório holístico (Dados Cadastrais + Histórico GPS/HRV).
    """
    # 1. Buscar Atleta e Avaliação
    player = await db.get(models.Player, payload.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Atleta não encontrado")
        
    ext = player.external_ids or {}
    assessment = ext.get("assessment")
    
    if not assessment:
        raise HTTPException(status_code=400, detail="Atleta sem avaliação física/técnica cadastrada. Preencha o perfil primeiro.")

    # 2. Calcular Métricas Reais
    metrics_summary, metrics_alerts = await _get_metrics_summary(db, payload.player_id)

    # 3. Avaliação do Sistema (Potencial, Posição)
    # Adaptar assessment para o formato esperado pelo evaluate_athlete
    eval_input = {
        "nome": player.first_name,
        "sobrenome": player.last_name or "",
        "idade": 20, # TODO: Adicionar data de nascimento no cadastro
        **assessment
    }
    # Fallbacks seguros se faltar campo
    if "idade" not in eval_input: eval_input["idade"] = 20
    
    sys_eval = evaluate_athlete(eval_input)

    # 4. Prompt
    prompt = f"""
Você é um fisiologista e analista de performance de elite. Analise este atleta de forma HOLÍSTICA.
Combine a avaliação técnica (olheiro) com os DADOS FISIOLÓGICOS REAIS (GPS/HRV) para dar um veredito.

DADOS DO ATLETA:
- Nome: {player.first_name} {player.last_name}
- Posição: {assessment.get('posicao')}
- Físico: {assessment.get('altura')}cm, {assessment.get('peso')}kg
- Skills: {json.dumps({k:v for k,v in assessment.items() if isinstance(v, int) and k not in ['altura','peso']})}

MÉTRICAS FISIOLÓGICAS (Últimos 28 dias):
{metrics_summary}

ALERTAS DO SISTEMA (Baseado em regras científicas):
{metrics_alerts}
(Se houver alertas de HRV ou ACWR, leve-os MUITO a sério no relatório).

AVALIAÇÃO TÉCNICA DO SISTEMA:
- Potencial: {sys_eval['potential_score']}/100
- Risco Lesão (Estrutural): {sys_eval['injury_risk_label']}

SAÍDA ESPERADA (JSON ÚNICO):
{{
  "relatorio": "<p>HTML curto. Comece analisando o momento físico (Fadiga/Recuperação) baseado nos alertas. Depois fale da parte técnica. Seja direto.</p>",
  "comparacao": "<p>HTML curto. Estilo de jogador similar.</p>",
  "plano_treino": "<ul><li>Foco 1 (Baseado no risco de lesão/fadiga atual)</li><li>Foco 2 (Técnico)</li><li>Foco 3 (Tático)</li><li>Foco 4 (Mental)</li></ul>"
}}
""".strip()

    # 5. Chamar Gemini
    api_url = f"{settings.GEMINI_API_URL}?key={settings.GEMINI_API_KEY}"
    gemini_payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"}
    }
    
    async with httpx.AsyncClient(timeout=90) as client:
        try:
            resp = await client.post(api_url, json=gemini_payload, headers={"Content-Type": "application/json"})
            resp.raise_for_status()
            data_ai = resp.json()
            text = data_ai["candidates"][0]["content"]["parts"][0]["text"]
            final_response = json.loads(text)
        except Exception as e:
            print(f"Erro Gemini: {e}")
            # Fallback em caso de erro da IA para não quebrar o fluxo
            return {
                "relatorio": f"<p>Não foi possível gerar a análise IA no momento. <br><strong>Alertas Detectados:</strong><br>{metrics_alerts or 'Nenhum'}</p>",
                "comparacao": "<p>Indisponível.</p>",
                "plano_treino": "<ul><li>Monitorar carga de treino</li><li>Manter hidratação</li></ul>",
                "evaluation": sys_eval
            }

    # Sanitize
    _allowed_tags = ["p", "ul", "li", "strong", "em", "br", "span", "b", "i"]
    for k in ("relatorio", "comparacao", "plano_treino"):
        if k in final_response:
            final_response[k] = bleach.clean(final_response[k], tags=_allowed_tags, strip=True)

    final_response["evaluation"] = sys_eval
    final_response["system_alerts"] = metrics_alerts # Retornar alertas crus também
    
    return final_response
