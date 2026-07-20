-- Valuation subsystem: RPR-style blended valuation.
-- Additive only — three new tables, their indexes, and FKs. No changes to
-- existing tables. `properties` is distinct from the transaction-side `Asset`.

-- CreateTable
CREATE TABLE "properties" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "zip" TEXT,
    "beds" INTEGER,
    "baths" DOUBLE PRECISION,
    "sqft" INTEGER,
    "lotSqft" INTEGER,
    "yearBuilt" INTEGER,
    "propertyType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_runs" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "targetCondition" TEXT,
    "blendedValue" DOUBLE PRECISION NOT NULL,
    "valueLow" DOUBLE PRECISION NOT NULL,
    "valueHigh" DOUBLE PRECISION NOT NULL,
    "spreadPct" DOUBLE PRECISION NOT NULL,
    "confidence" TEXT NOT NULL,
    "sourceCount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_sources" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "isOutlier" BOOLEAN NOT NULL DEFAULT false,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "enteredBy" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "valuation_runs_propertyId_idx" ON "valuation_runs"("propertyId");

-- CreateIndex
CREATE INDEX "valuation_sources_runId_idx" ON "valuation_sources"("runId");

-- AddForeignKey
ALTER TABLE "valuation_runs" ADD CONSTRAINT "valuation_runs_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_sources" ADD CONSTRAINT "valuation_sources_runId_fkey" FOREIGN KEY ("runId") REFERENCES "valuation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
