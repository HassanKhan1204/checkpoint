-- Postgres (OLTP): source of truth for teachers and the students they support.

CREATE TABLE IF NOT EXISTS teachers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT,
    -- Nullable: a teacher created via the old POST /teachers endpoint (or a
    -- future admin import) has no password and simply can't log in yet.
    password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES teachers(id),
    name TEXT NOT NULL,
    group_name TEXT,
    contact TEXT,
    notes TEXT,
    -- Nullable: existing test/demo students predate this column.
    parent_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_teacher_id ON students(teacher_id);

-- Library of short passages a student reads aloud during an assessment —
-- what their speech is compared against. grade_level uses the same free
-- text convention as students.group_name (e.g. "3rd grade") so the two
-- can be matched directly.
CREATE TABLE IF NOT EXISTS passages (
    id SERIAL PRIMARY KEY,
    grade_level TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passages_grade_level ON passages(grade_level);
