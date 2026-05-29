export interface ScheduleTemplate {
  id: string;
  label: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  overnight?: boolean;
}

export const scheduleTemplates: ScheduleTemplate[] = [
  { id: "0600-1800", label: "0600 - 1800", startHour: 6, startMinute: 0, endHour: 18, endMinute: 0 },
  { id: "1800-0600", label: "1800 - 0600", startHour: 18, startMinute: 0, endHour: 6, endMinute: 0, overnight: true },
  { id: "0600-1200", label: "0600 - 1200", startHour: 6, startMinute: 0, endHour: 12, endMinute: 0 },
  { id: "1200-1800", label: "1200 - 1800", startHour: 12, startMinute: 0, endHour: 18, endMinute: 0 },
  { id: "1800-0000", label: "1800 - 0000", startHour: 18, startMinute: 0, endHour: 0, endMinute: 0, overnight: true },
  { id: "0000-0600", label: "0000 - 0600", startHour: 0, startMinute: 0, endHour: 6, endMinute: 0 },
  { id: "0600-1400", label: "0600 - 1400", startHour: 6, startMinute: 0, endHour: 14, endMinute: 0 },
  { id: "1400-2000", label: "1400 - 2000", startHour: 14, startMinute: 0, endHour: 20, endMinute: 0 },
  { id: "Custom", label: "Custom", startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 }
];

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isNextLocalDay(left: Date, right: Date): boolean {
  const next = new Date(left);
  next.setDate(next.getDate() + 1);
  return isSameLocalDay(next, right);
}

export function isAllowedScheduleWindow(
  startAt: Date,
  endAt: Date,
  sourceType?: string | null
): boolean {
  if (!sourceType || sourceType === "Custom") {
    return true;
  }

  const template = scheduleTemplates.find((item) => item.id === sourceType);
  if (!template || template.id === "Custom") {
    return false;
  }

  const startMatches =
    startAt.getHours() === template.startHour && startAt.getMinutes() === template.startMinute;
  const endMatches =
    endAt.getHours() === template.endHour && endAt.getMinutes() === template.endMinute;
  const dayMatches = template.overnight
    ? isNextLocalDay(startAt, endAt)
    : isSameLocalDay(startAt, endAt);

  return startMatches && endMatches && dayMatches;
}