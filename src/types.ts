/**
 * Core type definitions for the MCP Registry.
 */

/** Health status of a registered MCP server. */
export type HealthStatus = "unknown" | "healthy" | "unhealthy" | "degraded";

/** A single tool capability exposed by an MCP server. */
export interface ToolCapability {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** A single resource capability exposed by an MCP server. */
export interface ResourceCapability {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** The full set of capabilities reported by an MCP server. */
export interface ServerCapabilities {
  tools: ToolCapability[];
  resources: ResourceCapability[];
}

/** Environment variables to pass when spawning the server process. */
export type ServerEnv = Record<string, string>;

/** A registered MCP server entry. */
export interface ServerEntry {
  /** Unique name identifying this server. */
  name: string;
  /** Command used to launch the server (e.g. "npx", "node"). */
  command: string;
  /** Arguments passed to the command. */
  args: string[];
  /** Optional environment variables for the server process. */
  env: ServerEnv;
  /** Discovered capabilities (tools and resources). */
  capabilities: ServerCapabilities;
  /** Current health status. */
  health: HealthStatus;
  /** ISO-8601 timestamp of the last health check. */
  lastChecked: string | null;
  /** ISO-8601 timestamp when the server was first registered. */
  registeredAt: string;
  /** Number of consecutive successful health checks. */
  uptimeChecks: number;
  /** Total number of health checks performed. */
  totalChecks: number;
}

/** Shape of the persisted registry data file. */
export interface RegistryData {
  version: number;
  servers: ServerEntry[];
}

/** Result returned from a health check. */
export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  responseTimeMs: number;
  capabilities?: ServerCapabilities;
  error?: string;
}

/** Options for searching the catalog. */
export interface SearchOptions {
  /** Search for a specific tool name (substring match). */
  tool?: string;
  /** Search for a specific resource URI or name (substring match). */
  resource?: string;
  /** Filter by health status. */
  health?: HealthStatus;
}

/** A search result entry returned by the catalog. */
export interface SearchResult {
  server: ServerEntry;
  matchedTools: ToolCapability[];
  matchedResources: ResourceCapability[];
}
