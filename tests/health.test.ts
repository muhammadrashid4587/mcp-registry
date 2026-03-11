import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Storage } from "../src/storage.js";
import { ServerRegistry } from "../src/registry.js";
import { HealthMonitor } from "../src/health.js";

describe("HealthMonitor", () => {
  let tmpDir: string;
  let storage: Storage;
  let registry: ServerRegistry;
  let monitor: HealthMonitor;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-registry-test-"));
    storage = new Storage(path.join(tmpDir, "registry.json"));
    registry = new ServerRegistry(storage);
    monitor = new HealthMonitor(registry, 3000);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns unhealthy for unknown server", async () => {
    const result = await monitor.check("nonexistent");
    expect(result.status).toBe("unhealthy");
    expect(result.error).toContain("not found");
  });

  it("marks server unhealthy when command does not exist", async () => {
    registry.register({
      name: "bad-server",
      command: "nonexistent-command-that-will-fail",
      args: [],
    });

    const result = await monitor.check("bad-server");
    expect(result.status).toBe("unhealthy");
    expect(result.error).toBeTruthy();
  });

  it("updates totalChecks and resets uptimeChecks on failure", async () => {
    registry.register({
      name: "flaky",
      command: "nonexistent-command-xyz",
      args: [],
    });

    await monitor.check("flaky");
    const entry = registry.get("flaky");
    expect(entry).toBeDefined();
    expect(entry!.totalChecks).toBe(1);
    expect(entry!.uptimeChecks).toBe(0);
    expect(entry!.health).toBe("unhealthy");
    expect(entry!.lastChecked).toBeTruthy();
  });

  it("checkAll() checks all registered servers", async () => {
    registry.register({ name: "s1", command: "no-such-cmd-1" });
    registry.register({ name: "s2", command: "no-such-cmd-2" });

    const results = await monitor.checkAll();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "unhealthy")).toBe(true);
  });

  it("checkAll() returns empty array when no servers registered", async () => {
    const results = await monitor.checkAll();
    expect(results).toEqual([]);
  });

  it("uptimePercent() returns 0 for server with no checks", () => {
    registry.register({ name: "fresh", command: "echo" });
    expect(monitor.uptimePercent("fresh")).toBe(0);
  });

  it("uptimePercent() returns 0 for unknown server", () => {
    expect(monitor.uptimePercent("unknown")).toBe(0);
  });

  it("uptimePercent() calculates correctly after failed checks", async () => {
    registry.register({ name: "calc", command: "no-cmd" });
    await monitor.check("calc");
    await monitor.check("calc");
    // Both checks fail, so uptime = 0/2 = 0%
    expect(monitor.uptimePercent("calc")).toBe(0);
  });

  it("marks server healthy when it responds to initialize", async () => {
    // Create a tiny script that acts as a minimal MCP server.
    const scriptPath = path.join(tmpDir, "mock-server.js");
    fs.writeFileSync(
      scriptPath,
      `
      process.stdin.setEncoding('utf-8');
      let buf = '';
      process.stdin.on('data', (chunk) => {
        buf += chunk;
        try {
          const req = JSON.parse(buf);
          const resp = {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {}, resources: {} },
              serverInfo: { name: 'mock', version: '1.0' }
            }
          };
          process.stdout.write(JSON.stringify(resp));
          process.exit(0);
        } catch {}
      });
      `,
    );

    registry.register({ name: "mock", command: "node", args: [scriptPath] });
    const result = await monitor.check("mock");
    expect(result.status).toBe("healthy");
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);

    const entry = registry.get("mock");
    expect(entry!.health).toBe("healthy");
    expect(entry!.uptimeChecks).toBe(1);
    expect(entry!.totalChecks).toBe(1);
  });
});
