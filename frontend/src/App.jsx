import { useEffect, useMemo, useState } from "react";
import { fetchMembers, fetchQuietMembers, logCheckIn } from "./api";
import "./App.css";

const DEFAULT_DAYS = 14;

function mergeMembers(members, quietMembers) {
  const quietById = new Map(quietMembers.map((q) => [q.member_id, q]));

  return members.map((member) => {
    const quiet = quietById.get(member.id);
    return {
      ...member,
      isQuiet: Boolean(quiet),
      daysSinceCheckIn: quiet ? quiet.days_since_check_in : null,
    };
  });
}

function sortMembers(members) {
  return [...members].sort((a, b) => {
    if (a.isQuiet !== b.isQuiet) return a.isQuiet ? -1 : 1;
    if (a.isQuiet && b.isQuiet) {
      if (a.daysSinceCheckIn === null) return -1;
      if (b.daysSinceCheckIn === null) return 1;
      return b.daysSinceCheckIn - a.daysSinceCheckIn;
    }
    return a.name.localeCompare(b.name);
  });
}

function StatusBadge({ member }) {
  if (!member.isQuiet) {
    return <span className="badge badge-ok">OK</span>;
  }
  if (member.daysSinceCheckIn === null) {
    return <span className="badge badge-quiet">Never checked in</span>;
  }
  return (
    <span className="badge badge-quiet">
      Quiet &mdash; {member.daysSinceCheckIn}d ago
    </span>
  );
}

export default function App() {
  const [members, setMembers] = useState([]);
  const [quietMembers, setQuietMembers] = useState([]);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);

  async function refresh(threshold = days) {
    setLoading(true);
    setError(null);
    try {
      const [memberList, quietList] = await Promise.all([
        fetchMembers(),
        fetchQuietMembers(threshold),
      ]);
      setMembers(memberList);
      setQuietMembers(quietList);
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
    () => sortMembers(mergeMembers(members, quietMembers)),
    [members, quietMembers]
  );

  async function handleCheckIn(member) {
    setPendingId(member.id);
    setError(null);
    try {
      await logCheckIn({ memberId: member.id, organizerId: member.organizer_id });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setPendingId(null);
    }
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => (
            <tr key={member.id} className={member.isQuiet ? "row-quiet" : ""}>
              <td>{member.name}</td>
              <td>{member.group_name ?? "—"}</td>
              <td>
                <StatusBadge member={member} />
              </td>
              <td>
                <button
                  onClick={() => handleCheckIn(member)}
                  disabled={pendingId === member.id}
                >
                  {pendingId === member.id ? "Logging..." : "Log check-in"}
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={4}>No members yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
