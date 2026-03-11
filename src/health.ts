/**
 * HealthMonitor — spawns MCP servers briefly to check if they respond
 * to the JSON-RPC `initialize` request, tracking uptime and health.
 */

import { spawn } from "node:child_process";
import { ServerRegistry } from "./registry.js";
import type {
  HealthCheckResult,
  HealthStatus,
  ServerCapabilities,
  ServerEntry,
  ToolCapability,
  ResourceCapability,
} from "./types.js";

/** Timeout in milliseconds for a single health check. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Send a JSON-RPC request over stdin and collect stdout until we get
 * a complete JSON-RPC response or the timeout fires.
 */
async function probeServer(
  entry: ServerEntry,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{
  capabilities: ServerCapabilities;
  responseTimeMs: number;
}> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const child = spawn(entry.command, entry.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...entry.env },
    });

    let stdout = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      reject(new Error(`Health check timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();

      // Try to parse a complete JSON-RPC response from the accumulated output.
      try {
        const response = JSON.parse(stdout);
        clearTimeout(timer);
        child.kill("SIGTERM");

        const elapsed = Date.now() - start;
        const result = response.result ?? {};
        const caps: ServerCapabilities = {
          tools: [],
          resources: [],
        };

        // The initialize response carries `capabilities` which lists
        // supported feature groups. We note them but won't have the
        // actual tool/resource lists until we call tools/list etc.
        if (result.capabilities) {
          caps.tools = result.capabilities.tools ?? [];
          caps.resources = result.capabilities.resources ?? [];
        }

        resolve({ capabilities: caps, responseTimeMs: elapsed });
      } catch {
        // Incomplete JSON — keep accumulating.
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (!timedOut) {
        reject(new Error(`Failed to spawn server: ${err.message}`));
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (!timedOut) {
        // If we didn't resolve already, treat a normal exit without
        // response as an error.
        if (stdout.length === 0) {
          reject(
            new Error(
              `Server exited with code ${code} without producing output`,
            ),
          );
        }
      }
    });

    // Send the MCP initialize JSON-RPC request.
    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-registry-health", version: "1.0.0" },
      },
    });

    child.stdin.write(initRequest + "\n");
    child.stdin.end();
  });
}

export class HealthMonitor {
  private registry: ServerRegistry;
  private timeoutMs: number;

  constructor(registry: ServerRegistry, timeoutMs?: number) {
    this.registry = registry;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Run a health check against a single registered server. */
  async check(name: string): Promise<HealthCheckResult> {
    const entry = this.registry.get(name);
    if (!entry) {
      return {
        name,
        status: "unhealthy",
        responseTimeMs: 0,
        error: `Server "${name}" not found in registry.`,
      };
    }

    try {
      const { capabilities, responseTimeMs } = await probeServer(
        entry,
        this.timeoutMs,
      );
      const status: HealthStatus = "healthy";

      this.registry.updateServer(name, {
        health: status,
        lastChecked: new Date().toISOString(),
        capabilities:
          capabilities.tools.length > 0 || capabilities.resources.length > 0
            ? capabilities
            : entry.capabilities,
        uptimeChecks: entry.uptimeChecks + 1,
        totalChecks: entry.totalChecks + 1,
      });

      return { name, status, responseTimeMs, capabilities };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status: HealthStatus = "unhealthy";

      this.registry.updateServer(name, {
        health: status,
        lastChecked: new Date().toISOString(),
        uptimeChecks: 0,
        totalChecks: entry.totalChecks + 1,
      });

      return { name, status, responseTimeMs: 0, error: message };
    }
  }

  /** Run health checks against all registered servers. */
  async checkAll(): Promise<HealthCheckResult[]> {
    const servers = this.registry.list();
    const results: HealthCheckResult[] = [];

    for (const server of servers) {
      const result = await this.check(server.name);
      results.push(result);
    }

    return results;
  }

  /** Calculate uptime percentage for a server. */
  uptimePercent(name: string): number {
    const entry = this.registry.get(name);
    if (!entry || entry.totalChecks === 0) {
      return 0;
    }
    return (entry.uptimeChecks / entry.totalChecks) * 100;
  }
}
