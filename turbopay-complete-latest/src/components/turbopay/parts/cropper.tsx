"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";

/**
 * Lightweight circular image cropper — no external dependencies.
 * Uses a canvas to render the image with zoom + pan, then crops to a
 * 256x256 circular PNG on confirm.
 */

interface CropperProps {
  imageSrc: string;
  onCancel: () => void;
  onConfirm: (croppedBlob: Blob) => void;
  loading?: boolean;
}

const OUTPUT_SIZE = 256;
const CROP_SIZE = 280;

export function Cropper({ imageSrc, onCancel, onConfirm, loading }: CropperProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const dragStart = React.useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  const drawCanvas = React.useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = CROP_SIZE;
    canvas.height = CROP_SIZE;
    ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
    const scaledW = img.width * zoom;
    const scaledH = img.height * zoom;
    const dx = (CROP_SIZE - scaledW) / 2 + offset.x;
    const dy = (CROP_SIZE - scaledH) / 2 + offset.y;
    ctx.drawImage(img, dx, dy, scaledW, scaledH);
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
  }, [zoom, offset]);

  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const minDim = Math.min(img.width, img.height);
      const initialZoom = CROP_SIZE / minDim;
      setZoom(initialZoom);
      setOffset({ x: 0, y: 0 });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  React.useEffect(() => { drawCanvas(); }, [drawCanvas]);

  const handlePointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setOffset({ x: dragStart.current.offsetX + dx, y: dragStart.current.offsetY + dy });
  };

  const handlePointerUp = () => { setDragging(false); };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = OUTPUT_SIZE;
    outCanvas.height = OUTPUT_SIZE;
    const outCtx = outCanvas.getContext("2d");
    if (!outCtx) return;
    outCtx.save();
    outCtx.beginPath();
    outCtx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    outCtx.clip();
    outCtx.drawImage(canvas, 0, 0, CROP_SIZE, CROP_SIZE, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    outCtx.restore();
    outCanvas.toBlob((blob) => {
      if (blob) onConfirm(blob);
    }, "image/jpeg", 0.9);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust your photo</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <div
            className="relative touch-none select-none rounded-full overflow-hidden border-4 border-background shadow-lg"
            style={{ width: CROP_SIZE, height: CROP_SIZE, cursor: dragging ? "grabbing" : "grab" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <canvas ref={canvasRef} className="block" />
          </div>
          <div className="flex items-center gap-3">
            <Button size="icon" variant="outline" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground w-12 text-center">{Math.round(zoom * 100)}%</span>
            <Button size="icon" variant="outline" onClick={() => setZoom((z) => Math.min(5, z + 0.1))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Uploading…</> : "Save Photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
