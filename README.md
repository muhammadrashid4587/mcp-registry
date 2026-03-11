# mcp-registry

Discovery and health monitoring service for MCP (Model Context Protocol) servers.

Maintains a catalog of registered MCP servers, their capabilities (tools, resources), health status, and uptime. Provides a CLI to register, search, and monitor MCP servers.

## Installation

```bash
npm install -g mcp-registry
```

Or run from source:

```bash
git clone https://github.com/muhammadrashid4587/mcp-registry.git
cd mcp-registry
npm install
npm run build
```

## Usage

### Register a server

```bash
mcp-registry register --name "filesystem" --command "npx" --args "@modelcontextprotocol/server-filesystem /tmp"
```

With auto-discovery of capabilities:

```bash
mcp-registry register --name "filesystem" --command "npx" --args "@modelcontextprotocol/server-filesystem /tmp" --discover
```

### List all servers

```bash
mcp-registry list
```

### Search by tool or resource

```bash
mcp-registry search --tool "read_file"
mcp-registry search --resource "file:///"
mcp-registry search --health "healthy"
```

### Run health checks

```bash
mcp-registry check --name "filesystem"
mcp-registry check --all
```

### Remove a server

```bash
mcp-registry remove --name "filesystem"
```

## How it works

- **Registry** stores server entries with name, command, args, env, capabilities, health status, and timestamps.
- **Health Monitor** spawns each server briefly and sends a JSON-RPC `initialize` request to verify it responds correctly.
- **Catalog** indexes tools and resources across all servers for fast lookup by name or URI.
- **Discovery** connects to a server via stdio, runs `initialize`, `tools/list`, and `resources/list` to extract its full capabilities.
- **Storage** persists the registry to `~/.mcp-registry/registry.json`.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
