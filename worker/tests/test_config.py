"""Tests for provider resolution in config."""

import pytest


def test_auto_defaults_to_ollama(monkeypatch):
    """Auto provider resolves to ollama when no API keys are set."""
    monkeypatch.delenv("EXTRACTOR_PROVIDER", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    from src.config import resolve_extractor_provider

    assert resolve_extractor_provider() == "ollama"


def test_auto_selects_openai_when_key_present(monkeypatch):
    """Auto provider resolves to openai when OPENAI_API_KEY is set."""
    monkeypatch.delenv("EXTRACTOR_PROVIDER", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    from src.config import resolve_extractor_provider

    assert resolve_extractor_provider() == "openai"


def test_auto_selects_anthropic_when_only_anthropic_key(monkeypatch):
    """Auto provider resolves to anthropic when only ANTHROPIC_API_KEY is set."""
    monkeypatch.delenv("EXTRACTOR_PROVIDER", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    from src.config import resolve_extractor_provider

    assert resolve_extractor_provider() == "anthropic"


@pytest.mark.parametrize("provider", ["ollama", "openai", "anthropic"])
def test_explicit_provider_overrides_auto(monkeypatch, provider):
    """Explicit EXTRACTOR_PROVIDER value overrides auto-detection."""
    monkeypatch.setenv("EXTRACTOR_PROVIDER", provider)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    from src.config import resolve_extractor_provider

    assert resolve_extractor_provider() == provider


def test_invalid_provider_raises_value_error(monkeypatch):
    """Invalid EXTRACTOR_PROVIDER value raises ValueError."""
    monkeypatch.setenv("EXTRACTOR_PROVIDER", "invalid_provider")

    from src.config import resolve_extractor_provider

    with pytest.raises(ValueError, match="Invalid EXTRACTOR_PROVIDER"):
        resolve_extractor_provider()
