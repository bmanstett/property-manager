"use strict";
/* The Leases home and the six-step lease builder: what a new draft starts with, how answers follow
   one another, drafts carried over from the earlier tool, renewals and amendments, and the whole
   journey from "Create a lease" to a finished lease in a real browser.
   Every person, address and file here is made up. Nothing is requested from the network.
   The browser part needs playwright-core and desktop Chrome. Set PLAYWRIGHT_CORE or CHROME_PATH if
   the defaults are not available. */
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http");
const runtime = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies");

require("./lease-law.js");
require("./lease-clauses.js");
require("./lease-document.js");
require("./leases.js");
const Law = globalThis.LeaseLaw,
  D = globalThis.Leases.domain;
const flat = (s) => String(s).replace(/\s+/g, " ").trim();
const plusDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const yearEnd = (start, months = 12) => plusDays(Law.addMonths(start, months), -1);
const counter = () => {
  let n = 0;
  return () => "id-" + ++n;
};
const TODAY = "2026-11-18";
const property = { id: "p", name: "Maple Street house", address: "2418 Maple Street", city: "San Diego", county: "San Diego" };
const tenancy = { id: "t", propertyId: "p", name: "Jordan & Sam Rivera", rentCents: 285000, depositCents: 285000, start: "2026-12-01" };

test("amounts, names and suggested values", () => {
  assert.equal(D.parseMoney("3,200"), "3200");
  assert.equal(D.parseMoney("$3200.5"), "3200.50");
  assert.equal(D.parseMoney(" 3200.00 "), "3200");
  for (const bad of ["abc", "12.345", "-5", "", "1e3"]) assert.equal(D.parseMoney(bad), null, bad);
  assert.equal(D.showMoney("3200"), "3,200");
  assert.equal(D.showMoney("3200.50"), "3,200.50");
  assert.equal(D.showMoney("soon"), "soon", "something that is not an amount is shown as typed");

  assert.deepEqual(D.namesFrom("Avery Morgan"), ["Avery Morgan"]);
  assert.deepEqual(D.namesFrom("Jordan & Sam Rivera"), ["Jordan Rivera", "Sam Rivera"]);
  assert.deepEqual(D.namesFrom("Avery Morgan, Lee Park and Kim Ortiz"), ["Avery Morgan", "Lee Park", "Kim Ortiz"]);
  assert.deepEqual(D.namesFrom("Upstairs tenants"), [], "a label is not a name");

  // The starting late fee is the modest figure lease-law.js suggests, never a percentage picked here.
  for (const rent of ["900", "2850", "3200", "6000"]) assert.equal(D.suggestLate(rent), D.parseMoney(Law.suggest.lateFee(rent)), "late fee for " + rent);
  assert.equal(D.suggestLate("3200"), "65");
  assert.equal(D.suggestLate("900"), "25");
  assert.equal(D.suggestLate(""), "");
  assert.ok(Number(D.suggestLate("3200")) <= 3200 * 0.05, "well inside what the builder warns about");
  assert.equal(D.lateDayFor("1"), "5");
  assert.equal(D.lateDayFor("15"), "19");
  assert.equal(D.lateDayFor("28"), "28");
  assert.equal(D.lateDayFor("soon"), "5");

  assert.equal(D.utilityDefaults("house").util_water, "tenant");
  assert.equal(D.utilityDefaults("apartment").util_water, "landlord");
  assert.equal(D.utilityDefaults("apartment").util_electric, "tenant");
  assert.deepEqual(D.utilityDefaults(""), {});
});

test("a new draft starts from what the app already knows, and answers follow one another until the owner sets them", () => {
  const lease = D.draftFor({ id: "l", property, tenancy, today: TODAY, recent: null, uid: counter() });
  assert.deepEqual([lease.type, lease.schema, lease.id, lease.propertyId, lease.tenancyId, lease.step, lease.lawVersion, lease.reviewedInputs], ["lease", 2, "l", "p", "t", 0, Law.version, false]);
  assert.equal(lease.name, "Lease – Jordan Rivera and Sam Rivera");
  assert.deepEqual(lease.tenants.map((t) => t.name), ["Jordan Rivera", "Sam Rivera"]);
  const f = lease.facts;
  assert.deepEqual([f.premises, f.city, f.county, f.state, f.inCity, f.kind, f.agreementDate], ["2418 Maple Street", "San Diego", "San Diego", "CA", "yes", "Fixed term", TODAY]);
  assert.deepEqual([f.rent, f.deposit, f.dueDay, f.lateFee, f.lateFeeAmount, f.lateFeeDay], ["2850", "2850", "1", "yes", D.suggestLate("2850"), "5"]);
  assert.deepEqual([f.termStart, f.start, f.end], ["2026-12-01", "2026-12-01", "2027-11-30"], "a move-in date still ahead starts the term, one year long");
  assert.ok(f.payMethods.split(",").includes("check"), "one way to pay that is neither cash nor electronic");
  assert.ok(Object.values(f).every((v) => typeof v === "string" && v !== ""), "answers are stored as text, and empty ones are left out");
  assert.equal(D.draftFor({ id: "x", property: { ...property, city: "La Mesa" }, tenancy: null, today: TODAY, recent: null, uid: counter() }).facts.inCity, undefined, "outside San Diego the owner is asked");

  const change = (changes) => {
    const before = { ...lease.facts };
    Object.assign(lease.facts, changes);
    D.derive(lease, before, TODAY);
  };
  change({ rent: "3200" });
  assert.deepEqual([f.deposit, f.lateFeeAmount], ["3200", "65"], "deposit and late fee follow the rent");
  change({ deposit: "3000" });
  change({ rent: "3400" });
  assert.deepEqual([f.deposit, f.lateFeeAmount], ["3000", D.suggestLate("3400")], "a deposit the owner typed stays");
  change({ dueDay: "15" });
  assert.equal(f.lateFeeDay, "19", "the late day follows the due day");
  change({ lateFeeDay: "20" });
  change({ dueDay: "10" });
  assert.equal(f.lateFeeDay, "20", "a late day the owner typed stays");
  change({ termStart: "2027-01-15" });
  assert.deepEqual([f.end, f.start], ["2028-01-14", "2027-01-15"], "the end date follows the start date");
  change({ end: "2027-07-14" });
  change({ termStart: "2027-02-01" });
  assert.equal(f.end, "2027-07-14", "an end date the owner chose stays");

  change({ unitType: "house" });
  assert.equal(f.util_water, "tenant");
  change({ unitType: "apartment", buildingUnits: "2", ownerOnSite: "yes" });
  assert.deepEqual([f.util_water, f.buildingUnits, f.ownerOnSite], ["landlord", "2", "yes"], "the usual split follows the kind of home");
  change({ util_water: "tenant" });
  change({ unitType: "condo" });
  assert.deepEqual([f.util_water, f.buildingUnits, f.ownerOnSite], ["tenant", undefined, undefined], "answers to questions no longer asked are dropped, and the owner’s own choices stay");
  change({ pool: "yes" });
  assert.equal(f.util_pool, "landlord");
  change({ pool: "no" });
  assert.equal(f.util_pool, undefined);
  lease.tenants.push({ id: "n", name: "Kim Ortiz", email: "", phone: "" });
  change({});
  assert.equal(lease.name, "Lease – Jordan Rivera and 2 others");
  lease.name = "The Riveras, 2027";
  lease.nameEdited = true;
  change({ rent: "3500" });
  assert.equal(lease.name, "The Riveras, 2027", "a name the owner typed stays");
});

test("the owner’s details and the home’s facts carry over from the last lease", () => {
  const records = [
    { type: "leasePacket", schema: 2, id: "old", propertyId: "p", tenancyId: "t", generated: "2026-01-05T10:00:00Z", facts: { landlord: "Pat Owner", noticeAddress: "410 Example Street, San Diego, CA 92103", noticePhone: "619-555-0100", premises: "2418 Maple Street", unit: "B", zip: "92104", unitType: "apartment", buildingUnits: "3-4", built: "1972", ownerKind: "people", inCity: "yes", util_water: "tenant", payMethods: "check,online", kind: "Fixed term", rent: "2500" } },
    { type: "lease", id: "elsewhere", propertyId: "other", _updatedAt: "2026-06-01T10:00:00Z", facts: { landlord: "Pat Owner", noticeEmail: "pat@example.test", premises: "9 Other Road", unitType: "house", kind: "Fixed term" }, schema: 2 },
    { type: "lease", id: "gone", propertyId: "p", _deleted: true, _updatedAt: "2026-07-01T10:00:00Z", facts: { landlord: "Someone Else", premises: "x" }, schema: 2 },
  ];
  const recent = D.recentAnswers(records, "p");
  assert.deepEqual(recent.owner, { landlord: "Pat Owner", noticeEmail: "pat@example.test" }, "the owner’s details come from the newest lease anywhere");
  assert.deepEqual([recent.home.unitType, recent.home.buildingUnits, recent.home.built, recent.home.zip, recent.home.util_water, recent.home.payMethods, recent.homeTenancyId], ["apartment", "3-4", "1972", "92104", "tenant", "check,online", "t"]);
  assert.equal(recent.home.rent, undefined, "the rent is never carried over");
  const same = D.draftFor({ id: "n", property, tenancy: { id: "t", name: "Jordan Rivera" }, today: TODAY, recent, uid: counter() });
  assert.deepEqual([same.facts.landlord, same.facts.unitType, same.facts.built, same.facts.unit, same.facts.util_water, same.facts.payMethods], ["Pat Owner", "apartment", "1972", "B", "tenant", "check,online"]);
  const other = D.draftFor({ id: "n2", property, tenancy: { id: "t2", name: "Lee Park" }, today: TODAY, recent, uid: counter() });
  assert.equal(other.facts.unit, undefined, "another tenant may live in another unit");
});

test("a draft from the earlier lease tool is upgraded without losing what was typed", () => {
  const old = {
    type: "lease",
    id: "legacy",
    propertyId: "p",
    tenancyId: "t",
    name: "Residential lease",
    step: 4,
    reviewedInputs: true,
    attachments: ["doc-1"],
    package: { version: "CA-2026.11.18.2", rules: [] },
    resolutions: { cap: "x" },
    customClauses: [{ id: "c1", title: "Bicycles", text: "Bicycles go in room B." }],
    facts: { premises: "184 Juniper Lane", city: "San Diego", jurisdiction: "City of San Diego", propertyType: "Apartment", buildingSize: "More than 15", ownerType: "Natural person", built: "1972", landlord: "Alex Example", noticeContact: "410 Example Street,  San Diego", adults: "Robin Example\n Sam Example ", kind: "Fixed term", termStart: "2026-12-01", start: "2026-12-01", end: "2027-11-30", rent: "1,800", deposit: "1800", dueDay: "1", methods: "Check or bank transfer", pets: "One cat named Miso", flood: "No", language: "Spanish", ownFridge: "Yes", attorneyName: "Test reviewer", capBasis: "Counsel memo" },
  };
  const lease = D.upgrade(JSON.parse(JSON.stringify(old)), { today: TODAY, uid: counter() });
  const f = lease.facts;
  assert.deepEqual([lease.schema, lease.id, lease.propertyId, lease.tenancyId, lease.step, lease.reviewedInputs, lease.lawVersion], [2, "legacy", "p", "t", 0, false, Law.version], "it starts again at the first step and must be read again");
  assert.deepEqual([lease.package, lease.resolutions], [null, null]);
  assert.deepEqual([f.premises, f.inCity, f.unitType, f.buildingUnits, f.ownerKind, f.built, f.landlord, f.noticeAddress], ["184 Juniper Lane", "yes", "apartment", "16+", "people", "1972", "Alex Example", "410 Example Street, San Diego"]);
  assert.deepEqual([f.kind, f.termStart, f.end, f.rent, f.deposit, f.payDetails, f.floodKnown, f.negotiatedLanguage, f.ownFridge, f.appliances], ["Fixed term", "2026-12-01", "2027-11-30", "1800", "1800", "Check or bank transfer", "no", "spanish", "yes", "stove"]);
  assert.deepEqual(lease.tenants.map((t) => t.name), ["Robin Example", "Sam Example"]);
  assert.deepEqual(lease.customClauses.map((c) => [c.title, c.text]), [["Bicycles", "Bicycles go in room B."], ["Pets", "One cat named Miso"]], "free text with no question of its own becomes a clause the owner can see");
  assert.deepEqual([f.old_attorneyName, f.old_capBasis], ["Test reviewer", "Counsel memo"], "every other answer is kept on the record");
  assert.deepEqual(lease.attachments, ["doc-1"]);
  assert.equal(lease.name, "Lease – Robin Example and Sam Example", "the earlier tool’s stock name is replaced");
  assert.equal(D.upgrade({ ...old, name: "Unit 3, winter 2026" }, { today: TODAY, uid: counter() }).name, "Unit 3, winter 2026");
});

test("renew, amend and revise each start from the finished lease", () => {
  const packet = {
    type: "leasePacket",
    schema: 2,
    id: "pk",
    propertyId: "p",
    tenancyId: "t",
    name: "Lease – Jordan Rivera",
    facts: { premises: "2418 Maple Street", city: "San Diego", inCity: "yes", unitType: "house", otherUnitOnLot: "no", built: "1999", ownerKind: "people", landlord: "Pat Owner", kind: "Fixed term", start: "2026-12-01", termStart: "2026-12-01", end: "2027-11-30", rent: "3200", deposit: "3200", dueDay: "1", firstMonth: "1600", rareReviewed: "yes", floodKnown: "no" },
    tenants: [{ id: "a", name: "Jordan Rivera", email: "jordan@example.test", phone: "" }],
    clauses: { pets: { on: true, opts: { policy: "approved", details: "One cat" } } },
    customClauses: [{ id: "c1", title: "Bicycles", text: "Bicycles go in the garage." }],
    attachments: [{ id: "copy-1", sourceId: "doc-1" }, { id: "copy-2", sourceId: "" }, { id: "copy-3", sourceId: "doc-gone" }],
  };
  const make = (mode) => D.fromPacket(JSON.parse(JSON.stringify(packet)), mode, { id: "new-" + mode, today: TODAY, uid: counter(), has: (id) => id === "doc-1" });

  const renewal = make("renew");
  assert.deepEqual([renewal.schema, renewal.id, renewal.propertyId, renewal.tenancyId, renewal.parentPacket, renewal.origin, renewal.step, renewal.reviewedInputs], [2, "new-renew", "p", "t", "pk", "renew", 2, false]);
  assert.deepEqual([renewal.facts.kind, renewal.facts.start, renewal.facts.termStart, renewal.facts.end, renewal.facts.agreementDate, renewal.facts.rent], ["Renewal", "2026-12-01", "2027-12-01", "2028-11-30", TODAY, "3200"], "the new term starts the day after the old one ends; the move-in date stays");
  assert.deepEqual([renewal.facts.firstMonth, renewal.facts.rareReviewed], [undefined, undefined], "one-time answers are asked again");
  assert.equal(renewal.name, "Lease renewal – Jordan Rivera");
  assert.deepEqual(renewal.clauses, packet.clauses);
  assert.deepEqual(renewal.customClauses.map((c) => [c.title, c.text]), [["Bicycles", "Bicycles go in the garage."]]);
  assert.notEqual(renewal.customClauses[0].id, "c1", "copies get their own ids");
  assert.deepEqual(renewal.attachments, ["doc-1"], "only the owner’s own files that still exist are attached again");
  assert.deepEqual(D.stepsFor(renewal), [0, 1, 2, 3, 4, 5]);

  const amendment = make("amend");
  assert.deepEqual([amendment.facts.kind, amendment.facts.changeText, amendment.facts.termStart, amendment.step, amendment.name], ["Amendment", "", undefined, 2, "Lease amendment – Jordan Rivera"]);
  assert.deepEqual([amendment.clauses, amendment.customClauses, amendment.attachments], [{}, [], []], "an amendment is one page of its own");
  assert.deepEqual(D.stepsFor(amendment), [0, 1, 2, 5], "an amendment skips Rules and Disclosures");
  assert.equal(D.progress(amendment, TODAY).of, 4);

  const revision = make("revise");
  assert.deepEqual([revision.facts.kind, revision.facts.termStart, revision.step, revision.name, revision.nameEdited, revision.parentPacket], ["Fixed term", "2026-12-01", 0, "Lease – Jordan Rivera", true, "pk"]);

  const monthly = D.fromPacket({ ...JSON.parse(JSON.stringify(packet)), facts: { ...packet.facts, kind: "Month to month", end: "" } }, "renew", { id: "m", today: TODAY, uid: counter() });
  assert.deepEqual([monthly.facts.termStart, monthly.facts.end], [TODAY, yearEnd(TODAY)], "a month-to-month tenancy is renewed from today");
});

test("a renewal keeps what was agreed, hidden answers are dropped, and earlier dates survive an upgrade", () => {
  const packet = {
    type: "leasePacket", schema: 2, id: "pk", propertyId: "p", tenancyId: "t", name: "Lease – Jordan Rivera",
    facts: { premises: "2418 Maple Street", city: "San Diego", inCity: "yes", unitType: "house", otherUnitOnLot: "no", built: "1999", ownerKind: "people", landlord: "Pat Owner", kind: "Fixed term", start: "2025-12-01", termStart: "2025-12-01", end: "2026-11-30", rent: "3000", deposit: "3000", dueDay: "1", lateFee: "yes", lateFeeAmount: "60", lateFeeDay: "5" },
    tenants: [{ id: "a", name: "Jordan Rivera" }], clauses: {}, customClauses: [], attachments: [],
  };
  // Raising the rent on a renewal does not touch the deposit the owner already holds, or the agreed late fee.
  const renewal = D.fromPacket(JSON.parse(JSON.stringify(packet)), "renew", { id: "r", today: TODAY, uid: counter() });
  const before = { ...renewal.facts };
  renewal.facts.rent = "3150";
  D.derive(renewal, before, TODAY);
  assert.deepEqual([renewal.facts.rent, renewal.facts.deposit, renewal.facts.lateFeeAmount], ["3150", "3000", "60"]);
  // A new lease still follows the rent.
  const fresh = D.draftFor({ id: "n", property, tenancy: { id: "t", name: "Jordan Rivera", rentCents: 300000 }, today: TODAY, recent: null, uid: counter() });
  const was = { ...fresh.facts };
  fresh.facts.rent = "3150";
  D.derive(fresh, was, TODAY);
  assert.deepEqual([fresh.facts.deposit, fresh.facts.lateFeeAmount], ["3150", D.suggestLate("3150")]);

  // A first payment typed for a mid-month start is dropped when the start moves to the day rent is due,
  // so it can never block the lease from a field that is no longer on the screen.
  const lease = D.draftFor({ id: "f", property, tenancy: null, today: TODAY, recent: null, uid: counter() });
  const change = (changes) => {
    const prev = { ...lease.facts };
    Object.assign(lease.facts, changes);
    D.derive(lease, prev, TODAY);
  };
  change({ rent: "2000", termStart: "2026-12-15" });
  change({ firstMonth: "about 1000" });
  assert.ok(D.problems(lease, TODAY).some((x) => x.field === "firstMonth"), "while it is shown, a first payment that is not an amount is flagged");
  change({ termStart: "2027-01-01" });
  assert.equal(lease.facts.firstMonth, undefined);
  assert.ok(!D.problems(lease, TODAY).some((x) => x.field === "firstMonth"));
  lease.facts.firstMonth = "about 1000"; // as an older draft might still hold it
  assert.ok(!D.problems(lease, TODAY).some((x) => x.field === "firstMonth"), "a first payment that is not shown is not checked");

  // The questions about an owner who lives on the property are kept only while they are asked.
  change({ unitType: "room", otherUnitOnLot: "yes", ownerOnSite: "yes", sharedKitchenBath: "no", ownerRentsMore: "no" });
  assert.deepEqual([lease.facts.sharedKitchenBath, lease.facts.ownerRentsMore], ["no", "no"]);
  change({ sharedKitchenBath: "yes" });
  assert.equal(lease.facts.ownerRentsMore, undefined, "sharing the kitchen or bathroom makes the count beside the point");
  change({ unitType: "adu", ownerRentsMore: "yes" });
  assert.deepEqual([lease.facts.sharedKitchenBath, lease.facts.ownerRentsMore], [undefined, "yes"]);
  change({ ownerOnSite: "no" });
  assert.equal(lease.facts.ownerRentsMore, undefined);

  // The earlier tool kept "original tenancy start" apart from "this term begins". Neither date is lost.
  const old = (facts) => D.upgrade({ type: "lease", id: "o", propertyId: "p", step: 2, attachments: [], facts: { premises: "184 Juniper Lane", landlord: "Alex Example", adults: "Robin Example", rent: "1800", ...facts } }, { today: TODAY, uid: counter() }).facts;
  const existing = old({ kind: "Fixed term", start: "2021-03-01", termStart: "2026-12-01", end: "2027-11-30" });
  assert.deepEqual([existing.kind, existing.start, existing.termStart, existing.end], ["Renewal", "2021-03-01", "2026-12-01", "2027-11-30"], "an existing tenant starting a new term is a renewal");
  const blank = old({ kind: "Fixed term", start: "2021-03-01", end: "2027-11-30" });
  assert.deepEqual([blank.kind, blank.start, blank.termStart], ["Fixed term", "2021-03-01", "2021-03-01"], "with no term date, the one date given starts the term");
  const monthly = old({ kind: "Month to month", start: "2021-03-01", termStart: "2026-12-01" });
  assert.deepEqual([monthly.kind, monthly.termStart, monthly.old_start], ["Month to month", "2026-12-01", "2021-03-01"]);
  const same = old({ kind: "Fixed term", start: "2026-12-01", termStart: "2026-12-01", end: "2027-11-30" });
  assert.deepEqual([same.kind, same.start, same.old_start], ["Fixed term", "2026-12-01", undefined]);
});

test("what is still needed is listed in order, with the step it belongs to", () => {
  const lease = D.draftFor({ id: "l", property, tenancy: null, today: TODAY, recent: null, uid: counter() });
  const list = D.problems(lease, TODAY);
  assert.ok(list.length > 5, "a new draft needs answers");
  assert.ok(list.every((x) => Number.isInteger(x.step) && x.step >= 0 && x.step <= 5 && x.field && /[.?]$/.test(x.label)), "each one names a step, a field and a plain sentence");
  assert.deepEqual(list.map((x) => x.step), list.map((x) => x.step).sort((a, b) => a - b), "in the order of the steps");
  for (const field of ["unitType", "built", "ownerKind", "landlord", "tenants", "termStart", "rent"]) assert.ok(list.some((x) => x.field === field), "asks for " + field);
  assert.deepEqual(D.progress(lease, TODAY), { left: list.length, step: 1, of: 6 });

  Object.assign(lease.facts, { rent: "3200", dueDay: "10", lateFee: "yes", lateFeeDay: "5", termStart: "2026-12-15", firstMonth: "half" });
  const more = D.problems(lease, TODAY);
  assert.equal(more.find((x) => x.field === "lateFeeDay").label, "Choose a late day on or after the day rent is due.");
  assert.equal(more.find((x) => x.field === "firstMonth").label, "Enter the first payment as an amount, or leave it blank.");

  const stored = { type: "lease", id: "odd", facts: { rent: 3200, built: null, unitType: "house" }, tenants: "Jordan", clauses: [], customClauses: [{ text: "x" }, null], attachments: [7, "doc"], step: 9 };
  const safe = D.tidy(JSON.parse(JSON.stringify(stored)), counter());
  assert.deepEqual([safe.facts, safe.tenants.length, safe.clauses, safe.customClauses.length, safe.attachments, safe.step, safe.schema], [{ rent: "3200", unitType: "house" }, 1, {}, 1, ["doc"], 0, 2], "a damaged draft opens instead of breaking the page");
});

/* ---------- The browser ---------- */
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core"));
} catch {
  ({ chromium } = require(path.join(runtime, "node", "node_modules", "playwright-core")));
}
const chrome = process.env.CHROME_PATH || (process.platform === "win32" ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : undefined);
const mime = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", png: "image/png", pdf: "application/pdf", webmanifest: "application/manifest+json", json: "application/json", txt: "text/plain; charset=utf-8" };
const servable = /^(index\.html|manifest\.webmanifest|LICENSE-Liberation\.txt|[a-z-]+\.(js|css|json)|(assets|legal-assets)\/[A-Za-z0-9_.-]+)$/;
function serve() {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname.slice(1)) || "index.html";
    const file = path.join(__dirname, name);
    if (!servable.test(name) || name === "sw.js" || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(name).slice(1)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", () => resolve(server)));
}
/* Runs in the page: small readers used by the checks below. */
const HELPERS = `window.T = {
  sheet() { const host = document.querySelector(".lb-preview .lb-sheet"); return host ? host.shadowRoot || host : null; },
  preview() { return (T.sheet()?.querySelector(".sheet")?.textContent || "").replace(/\\s+/g, " "); },
  headings() { return [...(T.sheet()?.querySelectorAll(".doc-h2") || [])].map((h) => h.textContent.replace(/^\\d+\\.\\s*/, "").trim()); },
  draftId() { return (location.hash.match(/^#leases\\/draft\\/(.+)$/) || [])[1] || ""; },
  draft() { return PM.get(T.draftId()); },
};`;
/* Runs in the page: the rules the whole app is held to, for what is on screen now. */
const AUDIT = (selector) => {
  const dialog = document.querySelector("dialog[open]");
  const scope = dialog || document.querySelector(selector);
  const issues = [];
  if (!scope) return ["nothing to check for " + selector];
  if (document.documentElement.scrollWidth > innerWidth) issues.push("the page scrolls sideways by " + (document.documentElement.scrollWidth - innerWidth) + "px");
  if (dialog && dialog.scrollWidth > dialog.clientWidth + 1) issues.push("the dialog scrolls sideways");
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.name || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 44);
  let checked = 0;
  for (const control of scope.querySelectorAll("button,summary,input:not([type=hidden]),select,textarea,a[href]")) {
    const r = control.getBoundingClientRect();
    if (control.closest("[hidden]") || getComputedStyle(control).visibility === "hidden" || !control.checkVisibility()) continue;
    if (control.closest("details:not([open])") && !control.matches("summary")) continue;
    if (control.matches("summary") && control.closest("details")?.parentElement?.closest("details:not([open])")) continue;
    const target = control.matches("input[type=checkbox],input[type=radio],input[type=file]") ? control.closest("label") || control : control;
    const box = target.getBoundingClientRect();
    if (!r.width && !box.width) continue;
    checked++;
    if (box.width < 43.98 || box.height < 43.98) issues.push("small target: " + label(control) + " " + Math.round(box.width) + "×" + Math.round(box.height));
    if (innerWidth <= 430 && control.matches("input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea") && parseFloat(getComputedStyle(control).fontSize) < 16) issues.push("small text in " + label(control));
  }
  const color = (s) => s.match(/[\d.]+/g)?.map(Number);
  const luminance = (rgb) => {
    const [r, g, b] = rgb.slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  };
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest("script,style,option,[hidden],[disabled],svg") || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    let bg,
      layer = el;
    while (layer) {
      const style = getComputedStyle(layer),
        rgba = color(style.backgroundColor);
      if (style.backgroundImage !== "none" || Number(style.opacity) < 1) break;
      if (rgba && (rgba.length === 3 || rgba[3] === 1)) {
        bg = rgba;
        break;
      }
      if (rgba?.[3] > 0) break;
      layer = layer.parentElement;
    }
    if (!bg) continue;
    const style = getComputedStyle(el),
      fg = color(style.color);
    if (!fg || fg[3] < 1) continue;
    const a = luminance(bg),
      b = luminance(fg),
      ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(style.fontSize),
      large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio + 0.005 < (large ? 3 : 4.5)) issues.push("low contrast " + ratio.toFixed(2) + ": " + n.textContent.trim().slice(0, 30));
  }
  if (checked < 2) issues.push("too few controls were found to check");
  return issues;
};

test("the lease builder in a real browser", async (t) => {
  const server = await serve();
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("http://127.0.0.1:" + server.address().port + "/");
  await page.waitForFunction(() => globalThis.PM?.prop?.() && PM.records("tenancy").length, null, { timeout: 20000 });
  await page.evaluate(HELPERS);
  const client = await context.newCDPSession(page);
  await client.send("Accessibility.enable");
  await client.send("DOM.enable");
  const today = await page.evaluate(() => PM.today());

  /* Sizes, contrast, names and overflow for what is on screen, at phone, zoomed and desktop widths. */
  async function audit(name, selector, widths = [375, 1280]) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
      await page.waitForTimeout(60);
      const issues = await page.evaluate(AUDIT, selector);
      const { nodes } = await client.send("Accessibility.getFullAXTree");
      for (const node of nodes) {
        if (node.ignored || !["button", "textbox", "checkbox", "radio", "combobox", "switch", "link", "searchbox"].includes(node.role?.value) || String(node.name?.value || "").trim() || !node.backendDOMNodeId) continue;
        const { object } = await client.send("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId });
        const { result } = await client.send("Runtime.callFunctionOn", { objectId: object.objectId, returnByValue: true, functionDeclaration: "function(){return this.closest&&this.closest('.lb,.lh,.lh-sources')?this.outerHTML.slice(0,90):''}" });
        if (result.value) issues.push("no name for " + node.role.value + ": " + result.value);
      }
      assert.deepEqual(issues, [], name + " at " + width + "px");
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(60);
  }
  const toastSays = (pattern) =>
    page.waitForFunction((source) => new RegExp(source).test(document.getElementById("toast")?.innerText || ""), pattern.source, { timeout: 8000 }).catch(async () => {
      assert.match(await page.locator("#toast").innerText(), pattern);
    });
  const builder = page.locator(".lb");
  const field = (key) => builder.locator('[data-field="' + key + '"]:not([type=radio]):not([type=checkbox])');
  const option = (key, value) => builder.locator('input[data-field="' + key + '"][value="' + value + '"]');
  const toggle = (key) => builder.locator('input[type=checkbox][data-field="' + key + '"]');
  /* The builder redraws on the next frame and after a press is released; wait for both. */
  const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0)))));
  const check = async (target) => (await target.check(), settle());
  const uncheck = async (target) => (await target.uncheck(), settle());
  const click = async (target) => (await target.click(), settle());
  const type = async (target, value) => {
    await target.fill(value);
    await target.blur();
    await settle();
  };
  const fill = (key, value) => type(field(key), value);
  const errorOf = (key) => builder.locator("#lb-" + key.replace(/[^a-zA-Z0-9_-]/g, "-") + "-error");
  const caption = () => builder.locator(".lb-caption").textContent();
  const next = async (label) => {
    await click(builder.locator('.lb-foot [data-lease="next"]'));
    await builder.locator("#lb-step-title").filter({ hasText: label }).waitFor();
  };
  const previewHas = (text, message) => page.waitForFunction((x) => T.preview().includes(x), flat(text), { timeout: 8000 }).catch(() => assert.fail("the preview should show: " + (message || flat(text).slice(0, 80))));
  const saved = () =>
    builder
      .locator('.lb-status[data-state="saved"]')
      .waitFor({ timeout: 12000 })
      .catch(async () => assert.fail("the draft should be saved, but the page says: " + flat(await builder.locator(".lb-status").innerText()) + " / " + flat(await builder.locator(".lb-alert").textContent())));
  const noDropdowns = async (name) => assert.equal(await builder.locator("select").count(), 0, "no dropdowns on " + name);

  await t.test("my own rental: the Leases home says what each thing is for", async () => {
    await page.evaluate(async () => {
      const today = PM.today();
      await Store.save("owner", [
        { type: "property", id: "t-property", name: "Maple Street house", address: "2418 Maple Street", city: "San Diego", county: "San Diego", state: "CA", timezone: "America/Los_Angeles" },
        { type: "unit", id: "t-unit", propertyId: "t-property", name: "Residential unit" },
        { type: "tenancy", id: "t-tenancy", unitId: "t-unit", propertyId: "t-property", name: "Jordan Rivera", rentCents: 285000, depositCents: 285000, depositDate: PM.addDays(today, -40), start: PM.addDays(today, -40), nextDue: today.slice(0, 7) + "-01" },
      ]);
      await PM.action("owner-property", "t-property");
    });
    await page.waitForFunction(() => PM.dataset() === "owner" && PM.prop()?.id === "t-property");
    await page.evaluate(() => PM.navigate("Leases", ""));
    const home = page.locator(".lh");
    await home.waitFor();
    assert.equal(await home.locator("h1").innerText(), "Leases");
    assert.deepEqual(await home.locator(".lh-head-actions button").allInnerTexts(), ["Create a lease", "Add a lease I already have"]);
    assert.deepEqual(await home.locator("h2").allInnerTexts(), ["Your tenants", "Moving out?", "What law is built in"]);
    const card = home.locator(".lh-tenant");
    assert.equal(await card.locator("h3").innerText(), "Jordan Rivera");
    assert.match(await card.locator(".lh-facts").innerText(), /No lease on file\s+\$2,850 a month/);
    assert.deepEqual(await card.locator("button").allInnerTexts(), ["Create lease"]);
    assert.equal(await home.locator("select").count(), 0, "no dropdowns");
    assert.match(await home.locator(".lh-side").innerText(), new RegExp("California and City of San Diego rules, reviewed " + Law.longDate(Law.reviewed).replace(/[.,]/g, "\\$&")));
    await audit("Leases home", ".lh", [375, 720, 1280]);
    // The sources behind the builder, each with a link to the official text.
    await click(home.locator('[data-lease="rules"]'));
    const dialog = page.locator("dialog[open]");
    await dialog.locator(".lh-sources").waitFor();
    assert.equal(await dialog.locator("#dialog-title").innerText(), "Legal sources");
    assert.equal(await dialog.locator(".lh-sources li").count(), Law.sources.length);
    assert.ok(Law.sources.length >= 10, "the list of sources is a real one");
    const links = await dialog.locator(".lh-sources li a").evaluateAll((list) => list.map((a) => [a.href, a.target, a.rel]));
    assert.ok(links.length === Law.sources.length && links.every(([href, target, rel]) => /^https:\/\//.test(href) && target === "_blank" && /noopener/.test(rel)));
    assert.match(await dialog.locator(".lh-sources").innerText(), /It is not a law firm, and this is not legal advice\./);
    assert.match(await dialog.locator(".lh-version").innerText(), new RegExp("^Version " + Law.version.replace(/[.]/g, "\\.") + "$"));
    await audit("legal sources", ".lh-sources", [375]);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" }).catch(() => {});
  });

  await t.test("step 1, Home: a few plain questions decide which rules apply", async () => {
    await click(page.locator('.lh .lh-head-actions [data-lease="create"]'));
    await builder.waitFor();
    assert.equal(await caption(), "Step 1 of 6 · Home");
    assert.equal(await builder.locator("#lb-step-title").innerText(), "Home");
    assert.equal(await builder.locator("#lb-name").inputValue(), "Lease – Jordan Rivera", "the one tenant without a lease is chosen for you");
    assert.deepEqual(await builder.locator(".lb-steps button").evaluateAll((list) => list.map((b) => b.getAttribute("aria-label"))), ["Step 1: Home, current step", "Step 2: People, not started", "Step 3: Rent & term, not started", "Step 4: Rules, not started", "Step 5: Disclosures, not started", "Step 6: Review & sign, not started"]);
    assert.deepEqual([await field("premises").inputValue(), await field("city").inputValue(), await option("inCity", "yes").isChecked()], ["2418 Maple Street", "San Diego", true]);
    assert.match(await builder.locator(".lb-result").innerText(), /^Which rules apply\s+Answer the questions above/);
    assert.equal(await builder.locator('.lb-linkrow a[target="_blank"]').first().getAttribute("href"), Law.links.cityLookup);
    assert.match(await page.evaluate(() => T.preview()), /Residential Lease Agreement 2418 Maple Street, San Diego, California/);
    await audit("Home step, before any answers", ".lb");

    await fill("zip", "921");
    assert.equal(await errorOf("zip").innerText(), "Enter a five-digit ZIP code.");
    await fill("zip", "92104");
    assert.equal(await errorOf("zip").count(), 0);
    await check(option("unitType", "apartment"));
    await option("buildingUnits", "5-15").waitFor();
    assert.equal(await option("otherUnitOnLot", "no").count(), 0, "only the questions that matter for an apartment");
    await check(option("unitType", "house"));
    await check(option("otherUnitOnLot", "no"));
    assert.equal(await option("buildingUnits", "5-15").count(), 0);
    await fill("built", "2999");
    assert.equal(await errorOf("built").innerText(), "Enter the year as four digits, for example 1985.");
    await fill("built", "1999");
    await check(option("ownerKind", "people"));
    const title = builder.locator(".lb-result-title");
    await title.filter({ hasText: "Exempt: a house owned by people, not a corporation" }).waitFor();
    assert.match(await builder.locator(".lb-result").innerText(), /Both the state and the City statement are in your lease\./);
    assert.match(await builder.locator(".lb-result-facts").innerText(), /^Based on: .*Built 1999.*Inside the City of San Diego/);
    await previewHas(Law.texts.stateExempt, "the state exemption statement");
    await previewHas(Law.texts.cityExempt, "the City exemption statement");
    assert.ok(!(await page.evaluate(() => T.preview())).includes(flat(Law.texts.stateCovered)), "an exempt home does not get the notice for covered homes");
    // The same home owned by a corporation is covered, and says so at once.
    await check(option("ownerKind", "corp"));
    await title.filter({ hasText: /^Covered/ }).waitFor();
    await option("multipleBuildings", "no").waitFor();
    await previewHas(Law.texts.stateCovered, "the notice for covered homes");
    await check(option("ownerKind", "people"));
    await title.filter({ hasText: /^Exempt/ }).waitFor();
    assert.equal(await option("multipleBuildings", "no").count(), 0);
    // An ADU behind the owner's home: the two-unit limit is asked, never assumed.
    await check(option("unitType", "adu"));
    await check(option("ownerOnSite", "yes"));
    await option("ownerRentsMore", "no").waitFor();
    assert.match(await builder.locator(".lb-result").innerText(), /^Which rules apply/, "no answer is shown until the question is answered");
    await check(option("ownerRentsMore", "no"));
    await title.filter({ hasText: "Rent cap applies; just-cause rules do not" }).waitFor();
    await previewHas("rents no more than two units or bedrooms there");
    await check(option("ownerRentsMore", "yes"));
    await title.filter({ hasText: /^Covered/ }).waitFor();
    assert.match(await builder.locator(".lb-result").innerText(), /more than two units or bedrooms/);
    await check(option("unitType", "house"));
    await check(option("otherUnitOnLot", "no"));
    await title.filter({ hasText: /^Exempt/ }).waitFor();
    assert.equal(await option("ownerRentsMore", "no").count(), 0);
    // The less common facts wait behind one line.
    assert.equal(await toggle("hoa").isVisible(), false);
    await click(builder.locator("summary", { hasText: "More about the home" }));
    await check(toggle("hoa"));
    await noDropdowns("Home");
    await audit("Home step, answered", ".lb", [375, 720, 1280]);
    await saved();
    const stored = await page.evaluate(() => T.draft());
    assert.deepEqual([stored.schema, stored.step, stored.tenancyId, stored.facts.unitType, stored.facts.built, stored.facts.ownerKind, stored.facts.zip, stored.facts.hoa, stored.facts.multipleBuildings], [2, 0, "t-tenancy", "house", "1999", "people", "92104", "yes", undefined]);
    const analysis = Law.analyze(stored, today);
    assert.equal(await title.innerText(), analysis.coverage.title, "the box shows what lease-law.js decided");
  });

  await t.test("step 2, People: the landlord, where notices go, and the tenants", async () => {
    await next("People");
    assert.equal(await caption(), "Step 2 of 6 · People");
    assert.equal(await builder.locator('.lb-steps li[data-k="s0"]').getAttribute("class"), "is-done");
    await fill("landlord", "Pat Owner");
    await fill("noticeAddress", "P.O. Box 12, San Diego, CA 92103");
    await builder.locator(".ui-note--warn").filter({ hasText: "This looks like a P.O. box. Use a street address where papers can be handed to someone." }).waitFor();
    await fill("noticeAddress", "410 Example Street, San Diego, CA 92103");
    assert.equal(await builder.locator(".ui-note--warn").count(), 0);
    await fill("noticePhone", "619-555-0100");
    await fill("noticeEmail", "pat@");
    assert.equal(await errorOf("noticeEmail").innerText(), "Check the email address.");
    await fill("noticeEmail", "pat@example.test");
    // Which tenant the lease is for, and who signs.
    assert.deepEqual(await builder.locator('input[name="lease:tenancyId"]').evaluateAll((list) => list.map((i) => [i.value, i.checked])), [["t-tenancy", true], ["", false]]);
    assert.equal(await field("tenants").inputValue(), "Jordan Rivera");
    assert.equal(await builder.locator('[data-lease="removeTenant"]').count(), 0, "one tenant cannot be removed");
    await click(builder.locator('[data-lease="addTenant"]'));
    const second = builder.locator('.lb-person input[name$=":name"]').nth(1);
    assert.ok(await second.evaluate((el) => el === document.activeElement), "the new name box is ready to type in");
    await type(second, "Sam Rivera");
    await page.waitForFunction(() => document.getElementById("lb-name").value === "Lease – Jordan Rivera and Sam Rivera");
    await previewHas("between Pat Owner (“Landlord”) and Jordan Rivera and Sam Rivera");
    assert.equal(await builder.locator('[data-lease="removeTenant"]').count(), 2);
    // A manager who signs for the owner.
    await check(builder.locator('input[name="ui:managed"]'));
    await fill("manager", "Robin Agent");
    await check(option("signer", "manager"));
    await previewHas("Robin Agent");
    await uncheck(builder.locator('input[name="ui:managed"]'));
    await page.waitForFunction(() => !T.preview().includes("Robin Agent"));
    await noDropdowns("People");
    await audit("People step", ".lb");
    await saved();
    const stored = await page.evaluate(() => T.draft());
    assert.deepEqual([stored.facts.landlord, stored.facts.noticeAddress, stored.facts.noticePhone, stored.facts.noticeEmail, stored.facts.manager, stored.facts.signer], ["Pat Owner", "410 Example Street, San Diego, CA 92103", "619-555-0100", "pat@example.test", undefined, undefined]);
    assert.deepEqual(stored.tenants.map((x) => x.name), ["Jordan Rivera", "Sam Rivera"]);
  });

  const start = plusDays(today, 30);
  await t.test("step 3, Rent & term: dates, rent, deposit, late fee, utilities and appliances", async () => {
    await next("Rent & term");
    assert.equal(await caption(), "Step 3 of 6 · Rent & term");
    assert.deepEqual([await field("rent").inputValue(), await field("deposit").inputValue(), await field("dueDay").inputValue()], ["2,850", "2,850", "1"], "the rent on file is filled in");
    await fill("termStart", start);
    assert.equal(await field("end").inputValue(), yearEnd(start), "one year by default");
    assert.equal(await builder.locator('[data-lease="endPreset"][data-ref="12"]').getAttribute("aria-pressed"), "true");
    await click(builder.locator('[data-lease="endPreset"][data-ref="6"]'));
    assert.equal(await field("end").inputValue(), yearEnd(start, 6));
    await fill("end", start);
    assert.equal(await errorOf("end").innerText(), "The end date must be after the start date.");
    await click(builder.locator('[data-lease="endPreset"][data-ref="12"]'));
    assert.equal(await errorOf("end").count(), 0);
    await previewHas("The term starts on " + Law.longDate(start) + " and ends on " + Law.longDate(yearEnd(start)) + ".");
    // Month to month has no end date; switching back brings the date back.
    await check(option("kind", "Month to month"));
    assert.equal(await field("end").count(), 0);
    await check(option("kind", "Fixed term"));
    assert.equal(await field("end").inputValue(), yearEnd(start));

    await fill("rent", "3,200");
    assert.deepEqual([await field("deposit").inputValue(), await field("lateFeeAmount").inputValue()], ["3,200", D.showMoney(D.suggestLate("3200"))], "deposit and late fee follow the rent");
    await builder.locator(".ui-note--info").filter({ hasText: /^First payment: \$/ }).waitFor();
    await fill("rent", "lots");
    assert.equal(await errorOf("rent").innerText(), "Enter an amount like 3,200 or 3,200.50.");
    await fill("rent", "3200");
    await fill("dueDay", "32");
    assert.equal(await errorOf("dueDay").innerText(), "Choose a day from 1 to 28.");
    await fill("dueDay", "1");
    // One way to pay that is neither cash nor electronic always stays.
    await click(option("payMethods", "check"));
    assert.equal(await option("payMethods", "check").isChecked(), true);
    await builder.locator(".ui-note").filter({ hasText: "A check or money order stays on the list." }).waitFor();
    await check(option("payMethods", "moneyorder"));
    await uncheck(option("payMethods", "check"));
    assert.equal(await option("payMethods", "check").isChecked(), false);
    await check(option("payMethods", "check"));
    await uncheck(option("payMethods", "moneyorder"));
    await fill("payDetails", "Zelle to pat@example.test");
    // Taking cash means paying in person, so the days and hours are asked for and required.
    assert.equal(await field("payHours").isVisible(), false, "the hours wait under More options until they matter");
    await check(option("payMethods", "cash"));
    await field("payHours").waitFor();
    assert.match(await builder.locator(".lb-f", { has: page.locator('[data-field="payHours"]') }).innerText(), /^When can the tenant pay in person\?\s+Cash is paid in person, so the lease must give the days and hours\./);
    assert.ok((await page.evaluate(() => Leases.domain.problems(T.draft() ? { ...T.draft(), facts: { ...T.draft().facts, payMethods: "check,zelle,cash", payHours: "" } } : {}, PM.today()))).some((x) => x.field === "payHours"));
    await fill("payHours", "weekdays, 9 a.m. to 5 p.m.");
    await previewHas("or delivered there in person weekdays, 9 a.m. to 5 p.m.");
    await uncheck(option("payMethods", "cash"));
    assert.equal(await field("payHours").isVisible(), false, "without cash the hours go back under More options");
    await click(builder.locator('details[data-more="paying"] > summary'));
    assert.equal(await field("payHours").inputValue(), "weekdays, 9 a.m. to 5 p.m.", "what was typed is kept");
    await fill("payHours", "");
    await previewHas("Payments sent by mail go to the address in the Notices section.");
    // The late fee: the modest suggestion, the plain reason, and a warning when it is large.
    assert.match(await builder.locator(".lb-f", { has: page.locator('input[data-field="lateFee"]') }).innerText(), /California allows only a modest estimate of what a late payment costs you, and courts have struck down larger fees\. Keep it small, and never add it to a pay-or-quit notice\./);
    assert.equal(await field("lateFeeDay").inputValue(), "5");
    await fill("lateFeeAmount", "400");
    const lateWarning = Law.analyze(await page.evaluate(() => T.draft() && { ...T.draft(), facts: { ...T.draft().facts, lateFeeAmount: "400" } }), today).warnings.find((w) => w.id === "lateFee");
    assert.ok(lateWarning, "a large late fee draws a warning");
    await builder.locator(".ui-note--warn").filter({ hasText: lateWarning.message }).waitFor();
    await fill("lateFeeAmount", "65");
    assert.equal(await builder.locator(".ui-note--warn").count(), 0);
    await uncheck(toggle("lateFee"));
    assert.equal(await field("lateFeeAmount").count(), 0);
    await page.waitForFunction(() => !T.preview().includes("late charge of"));
    await check(toggle("lateFee"));
    assert.equal(await field("lateFeeAmount").inputValue(), "65", "turning it back on keeps the amount");
    // The deposit is checked against California’s limit as it is typed.
    assert.match(await builder.locator(".lb-f", { has: page.locator('[data-field="deposit"]') }).locator(".ui-help").innerText(), /one month/i);
    await fill("deposit", "7000");
    const over = await errorOf("deposit").innerText();
    assert.match(over, /\$3,200\.00/, "the limit is named in dollars: " + over);
    assert.equal(await toggle("depositSmallOwner").count(), 1, "the one exception is offered only when it could matter");
    await check(toggle("depositSmallOwner"));
    assert.match(await errorOf("deposit").innerText(), /\$6,400\.00/);
    await fill("deposit", "6400");
    assert.equal(await errorOf("deposit").count(), 0);
    await fill("deposit", "3200");
    assert.equal(await toggle("depositSmallOwner").count(), 0, "the question goes away when the deposit is within one month’s rent; the answer is remembered");
    // Utilities and appliances.
    assert.deepEqual(await builder.locator(".lb-util").evaluateAll((list) => list.map((row) => [row.querySelector(".lb-util-name").textContent, row.querySelector("input:checked")?.value])), [["Electricity", "tenant"], ["Gas", "tenant"], ["Water", "tenant"], ["Sewer", "tenant"], ["Trash and recycling", "landlord"], ["Internet", "tenant"], ["Yard care", "tenant"]], "the usual split for a house");
    await check(option("util_trash", "tenant"));
    await builder.locator(".ui-note").filter({ hasText: "The City bills trash to owners on the property-tax bill" }).waitFor();
    await previewHas(Law.texts.cityUtilityFees, "the City’s utility-charge notice");
    await check(option("util_trash", "landlord"));
    assert.deepEqual(await builder.locator('input[data-field="appliances"]').evaluateAll((list) => list.filter((i) => i.checked).map((i) => [i.value, i.disabled])), [["stove", true], ["refrigerator", false]], "the stove cannot be removed");
    await uncheck(option("appliances", "refrigerator"));
    await builder.locator(".ui-note").filter({ hasText: "The tenant has asked to bring their own refrigerator." }).waitFor();
    await previewHas(Law.texts.fridge, "the refrigerator checkbox California requires");
    await check(option("appliances", "refrigerator"));
    await check(option("appliances", "dishwasher"));
    await noDropdowns("Rent & term");
    await audit("Rent & term step", ".lb", [375, 720, 1280]);
    await saved();
    const f = (await page.evaluate(() => T.draft())).facts;
    assert.deepEqual([f.kind, f.termStart, f.start, f.end, f.rent, f.deposit, f.dueDay, f.lateFee, f.lateFeeAmount, f.lateFeeDay, f.payMethods, f.appliances, f.ownFridge, f.util_trash, f.depositSmallOwner], ["Fixed term", start, start, yearEnd(start), "3200", "3200", "1", "yes", "65", "5", "check,zelle", "stove,refrigerator,dishwasher", "no", "landlord", "yes"]);
  });

  await t.test("step 4, Rules: recommended clauses, their exact wording, and the owner’s own", async () => {
    await next("Rules");
    assert.equal(await caption(), "Step 4 of 6 · Rules");
    const library = globalThis.LeaseClauses.library;
    assert.ok(library.length >= 30, "a real clause library");
    assert.deepEqual(await builder.locator(".lb-part > h3").allInnerTexts(), [...globalThis.LeaseClauses.groups.map((g) => g.title), "Your own clauses"]);
    assert.ok((await builder.locator(".lb-clause .ui-status", { hasText: "Recommended" }).count()) >= 8, "recommended clauses are marked");
    assert.ok((await builder.locator("summary", { hasText: /^More clauses you can add \(\d+\)/ }).count()) >= 2, "optional clauses wait behind one line");
    // A policy: pets.
    await check(option("clause.pets.policy", "approved"));
    await fill("clause.pets.details", "One cat named Miso");
    await previewHas("One cat named Miso");
    const pets = builder.locator('.lb-clause[data-k="clause:pets"]');
    await click(pets.locator("summary", { hasText: "Read the wording" }));
    assert.match(await pets.locator(".lb-wording").innerText(), /One cat named Miso/);
    assert.match(await pets.locator(".lb-wording").innerText(), /service animal or support animal/i, "the wording shown is the wording in the lease");
    // A recommended clause can be switched off, and comes out of the lease.
    const guests = "A guest may stay up to 14 nights in any six-month period.";
    await previewHas(guests);
    await uncheck(toggle("clause.guests"));
    await page.waitForFunction((x) => !T.preview().includes(x), guests);
    await check(toggle("clause.guests"));
    await type(field("clause.guests.nights"), "21");
    await previewHas("A guest may stay up to 21 nights in any six-month period.", "the number the owner typed");
    // An optional clause can be switched on.
    await click(builder.locator('details[data-more="extra:living"] > summary'));
    await check(toggle("clause.quiet"));
    await previewHas("From 10:00 p.m. to 7:00 a.m. Tenant and guests will keep noise low");
    // Find a clause.
    const all = await builder.locator(".lb-clause").count();
    await builder.locator("#lb-find").fill("pets");
    await page.waitForFunction((n) => document.querySelectorAll(".lb-clause").length < n, all);
    assert.ok((await builder.locator(".lb-clause").count()) >= 1);
    await builder.locator("#lb-find").fill("zzzz");
    await builder.locator(".lb-lede", { hasText: "No clause matches “zzzz”. You can write your own below." }).waitFor();
    await builder.locator("#lb-find").fill("");
    await page.waitForFunction((n) => document.querySelectorAll(".lb-clause").length === n, all);
    // The owner’s own clauses, with a warning for wording California does not allow.
    await click(builder.locator('[data-lease="addClause"]'));
    const own = builder.locator(".lb-own");
    await type(own.first().locator('input[name$=":title"]'), "Cleaning");
    await type(own.first().locator("textarea"), "Tenant pays a $300 non-refundable cleaning fee and waives the right to a jury trial.");
    const flags = globalThis.LeaseClauses.redFlags("Cleaning\nTenant pays a $300 non-refundable cleaning fee and waives the right to a jury trial.");
    assert.ok(flags.length >= 2);
    await page.waitForFunction((n) => document.querySelectorAll(".lb-own .ui-note--warn").length === n, flags.length);
    assert.deepEqual(await own.first().locator(".ui-note--warn p:first-child").allInnerTexts(), flags.map((x) => x.message));
    assert.match(await own.first().locator(".ui-note--warn").first().innerText(), /Civil Code § .*You can keep it, but it may not be enforceable\./);
    await type(own.first().locator('input[name$=":title"]'), "Bicycles");
    await type(own.first().locator("textarea"), "Bicycles are stored in the garage, not on the porch.");
    await page.waitForFunction(() => document.querySelectorAll(".lb-own .ui-note--warn").length === 0);
    await previewHas("Bicycles are stored in the garage, not on the porch.");
    assert.ok((await page.evaluate(() => T.headings())).includes("Additional provisions"));
    await click(builder.locator('[data-lease="addClause"]'));
    await type(own.nth(1).locator("textarea"), "Garden beds <A> & <B> are shared with the neighbor.");
    await previewHas("Garden beds <A> & <B> are shared with the neighbor.", "typed symbols appear as typed");
    await click(own.nth(1).locator('[data-lease="clauseUp"]'));
    assert.match(await own.first().locator("textarea").inputValue(), /^Garden beds/);
    await click(own.first().locator('[data-lease="removeClause"]'));
    assert.equal(await own.count(), 1);
    await click(builder.locator(".lb-undo", { hasText: "Clause removed." }).locator('[data-lease="undoClause"]'));
    assert.deepEqual(await own.locator("textarea").evaluateAll((list) => list.map((x) => x.value.slice(0, 12))), ["Garden beds ", "Bicycles are"]);
    await noDropdowns("Rules");
    await audit("Rules step", ".lb", [375, 720, 1280]);
    await saved();
    const stored = await page.evaluate(() => T.draft());
    assert.deepEqual([stored.clauses.pets.opts.policy, stored.clauses.pets.opts.details, stored.clauses.guests.on, stored.clauses.guests.opts.nights, stored.clauses.quiet.on], ["approved", "One cat named Miso", true, "21", true]);
    assert.deepEqual(stored.customClauses.map((x) => [x.title, x.text]), [["", "Garden beds <A> & <B> are shared with the neighbor."], ["Bicycles", "Bicycles are stored in the garage, not on the porch."]]);
  });

  await t.test("step 5, Disclosures: the required notices are added, with a few yes-or-no questions", async () => {
    await next("Disclosures");
    assert.equal(await caption(), "Step 5 of 6 · Disclosures");
    const before = Law.analyze(await page.evaluate(() => T.draft()), today);
    const todo = (i) => i.kind === "todo" || i.state === "attention" || i.state === "reminder";
    const titles = (list) => list.map((i) => i.title);
    assert.deepEqual(await builder.locator(".lb-item .lb-item-text b").allInnerTexts(), titles(before.items.filter((i) => ["included", "attached"].includes(i.state) && !todo(i))), "the list is the one lease-law.js worked out");
    for (const expected of ["Megan’s Law notice", "Bed bug information sheet", "Family daycare notice"]) assert.ok((await builder.locator(".lb-item .lb-item-text b").allInnerTexts()).includes(expected), "includes " + expected);
    // Each one says why, with a link to the law.
    const megan = builder.locator(".lb-item", { hasText: "Megan’s Law notice" });
    await click(megan.locator("summary"));
    assert.match(await megan.locator(".lb-item-body a").getAttribute("href"), /^https:\/\//);
    // A notice that is waiting on an answer says so, and its button goes to the question.
    const waiting = builder.locator(".lb-waiting li");
    assert.deepEqual(await waiting.locator("b").allInnerTexts(), titles(before.items.filter((i) => i.state === "needs-answer")));
    await click(waiting.filter({ hasText: "Flood" }).locator('[data-lease="fix"]'));
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.field), "floodKnown");
    await check(option("floodKnown", "no"));
    await page.waitForFunction(() => ![...document.querySelectorAll(".lb-waiting li b")].some((b) => /flood/i.test(b.textContent)));
    assert.ok((await builder.locator(".lb-item .lb-item-text b").allInnerTexts()).some((x) => /flood/i.test(x)), "once answered, the flood notice is on the included list");
    await previewHas(Law.texts.megan, "the Megan’s Law notice");
    await previewHas(Law.texts.flood[0], "the flood information");
    await previewHas(Law.texts.cityDaycare, "the City’s family daycare notice");
    for (const text of Law.texts.bedbug) await previewHas(text, "bed bug information: " + text.slice(0, 40));
    assert.equal(await option("leadKnown", "no").count(), 0, "no lead questions for a home built in 1999");
    await click(builder.locator("summary", { hasText: "Not needed for this home" }));
    assert.match(await builder.locator(".lb-plain").innerText(), /lead/i);
    // Less common situations: nothing is on, and a language other than English is pills, not a dropdown.
    assert.deepEqual(await builder.locator('[data-k="part:rare"] input[role="switch"]:checked').count(), 0);
    await check(builder.locator('input[name="ui:language"]'));
    assert.deepEqual(await builder.locator('input[data-field="negotiatedLanguage"]').evaluateAll((list) => list.map((i) => [i.value, i.checked])), [["spanish", true], ["chinese", false], ["tagalog", false], ["vietnamese", false], ["korean", false]]);
    await builder.locator(".lb-todo li", { hasText: "Translated copy of the lease" }).waitFor();
    await uncheck(builder.locator('input[name="ui:language"]'));
    await page.waitForFunction(() => ![...document.querySelectorAll(".lb-todo li")].some((li) => li.textContent.includes("Translated copy")));
    await check(option("pestService", "yes"));
    await fill("pestCompany", "Made-up Pest Co.");
    await builder.locator(".lb-todo li.is-due", { hasText: "Pest control company notice" }).waitFor();
    await check(toggle("rareReviewed"));
    assert.equal(await builder.locator(".lb-waiting li").count(), 0, "nothing is left waiting on an answer");
    assert.ok((await builder.locator(".lb-todo li").count()) >= 3, "what the owner must do outside the lease is listed");
    assert.ok((await builder.locator(".lb-todo .ui-status", { hasText: "Not part of the lease" }).count()) >= 1);
    await noDropdowns("Disclosures");
    await audit("Disclosures step", ".lb", [375, 720, 1280]);
    await saved();
    const f = (await page.evaluate(() => T.draft())).facts;
    assert.deepEqual([f.floodKnown, f.rareReviewed, f.negotiatedLanguage, f.pestService, f.pestCompany], ["no", "yes", "english", "yes", "Made-up Pest Co."]);
  });

  let packetId = "";
  await t.test("step 6, Review & sign: one glance, nothing missing, then make it final", async () => {
    await next("Review & sign");
    assert.equal(await caption(), "Step 6 of 6 · Review & sign");
    assert.deepEqual(await builder.locator(".lb-steps li").evaluateAll((list) => list.map((li) => li.className)), ["is-done", "is-done", "is-done", "is-done", "is-done", "is-now"]);
    const glance = Object.fromEntries(await builder.locator(".lb-glance > div").evaluateAll((rows) => rows.map((r) => [r.querySelector("dt").textContent, r.querySelector("dd").textContent])));
    assert.deepEqual([glance.Landlord, glance.Tenants || glance.Tenant, glance.Rent, glance["Security deposit"]], ["Pat Owner", "Jordan Rivera and Sam Rivera", "$3,200.00 a month, due on the 1st", "$3,200.00"]);
    assert.equal(await builder.locator(".lb-blank").count(), 0);
    assert.equal(await builder.locator(".lb-needs li").count(), 0);
    await builder.locator(".ui-note", { hasText: "Everything needed is filled in. Read the lease through once, then confirm below." }).waitFor();
    assert.match(await builder.locator(".lb-gives").innerText(), /Residential Lease Agreement[\s\S]*Information on Dampness and Mold/);
    const finalize = builder.locator('[data-lease="finalize"]');
    assert.equal(await finalize.isDisabled(), true);
    assert.equal(await builder.locator("#lb-finish-hint").innerText(), "Turn on the switch above once you have read the lease.");
    assert.match(await builder.locator(".lb-honest").innerText(), /It is not legal advice\./);
    // The owner’s own attachment.
    await click(builder.locator("summary", { hasText: "Add your own attachments" }));
    const pdf = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await Files.pdf("HOA rules", [{ heading: "Rules", lines: ["Made-up association rules."] }]).arrayBuffer()))));
    await builder.locator("#lb-upload").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a PDF") });
    await page.locator("#toast, [role=alert]").filter({ hasText: "That file is not a real PDF or photo. Choose another file." }).first().waitFor();
    await builder.locator("#lb-upload").setInputFiles({ name: "HOA rules.pdf", mimeType: "application/pdf", buffer: pdf });
    await builder.locator(".lb-gives li", { hasText: "HOA rules.pdf" }).waitFor();
    await toastSays(/Attachment added\./);
    // The draft can be downloaded and is marked as a draft.
    const [download] = await Promise.all([page.waitForEvent("download"), builder.locator('[data-lease="downloadDraft"]').click()]);
    assert.equal(download.suggestedFilename(), "Lease – Jordan Rivera and Sam Rivera (draft).pdf");
    assert.equal(fs.readFileSync(await download.path()).subarray(0, 5).toString(), "%PDF-");
    await noDropdowns("Review & sign");
    await audit("Review step", ".lb", [375, 720, 1280]);
    // On a phone the lease opens full-screen from the Preview button.
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await builder.locator(".lb-preview").isVisible(), false);
    await click(builder.locator('.lb-foot [data-lease="preview"]'));
    const full = builder.locator("dialog.lb-full[open]");
    await full.waitFor();
    assert.match(await full.evaluate((d) => (d.querySelector(".lb-sheet").shadowRoot || d.querySelector(".lb-sheet")).textContent.replace(/\s+/g, " ")), /DRAFT.*Residential Lease Agreement|Residential Lease Agreement/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "the lease fits a phone");
    await page.keyboard.press("Escape");
    await full.waitFor({ state: "detached" }).catch(() => {});
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.lease), "preview", "Escape returns to the Preview button");
    await page.setViewportSize({ width: 1280, height: 900 });

    // Leave and come back: everything is where it was.
    await saved();
    const id = await page.evaluate(() => T.draftId());
    await click(builder.locator(".lb-back"));
    const home = page.locator(".lh");
    await home.waitFor();
    assert.deepEqual(await home.locator(".lh-tenant button").allInnerTexts(), ["Continue lease"]);
    assert.match(await home.locator(".lh-draft").innerText(), /Lease – Jordan Rivera and Sam Rivera\s+Step 6 of 6 · Ready to finalize/);
    await click(home.locator('.lh-tenant [data-lease="lease"]'));
    await builder.waitFor();
    assert.equal(await caption(), "Step 6 of 6 · Review & sign");
    assert.equal(await page.evaluate(() => T.draftId()), id);
    // Changing an answer after confirming asks for the confirmation again.
    await check(builder.locator('input[name="lease:reviewed"]'));
    assert.equal(await finalize.isDisabled(), false);
    assert.equal(await builder.locator("#lb-finish-hint").innerText(), "Finalizing saves this lease as it is now. To change it afterwards, you make a new version.");
    await click(builder.locator('.lb-steps [data-lease="step"][data-ref="2"]'));
    await fill("payDetails", "Zelle to pat@example.test or 619-555-0100");
    await click(builder.locator('.lb-steps [data-lease="step"][data-ref="5"]'));
    assert.equal(await builder.locator('input[name="lease:reviewed"]').isChecked(), false, "a changed lease must be read again");
    assert.equal(await finalize.isDisabled(), true);
    await check(builder.locator('input[name="lease:reviewed"]'));
    const counts = await page.evaluate(() => [PM.records("leasePacket").length, PM.records("tenancy").length]);
    await click(finalize);
    const signing = page.locator(".lp-page");
    await signing.waitFor({ timeout: 20000 });
    await toastSays(/Lease finalized\. Next: give it to your tenant and sign\./);
    assert.equal(await signing.locator("h1").innerText(), "Lease – Jordan Rivera and Sam Rivera");
    assert.equal(await signing.locator(".lp-head .ui-status").innerText(), "Ready to sign");
    const made = await page.evaluate((draftId) => {
      const packet = PM.records("leasePacket").find((p) => p.leaseId === draftId);
      return { packet, hash: location.hash, counts: [PM.records("leasePacket").length, PM.records("tenancy").length], file: PM.get(packet.contractId), draft: PM.get(draftId) };
    }, id);
    packetId = made.packet.id;
    assert.equal(made.hash, "#leases/packet/" + packetId);
    assert.deepEqual(made.counts, [counts[0] + 1, counts[1]], "the lease belongs to the tenant already on file");
    assert.deepEqual([made.packet.mode, made.packet.schema, made.packet.tenancyId, made.packet.lawVersion, made.file.mime, made.draft.finalPacket], ["final", 2, "t-tenancy", Law.version, "application/pdf", packetId]);
    assert.deepEqual(made.packet.signers.map((s) => [s.name, s.role]), [["Pat Owner", "Landlord"], ["Jordan Rivera", "Tenant"], ["Sam Rivera", "Tenant"]]);
    assert.deepEqual([made.packet.facts.rent, made.packet.facts.payDetails, made.packet.clauses.pets.opts.details], ["3200", "Zelle to pat@example.test or 619-555-0100", "One cat named Miso"]);
    assert.deepEqual(made.packet.attachments.map((a) => a.path), ["handouts/Information on Dampness and Mold for Renters in California (state booklet).pdf", "attachments/01-HOA rules.pdf"]);
    assert.equal(made.packet.review.find((r) => r.id === "pest").status, "attention");
    // The finished lease is no longer a draft, and the tenant’s card moves on to signing.
    await click(signing.locator('[data-packet="home"]'));
    await home.waitFor();
    assert.equal(await home.locator(".lh-draft").count(), 0);
    assert.match(await home.locator(".lh-tenant .lh-facts").innerText(), /Ready to sign/);
    assert.deepEqual(await home.locator(".lh-tenant button").allInnerTexts(), ["Finish signing"]);
    // Opening the old draft link goes to the finished lease, not back into the builder.
    await page.evaluate((draftId) => PM.navigate("Leases", "draft/" + draftId), id);
    await signing.waitFor();
    assert.equal(await builder.count(), 0);
    // Home lists the lease as waiting for signatures, one press from its page.
    await page.evaluate(() => PM.navigate("Home"));
    await click(page.locator('.topbar [data-act="attention"]'));
    const waitingRow = page.locator('dialog[open] [data-act="packet"]');
    assert.match(await waitingRow.innerText(), /Lease ready to sign\s+For Jordan Rivera\s+Finish signing/);
    await click(waitingRow);
    await signing.waitFor();
    assert.deepEqual(await page.evaluate(() => [location.hash, Boolean(document.querySelector("dialog[open]"))]), ["#leases/packet/" + packetId, false]);
  });

  await t.test("a covered apartment built before 1978, and Fix buttons that go to the missing answer", async () => {
    await page.evaluate(() => Leases.open("newFor", ""));
    await builder.waitFor();
    assert.equal(await builder.locator("#lb-name").inputValue(), "Lease – 2418 Maple Street", "no tenant yet, so the lease is named for the home");
    // What the owner told us last time is already here.
    assert.deepEqual([await field("zip").inputValue(), await option("unitType", "house").isChecked(), await field("built").inputValue()], ["92104", true, "1999"]);
    await check(option("unitType", "apartment"));
    await check(option("buildingUnits", "5-15"));
    await fill("built", "1972");
    await builder.locator(".lb-result-title").filter({ hasText: "Covered by the rent cap and just-cause rules" }).waitFor();
    await previewHas(Law.texts.cityCovered, "the City’s tenant-protection notice");
    await previewHas(Law.texts.stateCovered, "the state’s rent cap and just cause notice");
    assert.ok(!(await page.evaluate(() => T.preview())).includes(flat(Law.texts.stateExempt)));
    // Straight to Review: what is missing is listed, and each Fix goes to its question.
    await click(builder.locator('.lb-steps [data-lease="step"][data-ref="5"]'));
    assert.equal(await caption(), "Step 6 of 6 · Review & sign");
    const stored = await page.evaluate(() => T.draft());
    const expected = D.problems(D.tidy(JSON.parse(JSON.stringify(stored)), counter()), today);
    assert.ok(expected.length >= 3);
    assert.deepEqual(await builder.locator(".lb-needs li > span").evaluateAll((list) => list.map((s) => s.lastChild.textContent)), expected.map((x) => x.label));
    assert.equal(await builder.locator("#lb-finish-hint").innerText(), expected.length + " things are still needed above.");
    assert.equal(await builder.locator('[data-lease="finalize"]').isDisabled(), true);
    assert.equal(await builder.locator('input[name="lease:reviewed"]').count(), 1);
    assert.deepEqual(await builder.locator(".lb-steps li").evaluateAll((list) => list.filter((li) => li.classList.contains("is-needs")).length > 0), true, "steps with something missing are marked");
    const tenantNeed = expected.find((x) => x.field === "tenants");
    await click(builder.locator('.lb-needs [data-lease="fix"][data-ref="tenants"]'));
    assert.equal(await caption(), "Step 2 of 6 · People");
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.field), "tenants", "the missing box is ready to type in");
    assert.equal(await errorOf("tenants").innerText(), tenantNeed.label);
    assert.equal(await field("landlord").inputValue(), "Pat Owner", "the owner’s details came from the last lease");
    await fill("tenants", "Lee Park");
    assert.equal(await errorOf("tenants").count(), 0);
    assert.equal(await builder.locator("#lb-name").inputValue(), "Lease – Lee Park");
    // A home built before 1978 gets the lead questions and the federal warning.
    await click(builder.locator('.lb-steps [data-lease="step"][data-ref="4"]'));
    await check(option("leadKnown", "yes"));
    await field("leadDetails").waitFor();
    await check(option("leadKnown", "no"));
    await check(option("leadRecords", "no"));
    await previewHas(Law.texts.leadWarning, "the federal Lead Warning Statement");
    assert.ok((await builder.locator(".lb-item .lb-item-text b").allInnerTexts()).includes("San Diego Tenant Protection Guide"));
    await audit("Disclosures step for a covered apartment", ".lb", [375]);
    await saved();
  });

  await t.test("a draft can be deleted and brought back", async () => {
    const id = await page.evaluate(() => T.draftId());
    await click(builder.locator(".lb-back"));
    const home = page.locator(".lh");
    await home.waitFor();
    const row = home.locator('.lh-draft[data-draft="' + id + '"]');
    assert.match(await row.innerText(), /^Lease – Lee Park\s+Step 5 of 6 · \d+ things? left/);
    await click(row.locator('[data-lease="deleteDraft"]'));
    await toastSays(/Draft deleted\./);
    assert.equal(await row.count(), 0);
    assert.equal(await page.evaluate((x) => PM.records("lease").some((l) => l.id === x), id), false);
    await click(home.locator(".lh-undo", { hasText: "“Lease – Lee Park” was deleted." }).locator('[data-lease="undoDelete"]'));
    await toastSays(/Draft restored\./);
    await row.waitFor();
    assert.equal(await page.evaluate((x) => PM.get(x).facts.built, id), "1972", "nothing typed was lost");
    await click(row.locator('[data-lease="deleteDraft"]'));
    await toastSays(/Draft deleted\./);
    await audit("Leases home with a lease ready to sign", ".lh", [375]);
  });

  await t.test("leaving after a save has failed keeps what was typed, and opening the lease brings it back", async () => {
    await page.evaluate(() => Leases.open("newFor", ""));
    await builder.waitFor();
    await saved();
    const id = await page.evaluate(() => T.draftId());
    // A switch that only shows more fields must not stop later answers from being saved.
    await click(builder.locator("summary", { hasText: "More about the home" }));
    await check(toggle("furnished"));
    await uncheck(toggle("furnished"));
    await fill("unit", "7");
    await saved();
    assert.equal(await page.evaluate((x) => PM.get(x).facts.unit, id), "7");
    // The device stops saving.
    await page.evaluate(() => {
      window.__save = PM.save;
      PM.save = async (type, record) => {
        if (type === "lease") throw new DOMException("The device is full.", "QuotaExceededError");
        return window.__save(type, record);
      };
    });
    await fill("unit", "9");
    await builder.locator(".lb-status-bad").waitFor();
    assert.match(await builder.locator(".lb-alert").innerText(), /^Not saved: This device is out of space for the app\. Free some space, then try again\. What you typed is still here\.\s+Try again$/);
    // Leaving through the main menu cannot save either. The answers are kept, and the owner is told.
    await page.evaluate(() => PM.navigate("Home"));
    await toastSays(/could not be saved\. Open the lease again to get them back\./);
    assert.equal(await page.evaluate((x) => PM.get(x).facts.unit, id), "7", "the saved copy is the older one");
    await page.evaluate(() => {
      PM.save = window.__save;
    });
    await page.evaluate((x) => Leases.open("lease", x), id);
    await builder.waitFor();
    await toastSays(/Your last changes to this lease had not been saved\. They are back on the screen\./);
    assert.equal(await field("unit").inputValue(), "9");
    await saved();
    assert.equal(await page.evaluate((x) => PM.get(x).facts.unit, id), "9", "and now they are saved");
    await click(builder.locator(".lb-back"));
    await page.locator(".lh").waitFor();
    await click(page.locator('.lh-draft[data-draft="' + id + '"] [data-lease="deleteDraft"]'));
    await toastSays(/Draft deleted\./);
  });

  await t.test("a draft from the earlier lease tool opens in the new builder with its answers", async () => {
    const id = await page.evaluate(async () => {
      const lease = await PM.save("lease", { id: PM.uid(), propertyId: PM.prop().id, tenancyId: "", name: "Residential lease", step: 3, reviewedInputs: true, attachments: [], customClauses: [{ id: PM.uid(), title: "Bicycles", text: "Bicycles go in room B." }], package: { format: "pm-legal-1", version: "CA-2026.11.18.2", rules: [] }, facts: { premises: "184 Juniper Lane", city: "San Diego", jurisdiction: "City of San Diego", propertyType: "Duplex", ownerType: "Natural person", ownerOccupied: "No", built: "1988", landlord: "Alex Example", adults: "Robin Example", kind: "Fixed term", rent: "1800", deposit: "1800", dueDay: "1", pets: "One cat named Miso" } });
      Leases.open("lease", lease.id);
      return lease.id;
    });
    await builder.waitFor();
    await toastSays(/This draft came from the earlier lease tool\. Your answers were carried over\. Check each step\./);
    assert.equal(await caption(), "Step 1 of 6 · Home");
    assert.equal(await builder.locator("#lb-name").inputValue(), "Lease – Robin Example");
    assert.deepEqual([await field("premises").inputValue(), await option("unitType", "apartment").isChecked(), await option("buildingUnits", "2").isChecked(), await option("ownerOnSite", "no").isChecked(), await field("built").inputValue()], ["184 Juniper Lane", true, true, true, "1988"]);
    await previewHas("One cat named Miso", "the earlier pet note, now a clause the owner can see");
    await page.waitForFunction((x) => PM.get(x).schema === 2, id);
    const stored = await page.evaluate((x) => PM.get(x), id);
    assert.deepEqual([stored.facts.landlord, stored.facts.rent, stored.reviewedInputs, stored.lawVersion], ["Alex Example", "1800", false, Law.version]);
    assert.deepEqual(stored.customClauses.map((c) => c.title), ["Bicycles", "Pets"]);
    await page.evaluate(() => LeasePackets.validateImport(PM.all()));
  });

  await t.test("renewing and amending start from the finished lease", async () => {
    await page.evaluate((id) => Leases.open("renew", id), packetId);
    await builder.locator("#lb-step-title").filter({ hasText: "Rent & term" }).waitFor();
    assert.equal(await caption(), "Step 3 of 6 · Rent & term");
    assert.equal(await builder.locator("#lb-name").inputValue(), "Lease renewal – Jordan Rivera and Sam Rivera");
    assert.match(await builder.locator(".lb-fixed").innerText(), /Lease type\s+Renewal of the current lease/);
    const nextStart = plusDays(yearEnd(start), 1);
    assert.deepEqual([await field("start").inputValue(), await field("termStart").inputValue(), await field("end").inputValue(), await field("rent").inputValue()], [start, nextStart, yearEnd(nextStart), "3,200"]);
    await previewHas("Lease Renewal");
    await previewHas("One cat named Miso", "the clauses carry over");
    // The deposit is the one the owner already holds: it is labelled that way and does not follow a new rent.
    assert.match(await builder.locator(".lb-f", { has: page.locator('[data-field="deposit"]') }).innerText(), /^Security deposit you hold\s+The deposit your tenant paid under the earlier lease\./);
    await fill("rent", "3,350");
    assert.deepEqual([await field("rent").inputValue(), await field("deposit").inputValue()], ["3,350", "3,200"]);
    await previewHas("Landlord holds a security deposit of $3,200.00 that Tenant paid under the earlier lease.");
    assert.ok(!(await page.evaluate(() => T.preview())).includes("Due before Tenant moves in"));
    await fill("rent", "3,200");
    await audit("renewal", ".lb", [375]);
    await saved();
    const renewal = await page.evaluate(() => T.draft());
    assert.deepEqual([renewal.parentPacket, renewal.origin, renewal.facts.kind, renewal.tenancyId, renewal.reviewedInputs], [packetId, "renew", "Renewal", "t-tenancy", false]);
    // Asking again continues the same draft instead of starting another.
    await page.evaluate((id) => Leases.open("renew", id), packetId);
    assert.equal(await page.evaluate(() => PM.records("lease").filter((l) => l.origin === "renew").length), 1);

    await page.evaluate((id) => Leases.open("amend", id), packetId);
    await builder.locator("#lb-step-title").filter({ hasText: "What changes" }).waitFor();
    assert.equal(await caption(), "Step 3 of 4 · What changes");
    assert.deepEqual(await builder.locator(".lb-steps .lb-step-label").allTextContents(), ["Home", "People", "What changes", "Review & sign"]);
    assert.match(await builder.locator(".ui-note").first().innerText(), /This changes the lease “Lease – Jordan Rivera and Sam Rivera”/);
    await fill("changeText", "Starting on the date below, the monthly rent is $3,350.00.");
    await fill("termStart", plusDays(today, 45));
    await previewHas("Starting on the date below, the monthly rent is $3,350.00.");
    await next("Review & sign");
    assert.equal(await caption(), "Step 4 of 4 · Review & sign");
    assert.equal(await builder.locator(".lb-needs li").count(), 0);
    assert.match(await builder.locator(".lb-gives").innerText(), /Lease Amendment\s+One page, signed by you and the tenant\./);
    await audit("amendment", ".lb", [375]);
    await check(builder.locator('input[name="lease:reviewed"]'));
    await click(builder.locator('[data-lease="finalize"]'));
    const signing = page.locator(".lp-page");
    await signing.waitFor({ timeout: 20000 });
    assert.match(await signing.locator(".lp-sub").innerText(), /^Lease Amendment · /);
    const amendment = await page.evaluate(() => PM.records("leasePacket").find((p) => p.facts.kind === "Amendment"));
    assert.deepEqual([amendment.parentPacket, amendment.attachments, amendment.signers.length], [packetId, [], 3]);
    await page.evaluate(() => {
      LeasePackets.validateImport(PM.all());
      Leases.validateImport(PM.all());
    });
  });

  assert.deepEqual(pageErrors, [], "no errors on the page");
});
