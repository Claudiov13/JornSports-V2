import os
import requests
import json
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Literal
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware

# Importa as configurações do banco de dados e os modelos de tabela
import models
from database import SessionLocal, engine

# ==============================================================================
# SETUP E CONFIGURAÇÃO INICIAL
# ==============================================================================

# Cria a tabela no banco de dados (se não existir) ao iniciar a aplicação
models.Base.metadata.create_all(bind=engine)

# Carrega as variáveis de ambiente do arquivo .env (ex: GEMINI_API_KEY)
load_dotenv()

# Inicia a aplicação FastAPI
app = FastAPI()

# Configuração do CORS para permitir a comunicação com o frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Em produção, restrinja para o domínio do seu frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# DEPENDÊNCIA DO BANCO DE DADOS
# ==============================================================================

# Função que fornece uma sessão do banco de dados para as rotas da API
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==============================================================================
# MODELOS PYDantic (Estrutura de Dados para a API)
# ==============================================================================

# Modelo para criar um novo relatório no banco de dados
class ReportCreate(BaseModel):
    athleteName: str
    dados: dict
    analysis: dict

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
# LÓGICA DE AVALIAÇÃO DETERMINÍSTICA
# ==============================================================================

def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))

def _to_0_10_from_interval(x: float | None, best: float, worst: float, invert: bool = False) -> float:
    if x is None: return 5.0
    a, b = (best, worst) if not invert else (worst, best)
    if a == b: return 5.0
    t = (x - a) / (b - a)
    t = 1.0 - t if invert else t
    return 10.0 * _clamp01(t)

def evaluate_athlete(d: dict) -> dict:
    speed = _to_0_10_from_interval(d.get("velocidade_sprint"), best=2.8, worst=4.5, invert=True)
    agility = _to_0_10_from_interval(d.get("agilidade"), best=9.0, worst=12.5, invert=True)
    jump = _to_0_10_from_interval(d.get("salto_vertical"), best=75.0, worst=30.0)
    endurance = 5.0
    
    def S(key): return float(d.get(key, 5.0))
    
    try:
        bmi = d["peso"] / ((d["altura"] / 100.0) ** 2)
    except (TypeError, ZeroDivisionError):
        bmi = None

    skill_keys = [
        "controle_bola", "drible", "passe_curto", "passe_longo", "finalizacao", 
        "cabeceio", "desarme", "visao_jogo", "compostura", "agressividade"
    ]
    
    feats = { key: S(key) for key in skill_keys }
    feats['velocidade'] = speed
    feats['agilidade'] = agility
    feats['salto'] = jump
    feats['resistencia'] = endurance

    positions = {
        "goleiro": {"compostura": 0.30, "salto": 0.25, "visao_jogo": 0.20, "passe_curto": 0.15, "passe_longo": 0.10},
        "zagueiro": {"desarme": 0.25, "cabeceio": 0.20, "compostura": 0.15, "passe_curto": 0.10, "agressividade": 0.15, "salto": 0.15},
        "lateral": {"velocidade": 0.25, "drible": 0.15, "passe_longo": 0.10, "desarme": 0.15, "resistencia": 0.20, "agilidade": 0.15},
        "volante": {"desarme": 0.20, "passe_curto": 0.20, "compostura": 0.15, "visao_jogo": 0.20, "agressividade": 0.10, "resistencia": 0.15},
        "meia": {"visao_jogo": 0.25, "passe_curto": 0.20, "drible": 0.15, "finalizacao": 0.15, "compostura": 0.15, "passe_longo": 0.10},
        "ponta": {"velocidade": 0.30, "drible": 0.25, "finalizacao": 0.20, "agilidade": 0.15, "passe_curto": 0.10},
        "atacante": {"finalizacao": 0.35, "cabeceio": 0.15, "compostura": 0.15, "visao_jogo": 0.10, "agressividade": 0.15, "controle_bola": 0.10}
    }
    
    pos_scores = {}
    for pos, weights in positions.items():
        score = sum(w * feats.get(feat, 5.0) for feat, w in weights.items())
        total_weight = sum(weights.values())
        pos_scores[pos] = round((score / total_weight) * 10, 1) if total_weight > 0 else 0.0
    
    best_position = max(pos_scores, key=pos_scores.get) if pos_scores else "N/A"

    tech_avg = sum(feats[s] for s in skill_keys) / len(skill_keys)
    phys_avg = sum([speed, agility, jump, endurance]) / 4.0
    potential = round((0.6 * tech_avg + 0.4 * phys_avg) * 10, 1)

    risk = 0.0
    notes = []
    if bmi is not None:
        if bmi > 25:
            risk += (bmi - 25) * 1.5
            if bmi >= 27.5: notes.append("IMC elevado, pode impactar agilidade e resistência.")
    risk += (10.0 - agility) * 0.4 + S("agressividade") * 0.3
    injury_score = round(_clamp01(risk / 10.0) * 100.0, 0)
    label = "baixo"
    if injury_score >= 67: label = "alto"
    elif injury_score >= 34: label = "médio"

    return { "best_position": best_position, "position_scores": pos_scores, "potential_score": potential, "injury_risk_score": int(injury_score), "injury_risk_label": label, "bmi": round(bmi, 1) if bmi else None, "notes": notes }

# ==============================================================================
# ROTAS (ENDPOINTS) DA API
# ==============================================================================

# --- ROTAS PARA GERENCIAR RELATÓRIOS NO BANCO DE DADOS ---

@app.post("/api/reports", status_code=201)
def create_report(report_data: ReportCreate, db: Session = Depends(get_db)):
    """ Salva um novo relatório no banco de dados. """
    new_report = models.Report(
        athlete_name=report_data.athleteName,
        dados_atleta=report_data.dados,
        analysis=report_data.analysis
    )
    db.add(new_report)
    db.commit()
    db.refresh(new_report)
    return new_report

@app.get("/api/reports")
def get_reports(db: Session = Depends(get_db)):
    """ Busca todos os relatórios salvos no banco de dados. """
    reports = db.query(models.Report).order_by(models.Report.date.desc()).all()
    return reports

@app.delete("/api/reports/{report_id}")
def delete_report(report_id: int, db: Session = Depends(get_db)):
    """ Deleta um relatório específico do banco de dados. """
    report_to_delete = db.query(models.Report).filter(models.Report.id == report_id).first()
    if not report_to_delete:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")
    db.delete(report_to_delete)
    db.commit()
    return {"detail": "Relatório deletado com sucesso"}

# --- ROTA PARA ANÁLISE COM A IA ---

@app.post("/api/analyze")
async def analyze_athlete(dados_atleta: AthleteData, db: Session = Depends(get_db)):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Chave da API não encontrada.")

    # 1. Roda a avaliação determinística primeiro
    eval_dict = evaluate_athlete(dados_atleta.model_dump())

    # 2. Monta o prompt para a IA
    prompt = f"""
        Você é um olheiro de futebol profissional e analista de dados. Sua tarefa é analisar o perfil de um atleta, combinando os dados brutos com uma avaliação numérica pré-calculada pelo nosso sistema. Forneça um relatório humano e perspicaz.

        **DADOS BRUTOS DO ATLETA:**
        - Nome: {dados_atleta.nome} {dados_atleta.sobrenome}, {dados_atleta.idade} anos
        - Posição Principal: {dados_atleta.posicao_atual}
        - Físico: {dados_atleta.altura} cm, {dados_atleta.peso} kg
        - Habilidades (0-10): Controle de Bola ({dados_atleta.controle_bola}), Drible ({dados_atleta.drible}), Passe Curto ({dados_atleta.passe_curto}), Passe Longo ({dados_atleta.passe_longo}), Finalização ({dados_atleta.finalizacao}), Cabeceio ({dados_atleta.cabeceio}), Desarme ({dados_atleta.desarme}), Visão de Jogo ({dados_atleta.visao_jogo}), Compostura ({dados_atleta.compostura}), Agressividade ({dados_atleta.agressividade}).

        **ANÁLISE NUMÉRICA DO SISTEMA:**
        - Melhor Posição Sugerida (baseado em pesos): **{eval_dict['best_position']}**
        - Score de Potencial Geral (0-100): {eval_dict['potential_score']}
        - Risco de Lesão (calculado): {eval_dict['injury_risk_label']} (Score: {eval_dict['injury_risk_score']}/100)
        - Observações do Sistema: {', '.join(eval_dict['notes']) if eval_dict['notes'] else 'Nenhuma'}

        **SUA TAREFA:**
        Com base em **TUDO** acima, gere uma resposta **EXCLUSIVAMENTE em formato JSON** com três chaves: "relatorio", "comparacao", e "plano_treino".
        1.  **relatorio**: Um parágrafo de análise em HTML. Comente sobre os pontos fortes e fracos, e se você concorda com a "Melhor Posição Sugerida" pelo sistema, explicando o porquê.
        2.  **comparacao**: Um parágrafo em HTML comparando o estilo de jogo a um jogador profissional.
        3.  **plano_treino**: Uma lista `<ul>` com `<li>` em HTML, com 3 a 5 pontos focais para o atleta evoluir.
    """

    # AQUI ESTÁ A CORREÇÃO PRINCIPAL:
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    
    payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json"},}

    try:
        response = requests.post(api_url, json=payload, timeout=90)
        response.raise_for_status()
        ai_analysis_text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        
        # 3. Combina a resposta da IA com a avaliação numérica
        final_response = json.loads(ai_analysis_text)
        final_response['evaluation'] = eval_dict
        
        return final_response
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Erro ao chamar a API do Gemini: {e}")
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar a resposta da API: {e}")