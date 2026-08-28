import clickhouse_connect
from clickhouse_connect.driver.client import Client

from app.config import settings

_client: Client | None = None


def get_clickhouse_client() -> Client:
    global _client
    if _client is None:
        _client = clickhouse_connect.get_client(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            username=settings.clickhouse_user,
            password=settings.clickhouse_password,
            database=settings.clickhouse_database,
        )
    return _client


def close_clickhouse_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
