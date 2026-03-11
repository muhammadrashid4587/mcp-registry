/**
 * Catalog — capability indexing and search across all registered MCP servers.
 * Provides fast lookup by tool name, resource URI/name, or health status.
 */

import { ServerRegistry } from "./registry.js";
import type {
  SearchOptions,
  SearchResult,
  ServerEntry,
  ToolCapability,
  ResourceCapability,
} from "./types.js";

export class Catalog {
  private registry: ServerRegistry;

  constructor(registry: ServerRegistry) {
    this.registry = registry;
  }

  /**
   * Search registered servers by tool name, resource, or health status.
   * All string matches are case-insensitive substring matches.
   */
  search(options: SearchOptions): SearchResult[] {
    const servers = this.registry.list();
    const results: SearchResult[] = [];

    for (const server of servers) {
      // If a health filter is specified, skip non-matching servers.
      if (options.health && server.health !== options.health) {
        continue;
      }

      let matchedTools: ToolCapability[] = [];
      let matchedResources: ResourceCapability[] = [];

      if (options.tool) {
        const needle = options.tool.toLowerCase();
        matchedTools = server.capabilities.tools.filter(
          (t) =>
            t.name.toLowerCase().includes(needle) ||
            (t.description?.toLowerCase().includes(needle) ?? false),
        );
      }

      if (options.resource) {
        const needle = options.resource.toLowerCase();
        matchedResources = server.capabilities.resources.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            r.uri.toLowerCase().includes(needle) ||
            (r.description?.toLowerCase().includes(needle) ?? false),
        );
      }

      // If tool/resource filters are active, only include servers that matched.
      const hasToolFilter = !!options.tool;
      const hasResourceFilter = !!options.resource;

      if (hasToolFilter && hasResourceFilter) {
        if (matchedTools.length > 0 || matchedResources.length > 0) {
          results.push({ server, matchedTools, matchedResources });
        }
      } else if (hasToolFilter) {
        if (matchedTools.length > 0) {
          results.push({ server, matchedTools, matchedResources: [] });
        }
      } else if (hasResourceFilter) {
        if (matchedResources.length > 0) {
          results.push({ server, matchedTools: [], matchedResources });
        }
      } else {
        // No tool/resource filter — health-only filter or no filter at all.
        results.push({
          server,
          matchedTools: server.capabilities.tools,
          matchedResources: server.capabilities.resources,
        });
      }
    }

    return results;
  }

  /** Find all servers that provide a given tool (exact name match). */
  findByTool(toolName: string): ServerEntry[] {
    return this.registry
      .list()
      .filter((s) => s.capabilities.tools.some((t) => t.name === toolName));
  }

  /** Find all servers that expose a resource matching a URI pattern. */
  findByResource(uriPattern: string): ServerEntry[] {
    const needle = uriPattern.toLowerCase();
    return this.registry
      .list()
      .filter((s) =>
        s.capabilities.resources.some((r) =>
          r.uri.toLowerCase().includes(needle),
        ),
      );
  }

  /** Return a flat list of all unique tool names across every server. */
  allToolNames(): string[] {
    const names = new Set<string>();
    for (const server of this.registry.list()) {
      for (const tool of server.capabilities.tools) {
        names.add(tool.name);
      }
    }
    return Array.from(names).sort();
  }

  /** Return a flat list of all unique resource URIs across every server. */
  allResourceUris(): string[] {
    const uris = new Set<string>();
    for (const server of this.registry.list()) {
      for (const resource of server.capabilities.resources) {
        uris.add(resource.uri);
      }
    }
    return Array.from(uris).sort();
  }

  /** Summary stats for display. */
  summary(): {
    totalServers: number;
    healthy: number;
    unhealthy: number;
    unknown: number;
    totalTools: number;
    totalResources: number;
  } {
    const servers = this.registry.list();
    return {
      totalServers: servers.length,
      healthy: servers.filter((s) => s.health === "healthy").length,
      unhealthy: servers.filter((s) => s.health === "unhealthy").length,
      unknown: servers.filter((s) => s.health === "unknown").length,
      totalTools: this.allToolNames().length,
      totalResources: this.allResourceUris().length,
    };
  }
}
