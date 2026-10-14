import React, { useRef, useEffect, useState, useCallback } from 'react';
import Icon from './Icon';
import { getObjectCoverCrop, imageFileToJpegBase64, imageToJpegBase64 } from '../utils/cardImage';

interface CardScannerProps {
  onCaptureAndProcess: (base64Image: string) => void;
  onFinish: () => void;
  isConfigError: boolean;
  pendingCount?: number;
  capturedCount?: number;
  onManualEntry?: () => void;
}

type CameraCapabilities = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
type CameraConstraint = MediaTrackConstraintSet & { torch?: boolean; focusMode?: string };

function cameraErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '相機權限尚未開啟。你可以在瀏覽器設定允許相機，或直接選擇照片。';
  if (name === 'NotFoundError') return '找不到可用的相機，請選擇名片照片。';
  if (name === 'NotReadableError') return '相機可能正被其他程式使用，請關閉其他相機程式後重試。';
  return '無法開啟即時相機。你仍可使用手機相機或選擇照片。';
}

const CardScanner: React.FC<CardScannerProps> = ({ onCaptureAndProcess, onFinish, isConfigError, pendingCount = 0, capturedCount, onManualEntry }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(false);
  const cameraRequestRef = useRef(0);
  const busyRef = useRef(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isTorchSupported, setIsTorchSupported] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [sessionCount, setSessionCount] = useState(0);
  const [guideWidth, setGuideWidth] = useState(280);

  const stopCamera = useCallback(() => {
    cameraRequestRef.current++;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (mountedRef.current) {
      setIsReady(false);
      setIsTorchOn(false);
      setIsTorchSupported(false);
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    const request = cameraRequestRef.current;
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('這個瀏覽器無法開啟即時相機，請使用手機相機或選擇照片。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      });
      if (!mountedRef.current || request !== cameraRequestRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stopCamera(); return; }
      video.srcObject = stream;
      await video.play();
      if (!mountedRef.current || request !== cameraRequestRef.current) return;
      const track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', () => {
        if (streamRef.current === stream && mountedRef.current) {
          stopCamera();
          setCameraError('相機已暫停，請重新開啟相機或選擇照片。');
        }
      }, { once: true });
      let capabilities: CameraCapabilities = {};
      try { capabilities = track?.getCapabilities?.() || {}; } catch { /* Optional camera controls. */ }
      setIsTorchSupported(!!capabilities.torch);
      if (capabilities.focusMode?.includes('continuous')) {
        const constraints: CameraConstraint = { focusMode: 'continuous' };
        // Focus support varies by phone; it must never prevent capture.
        void track.applyConstraints({ advanced: [constraints] }).catch(() => {});
      }
    } catch (error) {
      if (mountedRef.current && request === cameraRequestRef.current) {
        stopCamera();
        setCameraError(cameraErrorMessage(error));
      }
    }
  }, [stopCamera]);

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') stopCamera();
      else if (!streamRef.current) void startCamera();
    };
    const handlePageRestore = (event: PageTransitionEvent) => {
      if (event.persisted && document.visibilityState === 'visible' && !streamRef.current) void startCamera();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', stopCamera);
    window.addEventListener('pageshow', handlePageRestore);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', stopCamera);
      window.removeEventListener('pageshow', handlePageRestore);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const resizeGuide = () => setGuideWidth(Math.max(1, Math.min(preview.clientWidth * 0.88, preview.clientHeight * 0.8 * 85 / 54, 640)));
    resizeGuide();
    const observer = new ResizeObserver(resizeGuide);
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !isTorchSupported) return;
    try {
      const constraints: CameraConstraint = { torch: !isTorchOn };
      await track.applyConstraints({ advanced: [constraints] });
      if (mountedRef.current) setIsTorchOn(value => !value);
    } catch {
      setUploadError('這個相機暫時無法切換補光燈，請移到光線充足的地方拍攝。');
    }
  };

  const handleCapture = () => {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (busyRef.current || !isReady || !video || !guide || video.readyState < 2 || !video.videoWidth) return;
    busyRef.current = true;
    setIsBusy(true);
    setUploadError(null);
    try {
      // Capture the displayed video frame. A still photo can have a different field of view.
      const crop = getObjectCoverCrop(video.videoWidth, video.videoHeight, video.getBoundingClientRect(), guide.getBoundingClientRect());
      onCaptureAndProcess(imageToJpegBase64(video, crop));
      setSessionCount(count => count + 1);
      setIsFlashing(true);
      flashTimerRef.current = setTimeout(() => {
        busyRef.current = false;
        if (mountedRef.current) { setIsFlashing(false); setIsBusy(false); }
      }, 450);
    } catch (error) {
      busyRef.current = false;
      setIsBusy(false);
      setUploadError(error instanceof Error ? error.message : '拍攝失敗，請再試一次。');
    }
  };

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    setUploadError(null);
    const failures: string[] = [];
    for (let index = 0; index < files.length && mountedRef.current; index++) {
      setUploadProgress(`準備照片 ${index + 1} / ${files.length}`);
      try {
        const base64 = await imageFileToJpegBase64(files[index]);
        if (!mountedRef.current) break;
        onCaptureAndProcess(base64);
        setSessionCount(count => count + 1);
      } catch (error) {
        failures.push(`${files[index].name}：${error instanceof Error ? error.message : '無法讀取照片。'}`);
      }
    }
    busyRef.current = false;
    if (mountedRef.current) {
      setIsBusy(false);
      setUploadProgress('');
      setUploadError(failures.length ? failures.join('；') : null);
    }
  };

  const total = capturedCount ?? sessionCount;
  return (
    <section aria-label="掃描名片" className={`fixed z-30 bg-gray-950 flex flex-col text-white inset-x-0 bottom-0 ${isConfigError ? 'top-12' : 'top-0'}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 bg-gray-950" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <button type="button" onClick={onFinish} disabled={isBusy} className="min-h-11 flex items-center gap-1 rounded-xl bg-gray-800 px-3 text-sm font-semibold disabled:opacity-50">
          <Icon name="back" className="h-5 w-5" />完成{total > 0 ? `（${total}）` : ''}
        </button>
        <div className="text-right"><h1 className="font-semibold">掃描名片</h1><p className="text-xs text-gray-400">拍攝 → 核對 → 儲存</p></div>
        {isTorchSupported && <button type="button" onClick={toggleTorch} aria-label={isTorchOn ? '關閉補光燈' : '開啟補光燈'} aria-pressed={isTorchOn} className="min-h-11 min-w-11 flex items-center justify-center rounded-full bg-gray-800"><Icon name={isTorchOn ? 'sun' : 'bolt'} className="h-6 w-6 text-yellow-300" /></button>}
      </header>

      <div ref={previewRef} className="relative flex-1 min-h-24 overflow-hidden bg-black flex items-center justify-center">
        <video ref={videoRef} autoPlay muted playsInline onCanPlay={() => setIsReady(!!videoRef.current?.videoWidth)} className="absolute inset-0 w-full h-full object-cover" aria-label="即時相機預覽" />
        {!cameraError && <div ref={guideRef} className="relative rounded-2xl border-2 border-white/90 pointer-events-none" style={{ width: guideWidth, aspectRatio: '85 / 54', boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }} />}
        {!isReady && !cameraError && <p role="status" className="absolute rounded-xl bg-black/70 px-4 py-3">正在開啟相機…</p>}
        {cameraError && <div className="relative max-w-sm px-6 py-5 text-center"><Icon name="camera" className="mx-auto h-10 w-10 text-gray-400 mb-3" /><p role="status" className="text-sm leading-relaxed">{cameraError}</p><button type="button" onClick={() => void startCamera()} className="mt-4 min-h-11 rounded-xl bg-gray-800 px-5 text-sm">重新開啟相機</button></div>}
        {isFlashing && <div className="absolute inset-0 bg-white/80 pointer-events-none" />}
      </div>

      <footer className="shrink-0 px-4 pt-3 bg-gray-950" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <p className="text-center text-sm text-gray-300">{cameraError ? '每張照片放一張名片，文字越清楚越容易辨識' : '將名片完整對準框線，避開反光，可連續拍攝'}</p>
        <p role="status" aria-live="polite" className="min-h-6 mt-1 text-center text-xs text-blue-300">{uploadProgress || (pendingCount > 0 ? `${pendingCount} 張正在辨識，可以繼續拍攝` : total > 0 ? `已加入 ${total} 張，按「完成」核對內容` : '也可以從相簿一次選擇多張照片')}</p>
        {uploadError && <p role="alert" className="mx-auto max-w-xl max-h-20 overflow-y-auto rounded-lg bg-red-950 px-3 py-2 mb-2 text-sm text-red-200">{uploadError}</p>}
        <div className="mx-auto max-w-md flex items-center justify-between gap-3 py-2">
          <button type="button" disabled={isBusy} onClick={() => galleryRef.current?.click()} className="min-h-14 min-w-20 flex flex-col items-center justify-center gap-1 rounded-xl px-3 text-sm disabled:opacity-50"><Icon name="upload" className="h-6 w-6" />選擇照片</button>
          <button type="button" onClick={handleCapture} disabled={!isReady || isBusy || !!cameraError} aria-label="拍攝新名片" className="h-16 w-16 shrink-0 rounded-full border-4 border-white p-1 disabled:opacity-35 disabled:cursor-not-allowed"><span className="block w-full h-full rounded-full bg-white" /></button>
          <button type="button" disabled={isBusy} onClick={() => nativeCameraRef.current?.click()} className="min-h-14 min-w-20 flex flex-col items-center justify-center gap-1 rounded-xl px-3 text-sm disabled:opacity-50"><Icon name="camera" className="h-6 w-6" />手機相機</button>
        </div>
        {onManualEntry && <button type="button" disabled={isBusy} onClick={onManualEntry} className="block mx-auto min-h-10 px-4 text-sm text-gray-300 underline underline-offset-4 disabled:opacity-50">手動輸入名片</button>}
      </footer>
      <input ref={galleryRef} type="file" accept="image/*" multiple onChange={handleFiles} className="hidden" aria-label="從相簿選擇名片照片" />
      <input ref={nativeCameraRef} type="file" accept="image/*" capture="environment" onChange={handleFiles} className="hidden" aria-label="使用手機相機拍攝名片" />
    </section>
  );
};

export default CardScanner;
