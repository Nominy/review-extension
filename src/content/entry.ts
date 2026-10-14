import { createReviewKernel } from '../core/kernel';
import type { ReviewKernel } from '../core/types';
import { registerDomLifecycle } from '@nominy/babel-babel-runtime';
import { registerGraderAddon } from '../services/grader-addon-service';

async function boot(): Promise<void> {
  if (window.__babelReviewKernelInstalled) {
    return;
  }

  window.__babelReviewKernelInstalled = true;
  const kernel: ReviewKernel = createReviewKernel(registerGraderAddon(() => kernel.getGradingSnapshot()));
  await kernel.start();
  registerDomLifecycle(() => kernel.ensureMagicButton());
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      void boot();
    },
    { once: true }
  );
} else {
  void boot();
}
