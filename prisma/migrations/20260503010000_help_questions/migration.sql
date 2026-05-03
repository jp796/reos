CREATE TABLE "help_questions" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "user_id" TEXT,
  "question" TEXT NOT NULL,
  "answer_text" TEXT,
  "topic" TEXT,
  "helpful" BOOLEAN,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "help_questions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "help_questions_account_id_created_at_idx"
  ON "help_questions" ("account_id", "created_at");
CREATE INDEX "help_questions_topic_idx"
  ON "help_questions" ("topic");
ALTER TABLE "help_questions"
  ADD CONSTRAINT "help_questions_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
