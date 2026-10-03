// SPDX-License-Identifier: AGPL-3.0-only
export interface AppNotificationMessage { requestId: string; title: string; body: string }
export interface AppNotification extends AppNotificationMessage { id: string; appId: string; appName: string; createdAt: number; read: boolean; dismissed: boolean }
