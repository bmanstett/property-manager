"use strict";
// Legal classification and required-notice selection. Facts are fictional.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("./lease-law.js");
const L = globalThis.LeaseLaw;
const TODAY = "2026-11-18";
const complete = {
  state: "CA", agreementDate: TODAY, kind: "Fixed term", termStart: "2026-12-01", end: "2027-11-30",
  rent: "3200", deposit: "3200", landlord: "Pat Owner", noticeAddress: "1 Example St, San Diego, CA 92101",
  noticePhone: "619-555-0100", payMethods: "check,zelle", floodKnown: "no", rareReviewed: "yes",
  unitType: "house", inCity: "yes", ownerKind: "people", built: "1985", otherUnitOnLot: "no",
};
const analyze = (facts = {}) => L.analyze({ facts: { ...complete, ...facts } }, TODAY);
const coverage = (facts) => analyze(facts).coverage;
const item = (facts, id) => analyze(facts).items.find((x) => x.id === id);

test("statutory wording is frozen and unchanged", () => {
  // SHA-256 of each prescribed text as read from the official publisher on the review date.
  const digest = (v) => createHash("sha256").update(Array.isArray(v) ? v.join("\n") : v).digest("hex").slice(0, 16);
  assert.ok(Object.isFrozen(L.texts) && Object.isFrozen(L.texts.bedbug));
  assert.match(L.texts.stateCovered, /^California law limits the amount your rent can be increased\. See Section 1947\.12 of the Civil Code/);
  assert.match(L.texts.stateCovered, /12 months or more or at least one of the tenants has continuously and lawfully occupied the property for 24 months or more, a landlord must provide a statement of cause in any notice to terminate a tenancy\. See Section 1946\.2 of the Civil Code for more information\.$/);
  assert.match(L.texts.stateExempt, /meets the requirements of Sections 1947\.12 \(d\)\(5\) and 1946\.2 \(e\)\(8\) of the Civil Code/);
  assert.match(L.texts.stateExempt, /\(3\) a limited liability company in which at least one member is a corporation\.$/);
  assert.match(L.texts.cityCovered, /See California Civil Code section 1947\.12 for more information\. Local law also provides that a landlord shall provide a statement of cause in any notice to terminate a tenancy\./);
  assert.match(L.texts.cityCovered, /seniors \(62 years or older\) or disabled .* See Chapter 9, Article 8, Division 7 of the San Diego Municipal Code for more information\.$/);
  assert.match(L.texts.cityExempt, /meets the requirements of San Diego Municipal Code section 98\.0703\(l\)/);
  assert.match(L.texts.cityExempt, /\(4\) management of a mobilehome park, as defined in California Civil Code section 798\.2\.$/);
  assert.match(L.texts.megan, /www\.meganslaw\.ca\.gov\. Depending on an offender’s criminal history.*ZIP Code in which the offender resides\.$/);
  assert.match(L.texts.leadWarning, /lessors must disclose the presence of known lead-based paint and\/or lead-based paint hazards in the dwelling\./);
  assert.match(L.texts.fridge, /^Under state law, the landlord is required to provide a refrigerator in good working order in your unit\. By checking this box/);
  assert.match(L.texts.cityDaycare, /^Use of this rental property as a family daycare home is protected by state law in California Health and Safety Code sections 1597.30 – 1597.622./);
  assert.match(L.texts.cityUtilityFees, /^Equitable Fees and Right to Notice: The City of San Diego allows landlords to charge you a utility fee/);
  assert.equal(L.texts.bedbug.length, 10);
  assert.equal(L.texts.bedbug.filter((line) => line.startsWith("•")).length, 4);
  assert.ok(L.texts.flood.some((line) => line.includes("https://myhazards.caloes.ca.gov/")));
  // A change to any prescribed text must be deliberate: update these digests only after re-reading the source.
  assert.deepEqual(
    Object.fromEntries(["stateCovered", "stateExempt", "cityCovered", "cityExempt", "cityDaycare", "cityUtilityFees", "creditNotice", "megan", "bedbug", "fridge", "leadWarning"].map((k) => [k, digest(L.texts[k])])),
    JSON.parse(fs.readFileSync(path.join(__dirname, "lease-law-texts.json"), "utf8")),
  );
});

test("a house or condo owned by people is exempt only through the exemption statements", () => {
  const house = coverage();
  assert.deepEqual([house.row, house.cap, house.cause, house.city], ["separate", "exempt", "exempt", "exempt"]);
  assert.deepEqual(house.notices, ["stateExempt", "cityExempt"]);
  assert.equal(house.guide, false);
  assert.deepEqual(coverage({ unitType: "condo", ownerKind: "llc", inCity: "no", otherUnitOnLot: "" }).notices, ["stateExempt"]);
  // A corporate owner, or a second unit on the lot, loses the single-home exemption.
  for (const change of [{ ownerKind: "corp" }, { otherUnitOnLot: "yes" }]) {
    const c = coverage(change);
    assert.deepEqual([c.row, c.cap, c.cause, c.city], ["covered", "applies", "applies", "applies"]);
    assert.deepEqual(c.notices, ["cityCovered", "stateCovered"]);
    assert.equal(c.guide, true);
  }
});

test("covered homes get both notices and the City guide inside San Diego, the state notice outside", () => {
  const apartment = { unitType: "apartment", buildingUnits: "5-15", built: "1990" };
  assert.ok(analyze(apartment).attachments.some((a) => a.id === "guide"));
  const outside = analyze({ ...apartment, inCity: "no" });
  assert.deepEqual(outside.coverage.notices, ["stateCovered"]);
  assert.equal(outside.coverage.city, "outside");
  assert.ok(!outside.attachments.some((a) => a.id === "guide"));
  assert.ok(outside.warnings.some((w) => w.id === "outsideCity"));
  // A fixed term of three months or less is not a "tenancy" under SDMC § 98.0702 while it lasts, but it becomes one
  // if the tenant stays on, so the City notice and Guide are still given and the result says why.
  const short = coverage({ ...apartment, termStart: "2026-12-01", end: "2027-02-15" });
  assert.deepEqual([short.city, short.shortTerm, short.notices, short.guide], ["applies", true, ["cityCovered", "stateCovered"], true]);
  assert.match(short.reason, /if the tenant stays on after this short term\. A fixed term of three months or less is outside the City ordinance while it lasts\./);
  assert.ok(!/from the first day/.test(short.reason), "the result does not contradict itself");
  const usual = coverage({ ...apartment, termStart: "2026-12-01", end: "2027-03-01" });
  assert.deepEqual([usual.city, usual.shortTerm], ["applies", false]);
  assert.match(usual.reason, /from the first day under San Diego’s ordinance\.$/);
  assert.equal(coverage({ ...apartment, inCity: "no", termStart: "2026-12-01", end: "2027-02-15" }).shortTerm, false);
});

test("fifteen-year, duplex and owner-occupied rules", () => {
  // Without the certificate date the 15 years run from January 1 of the build year: the exemption is never stretched.
  assert.deepEqual([coverage({ built: "2011", ownerKind: "corp" }).row, coverage({ built: "2011", ownerKind: "corp" }).turns15], ["covered", ""]);
  const dated = analyze({ built: "2011", cofo: "2011-12-15", ownerKind: "corp" });
  assert.deepEqual([dated.coverage.row, dated.coverage.turns15], ["new", "2026-12-15"], "the date on the certificate decides");
  assert.ok(dated.coverage.statement.includes("within the previous 15 years"));
  assert.ok(dated.warnings.some((w) => w.id === "turns15"));
  const young = coverage({ built: "2012", ownerKind: "corp" });
  assert.deepEqual([young.row, young.turns15], ["new", "2027-01-01"]);
  assert.match(young.reason, /Without the date on the certificate, the 15 years are counted from January 1, 2012\./);
  assert.equal(coverage({ built: "2011", cofo: "2011-03-01", ownerKind: "corp" }).row, "covered");
  assert.equal(coverage({ built: "2010", ownerKind: "corp" }).row, "covered");
  // A month-to-month tenancy has no end date, so it is warned when the home turns 15 within two years.
  const open = { unitType: "apartment", buildingUnits: "5-15", kind: "Month to month", end: "" };
  assert.match(analyze({ ...open, built: "2012", cofo: "2012-03-01" }).warnings.find((w) => w.id === "turns15").message, /March 1, 2027, during the tenancy\./);
  assert.ok(!analyze({ ...open, built: "2020" }).warnings.some((w) => w.id === "turns15"), "no warning about a date many years away");
  // A new house owned by people gets the lasting exemption and its statements, not the one that ends at 15 years.
  const newHouse = analyze({ built: "2012", cofo: "2012-03-01" });
  assert.deepEqual([newHouse.coverage.row, newHouse.coverage.notices, newHouse.coverage.turns15], ["separate", ["stateExempt", "cityExempt"], ""]);
  assert.ok(!newHouse.warnings.some((w) => w.id === "turns15"));
  assert.equal(coverage({ built: "2012", otherUnitOnLot: "yes" }).row, "new", "a house that shares its lot relies on its age");
  const duplex = { unitType: "apartment", buildingUnits: "2", built: "1970" };
  assert.equal(coverage({ ...duplex, ownerOnSite: "yes" }).row, "duplex");
  assert.equal(coverage({ ...duplex, ownerOnSite: "no" }).row, "covered");
  assert.equal(coverage({ unitType: "apartment", buildingUnits: "3-4", ownerOnSite: "yes", built: "1970" }).row, "covered");
  // An ADU behind the owner's home: rent cap applies; just cause does not, if the owner rents out no more than two.
  const adu = coverage({ unitType: "adu", ownerOnSite: "yes", ownerRentsMore: "no", built: "2000" });
  assert.deepEqual([adu.row, adu.cap, adu.cause, adu.city, adu.notices], ["ownerHome", "applies", "exempt", "exempt", []]);
  assert.match(adu.statement, /rent limits of California Civil Code section 1947\.12 apply/);
  assert.match(adu.statement, /rents no more than two units or bedrooms there/);
  const unasked = analyze({ unitType: "adu", ownerOnSite: "yes", built: "2000" });
  assert.deepEqual([unasked.coverage.known, unasked.coverage.need], [false, ["ownerRentsMore"]], "the two-unit limit is asked, never assumed");
  assert.equal(unasked.blockers.find((b) => b.field === "ownerRentsMore").message, "Say whether you rent out more than two units or bedrooms on the property.");
  const many = coverage({ unitType: "adu", ownerOnSite: "yes", ownerRentsMore: "yes", built: "2000" });
  assert.deepEqual([many.row, many.cause, many.notices], ["covered", "applies", ["cityCovered", "stateCovered"]]);
  assert.match(many.reason, /more than two units or bedrooms/);
  assert.equal(coverage({ unitType: "adu", ownerOnSite: "no", built: "2000" }).row, "covered");
  assert.equal(coverage({ unitType: "adu", ownerOnSite: "yes", built: "2022" }).row, "new");
  // A room in the owner's home, on a lot with another unit: sharing the kitchen or bathroom is asked, not assumed.
  const room = { unitType: "room", otherUnitOnLot: "yes", ownerOnSite: "yes", built: "1970" };
  assert.deepEqual(coverage(room).need, ["sharedKitchenBath"]);
  const sharing = coverage({ ...room, sharedKitchenBath: "yes" });
  assert.equal(sharing.row, "ownerHome");
  assert.match(sharing.statement, /Tenant shares kitchen or bathroom facilities with Landlord/);
  assert.deepEqual(coverage({ ...room, sharedKitchenBath: "no" }).need, ["ownerRentsMore"]);
  const separateRoom = coverage({ ...room, sharedKitchenBath: "no", ownerRentsMore: "no" });
  assert.equal(separateRoom.row, "ownerHome");
  assert.ok(!/shares kitchen/.test(separateRoom.statement));
  assert.equal(coverage({ ...room, sharedKitchenBath: "no", ownerRentsMore: "yes" }).row, "covered");
  assert.equal(coverage({ unitType: "room", otherUnitOnLot: "no", ownerOnSite: "yes", built: "1970" }).row, "separate", "a room in a single home owned by people needs neither answer");
});

test("unanswered facts block instead of guessing, and overrides are explicit", () => {
  const blank = L.analyze({ facts: {} }, TODAY);
  assert.equal(blank.coverage.known, false);
  for (const field of ["unitType", "inCity", "ownerKind", "built", "landlord", "noticeAddress", "noticePhone", "payMethods", "floodKnown", "rareReviewed"])
    assert.ok(blank.blockers.some((b) => b.field === field), field);
  assert.equal(coverage({ built: "2999" }).known, false);
  assert.equal(coverage({ unitType: "apartment" }).known, false);
  const forced = coverage({ ownerKind: "corp", coverageOverride: "exempt" });
  assert.equal(forced.row, "covered", "a corporate owner can never claim the single-home exemption");
  const manual = analyze({ otherUnitOnLot: "yes", coverageOverride: "exempt" });
  assert.equal(manual.coverage.row, "override-exempt");
  assert.equal(manual.items.find((x) => x.id === "tenantProtections").state, "attention");
  assert.equal(coverage({ coverageOverride: "covered" }).row, "override-covered");
});

test("deposit limit, payment method and late-fee checks", () => {
  assert.equal(analyze().blockers.length, 0);
  assert.ok(analyze({ deposit: "3200.01" }).blockers.some((b) => b.field === "deposit"));
  assert.deepEqual([L.depositLimit({ facts: { rent: "3200" } }).months, L.depositLimit({ facts: { rent: "3200" } }).max], [1, 3200]);
  const small = { deposit: "6400", depositSmallOwner: "yes" };
  assert.equal(analyze(small).blockers.length, 0);
  assert.ok(analyze({ ...small, service: "yes" }).blockers.some((b) => b.field === "deposit"));
  assert.ok(analyze({ ...small, ownerKind: "corp" }).blockers.some((b) => b.field === "deposit"));
  assert.ok(analyze({ deposit: "6400.01", depositSmallOwner: "yes" }).blockers.some((b) => b.field === "deposit"));
  assert.ok(analyze({ payMethods: "zelle,cash" }).blockers.some((b) => b.field === "payMethods"));
  assert.equal(item({ payMethods: "moneyorder" }, "payment").state, "included");
  assert.ok(analyze({ lateFee: "yes", lateFeeAmount: "250" }).warnings.some((w) => w.id === "lateFee"));
  assert.ok(!analyze({ lateFee: "yes", lateFeeAmount: "100" }).warnings.some((w) => w.id === "lateFee"));
});

test("disclosures follow the home's facts", () => {
  assert.equal(item({}, "lead").state, "not-needed");
  const old = analyze({ built: "1977" });
  assert.equal(old.items.find((x) => x.id === "lead").state, "needs-answer");
  assert.ok(old.attachments.some((a) => a.id === "lead"));
  assert.ok(old.blockers.some((b) => b.field === "leadKnown") && old.blockers.some((b) => b.field === "leadRecords"));
  assert.equal(item({ built: "1977", leadKnown: "no", leadRecords: "no" }, "lead").state, "included");
  assert.ok(analyze({ built: "1977", leadKnown: "yes", leadRecords: "no" }).blockers.some((b) => b.field === "leadDetails"));
  assert.equal(item({ built: "1978" }, "lead").state, "not-needed");
  assert.equal(item({ floodKnown: "" }, "flood").state, "needs-answer");
  assert.equal(item({ floodKnown: "yes" }, "flood").state, "included");
  for (const id of ["megan", "bedbugs", "appliances", "entry", "copy", "photos"]) assert.equal(item({}, id).state, "included", id);
  assert.equal(item({}, "petPolicy").state, "reminder");
  assert.equal(item({ ownerPesticide: "yes" }, "ownerPesticide").state, "attention");
  assert.ok(analyze().attachments.some((a) => a.id === "mold" && a.giveBeforeSigning));
  for (const [fact, id] of [["pestService", "pest"], ["deathRecent", "death"], ["ordnance", "ordnance"], ["contamination", "contamination"], ["waterSubmeter", "waterSubmeter"], ["section8", "section8"]]) {
    assert.ok(item({ [fact]: "yes" }, id), id);
    assert.equal(item({ [fact]: "no" }, id), undefined, id);
  }
  assert.ok(analyze({ sharedMeter: "yes" }).blockers.some((b) => b.field === "sharedMeterDetails"));
  assert.equal(item({ sharedMeter: "yes", sharedMeterDetails: "Meter also powers the shared laundry light; Landlord credits $10 a month." }, "sharedMeter").state, "included");
  assert.ok(item({ buildingUnits: "16+", unitType: "apartment" }, "rentReporting"));
  assert.equal(item({}, "rentReporting"), undefined);
  assert.ok(item({ negotiatedLanguage: "spanish" }, "language"));
  // An amendment is a short change document: no notices or handouts are regenerated.
  const amendment = analyze({ kind: "Amendment" });
  assert.deepEqual([amendment.attachments.length, amendment.items.map((x) => x.id)], [0, ["contacts"]]);
});

test("City of San Diego texts follow the home's location and who pays the City bills", () => {
  assert.equal(item({}, "daycare").state, "included");
  assert.equal(item({ inCity: "no" }, "daycare"), undefined);
  assert.equal(item({}, "utilityFees"), undefined);
  // The City bills trash to the owner, so a tenant who pays for trash is reimbursing the landlord.
  assert.deepEqual(L.cityBilled({ inCity: "yes", util_trash: "tenant", util_water: "tenant" }), ["trash and recycling"]);
  assert.deepEqual(L.cityBilled({ inCity: "yes", util_trash: "landlord", util_water: "tenant", util_sewer: "tenant", utilityBilling: "yes" }), ["water", "sewer"]);
  assert.deepEqual(L.cityBilled({ inCity: "no", util_trash: "tenant", utilityBilling: "yes", util_water: "tenant" }), []);
  assert.equal(item({ util_trash: "tenant" }, "utilityFees").state, "included");
  assert.equal(item({}, "rentalTax").state, "reminder");
  assert.equal(item({ built: "1960", leadKnown: "no", leadRecords: "no" }, "leadInspection").state, "reminder");
  assert.equal(item({}, "leadInspection"), undefined);
  assert.equal(item({ inCity: "no" }, "rentalTax"), undefined);
});

test("bundled handouts match their registered bytes and every source link is official", () => {
  for (const handout of Object.values(L.handouts)) {
    const bytes = fs.readFileSync(path.join(__dirname, handout.path));
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), handout.hash, handout.path);
  }
  const hosts = ["leginfo.legislature.ca.gov", "docs.sandiego.gov", "www.sandiego.gov", "www.ecfr.gov", "www.hud.gov"];
  for (const s of L.sources) assert.ok(hosts.includes(new URL(s.url).hostname) && s.url.startsWith("https://"), s.url);
  for (const i of analyze({ built: "1970", leadKnown: "no", leadRecords: "no", pestService: "yes", section8: "yes" }).items)
    assert.ok(hosts.includes(new URL(i.url).hostname), i.id + " " + i.url);
});
