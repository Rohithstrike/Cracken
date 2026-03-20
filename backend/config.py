from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
from typing import Literal


class Settings(BaseSettings):
    app_env: Literal["development", "production", "testing"] = "development"
    log_level: str = "INFO"

    max_file_size_mb: int = 50
    allowed_extensions: str = ".log,.txt"

    ai_provider: Literal["ollama", "openai", "claude"] = "ollama"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "mistral"
    openai_api_key: str = ""
    claude_api_key: str = ""

    sample_line_count: int = 20

    # 🔥 VirusTotal Configuration (NEW)
    vt_api_key: str = ""
    vt_cache_ttl_seconds: int = 3600  # cache duration in seconds (default: 1 hour)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @field_validator("allowed_extensions")
    @classmethod
    def parse_extensions(cls, v: str) -> str:
        parts = [e.strip() for e in v.split(",")]
        for ext in parts:
            if not ext.startswith("."):
                raise ValueError(f"Extension '{ext}' must start with a dot.")
        return v

    @property
    def allowed_extensions_list(self) -> list[str]:
        return [e.strip() for e in self.allowed_extensions.split(",")]

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()