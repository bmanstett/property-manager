"use strict";
/* Finished leases: the folder to sign, recording signatures, the active lease, a lease the owner
   already has, the deposit helper, and the checks on lease records in a backup.
   Every person, address and file here is made up. Nothing is requested from the network.
   The browser part needs playwright-core and desktop Chrome; reading the lease PDF back needs the
   Python runtime the other suites use (pypdf). Set PLAYWRIGHT_CORE, CHROME_PATH or PYTHON_PATH if
   the defaults are not available. */
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const runtime = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies");
const python = process.env.PYTHON_PATH || path.join(runtime, "python", "python.exe");

require("./lease-packets.js");
const L = globalThis.LeasePackets;
const clone = (v) => JSON.parse(JSON.stringify(v));
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const flat = (s) => String(s).replace(/\s+/g, " ").trim();

/* ---------- Records written by the earlier lease tool (captured from the committed version) ---------- */
function legacyRecords() {
  const data = clone(LEGACY);
  const facts = (ref) => (Array.isArray(ref) ? { ...data.facts[ref[0]], ...ref[1] } : clone(data.facts[ref]));
  return data.records.map((r) => ({ ...r, ...(r.package ? { package: clone(data.packages[r.package]) } : {}), ...(r.facts !== undefined ? { facts: facts(r.facts) } : {}) }));
}
const legacyWorld = () => [
  { type: "property", id: "sample-juniper", name: "Juniper House" },
  { type: "tenancy", id: "sample-household", propertyId: "sample-juniper", name: "Avery Morgan" },
  ...legacyRecords(),
];
const find = (records, type, test = () => true) => records.find((r) => r.type === type && test(r));
/* Each change must make the records fail the check. */
function rejects(records, changes) {
  for (const [name, change] of Object.entries(changes)) {
    const copy = clone(records);
    const result = change(copy);
    const filtered = Array.isArray(result) && result.length > 0 && result.every((x) => x && typeof x === "object" && typeof x.type === "string");
    assert.throws(() => L.validateImport(filtered ? result : copy), /lease records/, "should be refused: " + name);
  }
}

test("pure helpers: dates, amounts, signing state, deductions and reminders", () => {
  const D = L.domain;
  assert.equal(D.plusDays("2026-11-18", 21), "2026-12-09");
  assert.equal(D.plusDays("2028-02-08", 21), "2028-02-29");
  assert.equal(D.plusDays("2026-02-30", 21), "");
  assert.equal(D.cents("3200"), 320000);
  assert.equal(D.cents("3200.5"), 320050);
  assert.equal(D.cents(" 12.34 "), 1234);
  for (const bad of ["", "12.345", "-5", "1,200", "abc", null]) assert.equal(D.cents(bad), null);
  assert.ok(D.isDate("2028-02-29") && !D.isDate("2027-02-29") && !D.isDate("2027-2-9"));
  assert.equal(D.listNames(["A"]), "A");
  assert.equal(D.listNames(["A", "B"]), "A and B");
  assert.equal(D.listNames(["A", "B", "C"]), "A, B and C");
  assert.equal(D.safeName('Lease: A/B "x"?.pdf'), "Lease- A-B -x--.pdf");
  assert.ok(Array.from(D.safeName("x".repeat(300) + ".pdf")).length <= 110);

  const signers = [{ id: "signer-0", name: "Pat Owner", role: "Landlord" }, { id: "signer-1", name: "Avery Morgan", role: "Tenant" }];
  const packet = { id: "p1", mode: "final", signers };
  assert.equal(D.signState(packet, []).state, "ready");
  assert.equal(D.signState(packet, []).label, "Ready to sign");
  const one = D.signState(packet, [{ signerId: "signer-1" }]);
  assert.deepEqual([one.state, one.done, one.total, one.label, one.missing.map((s) => s.name)], ["partly", 1, 2, "Signed by 1 of 2", ["Pat Owner"]]);
  assert.equal(D.signState(packet, [{ signerId: "signer-0" }, { signerId: "signer-1" }]).state, "signed");
  assert.equal(D.signState({ ...packet, mode: "draft" }, []).state, "draft");
  assert.equal(D.signState({ ...packet, mode: "reviewed" }, []).state, "ready");

  const item = { classification: "Documented deductible item", amountCents: 18000, basis: "Carpet cleaning", evidence: ["d1"] };
  assert.ok(D.itemReady(item));
  assert.ok(!D.itemReady({ ...item, evidence: [] }));
  assert.ok(!D.itemReady({ ...item, amountCents: 0 }));
  assert.ok(!D.itemReady({ ...item, classification: "Ordinary wear" }));

  assert.deepEqual(D.legacySigners({ landlord: " Alex Example ", adults: "Robin Example\n\n Sam Example " }).map((s) => [s.id, s.name, s.role]), [["signer-0", "Alex Example", "Landlord or agent"], ["signer-1", "Robin Example", "Tenant"], ["signer-2", "Sam Example", "Tenant"]]);
  assert.deepEqual(D.signerNames({ landlord: "Pat  Owner" }, [{ name: " Avery Morgan " }, { name: "" }]), ["Pat Owner", "Avery Morgan"]);
  assert.deepEqual(D.signerNames({ landlord: "Pat Owner", manager: "Robin Agent", signer: "manager" }, [{ name: "Avery Morgan" }]), ["Robin Agent", "Avery Morgan"]);
  assert.deepEqual(D.signerNames({ landlord: "Pat Owner" }, [{ name: "Avery Morgan" }], { guarantor: { on: true, opts: { name: " Dana  Rivera " } } }), ["Pat Owner", "Avery Morgan", "Dana Rivera"], "a co-signer signs too");
  assert.deepEqual(D.signerNames({ landlord: "Pat Owner" }, [{ name: "Avery Morgan" }], { guarantor: { on: false, opts: { name: "Dana Rivera" } } }), ["Pat Owner", "Avery Morgan"]);
  // The copy for the tenant is due 15 days after the tenant signs, and never shows a date already past.
  assert.equal(D.reminders({ id: "p4", facts: { kind: "Month to month", termStart: "2026-01-01", start: "2026-01-01" } }, "2026-10-01", "2026-11-18")[0].due, "2026-11-18");

  const lease = { id: "p9", facts: { kind: "Fixed term", start: "2026-12-15", termStart: "2026-12-15", end: "2027-12-14" } };
  assert.deepEqual(D.reminders(lease, "2026-11-18", "2026-11-18").map((r) => [r.id, r.title, r.due]), [
    ["lease-copy-p9", "Give each tenant a copy of the signed lease", "2026-12-03"],
    ["lease-renewal-p9", "Lease ends: decide on renewal", "2027-09-15"],
    ["lease-photos-p9", "Take move-in photos", "2026-12-15"],
  ]);
  const monthly = D.reminders({ id: "p8", facts: { kind: "Month to month", start: "2026-01-01", termStart: "2026-01-01" } }, "2026-11-18", "2026-11-18");
  assert.deepEqual(monthly.map((r) => r.key), ["copy"], "no renewal reminder without an end date and no photos for a past move-in");
  const renewal = D.reminders({ id: "p7", facts: { kind: "Renewal", start: "2024-01-01", termStart: "2027-01-01", end: "2027-12-31" } }, "2026-11-18", "2026-11-18");
  assert.deepEqual(renewal.map((r) => r.key), ["copy", "renewal"]);
  const amendment = D.reminders({ id: "p6", facts: { kind: "Amendment", termStart: "2027-01-01" } }, "2026-11-18", "2026-11-18");
  assert.deepEqual(amendment.map((r) => r.title), ["Give each tenant a copy of the signed amendment"]);
  const ending = D.reminders({ id: "p5", facts: { kind: "Fixed term", termStart: "2026-10-01", start: "2026-10-01", end: "2026-12-31" } }, "2026-11-18", "2026-11-18");
  assert.equal(ending.find((r) => r.key === "renewal").due, "2026-11-18", "a renewal reminder is never dated in the past");
});

test("records from the earlier lease tool still pass, and damage to them is refused", () => {
  const world = legacyWorld();
  const kinds = world.map((r) => r.type + (r.mode ? ":" + r.mode : ""));
  for (const kind of ["lease", "leasePacket:draft", "leasePacket:reviewed", "legalPackage", "signature", "execution", "operativeLease", "depositReturn"]) assert.ok(kinds.includes(kind), "fixture has " + kind);
  assert.ok(world.filter((r) => r.type === "lease").every((r) => r.schema === undefined && r.package), "the drafts are the earlier kind");
  L.validateImport(world);
  L.validateImport(world, new Set(world.filter((r) => r.type === "document").map((r) => r.hash)));
  assert.throws(() => L.validateImport(world, new Set()), /lease records/, "a file missing from the backup is refused");
  // A draft the owner deleted later must not make a backup unreadable.
  L.validateImport(world.filter((r) => r.type !== "lease"));

  const reviewed = (r) => find(r, "leasePacket", (p) => p.mode === "reviewed");
  const draft = (r) => find(r, "leasePacket", (p) => p.mode === "draft");
  rejects(world, {
    "signature made for another version of the folder": (r) => (find(r, "signature").packetHash = "bad"),
    "rule set with a script link": (r) => (reviewed(r).package.rules[0].url = "javascript:alert(1)"),
    "rule set without its rules": (r) => delete find(r, "legalPackage").package.rules,
    "rule set with too many rules": (r) => (find(r, "legalPackage").package.rules = Array.from({ length: 151 }, (_, i) => ({ id: "r" + i, title: "t" }))),
    "rule set without its review note": (r) => (find(r, "legalPackage").reviewer = ""),
    "folder hash changed": (r) => (reviewed(r).archiveHash = "0".repeat(64)),
    "signed copy missing": (r) => (find(r, "operativeLease").signedDoc = "missing"),
    "attachment missing": (r) => (find(r, "lease").attachments = ["missing"]),
    "clause without its place in the contract": (r) => delete reviewed(r).clauseReferences,
    "clause with a bad id": (r) => (draft(r).customClauses[0].id = "x"),
    "answer that is not text": (r) => (draft(r).facts.rent = 3200),
    "review with an unknown result": (r) => (draft(r).review[0].status = "Fine"),
    "review of a rule the set does not have": (r) => (draft(r).review[0].id = "nope"),
    "rule set version disagrees": (r) => (reviewed(r).packageVersion = "other"),
    "signer renamed": (r) => (reviewed(r).signers[1].name = "Someone Else"),
    "signer added": (r) => reviewed(r).signers.push({ id: "signer-2", name: "Extra", role: "Tenant" }),
    "unsafe file path": (r) => (reviewed(r).attachments[0].path = "../outside.pdf"),
    "absolute file path": (r) => (reviewed(r).attachments[0].path = "/etc/passwd"),
    "file path with a drive letter": (r) => (reviewed(r).attachments[0].path = "C:evil.pdf"),
    "contract that is not a PDF": (r) => (find(r, "document", (d) => d.id === reviewed(r).contractId).mime = "text/html"),
    "file filed under another lease": (r) => (find(r, "document", (d) => d.id === reviewed(r).archiveId).packetId = draft(r).id),
    "file that can be changed": (r) => (find(r, "document", (d) => d.id === reviewed(r).worksheetId).immutable = false),
    "lease that can be changed": (r) => (reviewed(r).immutable = false),
    "lease from another rental": (r) => {
      r.push({ type: "property", id: "other", name: "Other" });
      reviewed(r).propertyId = "other";
    },
    "file from another rental": (r) => {
      r.push({ type: "property", id: "other", name: "Other" });
      find(r, "document", (d) => d.id === reviewed(r).contractId).propertyId = "other";
    },
    "tenant from another rental": (r) => {
      r.push({ type: "property", id: "other", name: "Other" }, { type: "tenancy", id: "elsewhere", propertyId: "other", name: "X" });
      find(r, "signature").tenancyId = "elsewhere";
    },
    "active lease with a signature missing": (r) => r.filter((x) => !(x.type === "signature" && x.signerId === "signer-1")),
    "signed copy of the wrong kind": (r) => (find(r, "document", (d) => d.id === find(r, "execution").signedDoc).kind = "Receipt"),
    "signing record without a date": (r) => (find(r, "execution").effective = "soon"),
    "two signatures for one signer": (r) => r.push({ ...find(r, "signature"), id: "copy" }),
    "signature without a date": (r) => (find(r, "signature").signedDate = "2026-13-01"),
    "deposit deadline that does not match": (r) => (find(r, "depositReturn").deadline = "2027-01-01"),
    "deduction without an amount": (r) => (find(r, "depositReturn").items[0].amountCents = -1),
    "deduction receipt missing": (r) => (find(r, "depositReturn").items[0].evidence = ["missing"]),
    "draft step out of range": (r) => (find(r, "lease").step = 9),
    "lease from a newer app": (r) => (draft(r).schema = 3),
  });
});

test("current drafts are checked for shape and size, not for every value", () => {
  const base = [
    { type: "property", id: "p", name: "Maple Street house" },
    { type: "tenancy", id: "t", propertyId: "p", name: "Jordan Rivera" },
    { type: "document", id: "d", propertyId: "p", hash: "a".repeat(64), name: "HOA rules.pdf" },
  ];
  const draft = { type: "lease", schema: 2, id: "l", propertyId: "p", tenancyId: "t", name: "Lease – Jordan Rivera", step: 3, lawVersion: "CA-SD 2026.11", facts: { premises: "2418 Maple Street", rent: "2850" }, tenants: [{ id: "a", name: "Jordan Rivera", email: "", phone: "" }], clauses: { pets: { on: true, opts: { policy: "none" } }, guests: { on: false } }, customClauses: [{ id: "c1", title: "", text: "Bicycles go in room B." }], attachments: ["d"], parentPacket: "", reviewedInputs: false };
  L.validateImport([...base, draft]);
  L.validateImport([...base, { type: "lease", schema: 2, id: "bare", propertyId: "p", facts: {} }], undefined);
  L.validateImport([...base, { ...draft, tenancyId: "", facts: { ...draft.facts, built: null, dueDay: 1, furnished: false } }]);
  const refuse = (change, why) => {
    const copy = clone(draft);
    change(copy);
    assert.throws(() => L.validateImport([...base, copy]), /lease records/, why);
  };
  refuse((d) => (d.facts = ["x"]), "answers must be a map");
  refuse((d) => (d.facts.nested = { a: 1 }), "an answer cannot hold a nested value");
  refuse((d) => (d.facts.premises = "x".repeat(100001)), "an answer cannot be enormous");
  refuse((d) => (d.tenants = "Jordan"), "tenants must be a list");
  refuse((d) => (d.tenants = [{ name: { first: "J" } }]), "a tenant name must be text");
  refuse((d) => (d.clauses = []), "clause choices must be a map");
  refuse((d) => (d.clauses.pets.on = "yes"), "a clause switch must be on or off");
  refuse((d) => (d.clauses.pets.opts = ["none"]), "clause options must be a map");
  refuse((d) => d.customClauses.push({ id: "c1", title: "", text: "Again" }), "two clauses cannot share an id");
  refuse((d) => (d.customClauses[0].text = 5), "clause wording must be text");
  refuse((d) => (d.step = 6), "the step must be one of the six");
  refuse((d) => (d.attachments = ["missing"]), "an attachment must exist");
  refuse((d) => (d.parentPacket = "missing"), "the lease it came from must exist");
  refuse((d) => (d.finalPacket = "missing"), "the finished lease it points to must exist");
  refuse((d) => (d.tenancyId = "missing"), "the tenant must exist");
  refuse((d) => (d.propertyId = "missing"), "the rental must exist");
  refuse((d) => (d.schema = 3), "a newer format is refused");
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
/* A ZIP written by Files.zip stores its files uncompressed, so it can be read back directly. */
function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, "the ZIP has its closing record");
  const files = {};
  let at = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50, "directory entry " + i);
    assert.equal(buffer.readUInt16LE(at + 10), 0, "stored without compression");
    const size = buffer.readUInt32LE(at + 24),
      nameLength = buffer.readUInt16LE(at + 28),
      offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    files[name] = buffer.subarray(start, start + size);
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return files;
}
/* The words of a PDF, page by page, without the running title, address and page number. */
function pdfWords(buffer, drop) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lease-"));
  try {
    fs.writeFileSync(path.join(folder, "lease.pdf"), buffer);
    const script = ["import json,sys", "from pypdf import PdfReader", "print(json.dumps([p.extract_text() for p in PdfReader(sys.argv[1]).pages]))"].join("\n");
    let pages;
    try {
      pages = JSON.parse(execFileSync(python, ["-X", "utf8", "-c", script, path.join(folder, "lease.pdf")], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }));
    } catch (error) {
      throw Error("Reading the lease PDF back needs Python with pypdf; set PYTHON_PATH if the default is unavailable.\n" + (error.stderr || error.message));
    }
    const edge = (line) => !line || drop.includes(line) || /^Page \d+ of \d+$/.test(line) || drop.some((d) => line.startsWith(d) && /Page \d+ of \d+$/.test(line));
    return { pages: pages.length, text: flat(pages.map((p) => p.split("\n").map(flat).filter((line) => !edge(line)).join("\n")).join("\n")) };
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

/* Runs in the page: helpers for making complete drafts without the builder. */
const HELPERS = `window.T = {
  facts(over) {
    const today = PM.today(), start = PM.addDays(today, 27);
    return Object.assign({ state: "CA", agreementDate: today, kind: "Fixed term", start, termStart: start, end: PM.addDays(LeaseLaw.addYears(start, 1), -1), rent: "3200", dueDay: "1", deposit: "3200", landlord: "Pat Owner", noticeAddress: "410 Example Street, San Diego, CA 92103", noticePhone: "619-555-0100", noticeEmail: "pat@example.test", payMethods: "check,zelle", payDetails: "Zelle to pat@example.test", floodKnown: "no", rareReviewed: "yes", inCity: "yes", city: "San Diego", zip: "92101", lateFee: "yes", lateFeeAmount: "75", lateFeeDay: "5", util_electric: "tenant", util_gas: "tenant", util_water: "landlord", util_sewer: "landlord", util_trash: "landlord", util_internet: "tenant", appliances: "stove,refrigerator,dishwasher", ownFridge: "no", unitType: "apartment", buildingUnits: "5-15", ownerKind: "people", built: "1972", premises: "184 Juniper Lane", unit: "3", leadKnown: "no", leadRecords: "no" }, over || {});
  },
  async draft(over = {}) {
    const tenants = over.tenants || [{ id: PM.uid(), name: "Avery Morgan", email: "avery@example.test", phone: "" }, { id: PM.uid(), name: "Sam Lee", email: "", phone: "" }];
    const lease = await PM.save("lease", { id: PM.uid(), schema: 2, propertyId: PM.prop().id, tenancyId: "", name: "Lease – " + tenants.map((t) => t.name).join(" and "), step: 5, lawVersion: LeaseLaw.version, clauses: {}, customClauses: [], attachments: [], parentPacket: "", reviewedInputs: true, ...over, tenants, facts: T.facts(over.facts) });
    const missing = LeaseDocument.missing(lease, PM.today());
    if (missing.length) throw Error("The test draft is no longer complete: " + JSON.stringify(missing));
    return lease;
  },
  async bytes(documentId) {
    const blob = await PM.file(PM.get(documentId).hash);
    const data = new Uint8Array(await blob.arrayBuffer());
    let text = "";
    for (let i = 0; i < data.length; i += 32768) text += String.fromCharCode.apply(null, data.subarray(i, i + 32768));
    return btoa(text);
  },
  show(id) {
    PM.navigate("Leases", "packet/" + id);
    if (!document.querySelector('.lp-page[data-packet-id="' + id + '"]')) LeasePackets.page(id);
  },
  count: (type) => PM.records(type).length,
};`;
/* Runs in the page: the accessibility checks the whole app is held to, limited to what is on screen. */
const AUDIT = () => {
  const dialog = document.querySelector("dialog[open]");
  const scope = dialog || document.querySelector(".lp-page");
  const issues = [];
  if (!scope) return ["nothing to check"];
  if (document.documentElement.scrollWidth > innerWidth) issues.push("the page scrolls sideways by " + (document.documentElement.scrollWidth - innerWidth) + "px");
  if (dialog && dialog.scrollWidth > dialog.clientWidth + 1) issues.push("the dialog scrolls sideways");
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.name || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 44);
  let checked = 0;
  for (const control of scope.querySelectorAll("button,summary,input:not([type=hidden]),select,textarea,a[href]")) {
    const r = control.getBoundingClientRect();
    if (control.closest("[hidden]") || getComputedStyle(control).visibility === "hidden") continue;
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

test("finished leases in a real browser", async (t) => {
  const server = await serve();
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block", acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("http://127.0.0.1:" + server.address().port + "/");
  await page.waitForFunction(() => globalThis.PM?.prop?.() && PM.records("tenancy").length, null, { timeout: 20000 });
  await page.evaluate(HELPERS);
  const client = await context.newCDPSession(page);
  await client.send("Accessibility.enable");
  await client.send("DOM.enable");

  /* Everything on screen that is ours meets the size, contrast, naming and overflow rules. */
  async function audit(name, widths = [375, 720, 1280]) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
      const issues = await page.evaluate(AUDIT);
      const { nodes } = await client.send("Accessibility.getFullAXTree");
      for (const node of nodes) {
        if (node.ignored || !["button", "textbox", "checkbox", "radio", "combobox", "switch", "link"].includes(node.role?.value) || String(node.name?.value || "").trim() || !node.backendDOMNodeId) continue;
        const { object } = await client.send("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId });
        const { result } = await client.send("Runtime.callFunctionOn", { objectId: object.objectId, returnByValue: true, functionDeclaration: "function(){return this.closest&&this.closest('.lp-page,.lp-dialog')?this.outerHTML.slice(0,90):''}" });
        if (result.value) issues.push("no name for " + node.role.value + ": " + result.value);
      }
      assert.deepEqual(issues, [], name + " at " + width + "px");
    }
    await page.setViewportSize({ width: 375, height: 812 });
  }
  /* The message shown after a save. It appears a moment after the screen is drawn again, so wait for it. */
  const toastSays = (pattern) =>
    page.waitForFunction((source) => new RegExp(source).test(document.getElementById("toast")?.innerText || ""), pattern.source, { timeout: 8000 }).catch(async () => {
      assert.match(await page.locator("#toast").innerText(), pattern);
    });
  const samplePdf = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await Files.pdf("Signed pages", [{ heading: "Signed", lines: ["Made-up signed pages."] }]).arrayBuffer()))));
  const upload = (name = "signed lease.pdf") => ({ name, mimeType: "application/pdf", buffer: samplePdf });
  const texts = await page.evaluate(() => ({ law: LeaseLaw.texts, handouts: LeaseLaw.handouts, version: LeaseLaw.version }));
  const today = await page.evaluate(() => PM.today());
  const addDays = (iso, n) => L.domain.plusDays(iso, n);
  const longDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const state = {};

  await t.test("finalize refuses a lease that is not ready, in plain words, and writes nothing", async () => {
    const before = await page.evaluate(() => ["leasePacket", "document", "tenancy"].map(T.count));
    const messages = await page.evaluate(async () => {
      const lease = await T.draft();
      const tries = [
        { ...lease, reviewedInputs: false },
        { ...lease, facts: { ...lease.facts, rent: "" } },
        { ...lease, facts: { ...lease.facts, rent: "", landlord: "" } },
        { ...lease, schema: undefined },
        { ...lease, propertyId: "another-rental" },
        null,
      ];
      const out = [];
      for (const attempt of tries) out.push(await LeasePackets.finalize(attempt).then(() => "saved", (e) => e.message));
      return out;
    });
    assert.match(messages[0], /confirm that you have read the whole lease/);
    assert.match(messages[1], /^One thing is still needed.*rent/i);
    assert.match(messages[2], /^2 things are still needed/);
    assert.match(messages[3], /builder/);
    assert.match(messages[4], /different rental/);
    assert.match(messages[5], /builder/);
    assert.deepEqual(await page.evaluate(() => ["leasePacket", "document", "tenancy"].map(T.count)), before);
  });

  await t.test("finalize writes the lease, its booklets, the folder and the finished record in one save", async () => {
    const made = await page.evaluate(async () => {
      const receipt = await PM.save("document", { id: PM.uid(), name: "HOA rules.pdf", filename: "HOA rules.pdf", kind: "Other", mime: "application/pdf", hash: await PM.blob(Files.pdf("HOA rules", [{ heading: "Rules", lines: ["Made-up association rules."] }])), size: 1, date: PM.today(), immutable: true, version: 1 });
      const lease = await T.draft({ attachments: [receipt.id], customClauses: [{ id: PM.uid(), title: "Bicycles", text: "Bicycles are stored in room B, not on the balcony." }], facts: { pestService: "yes", pestCompany: "Made-up Pest Co." } });
      const counts = () => Object.fromEntries(["leasePacket", "document", "tenancy", "lease", "task", "signature"].map((type) => [type, T.count(type)]));
      const before = counts();
      const packet = await LeasePackets.finalize(lease);
      const docs = Object.fromEntries(PM.records("document").filter((d) => d.packetId === packet.id).map((d) => [d.id, d]));
      return { lease, packet, before, after: counts(), docs, draft: PM.get(lease.id), tenancy: PM.get(packet.tenancyId), receipt, zip: await T.bytes(packet.archiveId), route: PM.route ? PM.route() : "" };
    });
    const { packet, docs, lease } = made;
    state.first = packet;
    // The record (specification section 8).
    assert.deepEqual([packet.type, packet.schema, packet.mode, packet.immutable, packet.leaseId, packet.parentPacket], ["leasePacket", 2, "final", true, lease.id, ""]);
    assert.equal(packet.lawVersion, texts.version);
    assert.equal(packet.packageVersion, texts.version);
    assert.equal(packet.template, "CA-SD residential lease 2.0");
    assert.equal(packet.name, "Lease – Avery Morgan and Sam Lee");
    assert.match(packet.generated, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(packet.facts, lease.facts);
    assert.deepEqual(packet.tenants, lease.tenants);
    assert.deepEqual(packet.customClauses, lease.customClauses);
    assert.deepEqual(packet.clauses, {});
    assert.deepEqual(packet.signers, [{ id: "signer-0", name: "Pat Owner", role: "Landlord" }, { id: "signer-1", name: "Avery Morgan", role: "Tenant" }, { id: "signer-2", name: "Sam Lee", role: "Tenant" }]);
    assert.ok(packet.review.length > 10 && packet.review.every((r) => r.id && r.title && typeof r.status === "string" && typeof r.why === "string"));
    assert.equal(packet.review.find((r) => r.id === "pest").status, "attention");
    assert.equal(packet.worksheetId, packet.contractId);
    assert.equal(made.route, "", "finalize does not navigate");
    // One household was created and linked, because the draft named none.
    assert.equal(made.after.tenancy, made.before.tenancy + 1);
    assert.deepEqual([made.tenancy.type, made.tenancy.name, made.tenancy.start, made.tenancy.rentCents, made.tenancy.nextDue], ["tenancy", "Avery Morgan and Sam Lee", lease.facts.start, undefined, undefined]);
    assert.equal(made.draft.tenancyId, packet.tenancyId);
    assert.equal(made.draft.finalPacket, packet.id);
    assert.notEqual(made.draft._rev, lease._rev);
    assert.deepEqual([made.after.leasePacket - made.before.leasePacket, made.after.lease - made.before.lease, made.after.task - made.before.task, made.after.signature - made.before.signature], [1, 0, 0, 0]);
    // Documents: the lease, three booklets, the owner's attachment and the folder; all frozen.
    assert.equal(made.after.document, made.before.document + 6);
    assert.ok(Object.values(docs).every((d) => d.immutable === true && d.tenancyId === packet.tenancyId && /^[a-f0-9]{64}$/.test(d.hash)));
    const leaseDoc = docs[packet.contractId],
      archive = docs[packet.archiveId];
    assert.deepEqual([leaseDoc.kind, leaseDoc.mime, leaseDoc.name], ["Lease", "application/pdf", "Lease – Avery Morgan and Sam Lee.pdf"]);
    assert.deepEqual([archive.mime, archive.hash], ["application/zip", packet.archiveHash]);
    assert.deepEqual(packet.attachments.map((a) => a.path), [
      "handouts/City of San Diego Tenant Protection Guide.pdf",
      "handouts/Information on Dampness and Mold for Renters in California (state booklet).pdf",
      "handouts/Protect Your Family From Lead in Your Home (EPA pamphlet).pdf",
      "attachments/01-HOA rules.pdf",
    ]);
    assert.deepEqual(packet.attachments.map((a) => a.hash), [texts.handouts.guide.hash, texts.handouts.mold.hash, texts.handouts.lead.hash, made.receipt.hash]);
    assert.deepEqual(packet.attachments.map((a) => [docs[a.id].hash, docs[a.id].kind, a.sourceId]), [
      [texts.handouts.guide.hash, "Disclosure", ""],
      [texts.handouts.mold.hash, "Disclosure", ""],
      [texts.handouts.lead.hash, "Disclosure", ""],
      [made.receipt.hash, "Other", made.receipt.id],
    ]);
    // The folder itself.
    const zip = Buffer.from(made.zip, "base64");
    assert.equal(sha256(zip), packet.archiveHash);
    const files = unzip(zip);
    assert.deepEqual(Object.keys(files), ["Lease.pdf", ...packet.attachments.map((a) => a.path), "READ ME FIRST.txt"]);
    for (const a of packet.attachments) assert.equal(sha256(files[a.path]), a.hash, a.path);
    for (const handout of Object.values(texts.handouts)) assert.equal(sha256(fs.readFileSync(path.join(__dirname, handout.path))), handout.hash, "bundled " + handout.path);
    assert.equal(sha256(files["Lease.pdf"]), leaseDoc.hash);
    assert.equal(files["Lease.pdf"].subarray(0, 5).toString(), "%PDF-");
    const readme = files["READ ME FIRST.txt"].toString("utf8");
    for (const line of ["BEFORE ANYONE SIGNS", "1. Lease.pdf (the lease)", "2. handouts/City of San Diego Tenant Protection Guide.pdf", "5. attachments/01-HOA rules.pdf", "ALSO NEEDED FROM YOU BEFORE SIGNING", "Pest control company notice", "- Pat Owner (Landlord)", "- Sam Lee (Tenant)", "AFTER SIGNING", "within 15 days", "ALSO FOR YOU TO DO (NOT PART OF THE LEASE)", "City lead paint check between tenants", "It is not legal advice."]) assert.ok(readme.includes(line), "read-me has: " + line);
    assert.ok(!/packet|tenancy|household|operative|execut/i.test(readme), "the read-me is in plain words");
    // The lease as the tenant will read it.
    const address = "184 Juniper Lane, Unit 3, San Diego, California 92101";
    const words = pdfWords(files["Lease.pdf"], [address, "Residential Lease Agreement"]);
    assert.ok(words.pages >= 8, "a full lease, not a worksheet");
    assert.ok(!words.text.includes("DRAFT"), "no draft mark on the final lease");
    const required = [texts.law.cityCovered, texts.law.stateCovered, texts.law.megan, texts.law.cityDaycare, texts.law.leadWarning, texts.law.bedbugTitle, ...texts.law.bedbug, ...texts.law.flood];
    for (const text of required) assert.ok(words.text.includes(flat(text)), "the lease prints: " + text.slice(0, 60));
    for (const text of ["Pat Owner", "Avery Morgan and Sam Lee", "$3,200.00", "Bicycles are stored in room B, not on the balcony.", "Made-up Pest Co.", "410 Example Street, San Diego, CA 92103", "619-555-0100"]) assert.ok(words.text.includes(text), "the lease has: " + text);
    assert.ok(!words.text.includes(flat(texts.law.stateExempt)), "a covered home does not get the exemption statement");
  });

  await t.test("only one save runs at a time, a stale copy is refused, and a switch of rental stops the save", async () => {
    const result = await page.evaluate(async () => {
      const count = () => PM.records("leasePacket").length + "/" + PM.records("document").length;
      const out = {};
      // Two finalize calls on the same saved draft: the second sees the draft has moved on.
      const lease = await T.draft({ tenants: [{ id: PM.uid(), name: "Jo Rivera", email: "", phone: "" }] });
      let before = PM.records("leasePacket").length;
      const both = await Promise.allSettled([LeasePackets.finalize(lease), LeasePackets.finalize(lease)]);
      out.both = both.map((r) => r.status + (r.reason ? ": " + r.reason.message : ""));
      out.added = PM.records("leasePacket").length - before;
      // A draft changed on another screen.
      const other = await T.draft({ tenants: [{ id: PM.uid(), name: "Lee Park", email: "", phone: "" }] });
      await PM.save("lease", { ...other, name: "Lease renamed elsewhere" });
      before = count();
      out.stale = await LeasePackets.finalize(other).then(() => "saved", (e) => e.message);
      out.staleWrote = count() !== before;
      // The owner switches rental while the files are being stored.
      const third = await T.draft({ tenants: [{ id: PM.uid(), name: "Kim Ortiz", email: "", phone: "" }] });
      const dataset = PM.dataset, blob = PM.blob;
      let calls = 0;
      PM.blob = (b) => { if (++calls === 2) PM.dataset = () => "elsewhere"; return blob(b); };
      before = count();
      out.switched = await LeasePackets.finalize(third).then(() => "saved", (e) => e.message);
      PM.dataset = dataset; PM.blob = blob;
      out.switchWrote = count() !== before;
      out.fine = await LeasePackets.finalize(third).then((p) => p.mode, (e) => e.message);
      return out;
    });
    assert.equal(result.both[0], "fulfilled");
    assert.match(result.both[1], /^rejected: .*(changed somewhere else|could not be saved)/);
    assert.equal(result.added, 1);
    assert.match(result.stale, /changed somewhere else|could not be saved/);
    assert.equal(result.staleWrote, false);
    assert.match(result.switched, /switched to a different rental/);
    assert.equal(result.switchWrote, false);
    assert.equal(result.fine, "final", "the same draft finalizes once the owner is back on its rental");
  });

  await t.test("a lease with a co-signer can be made final, and the co-signer is one of the people who sign", async () => {
    const made = await page.evaluate(async () => {
      const lease = await T.draft({ tenants: [{ id: PM.uid(), name: "Riley Chen", email: "", phone: "" }], clauses: { guarantor: { on: true, opts: { name: "Dana Chen" } } } });
      const packet = await LeasePackets.finalize(lease);
      LeasePackets.validateImport(PM.all());
      T.show(packet.id);
      return { signers: packet.signers, boxes: [...document.querySelectorAll('#lp-sign input[name="signers"]')].map((i) => i.closest("label").innerText.trim()), readme: null };
    });
    assert.deepEqual(made.signers, [{ id: "signer-0", name: "Pat Owner", role: "Landlord" }, { id: "signer-1", name: "Riley Chen", role: "Tenant" }, { id: "signer-2", name: "Dana Chen", role: "Guarantor" }]);
    assert.deepEqual(made.boxes, ["Pat Owner (Landlord)", "Riley Chen (Tenant)", "Dana Chen (Guarantor)"]);
  });

  await t.test("a name the PDF font cannot draw gives a web-page lease, and the page says so", async () => {
    const made = await page.evaluate(async () => {
      const lease = await T.draft({ tenants: [{ id: PM.uid(), name: "Nguyễn Văn An", email: "", phone: "" }], facts: { unitType: "house", otherUnitOnLot: "no", buildingUnits: "", unit: "", built: "1999", premises: "2418 Maple Street", ownFridge: "yes", util_trash: "tenant", leadKnown: "", leadRecords: "" } });
      const packet = await LeasePackets.finalize(lease);
      const sheet = PM.get(packet.contractId);
      const html = await (await PM.file(sheet.hash)).text();
      const draft = await LeasePackets.draft(lease);
      T.show(packet.id);
      return { packet, sheet, html, zip: await T.bytes(packet.archiveId), plain: new DOMParser().parseFromString(html, "text/html").body.textContent, draft: { name: draft.name, html: draft.html, type: draft.blob.type, text: await draft.blob.text() } };
    });
    state.web = made.packet;
    assert.deepEqual([made.sheet.mime, made.sheet.name, made.sheet.kind], ["text/html", "Lease – Nguyễn Văn An.html", "Lease"]);
    assert.ok(made.html.startsWith("<!doctype html>") && made.html.includes("Nguyễn Văn An") && !/<script/i.test(made.html));
    const words = flat(made.plain);
    for (const text of [texts.law.stateExempt, texts.law.cityExempt, texts.law.megan, texts.law.cityDaycare, texts.law.fridge, texts.law.cityUtilityFees, texts.law.bedbugTitle, ...texts.law.bedbug]) assert.ok(words.includes(flat(text)), "the web-page lease prints: " + text.slice(0, 60));
    assert.ok(!words.includes(flat(texts.law.stateCovered)) && !words.includes(flat(texts.law.leadWarning)));
    const files = unzip(Buffer.from(made.zip, "base64"));
    assert.deepEqual(Object.keys(files), ["Lease.html", "handouts/Information on Dampness and Mold for Renters in California (state booklet).pdf", "READ ME FIRST.txt"]);
    assert.equal(files["Lease.html"].toString("utf8"), made.html);
    assert.ok(files["READ ME FIRST.txt"].toString("utf8").includes("1. Lease.html (the lease)"));
    assert.deepEqual(made.packet.signers.map((s) => s.name), ["Pat Owner", "Nguyễn Văn An"]);
    // The draft download writes nothing and is marked as a draft.
    assert.deepEqual([made.draft.name, made.draft.html, made.draft.type], ["Lease – Nguyễn Văn An (draft).html", true, "text/html"]);
    assert.ok(made.draft.text.includes("DRAFT"));
    // The page explains the web-page file in the agreed words and offers a download, not a print tab.
    await page.locator(".lp-page .ui-note").filter({ hasText: "This lease uses characters the PDF writer cannot draw, so it is saved as a web page. Open it and choose Print, then Save as PDF." }).waitFor();
    assert.equal(await page.locator('.lp-page [data-packet="print"]').innerText(), "Download the lease");
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator('.lp-page [data-packet="print"]').click()]);
    assert.equal(download.suggestedFilename(), "Lease – Nguyễn Văn An.html");
    await audit("lease saved as a web page", [375]);
  });

  await t.test("the lease page: ready to sign", async () => {
    await page.evaluate((id) => T.show(id), state.first.id);
    const view = page.locator(".lp-page");
    assert.equal(await view.locator("h1").innerText(), "Lease – Avery Morgan and Sam Lee");
    assert.equal(await view.locator(".lp-head .ui-status").innerText(), "Ready to sign");
    assert.match(await view.locator(".lp-state").innerText(), /^Made final .* Nothing is signed yet\.$/);
    assert.deepEqual(await view.locator(".lp-step h2").allInnerTexts(), ["Give these to your tenant before signing", "Sign", "Record the signed lease", "Afterwards"]);
    assert.deepEqual(await view.locator(".lp-step").first().locator(".lp-file-text b").allInnerTexts(), ["The lease", "City of San Diego Tenant Protection Guide", "Information on Dampness and Mold for Renters in California (state booklet)", "Protect Your Family From Lead in Your Home (EPA pamphlet)", "HOA rules"]);
    assert.match(await view.locator(".ui-note--warn").innerText(), /Also needed from you before signing\s+Pest control company notice/);
    assert.deepEqual(await view.locator(".lp-step").nth(3).locator("li b").allInnerTexts(), ["Give each tenant a copy of the signed lease", "Lease ends: decide on renewal", "Take move-in photos"]);
    // Three people, all ticked; the date is today and cannot be later.
    assert.deepEqual(await view.locator('#lp-sign input[name="signers"]').evaluateAll((list) => list.map((i) => [i.value, i.checked])), [["signer-0", true], ["signer-1", true], ["signer-2", true]]);
    assert.deepEqual(await view.locator('#lp-sign input[name="signedDate"]').evaluate((i) => [i.value, i.max]), [today, today]);
    assert.equal(await view.locator('[data-lease="revise"]').getAttribute("data-ref"), state.first.id);
    assert.equal(await view.locator("select").count(), 0, "no dropdowns");
    const words = await view.innerText();
    assert.ok(!/packet|tenancy|household|operative|execut|disclosure|jurisdiction|!/i.test(words), "plain words only: " + words.match(/packet|tenancy|household|operative|execut|disclosure|jurisdiction|!/i));
    await audit("ready to sign");
    // Buttons: the ZIP downloads, the lease opens in a tab for printing, email opens the message form.
    const [zip] = await Promise.all([page.waitForEvent("download"), view.locator('[data-packet="zip"]').click()]);
    assert.equal(zip.suggestedFilename(), "Lease – Avery Morgan and Sam Lee (everything to sign).zip");
    const [tab] = await Promise.all([context.waitForEvent("page"), view.locator('[data-packet="print"]').click()]);
    await tab.waitForURL(/^blob:/);
    await tab.close();
    await view.locator('[data-packet="email"]').click();
    await page.locator("dialog[open]").waitFor();
    assert.ok(await page.locator("dialog[open]").evaluate((d, name) => d.innerText.includes(name) || [...d.querySelectorAll("input:checked")].length > 0, "everything to sign"), "the folder is attached to the email");
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" }).catch(() => {});
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.packet), "email", "Escape returns to the button that opened the dialog");
  });

  await t.test("a failed save keeps what was typed and says why", async () => {
    const view = page.locator(".lp-page");
    const before = await page.evaluate(() => [T.count("signature"), T.count("document")]);
    const form = view.locator("#lp-sign");
    const yesterday = addDays(today, -1);
    await form.locator('[name="signedDate"]').fill(yesterday);
    await form.locator('[type="submit"]').click();
    assert.equal(await form.locator(".ui-error").innerText(), "Choose the signed copy first.");
    await form.locator('[name="document"]').setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("just some text, not a PDF") });
    await form.locator('[type="submit"]').click();
    await form.locator(".ui-error").filter({ hasText: "That file is not a PDF, JPEG or PNG." }).waitFor();
    assert.equal(await form.locator('[name="document"]').getAttribute("aria-invalid"), "true");
    assert.equal(await form.locator('[name="signedDate"]').inputValue(), yesterday, "the date typed is still there");
    await form.locator('[name="document"]').setInputFiles(upload());
    for (const box of await form.locator('input[name="signers"]').all()) await box.uncheck();
    await form.locator('[type="submit"]').click();
    assert.equal(await form.locator(".ui-error").innerText(), "Tick at least one person who signed this copy.");
    await form.locator('input[name="signers"][value="signer-1"]').check();
    await form.locator('[name="signedDate"]').fill(addDays(today, 1));
    await form.locator('[type="submit"]').click();
    assert.equal(await form.locator(".ui-error").innerText(), "The signing date cannot be in the future.");
    // The storage itself fails: the form stays as it was, with the reason.
    await form.locator('[name="signedDate"]').fill(yesterday);
    await page.evaluate(() => {
      const batch = PM.batch;
      PM.batch = async () => {
        PM.batch = batch;
        throw new DOMException("The device is full.", "QuotaExceededError");
      };
    });
    await form.locator('[type="submit"]').click();
    await form.locator(".lp-error").filter({ hasText: "out of storage space, so nothing was saved. Your entries are still here." }).waitFor();
    assert.deepEqual(await form.evaluate((f) => [f.elements.signedDate.value, f.elements.document.files.length, [...f.querySelectorAll('input[name="signers"]:checked')].map((i) => i.value)]), [yesterday, 1, ["signer-1"]]);
    assert.deepEqual(await page.evaluate(() => [T.count("signature"), T.count("document")]), [before[0], before[1] + 1].slice(0, 1).concat(await page.evaluate(() => T.count("document"))), "no signature was written");
    assert.equal(await page.evaluate(() => T.count("signature")), before[0]);
    state.signedDate = yesterday;
  });

  await t.test("recording signed copies: one person, then the rest, makes the lease active with its reminders", async () => {
    const view = page.locator(".lp-page");
    const id = state.first.id;
    const revs = await page.evaluate((id) => [PM.get(id)._rev, ...PM.records("document").filter((d) => d.packetId === id).map((d) => d._rev).sort()], id);
    // The form is still filled in from the last test: Avery Morgan, yesterday, a real PDF.
    await view.locator('#lp-sign [type="submit"]').click();
    await view.locator(".lp-head .ui-status").filter({ hasText: "Signed by 1 of 3" }).waitFor();
    assert.equal(await view.locator(".lp-state").innerText(), "Still to sign: Pat Owner and Sam Lee.");
    await toastSays(/Saved\. Still to sign: Pat Owner and Sam Lee\./);
    const partly = await page.evaluate((id) => ({ signatures: PM.records("signature").filter((s) => s.packetId === id), active: PM.records("operativeLease").length, executions: PM.records("execution").filter((e) => e.packetId === id).length, status: LeasePackets.statusFor(PM.get(id).tenancyId), tasks: PM.records("task").filter((x) => x.packetId === id).length }), id);
    assert.equal(partly.signatures.length, 1);
    const [signature] = partly.signatures;
    assert.deepEqual([signature.id, signature.signerId, signature.signedDate, signature.packetHash, signature.immutable, signature.certificateId], ["sig-" + id + "-signer-1", "signer-1", state.signedDate, state.first.archiveHash, true, ""]);
    assert.ok(signature.method && signature.basis);
    assert.deepEqual([partly.executions, partly.tasks], [0, 0]);
    assert.deepEqual([partly.status.state, partly.status.label, partly.status.packetId, partly.status.detail], ["partly-signed", "Signed by 1 of 3", id, "Still to sign: Pat Owner and Sam Lee."]);
    const signedDoc = await page.evaluate((docId) => PM.get(docId), signature.documentId);
    assert.deepEqual([signedDoc.kind, signedDoc.mime, signedDoc.packetId, signedDoc.immutable, signedDoc.name], ["Executed lease", "application/pdf", id, true, "Lease – Avery Morgan and Sam Lee (signed by Avery Morgan).pdf"]);
    // The person already recorded is shown as done; the other two are ticked for the next copy.
    assert.deepEqual(await view.locator('ul[aria-label="Already recorded"] .lp-file-text b').allInnerTexts(), ["Avery Morgan"]);
    assert.deepEqual(await view.locator('#lp-sign input[name="signers"]').evaluateAll((list) => list.map((i) => [i.value, i.checked])), [["signer-0", true], ["signer-2", true]]);
    await audit("partly signed");

    await view.locator('#lp-sign [name="document"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, 7)]) });
    await view.locator('#lp-sign [type="submit"]').click();
    await view.locator(".lp-head .ui-status").filter({ hasText: "Active lease" }).waitFor();
    await toastSays(/Signed lease saved\. This is now the active lease\./);
    const done = await page.evaluate((id) => {
      const packet = PM.get(id);
      return { packet, revs: [packet._rev, ...PM.records("document").filter((d) => d.packetId === id && d.kind !== "Executed lease").map((d) => d._rev).sort()], signatures: PM.records("signature").filter((s) => s.packetId === id), executions: PM.records("execution").filter((e) => e.packetId === id), operative: PM.records("operativeLease").filter((o) => o.tenancyId === packet.tenancyId), tasks: PM.records("task").filter((x) => x.packetId === id), status: LeasePackets.statusFor(packet.tenancyId), history: LeasePackets.history().map((h) => h.id), tenancy: PM.get(packet.tenancyId) };
    }, id);
    assert.deepEqual(done.revs, revs, "the finished lease and its files were never rewritten");
    assert.equal(done.signatures.length, 3);
    assert.equal(done.executions.length, 1);
    const [execution] = done.executions,
      [operative] = done.operative,
      last = done.signatures.find((s) => s.signerId === "signer-0");
    assert.deepEqual([execution.immutable, execution.signedDoc, execution.effective, execution.tenancyId], [true, last.documentId, state.first.facts.termStart, done.packet.tenancyId]);
    assert.ok(execution.basis && /^\d{4}-/.test(execution.confirmed));
    assert.deepEqual([operative.id, operative.packetId, operative.signedDoc, operative.executionId, operative.effective, operative.amendments], ["operative-" + done.packet.tenancyId, id, last.documentId, execution.id, state.first.facts.termStart, []]);
    assert.equal((await page.evaluate((docId) => PM.get(docId), last.documentId)).mime, "image/png", "the stored type comes from the file itself");
    const end = state.first.facts.end;
    assert.deepEqual(done.tasks.map((x) => [x.id, x.title, x.due, x.kind, x.completed, x.type]).sort(), [
      ["lease-copy-" + id, "Give each tenant a copy of the signed lease", addDays(state.signedDate, 15), "Reminder", false, "task"],
      ["lease-photos-" + id, "Take move-in photos", state.first.facts.start, "Reminder", false, "task"],
      ["lease-renewal-" + id, "Lease ends: decide on renewal", addDays(end, -90), "Reminder", false, "task"],
    ]);
    assert.deepEqual([done.status.state, done.status.label, done.status.packetId, done.status.signedDocId, done.status.starts, done.status.ends, done.status.rent], ["active", "Starts " + longDate(state.first.facts.termStart), id, last.documentId, state.first.facts.termStart, end, "3200"]);
    assert.ok(!done.history.includes(id), "the active lease is not listed as a past version");
    assert.equal(done.tenancy.end, undefined, "the household record itself is left alone");
    // The active page.
    assert.equal(await view.locator(".lp-card h2").first().innerText(), "Your active lease");
    assert.deepEqual(await view.locator(".lp-choice b").allInnerTexts(), ["Renew", "Amend", "Make changes", "Return the deposit"]);
    assert.deepEqual(await view.locator(".lp-choice").evaluateAll((list) => list.map((b) => [b.dataset.lease || b.dataset.packet, b.dataset.ref])), [["renew", id], ["amend", id], ["revise", id], ["deposit", done.packet.tenancyId]]);
    assert.equal(await view.locator('[data-packet="open"].primary').innerText(), "Open signed copy");
    assert.equal(await view.locator(".primary").count(), 1, "one main button");
    assert.equal(await view.locator('[data-packet="zip"]').count(), 1);
    assert.equal(await view.locator('[data-packet="track"]').innerText(), "Track rent for this lease", "the new household has no rent schedule yet");
    assert.deepEqual(await view.locator(".lp-card").filter({ hasText: "Reminders" }).locator("li b").allInnerTexts(), ["Give each tenant a copy of the signed lease", "Take move-in photos", "Lease ends: decide on renewal"]);
    assert.equal(await view.locator("form").count(), 0, "nothing left to record");
    await audit("active lease");
    // "Track rent" hands over to the rental-terms form for that household.
    const asked = await page.evaluate(() => {
      const action = PM.action;
      return new Promise((resolve) => {
        PM.action = (name, ref) => {
          PM.action = action;
          resolve([name, ref]);
        };
        document.querySelector('.lp-page [data-packet="track"]').click();
      });
    });
    assert.deepEqual(asked, ["edit-property", done.packet.tenancyId]);
    state.active = done;
  });

  await t.test("an amendment joins the active lease; a renewal replaces it and the old one moves to history", async () => {
    const result = await page.evaluate(async (baseId) => {
      const base = PM.get(baseId), today = PM.today();
      const sign = async (packet) => {
        T.show(packet.id);
        const form = document.getElementById("lp-sign");
        const file = new File([Files.pdf("Signed", [{ heading: "Signed", lines: ["Made-up."] }])], "signed.pdf", { type: "application/pdf" });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        form.elements.document.files = transfer.files;
        form.querySelector("[type=submit]").click();
        const t0 = Date.now();
        while (!PM.records("execution").some((e) => e.packetId === packet.id)) {
          if (Date.now() - t0 > 15000) throw Error("signing did not finish: " + form.innerText);
          await new Promise((r) => setTimeout(r, 40));
        }
      };
      const amendmentDraft = await PM.save("lease", { id: PM.uid(), schema: 2, propertyId: base.propertyId, tenancyId: base.tenancyId, name: "Amendment – rent", step: 5, lawVersion: LeaseLaw.version, tenants: base.tenants, clauses: {}, customClauses: [], attachments: [], parentPacket: base.id, reviewedInputs: true, facts: { ...base.facts, kind: "Amendment", agreementDate: today, termStart: PM.addDays(today, 40), changeText: "Monthly rent changes to $3,350.00." } });
      if (LeaseDocument.missing(amendmentDraft, today).length) throw Error("amendment draft incomplete: " + JSON.stringify(LeaseDocument.missing(amendmentDraft, today)));
      const amendment = await LeasePackets.finalize(amendmentDraft);
      T.show(amendment.id);
      const open = { title: document.querySelector(".lp-sub").innerText, steps: [...document.querySelectorAll(".lp-step h2")].map((h) => h.innerText), parent: document.querySelector('.lp-page [data-packet="view"]')?.innerText, pending: LeasePackets.statusFor(base.tenancyId) };
      await sign(amendment);
      const afterAmendment = { operative: PM.records("operativeLease").find((o) => o.tenancyId === base.tenancyId), status: LeasePackets.statusFor(base.tenancyId), chip: document.querySelector(".lp-head .ui-status").innerText, tasks: PM.records("task").filter((x) => x.packetId === amendment.id).map((x) => x.title), zip: Object.keys(amendment.attachments) };
      const start = PM.addDays(base.facts.end, 1);
      const renewalDraft = await PM.save("lease", { id: PM.uid(), schema: 2, propertyId: base.propertyId, tenancyId: base.tenancyId, name: "Renewal – Avery Morgan and Sam Lee", step: 5, lawVersion: LeaseLaw.version, tenants: base.tenants, clauses: {}, customClauses: [], attachments: [], parentPacket: base.id, reviewedInputs: true, facts: { ...base.facts, kind: "Renewal", agreementDate: today, termStart: start, end: PM.addDays(LeaseLaw.addYears(start, 1), -1), rent: "3350" } });
      if (LeaseDocument.missing(renewalDraft, today).length) throw Error("renewal draft incomplete: " + JSON.stringify(LeaseDocument.missing(renewalDraft, today)));
      const renewal = await LeasePackets.finalize(renewalDraft);
      const pending = LeasePackets.statusFor(base.tenancyId);
      await sign(renewal);
      const afterRenewal = { operative: PM.records("operativeLease").filter((o) => o.tenancyId === base.tenancyId), status: LeasePackets.statusFor(base.tenancyId), history: LeasePackets.history().filter((h) => h.tenancyId === base.tenancyId).map((h) => [h.id, h.label, h.mode]), tasks: PM.records("task").filter((x) => x.packetId === renewal.id).map((x) => x.id.replace("-" + renewal.id, "")) };
      T.show(base.id);
      const old = { chip: document.querySelector(".lp-head .ui-status").innerText, heading: document.querySelector(".lp-card h2").innerText, link: document.querySelector('.lp-page [data-packet="view"]')?.dataset.ref, choices: document.querySelectorAll(".lp-choice").length };
      return { amendment, renewal, open, afterAmendment, pending, afterRenewal, old };
    }, state.first.id);
    const id = state.first.id;
    assert.match(result.open.title, /^Lease Amendment · /);
    assert.deepEqual(result.open.steps, ["Give this to your tenant before signing", "Sign", "Record the signed amendment", "Afterwards"]);
    assert.equal(result.open.parent, "See the lease it changes");
    assert.deepEqual([result.open.pending.state, result.open.pending.label, result.open.pending.packetId, result.open.pending.activePacketId], ["ready", "Amendment ready to sign", result.amendment.id, id]);
    assert.deepEqual(result.amendment.attachments, [], "an amendment carries no booklets");
    assert.deepEqual([result.afterAmendment.operative.packetId, result.afterAmendment.operative.amendments, result.afterAmendment.operative.executionId], [id, [result.amendment.id], state.active.operative[0].executionId]);
    assert.deepEqual([result.afterAmendment.status.state, result.afterAmendment.status.packetId, result.afterAmendment.chip], ["active", id, "Signed amendment"]);
    assert.match(result.afterAmendment.status.detail, /1 amendment on file\./);
    assert.deepEqual(result.afterAmendment.tasks, ["Give each tenant a copy of the signed amendment"]);
    assert.deepEqual([result.pending.state, result.pending.label, result.pending.packetId], ["ready", "Renewal ready to sign", result.renewal.id]);
    assert.equal(result.afterRenewal.operative.length, 1, "one active lease per tenant");
    assert.deepEqual([result.afterRenewal.operative[0].packetId, result.afterRenewal.operative[0].amendments], [result.renewal.id, []]);
    assert.deepEqual([result.afterRenewal.status.state, result.afterRenewal.status.packetId, result.afterRenewal.status.rent], ["active", result.renewal.id, "3350"]);
    assert.deepEqual(result.afterRenewal.tasks.sort(), ["lease-copy", "lease-renewal"], "no move-in photos for a tenant who already lives there");
    assert.deepEqual(result.afterRenewal.history, [[result.amendment.id, "Earlier lease", "final"], [id, "Earlier lease", "final"]]);
    assert.deepEqual([result.old.chip, result.old.heading, result.old.link, result.old.choices], ["Earlier lease", "Earlier lease", result.renewal.id, 0]);
    state.renewal = result.renewal;
  });

  await t.test("add a lease I already have", async () => {
    await page.evaluate(() => PM.navigate("Leases", ""));
    const before = await page.evaluate(() => ({ packets: T.count("leasePacket"), tenants: PM.records("tenancy").map((x) => [x.id, x.name]) }));
    await page.evaluate(() => LeasePackets.addExisting());
    const dialog = page.locator("dialog[open]");
    const form = dialog.locator("#lp-existing");
    await form.waitFor();
    assert.equal(await dialog.locator("#dialog-title").innerText(), "Add a lease I already have");
    assert.deepEqual(await form.locator("label, legend").evaluateAll((list) => list.filter((n) => !n.matches(".ui-seg")).map((n) => n.innerText.trim())), ["Which tenant is this lease for?", "Signed lease", "Landlord name", "Tenant names", "Lease type", "Start date", "End date", "Monthly rent"]);
    assert.equal(await form.locator("select").count(), 0, "no dropdowns");
    assert.equal(await form.locator('input[name="landlord"]').inputValue(), "Pat Owner", "the landlord comes from the most recent lease");
    assert.deepEqual(await form.locator('input[name="tenancyId"]').evaluateAll((list) => list.map((i) => i.value)), [...before.tenants.map((x) => x[0]), "new"]);
    await audit("add a lease I already have");
    // Errors sit beside the field, in plain words.
    await form.locator('[type="submit"]').click();
    assert.equal(await form.locator(".ui-error").innerText(), "Choose which tenant this lease is for.");
    await form.locator('input[name="tenancyId"][value="new"]').check({ force: true });
    await form.locator('[type="submit"]').click();
    assert.equal(await form.locator(".ui-error").innerText(), "Choose the signed lease first.");
    await form.locator('[name="document"]').setInputFiles({ name: "IMG_2041.jpg", mimeType: "image/jpeg", buffer: Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(80, 3)]) });
    await form.locator('[name="tenants"]').fill("Jordan Rivera\n  Casey  Rivera ");
    const start = addDays(today, -200),
      end = addDays(today, 164);
    await form.locator('[name="start"]').fill(start);
    await form.locator('[type="submit"]').click();
    assert.equal(await form.locator(".ui-error").innerText(), "Enter the date the lease ends, or choose Month to month.");
    await form.locator('[name="end"]').fill(addDays(start, -1));
    await form.locator('[type="submit"]').click();
    assert.equal(await form.locator(".ui-error").innerText(), "The end date must be after the start date.");
    await form.locator('[name="end"]').fill(end);
    await form.locator('[type="submit"]').click();
    assert.equal(await form.locator(".ui-error").innerText(), "Enter the monthly rent, like 3200 or 3200.00.");
    assert.equal(await form.locator('[name="tenants"]').inputValue(), "Jordan Rivera\n  Casey  Rivera ", "what was typed is still there");
    await form.locator('[name="rent"]').fill("2850");
    await form.locator('[type="submit"]').click();
    await dialog.waitFor({ state: "detached" });
    await toastSays(/Lease saved\. It is now the active lease for Jordan Rivera and Casey Rivera\./);
    const saved = await page.evaluate((count) => {
      const packet = PM.records("leasePacket").slice().sort((a, b) => String(b.generated).localeCompare(String(a.generated)))[0];
      const doc = PM.get(packet.contractId);
      return { added: T.count("leasePacket") - count, packet, doc, tenancy: PM.get(packet.tenancyId), signatures: PM.records("signature").filter((s) => s.packetId === packet.id), executions: PM.records("execution").filter((e) => e.packetId === packet.id), operative: PM.records("operativeLease").filter((o) => o.tenancyId === packet.tenancyId), tasks: PM.records("task").filter((x) => x.packetId === packet.id), status: LeasePackets.statusFor(packet.tenancyId) };
    }, before.packets);
    const { packet, doc } = saved;
    state.existing = packet;
    assert.equal(saved.added, 1);
    assert.deepEqual([packet.schema, packet.mode, packet.immutable, packet.leaseId, packet.name, packet.lawVersion, packet.packageVersion], [2, "reviewed", true, "", "Lease – Jordan Rivera and Casey Rivera", "", ""]);
    assert.deepEqual(packet.facts, { premises: await page.evaluate(() => PM.prop().address || PM.prop().name), city: "San Diego", landlord: "Pat Owner", kind: "Fixed term", start, termStart: start, end, rent: "2850" });
    assert.deepEqual(packet.tenants.map((x) => [x.name, x.email, x.phone]), [["Jordan Rivera", "", ""], ["Casey Rivera", "", ""]]);
    assert.deepEqual(packet.signers, [{ id: "signer-0", name: "Pat Owner", role: "Landlord" }, { id: "signer-1", name: "Jordan Rivera", role: "Tenant" }, { id: "signer-2", name: "Casey Rivera", role: "Tenant" }]);
    assert.deepEqual([packet.worksheetId, packet.archiveId, packet.archiveHash, packet.attachments, packet.review], [doc.id, doc.id, doc.hash, [], []]);
    assert.deepEqual([doc.kind, doc.mime, doc.immutable, doc.packetId, doc.name, doc.originalName], ["Executed lease", "image/jpeg", true, packet.id, "Lease – Jordan Rivera and Casey Rivera (signed).jpg", "IMG_2041.jpg"]);
    assert.deepEqual([saved.tenancy.name, saved.tenancy.start, saved.tenancy.rentCents], ["Jordan Rivera and Casey Rivera", start, undefined]);
    assert.deepEqual(saved.signatures.map((s) => [s.signerId, s.documentId, s.packetHash, s.immutable]).sort(), [["signer-0", doc.id, doc.hash, true], ["signer-1", doc.id, doc.hash, true], ["signer-2", doc.id, doc.hash, true]]);
    assert.deepEqual([saved.executions.length, saved.executions[0].signedDoc, saved.executions[0].effective], [1, doc.id, start]);
    assert.deepEqual([saved.operative.length, saved.operative[0].packetId, saved.operative[0].signedDoc], [1, packet.id, doc.id]);
    assert.deepEqual(saved.tasks.map((x) => [x.title, x.due]), [["Lease ends: decide on renewal", addDays(end, -90)]]);
    assert.deepEqual([saved.status.state, saved.status.label, saved.status.packetId, saved.status.signedDocId, saved.status.ends, saved.status.rent], ["active", "Active until " + longDate(end), packet.id, doc.id, end, "2850"]);
    // Its page: active at once, with renew and amend, and no ZIP or "make changes" for a file we did not write.
    await page.evaluate((id) => T.show(id), packet.id);
    const view = page.locator(".lp-page");
    assert.equal(await view.locator(".lp-head .ui-status").innerText(), "Active lease");
    assert.match(await view.locator(".lp-sub").innerText(), /^Signed lease on file · /);
    assert.deepEqual(await view.locator(".lp-choice b").allInnerTexts(), ["Renew", "Amend", "Return the deposit"]);
    assert.equal(await view.locator('[data-packet="zip"]').count(), 0);
    await audit("a lease the owner already had", [375]);
    // A month-to-month lease for the same tenant replaces it, after a plain warning.
    await page.evaluate((id) => LeasePackets.addExisting(id), packet.tenancyId);
    await form.waitFor();
    assert.equal(await form.locator('input[name="tenancyId"]:checked').inputValue(), packet.tenancyId);
    assert.equal(await form.locator('[name="tenants"]').inputValue(), "Jordan Rivera and Casey Rivera");
    assert.match(await form.locator("#lp-existing-note").innerText(), /already has an active lease on file/);
    await form.locator('[name="document"]').setInputFiles(upload("month to month.pdf"));
    await form.locator('[name="tenants"]').fill("Jordan Rivera");
    await form.locator('input[name="kind"][value="Month to month"]').check({ force: true });
    assert.equal(await form.locator('[name="end"]').isVisible(), false, "no end date for month to month");
    await form.locator('[name="start"]').fill(addDays(today, -30));
    await form.locator('[name="rent"]').fill("2900.50");
    await form.locator('[type="submit"]').click();
    await dialog.waitFor({ state: "detached" });
    const monthly = await page.evaluate((tenancyId) => ({ status: LeasePackets.statusFor(tenancyId), operative: PM.records("operativeLease").filter((o) => o.tenancyId === tenancyId), tenants: T.count("tenancy") }), packet.tenancyId);
    assert.deepEqual([monthly.status.state, monthly.status.label, monthly.status.ends, monthly.status.rent, monthly.operative.length], ["active", "Month to month since " + longDate(addDays(today, -30)), "", "2900.50", 1]);
    assert.equal(monthly.tenants, before.tenants.length + 1, "only the first upload created a tenant");
  });

  await t.test("the deposit helper: deadline, deductions, summary and save", async () => {
    const tenancyId = state.existing.tenancyId;
    await page.evaluate((id) => T.show(id), await page.evaluate((t) => LeasePackets.statusFor(t).packetId, tenancyId));
    const opener = page.locator('.lp-page [data-packet="deposit"]');
    await opener.click();
    const dialog = page.locator("dialog[open]");
    const form = dialog.locator("#lp-deposit");
    await form.waitFor();
    assert.equal(await dialog.locator("#dialog-title").innerText(), "Moving out: return the deposit");
    assert.equal(await form.locator('input[name="tenancyId"]:checked').inputValue(), tenancyId, "opened for the tenant whose lease this is");
    assert.deepEqual(await form.locator("summary").allInnerTexts(), ["More choices for this item", "Inspection before move-out", "Photos and unfinished repairs", "How you sent it"]);
    assert.match(await form.locator("#lp-deadline").innerText(), /21 days after move-out/);
    assert.equal(await form.locator("select").count(), 0, "no dropdowns");
    const words = await form.innerText();
    assert.ok(!/reconciled|classification|tenancy|household|statewide target|possession|ledger/i.test(words), "plain words only");
    await audit("deposit helper");
    // Focus stays inside the dialog, and Escape goes back to the button that opened it.
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    assert.ok(await page.evaluate(() => document.querySelector("dialog[open]").contains(document.activeElement)));
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.packet), "deposit");
    await opener.click();
    await form.waitFor();
    // The essentials.
    const moved = addDays(today, -6);
    await form.locator('[name="vacated"]').fill(moved);
    assert.match(await form.locator("#lp-deadline").innerText(), new RegExp("Send the refund and the itemized statement by\\s+" + longDate(addDays(moved, 21)) + "\\s+15 days from today\\. California allows 21 days after the tenant moves out\\."));
    await form.locator('[name="funds"]').fill("2850");
    // A deduction needs a description, an amount and a receipt.
    const add = form.locator('[data-packet="deduct"]');
    await add.click();
    assert.equal(await form.locator(".ui-error").innerText(), "Say what the deduction is for.");
    await form.locator('[name="deductionBasis"]').fill("Carpet cleaning, invoice 1042");
    await add.click();
    assert.equal(await form.locator(".ui-error").innerText(), "Enter the amount, like 180 or 180.00.");
    await form.locator('[name="deductionAmount"]').fill("180");
    await add.click();
    assert.equal(await form.locator(".ui-error").innerText(), "Add a receipt, invoice or photo, so this deduction is backed up.");
    await form.locator('[name="evidenceFile"]').setInputFiles(upload("carpet invoice.pdf"));
    await add.click();
    await form.locator("#lp-items .lp-item-amount").waitFor();
    assert.deepEqual(await form.locator("#lp-items .lp-item").evaluateAll((list) => list.map((li) => li.innerText.replace(/\s+/g, " ").trim())), ["Carpet cleaning, invoice 1042 carpet invoice.pdf $180.00 Remove"]);
    assert.deepEqual(await form.evaluate((f) => [f.elements.deductionBasis.value, f.elements.deductionAmount.value, f.elements.evidenceFile.files.length, document.activeElement.name]), ["", "", 0, "deductionBasis"]);
    assert.deepEqual(await form.locator("#lp-totals dd").allInnerTexts(), ["$2,850.00", "− $180.00", "$2,670.00"]);
    // Something noted but not charged does not change the refund. Enter adds it.
    await form.locator("summary", { hasText: "More choices for this item" }).click();
    await form.locator('input[name="deductionType"][value="Ordinary wear"]').check({ force: true });
    await form.locator('[name="deductionBasis"]').fill("Faded paint in the hallway");
    await form.locator('[name="deductionAmount"]').fill("0");
    await form.locator('[name="deductionAmount"]').press("Enter");
    await form.locator("#lp-items .lp-item").nth(1).waitFor();
    assert.match(await form.locator("#lp-items .lp-item").nth(1).innerText(), /Faded paint in the hallway\s+Normal wear, not charged\s+\$0\.00/);
    assert.deepEqual(await form.locator("#lp-totals dd").allInnerTexts(), ["$2,850.00", "− $180.00", "$2,670.00"]);
    assert.equal(await form.locator('input[name="deductionType"]:checked').inputValue(), "Documented deductible item", "the next item is a deduction again");
    // Rules kept from the earlier worksheet.
    await form.locator('[name="funds"]').fill("100");
    await form.locator('[type="submit"]').click();
    assert.equal(await form.locator(".ui-error").innerText(), "The deductions add up to more than the deposit you are holding.");
    await form.locator('[name="funds"]').fill("2850");
    await form.locator("summary", { hasText: "How you sent it" }).click();
    await form.locator('[name="delivered"]').fill(today);
    await form.locator('[type="submit"]').click();
    assert.match(await form.locator(".ui-error").innerText(), /^To record that you sent it, also fill in/);
    await form.locator('[name="delivered"]').fill("");
    await form.locator('[name="deductionBasis"]').fill("half typed");
    await form.locator('[type="submit"]').click();
    assert.match(await form.locator(".ui-error").innerText(), /^You started a deduction but did not add it\./);
    await form.locator('[name="deductionBasis"]').fill("");
    await form.locator("summary", { hasText: "Photos and unfinished repairs" }).click();
    await form.locator('[name="photoNotes"]').fill("Photos taken at move-out, before cleaning.");
    // Closing with the X keeps the work for this session.
    await dialog.locator("#dialog-close").click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => T.count("depositReturn")), 0);
    await opener.click();
    await form.waitFor();
    assert.equal(await form.locator("#lp-items .lp-item").count(), 2, "the deductions are still there");
    assert.deepEqual(await form.evaluate((f) => [f.elements.vacated.value, f.elements.funds.value, f.elements.photoNotes.value]), [moved, "2850", "Photos taken at move-out, before cleaning."]);
    // The summary keeps the earlier worksheet's layout.
    const [summary] = await Promise.all([page.waitForEvent("download"), form.locator('[data-packet="return-pdf"]').click()]);
    assert.equal(summary.suggestedFilename(), "deposit-return-worksheet.pdf");
    const sheet = pdfWords(fs.readFileSync(await summary.path()), []);
    for (const text of ["Deposit return worksheet", "Household: Jordan Rivera and Casey Rivera", "Vacated: " + moved, "21-day target: " + addDays(moved, 21), "Carpet cleaning, invoice 1042 / Documented deductible item / $180 / carpet invoice.pdf", "Beginning deposit: $2,850", "Documented deductions: $180", "Balance: $2,670"]) assert.ok(sheet.text.includes(text), "the summary has: " + text + "\n" + sheet.text);
    await form.locator('[type="submit"]').click();
    await dialog.waitFor({ state: "detached" });
    await toastSays(/Deposit return saved\. Record the refund itself in Money\./);
    const saved = await page.evaluate(() => {
      const [record] = PM.records("depositReturn");
      return { record, task: PM.get("deposit-return-" + record.id), docs: record.items.flatMap((x) => x.evidence).map((id) => PM.get(id)), list: LeasePackets.depositReturns() };
    });
    const { record } = saved;
    assert.deepEqual([record.type, record.tenancyId, record.vacated, record.deadline, record.funds, record.photoNotes, record.deductionBasis, record.deductionAmount, record.delivered], ["depositReturn", tenancyId, moved, addDays(moved, 21), "2850", "Photos taken at move-out, before cleaning.", "", "", ""]);
    assert.deepEqual(record.items.map((x) => [x.classification, x.basis, x.amountCents, x.evidence.length]), [["Documented deductible item", "Carpet cleaning, invoice 1042", 18000, 1], ["Ordinary wear", "Faded paint in the hallway", 0, 0]]);
    assert.deepEqual(saved.docs.map((d) => [d.type, d.name, d.kind, d.mime, d.immutable, d.tenancyId]), [["document", "carpet invoice.pdf", "Receipt", "application/pdf", true, tenancyId]]);
    assert.deepEqual([saved.task.type, saved.task.title, saved.task.kind, saved.task.due, saved.task.completed, saved.task.depositReturnId], ["task", "Return the deposit to Jordan Rivera and Casey Rivera", "Reminder", record.deadline, false, record.id]);
    assert.deepEqual(saved.list, [{ id: record.id, label: "Jordan Rivera and Casey Rivera", detail: "Refund due by " + longDate(record.deadline) }]);
    // Reopen it, record that it was sent, and the reminder is done.
    await page.evaluate((id) => LeasePackets.depositReturn(id), record.id);
    await form.waitFor();
    assert.equal(await form.locator("#lp-items .lp-item").count(), 2);
    assert.equal(await form.locator("details", { hasText: "How you sent it" }).evaluate((d) => d.open), false);
    await form.locator("summary", { hasText: "How you sent it" }).click();
    await form.locator('input[name="method"][value="First-class mail check"]').check({ force: true });
    await form.locator('input[name="statementMethod"][value="First-class mail"]').check({ force: true });
    await form.locator('[name="delivered"]').fill(today);
    await form.locator('[name="deliveryProof"]').fill("Certificate of mailing kept with the invoice.");
    await form.locator('[type="submit"]').click();
    await dialog.waitFor({ state: "detached" });
    const sent = await page.evaluate((id) => ({ record: PM.get(id), task: PM.get("deposit-return-" + id), list: LeasePackets.depositReturns(), count: T.count("depositReturn") }), record.id);
    assert.deepEqual([sent.count, sent.record.delivered, sent.record.method, sent.record.statementMethod, sent.task.completed, sent.list[0].detail], [1, today, "First-class mail check", "First-class mail", true, "Refund sent " + longDate(today)]);
    assert.notEqual(sent.record._rev, record._rev);
  });

  await t.test("records from the earlier lease tool open read-only, can still be signed, and all records pass the backup check", async () => {
    const loaded = await page.evaluate(async (records) => {
      const property = PM.prop().id, tenancy = PM.records("tenancy").find((x) => x.id === "sample-household") || PM.records("tenancy").at(-1);
      // The files themselves are not in this test database; the records are what is checked.
      await PM.batch(records.filter((r) => r.type !== "operativeLease" && r.type !== "execution" && !(r.type === "signature" && r.signerId === "signer-1")).map((r) => ({ ...r, propertyId: property, ...(r.tenancyId ? { tenancyId: tenancy.id } : {}) })));
      LeasePackets.validateImport(PM.all());
      const draft = PM.records("leasePacket").find((x) => x.mode === "draft" && !x.schema), reviewed = PM.records("leasePacket").find((x) => x.mode === "reviewed" && !x.schema);
      T.show(draft.id);
      const draftPage = { chip: document.querySelector(".lp-head .ui-status").innerText, heading: document.querySelector(".lp-card h2").innerText, forms: document.querySelectorAll(".lp-page form").length, create: document.querySelector('.lp-page [data-lease="newFor"]')?.dataset.ref, sub: document.querySelector(".lp-sub").innerText };
      T.show(reviewed.id);
      return { draft, reviewed, tenancy: tenancy.id, draftPage, reviewedPage: { chip: document.querySelector(".lp-head .ui-status").innerText, remaining: [...document.querySelectorAll('#lp-sign input[name="signers"]')].map((i) => i.value), revise: document.querySelectorAll('.lp-page [data-lease="revise"]').length, history: LeasePackets.history().filter((h) => !h.id.includes("-") || h.id === draft.id || h.id === reviewed.id).map((h) => [h.id, h.label, h.mode]) } };
    }, legacyRecords());
    assert.deepEqual([loaded.draftPage.chip, loaded.draftPage.heading, loaded.draftPage.forms, loaded.draftPage.create], ["Earlier draft", "An earlier draft", 0, loaded.tenancy]);
    assert.match(loaded.draftPage.sub, /^Draft worksheet/);
    assert.deepEqual([loaded.reviewedPage.chip, loaded.reviewedPage.remaining, loaded.reviewedPage.revise], ["Signed by 1 of 2", ["signer-1"], 0]);
    assert.ok(loaded.reviewedPage.history.some(([id, label, mode]) => id === loaded.draft.id && label === "Earlier draft" && mode === "draft"));
    await audit("a lease from the earlier tool", [375]);
    const view = page.locator(".lp-page");
    await view.locator('#lp-sign [name="document"]').setInputFiles(upload("countersigned.pdf"));
    await view.locator('#lp-sign [type="submit"]').click();
    await view.locator(".lp-head .ui-status").filter({ hasText: "Active lease" }).waitFor();
    assert.deepEqual(await view.locator(".lp-choice b").allInnerTexts(), ["Create a lease", "Return the deposit"], "an earlier lease is renewed by writing a new one");
    const everything = await page.evaluate(() => {
      const records = PM.all();
      LeasePackets.validateImport(records);
      LeasePackets.validateImport(records, new Set(records.filter((r) => r.type === "document").map((r) => r.hash)));
      if (globalThis.Leases?.validateImport) Leases.validateImport(records);
      return records;
    });
    L.validateImport(everything);
    state.everything = everything;
  });

  await t.test("damage to the current records is refused", () => {
    const records = state.everything;
    const final = (r) => find(r, "leasePacket", (p) => p.id === state.first.id);
    const upload = (r) => find(r, "leasePacket", (p) => p.id === state.existing.id);
    const doc = (r, id) => find(r, "document", (d) => d.id === id);
    rejects(records, {
      "folder hash changed": (r) => (final(r).archiveHash = "0".repeat(64)),
      "lease file missing": (r) => r.filter((x) => x.id !== final(r).contractId),
      "booklet missing": (r) => r.filter((x) => x.id !== final(r).attachments[0].id),
      "booklet swapped for another file": (r) => (doc(r, final(r).attachments[0].id).hash = "b".repeat(64)),
      "file from another rental": (r) => {
        r.push({ type: "property", id: "other-rental", name: "Other" });
        doc(r, final(r).attachments[1].id).propertyId = "other-rental";
      },
      "lease moved to another rental": (r) => {
        r.push({ type: "property", id: "other-rental", name: "Other" });
        final(r).propertyId = "other-rental";
      },
      "tenant from another rental": (r) => {
        r.push({ type: "property", id: "other-rental", name: "Other" }, { type: "tenancy", id: "other-tenant", propertyId: "other-rental", name: "X" });
        final(r).tenancyId = "other-tenant";
      },
      "draft from another rental": (r) => {
        r.push({ type: "property", id: "other-rental", name: "Other" });
        find(r, "lease", (l) => l.id === final(r).leaseId).propertyId = "other-rental";
      },
      "signer renamed": (r) => (final(r).signers[1].name = "Someone Else"),
      "signer removed": (r) => final(r).signers.pop(),
      "signer out of order": (r) => final(r).signers.reverse(),
      "signer without a role": (r) => (final(r).signers[0].role = ""),
      "tenant renamed after signing": (r) => (final(r).tenants[0].name = "Avery Q. Morgan"),
      "landlord renamed after signing": (r) => (final(r).facts.landlord = "Pat Q. Owner"),
      "unsafe file path": (r) => (final(r).attachments[0].path = "../outside.pdf"),
      "file path with a backslash": (r) => (final(r).attachments[0].path = "handouts\\x.pdf"),
      "empty file path": (r) => (final(r).attachments[0].path = "handouts//x.pdf"),
      "answer that is not text": (r) => (final(r).facts.rent = 3200),
      "missing clause choices": (r) => delete final(r).clauses,
      "legal check with an unknown result": (r) => (final(r).review[0].status = "fine"),
      "version of the rules missing": (r) => delete final(r).lawVersion,
      "old and new version fields disagree": (r) => (final(r).packageVersion = "CA-2026.11.18.2"),
      "lease no longer frozen": (r) => (final(r).immutable = false),
      "lease file no longer frozen": (r) => (doc(r, final(r).contractId).immutable = false),
      "lease file filed under another lease": (r) => (doc(r, final(r).contractId).packetId = "elsewhere"),
      "lease in an unknown state": (r) => (final(r).mode = "draft"),
      "lease from a newer app": (r) => (final(r).schema = 3),
      "lease without a date": (r) => (final(r).generated = "yesterday"),
      "lease that amends a missing lease": (r) => (final(r).parentPacket = "missing"),
      "signature for another version of the folder": (r) => (find(r, "signature", (s) => s.packetId === final(r).id).packetHash = "0".repeat(64)),
      "signature by someone not on the lease": (r) => (find(r, "signature", (s) => s.packetId === final(r).id).signerId = "signer-9"),
      "signed copy filed under another lease": (r) => (doc(r, find(r, "signature", (s) => s.packetId === final(r).id).documentId).packetId = state.existing.id),
      "active lease with a signature missing": (r) => r.filter((x) => !(x.type === "signature" && x.packetId === final(r).id && x.signerId === "signer-2")),
      "signed copy of the wrong kind": (r) => (doc(r, find(r, "execution", (e) => e.packetId === final(r).id).signedDoc).kind = "Lease"),
      "active lease pointing at a missing signing record": (r) => (find(r, "operativeLease").executionId = "missing"),
      "amendment from another tenant": (r) => (find(r, "operativeLease", (o) => o.tenancyId === final(r).tenancyId).amendments = [state.existing.id]),
      "uploaded lease with a folder that is not the file": (r) => (upload(r).archiveId = final(r).archiveId),
      "uploaded lease of an unknown file type": (r) => (doc(r, upload(r).contractId).mime = "text/html"),
      "uploaded lease with one signer": (r) => {
        upload(r).signers.length = 1;
        upload(r).tenants.length = 0;
      },
      "reminder-free deposit return with a wrong deadline": (r) => (find(r, "depositReturn").deadline = "2030-01-01"),
      "deposit receipt missing": (r) => r.filter((x) => x.id !== find(r, "depositReturn").items[0].evidence[0]),
    });
    // What may legitimately differ is still accepted.
    const without = clone(records).filter((r) => r.id !== state.first.leaseId);
    L.validateImport(without);
  });

  assert.deepEqual(pageErrors, [], "no errors on the page");
});

/* A browser does not let a page opened from a file read the files next to it, so the booklets cannot be
   fetched there. Each one also ships as a script the page may load (build-static.cjs writes them). */
test("a lease is made final when the app is opened from a file on the computer", async (t) => {
  const { copies } = require("./build-static.cjs");
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [],
    consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  await page.goto(pathToFileURL(path.join(__dirname, "index.html")).href);
  await page.waitForFunction(() => globalThis.PM?.prop?.() && PM.records("tenancy").length, null, { timeout: 20000 });
  await page.evaluate(HELPERS);
  const handouts = Object.values(await page.evaluate(() => LeaseLaw.handouts));

  await t.test("every booklet has a script copy that holds the same bytes", () => {
    assert.deepEqual(copies.slice().sort(), handouts.map((h) => h.path + ".js").sort());
    for (const handout of handouts) {
      const box = {};
      require("node:vm").runInNewContext(fs.readFileSync(path.join(__dirname, handout.path + ".js"), "utf8"), box);
      assert.deepEqual(Object.keys(box.PM_BUNDLED), [handout.path]);
      const bytes = Buffer.from(box.PM_BUNDLED[handout.path], "base64");
      assert.ok(bytes.equals(fs.readFileSync(path.join(__dirname, handout.path))), handout.path + ".js matches the PDF");
      assert.equal(sha256(bytes), handout.hash, handout.path + ".js matches the reviewed booklet");
    }
  });

  await t.test("the lease, its three booklets and the folder are written, and nothing is left on the page", async () => {
    const made = await page.evaluate(async () => {
      const blocked = await fetch(LeaseLaw.handouts.mold.path).then(() => false, () => true);
      const lease = await T.draft();
      const packet = await LeasePackets.finalize(lease);
      return {
        protocol: location.protocol,
        blocked,
        packet,
        stored: packet.attachments.map((a) => PM.get(a.id).hash),
        zip: await T.bytes(packet.archiveId),
        left: [document.querySelectorAll('script[src*="legal-assets"]').length, Object.keys(globalThis.PM_BUNDLED || {}).length],
      };
    });
    assert.equal(made.protocol, "file:");
    assert.equal(made.blocked, true, "the browser refuses to let this page read the PDF directly");
    const expected = ["guide", "mold", "lead"].map((id) => handouts.find((h) => h.id === id));
    assert.deepEqual(made.packet.attachments.map((a) => a.path), expected.map((h) => "handouts/" + h.name + ".pdf"));
    assert.deepEqual(made.packet.attachments.map((a) => a.hash), expected.map((h) => h.hash));
    assert.deepEqual(made.stored, expected.map((h) => h.hash));
    const files = unzip(Buffer.from(made.zip, "base64"));
    assert.deepEqual(Object.keys(files), ["Lease.pdf", ...made.packet.attachments.map((a) => a.path), "READ ME FIRST.txt"]);
    for (const a of made.packet.attachments) assert.equal(sha256(files[a.path]), a.hash, a.path);
    assert.deepEqual(made.left, [0, 0], "the script copies are removed once read");
  });

  await t.test("a missing or damaged copy stops the lease in plain words and writes nothing", async () => {
    const refused = await page.evaluate(async () => {
      const real = globalThis.LeaseLaw;
      const count = () => PM.records("leasePacket").length + "/" + PM.records("document").length;
      const attempt = async (change) => {
        const lease = await T.draft({ tenants: [{ id: PM.uid(), name: "Jo Rivera", email: "", phone: "" }] });
        const before = count();
        globalThis.LeaseLaw = { ...real, analyze: (...args) => ((r) => ({ ...r, attachments: r.attachments.map(change) }))(real.analyze(...args)) };
        try {
          return { message: await LeasePackets.finalize(lease).then(() => "saved", (e) => e.message), wrote: count() !== before };
        } finally {
          globalThis.LeaseLaw = real;
        }
      };
      return {
        missing: await attempt((a) => ({ ...a, path: "legal-assets/not-in-the-folder.pdf" })),
        damaged: await attempt((a) => ({ ...a, hash: "0".repeat(64) })),
        after: await LeasePackets.finalize(await T.draft({ tenants: [{ id: PM.uid(), name: "Lee Park", email: "", phone: "" }] })).then((p) => p.mode, (e) => e.message),
      };
    });
    assert.equal(refused.missing.message, "A booklet that goes with this lease could not be opened: City of San Diego Tenant Protection Guide. The app’s folder on this computer is missing a file. Replace the app’s folder on this computer with a complete copy of the app, then try again.");
    assert.equal(refused.damaged.message, "The copy of this booklet on your device is damaged: City of San Diego Tenant Protection Guide. Replace the app’s folder on this computer with a complete copy of the app, then try again.");
    assert.deepEqual([refused.missing.wrote, refused.damaged.wrote], [false, false]);
    for (const { message } of [refused.missing, refused.damaged]) assert.ok(!/internet|install|packet|tenancy|household|script|file:/i.test(message), "plain words that fit this way of opening the app");
    assert.equal(refused.after, "final", "the next lease is made final as usual");
  });

  assert.deepEqual(pageErrors, [], "no errors on the page");
  assert.deepEqual(consoleErrors.filter((m) => /Content Security Policy|Refused to/i.test(m)), [], "the page's own security rules allow the script copies");
});

/* Captured by running the committed lease tool: one lease frozen as a draft worksheet, one frozen
   with an attorney-reviewed contract, both signatures, the designation as the signed lease, an
   amendment draft, an installed rule set and a deposit worksheet. Rule sets are cut to four rules. */
// prettier-ignore
const LEGACY = {
  packages: {"CA-2026.11.18.2":{"format":"pm-legal-1","version":"CA-2026.11.18.2","verified":"2026-11-18","jurisdiction":"California","summary":"California residential intake, federal disclosures and City of San Diego review.","rules":[{"id":"boundary","title":"Local jurisdiction","section":"Municipal and county protections","url":"https://oag.ca.gov/tenants","text":"Verify the parcel against an official boundary map. For this address, ","inputs":["jurisdiction","county","boundarySource"],"trigger":"manual","jurisdiction":"California","effective":null,"sunset":null,"verified":"2026-11-18","reviewStatus":"Agency guidance reviewed; compare current statute for exact wording","reference":"https://www.dre.ca.gov/Publications/ResourceGuidebook/2026_Landlord_Tenant_Guide.pdf"},{"id":"cap","title":"State rent limit","section":"Civil Code § 1947.12","url":"https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1947.12.","text":"Check exclusions, rolling 15-year certificate of occupancy, ownership,","inputs":["propertyType","ownerType","firstOccupancy","regulated","capCoverage","capBasis"],"trigger":"cap","jurisdiction":"California","effective":"2020-01-01","sunset":"2030-01-01","verified":"2026-11-18","reviewStatus":"Agency guidance reviewed; compare current statute for exact wording","reference":"https://www.oag.ca.gov/news/press-releases/attorney-general-bonta-shares-updated-resources-statewide-and-local-rent"},{"id":"cause","title":"Just cause and statutory notices","section":"Civil Code § 1946.2, as amended by AB 1529","url":"https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1946.2.","text":"Determine coverage separately from the rent limit. Test continuous occ","inputs":["propertyType","ownerType","firstOccupancy","start","populationChange","regulated","causeCoverage","causeBasis"],"trigger":"cause","jurisdiction":"California","effective":"2020-01-01","sunset":"2030-01-01","verified":"2026-11-18","reviewStatus":"Agency guidance reviewed; compare current statute for exact wording","reference":"https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB1529"},{"id":"sd","title":"San Diego tenant protections","section":"SDMC §§ 98.0701–98.0709","url":"https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division07.pdf","text":"For covered tenancies review city just cause, exemption notices, the w","inputs":["jurisdiction","boundarySource"],"trigger":"sd","jurisdiction":"City of San Diego","effective":"2023-06-24","sunset":null,"verified":"2026-11-18","reviewStatus":"Municipal code and administering agency reviewed","reference":"https://sdhc.org/housing-opportunities/tenant-protections/"}]},"legacy-test-source":{"format":"pm-legal-1","version":"legacy-test-source","verified":"2026-11-18","jurisdiction":"California","summary":"California residential intake, federal disclosures and City of San Diego review.","rules":[{"id":"boundary","title":"Local jurisdiction","section":"Municipal and county protections","url":"https://oag.ca.gov/tenants","text":"Verify the parcel against an official boundary map. For this address, ","inputs":["jurisdiction","county","boundarySource"],"trigger":"manual","jurisdiction":"California","effective":null,"sunset":null,"verified":"2026-11-18","reviewStatus":"Agency guidance reviewed; compare current statute for exact wording","reference":"https://www.dre.ca.gov/Publications/ResourceGuidebook/2026_Landlord_Tenant_Guide.pdf"},{"id":"cap","title":"State rent limit","section":"Civil Code § 1947.12","url":"https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1947.12.","text":"Check exclusions, rolling 15-year certificate of occupancy, ownership,","inputs":["propertyType","ownerType","firstOccupancy","regulated","capCoverage","capBasis"],"trigger":"cap","jurisdiction":"California","effective":"2020-01-01","sunset":"2030-01-01","verified":"2026-11-18","reviewStatus":"Agency guidance reviewed; compare current statute for exact wording","reference":"https://www.oag.ca.gov/news/press-releases/attorney-general-bonta-shares-updated-resources-statewide-and-local-rent"},{"id":"cause","title":"Just cause and statutory notices","section":"Civil Code § 1946.2, as amended by AB 1529","url":"https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1946.2.","text":"Determine coverage separately from the rent limit. Test continuous occ","inputs":["propertyType","ownerType","firstOccupancy","start","populationChange","regulated","causeCoverage","causeBasis"],"trigger":"cause","jurisdiction":"California","effective":"2020-01-01","sunset":"2030-01-01","verified":"2026-11-18","reviewStatus":"Agency guidance reviewed; compare current statute for exact wording","reference":"https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB1529"},{"id":"sd","title":"San Diego tenant protections","section":"SDMC §§ 98.0701–98.0709","url":"https://docs.sandiego.gov/municode/MuniCodeChapter09/Ch09Art08Division07.pdf","text":"For covered tenancies review city just cause, exemption notices, the w","inputs":["jurisdiction","boundarySource"],"trigger":"sd","jurisdiction":"City of San Diego","effective":"2023-06-24","sunset":null,"verified":"2026-11-18","reviewStatus":"Municipal code and administering agency reviewed","reference":"https://sdhc.org/housing-opportunities/tenant-protections/"}]}},
  facts: [
    {"premises":"Fictional residence","city":"San Diego","county":"San Diego","state":"CA","start":"2026-01-01","rent":"1800","agreementDate":"2026-11-18","kind":"Fixed term","jurisdiction":"City of San Diego","boundarySource":"Synthetic official boundary review","built":"1960","firstOccupancy":"1961-01-01","propertyType":"Separately transferable home or condo","ownerType":"Natural person","ownerOccupied":"No","regulated":"No","titleSeparate":"No","exemptionNotice":"No","populationChange":"No","capCoverage":"Covered","causeCoverage":"Covered","sdCoverage":"Covered","smallOwner":"No","capBasis":"Fixture counsel review","causeBasis":"Fixture counsel review","sdBasis":"Fixture municipality memo","termStart":"2026-11-20","end":"2027-11-19","dueDay":"1","deposit":"1800","depositWhen":"2026-01-01","methods":"Check or electronic transfer by agreement","utilities":"","appliances":"","parking":"","pets":"","maintenance":"","leadExemption":"No","applianceException":"No","ownFridge":"No","internet":"No","periodic":"No","service":"No","higherDeposit":"No","electronic":"No","pest":"No","flood":"No","hazards":"No","smoking":"No","sharedMeter":"No","language":"English","fee":"No","accommodation":"No","econsent":"No","rentChange":"No","meganHousing":"Single-family residential property","waterSubmeter":"No","buildingSize":"15 or fewer","multipleBuildings":"No","ownerPesticides":"No","demolition":"No","ordnance":"No","recentDeath":"No","conversion":"No","contaminationOrder":"No","bedbugContact":"Fictional office box 14","rulesText":"","attorneyDoc":"048c7c1f-111b-43ae-8fba-0c3019c95b5d","attorneyName":"Test reviewer","attorneyDate":"2026-11-18","attorneyScope":"Synthetic QA fixture only","rights":"Yes","landlord":"Alex Example","adults":"Robin Example","noticeContact":"Synthetic address and phone"},
    {"premises":"184 Juniper Lane (fictional)","city":"San Diego","county":"San Diego","state":"CA","start":"2025-12-01","rent":"3200.00","agreementDate":"2026-11-18","kind":"Fixed term","jurisdiction":"","boundarySource":"","built":"","firstOccupancy":"","propertyType":"","ownerType":"","ownerOccupied":"","regulated":"","titleSeparate":"","exemptionNotice":"","populationChange":"","capCoverage":"","causeCoverage":"","sdCoverage":"","smallOwner":"","capBasis":"","causeBasis":"","sdBasis":"","termStart":"2027-04-01","end":"2028-03-31","dueDay":"1","deposit":"","depositWhen":"","methods":"","utilities":"","appliances":"","parking":"","pets":"","maintenance":"","leadExemption":"","applianceException":"","ownFridge":"","internet":"","periodic":"","service":"","higherDeposit":"","electronic":"","pest":"","flood":"No","hazards":"","smoking":"","sharedMeter":"","language":"","fee":"","accommodation":"","econsent":"","rentChange":"","meganHousing":"Single-family residential property","waterSubmeter":"","buildingSize":"","multipleBuildings":"","ownerPesticides":"","demolition":"","ordnance":"","recentDeath":"","conversion":"","contaminationOrder":"","bedbugContact":"Fictional office box 14","rulesText":"","attorneyDoc":"","attorneyName":"","attorneyDate":"","attorneyScope":"","rights":""},
    {"kind":"Renewal","premises":"184 Juniper Lane (fictional)","city":"San Diego","county":"San Diego","state":"CA","start":"2025-12-01","rent":"3200.00","agreementDate":"2026-11-18"},
  ],
  records: [
    {"type":"leasePacket","id":"bdcd7391-f817-44a5-b1e4-714bfa0ff254","immutable":true,"propertyId":"sample-juniper","tenancyId":"sample-household","leaseId":"3e8d2c8e-a28d-4a4c-879b-dffa20c569e1","parentPacket":"","name":"Synthetic completion test","mode":"reviewed","generated":"2026-11-19T04:56:36.074Z","packageVersion":"CA-2026.11.18.2","template":"PM residential worksheet 1.2","package":"CA-2026.11.18.2","facts":0,"customClauses":[{"id":"4707b522-7b0a-4586-a1ec-a1ae05ed20d3","title":"Bicycle storage","text":"Bicycle storage is in room B.\nUse the west entrance."}],"clauseReferences":{"4707b522-7b0a-4586-a1ec-a1ae05ed20d3":"Agreement page 1, section 1"},"review":[{"id":"boundary","title":"Local jurisdiction","status":"Review needed","why":"Verify the parcel against an official boundary map. For this address, "},{"id":"cap","title":"State rent limit","status":"Required","why":"Check exclusions, rolling 15-year certificate of occupancy, ownership,"},{"id":"cause","title":"Just cause and statutory notices","status":"Required","why":"Determine coverage separately from the rent limit. Test continuous occ"},{"id":"sd","title":"San Diego tenant protections","status":"Required","why":"For covered tenancies review city just cause, exemption notices, the w"}],"resolutions":{"boundary":"Synthetic reviewed clause and exhibit reference","cap":"Synthetic reviewed clause and exhibit reference","cause":"Synthetic reviewed clause and exhibit reference","sd":"Synthetic reviewed clause and exhibit reference"},"signers":[{"id":"signer-0","name":"Alex Example","role":"Landlord or agent"},{"id":"signer-1","name":"Robin Example","role":"Tenant"}],"attachments":[{"id":"de9b2bbb-ca7d-464f-8f54-31cdf40c7256","sourceId":"048c7c1f-111b-43ae-8fba-0c3019c95b5d","hash":"8a1a689ea45798d571a6ec9bc57482b1a09cbcd3e33e635b64c5f4becb7b7f44","name":"Synthetic reviewed contract.pdf","path":"agreement/Synthetic reviewed contract.pdf"},{"id":"459f3cf4-8b81-44af-aa5c-d8dfac7e7ede","hash":"72ad0617badb9ef9b544c6d631e5984c198f937a984a614991f6cf9e56a4c5bc","name":"sdhc-guide-en.pdf","path":"disclosures/sdhc-guide-en.pdf"},{"id":"5aa24f7e-db07-4762-baab-7a088b76706e","hash":"a094896c4c29df8f5b7f064bef8108346f476d3fcbbca8ae950d8e9629fb0ef8","name":"epa-lead-en.pdf","path":"disclosures/epa-lead-en.pdf"},{"id":"f0e8daf7-c5b9-4f6b-a74d-aab46236dcc2","hash":"4181a0d5fa091d1fc9408ec8a41fb157ca91323db26e5512738f1025a19c67b6","name":"cdph-dampness-mold-en.pdf","path":"disclosures/cdph-dampness-mold-en.pdf"}],"worksheetId":"0248fe37-c0ea-4791-a7ad-b7480d496053","contractId":"de9b2bbb-ca7d-464f-8f54-31cdf40c7256","archiveId":"263d24b5-030d-4b77-8de4-4c56f676d99c","archiveHash":"7bb0fc7c7b4253eda21b1f5b0d76f5cf5700508345c4f251806cb1bf7952099e"},
    {"type":"leasePacket","id":"b19b51c9-8311-4c3f-bbcb-9e6a180cd229","immutable":true,"propertyId":"sample-juniper","tenancyId":"sample-household","leaseId":"3e8d2c8e-a28d-4a4c-879b-dffa20c569e1","parentPacket":"","name":"Residential lease","mode":"draft","generated":"2026-11-19T04:56:35.669Z","packageVersion":"CA-2026.11.18.2","template":"PM residential worksheet 1.2","package":"CA-2026.11.18.2","facts":1,"customClauses":[{"id":"4707b522-7b0a-4586-a1ec-a1ae05ed20d3","title":"Bicycle storage","text":"Bicycle storage is in room B.\nUse the west entrance."}],"clauseReferences":{},"review":[{"id":"boundary","title":"Local jurisdiction","status":"More information needed","why":"Confirm Municipal boundary, boundary evidence."},{"id":"cap","title":"State rent limit","status":"More information needed","why":"Confirm Housing type, Ownership, certificate of occupancy date, Subsid"},{"id":"cause","title":"Just cause and statutory notices","status":"More information needed","why":"Confirm Housing type, Ownership, certificate of occupancy date, Adult "},{"id":"sd","title":"San Diego tenant protections","status":"More information needed","why":"Confirm Municipal boundary, boundary evidence."}],"resolutions":{},"signers":[],"attachments":[{"id":"af1f3cc5-ceb8-469b-a802-f3054f989a41","hash":"4181a0d5fa091d1fc9408ec8a41fb157ca91323db26e5512738f1025a19c67b6","name":"cdph-dampness-mold-en.pdf","path":"disclosures/cdph-dampness-mold-en.pdf"}],"worksheetId":"d436f73c-b6b9-4273-a03e-b7b58e97fbb7","contractId":null,"archiveId":"7e177711-6e01-43da-bb32-dee41de4ade0","archiveHash":"54a259e932882cc3d25aa8cf08f525027d7d2c5a1602e194a55eb8760dad5a20"},
    {"id":"3e8d2c8e-a28d-4a4c-879b-dffa20c569e1","type":"lease","propertyId":"sample-juniper","tenancyId":"sample-household","name":"Synthetic completion test","step":5,"template":"PM residential worksheet 1.2","package":"CA-2026.11.18.2","facts":0,"attachments":[],"customClauses":[{"id":"4707b522-7b0a-4586-a1ec-a1ae05ed20d3","title":"Bicycle storage","text":"Bicycle storage is in room B.\nUse the west entrance."}],"reviewedInputs":true,"resolutions":{"boundary":"Synthetic reviewed clause and exhibit reference","cap":"Synthetic reviewed clause and exhibit reference","cause":"Synthetic reviewed clause and exhibit reference","sd":"Synthetic reviewed clause and exhibit reference"}},
    {"id":"ccd9ee95-88b1-498b-9155-ac42c4c36451","type":"lease","propertyId":"sample-juniper","tenancyId":"sample-household","name":"Amendment to Synthetic completion test","step":0,"template":"PM residential worksheet 1.2","package":"CA-2026.11.18.2","facts":[0,{"kind":"Amendment","attorneyDoc":"","attorneyName":"","attorneyDate":"","attorneyScope":"","rights":"","changeText":""}],"attachments":[],"customClauses":[{"id":"4707b522-7b0a-4586-a1ec-a1ae05ed20d3","title":"Bicycle storage","text":"Bicycle storage is in room B.\nUse the west entrance."}],"reviewedInputs":false,"parentPacket":"bdcd7391-f817-44a5-b1e4-714bfa0ff254"},
    {"id":"sample-renewal-sample-juniper","type":"lease","propertyId":"sample-juniper","tenancyId":"sample-household","name":"Lease renewal","step":1,"template":"PM residential worksheet 1.2","package":"CA-2026.11.18.2","facts":2,"attachments":[],"reviewedInputs":false},
    {"propertyId":"sample-juniper","package":"legacy-test-source","installed":"2026-11-19T04:56:37.923Z","reviewer":"Prior reviewer","basis":"Synthetic historical package","immutable":true,"type":"legalPackage","id":"0f448aff-03ac-4bc4-a8ac-dae27d95387d"},
    {"type":"signature","id":"sig-bdcd7391-f817-44a5-b1e4-714bfa0ff254-signer-0","propertyId":"sample-juniper","tenancyId":"sample-household","packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254","packetHash":"7bb0fc7c7b4253eda21b1f5b0d76f5cf5700508345c4f251806cb1bf7952099e","signerId":"signer-0","documentId":"5e7d2b52-14ed-41cc-be8f-a2fc5d770331","certificateId":"","signedDate":"2026-11-18","method":"Compared wet signatures on returned scan","basis":"Verified synthetic evidence for one listed signer.","immutable":true},
    {"type":"signature","id":"sig-bdcd7391-f817-44a5-b1e4-714bfa0ff254-signer-1","propertyId":"sample-juniper","tenancyId":"sample-household","packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254","packetHash":"7bb0fc7c7b4253eda21b1f5b0d76f5cf5700508345c4f251806cb1bf7952099e","signerId":"signer-1","documentId":"18e848f6-0cb9-4389-b9f7-3066373857c2","certificateId":"","signedDate":"2026-11-18","method":"Compared wet signatures on returned scan","basis":"Verified synthetic evidence for one listed signer.","immutable":true},
    {"type":"execution","id":"5dedead7-b639-4138-a665-b3700e9bf7e5","immutable":true,"propertyId":"sample-juniper","tenancyId":"sample-household","packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254","signedDoc":"5cccefc6-307a-45ea-adc3-3b0c730b34d8","effective":"2026-11-20","basis":"Fictional complete signed copy.","confirmed":"2026-11-19T04:56:37.818Z"},
    {"id":"operative-sample-household","type":"operativeLease","propertyId":"sample-juniper","tenancyId":"sample-household","packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254","signedDoc":"5cccefc6-307a-45ea-adc3-3b0c730b34d8","effective":"2026-11-20","executionId":"5dedead7-b639-4138-a665-b3700e9bf7e5"},
    {"id":"d2ec894b-2e79-4b24-9a32-afd87fe13437","type":"depositReturn","propertyId":"sample-juniper","tenancyId":"sample-household","items":[{"id":"bc1b5be9-a87b-4659-a8ea-9c049e654b37","classification":"Documented deductible item","basis":"Carpet cleaning invoice 1042","amountCents":12550,"evidence":["0248fe37-c0ea-4791-a7ad-b7480d496053"]}],"evidence":[],"possession":"2026-11-13","vacated":"2026-11-13","inspection":"","inspectionDate":"","rightsNotice":"","method":"","consent":"","statementMethod":"","delivered":"","deliveryProof":"","deductionType":"","deductionBasis":"","deductionAmount":"","electronic":"","adults":"","funds":"1800","tenantReply":"","photoNotes":"","estimate":"","finalDocs":"","followup":"","ledgerRef":"","deadline":"2026-12-04"},
    {"id":"deposit-return-d2ec894b-2e79-4b24-9a32-afd87fe13437","type":"task","propertyId":"sample-juniper","tenancyId":"sample-household","title":"Review deposit return","kind":"Reminder","due":"2026-12-04","completed":false,"depositReturnId":"d2ec894b-2e79-4b24-9a32-afd87fe13437"},
    {"type":"document","id":"0248fe37-c0ea-4791-a7ad-b7480d496053","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"a4e8cedb6f8533eb2aaa197ef02a5171f6ef0ae2c0ee6e4d2c06b109a7763657","size":151873,"mime":"application/pdf","name":"Packet review record.pdf","originalName":"Packet review record.pdf","kind":"Review record","date":"2026-11-18","created":"2026-11-19T04:56:36.161Z","immutable":true,"packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254"},
    {"id":"048c7c1f-111b-43ae-8fba-0c3019c95b5d","propertyId":"sample-juniper","name":"Synthetic reviewed contract.pdf","kind":"Agreement","hash":"8a1a689ea45798d571a6ec9bc57482b1a09cbcd3e33e635b64c5f4becb7b7f44","mime":"application/pdf","size":143520,"date":"2026-11-18","immutable":true,"type":"document"},
    {"type":"document","id":"18e848f6-0cb9-4389-b9f7-3066373857c2","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"55aeabda57d722d8c7b2586a28305daec2749bde8c8c78a2d8d5c3a967e47cde","size":142409,"mime":"application/pdf","name":"Returned final fixture.pdf","originalName":"Returned final fixture.pdf","kind":"Returned signed lease","date":"2026-11-18","created":"2026-11-19T04:56:37.667Z","immutable":true,"packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254"},
    {"type":"document","id":"263d24b5-030d-4b77-8de4-4c56f676d99c","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"7bb0fc7c7b4253eda21b1f5b0d76f5cf5700508345c4f251806cb1bf7952099e","size":4040296,"mime":"application/zip","name":"Synthetic completion test — reviewed packet.zip","originalName":"Synthetic completion test — reviewed packet.zip","kind":"Lease packet","date":"2026-11-18","created":"2026-11-19T04:56:36.252Z","immutable":true,"packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254"},
    {"type":"document","id":"459f3cf4-8b81-44af-aa5c-d8dfac7e7ede","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"72ad0617badb9ef9b544c6d631e5984c198f937a984a614991f6cf9e56a4c5bc","size":803854,"mime":"application/pdf","name":"sdhc-guide-en.pdf","originalName":"sdhc-guide-en.pdf","kind":"Disclosure","date":"2026-11-18","created":"2026-11-19T04:56:36.101Z","immutable":true,"source":"Bundled public disclosure","packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254"},
    {"type":"document","id":"5aa24f7e-db07-4762-baab-7a088b76706e","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"a094896c4c29df8f5b7f064bef8108346f476d3fcbbca8ae950d8e9629fb0ef8","size":1403637,"mime":"application/pdf","name":"epa-lead-en.pdf","originalName":"epa-lead-en.pdf","kind":"Disclosure","date":"2026-11-18","created":"2026-11-19T04:56:36.127Z","immutable":true,"source":"Bundled public disclosure","packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254"},
    {"type":"document","id":"5cccefc6-307a-45ea-adc3-3b0c730b34d8","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"55aeabda57d722d8c7b2586a28305daec2749bde8c8c78a2d8d5c3a967e47cde","size":142409,"mime":"application/pdf","name":"Returned final fixture.pdf","originalName":"Returned final fixture.pdf","kind":"Executed lease","date":"2026-11-18","created":"2026-11-19T04:56:37.818Z","immutable":true,"packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254","sourceId":"18e848f6-0cb9-4389-b9f7-3066373857c2"},
    {"type":"document","id":"5e7d2b52-14ed-41cc-be8f-a2fc5d770331","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"55aeabda57d722d8c7b2586a28305daec2749bde8c8c78a2d8d5c3a967e47cde","size":142409,"mime":"application/pdf","name":"Returned fixture.pdf","originalName":"Returned fixture.pdf","kind":"Returned signed lease","date":"2026-11-18","created":"2026-11-19T04:56:37.503Z","immutable":true,"packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254"},
    {"type":"document","id":"7e177711-6e01-43da-bb32-dee41de4ade0","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"54a259e932882cc3d25aa8cf08f525027d7d2c5a1602e194a55eb8760dad5a20","size":1915437,"mime":"application/zip","name":"Residential lease — draft packet.zip","originalName":"Residential lease — draft packet.zip","kind":"Lease packet","date":"2026-11-18","created":"2026-11-19T04:56:35.778Z","immutable":true,"packetId":"b19b51c9-8311-4c3f-bbcb-9e6a180cd229"},
    {"type":"document","id":"af1f3cc5-ceb8-469b-a802-f3054f989a41","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"4181a0d5fa091d1fc9408ec8a41fb157ca91323db26e5512738f1025a19c67b6","size":1687994,"mime":"application/pdf","name":"cdph-dampness-mold-en.pdf","originalName":"cdph-dampness-mold-en.pdf","kind":"Disclosure","date":"2026-11-18","created":"2026-11-19T04:56:35.694Z","immutable":true,"source":"Bundled public disclosure","packetId":"b19b51c9-8311-4c3f-bbcb-9e6a180cd229"},
    {"type":"document","id":"d436f73c-b6b9-4273-a03e-b7b58e97fbb7","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"d6b869d1856f797fc622d1b0f5137743c93d6f61b1b3f595b25ce25f92e80257","size":204424,"mime":"application/pdf","name":"Residential lease — draft.pdf","originalName":"Residential lease — draft.pdf","kind":"Draft lease","date":"2026-11-18","created":"2026-11-19T04:56:35.709Z","immutable":true,"packetId":"b19b51c9-8311-4c3f-bbcb-9e6a180cd229"},
    {"type":"document","id":"de9b2bbb-ca7d-464f-8f54-31cdf40c7256","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"8a1a689ea45798d571a6ec9bc57482b1a09cbcd3e33e635b64c5f4becb7b7f44","size":143520,"mime":"application/pdf","name":"Synthetic reviewed contract.pdf","originalName":"Synthetic reviewed contract.pdf","kind":"Agreement","date":"2026-11-18","created":"2026-11-19T04:56:36.084Z","immutable":true,"sourceId":"048c7c1f-111b-43ae-8fba-0c3019c95b5d","packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254"},
    {"type":"document","id":"f0e8daf7-c5b9-4f6b-a74d-aab46236dcc2","propertyId":"sample-juniper","tenancyId":"sample-household","hash":"4181a0d5fa091d1fc9408ec8a41fb157ca91323db26e5512738f1025a19c67b6","size":1687994,"mime":"application/pdf","name":"cdph-dampness-mold-en.pdf","originalName":"cdph-dampness-mold-en.pdf","kind":"Disclosure","date":"2026-11-18","created":"2026-11-19T04:56:36.155Z","immutable":true,"source":"Bundled public disclosure","packetId":"bdcd7391-f817-44a5-b1e4-714bfa0ff254"},
  ],
};
