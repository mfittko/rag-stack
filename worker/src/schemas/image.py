"""Image metadata extraction schema."""

from pydantic import BaseModel, Field


class ImageMetadata(BaseModel):
    """Metadata extracted from images."""

    description: str = ""
    detected_objects: list[str] = Field(default_factory=list)
    ocr_text: str = ""
    image_type: str = ""  # photo, diagram, screenshot, chart
    summary: str = ""
    summary_short: str = ""
    summary_medium: str = ""
    summary_long: str = ""
    keywords: list[str] = Field(default_factory=list)


# Prompt template for image metadata extraction
PROMPT = """Describe this image in detail.

Provide:
- description: A detailed description of the image
- detected_objects: List of main objects/entities visible in the image
- ocr_text: Any readable text visible in the image
- image_type: Classification (photo, diagram, screenshot, or chart)

{context}

Respond with valid JSON matching this schema: {schema}"""
