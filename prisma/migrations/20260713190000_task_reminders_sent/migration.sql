-- Track which due-date reminder windows have already been dispatched per task
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reminders_sent_json" JSONB;
