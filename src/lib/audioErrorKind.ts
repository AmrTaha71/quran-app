/** Item 4.18: tell a missing file from a network failure. A 404 reaches
 *  an <audio> element as MEDIA_ERR_SRC_NOT_SUPPORTED (4) while online; a
 *  dropped connection is MEDIA_ERR_NETWORK (2) or happens offline. */
export function classifyAudioError(code: number | null | undefined, online: boolean): 'network' | 'missing' | 'other' {
  if (!online || code === 2) return 'network';
  if (code === 4) return 'missing';
  return 'other';
}
