/**
 * Copies text to the clipboard. Returns false when the browser refuses, for example on a page
 * served over plain HTTP from another machine, where the Clipboard API does not exist.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
