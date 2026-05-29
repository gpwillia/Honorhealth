import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  approveRequest,
  createSchedule,
  createTradeRequest,
  denyRequest,
  getCurrentApprovalValidation,
  getAnalytics,
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
import {
  isScheduleTemplateId,
  scheduleTemplates,
  type ScheduleTemplateId
} from "./scheduleTemplates";
import type { CurrentApprovalValidation, Officer, ScheduleShift, Shift, TradeRequest } from "./types";
import type { AnalyticsResponse } from "./types";

interface PolicyRule {
  id: string;
  title: string;
  description: string;
}

interface AnalyticsGoal {
  title: string;
  description: string;
}

type AnalyticsView = "weekly" | "monthly" | "yearly" | "custom";

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

const analyticsGoals: AnalyticsGoal[] = [
  {
    title: "Improve coverage reliability across all sites",
    description: "Reduce unfilled shifts and last-minute scrambles by making open shifts visible, requestable, and trackable."
  },
  {
    title: "Create a defensible business case for staffing and budget",
    description: "Quantify unmet demand, approval bottlenecks, and policy constraints to justify hiring and targeted budget."
  },
  {
    title: "Reduce operational and compliance risk",
    description: "Enforce role, armed, and rest/OT rules consistently with an audit trail for every trade, request, and approval."
  },
  {
    title: "Enable smarter cross-site resource planning",
    description: "Use coverage data to show where bench strength is thin and where redundancy is needed."
  },
  {
    title: "Target training spends where it moves the needle",
    description: "Turn denial reasons and qualification gaps into targeted training investments that expand eligible coverage."
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

function toDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(value: Date): Date {
  const next = new Date(value);
  next.setDate(next.getDate() - next.getDay());
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfWeek(value: Date): Date {
  const end = addDays(startOfWeek(value), 6);
  end.setHours(23, 59, 0, 0);
  return end;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  })} - ${end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  })}`;
}

function buildTemplateWindow(dateValue: string, templateId: ScheduleTemplateId): {
  startAt: string;
  endAt: string;
} | null {
  const template = scheduleTemplates.find((item) => item.id === templateId);
  if (!template || template.id === "Custom") {
    return null;
  }

  const start = new Date(`${dateValue}T00:00`);
  start.setHours(template.startHour, template.startMinute, 0, 0);

  const end = new Date(start);
  if ("overnight" in template && template.overnight) {
    end.setDate(end.getDate() + 1);
  }
  end.setHours(template.endHour, template.endMinute, 0, 0);

  return {
    startAt: toDateTimeLocal(start),
    endAt: toDateTimeLocal(end)
  };
}

function detectTemplateId(shift: Pick<ScheduleShift, "startAt" | "endAt" | "sourceType">): ScheduleTemplateId {
  if (isScheduleTemplateId(shift.sourceType)) {
    return shift.sourceType;
  }

  const start = new Date(shift.startAt);
  const end = new Date(shift.endAt);

  const matched = scheduleTemplates.find((template) => {
    if (template.id === "Custom") {
      return false;
    }

    const startMatches =
      start.getHours() === template.startHour && start.getMinutes() === template.startMinute;
    const endMatches = end.getHours() === template.endHour && end.getMinutes() === template.endMinute;
    const overnight = end.toDateString() !== start.toDateString();

    return startMatches && endMatches && Boolean("overnight" in template && template.overnight) === overnight;
  });

  return matched?.id ?? "Custom";
}

function groupShiftsByDay(shifts: ScheduleShift[]): Array<{ day: string; shifts: ScheduleShift[] }> {
  const grouped = new Map<string, ScheduleShift[]>();

  for (const shift of shifts) {
    const day = new Date(shift.startAt).toISOString().slice(0, 10);
    const bucket = grouped.get(day) ?? [];
    bucket.push(shift);
    grouped.set(day, bucket);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]) => ({
      day,
      shifts: items.sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
    }));
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

function formatHours(value: number | null): string {
  if (value === null) {
    return "N/A";
  }

  return `${value.toFixed(1)} hrs`;
}

function trendHeightClass(value: number, maxValue: number): string {
  const ratio = maxValue === 0 ? 0 : value / maxValue;
  const bucket = Math.max(1, Math.ceil(ratio * 10));
  return `trendHeight${Math.min(bucket, 10)}`;
}

export function App() {
  const now = new Date();
  const initialWeekStart = startOfWeek(now);
  const initialWeekEnd = endOfWeek(now);

  const [activeUserId, setActiveUserId] = useState("officer1");
  const [activePage, setActivePage] = useState<"trade" | "schedule" | "analytics">("trade");
  const [userSearch, setUserSearch] = useState("");
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [tradeBoard, setTradeBoard] = useState<Shift[]>([]);
  const [queue, setQueue] = useState<TradeRequest[]>([]);
  const [requestHistory, setRequestHistory] = useState<TradeRequest[]>([]);
  const [currentValidationByRequest, setCurrentValidationByRequest] = useState<Record<string, CurrentApprovalValidation>>({});
  const [approvalErrorByRequest, setApprovalErrorByRequest] = useState<Record<string, string>>({});
  const [bypassByRequest, setBypassByRequest] = useState<Record<string, boolean>>({});
  const [bypassReasonByRequest, setBypassReasonByRequest] = useState<Record<string, string>>({});
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [scheduleShifts, setScheduleShifts] = useState<ScheduleShift[]>([]);
  const [weekCalendarStart, setWeekCalendarStart] = useState(initialWeekStart);
  const [weekCalendarShifts, setWeekCalendarShifts] = useState<ScheduleShift[]>([]);
  const [scheduleOfficerId, setScheduleOfficerId] = useState("");
  const [scheduleLocation, setScheduleLocation] = useState("");
  const [scheduleStatus, setScheduleStatus] = useState<"" | "Assigned" | "Posted">("");
  const [editShiftId, setEditShiftId] = useState<string | null>(null);
  const [formOfficerId, setFormOfficerId] = useState("officer1");
  const [formShiftDate, setFormShiftDate] = useState(toDateInputValue(now));
  const [formShiftTemplateId, setFormShiftTemplateId] = useState<ScheduleTemplateId>("0600-1800");
  const [formStartAt, setFormStartAt] = useState(toDateTimeLocal(now));
  const [formEndAt, setFormEndAt] = useState(toDateTimeLocal(addDays(now, 1)));
  const [formLocation, setFormLocation] = useState("Deer Valley");
  const [formRoleRequired, setFormRoleRequired] = useState("Security Officer");
  const [formArmedRequired, setFormArmedRequired] = useState(false);
  const [formNotes, setFormNotes] = useState("");
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [analyticsLocation, setAnalyticsLocation] = useState("");
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>("monthly");
  const [analyticsFrom, setAnalyticsFrom] = useState(toDateInputValue(addDays(now, -28)));
  const [analyticsTo, setAnalyticsTo] = useState(toDateInputValue(now));
  const [trendLocation, setTrendLocation] = useState("ALL");
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolicyModalOpen, setIsPolicyModalOpen] = useState(false);
  const userSearchRef = useRef<HTMLInputElement | null>(null);

  const currentUser = useMemo(
    () => userChoices.find((item) => item.id === activeUserId) ?? userChoices[0],
    [activeUserId]
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
    return groupShiftsByDay(scheduleShifts);
  }, [scheduleShifts]);

  const weekCalendarDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekCalendarStart, index);
      const dayKey = day.toISOString().slice(0, 10);
      const shifts = weekCalendarShifts
        .filter((shift) => new Date(shift.startAt).toISOString().slice(0, 10) === dayKey)
        .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());

      return { day, dayKey, shifts };
    });
  }, [weekCalendarShifts, weekCalendarStart]);

  const officerNameById = useMemo(() => {
    return new Map(officers.map((officer) => [officer.id, officer.name]));
  }, [officers]);

  const scheduleLocations = useMemo(() => {
    const values = new Set<string>(["Deer Valley", "TMC", "JCL", "Hospital (New)"]);
    for (const shift of scheduleShifts) {
      values.add(shift.location);
    }
    for (const shift of weekCalendarShifts) {
      values.add(shift.location);
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [scheduleShifts, weekCalendarShifts]);

  const currentWeekLabel = useMemo(() => formatWeekRange(weekCalendarStart), [weekCalendarStart]);

  const displayLocations = useMemo(() => {
    return scheduleLocations;
  }, [scheduleLocations]);

  const trendLocationOptions = useMemo(() => {
    if (!analytics) {
      return [];
    }

    return analytics.trend.byLocation.map((item) => item.location);
  }, [analytics]);

  const selectedTrendPoints = useMemo(() => {
    if (!analytics) {
      return [];
    }

    if (trendLocation === "ALL") {
      return analytics.trend.overall;
    }

    return analytics.trend.byLocation.find((item) => item.location === trendLocation)?.points ?? [];
  }, [analytics, trendLocation]);

  const trendMaxPosted = useMemo(() => {
    const max = selectedTrendPoints.reduce((result, point) => Math.max(result, point.posted), 0);
    return max > 0 ? max : 1;
  }, [selectedTrendPoints]);

  useEffect(() => {
    if (currentUser.role !== "Supervisor" && activePage === "analytics") {
      setActivePage("trade");
    }
  }, [activePage, currentUser.role]);

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

  useEffect(() => {
    if (formShiftTemplateId === "Custom") {
      return;
    }

    const window = buildTemplateWindow(formShiftDate, formShiftTemplateId);
    if (!window) {
      return;
    }

    setFormStartAt(window.startAt);
    setFormEndAt(window.endAt);
  }, [formShiftDate, formShiftTemplateId]);

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

        const liveValidationEntries = await Promise.all(
          pending.map(async (request) => {
            try {
              const validation = await getCurrentApprovalValidation(activeUserId, request.id);
              return [request.id, validation] as const;
            } catch {
              return [request.id, null] as const;
            }
          })
        );

        setCurrentValidationByRequest(
          Object.fromEntries(
            liveValidationEntries.filter((entry): entry is readonly [string, CurrentApprovalValidation] => entry[1] !== null)
          )
        );
        setApprovalErrorByRequest({});
      } else {
        setQueue([]);
        setRequestHistory([]);
        setCurrentValidationByRequest({});
        setApprovalErrorByRequest({});
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
      const weekEnd = endOfWeek(weekCalendarStart);
      const [officerResult, scheduleResult] = await Promise.all([
        getOfficers(activeUserId),
        getSchedule(activeUserId, {
          from: weekCalendarStart.toISOString(),
          to: weekEnd.toISOString()
        })
      ]);

      setOfficers(officerResult);
      setScheduleShifts(scheduleResult);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load schedule";
      setError(msg);
    }
  }

  async function loadWeekCalendarData() {
    setError(null);

    try {
      const result = await getSchedule(activeUserId, {
        officerId: scheduleOfficerId || undefined,
        from: weekCalendarStart.toISOString(),
        to: endOfWeek(weekCalendarStart).toISOString(),
        location: scheduleLocation || undefined,
        status: scheduleStatus || undefined
      });

      setWeekCalendarShifts(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load weekly calendar";
      setError(msg);
    }
  }

  async function loadAnalyticsData() {
    if (currentUser.role !== "Supervisor") {
      setAnalytics(null);
      return;
    }

    setError(null);

    try {
      const result = await getAnalytics(activeUserId, {
        location: analyticsLocation || undefined,
        view: analyticsView,
        from: analyticsView === "custom" && analyticsFrom ? `${analyticsFrom}T00:00:00.000Z` : undefined,
        to: analyticsView === "custom" && analyticsTo ? `${analyticsTo}T23:59:59.000Z` : undefined
      });

      setAnalytics(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load analytics";
      setError(msg);
    }
  }

  useEffect(() => {
    void loadTradeData();
    void loadScheduleData();
  }, [activeUserId, weekCalendarStart]);

  useEffect(() => {
    void loadWeekCalendarData();
  }, [activeUserId, weekCalendarStart, scheduleOfficerId, scheduleLocation, scheduleStatus]);

  useEffect(() => {
    if (currentUser.role === "Supervisor") {
      void loadAnalyticsData();
    }
  }, [activeUserId, currentUser.role, analyticsLocation, analyticsFrom, analyticsTo, analyticsView]);

  useEffect(() => {
    if (trendLocation === "ALL") {
      return;
    }

    if (!trendLocationOptions.includes(trendLocation)) {
      setTrendLocation("ALL");
    }
  }, [trendLocation, trendLocationOptions]);

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
    setApprovalErrorByRequest((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });

    try {
      const bypassValidation = bypassByRequest[requestId] ?? false;
      const bypassReason = (bypassReasonByRequest[requestId] ?? "").trim();

      const currentValidation = await getCurrentApprovalValidation(activeUserId, requestId);
      setCurrentValidationByRequest((prev) => ({
        ...prev,
        [requestId]: currentValidation
      }));

      if (!bypassValidation && !currentValidation.canApprove) {
        const reasonText = currentValidation.reasons.length > 0
          ? currentValidation.reasons.join(" ")
          : "Approval is currently blocked by validation checks.";
        setApprovalErrorByRequest((prev) => ({
          ...prev,
          [requestId]: reasonText
        }));
        return;
      }

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
      setCurrentValidationByRequest((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
      setApprovalErrorByRequest((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
      setMessage("Request approved and shift reassigned.");
      await loadTradeData();
      await loadScheduleData();
    } catch (e) {
      if (e instanceof ApiError && e.code === "APPROVAL_BLOCKED") {
        const payload = e.payload as { validation?: CurrentApprovalValidation };
        const validation = payload.validation;
        if (validation) {
          setCurrentValidationByRequest((prev) => ({
            ...prev,
            [requestId]: validation
          }));
          setApprovalErrorByRequest((prev) => ({
            ...prev,
            [requestId]: validation.reasons.join(" ") || "Approval blocked by validation checks."
          }));
        }
      }

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
          notes: formNotes || null,
          sourceType: formShiftTemplateId
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
          notes: formNotes || undefined,
          sourceType: formShiftTemplateId
        });
        setMessage("Schedule created.");
      }

      setEditShiftId(null);
      setFormNotes("");
      await loadScheduleData();
      await loadTradeData();
      await loadWeekCalendarData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to save schedule";
      setError(msg);
    } finally {
      setIsSavingSchedule(false);
    }
  }

  function beginEdit(shift: ScheduleShift): void {
    const templateId = detectTemplateId(shift);

    setEditShiftId(shift.id);
    setFormOfficerId(shift.currentOfficerId);
    setFormShiftDate(toDateInputValue(new Date(shift.startAt)));
    setFormShiftTemplateId(templateId);
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
    setFormShiftDate(toDateInputValue(new Date()));
    setFormShiftTemplateId("0600-1800");
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
                Calendar
              </button>
              {currentUser.role === "Supervisor" ? (
                <button
                  type="button"
                  className={activePage === "analytics" ? "secondary" : ""}
                  onClick={() => setActivePage("analytics")}
                >
                  Analytics
                </button>
              ) : null}
              <button
                type="button"
                className={isPolicyModalOpen ? "secondary" : ""}
                onClick={() => setIsPolicyModalOpen(true)}
              >
                Policies
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
        {activePage === "trade" ? (
        <div className="tradeBoardGrid">
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
                    {(() => {
                      const liveValidation = currentValidationByRequest[request.id];
                      const fallbackPass = request.validations[0]?.overallPass ?? false;
                      const effectivePass = liveValidation?.canApprove ?? fallbackPass;
                      const reasons = liveValidation?.reasons ?? [];
                      const inlineError = approvalErrorByRequest[request.id];

                      return (
                        <>
                    <div><strong>Request {request.id}</strong></div>
                    <div className="meta">Shift: {request.shift.location} ({request.shift.roleRequired})</div>
                    <div className="meta">From {request.postingOfficerId} to {request.requestingOfficerId}</div>
                    <div className="meta">Current Validation: {effectivePass ? "PASS" : "FAIL"}</div>
                    {!effectivePass && reasons.length > 0 ? (
                      <div className="meta validationReasonList">
                        {reasons.map((reason) => (
                          <div key={`${request.id}-${reason}`}>• {reason}</div>
                        ))}
                      </div>
                    ) : null}
                    {inlineError ? <div className="meta inlineApprovalError">{inlineError}</div> : null}
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
                        </>
                      );
                    })()}
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
        ) : activePage === "schedule" ? (
        <div className="grid fullSpanGrid">
          <article className="card">
            <h2>Calendar</h2>
            <div className="calendarHeader">
              <div>
                <h3>Weekly Team Calendar</h3>
                <p className="meta">All officers working for the selected week: {currentWeekLabel}</p>
              </div>
              <div className="actionRow weekNav">
                <button type="button" className="secondary" onClick={() => setWeekCalendarStart((current) => addDays(current, -7))}>
                  Previous Week
                </button>
                <button type="button" className="secondary" onClick={() => setWeekCalendarStart(startOfWeek(new Date()))}>
                  Current Week
                </button>
                <button type="button" className="secondary" onClick={() => setWeekCalendarStart((current) => addDays(current, 7))}>
                  Next Week
                </button>
              </div>
            </div>

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
                Location
                <select value={scheduleLocation} onChange={(e) => setScheduleLocation(e.target.value)}>
                  <option value="">All locations</option>
                  {scheduleLocations.map((location) => (
                    <option key={location} value={location}>{location}</option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  value={scheduleStatus}
                  onChange={(e) => setScheduleStatus(e.target.value as "" | "Assigned" | "Posted")}
                >
                  <option value="">All statuses</option>
                  <option value="Assigned">Assigned</option>
                  <option value="Posted">Posted</option>
                </select>
              </label>
            </div>

            <div className="weekCalendarGrid">
              {weekCalendarDays.map(({ day, dayKey, shifts }) => (
                <section key={dayKey} className="weekCalendarDay">
                  <h4>{formatScheduleDay(day.toISOString())}</h4>
                  <div className="weekCalendarList">
                    {shifts.map((shift) => (
                      <div key={shift.id} className="calendarShiftCard">
                        <strong>{formatScheduleTime(shift.startAt)} - {formatScheduleTime(shift.endAt)}</strong>
                        <div className="meta">
                          {(officerNameById.get(shift.currentOfficerId) ?? shift.currentOfficerId)} • {shift.location}
                        </div>
                        <div className="meta">{shift.status}</div>
                      </div>
                    ))}
                    {shifts.length === 0 ? <p className="meta">No officers scheduled.</p> : null}
                  </div>
                </section>
              ))}
            </div>

            <h3>Detailed Schedule List</h3>
            <p className="meta">This list shows the full Sunday-to-Saturday schedule for the selected week without weekly team calendar filters.</p>

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
                  Shift Option
                  <select value={formShiftTemplateId} onChange={(e) => setFormShiftTemplateId(e.target.value as ScheduleTemplateId)}>
                    {scheduleTemplates.map((template) => (
                      <option key={template.id} value={template.id}>{template.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Shift Date
                  <input type="date" value={formShiftDate} onChange={(e) => setFormShiftDate(e.target.value)} />
                </label>
                <label>
                  Start
                  <input
                    type="datetime-local"
                    value={formStartAt}
                    onChange={(e) => setFormStartAt(e.target.value)}
                    disabled={formShiftTemplateId !== "Custom"}
                  />
                </label>
                <label>
                  End
                  <input
                    type="datetime-local"
                    value={formEndAt}
                    onChange={(e) => setFormEndAt(e.target.value)}
                    disabled={formShiftTemplateId !== "Custom"}
                  />
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
        ) : (
        <div className="grid fullSpanGrid">
          <article className="card">
            <h2>Analytics</h2>
            <div className="filterRow">
              <label>
                Location
                <select value={analyticsLocation} onChange={(e) => setAnalyticsLocation(e.target.value)}>
                  <option value="">All locations</option>
                  {displayLocations.map((location) => (
                    <option key={location} value={location}>{location}</option>
                  ))}
                </select>
              </label>
              <label>
                Time View
                <select value={analyticsView} onChange={(e) => setAnalyticsView(e.target.value as AnalyticsView)}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="custom">Custom Range</option>
                </select>
              </label>
              <label>
                From
                <input
                  type="date"
                  value={analyticsFrom}
                  onChange={(e) => setAnalyticsFrom(e.target.value)}
                  disabled={analyticsView !== "custom"}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={analyticsTo}
                  onChange={(e) => setAnalyticsTo(e.target.value)}
                  disabled={analyticsView !== "custom"}
                />
              </label>
              <button type="button" onClick={() => void loadAnalyticsData()}>Refresh</button>
            </div>

            <div className="analyticsGrid">
              <section className="analyticsPanel">
                <h3>Value Goals</h3>
                <div className="analyticsList">
                  {analyticsGoals.map((goal, index) => (
                    <div key={goal.title} className="analyticsListItem">
                      <strong>{index + 1}. {goal.title}</strong>
                      <p>{goal.description}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="analyticsPanel">
                <h3>Lead Metrics</h3>
                <div className="analyticsCards">
                  <div className="analyticsCard">
                    <span className="analyticsLabel">Shift Fill Rate</span>
                    <strong>{analytics?.metrics.shiftFillRate ?? 0}%</strong>
                    <span className="meta">{analytics?.metrics.filledShiftCount ?? 0} of {analytics?.metrics.postedShiftCount ?? 0} posted shifts filled</span>
                  </div>
                  <div className="analyticsCard">
                    <span className="analyticsLabel">Unfilled Shifts</span>
                    <strong>{analytics?.metrics.unfilledShiftCount ?? 0}</strong>
                    <span className="meta">Posted shifts still open in the selected window</span>
                  </div>
                  <div className="analyticsCard">
                    <span className="analyticsLabel">Median Time-to-Fill</span>
                    <strong>{formatHours(analytics?.metrics.medianTimeToFillHours ?? null)}</strong>
                    <span className="meta">90th percentile: {formatHours(analytics?.metrics.p90TimeToFillHours ?? null)}</span>
                  </div>
                  <div className="analyticsCard">
                    <span className="analyticsLabel">Approval Cycle</span>
                    <strong>{formatHours(analytics?.metrics.medianApprovalCycleHours ?? null)}</strong>
                    <span className="meta">Median time from request submitted to supervisor decision</span>
                  </div>
                </div>
              </section>

              <section className="analyticsPanel">
                <h3>Policy Denials by Location</h3>
                <div className="analyticsList">
                  {(analytics?.policyDenials ?? []).map((item) => (
                    <div key={item.policy} className="analyticsListItem">
                      <strong>{item.policy}</strong>
                      <p>{item.count} denied requests in selected window</p>
                      <div className="analyticsMiniRows">
                        {item.locationCounts.map((locationRow) => (
                          <div key={`${item.policy}-${locationRow.location}`} className="analyticsRow">
                            <span>{locationRow.location}</span>
                            <strong>{locationRow.count}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {(analytics?.policyDenials.length ?? 0) === 0 ? <p className="meta">No policy denials in the selected window.</p> : null}
                </div>
              </section>

              <section className="analyticsPanel">
                <h3>Pickup Concentration</h3>
                <div className="analyticsList">
                  {(analytics?.pickupConcentration ?? []).map((item) => (
                    <div key={item.officerId} className="analyticsRow">
                      <span>{officerNameById.get(item.officerId) ?? item.officerId}</span>
                      <strong>{item.approvals} approvals ({item.share}%)</strong>
                    </div>
                  ))}
                  {(analytics?.pickupConcentration.length ?? 0) === 0 ? <p className="meta">No approved pickups in the selected window.</p> : null}
                </div>
              </section>

              <section className="analyticsPanel analyticsPanelWide">
                <h3>Location Coverage and Armed Ratio</h3>
                <div className="analyticsTrendTable locationCoverageTable">
                  <div className="analyticsTrendHeader">Location</div>
                  <div className="analyticsTrendHeader">Total</div>
                  <div className="analyticsTrendHeader">Posted</div>
                  <div className="analyticsTrendHeader">Filled</div>
                  <div className="analyticsTrendHeader">Unfilled</div>
                  <div className="analyticsTrendHeader">Armed:Unarmed</div>
                  {(analytics?.locationCoverage ?? []).flatMap((row) => [
                    <div key={`${row.location}-location`} className="analyticsTrendCell">{row.location}</div>,
                    <div key={`${row.location}-total`} className="analyticsTrendCell">{row.shiftCount}</div>,
                    <div key={`${row.location}-posted`} className="analyticsTrendCell">{row.postedCount}</div>,
                    <div key={`${row.location}-filled`} className="analyticsTrendCell">{row.filledCount}</div>,
                    <div key={`${row.location}-unfilled`} className="analyticsTrendCell">{row.unfilledCount}</div>,
                    <div key={`${row.location}-ratio`} className="analyticsTrendCell">{row.armedToUnarmedRatio}</div>
                  ])}
                  {(analytics?.locationCoverage.length ?? 0) === 0 ? <p className="meta">No location coverage data in the selected window.</p> : null}
                </div>
              </section>

              <section className="analyticsPanel analyticsPanelWide">
                <h3>Trend Highlights</h3>
                <div className="trendToolbar">
                  <label>
                    Trend Location
                    <select value={trendLocation} onChange={(e) => setTrendLocation(e.target.value)}>
                      <option value="ALL">All locations</option>
                      {trendLocationOptions.map((location) => (
                        <option key={location} value={location}>{location}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="trendLegend">
                  <span><i className="legendSwatch posted" /> Posted</span>
                  <span><i className="legendSwatch filled" /> Filled</span>
                  <span><i className="legendSwatch unfilled" /> Unfilled</span>
                </div>

                <div className="trendChart">
                  {selectedTrendPoints.map((point) => (
                    <div key={point.period} className="trendChartGroup">
                      <div className="trendBars">
                        <div
                          className={`trendBar posted ${trendHeightClass(point.posted, trendMaxPosted)}`}
                          title={`Posted: ${point.posted}`}
                        />
                        <div
                          className={`trendBar filled ${trendHeightClass(point.filled, trendMaxPosted)}`}
                          title={`Filled: ${point.filled}`}
                        />
                        <div
                          className={`trendBar unfilled ${trendHeightClass(point.unfilled, trendMaxPosted)}`}
                          title={`Unfilled: ${point.unfilled}`}
                        />
                      </div>
                      <span className="trendLabel">{point.period}</span>
                      <span className="trendMeta">Fill {point.fillRate}%</span>
                    </div>
                  ))}
                </div>
                {selectedTrendPoints.length === 0 ? <p className="meta">No trend data in the selected window.</p> : null}
              </section>
            </div>
          </article>
        </div>
        )}
      </section>

      {isPolicyModalOpen ? (
        <div className="policyModalBackdrop" role="presentation" onClick={() => setIsPolicyModalOpen(false)}>
          <div
            className="policyModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="policy-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="policyModalHeader">
              <h3 id="policy-modal-title">Trade Board Policy Guide</h3>
              <button type="button" className="secondary" onClick={() => setIsPolicyModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="policyModalList">
              {policyRules.map((policy, index) => (
                <section key={policy.id} className="policyModalSection">
                  <h4>{index + 1}. {policy.title}</h4>
                  <p>{policy.description}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
