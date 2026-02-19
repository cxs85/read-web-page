#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readWebPage } from "./reader.js";

const server = new Server(
  {
    name: "read-web-page-mcp",
    version: "3.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_web_page",
        description:
          "Read and extract content from a web page. Handles JavaScript rendering, login pages, and returns content as Markdown.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL of the web page to read",
            },
            objective: {
              type: "string",
              description:
                "Optional: a natural-language description of what information you're looking for. Returns only relevant excerpts.",
            },
            forceRefetch: {
              type: "boolean",
              description:
                "Force a live fetch instead of using cache (default: false)",
            },
          },
          required: ["url"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "read_web_page") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { url, objective, forceRefetch } = request.params.arguments as {
    url: string;
    objective?: string;
    forceRefetch?: boolean;
  };

  try {
    const result = await readWebPage(url, objective, forceRefetch);
    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error reading web page: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("read-web-page MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
