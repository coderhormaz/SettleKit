import { createServer } from "node:http";

const server = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: "NOT_FOUND" }));
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ service: "settlekit-phase1-diagnostic", status: "ready" }));
});
server.listen(3011, "127.0.0.1", () => process.stdout.write("Diagnostic merchant API listening on http://127.0.0.1:3011/health\n"));
function stop() { server.close(); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
