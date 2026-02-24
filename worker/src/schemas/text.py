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
- summary_short: A one-sentence summary (≤20 words)
- summary_medium: A 2-3 sentence summary
- summary_long: A comprehensive summary (4-6 sentences)
- keywords: List of key topics or concepts (5-10 items)
- key_entities: List of key entities, names, or concepts mentioned

Text:
{text}

Respond with valid JSON matching this schema: {schema}"""
