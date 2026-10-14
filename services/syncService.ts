import type { BusinessCard } from '../types';
import type { CardStoreState } from './cardStorage';

export interface CloudApi {
  getCloudCardsLight(): Promise<{ cards: BusinessCard[]; spreadsheetId: string }>;
  uploadImageToDrive(image: string, id: string): Promise<string>;
  updateCardInSheet(card: BusinessCard): Promise<void>;
  deleteCardFromSheet(id: string): Promise<void>;
}
export interface SyncResult {
  cards: BusinessCard[];
  spreadsheetId: string;
  deleted: string[];
  removed: string[]; // Previously synced cards that were deleted on another device.
}
export const belongsToAccount = (card: BusinessCard, account: string) => !card.cloudAccount || card.cloudAccount === account;

/** Remote operations use a stable snapshot; applySyncResult protects newer local edits. */
export async function synchronizeCards(
  snapshot: CardStoreState, account: string, api: CloudApi, isCurrent = () => true,
): Promise<SyncResult> {
  const check = () => { if (!isCurrent()) throw new Error('同步已取消，資料仍保留在本機。'); };
  const tombstones = snapshot.deletions.filter(d => d.account === account);
  for (const deletion of tombstones) {
    check();
    await api.deleteCardFromSheet(deletion.id);
  }
  check();
  const remote = await api.getCloudCardsLight();
  const deleted = new Set(tombstones.map(d => d.id));
  const result = new Map(remote.cards.filter(c => !deleted.has(c.id)).map(c => [c.id, { ...c, cloudAccount: account, lastSyncedAt: c.timestamp, lastSyncedSheetId: remote.spreadsheetId }]));
  const removed: string[] = [];
  for (const local of snapshot.cards.filter(c => belongsToAccount(c, account))) {
    check();
    if (deleted.has(local.id)) continue;
    if (local.isProcessing || local.isError) {
      // Unfinished scans stay local, including when an older copy exists remotely.
      result.delete(local.id);
      continue;
    }
    const cloud = result.get(local.id);
    // Only infer deletion in the same spreadsheet: a newly created database
    // must never erase the local collection. Unsent local
    // edits still win, so deleting on another device cannot silently discard them.
    if (!cloud && local.cloudAccount === account && Number.isFinite(local.lastSyncedAt) && local.lastSyncedSheetId === remote.spreadsheetId && local.timestamp === local.lastSyncedAt) {
      removed.push(local.id);
      continue;
    }
    if (cloud && cloud.timestamp > local.timestamp) continue;
    let card = { ...local, cloudAccount: account, lastSyncedAt: local.timestamp, lastSyncedSheetId: remote.spreadsheetId };
    if (!cloud || local.timestamp > cloud.timestamp) {
      // An unbound/imported Drive ID must never cross Google account boundaries.
      if (!local.cloudAccount) card.imageDriveId = undefined;
      // The other device may also have deleted the Drive photo. Recreate it
      // from the cached capture when preserving an unsent local edit.
      if (!cloud && Number.isFinite(local.lastSyncedAt) && card.imageBase64) card.imageDriveId = undefined;
      if (card.imageBase64 && !card.imageDriveId) {
        card.imageDriveId = await api.uploadImageToDrive(card.imageBase64, card.id);
      }
      check();
      await api.updateCardInSheet(card);
    } else {
      card.imageDriveId = cloud.imageDriveId;
    }
    result.set(card.id, card);
  }
  check();
  return { cards: [...result.values()], spreadsheetId: remote.spreadsheetId, deleted: [...deleted], removed };
}

export function applySyncResult(current: CardStoreState, snapshot: CardStoreState, result: SyncResult, account: string): CardStoreState {
  const snapshotById = new Map(snapshot.cards.map(c => [c.id, c]));
  const currentById = new Map(current.cards.map(c => [c.id, c]));
  const deleted = new Set(current.deletions.filter(d => d.account === account).map(d => d.id));
  for (const id of result.removed) {
    const now = currentById.get(id);
    const before = snapshotById.get(id);
    if (now && before && now.cloudAccount === account && !now.isProcessing && !now.isError
      && now.timestamp === before.timestamp && !deleted.has(id)) currentById.delete(id);
  }
  for (const incoming of result.cards) {
    const now = currentById.get(incoming.id);
    const before = snapshotById.get(incoming.id);
    if (deleted.has(incoming.id) || (before && !now)) continue;
    if (now && (!belongsToAccount(now, account) || now.isProcessing || now.isError)) continue;
    if (now && before && now.timestamp !== before.timestamp) continue;
    if (now && !before) continue;
    currentById.set(incoming.id, {
      ...incoming,
      imageBase64: incoming.imageBase64 ?? (now?.imageDriveId === incoming.imageDriveId ? now?.imageBase64 : undefined),
    });
  }
  const acknowledged = new Map(snapshot.deletions.filter(d => d.account === account && result.deleted.includes(d.id)).map(d => [d.id, d.deletedAt]));
  const next: CardStoreState = {
    cards: [...currentById.values()],
    deletions: current.deletions.filter(d => d.account !== account || acknowledged.get(d.id) !== d.deletedAt),
  };
  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
}
