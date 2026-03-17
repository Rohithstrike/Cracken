from abc import ABC, abstractmethod
from typing import List


class BaseAIProvider(ABC):
    """
    Abstract base class for all AI provider implementations.

    Every provider (Ollama, OpenAI, Claude) must implement
    generate_regex() and return the raw model response text.
    ai_engine._parse_ai_response() handles all response parsing.
    """

    @abstractmethod
    async def generate_regex(self, sanitized_log_sample: str) -> str:
        """
        Sends sanitized log lines to the AI model and returns
        the raw response text.

        Args:
            sanitized_log_sample: Pre-sanitized and masked log lines
                                  joined as a single string.
                                  Never contains real IPs, usernames,
                                  domains, or tokens.

        Returns:
            Raw model response text. May be JSON, fenced JSON,
            or a plain regex string — ai_engine handles all formats.

        Raises:
            RuntimeError: if the provider call fails after retries.
        """
        ...