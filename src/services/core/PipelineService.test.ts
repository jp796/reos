import { test, expect, describe } from "bun:test";
import {
  businessFor,
  dispositionFor,
  statusForDeal,
  computeAutoIncome,
  computeTotals,
  investorIncomeFromAsset,
  type PipelineRow,
} from "./PipelineService";

describe("business + disposition mapping", () => {
  test("investor/wholesale → EPS, else RE Agent", () => {
    expect(businessFor("investor")).toBe("EPS");
    expect(businessFor("wholesale")).toBe("EPS");
    expect(businessFor("buyer")).toBe("RE Agent");
    expect(businessFor("seller")).toBe("RE Agent");
    expect(businessFor(null)).toBe("RE Agent");
  });

  test("disposition labels", () => {
    expect(dispositionFor("buyer")).toBe("Client Purchase");
    expect(dispositionFor("seller")).toBe("Client Sale");
    expect(dispositionFor("investor")).toBe("Flip Sale");
    expect(dispositionFor("wholesale")).toBe("Wholesale");
    expect(dispositionFor("other")).toBe("Other");
  });

  test("listing is a guess; everything else contracted", () => {
    expect(statusForDeal("listing")).toBe("guess");
    expect(statusForDeal("active")).toBe("contracted");
    expect(statusForDeal("pending")).toBe("contracted");
    expect(statusForDeal("closed")).toBe("contracted");
  });
});

describe("auto income from financials", () => {
  test("prefers net, then gross, then salePrice × rate", () => {
    expect(computeAutoIncome({ netCommission: 9000, grossCommission: 12000, salePrice: 400000, commissionPercent: 3 })).toBe(9000);
    expect(computeAutoIncome({ netCommission: null, grossCommission: 12000, salePrice: 400000, commissionPercent: 3 })).toBe(12000);
    expect(computeAutoIncome({ salePrice: 400000, commissionPercent: 3 })).toBe(12000); // 3% treated as percent
    expect(computeAutoIncome({ salePrice: 400000, commissionPercent: 0.03 })).toBe(12000); // 0.03 as fraction
  });

  test("returns null when nothing to compute", () => {
    expect(computeAutoIncome(null)).toBeNull();
    expect(computeAutoIncome({})).toBeNull();
    expect(computeAutoIncome({ salePrice: 400000 })).toBeNull(); // no rate
    expect(computeAutoIncome({ netCommission: 0, grossCommission: 0 })).toBeNull();
  });
});

describe("investor proceeds from asset economics", () => {
  test("flip → projected profit as EPS Flip Sale", () => {
    const r = investorIncomeFromAsset({
      representation: "principal",
      strategy: "flip",
      economicsJson: { purchasePrice: 100000, rehabBudget: 40000, salePrice: 220000, sellingCosts: 15000 },
    });
    // profit = 220000 - 15000 - (100000+40000) = 65000
    expect(r).toEqual({ income: 65000, disposition: "Flip Sale" });
  });

  test("wholesale → assignment fee as EPS Wholesale", () => {
    const r = investorIncomeFromAsset({
      representation: "principal",
      strategy: "wholesale",
      economicsJson: { assignmentFee: 20000 },
    });
    expect(r).toEqual({ income: 20000, disposition: "Wholesale" });
  });

  test("rental / creative / non-principal / zero → null (no lump-sum proceeds)", () => {
    expect(investorIncomeFromAsset({ representation: "principal", strategy: "rental_brrrr", economicsJson: { monthlyRent: 1800 } })).toBeNull();
    expect(investorIncomeFromAsset({ representation: "principal", strategy: "creative", economicsJson: {} })).toBeNull();
    expect(investorIncomeFromAsset({ representation: "client", strategy: "flip", economicsJson: { salePrice: 200000, purchasePrice: 100000 } })).toBeNull();
    expect(investorIncomeFromAsset({ representation: "principal", strategy: "wholesale", economicsJson: { assignmentFee: 0 } })).toBeNull();
    expect(investorIncomeFromAsset(null)).toBeNull();
  });
});

describe("totals", () => {
  const rows: PipelineRow[] = [
    { id: "1", source: "manual", business: "EPS", property: "A", disposition: "Wholesale", expectedIncome: 14000, expectedDate: null, status: "contracted", note: null, transactionId: null },
    { id: "2", source: "auto", business: "RE Agent", property: "B", disposition: "Client Sale", expectedIncome: 9180, expectedDate: null, status: "contracted", note: null, transactionId: "t2" },
    { id: "3", source: "manual", business: "EPS", property: "C", disposition: "Flip Sale", expectedIncome: 15000, expectedDate: null, status: "guess", note: null, transactionId: null },
  ];

  test("grand, contracted, guess, and per-business rollups", () => {
    const t = computeTotals(rows);
    expect(t.grandTotal).toBe(38180);
    expect(t.contractedTotal).toBe(23180);
    expect(t.guessTotal).toBe(15000);
    expect(t.count).toBe(3);
    expect(t.byBusiness).toEqual([
      { business: "EPS", total: 29000 },
      { business: "RE Agent", total: 9180 },
    ]);
  });

  test("empty rows → zeros", () => {
    const t = computeTotals([]);
    expect(t.grandTotal).toBe(0);
    expect(t.count).toBe(0);
    expect(t.byBusiness).toEqual([]);
  });
});
