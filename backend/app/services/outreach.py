import anthropic

from app.config import settings
from app.models.schemas import QuietMember

_SYSTEM_PROMPT = (
    "You draft short, warm outreach notes for staff (teachers, senior center "
    "coordinators) to send to someone they support who has gone quiet. Write "
    "one or two sentences, warm and personal, without presuming to know why "
    "they've been away. Output only the message body a staff member could "
    "copy and send directly — no greeting, no signature, no explanation."
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


async def draft_outreach_note(member: QuietMember) -> str:
    group = member.group_name or "their group"
    if member.days_since_check_in is None:
        context = f"{member.name} (group: {group}) has never checked in."
    else:
        context = (
            f"{member.name} (group: {group}) hasn't checked in for "
            f"{member.days_since_check_in} days."
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
