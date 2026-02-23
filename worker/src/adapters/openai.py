"""OpenAI adapter for LLM extraction."""

import json
import logging
import re

from src.adapters.base import ExtractorAdapter, ImageDescription
from src.config import (
    EXTRACTOR_MAX_OUTPUT_TOKENS,
    EXTRACTOR_MODEL_CAPABLE,
    EXTRACTOR_MODEL_FAST,
    EXTRACTOR_MODEL_VISION,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
)

logger = logging.getLogger(__name__)


class OpenAIAdapter(ExtractorAdapter):
    """OpenAI GPT-based LLM extraction adapter."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(
            base_url=base_url or OPENAI_BASE_URL,
            api_key=api_key or OPENAI_API_KEY or "not-required",
        )
        self.fast_model = EXTRACTOR_MODEL_FAST
        self.capable_model = EXTRACTOR_MODEL_CAPABLE
        self.vision_model = EXTRACTOR_MODEL_VISION
        self.max_tokens = EXTRACTOR_MAX_OUTPUT_TOKENS

    async def extract_metadata(
        self, text: str, doc_type: str, schema: dict, prompt_template: str = ""
    ) -> dict:
        """Extract type-specific metadata using GPT."""
        if prompt_template:
            prompt = prompt_template.replace("{text}", text[:8000]).replace(
                "{schema}", json.dumps(schema, indent=2)
            )
        else:
            prompt = (
                f"Analyze this {doc_type} document and extract metadata "
                f"according to the schema.\n\n"
                f"Text:\n{text[:8000]}\n\n"
                f"Schema:\n{json.dumps(schema, indent=2)}\n\n"
                f"Extract the metadata as JSON."
            )

        return await self._extract_structured(prompt, schema, self.fast_model)

    async def extract_entities(self, text: str) -> dict:
        """Extract entities and relationships using GPT."""
        prompt = f"""Extract entities and relationships from this text.

Text:
{text[:8000]}

For each entity, provide:
- name: entity name
- type: entity type (person, class, concept, project, org, etc.)
- description: brief description

For each relationship:
- source: source entity name
- target: target entity name
- type: relationship type (uses, depends-on, discusses, implements, etc.)
- description: brief description"""

        schema = {
            "type": "object",
            "properties": {
                "entities": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "type": {"type": "string"},
                            "description": {"type": "string"},
                        },
                        "required": ["name", "type", "description"],
                    },
                },
                "relationships": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source": {"type": "string"},
                            "target": {"type": "string"},
                            "type": {"type": "string"},
                            "description": {"type": "string"},
                        },
                        "required": ["source", "target", "type"],
                    },
                },
            },
            "required": ["entities", "relationships"],
        }

        return await self._extract_structured(prompt, schema, self.capable_model)

    async def describe_image(self, image_base64: str, context: str = "") -> ImageDescription:
        """Describe an image using GPT Vision."""
        prompt = f"""Describe this image in detail. Provide:
- description: A detailed description of the image
- detected_objects: List of main objects/entities visible
- ocr_text: Any text visible in the image
- image_type: Classification (photo, diagram, screenshot, chart)

{f"Context: {context}" if context else ""}

Respond in JSON format."""

        try:
            response = await self.client.chat.completions.create(
                model=self.vision_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                            },
                        ],
                    }
                ],
                max_tokens=self.max_tokens,
                response_format={"type": "json_object"},
            )

            content = response.choices[0].message.content
            result = self._parse_json_content(content)
            if result is None:
                return ImageDescription(description="", detected_objects=[], ocr_text="", image_type="")
            return ImageDescription(**result)

        except Exception as e:
            logger.error(f"Error in image description: {e}")
            return ImageDescription(description="", detected_objects=[], ocr_text="", image_type="")

    async def is_available(self) -> bool:
        """Check if OpenAI API is available."""
        try:
            await self.client.chat.completions.create(
                model=self.fast_model,
                messages=[{"role": "user", "content": "test"}],
                max_tokens=5,
            )
            return True
        except Exception as e:
            logger.warning(f"OpenAI availability check failed: {e}")
            return False

    async def _extract_structured(self, prompt: str, schema: dict, model: str) -> dict:
        """Extract structured data using OpenAI's JSON mode with fallback."""
        try:
            response = await self.client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a helpful assistant that extracts "
                            "structured data. Always respond with valid JSON."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                max_tokens=self.max_tokens,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content
            result = self._parse_json_content(content)
            if result is not None:
                return result
        except Exception as e:
            logger.warning(
                f"JSON mode extraction failed ({e}); retrying without response_format"
            )

        # Fallback: retry without response_format
        try:
            response = await self.client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a helpful assistant that extracts "
                            "structured data. Always respond with valid JSON."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                max_tokens=self.max_tokens,
            )
            content = response.choices[0].message.content
            result = self._parse_json_content(content)
            if result is not None:
                return result
        except Exception as e:
            logger.error(f"Error in structured extraction (fallback): {e}")

        return self._empty_response_for_schema(schema)

    def _parse_json_content(self, content: str | None) -> dict | None:
        """Parse JSON from LLM response content using three-stage extraction.

        Stages:
        1. Direct parse of stripped content
        2. Extract from fenced markdown blocks (```json {...}```)
        3. Substring between first { and last }

        Returns:
            Parsed dict or None on all failures
        """
        if not content:
            return None

        stripped = content.strip()

        # Stage 1: direct parse
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass

        # Stage 2: fenced markdown block
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", stripped, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        # Stage 3: first { to last }
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(stripped[start : end + 1])
            except json.JSONDecodeError:
                pass

        return None

    def _empty_response_for_schema(self, schema: dict) -> dict:
        """Generate an empty response matching the schema structure."""
        result = {}
        if "properties" in schema:
            for key, prop in schema["properties"].items():
                if prop.get("type") == "array":
                    result[key] = []
                elif prop.get("type") == "string":
                    result[key] = ""
                elif prop.get("type") == "object":
                    result[key] = {}
        return result
