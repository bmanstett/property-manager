"use strict";
// The generated lease: required content per situation, print sizes, clause library and wording guards.
// People and addresses are fictional.
const test = require("node:test");
const assert = require("node:assert/strict");
for (const file of ["pdf-font.js", "export.js", "lease-law.js", "lease-clauses.js", "lease-document.js"]) require("./" + file);
const L = globalThis.LeaseLaw,
  C = globalThis.LeaseClauses,
  D = globalThis.LeaseDocument;
const TODAY = "2026-11-18";
const base = {
  state: "CA", agreementDate: TODAY, kind: "Fixed term", termStart: "2026-12-15", end: "2027-12-14", rent: "3200", dueDay: "1",
  deposit: "3200", landlord: "Pat Owner", noticeAddress: "410 Example Street, San Diego, CA 92103", noticePhone: "619-555-0100",
  payMethods: "check,zelle", floodKnown: "no", rareReviewed: "yes", inCity: "yes", city: "San Diego", zip: "92101",
  lateFee: "yes", lateFeeAmount: "75", lateFeeDay: "5", util_electric: "tenant", util_gas: "tenant", util_water: "landlord",
  util_sewer: "landlord", util_trash: "landlord", util_internet: "tenant", appliances: "stove,refrigerator,dishwasher",
};
const apartment = (facts = {}, more = {}) => ({
  facts: { ...base, unitType: "apartment", buildingUnits: "5-15", ownerKind: "people", built: "1972", premises: "184 Juniper Lane", unit: "3", leadKnown: "no", leadRecords: "no", ...facts },
  tenants: [{ id: "a", name: "Avery Morgan", email: "avery@example.test" }, { id: "b", name: "Sam Lee" }],
  clauses: {}, customClauses: [], ...more,
});
const house = (facts = {}, more = {}) => ({
  facts: { ...base, unitType: "house", otherUnitOnLot: "no", ownerKind: "people", built: "1999", premises: "2418 Maple Street", ...facts },
  tenants: [{ id: "a", name: "Jordan Rivera" }], clauses: {}, customClauses: [], ...more,
});
const build = (lease, draft = false) => D.build(lease, { draft, today: TODAY });
const textOf = (b) => [b.text, b.sub, b.heading, (b.runs || []).map((r) => r.text).join(""), ...(b.paras || []), ...(b.rows || []).flat(), ...(b.parties || []).map((p) => p.role + " " + p.name)].filter(Boolean).join(" ");
const flat = (doc) => doc.blocks.map(textOf).join("\n");
const notices = (doc) => doc.blocks.filter((b) => b.t === "notice");
const noticeWith = (doc, text) => notices(doc).find((n) => n.paras.includes(text));

test("a covered apartment built before 1978 inside the City carries every required notice", () => {
  const lease = apartment();
  assert.deepEqual(D.missing(lease, TODAY), []);
  const doc = build(lease),
    all = flat(doc);
  assert.equal(doc.title, "Residential Lease Agreement");
  assert.equal(doc.watermark, "");
  for (const key of ["cityCovered", "stateCovered", "cityDaycare"]) assert.ok(noticeWith(doc, L.texts[key]).size >= 12, key + " is printed at 12 points or larger");
  assert.equal(noticeWith(doc, L.texts.stateExempt), undefined);
  assert.equal(noticeWith(doc, L.texts.cityExempt), undefined);
  assert.ok(all.includes(L.texts.megan));
  for (const line of L.texts.flood) assert.ok(all.includes(line));
  assert.ok(!all.includes(L.texts.floodKnown));
  const bedbugs = notices(doc).find((n) => n.heading === L.texts.bedbugTitle);
  assert.ok(bedbugs.size >= 10);
  assert.deepEqual(bedbugs.paras, [...L.texts.bedbug]);
  assert.ok(noticeWith(doc, L.texts.leadWarning));
  assert.ok(all.includes("Landlord has no knowledge of lead-based paint"));
  assert.ok(all.includes("Tenant has received the pamphlet “Protect Your Family From Lead in Your Home.”"));
  assert.ok(all.includes("City of San Diego Tenant Protection Guide is attached"));
  assert.match(all, /Landlord may terminate this Lease if the owner unilaterally decides to occupy the home/);
  assert.match(all, /Within 21 calendar days after Tenant moves out/);
  assert.match(all, /Twenty-four hours’ notice is presumed reasonable, or six days if the notice is mailed/);
  assert.match(all, /Telephone: 619-555-0100\. Street address where papers can be delivered in person: 410 Example Street/);
  assert.match(all, /copy of the signed Lease within 15 days/);
  // Two signature blocks: the lease and the lead disclosure, each with the landlord and both tenants.
  const signs = doc.blocks.filter((b) => b.t === "sign");
  assert.equal(signs.length, 2);
  for (const s of signs) assert.deepEqual(s.parties.map((p) => p.role), ["Landlord", "Tenant", "Tenant"]);
  assert.ok(doc.blocks.some((b) => b.t === "h1" && b.breakBefore && b.text.includes("Bed Bugs")));
  // Sections are numbered 1..n with no gaps and nothing is left as a placeholder.
  const numbers = doc.blocks.filter((b) => b.t === "h2").map((b) => Number(b.text.split(".")[0]));
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1));
  assert.ok(numbers.length >= 24);
  assert.doesNotMatch(all, /\[[^\]]+\]|undefined|NaN|null/);
});

test("an exempt house prints both exemption statements and nothing that says it is covered", () => {
  const lease = house({ kind: "Month to month", end: "", termStart: "2026-12-01", ownFridge: "yes", util_trash: "tenant", util_yard: "tenant", floodKnown: "yes" });
  assert.deepEqual(D.missing(lease, TODAY), []);
  const doc = build(lease, true),
    all = flat(doc);
  assert.equal(doc.title, "Month-to-Month Rental Agreement");
  assert.equal(doc.watermark, "DRAFT");
  for (const key of ["stateExempt", "cityExempt", "cityDaycare"]) assert.ok(noticeWith(doc, L.texts[key]).size >= 12, key);
  for (const key of ["stateCovered", "cityCovered"]) assert.equal(noticeWith(doc, L.texts[key]), undefined, key);
  assert.ok(!all.includes("Tenant Protection Guide"));
  assert.ok(!all.includes("owner unilaterally decides"), "the owner move-in clause is only for covered homes");
  assert.ok(!all.includes(L.texts.leadWarning) && !all.includes("Lead-Based Paint"));
  assert.ok(all.includes(L.texts.floodKnown));
  // The tenant-supplied refrigerator election is an unchecked box with the statutory sentence and the 30-day reversal.
  const box = doc.blocks.find((b) => b.t === "check" && b.text === L.texts.fridge);
  assert.equal(box.checked, false);
  assert.match(all, /30 days’ written notice that Tenant no longer wishes to keep it/);
  assert.match(all, /Landlord provides these appliances and will keep them in good working order: stove and dishwasher\./);
  // Trash inside the City is billed to the owner, so "tenant pays" prints the City's utility-fee notice.
  assert.ok(noticeWith(doc, L.texts.cityUtilityFees).size >= 12);
  assert.match(all, /reimburse Landlord the amount the City charges Landlord for them, with nothing added/);
  assert.match(all, /continues from month to month/);
  assert.match(all, /Tenant will water, mow and weed the yard/);
  assert.equal(doc.blocks.filter((b) => b.t === "sign").length, 1);
});

test("outside the City only state law is applied, and other situations get plain statements", () => {
  const outside = flat(build(apartment({ inCity: "no", built: "1990" })));
  assert.ok(outside.includes(L.texts.stateCovered));
  for (const key of ["cityCovered", "cityDaycare", "cityExempt", "cityUtilityFees"]) assert.ok(!outside.includes(L.texts[key]), key);
  const adu = flat(build({ ...house({ unitType: "adu", ownerOnSite: "yes", ownerRentsMore: "no", built: "2000" }) }));
  assert.match(adu, /The rent limits of California Civil Code section 1947\.12 apply to this home\. Because Landlord lives at the property/);
  for (const key of ["stateCovered", "stateExempt", "cityCovered", "cityExempt"]) assert.ok(!adu.includes(L.texts[key]), key);
  const fresh = flat(build(house({ built: "2020", ownerKind: "corp" })));
  assert.match(fresh, /issued its certificate of occupancy within the previous 15 years/);
  const corp = build(house({ ownerKind: "corp" }));
  assert.ok(noticeWith(corp, L.texts.cityCovered) && noticeWith(corp, L.texts.stateCovered));
});

test("money, dates and people are worked out the way the lease states them", () => {
  assert.deepEqual(D.firstPayment({ rent: "3200", dueDay: "1", termStart: "2026-12-15" }), { prorated: true, amount: 1813.33, from: "2026-12-15", through: "2026-12-31", nextDue: "2027-01-01" });
  assert.deepEqual(D.firstPayment({ rent: "3000", dueDay: "1", termStart: "2027-01-01" }), { prorated: false, amount: 3000, from: "2027-01-01", through: "2027-01-31" });
  assert.equal(D.firstPayment({ rent: "3000", dueDay: "5", termStart: "2027-01-06" }).amount, 3000, "never more than a month's rent");
  assert.equal(D.firstPayment({ rent: "", dueDay: "1", termStart: "2027-01-01" }), null);
  assert.deepEqual(D.signers(apartment()).map((s) => [s.id, s.role, s.name]), [["signer-0", "Landlord", "Pat Owner"], ["signer-1", "Tenant", "Avery Morgan"], ["signer-2", "Tenant", "Sam Lee"]]);
  assert.deepEqual(D.signers(house({ manager: "Sky Property Care", signer: "manager" }))[0], { id: "signer-0", name: "Sky Property Care", role: "Landlord’s agent" });
  const all = flat(build(apartment()));
  assert.match(all, /The first payment is \$1,813\.33, due on or before December 15, 2026\. It covers December 15, 2026 through December 31, 2026\./);
  assert.match(all, /late charge of \$75\.00/);
  assert.match(all, /\$25 for the first returned check and \$35 for each one after that/);
  assert.match(all, /Tenant owes no rent for any period when a mandatory evacuation order/);
  assert.match(all, /A late charge is not rent/);
  assert.match(all, /If that day falls on a weekend or legal holiday, rent is due the next business day\./);
  assert.match(all, /Landlord accepts payment by personal check or electronic transfer such as Zelle\./);
  assert.equal(D.series(["a", "b", "c"]), "a, b and c");
  assert.equal(D.ordinal(1) + D.ordinal(2) + D.ordinal(3) + D.ordinal(11) + D.ordinal(22), "1st2nd3rd11th22nd");
});

test("what is still needed is listed in plain words, step by step", () => {
  const fields = (lease) => D.missing(lease, TODAY).map((m) => m.field);
  const blank = fields({ facts: {}, tenants: [], clauses: {}, customClauses: [] });
  for (const f of ["premises", "landlord", "tenants", "agreementDate", "termStart", "end", "rent", "dueDay", "deposit", "unitType", "floodKnown", "rareReviewed"]) assert.ok(blank.includes(f), f);
  const steps = D.missing({ facts: {}, tenants: [] }, TODAY).map((m) => m.step);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b));
  assert.ok(fields(apartment({ end: "2026-12-01" })).includes("end"));
  assert.ok(fields(apartment({ lateFeeAmount: "" })).includes("lateFeeAmount"));
  assert.ok(!fields(house({ kind: "Month to month", end: "" })).includes("end"));
  assert.ok(fields(apartment({}, { clauses: { pets: { opts: { policy: "approved", details: "" } } } })).includes("clause.pets.details"));
  assert.ok(fields(apartment({}, { customClauses: [{ id: "c1", title: "Bikes", text: " " }] })).includes("custom.c1"));
  assert.ok(fields(apartment({}, { tenants: [{ name: "Pat Owner" }] })).includes("tenants"), "a tenant cannot have the landlord's exact name");
  const amendment = { facts: { kind: "Amendment", agreementDate: TODAY, termStart: "2027-01-01", landlord: "Pat Owner", premises: "2418 Maple Street", changeText: "Rent becomes $3,350.00." }, tenants: [{ name: "Jordan Rivera" }], customClauses: [] };
  assert.deepEqual(D.missing(amendment, TODAY), []);
  const doc = build(amendment);
  assert.equal(doc.title, "Lease Amendment");
  assert.match(flat(doc), /Rent becomes \$3,350\.00\./);
  assert.equal(notices(doc).length, 0);
});

test("every clause in the library produces clean wording, and policy choices change it", () => {
  const leases = [apartment(), house({ parking: "the driveway", storage: "the garage shelves", pool: "yes" }), house({ unitType: "condo", hoa: "yes" })];
  const seen = new Set();
  for (const lease of leases) {
    const state = C.state(lease);
    for (const clause of C.library) {
      if (!C.visible(clause, lease)) continue;
      seen.add(clause.id);
      const section = clause.section(lease, state[clause.id].opts);
      assert.ok(section.heading && section.blocks.length, clause.id);
      const text = section.blocks.map(textOf).join(" ");
      assert.doesNotMatch(text, /undefined|NaN|null|\[object/, clause.id);
      assert.ok(clause.title && clause.summary && C.groups.some((g) => g.id === clause.group), clause.id);
      assert.ok(["policy", "recommended", "optional"].includes(clause.level), clause.id);
    }
  }
  assert.equal(seen.size, C.library.length, "every clause is shown for at least one kind of home");
  assert.equal(new Set(C.library.map((c) => c.id)).size, C.library.length);
  const withPets = flat(build(apartment({}, { clauses: { pets: { opts: { policy: "approved", details: "one cat named Miso", petRent: "35" } }, smoking: { opts: { policy: "outside", area: "the back patio" } }, guests: { on: false }, attorneyFees: { opts: { policy: "prevailing", cap: "2000" } } } })));
  assert.match(withPets, /only the following animals: one cat named Miso\./);
  assert.match(withPets, /pet rent of \$35\.00 each month/);
  assert.match(withPets, /A service animal or support animal that a person with a disability needs is not a pet/);
  assert.match(withPets, /except this outdoor area: the back patio\./);
  assert.match(withPets, /prevailing party may recover reasonable attorney’s fees and costs from the other party, up to \$2,000\./);
  assert.ok(!withPets.includes("A guest may stay up to"));
  assert.ok(flat(build(apartment())).includes("A guest may stay up to 14 nights"));
  // Saved choices that are not valid options fall back to the default instead of printing nonsense.
  assert.equal(C.state(apartment({}, { clauses: { pets: { opts: { policy: "bogus" } } } })).pets.opts.policy, "none");
  assert.ok(flat(build(apartment({}, { customClauses: [{ id: "c1", title: "Bicycles", text: "Bicycles are stored in room B." }] }))).includes("(a) Bicycles. Bicycles are stored in room B."));
});

test("custom-clause warnings catch wording California does not allow and leave ordinary wording alone", () => {
  const flagged = (text) => C.redFlags(text).map((f) => f.cite);
  assert.ok(flagged("Tenant pays a non-refundable cleaning fee of $300.").some((c) => c.includes("1950.5")));
  assert.ok(flagged("Tenant waives the right to repairs.").some((c) => c.includes("1953")));
  assert.ok(flagged("Landlord may enter at any time without notice.").some((c) => c.includes("1954")));
  assert.ok(flagged("No children may live in the unit.").some((c) => c.includes("12955")));
  assert.ok(flagged("Rent must be paid in cash only.").some((c) => c.includes("1947.3")));
  assert.ok(flagged("Tenant gives up the right to a jury trial.").length >= 1);
  assert.ok(flagged("A late fee of $20 per day applies.").some((c) => c.includes("1671")));
  assert.ok(flagged("This lease will automatically renew for one year.").some((c) => c.includes("1945.5")));
  assert.ok(flagged("A $50 fine applies for each noise complaint.").some((c) => c.includes("1671")));
  assert.ok(flagged("Carpets must be professionally cleaned at move-out.").some((c) => c.includes("1950.5(e)")));
  assert.ok(flagged("Landlord is not liable for any injury on the property.").some((c) => c.includes("1953(a)(5)")));
  assert.ok(flagged("Tenant is responsible for all repairs.").some((c) => c.includes("1942.1")));
  assert.ok(flagged("Tenant must give 60 days notice before moving out.").some((c) => c.includes("1946")));
  assert.ok(flagged("A $75 fee applies for serving any notice.").some((c) => c.includes("1946.1(i)")));
  assert.ok(flagged("No students.").some((c) => c.includes("12955")));
  for (const fine of ["Bicycles are stored in room B, not on the balcony.", "Tenant may park one car in the driveway.", "The gardener comes on Tuesdays.", "Tenant will water the lemon tree weekly.", "This is a single-family home with white walls; guests are welcome.", "Tenant will replace the furnace filter every 90 days.", "Landlord will give 60 days’ notice before ending the tenancy.", "The side gate stays locked. Deliveries go to the front porch.", "Tenant may hang pictures and install a small shelf in the garage."])
    assert.deepEqual(C.redFlags(fine), [], fine);
  assert.equal(C.redFlags("non-refundable and nonrefundable").length, 1, "one warning per problem");
});

test("the lease never uses wording the law voids, in any configuration", () => {
  const variants = [apartment(), house(), house({ unitType: "condo", hoa: "yes", kind: "Month to month", end: "" }), apartment({ inCity: "no" }), house({ unitType: "room", ownerOnSite: "yes", sharedKitchenBath: "yes" }), apartment({ sharedMeter: "yes", sharedMeterDetails: "The meter also powers the hall light; Landlord credits $10 a month.", pestService: "yes", pestCompany: "Coastal Pest", deathRecent: "yes", moldKnown: "yes", moldDetails: "Small patch under the kitchen sink, cleaned in October 2026" })];
  for (const lease of variants) {
    const all = flat(build(lease));
    for (const banned of [/non-?refundable/i, /\bwaive/i, /\bas[- ]is\b/i, /jury/i, /arbitrat/i, /at any time without notice/i, /hold harmless/i, /indemnif/i, /confess/i])
      assert.doesNotMatch(all, banned);
    assert.doesNotMatch(all, /undefined|NaN|\[object/);
    assert.match(all, /fully refundable to the extent it is not used for those purposes/);
    assert.match(all, /Landlord will not lock Tenant out, remove Tenant’s belongings or shut off utilities/);
  }
});

test("the PDF prints each notice at its required size and the web version matches it", async () => {
  const doc = build(apartment());
  const blob = globalThis.Files.pdfDoc(doc);
  assert.equal(blob.type, "application/pdf");
  const pdf = Buffer.from(await blob.arrayBuffer()).toString("latin1");
  const cmap = new Map();
  for (const block of pdf.matchAll(/beginbfchar\n([\s\S]*?)\nendbfchar/g))
    for (const [, cid, unicode] of block[1].matchAll(/<([a-f0-9]{4})> <([a-f0-9]+)>/g))
      cmap.set(cid, String.fromCharCode(...unicode.match(/.{4}/g).map((u) => parseInt(u, 16))));
  const printed = [];
  for (const [, size, encoded] of pdf.matchAll(/BT \/F ([\d.]+) Tf [^\n]*? Tm <([a-f0-9]+)> Tj ET/g))
    printed.push({ size: Number(size), text: encoded.match(/.{4}/g).map((cid) => cmap.get(cid)).join("") });
  assert.ok(printed.length > 300, "text operators are readable");
  const squash = (s) => s.replace(/\s+/g, "");
  const at = (min) => squash(printed.filter((line) => line.size >= min).map((line) => line.text).join(""));
  for (const key of ["cityCovered", "stateCovered", "cityDaycare"]) assert.ok(at(12).includes(squash(L.texts[key])), key + " at 12pt");
  for (const line of L.texts.bedbug) assert.ok(at(10).includes(squash(line)), "bed bug text at 10pt");
  // Body text is 10.5pt; page headers and footers are 8pt and are left out so a paragraph that crosses a page stays whole.
  assert.ok(at(9).includes(squash(L.texts.megan)));
  for (const line of L.texts.flood) assert.ok(at(9).includes(squash(line)));
  assert.ok(at(10).includes(squash(L.texts.leadWarning)));
  assert.ok(/Page 1 of \d+/.test(printed.map((l) => l.text).join(" ")));
  const html = globalThis.Files.htmlDoc(doc, { standalone: true });
  assert.ok(html.startsWith("<!doctype html>") && !/<script/i.test(html));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  for (const key of ["cityCovered", "stateCovered", "cityDaycare"]) {
    const i = html.indexOf(esc(L.texts[key]));
    assert.ok(i > 0, key + " in the web version");
    assert.match(html.slice(Math.max(0, i - 400), i), /font-size:\s*12pt/, key + " at 12pt in the web version");
  }
  // A name the embedded font cannot draw is reported, so the app can fall back to the web version.
  assert.throws(() => globalThis.Files.pdfDoc(build(house({}, { tenants: [{ name: "Nguyễn Thị Hồng" }] }))), (e) => e.code === "PDF_TEXT_UNSUPPORTED");
  assert.ok(globalThis.Files.htmlDoc(build(house({}, { tenants: [{ name: "Nguyễn Thị Hồng" }] }))).includes("Nguyễn Thị Hồng"));
});

test("a renewal keeps the deposit already held and drops the terms that only fit a move-in", () => {
  const renewal = apartment({ kind: "Renewal", start: "2024-08-01", termStart: "2026-12-15", end: "2027-12-14" });
  assert.deepEqual(D.missing(renewal, TODAY), []);
  const doc = build(renewal),
    all = flat(doc);
  assert.equal(doc.title, "Lease Renewal Agreement");
  assert.match(all, /Tenant has lived in the home since August 1, 2024\. This Lease renews that tenancy/);
  assert.match(all, /Landlord holds a security deposit of \$3,200\.00 that Tenant paid under the earlier lease\. It continues as the security deposit under this Lease, and no further deposit is due\./);
  assert.match(all, /This rent applies from December 15, 2026\./);
  assert.match(all, /Tenant already lives in the home\./);
  assert.match(all, /Tenant already has the keys to the home\./);
  assert.match(all, /will keep those accounts in Tenant’s name/);
  assert.match(all, /Landlord will photograph the home when Tenant moves out\./);
  for (const moveIn of ["Tenant will pay a security deposit", "Due before Tenant moves in", "Total due before move-in", "The first payment is", "If the home is not ready", "at move-in and again at move-out", "sets of keys at move-in", "by the start date", "At or before move-in"])
    assert.ok(!all.includes(moveIn), "a renewal does not say: " + moveIn);
  assert.equal(C.state(renewal).possession, undefined, "the clause about a late move-in is not offered");
  assert.ok(!L.analyze(renewal, TODAY).items.some((i) => i.id === "photos"), "no move-in photos for a tenant who already lives there");
  // The required notices are all still there.
  for (const key of ["cityCovered", "stateCovered", "cityDaycare"]) assert.ok(noticeWith(doc, L.texts[key]));
  // A deposit collected before July 1, 2024 may stay above today's limit; one collected since may not.
  const old = L.analyze(apartment({ kind: "Renewal", start: "2022-03-01", deposit: "6400" }), TODAY);
  assert.ok(!old.blockers.some((b) => b.field === "deposit"));
  assert.match(old.warnings.find((w) => w.id === "depositOlder").message, /above today’s limit of \$3,200\.00\. California lets you keep a deposit collected before July 1, 2024/);
  const recent = L.analyze(apartment({ kind: "Renewal", start: "2024-08-01", deposit: "6400" }), TODAY);
  assert.match(recent.blockers.find((b) => b.field === "deposit").message, /Lower it to \$3,200\.00 or less\./);
  assert.ok(L.analyze(apartment({ deposit: "6400", start: "2022-03-01" }), TODAY).blockers.some((b) => b.field === "deposit"), "a new lease is always held to the limit");
});

test("deadlines and amounts say exactly what they mean", () => {
  // The late charge can never fall due before the rent does.
  const all = flat(build(apartment()));
  assert.match(all, /by the end of the 5th day of the month, Tenant will pay a late charge of \$75\.00\. When the day rent is due moves to the next business day because of a weekend or legal holiday, this deadline moves by the same number of days\./);
  // Paying in person is offered only with the days and hours; taking cash requires them.
  assert.match(all, /Payments sent by mail go to the address in the Notices section\./);
  assert.ok(!/hand delivery|in person [a-z]/.test(all.split("Notices")[0]), "no in-person payment without hours");
  const hours = apartment({ payMethods: "check,cash", payHours: "weekdays, 9 a.m. to 5 p.m." });
  assert.deepEqual(D.missing(hours, TODAY), []);
  assert.match(flat(build(hours)), /Payments may be mailed to the address in the Notices section, or delivered there in person weekdays, 9 a\.m\. to 5 p\.m\./);
  const cash = D.missing(apartment({ payMethods: "check,cash" }), TODAY);
  assert.deepEqual(cash.map((x) => [x.step, x.field]), [[L.steps.terms, "payHours"]]);
  assert.match(cash[0].label, /^Say on which days and at what hours the tenant can pay in person\./);
  // An amount or number a clause needs is asked for, so no placeholder or zero reaches a finished lease.
  const gaps = (clauses) => D.missing(apartment({}, { clauses }), TODAY).map((x) => [x.field, x.label]);
  assert.deepEqual(gaps({ concession: { on: true, opts: { amount: "", what: "half off the first month" } } }), [["clause.concession.amount", "Move-in discount: discount needs an amount."]]);
  assert.deepEqual(gaps({ concession: { on: true, opts: { amount: "800", what: "half off the first month" } } }), []);
  assert.deepEqual(gaps({ insurance: { on: true, opts: { policy: "required", liability: "0" } } }), [["clause.insurance.liability", "Renters insurance: minimum liability coverage needs an amount."]]);
  assert.deepEqual(gaps({ insurance: { on: true, opts: { policy: "recommended", liability: "" } } }), [], "an amount that is not shown is not asked for");
  assert.deepEqual(gaps({ guests: { on: true, opts: { nights: "0" } } }), [["clause.guests.nights", "Guests: nights a guest may stay in any six months must be a number from 7 to 60."]]);
  assert.deepEqual(gaps({ possession: { on: true, opts: { days: "45" } } }), [["clause.possession.days", "If the home is not ready on time: days of delay before either side may cancel must be a number from 3 to 30."]]);
  assert.deepEqual(gaps({ pets: { on: true, opts: { policy: "allowed", petRent: "" } } }), [], "pet rent may be left blank");
  assert.deepEqual(gaps({ pets: { on: true, opts: { policy: "allowed", petRent: "some" } } }), [["clause.pets.petRent", "Pets: monthly pet rent must be an amount, or blank."]]);
  assert.deepEqual(gaps({ guests: { on: false, opts: { nights: "0" } } }), [], "a clause that is off asks for nothing");
  // With every default in place nothing is missing and nothing is left as a placeholder.
  for (const lease of [apartment(), house()]) {
    assert.deepEqual(D.missing(lease, TODAY), []);
    assert.ok(!/\[[a-z][^\]]*\]|undefined|NaN/.test(flat(build(lease))), "no placeholder in a complete lease");
  }
  // A fixed term of three months or less inside the City still carries the City notice, and says what it means.
  const short = flat(build(apartment({ termStart: "2026-12-15", end: "2027-02-28" })));
  assert.ok(short.includes(L.texts.cityCovered) && short.includes(L.texts.stateCovered));
  assert.match(short, /The City’s just cause rules do not apply to a lease for a fixed term of three months or less\. They apply from the first day if the tenancy continues after that term, and Tenant has the benefit/);
  assert.ok(!short.includes("apply from the start of the tenancy"));
});

test("optional extras: co-signer, move-in total, discount and City utility charges", () => {
  const lease = apartment({ parking: "space 12" }, { clauses: { guarantor: { on: true, opts: { name: "Dana Rivera" } }, concession: { on: true, opts: { amount: "500", what: "$500 off the first month" } } } });
  assert.deepEqual(D.missing(lease, TODAY), []);
  assert.deepEqual(D.signers(lease).at(-1), { id: "signer-3", name: "Dana Rivera", role: "Guarantor" });
  const doc = build(lease),
    all = flat(doc);
  assert.match(all, /Dana Rivera \(“Guarantor”\) guarantees that Tenant will pay the rent/);
  assert.match(all, /one-time discount of \$500\.00: \$500 off the first month\. The monthly rent stated above does not change\./);
  assert.match(all, /Tenant may park here: space 12\./);
  assert.match(all, /The rent does not change during the term\./);
  assert.match(all, /the rent cannot rise by more than that law allows in any 12 months/);
  const due = doc.blocks.find((b) => b.t === "kv" && b.rows.some((r) => r[0] === "Total due before move-in"));
  assert.deepEqual(due.rows, [["First payment", "$1,813.33"], ["Security deposit", "$3,200.00"], ["Total due before move-in", "$5,013.33"]]);
  assert.ok(D.missing(apartment({}, { clauses: { guarantor: { on: true, opts: { name: "" } } } }), TODAY).some((m) => m.field === "clause.guarantor.name"));
  // An exempt house: no rent-cap sentence.
  assert.doesNotMatch(flat(build(house())), /cannot rise by more than that law allows/);
});
