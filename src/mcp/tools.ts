import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addCareTask,
  addCheckIn,
  addHouseholdMember,
  addMedicationEvent,
  getDayData,
  getRecentActivity,
  listCareTasks,
  listHouseholdMembers,
} from "../store.js";
import { generateDailySummary, generateHouseholdSummary } from "../bedrock.js";
import { computeAlerts, computeHouseholdAlerts } from "../alerts.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function registerCaretakingTools(server: McpServer): void {
  server.registerTool(
    "log_checkin",
    {
      title: "Log a caretaking check-in",
      description: "Record that a check-in happened with the person being cared for, with an optional note and mood.",
      inputSchema: {
        person: z.string().describe("Name of the person being cared for"),
        note: z.string().optional().describe("Free-text note about the check-in"),
        mood: z.string().optional().describe("Reported or observed mood, e.g. 'good', 'tired'"),
      },
    },
    async ({ person, note, mood }) => {
      const entry = await addCheckIn(person, note, mood);
      return textResult(`Logged check-in for ${person} at ${entry.timestamp}.`);
    },
  );

  server.registerTool(
    "log_medication",
    {
      title: "Log a medication event",
      description: "Record whether a medication dose was taken or missed for the person being cared for.",
      inputSchema: {
        person: z.string().describe("Name of the person being cared for"),
        medication: z.string().describe("Name of the medication/dose"),
        taken: z.boolean().describe("True if the dose was taken, false if missed"),
      },
    },
    async ({ person, medication, taken }) => {
      const entry = await addMedicationEvent(person, medication, taken);
      return textResult(
        `Logged medication event for ${person}: ${medication} ${taken ? "taken" : "missed"} at ${entry.timestamp}.`,
      );
    },
  );

  server.registerTool(
    "add_care_task",
    {
      title: "Add a care task",
      description: "Add a shared caretaking task (e.g. 'pick up prescription', 'call doctor') for a person.",
      inputSchema: {
        person: z.string().describe("Name of the person being cared for"),
        task: z.string().describe("Description of the task"),
        due: z.string().optional().describe("ISO date/time the task is due, if any"),
      },
    },
    async ({ person, task, due }) => {
      await addCareTask(person, task, due);
      return textResult(`Added care task for ${person}: "${task}"${due ? ` (due ${due})` : ""}.`);
    },
  );

  server.registerTool(
    "list_care_tasks",
    {
      title: "List care tasks",
      description: "List all caretaking tasks (open and done) for a person.",
      inputSchema: {
        person: z.string().describe("Name of the person being cared for"),
      },
    },
    async ({ person }) => {
      const tasks = await listCareTasks(person);
      if (tasks.length === 0) return textResult(`No care tasks found for ${person}.`);
      const lines = tasks.map((t) => `- [${t.done ? "x" : " "}] ${t.task}${t.due ? ` (due ${t.due})` : ""}`);
      return textResult(`Care tasks for ${person}:\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "get_daily_summary",
    {
      title: "Get a daily caretaking summary",
      description:
        "Generate a natural-language summary of a person's check-ins, medication events, and open tasks for a given day (defaults to today).",
      inputSchema: {
        person: z.string().describe("Name of the person being cared for"),
        date: z.string().optional().describe("ISO date (YYYY-MM-DD); defaults to today"),
      },
    },
    async ({ person, date }) => {
      const isoDate = date ?? new Date().toISOString().slice(0, 10);
      const snapshot = await getDayData(person, isoDate);
      const { summary, source } = await generateDailySummary({ person, date: isoDate, ...snapshot });
      return textResult(`${summary}\n\n(source: ${source})`);
    },
  );

  server.registerTool(
    "get_alerts",
    {
      title: "Get caretaking alerts",
      description:
        "Flag concerning gaps for a person: no check-in within the expected window, or a missed medication dose without a follow-up taken dose since.",
      inputSchema: {
        person: z.string().describe("Name of the person being cared for"),
      },
    },
    async ({ person }) => {
      const { checkIns, medicationEvents } = await getRecentActivity(person);
      const alerts = computeAlerts(person, checkIns, medicationEvents);
      return textResult(
        alerts.length > 0 ? `Alerts for ${person}:\n- ${alerts.join("\n- ")}` : `No alerts for ${person}.`,
      );
    },
  );

  server.registerTool(
    "add_household_member",
    {
      title: "Add a household member",
      description:
        "Add a person to a household, so household-level tools can cover them. Creates the household if it doesn't exist yet.",
      inputSchema: {
        household: z.string().describe("Name of the household, e.g. 'Smith Family'"),
        person: z.string().describe("Name of the person being cared for to add to this household"),
      },
    },
    async ({ household, person }) => {
      await addHouseholdMember(household, person);
      return textResult(`Added ${person} to household "${household}".`);
    },
  );

  server.registerTool(
    "list_household_members",
    {
      title: "List household members",
      description: "List everyone currently in a household.",
      inputSchema: {
        household: z.string().describe("Name of the household"),
      },
    },
    async ({ household }) => {
      const members = await listHouseholdMembers(household);
      return textResult(
        members.length > 0
          ? `Household "${household}": ${members.join(", ")}.`
          : `Household "${household}" has no members yet. Use add_household_member to add one.`,
      );
    },
  );

  server.registerTool(
    "get_household_summary",
    {
      title: "Get a household-level daily summary",
      description:
        "Generate one natural-language summary covering every member of a household for a given day (defaults to today).",
      inputSchema: {
        household: z.string().describe("Name of the household"),
        date: z.string().optional().describe("ISO date (YYYY-MM-DD); defaults to today"),
      },
    },
    async ({ household, date }) => {
      const members = await listHouseholdMembers(household);
      if (members.length === 0) {
        return textResult(`Household "${household}" has no members yet. Use add_household_member to add one.`);
      }
      const isoDate = date ?? new Date().toISOString().slice(0, 10);
      const memberSnapshots = await Promise.all(
        members.map(async (person) => ({ person, date: isoDate, ...(await getDayData(person, isoDate)) })),
      );
      const { summary, source } = await generateHouseholdSummary({
        household,
        date: isoDate,
        members: memberSnapshots,
      });
      return textResult(`${summary}\n\n(source: ${source})`);
    },
  );

  server.registerTool(
    "get_household_alerts",
    {
      title: "Get household-level alerts",
      description: "Flag concerning gaps (missed check-ins or medication) across every member of a household at once.",
      inputSchema: {
        household: z.string().describe("Name of the household"),
      },
    },
    async ({ household }) => {
      const members = await listHouseholdMembers(household);
      if (members.length === 0) {
        return textResult(`Household "${household}" has no members yet. Use add_household_member to add one.`);
      }
      const memberActivity = await Promise.all(
        members.map(async (person) => ({ person, ...(await getRecentActivity(person)) })),
      );
      const alerts = computeHouseholdAlerts(memberActivity);
      return textResult(
        alerts.length > 0
          ? `Alerts for household "${household}":\n- ${alerts.join("\n- ")}`
          : `No alerts for household "${household}".`,
      );
    },
  );
}
