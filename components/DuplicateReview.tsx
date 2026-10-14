import React, { useMemo, useState } from 'react';
import type { BusinessCard } from '../types';
import { canKeepBoth, findDuplicatePairs, mergeFields, type DuplicatePair, type MergeChoices, type MergeField } from '../services/contactDuplicates';
import ContactPanel, { contactButtonClass } from './ContactPanel';

export default function DuplicateReview({ cards, onMerge, onLoadImage, onClose }: {
  cards: BusinessCard[]; onMerge: (pair: DuplicatePair, choices: MergeChoices, photo: 'left' | 'right') => Promise<void>;
  onLoadImage: (card: BusinessCard) => Promise<string | undefined>; onClose: () => void;
}) {
  const pairs = useMemo(() => findDuplicatePairs(cards), [cards]);
  const [selected, setSelected] = useState<DuplicatePair | null>(null);
  const [choices, setChoices] = useState<MergeChoices>({});
  const [photo, setPhoto] = useState<'left' | 'right'>('left');
  const [busy, setBusy] = useState(false);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [images, setImages] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(20);
  const conflicts = selected ? (Object.keys(mergeFields) as MergeField[]).filter(field => selected.left[field].trim() && selected.right[field].trim() && selected.left[field].trim() !== selected.right[field].trim()) : [];
  return <ContactPanel title="重複名片整理" onClose={onClose} busy={busy}>
    {error && <p role="alert" className="mb-4 text-red-300">{error}</p>}
    {!selected ? <>
      <p className="text-sm text-gray-400 mb-4">依 Email、電話或「姓名＋公司」找出可能重複的名片。共用電話不代表同一人，請逐組確認。合併前的兩張名片都會保留。</p>
      <p className="text-sm text-blue-300 mb-3">{pairs.length >= 200 ? '先顯示 200 組，整理後會繼續比對' : `找到 ${pairs.length} 組可能重複的名片`}</p>
      <ul className="space-y-3">{pairs.slice(0, limit).map(pair => <li key={`${pair.left.id}:${pair.right.id}`} className="bg-gray-900 p-4 rounded-xl"><p className="font-medium break-words">{pair.left.name || pair.left.company} ／ {pair.right.name || pair.right.company}</p><p className="text-xs text-gray-400 mt-1 break-words">{pair.left.company} ／ {pair.right.company}</p><p className="text-sm text-amber-300 mt-2">{pair.reasons.join(' · ')}</p><button className={`${contactButtonClass} mt-3`} onClick={() => { setSelected(pair); setChoices({}); setPhoto(pair.left.imageBase64 || pair.left.imageDriveId ? 'left' : 'right'); setError(''); }} aria-label={`比較 ${pair.left.name || pair.left.company} 與 ${pair.right.name || pair.right.company}`}>比較並選擇欄位</button></li>)}</ul>
      {pairs.length > limit && <button onClick={() => setLimit(value => value + 20)} className="min-h-11 mt-3 text-blue-300">顯示更多組</button>}
      {!pairs.length && <p className="text-gray-400 py-8 text-center">目前沒有找到可能重複的名片。</p>}
    </> : <>
      <button disabled={busy} onClick={() => { setSelected(null); setError(''); }} className="min-h-11 mb-2 text-blue-300">返回比對清單</button>
      <p className="text-sm text-gray-300 mb-4">相同或空白欄位會自動補齊。有差異的欄位請選擇要保留的內容。標籤、場合、待辦、互動與辨識原文會一起保留。</p>
      <fieldset disabled={busy} className="space-y-4">
        {(Object.entries(mergeFields) as [MergeField, string][]).map(([field, label]) => <fieldset key={field} className="border border-gray-800 rounded-xl p-3"><legend className="px-2 text-sm text-blue-300">{label}</legend><div className="grid grid-cols-2 gap-2">{(['left', 'right'] as const).map((side, index) => <label key={side} className={`min-w-0 p-3 rounded-lg whitespace-pre-wrap break-words text-sm ${choices[field] === side ? 'bg-blue-950 ring-1 ring-blue-500' : 'bg-gray-900'}`}>
          <span className="block text-xs text-gray-400 mb-2">名片 {index + 1}</span>{conflicts.includes(field) && <input type="radio" name={`merge-${field}`} value={side} checked={choices[field] === side} onChange={() => setChoices(current => ({ ...current, [field]: side }))} aria-label={`${label}：使用名片 ${index + 1}`} className="mr-2" />}{selected[side][field] || '（空白）'}
        </label>)}</div>{conflicts.includes(field) && canKeepBoth(field) && <label className="flex gap-2 items-center min-h-11 text-sm"><input type="radio" name={`merge-${field}`} checked={choices[field] === 'both'} onChange={() => setChoices(current => ({ ...current, [field]: 'both' }))} />{label}兩者都保留</label>}</fieldset>)}
        {(selected.left.imageBase64 || selected.left.imageDriveId || selected.right.imageBase64 || selected.right.imageDriveId) && <fieldset className="border border-gray-800 rounded-xl p-3"><legend className="px-2 text-sm text-blue-300">主要照片</legend><div className="grid grid-cols-2 gap-3">{(['left', 'right'] as const).map((side, index) => {
          const card = selected[side], image = card.imageBase64 || images[card.id];
          if (!image && !card.imageDriveId) return <p key={side} className="text-sm text-gray-500">名片 {index + 1} 無照片</p>;
          return <div key={side} className="min-w-0"><label className="flex items-center gap-2 min-h-11 text-sm"><input type="radio" name="merge-photo" checked={photo === side} onChange={() => setPhoto(side)} />使用名片 {index + 1} 照片</label>{image ? <img src={`data:image/jpeg;base64,${image}`} alt={`名片 ${index + 1} 原圖`} className="w-full object-contain max-h-64" /> : <button disabled={loadingPhoto} className="min-h-11 text-blue-300 text-sm" onClick={async () => { setLoadingPhoto(true); try { const data = await onLoadImage(card); if (data) setImages(current => ({ ...current, [card.id]: data })); } catch (cause) { setError((cause as Error).message); } finally { setLoadingPhoto(false); } }}>載入名片 {index + 1} 照片</button>}</div>;
        })}</div></fieldset>}
        <p className="text-xs text-gray-400">合併後，在「跟進與紀錄 → 查看合併前的名片」可還原原始資料。</p>
        <button disabled={busy || loadingPhoto || conflicts.some(field => !choices[field])} className={`${contactButtonClass} w-full`} onClick={async () => {
          setBusy(true); setError('');
          try { await onMerge(selected, choices, photo); setSelected(null); }
          catch (cause) { setError((cause as Error).message); }
          finally { setBusy(false); }
        }}>{busy ? '正在合併…' : '確認合併，保留兩張原始名片'}</button>
        {conflicts.some(field => !choices[field]) && <p className="text-sm text-amber-300">請先選擇所有有差異的欄位。</p>}
      </fieldset>
    </>}
  </ContactPanel>;
}
