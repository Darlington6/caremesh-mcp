import type { CheckIn, MedicationEvent } from "./types.js";

export const HOURS_UNTIL_CHECKIN_OVERDUE = 24;
export const HOURS_UNTIL_MISSED_MED_STALE = 7 * 24;

/** Pure function so alert logic can be unit tested without spinning up the MCP server. */
export function computeAlerts(
  person: string,
  checkIns: CheckIn[],
  medicationEvents: MedicationEvent[],
  now: number = Date.now(),
): string[] {
  const alerts: string[] = [];

  const sortedCheckIns = [...checkIns].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const lastCheckIn = sortedCheckIns[0];
  const hoursSinceCheckIn = lastCheckIn ? (now - Date.parse(lastCheckIn.timestamp)) / 3_600_000 : Infinity;
  if (hoursSinceCheckIn > HOURS_UNTIL_CHECKIN_OVERDUE) {
    alerts.push(
      lastCheckIn
        ? `No check-in for ${person} in ${Math.round(hoursSinceCheckIn)} hours (last: ${lastCheckIn.timestamp}).`
        : `No check-in has ever been recorded for ${person}.`,
    );
  }

  const sortedMeds = [...medicationEvents].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const lastMissed = sortedMeds.find((m) => !m.taken);
  if (lastMissed) {
    const hoursSinceMissed = (now - Date.parse(lastMissed.timestamp)) / 3_600_000;
    const takenSince = medicationEvents.some(
      (m) => m.taken && Date.parse(m.timestamp) > Date.parse(lastMissed.timestamp),
    );
    if (!takenSince && hoursSinceMissed < HOURS_UNTIL_MISSED_MED_STALE) {
      alerts.push(
        `Missed medication "${lastMissed.medication}" at ${lastMissed.timestamp} with no taken dose logged since.`,
      );
    }
  }

  return alerts;
}

/**
 * Household alerts are just each member's own alerts flattened together — computeAlerts already
 * names the person in every message it produces, so no extra prefixing is needed here.
 */
export function computeHouseholdAlerts(
  members: Array<{ person: string; checkIns: CheckIn[]; medicationEvents: MedicationEvent[] }>,
  now: number = Date.now(),
): string[] {
  return members.flatMap((m) => computeAlerts(m.person, m.checkIns, m.medicationEvents, now));
}
