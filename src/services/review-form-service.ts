import {
  MAGIC_BUTTON_ID,
  MAGIC_STYLE_ID,
  RATING_PREFIX_BY_CATEGORY,
} from "../core/constants";
import type {
  FeedbackItem,
  InputSnapshot,
  MagicButtonController,
} from "../core/types";

let toastTimer = 0;
const TOAST_ID = "babel-review-magic-toast";
const MIN_REVIEW_TEXTAREAS = 4;

function getReviewContainer(): HTMLElement | null {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    'textarea[placeholder="Provide specific feedback..."]',
  );
  if (!textarea) {
    return null;
  }

  let current: HTMLElement | null = textarea.parentElement;
  while (current && current !== document.body) {
    const count = current.querySelectorAll(
      'textarea[placeholder="Provide specific feedback..."]',
    ).length;
    if (count >= MIN_REVIEW_TEXTAREAS) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function findHeading(container: HTMLElement, text: string): HTMLElement | null {
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>("h1,h2,h3,h4,div,span"),
  );
  for (const node of nodes) {
    if ((node.textContent || "").trim() === text) {
      return node;
    }
  }
  return null;
}

function ensureStyles(): void {
  if (document.getElementById(MAGIC_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = MAGIC_STYLE_ID;
  style.textContent = `
    #${MAGIC_BUTTON_ID} {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      border: 1px solid #f97316;
      background: #f97316;
      color: #ffffff;
      border-radius: 6px;
      padding: 7px 12px;
      font: 600 13px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      cursor: pointer;
      margin-left: 8px;
      margin-right: 0;
      margin-top: 4px;
      margin-bottom: 4px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
    }
    #${MAGIC_BUTTON_ID}:hover {
      background: #ea580c;
      border-color: #ea580c;
    }
    #${MAGIC_BUTTON_ID}:active {
      background: #c2410c;
      border-color: #c2410c;
      box-shadow: none;
    }
    #${MAGIC_BUTTON_ID}[data-state="loading"] {
      opacity: 0.88;
      cursor: wait;
      background: #fdba74;
      border-color: #fdba74;
    }
    #${MAGIC_BUTTON_ID}[data-state="done"] {
      border-color: #16a34a;
      background: #16a34a;
      color: #ffffff;
    }
    #${MAGIC_BUTTON_ID}[data-state="error"] {
      border-color: #b91c1c;
      background: #b91c1c;
      color: #ffffff;
    }
    #${MAGIC_BUTTON_ID} .babel-review-magic-icon {
      font-size: 15px;
      line-height: 1;
    }
    #${MAGIC_BUTTON_ID} .babel-review-magic-spinner {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid currentColor;
      border-right-color: transparent;
      display: none;
    }
    #${MAGIC_BUTTON_ID}[data-state="loading"] .babel-review-magic-spinner {
      display: inline-block;
      animation: babel-review-spin 0.7s linear infinite;
    }
    #${MAGIC_BUTTON_ID}[data-state="loading"] .babel-review-magic-icon { display: none; }
    @keyframes babel-review-spin {
      to { transform: rotate(360deg); }
    }
    #${TOAST_ID} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      max-width: 380px;
      padding: 0;
      border-radius: 12px;
      font: 600 12.5px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #fff;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.22), 0 2px 6px rgba(0, 0, 0, 0.10);
      overflow: hidden;
      animation: babel-review-toast-in 280ms cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: auto;
    }
    #${TOAST_ID} .babel-toast-content {
      padding: 10px 14px;
    }
    #${TOAST_ID} .babel-toast-bar {
      height: 3px;
      background: rgba(255, 255, 255, 0.35);
      animation: babel-review-toast-bar 3s linear forwards;
    }
    #${TOAST_ID}.babel-toast-out {
      animation: babel-review-toast-out 220ms ease-in forwards;
    }
    @keyframes babel-review-toast-in {
      from { opacity: 0; transform: translateY(12px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes babel-review-toast-out {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to { opacity: 0; transform: translateY(8px) scale(0.97); }
    }
    @keyframes babel-review-toast-bar {
      from { width: 100%; }
      to { width: 0%; }
    }
  `;
  document.documentElement.appendChild(style);
}

function setNativeValue(element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
}

function findCardByCategory(
  root: ParentNode,
  category: string,
): HTMLElement | null {
  const prefix = RATING_PREFIX_BY_CATEGORY[category];
  if (!prefix) {
    return null;
  }

  const selector = `#${CSS.escape(prefix)}-1`;
  const control =
    root.querySelector(selector) || document.querySelector(selector);
  if (!(control instanceof HTMLElement)) {
    return null;
  }

  let card: HTMLElement | null = control.closest("div");
  while (card && card !== root && card !== document.body) {
    if (
      card.querySelector('textarea[placeholder="Provide specific feedback..."]')
    ) {
      return card;
    }
    card = card.parentElement;
  }

  return null;
}

export function createReviewFormService(): MagicButtonController {
  return {
    ensure(onClick): void {
      ensureStyles();

      if (document.getElementById(MAGIC_BUTTON_ID)) {
        return;
      }

      const container = getReviewContainer();
      if (!container) {
        return;
      }

      const button = document.createElement("button");
      button.id = MAGIC_BUTTON_ID;
      button.type = "button";
      button.dataset.state = "idle";
      button.innerHTML = `
        <span class="babel-review-magic-icon">\u{1FA84}</span>
        <span class="babel-review-magic-spinner"></span>
        <span class="babel-review-magic-label">Magic Review</span>
      `;
      button.addEventListener("click", () => {
        void onClick();
      });

      const heading = findHeading(container, "Review the feedback");
      if (heading?.parentElement) {
        heading.parentElement.appendChild(button);
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.justifyContent = "flex-end";
      wrapper.style.marginBottom = "8px";
      wrapper.appendChild(button);
      container.prepend(wrapper);
    },
    setState(mode, label): void {
      const button = document.getElementById(MAGIC_BUTTON_ID);
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }

      button.dataset.state = mode;
      button.disabled = mode === "loading";
      const labelNode = button.querySelector<HTMLElement>(
        ".babel-review-magic-label",
      );
      if (labelNode) {
        labelNode.textContent = label || "Magic Review";
      }
    },
    pushToast(message, isError): void {
      ensureStyles();
      const existing = document.getElementById(TOAST_ID);
      if (existing) {
        existing.remove();
      }
      window.clearTimeout(toastTimer);

      const holder = document.createElement("div");
      holder.id = TOAST_ID;
      holder.style.background = isError
        ? "linear-gradient(135deg, #b91c1c 0%, #991b1b 100%)"
        : "linear-gradient(135deg, #166534 0%, #15803d 100%)";
      holder.innerHTML = `<div class="babel-toast-content"></div><div class="babel-toast-bar"></div>`;
      const content = holder.querySelector<HTMLElement>(".babel-toast-content");
      if (content) {
        content.textContent = message;
      }
      document.documentElement.appendChild(holder);

      toastTimer = window.setTimeout(() => {
        holder.classList.add("babel-toast-out");
        window.setTimeout(() => holder.remove(), 240);
      }, 3000);
    },
    async applyFeedback(
      feedback: FeedbackItem[],
    ): Promise<{ applied: number }> {
      const root = getReviewContainer() || document;
      let applied = 0;
      const targets: Array<{ note: string; card: HTMLElement }> = [];

      for (const item of feedback) {
        const category = item?.category?.trim();
        const note = item?.note || "";
        if (!category || !note) {
          continue;
        }

        const card = findCardByCategory(root, category);
        if (card) {
          targets.push({ card, note: note.slice(0, 500) });
        }
      }

      for (const target of targets) {
        const textarea = target.card.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder="Provide specific feedback..."]',
        );
        if (!textarea) {
          continue;
        }

        setNativeValue(textarea, target.note);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
        applied += 1;
      }

      return { applied };
    },
    collectInputBoxesSnapshot(): InputSnapshot {
      const root = getReviewContainer() || document;
      const categories: InputSnapshot["categories"] = {};

      for (const category of Object.keys(RATING_PREFIX_BY_CATEGORY)) {
        const card = findCardByCategory(root, category);
        if (!card) {
          continue;
        }

        const textarea = card.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder="Provide specific feedback..."]',
        );
        categories[category] = {
          note: textarea?.value || "",
        };
      }

      const notes = Array.from(
        root.querySelectorAll<HTMLTextAreaElement>(
          'textarea[placeholder="Provide specific feedback..."]',
        ),
      ).map((element, index) => ({
        index,
        note: element.value || "",
      }));

      return { categories, notes };
    },
  };
}
