#!/usr/bin/env node
import readline from "node:readline";

const CIRCLECI_URL = "https://mcp.circleci.com/v1/mcp";
const TOKEN = process.env.CIRCLECI_TOKEN;
if (!TOKEN) {
  console.error("CIRCLECI_TOKEN environment variable is not set");
}

function sanitizeSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;

  const res = Array.isArray(schema) ? [] : {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "type" && Array.isArray(v)) {
      const nonNull = v.filter((t) => t !== "null");
      res[k] = nonNull.length >= 1 ? nonNull[0] : "string";
      continue;
    }
    if (typeof v === "object" && v !== null) {
      res[k] = sanitizeSchema(v);
    } else {
      res[k] = v;
    }
  }

  if (res.type === "object" && !res.properties) {
    res.properties = {};
  }

  return res;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let queue = Promise.resolve();

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  queue = queue.then(async () => {
    try {
      const msg = JSON.parse(trimmed);

      // Notifications do not have an id and don't expect a response
      if (msg.id === undefined) {
        await fetch(CIRCLECI_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify(msg),
        }).catch(() => {});
        return;
      }

      const res = await fetch(CIRCLECI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(msg),
      });

      const text = await res.text();
      const dataLine = text.split("\n").find((l) => l.startsWith("data: "));

      if (dataLine) {
        const json = JSON.parse(dataLine.replace(/^data:\s*/, ""));
        if (msg.method === "tools/list" && json.result?.tools) {
          for (const tool of json.result.tools) {
            tool.inputSchema = sanitizeSchema(tool.inputSchema);
          }
        }
        process.stdout.write(JSON.stringify(json) + "\n");
      } else {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32603, message: `Upstream error: ${text}` },
          }) + "\n"
        );
      }
    } catch (err) {
      console.error("CircleCI proxy error:", err);
    }
  });
});
