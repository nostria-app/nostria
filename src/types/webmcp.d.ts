interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, extra?: unknown) => unknown;
}

interface WebMcpModelContext {
  provideContext?: (input: { tools: WebMcpTool[] }) => unknown;
  registerTool?: (tool: WebMcpTool) => unknown;
}

interface Navigator {
  modelContext?: WebMcpModelContext;
  modelContextProtocol?: WebMcpModelContext;
}
