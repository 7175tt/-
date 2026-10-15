import React, { useEffect, useState, useRef } from 'react';
import { BusinessCard } from '../types';
import Icon from './Icon';
import { imageFileToJpegBase64 } from '../utils/cardImage';
import CardPhoto from './CardPhoto';
import { isSameCardPhoto } from '../services/cardPhoto';

interface CardFormProps {
  cardData: BusinessCard;
  onSave: (updatedCard: BusinessCard) => void | Promise<void>;
  onCancel: () => void;
  isConfigError: boolean;
  mode?: 'create' | 'review' | 'edit';
  canLoadCloudImages?: boolean;
  onLazyImageLoaded?: (card: BusinessCard, base64: string) => void;
}

const CardForm: React.FC<CardFormProps> = ({ cardData, onSave, onCancel, isConfigError, mode = 'edit', canLoadCloudImages = false, onLazyImageLoaded }) => {
  const [formData, setFormData] = useState(cardData);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingPhoto, setIsLoadingPhoto] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const photoRequestRef = useRef(0);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; photoRequestRef.current++; };
  }, []);

  useEffect(() => {
    setFormData(cardData);
    setError(null);
    setIsLoadingPhoto(false);
    photoRequestRef.current++;
  }, [cardData.id]);

  const hasPhoto = !!(formData.imageBase64 || formData.imageDriveId);
  const cachePhoto = (source: BusinessCard, base64: string) => {
    setFormData(current => isSameCardPhoto(current, source) ? { ...current, imageBase64: base64 } : current);
    onLazyImageLoaded?.(source, base64);
  };
  const isReview = mode === 'review' || !!cardData.isError;
  const heading = mode === 'create' ? '新增名片' : isReview ? '核對名片' : '編輯名片';
  const disabled = isSaving || isLoadingPhoto;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormData(previous => ({ ...previous, [name]: value }));
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current || isLoadingPhoto) return;
    if (![formData.name, formData.company, formData.phone, formData.email].some(value => value?.trim())) {
      setError('請至少填寫姓名、公司、電話或 Email 其中一項，方便日後搜尋。');
      firstFieldRef.current?.focus();
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      const updatedCard = { ...formData, isError: false, isProcessing: false };
      for (const field of ['name', 'company', 'title', 'phone', 'email', 'address', 'notes'] as const) {
        updatedCard[field] = (updatedCard[field] || '').trim();
      }
      await onSave(updatedCard);
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : '儲存失敗，內容仍保留在此，請再試一次。');
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const request = ++photoRequestRef.current;
    setIsLoadingPhoto(true);
    setError(null);
    try {
      const imageBase64 = await imageFileToJpegBase64(file);
      if (!mountedRef.current || request !== photoRequestRef.current) return;
      setFormData(previous => ({ ...previous, imageBase64, imageDriveId: undefined }));
    } catch (cause) {
      if (mountedRef.current && request === photoRequestRef.current) setError(cause instanceof Error ? cause.message : '無法讀取照片，原有照片已保留。');
    } finally {
      if (mountedRef.current && request === photoRequestRef.current) setIsLoadingPhoto(false);
    }
  };

  const handleDeletePhoto = () => {
    photoRequestRef.current++;
    setFormData(previous => ({ ...previous, imageBase64: undefined, imageDriveId: undefined }));
  };

  return (
    <section aria-labelledby="card-form-title" className={`fixed z-30 bg-gray-950 text-white flex flex-col overflow-y-auto inset-x-0 bottom-0 ${isConfigError ? 'top-12' : 'top-0'}`}>
      <div className="w-full max-w-2xl mx-auto px-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <header className="flex items-center justify-between gap-4 mb-4">
          <div><h1 id="card-form-title" className="text-2xl font-bold">{heading}</h1><p className="text-sm text-gray-400 mt-1">{mode === 'create' ? '先填重點，隨時可以補充' : '對照照片確認姓名與聯絡方式'}</p></div>
          <button type="button" onClick={onCancel} disabled={disabled} aria-label="返回名片列表" className="min-w-11 min-h-11 rounded-xl flex items-center justify-center bg-gray-800 text-gray-300 disabled:opacity-50"><Icon name="x-mark" className="h-6 w-6" /></button>
        </header>

        {isReview && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 mb-4 text-sm text-amber-100" role="status">{cardData.isError ? '自動辨識未完成，照片已保留。請對照照片填寫，或回到列表重新辨識。' : '辨識內容需要你確認，請特別核對電話與 Email，儲存後即可使用。'}</div>}

        <input id="card-photo" type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" aria-label="選擇名片照片" />
        <div className="mb-5">
          <p className="text-sm font-medium text-gray-300 mb-2">名片照片</p>
          {hasPhoto ? <CardPhoto card={formData} variant="full" alt="名片原始照片，可對照下方辨識內容" canLoadCloudImages={canLoadCloudImages} onImageLoaded={cachePhoto} /> : <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled} className="w-full min-h-24 flex items-center justify-center gap-3 border-2 border-dashed border-gray-700 rounded-xl text-gray-400 disabled:opacity-50"><Icon name="camera" className="h-7 w-7" /><span>新增名片照片（選填）</span></button>}
          {hasPhoto && <div className="flex gap-3 mt-2"><button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled} className="min-h-11 rounded-lg bg-gray-800 px-4 text-sm disabled:opacity-50">更換照片</button><button type="button" onClick={handleDeletePhoto} disabled={disabled} className="min-h-11 rounded-lg px-4 text-sm text-red-300 disabled:opacity-50">移除照片</button></div>}
          {isLoadingPhoto && <p role="status" className="text-sm text-blue-300 mt-2">正在準備照片…</p>}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField label="姓名" name="name" value={formData.name} onChange={handleChange} inputRef={firstFieldRef} icon="user" autoComplete="off" />
            <InputField label="公司" name="company" value={formData.company} onChange={handleChange} icon="company" />
            <InputField label="職稱" name="title" value={formData.title} onChange={handleChange} />
            <InputField label="電話" name="phone" value={formData.phone} onChange={handleChange} icon="phone" type="tel" inputMode="tel" placeholder="手機、公司電話或分機" />
          </div>
          <InputField label="Email" name="email" value={formData.email} onChange={handleChange} icon="mail" inputMode="email" placeholder="多個 Email 可以用逗號分隔" />
          <InputField label="地址" name="address" value={formData.address} onChange={handleChange} icon="company" />
          <div><label htmlFor="card-notes" className="block text-sm font-medium text-gray-300 mb-1.5">備註</label><textarea id="card-notes" name="notes" value={formData.notes || ''} onChange={handleChange} rows={3} placeholder="在哪裡認識、專長、下次聯絡事項…" className="w-full bg-gray-900 border border-gray-700 text-white rounded-xl p-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
          {!!formData.rawText && <details className="rounded-xl bg-gray-900 border border-gray-800 p-3"><summary className="min-h-6 cursor-pointer text-sm text-gray-300">查看辨識原文</summary><p className="mt-3 text-sm text-gray-400 whitespace-pre-wrap break-words select-text">{formData.rawText}</p></details>}
          {error && <p id="card-form-error" role="alert" className="rounded-xl bg-red-950 px-3 py-3 text-sm text-red-200">{error}</p>}
          <div className="sticky bottom-0 flex gap-3 bg-gray-950/95 backdrop-blur-sm pt-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            <button type="button" onClick={onCancel} disabled={disabled} className="min-h-12 rounded-xl bg-gray-800 px-5 text-gray-200 disabled:opacity-50">取消</button>
            <button type="submit" disabled={disabled} className="min-h-12 flex-1 rounded-xl bg-blue-600 px-4 font-semibold flex items-center justify-center gap-2 hover:bg-blue-500 disabled:opacity-50"><Icon name="save" className="h-5 w-5" />{isSaving ? '儲存中…' : mode === 'create' ? '建立名片' : isReview ? '確認並儲存' : '儲存變更'}</button>
          </div>
        </form>
      </div>
    </section>
  );
};

interface InputFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  icon?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  placeholder?: string;
  autoComplete?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

const InputField: React.FC<InputFieldProps> = ({ label, name, value, onChange, icon, type = 'text', inputMode, placeholder, autoComplete = 'off', inputRef }) => (
  <div>
    <label htmlFor={`card-${name}`} className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
    <div className="relative">
      {icon && <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"><Icon name={icon} className="h-5 w-5 text-gray-500" /></div>}
      <input ref={inputRef} type={type} inputMode={inputMode} autoComplete={autoComplete} autoCapitalize={name === 'email' ? 'none' : undefined} spellCheck={name === 'email' ? false : undefined} id={`card-${name}`} name={name} value={value || ''} onChange={onChange} placeholder={placeholder} className={`w-full bg-gray-900 border border-gray-700 text-white rounded-xl py-3 pr-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 ${icon ? 'pl-10' : 'pl-3'}`} />
    </div>
  </div>
);

export default CardForm;
