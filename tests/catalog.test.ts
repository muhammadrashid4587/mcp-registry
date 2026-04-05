import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Storage } from "../src/storage.js";
import { ServerRegistry } from "../src/registry.js";
import { Catalog } from "../src/catalog.js";

describe("Catalog", () => {
  let tmpDir: string;
  let storage: Storage;
  let registry: ServerRegistry;
  let catalog: Catalog;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-registry-test-"));
    storage = new Storage(path.join(tmpDir, "registry.json"));
    registry = new ServerRegistry(storage);
    catalog = new Catalog(registry);

    // Seed some servers with capabilities.
    registry.register({
      name: "filesystem",
      command: "npx",
      args: ["@modelcontextprotocol/server-filesystem", "/tmp"],
      capabilities: {
        tools: [
          { name: "read_file", description: "Read file contents" },
          { name: "write_file", description: "Write to a file" },
          { name: "list_directory", description: "List directory contents" },
        ],
        resources: [
          { uri: "file:///tmp", name: "tmp", description: "Temp directory" },
        ],
      },
    });
    registry.updateServer("filesystem", { health: "healthy" });

    registry.register({
      name: "github",
      command: "npx",
      args: ["@modelcontextprotocol/server-github"],
      capabilities: {
        tools: [
          { name: "create_issue", description: "Create a GitHub issue" },
          { name: "read_file", description: "Read a file from a repo" },
        ],
        resources: [
          { uri: "github://repos", name: "repos", description: "GitHub repos" },
        ],
      },
    });
    registry.updateServer("github", { health: "healthy" });

    registry.register({
      name: "broken-server",
      command: "broken",
      capabilities: { tools: [], resources: [] },
    });
    registry.updateServer("broken-server", { health: "unhealthy" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("search()", () => {
    it("finds servers by tool name", () => {
      const results = catalog.search({ tool: "read_file" });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.server.name).sort()).toEqual([
        "filesystem",
        "github",
      ]);
    });

    it("finds servers by partial tool name (case insensitive)", () => {
      const results = catalog.search({ tool: "READ" });
      expect(results).toHaveLength(2);
    });

    it("finds servers by tool description", () => {
      const results = catalog.search({ tool: "github issue" });
      expect(results).toHaveLength(1);
      expect(results[0].server.name).toBe("github");
    });

    it("finds servers by resource URI", () => {
      const results = catalog.search({ resource: "file:///" });
      expect(results).toHaveLength(1);
      expect(results[0].server.name).toBe("filesystem");
    });

    it("finds servers by resource name", () => {
      const results = catalog.search({ resource: "repos" });
      expect(results).toHaveLength(1);
      expect(results[0].server.name).toBe("github");
    });

    it("filters by health status", () => {
      const results = catalog.search({ health: "unhealthy" });
      expect(results).toHaveLength(1);
      expect(results[0].server.name).toBe("broken-server");
    });

    it("combines tool and health filters", () => {
      const results = catalog.search({ tool: "read_file", health: "healthy" });
      expect(results).toHaveLength(2);
    });

    it("returns empty for non-matching search", () => {
      const results = catalog.search({ tool: "nonexistent_tool" });
      expect(results).toHaveLength(0);
    });

    it("returns all servers with no specific filters (just health)", () => {
      const results = catalog.search({ health: "healthy" });
      expect(results).toHaveLength(2);
    });

    it("returns all servers with no filters", () => {
      const results = catalog.search({});
      expect(results).toHaveLength(3);
    });

    it("populates matchedTools correctly", () => {
      const results = catalog.search({ tool: "write_file" });
      expect(results).toHaveLength(1);
      expect(results[0].matchedTools).toHaveLength(1);
      expect(results[0].matchedTools[0].name).toBe("write_file");
    });

    it("populates matchedResources correctly", () => {
      const results = catalog.search({ resource: "github" });
      expect(results).toHaveLength(1);
      expect(results[0].matchedResources).toHaveLength(1);
      expect(results[0].matchedResources[0].uri).toBe("github://repos");
    });

    it("combines tool and resource filters (OR logic)", () => {
      const results = catalog.search({ tool: "create_issue", resource: "file:///" });
      // github matches tool, filesystem matches resource
      expect(results).toHaveLength(2);
    });
  });

  describe("findByTool()", () => {
    it("finds servers with an exact tool name match", () => {
      const servers = catalog.findByTool("read_file");
      expect(servers).toHaveLength(2);
    });

    it("returns empty for nonexistent tool", () => {
      const servers = catalog.findByTool("nope");
      expect(servers).toHaveLength(0);
    });
  });

  describe("findByResource()", () => {
    it("finds servers by resource URI pattern", () => {
      const servers = catalog.findByResource("github://");
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe("github");
    });
  });

  describe("allToolNames()", () => {
    it("returns sorted unique tool names", () => {
      const names = catalog.allToolNames();
      expect(names).toEqual([
        "create_issue",
        "list_directory",
        "read_file",
        "write_file",
      ]);
    });
  });

  describe("allResourceUris()", () => {
    it("returns sorted unique resource URIs", () => {
      const uris = catalog.allResourceUris();
      expect(uris).toEqual(["file:///tmp", "github://repos"]);
    });
  });

  describe("summary()", () => {
    it("returns correct summary stats", () => {
      const stats = catalog.summary();
      expect(stats).toEqual({
        totalServers: 3,
        healthy: 2,
        unhealthy: 1,
        degraded: 0,
        unknown: 0,
        totalTools: 4,
        totalResources: 2,
      });
    });

    it("counts degraded servers", () => {
      registry.register({
        name: "slow-server",
        command: "node",
        capabilities: { tools: [], resources: [] },
      });
      registry.updateServer("slow-server", { health: "degraded" });

      const stats = catalog.summary();
      expect(stats.totalServers).toBe(4);
      expect(stats.degraded).toBe(1);
    });
  });
});
