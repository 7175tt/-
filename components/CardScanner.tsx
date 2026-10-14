import React, { useRef, useEffect, useState, useCallback } from 'react';
import Icon from './Icon';
import { createStillCamera, getContainedImageRect, getObjectCoverCrop, imageBlobToJpegBase64, imageFileToJpegBase64, imageToJpegBase64, isStillCameraUnsupported, takeHighResolutionPhoto, type StillCamera } from '../utils/cardImage';

interface CardScannerProps {
  onCaptureAndProcess: (base64Image: string) => void;
  onFinish: () => void;
  isConfigError: boolean;
  pendingCount?: number;
  capturedCount?: number;
  activityLabel?: string;
  onManualEntry?: () => void;
}

type CameraCapabilities = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[]; exposureMode?: string[] };
type CameraConstraint = MediaTrackConstraintSet & { torch?: boolean; focusMode?: string; exposureMode?: string };

function cameraErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '相機權限尚未開啟。你可以在瀏覽器設定允許相機，或直接選擇照片。';
  if (name === 'NotFoundError') return '找不到可用的相機，請選擇名片照片。';
  if (name === 'NotReadableError') return '相機可能正被其他程式使用，請關閉其他相機程式後重試。';
  return '無法開啟即時相機。你仍可使用手機相機或選擇照片。';
}

const CardScanner: React.FC<CardScannerProps> = ({ onCaptureAndProcess, onFinish, isConfigError, pendingCount = 0, capturedCount, onManualEntry, activityLabel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stillCameraRef = useRef<StillCamera | null>(null);
  const mountedRef = useRef(false);
  const cameraRequestRef = useRef(0);
  const captureTokenRef = useRef(0);
  const captureInFlightRef = useRef(false);
  const busyRef = useRef(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initiallySettledRef = useRef(false);
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
  const [captureMode, setCaptureMode] = useState<'photo' | 'video' | null>(null);

  const stopCamera = useCallback(() => {
    cameraRequestRef.current++;
    captureTokenRef.current++;
    stillCameraRef.current = null;
    initiallySettledRef.current = false;
    if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (captureInFlightRef.current) {
      captureInFlightRef.current = false;
      busyRef.current = false;
      if (mountedRef.current) { setIsBusy(false); setIsFlashing(false); setUploadProgress(''); }
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (mountedRef.current) {
      setIsReady(false);
      setIsTorchOn(false);
      setIsTorchSupported(false);
      setCaptureMode(null);
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
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
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
      const controls: CameraConstraint = {
        ...(capabilities.focusMode?.includes('continuous') ? { focusMode: 'continuous' } : {}),
        ...(capabilities.exposureMode?.includes('continuous') ? { exposureMode: 'continuous' } : {}),
      };
      if (Object.keys(controls).length) void track.applyConstraints({ advanced: [controls] }).catch(() => {});
      if (!mountedRef.current || request !== cameraRequestRef.current) return;
      stillCameraRef.current = createStillCamera(track);
      setCaptureMode(stillCameraRef.current ? 'photo' : 'video');
      // Let the initial exposure/focus settle once; subsequent photos stay quick.
      readyTimerRef.current = setTimeout(() => {
        if (mountedRef.current && request === cameraRequestRef.current) {
          initiallySettledRef.current = true;
          setIsReady(video.readyState >= 2 && video.videoWidth > 0);
        }
      }, 300);
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
    const video = videoRef.current;
    const resizeGuide = () => {
      if (!preview.clientWidth || !preview.clientHeight) return;
      const frame = getContainedImageRect(video?.videoWidth || 16, video?.videoHeight || 9, preview.getBoundingClientRect());
      setGuideWidth(Math.max(1, Math.min(frame.width * 0.9, frame.height * 0.9 * 85 / 54, 640)));
    };
    resizeGuide();
    const observer = new ResizeObserver(resizeGuide);
    observer.observe(preview);
    video?.addEventListener('resize', resizeGuide);
    video?.addEventListener('loadedmetadata', resizeGuide);
    return () => { observer.disconnect(); video?.removeEventListener('resize', resizeGuide); video?.removeEventListener('loadedmetadata', resizeGuide); };
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

  const handleCapture = async () => {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (busyRef.current || !isReady || !video || !guide || video.readyState < 2 || !video.videoWidth) return;
    busyRef.current = true;
    captureInFlightRef.current = true;
    const token = ++captureTokenRef.current;
    const request = cameraRequestRef.current;
    const isCurrent = () => mountedRef.current && token === captureTokenRef.current && request === cameraRequestRef.current;
    let saved = false;
    setIsBusy(true);
    setUploadError(null);
    try {
      let image: string | undefined;
      const stillCamera = stillCameraRef.current;
      if (stillCamera) {
        setUploadProgress('正在拍攝高畫質照片，請保持穩定…');
        try {
          const photo = await takeHighResolutionPhoto(stillCamera, isCurrent);
          if (!isCurrent()) return;
          // The photo sensor may use a different field of view from the video.
          // Preserve its full frame instead of guessing which pixels to remove.
          image = await imageBlobToJpegBase64(photo);
          if (!isCurrent()) return;
        } catch (error) {
          if (!isCurrent()) return;
          if (!isStillCameraUnsupported(error)) throw new Error('高畫質拍攝未成功，請保持手機穩定後重試，或使用「手機相機」。');
          stillCameraRef.current = null;
          setCaptureMode('video');
          setUploadError('此瀏覽器不支援高畫質拍照，這次使用預覽畫面。若細字不清楚，請改用「手機相機」。');
        }
      }
      if (!image) {
        if (video.readyState < 2 || !video.videoWidth) throw new Error('相機畫面已暫停，請重新開啟相機。');
        const frame = getContainedImageRect(video.videoWidth, video.videoHeight, video.getBoundingClientRect());
        const crop = getObjectCoverCrop(video.videoWidth, video.videoHeight, frame, guide.getBoundingClientRect());
        image = imageToJpegBase64(video, crop, 2560);
      }
      if (!isCurrent()) return;
      onCaptureAndProcess(image);
      saved = true;
      setSessionCount(count => count + 1);
      setUploadProgress('');
      setIsFlashing(true);
      flashTimerRef.current = setTimeout(() => {
        if (!isCurrent()) return;
        captureInFlightRef.current = false;
        busyRef.current = false;
        if (mountedRef.current) { setIsFlashing(false); setIsBusy(false); }
      }, 450);
    } catch (error) {
      if (isCurrent()) setUploadError(error instanceof Error ? error.message : '拍攝失敗，請再試一次。');
    } finally {
      if (!saved && isCurrent()) {
        busyRef.current = false;
        captureInFlightRef.current = false;
        setIsBusy(false);
        setUploadProgress('');
      }
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
      {activityLabel && <p className="shrink-0 px-4 pb-2 text-xs text-blue-300 truncate">活動：{activityLabel}</p>}

      <div ref={previewRef} className="relative flex-1 min-h-24 overflow-hidden bg-black flex items-center justify-center">
        <video ref={videoRef} autoPlay muted playsInline onCanPlay={() => {
          const video = videoRef.current;
          if (initiallySettledRef.current && streamRef.current && video) setIsReady(video.readyState >= 2 && video.videoWidth > 0);
        }} onWaiting={() => setIsReady(false)} className="absolute inset-0 w-full h-full object-contain" aria-label="即時相機預覽" />
        {!cameraError && <div ref={guideRef} className="relative rounded-2xl border-2 border-white/90 pointer-events-none" style={{ width: guideWidth, aspectRatio: '85 / 54', boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }} />}
        {!isReady && !cameraError && <p role="status" className="absolute rounded-xl bg-black/70 px-4 py-3">正在開啟相機…</p>}
        {cameraError && <div className="relative max-w-sm px-6 py-5 text-center"><Icon name="camera" className="mx-auto h-10 w-10 text-gray-400 mb-3" /><p role="status" className="text-sm leading-relaxed">{cameraError}</p><button type="button" onClick={() => void startCamera()} className="mt-4 min-h-11 rounded-xl bg-gray-800 px-5 text-sm">重新開啟相機</button></div>}
        {isFlashing && <div className="absolute inset-0 bg-white/80 pointer-events-none" />}
      </div>

      <footer className="shrink-0 px-4 pt-3 bg-gray-950" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <p className="text-center text-sm text-gray-300">{cameraError ? '每張照片放一張名片，文字越清楚越容易辨識' : captureMode === 'photo' ? '名片盡量填滿框線；照片會保留周圍畫面' : '名片盡量填滿框線；細字可改用「手機相機」'}</p>
        {captureMode && <p className="text-center text-xs text-gray-400 mt-1">{captureMode === 'photo' ? '高畫質拍照 · 請保持穩定，避開反光' : '預覽畫面拍照 · 手機相機可保留更多細節'}</p>}
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
