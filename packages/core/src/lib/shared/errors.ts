// A hibából beszédes üzenetet nyer ki: Error esetén az .message-t, egyébként String()-et.
// A rendszer-határokon (CLI kimenet, tool_result) egységes, ismétlés nélküli hibaformázásra.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
