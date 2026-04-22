import { createPageBridge } from '@nominy/babel-babel-runtime';
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

export function createPageBridgeService() {
  const bridge = createPageBridge({
    commandSource: COMMAND_SOURCE,
    eventSource: EVENT_SOURCE,
    injectScriptPath: chrome.runtime.getURL('dist/content/page-bridge.js'),
    injectScriptDataset: {
      targetNeedles: JSON.stringify(TARGET_NEEDLES)
    }
  });

  return {
    inject(): void {
      bridge.inject();
    },
    fetchReviewAction(reviewActionId: string): void {
      bridge.post(COMMAND_FETCH_REVIEW_ACTION, {
        reviewActionId
      });
    },
    fetchTranscriptionDiff(payload: DiffCommandPayload): void {
      bridge.post(COMMAND_FETCH_TRANSCRIPTION_DIFF, {
        reviewActionId: payload.reviewActionId,
        transcriptionChunkId: payload.transcriptionChunkId
      });
    },
    onReviewActionCaptured(listener: (entry: CapturedNetworkEntry) => void): () => void {
      return bridge.subscribe<CapturedNetworkEntry>(EVENT_REVIEW_ACTION_CAPTURED, listener);
    },
    onTranscriptionDiff(listener: (payload: BabelDiffPayload) => void): () => void {
      return bridge.subscribe<BabelDiffPayload>(EVENT_TRANSCRIPTION_DIFF_FETCHED, listener);
    }
  };
}
