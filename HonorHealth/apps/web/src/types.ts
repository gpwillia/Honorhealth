export type UserRole = "Officer" | "Supervisor";

export interface Shift {
  id: string;
  currentOfficerId: string;
  startAt: string;
  endAt: string;
  location: string;
  roleRequired: string;
  armedRequired: boolean;
  status: "Assigned" | "Posted";
  canPost?: boolean;
  reason?: string | null;
}

export interface ValidationResult {
  id: string;
  armedCheck: boolean;
  roleCheck: boolean;
  restOtCheck: boolean;
  overallPass: boolean;
}

export interface TradeRequest {
  id: string;
  shiftId: string;
  postingOfficerId: string;
  requestingOfficerId: string;
  status: "PendingApproval" | "Approved" | "Denied";
  denialReason?: string;
  shift: Shift;
  validations: ValidationResult[];
}
