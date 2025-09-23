import os
import requests
import json
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Literal
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession

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

@app.on_event("startup")
async def on_startup():
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
# ROTAS (ENDPOINTS) DA API
# ==============================================================================

# --- ROTAS PARA GERENCIAR RELATÓRIOS NO BANCO DE DADOS ---

@app.post("/api/reports", status_code=201)
# Rota agora é 'async def', e a dependência é AsyncSession
async def create_report(report_data: ReportCreate, db: AsyncSession = Depends(get_db)):
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

@app.get("/api/reports")
# Rota agora é 'async def'
async def get_reports(db: AsyncSession = Depends(get_db)):
    """ Busca todos os relatórios salvos no banco de dados. """
    # Nova sintaxe com 'select' e 'await db.execute'
    query = select(models.Report).order_by(models.Report.date.desc())
    result = await db.execute(query)
    reports = result.scalars().all()
    return reports

@app.delete("/api/reports/{report_id}")
# Rota agora é 'async def'
async def delete_report(report_id: int, db: AsyncSession = Depends(get_db)):
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