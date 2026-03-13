import type { ReviewKernel } from './types';

export function registerLifecycle(kernel: ReviewKernel): void {
  const observer = new MutationObserver(() => {
    kernel.ensureMagicButton();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  kernel.ensureMagicButton();
}
