import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Storage } from "../src/storage.js";

describe("Storage", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-registry-test-"));
    filePath = path.join(tmpDir, "registry.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns default data when no file exists", () => {
    const storage = new Storage(filePath);
    const data = storage.load();
    expect(data).toEqual({ version: 1, servers: [] });
  });

  it("persists and reloads data", () => {
    const storage = new Storage(filePath);
    const data = { version: 1, servers: [{ name: "test" }] };
    storage.save(data as any);

    const loaded = storage.load();
    expect(loaded.servers).toHaveLength(1);
    expect(loaded.servers[0].name).toBe("test");
  });

  it("creates parent directories on save", () => {
    const nestedPath = path.join(tmpDir, "a", "b", "c", "registry.json");
    const storage = new Storage(nestedPath);
    storage.save({ version: 1, servers: [] });
    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  it("update() loads, mutates, and saves", () => {
    const storage = new Storage(filePath);
    storage.update((data) => {
      data.servers.push({
        name: "foo",
        command: "echo",
        args: [],
        env: {},
        capabilities: { tools: [], resources: [] },
        health: "unknown",
        lastChecked: null,
        registeredAt: new Date().toISOString(),
        uptimeChecks: 0,
        totalChecks: 0,
      });
    });

    const reloaded = new Storage(filePath).load();
    expect(reloaded.servers).toHaveLength(1);
    expect(reloaded.servers[0].name).toBe("foo");
  });

  it("clear() removes the file", () => {
    const storage = new Storage(filePath);
    storage.save({ version: 1, servers: [] });
    expect(fs.existsSync(filePath)).toBe(true);

    storage.clear();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("getServers() returns the server array", () => {
    const storage = new Storage(filePath);
    storage.save({
      version: 1,
      servers: [
        {
          name: "a",
          command: "x",
          args: [],
          env: {},
          capabilities: { tools: [], resources: [] },
          health: "healthy",
          lastChecked: null,
          registeredAt: "",
          uptimeChecks: 0,
          totalChecks: 0,
        },
      ] as any,
    });

    expect(storage.getServers()).toHaveLength(1);
  });

  it("handles corrupted JSON gracefully", () => {
    fs.writeFileSync(filePath, "not valid json!!!");
    const storage = new Storage(filePath);
    const data = storage.load();
    expect(data).toEqual({ version: 1, servers: [] });
  });

  it("handles missing fields gracefully", () => {
    fs.writeFileSync(filePath, JSON.stringify({ foo: "bar" }));
    const storage = new Storage(filePath);
    const data = storage.load();
    expect(data).toEqual({ version: 1, servers: [] });
  });

  it("getFilePath() returns the configured path", () => {
    const storage = new Storage(filePath);
    expect(storage.getFilePath()).toBe(filePath);
  });
});
