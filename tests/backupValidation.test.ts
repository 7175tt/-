import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCardBackup, MAX_IMPORT_CARDS } from '../services/backupValidation';

const card = { id: 'card-1', name: '王小明', company: 'Example', title: '', phone: '0912-345-678', email: 'a@example.com', address: '', notes: '展會認識', rawText: '原始內容', timestamp: 1720000000000 };

test('legacy array backups preserve contact content and fill omitted optional fields', () => {
  const [restored] = parseCardBackup(JSON.stringify([{ id: 'old-id', name: '舊名片', timestamp: 1 }]));
  assert.equal(restored.id, 'old-id');
  assert.equal(restored.name, '舊名片');
  assert.equal(restored.notes, '');
  assert.equal(restored.rawText, '');
  assert.deepEqual(parseCardBackup(JSON.stringify([card])), [card]);
});

test('versioned backups preserve review state but strip untrusted account and unknown fields', () => {
  const [restored] = parseCardBackup(JSON.stringify({ version: 1, cards: [{ ...card, needsReview: true, cloudAccount: 'other@example.com', unknown: 'discard' }] }));
  assert.equal(restored.needsReview, true);
  assert.equal(restored.cloudAccount, undefined);
  assert.equal('unknown' in restored, false);
});

test('interrupted scans are retryable errors instead of endless spinners', () => {
  const [restored] = parseCardBackup(JSON.stringify([{ ...card, isProcessing: true, imageBase64: 'aGVsbG8=' }]));
  assert.equal(restored.isProcessing, undefined);
  assert.equal(restored.isError, true);
  assert.match(restored.errorMessage!, /重新辨識/);
  assert.equal(restored.imageBase64, 'aGVsbG8=');
});

test('invalid documents and empty backups never return a destructive replacement', () => {
  for (const input of ['{broken', '[]', '{}', '[null]', '[{}]', '{"version":2,"cards":[]}']) {
    assert.throws(() => parseCardBackup(input));
  }
});

test('every entry must validate; nested text, repeated IDs and invalid fields fail atomically', () => {
  const bad = [
    { ...card, id: 'second', phone: { value: '123' } },
    { ...card, id: 'second', timestamp: 'yesterday' },
    { ...card, id: 'second', imageBase64: '<script>' },
    { ...card, id: 'second', imageDriveId: 'https://evil.example/image' },
    { ...card, id: 'second', isProcessing: 'true' },
    { ...card, id: 'second', notes: 'x'.repeat(50_001) },
    card,
  ];
  for (const entry of bad) assert.throws(() => parseCardBackup(JSON.stringify([card, entry])), /第 2 張名片/);
  assert.throws(() => parseCardBackup(JSON.stringify(Array.from({ length: MAX_IMPORT_CARDS + 1 }, () => card))), /5,000/);
});

test('prototype keys cannot affect returned objects', () => {
  const [restored] = parseCardBackup('[{"id":"safe","name":"Name","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}]', 1);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.hasOwn(restored, '__proto__'), false);
  assert.equal(Object.hasOwn(restored, 'constructor'), false);
  assert.equal(restored.timestamp, 1);
});
