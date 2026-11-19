/* Run with node --test github-sync-tests.cjs. All GitHub traffic is simulated. */
"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {assets} = require("./build-static.cjs");
let chromium;
try { ({chromium} = require(process.env.PLAYWRIGHT_CORE || "playwright-core")); }
catch { ({chromium} = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core"))); }

test("reviewed encrypted GitHub sync from the normal settings entry point", async t => {
  const server = http.createServer((req, res) => {
    const name = req.url === "/app/" ? "index.html" : req.url.slice("/app/".length);
    if (!req.url.startsWith("/app/") || !assets.includes(name) || !fs.existsSync(path.join(__dirname, name))) {
      res.writeHead(404).end(); return;
    }
    const mime = {".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".pdf":"application/pdf"};
    res.setHeader("content-type", mime[path.extname(name)] || "application/octet-stream");
    res.end(fs.readFileSync(path.join(__dirname, name)));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const executablePath = process.env.CHROME_PATH || (process.platform === "win32" ? path.join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe") : undefined);
  const browser = await chromium.launch({headless: true, executablePath});
  t.after(() => browser.close());
  const token = "github_pat_synthetic_fixture";
  const password = "synthetic-vault-password";
  const repo = {id: 1, full_name: "sample/private-data", private: true, visibility: "private", has_pages: false, default_branch: "main"};
  const vaultPath = "property-manager/owner.pmvault";
  let bytes, sha, puts = 0;
  async function device() {
    const context = await browser.newContext({serviceWorkers: "block"});
    await context.route("https://api.github.com/**", async route => {
      const request = route.request();
      assert.equal(request.headers().authorization, "Bearer " + token);
      assert.ok(!request.url().includes(token));
      const base = "https://api.github.com/repos/" + repo.full_name;
      if (request.url() === base) return route.fulfill({json: repo});
      if (request.url() === base + "/contents/" + vaultPath + "?ref=main")
        return bytes ? route.fulfill({json: {path: vaultPath, type: "file", sha, size: bytes.length}}) : route.fulfill({status: 404});
      if (sha && request.url() === base + "/git/blobs/" + sha) return route.fulfill({body: bytes});
      assert.equal(request.url(), base + "/contents/" + vaultPath);
      assert.equal(request.method(), "PUT");
      const body = request.postDataJSON();
      assert.equal(body.branch, "main");
      if (body.sha !== sha) return route.fulfill({status: 409});
      bytes = Buffer.from(body.content, "base64");
      assert.equal(bytes.subarray(0, 8).toString(), "PMVAULT2");
      for (const text of [token, password, "Personal property test", "original bytes"]) assert.ok(!bytes.includes(Buffer.from(text)));
      sha = crypto.createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
      puts++;
      return route.fulfill({status: 201, json: {content: {sha, path: vaultPath}}});
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    await page.goto("http://127.0.0.1:" + server.address().port + "/app/");
    await page.locator("#rail-backup strong").waitFor();
    return page;
  }
  async function openSettings(page) {
    await page.locator('.avatar[data-act="settings"]').click();
    await page.getByRole("button", {name: /GitHub sync/}).click();
    await page.locator("#github-token").waitFor();
  }
  async function start(page, mode = "sync", pass = password) {
    await openSettings(page);
    await page.locator("#github-repo").fill(repo.full_name);
    await page.locator("#github-token").fill(token);
    await page.locator("#github-pass").fill(pass);
    await page.locator("#github-mode").selectOption(mode);
    await page.getByRole("button", {name: "Review GitHub sync", exact: true}).click();
  }
  const source = await device();
  await source.evaluate(async () => {
    const hash = await Store.storeBlob("owner", new Blob(["original bytes"]));
    await Store.save("owner", [
      {type:"property", id:"office", name:"Personal property test"},
      {type:"document", id:"doc", name:"Receipt", propertyId:"office", hash},
    ]);
  });
  await start(source);
  await source.locator("#github-confirm").fill(password);
  await source.getByRole("button", {name: "Upload encrypted snapshot", exact: true}).click();
  await source.locator("dialog").waitFor({state:"hidden"});
  assert.equal(puts, 1);
  assert.equal(await source.evaluate(async () => (await Store.status("owner")).backupEvidence), "GitHub confirmed encrypted snapshot");
  const dest = await device();
  await start(dest, "pull", "incorrect-password");
  await dest.locator("#vault-result").filter({hasText:/authenticate/}).waitFor();
  assert.equal((await dest.evaluate(() => Store.list("owner"))).length, 0);
  await dest.locator("#dialog-close").click();
  await start(dest, "pull");
  await dest.getByRole("button", {name:"Apply reviewed merge"}).click();
  await dest.locator("dialog").waitFor({state:"hidden"});
  assert.equal(await dest.evaluate(async () => {
    const doc = (await Store.list("owner")).find(r => r.id === "doc");
    return (await Store.getBlob("owner", doc.hash)).text();
  }), "original bytes");
  assert.equal(puts, 1);
  await dest.evaluate(() => Store.save("owner", [{type:"task",id:"next",title:"New record"}]));
  await start(dest);
  await dest.getByRole("button", {name:"Merge and upload encrypted snapshot"}).click();
  await dest.locator("dialog").waitFor({state:"hidden"});
  assert.equal(puts, 2);
  await start(source);
  await source.getByRole("button", {name:"Merge and upload encrypted snapshot"}).waitFor();
  sha = crypto.createHash("sha1").update("competing revision").digest("hex");
  await source.getByRole("button", {name:"Merge and upload encrypted snapshot"}).click();
  await source.locator("#vault-result").filter({hasText:/local merge was saved/}).waitFor();
  assert.ok((await source.evaluate(() => Store.list("owner"))).some(r => r.id === "next"));
  assert.equal(puts, 2);
  await source.locator("#dialog-close").click();
  repo.private = false;
  await start(source);
  await source.locator("#vault-result").filter({hasText:/private data repository/}).waitFor();
  await source.locator("#dialog-close").click();
  assert.equal(await source.locator("#github-token").inputValue(), "");
  assert.equal(await source.locator("#github-pass").inputValue(), "");
  const prefs = await source.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  assert.ok(!prefs.includes(token) && !prefs.includes(password));
  assert.equal(puts, 2);
});
