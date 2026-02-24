(function () {
  "use strict";

  window.BabelReview = window.BabelReview || {};
  window.BabelReview.constants = {
    TARGET_NEEDLES: [
      "claimNextReviewActionFromReviewQueue",
      "getReviewActionDataById",
      "submitTranscriptReviewAction",
    ],
    EVENT_SOURCE: "babel-review-interceptor",
    COMMAND_SOURCE: "babel-review-overlay",
    COMMAND_FETCH_REVIEW_ACTION: "fetch-review-action-data",
    STORAGE_KEY_SESSIONS: "babel.review.sessions.v1",
    STORAGE_KEY_SETTINGS: "babel.review.settings.v1",
    STORAGE_KEY_SELECTED: "babel.review.selected.v1",
    DEFAULT_SETTINGS: {
      backendBaseUrl: "https://reviewgen.ovh",
      backendBaseUrlFallbacks: [
        "http://127.0.0.1:3001",
        "http://localhost:3001",
      ],
      overlayMinimized: true,
      overlayPosX: 24,
      overlayPosY: 96,
    },
    MAX_ENTRIES: 80,
  };
})();
