import { useEffect, useMemo, useState } from "react";
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

function formatRange(startAt: string, endAt: string): string {
  const start = new Date(startAt).toLocaleString();
  const end = new Date(endAt).toLocaleString();
  return `${start} - ${end}`;
}

export function App() {
  const [activeUserId, setActiveUserId] = useState("officer1");
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [tradeBoard, setTradeBoard] = useState<Shift[]>([]);
  const [queue, setQueue] = useState<TradeRequest[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentUser = useMemo(
    () => userChoices.find((item) => item.id === activeUserId) ?? userChoices[0],
    [activeUserId]
  );

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
          <img src="/honorhealth-banner.svg" alt="HonorHealth" />
        </div>

        <div className="headerRow">
          <div>
            <p className="eyebrow">Security Operations</p>
            <h1>Shift Trade Board</h1>
            <p className="subhead">Coordinate secure, policy-aware shift trades across all officers.</p>
          </div>

          <label className="userPicker">
            <span>Active user</span>
            <select value={activeUserId} onChange={(e) => setActiveUserId(e.target.value)}>
              {userChoices.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} ({option.role})
                </option>
              ))}
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
              <li><a href="#policy-ownership">Shift Ownership and Posting Eligibility</a></li>
              <li><a href="#policy-status">Posted Shift Required for Requests</a></li>
              <li><a href="#policy-self-request">No Self-Request</a></li>
              <li><a href="#policy-role">Role Qualification Check</a></li>
              <li><a href="#policy-armed">Armed Qualification Check</a></li>
              <li><a href="#policy-rest-ot">Rest and Overtime Check (12-hour max)</a></li>
              <li><a href="#policy-conflict">One Active Pending Request per Shift</a></li>
              <li><a href="#policy-supervisor">Supervisor Approval Required</a></li>
            </ul>
          </nav>

          <div className="policyDetails">
            <section id="policy-ownership">
              <h3>Shift Ownership and Posting Eligibility</h3>
              <p>Only the officer assigned to a shift can post it, and only when the shift is currently Assigned.</p>
            </section>
            <section id="policy-status">
              <h3>Posted Shift Required for Requests</h3>
              <p>Officers can request pickup only for shifts with status Posted.</p>
            </section>
            <section id="policy-self-request">
              <h3>No Self-Request</h3>
              <p>An officer cannot request pickup for their own posted shift.</p>
            </section>
            <section id="policy-role">
              <h3>Role Qualification Check</h3>
              <p>The requesting officer must hold the role required by the shift.</p>
            </section>
            <section id="policy-armed">
              <h3>Armed Qualification Check</h3>
              <p>If a shift requires armed qualification, only officers marked armed-qualified pass validation.</p>
            </section>
            <section id="policy-rest-ot">
              <h3>Rest and Overtime Check</h3>
              <p>The request fails if it overlaps another same-day shift or would exceed 12 total working hours that day.</p>
            </section>
            <section id="policy-conflict">
              <h3>One Active Pending Request per Shift</h3>
              <p>Only one pending request can exist for a posted shift at a time.</p>
            </section>
            <section id="policy-supervisor">
              <h3>Supervisor Approval Required</h3>
              <p>Only a supervisor can approve or deny pending requests, and approval reruns validation checks.</p>
            </section>
          </div>
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
    </main>
  );
}
