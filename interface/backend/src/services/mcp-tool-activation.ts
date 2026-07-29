/**
 * Return only MCP servers explicitly named by the conversation.
 *
 * Generic words such as "logic", "reasoning", and "memory" occur naturally in
 * analytical corpora and are not authorization to expose an entire server's
 * tool surface to the model.
 */
export function explicitlyRequestedMcpServers(
  conversationText: string,
  serverNames: readonly string[],
): string[] {
  const normalized = conversationText.toLowerCase();
  return serverNames.filter((serverName) =>
    normalized.includes(serverName.toLowerCase()),
  );
}

/** Meta-tools can reach every server, so expose them only with explicit scope. */
export function shouldExposeMcpMetaTools(
  explicitlyRequestedServers: readonly string[],
): boolean {
  return explicitlyRequestedServers.length > 0;
}

/** Repair a direct MCP call that redundantly nests the real payload once. */
export function unwrapNestedToolArguments(
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(args).length !== 1) return args;
  const nested = args.arguments;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return args;
  return { ...(nested as Record<string, unknown>) };
}
