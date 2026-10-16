import React from 'react';
import { GoogleUser, SyncStatus } from '../types';
import Icon from './Icon';
import Spinner from './Spinner';
import { rememberedGoogleEmail } from '../services/googleSession';

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
        className="w-full flex items-center justify-center gap-2 min-h-11 px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-wait"
        title={isDisabled ? "正在連接 Google 服務" : "登入後自動同步至您的 Google Sheets 與 Drive"}
      >
        <Icon name="google-logo" className="h-5 w-5" />
        <span className="font-medium">{isDisabled ? "連接 Google…" : rememberedGoogleEmail() ? "繼續 Google 登入" : "登入並自動同步"}</span>
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
    <div className="flex items-center justify-between gap-2 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        {user.picture ? (
           <img src={user.picture} alt={user.name} className="h-8 w-8 rounded-full shrink-0" />
        ) : (
          <span className="h-8 w-8 rounded-full bg-gray-600 flex items-center justify-center shrink-0">
             <Icon name="user" className="h-5 w-5 text-gray-400" />
          </span>
        )}
        <div className="min-w-0"><p className="text-sm font-medium text-white truncate">{user.name}</p><p className="text-xs text-gray-400 truncate" title={user.email}>{user.email}</p></div>
        <div className="shrink-0" title={syncStatus}>{getSyncIndicator()}</div>
      </div>
      <button
        onClick={onLogout}
        className="flex items-center justify-center min-h-11 min-w-11 shrink-0 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
        aria-label="登出"
        title="登出並切換回本機儲存"
      >
        <Icon name="logout" className="h-5 w-5" />
      </button>
    </div>
  );
};

export default GoogleAuth;
