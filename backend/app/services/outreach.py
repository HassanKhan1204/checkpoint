import anthropic

from app.config import settings
from app.models.schemas import DecliningStudent

_SYSTEM_PROMPT = (
    "You draft short, warm parent notes for teachers to send about a student "
    "whose reading fluency has declined across their last three assessments. "
    "Write one or two sentences: mention the trend gently, without alarming "
    "the parent or overstating the concern from a few data points, and "
    "suggest a simple next step (e.g. reading together at home, a follow-up "
    "check-in). Output only the message body a teacher could copy and send "
    "directly — no greeting, no signature, no explanation."
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
    latest = student.history[-1].fluency_score
    context = (
        f"{student.name} (group: {group})'s last three reading fluency scores "
        f"(words correct per minute), oldest to most recent, were: {scores}. "
        f"That's a drop from an average of {student.average_previous_score:.1f} "
        f"over the prior two assessments to {latest:.1f} most recently."
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
