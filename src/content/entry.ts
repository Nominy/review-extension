import { createReviewKernel } from '../core/kernel';
import { registerLifecycle } from '../core/lifecycle';

async function boot(): Promise<void> {
  if (window.__babelReviewKernelInstalled) {
    return;
  }

  window.__babelReviewKernelInstalled = true;
  const kernel = createReviewKernel();
  await kernel.start();
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
