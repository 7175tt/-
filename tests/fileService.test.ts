import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { importFromExcel, importFromJson } from '../services/fileService';
import type { BusinessCard } from '../types';

// Node has Blob/File but no FileReader; read real generated workbook bytes through its browser contract.
class TestFileReader {
  result: string | ArrayBuffer | null = null;
  onload?: (event: { target: TestFileReader }) => void;
  onerror?: () => void;
  readAsArrayBuffer(file: File) { file.arrayBuffer().then(value => { this.result = value; this.onload?.({ target: this }); }, () => this.onerror?.()); }
  readAsText(file: File) { file.text().then(value => { this.result = value; this.onload?.({ target: this }); }, () => this.onerror?.()); }
}
Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: TestFileReader });

const headers = ['姓名', '公司', '職稱', '電話', 'Email', '地址', '備註', '建立時間', '辨識原文'];
const workbook = (rows: unknown[][]) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '名片');
  return new File([XLSX.write(book, { bookType: 'xlsx', type: 'array' })], 'contacts.xlsx');
};

test('Excel import preserves phone strings, notes, OCR text and original timestamp', async () => {
  const [card] = await importFromExcel(workbook([headers, ['王小明', 'Example', '顧問', '0912-345-678', 'a@example.com', '台北市', '會展認識', '2025-01-01T00:00:00.000Z', '原文內容']]), []);
  assert.equal(card.phone, '0912-345-678');
  assert.equal(card.notes, '會展認識');
  assert.equal(card.rawText, '原文內容');
  assert.equal(card.timestamp, Date.parse('2025-01-01T00:00:00.000Z'));
  assert.ok(card.id);
});

test('Excel import skips empty and duplicate rows without hiding a different phone', async () => {
  const existing = { name: '小明', company: 'Example', email: 'a@example.com', phone: '0912345678' } as BusinessCard;
  const rows = [headers, ['小明', 'Example', '', '0912345678', 'a@example.com'], ['', '', '', ''], ['小明', 'Example', '', '0987654321', 'a@example.com'], ['小明', 'Example', '', '0987654321', 'a@example.com']];
  const imported = await importFromExcel(workbook(rows), [existing]);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].phone, '0987654321');
});

test('Excel contacts with changed notes or only notes are preserved instead of silently discarded', async () => {
  const rows = [headers,
    ['小明', 'Example', '', '0912345678', '', '', '第一次見面'],
    ['小明', 'Example', '', '0912345678', '', '', '新的合作備註'],
    ['', '', '', '', '', '', '待補聯絡資訊 A'],
    ['', '', '', '', '', '', '待補聯絡資訊 B'],
  ];
  const imported = await importFromExcel(workbook(rows), []);
  assert.equal(imported.length, 4);
  assert.equal(imported[1].notes, '新的合作備註');
});

test('invalid or oversized Excel inputs fail before returning any imported rows', async () => {
  await assert.rejects(importFromExcel(workbook([['錯誤欄位'], ['小明']]), []), /必要的欄位/);
  await assert.rejects(importFromExcel({ size: 11 * 1024 * 1024 } as File, []), /10 MB/);
  await assert.rejects(importFromExcel(workbook([headers, ...Array.from({ length: 5001 }, () => ['姓名', '公司'])]), []), /5,000/);
});

test('JSON file import rejects malformed content and oversize before returning cards', async () => {
  await assert.rejects(importFromJson(new File(['[{"name":[]} ]'], 'bad.json')), /必須是文字/);
  await assert.rejects(importFromJson({ size: 51 * 1024 * 1024 } as File), /50 MB/);
  const imported = await importFromJson(new File(['[{"name":"舊名片"}]'], 'legacy.json'));
  assert.equal(imported[0].name, '舊名片');
  assert.ok(imported[0].id);
});
