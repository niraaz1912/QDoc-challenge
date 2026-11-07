import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { app } from "../src/index.js";
import { WebSocket } from "ws";
import { createClusterServer } from "../src/server.js";

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("health endpoint responds", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("chat requires Firebase authentication", async () => {
  const response = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "When is my next dose?" }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required" });
});

test("Prometheus metrics include request counts", async () => {
  const response = await fetch(`${baseUrl}/metrics`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /qdoc_http_requests_total\{method="GET",route="\/health",status="200"\} 1/);
});

test("cluster WebSocket rejects an invalid Firebase token", async () => {
  const clusterServer = createClusterServer();
  clusterServer.listen(0, "127.0.0.1");
  await new Promise((resolve) => clusterServer.once("listening", resolve));
  try {
    const status = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${clusterServer.address().port}/cluster/ws`);
      socket.on("open", () => socket.send(JSON.stringify({ token: "invalid" })));
      socket.on("close", resolve);
      socket.on("error", reject);
    });
    assert.equal(status, 1008);
  } finally {
    await new Promise((resolve) => clusterServer.close(resolve));
  }
});
