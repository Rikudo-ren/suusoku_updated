/**
 * Browser-API glue for the result-screen sharing feature. Generating the
 * caption/image happens elsewhere (shareText.ts / shareCard.ts) -- this file
 * only knows how to hand a ready (text, image) pair to a platform, with
 * fallbacks for whatever the current browser/OS actually supports, since
 * clipboard-image support and the Web Share API vary a lot across
 * desktop/mobile/browser combinations.
 */

export type ShareOutcome =
  | { kind: "shared" }
  | { kind: "copied-image-and-text" }
  | { kind: "copied-text" }
  | { kind: "downloaded" }
  | { kind: "cancelled" }
  | { kind: "unsupported" };

function supportsClipboardImageWrite(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === "function" &&
    typeof ClipboardItem !== "undefined"
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through -- caller decides the fallback */
  }
  return false;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a delay rather than immediately: some browsers (notably
  // Safari) kick the download off asynchronously, and revoking the object
  // URL right away can cancel it before the download actually starts.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Copies the result image to the clipboard with the caption text attached as
 * a second representation of the *same* clipboard item. Pasting into
 * something that accepts images -- Discord's message box and X's own tweet
 * composer both do -- attaches the picture directly; pasting into a
 * text-only field still yields the caption. Falls back to a text-only copy
 * (plus a manual download so the image isn't lost) and finally to a plain
 * download if the clipboard API itself is unavailable.
 */
export async function copyImageAndText(blob: Blob, text: string, filename: string): Promise<ShareOutcome> {
  if (supportsClipboardImageWrite()) {
    try {
      const item = new ClipboardItem({
        [blob.type]: blob,
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return { kind: "copied-image-and-text" };
    } catch {
      /* some browsers implement ClipboardItem but reject multi-type writes
       * (or the user denied permission) -- fall through to the text/download
       * path below rather than leaving the player with nothing. */
    }
  }
  const textCopied = await copyText(text);
  downloadBlob(blob, filename);
  return textCopied ? { kind: "copied-text" } : { kind: "downloaded" };
}

function canWebShareFiles(file: File): boolean {
  return typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [file] });
}

export function isWebShareAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.share;
}

/** Web Share API -- opens the OS-native share sheet so the player can pick
 * literally any installed app (Discord, X, LINE, Mail, ...) in one tap.
 * Attaches the image when the platform supports sharing files; otherwise
 * falls back to text + link only rather than failing outright. */
export async function webShare(text: string, url: string, file?: File): Promise<ShareOutcome> {
  if (!navigator.share) return { kind: "unsupported" };
  try {
    const attachFile = file && canWebShareFiles(file);
    await navigator.share(attachFile ? { text, url, files: [file] } : { text, url });
    return { kind: "shared" };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return { kind: "cancelled" };
    return { kind: "unsupported" };
  }
}

export function openTweetIntent(intentUrl: string) {
  window.open(intentUrl, "_blank", "noopener,noreferrer,width=600,height=650");
}
