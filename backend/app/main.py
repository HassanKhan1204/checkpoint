from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.clickhouse import close_clickhouse_client, get_clickhouse_client
from app.db.postgres import close_pool, get_pool
from app.routers import events, insights, students, teachers


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    get_clickhouse_client()
    yield
    await close_pool()
    close_clickhouse_client()


app = FastAPI(title="Checkpoint API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(teachers.router)
app.include_router(students.router)
app.include_router(events.router)
app.include_router(insights.router)


@app.get("/health")
async def health() -> dict[str, str]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")

    client = get_clickhouse_client()
    client.command("SELECT 1")

    return {"status": "ok"}
