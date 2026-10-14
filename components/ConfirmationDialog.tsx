import React from 'react';
import Icon from './Icon';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmButtonText?: string;
  cancelButtonText?: string;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmButtonText = '確認',
  cancelButtonText = '取消',
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 animate-fade-in"
      aria-labelledby="confirmation-dialog-title"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div 
        className="bg-gray-800 rounded-xl shadow-2xl p-6 m-4 max-w-sm w-full transform transition-all scale-100 animate-zoom-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:flex sm:items-start">
          <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-900/50 sm:mx-0 sm:h-10 sm:w-10">
            <Icon name="exclamation-triangle" className="h-6 w-6 text-red-400" />
          </div>
          <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
            <h3 className="text-lg leading-6 font-bold text-white" id="confirmation-dialog-title">
              {title}
            </h3>
            <div className="mt-2">
              <p className="text-sm text-gray-400">
                {message}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse gap-3">
          <button
            type="button"
            className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 focus:ring-offset-gray-800 sm:w-auto sm:text-sm transition-colors"
            onClick={onConfirm}
          >
            {confirmButtonText}
          </button>
          <button
            type="button"
            className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-600 shadow-sm px-4 py-2 bg-gray-700 text-base font-medium text-gray-200 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-800 sm:mt-0 sm:w-auto sm:text-sm transition-colors"
            onClick={onCancel}
          >
            {cancelButtonText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationDialog;