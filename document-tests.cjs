/* Development-only tests for the block-document writers in export.js.
   Run with node --test document-tests.cjs. PDFs are opened with the Python
   runtime that storage-tests.cjs uses (pypdf and pypdfium2); set PYTHON_PATH
   when the local default is unavailable. Parties and addresses are fictional.
   Set DOC_SAMPLE_DIR to also save the sample lease as sample.pdf and sample.html. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
require("./pdf-font.js");
require("./export.js");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const bytesOf = async (blob) => Buffer.from(await blob.arrayBuffer());
const squash = (s) => String(s).replace(/\s+/g, " ").trim();
const LEFT = 64, RIGHT = 548, TOP = 730, BOTTOM = 64;

/* ---------- Reading a generated PDF back ---------- */

// Every BT ... ET line becomes a piece with its size, position, decoded text, measured
// width and effective text render mode. The mode persists between text objects, exactly
// as it does in a PDF viewer, so a missing reset after bold text would be caught here.
function parse(buffer) {
  const source = buffer.toString("latin1");
  const unicode = new Map();
  for (const [, body] of source.matchAll(/beginbfchar\n([\s\S]*?)\nendbfchar/g))
    for (const [, cid, units] of body.matchAll(/<([0-9a-f]{4})> <([0-9a-f]+)>/g))
      unicode.set(cid, String.fromCharCode(...units.match(/.{4}/g).map((unit) => parseInt(unit, 16))));
  const widths = source.match(/\/W \[1 \[([\d ]*)\]\]/)[1].split(" ").map(Number);
  const object = (id) => {
    const marker = "\n" + id + " 0 obj\n", start = source.indexOf(marker);
    assert.ok(start >= 0, "missing object " + id);
    return source.slice(start + marker.length);
  };
  const kids = [...source.match(/\/Kids \[([^\]]*)\]/)[1].matchAll(/(\d+) 0 R/g)].map((found) => found[1]);
  const shape = /^BT \/F ([\d.]+) Tf (?:(\d) Tr )?(?:([\d.]+) w ([\d.]+ [\d.]+ [\d.]+) RG )?([\d.]+ [\d.]+ [\d.]+) rg ((?:-?[\d.]+ ){6})Tm <((?:[0-9a-f]{4})+)> Tj ET$/;
  const pages = kids.map((id) => {
    const content = object(object(id).match(/\/Contents (\d+) 0 R/)[1]);
    const length = Number(content.match(/^<< \/Length (\d+)/)[1]);
    const stream = content.slice(content.indexOf("stream\n") + 7).slice(0, length);
    let mode = 0;
    const pieces = [], drawn = [];
    for (const line of stream.split("\n")) {
      if (!line.startsWith("BT ")) { drawn.push(line); continue; }
      const found = line.match(shape);
      assert.ok(found, "unexpected text operator shape: " + line.slice(0, 140));
      const [, size, tr, strokeWidth, strokeColor, color, matrix, encoded] = found;
      if (tr !== undefined) mode = Number(tr);
      const cids = encoded.match(/.{4}/g), m = matrix.trim().split(" ").map(Number);
      pieces.push({
        line, color, strokeColor, mode, matrix: m, x: m[4], y: m[5],
        size: Number(size), bold: mode === 2, declared: tr === undefined ? null : Number(tr),
        strokeWidth: strokeWidth === undefined ? null : Number(strokeWidth),
        text: cids.map((cid) => unicode.get(cid)).join(""),
        width: (cids.reduce((total, cid) => total + widths[parseInt(cid, 16) - 1], 0) * Number(size)) / 1000,
      });
    }
    return { stream, pieces, drawn };
  });
  return { source, pages };
}
const upright = (piece) => piece.matrix[0] === 1 && piece.matrix[1] === 0;
const body = (page) => page.pieces.filter((piece) => upright(piece) && piece.y > BOTTOM && piece.y < TOP);
// Pieces that share a baseline, joined the way a reader sees them.
function lines(page) {
  const rows = new Map();
  for (const piece of body(page)) rows.set(piece.y, [...(rows.get(piece.y) || []), piece]);
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([y, pieces]) => {
    pieces.sort((a, b) => a.x - b.x);
    let text = "", end = null;
    for (const piece of pieces) {
      if (end !== null && piece.x - end > piece.size * 0.1) text += " ";
      text += piece.text;
      end = piece.x + piece.width;
    }
    return { y, text, pieces, x: pieces[0].x, size: pieces[0].size, bold: pieces.every((piece) => piece.bold) };
  });
}
const strokes = (page, pattern) => page.drawn.map((line) => line.match(pattern)).filter(Boolean);
const make = async (doc) => parse(await bytesOf(Files.pdfDoc(doc)));
const pageOf = (pdf, needle) => pdf.pages.findIndex((page) => body(page).some((piece) => piece.text.includes(needle)));

/* One Python run opens a set of PDFs with pypdf in strict mode (warnings are errors and
   log records are collected) and with pdfium, and returns what each engine saw. */
const python = process.env.PYTHON_PATH || path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
function inspect(files) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pm-document-test-"));
  try {
    for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(folder, name + ".pdf"), data);
    const script = [
      "import io, json, logging, os, sys, warnings",
      "from pypdf import PdfReader",
      "import pypdfium2 as pdfium",
      "records = []",
      "class Collect(logging.Handler):",
      "    def emit(self, record): records.append(record.getMessage())",
      "logging.getLogger('pypdf').addHandler(Collect())",
      "result = {}",
      "for name in sys.argv[2:]:",
      "    with open(os.path.join(sys.argv[1], name + '.pdf'), 'rb') as handle: data = handle.read()",
      "    del records[:]",
      "    with warnings.catch_warnings():",
      "        warnings.simplefilter('error')",
      "        reader = PdfReader(io.BytesIO(data), strict=True)",
      "        pages = [page.extract_text() for page in reader.pages]",
      "        boxes = [[float(v) for v in page.mediabox] for page in reader.pages]",
      "        info = reader.trailer['/Info']",
      "    doc = pdfium.PdfDocument(data)",
      "    sizes = [list(doc[i].get_size()) for i in range(len(doc))]",
      "    seen = [doc[i].get_textpage().get_text_bounded() for i in range(len(doc))]",
      "    ink = [sum(doc[i].render(scale=2).to_pil().convert('L').histogram()[:128]) for i in range(len(doc))]",
      "    result[name] = {'pages': pages, 'boxes': boxes, 'info': {str(k): str(v) for k, v in info.items()}, 'lang': str(reader.trailer['/Root'].get('/Lang')), 'warnings': list(records), 'sizes': sizes, 'pdfium': seen, 'ink': ink}",
      "print(json.dumps(result))",
    ].join("\n");
    return JSON.parse(execFileSync(python, ["-X", "utf8", "-c", script, folder, ...Object.keys(files)], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }));
  } catch (error) {
    throw Error("PDF inspection failed. It needs Python with pypdf and pypdfium2; set PYTHON_PATH if the default is unavailable.\n" + (error.stderr || error.message));
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

/* ---------- Fixtures ---------- */

const landlord = "Juniper Lane Holdings LLC";
const tenants = ["José Peña", "Hoàng Lê"];
const address = "4127 Juniper Street, Unit B, San Diego, CA 92104";
const tpaNotice = [
  "California law limits the amount your rent can be increased. See Section 1947.12 of the Civil Code for more information. California law also provides that after all of the tenants have continuously and lawfully occupied the property for 12 months or more or at least one of the tenants has continuously and lawfully occupied the property for 24 months or more, a landlord must provide a statement of cause in any notice to terminate a tenancy. See Section 1946.2 of the Civil Code for more information.",
];
const bedBugNotice = [
  "Bed bug Appearance: Bed bugs have six legs. Adult bed bugs have flat bodies about 1/4 of an inch in length. Their color can vary from red and brown to copper colored. Young bed bugs are very small. Their bodies are about 1/16 of an inch in length. They have almost no color. When a bed bug feeds, its body swells, may lengthen, and becomes bright red, sometimes making it appear to be a different insect. Bed bugs do not fly. They can either crawl or be carried from place to place on objects, people, or animals. Bed bugs can be hard to find and identify because they are tiny and try to stay hidden.",
  "Life Cycle and Reproduction: An average bed bug lives for about 10 months. Female bed bugs lay one to five eggs per day. Bed bugs grow to full adulthood in about 21 days.",
  "Bed bugs can survive for months without feeding.",
  "Bed bug Bites: Because bed bugs usually feed at night, most people are bitten in their sleep and do not realize they were bitten. A person’s reaction to insect bites is an immune response and so varies from person to person. Sometimes the red welts caused by the bites will not be noticed until many days after a person was bitten, if at all.",
  "Common signs and symptoms of a possible bed bug infestation:",
  "• Small red to reddish brown fecal spots on mattresses, box springs, bed frames, mattresses, linens, upholstery, or walls.",
  "• Molted bed bug skins, white, sticky eggs, or empty eggshells.",
  "• Very heavily infested areas may have a characteristically sweet odor.",
  "• Red, itchy bite marks, especially on the legs, arms, and other body parts exposed while sleeping. However, some people do not show bed bug lesions on their bodies even though bed bugs may have fed on them.",
  "For more information, see the Internet Web sites of the United States Environmental Protection Agency and the National Pest Management Association.",
];

// A realistic sample lease that uses every block type. The wording is filler for layout
// review; it is not the app's lease text.
function lease(watermark = "DRAFT") {
  const p = (text, more) => ({ t: "p", text, ...more });
  const lead = (label, text) => ({ t: "p", runs: [{ text: label, bold: true }, { text: " " + text }] });
  const alpha = (...items) => ({ t: "list", style: "alpha", items });
  let number = 0;
  const section = (heading, ...blocks) => [{ t: "h2", text: ++number + ". " + heading }, ...blocks];
  return {
    title: "Residential Lease Agreement — 4127 Juniper Street, Unit B",
    footer: address,
    watermark,
    blocks: [
      { t: "title", text: "Residential Lease Agreement", sub: "City of San Diego, California\nSample for layout review · fictional parties" },
      {
        t: "kv",
        rows: [
          ["Landlord", landlord],
          ["Tenants", tenants.join(" and ")],
          ["Premises", address],
          ["Term", "December 1, 2026 through November 30, 2027, then month to month"],
          ["Monthly rent", "$3,200.00, due on the first day of each month"],
          ["Security deposit", "$3,200.00 (one month’s rent)"],
          ["Notices to Landlord", "PO Box 1207, San Diego, CA 92112 · notices@juniperlane.example"],
        ],
      },
      p("This table summarizes the main terms for convenience. The numbered sections that follow are the agreement.", { size: 9.5, after: 2 }),
      { t: "h1", text: "Agreement" },
      p("This Residential Lease Agreement (the “Agreement”) is made on November 18, 2026 between the Landlord and the Tenants named above."),
      ...section("Premises", p("Landlord rents to Tenant the dwelling at " + address + " (the “Premises”) for use as a private residence only. The Premises include:"), alpha("One assigned parking space, number 14.", "The refrigerator, range, dishwasher and window coverings now in the dwelling.")),
      ...section("Term", lead("Fixed term.", "The tenancy begins on December 1, 2026 and the fixed term ends on November 30, 2027. If Tenant stays with Landlord’s consent after that date, the tenancy continues from month to month on the same terms.")),
      ...section("Rent", lead("Amount.", "Tenant shall pay rent of $3,200.00 per month, in advance and without deduction or offset, on or before the first day of each calendar month, by one of these methods:"), alpha("Personal check, cashier’s check or money order payable to " + landlord + ".", "Electronic transfer through the payment portal that Landlord identifies in writing.", [{ text: "Third-party payment.", bold: true }, { text: " Landlord accepts rent from a third party as the law provides." }])),
      ...section("Late Charges and Returned Payments", p("Tenant shall pay a late charge of $75.00 if rent is not received by the end of the fifth day after it is due, and $25.00 for a returned payment. A late charge is not a grace period.")),
      ...section("Security Deposit", p("Tenant shall deposit $3,200.00 with Landlord before taking possession. Landlord may use the deposit only as Civil Code § 1950.5 allows and will return it, less lawful deductions, within 21 days after Tenant vacates.")),
      ...section("Utilities and Services", p("Tenant pays for electricity, gas and internet. Landlord pays for water, sewer and trash collection.")),
      ...section("Occupants and Guests", p("Only the Tenants named above and their minor children may live in the Premises.")),
      ...section("Use of the Premises", p("Tenant shall use the Premises only as a residence and shall not disturb the neighbors.")),
      ...section("Condition and Move-In Inspection", p("Tenant has examined the Premises and accepts them in clean and operative condition, except as noted on the move-in inspection form that both parties sign.")),
      ...section("Maintenance and Repairs", lead("Landlord.", "Landlord shall keep the Premises fit to live in and shall make repairs within a reasonable time after notice."), lead("Tenant.", "Tenant shall:"), alpha("Keep the Premises clean and sanitary, and dispose of all rubbish properly.", "Promptly tell Landlord in writing about any leak, mold, pest or dangerous condition.", "Pay for repairs of damage that Tenant or a guest causes, ordinary wear and tear excepted.")),
      ...section("Alterations", p("Tenant shall not paint, change locks, install fixtures or make any other alteration without Landlord’s prior written consent.")),
      ...section("Landlord’s Entry", p("Landlord may enter the Premises only for the reasons and in the manner that Civil Code § 1954 allows, ordinarily after at least 24 hours’ written notice and during normal business hours.")),
      ...section("Pets and Assistance Animals", p("No animal other than a service or support animal may be kept without Landlord’s written consent.")),
      ...section("Smoking", p("Smoking of any substance, including with electronic devices, is prohibited on the property.")),
      ...section("Parking and Storage", p("Tenant may park one registered passenger vehicle in space 14. No outside storage is provided.")),
      ...section("Renters’ Insurance", p("Landlord’s insurance does not cover Tenant’s belongings; renters’ insurance is recommended.")),
      ...section("Assignment and Subletting", p("Tenant shall not assign this Agreement or sublet any part of the Premises without Landlord’s prior written consent.")),
      ...section("Rent Increases and Termination Protections", p("The following notice is printed in 12-point type as Civil Code § 1946.2 requires."), { t: "notice", heading: "Notice of tenant protections", paras: tpaNotice, size: 12, frame: "box" }),
      ...section("Default and Remedies", p("If Tenant fails to pay rent when due or breaks another term of this Agreement, Landlord may serve the notice that the law requires and may end the tenancy through the court process.")),
      ...section("Ending the Tenancy and Moving Out", p("To end a month-to-month tenancy, Tenant shall give at least 30 days’ written notice. Tenant shall return every key and leave the Premises as clean as they were at move-in.")),
      ...section("Notices", p("A notice under this Agreement must be in writing and sent to the address in the summary table.")),
      ...section("Required Information for Tenants", p("Information about registered sex offenders is available at www.meganslaw.ca.gov, and about natural hazards at https://myhazards.caloes.ca.gov/. The following notice is required by Civil Code § 1954.603."), { t: "notice", heading: "Information about Bed Bugs", paras: bedBugNotice, size: 12, frame: "bar" }),
      ...section("Joint and Several Liability", p("Each Tenant is responsible for the whole of the rent and every other obligation of Tenant.")),
      ...section("Entire Agreement and Changes", p("This Agreement and its addenda are the whole agreement between the parties about the Premises. It can be changed only in a writing signed by Landlord and Tenant.")),
      { t: "rule" },
      {
        t: "keep",
        blocks: [
          ...section("Signatures", p("By signing below, each party agrees to this Agreement and its addenda.")),
          { t: "space", h: 4 },
          { t: "sign", parties: [{ role: "Landlord", name: landlord }, ...tenants.map((name) => ({ role: "Tenant", name }))] },
        ],
      },
      { t: "h1", text: "Addendum A — Move-In Acknowledgments", breakBefore: true },
      p("Tenant acknowledges each item that is checked below. Landlord has checked the boxes that describe what was delivered at signing."),
      { t: "check", checked: true, text: "Tenant received the booklet “Information on Dampness and Mold for Renters in California.”" },
      { t: "check", checked: true, runs: [{ text: "Keys delivered:", bold: true }, { text: " two door keys, one mailbox key and one garage remote." }] },
      { t: "check", checked: false, text: "Tenant chooses to supply and maintain Tenant’s own refrigerator and understands that this choice is voluntary and can be withdrawn with 30 days’ written notice." },
      { t: "check", checked: false, indent: 16, text: "Tenant asks for a copy of the move-in inspection photographs by email." },
      { t: "sign", withDate: false, parties: tenants.map((name) => ({ role: "Tenant initials", name })) },
      { t: "pagebreak" },
      { t: "h1", text: "Addendum B — House Rules" },
      p("Quiet hours", { bold: true, align: "center", size: 11 }),
      { t: "list", style: "number", items: ["Quiet hours are from 10:00 PM to 7:00 AM every day.", "Laundry machines may be used between 8:00 AM and 9:00 PM.", "Trash and recycling go out on Tuesday evening."] },
      { t: "list", style: "bullet", indent: 0, items: ["Bicycles are kept in the rack, not in hallways.", "Grills are not allowed on balconies."] },
      { t: "list", style: "none", items: ["Questions about these rules go to the notice address above."] },
    ],
  };
}

// The text a reader should find, in order.
function strings(doc) {
  const out = [];
  const flat = (value) => squash(Array.isArray(value) ? value.map((run) => (typeof run === "string" ? run : run.text)).join("") : (value ?? ""));
  const say = (value) => flat(value) && out.push(flat(value));
  const walk = (block) => {
    if (block.t === "title") [block.text, ...String(block.sub || "").split("\n")].forEach(say);
    else if (block.t === "h1" || block.t === "h2") say(block.text);
    else if (block.t === "p" || block.t === "check") say(block.runs || block.text);
    else if (block.t === "list") {
      const marker = (index) => ({ alpha: "(" + String.fromCharCode(97 + index) + ") ", number: index + 1 + ". ", bullet: "• ", none: "" })[block.style];
      block.items.forEach((item, index) => say(marker(index) + flat(item)));
    } else if (block.t === "kv") block.rows.flat().forEach(say);
    else if (block.t === "notice") [block.heading, ...block.paras].forEach(say);
    else if (block.t === "sign") block.parties.forEach((party) => say(party.role + ": " + party.name));
    else if (block.t === "keep") block.blocks.forEach(walk);
  };
  doc.blocks.forEach(walk);
  return out;
}
const kinds = (blocks) => blocks.flatMap((block) => [block.t, ...(block.t === "keep" ? kinds(block.blocks) : [])]);
function assertInOrder(haystack, needles, label) {
  let from = 0;
  for (const needle of needles) {
    const at = haystack.indexOf(needle, from);
    assert.ok(at >= 0, label + " is missing or out of order: " + needle.slice(0, 90));
    from = at + needle.length;
  }
}
// Removes the watermark, running header and footer from one extracted page.
function content(text, doc, index, count) {
  const rows = text.replace(/\r/g, "").split("\n").map(squash).filter(Boolean);
  if (doc.watermark) assert.equal(rows.shift(), doc.watermark, "the watermark is the first text on page " + (index + 1));
  if (index) assert.equal(rows.shift(), doc.title, "running header on page " + (index + 1));
  assert.equal(rows.pop(), squash(doc.footer + " Page " + (index + 1) + " of " + count), "footer on page " + (index + 1));
  return rows.join(" ");
}
const filler = (count, tag = "Filler") => Array.from({ length: count }, (_, index) => ({ t: "p", text: tag + " line " + String(index + 1).padStart(3, "0") + ".", after: 0 }));
const long = (words, tag) => Array.from({ length: words }, () => tag).join(" ");

const legacyCases = () => ({
  simple: ["Notices", [{ heading: "Heading", lines: ["One line.", "Another line."] }]],
  long: ["Annual summary – José", [
    { heading: "Monthly activity", lines: Array.from({ length: 95 }, (_, i) => "Record " + String(i + 1).padStart(3, "0") + " recorded for the property.") },
    { heading: "Signatures", keepTogether: true, lines: ["Owner: ____________________", "Tenant: ____________________"] },
  ]],
  typography: ["Lease packet • “Quoted” § 1946.2 — draft", [
    { heading: "Tenant Protection Act notice", bodySize: 12, lines: ["California law limits the amount your rent can be increased. See Section 1947.12 of the Civil Code for more information. ".repeat(4), "https://example.com/" + "a".repeat(300)] },
    { lines: "A single string with a tab\tand CRLF\r\nsecond line □ •" },
    { heading: "", lines: [] },
    { heading: "Signer details", lines: ["x"] },
  ]],
  empty: ["", []],
});
// SHA-256 of Files.pdf output from the implementation committed before pdfDoc existed
// (commit 3875366), with the bundled Liberation Sans 1.07.4.
const legacyFont = "0d1e8f394a7bb28bb0302c0af56116c3e91b70421682a7ef96b0811801654c56";
const legacyHashes = {
  simple: "b45d12509f3f327e407ad69392557eac4effd72f7c1c51d3d543067b8c3fcf94",
  long: "71f65680bea5ba372f2006bbecbef097b9d80203b3d0e2a6d29c4a83c4d073f7",
  typography: "e3f92fbfffb98b309bb4c5d897a81bd08fd0b1cec3c49e31d1b35c6735ab6a95",
  empty: "8ffb0031059e6d551e92986811eb17ac3ef130cd7ed5e190fcd0514780b5db82",
};

const emphasis = "The quick brown fox jumps over the lazy dog near 4127 Juniper Street. ".repeat(12);
const built = {}, seen = {};
test.before(async () => {
  const docs = {
    draft: lease(),
    clean: lease(""),
    regular: { title: "Weight", footer: "", watermark: "", blocks: [{ t: "p", text: emphasis }] },
    bold: { title: "Weight", footer: "", watermark: "", blocks: [{ t: "p", text: emphasis, bold: true }] },
    names: { title: "Names", footer: "José Peña", watermark: "", blocks: [{ t: "p", text: "José Peña, Zoë Müller, François Lévêque and Hoàng Lê signed in Ñuñoa: ¿Cómo está? ¡Bien!" }] },
    long: { title: "Long document", footer: "Unit 12", watermark: "", blocks: Array.from({ length: 150 }, (_, index) => ({ t: "p", text: "Paragraph " + (index + 1) + ". " + "Tenant shall keep the premises clean and sanitary at all times. ".repeat(4) })) },
  };
  for (const [name, doc] of Object.entries(docs)) built[name] = { doc, bytes: await bytesOf(Files.pdfDoc(doc)) };
  for (const item of Object.values(built)) item.pdf = parse(item.bytes);
  Object.assign(seen, inspect(Object.fromEntries(Object.entries(built).map(([name, item]) => [name, item.bytes]))));
});

/* ---------- Tests ---------- */

test("1. every block type renders and all text extracts in reading order", () => {
  const { doc, pdf } = built.draft;
  assert.deepEqual([...new Set(kinds(doc.blocks))].sort(), ["check", "h1", "h2", "keep", "kv", "list", "notice", "p", "pagebreak", "rule", "sign", "space", "title"]);
  assert.ok(pdf.pages.length >= 4 && pdf.pages.length <= 6, "the sample lease should run four to six pages, got " + pdf.pages.length);
  assert.equal(kinds(doc.blocks).filter((kind) => kind === "h2").length, 25, "twenty-five numbered sections");
  const expected = strings(doc);
  assert.ok(expected.length > 100);
  for (const engine of ["pages", "pdfium"]) {
    const pages = seen.draft[engine];
    assert.equal(pages.length, pdf.pages.length);
    assertInOrder(pages.map((text, index) => content(text, doc, index, pages.length)).join(" "), expected, engine === "pages" ? "pypdf text" : "pdfium text");
  }
  // The content streams tell the same story without any reader heuristics.
  assertInOrder(pdf.pages.flatMap((page) => lines(page).map((line) => line.text)).join(" "), expected, "content stream text");
  const text = seen.draft.pages.join("\n");
  assert.match(text, /Amount\. Tenant shall pay rent of \$3,200\.00 per month/, "a bold lead-in and its sentence are separated by one space");
  assert.match(text, /\(c\) Third-party payment\. Landlord accepts rent from a third party/);
  assert.match(text, /Landlord: Juniper Lane Holdings LLC Date/);
  assert.match(text, /Tenant: José Peña Date\s+Tenant: Hoàng Lê Date/);
  assert.match(text, /Tenant initials: José Peña\s+Tenant initials: Hoàng Lê/);
  assert.doesNotMatch(text, /[□☐☑☒]/, "checkboxes are drawn, not printed with a glyph");
});

test("2. a 12-point notice never prints smaller, boxed or flowing across pages", async () => {
  const { pdf } = built.draft;
  const printed = pdf.pages.flatMap((page) => lines(page));
  const readable = (min) => printed.filter((line) => line.pieces.every((piece) => piece.size >= min)).map((line) => line.text).join(" ");
  for (const paragraph of ["Notice of tenant protections", ...tpaNotice, "Information about Bed Bugs", ...bedBugNotice]) {
    assert.ok(readable(12).includes(paragraph), "incomplete or undersized notice text: " + paragraph.slice(0, 60));
    assert.ok(!readable(12.01).includes(paragraph), "a 12-point notice prints at exactly 12 points");
  }
  for (const word of ["swells", "eggshells", "statement of cause"]) {
    const pieces = pdf.pages.flatMap((page) => body(page)).filter((piece) => piece.text.includes(word));
    assert.ok(pieces.length && pieces.every((piece) => piece.size === 12), word);
  }
  // The boxed notice sits inside one rectangle on one page.
  const boxPage = pageOf(pdf, "California law limits the amount");
  const box = strokes(pdf.pages[boxPage], /^0\.25 0\.25 0\.25 RG 0\.8 w ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re S$/);
  assert.equal(box.length, 1);
  const [x, y, w, h] = box[0].slice(1).map(Number);
  const inside = lines(pdf.pages[boxPage]).filter((line) => line.size === 12 && line.y > y && line.y < y + h);
  assert.equal(inside.map((line) => line.text).join(" "), "Notice of tenant protections " + tpaNotice[0]);
  assert.ok(x >= LEFT && x + w <= RIGHT && inside.every((line) => line.x >= x + 9 && Math.max(...line.pieces.map((piece) => piece.x + piece.width)) <= x + w - 9));
  // The long notice flows over a page boundary with a side rule on each part.
  const bars = pdf.pages.map((page) => strokes(page, /^0\.35 0\.35 0\.35 RG 2 w 65 ([\d.]+) m 65 ([\d.]+) l S$/));
  const parts = bars.map((found, index) => (found.length ? index : -1)).filter((index) => index >= 0);
  assert.equal(parts.length, 2, "the bed bug notice should span two pages in the sample");
  assert.equal(parts[1], parts[0] + 1);
  for (const index of parts) {
    const [top, bottom] = bars[index][0].slice(1).map(Number);
    const beside = lines(pdf.pages[index]).filter((line) => line.size === 12 && line.x === 76);
    assert.ok(beside.length >= 2 && beside.every((line) => line.y < top && line.y > bottom), "the rule runs the full height of the notice on page " + (index + 1));
  }
  assert.equal(pageOf(pdf, "Information about Bed Bugs"), parts[0]);
  assert.equal(pageOf(pdf, "National Pest Management Association"), parts[1]);
  // Other sizes are honored exactly, and a box too tall for a page falls back to the side rule.
  const other = await make({ blocks: [{ t: "notice", heading: "Lead Warning Statement", paras: ["Housing built before 1978 may contain lead-based paint."], size: 14, frame: "box" }, { t: "notice", paras: ["Default size."], frame: "none" }, { t: "notice", paras: ["Big"], size: 80 }] });
  assert.deepEqual(body(other.pages[0]).map((piece) => piece.size), [14, 14, 12, 80]);
  const tall = await make({ blocks: [{ t: "notice", heading: "Tall", paras: Array.from({ length: 30 }, (_, index) => "Paragraph " + index + ". " + long(40, "notice")), size: 12, frame: "box" }] });
  assert.ok(tall.pages.length > 1);
  for (const page of tall.pages) {
    assert.equal(strokes(page, / re S$/).length, 0);
    assert.equal(strokes(page, /^0\.35 0\.35 0\.35 RG 2 w 65 /).length, 1);
    assert.ok(body(page).every((piece) => piece.size === 12));
  }
});

test("3. bold is render mode 2 with a matching stroke, and regular text is mode 0", () => {
  const { pdf } = built.draft;
  const all = pdf.pages.flatMap((page) => page.pieces);
  for (const page of pdf.pages) {
    assert.equal(page.stream.split("\n").filter((line) => line.includes(" Tj")).length, page.pieces.length, "one Tj per line");
    assert.equal((page.stream.match(/ Tj/g) || []).length, page.pieces.length);
    assert.equal((page.stream.match(/\bBT\b/g) || []).length, page.pieces.length);
    assert.equal((page.stream.match(/\bET\b/g) || []).length, page.pieces.length);
  }
  for (const piece of all) {
    assert.ok(piece.mode === 0 || piece.mode === 2);
    if (piece.bold) {
      assert.equal(piece.declared, 2, "every bold piece sets its own render mode: " + piece.text);
      assert.equal(piece.strokeColor, piece.color, "stroke and fill colors match");
      assert.ok(Math.abs(piece.strokeWidth / piece.size - 0.032) < 0.002, "stroke is about 3.2% of the size, got " + piece.strokeWidth + " at " + piece.size);
    } else {
      assert.ok(!piece.line.includes("2 Tr") && piece.strokeWidth === null);
    }
  }
  const find = (text) => all.filter((piece) => piece.text === text);
  for (const text of ["Residential Lease Agreement", "Agreement", "3. Rent", "Amount.", "Fixed term.", "Tenant.", "Third-party payment.", "Landlord", "Monthly rent", "Notice of tenant protections", "Keys delivered:", "Quiet hours", "Addendum B — House Rules"])
    assert.ok(find(text).length && find(text).every((piece) => piece.bold), "expected bold: " + text);
  for (const text of [landlord, "City of San Diego, California", "(a)", "1.", "•", "Date", "Tenant: José Peña", "$3,200.00, due on the first day of each month"])
    assert.ok(find(text).length && find(text).every((piece) => !piece.bold && piece.mode === 0), "expected regular: " + text);
  // The reset happens in the first regular piece after a bold one, never later.
  const resets = pdf.pages.flatMap((page) => page.pieces.filter((piece, index) => index && page.pieces[index - 1].bold && !piece.bold));
  assert.ok(resets.length > 20 && resets.every((piece) => piece.declared === 0));
  assert.ok(all.filter((piece) => piece.declared === 0).length === resets.length, "no needless resets");
  assert.ok(all.filter(upright).every((piece) => piece.color === (piece.y > BOTTOM && piece.y < TOP ? "0.10 0.10 0.10" : "0.40 0.40 0.40")));
  // Rendered pixels agree: the same paragraph is visibly heavier in bold.
  assert.deepEqual(built.bold.pdf.pages[0].pieces.map((piece) => [piece.x, piece.y, piece.text]), built.regular.pdf.pages[0].pieces.map((piece) => [piece.x, piece.y, piece.text]), "bold is measured with the regular widths");
  assert.ok(seen.bold.ink[0] > seen.regular.ink[0] * 1.15, "bold ink " + seen.bold.ink[0] + " vs regular " + seen.regular.ink[0]);
});

test("4. every page of a long document is numbered against the right total", () => {
  const { pdf, doc } = built.long;
  const count = pdf.pages.length;
  assert.ok(count >= 12, "expected a long document, got " + count + " pages");
  pdf.pages.forEach((page, index) => {
    const label = "Page " + (index + 1) + " of " + count;
    const last = page.pieces[page.pieces.length - 1];
    assert.equal(last.text, label);
    assert.ok(last.size === 8 && last.y < BOTTOM && Math.abs(last.x + last.width - RIGHT) < 0.02, "right-aligned in the bottom margin");
    assert.equal(page.pieces.filter((piece) => /^Page \d+ of \d+$/.test(piece.text)).length, 1);
    const foot = page.pieces[page.pieces.length - 2];
    assert.ok(foot.text === doc.footer && foot.x === LEFT && foot.y === last.y && foot.size === 8);
    assert.equal(strokes(page, /^0\.72 0\.72 0\.72 RG 0\.5 w 64 48 m 548 48 l S$/).length, 1, "rule above the footer");
    for (const engine of ["pages", "pdfium"]) assert.ok(squash(seen.long[engine][index]).endsWith(doc.footer + " " + label), engine + " page " + (index + 1));
    // Pages after the first carry the title and a rule at the top.
    const header = page.pieces.filter((piece) => piece.y > TOP);
    assert.deepEqual(header.map((piece) => [piece.text, piece.x, piece.size, piece.color]), index ? [[doc.title, LEFT, 8, "0.40 0.40 0.40"]] : []);
    assert.equal(strokes(page, /^0\.72 0\.72 0\.72 RG 0\.5 w 64 745 m 548 745 l S$/).length, index ? 1 : 0);
  });
  assertInOrder(squash(seen.long.pages.join(" ")), Array.from({ length: 150 }, (_, index) => "Paragraph " + (index + 1) + "."), "long document");
});

test("5. a signature block moves to the next page intact and a heading is never stranded", async () => {
  const parties = [{ role: "Landlord", name: landlord }, { role: "Tenant", name: tenants[0] }, { role: "Tenant", name: tenants[1] }];
  const outcomes = new Set();
  for (let count = 30; count <= 47; count++) {
    const pdf = await make({ blocks: [...filler(count), { t: "sign", parties }] });
    const where = parties.map((party) => pageOf(pdf, party.role + ": " + party.name));
    assert.ok(where.every((index) => index === where[0] && index >= 0), "the block is split with " + count + " lines above it");
    assert.equal(where[0], pdf.pages.length - 1);
    // A block that moves takes the one line before it along, so it never opens a page alone.
    if (pdf.pages.length === 2 && count <= 45) {
      assert.deepEqual(lines(pdf.pages[1]).slice(0, 2).map((line) => line.text), ["Filler line " + String(count).padStart(3, "0") + ".", "Landlord: " + landlord + " Date"]);
      assert.equal(lines(pdf.pages[0]).at(-1).text, "Filler line " + String(count - 1).padStart(3, "0") + ".");
    }
    outcomes.add(pdf.pages.length + (where[0] ? " moved" : " fits"));
    // Each party: a 250 pt signature line and a 120 pt date line share a row, 30 pt of
    // blank space above them and the captions directly underneath.
    const page = pdf.pages[where[0]], rules = strokes(page, /^0\.10 0\.10 0\.10 RG 0\.75 w ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S$/).map((found) => found.slice(1).map(Number));
    assert.equal(rules.length, 6);
    parties.forEach((party, index) => {
      const [sign, date] = rules.slice(index * 2, index * 2 + 2);
      assert.deepEqual([sign[0], sign[2] - sign[0], date[2] - date[0], sign[1], sign[3]], [LEFT, 250, 120, date[1], sign[1]]);
      assert.ok(date[0] > sign[2]);
      const caption = body(page).find((piece) => piece.text === party.role + ": " + party.name);
      const when = body(page).find((piece) => piece.text === "Date" && piece.y === caption.y);
      assert.ok(caption.x === LEFT && when.x === date[0] && caption.size < 10 && sign[1] - caption.y > 6 && sign[1] - caption.y < 13);
      const above = body(page).filter((piece) => piece.y > sign[1] && piece.y < sign[1] + 30);
      assert.equal(above.length, 0, "30 pt stay blank above the line");
      assert.ok(sign[1] > BOTTOM + 10);
    });
  }
  assert.deepEqual([...outcomes].sort(), ["1 fits", "2 moved"]);
  // The closing paragraph gives up its last two lines, never one, and a forced break still
  // lets a signature page start with the block itself.
  let carried = 0;
  for (let count = 26; count <= 40; count++) {
    const pdf = await make({ blocks: [...filler(count), { t: "p", text: long(75, "closing") }, { t: "space", h: 6 }, { t: "sign", parties }] });
    const closing = pdf.pages.map((page) => lines(page).filter((line) => line.text.startsWith("closing")).length);
    assert.equal(closing[0] + (closing[1] || 0), 6);
    if (pdf.pages.length === 1) continue;
    assert.ok(closing[1] >= 2 && closing[0] !== 1, "the block follows " + closing[1] + " lines of the closing paragraph with " + count + " lines above");
    assert.equal(pageOf(pdf, "Landlord: " + landlord), 1);
    if (closing[1] === 2) carried++;
  }
  assert.ok(carried >= 4, "the sweep should carry two closing lines over, saw " + carried);
  const forced = await make({ blocks: [{ t: "p", text: "Body." }, { t: "pagebreak" }, { t: "sign", parties }, { t: "h1", text: "Addendum", breakBefore: true }, { t: "sign", parties }] });
  assert.deepEqual(forced.pages.map((page) => lines(page).map((line) => line.text.split(":")[0])), [["Body."], ["Landlord", "Tenant", "Tenant"], ["Addendum", "Landlord", "Tenant", "Tenant"]]);

  // Headings: sweep the starting position so that headings meet every page boundary.
  let boundaries = 0;
  for (let shift = 0; shift < 44; shift += 3) {
    const blocks = [{ t: "space", h: shift }];
    for (let index = 1; index <= 70; index++)
      blocks.push({ t: "h2", text: index + ". Heading" }, { t: "p", text: long(18 + ((index * 7) % 5) * 16, "body" + index) });
    const pdf = await make({ blocks });
    assert.ok(pdf.pages.length > 4);
    pdf.pages.forEach((page, at) => {
      const rows = lines(page);
      rows.forEach((row, index) => {
        if (row.size !== 11.5) return;
        assert.ok(row.bold && /^\d+\. Heading$/.test(row.text));
        const tag = "body" + row.text.split(".")[0];
        assert.ok(rows[index + 1] && rows[index + 2], "heading “" + row.text + "” is within two lines of the end of page " + (at + 1));
        assert.ok(rows[index + 1].text.split(" ")[0] === tag && rows[index + 2].text.split(" ")[0] === tag, "a heading keeps two lines of its own section");
      });
      assert.notEqual(rows[rows.length - 1].size, 11.5);
      if (at && rows[0].size === 11.5) boundaries++;
    });
  }
  assert.ok(boundaries > 5, "the sweep should push headings to the top of pages");
  // A one-line section still keeps its line, and a major heading follows the same rule.
  for (let count = 38; count <= 46; count++) {
    const pdf = await make({ blocks: [...filler(count), { t: "h1", text: "Major heading" }, { t: "h2", text: "Minor heading" }, { t: "p", text: "Only line." }, { t: "h2", text: "Next heading" }, { t: "p", text: long(60, "tail") }] });
    const where = ["Major heading", "Minor heading", "Only line."].map((text) => pageOf(pdf, text));
    assert.ok(where.every((index) => index === where[0]), "headings and their first line share a page with " + count + " lines above");
    for (const page of pdf.pages) assert.ok(!lines(page).at(-1).bold);
  }
  // A one-line paragraph under a heading brings the next line along, and a heading that
  // wraps onto several lines is never divided.
  const wrapped = "A heading long enough to run onto more than two lines " + long(22, "heading");
  let pushed = 0;
  for (let count = 36; count <= 46; count++) {
    const short = await make({ blocks: [...filler(count), { t: "h2", text: "Short heading" }, { t: "p", text: "Only line." }, { t: "p", text: long(70, "next") }] });
    const rows = lines(short.pages[pageOf(short, "Short heading")]), from = rows.findIndex((row) => row.text === "Short heading");
    assert.deepEqual([rows[from + 1]?.text, rows[from + 2]?.text.split(" ")[0]], ["Only line.", "next"], "two lines follow the heading with " + count + " lines above");
    const tall = await make({ blocks: [...filler(count), { t: "h2", text: wrapped }, { t: "p", text: long(70, "last") }] });
    const parts = tall.pages.map((page) => lines(page).filter((row) => row.size === 11.5).length);
    assert.deepEqual(parts.filter(Boolean), [3], "the wrapped heading stays whole with " + count + " lines above");
    const under = lines(tall.pages[parts.indexOf(3)]).filter((row) => row.text.startsWith("last"));
    assert.ok(under.length >= 2, "and keeps two lines of its text");
    if (parts.indexOf(3) === 1 && count <= 45) pushed++;
  }
  assert.ok(pushed >= 3, "the sweep should push the wrapped heading to the next page");
});

test("6. the watermark is on every page when set and absent when empty", async () => {
  for (const name of ["draft", "clean"]) {
    const { pdf, doc } = built[name];
    pdf.pages.forEach((page, index) => {
      const marks = page.pieces.filter((piece) => !upright(piece));
      for (const engine of ["pages", "pdfium"]) assert.equal(/\bDRAFT\b/.test(seen[name][engine][index]), !!doc.watermark, engine + " page " + (index + 1));
      if (!doc.watermark) return assert.equal(marks.length, 0);
      assert.equal(marks.length, 1);
      const [mark] = marks;
      assert.equal(page.pieces[0], mark, "drawn before everything else");
      assert.equal(page.stream.split("\n")[1], mark.line);
      assert.deepEqual([mark.text, mark.size, mark.color, mark.mode], ["DRAFT", 96, "0.90 0.90 0.90", 0]);
      assert.deepEqual(mark.matrix.slice(0, 4), [0.6428, 0.766, -0.766, 0.6428], "about 50 degrees");
      // The middle of the word, half a capital above the baseline, is the middle of the page.
      const [cos, sin] = mark.matrix, lift = 0.344 * mark.size;
      assert.ok(Math.abs(mark.x + cos * (mark.width / 2) - sin * lift - 306) < 0.02 && Math.abs(mark.y + sin * (mark.width / 2) + cos * lift - 396) < 0.02);
    });
  }
  assert.equal(built.draft.pdf.pages.length, built.clean.pdf.pages.length, "a watermark does not move the text");
  // A long mark shrinks so that it stays on the page.
  const wide = await make({ watermark: "DRAFT · NOT FOR SIGNATURE", blocks: [{ t: "p", text: "Body." }] });
  const mark = wide.pages[0].pieces[0];
  assert.ok(mark.size < 96 && mark.size > 30 && mark.width <= 720.5 && mark.width > 700);
  for (const [dx, dy] of [[0, 0], [mark.width * 0.6428, mark.width * 0.766]]) assert.ok(mark.x + dx > 0 && mark.x + dx < 612 && mark.y + dy > 0 && mark.y + dy < 792);
  assert.equal(wide.pages[0].pieces.filter((piece) => piece.text.includes("NOT FOR SIGNATURE")).length, 1);
});

test("7. htmlDoc escapes markup, carries every paragraph and stands alone without scripts", () => {
  const doc = lease();
  const html = Files.htmlDoc(doc);
  assert.ok(html.startsWith('<article class="doc">') && html.endsWith("</article>"));
  const visible = (markup) => squash(markup.replace(/<\/?strong>/g, "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  assertInOrder(visible(html), [doc.watermark, ...strings(doc)], "HTML text");
  for (const name of ["doc-title", "doc-sub", "doc-h1", "doc-h2", "doc-p", "doc-list", "doc-kv", "doc-notice", "doc-check", "doc-sign", "doc-rule", "doc-space", "doc-break", "doc-keep", "doc-watermark"])
    assert.match(html, new RegExp('class="' + name + '[ "]'), name);
  assert.equal(Files.htmlDoc(lease("")).includes("doc-watermark"), false);
  assert.match(html, /<h1 class="doc-title" dir="auto">Residential Lease Agreement<\/h1>\n<p class="doc-sub" dir="auto">City of San Diego, California<br>Sample for layout review · fictional parties<\/p>/);
  assert.match(html, /<h2 class="doc-h1 doc-h1-break" dir="auto">Addendum A — Move-In Acknowledgments<\/h2>/);
  assert.match(html, /<h2 class="doc-h1" dir="auto">Addendum B — House Rules<\/h2>/);
  assert.match(html, /<h3 class="doc-h2" dir="auto">3\. Rent<\/h3>\n<p class="doc-p" dir="auto"><strong>Amount\.<\/strong> Tenant shall pay rent/);
  assert.match(html, /<li dir="auto"><span class="doc-marker" dir="ltr">\(c\)<\/span> <span class="doc-item"><strong>Third-party payment\.<\/strong> Landlord accepts rent/);
  assert.match(html, /<tr><th scope="row" dir="auto">Monthly rent<\/th><td dir="auto">\$3,200\.00, due on the first day of each month<\/td><\/tr>/);
  // Sizes with legal weight are inline, in points.
  const notice = html.match(/<section class="doc-notice doc-notice-box">[\s\S]*?<\/section>/)[0];
  assert.match(notice, /<h4 class="doc-notice-heading" dir="auto" style="font-size:12pt">Notice of tenant protections<\/h4>/);
  assert.ok(notice.includes('<p dir="auto" style="font-size:12pt">' + tpaNotice[0] + "</p>"));
  const flowing = html.match(/<section class="doc-notice doc-notice-bar">[\s\S]*?<\/section>/)[0];
  assert.equal(flowing.match(/style="font-size:12pt"/g).length, bedBugNotice.length + 1);
  assert.match(html, /<p class="doc-p" dir="auto" style="font-size:9\.5pt;margin-bottom:2pt">This table summarizes/);
  assert.match(html, /<p class="doc-p" dir="auto" style="font-size:11pt;text-align:center"><strong>Quiet hours<\/strong><\/p>/);
  assert.match(html, /<p class="doc-check" dir="auto" style="margin-inline-start:16pt"><svg class="doc-box" viewBox="0 0 9 9" role="img" aria-label="Not checked"><rect [^>]*\/><\/svg> <span class="doc-item">Tenant asks for a copy/);
  assert.equal(html.match(/aria-label="Checked"><rect [^>]*\/><path /g).length, 2);
  assert.equal(html.match(/<div class="doc-sign-party">/g).length, 5);
  assert.equal(html.match(/<span class="doc-sign-caption">Date<\/span>/g).length, 3, "the initials block has no date lines");
  assert.match(html, /<div class="doc-space" style="height:4pt"><\/div>/);
  assert.match(html, /<ol class="doc-list doc-list-number" style="margin-inline-start:14pt">/);
  assert.match(html, /<ul class="doc-list doc-list-bullet">\n<li dir="auto"><span class="doc-marker" dir="ltr">•<\/span> <span class="doc-item">Bicycles/);
  assert.match(html, /<ul class="doc-list doc-list-none" style="margin-inline-start:14pt">\n<li dir="auto"><span class="doc-item">Questions about/);
  assert.match(html, /<div class="doc-keep">\n<h3 class="doc-h2" dir="auto">25\. Signatures<\/h3>[\s\S]*<div class="doc-sign">[\s\S]*?<\/div>\n<\/div>\n<h2 /);
  // Every element that carries text lets the browser choose its direction.
  const carriers = [...html.matchAll(/<(?:(?:h[1-4]|th|td|p|li)\b|span class="doc-sign-caption")[^>]*>/g)].map((found) => found[0]).filter((tag) => tag !== '<span class="doc-sign-caption">');
  assert.ok(carriers.length > 90 && carriers.every((tag) => tag.includes('dir="auto"')), carriers.length + " text elements");
  assert.match(html, /^<article class="doc">\n<div class="doc-watermark"><span dir="auto">DRAFT<\/span><\/div>\n<h1 /);

  const hostile = {
    title: 'Lease </title><script>alert("t")</script>',
    footer: '"/><script>alert(2)</script>',
    watermark: "<b>DRAFT</b>",
    blocks: [
      { t: "title", text: "<img src=x onerror=alert(1)>", sub: "A & B <i>sub</i>" },
      { t: "h1", text: "</h2><script>alert(3)</script>" },
      { t: "p", runs: [{ text: "5 < 6 & 7 > 4", bold: true }, { text: " \"quoted\" and 'single' </p><script>alert(4)</script>" }] },
      { t: "list", items: ["<li onclick=x>item</li>"] },
      { t: "kv", rows: [["<th>", "</td></tr></table><script>alert(5)</script>"]] },
      { t: "notice", heading: "<h4>", paras: ["</section><style>*{display:none}</style>"], frame: "box" },
      { t: "check", text: "</span></p><svg onload=alert(6)>" },
      { t: "sign", parties: [{ role: "<u>Role</u>", name: "\"><script>alert(7)</script>" }] },
    ],
  };
  for (const standalone of [false, true]) {
    const out = Files.htmlDoc(hostile, { standalone });
    assert.doesNotMatch(out, /<script|<img|<i>|<b>|<u>|<li onclick|<svg onload|<th>|<h4>|onerror=alert\(1\)>/i);
    assert.equal(out.match(/<style/g)?.length || 0, standalone ? 1 : 0);
    assert.equal(out.match(/<\/style/g)?.length || 0, standalone ? 1 : 0);
    assert.equal(out.match(/<\/(?:table|section)>/g).length, 2);
    assert.ok(out.includes("<strong>5 &lt; 6 &amp; 7 &gt; 4</strong> &quot;quoted&quot; and &#39;single&#39; &lt;/p&gt;&lt;script&gt;alert(4)&lt;/script&gt;</p>"));
    assert.ok(out.includes("&lt;img src=x onerror=alert(1)&gt;</h1>") && out.includes("A &amp; B &lt;i&gt;sub&lt;/i&gt;"));
    assert.ok(out.includes("&lt;u&gt;Role&lt;/u&gt;: &quot;&gt;&lt;script&gt;alert(7)&lt;/script&gt;"));
  }

  const page = Files.htmlDoc(doc, { standalone: true });
  assert.ok(page.startsWith('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'));
  assert.ok(page.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
  assert.ok(page.includes("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">"));
  assert.ok(page.indexOf("Content-Security-Policy") < page.indexOf("<style>"), "the policy precedes the stylesheet");
  assert.ok(page.includes("<title>Residential Lease Agreement — 4127 Juniper Street, Unit B</title>"));
  assert.ok(page.includes("<style>\n" + Files.docCss + "\n"));
  assert.ok(page.includes("<body>\n" + html + "\n</body>\n</html>\n"));
  assert.doesNotMatch(page, /<script|<link|<img|<iframe|<object|<embed|\ssrc=|\shref=|url\(|@import|javascript:/i);
  assert.equal(page.match(/<article/g).length, 1);
  const risky = Files.htmlDoc(hostile, { standalone: true });
  assert.ok(risky.includes("<title>Lease &lt;/title&gt;&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt;</title>"));
  assert.match(risky, /@bottom-left\{[^}]*content:"\\22 \/\\3e \\3c script\\3e alert\(2\)\\3c \/script\\3e "\}/, "page-margin text is a safely escaped CSS string");
  assert.equal(Files.htmlDoc({ blocks: [] }, { standalone: true }).includes("<title>Document</title>"), true);

  const css = Files.docCss;
  assert.equal(typeof css, "string");
  for (const rule of [/@page\{size:letter;margin:\.75in\}/, /@media print\{/, /\.doc \.doc-h1-break\{[^}]*break-before:page/, /\.doc \.doc-keep,\.doc \.doc-sign,\.doc \.doc-sign-party\{break-inside:avoid/, /\.doc \.doc-notice-box\{[^}]*break-inside:avoid/, /\.doc\{[^}]*font:400 10\.5pt\/1\.38 system-ui/, /\.doc \.doc-break\{[^}]*break-after:page/, /\.doc\.doc \*\{[^}]*font:inherit;letter-spacing:inherit/])
    assert.match(css, rule);
  assert.doesNotMatch(css, /georgia|times|serif(?<!sans-serif)|<|url\(|@import|expression/i);
  for (const name of ["doc-title", "doc-sub", "doc-h1", "doc-h2", "doc-p", "doc-list", "doc-kv", "doc-notice", "doc-check", "doc-sign", "doc-rule", "doc-break", "doc-keep", "doc-watermark"])
    assert.ok(css.includes("." + name), "docCss styles ." + name);
});

test("8. unsupported scripts are refused with PDF_TEXT_UNSUPPORTED; supported diacritics print", async (t) => {
  const supported = (text) => {
    try { Files.pdfDoc({ blocks: [{ t: "p", text }] }); return true; } catch (error) { if (error.code !== "PDF_TEXT_UNSUPPORTED") throw error; return false; }
  };
  const refuses = (doc, label) => assert.throws(() => Files.pdfDoc(doc), (error) => error instanceof Error && error.code === "PDF_TEXT_UNSUPPORTED" && /printable HTML/.test(error.message), label);
  const wrap = (text) => ({ title: "Lease", footer: "", blocks: [{ t: "p", text }] });
  refuses(wrap("租客 王小明"), "Chinese");
  refuses(wrap("임차인 김민준"), "Korean");
  refuses(wrap("المستأجر"), "Arabic");
  refuses(wrap("שוכר"), "Hebrew");
  // Every text field goes through the same check.
  const chinese = "租约";
  for (const doc of [
    { title: chinese, blocks: filler(60) }, { title: chinese, blocks: [{ t: "p", text: "One page, so the title is never printed." }] }, { footer: chinese, blocks: [] }, { watermark: chinese, blocks: [] },
    { blocks: [{ t: "title", text: "Lease", sub: chinese }] }, { blocks: [{ t: "h1", text: chinese }] }, { blocks: [{ t: "h2", text: chinese }] },
    { blocks: [{ t: "p", runs: [{ text: "Tenant ", bold: true }, { text: chinese }] }] }, { blocks: [{ t: "list", items: ["ok", chinese] }] },
    { blocks: [{ t: "kv", rows: [["Tenant", chinese]] }] }, { blocks: [{ t: "kv", rows: [[chinese, "Tenant"]] }] },
    { blocks: [{ t: "notice", heading: "Notice", paras: [chinese] }] }, { blocks: [{ t: "notice", heading: chinese, paras: ["Notice"] }] },
    { blocks: [{ t: "check", text: chinese }] }, { blocks: [{ t: "sign", parties: [{ role: "Tenant", name: chinese }] }] },
    { blocks: [{ t: "keep", blocks: [{ t: "p", text: chinese }] }] },
  ]) refuses(doc, JSON.stringify(doc).slice(0, 80));
  // The HTML writer keeps all of it, so a caller can fall back.
  for (const text of ["租客 王小明", "임차인 김민준", "المستأجر", "Nguyễn Thị Hồng"])
    assert.ok(Files.htmlDoc(wrap(text), { standalone: true }).includes('<p class="doc-p" dir="auto">' + text + "</p>"));

  // Spanish and other Latin-1 and Latin Extended-A names print and extract exactly.
  const names = "José Peña, Zoë Müller, François Lévêque and Hoàng Lê signed in Ñuñoa: ¿Cómo está? ¡Bien!";
  assert.equal(squash(built.names.pdf.pages[0].pieces.map((piece) => piece.text).join(" ")), names + " José Peña Page 1 of 1");
  for (const engine of ["pages", "pdfium"]) assert.ok(squash(seen.names[engine][0]).startsWith(names), engine);
  assert.deepEqual(seen.names.warnings, []);

  // Vietnamese: the bundled Liberation Sans 1.07.4 has the Latin-1 and Latin Extended-A
  // letters (à, ê, ô, ă, đ, ĩ, ũ ...) but not the Latin Extended Additional block or ơ/ư,
  // so a name such as “Nguyễn Thị Hồng” is refused rather than printed without its marks.
  // With a typeface that has those glyphs the same name must print and extract intact.
  const vietnamese = "Nguyễn Thị Hồng";
  assert.ok(supported("Hoàng Lê, Võ Ngô, Đinh Hà, Vũ Tô and Lý Đăng"), "Vietnamese names within Latin-1 and Latin Extended-A print");
  if (supported(vietnamese)) {
    const pdf = await make(wrap(vietnamese + " and José Peña"));
    assert.equal(pdf.pages[0].pieces[0].text, vietnamese + " and José Peña");
  } else {
    refuses(wrap(vietnamese), "Vietnamese beyond the typeface");
    refuses({ blocks: [{ t: "sign", parties: [{ role: "Tenant", name: vietnamese }] }] }, "Vietnamese signer");
    assert.throws(() => Files.pdfDoc(wrap(vietnamese)), /“[ễịồ]”/, "the message names the character");
    t.diagnostic("The bundled typeface lacks Vietnamese letters such as ễ, ị, ồ, ơ and ư: “" + vietnamese + "” raises PDF_TEXT_UNSUPPORTED and callers fall back to htmlDoc.");
  }
  // Invisible formatting characters and narrow no-break spaces from Intl output are harmless.
  const tidy = await make(wrap("Quiet hours end at 7:00\u202fAM for co\u00adoperative\u200b tenants\ufeff"));
  assert.equal(tidy.pages[0].pieces[0].text, "Quiet hours end at 7:00\u00a0AM for cooperative tenants");
});

test("9. the same document always produces the same bytes", async () => {
  const first = await bytesOf(Files.pdfDoc(lease()));
  await bytesOf(Files.pdfDoc({ title: "Other", watermark: "VOID", blocks: [{ t: "p", text: "ÀÉÎÕÜ ñ ç — different characters first" }] }));
  Files.pdf("Another writer", [{ heading: "Ω", lines: ["αβγ"] }]);
  const second = await bytesOf(Files.pdfDoc(lease()));
  assert.equal(sha256(first), sha256(second));
  assert.ok(first.equals(built.draft.bytes));
  assert.equal(Files.htmlDoc(lease(), { standalone: true }), Files.htmlDoc(lease(), { standalone: true }));
  // The writers only read their input.
  const freeze = (value) => {
    if (value && typeof value === "object") Object.values(value).forEach(freeze);
    return Object.freeze(value);
  };
  const frozen = freeze(lease());
  assert.ok((await bytesOf(Files.pdfDoc(frozen))).equals(first));
  assert.equal(Files.htmlDoc(frozen), Files.htmlDoc(lease()));
  assert.deepEqual(frozen, lease());
  const structure = first.toString("latin1").replace(/stream\n[\s\S]*?\nendstream/g, "");
  assert.doesNotMatch(structure, /\/CreationDate|\/ModDate|\/ID\b|D:\d{8}/, "no dates or random identifiers");
  // A fresh process agrees.
  const script = "require('./pdf-font.js');require('./export.js');Files.pdfDoc(JSON.parse(require('node:fs').readFileSync(0,'utf8'))).arrayBuffer().then(b=>console.log(require('node:crypto').createHash('sha256').update(Buffer.from(b)).digest('hex')))";
  const other = execFileSync(process.execPath, ["-e", script], { cwd: __dirname, encoding: "utf8", input: JSON.stringify(lease()) }).trim();
  assert.equal(other, sha256(first));
});

test("10. Files.pdf and Files.zip still write exactly what they wrote before", async (t) => {
  const cases = legacyCases();
  // First against hashes recorded from the implementation that preceded pdfDoc.
  if (sha256(globalThis.PM_PDF_FONT) === legacyFont)
    for (const [name, args] of Object.entries(cases)) assert.equal(sha256(await bytesOf(Files.pdf(...args))), legacyHashes[name], "Files.pdf output changed for the “" + name + "” case");
  else t.diagnostic("The embedded typeface changed, so the recorded Files.pdf hashes no longer apply.");
  const archive = await Files.zip([{ name: "a/b.txt", data: "hello" }, { name: "c.bin", data: new Blob([new Uint8Array([1, 2, 3])]) }]);
  assert.equal(sha256(await bytesOf(archive)), "e502c13cb4b6ad7942f0ada9b92be58bced0f4e30d3e995693d99eca0627092f");
  assert.equal(archive.type, "application/zip");
  assert.throws(() => Files.pdf("Lease", [{ lines: ["租约"] }]), (error) => error.code === "PDF_TEXT_UNSUPPORTED" && /cannot render the character “租”/.test(error.message));
  assert.throws(() => Files.pdf("عقد", []), (error) => error.code === "PDF_TEXT_UNSUPPORTED" && /right-to-left layout/.test(error.message));
  await assert.rejects(Files.zip([{ name: "../parent/file", data: "x" }]), /filename is invalid/);
  assert.deepEqual(Object.keys(Files), ["pdf", "zip", "pdfDoc", "htmlDoc", "docCss"]);
  assert.ok(Object.isFrozen(Files));

  // Then side by side with the committed export.js, evaluated in its own context.
  let committed;
  try {
    committed = execFileSync("git", ["show", "HEAD:export.js"], { cwd: __dirname, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    t.diagnostic("git is unavailable; compared against the recorded hashes only.");
    return;
  }
  const before = { TextEncoder, Blob, atob, PM_PDF_FONT: globalThis.PM_PDF_FONT };
  vm.runInNewContext(committed, before, { filename: "HEAD:export.js" });
  for (const [name, args] of Object.entries(cases)) {
    const [was, now] = [await bytesOf(before.Files.pdf(...args)), await bytesOf(Files.pdf(...args))];
    assert.ok(was.equals(now), "Files.pdf differs from the committed implementation for the “" + name + "” case");
  }
  const entries = () => [{ name: "summary.pdf", data: Files.pdf(...cases.simple) }, { name: "support/receipt.txt", data: "Sample file contents" }, { name: "bytes.bin", data: new Blob([new Uint8Array([0, 1, 2, 254, 255])]) }];
  assert.ok((await bytesOf(await before.Files.zip(entries()))).equals(await bytesOf(await Files.zip(entries()))));
  for (const args of [["Lease", [{ lines: ["租约"] }]], ["عقد", []], ["Lease", [{ heading: "Nguyễn Thị Hồng" }]], ["Lease", [{ lines: ["tab\tand\u00a0space\u200d"] }]]]) {
    const outcome = (files) => { try { files.pdf(...args); } catch (error) { return [error.code, error.message]; } return ["printed"]; };
    assert.deepEqual(outcome(Files), outcome(before.Files), "the same input fails or prints in both");
  }
});

test("11. pypdf in strict mode and pdfium open every file as U.S. Letter", async () => {
  for (const [name, item] of Object.entries(built)) {
    const report = seen[name];
    assert.deepEqual(report.warnings, [], name + ": pypdf logged " + JSON.stringify(report.warnings));
    assert.equal(report.pages.length, item.pdf.pages.length);
    assert.equal(report.sizes.length, item.pdf.pages.length);
    assert.ok(report.boxes.every((box) => String(box) === "0,0,612,792"), name);
    assert.ok(report.sizes.every((size) => String(size) === "612,792"), name);
    assert.ok(report.ink.every((count) => count > 200), name + ": every page renders ink");
    assert.equal(report.info["/Title"], item.doc.title);
    assert.equal(report.info["/Producer"], "Property Manager");
    assert.deepEqual(Object.keys(report.info).sort(), ["/Producer", "/Title"], "no dates in the document information");
    assert.equal(report.lang, "en-US");
    const blob = Files.pdfDoc(item.doc);
    assert.ok(blob instanceof Blob && blob.type === "application/pdf" && blob.size === item.bytes.length);
    assert.ok(item.bytes.subarray(0, 9).toString("latin1") === "%PDF-1.7\n" && item.bytes.toString("latin1").endsWith("\n%%EOF\n"));
  }
  // The title is stored as UTF-16BE hex with a byte-order mark.
  const title = "Lease — José & “Ünïcode” (§ 1946.2)";
  const bytes = await bytesOf(Files.pdfDoc({ title, blocks: [{ t: "p", text: "Body." }] }));
  const hex = "feff" + Array.from({ length: title.length }, (_, index) => title.charCodeAt(index).toString(16).padStart(4, "0")).join("");
  assert.ok(bytes.toString("latin1").includes("<< /Title <" + hex + "> /Producer (Property Manager) >>"));
  assert.match(bytes.toString("latin1"), /trailer\n<< \/Size \d+ \/Root 1 0 R \/Info \d+ 0 R >>/);
  const untitled = (await bytesOf(Files.pdfDoc({ blocks: [] }))).toString("latin1");
  assert.ok(untitled.includes("<< /Title <feff> /Producer (Property Manager) >>") && !untitled.includes("/DisplayDocTitle"));
});

test("12. unknown blocks are errors, empty blocks print nothing", async () => {
  for (const [blocks, message] of [
    [[{ t: "table", rows: [] }], /Unknown document block type “table” at blocks\[0\]\./],
    [[{ t: "p", text: "ok" }, { text: "no type" }], /Unknown document block type “undefined” at blocks\[1\]\./],
    [[null], /Unknown document block type “undefined” at blocks\[0\]\./],
    [["text"], /Unknown document block type “undefined” at blocks\[0\]\./],
    [[{ t: "keep", blocks: [{ t: "p", text: "ok" }, { t: "H2", text: "case matters" }] }], /Unknown document block type “H2” at blocks\[0\]\.blocks\[1\]\./],
    [[{ t: "list", style: "roman", items: ["x"] }], /Unknown list style “roman” at blocks\[0\]\./],
    [[{ t: "notice", frame: "shadow", paras: ["x"] }], /Unknown notice frame “shadow” at blocks\[0\]\./],
    [[{ t: "p", align: "right", text: "x" }], /Unknown paragraph alignment “right” at blocks\[0\]\./],
    [[{ t: "kv", rows: [{ label: "a", value: "b" }] }], /A key-terms row must be \[label, value\] at blocks\[0\]\.rows\[0\]\./],
  ]) {
    assert.throws(() => Files.pdfDoc({ blocks }), (error) => error instanceof Error && !error.code && message.test(error.message), String(message));
    assert.throws(() => Files.htmlDoc({ blocks }), message, "both writers validate the same way");
  }
  const empty = [
    { t: "title" }, { t: "title", text: "  ", sub: "Subtitle without a title" }, { t: "h1" }, { t: "h1", text: "", breakBefore: true }, { t: "h2", text: null },
    { t: "p" }, { t: "p", text: "" }, { t: "p", text: " \n \t " }, { t: "p", runs: [] }, { t: "p", runs: [{ text: "" }, { bold: true }] },
    { t: "list" }, { t: "list", items: [] }, { t: "list", items: ["", null, [], [{ text: " " }]] }, { t: "kv" }, { t: "kv", rows: [["", ""], [null, undefined]] },
    { t: "notice" }, { t: "notice", heading: "", paras: ["", null] }, { t: "check" }, { t: "check", text: "", checked: true }, { t: "sign" }, { t: "sign", parties: [] }, { t: "sign", parties: [null, "x"] },
    { t: "space" }, { t: "space", h: 0 }, { t: "space", h: "tall" }, { t: "keep" }, { t: "keep", blocks: [{ t: "p", text: "" }, { t: "keep", blocks: [] }] },
  ];
  for (const doc of [undefined, null, {}, { blocks: null }, { blocks: [] }, { title: "", footer: "", watermark: "", blocks: empty }]) {
    const pdf = await make(doc);
    assert.equal(pdf.pages.length, 1);
    assert.deepEqual(pdf.pages[0].pieces.map((piece) => piece.text), ["Page 1 of 1"]);
    assert.deepEqual(pdf.pages[0].drawn, ["1 j", "0.72 0.72 0.72 RG 0.5 w 64 48 m 548 48 l S"]);
    assert.equal(Files.htmlDoc(doc), '<article class="doc">\n\n</article>');
  }
  // Empty list items and table rows drop out before the rest is numbered.
  const pdf = await make({ blocks: [{ t: "list", style: "alpha", items: ["first", "", "second", null, "third"] }, { t: "kv", rows: [["", ""], ["Label", ""], ["", "Value only"]] }, { t: "sign", parties: [{}, { role: "Witness" }, { name: "Alex Kim" }] }] });
  assert.deepEqual(lines(pdf.pages[0]).map((line) => line.text), ["(a) first", "(b) second", "(c) third", "Label", "Value only", "Date", "Witness Date", "Alex Kim Date"]);
  for (const write of [Files.pdfDoc, Files.htmlDoc]) {
    assert.throws(() => write({ blocks: "one paragraph" }), /Document blocks must be an array at blocks\.$/);
    assert.throws(() => write({ blocks: [{ t: "keep", blocks: { t: "p", text: "x" } }] }), /Document blocks must be an array at blocks\[0\]\.blocks\.$/);
  }
  // A subtitle may be given as lines.
  const titled = await make({ blocks: [{ t: "title", text: "Lease", sub: ["Line one", "Line two"] }] });
  assert.deepEqual(lines(titled.pages[0]).map((line) => [line.text, line.size, Math.round(line.x + line.pieces[0].width / 2)]), [["Lease", 20, 306], ["Line one", 11, 306], ["Line two", 11, 306]]);
  assert.ok(Files.htmlDoc({ blocks: [{ t: "title", text: "Lease", sub: ["Line one", "Line two"] }] }).includes('<p class="doc-sub" dir="auto">Line one<br>Line two</p>'));
  // Numbers and strings are both accepted as text; odd option values fall back to defaults.
  const loose = await make({ title: 2026, blocks: [{ t: "p", text: 3200, size: "large", indent: -5, after: null }, { t: "p", text: "next" }, { t: "kv", rows: [["Rent", 3200]] }] });
  assert.deepEqual(body(loose.pages[0]).map((piece) => [piece.text, piece.size, piece.x]), [["3200", 10.5, LEFT], ["next", 10.5, LEFT], ["Rent", 10.5, LEFT], ["3200", 10.5, LEFT + 150]]);
});

test("13. text never leaves the margins: long tokens break, long values wrap", async () => {
  const url = "https://www.sandiego.gov/sites/default/files/" + "tenant-protection-guide/".repeat(14) + "index.html?source=lease&section=" + "x".repeat(180);
  const doc = {
    title: "T".repeat(400), footer: "F".repeat(400), watermark: "",
    blocks: [
      { t: "title", text: "A very long title ".repeat(8), sub: "Subtitle " + "W".repeat(140) },
      { t: "h1", text: "Heading " + "M".repeat(120) }, { t: "h2", text: "Section " + "M".repeat(120) },
      { t: "p", text: "See " + url + " for details." }, { t: "p", indent: 120, runs: [{ text: "Bold" + "B".repeat(90), bold: true }, { text: "regular" + "r".repeat(140) }] },
      { t: "list", style: "number", indent: 40, items: [url, "short", url] }, { t: "list", style: "alpha", items: Array.from({ length: 30 }, (_, index) => "Item " + index + " " + url.slice(0, 120)) },
      { t: "kv", rows: [["L".repeat(60), url], ["Label with several words that wrap in the column", "V".repeat(300)]] },
      { t: "notice", heading: "H".repeat(100), paras: [url], frame: "box" }, { t: "notice", heading: "Bar", paras: [url], frame: "bar", size: 16 },
      { t: "check", indent: 200, text: url }, { t: "sign", parties: [{ role: "Tenant", name: "N".repeat(120) }] },
      { t: "p", align: "center", text: url }, { t: "p", size: 30, text: "Large " + url.slice(0, 90) },
      ...filler(70),
    ],
  };
  const pdf = await make(doc);
  assert.ok(pdf.pages.length >= 3);
  let widest = 0;
  for (const page of pdf.pages) {
    for (const piece of page.pieces) {
      assert.ok(piece.x >= LEFT - 0.01, "left margin: " + piece.text.slice(0, 40));
      assert.ok(piece.x + piece.width <= RIGHT + 0.02, "right margin: " + (piece.x + piece.width).toFixed(2) + " " + piece.text.slice(0, 40));
      widest = Math.max(widest, piece.x + piece.width);
    }
    for (const piece of body(page)) assert.ok(piece.y - 0.22 * piece.size >= BOTTOM - 0.5 && piece.y + 0.75 * piece.size <= TOP + 0.5, "vertical margins: " + piece.y);
    assert.ok(page.pieces.filter((piece) => piece.y < BOTTOM).every((piece) => piece.y === 36));
  }
  assert.ok(widest > RIGHT - 4, "lines are filled to the margin");
  // Nothing is lost when a token is cut, and the cut prefers URL punctuation.
  const printed = pdf.pages.flatMap((page) => lines(page));
  const paragraph = printed.slice(printed.findIndex((line, index) => line.text === "See" && printed[index + 1].text.startsWith("https://")));
  const count = paragraph.findIndex((line) => line.text.endsWith("for details.")) + 1;
  assert.ok(count >= 3);
  assert.equal(paragraph.slice(0, count).map((line) => line.text).join("").replace(/ /g, ""), ("See " + url + " for details.").replace(/ /g, ""));
  assert.equal(paragraph[0].text, "See");
  assert.ok(paragraph.slice(1, 4).every((line) => /[\/\-=&?.]$/.test(line.text)), "broken after punctuation: " + paragraph.slice(1, 4).map((line) => line.text.slice(-12)).join(" | "));
  // The running header and footer are shortened with an ellipsis instead of colliding.
  const [header] = pdf.pages[1].pieces.filter((piece) => piece.y > TOP);
  const footer = pdf.pages[1].pieces.filter((piece) => piece.y < BOTTOM);
  assert.ok(/^T+…$/.test(header.text) && header.x + header.width <= RIGHT);
  assert.ok(/^F+…$/.test(footer[0].text) && footer[0].x + footer[0].width < footer[1].x - 10 && footer[1].text === "Page 2 of " + pdf.pages.length);
  // Ordinary words are never split, and a no-break space keeps its neighbors together.
  const words = await make({ blocks: [{ t: "p", text: long(400, "indivisible") }, { t: "p", text: long(60, "Civil Code §\u00a01950.5") }] });
  for (const line of lines(words.pages[0])) {
    assert.match(line.text, /^(indivisible( |$))+$|^((Civil|Code|§\u00a01950\.5)( |$))+$/);
    assert.ok(!line.text.endsWith("§"));
  }
});

test("14. keep groups, boxed notices and paragraphs break only where they should", async () => {
  let moved = 0, split = 0, total = 0;
  for (let count = 28; count <= 46; count++) {
    const kept = [{ t: "h2", text: "Kept heading" }, { t: "p", text: long(50, "kept") }, { t: "list", style: "alpha", items: ["kept item one", "kept item two"] }, { t: "space", h: 6 }, { t: "check", text: "kept check" }];
    const pdf = await make({ blocks: [...filler(count), { t: "keep", blocks: kept }, ...filler(3, "After")] });
    const where = new Set(pdf.pages.flatMap((page, index) => body(page).some((piece) => /^kept|Kept/.test(piece.text)) ? [index] : []));
    assert.equal(where.size, 1, "the keep group is split with " + count + " lines above it");
    if ([...where][0] === 1 && count <= 45) {
      moved++;
      assert.equal(lines(pdf.pages[1])[0].text, "Kept heading");
      assert.ok(Math.abs(lines(pdf.pages[1])[0].y - (TOP - 15.5 / 2 - 0.3465 * 11.5)) < 0.006, "the group starts at the top margin");
    }
    // The same blocks without keep do break in at least one of these positions.
    const loose = await make({ blocks: [...filler(count), ...kept] });
    if (new Set(loose.pages.flatMap((page, index) => body(page).some((piece) => /^kept|Kept/.test(piece.text)) ? [index] : [])).size > 1) split++;

    const notice = { t: "notice", heading: "Boxed heading", paras: [long(70, "boxed"), long(30, "boxed")], frame: "box" };
    const boxed = await make({ blocks: [...filler(count), notice, ...filler(3, "After")] });
    const pages = boxed.pages.flatMap((page, index) => body(page).some((piece) => /^boxed|Boxed/.test(piece.text)) ? [index] : []);
    assert.equal(pages.length, 1, "the boxed notice is split with " + count + " lines above it");
    const rect = strokes(boxed.pages[pages[0]], /^0\.25 0\.25 0\.25 RG 0\.8 w ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re S$/);
    assert.equal(rect.length, 1);
    assert.equal(boxed.pages.flatMap((page) => strokes(page, / re S$/)).length, 1);
    const [, , bottom, , height] = rect[0].map(Number);
    assert.ok(bottom >= BOTTOM && bottom + height <= TOP + 0.01, "the box stays inside the margins");
    assert.ok(body(boxed.pages[pages[0]]).filter((piece) => /^boxed|Boxed/.test(piece.text)).every((piece) => piece.y > bottom + 10 && piece.y < bottom + height - 10));
    total++;
  }
  assert.ok(moved >= 5 && moved < total && split >= 3, "moved " + moved + ", split without keep " + split);
  // A keep group taller than a page cannot be kept and simply flows.
  const tall = await make({ blocks: [{ t: "keep", blocks: [{ t: "h2", text: "Tall" }, ...filler(120)] }] });
  assert.equal(tall.pages.length, 3);
  assert.equal(lines(tall.pages[0]).length, 45);
  // A title stays with its subtitle, and a table row with all of its lines.
  let shifted = 0;
  for (let count = 38; count <= 46; count++) {
    const titled = await make({ blocks: [...filler(count), { t: "title", text: "Titled", sub: "Subtitle one\nSubtitle two" }] });
    assert.equal(new Set(["Titled", "Subtitle one", "Subtitle two"].map((text) => pageOf(titled, text))).size, 1, "title and subtitle share a page with " + count + " lines above");
    const table = await make({ blocks: [...filler(count), { t: "kv", rows: [["Label", long(45, "cell")], ["Second label that wraps onto two lines", "Short"]] }] });
    for (const marks of [["Label", "cell"], ["Second label", "lines", "Short"]]) {
      const where = new Set(table.pages.flatMap((page, index) => (body(page).some((piece) => marks.some((mark) => piece.text.startsWith(mark))) ? [index] : [])));
      assert.equal(where.size, 1, "a table row is split with " + count + " lines above");
      if ([...where][0] === 1 && count <= 44) shifted++;
    }
  }
  assert.ok(shifted >= 3, "the sweep should move rows to the next page");

  // Paragraphs of four or more lines never leave one line alone on either side of a break.
  let breaks = 0;
  for (let shift = 0; shift < 15; shift++) {
    const sizes = Array.from({ length: 60 }, (_, index) => 1 + ((index * 5 + shift) % 9));
    const pdf = await make({ blocks: [{ t: "space", h: shift }, ...sizes.map((size, index) => ({ t: "p", text: long(size * 12 - 3, "p" + String(index).padStart(2, "0") + "x") }))] });
    const counts = new Map();
    pdf.pages.forEach((page, at) => {
      for (const line of lines(page)) {
        const tag = line.text.slice(0, 4);
        counts.set(tag, [...(counts.get(tag) || []), at]);
      }
      assert.ok(lines(page).at(-1).y - 0.22 * 10.5 >= BOTTOM - 0.5);
    });
    for (const [tag, where] of counts) {
      const pages = [...new Set(where)];
      if (pages.length === 1) continue;
      breaks++;
      assert.equal(pages.length, 2);
      const parts = pages.map((index) => where.filter((at) => at === index).length);
      assert.ok(where.length >= 4, "a short paragraph (" + tag + ", " + where.length + " lines) stays whole");
      assert.ok(parts[0] >= 2 && parts[1] >= 2, "paragraph " + tag + " breaks " + parts.join("+"));
    }
  }
  assert.ok(breaks > 15, "the sweep should break paragraphs across pages, saw " + breaks);
  // Explicit breaks: pagebreak and breakBefore start a page; neither leaves a blank page.
  const pdf = await make({ blocks: [{ t: "p", text: "one" }, { t: "pagebreak" }, { t: "pagebreak" }, { t: "h1", text: "two", breakBefore: true }, { t: "h1", text: "three", breakBefore: true }, { t: "pagebreak" }] });
  assert.deepEqual(pdf.pages.map((page) => lines(page).map((line) => line.text)), [["one"], ["two"], ["three"]]);
  assert.ok(pdf.pages.slice(1).every((page) => Math.abs(lines(page)[0].y - (TOP - 17 / 2 - 0.3465 * 13)) < 0.006), "a heading that starts a page sits at the top margin");
  // Space is kept where it was asked for and dropped where a page happens to break.
  const spaced = await make({ blocks: [{ t: "space", h: 100 }, { t: "p", text: "after space" }, { t: "pagebreak" }, { t: "space", h: 50 }, { t: "p", text: "after break" }, ...filler(41), { t: "space", h: 60 }, { t: "p", text: "after overflow" }] });
  const first = (index) => lines(spaced.pages[index])[0];
  assert.deepEqual([first(0).text, first(1).text, first(2).text], ["after space", "after break", "after overflow"]);
  assert.deepEqual([first(0).y - first(2).y, first(1).y - first(2).y].map((value) => Math.round(value * 100) / 100), [-100, -50]);
});

test("15. runs, lists, tables and checkboxes are laid out as specified", async () => {
  const space = 0.278 * 10.5, near = (a, b) => Math.abs(a - b) < 0.011;
  // Runs: one piece per style change at its measured position, one space between words.
  let pdf = await make({
    blocks: [
      { t: "p", runs: [{ text: "Rent", bold: true }, { text: ", due monthly, is " }, { text: "$3,200.00", bold: true }, { text: " per month and " }, { text: "late after the", bold: true }, { text: " fifth day." }] },
      { t: "p", runs: [{ text: "First line\nSecond ", bold: true }, { text: "line continues " + long(40, "wrap") }], indent: 30 },
      { t: "p", text: "Centered line", align: "center" }, { t: "p", text: "Big", size: 18, after: 30 }, { t: "p", text: "Below" },
      { t: "p", runs: [{ text: "Spaces   inside \t runs ", bold: true }, { text: "  collapse  " }, { text: " to one.", bold: true }] },
    ],
  });
  let rows = lines(pdf.pages[0]);
  const mixed = rows[0].pieces;
  assert.deepEqual(mixed.map((piece) => [piece.text, piece.bold]), [["Rent", true], [", due monthly, is", false], ["$3,200.00", true], ["per month and", false], ["late after the", true], ["fifth day.", false]]);
  assert.equal(rows[0].text, "Rent, due monthly, is $3,200.00 per month and late after the fifth day.");
  mixed.slice(1).forEach((piece, index) => {
    const gap = piece.x - (mixed[index].x + mixed[index].width);
    assert.ok(near(gap, index === 0 ? 0 : space), "gap after “" + mixed[index].text + "” is " + gap.toFixed(3));
  });
  assert.ok(pdf.pages[0].pieces.every((piece) => !/^\s|\s$/.test(piece.text)), "no piece starts or ends with a space");
  assert.deepEqual([rows[1].text, rows[1].bold, rows[1].x, rows[2].pieces[0].text, rows[2].pieces[0].bold, rows[2].x], ["First line", true, LEFT + 30, "Second", true, LEFT + 30]);
  assert.ok(rows[3].x === LEFT + 30 && rows[3].text.startsWith("wrap"));
  const centered = rows.find((row) => row.text === "Centered line");
  assert.ok(near(centered.x + centered.pieces[0].width / 2, 306));
  const [big, below] = [rows.find((row) => row.text === "Big"), rows.find((row) => row.text === "Below")];
  assert.ok(big.size === 18 && Math.abs(big.y - below.y - ((18 * (14.5 / 10.5)) / 2 - 0.3465 * 18 + 30 + 14.5 / 2 + 0.3465 * 10.5)) < 0.02, "size and space after are honored");
  assert.deepEqual(rows.at(-1).pieces.map((piece) => [piece.text, piece.bold]), [["Spaces inside runs", true], ["collapse", false], ["to one.", true]]);
  assert.ok(near(rows[1].y - rows[2].y, 14.5) && near(rows[0].y - rows[1].y, 14.5 + 6), "10.5 pt text on 14.5 pt leading with 6 pt after a paragraph");
  assert.ok(near(rows[0].y, TOP - 14.5 / 2 - 0.3465 * 10.5), "the first line starts at the top margin");

  // Lists: markers, a hanging indent, and one text column per list.
  pdf = await make({ blocks: [{ t: "list", style: "alpha", indent: 20, items: Array.from({ length: 28 }, (_, index) => (index === 1 ? long(60, "hang") : "Item " + (index + 1))) }] });
  rows = lines(pdf.pages[0]);
  const markers = body(pdf.pages[0]).filter((piece) => /^\([a-z]+\)$/.test(piece.text));
  assert.deepEqual(markers.map((piece) => piece.text), [..."abcdefghijklmnopqrstuvwxyz"].map((letter) => "(" + letter + ")").concat("(aa)", "(bb)"));
  assert.ok(markers.every((piece) => piece.x === LEFT + 20));
  const hang = rows.filter((row) => /^(\(b\) )?hang/.test(row.text));
  assert.ok(hang.length >= 3);
  const column = hang[0].pieces[1].x;
  assert.ok(hang.slice(1).every((row) => row.x === column) && column > LEFT + 20 + markers[26].width + 4);
  assert.ok(rows.filter((row) => /^\([a-z]+\) Item/.test(row.text)).every((row) => row.pieces[1].x === column));
  assert.ok(near(rows[0].y - rows[1].y, 14.5 + 3), "3 pt between items");
  pdf = await make({ blocks: [{ t: "list", style: "number", items: Array.from({ length: 11 }, (_, index) => "Step " + (index + 1)) }, { t: "list", style: "bullet", indent: 0, items: ["Dot one", long(50, "dot")] }, { t: "list", style: "none", indent: 40, items: ["Plain one", "Plain two"] }, { t: "list", items: ["Default style"] }] });
  rows = lines(pdf.pages[0]);
  const steps = rows.filter((row) => /^\d+\. Step \d+$/.test(row.text));
  assert.deepEqual(steps.map((row) => row.text), Array.from({ length: 11 }, (_, index) => index + 1 + ". Step " + (index + 1)));
  assert.equal(new Set(steps.map((row) => row.pieces[1].x)).size, 1);
  assert.ok(steps[0].x === LEFT + 14 && steps[1].y < steps[0].y);
  const dots = rows.filter((row) => /^(• )?[Dd]ot/.test(row.text));
  assert.ok(dots.length >= 3 && dots[0].x === LEFT && dots[0].pieces[0].text === "•" && dots.slice(2).every((row) => row.x === dots[0].pieces[1].x));
  assert.deepEqual(rows.filter((row) => row.text.startsWith("Plain")).map((row) => [row.text, row.x]), [["Plain one", LEFT + 40], ["Plain two", LEFT + 40]]);
  assert.equal(rows.at(-1).text, "(a) Default style");

  // Key terms: bold labels in a 150 pt column, values beside them, a rule under each row.
  pdf = await make({ blocks: [{ t: "kv", rows: [["Monthly rent", "$3,200.00"], ["A label long enough to need two lines", "Short"], ["Term", long(60, "value")], ["Parties", [{ text: "José Peña", bold: true }, { text: " and others\nSecond line" }]]] }] });
  rows = lines(pdf.pages[0]);
  const rent = rows.find((row) => row.text === "Monthly rent $3,200.00");
  assert.deepEqual(rent.pieces.map((piece) => [piece.x, piece.bold]), [[LEFT, true], [LEFT + 150, false]]);
  const label = body(pdf.pages[0]).filter((piece) => piece.bold && /^A label|lines$/.test(piece.text));
  assert.ok(label.length === 2 && label[1].y < label[0].y && label.every((piece) => piece.x === LEFT && piece.x + piece.width <= LEFT + 140.01));
  const values = rows.filter((row) => row.text.includes("value"));
  assert.ok(values.length >= 2 && values.every((row) => row.pieces.at(-1).x === LEFT + 150));
  assert.deepEqual(rows.slice(-2).map((row) => row.pieces.map((piece) => [piece.text, piece.x > LEFT, piece.bold])), [[["Parties", false, true], ["José Peña", true, true], ["and others", true, false]], [["Second line", true, false]]]);
  const hair = strokes(pdf.pages[0], /^0\.72 0\.72 0\.72 RG 0\.5 w 64 ([\d.]+) m 548 \1 l S$/).map((found) => Number(found[1]));
  assert.equal(hair.length, 1 + 4 + 1, "one rule above the table, one under each row, and the footer rule");
  assert.ok(hair[0] === TOP && hair[0] > rent.y && hair[1] < rent.y && near(hair[0] - hair[1], 14.5 + 8) && hair.every((y, index) => !index || y < hair[index - 1]));
  // A table that continues on the next page starts with a rule there too.
  pdf = await make({ blocks: [...filler(43), { t: "kv", rows: Array.from({ length: 6 }, (_, index) => ["Label " + index, "Value " + index]) }] });
  assert.equal(pdf.pages.length, 2);
  assert.equal(strokes(pdf.pages[1], /^0\.72 0\.72 0\.72 RG 0\.5 w 64 730 m 548 730 l S$/).length, 1);
  assert.deepEqual([strokes(pdf.pages[1], /^0\.72 0\.72 0\.72 RG 0\.5 w 64 [\d.]+ m 548 [\d.]+ l S$/).length, lines(pdf.pages[1]).length], [1 + 5 + 1, 5]);

  // Checkboxes: a drawn 9 pt square, a drawn X when checked, text hanging beside it.
  pdf = await make({ blocks: [{ t: "check", text: "Checked " + long(40, "box"), checked: true }, { t: "check", text: "Open box", indent: 24 }, { t: "check", runs: [{ text: "Bold", bold: true }, { text: " then plain" }], checked: false }, { t: "check", text: "Only true is checked", checked: "yes" }, { t: "rule" }, { t: "p", text: "End" }] });
  rows = lines(pdf.pages[0]);
  const squares = strokes(pdf.pages[0], /^0\.10 0\.10 0\.10 RG 0\.8 w ([\d.]+) ([\d.]+) 8\.2 8\.2 re S$/).map((found) => found.slice(1).map(Number));
  const crosses = strokes(pdf.pages[0], /^0\.10 0\.10 0\.10 RG 1\.1 w 1 J ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S 0 J$/).map((found) => found.slice(1).map(Number));
  assert.deepEqual([squares.length, crosses.length], [4, 1]);
  const checked = rows.filter((row) => /^(Checked|box)/.test(row.text));
  assert.ok(checked.length >= 2 && checked.every((row) => row.x === LEFT + 16), "wrapped lines hang beside the box");
  assert.deepEqual(squares.map((square) => square[0]), [LEFT + 0.4, LEFT + 24.4, LEFT + 0.4, LEFT + 0.4]);
  assert.ok(Files.htmlDoc({ blocks: [{ t: "check", text: "Only true is checked", checked: "yes" }] }).includes('aria-label="Not checked"'));
  assert.ok(near(squares[0][1] - 0.4, checked[0].y - 1), "the box sits on the first line");
  assert.ok(crosses[0].every((value, index) => (index % 2 ? value > squares[0][1] && value < squares[0][1] + 8.2 : value > squares[0][0] && value < squares[0][0] + 8.2)), "the X stays inside its box");
  assert.equal(rows.find((row) => row.text === "Open box").x, LEFT + 24 + 16);
  assert.deepEqual(rows.find((row) => row.text === "Bold then plain").pieces.map((piece) => piece.bold), [true, false]);
  assert.ok(body(pdf.pages[0]).every((piece) => !/[□☐☑☒✓✗]/.test(piece.text)));
  const [rule] = strokes(pdf.pages[0], /^0\.72 0\.72 0\.72 RG 0\.5 w 64 ([\d.]+) m 548 \1 l S$/).map((found) => Number(found[1]));
  assert.ok(rule < rows.at(-2).y && rule > rows.at(-1).y, "the rule block draws between its neighbors");
  assert.deepEqual(rows.slice(-2).map((row) => row.text), ["Only true is checked", "End"]);
});

test("16. random documents keep every line on the page, in order and clear of its neighbors", async () => {
  let seed = 20261118, serial = 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const upTo = (max) => 1 + Math.floor(random() * max);
  const text = (max) => long(upTo(max), "w" + (++serial).toString(36));
  const several = (max, create) => Array.from({ length: upTo(max) }, create);
  const block = (nested) => {
    const kind = pick(["p", "p", "p", "p", "h2", "h2", "h1", "list", "kv", "notice", "check", "sign", "rule", "space", "pagebreak", "title", "keep"]);
    if (kind === "p") return { t: "p", text: text(140), size: pick([undefined, 9, 10.5, 12, 16]), indent: pick([0, 0, 18, 60]), align: pick([undefined, "center"]), bold: random() < 0.2, after: pick([undefined, 0, 14]) };
    if (kind === "h1") return { t: "h1", text: text(9), breakBefore: random() < 0.2 };
    if (kind === "h2") return { t: "h2", text: text(9) };
    if (kind === "list") return { t: "list", style: pick(["alpha", "number", "bullet", "none"]), indent: pick([undefined, 0, 30]), items: several(6, () => text(45)) };
    if (kind === "kv") return { t: "kv", rows: several(5, () => [text(2), text(45)]) };
    if (kind === "notice") return { t: "notice", heading: random() < 0.7 ? text(6) : undefined, paras: several(4, () => text(100)), size: pick([10.5, 12, 14]), frame: pick(["box", "bar", "none"]) };
    if (kind === "check") return { t: "check", text: text(35), checked: random() < 0.5, indent: pick([0, 16]) };
    if (kind === "sign") return { t: "sign", parties: several(3, () => ({ role: "Tenant", name: text(3) })), withDate: random() < 0.7 };
    if (kind === "title") return { t: "title", text: text(6), sub: text(9) };
    if (kind === "space") return { t: "space", h: Math.floor(random() * 90) };
    if (kind === "keep" && !nested) return { t: "keep", blocks: several(4, () => block(true)) };
    return { t: kind === "keep" ? "rule" : kind };
  };
  let pages = 0, boxes = 0;
  for (let round = 0; round < 40; round++) {
    const doc = { title: "Random " + round, footer: "Round " + round, watermark: round % 3 ? "" : "DRAFT", blocks: several(60, () => block(false)) };
    const pdf = await make(doc);
    const printed = pdf.pages.flatMap((page) => lines(page));
    assertInOrder(printed.map((line) => line.text).join(" "), strings(doc), "round " + round);
    assert.equal(printed.reduce((count, line) => count + line.text.split(" ").filter((word) => /^w[0-9a-z]+$/.test(word)).length, 0), strings(doc).join(" ").split(" ").filter((word) => /^w[0-9a-z]+$/.test(word)).length, "no word is printed twice or dropped in round " + round);
    pdf.pages.forEach((page, index) => {
      const where = "round " + round + ", page " + (index + 1);
      assert.equal(page.pieces.at(-1).text, "Page " + (index + 1) + " of " + pdf.pages.length);
      for (const piece of body(page)) {
        assert.ok(piece.x >= LEFT - 0.01 && piece.x + piece.width <= RIGHT + 0.02, where + ": side margins, " + piece.text.slice(0, 30));
        assert.ok(piece.y - 0.212 * piece.size >= BOTTOM - 0.01 && piece.y + 0.905 * piece.size <= TOP + 0.01, where + ": top and bottom margins at y " + piece.y);
      }
      const rows = lines(page);
      rows.slice(1).forEach((row, at) => {
        const gap = rows[at].y - row.y, need = 1.2 * Math.min(row.size, rows[at].size);
        assert.ok(gap >= need - 0.02, where + ": lines “" + rows[at].text.slice(0, 20) + "” and “" + row.text.slice(0, 20) + "” are " + gap.toFixed(2) + " pt apart");
      });
      // Frames stay inside the margins and around their own text.
      for (const [, x, y, w, h] of strokes(page, /^0\.25 0\.25 0\.25 RG 0\.8 w ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re S$/).map((found) => found.map(Number))) {
        boxes++;
        assert.ok(x >= LEFT && x + w <= RIGHT && y >= BOTTOM - 0.01 && y + h <= TOP + 0.01, where + ": box inside the margins");
        assert.ok(rows.some((row) => row.y > y && row.y < y + h), where + ": box around text");
      }
      for (const [, , top, , bottom] of strokes(page, /^0\.35 0\.35 0\.35 RG 2 w ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S$/).map((found) => found.map(Number)))
        assert.ok(top <= TOP + 0.01 && bottom >= BOTTOM - 0.01 && top > bottom, where + ": side rule inside the margins");
    });
    pages += pdf.pages.length;
    // The HTML writer carries the same text in the same order.
    assertInOrder(squash(Files.htmlDoc(doc).replace(/<\/?strong>/g, "").replace(/<[^>]+>/g, " ")), strings(doc), "HTML, round " + round);
  }
  assert.ok(pages > 150 && boxes > 8, pages + " pages and " + boxes + " boxed notices were checked");
});

test("sample lease files", async (t) => {
  const { doc, bytes, pdf } = built.draft;
  const html = Files.htmlDoc(doc, { standalone: true });
  t.diagnostic("Sample lease: " + pdf.pages.length + " pages, " + bytes.length + " PDF bytes, " + Buffer.byteLength(html) + " HTML bytes.");
  if (!process.env.DOC_SAMPLE_DIR) return;
  fs.mkdirSync(process.env.DOC_SAMPLE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.DOC_SAMPLE_DIR, "sample.pdf"), bytes);
  fs.writeFileSync(path.join(process.env.DOC_SAMPLE_DIR, "sample.html"), html);
  t.diagnostic("Saved sample.pdf and sample.html in " + path.resolve(process.env.DOC_SAMPLE_DIR));
});
