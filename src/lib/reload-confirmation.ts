/** A confirmation only authorizes discarding the content that was shown before it. */
export async function confirmDocumentReload(
  readSource: () => string,
  confirmDiscard: () => Promise<boolean>,
): Promise<"confirmed" | "cancelled" | "changed"> {
  const source = readSource();
  if (!await confirmDiscard()) return "cancelled";
  return readSource() === source ? "confirmed" : "changed";
}
