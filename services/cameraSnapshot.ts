export function cacheBustUrl(url: string, nonce = Date.now()): string {
  return url + (url.includes('?') ? '&' : '?') + `n=${nonce}`;
}

export function cameraSnapshotFileName(date = new Date()): string {
  return `helix-camera-${date.toISOString().replace(/[:.]/g, '-')}.jpg`;
}
