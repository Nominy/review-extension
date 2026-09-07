import type { CapturedNetworkEntry } from '../core/types';
import { audioUrl, extractNormalizedFromEntry } from './review-action-parser';

export async function enrichRecordingUrls(entry: CapturedNetworkEntry, fetcher: typeof fetch): Promise<CapturedNetworkEntry> {
  try {
    const snapshot = extractNormalizedFromEntry(entry);
    const s3Urls = [...new Set(snapshot?.recordings.map(recording => recording.processedRecordingUri).filter((uri): uri is string => !!uri) || [])];
    if (!s3Urls.length) return entry;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const url = '/api/trpc/application.getAudioPresignedUrls?batch=1&input=' + encodeURIComponent(JSON.stringify({ '0': { json: { s3Urls } } }));
      const response = await fetcher(url, { credentials: 'include', signal: controller.signal });
      if (!response.ok) return entry;
      const body = await response.json();
      const frame = Array.isArray(body) ? body[0] : body;
      const mapping = frame?.result?.data?.json ?? frame?.result?.data;
      if (!mapping || typeof mapping !== 'object') return entry;
      const recordingAudioUrls = Object.fromEntries(Object.entries(mapping).flatMap(([source, value]) => s3Urls.includes(source) && audioUrl(value) ? [[source, audioUrl(value)]] : []));
      return { ...entry, recordingAudioUrls };
    } finally { clearTimeout(timer); }
  } catch { return entry; } // URL lookup must never block transcript capture.
}
