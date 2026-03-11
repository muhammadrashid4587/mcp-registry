/**
 * Persistent JSON file-based storage for the MCP Registry.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { RegistryData, ServerEntry } from "./types.js";

const CURRENT_VERSION = 1;

function defaultData(): RegistryData {
  return { version: CURRENT_VERSION, servers: [] };
}

export class Storage {
  private readonly filePath: string;

  /**
   * @param filePath  Absolute path to the JSON data file.
   *                  Defaults to `~/.mcp-registry/registry.json`.
   */
  constructor(filePath?: string) {
    if (filePath) {
      this.filePath = filePath;
    } else {
      const dir = path.join(os.homedir(), ".mcp-registry");
      this.filePath = path.join(dir, "registry.json");
    }
  }

  /** Return the resolved file path used by this storage instance. */
  getFilePath(): string {
    return this.filePath;
  }

  /** Load the registry data from disk. Returns default data if the file does not exist. */
  load(): RegistryData {
    try {
      if (!fs.existsSync(this.filePath)) {
        return defaultData();
      }
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (
        parsed == null ||
        typeof parsed !== "object" ||
        typeof parsed.version !== "number" ||
        !Array.isArray(parsed.servers)
      ) {
        return defaultData();
      }
      return parsed as RegistryData;
    } catch {
      return defaultData();
    }
  }

  /** Persist the full registry data to disk, creating parent directories as needed. */
  save(data: RegistryData): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /** Convenience: load, apply a mutation, then save. Returns the updated data. */
  update(mutate: (data: RegistryData) => void): RegistryData {
    const data = this.load();
    mutate(data);
    this.save(data);
    return data;
  }

  /** Delete the data file if it exists. */
  clear(): void {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }

  /** Convenience: load and return the server list. */
  getServers(): ServerEntry[] {
    return this.load().servers;
  }
}
