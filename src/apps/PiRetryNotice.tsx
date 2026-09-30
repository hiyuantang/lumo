// SPDX-License-Identifier: AGPL-3.0-only
import type { PiRetry } from '../api/pi';
import { Disclosure } from '../shell/Disclosure';
import { IconRefresh } from '../shell/icons';

export function PiRetryNotice({ retry }: { retry: PiRetry }) {
  return <Disclosure className="pi-thinking pi-retry-notice" testId="pi-retry-notice" label={<span className="pi-step-label"><IconRefresh size={14}/><span>Attempt {retry.attempt} of {retry.maxAttempts}</span></span>}><p>{retry.errorMessage || 'Temporary connection error.'}</p></Disclosure>;
}
