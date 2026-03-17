import httpx
from typing import List

from backend.ai.base import BaseAIProvider
from backend.ai.prompt_builder import build_regex_prompt
from backend.config import settings
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# ── Defaults ──────────────────────────────────────────────────────────────────
_DEFAULT_BASE_URL = "http://localhost:11434"
_DEFAULT_MODEL    = "mistral"
_REQUEST_TIMEOUT  = 120.0   # seconds — local models can be slow on first load


class OllamaProvider(BaseAIProvider):
    """
    AI provider implementation for a locally running Ollama server.

    Reads connection settings from the application config:
        settings.ollama_base_url  (default: http://localhost:11434)
        settings.ollama_model     (default: mistral)

    Compatible with any model served by Ollama:
        ollama pull mistral
        ollama pull llama3
        ollama pull deepseek-coder
    """

    def __init__(self) -> None:
        self._base_url = getattr(
            settings, "ollama_base_url", _DEFAULT_BASE_URL
        ).rstrip("/")
        self._model = getattr(
            settings, "ollama_model", _DEFAULT_MODEL
        )
        self._endpoint = f"{self._base_url}/api/generate"

    async def generate_regex(self, sanitized_log_sample: str) -> str:
        """
        Sends sanitized log lines to the local Ollama server and
        returns the raw model response text.

        Steps:
            1. Split sample string back into lines
            2. Build the prompt via prompt_builder
            3. POST to Ollama /api/generate with stream=false
            4. Extract and return the "response" field

        Args:
            sanitized_log_sample: Masked log lines joined by newlines.

        Returns:
            Raw model output string — JSON, fenced JSON, or plain regex.

        Raises:
            RuntimeError: on connection error, timeout, or bad response.
        """
        lines: List[str] = [
            l for l in sanitized_log_sample.splitlines() if l.strip()
        ]
        prompt = build_regex_prompt(lines)

        payload = {
            "model":  self._model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.1,   # low temperature = deterministic output
                "num_predict": 512,   # cap token output — regex fits easily
            },
        }

        logger.info(
            "ollama_request_sending",
            model=self._model,
            endpoint=self._endpoint,
            sample_lines=len(lines),
        )

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(
                    connect=10.0,
                    read=_REQUEST_TIMEOUT,
                    write=10.0,
                    pool=5.0,
                )
            ) as client:
                response = await client.post(self._endpoint, json=payload)
                response.raise_for_status()

        except httpx.ConnectError as exc:
            logger.error(
                "ollama_connection_failed",
                endpoint=self._endpoint,
                error=str(exc),
            )
            raise RuntimeError(
                f"Cannot connect to Ollama at {self._endpoint}. "
                f"Is Ollama running? Try: ollama serve"
            ) from exc

        except httpx.TimeoutException as exc:
            logger.error(
                "ollama_request_timeout",
                endpoint=self._endpoint,
                timeout=_REQUEST_TIMEOUT,
                model=self._model,
            )
            raise RuntimeError(
                f"Ollama request timed out after {_REQUEST_TIMEOUT}s. "
                f"The model '{self._model}' may still be loading."
            ) from exc

        except httpx.HTTPStatusError as exc:
            logger.error(
                "ollama_http_error",
                status_code=exc.response.status_code,
                body=exc.response.text[:200],
            )
            raise RuntimeError(
                f"Ollama returned HTTP {exc.response.status_code}: "
                f"{exc.response.text[:200]}"
            ) from exc

        # ── Parse Ollama response ─────────────────────────────────────────
        try:
            data = response.json()
        except Exception as exc:
            logger.error(
                "ollama_response_not_json",
                raw=response.text[:200],
            )
            raise RuntimeError(
                f"Ollama response was not valid JSON: {response.text[:200]}"
            ) from exc

        raw_text = data.get("response", "")

        if not raw_text:
            logger.error(
                "ollama_empty_response",
                full_response=str(data)[:200],
            )
            raise RuntimeError(
                "Ollama returned an empty 'response' field. "
                "The model may have failed to generate output."
            )

        logger.info(
            "ollama_response_received",
            model=self._model,
            response_length=len(raw_text),
            preview=raw_text[:120],
        )

        return raw_text