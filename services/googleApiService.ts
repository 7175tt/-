

declare var gapi: any;
declare var google: any;

import { BusinessCard } from '../types';
import { GOOGLE_CLIENT_ID, SPREADSHEET_NAME, CARD_SHEET_NAME, IMAGE_FOLDER_NAME } from '../config';

const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest", "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";

let tokenClient: any = null;
let spreadsheetId: string | null = null;
let imageFolderId: string | null = null;

// 'rawText' is removed from this list and will no longer be saved to Google Sheets.
const cardHeaders = ['id', 'name', 'company', 'title', 'phone', 'email', 'address', 'notes', 'timestamp', 'imageDriveId'];

/**
 * Loads the GAPI client and initializes it. Assumes gapi global is already available.
 */
export function loadGapi(callback: () => void) {
  try {
    gapi.load('client', () => {
      gapi.client.init({
        discoveryDocs: DISCOVERY_DOCS,
      }).then(() => {
        callback();
      }).catch((err: any) => {
        console.error("Error initializing gapi client", err);
      });
    });
  } catch (e) {
    console.error("GAPI script not loaded yet.", e);
  }
}

/**
 * Initializes the GIS client. Assumes google global is already available.
 */
export function initGis(callback: (tokenResponse: any) => void) {
    const handleError = (error: any) => {
        // This callback handles non-OAuth errors, such as browser restrictions
        // that prevent the silent sign-in from completing. It allows the app
        // to gracefully handle the failure of a silent sign-in attempt.
        console.warn("GIS silent sign-in error:", error);

        const silentSignInErrorTypes = [
            'popup_closed',
            'popup_failed_to_open',
            'idpiframe_initialization_failed',
        ];
        
        if (silentSignInErrorTypes.includes(error.type)) {
             // Normalize various silent sign-in failures into a single, manageable error type.
             callback({ 
                 error: 'suppressed_by_user', 
                 error_description: 'Silent sign-in could not complete, likely due to browser privacy settings.' 
             });
        } else {
            // Pass through any other unexpected errors.
            callback({ 
                error: error.type || 'gis_error', 
                error_description: error.message || 'An unknown Google Sign-In error occurred.' 
            });
        }
    };

    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: callback,
            error_callback: handleError,
        });
    } catch (e) {
        console.error("Google Sign-In script not loaded yet.", e);
    }
}

/**
 * Triggers the Google Sign-In flow with a popup for user interaction.
 * Should be called from a user gesture (e.g., a button click).
 */
export function signInWithPopup() {
  if (!tokenClient) {
    console.error("GIS not initialized. Cannot sign in.");
    return;
  }
  // An empty config object prompts the user to sign in and grant consent if needed.
  tokenClient.requestAccessToken({}); 
}

/**
 * Attempts to sign in the user silently without showing a popup.
 * If the user is not signed in or needs to grant consent, this will fail
 * and the callback will be invoked with an error, which should be handled gracefully.
 */
export function signInSilently() {
  if (!tokenClient) {
    console.error("GIS not initialized. Cannot perform silent sign-in.");
    return;
  }
  // 'prompt: 'none'' tells the client not to display any UI.
  tokenClient.requestAccessToken({prompt: 'none'});
}

/**
 * Signs out the current user by clearing local session data.
 * The Google token is NOT revoked, allowing for a seamless sign-in experience next time.
 */
export function signOut() {
  const token = gapi.client.getToken();
  if (token) {
    // We do NOT revoke the token here, to allow for a "remember me" functionality.
    // Revoking would force the user to re-consent every time they log in.
    // google.accounts.oauth2.revoke(token.access_token, () => {});
    gapi.client.setToken(null);
    spreadsheetId = null;
    imageFolderId = null;
  }
}

/**
 * Ensures spreadsheet and image folder IDs are initialized before use.
 * This makes cloud operations more robust.
 */
async function initializeCloudStorage() {
    if (!spreadsheetId) {
        spreadsheetId = await findOrCreateSpreadsheet();
    }
    if (!imageFolderId) {
        imageFolderId = await findOrCreateImageFolder();
    }
}

/**
 * Prepares cloud storage by finding or creating necessary files/folders,
 * but does NOT download card data.
 * @returns The ID of the spreadsheet.
 */
export async function prepareCloudStorage(): Promise<{ spreadsheetId: string | null }> {
    await initializeCloudStorage();
    return { spreadsheetId };
}

async function findOrCreateSpreadsheet(): Promise<string> {
    const response = await gapi.client.drive.files.list({
        q: `mimeType='application/vnd.google-apps.spreadsheet' and name='${SPREADSHEET_NAME}' and trashed=false`,
        fields: 'files(id, name)',
    });
    if (response.result.files && response.result.files.length > 0) {
        return response.result.files[0].id!;
    } else {
        const spreadsheet = await gapi.client.sheets.spreadsheets.create({
            properties: { title: SPREADSHEET_NAME },
            sheets: [{ properties: { title: CARD_SHEET_NAME } }]
        });
        const newSheetId = spreadsheet.result.spreadsheetId!;
        // Add headers to the new sheet
        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: newSheetId,
            range: `${CARD_SHEET_NAME}!A1`,
            valueInputOption: 'RAW',
            resource: { values: [cardHeaders] },
        });
        return newSheetId;
    }
}

async function findOrCreateImageFolder(): Promise<string> {
    const response = await gapi.client.drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${IMAGE_FOLDER_NAME}' and trashed=false`,
        fields: 'files(id, name)',
    });

    if (response.result.files && response.result.files.length > 0) {
        return response.result.files[0].id!;
    } else {
        const fileMetadata = {
            'name': IMAGE_FOLDER_NAME,
            'mimeType': 'application/vnd.google-apps.folder'
        };
        const folder = await gapi.client.drive.files.create({
            resource: fileMetadata,
            fields: 'id'
        });
        return folder.result.id!;
    }
}

/**
 * Fetches an image from Google Drive using the robust Fetch API and returns it as a Base64 string.
 * @param fileId The ID of the file in Google Drive.
 */
export async function getImageAsBase64(fileId: string): Promise<string> {
    if (!fileId) {
        throw new Error('No file ID provided to getImageAsBase64.');
    }

    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: {
            'Authorization': `Bearer ${gapi.client.getToken().access_token}`,
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Google Drive API Error:", errorText);
        throw new Error(`Failed to download image from Drive (File ID: ${fileId}): ${response.statusText}`);
    }

    const blob = await response.blob();

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            if (!result) {
                return reject(new Error('FileReader returned null result.'));
            }
            const base64Data = result.split(',')[1];
            resolve(base64Data);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
    });
}

export async function getCloudCardsLight(): Promise<{ cards: BusinessCard[], spreadsheetId: string }> {
    await initializeCloudStorage();
    
    // Dynamically calculate the range based on the number of headers.
    const rangeEndColumn = String.fromCharCode(65 + cardHeaders.length - 1);
    const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${CARD_SHEET_NAME}!A2:${rangeEndColumn}`,
    });

    const values = response.result.values || [];
    const cards: BusinessCard[] = values.map(row => {
        const card: any = { rawText: '' }; // Default rawText since it's not in the sheet.
        cardHeaders.forEach((header, index) => {
            card[header] = row[index];
        });
        // Convert timestamp back to number
        card.timestamp = parseInt(card.timestamp, 10) || Date.now();
        return card as BusinessCard;
    });

    return { cards, spreadsheetId: spreadsheetId! };
}

export async function getCloudCards(): Promise<{ cards: BusinessCard[], spreadsheetId: string }> {
    await initializeCloudStorage();
    
    // Dynamically calculate the range based on the number of headers.
    const rangeEndColumn = String.fromCharCode(65 + cardHeaders.length - 1);
    const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${CARD_SHEET_NAME}!A2:${rangeEndColumn}`,
    });

    const values = response.result.values || [];
    const cards: BusinessCard[] = values.map(row => {
        const card: any = { rawText: '' }; // Default rawText since it's not in the sheet.
        cardHeaders.forEach((header, index) => {
            card[header] = row[index];
        });
        // Convert timestamp back to number
        card.timestamp = parseInt(card.timestamp, 10) || Date.now();
        return card as BusinessCard;
    });

    // Fetch images in parallel for cards that have a drive ID
    const imageFetchPromises = cards
        .filter(card => card.imageDriveId)
        .map(async (card) => {
            try {
                const base64Data = await getImageAsBase64(card.imageDriveId!);
                card.imageBase64 = base64Data;
            } catch (e) {
                console.error(`Failed to fetch image for card ${card.id} (File ID: ${card.imageDriveId}):`, e);
                // If fetching fails, the card won't have an image.
                // This is an acceptable fallback to prevent app crash.
            }
        });

    await Promise.all(imageFetchPromises);
    
    return { cards, spreadsheetId: spreadsheetId! };
}

function base64ToBlob(base64: string, contentType = '', sliceSize = 512) {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, {type: contentType});
}


export async function uploadImageToDrive(base64Image: string, cardId: string): Promise<string> {
    await initializeCloudStorage();
    
    const blob = base64ToBlob(base64Image, 'image/jpeg');
    const fileMetadata = {
        name: `${cardId}.jpg`,
        parents: [imageFolderId]
    };
    
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }));
    form.append('file', blob);

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: new Headers({ 'Authorization': `Bearer ${gapi.client.getToken().access_token}` }),
        body: form,
    });
    
    const result = await response.json();
    if (result.error) throw new Error(result.error.message);

    const fileId = result.id;
    if (!fileId) {
        throw new Error('Image upload to Drive succeeded but did not return a file ID.');
    }

    // Make file publicly readable so it can be downloaded. The user must be authenticated.
    await gapi.client.drive.permissions.create({
        fileId: fileId,
        resource: {
            role: 'reader',
            type: 'anyone'
        }
    });
    
    // Return only the file ID, which is the most stable reference.
    return fileId;
}

export async function deleteCardImage(cardId: string): Promise<void> {
    await initializeCloudStorage();
    
    try {
        const response = await gapi.client.drive.files.list({
            q: `name='${cardId}.jpg' and '${imageFolderId}' in parents and trashed=false`,
            fields: 'files(id)',
        });
        
        if (response.result.files && response.result.files.length > 0) {
            const fileId = response.result.files[0].id;
            if (fileId) {
                await gapi.client.drive.files.delete({ fileId });
            }
        } else {
            console.warn(`Image for card ${cardId} not found in Drive, skipping deletion.`);
        }
    } catch (e: any) {
        // Do not rethrow, as the main operation (e.g., sheet row deletion) should still proceed.
        console.error(`Failed to delete image for card ${cardId} from Drive:`, e);
    }
}


export async function addCardsToSheet(cards: Omit<BusinessCard, 'imageBase64'>[]): Promise<void> {
    await initializeCloudStorage();

    const values = cards.map(card => cardHeaders.map(header => (card as any)[header] ?? ''));

    await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${CARD_SHEET_NAME}!A1`,
        valueInputOption: 'RAW',
        resource: { values },
    });
}


export async function updateCardInSheet(card: Omit<BusinessCard, 'imageBase64'>): Promise<void> {
    await initializeCloudStorage();

    const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId!,
        range: `${CARD_SHEET_NAME}!A:A`,
    });

    const rowNumber = response.result.values?.findIndex(row => row[0] === card.id);
    if (rowNumber === undefined || rowNumber === -1) {
        // If not found, just add it as a new card
        console.warn("Card not found for updating, adding as new card.");
        await addCardsToSheet([card]);
        return;
    }
    
    const targetRowInSheet = rowNumber + 2; // +1 for 0-based findIndex, +1 because data starts at row 2
    const values = [cardHeaders.map(header => (card as any)[header] ?? '')];
    
    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${CARD_SHEET_NAME}!A${targetRowInSheet}`,
        valueInputOption: 'RAW',
        resource: { values },
    });
}


export async function deleteCardFromSheet(cardId: string): Promise<void> {
    // Attempt to delete the associated image from Drive. No need to await.
    deleteCardImage(cardId).catch(err => console.error("Could not delete card image:", err));

    await initializeCloudStorage();

    const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${CARD_SHEET_NAME}!A:A`,
    });

    const allIds = response.result.values;
    if (!allIds) {
        console.warn("Sheet seems empty, nothing to delete.");
        return;
    }
    
    const rowIndex = allIds.findIndex(row => row[0] === cardId);
    if (rowIndex === -1) {
        console.warn("Card not found in sheet for deletion.");
        return;
    }
    
    const sheetId = await getSheetIdByName(CARD_SHEET_NAME);
    const actualRowIndex = rowIndex + 1; // +1 because our get range starts at A2.

    await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
            requests: [{
                deleteDimension: {
                    range: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex: actualRowIndex,
                        endIndex: actualRowIndex + 1
                    }
                }
            }]
        }
    });
}

// Helper to get the numeric sheet ID needed for some operations
async function getSheetIdByName(name: string): Promise<number> {
    if (!spreadsheetId) throw new Error("Spreadsheet not initialized.");
    const response = await gapi.client.sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties',
    });
    const sheet = response.result.sheets?.find(s => s.properties?.title === name);
    if (!sheet || sheet.properties?.sheetId === undefined || sheet.properties.sheetId === null) {
        throw new Error(`Sheet with name "${name}" not found.`);
    }
    return sheet.properties.sheetId;
}
