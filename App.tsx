
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { BusinessCard, AppView, GoogleUser, SyncStatus } from './types';
import { LOCAL_STORAGE_KEY } from './constants';
import useLocalStorage from './hooks/useLocalStorage';
import { extractTextFromImage, structureText } from './services/geminiService';
import * as GoogleApiService from './services/googleApiService';
import * as fileService from './services/fileService';
import CardList from './components/CardList';
import CardScanner from './components/CardScanner';
import CardForm from './components/CardForm';
import ConfirmationDialog from './components/ConfirmationDialog';
import InstructionsModal from './components/InstructionsModal';
import Icon from './components/Icon';
import { GOOGLE_CLIENT_ID } from './config';

declare var gapi: any;

const IS_CONFIG_ERROR = GOOGLE_CLIENT_ID === 'PLACEHOLDER_ENTER_YOUR_CLIENT_ID_HERE';

const ConfigErrorBanner = () => (
    <div className="fixed top-0 left-0 right-0 bg-yellow-500 text-black text-center p-3 font-bold flex items-center justify-center gap-2 z-[100] shadow-lg animate-fade-in-down">
        <Icon name="exclamation-triangle" className="h-6 w-6" />
        <span>Google 雲端同步功能未設定。請按 F12 查看主控台說明以完成設定。</span>
    </div>
);


function App() {
  const [localCards, setLocalCards] = useLocalStorage<BusinessCard[]>(LOCAL_STORAGE_KEY, []);
  const [cloudCards, setCloudCards] = useState<BusinessCard[]>([]);
  
  const [currentView, setCurrentView] = useState<AppView>(AppView.LIST);
  const [notification, setNotification] = useState<{type: 'error' | 'success', message: string} | null>(null);
  const [editingCard, setEditingCard] = useState<BusinessCard | null>(null);
  
  // Dialog states
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showMigrationConfirm, setShowMigrationConfirm] = useState(false);
  
  const [jsonToRestore, setJsonToRestore] = useState<BusinessCard[] | null>(null);
  const excelFileInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  // Cloud Sync State
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [isGapiReady, setIsGapiReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(SyncStatus.UNINITIALIZED);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);

  const isCloudMode = !!googleUser;
  // Always use localCards as the single responsive source of truth for seamless offline/online transitions.
  const cards = localCards;
  const setCards = setLocalCards;

  // --- GOOGLE API & AUTH ---
  const showNotification = (type: 'error' | 'success', message: string) => {
    setNotification({ type, message });
  };

  const handleAuthCallback = useCallback(async (tokenResponse: any) => {
    if (tokenResponse.error) {
        // 'suppressed_by_user' is the normalized error for a failed silent sign-in attempt.
        // We handle it gracefully by not showing an error and letting the user log in manually.
        const isSilentSignInFailure = tokenResponse.error === 'suppressed_by_user';
                                      
        if (isSilentSignInFailure && syncStatus === SyncStatus.UNINITIALIZED) {
            setSyncStatus(SyncStatus.LOCAL); // Silently transition to local mode
            return;
        }

        let errorMessage = `登入失敗: ${tokenResponse.error_description || tokenResponse.error}.`;
        if (tokenResponse.error === 'invalid_request' || tokenResponse.error === 'unauthorized_client') {
            errorMessage = `登入授權失敗。這通常是 Google Cloud Console 中的 OAuth 設定有誤所導致。請確認：「已授權的 JavaScript 來源」已正確設定為您應用程式的網址 (${window.location.origin})。`;
        } else if (tokenResponse.error === 'access_denied' || tokenResponse.error === 'popup_closed_by_user') {
            errorMessage = '登入已取消或被使用者拒絕。';
        }
        showNotification('error', errorMessage);
        setSyncStatus(SyncStatus.ERROR);
        return;
    }
    try {
        setSyncStatus(SyncStatus.SYNCING);
        gapi.client.setToken(tokenResponse); // Explicitly set token for GAPI

        const userInfo = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        })).json();

        setGoogleUser({ name: userInfo.name, email: userInfo.email, picture: userInfo.picture });
        showNotification('success', `歡迎，${userInfo.name || userInfo.email}！`);
        
        // On login, just prepare the cloud storage but don't download anything.
        // The user will trigger the first sync manually.
        setCloudCards([]); 
        const { spreadsheetId: cloudSheetId } = await GoogleApiService.prepareCloudStorage();
        setSpreadsheetId(cloudSheetId);
        setSyncStatus(SyncStatus.READY_TO_SYNC);

        // Save token and info into localStorage for persistent session
        const expiresAt = Date.now() + (parseInt(tokenResponse.expires_in, 10) || 3600) * 1000;
        const authData = {
            tokenResponse,
            user: { name: userInfo.name, email: userInfo.email, picture: userInfo.picture },
            spreadsheetId: cloudSheetId,
            expiresAt
        };
        localStorage.setItem('KEEPER_GOOGLE_AUTH', JSON.stringify(authData));

    } catch (e: any) {
        showNotification('error', `雲端同步時發生錯誤: ${e.message}`);
        setSyncStatus(SyncStatus.ERROR);
        GoogleApiService.signOut();
        setGoogleUser(null);
        localStorage.removeItem('KEEPER_GOOGLE_AUTH');
    }
  }, [syncStatus]);

  // Use a ref to hold the latest callback. This prevents the initialization
  // useEffect from re-running when the callback identity changes due to its dependencies.
  const authCallbackRef = useRef(handleAuthCallback);
  useEffect(() => {
    authCallbackRef.current = handleAuthCallback;
  }, [handleAuthCallback]);

  // Effect for Google service initialization. This should only run ONCE.
  useEffect(() => {
    if (IS_CONFIG_ERROR) {
      console.group("👋 Google Cloud Sync - 設定提醒");
      console.error("⛔️ 設定錯誤：尚未設定 Google Client ID。");
      console.log("雲端同步功能目前已停用。若要啟用，請依照以下步驟操作：");
      console.log("1. 前往 `src/config.ts` 或 `config.ts` 檔案。");
      console.log("2. 依照檔案中的指示，填入您從 Google Cloud Console 取得的 Client ID。");
      if (window.location.origin && window.location.origin !== 'null') {
          console.log(
          "3. 請務必將此來源網址新增至您 Google Cloud憑證的「已授權的 JavaScript 來源」清單中:",
          window.location.origin
        );
      }
      console.groupEnd();
      return;
    }

    // A stable callback that delegates to the latest version in the ref.
    const stableAuthCallback = (tokenResponse: any) => {
      authCallbackRef.current(tokenResponse);
    };

    GoogleApiService.loadGapi(async () => {
        GoogleApiService.initGis(stableAuthCallback);
        setIsGapiReady(true);
        
        // Attempt to restore session from localStorage if valid
        const storedAuthStr = localStorage.getItem('KEEPER_GOOGLE_AUTH');
        if (storedAuthStr) {
            try {
                const storedAuth = JSON.parse(storedAuthStr);
                if (storedAuth && storedAuth.expiresAt > Date.now()) {
                    setSyncStatus(SyncStatus.SYNCING);
                    gapi.client.setToken(storedAuth.tokenResponse);
                    setGoogleUser(storedAuth.user);
                    setSpreadsheetId(storedAuth.spreadsheetId);
                    setSyncStatus(SyncStatus.READY_TO_SYNC);
                    
                    return;
                }
            } catch (err) {
                console.error("Failed to restore Google session:", err);
            }
            localStorage.removeItem('KEEPER_GOOGLE_AUTH');
        }
        
        setSyncStatus(SyncStatus.LOCAL);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // <-- Empty dependency array ensures this effect runs only once on mount.

  // Migration confirm is no longer needed since manual sync merges local cards implicitly.


  const handleGoogleLogin = () => {
    if (IS_CONFIG_ERROR) {
      showNotification('error', "Google 雲端同步功能未設定。請參考主控台說明。");
      return;
    }
    if (isGapiReady) {
      GoogleApiService.signInWithPopup();
    } else {
      showNotification('error', "Google 服務尚未準備就緒，請稍後再試。");
    }
  };

  const handleGoogleLogout = () => {
    GoogleApiService.signOut();
    setGoogleUser(null);
    setCloudCards([]);
    setSpreadsheetId(null);
    setSyncStatus(SyncStatus.LOCAL);
    localStorage.removeItem('KEEPER_GOOGLE_AUTH');
    showNotification('success', '您已登出，現在使用本機儲存。');
  };
  
  const handleForceSync = async () => {
    if (!isCloudMode) {
        showNotification('error', "請先登入 Google 帳號以進行雲端同步。");
        return;
    }
    setSyncStatus(SyncStatus.SYNCING);
    showNotification('success', '正在進行雲端雙向同步...');
    try {
        // 1. Delete records on Cloud Sheets that have been requested by user deletion log
        const deletedLogStr = localStorage.getItem('KEEPER_DELETED_LOG') || '[]';
        const deletedLog: string[] = JSON.parse(deletedLogStr);
        if (deletedLog.length > 0) {
            for (const idToDel of deletedLog) {
                try {
                    await GoogleApiService.deleteCardFromSheet(idToDel);
                } catch (delErr) {
                    console.error(`Deletion of ${idToDel} failed on Cloud:`, delErr);
                }
            }
            localStorage.setItem('KEEPER_DELETED_LOG', '[]');
        }

        // 2. Fetch the current records from Google Sheets (lightweight JSON only)
        const { cards: cloudData, spreadsheetId: cloudSheetId } = await GoogleApiService.getCloudCardsLight();
        setSpreadsheetId(cloudSheetId);

        // 3. Multi-directional merge
        const mergedCards = [...localCards];

        // Ensure we upload any local additions and updates to Sheets & Drive
        for (let i = 0; i < mergedCards.length; i++) {
            const localCard = mergedCards[i];
            
            // Check if this card exists on the cloud
            const cloudMatch = cloudData.find(c => c.id === localCard.id);
            
            if (!cloudMatch) {
                let driveId = localCard.imageDriveId;
                if (!driveId && localCard.imageBase64) {
                    driveId = await GoogleApiService.uploadImageToDrive(localCard.imageBase64, localCard.id);
                }
                const updatedLocalCard = { ...localCard, imageDriveId: driveId };
                mergedCards[i] = updatedLocalCard;

                const { imageBase64, ...cardForSheet } = updatedLocalCard;
                await GoogleApiService.addCardsToSheet([cardForSheet]);
            } else {
                if (localCard.timestamp > cloudMatch.timestamp) {
                    let driveId = localCard.imageDriveId;
                    if (!driveId && localCard.imageBase64) {
                        driveId = await GoogleApiService.uploadImageToDrive(localCard.imageBase64, localCard.id);
                    }
                    const updatedLocalCard = { ...localCard, imageDriveId: driveId };
                    mergedCards[i] = updatedLocalCard;

                    const { imageBase64, ...cardForSheet } = updatedLocalCard;
                    await GoogleApiService.updateCardInSheet(cardForSheet);
                }
            }
        }

        // Import Cloud Cards that are not in Local
        for (const cloudCard of cloudData) {
            const localMatch = mergedCards.find(c => c.id === cloudCard.id);
            const wasDeletedByClient = deletedLog.includes(cloudCard.id);

            if (!localMatch && !wasDeletedByClient) {
                mergedCards.push(cloudCard);
            } else if (localMatch && cloudCard.timestamp > localMatch.timestamp) {
                const updatedLocal: BusinessCard = {
                    ...localMatch,
                    ...cloudCard,
                    imageBase64: cloudCard.imageDriveId === localMatch.imageDriveId ? localMatch.imageBase64 : undefined,
                };
                const idx = mergedCards.findIndex(c => c.id === cloudCard.id);
                if (idx !== -1) mergedCards[idx] = updatedLocal;
            }
        }

        setLocalCards(mergedCards);
        setSyncStatus(SyncStatus.SYNCED);
        showNotification('success', '同步成功！');
    } catch (e: any) {
        setSyncStatus(SyncStatus.ERROR);
        showNotification('error', `同步失敗: ${e.message}`);
    }
  };

  const handleMigrateToCloud = async () => {
    setShowMigrationConfirm(false);
    setSyncStatus(SyncStatus.SYNCING);
    showNotification('success', '正在將本機資料上傳至雲端...');
    try {
        const cardsForSheet: Omit<BusinessCard, 'imageBase64'>[] = [];
        const cardsForState: BusinessCard[] = [];

        for (const card of localCards) {
            const cardWithDriveId = { ...card };
            if (card.imageBase64) {
                const driveLink = await GoogleApiService.uploadImageToDrive(card.imageBase64, card.id);
                cardWithDriveId.imageDriveId = driveLink;
            }
            cardsForState.push(cardWithDriveId);

            const { imageBase64, ...rest } = cardWithDriveId;
            cardsForSheet.push(rest);
        }
        
        await GoogleApiService.addCardsToSheet(cardsForSheet);
        setCloudCards(prev => [...prev, ...cardsForState]);
        setLocalCards([]);
        setSyncStatus(SyncStatus.SYNCED);
        showNotification('success', '備份已成功遷移至雲端！');
    } catch (e: any) {
        setSyncStatus(SyncStatus.ERROR);
        showNotification('error', `遷移失敗: ${e.message}`);
    }
  };

  const handleScanNew = () => {
    setCurrentView(AppView.SCANNING);
  };

  const handleFinishScan = () => {
    setCurrentView(AppView.LIST);
  };

  const processSingleCard = useCallback(async (placeholderCard: BusinessCard) => {
    try {
        if (!placeholderCard.imageBase64) throw new Error("影像資料遺失。");
        
        const rawText = await extractTextFromImage(placeholderCard.imageBase64);
        const structuredData = await structureText(rawText || '');

        if (!structuredData) throw new Error("AI 無法解析名片資訊，請檢查照片清晰度。");

        const processedCard: BusinessCard = {
            ...placeholderCard,
            ...structuredData,
            isProcessing: false,
        };
        
        setLocalCards(prev => prev.map(c => c.id === processedCard.id ? processedCard : c));

    } catch (e: any) {
        console.error(`處理卡片 ${placeholderCard.id} 時發生錯誤:`, e);
        
        let errorMessage = e.message || '請稍後再試。';
        if (typeof errorMessage === 'string' && (errorMessage.includes('Proxying failed') || errorMessage.includes('API key not valid') || errorMessage.includes('Request payload size exceeds the limit'))) {
            errorMessage = '無法連接至 AI 服務。\n這通常是 API 金鑰的「網站來源」限制設定有誤、網路連線問題、或照片檔案過大所致。';
        } else if (typeof errorMessage === 'string' && errorMessage.includes('400')) {
             errorMessage = 'AI 服務請求格式錯誤。\n可能是圖片品質不佳或損毀，請嘗試重新拍攝。';
        } else if (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('quota')) {
            errorMessage = 'AI 服務用量已達上限，請檢查您的 Google Cloud 帳戶。';
        }

        const errorCard: BusinessCard = {
            ...placeholderCard,
            isProcessing: false,
            isError: true,
            name: '辨識失敗',
            company: errorMessage,
        };
        setLocalCards(prev => prev.map(c => c.id === placeholderCard.id ? errorCard : c));
    }
  }, [setLocalCards]);

  const handleCaptureAndProcess = useCallback((base64Image: string) => {
    const placeholderCard: BusinessCard = {
      id: crypto.randomUUID(),
      name: '正在辨識中...',
      company: '請稍候',
      title: '',
      phone: '',
      email: '',
      address: '',
      notes: '',
      rawText: '',
      timestamp: Date.now(),
      imageBase64: base64Image,
      isProcessing: true,
    };
  
    // Add to list immediately, new cards at the top
    setCards(prev => [placeholderCard, ...prev]);
    
    // Start processing in the background
    processSingleCard(placeholderCard);
  
  }, [setCards, processSingleCard]);


  const handleDeleteCard = async (id: string) => {
    if (isCloudMode) {
        try {
            const deletedLogStr = localStorage.getItem('KEEPER_DELETED_LOG') || '[]';
            const deletedLog: string[] = JSON.parse(deletedLogStr);
            if (!deletedLog.includes(id)) {
                deletedLog.push(id);
                localStorage.setItem('KEEPER_DELETED_LOG', JSON.stringify(deletedLog));
            }
        } catch (e) {
            console.error("Failed to append to deletion log:", e);
        }
    }
    setLocalCards(prev => prev.filter(card => card.id !== id));
    showNotification('success', '名片已刪除。');
  };
  
  const handleStartEdit = (cardToEdit: BusinessCard) => {
    // Prevent editing a card that failed processing
    if (cardToEdit.isError) return;
    setEditingCard(cardToEdit);
    setCurrentView(AppView.EDITING);
  };

  const handleUpdateCard = async (updatedCard: BusinessCard) => {
    const updatedWithTimestamp = {
        ...updatedCard,
        timestamp: Date.now()
    };
    setLocalCards(prev => prev.map(c => c.id === updatedWithTimestamp.id ? updatedWithTimestamp : c));
    setEditingCard(null);
    setCurrentView(AppView.LIST);
    showNotification('success', '名片已儲存！');
  };

  const handleCancelEdit = () => {
    setEditingCard(null);
    setCurrentView(AppView.LIST);
  };

  const handleLazyImageLoaded = useCallback((cardId: string, base64: string) => {
    setLocalCards(prev => prev.map(c => c.id === cardId ? { ...c, imageBase64: base64 } : c));
  }, [setLocalCards]);
  
  const handleImportExcelClick = () => excelFileInputRef.current?.click();
  
  const handleExcelFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        const newCards = await fileService.importFromExcel(file, cards);
        if (newCards.length > 0) {
            setLocalCards(prev => [...newCards, ...prev]);
            showNotification('success', `${newCards.length} 張新名片已成功匯入！本機已儲存。`);
        } else {
            showNotification('success', '沒有新的名片可匯入。');
        }
    } catch (error: any) {
        showNotification('error', `匯入失败：${error.message}`);
    } finally {
        if(event.target) event.target.value = '';
    }
  };

  const handleRestoreJsonClick = () => {
    if (isCloudMode) return;
    jsonFileInputRef.current?.click();
  };
  
  const handleJsonFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || isCloudMode) return;
    try {
        const parsedData = await fileService.importFromJson(file);
        setJsonToRestore(parsedData);
        setShowRestoreConfirm(true);
    } catch (error: any) {
        showNotification('error', `還原失敗：${error.message}`);
    } finally {
        if(event.target) event.target.value = '';
    }
  };

  const executeRestore = () => {
    if (jsonToRestore) {
        setCards(jsonToRestore);
        showNotification('success', '資料已從備份還原！');
    }
    setShowRestoreConfirm(false);
    setJsonToRestore(null);
  };

  const handleRequestClearAll = () => (cards.length > 0) && setShowClearConfirm(true);
  
  const executeClearAll = async () => {
    if (isCloudMode) {
        setSyncStatus(SyncStatus.SYNCING);
        showNotification('success', '正在清除雲端資料...');
        try {
            // This is slow, but safe. Delete one by one.
            for (const card of cards) {
                await GoogleApiService.deleteCardFromSheet(card.id);
            }
            setSyncStatus(SyncStatus.SYNCED);
        } catch (e: any) {
            setSyncStatus(SyncStatus.ERROR);
            showNotification('error', `清除雲端資料失敗: ${e.message}`);
        }
    }
    setCards([]);
    setShowClearConfirm(false);
    showNotification('success', '所有名片資料已被清除。');
  };

  const renderView = () => {
    switch (currentView) {
      case AppView.SCANNING:
        return <CardScanner onCaptureAndProcess={handleCaptureAndProcess} onFinish={handleFinishScan} isConfigError={IS_CONFIG_ERROR} />;
      case AppView.EDITING:
        return editingCard && <CardForm cardData={editingCard} onSave={handleUpdateCard} onCancel={handleCancelEdit} isConfigError={IS_CONFIG_ERROR} />;
      case AppView.LIST:
      default:
        return <CardList cards={cards} onScanNew={handleScanNew} onDeleteCard={handleDeleteCard} onEditCard={handleStartEdit} onExportExcel={() => fileService.exportToExcel(cards)} onImportExcel={handleImportExcelClick} onExportJson={() => fileService.exportToJson(cards)} onRestoreJson={handleRestoreJsonClick} onClearAll={handleRequestClearAll} onShowInstructions={() => setShowInstructions(true)} googleUser={googleUser} syncStatus={syncStatus} isGapiReady={isGapiReady} onGoogleLogin={handleGoogleLogin} onGoogleLogout={handleGoogleLogout} onForceSync={handleForceSync} spreadsheetId={spreadsheetId} onLazyImageLoaded={handleLazyImageLoaded} />;
    }
  };

  return (
    <div className="h-screen w-screen bg-gray-900 text-white font-sans overflow-hidden">
        {IS_CONFIG_ERROR && <ConfigErrorBanner />}
        <div className={`h-full w-full ${IS_CONFIG_ERROR && (currentView === AppView.LIST || currentView === AppView.EDITING) ? 'pt-12' : ''}`}>
          <input type="file" ref={excelFileInputRef} onChange={handleExcelFileImport} className="hidden" accept=".xlsx, .xls" />
          <input type="file" ref={jsonFileInputRef} onChange={handleJsonFileImport} className="hidden" accept=".json" />
          {notification && (
              <div className={`fixed top-4 left-1/2 -translate-x-1/2 px-4 py-3 max-w-[90%] rounded-lg shadow-lg z-50 animate-fade-in-down text-center ${notification.type === 'error' ? 'bg-red-800' : 'bg-green-600'} ${IS_CONFIG_ERROR ? 'mt-12' : ''}`}>
                  <p className="whitespace-pre-wrap">{notification.message}</p>
              </div>
          )}
          {renderView()}
          <ConfirmationDialog isOpen={showClearConfirm} onCancel={() => setShowClearConfirm(false)} onConfirm={executeClearAll} title="永久刪除所有資料" message="您確定要永久刪除所有名片資料嗎？此操作無法復原。在雲端模式下，這將會刪除您 Google Sheet 中的所有資料。" confirmButtonText="確定刪除" />
          <ConfirmationDialog isOpen={showRestoreConfirm} onCancel={() => { setShowRestoreConfirm(false); setJsonToRestore(null); }} onConfirm={executeRestore} title="從備份還原資料" message="這將會用備份檔案的內容覆蓋您目前所有的本機名片資料。確定要繼續嗎？" confirmButtonText="確定還原" />
          <ConfirmationDialog isOpen={showMigrationConfirm} onCancel={() => setShowMigrationConfirm(false)} onConfirm={handleMigrateToCloud} title="同步本機資料至雲端" message={`我們偵測到您有 ${localCards.length} 筆本機資料。要將它們上傳至您的 Google 雲端嗎？上傳後，本機資料將被清除以避免重複。`} confirmButtonText="是，開始上傳" />
          {showInstructions && <InstructionsModal onClose={() => setShowInstructions(false)} />}
        </div>
    </div>
  );
}

export default App;
