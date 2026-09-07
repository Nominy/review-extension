import { createReviewKernel } from '../core/kernel';
import { registerLifecycle } from '../core/lifecycle';
import { registerGraderAddon } from '../services/grader-addon-service';

async function boot(): Promise<void> {
  if (window.__babelReviewKernelInstalled) {
    return;
  }

  window.__babelReviewKernelInstalled = true;
  const kernel = createReviewKernel();
  await kernel.start();
  registerGraderAddon(kernel);
  registerLifecycle(kernel);
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
