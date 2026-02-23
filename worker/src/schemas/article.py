"""Article/blog post metadata extraction schema."""

from pydantic import BaseModel, Field


class ArticleMetadata(BaseModel):
    """Metadata extracted from articles and blog posts."""

    summary: str = ""
    summary_short: str = ""
    summary_medium: str = ""
    summary_long: str = ""
    keywords: list[str] = Field(default_factory=list)
    takeaways: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    target_audience: str = ""


# Prompt template for article metadata extraction
PROMPT = """Analyze this article and extract metadata.

Provide:
- summary: A summary of the article
- summary_short: A one-sentence summary (≤20 words)
- summary_medium: A 2-3 sentence summary
- summary_long: A comprehensive summary (4-6 sentences)
- keywords: List of key topics or concepts (5-10 items)
- takeaways: List of key takeaways or main points
- tags: List of relevant tags or topics
- target_audience: Description of the intended audience

Article:
{text}

Respond with valid JSON matching this schema: {schema}"""
