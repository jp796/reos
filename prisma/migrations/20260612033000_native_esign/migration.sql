-- Native esign engine: recipients, fields, events + finalized-PDF columns

ALTER TABLE "esign_requests" ADD COLUMN "final_hash" TEXT;
ALTER TABLE "esign_requests" ADD COLUMN "final_document_id" TEXT;

CREATE TABLE "esign_recipients" (
  "id" TEXT NOT NULL,
  "esign_request_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "signing_order" INTEGER NOT NULL DEFAULT 1,
  "token" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "consent_at" TIMESTAMP(3),
  "consent_text_version" TEXT,
  "viewed_at" TIMESTAMP(3),
  "signed_at" TIMESTAMP(3),
  "ip" TEXT,
  "user_agent" TEXT,
  "signature_image" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "esign_recipients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "esign_recipients_token_key" ON "esign_recipients"("token");
CREATE INDEX "esign_recipients_esign_request_id_idx" ON "esign_recipients"("esign_request_id");
ALTER TABLE "esign_recipients" ADD CONSTRAINT "esign_recipients_esign_request_id_fkey" FOREIGN KEY ("esign_request_id") REFERENCES "esign_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "esign_fields" (
  "id" TEXT NOT NULL,
  "esign_request_id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "page" INTEGER NOT NULL,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "width" DOUBLE PRECISION NOT NULL,
  "height" DOUBLE PRECISION NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "value" TEXT,
  CONSTRAINT "esign_fields_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "esign_fields_esign_request_id_idx" ON "esign_fields"("esign_request_id");
CREATE INDEX "esign_fields_recipient_id_idx" ON "esign_fields"("recipient_id");
ALTER TABLE "esign_fields" ADD CONSTRAINT "esign_fields_esign_request_id_fkey" FOREIGN KEY ("esign_request_id") REFERENCES "esign_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esign_fields" ADD CONSTRAINT "esign_fields_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "esign_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "esign_events" (
  "id" TEXT NOT NULL,
  "esign_request_id" TEXT NOT NULL,
  "recipient_id" TEXT,
  "type" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip" TEXT,
  "user_agent" TEXT,
  "meta_json" JSONB,
  CONSTRAINT "esign_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "esign_events_esign_request_id_occurred_at_idx" ON "esign_events"("esign_request_id", "occurred_at");
ALTER TABLE "esign_events" ADD CONSTRAINT "esign_events_esign_request_id_fkey" FOREIGN KEY ("esign_request_id") REFERENCES "esign_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "esign_events" ADD CONSTRAINT "esign_events_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "esign_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
