export type UserRole = "Officer" | "Supervisor" | "System";

export type TradeRequestStatus =
  | "Posted"
  | "PendingApproval"
  | "Approved"
  | "Denied";

export interface RequestUser {
  id: string;
  role: UserRole;
  name: string;
}
