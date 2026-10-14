import React, { useState, useEffect } from 'react';
import { BusinessCard } from '../types';
import Icon from './Icon';
import Spinner from './Spinner';

interface CardItemProps {
  card: BusinessCard;
  onDelete: (id: string) => void;
  onEdit: (card: BusinessCard) => void;
  onLazyImageLoaded?: (id: string, base64: string) => void;
}

const CardItem: React.FC<CardItemProps> = ({ card, onDelete, onEdit, onLazyImageLoaded }) => {
  const [showImageModal, setShowImageModal] = useState(false);
  const [lazyImage, setLazyImage] = useState<string | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  
  // The single source of truth for the image. If we have the base64 data, we can display it.
  const imageUrl = card.imageBase64 ? `data:image/jpeg;base64,${card.imageBase64}` : (lazyImage ? `data:image/jpeg;base64,${lazyImage}` : null);

  useEffect(() => {
    if (!card.imageBase64 && card.imageDriveId && !lazyImage && !isLoadingImage) {
      setIsLoadingImage(true);
      // Dynamically load API to avoid bundle overhead and circular dependencies
      import('../services/googleApiService').then(async (api) => {
        try {
          const base64 = await api.getImageAsBase64(card.imageDriveId!);
          if (base64) {
            setLazyImage(base64);
            if (onLazyImageLoaded) {
              onLazyImageLoaded(card.id, base64);
            }
          }
        } catch (e) {
          console.error("Failed to lazy load image for card:", card.id, e);
        } finally {
          setIsLoadingImage(false);
        }
      }).catch(err => {
        console.error("Failed to load GoogleApiService dynamically:", err);
        setIsLoadingImage(false);
      });
    }
  }, [card.imageBase64, card.imageDriveId, card.id, onLazyImageLoaded, lazyImage, isLoadingImage]);

  if (card.isProcessing) {
    return (
      <div className="bg-gray-800 rounded-lg p-5 shadow-lg flex items-center gap-4 animate-pulse">
        {imageUrl && (
          <img
            src={imageUrl}
            alt="名片縮圖"
            className="w-24 h-14 object-cover rounded-md border border-gray-700"
          />
        )}
        <div className="flex-grow flex items-center gap-3">
          <Spinner className="h-6 w-6" />
          <div>
            <h3 className="text-lg font-bold text-white">正在辨識中...</h3>
            <p className="text-gray-400">請稍候</p>
          </div>
        </div>
      </div>
    );
  }

  if (card.isError) {
    return (
      <div className="bg-gray-800 rounded-lg p-5 shadow-lg flex items-center gap-4 border border-red-500/50">
        <div className="flex-grow flex items-center gap-3 overflow-hidden">
          <Icon name="exclamation-triangle" className="h-8 w-8 text-red-400 flex-shrink-0" />
          <div className="overflow-hidden">
            <h3 className="text-lg font-bold text-red-400 truncate">{card.name}</h3>
            <p className="text-gray-400 text-sm truncate">{card.company}</p>
          </div>
        </div>
        <button
          onClick={() => onDelete(card.id)}
          className="text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
          aria-label={`刪除失敗的項目`}
        >
          <Icon name="trash" className="h-5 w-5" />
        </button>
      </div>
    );
  }


  const CardImageModal = () => (
    <div
      className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 animate-fade-in"
      onClick={() => setShowImageModal(false)}
      role="dialog"
      aria-modal="true"
      aria-label="名片照片預覽"
    >
      <img
        src={imageUrl!}
        alt={`${card.name} 的名片`}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
       <button 
        className="absolute top-4 right-4 text-white text-3xl font-bold"
        aria-label="關閉預覽"
       >&times;</button>
    </div>
  );


  return (
    <>
      <div className="bg-gray-800 rounded-lg p-5 shadow-lg transition-transform transform hover:scale-[1.02] flex flex-col">
        <div className="flex justify-between items-start gap-4 flex-grow">
          <div className="flex-grow">
            <h3 className="text-xl font-bold text-white">{card.name}</h3>
            <p className="text-blue-400 font-medium">{card.title}</p>
            <p className="text-gray-300 mt-1">{card.company}</p>
          </div>
          <div className="flex-shrink-0 flex flex-col items-end gap-y-3">
             {imageUrl ? (
              <button onClick={() => setShowImageModal(true)} aria-label="查看名片照片">
                <img
                  src={imageUrl}
                  alt="名片縮圖"
                  className="w-24 h-14 object-cover rounded-md cursor-pointer border border-gray-700 hover:border-blue-500 transition-all"
                />
              </button>
            ) : (card.imageDriveId && isLoadingImage) ? (
              <div className="w-24 h-14 flex items-center justify-center rounded-md border border-gray-750 bg-gray-900/40">
                <Spinner className="h-5 w-5 text-blue-400" />
              </div>
            ) : null}
            <div className="flex items-center space-x-3 text-gray-500">
                <button
                  onClick={() => onEdit(card)}
                  className="hover:text-blue-400 transition-colors"
                  aria-label={`編輯 ${card.name} 的名片`}
                >
                  <Icon name="edit" className="h-5 w-5" />
                </button>
                <button
                  onClick={() => onDelete(card.id)}
                  className="hover:text-red-500 transition-colors"
                  aria-label={`刪除 ${card.name} 的名片`}
                >
                  <Icon name="trash" className="h-5 w-5" />
                </button>
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-2 text-sm text-gray-400">
          {card.phone && (
            <div className="flex items-center">
              <Icon name="phone" className="h-4 w-4 mr-3 text-gray-500 flex-shrink-0" />
              <a href={`tel:${card.phone}`} className="hover:text-blue-400 break-all">{card.phone}</a>
            </div>
          )}
          {card.email && (
            <div className="flex items-center">
              <Icon name="mail" className="h-4 w-4 mr-3 text-gray-500 flex-shrink-0" />
              <a href={`mailto:${card.email}`} className="hover:text-blue-400 truncate">{card.email}</a>
            </div>
          )}
          {card.address && (
            <div className="flex items-center">
              <Icon name="company" className="h-4 w-4 mr-3 text-gray-500 flex-shrink-0" />
              <span>{card.address}</span>
            </div>
          )}
        </div>
        {card.notes && (
          <div className="mt-4 pt-4 border-t border-gray-700/60">
            <div className="flex items-start text-sm">
              <Icon name="notes" className="h-4 w-4 mr-3 text-gray-500 flex-shrink-0 mt-0.5" />
              <p className="text-gray-300 whitespace-pre-wrap flex-grow">{card.notes}</p>
            </div>
          </div>
        )}
      </div>
      {showImageModal && imageUrl && <CardImageModal />}
    </>
  );
};

export default CardItem;