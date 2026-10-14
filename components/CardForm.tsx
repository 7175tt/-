import React, { useState, useRef } from 'react';
import { BusinessCard } from '../types';
import Icon from './Icon';

interface CardFormProps {
  cardData: BusinessCard;
  onSave: (updatedCard: BusinessCard) => void;
  onCancel: () => void;
  isConfigError: boolean;
}

const CardForm: React.FC<CardFormProps> = ({ cardData, onSave, onCancel, isConfigError }) => {
  const [formData, setFormData] = useState(cardData);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getImageUrl = () => {
    // The only reliable way to display an image in the form is via base64.
    // imageDriveId is just an ID, not a URL.
    if (formData.imageBase64) {
      return `data:image/jpeg;base64,${formData.imageBase64}`;
    }
    return null;
  };
  const imageUrl = getImageUrl();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const base64Image = (event.target?.result as string).split(',')[1];
        setFormData(prev => ({
            ...prev,
            imageBase64: base64Image,
            imageDriveId: undefined, // Clear drive ID when a new local image is staged
        }));
    };
    reader.readAsDataURL(file);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleDeletePhoto = () => {
    setFormData(prev => ({
        ...prev,
        imageBase64: undefined,
        imageDriveId: undefined,
    }));
  };

  return (
    <div className={`fixed bg-gray-900 text-white p-4 flex flex-col items-center justify-start overflow-y-auto animate-fade-in inset-x-0 bottom-0 ${isConfigError ? 'top-12' : 'top-0'}`}>
        <div className="w-full max-w-md mx-auto py-8">
            <header className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">編輯名片</h2>
                <button onClick={onCancel} className="text-gray-400 hover:text-white">
                    <Icon name="back" className="w-7 h-7" />
                </button>
            </header>
            
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept="image/jpeg,image/png,image/webp"
            />
            
            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-400 mb-2">名片照片</label>
                {imageUrl ? (
                    <div className="rounded-lg overflow-hidden shadow-lg relative group bg-gray-900">
                        <img
                            src={imageUrl}
                            alt="名片預覽"
                            className="w-full h-auto object-contain"
                        />
                         <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                            <button type="button" onClick={handleUploadClick} className="bg-white/90 text-black px-4 py-2 rounded-lg text-sm font-semibold hover:bg-white transition flex items-center gap-2"><Icon name="edit" className="w-4 h-4"/>更換</button>
                            <button type="button" onClick={handleDeletePhoto} className="bg-red-600/90 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600 transition flex items-center gap-2"><Icon name="trash" className="w-4 h-4"/>刪除</button>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={handleUploadClick}
                        className="w-full flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-gray-600 rounded-lg text-gray-400 hover:bg-gray-800 hover:border-gray-500 transition-colors"
                    >
                        <Icon name="camera" className="h-8 w-8" />
                        <span>新增名片照片</span>
                    </button>
                )}
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-4">
                <InputField label="姓名" name="name" value={formData.name} onChange={handleChange} icon="user" />
                <InputField label="公司" name="company" value={formData.company} onChange={handleChange} icon="company" />
                <InputField label="職稱" name="title" value={formData.title} onChange={handleChange} />
                <InputField label="電話" name="phone" value={formData.phone} onChange={handleChange} icon="phone" type="tel" />
                <InputField label="Email" name="email" value={formData.email} onChange={handleChange} icon="mail" type="email" />
                <InputField label="地址" name="address" value={formData.address} onChange={handleChange} icon="company" />
                <TextareaField label="備註" name="notes" value={formData.notes || ''} onChange={handleChange} icon="notes" />
                
                <div className="pt-4 flex justify-between items-center gap-4">
                    <button type="button" onClick={onCancel} className="w-full py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors">
                        取消
                    </button>
                    <button type="submit" className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
                        <Icon name="save" className="w-5 h-5" />
                        儲存變更
                    </button>
                </div>
            </form>
        </div>
    </div>
  );
};

interface InputFieldProps {
    label: string;
    name: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    icon?: string;
    type?: string;
}

const InputField: React.FC<InputFieldProps> = ({ label, name, value, onChange, icon, type = 'text' }) => (
    <div>
        <label htmlFor={name} className="block text-sm font-medium text-gray-400 mb-1">{label}</label>
        <div className="relative">
            {icon && <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Icon name={icon} className="h-5 w-5 text-gray-500" />
            </div>}
            <input
                type={type}
                id={name}
                name={name}
                value={value}
                onChange={onChange}
                className={`w-full bg-gray-800 border border-gray-700 text-white rounded-lg py-2.5 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${icon ? 'pl-10' : 'pl-3'}`}
            />
        </div>
    </div>
);

interface TextareaFieldProps {
    label: string;
    name: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    icon?: string;
    rows?: number;
}

const TextareaField: React.FC<TextareaFieldProps> = ({ label, name, value, onChange, icon, rows = 4 }) => (
    <div>
        <label htmlFor={name} className="block text-sm font-medium text-gray-400 mb-1">{label}</label>
        <div className="relative">
            {icon && <div className="pointer-events-none absolute top-3 left-0 flex items-center pl-3">
                <Icon name={icon} className="h-5 w-5 text-gray-500" />
            </div>}
            <textarea
                id={name}
                name={name}
                value={value}
                onChange={onChange}
                rows={rows}
                className={`w-full bg-gray-800 border border-gray-700 text-white rounded-lg py-2.5 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500 ${icon ? 'pl-10' : 'pl-3'}`}
            />
        </div>
    </div>
);


export default CardForm;