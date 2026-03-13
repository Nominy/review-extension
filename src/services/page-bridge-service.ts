import {
  COMMAND_FETCH_REVIEW_ACTION,
  COMMAND_FETCH_TRANSCRIPTION_DIFF,
  COMMAND_SOURCE,
  EVENT_REVIEW_ACTION_CAPTURED,
  EVENT_SOURCE,
  EVENT_TRANSCRIPTION_DIFF_FETCHED,
  TARGET_NEEDLES
} from '../core/constants';
import type { BabelDiffPayload, CapturedNetworkEntry, DiffCommandPayload } from '../core/types';

function postWindowMessage(payload: Record<string, unknown>): void {
  window.postMessage(
    {
      source: COMMAND_SOURCE,
      ...payload
    },
    '*'
  );
}

function injectPageBridge(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('dist/content/page-bridge.js');
  script.dataset.targetNeedles = JSON.stringify(TARGET_NEEDLES);
  script.async = false;
  (document.documentElement || document.head).appendChild(script);
  script.onload = () => script.remove();
}

function subscribe<T>(type: string, listener: (payload: T) => void): () => void {
  const handler = (event: MessageEvent): void => {
    if (event.source !== window) {
      return;
    }

    const data = event.data as { source?: string; type?: string; payload?: T } | null;
    if (!data || data.source !== EVENT_SOURCE || data.type !== type) {
      return;
    }

    if (data.payload !== undefined) {
      listener(data.payload);
    }
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

export function createPageBridgeService() {
  return {
    inject(): void {
      injectPageBridge();
    },
    fetchReviewAction(reviewActionId: string): void {
      postWindowMessage({
        type: COMMAND_FETCH_REVIEW_ACTION,
        reviewActionId
      });
    },
    fetchTranscriptionDiff(payload: DiffCommandPayload): void {
      postWindowMessage({
        type: COMMAND_FETCH_TRANSCRIPTION_DIFF,
        reviewActionId: payload.reviewActionId,
        transcriptionChunkId: payload.transcriptionChunkId
      });
    },
    onReviewActionCaptured(listener: (entry: CapturedNetworkEntry) => void): () => void {
      return subscribe<CapturedNetworkEntry>(EVENT_REVIEW_ACTION_CAPTURED, listener);
    },
    onTranscriptionDiff(listener: (payload: BabelDiffPayload) => void): () => void {
      return subscribe<BabelDiffPayload>(EVENT_TRANSCRIPTION_DIFF_FETCHED, listener);
    }
  };
}
