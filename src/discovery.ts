/**
 * Auto-discovery — spawn an MCP server via stdio, run `initialize`,
 * then call `tools/list` and `resources/list` to extract capabilities.
 */

import { spawn } from "node:child_process";
import type { ServerCapabilities, ToolCapability, ResourceCapability } from "./types.js";

const DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * Send a JSON-RPC request and wait for a response with the matching id.
 * Resolves with the parsed response object.
 */
function sendRpcRequest(
  stdin: NodeJS.WritableStream,
  stdout: NodeJS.ReadableStream,
  method: string,
  params: Record<string, unknown>,
  id: number,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`RPC call "${method}" timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString();

      // Try to parse each line as JSON (newline-delimited JSON-RPC).
      const lines = buffer.split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            settled = true;
            clearTimeout(timer);
            stdout.removeListener("data", onData);
            resolve(msg);
            return;
          }
        } catch {
          // Not valid JSON yet.
        }
      }
      // Keep the last (potentially incomplete) line.
      buffer = lines[lines.length - 1];
    };

    stdout.on("data", onData);

    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    stdin.write(request + "\n");
  });
}

/**
 * Discover capabilities of an MCP server by spawning it and querying
 * via JSON-RPC over stdio.
 *
 * Steps:
 * 1. Send `initialize` request.
 * 2. Send `notifications/initialized` notification.
 * 3. Call `tools/list` to enumerate tools.
 * 4. Call `resources/list` to enumerate resources.
 * 5. Kill the process and return the gathered capabilities.
 */
export async function discoverCapabilities(
  command: string,
  args: string[],
  env: Record<string, string> = {},
  timeoutMs: number = DISCOVERY_TIMEOUT_MS,
): Promise<ServerCapabilities> {
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

  const capabilities: ServerCapabilities = { tools: [], resources: [] };

  try {
    // 1. Initialize
    const initResp = await sendRpcRequest(
      child.stdin,
      child.stdout,
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-registry-discovery", version: "1.0.0" },
      },
      1,
      timeoutMs,
    );

    // 2. Send initialized notification (no id — it's a notification).
    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    child.stdin.write(notification + "\n");

    // 3. tools/list
    try {
      const toolsResp = await sendRpcRequest(
        child.stdin,
        child.stdout,
        "tools/list",
        {},
        2,
        timeoutMs,
      );
      const result = (toolsResp as any).result;
      if (result && Array.isArray(result.tools)) {
        capabilities.tools = result.tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      }
    } catch {
      // Server may not support tools/list — that's fine.
    }

    // 4. resources/list
    try {
      const resourcesResp = await sendRpcRequest(
        child.stdin,
        child.stdout,
        "resources/list",
        {},
        3,
        timeoutMs,
      );
      const result = (resourcesResp as any).result;
      if (result && Array.isArray(result.resources)) {
        capabilities.resources = result.resources.map((r: any) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }));
      }
    } catch {
      // Server may not support resources/list — that's fine.
    }
  } finally {
    child.kill("SIGTERM");
  }

  return capabilities;
}
