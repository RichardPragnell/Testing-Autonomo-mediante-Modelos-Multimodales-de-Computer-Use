import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadProjectEnv } from "@agentic-qa/harness-core";
import { toolContracts } from "./tools.js";

function isDirectExecution(): boolean {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return false;
  }

  return fileURLToPath(import.meta.url) === resolve(scriptPath);
}

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "bench-harness-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  for (const tool of toolContracts) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (input: Record<string, unknown>, _extra: unknown) => {
        const result = await tool.handler(input);
        const structured =
          result && typeof result === "object" ? (result as Record<string, unknown>) : undefined;
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: structured
        };
      }
    );
  }
  return server;
}

async function main(): Promise<void> {
  await loadProjectEnv();

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bench-harness MCP server running on stdio");
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error("Fatal error in mcp server:", error);
    process.exit(1);
  });
}
