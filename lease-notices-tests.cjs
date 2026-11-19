"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("./rules.js");
require("./lease-notices.js");

const current = [
  { id: "floodBaseline", status: "Required" },
  { id: "bedbugs", status: "Required" },
  { id: "megan", status: "Required" },
];
function sections(facts = {}, outcomes = current) {
  return LeaseNotices.sections({
    facts: { state: "CA", agreementDate: "2026-11-18", kind: "Fixed term", ...facts },
  }, outcomes);
}

test("flood information for all covered leases distinguishes unknown and known site conditions", () => {
  for (const answer of ["Yes", "No", ""]) {
    const lines = sections({ flood: answer })[0].lines;
    assert.ok(lines.some(line => line.includes("https://myhazards.caloes.ca.gov/")));
    assert.ok(lines.some(line => line.includes("renter’s insurance and flood insurance")));
    assert.ok(lines.some(line => line.includes("additional information")));
    assert.equal(lines.some(line => line.includes("owner has actual knowledge")), answer === "Yes");
    assert.equal(lines.some(line => line.includes("Draft pending")), !answer);
  }
});

test("bed bug notice includes the statutory education and the property's reporting procedure", () => {
  const section = (f) => sections(f).find(item => item.heading === "Information about Bed Bugs").lines;
  const lines = section({ bedbugContact: "Notices box 1", noticeContact: "Notices box 2" });
  assert.equal(lines.filter(line => line.startsWith("•")).length, 4);
  assert.ok(lines.some(line => line.startsWith("Bed bug Appearance:")));
  assert.ok(lines.some(line => line.startsWith("Life Cycle and Reproduction:")));
  assert.ok(lines.some(line => line.startsWith("Bed bug Bites:")));
  assert.ok(lines.some(line => line.includes("National Pest Management Association")));
  assert.ok(lines.some(line => line.includes("Notices box 1")));
  assert.ok(!lines.some(line => line.includes("Notices box 2")));
  assert.ok(section({ bedbugContact: " ", noticeContact: "Notices box 2" }).some(line => line.includes("Notices box 2")));
  assert.ok(section({}).some(line => line.includes("[written reporting contact pending]")));
  const unresolved = [{ id: "floodBaseline", status: "Required" }, { id: "bedbugs", status: "More information needed" }];
  assert.equal(sections({}, unresolved).length, 2);
  assert.equal(sections({ kind: "Renewal" }, unresolved).length, 1);
});

test("notice selection follows the pinned package, jurisdiction and historical wording", () => {
  assert.deepEqual(sections({}, current.filter(x => x.id !== "floodBaseline")), []);
  assert.deepEqual(sections({ state: "NV" }), []);
  assert.deepEqual(sections({ agreementDate: "" }), []);
  const wording = (when) => sections({ agreementDate: when }).find(x => x.heading.includes("Megan")).lines.join(" ");
  assert.match(wording("2005-08-31"), /Identification Line/);
  assert.match(wording("2005-09-01"), /www\.meganslaw\.ca\.gov/);
  const outOfScope = current.map(x => ({ ...x, status: "Not applicable" }));
  assert.deepEqual(sections({}, outOfScope), []);
});

const housingRules = [...current, ...["cap", "cause", "stove"].map(id => ({ id, status: "Required" }))];
const apartment = {
  propertyType: "Apartment", regulated: "No", capCoverage: "Covered", causeCoverage: "Covered",
  start: "2026-11-18", jurisdiction: "Other incorporated city", boundarySource: "Verified parcel",
  applianceException: "No", ownFridge: "Yes",
};
test("the covered-property notice only prints for an established ordinary, covered tenancy", () => {
  const covered = (changes, rules = housingRules) =>
    sections({ ...apartment, ...changes }, rules).some(s => s.heading.includes("Protection Act"));
  assert.ok(covered({}));
  assert.ok(covered({ kind: "Renewal", start: "2018-03-01", termStart: "2026-03-01" }));
  for (const change of [
    { causeCoverage: "Exempt" }, { capCoverage: "Exempt" }, { capCoverage: "" },
    { kind: "Amendment" }, { propertyType: "Other or special housing" }, { regulated: "Yes" },
    { jurisdiction: "City of San Diego", sdCoverage: "Covered" }, { boundarySource: "" },
    { agreementDate: "2025-12-31" }, { agreementDate: "2030-01-01" },
  ]) assert.equal(covered(change), false);
  assert.equal(covered({}, housingRules.map(x => x.id === "cause" ? { ...x, status: "Review needed" } : x)), false);
});

test("refrigerator election leaves a physical checkbox blank for the tenant at signing", () => {
  const kitchen = changes => sections({ ...apartment, ...changes }, housingRules).find(s => s.heading === "Kitchen appliances");
  const chosen = kitchen({}).lines.join(" ");
  assert.match(chosen, /□ Under state law/);
  assert.match(chosen, /voluntary/);
  assert.match(chosen, /30 days’ written notice/);
  assert.match(chosen, /at the end of that notice period, the landlord will install/i);
  assert.match(chosen, /landlord will provide and maintain a working stove/i);
  assert.doesNotMatch(kitchen({ ownFridge: "No" }).lines.join(" "), /□/);
  assert.equal(kitchen({ applianceException: "Yes" }), undefined);
  assert.equal(kitchen({ ownFridge: "" }), undefined);
  assert.equal(kitchen({ agreementDate: "2025-12-31" }), undefined);
});

test("actual PDF notice paragraphs meet their individual minimum print sizes", async () => {
  require("./pdf-font.js");
  require("./export.js");
  const notices = sections({ ...apartment, flood: "Yes", noticeContact: "Notices box 2" }, housingRules);
  const blob = Files.pdf("Notices", notices);
  const pdf = Buffer.from(await blob.arrayBuffer()).toString("latin1");
  const cmap = new Map();
  for (const block of pdf.matchAll(/beginbfchar\n([\s\S]*?)\nendbfchar/g)) {
    for (const [, cid, unicode] of block[1].matchAll(/<([a-f0-9]{4})> <([a-f0-9]{4})>/g)) {
      cmap.set(cid, String.fromCharCode(parseInt(unicode, 16)));
    }
  }
  const printed = [];
  for (const [, size, encoded] of pdf.matchAll(/BT \/F ([\d.]+) Tf [^\n]*? Tm <([a-f0-9]+)> Tj ET/g)) {
    printed.push({ size: Number(size), text: encoded.match(/.{4}/g).map(cid => cmap.get(cid)).join("") });
  }
  for (const notice of notices) {
    const minSize = notice.heading.includes("Protection Act") ? 12 : 10;
    const readable = printed.filter(line => line.size >= minSize).map(line => line.text).join(" ");
    for (const paragraph of [notice.heading, ...notice.lines]) {
      assert.ok(readable.includes(paragraph), "Incomplete or undersized text in " + notice.heading);
    }
  }
});
