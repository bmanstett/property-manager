"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  os = require("node:os");
const assert = require("node:assert/strict"),
  test = require("node:test");
const appFiles = new Set([
  "index.html",
  "style.css",
  "accessibility.css",
  "money.css",
  "lease.css",
  "icons.js",
  "export.js",
  "storage.js",
  "github-sync.js",
  "money.js",
  "leases.js",
  "lease-notices.js",
  "rules.js",
  "pdf-font.js",
  "records.js",
  "app.js",
  "sw.js",
  "manifest.webmanifest",
]);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".jpg": "image/jpeg",
};
const start = (port = 0) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const key =
        new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
      if (
        !appFiles.has(key) &&
        !/^assets\/[\w.-]+$|^legal-assets\/[\w.-]+$|^LICENSE-Liberation\.txt$/.test(
          key,
        )
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      fs.readFile(path.join(__dirname, key), (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.setHeader(
          "Content-Type",
          mime[path.extname(key)] || "application/octet-stream",
        );
        res.end(data);
      });
    });
    server.on("error", reject).listen(port, "127.0.0.1", () => resolve(server));
  });
if (process.argv.includes("--preview")) {
  start(8427).then(() =>
    console.log("Property Manager preview http://127.0.0.1:8427/"),
  );
} else {
  let chromium;
  try {
    ({ chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core"));
  } catch {
    ({ chromium } = require(
      path.join(
        os.homedir(),
        ".cache",
        "codex-runtimes",
        "codex-primary-runtime",
        "dependencies",
        "node",
        "node_modules",
        "playwright-core",
      ),
    ));
  }
  test("Property Manager owner and document journeys", async (t) => {
    const server = await start();
    t.after(() => server.close());
    const browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH ||
        path.join(
          process.env.ProgramFiles,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        ),
      headless: true,
    });
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(6500);
    const base = "http://127.0.0.1:" + server.address().port;
    const uncaught = [];
    page.on("pageerror", (e) => uncaught.push(e.message));
    await page.goto(base);
    await page.getByRole("heading", { name: "Property overview" }).waitFor();
    const sampleCount = await page.evaluate(() => PM.all().length);
    const clickAct = (name) =>
      page
        .locator('[data-act="' + name + '"]:visible')
        .first()
        .click();
    const close = async () => {
      if (await page.locator("dialog[open]").count())
        await page.locator("#dialog-close").click();
    };
    const nav = async (n) => {
      await close();
      await page
        .locator('[data-nav="' + n + '"]:visible')
        .first()
        .click();
    };
    await t.test(
      "home, desktop and iPhone widths, navigation, global search and keyboard",
      async () => {
        const dir = path.join(__dirname, "qa-screens");
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, "home-desktop.png") });
        for (const w of [375, 390, 430, 768]) {
          await page.setViewportSize({ width: w, height: 844 });
          for (const n of ["Home", "Money", "Leases", "Documents", "Tasks"]) {
            await nav(n);
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              n + " exceeds " + w,
            );
          }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await nav("Home");
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(dir, "home-mobile.png") });
        await page.keyboard.press("/");
        await page.locator("#global-search").fill("irrigation");
        await page
          .getByRole("button", { name: /Review irrigation estimate/ })
          .last()
          .click();
        await page.getByRole("heading", { name: "Task details" }).waitFor();
        await close();
        await page.setViewportSize({ width: 1440, height: 1000 });
      },
    );
    await t.test(
      "owner setup, opening deposit, partial and final receipts via actual forms",
      async () => {
        await clickAct("properties");
        await clickAct("setup");
        const f = page.locator("#setup-form");
        const date = await page.evaluate(() => PM.today().slice(0, 7) + "-01");
        for (const [n, v] of Object.entries({
          name: "Synthetic owner rental",
          household: "Synthetic household",
          start: date,
          nextDue: date,
          rent: "3000",
          deposit: "2400",
        }))
          await f.locator('[name="' + n + '"]').fill(v);
        await f
          .getByRole("button", { name: "Create rental workspace" })
          .click();
        await page.waitForFunction(
          () => PM.dataset() === "owner" && PM.records("charge").length > 0,
        );
        let m = await page.evaluate(() => Money.home());
        assert.equal(m.received, 0);
        assert.equal(m.deposit, 240000);
        assert.equal(m.outstanding, 300000);
        for (const [n, balance] of [
          ["1000", 200000],
          ["2000", 0],
        ]) {
          await clickAct("payment");
          const f = page.locator("#mf-form");
          await f.locator("[name=amount]").fill(n);
          await f.locator('[name^="allocation:"]').first().fill(n);
          await f.getByRole("button", { name: "Save payment" }).click();
          await page.waitForFunction(
            (x) => Money.home().outstanding === x,
            balance,
          );
        }
        m = await page.evaluate(() => Money.home());
        assert.equal(m.received, 300000);
        assert.equal(m.income, 300000);
        assert.equal(m.deposit, 240000);
      },
    );
    await t.test(
      "manual file review, duplicate warning and exact original-byte retrieval",
      async () => {
        await nav("Documents");
        await clickAct("import");
        const sample = {
          name: "original-report.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(
            "Synthetic condition report\nWindows and doors inspected.\n",
          ),
        };
        await page.locator("#import-files").setInputFiles(sample);
        await page.locator("#commit-docs").waitFor();
        await page
          .getByRole("button", { name: "Import reviewed files" })
          .click();
        await page
          .getByRole("button", { name: /original-report\.txt/ })
          .click();
        await page
          .getByText("Windows and doors inspected.", { exact: false })
          .first()
          .waitFor();
        const original = await page.evaluate(async () => {
          const d = PM.records("document")[0];
          return (await PM.file(d.hash)).text();
        });
        assert.equal(original, sample.buffer.toString());
        await close();
        await clickAct("import");
        await page.locator("#import-files").setInputFiles(sample);
        await page.getByText(/Identical file already seen/).waitFor();
        assert.equal(await page.locator("[name=use0]").isChecked(), false);
        await close();
      },
    );
    await t.test(
      "inspect, complete, compare, and retain earlier snapshot",
      async () => {
        await nav("Tasks");
        await page
          .getByRole("button", { name: "Inspections", exact: true })
          .click();
        await clickAct("inspect-new");
        await page
          .locator("#inspection-form [name=title]")
          .fill("Fall inspection");
        await page.locator("[name=cond0]").selectOption("Ordinary wear");
        await page.locator("[name=note0]").fill("Small floor scuff");
        await page
          .getByRole("button", { name: "Complete inspection", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Save completed snapshot" })
          .click();
        await page.getByRole("button", { name: /Fall inspection/ }).click();
        await page.getByRole("button", { name: "Create revision" }).click();
        await page.locator("[name=note0]").fill("Follow-up complete");
        await page.getByRole("button", { name: "Save progress" }).click();
        await clickAct("compare");
        assert.equal(await page.locator("#side-0,#side-1").count(), 2);
        await close();
        assert.equal(
          await page.evaluate(
            () =>
              PM.records("inspection").find((i) => i.completed).items[0].notes,
          ),
          "Small floor scuff",
        );
      },
    );
    await t.test(
      "outbox retains attachment versions and canceled native share stays ready",
      async () => {
        await nav("Tasks");
        await page.getByRole("button", { name: "Outbox", exact: true }).click();
        await clickAct("compose");
        await page.locator("[name=to]").fill("renter@example.invalid");
        await page.locator("#mail-form details summary").click();
        await page.locator("[name=attachment]").first().check();
        await page.getByRole("button", { name: "Review for outbox" }).click();
        await page.locator("#recipient-ok").check();
        await page.locator("#mail-ready").click();
        await page.waitForFunction(
          () => PM.records("communication")[0]?.status === "Ready",
        );
        await page.evaluate(() => {
          Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async () => {
              throw new DOMException("Canceled", "AbortError");
            },
          });
          Object.defineProperty(navigator, "canShare", {
            configurable: true,
            value: () => true,
          });
          Work.open("message", PM.records("communication")[0].id);
        });
        await page.locator("#recipient-ok").check();
        await page.locator("#mail-share").click();
        assert.equal(
          await page.evaluate(() => PM.records("communication")[0].status),
          "Ready",
        );
        assert.equal(
          await page.evaluate(
            () => PM.records("communication")[0].attachments.length,
          ),
          1,
        );
        await close();
      },
    );
    await t.test(
      "reprice a future charge, close a tenancy and open a successor without changing received rent",
      async () => {
        const edit = async () => {
          await nav("Home");
          await clickAct("property");
          await page
            .getByRole("button", { name: /Synthetic household/ })
            .click();
        };
        await edit();
        const due = await page.evaluate(() =>
          PM.records("charge")
            .map((c) => c.date)
            .sort()
            .at(-1),
        );
        await page.locator("#rental-details summary").click();
        await page.locator("#rental-details [name=rent]").fill("3300");
        await page.locator("#rental-details [name=from]").fill(due);
        await page
          .locator("#rental-details [name=reason]")
          .fill("Synthetic documented renewal");
        await page.getByRole("button", { name: "Save rental details" }).click();
        await page
          .getByRole("button", { name: "Confirm schedule change" })
          .click();
        await page.waitForFunction(
          (d) =>
            PM.records("charge").find((c) => c.date === d)?.amount === 330000,
          due,
        );
        await edit();
        const date = await page.evaluate(() => PM.today());
        await page.locator("#rental-details [name=end]").fill(date);
        await page
          .locator("#rental-details [name=reason]")
          .fill("Possession returned");
        await page.getByRole("button", { name: "Save rental details" }).click();
        await page
          .getByRole("button", { name: "Confirm schedule change" })
          .click();
        await page.waitForFunction(
          (d) => !PM.records("charge").some((c) => c.date === d),
          due,
        );
        assert.equal(
          await page.evaluate(() => PM.records("scheduleAdjustment").length),
          2,
        );
        assert.equal(await page.evaluate(() => Money.home().received), 300000);
        await clickAct("property");
        await clickAct("new-household");
        await page
          .locator("#rental-details [name=household]")
          .fill("Successor household");
        await page.locator("#rental-details [name=start]").fill(due);
        await page.getByRole("button", { name: "Save rental details" }).click();
        await page.waitForFunction(() => PM.records("tenancy").length === 2);
      },
    );
    await t.test(
      "committed owner records persist after reload and stay isolated from sample",
      async () => {
        await page.reload();
        await page.waitForFunction(() => PM?.records("document").length === 1);
        assert.equal(await page.evaluate(() => Money.home().received), 300000);
        assert.equal(
          await page.evaluate(() => PM.all("property")[0].name),
          "Synthetic owner rental",
        );
        assert.equal(
          await page.evaluate(async () => (await Store.list("sample")).length),
          sampleCount,
        );
        assert.deepEqual(uncaught, []);
      },
    );
  });
}
