import type {
  AnalyticsResponse,
  CurrentApprovalValidation,
  Officer,
  ScheduleShift,
  Shift,
  TradeRequest,
  UserRole
} from "./types";

export class ApiError extends Error {
  code?: string;
  payload?: unknown;

  constructor(message: string, options: { code?: string; payload?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.payload = options.payload;
  }
}

async function request<T>(
  path: string,
  userId: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new ApiError(errorBody.message ?? `Request failed: ${response.status}`, {
      code: errorBody.code,
      payload: errorBody
    });
  }

  return response.json() as Promise<T>;
}

export function getMyShifts(userId: string): Promise<Shift[]> {
  return request<Shift[]>("/api/my-shifts", userId);
}

export function postShift(userId: string, shiftId: string): Promise<Shift> {
  return request<Shift>("/api/trade-board/posts", userId, "POST", { shiftId });
}

export function getTradeBoard(userId: string): Promise<Shift[]> {
  return request<Shift[]>("/api/trade-board/posts", userId);
}

export function createTradeRequest(userId: string, shiftId: string): Promise<TradeRequest> {
  return request<TradeRequest>("/api/trade-requests", userId, "POST", { shiftId });
}

export function getPendingQueue(userId: string): Promise<TradeRequest[]> {
  return request<TradeRequest[]>("/api/trade-requests?status=PendingApproval", userId);
}

export function getTradeRequestsByStatus(
  userId: string,
  status: "PendingApproval" | "Approved" | "Denied",
  pageSize = 50
): Promise<TradeRequest[]> {
  return request<TradeRequest[]>(
    `/api/trade-requests?status=${status}&page=1&pageSize=${pageSize}`,
    userId
  );
}

export function approveRequest(
  userId: string,
  requestId: string,
  options: { bypassValidation?: boolean; bypassReason?: string } = {}
): Promise<TradeRequest> {
  return request<TradeRequest>(`/api/trade-requests/${requestId}/approve`, userId, "POST", {
    bypassValidation: options.bypassValidation ?? false,
    bypassReason: options.bypassReason
  });
}

export function denyRequest(userId: string, requestId: string): Promise<TradeRequest> {
  return request<TradeRequest>(`/api/trade-requests/${requestId}/deny`, userId, "POST", {});
}

export function getCurrentApprovalValidation(
  userId: string,
  requestId: string
): Promise<CurrentApprovalValidation> {
  return request<CurrentApprovalValidation>(`/api/trade-requests/${requestId}/current-validation`, userId);
}

export function getOfficers(userId: string): Promise<Officer[]> {
  return request<Officer[]>("/api/officers", userId);
}

export function getSchedule(
  userId: string,
  options: {
    officerId?: string;
    from?: string;
    to?: string;
    location?: string;
    status?: "Assigned" | "Posted";
  } = {}
): Promise<ScheduleShift[]> {
  const query = new URLSearchParams();
  if (options.officerId) {
    query.set("officerId", options.officerId);
  }
  if (options.from) {
    query.set("from", options.from);
  }
  if (options.to) {
    query.set("to", options.to);
  }
  if (options.location) {
    query.set("location", options.location);
  }
  if (options.status) {
    query.set("status", options.status);
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<ScheduleShift[]>(`/api/schedule${suffix}`, userId);
}

export function getAnalytics(
  userId: string,
  options: {
    location?: string;
    from?: string;
    to?: string;
    view?: "weekly" | "monthly" | "yearly" | "custom";
  } = {}
): Promise<AnalyticsResponse> {
  const query = new URLSearchParams();
  if (options.location) {
    query.set("location", options.location);
  }
  if (options.from) {
    query.set("from", options.from);
  }
  if (options.to) {
    query.set("to", options.to);
  }
  if (options.view) {
    query.set("view", options.view);
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<AnalyticsResponse>(`/api/analytics${suffix}`, userId);
}

export function createSchedule(
  userId: string,
  payload: {
    officerId: string;
    startAt: string;
    endAt: string;
    location: string;
    roleRequired: string;
    armedRequired: boolean;
    notes?: string;
    sourceType?: string;
  }
): Promise<ScheduleShift> {
  return request<ScheduleShift>("/api/schedule", userId, "POST", payload);
}

export function updateSchedule(
  userId: string,
  shiftId: string,
  payload: Partial<{
    officerId: string;
    startAt: string;
    endAt: string;
    location: string;
    roleRequired: string;
    armedRequired: boolean;
    status: "Assigned" | "Posted";
    notes: string | null;
    sourceType: string;
  }>
): Promise<ScheduleShift> {
  return request<ScheduleShift>(`/api/schedule/${shiftId}`, userId, "PATCH", payload);
}

export const userChoices: Array<{ id: string; label: string; role: UserRole }> = [
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `officer${i + 1}`,
    label: `Officer ${i + 1}`,
    role: "Officer" as UserRole
  })),
  { id: "supervisor1", label: "Supervisor 1", role: "Supervisor" },
  { id: "supervisor2", label: "Supervisor 2", role: "Supervisor" },
  { id: "supervisor3", label: "Supervisor 3", role: "Supervisor" }
];
