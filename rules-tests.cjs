"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("./rules.js");
const R = globalThis.LeaseRules;
function check(id, facts, expected) {
  const rule = R.base.rules.find((entry) => entry.id === id);
  assert.ok(rule, id);
  const outcome = R.evaluate(rule, { state: "CA", agreementDate: "2026-11-18", ...facts });
  assert.equal(outcome.status, expected, id + " / " + JSON.stringify(facts) + " / " + outcome.why);
}

test("general disclosures, conditional notices and historical cutoffs are independent", () => {
  for (const answer of ["", "Yes", "No"]) {
    check("floodBaseline", { flood: answer }, R.required);
    check("flood", { flood: answer }, answer === "" ? R.unknown : answer === "Yes" ? R.required : R.na);
  }
  check("floodBaseline", { agreementDate: "2018-06-30" }, R.na);
  check("floodBaseline", { agreementDate: "2018-07-01" }, R.required);
  check("moldBooklet", { agreementDate: "2021-12-31", kind: "Fixed term" }, R.na);
  check("moldBooklet", { agreementDate: "2022-01-01", hazards: "No", kind: "Fixed term" }, R.required);
  check("moldBooklet", { kind: "Renewal" }, R.review);
  check("moldBooklet", { kind: "Month to month", state: "NV" }, R.review);
  check("moldBooklet", { state: "" }, R.unknown);
  check("megan", { meganHousing: "Other or uncertain" }, R.review);
  for (const [i, type] of R.fields.meganHousing[1].slice(0, 3).entries())
    check("megan", { meganHousing: type }, i === 2 ? R.na : R.required);
  for (const [id, key] of Object.entries({waterBilling: "waterSubmeter", ownerPesticides: "ownerPesticides", demolition: "demolition", ordnance: "ordnance", recentDeath: "recentDeath", conversion: "conversion", contamination: "contaminationOrder", specialHousing: "regulated"})) {
    check(id, { [key]: "Yes" }, R.required);
    check(id, { [key]: "No" }, R.na);
    check(id, { [key]: "" }, R.unknown);
  }
  check("emergencyPricing", { rentChange: "No" }, R.review);
  check("futureEmergency", { rentChange: "No", agreementDate: "2027-01-01" }, R.review);
});

test("positive rent reporting distinguishes building count, ownership and assisted housing", () => {
  const facts = {buildingSize: "15 or fewer", regulated: "No", ownerType: "Natural person"};
  check("rentReporting", facts, R.na);
  check("rentReporting", {...facts, buildingSize: "More than 15"}, R.required);
  check("rentReporting", {...facts, regulated: "Yes"}, R.review);
  check("rentReporting", {...facts, agreementDate: "2024-01-01"}, R.review);
  const corporate = {...facts, ownerType: "REIT, corporation or corporate LLC member"};
  check("rentReporting", corporate, R.unknown);
  check("rentReporting", {...corporate, multipleBuildings: "Yes"}, R.required);
  check("rentReporting", {...corporate, multipleBuildings: "No"}, R.na);
  check("rentReporting", {...corporate, multipleBuildings: "Yes", ownerType: "Trust or other entity"}, R.review);
});

test("unverified facts cannot resolve legal coverage and zero security needs no fictional collection date", () => {
  check("lead", { built: "9999" }, R.unknown);
  check("lead", { built: "new" }, R.unknown);
  check("lead", { built: "1900", leadExemption: "maybe" }, R.unknown);
  check("moldBooklet", { kind: "Fixed term", agreementDate: "2026-02-30" }, R.unknown);
  check("sd", { jurisdiction: "Other", boundarySource: "record" }, R.unknown);
  check("sd", { jurisdiction: "City of San Diego", boundarySource: "record", sdCoverage: "Covered" }, R.unknown);
  check("deposit", { rent: "2000", deposit: "0.00" }, R.na);
  check("deposit", { rent: "2000", deposit: "-10", depositWhen: "2026-11-18" }, R.unknown);
  check("stove", { applianceException: "No" }, R.unknown);
});

test("every packaged disclosure PDF matches its registered bytes and blank federal form is for drafts", () => {
  for (const assets of Object.values(R.attached)) {
    for (const asset of assets) {
      const bytes = fs.readFileSync(path.join(__dirname, asset.path));
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.hash);
    }
  }
  assert.deepEqual(Object.values(R.attached).flat().filter(a => a.draftOnly).map(a => a.path), ["legal-assets/epa-lead-lessor-en.pdf"]);
});
