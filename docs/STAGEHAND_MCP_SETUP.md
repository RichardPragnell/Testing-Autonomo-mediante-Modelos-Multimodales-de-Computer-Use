# Stagehand MCP Docs Setup

This project uses Stagehand SDK at runtime and uses `stagehand-docs` MCP for development assistance.

## MCP server entry
Use this MCP endpoint in your coding-agent client:

`https://docs.stagehand.dev/mcp`

## Required environment variables
- `STAGEHAND_API_KEY`
- `GEMINI_API_KEY`

## Suggested client config snippet
```json
{
  "mcpServers": {
    "stagehand-docs": {
      "url": "https://docs.stagehand.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${STAGEHAND_API_KEY}",
        "X-Gemini-Key": "${GEMINI_API_KEY}"
      }
    }
  }
}
```

Adjust headers to your MCP client format if needed.
