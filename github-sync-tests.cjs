/* Run with node --test github-sync-tests.cjs. All GitHub traffic is simulated.
   These tests drive the Backup & sync panels through the interface. Buttons are found by id so
   that rewording a label is a one-line change here; each screen's main label is asserted once. */
"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {assets} = require("./build-static.cjs");
let chromium;
try { ({chromium} = require(process.env.PLAYWRIGHT_CORE || "playwright-core")); }
catch { ({chromium} = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core"))); }

async function launch(t) {
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
  return {browser, url: "http://127.0.0.1:" + server.address().port + "/app/"};
}
const title = (page, text) => page.locator("dialog[open] #dialog-title").filter({hasText: text}).waitFor();
const submit = async (page, label) => {
  // Each step reuses the same button id, so wait for the step that carries this label.
  const button = page.locator("dialog[open] #vault-submit").filter({hasText: label});
  await button.waitFor();
  assert.equal(await button.innerText(), label);
  await button.click();
};
/* Nothing typed into these panels may be kept as a draft, passwords least of all. */
const nothingKept = async page =>
  assert.equal(await page.locator("dialog[open]").locator("input[name], select[name], textarea[name]").count(), 0);

/* ---------- Sync with GitHub ---------- */
const vaultPath = "property-manager/owner.pmvault";
const KEPT = {key: "propertymanager.githubKey", password: "propertymanager.githubPassword", repository: "propertymanager.githubRepository"};
/* What this device remembers for sync. */
const kept = page => page.evaluate(names => Object.fromEntries(Object.entries(names).map(([k, name]) => [k, localStorage.getItem(name) || ""])), KEPT);
const privateRepo = (full_name, id = 1) => ({id, full_name, private: true, visibility: "private", has_pages: false, default_branch: "main"});
/* A pretend GitHub. world = {token, repos, listed, vaults, puts, secrets, calls}:
     listed   the names GET /user/repos answers with, or a status such as 403 when it will not list
     vaults   the online backup in each repository, by name: {bytes, sha}
     secrets  text that must never be found in an upload */
function simulate(context, world) {
  return context.route("https://api.github.com/**", async route => {
    const request = route.request(), url = new URL(request.url());
    world.calls.push(request.method() + " " + url.pathname);
    assert.ok(!request.url().includes(world.token), "the key is never put in an address");
    if (request.headers().authorization !== "Bearer " + world.token) return route.fulfill({status: 401, json: {message: "Bad credentials"}});
    if (url.pathname === "/user/repos") {
      assert.equal(url.search, "?visibility=private&sort=pushed&per_page=100");
      return typeof world.listed === "number" ? route.fulfill({status: world.listed}) : route.fulfill({json: world.repos.filter(r => world.listed.includes(r.full_name))});
    }
    const match = /^\/repos\/([^/]+\/[^/]+?)(\/.*)?$/.exec(url.pathname);
    const repo = match && world.repos.find(r => r.full_name === match[1]);
    if (!repo) return route.fulfill({status: 404});
    const rest = match[2] || "", vault = world.vaults[repo.full_name];
    if (!rest) return route.fulfill({json: repo});
    if (request.method() === "GET" && rest === "/contents/" + vaultPath) {
      assert.ok(["", "?ref=main"].includes(url.search));
      return vault ? route.fulfill({json: {path: vaultPath, type: "file", sha: vault.sha, size: vault.bytes.length}}) : route.fulfill({status: 404});
    }
    if (vault && rest === "/git/blobs/" + vault.sha) return route.fulfill({body: vault.bytes});
    assert.equal(rest, "/contents/" + vaultPath);
    assert.equal(request.method(), "PUT");
    const body = request.postDataJSON();
    assert.equal(body.branch, "main");
    if (body.sha !== vault?.sha) return route.fulfill({status: 409});
    const bytes = Buffer.from(body.content, "base64");
    assert.equal(bytes.subarray(0, 8).toString(), "PMVAULT2");
    for (const text of [world.token, ...world.secrets]) assert.ok(!bytes.includes(Buffer.from(text)), "an upload is locked");
    world.vaults[repo.full_name] = {bytes, sha: crypto.createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex")};
    world.puts++;
    return route.fulfill({status: 201, json: {content: {sha: world.vaults[repo.full_name].sha, path: vaultPath}}});
  });
}
const newWorld = (more = {}) => ({token: "github_pat_synthetic_fixture", repos: [privateRepo("sample/private-data")], listed: ["sample/private-data"], vaults: {}, puts: 0, secrets: ["Personal property test", "original bytes"], calls: [], ...more});
async function syncDevice(browser, url, world, {records = false} = {}) {
  const context = await browser.newContext({serviceWorkers: "block"});
  // A page opened from a file has no origin to name, so there the grant covers the whole context.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], url.startsWith("file:") ? undefined : {origin: new URL(url).origin});
  await simulate(context, world);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(url);
  await page.locator("#rail-backup strong").waitFor();
  if (records) await page.evaluate(async () => {
    const hash = await Store.storeBlob("owner", new Blob(["original bytes"]));
    await Store.save("owner", [
      {type:"property", id:"office", name:"Personal property test"},
      {type:"document", id:"doc", name:"Receipt", propertyId:"office", hash},
    ]);
  });
  return page;
}
/* Settings, GitHub sync: the screen as the owner reaches it, which does not start anything by itself. */
async function openSync(page) {
  if (await page.locator("dialog[open]").count()) await page.locator("#dialog-close").click();
  await page.locator('.avatar[data-act="settings"]').click();
  await page.getByRole("button", {name: /GitHub sync/}).click();
  await title(page, "Sync with GitHub");
  await page.locator("dialog[open] #vault-submit").waitFor();
}
/* Paste the way a person does: copy, click into the box, Ctrl+V. Nothing else is pressed. */
async function pasteKey(page, token) {
  await page.evaluate(text => navigator.clipboard.writeText(text), token);
  await page.locator("#github-token").click();
  await page.keyboard.press("Control+V");
}
const onlyDownload = async page => {
  await page.locator("#github-more > details > summary").click();
  await page.locator("#github-pull").check();
};
const summary = page => page.evaluate(async () => (await Store.status("owner")).summary.state);
const errorSays = (page, pattern) => page.locator("#vault-result.ui-note--error").filter({hasText: pattern}).waitFor();

test("sync with GitHub: paste the access key once, and nothing else is typed", async t => {
  const {browser, url} = await launch(t);
  const world = newWorld(), repo = world.repos[0], token = world.token;
  const source = await syncDevice(browser, url, world, {records: true});
  assert.equal(await summary(source), "never");

  // The first screen asks for one thing: the key. No repository name and no password.
  await openSync(source);
  await nothingKept(source);
  assert.deepEqual(await source.locator("dialog[open] input:visible").evaluateAll(list => list.map(i => i.id)), ["github-token"]);
  assert.equal(await source.locator("#github-repo, #github-pass").count(), 0);
  assert.equal(await source.locator("dialog[open] select").count(), 0);
  await source.locator(".bk-steps").filter({hasText: "the app finds the repository and remembers the key"}).waitFor();

  // Pasting is enough. The key is remembered, the repository is found, and the first backup is ready to go.
  await pasteKey(source, token);
  await title(source, "Create your online backup");
  assert.deepEqual(await kept(source), {key: token, password: "", repository: repo.full_name});
  assert.ok(world.calls.includes("GET /user/repos"));
  await source.locator(".bk-lead").filter({hasText: "This is the first backup in " + repo.full_name}).waitFor();
  // The app made the backup password. It can be read and copied, and nothing has to be typed.
  const password = await source.locator("#github-pass").inputValue();
  assert.match(password, /^[a-hjkmnp-z2-9]{5}(-[a-hjkmnp-z2-9]{5}){3}$/);
  assert.equal(await source.locator("#github-pass").getAttribute("type"), "text");
  assert.equal(await source.locator("#github-confirm").count(), 0);
  await source.locator("#github-copy").click();
  assert.equal(await source.evaluate(() => navigator.clipboard.readText()), password);
  world.secrets.push(password);
  await submit(source, "Upload first backup");
  await source.locator("dialog").waitFor({state:"hidden"});
  assert.equal(world.puts, 1);
  assert.equal(await source.evaluate(async () => (await Store.status("owner")).backupEvidence), "GitHub confirmed encrypted snapshot");
  assert.equal(await summary(source), "current");
  assert.equal(await source.evaluate(() => Store.syncRepository()), repo.full_name);
  assert.deepEqual(await kept(source), {key: token, password, repository: repo.full_name});

  // A second device: the same key, then the backup password once.
  const dest = await syncDevice(browser, url, world);
  await openSync(dest);
  await onlyDownload(dest);
  await dest.locator("#github-token").fill(token);
  await submit(dest, "Sync now");
  await title(dest, "Open your online backup");
  await nothingKept(dest);
  await dest.locator(".bk-lead").filter({hasText: repo.full_name + " already holds your online backup"}).waitFor();
  await dest.locator("#github-pass").fill("incorrect-password");
  await submit(dest, "Open backup");
  await errorSays(dest, /password did not open this backup/);
  assert.equal((await dest.evaluate(() => Store.list("owner"))).length, 0);
  assert.equal((await kept(dest)).password, "", "a password that did not work is not remembered");
  await dest.locator("#github-pass").fill(password);
  await submit(dest, "Open backup");
  await title(dest, "Review and finish sync");
  await submit(dest, "Bring in changes");
  await dest.locator("dialog").waitFor({state:"hidden"});
  assert.equal(await dest.evaluate(async () => {
    const doc = (await Store.list("owner")).find(r => r.id === "doc");
    return (await Store.getBlob("owner", doc.hash)).text();
  }), "original bytes");
  assert.equal(world.puts, 1);
  // A device that only downloaded says so. It does not claim to be backed up.
  assert.equal(await summary(dest), "brought");
  assert.deepEqual(await kept(dest), {key: token, password, repository: repo.full_name});

  // From now on a sync asks for nothing: no key, no password, no repository.
  await dest.evaluate(() => Store.save("owner", [{type:"task",id:"next",title:"New record"}]));
  await openSync(dest);
  await nothingKept(dest);
  assert.equal(await dest.locator("#github-token, #github-repo, #github-pass").count(), 0);
  await dest.locator(".bk-repo").filter({hasText: "Syncing with " + repo.full_name}).waitFor();
  await submit(dest, "Sync now");
  await submit(dest, "Finish sync");
  await dest.locator("dialog").waitFor({state:"hidden"});
  assert.equal(world.puts, 2);
  assert.equal(await summary(dest), "current");

  // The saved backup password can be read back, for adding another device.
  await openSync(source);
  await source.locator("#github-more > details > summary").click();
  assert.equal(await source.locator("#github-saved").inputValue(), password);
  assert.equal(await source.locator("#github-saved").getAttribute("type"), "password");
  await source.getByRole("button", {name: "Show backup password"}).click();
  assert.equal(await source.locator("#github-saved").getAttribute("type"), "text");
  await submit(source, "Sync now");
  await title(source, "Review and finish sync");
  await source.locator("#vault-submit").waitFor();
  world.vaults[repo.full_name].sha = crypto.createHash("sha1").update("competing revision").digest("hex");
  await submit(source, "Finish sync");
  // The other device's changes are kept even though this device's upload was refused.
  await title(source, "Sync did not finish");
  await source.locator("#vault-result.ui-note--warn").filter({hasText:/Uploading this device’s changes did not finish/}).waitFor();
  assert.ok((await source.evaluate(() => Store.list("owner"))).some(r => r.id === "next"));
  assert.equal(world.puts, 2);
  await submit(source, "Try sync again");
  await title(source, "Review and finish sync");
  await submit(source, "Finish sync");
  await source.locator("dialog").waitFor({state:"hidden"});
  assert.equal(world.puts, 3);
  assert.equal(await summary(source), "current");

  // The reminder on Home is one press: it opens the screen and starts the sync by itself.
  await source.evaluate(() => PM.action("sync-now"));
  await title(source, "Review and finish sync");
  await source.locator("#dialog-close").click();
  // Going back to the sync screen from a later step does not start another sync.
  await source.evaluate(() => PM.action("github-sync"));
  await title(source, "Sync with GitHub");
  await source.locator("dialog[open] #vault-submit").filter({hasText: "Sync now"}).waitFor();
  await source.waitForTimeout(300);
  assert.equal(await source.locator("#vault-result").isHidden(), true);

  repo.private = false;
  await submit(source, "Sync now");
  await errorSays(source, /sync needs a private repository/);
  await source.locator("#dialog-close").click();
  assert.equal(world.puts, 3);

  // What is remembered stays in this browser's settings: never in the records, a backup or the address.
  for (const page of [source, dest]) {
    const records = JSON.stringify(await page.evaluate(async () => [await Store.list("owner"), await Store.history("owner")]));
    assert.ok(!records.includes(token) && !records.includes(password));
    assert.ok(!(await page.evaluate(() => JSON.stringify(sessionStorage) + location.href)).includes(token));
  }
  assert.deepEqual(await kept(source), {key: token, password, repository: repo.full_name});
});

test("sync with GitHub: finding the repository from the key, and keys that stop working", async t => {
  const {browser, url} = await launch(t);
  const token = "github_pat_synthetic_fixture";
  const fresh = async (more, options) => {
    const world = newWorld(more);
    return {world, page: await syncDevice(browser, url, world, {records: true, ...options})};
  };
  const enterKey = async (page, key = token) => {
    await openSync(page);
    await page.locator("#github-token").fill(key);
    await submit(page, "Sync now");
  };

  await t.test("a key that can open several repositories uses the one that holds the backup", async () => {
    const {world, page} = await fresh({repos: [privateRepo("sample/notes", 1), privateRepo("sample/rental-backup", 2)], listed: ["sample/notes", "sample/rental-backup"]});
    world.vaults["sample/rental-backup"] = {bytes: Buffer.from("PMVAULT2" + "x".repeat(60)), sha: "a".repeat(40)};
    await enterKey(page);
    await title(page, "Open your online backup");
    assert.equal((await kept(page)).repository, "sample/rental-backup");
    await page.context().close();
  });

  await t.test("when none of them holds a backup yet, the owner picks one, without a dropdown", async () => {
    const {page} = await fresh({repos: [privateRepo("sample/notes", 1), privateRepo("sample/rental-backup", 2)], listed: ["sample/notes", "sample/rental-backup"]});
    await enterKey(page);
    await errorSays(page, "This key can open more than one private repository. Choose the one for your backup.");
    assert.equal((await kept(page)).key, token, "the key is kept while the owner chooses");
    assert.equal(await page.locator("dialog[open] select").count(), 0);
    assert.deepEqual(await page.locator("#github-choose [data-repository]").evaluateAll(list => list.map(b => b.innerText.replace(/\s+/g, " ").trim())), ["sample/notes No backup here yet", "sample/rental-backup No backup here yet"]);
    await page.locator('#github-choose [data-repository="sample/rental-backup"]').click();
    await title(page, "Create your online backup");
    assert.equal((await kept(page)).repository, "sample/rental-backup");
    await page.context().close();
  });

  await t.test("when GitHub will not say which repositories a key opens, the name can still be typed", async () => {
    for (const listed of [403, []]) {
      const {page} = await fresh({listed});
      await enterKey(page);
      await errorSays(page, /could not tell which repository this key is for/);
      assert.equal(await page.locator("#github-repo").getAttribute("name"), null);
      await page.locator("#github-repo").fill("sample/private-data");
      await submit(page, "Sync now");
      await title(page, "Create your online backup");
      assert.deepEqual(await kept(page), {key: token, password: "", repository: "sample/private-data"});
      await page.context().close();
    }
  });

  await t.test("something that is not a key, or a key GitHub refuses, is not kept", async () => {
    const {world, page} = await fresh();
    await enterKey(page, "ghp_classic_token_style");
    await errorSays(page, "That does not look like a GitHub access key. It should start with github_pat_.");
    assert.deepEqual(world.calls, [], "nothing was sent to GitHub");
    assert.equal((await kept(page)).key, "");
    await page.locator("#github-token").fill("github_pat_someone_elses_key");
    await submit(page, "Sync now");
    await errorSays(page, "GitHub did not accept the access key. It may have expired or been deleted. Create a new key on GitHub and paste it here.");
    assert.equal((await kept(page)).key, "");
    assert.equal(await page.locator("#github-token").isVisible(), true);
    await page.context().close();
  });

  await t.test("a saved key that expires is asked for again, and the rest is remembered", async () => {
    const {world, page} = await fresh();
    await enterKey(page);
    await title(page, "Create your online backup");
    const password = await page.locator("#github-pass").inputValue();
    world.secrets.push(password);
    await submit(page, "Upload first backup");
    await page.locator("dialog").waitFor({state:"hidden"});
    // GitHub stops accepting the key (it expired). The app says so and asks for a new one.
    const renewed = "github_pat_renewed_fixture";
    world.token = renewed;
    await openSync(page);
    await submit(page, "Sync now");
    await errorSays(page, /GitHub did not accept the access key\. It may have expired/);
    await page.locator("#github-token").waitFor();
    await page.locator(".bk-repo").filter({hasText: "Syncing with sample/private-data"}).waitFor();
    assert.deepEqual(await kept(page), {key: "", password, repository: "sample/private-data"});
    // The new key is pasted and the sync carries on: no password, no repository name.
    await pasteKey(page, renewed);
    await title(page, "Review and finish sync");
    assert.deepEqual(await kept(page), {key: renewed, password, repository: "sample/private-data"});
    await page.locator("#dialog-close").click();
    // Change key asks for another key and keeps the saved one until GitHub accepts the new one,
    // because GitHub shows a key only once.
    await openSync(page);
    await page.locator("#github-change").click();
    await page.locator("#github-token").waitFor();
    await page.locator("#github-token-help").filter({hasText: "Paste the new key. It takes the place of the one saved on this device."}).waitFor();
    assert.equal((await kept(page)).key, renewed);
    await page.locator("#github-token").fill("github_pat_not_a_real_one");
    await submit(page, "Sync now");
    await errorSays(page, /GitHub did not accept the access key/);
    assert.equal((await kept(page)).key, renewed, "a refused replacement leaves the saved key alone");
    await page.locator("#dialog-close").click();
    await openSync(page);
    assert.equal(await page.locator("#github-token").count(), 0, "closing without a new key changes nothing");
    // Forgetting the key is its own, deliberate step.
    await page.locator("#github-change").click();
    await page.locator("#github-forget").click();
    await page.locator("#github-token-help").filter({hasText: "Paste the key from GitHub."}).waitFor();
    assert.equal(await page.locator("#github-forget").count(), 0);
    assert.deepEqual(await kept(page), {key: "", password, repository: "sample/private-data"});
    await page.context().close();
  });

  await t.test("a device that synced before keys were remembered pastes its key and types its password once", async () => {
    const {world, page} = await fresh();
    const typed = "synthetic-vault-password";
    world.secrets.push(typed);
    // Another device made the online backup with a password its owner chose.
    const other = await syncDevice(browser, url, world, {records: true});
    await enterKey(other);
    await title(other, "Create your online backup");
    await other.locator("#github-pass").fill("short");
    await submit(other, "Upload first backup");
    await errorSays(other, "Use at least 12 characters for the backup password.");
    assert.equal(world.puts, 0);
    await other.locator("#github-pass").fill(typed);
    await submit(other, "Upload first backup");
    await other.locator("dialog").waitFor({state:"hidden"});
    assert.equal((await kept(other)).password, typed);
    await other.context().close();
    // This device only remembers the repository, as the earlier version left it.
    await page.evaluate(name => localStorage.setItem(name, "sample/private-data"), KEPT.repository);
    await openSync(page);
    await page.locator(".bk-repo").filter({hasText: "Syncing with sample/private-data"}).waitFor();
    assert.equal(await page.locator("#github-change").count(), 0);
    await pasteKey(page, token);
    await title(page, "Open your online backup");
    await page.locator("#github-pass").fill(typed);
    await submit(page, "Open backup");
    await title(page, "Review and finish sync");
    assert.deepEqual(await kept(page), {key: token, password: typed, repository: "sample/private-data"});
    // A saved password that no longer opens the online backup is asked for again, in plain words.
    await page.locator("#dialog-close").click();
    await page.evaluate(name => localStorage.setItem(name, "a-password-from-before"), KEPT.password);
    await openSync(page);
    await submit(page, "Sync now");
    await title(page, "Open your online backup");
    await page.locator("#vault-result.ui-note--warn").filter({hasText: "The backup password saved on this device did not open the online backup. Type the right one."}).waitFor();
    await page.context().close();
  });

  await t.test("the same single paste sets up sync when the app is opened from a file on the computer", async () => {
    const world = newWorld();
    const page = await syncDevice(browser, pathToFileURL(path.join(__dirname, "index.html")).href, world, {records: true});
    assert.equal(await page.evaluate(() => location.protocol), "file:");
    await openSync(page);
    await pasteKey(page, token);
    await title(page, "Create your online backup");
    const password = await page.locator("#github-pass").inputValue();
    world.secrets.push(password);
    await submit(page, "Upload first backup");
    await page.locator("dialog").waitFor({state:"hidden"});
    assert.equal(world.puts, 1);
    // Closing the app and opening the file again: everything is still remembered, and one press syncs.
    await page.reload();
    await page.locator("#rail-backup strong").waitFor();
    assert.deepEqual(await kept(page), {key: token, password, repository: "sample/private-data"});
    await page.evaluate(() => PM.action("sync-now"));
    await title(page, "Review and finish sync");
    await page.context().close();
  });
});

test("back up to a file, then restore or combine on another device from every entry point", async t => {
  const {browser, url} = await launch(t);
  const password = "synthetic-file-password";
  const errors = [];
  async function device() {
    // San Diego time: a backup made in the evening must not be dated tomorrow.
    const context = await browser.newContext({serviceWorkers: "block", timezoneId: "America/Los_Angeles", locale: "en-US"});
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => globalThis.PM && PM.prop());
    return page;
  }
  const open = (page, action) => page.evaluate(action => PM.action(action), action);
  const chooseBackup = async (page, buffer, pass = password) => {
    await page.locator("#vault-file").setInputFiles({name: "backup.pmvault", mimeType: "application/octet-stream", buffer});
    await page.locator("#vault-pass").fill(pass);
    await submit(page, "Check backup");
  };

  const source = await device();
  await source.evaluate(async () => {
    const hash = await Store.storeBlob("owner", new Blob(["original bytes"]));
    await Store.save("owner", [
      {type:"property", id:"office", name:"Personal property test"},
      {type:"document", id:"doc", name:"Receipt", propertyId:"office", hash},
    ]);
  });
  // The sample is showing. Backup still means the owner's own records, and says which.
  await open(source, "storage");
  await title(source, "Backup & sync");
  assert.equal(await source.locator(".bk-status strong").innerText(), "Not backed up yet");
  await source.locator("#vault-make").click();
  await title(source, "Back up now");
  await nothingKept(source);
  await source.locator(".bk-small").filter({hasText: "Personal property test"}).waitFor();
  // The password is typed once and can be read back. Hide turns it into dots.
  assert.equal(await source.locator("#vault-pass").getAttribute("type"), "text");
  assert.equal(await source.locator("#vault-repeat").count(), 0);
  await source.getByRole("button", {name: "Hide backup password"}).click();
  assert.equal(await source.locator("#vault-pass").getAttribute("type"), "password");
  await source.locator("#vault-pass").fill(password);
  await submit(source, "Create backup file");
  await title(source, "Save your backup file");
  // One button confirms, and only after a save was started.
  assert.equal(await source.locator("#vault-checked").count(), 0);
  assert.ok(await source.locator("#vault-confirm").isDisabled());
  // Until a save has started there is no file anywhere, so nothing offers to mark one as saved.
  assert.deepEqual(await source.evaluate(async () => { const s = (await Store.status("owner")).summary; return [s.state, Boolean(s.fileMade), s.action === "storage"]; }), ["unfinished", false, false]);
  const [download] = await Promise.all([source.waitForEvent("download"), source.locator("#vault-download").click()]);
  const made = await source.evaluate(async () => {
    const s = await Store.status("owner"), d = new Date(s.lastCreated), two = n => String(n).padStart(2, "0");
    const day = d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
    return {name: "Property-Manager-backup-" + day + "-" + two(d.getHours()) + two(d.getMinutes()) + ".pmvault",
      localDay: s.lastCreated.slice(0, 10) === day, confirmed: s.lastBackup, state: s.summary.state, next: s.summary.action};
  });
  assert.equal(download.suggestedFilename(), made.name);
  assert.ok(made.localDay);
  // A download alone is not a backup.
  assert.equal(made.confirmed, null);
  assert.equal(made.state, "unfinished");
  // The reminder leads to Backup & sync, where a file that was saved can be marked as saved.
  assert.equal(made.next, "storage");
  assert.equal(await source.locator("#vault-confirm").innerText(), "Done, I saved it");
  await source.locator("#vault-confirm").click();
  await source.locator("dialog").waitFor({state:"hidden"});
  assert.deepEqual(await source.evaluate(async () => { const s = await Store.status("owner"); return [s.backupEvidence, s.summary.state, s.summary.headline]; }),
    ["Owner confirmed file saved", "current", "Backed up"]);
  const file = fs.readFileSync(await download.path());
  assert.equal(file.subarray(0, 8).toString(), "PMVAULT2");
  for (const text of [password, "Personal property test", "original bytes"]) assert.ok(!file.includes(Buffer.from(text)));

  // A new device opens on the sample. Every way in must load the owner's backup.
  for (const entry of ["storage", "restore", "merge", "owner-restore"]) {
    const fresh = await device();
    await open(fresh, entry);
    if (entry === "storage") { await title(fresh, "Backup & sync"); await fresh.locator("#vault-restore").click(); }
    await title(fresh, "Restore from a backup file");
    await nothingKept(fresh);
    await chooseBackup(fresh, file);
    await title(fresh, "Restore this backup?");
    await fresh.locator(".bk-lead").filter({hasText: "Personal property test"}).first().waitFor();
    await submit(fresh, "Restore to this device");
    await fresh.locator("dialog").waitFor({state:"hidden"});
    await fresh.waitForFunction(() => PM.dataset() === "owner" && PM.prop()?.name === "Personal property test");
    assert.equal(await fresh.evaluate(async () => (await Store.getBlob("owner", (await Store.list("owner")).find(r => r.id === "doc").hash)).text()), "original bytes", entry);
    assert.equal(await fresh.locator("#toast").innerText(), "Restored. 2 entries loaded.", entry);
    await fresh.context().close();
  }

  // A file that holds the other set of records is explained, and one button carries on with it.
  const mixed = await device();
  const sampleFile = Buffer.from(await mixed.evaluate(async pass => Array.from(new Uint8Array(await (await Store.makeBackup("sample", pass)).blob.arrayBuffer())), password));
  await open(mixed, "restore");
  await title(mixed, "Restore from a backup file");
  await chooseBackup(mixed, sampleFile);
  await mixed.locator("#vault-result.ui-note--error").filter({hasText: "This backup holds the sample property, not your own records."}).waitFor();
  assert.equal((await mixed.evaluate(() => Store.list("owner"))).length, 0);
  assert.equal(await mixed.locator("#vault-switch").innerText(), "Use it for the sample property");
  await mixed.locator("#vault-switch").click();
  await title(mixed, "How should this backup be used?");
  await mixed.locator("#dialog-close").click();
  await mixed.context().close();

  // Two devices change the same thing. Combining asks which copy to keep, in words.
  const other = await device();
  await open(other, "restore");
  await chooseBackup(other, file);
  await submit(other, "Restore to this device");
  await other.locator("dialog").waitFor({state:"hidden"});
  const rename = (page, name, extra = []) => page.evaluate(async ([name, extra]) => {
    const property = (await Store.list("owner")).find(r => r.type === "property");
    await Store.save("owner", [{...property, name}, ...extra]);
  }, [name, extra]);
  await rename(source, "Edited on the computer", [{type:"task", id:"from-computer", title:"Only on the computer", propertyId:"office"}]);
  await rename(other, "Edited on the phone");
  const second = Buffer.from(await source.evaluate(async pass => Array.from(new Uint8Array(await (await Store.makeBackup("owner", pass)).blob.arrayBuffer())), password));
  await open(other, "storage");
  await other.locator("#vault-restore").click();
  await chooseBackup(other, second);
  await title(other, "How should this backup be used?");
  await nothingKept(other);
  assert.equal(await other.locator('[data-use="merge"]').getAttribute("aria-pressed"), "true");
  assert.equal(await other.locator("dialog[open] select").count(), 0);
  const conflict = other.locator('[data-conflict="0"]');
  assert.equal(await conflict.locator("h3").innerText(), "Property details: Edited on the phone");
  assert.match(await conflict.locator(".bk-diff").innerText(), /Name\s+This device\s+“Edited on the phone”\s+Other device\s+“Edited on the computer”/);
  await submit(other, "Combine now");
  await other.locator("#vault-result.ui-note--error").filter({hasText: "Choose which copy to keep"}).waitFor();
  assert.equal(await other.evaluate(async () => (await Store.list("owner")).find(r => r.type === "property").name), "Edited on the phone");
  // Replacing everything needs its own explicit yes.
  await other.locator('[data-use="restore"]').click();
  await submit(other, "Replace with this backup");
  await other.locator("#vault-result.ui-note--error").filter({hasText: "To replace everything"}).waitFor();
  assert.ok(!(await other.evaluate(() => Store.list("owner"))).some(r => r.id === "from-computer"));
  await other.locator('[data-use="merge"]').click();
  await conflict.locator('[data-keep="incoming"]').click();
  await submit(other, "Combine now");
  await other.locator("dialog").waitFor({state:"hidden"});
  assert.deepEqual(await other.evaluate(async () => {
    const records = await Store.list("owner");
    return [records.find(r => r.type === "property").name, records.some(r => r.id === "from-computer")];
  }), ["Edited on the computer", true]);
  assert.equal(await other.locator("#toast").innerText(), "Combined. 2 changes added.");
  assert.deepEqual(errors, []);
});
