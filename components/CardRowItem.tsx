import React from 'react';
import { BusinessCard } from '../types';
import Icon from './Icon';
import Spinner from './Spinner';

interface CardRowItemProps {
  card: BusinessCard;
  onDelete: (id: string) => void;
  onEdit: (card: BusinessCard) => void;
}

const CardRowItem: React.FC<CardRowItemProps> = ({ card, onDelete, onEdit }) => {
  if (card.isProcessing) {
    return (
      <div className="px-4 py-4 flex items-center gap-4 bg-gray-700/20 animate-pulse">
        <Spinner className="h-5 w-5" />
        <div className="flex-grow">
          <p className="font-semibold text-white">正在辨識中...</p>
          <p className="text-sm text-gray-400">請稍候</p>
        </div>
      </div>
    );
  }

  if (card.isError) {
    return (
      <div className="px-4 py-4 md:grid md:grid-cols-[minmax(0,_5fr)_minmax(0,_0.5fr)] md:gap-4 items-center bg-red-900/20">
        <div className="flex items-center gap-2 overflow-hidden">
          <Icon name="exclamation-triangle" className="h-5 w-5 text-red-400 flex-shrink-0" />
          <div>
            <p className="font-semibold text-red-400 truncate">{card.name}</p>
            <p className="text-sm text-gray-400 truncate">{card.company}</p>
          </div>
        </div>
        <div className="hidden md:flex items-center justify-end">
          <button onClick={() => onDelete(card.id)} className="text-gray-500 hover:text-red-400 transition-colors" aria-label={`刪除失敗的項目`}>
            <Icon name="trash" className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 hover:bg-gray-700/40 transition-colors md:grid md:grid-cols-[minmax(0,2fr),minmax(0,1.5fr),minmax(0,2fr),minmax(0,0.5fr)] md:gap-4 md:items-center">
      {/* Section 1: Name, Company, and Mobile Actions */}
      <div className="flex justify-between items-start md:flex-col md:items-start md:justify-start">
        <div>
          <p className="font-semibold text-white truncate">{card.name || 'N/A'}</p>
          <p className="text-sm text-gray-400 truncate">{card.company || 'N/A'}</p>
        </div>
        <div className="flex items-center space-x-3 text-gray-500 md:hidden flex-shrink-0">
          <button onClick={() => onEdit(card)} className="hover:text-blue-400 transition-colors" aria-label={`編輯 ${card.name} 的名片`}>
            <Icon name="edit" className="h-5 w-5" />
          </button>
          <button onClick={() => onDelete(card.id)} className="hover:text-red-500 transition-colors" aria-label={`刪除 ${card.name} 的名片`}>
            <Icon name="trash" className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Section 2: Title */}
      <div className="mt-1 md:mt-0">
        <p className="text-gray-300 truncate">{card.title || '-'}</p>
      </div>
      
      {/* Section 3: Contact */}
      <div className="mt-2 space-y-1 text-sm md:mt-0">
        {card.phone && (
          <div className="flex items-center gap-2 text-gray-400">
            <Icon name="phone" className="h-4 w-4 flex-shrink-0" />
            <a href={`tel:${card.phone}`} className="hover:text-blue-400 truncate">{card.phone}</a>
          </div>
        )}
        {card.email && (
          <div className="flex items-center gap-2 text-gray-400">
            <Icon name="mail" className="h-4 w-4 flex-shrink-0" />
            <a href={`mailto:${card.email}`} className="hover:text-blue-400 truncate">{card.email}</a>
          </div>
        )}
      </div>

      {/* Section 4: Actions (Desktop) */}
      <div className="hidden md:flex items-center justify-end space-x-3 text-gray-500">
        <button onClick={() => onEdit(card)} className="hover:text-blue-400 transition-colors" aria-label={`編輯 ${card.name} 的名片`}>
          <Icon name="edit" className="h-5 w-5" />
        </button>
        <button onClick={() => onDelete(card.id)} className="hover:text-red-500 transition-colors" aria-label={`刪除 ${card.name} 的名片`}>
          <Icon name="trash" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default CardRowItem;