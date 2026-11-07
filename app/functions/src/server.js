import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { app, verifyFirebaseIdToken } from "./index.js";

export function createClusterServer() {
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url, "http://localhost").pathname !== "/cluster/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client));
});

wss.on("connection", (client) => {
  let upstream;
  const authTimer = setTimeout(() => client.close(1008, "Authentication required"), 5000);
  client.once("message", async (raw) => {
    clearTimeout(authTimer);
    try {
      const { token } = JSON.parse(raw.toString());
      const user = await verifyFirebaseIdToken(token);
      if (user.clusterViewer !== true) {
        client.close(1008, "Cluster viewer access required");
        return;
      }
      if (client.readyState !== WebSocket.OPEN) return;
      const sharedToken = process.env.CLUSTER_OBSERVER_TOKEN;
      if (!sharedToken) {
        client.close(1011, "Cluster stream unavailable");
        return;
      }
      upstream = new WebSocket(
        process.env.CLUSTER_OBSERVER_URL || "ws://cluster-observer.qdoc.svc.cluster.local:8080/ws",
        { headers: { Authorization: `Bearer ${sharedToken}` } }
      );
      upstream.on("message", (data) => {
        if (client.readyState === WebSocket.OPEN) client.send(data.toString(), { binary: false });
      });
      upstream.on("close", () => client.close(1011, "Cluster stream ended"));
      upstream.on("error", () => client.close(1011, "Cluster stream unavailable"));
    } catch {
      client.close(1008, "Invalid authentication token");
    }
  });
  client.on("close", () => {
    clearTimeout(authTimer);
    upstream?.close();
  });
});

return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  createClusterServer().listen(port, "0.0.0.0", () => {
    console.log(`QDoc backend listening on ${port}`);
  });
}
