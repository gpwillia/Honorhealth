import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveRequest,
  createSchedule,
  createTradeRequest,
  denyRequest,
  getOfficers,
  getSchedule,
  getMyShifts,
  getPendingQueue,
  getTradeRequestsByStatus,
  getTradeBoard,
  postShift,
  updateSchedule,
  userChoices
} from "./api";
import type { Officer, ScheduleShift, Shift, TradeRequest } from "./types";

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

function toDateTimeLocal(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatScheduleDay(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatScheduleTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatReviewerName(userId?: string | null): string {
  if (!userId) {
    return "Pending review";
  }

  const match = userChoices.find((choice) => choice.id === userId);
  if (!match) {
    return userId;
  }

  return match.label.replace(/\s+\(.+\)$/, "");
}

function formatReviewedAt(value?: string | null): string {
  if (!value) {
    return "Pending";
  }

  return new Date(value).toLocaleString();
}

export function App() {
  const now = new Date();
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 7);

  const [activeUserId, setActiveUserId] = useState("officer1");
  const [activePage, setActivePage] = useState<"trade" | "schedule">("trade");
  const [userSearch, setUserSearch] = useState("");
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [tradeBoard, setTradeBoard] = useState<Shift[]>([]);
  const [queue, setQueue] = useState<TradeRequest[]>([]);
  const [requestHistory, setRequestHistory] = useState<TradeRequest[]>([]);
  const [bypassByRequest, setBypassByRequest] = useState<Record<string, boolean>>({});
  const [bypassReasonByRequest, setBypassReasonByRequest] = useState<Record<string, string>>({});
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [scheduleShifts, setScheduleShifts] = useState<ScheduleShift[]>([]);
  const [scheduleOfficerId, setScheduleOfficerId] = useState("");
  const [scheduleFrom, setScheduleFrom] = useState(toDateTimeLocal(now));
  const [scheduleTo, setScheduleTo] = useState(toDateTimeLocal(nextWeek));
  const [editShiftId, setEditShiftId] = useState<string | null>(null);
  const [formOfficerId, setFormOfficerId] = useState("officer1");
  const [formStartAt, setFormStartAt] = useState(toDateTimeLocal(now));
  const [formEndAt, setFormEndAt] = useState(toDateTimeLocal(nextWeek));
  const [formLocation, setFormLocation] = useState("Deer Valley");
  const [formRoleRequired, setFormRoleRequired] = useState("Security Officer");
  const [formArmedRequired, setFormArmedRequired] = useState(false);
  const [formNotes, setFormNotes] = useState("");
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
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

  const scheduleGroupedByDay = useMemo(() => {
    const grouped = new Map<string, ScheduleShift[]>();

    for (const shift of scheduleShifts) {
      const day = new Date(shift.startAt).toISOString().slice(0, 10);
      const bucket = grouped.get(day) ?? [];
      bucket.push(shift);
      grouped.set(day, bucket);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, shifts]) => ({
        day,
        shifts: shifts.sort(
          (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
        )
      }));
  }, [scheduleShifts]);

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

  async function loadTradeData() {
    setError(null);

    try {
      const [myShiftsResult, boardResult] = await Promise.all([
        getMyShifts(activeUserId),
        getTradeBoard(activeUserId)
      ]);

      setMyShifts(myShiftsResult);
      setTradeBoard(boardResult);

      if (currentUser.role === "Supervisor") {
        const [pending, approved, denied] = await Promise.all([
          getPendingQueue(activeUserId),
          getTradeRequestsByStatus(activeUserId, "Approved"),
          getTradeRequestsByStatus(activeUserId, "Denied")
        ]);

        setQueue(pending);
        setRequestHistory(
          [...approved, ...denied].sort((a, b) => {
            const left = a.reviewedAt ? new Date(a.reviewedAt).getTime() : 0;
            const right = b.reviewedAt ? new Date(b.reviewedAt).getTime() : 0;
            return right - left;
          })
        );
        setBypassByRequest((prev) => {
          const next: Record<string, boolean> = {};
          for (const request of pending) {
            next[request.id] = prev[request.id] ?? false;
          }
          return next;
        });
        setBypassReasonByRequest((prev) => {
          const next: Record<string, string> = {};
          for (const request of pending) {
            next[request.id] = prev[request.id] ?? "";
          }
          return next;
        });
      } else {
        setQueue([]);
        setRequestHistory([]);
        setBypassByRequest({});
        setBypassReasonByRequest({});
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load data";
      setError(msg);
    }
  }

    async function loadScheduleData() {
      setError(null);

      try {
        const [officerResult, scheduleResult] = await Promise.all([
          getOfficers(activeUserId),
          getSchedule(activeUserId, {
            officerId: scheduleOfficerId || undefined,
            from: scheduleFrom,
            to: scheduleTo
          })
        ]);

        setOfficers(officerResult);
        setScheduleShifts(scheduleResult);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load schedule";
        setError(msg);
      }
    }

  useEffect(() => {
      void loadTradeData();
      void loadScheduleData();
    }, [activeUserId]);

  async function handlePostShift(shiftId: string) {
    setMessage(null);
    setError(null);

    try {
      await postShift(activeUserId, shiftId);
      setMessage("Shift posted to Trade Board.");
      await loadTradeData();
      await loadScheduleData();
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
      await loadTradeData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to submit request";
      setError(msg);
    }
  }

  async function handleApprove(requestId: string) {
    setMessage(null);
    setError(null);

    try {
      const bypassValidation = bypassByRequest[requestId] ?? false;
      const bypassReason = (bypassReasonByRequest[requestId] ?? "").trim();

      if (bypassValidation && !bypassReason) {
        setError("Bypass reason is required when override is enabled.");
        return;
      }

      await approveRequest(activeUserId, requestId, {
        bypassValidation,
        bypassReason: bypassValidation ? bypassReason : undefined
      });

      setBypassByRequest((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
      setBypassReasonByRequest((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
      setMessage("Request approved and shift reassigned.");
      await loadTradeData();
      await loadScheduleData();
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
      await loadTradeData();
  
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Deny failed";
      setError(msg);
    }
  }

  async function handleScheduleSearch(): Promise<void> {
    await loadScheduleData();
  }

  async function handleCreateOrUpdateSchedule(): Promise<void> {
    setMessage(null);
    setError(null);
    setIsSavingSchedule(true);

    try {
      if (editShiftId) {
        await updateSchedule(activeUserId, editShiftId, {
          officerId: formOfficerId,
          startAt: formStartAt,
          endAt: formEndAt,
          location: formLocation,
          roleRequired: formRoleRequired,
          armedRequired: formArmedRequired,
          notes: formNotes || null
        });
        setMessage("Schedule updated.");
      } else {
        await createSchedule(activeUserId, {
          officerId: formOfficerId,
          startAt: formStartAt,
          endAt: formEndAt,
          location: formLocation,
          roleRequired: formRoleRequired,
          armedRequired: formArmedRequired,
          notes: formNotes || undefined
        });
        setMessage("Schedule created.");
      }

      setEditShiftId(null);
      setFormNotes("");
      await loadScheduleData();
      await loadTradeData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to save schedule";
      setError(msg);
    } finally {
      setIsSavingSchedule(false);
    }
  }

  function beginEdit(shift: ScheduleShift): void {
    setEditShiftId(shift.id);
    setFormOfficerId(shift.currentOfficerId);
    setFormStartAt(toDateTimeLocal(new Date(shift.startAt)));
    setFormEndAt(toDateTimeLocal(new Date(shift.endAt)));
    setFormLocation(shift.location);
    setFormRoleRequired(shift.roleRequired);
    setFormArmedRequired(shift.armedRequired);
    setFormNotes(shift.notes ?? "");
    setActivePage("schedule");
  }

  function resetScheduleForm(): void {
    setEditShiftId(null);
    setFormOfficerId("officer1");
    setFormStartAt(toDateTimeLocal(new Date()));
    const next = new Date();
    next.setHours(next.getHours() + 8);
    setFormEndAt(toDateTimeLocal(next));
    setFormLocation("Deer Valley");
    setFormRoleRequired("Security Officer");
    setFormArmedRequired(false);
    setFormNotes("");
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
            <div className="tabRow">
              <button
                type="button"
                className={activePage === "trade" ? "secondary" : ""}
                onClick={() => setActivePage("trade")}
              >
                Trade Board
              </button>
              <button
                type="button"
                className={activePage === "schedule" ? "secondary" : ""}
                onClick={() => setActivePage("schedule")}
              >
                Schedule Calendar
              </button>
            </div>
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

        {activePage === "trade" ? (
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
                    <div className="approvalHistory">
                      <div className="meta"><strong>Approval History</strong></div>
                      <div className="meta">Supervisor: {formatReviewerName(request.reviewedBy)}</div>
                      <div className="meta">Date/Time: {formatReviewedAt(request.reviewedAt)}</div>
                    </div>
                    <div className="overridePanel">
                      <label className="overrideToggle">
                        <input
                          type="checkbox"
                          checked={bypassByRequest[request.id] ?? false}
                          onChange={(e) =>
                            setBypassByRequest((prev) => ({
                              ...prev,
                              [request.id]: e.target.checked
                            }))
                          }
                        />
                        Bypass validation for this approval
                      </label>
                      {(bypassByRequest[request.id] ?? false) ? (
                        <label className="overrideReason">
                          Override reason
                          <input
                            type="text"
                            value={bypassReasonByRequest[request.id] ?? ""}
                            onChange={(e) =>
                              setBypassReasonByRequest((prev) => ({
                                ...prev,
                                [request.id]: e.target.value
                              }))
                            }
                            placeholder="Explain why this shift must be approved"
                          />
                        </label>
                      ) : null}
                    </div>
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

          {currentUser.role === "Supervisor" ? (
            <article className="card">
              <h2>Request History</h2>
              <div className="list">
                {requestHistory.map((request) => (
                  <div className="item" key={request.id}>
                    <div><strong>Request {request.id}</strong></div>
                    <div className="meta">Shift: {request.shift.location} ({request.shift.roleRequired})</div>
                    <div className="meta">From {request.postingOfficerId} to {request.requestingOfficerId}</div>
                    <div className="meta">Status: <span className="status">{request.status}</span></div>
                    {request.denialReason ? <div className="meta">Reason: {request.denialReason}</div> : null}
                    <div className="approvalHistory">
                      <div className="meta"><strong>Approval History</strong></div>
                      <div className="meta">Supervisor: {formatReviewerName(request.reviewedBy)}</div>
                      <div className="meta">Date/Time: {formatReviewedAt(request.reviewedAt)}</div>
                    </div>
                  </div>
                ))}
                {requestHistory.length === 0 ? (
                  <div className="meta">No approved or denied requests yet.</div>
                ) : null}
              </div>
            </article>
          ) : null}
        </div>
        ) : (
        <div className="grid">
          <article className="card">
            <h2>Schedule Calendar</h2>
            <div className="filterRow">
              <label>
                Officer
                <select value={scheduleOfficerId} onChange={(e) => setScheduleOfficerId(e.target.value)}>
                  <option value="">All officers</option>
                  {officers.map((officer) => (
                    <option key={officer.id} value={officer.id}>{officer.name}</option>
                  ))}
                </select>
              </label>
              <label>
                From
                <input type="datetime-local" value={scheduleFrom} onChange={(e) => setScheduleFrom(e.target.value)} />
              </label>
              <label>
                To
                <input type="datetime-local" value={scheduleTo} onChange={(e) => setScheduleTo(e.target.value)} />
              </label>
              <button type="button" onClick={() => void handleScheduleSearch()}>Refresh</button>
            </div>

            <div className="timeline">
              {scheduleGroupedByDay.map((group) => (
                <div key={group.day} className="timelineDay">
                  <h3>{formatScheduleDay(group.day)}</h3>
                  <div className="list">
                    {group.shifts.map((shift) => (
                      <div className="item" key={shift.id}>
                        <div><strong>{shift.location}</strong> ({shift.roleRequired})</div>
                        <div className="meta">Officer: {shift.currentOfficerId}</div>
                        <div className="meta">{formatScheduleTime(shift.startAt)} - {formatScheduleTime(shift.endAt)}</div>
                        <div className="meta">Status: <span className="status">{shift.status}</span></div>
                        {shift.notes ? <div className="meta">Notes: {shift.notes}</div> : null}
                        {currentUser.role === "Supervisor" ? (
                          <div className="actionRow">
                            <button type="button" onClick={() => beginEdit(shift)}>Edit Shift</button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {scheduleGroupedByDay.length === 0 ? <p className="meta">No scheduled shifts in this range.</p> : null}
            </div>
          </article>

          {currentUser.role === "Supervisor" ? (
            <article className="card">
              <h2>{editShiftId ? "Edit Schedule" : "Create Schedule"}</h2>
              <div className="formGrid">
                <label>
                  Officer
                  <select value={formOfficerId} onChange={(e) => setFormOfficerId(e.target.value)}>
                    {officers.map((officer) => (
                      <option key={officer.id} value={officer.id}>{officer.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Start
                  <input type="datetime-local" value={formStartAt} onChange={(e) => setFormStartAt(e.target.value)} />
                </label>
                <label>
                  End
                  <input type="datetime-local" value={formEndAt} onChange={(e) => setFormEndAt(e.target.value)} />
                </label>
                <label>
                  Location
                  <select value={formLocation} onChange={(e) => setFormLocation(e.target.value)}>
                    <option value="Deer Valley">Deer Valley</option>
                    <option value="TMC">TMC</option>
                    <option value="JCL">JCL</option>
                    <option value="Hospital (New)">Hospital (New)</option>
                  </select>
                </label>
                <label>
                  Role Required
                  <input value={formRoleRequired} onChange={(e) => setFormRoleRequired(e.target.value)} />
                </label>
                <label>
                  Notes
                  <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
                </label>
                <label className="checkboxField">
                  <input type="checkbox" checked={formArmedRequired} onChange={(e) => setFormArmedRequired(e.target.checked)} />
                  Armed Required
                </label>
              </div>

              <div className="actionRow">
                <button type="button" disabled={isSavingSchedule} onClick={() => void handleCreateOrUpdateSchedule()}>
                  {isSavingSchedule ? "Saving..." : editShiftId ? "Update Schedule" : "Create Schedule"}
                </button>
                {editShiftId ? (
                  <button type="button" className="secondary" onClick={resetScheduleForm}>Cancel Edit</button>
                ) : null}
              </div>
            </article>
          ) : null}
        </div>
        )}
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
