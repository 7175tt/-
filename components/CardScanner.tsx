
// Add necessary type definitions for experimental APIs which might not be in default TS DOM typings.
declare global {
  interface MediaTrackCapabilities {
    focusMode?: string[];
    exposureMode?: string[];
    torch?: boolean;
  }
  interface MediaTrackConstraints {
    focusMode?: string;
    exposureMode?: string;
    advanced?: MediaTrackConstraintSet[];
  }
  interface MediaTrackConstraintSet {
    torch?: boolean;
    focusMode?: string;
  }
  interface ImageCapture {
    takePhoto(photoSettings?: any): Promise<Blob>;
    getPhotoCapabilities(): Promise<any>;
  }
  var ImageCapture: {
    new (videoTrack: MediaStreamTrack): ImageCapture;
  };
  interface ScreenOrientation {
    lock(orientation: 'landscape' | 'portrait'): Promise<void>;
    unlock(): void;
  }
}

import React, { useRef, useEffect, useState, useCallback } from 'react';
import Icon from './Icon';

interface CardScannerProps {
  onCaptureAndProcess: (base64Image: string) => void;
  onFinish: () => void;
  isConfigError: boolean;
}

const CardScanner: React.FC<CardScannerProps> = ({ onCaptureAndProcess, onFinish, isConfigError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imageCaptureRef = useRef<ImageCapture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTorchSupported, setIsTorchSupported] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);

  const startCamera = useCallback(async () => {
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
    }
    const constraints: MediaStreamConstraints = {
      video: { 
        facingMode: 'environment', 
        width: { ideal: 4096 }, 
        height: { ideal: 2160 } 
      },
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      const videoTrack = stream.getVideoTracks()[0];

      if (typeof ImageCapture !== 'undefined') {
        imageCaptureRef.current = new ImageCapture(videoTrack);
      }
      
      if (videoTrack?.getCapabilities) {
          const capabilities = videoTrack.getCapabilities();
          if (capabilities.torch) setIsTorchSupported(true);
          if (capabilities.focusMode?.includes('continuous')) {
            videoTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
          }
      }
    } catch (err) {
        console.error("Error accessing camera:", err);
        setError('無法存取相機。請檢查瀏覽器權限設定。');
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [startCamera]);
  
  const toggleTorch = useCallback(async () => {
    if (!streamRef.current || !isTorchSupported) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    try {
        await videoTrack.applyConstraints({ advanced: [{ torch: !isTorchOn }] });
        setIsTorchOn(prev => !prev);
    } catch (e) {
        console.error("Failed to toggle torch:", e);
    }
  }, [isTorchOn, isTorchSupported]);

  const handleCapture = useCallback(async () => {
    const videoEl = videoRef.current;
    const guideEl = guideRef.current;
    const canvas = canvasRef.current;
    if (!videoEl || !guideEl || !canvas) return;

    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 300);
    
    const context = canvas.getContext('2d');
    if (!context) return;

    const processAndCrop = async (imageSource: ImageBitmap | HTMLVideoElement) => {
        const sourceWidth = imageSource instanceof HTMLVideoElement ? imageSource.videoWidth : imageSource.width;
        const sourceHeight = imageSource instanceof HTMLVideoElement ? imageSource.videoHeight : imageSource.height;
        
        const viewWidth = videoEl.offsetWidth;
        const viewHeight = videoEl.offsetHeight;

        const guideWidth = guideEl.offsetWidth;
        const guideHeight = guideEl.offsetHeight;
        const guideTop = guideEl.offsetTop;
        const guideLeft = guideEl.offsetLeft;

        const sourceRatio = sourceWidth / sourceHeight;
        const viewRatio = viewWidth / viewHeight;
        
        let scale = 1;
        let offsetX = 0;
        let offsetY = 0;
        
        // This logic handles 'object-cover' behavior
        if (sourceRatio > viewRatio) { // Video is wider than view (letterboxed)
            scale = viewHeight / sourceHeight;
            offsetX = (viewWidth - sourceWidth * scale) / 2;
        } else { // Video is taller than view (pillarboxed)
            scale = viewWidth / sourceWidth;
            offsetY = (viewHeight - sourceHeight * scale) / 2;
        }

        const cropX = (guideLeft - offsetX) / scale;
        const cropY = (guideTop - offsetY) / scale;
        const cropWidth = guideWidth / scale;
        const cropHeight = guideHeight / scale;
        
        // Scale down to a reasonable size for AI processing, preserving detail without hitting proxy size limits
        const outputWidth = Math.min(cropWidth, 1024);
        const outputHeight = cropWidth > 0 ? outputWidth * (cropHeight / cropWidth) : 0;
        
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        
        context.imageSmoothingQuality = 'high';
        context.drawImage(imageSource, cropX, cropY, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82); // Optimized speed/size for proxy transfer and Gemini OCR
        onCaptureAndProcess(dataUrl.split(',')[1]);
    };

    if (imageCaptureRef.current) {
        try {
            const photoCapabilities = await imageCaptureRef.current.getPhotoCapabilities();
            const blob = await imageCaptureRef.current.takePhoto({
                imageWidth: photoCapabilities.imageWidth.max,
                imageHeight: photoCapabilities.imageHeight.max,
            });
            const imageBitmap = await createImageBitmap(blob);
            await processAndCrop(imageBitmap);
            return;
        } catch (e) {
            console.error("ImageCapture API with max resolution failed, falling back to canvas method.", e);
        }
    }
    
    // Fallback if ImageCapture fails or is not available
    await processAndCrop(videoEl);

  }, [onCaptureAndProcess]);

  return (
    <div className={`fixed bg-gray-900 flex flex-col items-center justify-center text-white inset-x-0 bottom-0 ${isConfigError ? 'top-12' : 'top-0'}`}>
        {isFlashing && <div className="absolute inset-0 bg-white z-30 animate-fade-out pointer-events-none"></div>}
        <div className="absolute top-4 left-4 z-20">
          <button onClick={onFinish} className="bg-gray-800/50 px-4 py-2 rounded-full hover:bg-gray-700/70 transition-colors flex items-center gap-2">
            <Icon name="back" className="h-5 w-5" />
            <span className="font-medium text-sm">完成</span>
          </button>
        </div>
        {isTorchSupported && (
          <div className="absolute top-4 right-4 z-20">
              <button 
                onClick={toggleTorch} 
                className="bg-gray-800/50 p-2 rounded-full hover:bg-gray-700/70 transition-colors"
                title={isTorchOn ? '關閉閃光燈' : '開啟閃光燈'}
              >
                  <Icon name={isTorchOn ? 'sun' : 'bolt'} className="h-6 w-6 text-yellow-300" />
              </button>
          </div>
        )}

        <div className="w-full h-full relative flex items-center justify-center">
          {error ? (
            <div className="text-center p-4 bg-red-900/50 rounded-lg">
              <p className="font-bold">發生錯誤</p>
              <p>{error}</p>
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover bg-black"></video>
              <div 
                ref={guideRef}
                className="absolute w-[90%] aspect-[8.5/5.4] border-4 border-white/50 rounded-lg shadow-2xl pointer-events-none"
                style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)'}}
              ></div>
            </>
          )}
        </div>

        <div className="absolute bottom-28 w-full px-4 text-center">
            <div className="bg-black/40 text-white text-sm py-2 px-3 rounded-lg inline-block backdrop-blur-sm">
              <p>將名片對準框線，可連續拍攝</p>
            </div>
        </div>
        
        <div className="absolute bottom-8 flex items-center justify-center w-full z-20">
          <button
            onClick={handleCapture}
            disabled={!!error}
            className="w-20 h-20 rounded-full bg-white/30 border-4 border-white flex items-center justify-center backdrop-blur-sm hover:bg-white/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="拍攝新名片"
          >
            <div className="w-16 h-16 rounded-full bg-white"></div>
          </button>
        </div>
        <canvas ref={canvasRef} className="hidden"></canvas>
    </div>
  );
};

export default CardScanner;
