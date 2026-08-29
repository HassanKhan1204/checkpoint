const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function request(path, options) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `${options?.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function fetchStudents() {
  return request("/students");
}

export function fetchQuietStudentDrafts(days) {
  return request(`/insights/quiet-students/drafts?days=${days}`);
}

export function logAssessment({ studentId, teacherId, fluencyScore, accuracyPct, errorTags }) {
  return request("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_id: studentId,
      teacher_id: teacherId,
      fluency_score: fluencyScore,
      accuracy_pct: accuracyPct,
      error_tags: errorTags,
    }),
  });
}
