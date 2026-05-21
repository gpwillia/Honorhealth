import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveRequest,
  createTradeRequest,
  denyRequest,
  getMyShifts,
  getPendingQueue,
  getTradeBoard,
  postShift,
  userChoices
} from "./api";
import type { Shift, TradeRequest } from "./types";

interface PolicyRule {
  id: string;
  title: string;
  description: string;
}

const policyRules: PolicyRule[] = [
  {
    id: "policy-ownership",
    title: "Shift Ownership and Posting Eligibility",
    description:
      "Only the officer assigned to a shift can post it, and only when the shift is currently Assigned."
  },
  {
    id: "policy-status",
    title: "Posted Shift Required for Requests",
    description: "Officers can request pickup only for shifts with status Posted."
  },
  {
    id: "policy-self-request",
    title: "No Self-Request",
    description: "An officer cannot request pickup for their own posted shift."
  },
  {
    id: "policy-role",
    title: "Role Qualification Check",
    description: "The requesting officer must hold the role required by the shift."
  },
  {
    id: "policy-armed",
    title: "Armed Qualification Check",
    description:
      "If a shift requires armed qualification, only officers marked armed-qualified pass validation."
  },
  {
    id: "policy-rest-ot",
    title: "Rest and Overtime Check (12-hour max)",
    description:
      "The request fails if it overlaps another same-day shift or would exceed 12 total working hours that day."
  },
  {
    id: "policy-conflict",
    title: "One Active Pending Request per Shift",
    description: "Only one pending request can exist for a posted shift at a time."
  },
  {
    id: "policy-supervisor",
    title: "Supervisor Approval Required",
    description:
      "Only a supervisor can approve or deny pending requests, and approval reruns validation checks."
  }
];

function formatRange(startAt: string, endAt: string): string {
  const start = new Date(startAt).toLocaleString();
  const end = new Date(endAt).toLocaleString();
  return `${start} - ${end}`;
}

export function App() {
  const [activeUserId, setActiveUserId] = useState("officer1");
  const [userSearch, setUserSearch] = useState("");
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [tradeBoard, setTradeBoard] = useState<Shift[]>([]);
  const [queue, setQueue] = useState<TradeRequest[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePolicyId, setActivePolicyId] = useState<string | null>(null);
  const userSearchRef = useRef<HTMLInputElement | null>(null);

  const currentUser = useMemo(
    () => userChoices.find((item) => item.id === activeUserId) ?? userChoices[0],
    [activeUserId]
  );

  const activePolicy = useMemo(
    () => policyRules.find((policy) => policy.id === activePolicyId) ?? null,
    [activePolicyId]
  );

  const filteredUserChoices = useMemo(() => {
    const query = userSearch.trim().toLowerCase();

    if (!query) {
      return userChoices;
    }

    return userChoices.filter((choice) => {
      const label = choice.label.toLowerCase();
      const role = choice.role.toLowerCase();
      const id = choice.id.toLowerCase();
      return label.includes(query) || role.includes(query) || id.includes(query);
    });
  }, [userSearch]);

  const selectedUserId = useMemo(() => {
    const hasSelected = filteredUserChoices.some((choice) => choice.id === activeUserId);
    return hasSelected ? activeUserId : "";
  }, [activeUserId, filteredUserChoices]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "/") {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      const isEditable =
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target?.isContentEditable;

      if (isEditable) {
        return;
      }

      event.preventDefault();
      userSearchRef.current?.focus();
      userSearchRef.current?.select();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function loadData() {
    setError(null);

    try {
      const [myShiftsResult, boardResult] = await Promise.all([
        getMyShifts(activeUserId),
        getTradeBoard(activeUserId)
      ]);

      setMyShifts(myShiftsResult);
      setTradeBoard(boardResult);

      if (currentUser.role === "Supervisor") {
        const pending = await getPendingQueue(activeUserId);
        setQueue(pending);
      } else {
        setQueue([]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load data";
      setError(msg);
    }
  }

  useEffect(() => {
    void loadData();
  }, [activeUserId]);

  async function handlePostShift(shiftId: string) {
    setMessage(null);
    setError(null);

    try {
      await postShift(activeUserId, shiftId);
      setMessage("Shift posted to Trade Board.");
      await loadData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to post shift";
      setError(msg);
    }
  }

  async function handleRequestPickup(shiftId: string) {
    setMessage(null);
    setError(null);

    try {
      await createTradeRequest(activeUserId, shiftId);
      setMessage("Pickup request submitted for supervisor review.");
      await loadData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to submit request";
      setError(msg);
    }
  }

  async function handleApprove(requestId: string) {
    setMessage(null);
    setError(null);

    try {
      await approveRequest(activeUserId, requestId);
      setMessage("Request approved and shift reassigned.");
      await loadData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Approval failed";
      setError(msg);
    }
  }

  async function handleDeny(requestId: string) {
    setMessage(null);
    setError(null);

    try {
      await denyRequest(activeUserId, requestId);
      setMessage("Request denied.");
      await loadData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Deny failed";
      setError(msg);
    }
  }

  return (
    <main className="app">
      <header className="topShell">
        <div className="brandBanner" role="img" aria-label="HonorHealth banner">
          <img src="/honor-health-logo.png" alt="HonorHealth" />
        </div>

        <div className="headerRow">
          <div>
            <p className="eyebrow">Security Operations</p>
            <h1>Shift Trade Board</h1>
            <p className="subhead">Coordinate secure, policy-aware shift trades across all officers.</p>
          </div>

          <label className="userPicker">
            <span>Active user</span>
            <input
              ref={userSearchRef}
              type="search"
              placeholder="Search officer by name or id"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              aria-label="Search active user list"
            />
            <select
              value={selectedUserId}
              onChange={(e) => {
                if (!e.target.value) {
                  return;
                }

                setActiveUserId(e.target.value);
              }}
            >
              {filteredUserChoices.length > 0 ? (
                filteredUserChoices.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} ({option.role})
                  </option>
                ))
              ) : (
                <option value="" disabled>
                  No matches found
                </option>
              )}
            </select>
          </label>
        </div>

        {message ? <div className="notice ok">{message}</div> : null}
        {error ? <div className="notice error">{error}</div> : null}
      </header>

      <section className="workspaceLayout">
        <aside className="card policyCard">
          <h2>Validation Policies</h2>
          <nav aria-label="Trade validation rules">
            <ul className="policyList">
              {policyRules.map((policy) => (
                <li key={policy.id}>
                  <button
                    className="policyLink"
                    type="button"
                    onClick={() => setActivePolicyId(policy.id)}
                  >
                    {policy.title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="grid">
          <article className="card">
            <h2>My Shifts</h2>
            <div className="list">
              {myShifts.map((shift) => (
                <div className="item" key={shift.id}>
                  <div><strong>{shift.location}</strong> ({shift.roleRequired})</div>
                  <div className="meta">{formatRange(shift.startAt, shift.endAt)}</div>
                  <div className="meta">Armed Required: {shift.armedRequired ? "Yes" : "No"}</div>
                  <div className="meta">Status: <span className="status">{shift.status}</span></div>
                  <p className="meta">{shift.canPost ? "Eligible for posting" : shift.reason}</p>
                  <button disabled={!shift.canPost || currentUser.role !== "Officer"} onClick={() => void handlePostShift(shift.id)}>
                    Post to Trade Board
                  </button>
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <h2>Open Posted Shifts</h2>
            <div className="list">
              {tradeBoard.map((shift) => (
                <div className="item" key={shift.id}>
                  <div><strong>{shift.location}</strong> ({shift.roleRequired})</div>
                  <div className="meta">{formatRange(shift.startAt, shift.endAt)}</div>
                  <div className="meta">Owner: {shift.currentOfficerId}</div>
                  <div className="meta">Status: <span className="status">{shift.status}</span></div>
                  <button
                    disabled={currentUser.role !== "Officer" || shift.currentOfficerId === activeUserId}
                    onClick={() => void handleRequestPickup(shift.id)}
                  >
                    Request Pickup
                  </button>
                </div>
              ))}
            </div>
          </article>

          {currentUser.role === "Supervisor" ? (
            <article className="card">
              <h2>Approval Queue</h2>
              <div className="list">
                {queue.map((request) => (
                  <div className="item" key={request.id}>
                    <div><strong>Request {request.id}</strong></div>
                    <div className="meta">Shift: {request.shift.location} ({request.shift.roleRequired})</div>
                    <div className="meta">From {request.postingOfficerId} to {request.requestingOfficerId}</div>
                    <div className="meta">Validation: {request.validations[0]?.overallPass ? "PASS" : "FAIL"}</div>
                    <div className="actionRow">
                      <button onClick={() => void handleApprove(request.id)}>Approve</button>
                      <button className="danger" onClick={() => void handleDeny(request.id)}>Deny</button>
                    </div>
                  </div>
                ))}
                {queue.length === 0 ? <div className="meta">No pending requests.</div> : null}
              </div>
            </article>
          ) : null}
        </div>
      </section>

      {activePolicy ? (
        <div className="policyModalBackdrop" role="presentation" onClick={() => setActivePolicyId(null)}>
          <div
            className="policyModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="policy-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="policyModalHeader">
              <h3 id="policy-modal-title">{activePolicy.title}</h3>
              <button type="button" className="secondary" onClick={() => setActivePolicyId(null)}>
                Close
              </button>
            </div>
            <p>{activePolicy.description}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
