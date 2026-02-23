"""PDF document metadata extraction schema."""

from pydantic import BaseModel, Field


class Section(BaseModel):
    """A section from a PDF document."""

    title: str = ""
    summary: str = ""


class InvoiceLineItem(BaseModel):
    """A line item in an invoice."""

    description: str = ""
    quantity: str = ""
    unit_price: str = ""
    amount: str = ""
    vat_rate: str = ""


class InvoiceMetadata(BaseModel):
    """Structured invoice data extracted from a PDF."""

    is_invoice: bool = False
    sender: str = ""
    receiver: str = ""
    invoice_identifier: str | None = None
    invoice_number: str = ""
    invoice_date: str = ""
    due_date: str = ""
    currency: str = ""
    subtotal: str = ""
    vat_amount: str = ""
    total_amount: str = ""
    line_items: list[InvoiceLineItem] = Field(default_factory=list)


class PDFMetadata(BaseModel):
    """Metadata extracted from PDF documents."""

    summary: str = ""
    summary_short: str = ""
    summary_medium: str = ""
    summary_long: str = ""
    keywords: list[str] = Field(default_factory=list)
    key_entities: list[str] = Field(default_factory=list)
    sections: list[Section] = Field(default_factory=list)
    invoice: InvoiceMetadata = Field(default_factory=InvoiceMetadata)


# Prompt template for PDF metadata extraction
PROMPT = """Analyze this PDF document and extract metadata.

Provide:
- summary: An overall summary of the document
- summary_short: A one-sentence summary (≤20 words)
- summary_medium: A 2-3 sentence summary
- summary_long: A comprehensive summary (4-6 sentences)
- keywords: List of key topics or concepts (5-10 items)
- key_entities: List of key entities, names, or concepts mentioned
- sections: List of major sections with title and summary
- invoice: Invoice metadata (set is_invoice to true if this is an invoice,
  and populate all relevant fields including sender, receiver, dates, amounts, and line_items)

PDF content:
{text}

Respond with valid JSON matching this schema: {schema}"""
