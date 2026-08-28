"""Apply the Postgres and ClickHouse schema files.

Usage (from backend/):
    python -m scripts.init_db
"""

import asyncio
from pathlib import Path

import asyncpg
import clickhouse_connect

from app.config import settings

SCHEMA_DIR = Path(__file__).resolve().parent.parent / "app" / "schema"


async def init_postgres() -> None:
    sql = (SCHEMA_DIR / "postgres.sql").read_text()
    conn = await asyncpg.connect(
        host=settings.postgres_host,
        port=settings.postgres_port,
        database=settings.postgres_db,
        user=settings.postgres_user,
        password=settings.postgres_password,
    )
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


def init_clickhouse() -> None:
    sql = (SCHEMA_DIR / "clickhouse.sql").read_text()
    client = clickhouse_connect.get_client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        username=settings.clickhouse_user,
        password=settings.clickhouse_password,
        database=settings.clickhouse_database,
    )
    for statement in filter(None, (s.strip() for s in sql.split(";"))):
        client.command(statement)


async def main() -> None:
    await init_postgres()
    init_clickhouse()
    print("Schema applied.")


if __name__ == "__main__":
    asyncio.run(main())
