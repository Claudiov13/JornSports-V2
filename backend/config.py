from pydantic_settings import BaseSettings, SettingsConfigDict

# ARQUIVO MUITO MAIS SIMPLES AGORA
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra='ignore')

    DATABASE_URL: str
    GEMINI_API_KEY: str
    GEMINI_API_URL: str

    # ✅ Alteração: Ler como uma string simples. O valor padrão é uma string vazia.
    ALLOWED_ORIGINS: str = ""

settings = Settings()