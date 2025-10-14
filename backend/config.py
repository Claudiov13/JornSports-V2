from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str
    GEMINI_API_KEY: str
    GEMINI_API_URL: str
    ALLOWED_ORIGINS: str = ""
    JWT_SECRET: str
    JWT_ALG: str = "HS256"


settings = Settings()
