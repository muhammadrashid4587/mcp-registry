#!/usr/bin/env node

/**
 * mcp-registry CLI entry point.
 *
 * Commands:
 *   register  — Register a new MCP server
 *   list      — List all registered servers
 *   search    — Search servers by tool or resource
 *   check     — Run health checks
 *   remove    — Remove a registered server
 */

import { parseArgs } from "node:util";
import { Storage } from "./storage.js";
import { ServerRegistry } from "./registry.js";
import { HealthMonitor } from "./health.js";
import { Catalog } from "./catalog.js";
import { discoverCapabilities } from "./discovery.js";
import type { HealthCheckResult } from "./types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
mcp-registry — Discovery and health monitoring for MCP servers

Usage:
  mcp-registry register --name <name> --command <cmd> [--args "<args>"] [--env "KEY=VAL,..."]
  mcp-registry list
  mcp-registry search --tool <name> | --resource <uri>
  mcp-registry check [--name <name> | --all]
  mcp-registry remove --name <name>

Options:
  --help, -h     Show this help message
  --discover     Auto-discover capabilities on register
`);
}

function statusIcon(status: string): string {
  switch (status) {
    case "healthy":
      return "[OK]";
    case "unhealthy":
      return "[FAIL]";
    case "degraded":
      return "[WARN]";
    default:
      return "[??]";
  }
}

function formatEntry(entry: {
  name: string;
  command: string;
  args: string[];
  health: string;
  lastChecked: string | null;
  uptimeChecks: number;
  totalChecks: number;
  capabilities: { tools: { name: string }[]; resources: { uri: string }[] };
}): string {
  const uptime =
    entry.totalChecks > 0
      ? ((entry.uptimeChecks / entry.totalChecks) * 100).toFixed(1) + "%"
      : "n/a";
  const toolNames = entry.capabilities.tools.map((t) => t.name).join(", ") || "none";
  const resourceCount = entry.capabilities.resources.length;
  return [
    `  ${statusIcon(entry.health)} ${entry.name}`,
    `     Command:   ${entry.command} ${entry.args.join(" ")}`,
    `     Health:    ${entry.health}  (uptime ${uptime})`,
    `     Tools:     ${toolNames}`,
    `     Resources: ${resourceCount} resource(s)`,
    `     Checked:   ${entry.lastChecked ?? "never"}`,
  ].join("\n");
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdRegister(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: "string" },
      command: { type: "string" },
      args: { type: "string" },
      env: { type: "string" },
      discover: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (!values.name || !values.command) {
    console.error("Error: --name and --command are required.");
    process.exit(1);
  }

  const serverArgs = values.args ? values.args.split(/\s+/) : [];
  const serverEnv: Record<string, string> = {};
  if (values.env) {
    for (const pair of values.env.split(",")) {
      const [key, ...rest] = pair.split("=");
      if (key) serverEnv[key.trim()] = rest.join("=").trim();
    }
  }

  const storage = new Storage();
  const registry = new ServerRegistry(storage);

  let capabilities = { tools: [] as any[], resources: [] as any[] };
  if (values.discover) {
    console.log(`Discovering capabilities for "${values.name}"...`);
    try {
      capabilities = await discoverCapabilities(
        values.command,
        serverArgs,
        serverEnv,
      );
      console.log(
        `  Found ${capabilities.tools.length} tool(s) and ${capabilities.resources.length} resource(s).`,
      );
    } catch (err) {
      console.warn(
        `  Warning: discovery failed (${err instanceof Error ? err.message : err}). Registering without capabilities.`,
      );
    }
  }

  try {
    const entry = registry.register({
      name: values.name,
      command: values.command,
      args: serverArgs,
      env: serverEnv,
      capabilities,
    });
    console.log(`Registered "${entry.name}" successfully.`);
  } catch (err) {
    console.error(
      `Error: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

function cmdList(): void {
  const storage = new Storage();
  const registry = new ServerRegistry(storage);
  const servers = registry.list();

  if (servers.length === 0) {
    console.log("No servers registered. Use 'mcp-registry register' to add one.");
    return;
  }

  console.log(`Registered MCP servers (${servers.length}):\n`);
  for (const entry of servers) {
    console.log(formatEntry(entry));
    console.log();
  }
}

function cmdSearch(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      tool: { type: "string" },
      resource: { type: "string" },
      health: { type: "string" },
    },
    strict: true,
  });

  if (!values.tool && !values.resource && !values.health) {
    console.error(
      "Error: at least one of --tool, --resource, or --health is required.",
    );
    process.exit(1);
  }

  const storage = new Storage();
  const registry = new ServerRegistry(storage);
  const catalog = new Catalog(registry);

  const results = catalog.search({
    tool: values.tool,
    resource: values.resource,
    health: values.health as any,
  });

  if (results.length === 0) {
    console.log("No matching servers found.");
    return;
  }

  console.log(`Found ${results.length} matching server(s):\n`);
  for (const r of results) {
    console.log(formatEntry(r.server));
    if (r.matchedTools.length > 0) {
      console.log(
        `     Matched tools: ${r.matchedTools.map((t) => t.name).join(", ")}`,
      );
    }
    if (r.matchedResources.length > 0) {
      console.log(
        `     Matched resources: ${r.matchedResources.map((r) => r.uri).join(", ")}`,
      );
    }
    console.log();
  }
}

async function cmdCheck(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: "string" },
      all: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (!values.name && !values.all) {
    console.error("Error: --name <name> or --all is required.");
    process.exit(1);
  }

  const storage = new Storage();
  const registry = new ServerRegistry(storage);
  const monitor = new HealthMonitor(registry);

  let results: HealthCheckResult[];
  if (values.all) {
    console.log("Running health checks on all servers...\n");
    results = await monitor.checkAll();
  } else {
    results = [await monitor.check(values.name!)];
  }

  for (const r of results) {
    const icon = statusIcon(r.status);
    const time = r.responseTimeMs > 0 ? ` (${r.responseTimeMs}ms)` : "";
    console.log(`${icon} ${r.name}: ${r.status}${time}`);
    if (r.error) {
      console.log(`     Error: ${r.error}`);
    }
    if (r.capabilities) {
      console.log(
        `     Capabilities: ${r.capabilities.tools.length} tool(s), ${r.capabilities.resources.length} resource(s)`,
      );
    }
  }
}

function cmdRemove(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: "string" },
    },
    strict: true,
  });

  if (!values.name) {
    console.error("Error: --name is required.");
    process.exit(1);
  }

  const storage = new Storage();
  const registry = new ServerRegistry(storage);

  if (registry.remove(values.name)) {
    console.log(`Removed "${values.name}".`);
  } else {
    console.error(`Error: server "${values.name}" not found.`);
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  switch (command) {
    case "register":
      await cmdRegister(rest);
      break;
    case "list":
      cmdList();
      break;
    case "search":
      cmdSearch(rest);
      break;
    case "check":
      await cmdCheck(rest);
      break;
    case "remove":
      cmdRemove(rest);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
