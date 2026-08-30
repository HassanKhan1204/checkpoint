import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchStudents,
  fetchDecliningStudentDrafts,
  fetchStudentEvents,
  fetchPassages,
  logAssessment,
  signup,
  login,
  fetchMe,
  setAuthToken,
  createStudent,
  updateStudent,
  deleteStudent,
} from "./api";
import "./App.css";

const AUTH_TOKEN_KEY = "checkpoint_token";

const STATUS_RANK = { declining: 0, insufficient_data: 1, ok: 2 };

// Chrome/Edge ship this behind a webkit prefix; Firefox doesn't implement it
// at all. Compute once and branch on it rather than failing inside the
// click handler.
const SpeechRecognitionAPI =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

// Below this accuracy, tag the assessment "unclear" — roughly the standard
// oral-reading-fluency "frustration level" cutoff. We don't have enough
// signal here to tell decoding errors from comprehension errors, so we
// don't try.
const LOW_ACCURACY_THRESHOLD = 90;

function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

// Longest common subsequence length between the reference passage and the
// transcript — words matched in the same relative order count as "correct",
// which tolerates the student skipping, inserting, or misreading the odd
// word without cascading every later word into a mismatch.
function countWordsCorrect(referenceWords, transcriptWords) {
  const n = referenceWords.length;
  const m = transcriptWords.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        referenceWords[i - 1] === transcriptWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[n][m];
}

function scoreReading(passageText, transcriptText, elapsedSeconds) {
  const referenceWords = normalizeWords(passageText);
  const transcriptWords = normalizeWords(transcriptText);
  const totalWords = referenceWords.length;
  const wordsCorrect = totalWords === 0 ? 0 : countWordsCorrect(referenceWords, transcriptWords);
  const accuracyPct = totalWords === 0 ? 0 : (wordsCorrect / totalWords) * 100;
  const minutes = Math.max(elapsedSeconds, 1) / 60; // guard against a near-instant stop
  const fluencyScore = wordsCorrect / minutes;
  const errorTags = accuracyPct < LOW_ACCURACY_THRESHOLD ? ["unclear"] : [];
  return { wordsCorrect, totalWords, accuracyPct, fluencyScore, errorTags };
}

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

// The class/group name shown in the header. Falls back to something
// generic if students span more than one group.
function groupHeading(students) {
  if (students.length === 0) return null;
  const groups = new Set(students.map((s) => s.group_name).filter(Boolean));
  return groups.size === 1 ? [...groups][0] : "Your students";
}

// One understated line — not a stats dashboard, just a quick read on how
// many students may need a look this week.
function summarySentence(total, decliningCount) {
  if (total === 0) return null;
  if (decliningCount === 0) {
    return "All students are on track this week.";
  }
  const noun = decliningCount === 1 ? "student" : "students";
  return `${decliningCount} of ${total} ${noun} may need attention this week.`;
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

// A mailto: link pre-filled with the drafted note — recipient left blank
// (rather than omitting the button) when no parent email is on file, so
// the teacher can still open it and address it themselves.
function buildMailtoHref(student) {
  const to = student.parent_email ?? "";
  const subject = encodeURIComponent(`A quick note about ${student.name}'s reading`);
  const body = encodeURIComponent(student.draft ?? "");
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

// public/logo.svg — the same file the favicon is generated from, so the
// header mark and the browser tab icon are always the same image.
function BrandMark() {
  return <img className="brand-mark" src="/logo.svg" alt="" width="40" height="40" />;
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
        <div className="note-actions">
          <button className="note-copy-button" onClick={onCopy}>
            {copied ? "Copied!" : "Copy note"}
          </button>
          <a
            className="note-email-button"
            href={buildMailtoHref(student)}
            title={student.parent_email ? undefined : "No parent email on file — you can still address it yourself"}
          >
            ✉️ Open in email
          </a>
        </div>
      </div>
    </div>
  );
}

function formatElapsed(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function ListenModal({ student, onClose, onAssessmentLogged }) {
  const [passage, setPassage] = useState(null);
  const [passageIsFallback, setPassageIsFallback] = useState(false);
  const [passageError, setPassageError] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [speechError, setSpeechError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [scoreResult, setScoreResult] = useState(null);

  const recognitionRef = useRef(null);
  const timerRef = useRef(null);
  const keepListeningRef = useRef(false);
  // onend fires asynchronously, after this render's closures were created —
  // reading transcript/elapsedSeconds state directly there would see stale
  // values from whenever startRecording ran. Refs give the current value.
  const transcriptRef = useRef("");
  const elapsedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function loadPassage() {
      try {
        let results = await fetchPassages(student.group_name);
        let fallback = false;
        if (results.length === 0) {
          results = await fetchPassages();
          fallback = true;
        }
        if (!cancelled) {
          setPassage(results[0] ?? null);
          setPassageIsFallback(fallback && results.length > 0);
        }
      } catch (err) {
        if (!cancelled) setPassageError(err.message);
      }
    }
    loadPassage();
    return () => {
      cancelled = true;
    };
  }, [student.group_name]);

  // Stop everything on unmount — don't leave the mic listening or the
  // timer running after the modal closes.
  useEffect(() => {
    return () => {
      keepListeningRef.current = false;
      recognitionRef.current?.stop();
      clearInterval(timerRef.current);
    };
  }, []);

  async function finalizeRecording() {
    const finalTranscript = transcriptRef.current.trim();
    const seconds = elapsedRef.current;

    if (!finalTranscript) {
      return; // nothing was said — nothing to score or log
    }

    const result = scoreReading(passage.text, finalTranscript, seconds);
    setScoreResult(result);
    setSubmitting(true);
    setSubmitError(null);
    try {
      await logAssessment({
        studentId: student.id,
        fluencyScore: Math.round(result.fluencyScore),
        accuracyPct: Math.round(result.accuracyPct * 10) / 10,
        errorTags: result.errorTags,
      });
      onAssessmentLogged?.();
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function startRecording() {
    setSpeechError(null);
    setSubmitError(null);
    setScoreResult(null);
    setTranscript("");
    setInterimText("");
    setElapsedSeconds(0);
    transcriptRef.current = "";
    elapsedRef.current = 0;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalChunk += result[0].transcript;
        } else {
          interimChunk += result[0].transcript;
        }
      }
      if (finalChunk) {
        setTranscript((prev) => {
          const next = prev ? `${prev} ${finalChunk}`.trim() : finalChunk.trim();
          transcriptRef.current = next;
          return next;
        });
      }
      setInterimText(interimChunk);
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech") return; // benign — keep listening
      setSpeechError(`Speech recognition error: ${event.error}`);
    };

    recognition.onend = () => {
      // Chrome ends the session on silence even with continuous: true —
      // restart it transparently as long as the user hasn't pressed Stop.
      // Once they have, this is the reliable point to score and submit:
      // stop() is async, so scoring immediately inside stopRecording()
      // could miss whatever result event was still in flight.
      if (keepListeningRef.current) {
        recognition.start();
      } else {
        finalizeRecording();
      }
    };

    keepListeningRef.current = true;
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);

    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => {
        const next = s + 1;
        elapsedRef.current = next;
        return next;
      });
    }, 1000);
  }

  function stopRecording() {
    keepListeningRef.current = false;
    clearInterval(timerRef.current);
    setIsRecording(false);
    recognitionRef.current?.stop();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="listen-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Listen to ${student.name} read`}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="modal-student-name">Listen to {student.name} read</h2>

        {passageError && <p className="error">{passageError}</p>}
        {!passageError && !passage && <p className="listen-loading">Finding a passage...</p>}
        {passage && (
          <div className="passage-card">
            <span className="passage-grade">{passage.grade_level}</span>
            <p className="passage-text">{passage.text}</p>
            {passageIsFallback && (
              <p className="passage-fallback-note">
                No passage found for {student.group_name ?? "this grade"} — showing a different grade instead.
              </p>
            )}
          </div>
        )}

        {!SpeechRecognitionAPI ? (
          <p className="error">
            Speech recognition isn't supported in this browser. Try Chrome or Edge.
          </p>
        ) : (
          <>
            <p className="experimental-note">
              Experimental: uses your browser's speech recognition to estimate reading fluency
              automatically. Best in a quiet room.
            </p>
            <div className="listen-controls">
            <button
              className={isRecording ? "stop-button" : "start-button"}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!passage}
            >
              {isRecording ? "⏹ Stop recording" : "🎤 Start recording"}
            </button>
            {isRecording && <span className="recording-indicator">● Recording</span>}
            <span className="listen-timer">{formatElapsed(elapsedSeconds)}</span>
            </div>
          </>
        )}

        {speechError && <p className="error">{speechError}</p>}

        <div className="transcript-box">
          {transcript || interimText ? (
            <p className="transcript-text">
              {transcript}
              {interimText && <span className="transcript-interim"> {interimText}</span>}
            </p>
          ) : (
            <p className="transcript-empty">The transcript will appear here as the student reads.</p>
          )}
        </div>

        {submitting && <p className="listen-loading">Scoring and logging the assessment...</p>}
        {submitError && <p className="error">Couldn't log the assessment: {submitError}</p>}
        {scoreResult && !submitting && !submitError && (
          <p className="score-result">
            Logged: {Math.round(scoreResult.fluencyScore)} WCPM · {scoreResult.accuracyPct.toFixed(1)}% accuracy (
            {scoreResult.wordsCorrect} of {scoreResult.totalWords} words)
            {scoreResult.errorTags.includes("unclear") && " — tagged unclear"}
          </p>
        )}
      </div>
    </div>
  );
}

function AuthScreen({ onAuthSuccess }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response =
        mode === "signup" ? await signup({ name, email, password }) : await login({ email, password });
      onAuthSuccess(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dashboard auth-screen">
      <header className="app-header">
        <div className="brand">
          <BrandMark />
          <h1>Checkpoint</h1>
        </div>
        <p className="app-tagline">
          Checkpoint helps teachers spot reading trends early and reach out to families
          before a small dip becomes a bigger gap.
        </p>
      </header>

      <form className="auth-card" onSubmit={handleSubmit}>
        <h2 className="auth-title">{mode === "signup" ? "Create your account" : "Welcome back"}</h2>

        {mode === "signup" && (
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Please wait..." : mode === "signup" ? "Sign up" : "Log in"}
        </button>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setError(null);
            setMode((m) => (m === "signup" ? "login" : "signup"));
          }}
        >
          {mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}
        </button>
      </form>
    </div>
  );
}

function StudentFormModal({ student, onClose, onSaved }) {
  const isEdit = Boolean(student);
  const [name, setName] = useState(student?.name ?? "");
  const [groupName, setGroupName] = useState(student?.group_name ?? "");
  const [parentEmail, setParentEmail] = useState(student?.parent_email ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await updateStudent(student.id, {
          name,
          groupName: groupName || null,
          parentEmail: parentEmail || null,
          // Not exposed in this trimmed form — carry the existing values
          // through so a PUT (which replaces the whole record) doesn't
          // silently clear them.
          contact: student.contact ?? null,
          notes: student.notes ?? null,
        });
      } else {
        await createStudent({ name, groupName: groupName || null, parentEmail: parentEmail || null });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="student-form-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit ${student.name}` : "Add a student"}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="modal-student-name">{isEdit ? `Edit ${student.name}` : "Add a student"}</h2>

        <form className="student-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="form-field">
            <span>Group / grade</span>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. 3rd grade"
            />
          </label>
          <label className="form-field">
            <span>Parent email</span>
            <input
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              placeholder="parent@example.com"
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={submitting}>
            {submitting ? "Saving..." : isEdit ? "Save changes" : "Add student"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(AUTH_TOKEN_KEY));
  const [teacher, setTeacher] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [students, setStudents] = useState([]);
  const [decliningList, setDecliningList] = useState([]);
  const [okHistoryById, setOkHistoryById] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [listenStudentId, setListenStudentId] = useState(null);
  const [studentModal, setStudentModal] = useState(null); // null | { mode: "add" } | { mode: "edit", student }
  const [removeConfirmId, setRemoveConfirmId] = useState(null);
  const [removingId, setRemovingId] = useState(null);

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

  // Validate any stored token against the server on load (and whenever it
  // changes) — a stale or tampered token in localStorage should drop back
  // to the login screen, not surface as a broken dashboard.
  useEffect(() => {
    setAuthToken(token);
    if (!token) {
      setTeacher(null);
      setAuthChecking(false);
      return;
    }
    let cancelled = false;
    setAuthChecking(true);
    fetchMe()
      .then((current) => {
        if (!cancelled) setTeacher(current);
      })
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem(AUTH_TOKEN_KEY);
          setAuthToken(null);
          setToken(null);
          setTeacher(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (teacher) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacher]);

  function handleAuthSuccess({ access_token, teacher: signedInTeacher }) {
    localStorage.setItem(AUTH_TOKEN_KEY, access_token);
    setToken(access_token);
    setTeacher(signedInTeacher);
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setAuthToken(null);
    setToken(null);
    setTeacher(null);
    setStudents([]);
    setDecliningList([]);
    setOkHistoryById(new Map());
    setSelectedId(null);
    setListenStudentId(null);
  }

  useEffect(() => {
    if (selectedId === null && listenStudentId === null && studentModal === null && removeConfirmId === null) {
      return;
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setSelectedId(null);
        setListenStudentId(null);
        setStudentModal(null);
        setRemoveConfirmId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, listenStudentId, studentModal, removeConfirmId]);

  const rows = useMemo(
    () => sortStudents(mergeStudents(students, decliningList, okHistoryById)),
    [students, decliningList, okHistoryById]
  );

  const selectedStudent = rows.find((s) => s.id === selectedId) ?? null;
  const listenStudent = rows.find((s) => s.id === listenStudentId) ?? null;
  const decliningCount = rows.filter((s) => s.status === "declining").length;

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

  async function handleStudentSaved() {
    setStudentModal(null);
    await refresh();
  }

  async function handleRemoveConfirmed(student) {
    setRemovingId(student.id);
    setError(null);
    try {
      await deleteStudent(student.id);
      setRemoveConfirmId(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  }

  if (authChecking) {
    return (
      <div className="dashboard auth-screen">
        <p className="listen-loading">Loading…</p>
      </div>
    );
  }

  if (!teacher) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="dashboard">
      <div className="page-header">
        <header className="app-header">
          <div className="brand">
            <BrandMark />
            <h1>Checkpoint</h1>
          </div>
          <p className="app-tagline">
            Checkpoint helps teachers spot reading trends early and reach out to families
            before a small dip becomes a bigger gap.
          </p>
        </header>

        <div className="controls">
          <button onClick={refresh} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button type="button" onClick={() => setStudentModal({ mode: "add" })}>
            + Add student
          </button>
          <span className="signed-in-as">Signed in as {teacher.name}</span>
          <button type="button" className="logout-button" onClick={handleLogout}>
            Log out
          </button>
        </div>

        {error && <p className="error">{error}</p>}
      </div>

      {rows.length > 0 && (
        <div className="class-summary">
          <h2 className="class-name">{groupHeading(rows)}</h2>
          <p className="class-stat">{summarySentence(rows.length, decliningCount)}</p>
        </div>
      )}

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
                <div className="card-header-actions">
                  <StatusBadge student={student} />
                  <div className="card-icon-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Edit ${student.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setStudentModal({ mode: "edit", student });
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${student.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRemoveConfirmId(student.id);
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>

              {removeConfirmId === student.id && (
                <div className="remove-confirm" onClick={(e) => e.stopPropagation()}>
                  <span>Remove {student.name}?</span>
                  <button
                    type="button"
                    className="remove-confirm-yes"
                    onClick={() => handleRemoveConfirmed(student)}
                    disabled={removingId === student.id}
                  >
                    {removingId === student.id ? "Removing..." : "Yes, remove"}
                  </button>
                  <button type="button" onClick={() => setRemoveConfirmId(null)}>
                    Cancel
                  </button>
                </div>
              )}

              <div className="card-body">
                <Sparkline history={student.history} status={student.status} />
                {student.status !== "ok" && <ErrorTags tags={latestTags} />}
              </div>

              {hasNote && <span className="view-note-hint">✉️ Click to view parent note</span>}

              <button
                className="listen-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setListenStudentId(student.id);
                }}
              >
                🎤 Listen to student read
              </button>

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

      {listenStudent && (
        <ListenModal
          student={listenStudent}
          onClose={() => setListenStudentId(null)}
          onAssessmentLogged={refresh}
        />
      )}

      {studentModal && (
        <StudentFormModal
          student={studentModal.mode === "edit" ? studentModal.student : null}
          onClose={() => setStudentModal(null)}
          onSaved={handleStudentSaved}
        />
      )}
    </div>
  );
}
