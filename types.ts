
export interface BusinessCard {
  id: string;
  name: string;
  company: string;
  title: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  rawText: string;
  timestamp: number;
  imageBase64?: string; // For local/temp storage and runtime display.
  imageLocalId?: string; // Original photo in the device's separate IndexedDB photo store.
  imageDriveId?: string; // Google Drive File ID. NOT a full URL.
  isProcessing?: boolean;
  isError?: boolean;
  errorMessage?: string;
  needsReview?: boolean;
  cloudAccount?: string; // Prevent one Google account's cards being uploaded to another.
  lastSyncedAt?: number; // Last confirmed cloud version; detects deletions on another device.
  lastSyncedSheetId?: string;
}

export enum AppView {
  LIST,
  SCANNING,
  EDITING,
}

export interface ProcessingState {
  isProcessing: boolean;
  message: string;
}

export interface GoogleUser {
  name: string;
  email: string;
  picture: string;
}

export enum SyncStatus {
  UNINITIALIZED = 'UNINITIALIZED', // Not logged in or GAPI not ready
  READY_TO_SYNC = 'READY_TO_SYNC', // Logged in, ready for manual sync
  SYNCING = 'SYNCING', // Actively syncing data
  SYNCED = 'SYNCED', // Sync complete and successful
  ERROR = 'ERROR', // An error occurred during sync
  LOCAL = 'LOCAL', // Logged out, using local storage
}
