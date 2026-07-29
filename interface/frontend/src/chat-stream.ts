/** Choose the persisted backend response over provisional text from tool turns. */
export function selectFinalAssistantContent(
  backendContent: string | undefined,
  streamedContent: string,
): string {
  return backendContent?.trim() ? backendContent : streamedContent;
}
