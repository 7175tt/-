import React from 'react';
import { GoogleUser, SyncStatus } from '../types';
import Icon from './Icon';
import Spinner from './Spinner';

interface GoogleAuthProps {
  user: GoogleUser | null;
  syncStatus: SyncStatus;
  isGapiReady: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

const GoogleAuth: React.FC<GoogleAuthProps> = ({ user, syncStatus, isGapiReady, onLogin, onLogout }) => {
  if (!user) {
    const isDisabled = !isGapiReady;
    return (
      <button
        onClick={onLogin}
        disabled={isDisabled}
        className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-wait"
        title={isDisabled ? "正在初始化 Google 服務..." : "使用 Google 登入"}
      >
        <Icon name="google-logo" className="h-5 w-5" />
        <span className="font-medium">{isDisabled ? "服務準備中..." : "使用 Google 登入"}</span>
      </button>
    );
  }

  const getSyncIndicator = () => {
    switch(syncStatus) {
      case SyncStatus.SYNCING:
        return <Spinner className="h-4 w-4" />;
      case SyncStatus.SYNCED:
        return <Icon name="save" className="h-4 w-4 text-green-400" />;
      case SyncStatus.ERROR:
        return <Icon name="question-mark-circle" className="h-4 w-4 text-red-400" />;
      default:
        return null;
    }
  }

  return (
    <div className="flex items-center gap-3 bg-gray-800 rounded-full p-1 pr-4">
      <div className="flex items-center gap-2">
        {user.picture ? (
           <img src={user.picture} alt={user.name} className="h-8 w-8 rounded-full" />
        ) : (
          <span className="h-8 w-8 rounded-full bg-gray-600 flex items-center justify-center">
             <Icon name="user" className="h-5 w-5 text-gray-400" />
          </span>
        )}
        <span className="text-sm font-medium text-white truncate hidden sm:inline">{user.name}</span>
        <div title={syncStatus}>{getSyncIndicator()}</div>
      </div>
      <button
        onClick={onLogout}
        className="text-gray-400 hover:text-white transition-colors"
        aria-label="登出"
        title="登出並切換回本機儲存"
      >
        <Icon name="logout" className="h-5 w-5" />
      </button>
    </div>
  );
};

export default GoogleAuth;