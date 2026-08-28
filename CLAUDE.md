# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Checkpoint

## What this is
A one-day hackathon build (ClickHouse Hackathon, SF) for the reading crisis
track. Core idea: teachers log quick reading assessments on their students —
a fluency score plus error type tags. The system detects declining reading
trends automatically and an agent drafts a parent note with a suggested next
step — instead of the teacher having to notice patterns manually in a
spreadsheet.

## Architecture
- **Postgres (OLTP)**: source of truth — students/members, organizers, groups
- **ClickHouse (OLAP)**: append-only event log — check-ins, assessments,
  attendance — queried for trends via aggregate functions (uniq, quantile,
  sumIf) and "who's gone quiet" style HAVING queries
- **Backend**: FastAPI (Python)
- **Frontend**: React + Vite
- **Agent layer**: Anthropic API, watches ClickHouse aggregates and drafts
  outreach/flags — not just a static dashboard

## Solo build — keep it simple
- One repo, direct commits to main, no branching overhead
- Prioritize one working vertical (pick reading OR loneliness) over building
  both halfway
- Dual-write pattern: app writes to Postgres, then inserts a lightweight
  event into ClickHouse — no CDC/sync infra needed today

## Conventions
- Python: FastAPI + Pydantic models, type hints throughout
- ClickHouse: MergeTree engine, ORDER BY (event_type, event_time) as default
  pattern unless a table needs otherwise
- Keep .env out of git — use .env.example instead