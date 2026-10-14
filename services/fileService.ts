
import * as XLSX from 'xlsx';
import { BusinessCard } from '../types';

/**
 * Exports an array of business cards to an Excel .xlsx file.
 * @param cards The array of business cards to export.
 */
export const exportToExcel = (cards: BusinessCard[]): void => {
    if (cards.length === 0) return;
    const headers = ['姓名', '公司', '職稱', '電話', 'Email', '地址', '備註', '建立時間'];
    const data = cards.map(card => [
        card.name, card.company, card.title, card.phone, card.email, card.address, card.notes || '',
        new Date(card.timestamp).toLocaleString('zh-TW'),
    ]);
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
    URL.revokeObjectURL(url);
};

/**
 * Imports business cards from an Excel file, checking for duplicates.
 * @param file The .xlsx file to import from.
 * @param existingCards The list of current cards to check against for duplicates.
 * @returns A promise that resolves to an array of new, non-duplicate business cards.
 */
export const importFromExcel = (file: File, existingCards: BusinessCard[]): Promise<BusinessCard[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

                if (jsonData.length < 2) throw new Error("檔案中無有效資料");

                const fileHeaders = jsonData[0];
                const requiredHeaders = ['姓名', '公司'];
                if (!requiredHeaders.every(h => fileHeaders.includes(h))) {
                   throw new Error(`檔案缺少必要的欄位：${requiredHeaders.join(', ')}`);
                }

                const headerMap: { [key: string]: number } = {};
                fileHeaders.forEach((header: string, index: number) => { headerMap[header] = index; });

                const importedCards: BusinessCard[] = [];
                const existingCardIdentifiers = new Set(existingCards.map(c => `${c.name}|${c.company}|${c.email}`));

                for (let i = 1; i < jsonData.length; i++) {
                    const values = jsonData[i];
                    if (!values || values.length === 0) continue;

                    const cardData: Omit<BusinessCard, 'id'> = {
                        name: String(values[headerMap['姓名']] || ''),
                        company: String(values[headerMap['公司']] || ''),
                        title: String(values[headerMap['職稱']] || ''),
                        phone: String(values[headerMap['電話']] || ''),
                        email: String(values[headerMap['Email']] || ''),
                        address: String(values[headerMap['地址']] || ''),
                        notes: String(values[headerMap['備註']] || ''),
                        timestamp: Date.now(),
                        rawText: '',
                    };

                    const identifier = `${cardData.name}|${cardData.company}|${cardData.email}`;
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
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
};

/**
 * Imports business cards from a JSON backup file.
 * @param file The .json file to import from.
 * @returns A promise that resolves to an array of business cards from the backup.
 */
export const importFromJson = (file: File): Promise<BusinessCard[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsedData = JSON.parse(e.target?.result as string);
                if (!Array.isArray(parsedData)) throw new Error("無效的檔案格式");
                // TODO: Add schema validation for parsedData items
                resolve(parsedData as BusinessCard[]);
            } catch (error) {
                reject(error as Error);
            }
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
};
