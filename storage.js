(function () {
  "use strict";

  const c = window.BabelReview.constants;
  window.BabelReview = window.BabelReview || {};

  async function loadState() {
    const data = await chrome.storage.local.get([
      c.STORAGE_KEY_SESSIONS,
      c.STORAGE_KEY_SETTINGS,
      c.STORAGE_KEY_SELECTED
    ]);
    return {
      sessions: data[c.STORAGE_KEY_SESSIONS] || {},
      settings: { ...c.DEFAULT_SETTINGS, ...(data[c.STORAGE_KEY_SETTINGS] || {}) },
      selectedSessionId: data[c.STORAGE_KEY_SELECTED] || ""
    };
  }

  async function saveState(state) {
    await chrome.storage.local.set({
      [c.STORAGE_KEY_SESSIONS]: state.sessions || {},
      [c.STORAGE_KEY_SETTINGS]: state.settings || c.DEFAULT_SETTINGS,
      [c.STORAGE_KEY_SELECTED]: state.selectedSessionId || ""
    });
  }

  window.BabelReview.storage = {
    loadState,
    saveState
  };
})();
