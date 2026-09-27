// SPDX-License-Identifier: AGPL-3.0-only
export interface TrashSelection { id: string; revision: string }
export interface TrashItem extends TrashSelection {
  name: string;
  originalPath: string;
  deletedAt: string;
  type: string;
  sizeBytes: number;
  canRestore: boolean;
}
