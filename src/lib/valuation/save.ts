/**
 * Persist a BlendResult + its sources via Prisma.
 * Import your app's PrismaClient singleton and pass it in.
 */
import type { PrismaClient } from "@prisma/client";
import type { BlendResult } from "./blend";

export async function saveRun(
  prisma: PrismaClient,
  propertyId: number,
  result: BlendResult,
  notes?: string,
): Promise<number> {
  const run = await prisma.valuationRun.create({
    data: {
      propertyId,
      targetCondition: result.targetCondition ?? null,
      blendedValue: result.blendedValue,
      valueLow: result.valueLow,
      valueHigh: result.valueHigh,
      spreadPct: result.spreadPct,
      confidence: result.confidence,
      sourceCount: result.sourceCount,
      notes: notes ?? null,
      sources: {
        create: result.sources.map((s) => ({
          source: s.source,
          value: s.value,
          weight: s.weight,
          isOutlier: s.isOutlier,
          included: s.included,
          enteredBy: s.enteredBy,
        })),
      },
    },
  });
  return run.id;
}
