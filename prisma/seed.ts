/**
 * Seed the local database with the owner Account + User.
 * Run:  pnpm db:seed
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const ownerEmail = "owner@real-estate-os.local";

  const account = await db.account.upsert({
    where: { id: "owner-account" },
    update: {},
    create: {
      id: "owner-account",
      businessName: "My Real Estate Business",
      ownerUserId: "owner-user",
    },
  });

  await db.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      id: "owner-user",
      accountId: account.id,
      name: "Owner",
      email: ownerEmail,
      role: "owner",
    },
  });

  // Starter source channels
  const channels = [
    { name: "Sphere", category: "sphere" },
    { name: "Repeat Client", category: "repeat_client" },
    { name: "Referral", category: "referral" },
    { name: "YouTube", category: "youtube" },
    { name: "Zillow", category: "portal" },
    { name: "Direct Mail", category: "direct_mail" },
    { name: "Google Organic", category: "organic" },
    { name: "PPC", category: "ppc" },
    { name: "Open House", category: "open_house" },
  ];
  for (const c of channels) {
    await db.sourceChannel.upsert({
      where: {
        id: `${account.id}-${c.category}-${c.name.toLowerCase().replace(/\s+/g, "-")}`,
      },
      update: {},
      create: {
        id: `${account.id}-${c.category}-${c.name.toLowerCase().replace(/\s+/g, "-")}`,
        accountId: account.id,
        name: c.name,
        category: c.category,
      },
    });
  }

  console.log(`Seeded account ${account.id} with owner ${ownerEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
