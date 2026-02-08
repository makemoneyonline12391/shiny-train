
import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isListening: boolean;
  isSpeaking: boolean;
  analyzer?: AnalyserNode;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isListening, isSpeaking, analyzer }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !analyzer) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyzer.getByteFrequencyData(dataArray);

      // Handle high-DPI displays
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const baseRadius = Math.max(0, Math.min(centerX, centerY) * 0.45);

      // Outer Glow
      const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.8, centerX, centerY, baseRadius * 1.8);
      if (isSpeaking) {
        gradient.addColorStop(0, 'rgba(129, 140, 248, 0.2)');
        gradient.addColorStop(1, 'transparent');
      } else if (isListening) {
        gradient.addColorStop(0, 'rgba(34, 197, 94, 0.15)');
        gradient.addColorStop(1, 'transparent');
      } else {
        gradient.addColorStop(0, 'rgba(71, 85, 105, 0.1)');
        gradient.addColorStop(1, 'transparent');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Bars
      const barCount = 48;
      const angleStep = (Math.PI * 2) / barCount;

      for (let i = 0; i < barCount; i++) {
        const barHeight = (dataArray[i % bufferLength] / 255) * (baseRadius * 0.7);
        const angle = i * angleStep;

        const x1 = centerX + Math.cos(angle) * baseRadius;
        const y1 = centerY + Math.sin(angle) * baseRadius;
        const x2 = centerX + Math.cos(angle) * (baseRadius + barHeight);
        const y2 = centerY + Math.sin(angle) * (baseRadius + barHeight);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = isSpeaking ? '#818cf8' : (isListening ? '#4ade80' : '#475569');
        ctx.lineWidth = Math.max(2, baseRadius / 25);
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Core Circle - Fixed: Ensure radius is not negative
      ctx.beginPath();
      ctx.arc(centerX, centerY, Math.max(0, baseRadius - 2), 0, Math.PI * 2);
      ctx.fillStyle = isSpeaking ? '#4f46e5' : (isListening ? '#16a34a' : '#27272a');
      ctx.fill();
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [analyzer, isListening, isSpeaking]);

  return (
    <div className="relative w-full aspect-square max-w-[320px] sm:max-w-[400px] flex items-center justify-center">
      <canvas 
        ref={canvasRef} 
        className="w-full h-full"
      />
      {!isListening && !isSpeaking && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-zinc-600 text-[10px] sm:text-xs font-bold uppercase tracking-[0.3em] animate-pulse">
            Standby
          </div>
        </div>
      )}
    </div>
  );
};
