// Tiny handoff between the interactive MakerWorld download screen and the Slice
// tab. The download screen captures + saves the 3MF, drops the result here, and
// navigates back; the Slice tab picks it up on focus.

export type MwDownloadResult = {
  designId: string;
  instanceId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
};

let last: MwDownloadResult | null = null;

export function setMwDownload(result: MwDownloadResult): void {
  last = result;
}

export function takeMwDownload(): MwDownloadResult | null {
  const r = last;
  last = null;
  return r;
}
