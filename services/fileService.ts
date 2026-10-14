
import { BusinessCard } from '../types';
import { MAX_BACKUP_BYTES, MAX_IMPORT_CARDS, parseCardBackup } from './backupValidation';
import { decodeContactMetadata, encodeContactMetadata, parseLabels, readContactMetadata } from './contactMetadata';
export { downloadVCard as exportToVCard } from './contactExport';

/**
 * Exports an array of business cards to an Excel .xlsx file.
 * @param cards The array of business cards to export.
 */
export const exportToExcel = async (cards: BusinessCard[]): Promise<void> => {
    if (cards.length === 0) return;
    const XLSX = await import('xlsx');
    const headers = ['姓名', '公司', '職稱', '電話', 'Email', '地址', '備註', '建立時間', '辨識原文', '標籤', '認識場合', '人脈紀錄 JSON'];
    const data = cards.map(card => [
        card.name, card.company, card.title, card.phone, card.email, card.address, card.notes || '',
        new Date(card.timestamp).toISOString(), card.rawText || '',
        (card.tags || []).join('、'), (card.events || []).join('、'), encodeContactMetadata({ followUps: card.followUps, interactions: card.interactions }),
    ]);
    if (data.some(row => row.some(value => value.length > 32_767))) {
        throw new Error('部分紀錄超過 Excel 單一儲存格的 32,767 字限制，請改用完整 JSON 備份保存全部內容。');
    }
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '名片資料');
    const filename = `business_cards_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, filename);
};

/**
 * Exports an array of business cards to a JSON file for a complete backup.
 * @param cards The array of business cards to export.
 */
export const exportToJson = (cards: BusinessCard[]): void => {
    if (cards.length === 0) return;
    const jsonString = JSON.stringify(cards, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `business_cards_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Let mobile browsers consume the download before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/**
 * Imports business cards from an Excel file, checking for duplicates.
 * @param file The .xlsx file to import from.
 * @param existingCards The list of current cards to check against for duplicates.
 * @returns A promise that resolves to an array of new, non-duplicate business cards.
 */
export const importFromExcel = async (file: File, existingCards: BusinessCard[]): Promise<BusinessCard[]> => {
    if (file.size > 10 * 1024 * 1024) throw new Error('Excel 檔案超過 10 MB，請分批匯入。');
    const XLSX = await import('xlsx');
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'array', cellDates: true, sheetRows: MAX_IMPORT_CARDS + 2 });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                if (!worksheet) throw new Error('檔案中沒有工作表。');
                const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
                if (range.e.c > 100) throw new Error('Excel 欄位過多，請使用名片管家匯出的格式。');
                const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

                if (jsonData.length < 2) throw new Error("檔案中無有效資料");
                if (jsonData.length > MAX_IMPORT_CARDS + 1) throw new Error("一次最多可匯入 5,000 張名片，請分批匯入。");

                const fileHeaders = jsonData[0];
                const requiredHeaders = ['姓名', '公司'];
                if (!requiredHeaders.every(h => fileHeaders.includes(h))) {
                   throw new Error(`檔案缺少必要的欄位：${requiredHeaders.join(', ')}`);
                }

                const headerMap: { [key: string]: number } = Object.create(null);
                fileHeaders.forEach((header: string, index: number) => { headerMap[header] = index; });

                const importedCards: BusinessCard[] = [];
                // Skip only repeated content. A changed phone, note or role must not disappear.
                const identifierFor = (card: Omit<BusinessCard, 'id'>) =>
                    JSON.stringify([[card.name, card.company, card.title, card.phone, card.email, card.address, card.notes, card.rawText]
                        .map(value => (value || '').normalize('NFKC').trim()),
                        encodeContactMetadata({ tags: card.tags?.length ? card.tags : undefined, events: card.events?.length ? card.events : undefined,
                            followUps: card.followUps?.length ? card.followUps : undefined, interactions: card.interactions?.length ? card.interactions : undefined })]);
                const existingCardIdentifiers = new Set(existingCards.map(identifierFor));

                for (let i = 1; i < jsonData.length; i++) {
                    const values = jsonData[i];
                    if (!values || values.length === 0) continue;
                    const cell = (header: string) => {
                        const value = String(values[headerMap[header]] ?? '').trim();
                        if (value.length > 50_000) throw new Error(`第 ${i + 1} 列的 ${header} 內容過長，尚未匯入任何資料。`);
                        return value;
                    };
                    const originalDate = values[headerMap['建立時間']];
                    const timestamp = originalDate instanceof Date ? originalDate.getTime()
                        : typeof originalDate === 'string' ? Date.parse(originalDate) : NaN;

                    const cardData: Omit<BusinessCard, 'id'> = {
                        ...readContactMetadata({ ...decodeContactMetadata(cell('人脈紀錄 JSON')), mergedIntoId: undefined,
                            tags: parseLabels(cell('標籤')), events: parseLabels(cell('認識場合')) }),
                        name: cell('姓名'),
                        company: cell('公司'),
                        title: cell('職稱'),
                        phone: cell('電話'),
                        email: cell('Email'),
                        address: cell('地址'),
                        notes: cell('備註'),
                        timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
                        rawText: cell('辨識原文'),
                    };

                    if (![cardData.name, cardData.company, cardData.phone, cardData.email, cardData.address, cardData.notes, cardData.rawText].some(Boolean)) continue;
                    const identifier = identifierFor(cardData);
                    if (!existingCardIdentifiers.has(identifier)) {
                        importedCards.push({ ...cardData, id: crypto.randomUUID() });
                        existingCardIdentifiers.add(identifier);
                    }
                }
                resolve(importedCards);
            } catch (error) {
                reject(error as Error);
            }
        };
        reader.onerror = () => reject(new Error('無法讀取檔案，請重新選擇檔案後再試。'));
        reader.onabort = () => reject(new Error('檔案讀取已取消。'));
        reader.readAsArrayBuffer(file);
    });
};

/**
 * Imports business cards from a JSON backup file.
 * @param file The .json file to import from.
 * @returns A promise that resolves to an array of business cards from the backup.
 */
export const importFromJson = (file: File): Promise<BusinessCard[]> => {
    if (file.size > MAX_BACKUP_BYTES) return Promise.reject(new Error('備份檔案超過 50 MB，請使用較小的備份檔。'));
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                resolve(parseCardBackup(e.target?.result as string));
            } catch (error) {
                reject(error as Error);
            }
        };
        reader.onerror = () => reject(new Error('無法讀取檔案，請重新選擇檔案後再試。'));
        reader.onabort = () => reject(new Error('檔案讀取已取消。'));
        reader.readAsText(file);
    });
};
