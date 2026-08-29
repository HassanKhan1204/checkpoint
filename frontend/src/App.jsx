import { useEffect, useMemo, useState } from "react";
import { fetchStudents, fetchDecliningStudentDrafts, logAssessment } from "./api";
import "./App.css";

const STATUS_RANK = { declining: 0, insufficient_data: 1, ok: 2 };

function mergeStudents(students, decliningList) {
  const infoById = new Map(decliningList.map((d, index) => [d.student_id, { ...d, apiOrder: index }]));

  return students.map((student) => {
    const info = infoById.get(student.id);
    return {
      ...student,
      status: info ? info.status : "ok",
      history: info ? info.history : [],
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

function StatusBadge({ student }) {
  if (student.status === "declining") {
    return <span className="badge badge-declining">Declining</span>;
  }
  if (student.status === "insufficient_data") {
    return <span className="badge badge-pending">Not enough data</span>;
  }
  return <span className="badge badge-ok">OK</span>;
}

function HistoryCell({ student }) {
  if (student.history.length === 0) {
    return <span className="draft-empty">—</span>;
  }
  const scores = student.history.map((point) => Math.round(point.fluency_score)).join(" → ");
  return (
    <span className="history-text">
      {scores} <span className="history-unit">WCPM</span>
    </span>
  );
}

export default function App() {
  const [students, setStudents] = useState([]);
  const [decliningList, setDecliningList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [studentList, declining] = await Promise.all([
        fetchStudents(),
        fetchDecliningStudentDrafts(),
      ]);
      setStudents(studentList);
      setDecliningList(declining);
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

  const rows = useMemo(
    () => sortStudents(mergeStudents(students, decliningList)),
    [students, decliningList]
  );

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
      <h1>Checkpoint</h1>

      <div className="controls">
        <button onClick={refresh} disabled={loading}>
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
            <th>Fluency history</th>
            <th>Parent note draft</th>
            <th>Log assessment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((student) => (
            <tr key={student.id} className={`row-${student.status}`}>
              <td>{student.name}</td>
              <td>{student.group_name ?? "—"}</td>
              <td>
                <StatusBadge student={student} />
              </td>
              <td>
                <HistoryCell student={student} />
              </td>
              <td className="draft-cell">
                {student.draft ? (
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
                <form
                  className="assessment-form"
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
              </td>
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={6}>No students yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
