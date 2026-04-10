export const TARGET_NEEDLES = [
  'claimNextReviewActionFromReviewQueue',
  'getReviewActionDataById',
  'submitTranscriptReviewAction'
] as const;

export const EVENT_SOURCE = 'babel-review-helper';
export const COMMAND_SOURCE = 'babel-review-overlay';
export const COMMAND_FETCH_REVIEW_ACTION = 'fetch-review-action-data';
export const COMMAND_FETCH_TRANSCRIPTION_DIFF = 'fetch-transcription-diff';
export const EVENT_REVIEW_ACTION_CAPTURED = 'review-action-captured';
export const EVENT_TRANSCRIPTION_DIFF_FETCHED = 'transcription-diff-fetched';

export const STORAGE_KEY_SESSIONS = 'babel.review.sessions.v1';
export const STORAGE_KEY_SETTINGS = 'babel.review.settings.v1';
export const STORAGE_KEY_SELECTED = 'babel.review.selected.v1';
export const STORAGE_KEY_APPLY_COMMANDS = 'babel.review.apply-commands.v1';

export const MAGIC_BUTTON_ID = 'babel-review-magic-button';
export const MAGIC_STYLE_ID = 'babel-review-magic-style';
export const SESSION_PAGE_PATH = 'session.html';
export const OPTIONS_PAGE_PATH = 'options.html';

export const RATING_PREFIX_BY_CATEGORY: Record<string, string> = {
  'Word Accuracy': 'wordAccuracy',
  'Timestamp Accuracy': 'timestampAccuracy',
  'Punctuation & Formatting': 'punctuationFormatting',
  'Tags & Emphasis': 'tagsEmphasis',
  Segmentation: 'segmentation'
};
