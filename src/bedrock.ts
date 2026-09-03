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

export interface DaySnapshot {
  person: string;
  date: string;
  checkIns: CheckIn[];
  medicationEvents: MedicationEvent[];
  careTasks: CareTask[];
}

function buildPrompt({ person, date, checkIns, medicationEvents, careTasks }: DaySnapshot): string {
  return [
    `You are a caretaking assistant summarizing a day for a family caregiver.`,
    `Person: ${person}. Date: ${date}.`,
    `Check-ins: ${JSON.stringify(checkIns.map(({ note, mood, timestamp }) => ({ note, mood, timestamp })))}`,
    `Medication events: ${JSON.stringify(medicationEvents.map(({ medication, taken, timestamp }) => ({ medication, taken, timestamp })))}`,
    `Open care tasks: ${JSON.stringify(careTasks.filter((t) => !t.done).map(({ task, due }) => ({ task, due })))}`,
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
  if (!process.env.AWS_REGION && !process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
    return { summary: fallbackSummary(snapshot), source: "fallback" };
  }

  try {
    const response = await getClient().send(
      new ConverseCommand({
        modelId: MODEL_ID,
        messages: [{ role: "user", content: [{ text: buildPrompt(snapshot) }] }],
      }),
    );
    const text = response.output?.message?.content?.map((c) => c.text ?? "").join("") ?? "";
    if (!text.trim()) throw new Error("empty Bedrock response");
    return { summary: text.trim(), source: "bedrock" };
  } catch (err) {
    console.error("Bedrock call failed, using local fallback summary:", err);
    return { summary: fallbackSummary(snapshot), source: "fallback" };
  }
}
