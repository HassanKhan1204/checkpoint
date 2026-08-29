const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Set once at login/signup (and on app load, from localStorage) so every
// request below can attach it without each call site having to know about it.
let authToken = null;

export function setAuthToken(token) {
  authToken = token;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `${options?.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function signup({ name, email, password }) {
  return request("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
}

export function login({ email, password }) {
  return request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export function fetchMe() {
  return request("/auth/me");
}

export function fetchStudents() {
  return request("/students");
}

export function fetchDecliningStudentDrafts() {
  return request("/insights/declining-students/drafts");
}

export function fetchStudentEvents(studentId) {
  return request(`/events/students/${studentId}`);
}

export function fetchPassages(gradeLevel) {
  const query = gradeLevel ? `?grade_level=${encodeURIComponent(gradeLevel)}` : "";
  return request(`/passages${query}`);
}

export function logAssessment({ studentId, fluencyScore, accuracyPct, errorTags }) {
  return request("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_id: studentId,
      fluency_score: fluencyScore,
      accuracy_pct: accuracyPct,
      error_tags: errorTags,
    }),
  });
}
