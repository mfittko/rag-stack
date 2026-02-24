"""Tests for LLM adapters."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.adapters import get_adapter
from src.adapters.base import ImageDescription
from src.adapters.ollama import OllamaAdapter, _normalize_ollama_base_url
from src.adapters.openai import OpenAIAdapter


def _make_openai_response(content: str) -> MagicMock:
    """Create a mock OpenAI chat completion response."""
    choice = MagicMock()
    choice.message.content = content
    response = MagicMock()
    response.choices = [choice]
    return response


@pytest.mark.asyncio
async def test_ollama_adapter_extract_metadata():
    """Test Ollama adapter metadata extraction via OpenAI-compatible interface."""
    adapter = OllamaAdapter()

    mock_response = _make_openai_response('{"summary": "Test summary", "complexity": "low"}')

    create_mock = AsyncMock(return_value=mock_response)
    with patch.object(adapter.client.chat.completions, "create", new=create_mock):
        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "complexity": {"type": "string"},
            },
        }

        result = await adapter.extract_metadata("test code", "code", schema)

        assert "summary" in result
        assert "complexity" in result


@pytest.mark.asyncio
async def test_ollama_adapter_extract_entities():
    """Test Ollama adapter entity extraction."""
    adapter = OllamaAdapter()

    content = (
        '{"entities": [{"name": "TestClass", "type": "class", '
        '"description": "A test class"}], "relationships": []}'
    )
    mock_response = _make_openai_response(content)

    create_mock = AsyncMock(return_value=mock_response)
    with patch.object(adapter.client.chat.completions, "create", new=create_mock):
        result = await adapter.extract_entities("test text")

        assert "entities" in result
        assert "relationships" in result
        assert isinstance(result["entities"], list)


@pytest.mark.asyncio
async def test_ollama_adapter_is_available():
    """Test Ollama availability check."""
    adapter = OllamaAdapter()

    mock_response = _make_openai_response("ok")

    create_mock = AsyncMock(return_value=mock_response)
    with patch.object(adapter.client.chat.completions, "create", new=create_mock):
        result = await adapter.is_available()

        assert result is True


@pytest.mark.asyncio
async def test_ollama_adapter_is_not_available():
    """Test Ollama availability check when service is down."""
    adapter = OllamaAdapter()

    with patch.object(
        adapter.client.chat.completions,
        "create",
        new=AsyncMock(side_effect=Exception("Connection error")),
    ):
        result = await adapter.is_available()

        assert result is False


@pytest.mark.asyncio
async def test_ollama_adapter_describe_image():
    """Test Ollama image description."""
    adapter = OllamaAdapter()

    content = (
        '{"description": "A test image", '
        '"detected_objects": ["object1"], "ocr_text": "", "image_type": "photo"}'
    )
    mock_response = _make_openai_response(content)

    create_mock = AsyncMock(return_value=mock_response)
    with patch.object(adapter.client.chat.completions, "create", new=create_mock):
        result = await adapter.describe_image("base64imagedata", "test context")

        assert isinstance(result, ImageDescription)
        assert result.description == "A test image"
        assert "object1" in result.detected_objects


def test_get_adapter_default():
    """Test adapter factory returns Ollama by default."""
    with patch("src.adapters.EXTRACTOR_PROVIDER", "ollama"):
        adapter = get_adapter()
        assert isinstance(adapter, OllamaAdapter)


def test_get_adapter_ollama():
    """Test adapter factory returns Ollama when configured."""
    with patch("src.adapters.EXTRACTOR_PROVIDER", "ollama"):
        adapter = get_adapter()
        assert isinstance(adapter, OllamaAdapter)


def test_get_adapter_openai():
    """Test adapter factory returns OpenAIAdapter when configured."""
    with (
        patch("src.adapters.EXTRACTOR_PROVIDER", "openai"),
        patch("src.adapters.openai.OPENAI_API_KEY", "sk-test"),
    ):
        adapter = get_adapter()
        assert isinstance(adapter, OpenAIAdapter)
        assert not isinstance(adapter, OllamaAdapter)


@pytest.mark.asyncio
async def test_openai_adapter_json_mode_fallback():
    """Test OpenAI adapter falls back to non-JSON mode when JSON mode fails."""
    adapter = OpenAIAdapter(base_url="http://localhost:11434/v1")

    fallback_response = _make_openai_response('{"summary": "fallback result"}')

    # First call (JSON mode) raises; second call (fallback) succeeds
    create_mock = AsyncMock(side_effect=[Exception("json_object not supported"), fallback_response])

    with patch.object(adapter.client.chat.completions, "create", new=create_mock):
        schema = {"type": "object", "properties": {"summary": {"type": "string"}}}
        result = await adapter._extract_structured("test prompt", schema, "test-model")

        assert result == {"summary": "fallback result"}
        assert create_mock.call_count == 2
        # Second call must NOT have response_format
        second_call_kwargs = create_mock.call_args_list[1][1]
        assert "response_format" not in second_call_kwargs


@pytest.mark.asyncio
async def test_ollama_adapter_handles_invalid_json():
    """Test Ollama adapter handles invalid JSON gracefully."""
    adapter = OllamaAdapter()

    mock_response = _make_openai_response("invalid json{{{")

    create_mock = AsyncMock(return_value=mock_response)
    with patch.object(adapter.client.chat.completions, "create", new=create_mock):
        schema = {"type": "object", "properties": {"summary": {"type": "string"}}}

        result = await adapter.extract_metadata("test", "code", schema)

        # Should return empty structure rather than crashing
        assert isinstance(result, dict)
        assert "summary" in result


@pytest.mark.asyncio
async def test_ollama_adapter_with_custom_prompt():
    """Test Ollama adapter uses custom prompt template when provided."""
    adapter = OllamaAdapter()

    mock_response = _make_openai_response('{"summary": "Custom prompt result", "topics": []}')
    create_mock = AsyncMock(return_value=mock_response)

    with patch.object(adapter.client.chat.completions, "create", new=create_mock):
        schema = {
            "type": "object",
            "properties": {"summary": {"type": "string"}, "topics": {"type": "array"}},
        }

        custom_prompt = "Analyze this article and extract: {text}"
        result = await adapter.extract_metadata("article text", "article", schema, custom_prompt)

        assert create_mock.called
        # Verify custom prompt was incorporated
        call_kwargs = create_mock.call_args[1]
        messages = call_kwargs["messages"]
        user_message = next(m for m in messages if m["role"] == "user")
        assert "article text" in user_message["content"]

        assert isinstance(result, dict)
        assert "summary" in result


def test_ollama_url_normalization():
    """Test _normalize_ollama_base_url adds /v1 correctly."""
    assert _normalize_ollama_base_url("http://localhost:11434") == "http://localhost:11434/v1"
    assert _normalize_ollama_base_url("http://localhost:11434/") == "http://localhost:11434/v1"
    assert _normalize_ollama_base_url("http://localhost:11434/v1") == "http://localhost:11434/v1"
    assert _normalize_ollama_base_url("http://localhost:11434/v1/") == "http://localhost:11434/v1"


def test_ollama_adapter_uses_ollama_api_key():
    """Test OllamaAdapter uses OLLAMA_API_KEY when set."""
    with (
        patch("src.adapters.ollama.OLLAMA_API_KEY", "ollama-secret"),
        patch("src.adapters.ollama.OPENAI_API_KEY", "openai-key"),
    ):
        adapter = OllamaAdapter()
        # The api_key passed to AsyncOpenAI should be the ollama key
        assert adapter.client.api_key == "ollama-secret"


def test_openai_adapter_parse_json_content_direct():
    """Test _parse_json_content with valid JSON string."""
    adapter = OpenAIAdapter(base_url="http://localhost:11434/v1")
    result = adapter._parse_json_content('{"key": "value"}')
    assert result == {"key": "value"}


def test_openai_adapter_parse_json_content_fenced():
    """Test _parse_json_content with fenced markdown block."""
    adapter = OpenAIAdapter(base_url="http://localhost:11434/v1")
    content = '```json\n{"key": "value"}\n```'
    result = adapter._parse_json_content(content)
    assert result == {"key": "value"}


def test_openai_adapter_parse_json_content_substring():
    """Test _parse_json_content extracts JSON substring."""
    adapter = OpenAIAdapter(base_url="http://localhost:11434/v1")
    content = 'Here is the result: {"key": "value"} - done'
    result = adapter._parse_json_content(content)
    assert result == {"key": "value"}


def test_openai_adapter_parse_json_content_none():
    """Test _parse_json_content returns None for unparseable content."""
    adapter = OpenAIAdapter(base_url="http://localhost:11434/v1")
    result = adapter._parse_json_content("not json at all")
    assert result is None


def test_openai_adapter_parse_json_content_empty():
    """Test _parse_json_content returns None for empty/None content."""
    adapter = OpenAIAdapter(base_url="http://localhost:11434/v1")
    assert adapter._parse_json_content(None) is None
    assert adapter._parse_json_content("") is None


def test_openai_adapter_fails_fast_without_api_key():
    """Test OpenAIAdapter raises ValueError when using real OpenAI without a key."""
    with (
        patch("src.adapters.openai.OPENAI_BASE_URL", "https://api.openai.com/v1"),
        patch("src.adapters.openai.OPENAI_API_KEY", ""),
    ):
        with pytest.raises(ValueError, match="OPENAI_API_KEY is required"):
            OpenAIAdapter()


def test_openai_adapter_no_fail_fast_with_local_url():
    """Test OpenAIAdapter does NOT raise when using a local/custom base_url without a key."""
    adapter = OpenAIAdapter(base_url="http://localhost:11434/v1")
    assert adapter is not None
