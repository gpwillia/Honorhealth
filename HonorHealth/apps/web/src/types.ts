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

export interface ScheduleShift extends Shift {
  scheduledById?: string | null;
  sourceType?: string;
  notes?: string | null;
  lastSyncedAt?: string | null;
}

export interface Officer {
  id: string;
  role: UserRole;
  name: string;
  homeSite?: string;
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
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  denialReason?: string;
  shift: Shift;
  validations: ValidationResult[];
}

export interface CurrentApprovalValidation {
  requestId: string;
  canApprove: boolean;
  checks: {
    armedCheck: boolean;
    roleCheck: boolean;
    restOtCheck: boolean;
    overallPass: boolean;
  };
  reasons: string[];
  details: {
    armedRequired?: boolean;
    officerArmedQualified?: boolean;
    roleRequired?: string;
    officerRoles?: string[];
    hasOverlap?: boolean;
    existingHours?: number;
    candidateHours?: number;
    totalHours?: number;
    maxHours?: number;
  };
}

export interface AnalyticsMetrics {
  postedShiftCount: number;
  filledShiftCount: number;
  unfilledShiftCount: number;
  shiftFillRate: number;
  medianTimeToFillHours: number | null;
  p90TimeToFillHours: number | null;
  medianApprovalCycleHours: number | null;
}

export interface AnalyticsReasonBreakdown {
  reason: string;
  count: number;
}

export interface AnalyticsPickupConcentration {
  officerId: string;
  approvals: number;
  share: number;
}

export interface AnalyticsTrendPoint {
  period: string;
  posted: number;
  filled: number;
  unfilled: number;
  fillRate: number;
}

export interface AnalyticsPolicyDenial {
  policy: string;
  count: number;
  locationCounts: Array<{
    location: string;
    count: number;
  }>;
}

export interface AnalyticsLocationCoverage {
  location: string;
  shiftCount: number;
  postedCount: number;
  filledCount: number;
  unfilledCount: number;
  armedOfficerCount: number;
  unarmedOfficerCount: number;
  armedToUnarmedRatio: string;
}

export interface AnalyticsLocationTrend {
  location: string;
  points: AnalyticsTrendPoint[];
}

export interface AnalyticsResponse {
  filters: {
    location: string | null;
    from: string;
    to: string;
    view: "weekly" | "monthly" | "yearly" | "custom";
  };
  metrics: AnalyticsMetrics;
  locationCoverage: AnalyticsLocationCoverage[];
  policyDenials: AnalyticsPolicyDenial[];
  denialReasons: AnalyticsReasonBreakdown[];
  pickupConcentration: AnalyticsPickupConcentration[];
  trend: {
    overall: AnalyticsTrendPoint[];
    byLocation: AnalyticsLocationTrend[];
  };
}
