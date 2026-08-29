"""Seed a realistic demo class for the demo teacher account.

Creates the demo teacher (jane@example.com / checkpoint-demo) if she
doesn't exist yet, then a class of 10 students spanning 3rd and 4th grade
with reading_assessment histories chosen to exercise every branch of the
trend-detection logic in app/routers/insights.py:

  - clear decliners (Maya Chen, Aisha Patel, Emma Rodriguez, Liam Johnson)
  - steady/improving, correctly not flagged (Jordan Lee, Sofia Martinez)
  - a single off-day dip that recovers — a visible wobble in the sparkline
    that should NOT flag, since the *latest three* readings are flat/up
    (Noah Kim, Ethan Brooks, Olivia Nguyen)
  - not enough data yet, fewer than 3 assessments (Marcus Bell)

Intended for a fresh database (run once after `python -m scripts.init_db`)
— re-running it against a database that already has this data will create
duplicate students, since student names aren't unique. It's a seed script,
not a sync/upsert.

Usage (from backend/):
    python -m scripts.seed_demo_data
"""

import asyncio
import json
from datetime import datetime

import asyncpg
import clickhouse_connect

from app.config import settings
from app.services.auth import hash_password

DEMO_TEACHER_EMAIL = "jane@example.com"
DEMO_TEACHER_PASSWORD = "checkpoint-demo"
EVENT_TYPE = "reading_assessment"

# name, group_name, parent_email
STUDENTS = [
    ("Maya Chen", "3rd grade", None),
    ("Aisha Patel", "3rd grade", None),
    ("Jordan Lee", "3rd grade", None),
    ("Noah Kim", "3rd grade", None),
    ("Emma Rodriguez", "4th grade", "carla.rodriguez@gmail.com"),
    ("Liam Johnson", "3rd grade", "mjohnson82@yahoo.com"),
    ("Sofia Martinez", "4th grade", "martinez.family@outlook.com"),
    ("Ethan Brooks", "4th grade", "dbrooks@icloud.com"),
    ("Olivia Nguyen", "4th grade", "thanh.nguyen@gmail.com"),
    ("Marcus Bell", "3rd grade", "kbell1979@hotmail.com"),
]

# name -> [(event_time, fluency_score, accuracy_pct, error_tags), ...]
EVENTS_BY_NAME = {
    # Clear, steady decline — flags "declining".
    "Maya Chen": [
        ("2026-08-08 00:25:05", 72.0, 91.0, []),
        ("2026-08-15 00:25:05", 68.0, 87.0, ["decoding"]),
        ("2026-08-29 00:25:05", 55.0, 78.0, ["decoding"]),
    ],
    "Aisha Patel": [
        ("2026-08-08 00:25:05", 90.0, 95.0, []),
        ("2026-08-15 00:25:05", 86.0, 93.0, ["comprehension"]),
        ("2026-08-29 00:25:05", 74.0, 90.0, ["comprehension"]),
    ],
    "Emma Rodriguez": [
        ("2026-08-01 00:00:00", 88.0, 94.0, []),
        ("2026-08-08 00:00:00", 84.0, 92.0, []),
        ("2026-08-15 00:00:00", 79.0, 88.0, ["decoding"]),
        ("2026-08-29 00:00:00", 65.0, 80.0, ["decoding"]),
    ],
    "Liam Johnson": [
        ("2026-08-01 00:00:00", 60.0, 90.0, []),
        ("2026-08-15 00:00:00", 54.0, 85.0, ["decoding"]),
        ("2026-08-29 00:00:00", 42.0, 75.0, ["decoding"]),
    ],
    # Steady improvement — should not flag.
    "Jordan Lee": [
        ("2026-08-08 00:25:05", 50.0, 80.0, ["decoding"]),
        ("2026-08-15 00:25:05", 58.0, 84.0, ["decoding"]),
        ("2026-08-29 00:25:05", 66.0, 90.0, []),
    ],
    "Sofia Martinez": [
        ("2026-08-01 07:00:00", 70.0, 90.0, []),
        ("2026-08-08 07:00:00", 74.0, 91.0, []),
        ("2026-08-15 07:00:00", 78.0, 93.0, []),
        ("2026-08-29 07:00:00", 83.0, 95.0, []),
    ],
    # A single off-day dip that recovers — visible in the sparkline, but
    # the latest three readings are flat/up, so this should not flag.
    "Noah Kim": [
        ("2026-08-15 00:25:05", 60.0, 85.0, []),
        ("2026-08-29 00:25:05", 63.0, 87.0, []),
        ("2026-08-29 22:33:53", 80.0, 95.0, []),
    ],
    "Ethan Brooks": [
        ("2026-08-01 07:00:00", 72.0, 92.0, []),
        ("2026-08-08 07:00:00", 75.0, 93.0, []),
        ("2026-08-15 07:00:00", 69.0, 89.0, []),
        ("2026-08-29 07:00:00", 76.0, 93.0, []),
    ],
    "Olivia Nguyen": [
        ("2026-08-08 07:00:00", 65.0, 88.0, []),
        ("2026-08-15 07:00:00", 62.0, 87.0, []),
        ("2026-08-29 07:00:00", 66.0, 90.0, []),
    ],
    # Only 2 assessments on file — "not enough data yet".
    "Marcus Bell": [
        ("2026-08-15 00:00:00", 50.0, 85.0, []),
        ("2026-08-29 00:00:00", 53.0, 87.0, []),
    ],
}


async def seed_postgres() -> tuple[int, dict[str, int]]:
    conn = await asyncpg.connect(
        host=settings.postgres_host,
        port=settings.postgres_port,
        database=settings.postgres_db,
        user=settings.postgres_user,
        password=settings.postgres_password,
    )
    try:
        teacher_id = await conn.fetchval(
            "SELECT id FROM teachers WHERE email = $1", DEMO_TEACHER_EMAIL
        )
        if teacher_id is None:
            teacher_id = await conn.fetchval(
                """
                INSERT INTO teachers (name, email, password_hash)
                VALUES ($1, $2, $3)
                RETURNING id
                """,
                "Jane Teacher",
                DEMO_TEACHER_EMAIL,
                hash_password(DEMO_TEACHER_PASSWORD),
            )
            print(f"Created demo teacher {DEMO_TEACHER_EMAIL!r} (id={teacher_id}).")
        else:
            print(f"Demo teacher {DEMO_TEACHER_EMAIL!r} already exists (id={teacher_id}).")

        student_ids: dict[str, int] = {}
        for name, group_name, parent_email in STUDENTS:
            student_id = await conn.fetchval(
                """
                INSERT INTO students (teacher_id, name, group_name, parent_email)
                VALUES ($1, $2, $3, $4)
                RETURNING id
                """,
                teacher_id,
                name,
                group_name,
                parent_email,
            )
            student_ids[name] = student_id
        print(f"Inserted {len(student_ids)} students.")
        return teacher_id, student_ids
    finally:
        await conn.close()


def seed_clickhouse(teacher_id: int, student_ids: dict[str, int]) -> None:
    client = clickhouse_connect.get_client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        username=settings.clickhouse_user,
        password=settings.clickhouse_password,
        database=settings.clickhouse_database,
    )
    rows = []
    for name, events in EVENTS_BY_NAME.items():
        student_id = student_ids[name]
        for event_time, fluency_score, accuracy_pct, error_tags in events:
            metadata = json.dumps({"accuracy_pct": accuracy_pct, "error_tags": error_tags})
            rows.append(
                [
                    EVENT_TYPE,
                    datetime.strptime(event_time, "%Y-%m-%d %H:%M:%S"),
                    student_id,
                    teacher_id,
                    fluency_score,
                    metadata,
                ]
            )
    client.insert(
        "events",
        rows,
        column_names=["event_type", "event_time", "student_id", "teacher_id", "value", "metadata"],
    )
    print(f"Inserted {len(rows)} reading_assessment events.")


async def main() -> None:
    teacher_id, student_ids = await seed_postgres()
    seed_clickhouse(teacher_id, student_ids)
    print(f"Done. Log in with {DEMO_TEACHER_EMAIL} / {DEMO_TEACHER_PASSWORD}.")


if __name__ == "__main__":
    asyncio.run(main())
