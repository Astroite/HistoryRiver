import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);
const previewRoot = new URL("../src/app/_sites-preview/", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the HistoryRiver prototype shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>落九川｜交互原型<\/title>/i);
  assert.match(html, /<main class="history-shell">/);
  assert.match(html, /class="history-stage"/);
  assert.match(html, /class="history-vignette"/);
  assert.doesNotMatch(html, /原型 · 模拟数据|二十年窗口|观河/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("removes all disposable starter metadata and preview code", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /export const metadata:\s*Metadata/);
  assert.match(page, /<HistoryRiver \/>/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(packageJson, /"name": "luo-jiu-chuan-prototype"/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview/);
  assert.doesNotMatch(layout, /Starter Project|next\/font\/google/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(previewRoot));
  await access(new URL("src/app/history-river.tsx", templateRoot));
});
