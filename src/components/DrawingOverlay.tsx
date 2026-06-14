import React, { useRef, useState, useEffect } from 'react';
import { X, Undo, Redo, Trash2, Sparkles, Check, Edit, Paintbrush } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

interface DrawingOverlayProps {
  imageUrl: string;
  mimeType: string;
  onSave: (newBase64: string) => void;
  onClose: () => void;
}

export default function DrawingOverlay({ imageUrl, mimeType, onSave, onClose }: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Drawing state variables
  const [isDrawing, setIsDrawing] = useState(false);
  const [colorHex, setColorHex] = useState('#ef4444'); // default red (for key resistance level)
  const [isHighlighter, setIsHighlighter] = useState(false);
  const [brushWidth, setBrushWidth] = useState(5);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoList, setRedoList] = useState<Stroke[]>([]);

  // Selected preset colors
  const colorPresets = [
    { name: 'Red', hex: '#ef4444' },     // Resistance
    { name: 'Green', hex: '#22c55e' },   // Support
    { name: 'Yellow', hex: '#eab308' },  // Highlight
    { name: 'White', hex: '#ffffff' },   // Reference level
    { name: 'Blue', hex: '#3b82f6' },    // Custom patterns
  ];

  // Helper to get selected color with opacity if highlighter mode is on
  const getActiveColorString = (hex: string, highlightMode: boolean) => {
    if (!highlightMode) return hex;
    // convert hex to rgba
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, 0.45)`;
  };

  const currentColor = getActiveColorString(colorHex, isHighlighter);

  // Load image on mount
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Handle canvas resize and drawing when image is loaded, or strokes change
  useEffect(() => {
    if (!imageLoaded || !imageRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = imageRef.current;
    
    // Calculate dimensions to fit nicely within screen bounds
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const maxW = Math.min(1000, screenW - 48); // margins
    const maxH = Math.min(600, screenH - 240); // header/footer spacing

    let drawW = img.naturalWidth;
    let drawH = img.naturalHeight;

    const ratio = drawW / drawH;

    if (drawW > maxW) {
      drawW = maxW;
      drawH = drawW / ratio;
    }
    if (drawH > maxH) {
      drawH = maxH;
      drawW = drawH * ratio;
    }

    // Set canvas internal resolution to matching fit
    canvas.width = drawW;
    canvas.height = drawH;

    // Clear and draw image
    ctx.clearRect(0, 0, drawW, drawH);
    ctx.drawImage(img, 0, 0, drawW, drawH);

    // Draw all strokes
    strokes.forEach(stroke => {
      if (stroke.points.length < 1) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });
  }, [imageLoaded, strokes]);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): Point | null => {
    if (!canvasRef.current) return null;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    let clientX: number;
    let clientY: number;

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Account for canvas actual scaling inside its client bounds
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (e.cancelable) {
      e.preventDefault();
    }
    const coords = getCoordinates(e);
    if (!coords) return;

    setIsDrawing(true);
    setRedoList([]); // clear redo state on new activity

    const newStroke: Stroke = {
      points: [coords],
      color: currentColor,
      width: brushWidth
    };

    setStrokes(prev => [...prev, newStroke]);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || strokes.length === 0) return;
    if (e.cancelable) {
      e.preventDefault();
    }

    const coords = getCoordinates(e);
    if (!coords) return;

    setStrokes(prev => {
      const copy = [...prev];
      const lastIdx = copy.length - 1;
      copy[lastIdx] = {
        ...copy[lastIdx],
        points: [...copy[lastIdx].points, coords]
      };
      return copy;
    });
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleUndo = () => {
    if (strokes.length === 0) return;
    const copy = [...strokes];
    const removed = copy.pop();
    setStrokes(copy);
    if (removed) {
      setRedoList(prev => [...prev, removed]);
    }
  };

  const handleRedo = () => {
    if (redoList.length === 0) return;
    const copy = [...redoList];
    const added = copy.pop();
    setRedoList(copy);
    if (added) {
      setStrokes(prev => [...prev, added]);
    }
  };

  const handleClear = () => {
    if (strokes.length === 0) return;
    setStrokes([]);
    setRedoList([]);
  };

  const handleSave = () => {
    if (!canvasRef.current) return;
    try {
      const exportType = mimeType || 'image/png';
      const dataUrl = canvasRef.current.toDataURL(exportType, 0.92);
      const match = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
      if (match && match[2]) {
        onSave(match[2]);
      } else {
        console.error("Failed to parse drawn data URL:", dataUrl);
      }
    } catch (err) {
      console.error("Failed to export annotated image from canvas context:", err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-50 flex flex-col outline-none" id="drawing-overlay-modal" tabIndex={-1}>
      {/* Header Controls bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0 bg-zinc-950">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#F95C4B]/20 flex items-center justify-center">
            <Paintbrush className="w-4 h-4 text-[#F95C4B]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white tracking-wide">Annotate Chart Pattern</h3>
            <p className="text-[10px] text-zinc-400 font-mono">HIGHLIGHT TRENDS, INDICATORS, OR SUPPORT LEVELS</p>
          </div>
        </div>

        {/* Toolbar Center Actions */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleUndo}
            disabled={strokes.length === 0}
            className="p-2 rounded-lg bg-zinc-900 border border-white/5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-zinc-900 cursor-pointer transition-colors"
            title="Undo"
          >
            <Undo className="w-4 h-4" />
          </button>
          <button
            onClick={handleRedo}
            disabled={redoList.length === 0}
            className="p-2 rounded-lg bg-zinc-900 border border-white/5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-zinc-900 cursor-pointer transition-colors"
            title="Redo"
          >
            <Redo className="w-4 h-4" />
          </button>
          <button
            onClick={handleClear}
            disabled={strokes.length === 0}
            className="p-2 rounded-lg bg-zinc-900 border border-red-950 text-red-400 hover:bg-red-950/40 disabled:opacity-40 disabled:hover:bg-zinc-900 cursor-pointer transition-colors"
            title="Clear all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-900 border border-white/10 hover:bg-zinc-800 hover:text-white transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#F95C4B] hover:brightness-110 active:scale-95 transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            Apply Changes
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div 
        ref={containerRef} 
        className="flex-1 overflow-hidden flex items-center justify-center p-6 bg-zinc-900/60 relative"
      >
        {!imageLoaded && (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full border-2 border-[#F95C4B] border-t-transparent animate-spin"></div>
            <p className="text-xs font-mono text-zinc-400">Loading original canvas setup...</p>
          </div>
        )}
        <div className="relative border border-white/10 rounded-xl overflow-hidden shadow-2xl bg-zinc-950 max-w-full max-h-full">
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            className="block cursor-crosshair max-w-full max-h-full touch-none select-none"
          />
        </div>
      </div>

      {/* Footer Settings bar */}
      <div className="px-6 py-4 border-t border-white/10 shrink-0 bg-zinc-950 flex flex-wrap items-center justify-between gap-4">
        {/* Color Presets */}
        <div className="flex items-center gap-4">
          <span className="text-xs font-mono text-zinc-400 uppercase tracking-widest">Active Pen Color:</span>
          <div className="flex items-center gap-2">
            {colorPresets.map((preset) => {
              const isActive = colorHex === preset.hex;
              return (
                <button
                  key={preset.name}
                  onClick={() => setColorHex(preset.hex)}
                  className={`w-6 h-6 rounded-full border transition-all cursor-pointer ${
                    isActive 
                      ? 'ring-2 ring-offset-2 ring-offset-black ring-white border-white scale-110' 
                      : 'border-white/20 hover:scale-105'
                  }`}
                  style={{ backgroundColor: preset.hex }}
                  title={`${preset.name} Color`}
                />
              );
            })}
          </div>
        </div>

        {/* Drawing Settings Tool (Pen vs Highlighter toggle and Brush size) */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5 p-1 bg-zinc-900 border border-white/10 rounded-lg">
            <button
              onClick={() => setIsHighlighter(false)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                !isHighlighter 
                  ? 'bg-[#F95C4B] text-white' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Edit className="w-3.5 h-3.5" />
              Solid Pen
            </button>
            <button
              onClick={() => setIsHighlighter(true)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                isHighlighter 
                  ? 'bg-[#F95C4B] text-white' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Highlighter
            </button>
          </div>

          {/* Brush thickness */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-zinc-400">Brush Size:</span>
            <div className="flex items-center gap-1.5">
              {[2, 5, 10, 18, 30].map((size) => {
                const isActive = brushWidth === size;
                return (
                  <button
                    key={size}
                    onClick={() => setBrushWidth(size)}
                    className={`h-7 px-2.5 rounded-lg text-[11px] font-mono border transition-all cursor-pointer flex items-center justify-center ${
                      isActive
                        ? 'bg-white border-white text-zinc-950 font-bold'
                        : 'bg-zinc-900 border-white/10 text-zinc-400 hover:text-white hover:border-white/30'
                    }`}
                  >
                    {size}px
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
