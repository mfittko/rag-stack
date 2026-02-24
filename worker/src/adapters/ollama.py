"""Ollama adapter for LLM extraction."""

from src.adapters.openai import OpenAIAdapter
from src.config import OLLAMA_API_KEY, OLLAMA_URL, OPENAI_API_KEY


def _normalize_ollama_base_url(url: str) -> str:
    """Ensure the Ollama URL ends with /v1 for OpenAI-compatibility.

    Examples:
        http://localhost:11434   → http://localhost:11434/v1
        http://localhost:11434/  → http://localhost:11434/v1
        http://localhost:11434/v1 → http://localhost:11434/v1
    """
    stripped = url.rstrip("/")
    if not stripped.endswith("/v1"):
        stripped = stripped + "/v1"
    return stripped


class OllamaAdapter(OpenAIAdapter):
    """Ollama-based LLM extraction adapter (thin OpenAI-compatible wrapper)."""

    def __init__(self):
        api_key = OLLAMA_API_KEY or OPENAI_API_KEY or "not-required"
        super().__init__(
            base_url=_normalize_ollama_base_url(OLLAMA_URL),
            api_key=api_key,
        )
