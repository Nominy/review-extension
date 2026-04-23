import { registerDomLifecycle } from '@nominy/babel-babel-runtime';
import type { ReviewKernel } from './types';

export function registerLifecycle(kernel: ReviewKernel): void {
  registerDomLifecycle(() => kernel.ensureMagicButton());
}
