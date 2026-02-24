"""Meeting notes metadata extraction schema."""

from pydantic import BaseModel, Field


class ActionItem(BaseModel):
    """An action item from a meeting."""

    task: str
    assignee: str = ""
    deadline: str = ""


class TopicSegment(BaseModel):
    """A topic discussed in the meeting."""

    topic: str
    summary: str


class MeetingMetadata(BaseModel):
    """Metadata extracted from meeting notes."""

    decisions: list[str] = Field(default_factory=list)
    action_items: list[ActionItem] = Field(default_factory=list)
    topic_segments: list[TopicSegment] = Field(default_factory=list)
    summary: str = ""
    summary_short: str = ""
    summary_medium: str = ""
    summary_long: str = ""
    keywords: list[str] = Field(default_factory=list)


# Prompt template for meeting metadata extraction
PROMPT = """Analyze these meeting notes and extract metadata.

Provide:
- decisions: List of decisions made in the meeting
- action_items: List of action items with task, assignee, and deadline (if mentioned)
- topic_segments: List of topics discussed with a summary for each
- summary: A brief overall summary of the meeting
- summary_short: A one-sentence summary (≤20 words)
- summary_medium: A 2-3 sentence summary
- summary_long: A comprehensive summary (4-6 sentences)
- keywords: List of key topics or themes (5-10 items)

Meeting notes:
{text}

Respond with valid JSON matching this schema: {schema}"""
