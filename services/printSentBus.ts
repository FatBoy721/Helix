export type PrintSentNotice = {
  filename: string;
};

let pending: PrintSentNotice | null = null;

/** Stages a confirmed print start for the Home tab to present once. */
export function setPrintSentNotice(notice: PrintSentNotice): void {
  pending = notice;
}

export function takePrintSentNotice(): PrintSentNotice | null {
  const notice = pending;
  pending = null;
  return notice;
}
