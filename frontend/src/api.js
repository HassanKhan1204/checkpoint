const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function request(path, options) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    throw new Error(`${options?.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function fetchMembers() {
  return request("/members");
}

export function fetchQuietMembers(days) {
  return request(`/insights/quiet-members?days=${days}`);
}

export function logCheckIn({ memberId, organizerId }) {
  return request("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_type: "check_in",
      member_id: memberId,
      organizer_id: organizerId,
    }),
  });
}
