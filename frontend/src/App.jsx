import { useEffect, useMemo, useState } from "react";
import { fetchStudents, fetchQuietStudentDrafts, logCheckIn } from "./api";
import "./App.css";

const DEFAULT_DAYS = 14;

function mergeStudents(students, quietStudents) {
  const quietById = new Map(quietStudents.map((q) => [q.student_id, q]));

  return students.map((student) => {
    const quiet = quietById.get(student.id);
    return {
      ...student,
      isQuiet: Boolean(quiet),
      daysSinceCheckIn: quiet ? quiet.days_since_check_in : null,
      draft: quiet ? quiet.draft : null,
    };
  });
}

function sortStudents(students) {
  return [...students].sort((a, b) => {
    if (a.isQuiet !== b.isQuiet) return a.isQuiet ? -1 : 1;
    if (a.isQuiet && b.isQuiet) {
      if (a.daysSinceCheckIn === null) return -1;
      if (b.daysSinceCheckIn === null) return 1;
      return b.daysSinceCheckIn - a.daysSinceCheckIn;
    }
    return a.name.localeCompare(b.name);
  });
}

function StatusBadge({ student }) {
  if (!student.isQuiet) {
    return <span className="badge badge-ok">OK</span>;
  }
  if (student.daysSinceCheckIn === null) {
    return <span className="badge badge-quiet">Never checked in</span>;
  }
  return (
    <span className="badge badge-quiet">
      Quiet &mdash; {student.daysSinceCheckIn}d ago
    </span>
  );
}

export default function App() {
  const [students, setStudents] = useState([]);
  const [quietStudents, setQuietStudents] = useState([]);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  async function refresh(threshold = days) {
    setLoading(true);
    setError(null);
    try {
      const [studentList, quietList] = await Promise.all([
        fetchStudents(),
        fetchQuietStudentDrafts(threshold),
      ]);
      setStudents(studentList);
      setQuietStudents(quietList);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(DEFAULT_DAYS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(
    () => sortStudents(mergeStudents(students, quietStudents)),
    [students, quietStudents]
  );

  async function handleCheckIn(student) {
    setPendingId(student.id);
    setError(null);
    try {
      await logCheckIn({ studentId: student.id, teacherId: student.teacher_id });
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
      <h1>Checkpoint</h1>

      <div className="controls">
        <label>
          Quiet threshold (days):{" "}
          <input
            type="number"
            min="1"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
        <button onClick={() => refresh(days)} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Group</th>
            <th>Status</th>
            <th>Outreach draft</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((student) => (
            <tr key={student.id} className={student.isQuiet ? "row-quiet" : ""}>
              <td>{student.name}</td>
              <td>{student.group_name ?? "—"}</td>
              <td>
                <StatusBadge student={student} />
              </td>
              <td className="draft-cell">
                {student.isQuiet && student.draft ? (
                  <>
                    <span className="draft-text">{student.draft}</span>
                    <button onClick={() => handleCopy(student)}>
                      {copiedId === student.id ? "Copied!" : "Copy"}
                    </button>
                  </>
                ) : (
                  <span className="draft-empty">—</span>
                )}
              </td>
              <td>
                <button
                  onClick={() => handleCheckIn(student)}
                  disabled={pendingId === student.id}
                >
                  {pendingId === student.id ? "Logging..." : "Log check-in"}
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={5}>No students yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
