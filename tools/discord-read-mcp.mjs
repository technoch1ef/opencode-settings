#!/usr/bin/env node
// Read-only Discord MCP (stdio). One tool: discord_read(link).
// The only network call is api() below, and it hardcodes GET, so this
// server has no way to send, edit, react, or delete.
import readline from "node:readline";

const TOKEN = process.env.DISCORD_USER_TOKEN;
if (!TOKEN) console.error("DISCORD_USER_TOKEN environment variable is not set");

async function api(path) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method: "GET",
      headers: { Authorization: TOKEN },
    });
    if (res.status === 429) {
      const { retry_after = 1 } = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, retry_after * 1000));
      continue;
    }
    const body = await res.json();
    if (!res.ok) throw new Error(`Discord ${res.status}: ${body.message}`);
    return body;
  }
  throw new Error("Discord rate limit, try again later");
}

function fmt(x, mark = "") {
  const who = x.author.global_name || x.author.username;
  const reply = x.message_reference?.message_id ? ` (reply to ${x.message_reference.message_id})` : "";
  const files = x.attachments.map((a) => ` [${a.filename}: ${a.url}]`).join("");
  const embeds = x.embeds.map((e) => ` [embed: ${e.title || ""} ${e.description || e.url || ""}]`).join("");
  return `${mark}${x.timestamp.slice(0, 16)} ${who} #${x.id}${reply}: ${x.content}${files}${embeds}`;
}

async function read({ link, limit = 50, before, offset = 0 }) {
  const m = String(link).match(/channels\/(@me|\d+)\/(\d+)(?:\/(\d+))?/);
  if (!m) throw new Error("Expected a link like https://discord.com/channels/<guild>/<channel>[/<message>]");
  const [, guild, channel, message] = m;
  const info = await api(`/channels/${channel}`);

  // Forum/media channels hold no messages themselves; list their posts.
  if ((info.type === 15 || info.type === 16) && !message) {
    const n = Math.min(Math.max(Number(limit) || 25, 1), 25);
    const r = await api(
      `/channels/${channel}/threads/search?sort_by=last_message_time&sort_order=desc&limit=${n}&offset=${Number(offset) || 0}`,
    );
    const first = Object.fromEntries((r.first_messages || []).map((x) => [x.channel_id, x]));
    const posts = r.threads.map((t) => {
      const url = `https://discord.com/channels/${guild}/${t.id}`;
      const body = first[t.id] ? `\n  ${fmt(first[t.id])}` : "";
      return `- ${t.name} (${t.message_count ?? 0} replies) ${url}${body}`;
    });
    const more = r.has_more ? `; more: offset=${(Number(offset) || 0) + r.threads.length}` : "";
    return [`Forum #${info.name}: ${r.total_results} posts, newest activity first${more}. Open a post link to read it.`, ...posts].join("\n");
  }

  const n = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const q = before ? `before=${before}` : message ? `around=${message}` : "";
  const msgs = await api(`/channels/${channel}/messages?limit=${n}${q && "&" + q}`);
  const lines = msgs.reverse().map((x) => fmt(x, x.id === message ? ">>> " : ""));
  const head = `#${info.name || channel} (${msgs.length} msgs, oldest first; pass before=<oldest id> for earlier)`;
  return [head, ...lines].join("\n");
}

const tool = {
  name: "discord_read",
  description:
    "Read a Discord link (read-only). Channel/thread link: latest messages. Message link: messages around it (marked >>>). Forum link: list of posts with their links.",
  inputSchema: {
    type: "object",
    properties: {
      link: { type: "string", description: "https://discord.com/channels/<guild>/<channel>[/<message>]" },
      limit: { type: "number", description: "Messages 1-100 (default 50); forum posts 1-25" },
      offset: { type: "number", description: "Forum only: skip this many posts (pagination)" },
      before: { type: "string", description: "Message id; fetch messages older than it (pagination)" },
    },
    required: ["link"],
  },
};

function handle(msg) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "discord-read", version: "1.0.0" },
      };
    case "tools/list":
      return { tools: [tool] };
    case "tools/call":
      if (msg.params?.name !== tool.name) throw new Error(`Unknown tool ${msg.params?.name}`);
      return read(msg.params.arguments || {}).then(
        (text) => ({ content: [{ type: "text", text }] }),
        (e) => ({ content: [{ type: "text", text: e.message }], isError: true }),
      );
    case "ping":
      return {};
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

readline.createInterface({ input: process.stdin, terminal: false }).on("line", async (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return; // notification
  const out = { jsonrpc: "2.0", id: msg.id };
  try {
    out.result = await handle(msg);
  } catch (e) {
    out.error = { code: e.code || -32603, message: e.message };
  }
  process.stdout.write(JSON.stringify(out) + "\n");
});
