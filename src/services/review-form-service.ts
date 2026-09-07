import { ensureUiStyles, themeRoot, applyComponent } from '@nominy/babel-extension-frontend';
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

function getReviewContainer(requireWritable = false): HTMLElement | null {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    'textarea[placeholder="Provide specific feedback..."]' +
      (requireWritable ? ":not(:disabled):not([readonly])" : ""),
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
    ensureUiStyles();
    if (document.getElementById(MAGIC_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = MAGIC_STYLE_ID;
    style.textContent = `
      #${MAGIC_BUTTON_ID} { margin: 4px 0 4px 8px; }
      #${MAGIC_BUTTON_ID} .babel-review-magic-spinner { display: none; }
      #${MAGIC_BUTTON_ID}[data-state="loading"] .babel-review-magic-spinner { display: inline-block; }
      #${MAGIC_BUTTON_ID}[data-state="loading"] .babel-review-magic-icon { display: none; }
      #${TOAST_ID} { position: fixed; right: 18px; bottom: 18px; }
      #${TOAST_ID}.babel-toast-out { opacity: 0; transition: opacity 220ms ease; }
      .babel-toast-bar { display: none; }
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
  allowDocumentFallback = true,
): HTMLElement | null {
  const prefix = RATING_PREFIX_BY_CATEGORY[category];
  if (!prefix) {
    return null;
  }

  const selector = `#${CSS.escape(prefix)}-1`;
  const control =
    root.querySelector(selector) ||
    (allowDocumentFallback ? document.querySelector(selector) : null);
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

      const existing = document.getElementById(MAGIC_BUTTON_ID);
      const container = getReviewContainer(true);
      if (!container) {
        existing?.remove();
        return;
      }

      if (existing && container.contains(existing)) {
        return;
      }
      existing?.remove();

      const button = document.createElement("button");
      button.id = MAGIC_BUTTON_ID;
      themeRoot(button, 'orange');
      applyComponent(button, 'button', { variant: 'primary' });
      button.type = "button";
      button.dataset.state = "idle";
      button.innerHTML = `
        <span class="babel-review-magic-icon">\u{1FA84}</span>
        <span class="babel-review-magic-spinner bui-spinner"></span>
        <span class="babel-review-magic-label">Magic Review</span>
      `;
      button.addEventListener("click", () => {
        if (!getReviewContainer(true)?.contains(button)) {
          button.remove();
          return;
        }
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
      if (!getReviewContainer(true)?.contains(button)) {
        button.remove();
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
      themeRoot(holder, 'orange');
      applyComponent(holder, 'toast', { tone: isError ? 'danger' : 'success' });
      holder.setAttribute('role', isError ? 'alert' : 'status');
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
      const root = getReviewContainer(true);
      if (!root) {
        return { applied: 0 };
      }
      let applied = 0;
      const targets: Array<{ note: string; card: HTMLElement }> = [];

      for (const item of feedback) {
        const category = item?.category?.trim();
        const note = item?.note || "";
        if (!category || !note) {
          continue;
        }

        const card = findCardByCategory(root, category, false);
        if (card) {
          targets.push({ card, note: note.slice(0, 500) });
        }
      }

      for (const target of targets) {
        const textarea = target.card.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder="Provide specific feedback..."]',
        );
        if (
          !textarea ||
          !root.contains(textarea) ||
          textarea.disabled ||
          textarea.readOnly ||
          textarea.matches(":disabled")
        ) {
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
