import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Storage } from "../src/storage.js";
import { ServerRegistry } from "../src/registry.js";

describe("ServerRegistry", () => {
  let tmpDir: string;
  let storage: Storage;
  let registry: ServerRegistry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-registry-test-"));
    storage = new Storage(path.join(tmpDir, "registry.json"));
    registry = new ServerRegistry(storage);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers a new server", () => {
    const entry = registry.register({
      name: "test-server",
      command: "node",
      args: ["server.js"],
    });

    expect(entry.name).toBe("test-server");
    expect(entry.command).toBe("node");
    expect(entry.args).toEqual(["server.js"]);
    expect(entry.health).toBe("unknown");
    expect(entry.capabilities.tools).toEqual([]);
    expect(entry.capabilities.resources).toEqual([]);
    expect(entry.registeredAt).toBeTruthy();
  });

  it("throws when registering a duplicate name", () => {
    registry.register({ name: "dup", command: "echo" });
    expect(() => registry.register({ name: "dup", command: "echo" })).toThrow(
      'Server "dup" is already registered.',
    );
  });

  it("lists all servers", () => {
    registry.register({ name: "a", command: "echo" });
    registry.register({ name: "b", command: "echo" });

    const servers = registry.list();
    expect(servers).toHaveLength(2);
    expect(servers.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("gets a server by name", () => {
    registry.register({ name: "finder", command: "node" });
    const found = registry.get("finder");
    expect(found).toBeDefined();
    expect(found!.name).toBe("finder");
  });

  it("returns undefined for unknown server", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("removes a server", () => {
    registry.register({ name: "removable", command: "echo" });
    expect(registry.remove("removable")).toBe(true);
    expect(registry.get("removable")).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it("returns false when removing a nonexistent server", () => {
    expect(registry.remove("nope")).toBe(false);
  });

  it("updates a server entry", () => {
    registry.register({ name: "updatable", command: "echo" });
    const updated = registry.updateServer("updatable", {
      health: "healthy",
      lastChecked: "2025-01-01T00:00:00Z",
    });

    expect(updated.health).toBe("healthy");
    expect(updated.lastChecked).toBe("2025-01-01T00:00:00Z");
  });

  it("throws when updating a nonexistent server", () => {
    expect(() =>
      registry.updateServer("ghost", { health: "healthy" }),
    ).toThrow('Server "ghost" not found.');
  });

  it("counts servers", () => {
    expect(registry.count()).toBe(0);
    registry.register({ name: "x", command: "echo" });
    registry.register({ name: "y", command: "echo" });
    expect(registry.count()).toBe(2);
  });

  it("registers with capabilities", () => {
    const entry = registry.register({
      name: "capable",
      command: "node",
      capabilities: {
        tools: [{ name: "read_file", description: "Read a file" }],
        resources: [{ uri: "file:///tmp", name: "tmp", description: "Temp dir" }],
      },
    });

    expect(entry.capabilities.tools).toHaveLength(1);
    expect(entry.capabilities.tools[0].name).toBe("read_file");
    expect(entry.capabilities.resources).toHaveLength(1);
    expect(entry.capabilities.resources[0].uri).toBe("file:///tmp");
  });

  it("registers with env variables", () => {
    const entry = registry.register({
      name: "env-server",
      command: "node",
      env: { API_KEY: "secret123" },
    });

    expect(entry.env).toEqual({ API_KEY: "secret123" });
  });

  it("persists data across instances", () => {
    registry.register({ name: "persistent", command: "echo" });

    // Create a new registry backed by the same file.
    const registry2 = new ServerRegistry(
      new Storage(path.join(tmpDir, "registry.json")),
    );
    expect(registry2.get("persistent")).toBeDefined();
    expect(registry2.count()).toBe(1);
  });
});
