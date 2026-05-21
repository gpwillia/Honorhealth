import type { Shift, TradeRequest, UserRole } from "./types";

async function request<T>(
  path: string,
  userId: string,
  method: "GET" | "POST" = "GET",
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
    throw new Error(errorBody.message ?? `Request failed: ${response.status}`);
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

export function approveRequest(userId: string, requestId: string): Promise<TradeRequest> {
  return request<TradeRequest>(`/api/trade-requests/${requestId}/approve`, userId, "POST", {});
}

export function denyRequest(userId: string, requestId: string): Promise<TradeRequest> {
  return request<TradeRequest>(`/api/trade-requests/${requestId}/deny`, userId, "POST", {});
}

export const userChoices: Array<{ id: string; label: string; role: UserRole }> = [
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `officer${i + 1}`,
    label: `Officer ${i + 1}`,
    role: "Officer" as UserRole
  })),
  { id: "supervisor1", label: "Supervisor Darren Viner", role: "Supervisor" }
];
