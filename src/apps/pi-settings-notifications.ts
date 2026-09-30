// SPDX-License-Identifier: AGPL-3.0-only
export function piSettingsSaved(waitingForIdle = false) {
  return waitingForIdle ? 'Saved. Applies when Pi is idle.' : 'Saved';
}
