"""Code document metadata extraction schema."""

from pydantic import BaseModel, Field


class CodeMetadata(BaseModel):
    """Metadata extracted from code documents."""

    summary: str = ""
    summary_short: str = ""
    summary_medium: str = ""
    summary_long: str = ""
    keywords: list[str] = Field(default_factory=list)
    purpose: str = ""
    complexity: str = ""  # low, medium, high


# Prompt template for code metadata extraction
PROMPT = """Analyze this code and extract metadata.

Provide:
- summary: A 1-2 sentence summary of what this code does
- summary_short: A one-sentence summary (≤20 words)
- summary_medium: A 2-3 sentence summary
- summary_long: A comprehensive summary (4-6 sentences)
- keywords: List of key concepts, patterns, or technologies (5-10 items)
- purpose: The purpose of this code in the broader system
- complexity: Rate the complexity as "low", "medium", or "high"

Code:
{text}

Respond with valid JSON matching this schema: {schema}"""
