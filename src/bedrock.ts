import "./env.js";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { CareTask, CheckIn, MedicationEvent } from "./types.js";

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-5-sonnet-20241022-v2:0";
const REGION = process.env.AWS_REGION ?? "us-east-1";

let client: BedrockRuntimeClient | undefined;
function getClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({ region: REGION });
  return client;
}

function credentialsConfigured(): boolean {
  return Boolean(process.env.AWS_REGION || process.env.AWS_PROFILE || process.env.AWS_ACCESS_KEY_ID);
}

async function callBedrock(prompt: string): Promise<string> {
  const response = await getClient().send(
    new ConverseCommand({ modelId: MODEL_ID, messages: [{ role: "user", content: [{ text: prompt }] }] }),
  );
  const text = response.output?.message?.content?.map((c) => c.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("empty Bedrock response");
  return text.trim();
}

export interface DaySnapshot {
  person: string;
  date: string;
  checkIns: CheckIn[];
  medicationEvents: MedicationEvent[];
  careTasks: CareTask[];
}

function describeDay({ checkIns, medicationEvents, careTasks }: DaySnapshot): string {
  return [
    `Check-ins: ${JSON.stringify(checkIns.map(({ note, mood, timestamp }) => ({ note, mood, timestamp })))}`,
    `Medication events: ${JSON.stringify(medicationEvents.map(({ medication, taken, timestamp }) => ({ medication, taken, timestamp })))}`,
    `Open care tasks: ${JSON.stringify(careTasks.filter((t) => !t.done).map(({ task, due }) => ({ task, due })))}`,
  ].join("\n");
}

function buildPrompt(snapshot: DaySnapshot): string {
  return [
    `You are a caretaking assistant summarizing a day for a family caregiver.`,
    `Person: ${snapshot.person}. Date: ${snapshot.date}.`,
    describeDay(snapshot),
    `Write a short (3-5 sentence), warm, plain-language summary a caregiver could read in passing. Call out anything concerning (missed medication, no check-in, overdue tasks) clearly but calmly.`,
  ].join("\n");
}

/** Local, deterministic summary used when Bedrock isn't configured or the call fails. */
export function fallbackSummary(snapshot: DaySnapshot): string {
  const { person, checkIns, medicationEvents, careTasks } = snapshot;
  const missedMeds = medicationEvents.filter((m) => !m.taken);
  const openTasks = careTasks.filter((t) => !t.done);

  const parts: string[] = [];
  parts.push(
    checkIns.length > 0
      ? `${person} checked in ${checkIns.length} time(s) today${checkIns[checkIns.length - 1]?.mood ? `, most recently feeling ${checkIns[checkIns.length - 1].mood}` : ""}.`
      : `No check-ins recorded for ${person} today.`,
  );
  parts.push(
    missedMeds.length > 0
      ? `${missedMeds.length} medication dose(s) were missed: ${missedMeds.map((m) => m.medication).join(", ")}.`
      : medicationEvents.length > 0
        ? "All logged medications were taken."
        : "No medication events logged today.",
  );
  parts.push(
    openTasks.length > 0
      ? `${openTasks.length} care task(s) still open: ${openTasks.map((t) => t.task).join(", ")}.`
      : "No open care tasks.",
  );
  return parts.join(" ");
}

export async function generateDailySummary(
  snapshot: DaySnapshot,
): Promise<{ summary: string; source: "bedrock" | "fallback" }> {
  if (!credentialsConfigured()) {
    return { summary: fallbackSummary(snapshot), source: "fallback" };
  }
  try {
    return { summary: await callBedrock(buildPrompt(snapshot)), source: "bedrock" };
  } catch (err) {
    console.error("Bedrock call failed, using local fallback summary:", err);
    return { summary: fallbackSummary(snapshot), source: "fallback" };
  }
}

export interface HouseholdSnapshot {
  household: string;
  date: string;
  members: DaySnapshot[];
}

function buildHouseholdPrompt({ household, date, members }: HouseholdSnapshot): string {
  return [
    `You are a caretaking assistant summarizing a day for a family caregiver responsible for multiple people in one household.`,
    `Household: ${household}. Date: ${date}.`,
    ...members.map((m) => `--- ${m.person} ---\n${describeDay(m)}`),
    `Write a short, warm, plain-language summary covering everyone in the household. Call out anything concerning for any individual clearly but calmly.`,
  ].join("\n");
}

/** Local, deterministic household summary; reuses fallbackSummary per member. */
export function fallbackHouseholdSummary(snapshot: HouseholdSnapshot): string {
  return snapshot.members.map((m) => `${m.person}: ${fallbackSummary(m)}`).join("\n");
}

export async function generateHouseholdSummary(
  snapshot: HouseholdSnapshot,
): Promise<{ summary: string; source: "bedrock" | "fallback" }> {
  if (!credentialsConfigured()) {
    return { summary: fallbackHouseholdSummary(snapshot), source: "fallback" };
  }
  try {
    return { summary: await callBedrock(buildHouseholdPrompt(snapshot)), source: "bedrock" };
  } catch (err) {
    console.error("Bedrock call failed, using local fallback household summary:", err);
    return { summary: fallbackHouseholdSummary(snapshot), source: "fallback" };
  }
}
