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

test("server-renders the HistoryRiver shell with the viewing experience layer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>落九川｜年度人物轨迹<\/title>/i);
  assert.match(html, /<main class="history-shell">/);
  assert.match(html, /class="history-stage"/);
  assert.match(html, /class="history-vignette"/);
  assert.match(html, /class="history-experience"/);
  assert.match(html, /class="history-prologue/);
  assert.match(html, /aria-label="纪年轴"/);
  assert.match(html, /春秋战国/);
  assert.match(html, /history-directory-toggle/);
  assert.doesNotMatch(html, /原型 · 模拟数据|二十年窗口|观河|自动播放|人物详情/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("keeps product interaction debug-only while enabling editor-camera navigation", async () => {
  const [page, layout, packageJson, runtime, personThreads, cameraControls] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../src/app/history-river.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/history-person-threads.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../src/lib/viewport/river-camera-controls.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /export const metadata:\s*Metadata/);
  assert.match(page, /<HistoryRiver \/>/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(packageJson, /"name": "luo-jiu-chuan-prototype"/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview/);
  assert.doesNotMatch(layout, /Starter Project|next\/font\/google/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  for (const forbidden of [
    "ExperienceState",
    "guideStateAtSeconds",
    "prototypeFixture",
    "OrbitControls",
    "Raycaster",
    "selectedRelation",
    "eventCloud",
    "relationLines",
  ]) {
    assert.doesNotMatch(runtime, new RegExp(forbidden), forbidden);
  }
  assert.match(runtime, /renderData/);
  assert.match(runtime, /RiverCameraControls/);
  assert.match(runtime, /createPersonThreadRig/);
  assert.match(runtime, /HistoryExperience/);
  assert.match(runtime, /pickPerson/);
  assert.match(runtime, /URLSearchParams\(window\.location\.search\)\.has\("debug"\)/);
  assert.match(runtime, /HistoryDebugMenu/);
  assert.match(runtime, /sceneComponentsRef/);
  assert.match(personThreads, /buildRenderPersonThreadGeometry/);
  assert.match(personThreads, /Line2/);
  assert.match(personThreads, /summarizePersonEvidence/);
  assert.match(cameraControls, /resolveRiverDragMode/);
  assert.match(cameraControls, /dblclick/);
  for (const forbidden of [
    "Raycaster",
    "selectedPerson",
    "selectedRelation",
    "autoPlay",
    "URLSearchParams",
    "requestPointerLock",
    "pointerLockElement",
    "keydown",
  ]) {
    assert.doesNotMatch(cameraControls, new RegExp(forbidden), forbidden);
  }

  await assert.rejects(access(previewRoot));
  await access(new URL("src/app/history-river.tsx", templateRoot));
});
