import anthropic

from app.config import settings
from app.models.schemas import DecliningStudent

_SYSTEM_PROMPT = (
    "You draft short, warm notes a teacher can send home to a parent about "
    "their child's recent reading progress. The student's reading fluency "
    "has dipped over their last three assessments. Write one or two "
    "sentences in a supportive, not-alarming tone — describe the progress "
    "in plain, encouraging language a parent would find easy to read; don't "
    "cite raw scores or clinical words like 'decline' or 'trend'. Then "
    "suggest exactly one concrete next step, chosen from the student's "
    "error tags on their most recent assessment: if the errors are mostly "
    "decoding-related, suggest phonics practice (e.g. sounding out words "
    "together, a phonics app or workbook); if mostly comprehension-related, "
    "suggest reading together and talking about what was read; otherwise, "
    "suggest a bit of extra reading time at home each day. Output only the "
    "message body a teacher could copy and send directly — no greeting, no "
    "signature, no explanation."
)

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        default_headers = None
        if settings.anthropic_workspace_id:
            default_headers = {"anthropic-workspace-id": settings.anthropic_workspace_id}
        _client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            default_headers=default_headers,
        )
    return _client


async def draft_outreach_note(student: DecliningStudent) -> str:
    group = student.group_name or "their group"
    scores = ", ".join(str(round(point.fluency_score)) for point in student.history)
    latest = student.history[-1]
    tags = ", ".join(latest.error_tags) if latest.error_tags else "none noted"
    context = (
        f"{student.name} (group: {group})'s last three reading fluency scores "
        f"(words correct per minute), oldest to most recent, were: {scores}. "
        f"That's a drop from an average of {student.average_previous_score:.1f} "
        f"over the prior two assessments to {latest.fluency_score:.1f} most "
        f"recently. Error tags noted on the most recent assessment: {tags}."
    )

    client = _get_client()
    response = await client.messages.create(
        model="claude-sonnet-5",
        max_tokens=120,
        thinking={"type": "disabled"},
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": context}],
    )
    return next(block.text for block in response.content if block.type == "text")
