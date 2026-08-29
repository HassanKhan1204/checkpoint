import { useEffect, useMemo, useState } from "react";
import {
  fetchStudents,
  fetchDecliningStudentDrafts,
  fetchStudentEvents,
  logAssessment,
} from "./api";
import "./App.css";

const STATUS_RANK = { declining: 0, insufficient_data: 1, ok: 2 };

const SPARKLINE_COLOR = {
  declining: "var(--color-status-attention-text)",
  insufficient_data: "var(--color-status-pending-text)",
  ok: "var(--color-status-ontrack-text)",
};

// The insights endpoint only returns history for flagged students (that's
// all it needs internally) — for "on track" students we pull their raw
// event history separately so their sparkline has real data too.
async function fetchOkHistories(students, decliningIds) {
  const okStudents = students.filter((s) => !decliningIds.has(s.id));
  const eventLists = await Promise.all(okStudents.map((s) => fetchStudentEvents(s.id)));

  const historyById = new Map();
  okStudents.forEach((student, i) => {
    const history = eventLists[i]
      .filter((event) => event.event_type === "reading_assessment")
      .slice(0, 3) // API returns most-recent-first
      .reverse() // chronological, oldest first — matches the insights shape
      .map((event) => {
        let parsed = {};
        try {
          parsed = JSON.parse(event.metadata || "{}");
        } catch {
          parsed = {};
        }
        return {
          event_time: event.event_time,
          fluency_score: event.value,
          accuracy_pct: parsed.accuracy_pct ?? null,
          error_tags: parsed.error_tags ?? [],
        };
      });
    historyById.set(student.id, history);
  });
  return historyById;
}

function mergeStudents(students, decliningList, okHistoryById) {
  const infoById = new Map(decliningList.map((d, index) => [d.student_id, { ...d, apiOrder: index }]));

  return students.map((student) => {
    const info = infoById.get(student.id);
    return {
      ...student,
      status: info ? info.status : "ok",
      history: info ? info.history : okHistoryById.get(student.id) ?? [],
      averagePreviousScore: info ? info.average_previous_score : null,
      draft: info ? info.draft : null,
      apiOrder: info ? info.apiOrder : Infinity,
    };
  });
}

function sortStudents(students) {
  return [...students].sort((a, b) => {
    if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) {
      return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    }
    if (a.apiOrder !== b.apiOrder) return a.apiOrder - b.apiOrder;
    return a.name.localeCompare(b.name);
  });
}

// A short, concrete line explaining why a student was flagged — the actual
// score trend and error tags, not just "declining".
function flagReason(student) {
  if (student.status !== "declining" || student.history.length === 0) return null;
  const latest = student.history[student.history.length - 1];
  const avg = Math.round(student.averagePreviousScore);
  const current = Math.round(latest.fluency_score);
  const tagPhrase = latest.error_tags.length > 0 ? `, with ${latest.error_tags.join(" and ")} errors noted` : "";
  return `Fluency dropped from an average of ${avg} to ${current} words per minute${tagPhrase}.`;
}

function StatusBadge({ student }) {
  if (student.status === "declining") {
    return <span className="badge badge-declining">Needs attention</span>;
  }
  if (student.status === "insufficient_data") {
    return <span className="badge badge-pending">Not enough data yet</span>;
  }
  return <span className="badge badge-ok">On track</span>;
}

function Sparkline({ history, status }) {
  if (history.length === 0) {
    return <span className="sparkline-empty">No history yet</span>;
  }

  const scores = history.map((point) => point.fluency_score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1; // avoid divide-by-zero when scores are flat
  const width = 96;
  const height = 32;
  const pad = 5;

  const points = scores.map((score, i) => {
    const x = scores.length === 1 ? width / 2 : pad + (i / (scores.length - 1)) * (width - pad * 2);
    const y = height - pad - ((score - min) / range) * (height - pad * 2);
    return [x, y];
  });

  const color = SPARKLINE_COLOR[status] ?? "var(--color-text-muted)";
  const pathD = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Fluency scores: ${scores.join(", ")}`}
    >
      {points.length > 1 && (
        <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={color} />
      ))}
    </svg>
  );
}

function ErrorTags({ tags }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="error-tags">
      {tags.map((tag) => (
        <span key={tag} className="error-tag">
          {tag}
        </span>
      ))}
    </div>
  );
}

function NoteModal({ student, onClose, onCopy, copied }) {
  const reason = flagReason(student);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="note-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Parent note for ${student.name}`}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="modal-student-name">{student.name}</h2>
        {reason && <p className="flag-reason">{reason}</p>}
        <div className="letter-card">
          <p className="letter-text">{student.draft}</p>
        </div>
        <button className="note-copy-button" onClick={onCopy}>
          {copied ? "Copied!" : "Copy note"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [students, setStudents] = useState([]);
  const [decliningList, setDecliningList] = useState([]);
  const [okHistoryById, setOkHistoryById] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [studentList, declining] = await Promise.all([
        fetchStudents(),
        fetchDecliningStudentDrafts(),
      ]);
      const decliningIds = new Set(declining.map((d) => d.student_id));
      const okHistories = await fetchOkHistories(studentList, decliningIds);

      setStudents(studentList);
      setDecliningList(declining);
      setOkHistoryById(okHistories);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId]);

  const rows = useMemo(
    () => sortStudents(mergeStudents(students, decliningList, okHistoryById)),
    [students, decliningList, okHistoryById]
  );

  const selectedStudent = rows.find((s) => s.id === selectedId) ?? null;

  async function handleLogAssessment(student, formEvent) {
    formEvent.preventDefault();
    const form = formEvent.target;
    const fluencyScore = Number(form.fluencyScore.value);
    const accuracyPct = Number(form.accuracyPct.value);
    const errorTags = form.errorTags.value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    setPendingId(student.id);
    setError(null);
    try {
      await logAssessment({
        studentId: student.id,
        teacherId: student.teacher_id,
        fluencyScore,
        accuracyPct,
        errorTags,
      });
      form.reset();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingId(null);
    }
  }

  async function handleCopy(student) {
    await navigator.clipboard.writeText(student.draft);
    setCopiedId(student.id);
    setTimeout(() => setCopiedId((id) => (id === student.id ? null : id)), 1500);
  }

  return (
    <div className="dashboard">
      <h1>Checkpoint — Reading Trends</h1>

      <div className="controls">
        <button onClick={refresh} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card-grid">
        {rows.map((student) => {
          const latestTags =
            student.history.length > 0 ? student.history[student.history.length - 1].error_tags : [];
          const hasNote = Boolean(student.draft);

          return (
            <div
              key={student.id}
              className={`student-card card-${student.status} ${hasNote ? "card-clickable" : ""}`}
              onClick={hasNote ? () => setSelectedId(student.id) : undefined}
              role={hasNote ? "button" : undefined}
              tabIndex={hasNote ? 0 : undefined}
              onKeyDown={
                hasNote
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(student.id);
                      }
                    }
                  : undefined
              }
            >
              <div className="card-header">
                <div>
                  <h3 className="card-name">{student.name}</h3>
                  <span className="card-group">{student.group_name ?? "—"}</span>
                </div>
                <StatusBadge student={student} />
              </div>

              <div className="card-body">
                <Sparkline history={student.history} status={student.status} />
                {student.status !== "ok" && <ErrorTags tags={latestTags} />}
              </div>

              {hasNote && <span className="view-note-hint">✉️ Click to view parent note</span>}

              <form
                className="assessment-form"
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => handleLogAssessment(student, e)}
              >
                <input
                  name="fluencyScore"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="WCPM"
                  required
                />
                <input
                  name="accuracyPct"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  placeholder="Acc %"
                  required
                />
                <input name="errorTags" type="text" placeholder="tags, comma-sep" />
                <button type="submit" disabled={pendingId === student.id}>
                  {pendingId === student.id ? "Logging..." : "Log"}
                </button>
              </form>
            </div>
          );
        })}
        {rows.length === 0 && !loading && <p>No students yet.</p>}
      </div>

      {selectedStudent && (
        <NoteModal
          student={selectedStudent}
          onClose={() => setSelectedId(null)}
          onCopy={() => handleCopy(selectedStudent)}
          copied={copiedId === selectedStudent.id}
        />
      )}
    </div>
  );
}
