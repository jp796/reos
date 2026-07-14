/**
 * TaskReminderService — daily due-date reminders for transaction Tasks.
 *
 * For every open task with a due date approaching (or overdue), the whole
 * account team gets pinged — instantly on Telegram (per-user chat) and by
 * email (one message via the account's connected Gmail). This is what turns
 * REOS tasks into real accountability instead of a list nobody checks.
 *
 * Idempotent: each task tracks which reminder windows it has already fired
 * (Task.remindersSentJson, e.g. ["d3","d1","d0","overdue"]) so a task is never
 * pinged twice in the same window even if the cron runs more than once a day.
 */

import type { PrismaClient } from "@prisma/client";
import { TelegramService } from "@/services/integrations/TelegramService";
import { sendAccountGmail } from "@/services/integrations/GmailSendService";
import { logError } from "@/lib/log";

const DEAL_URL = "https://www.myrealestateos.com/transactions";
const TODAY_URL = "https://www.myrealestateos.com/today";

export type ReminderWindow = "d3" | "d1" | "d0" | "overdue";

/** Whole-day difference (dueAt - now), rounded like the morning tick. */
export function dayDiff(due: Date, now: Date): number {
  const a = new Date(due);
  a.setHours(0, 0, 0, 0);
  const b = new Date(now);
  b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

/** Which reminder window a task falls into right now, or null if none. */
export function windowFor(dueAt: Date | null, now: Date): ReminderWindow | null {
  if (!dueAt) return null;
  const d = dayDiff(dueAt, now);
  if (d < 0) return "overdue";
  if (d === 0) return "d0";
  if (d === 1) return "d1";
  if (d === 3) return "d3";
  return null;
}

/** Parse the stored sent-windows array defensively (it's a JSON column). */
export function sentWindows(json: unknown): ReminderWindow[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (w): w is ReminderWindow =>
      w === "d3" || w === "d1" || w === "d0" || w === "overdue",
  );
}

/** Human phrasing for a window, used in the reminder line. */
export function duePhrase(w: ReminderWindow): string {
  switch (w) {
    case "overdue":
      return "OVERDUE";
    case "d0":
      return "due today";
    case "d1":
      return "due tomorrow";
    case "d3":
      return "due in 3 days";
  }
}

interface DueTask {
  id: string;
  title: string;
  window: ReminderWindow;
  priority: string;
  property: string;
  transactionId: string;
  alreadySent: ReminderWindow[];
}

/** Build the plain-text reminder body for an account's due tasks. Plain text
 *  (no Markdown control chars) so it renders safely on Telegram and email. */
export function buildReminderMessage(tasks: DueTask[]): string {
  const lines: string[] = [];
  const overdue = tasks.filter((t) => t.window === "overdue").length;
  lines.push(
    `⏰ REOS task reminders — ${tasks.length} task${tasks.length === 1 ? "" : "s"} need attention${overdue ? ` (${overdue} overdue)` : ""}`,
  );
  lines.push("");
  for (const t of tasks) {
    const flag = t.window === "overdue" ? "❗" : t.priority === "urgent" ? "🔴" : "•";
    lines.push(`${flag} ${t.title} — ${t.property} — ${duePhrase(t.window)}`);
    lines.push(`   ${DEAL_URL}/${t.transactionId}`);
  }
  lines.push("");
  lines.push(`Open your day: ${TODAY_URL}`);
  return lines.join("\n");
}

export interface TaskReminderResult {
  accountsNotified: number;
  tasksReminded: number;
  telegramSent: number;
  emailsSent: number;
}

/**
 * Scan every account's open tasks and fire due-date reminders. Best-effort per
 * account/recipient — one failing send never blocks the rest.
 */
export async function runTaskReminders(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<TaskReminderResult> {
  const result: TaskReminderResult = {
    accountsNotified: 0,
    tasksReminded: 0,
    telegramSent: 0,
    emailsSent: 0,
  };

  // Window upper bound: only tasks due within ~3 days or already overdue.
  const horizon = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
  const candidates = await db.task.findMany({
    where: {
      completedAt: null,
      dueAt: { not: null, lte: horizon },
      transaction: { isDemo: false },
    },
    select: {
      id: true,
      title: true,
      priority: true,
      dueAt: true,
      remindersSentJson: true,
      transactionId: true,
      transaction: {
        select: { accountId: true, propertyAddress: true },
      },
    },
  });

  // Group the tasks that are actually in a not-yet-sent window, by account.
  const byAccount = new Map<string, DueTask[]>();
  for (const t of candidates) {
    const w = windowFor(t.dueAt, now);
    if (!w) continue;
    const already = sentWindows(t.remindersSentJson);
    if (already.includes(w)) continue;
    const acct = t.transaction.accountId;
    const list = byAccount.get(acct) ?? [];
    list.push({
      id: t.id,
      title: t.title,
      window: w,
      priority: t.priority,
      property: t.transaction.propertyAddress ?? "(no address)",
      transactionId: t.transactionId,
      alreadySent: already,
    });
    byAccount.set(acct, list);
  }

  for (const [accountId, tasks] of byAccount) {
    // Order: overdue first, then today, tomorrow, 3-day.
    const order: Record<ReminderWindow, number> = { overdue: 0, d0: 1, d1: 2, d3: 3 };
    tasks.sort((a, b) => order[a.window] - order[b.window]);

    const team = await db.user.findMany({
      where: { accountId },
      select: { name: true, email: true, telegramChatId: true, role: true },
    });
    if (team.length === 0) continue;

    const message = buildReminderMessage(tasks);

    // Telegram — instant, per team member who has linked their chat.
    if (TelegramService.isConfigured()) {
      const tg = new TelegramService();
      for (const u of team) {
        if (!u.telegramChatId) continue;
        try {
          await tg.sendMessage(message, { chatId: u.telegramChatId, parseMode: "HTML" });
          result.telegramSent++;
        } catch (e) {
          logError(e, { route: "TaskReminderService.telegram", accountId });
        }
      }
    }

    // Email — one message to the whole team, from the owner's identity via
    // the account's connected Gmail.
    const owner = team.find((u) => u.role === "owner") ?? team[0]!;
    const emails = team.map((u) => u.email).filter(Boolean);
    try {
      const sent = await sendAccountGmail({
        accountId,
        fromEmail: owner.email,
        recipients: emails,
        subject: `REOS reminders — ${tasks.length} task${tasks.length === 1 ? "" : "s"} need attention`,
        text: message,
      });
      if (sent) result.emailsSent++;
    } catch (e) {
      logError(e, { route: "TaskReminderService.email", accountId });
    }

    // Mark each task's window as sent so we never double-ping it.
    await Promise.all(
      tasks.map((t) =>
        db.task
          .update({
            where: { id: t.id },
            data: { remindersSentJson: [...t.alreadySent, t.window] },
          })
          .catch((e) => logError(e, { route: "TaskReminderService.mark", accountId })),
      ),
    );

    result.accountsNotified++;
    result.tasksReminded += tasks.length;
  }

  return result;
}
