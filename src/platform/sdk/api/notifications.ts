// SPDX-License-Identifier: AGPL-3.0-only
import { getDataSource } from '../../../api/source';
import type { AppNotificationMessage } from '../../../api/notifications';
export async function sendNotification(app: string, message: AppNotificationMessage) {
  const result = await getDataSource().sendNotification(app, message);
  window.dispatchEvent(new Event('lumo:notifications-changed'));
  return result;
}
