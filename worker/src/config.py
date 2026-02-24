import os

# API communication settings
API_URL = os.environ.get("API_URL", "http://localhost:3000")
API_TOKEN = os.environ.get("API_TOKEN", "")

# LLM provider settings
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_API_KEY = os.environ.get("OLLAMA_API_KEY", "")

OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
EXTRACTOR_MAX_OUTPUT_TOKENS = int(os.environ.get("EXTRACTOR_MAX_OUTPUT_TOKENS", "16384"))

EXTRACTOR_MODEL_FAST = os.environ.get("EXTRACTOR_MODEL_FAST", "gpt-4.1-mini")
EXTRACTOR_MODEL_CAPABLE = os.environ.get("EXTRACTOR_MODEL_CAPABLE", "gpt-4.1-mini")
EXTRACTOR_MODEL_VISION = os.environ.get("EXTRACTOR_MODEL_VISION", "gpt-4.1-mini")

# Anthropic-specific model defaults (Claude models)
ANTHROPIC_MODEL_FAST = os.environ.get("ANTHROPIC_MODEL_FAST", "claude-3-5-haiku-20241022")
ANTHROPIC_MODEL_CAPABLE = os.environ.get("ANTHROPIC_MODEL_CAPABLE", "claude-3-5-sonnet-20241022")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")


def resolve_extractor_provider() -> str:
    """Resolve the extractor provider from environment variables.

    Returns:
        Provider name: 'ollama', 'openai', or 'anthropic'

    Raises:
        ValueError: If EXTRACTOR_PROVIDER is set to an invalid value
    """
    raw = os.environ.get("EXTRACTOR_PROVIDER", "auto").strip().lower()
    if raw in ("ollama", "openai", "anthropic"):
        return raw
    if raw == "auto":
        if os.environ.get("OPENAI_API_KEY"):
            return "openai"
        if os.environ.get("ANTHROPIC_API_KEY"):
            return "anthropic"
        return "ollama"
    raise ValueError(f"Invalid EXTRACTOR_PROVIDER: {raw}")


EXTRACTOR_PROVIDER = resolve_extractor_provider()

# Worker settings
WORKER_CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", "4"))
MAX_RETRIES = 3
QUEUE_NAME = "enrichment"
