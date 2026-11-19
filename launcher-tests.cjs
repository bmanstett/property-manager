"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { spawn } = require("node:child_process"),
  path = require("node:path"),
  fs = require("node:fs");
const { assets } = require("./build-static.cjs");
test(
  "native Windows launcher serves the exact installable app on its assigned loopback port",
  { skip: process.platform !== "win32" },
  async (t) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "RemoteSigned",
        "-File",
        path.join(__dirname, "Start-PropertyManager.ps1"),
        "-NoBrowser",
        "-Port",
        "0",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => child.kill());
    const url = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Local launcher did not report its port")), 15000);
      child.stdout.on("data", chunk => {
        output += chunk.toString();
        const match = /Property Manager is available at (http:\/\/127\.0\.0\.1:[1-9]\d*\/)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once("error", reject);
      child.once("exit", code => {
        clearTimeout(timer);
        reject(Error("Local launcher exited " + code));
      });
    });
    for (const file of [...assets, "sw.js"]) {
      const res = await fetch(url + file, {
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(res.status, 200, file);
      assert.deepEqual(
        Buffer.from(await res.arrayBuffer()),
        fs.readFileSync(path.join(__dirname, "dist", file)),
        file,
      );
    }
    assert.equal(
      (await fetch(url + "private/source-inventory.json")).status,
      404,
    );
    assert.equal(
      (await fetch(url + "index.html", { method: "POST" })).status,
      404,
    );
    assert.match(
      (await fetch(url + "manifest.webmanifest")).headers.get("content-type"),
      /application\/manifest\+json/,
    );
  },
);
