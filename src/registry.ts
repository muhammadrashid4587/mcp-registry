/**
 * ServerRegistry — stores and queries registered MCP server entries.
 */

import { Storage } from "./storage.js";
import type { ServerEntry, ServerCapabilities, ServerEnv } from "./types.js";

export interface RegisterOptions {
  name: string;
  command: string;
  args?: string[];
  env?: ServerEnv;
  capabilities?: ServerCapabilities;
}

export class ServerRegistry {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  /** Register a new server. Throws if a server with the same name already exists. */
  register(opts: RegisterOptions): ServerEntry {
    if (!opts.name || !opts.name.trim()) {
      throw new Error("Server name must not be empty.");
    }
    if (!opts.command || !opts.command.trim()) {
      throw new Error("Server command must not be empty.");
    }
    const existing = this.get(opts.name);
    if (existing) {
      throw new Error(`Server "${opts.name}" is already registered.`);
    }

    const entry: ServerEntry = {
      name: opts.name,
      command: opts.command,
      args: opts.args ?? [],
      env: opts.env ?? {},
      capabilities: opts.capabilities ?? { tools: [], resources: [] },
      health: "unknown",
      lastChecked: null,
      registeredAt: new Date().toISOString(),
      uptimeChecks: 0,
      totalChecks: 0,
    };

    this.storage.update((data) => {
      data.servers.push(entry);
    });

    return entry;
  }

  /** Remove a server by name. Returns true if removed, false if not found. */
  remove(name: string): boolean {
    let found = false;
    this.storage.update((data) => {
      const idx = data.servers.findIndex((s) => s.name === name);
      if (idx !== -1) {
        data.servers.splice(idx, 1);
        found = true;
      }
    });
    return found;
  }

  /** Get a single server by name, or undefined. */
  get(name: string): ServerEntry | undefined {
    return this.storage.getServers().find((s) => s.name === name);
  }

  /** List all registered servers. */
  list(): ServerEntry[] {
    return this.storage.getServers();
  }

  /** Update a server entry in-place. Throws if not found. */
  updateServer(name: string, patch: Partial<ServerEntry>): ServerEntry {
    let updated: ServerEntry | undefined;
    this.storage.update((data) => {
      const server = data.servers.find((s) => s.name === name);
      if (!server) {
        throw new Error(`Server "${name}" not found.`);
      }
      const { name: _ignoredName, ...safePatch } = patch;
      Object.assign(server, safePatch);
      updated = { ...server };
    });
    if (!updated) {
      throw new Error(`Server "${name}" was not updated.`);
    }
    return updated;
  }

  /** Return the number of registered servers. */
  count(): number {
    return this.storage.getServers().length;
  }
}
