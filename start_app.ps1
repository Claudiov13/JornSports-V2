# Script para iniciar o Jorn Sports App (Docker + Backend)
Write-Host "Iniciando Jorn Sports..." -ForegroundColor Green

# 1. Verificar se o Docker está rodando
$dockerProcess = Get-Process "Docker Desktop" -ErrorAction SilentlyContinue
if (-not $dockerProcess) {
    Write-Host "Iniciando Docker Desktop..." -ForegroundColor Yellow
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    # Esperar o Docker iniciar (pode ajustar o tempo se necessário)
    Start-Sleep -Seconds 15
}

# 2. Subir o Banco de Dados (Docker Compose)
Write-Host "Subindo banco de dados..." -ForegroundColor Cyan
docker-compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro ao subir o Docker Compose. Verifique se o Docker está rodando." -ForegroundColor Red
    Pause
    Exit
}

# 3. Iniciar o Backend
Write-Host "Iniciando o Backend..." -ForegroundColor Cyan
Set-Location "backend"

# Verificar se venv existe
if (Test-Path "venv") {
    .\venv\Scripts\activate
} else {
    Write-Host "Ambiente virtual não encontrado. Criando..." -ForegroundColor Yellow
    python -m venv venv
    .\venv\Scripts\activate
    pip install -r requirements.txt
}

# Rodar Uvicorn
Write-Host "Backend rodando em http://localhost:8000" -ForegroundColor Green
uvicorn main:app --reload

Pause
