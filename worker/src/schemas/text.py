"""Generic text document metadata extraction schema."""

from pydantic import BaseModel, Field


class TextMetadata(BaseModel):
    """Metadata extracted from generic text documents."""

    summary: str = ""
    summary_short: str = ""
    summary_medium: str = ""
    summary_long: str = ""
    keywords: list[str] = Field(default_factory=list)
    key_entities: list[str] = Field(default_factory=list)


# Prompt template for text metadata extraction
PROMPT = """Analyze this text and extract metadata.

Provide:
- summary: A concise summary of the text
- key_entities: List of key entities, names, or concepts mentioned

Text:
{text}

Respond with valid JSON matching this schema: {schema}"""
