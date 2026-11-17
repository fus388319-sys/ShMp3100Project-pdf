import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Award,
  BookOpen,
  Camera,
  CheckCircle2,
  Code2,
  CreditCard,
  Crop,
  Crosshair,
  Download,
  Eye,
  FileCheck2,
  FileCode2,
  FileImage,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Focus,
  Hash,
  Image as ImageIcon,
  Layers,
  ListOrdered,
  Lock,
  MoreHorizontal,
  PenTool,
  Plus,
  Presentation,
  Receipt,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ScanLine,
  Scissors,
  ShieldCheck,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Stamp,
  Trash2,
  Upload,
  Wand2,
  X,
  Zap,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ============================================================================
// Types & Interfaces
// ============================================================================

type WorkspaceSection = 'all-tools' | 'image-scan' | 'toolkit' | 'templates';
type ScanStudioStep = 'scan' | 'edit' | 'finish';
type ScanCategory = 'Doc' | 'ID' | 'Receipt' | 'Book';
type EditTab = 'crop' | 'filter' | 'arrange' | 'index' | 'stamp';
type ScanFilter = 'original' | 'crisp' | 'grayscale' | 'bw';
type PageSizeOption = 'a4' | 'letter' | 'fit';
type MarginOption = 'none' | 'compact' | 'standard';
type WatermarkPlacement = 'diagonal' | 'footer';
type TemplateKind = 'invoice' | 'brief' | 'certificate';

type PdfToolkitTool =
  | 'word-to-pdf'
  | 'ppt-to-pdf'
  | 'excel-to-pdf'
  | 'html-to-pdf'
  | 'txt-to-pdf'
  | 'pdf-to-word'
  | 'pdf-to-image'
  | 'pdf-to-ppt'
  | 'pdf-to-excel'
  | 'sign'
  | 'ocr'
  | 'protect'
  | 'merge'
  | 'split'
  | 'rotate'
  | 'watermark'
  | 'page-numbers'
  | 'metadata';

interface CropBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface ScannedPage {
  id: string;
  rawUrl: string;
  processedUrl: string;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  crop: CropBox;
  filter: ScanFilter;
  brightness: number;
  contrast: number;
  category: ScanCategory;
  source: 'camera' | 'gallery';
  label: string;
}

interface IndexEntry {
  id: string;
  pageNumber: number;
  heading: string;
  summary: string;
}

interface DetectedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

interface QueuedPdfItem {
  id: string;
  file: File;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  title: string;
  author: string;
}

interface GeneratedPdfResult {
  blob: Blob;
  url: string;
  filename: string;
  pageCount: number;
  sizeBytes: number;
}

interface ExportRecord {
  id: string;
  filename: string;
  url: string;
  sizeBytes: number;
  pageCount: number;
  createdAt: string;
}

interface ConvertedPreviewOutput {
  title: string;
  textPreview?: string;
  images?: { pageNumber: number; url: string }[];
  downloadUrl: string;
  downloadName: string;
  secondaryUrl?: string;
  secondaryName?: string;
}

interface InvoiceLineItem {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
}

interface ToastMessage {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

// ============================================================================
// Constants
// ============================================================================

const ACCEPTED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
]);

const SCAN_CATEGORIES: {
  id: ScanCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'Doc', label: 'Doc', icon: FileText },
  { id: 'ID', label: 'ID', icon: CreditCard },
  { id: 'Receipt', label: 'Receipt', icon: Receipt },
  { id: 'Book', label: 'Book', icon: BookOpen },
];

const EDIT_TABS: {
  id: EditTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'crop', label: '1. Auto Crop', icon: Crop },
  { id: 'filter', label: '2. Scan Filter', icon: Sliders },
  { id: 'arrange', label: '3. Rotate & Order', icon: RotateCw },
  { id: 'index', label: '4. Index & Rename', icon: ListOrdered },
  { id: 'stamp', label: '5. Stamp & Page', icon: Stamp },
];

interface WorkspaceToolDef {
  id: PdfToolkitTool;
  label: string;
  group: 'Convert to PDF' | 'Convert from PDF' | 'Manage & Edit PDF';
  description: string;
  badgeColor: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TOOLKIT_ITEMS: WorkspaceToolDef[] = [
  {
    id: 'txt-to-pdf',
    label: 'TXT & Notes to PDF',
    group: 'Convert to PDF',
    description: 'Turn text notes into clean vector PDFs',
    badgeColor: 'bg-blue-600',
    icon: FileText,
  },
  {
    id: 'word-to-pdf',
    label: 'Word to PDF',
    group: 'Convert to PDF',
    description: 'Convert .docx or prose into clean A4 PDFs',
    badgeColor: 'bg-violet-600',
    icon: FileText,
  },
  {
    id: 'ppt-to-pdf',
    label: 'PPT to PDF',
    group: 'Convert to PDF',
    description: 'Convert .pptx decks into 16:9 PDF slides',
    badgeColor: 'bg-rose-600',
    icon: Presentation,
  },
  {
    id: 'excel-to-pdf',
    label: 'Excel to PDF',
    group: 'Convert to PDF',
    description: 'Convert .xlsx or CSV tables into bordered PDFs',
    badgeColor: 'bg-emerald-600',
    icon: FileSpreadsheet,
  },
  {
    id: 'html-to-pdf',
    label: 'HTML to PDF',
    group: 'Convert to PDF',
    description: 'Convert .html markup into structured PDFs',
    badgeColor: 'bg-amber-600',
    icon: FileCode2,
  },
  {
    id: 'pdf-to-word',
    label: 'PDF to Word',
    group: 'Convert from PDF',
    description: 'Extract PDF text into editable .doc & .txt',
    badgeColor: 'bg-blue-600',
    icon: FileText,
  },
  {
    id: 'pdf-to-image',
    label: 'PDF to Image',
    group: 'Convert from PDF',
    description: 'Render PDF pages to PNG images (.zip pack)',
    badgeColor: 'bg-purple-600',
    icon: ImageIcon,
  },
  {
    id: 'pdf-to-ppt',
    label: 'PDF to PPT',
    group: 'Convert from PDF',
    description: 'Export PDF pages as interactive HTML slides',
    badgeColor: 'bg-orange-600',
    icon: Presentation,
  },
  {
    id: 'pdf-to-excel',
    label: 'PDF to Excel',
    group: 'Convert from PDF',
    description: 'Extract PDF rows into structured .csv sheets',
    badgeColor: 'bg-teal-600',
    icon: FileSpreadsheet,
  },
  {
    id: 'merge',
    label: 'Merge PDFs',
    group: 'Manage & Edit PDF',
    description: 'Combine multiple PDF documents in order',
    badgeColor: 'bg-violet-600',
    icon: Layers,
  },
  {
    id: 'split',
    label: 'Split & Extract',
    group: 'Manage & Edit PDF',
    description: 'Extract page ranges (e.g. 1-3, 5) to PDF',
    badgeColor: 'bg-rose-600',
    icon: Scissors,
  },
  {
    id: 'rotate',
    label: 'Rotate Pages',
    group: 'Manage & Edit PDF',
    description: 'Rotate chosen PDF pages 90°, 180°, or 270°',
    badgeColor: 'bg-amber-600',
    icon: RotateCw,
  },
  {
    id: 'sign',
    label: 'Sign PDF',
    group: 'Manage & Edit PDF',
    description: 'Draw or type your signature on PDF pages',
    badgeColor: 'bg-indigo-600',
    icon: PenTool,
  },
  {
    id: 'ocr',
    label: 'OCR & Auto-Index',
    group: 'Manage & Edit PDF',
    description: 'Analyze PDF pages to detect title & index',
    badgeColor: 'bg-cyan-600',
    icon: Wand2,
  },
  {
    id: 'protect',
    label: 'Protect & Lock',
    group: 'Manage & Edit PDF',
    description: 'Add confidentiality stamp & clean metadata',
    badgeColor: 'bg-emerald-600',
    icon: ShieldCheck,
  },
  {
    id: 'watermark',
    label: 'Watermark Stamp',
    group: 'Manage & Edit PDF',
    description: 'Stamp ShMp3100 Tool PDFMR across pages',
    badgeColor: 'bg-purple-600',
    icon: Stamp,
  },
  {
    id: 'page-numbers',
    label: 'Page Numbers',
    group: 'Manage & Edit PDF',
    description: 'Stamp crisp page numbers on every page',
    badgeColor: 'bg-sky-600',
    icon: Hash,
  },
  {
    id: 'metadata',
    label: 'Metadata & Clean',
    group: 'Manage & Edit PDF',
    description: 'Edit embedded PDF title & author info',
    badgeColor: 'bg-slate-700',
    icon: SlidersHorizontal,
  },
];

// ============================================================================
// Computer Vision: Document Boundary Auto-Detection & Auto-Crop
// ============================================================================

function detectDocumentBoundsFromCanvas(
  canvas: HTMLCanvasElement
): DetectedBox | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const w = canvas.width;
  const h = canvas.height;
  if (w < 40 || h < 40) return null;

  const { data } = ctx.getImageData(0, 0, w, h);

  let bgSum = 0;
  let bgCount = 0;
  for (let x = 0; x < w; x += 2) {
    const topIdx = (2 * w + x) * 4;
    const botIdx = ((h - 3) * w + x) * 4;
    bgSum += 0.299 * data[topIdx] + 0.587 * data[topIdx + 1] + 0.114 * data[topIdx + 2];
    bgSum += 0.299 * data[botIdx] + 0.587 * data[botIdx + 1] + 0.114 * data[botIdx + 2];
    bgCount += 2;
  }
  const bgLum = bgCount > 0 ? bgSum / bgCount : 40;

  let centerSum = 0;
  let centerCount = 0;
  const cxStart = Math.floor(w * 0.3);
  const cxEnd = Math.floor(w * 0.7);
  const cyStart = Math.floor(h * 0.3);
  const cyEnd = Math.floor(h * 0.7);
  for (let y = cyStart; y < cyEnd; y += 3) {
    for (let x = cxStart; x < cxEnd; x += 3) {
      const idx = (y * w + x) * 4;
      centerSum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      centerCount++;
    }
  }
  const centerLum = centerCount > 0 ? centerSum / centerCount : 160;
  const contrastDelta = Math.abs(centerLum - bgLum);

  if (contrastDelta < 18) return null;

  const threshold = bgLum + (centerLum - bgLum) * 0.42;
  const targetBrighter = centerLum > bgLum;

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let hitCount = 0;

  const padX = Math.floor(w * 0.04);
  const padY = Math.floor(h * 0.04);

  for (let y = padY; y < h - padY; y += 2) {
    for (let x = padX; x < w - padX; x += 2) {
      const idx = (y * w + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      const isDoc = targetBrighter ? lum >= threshold : lum <= threshold;
      if (isDoc) {
        hitCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const boxW = (maxX - minX) / w;
  const boxH = (maxY - minY) / h;
  const areaRatio = boxW * boxH;

  if (hitCount < 80 || boxW < 0.22 || boxH < 0.22 || areaRatio > 0.92) {
    return null;
  }

  const nx = Math.max(0.02, minX / w - 0.015);
  const ny = Math.max(0.02, minY / h - 0.015);
  const nw = Math.min(0.96 - nx, boxW + 0.03);
  const nh = Math.min(0.96 - ny, boxH + 0.03);

  return {
    x: nx,
    y: ny,
    w: nw,
    h: nh,
    confidence: Math.min(1, contrastDelta / 85),
  };
}

function readImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to load image.'));
    img.src = src;
  });
}

async function autoDetectCropBoxFromUrl(src: string): Promise<CropBox> {
  const img = await readImageElement(src);
  const sampleW = 180;
  const sampleH = Math.max(
    100,
    Math.round(sampleW * ((img.naturalHeight || 4) / (img.naturalWidth || 3)))
  );

  const canvas = document.createElement('canvas');
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { top: 0, right: 0, bottom: 0, left: 0 };

  ctx.drawImage(img, 0, 0, sampleW, sampleH);
  const box = detectDocumentBoundsFromCanvas(canvas);
  if (!box) return { top: 0, right: 0, bottom: 0, left: 0 };

  return {
    top: Math.min(0.35, Math.max(0, Number(box.y.toFixed(3)))),
    left: Math.min(0.35, Math.max(0, Number(box.x.toFixed(3)))),
    right: Math.min(0.35, Math.max(0, Number((1 - (box.x + box.w)).toFixed(3)))),
    bottom: Math.min(0.35, Math.max(0, Number((1 - (box.y + box.h)).toFixed(3)))),
  };
}

function computeFrameFocusScore(
  canvas: HTMLCanvasElement,
  box: DetectedBox | null
): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 32 || h < 32) return 0;

  const { data } = ctx.getImageData(0, 0, w, h);
  const startX = Math.max(2, Math.floor((box ? box.x : 0.18) * w));
  const endX = Math.min(w - 2, Math.floor((box ? box.x + box.w : 0.82) * w));
  const startY = Math.max(2, Math.floor((box ? box.y : 0.18) * h));
  const endY = Math.min(h - 2, Math.floor((box ? box.y + box.h : 0.82) * h));

  let gradSum = 0;
  let count = 0;
  for (let y = startY; y < endY; y += 2) {
    for (let x = startX; x < endX; x += 2) {
      const idx = (y * w + x) * 4;
      const rightIdx = (y * w + (x + 1)) * 4;
      const downIdx = ((y + 1) * w + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      const lumR =
        0.299 * data[rightIdx] + 0.587 * data[rightIdx + 1] + 0.114 * data[rightIdx + 2];
      const lumD =
        0.299 * data[downIdx] + 0.587 * data[downIdx + 1] + 0.114 * data[downIdx + 2];
      gradSum += Math.abs(lum - lumR) + Math.abs(lum - lumD);
      count++;
    }
  }

  if (count === 0) return 0;
  const avgGrad = gradSum / count;
  return Math.min(100, Math.max(0, Math.round((avgGrad / 22) * 100)));
}

interface AiDetectCropResponse {
  documentDetected?: boolean;
  focusQuality?: 'sharp' | 'moderate' | 'blurry';
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  documentTitle?: string;
  pageHeading?: string;
  recommendedFilter?: ScanFilter;
}

async function requestAiDetectAndCrop(
  imageUrl: string,
  scanMode: ScanCategory
): Promise<AiDetectCropResponse> {
  let payloadUrl = imageUrl;
  // Always resize down to 640px JPEG (q=0.72) for fast <1s AI edge detection
  const img = await readImageElement(imageUrl);
  const maxDim = 640;
  const natW = img.naturalWidth || 1200;
  const natH = img.naturalHeight || 1600;
  const scale = Math.min(1, maxDim / Math.max(natW, natH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(natW * scale));
  canvas.height = Math.max(1, Math.round(natH * scale));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    payloadUrl = canvas.toDataURL('image/jpeg', 0.72);
  }

  const commaIdx = payloadUrl.indexOf(',');
  const imageBase64 = commaIdx >= 0 ? payloadUrl.slice(commaIdx + 1) : payloadUrl;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('/api/ai-detect-crop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        imageBase64,
        mimeType: 'image/jpeg',
        scanMode,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data?.error === 'string'
          ? data.error
          : 'AI document detection service failed.'
      );
    }
    return data as AiDetectCropResponse;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function renderProcessedPage(
  rawUrl: string,
  crop: CropBox,
  rotation: 0 | 90 | 180 | 270,
  filter: ScanFilter,
  brightness: number,
  contrast: number
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await readImageElement(rawUrl);
  const natW = img.naturalWidth || img.width || 1200;
  const natH = img.naturalHeight || img.height || 1600;

  const sx = Math.round(natW * crop.left);
  const sy = Math.round(natH * crop.top);
  const sw = Math.max(40, Math.round(natW * (1 - crop.left - crop.right)));
  const sh = Math.max(40, Math.round(natH * (1 - crop.top - crop.bottom)));

  // Cap output resolution to 1500px longest side for instant ~20ms canvas export
  const capScale = Math.min(1, 1500 / Math.max(sw, sh));
  const dw = Math.max(40, Math.round(sw * capScale));
  const dh = Math.max(40, Math.round(sh * capScale));

  const swap = rotation === 90 || rotation === 270;
  const outW = swap ? dh : dw;
  const outH = swap ? dw : dh;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotation * Math.PI) / 180);

  let filterStr = `brightness(${brightness}%) contrast(${contrast}%)`;
  if (filter === 'crisp') {
    filterStr = `brightness(${Math.min(155, brightness + 8)}%) contrast(${Math.min(185, contrast + 26)}%) saturate(112%)`;
  } else if (filter === 'grayscale') {
    filterStr = `grayscale(100%) brightness(${brightness}%) contrast(${Math.min(180, contrast + 12)}%)`;
  } else if (filter === 'bw') {
    filterStr = `grayscale(100%) brightness(${Math.min(155, brightness + 12)}%) contrast(${Math.min(200, contrast + 45)}%)`;
  }
  ctx.filter = filterStr;
  ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  if (filter === 'bw') {
    const imgData = ctx.getImageData(0, 0, outW, outH);
    const px = imgData.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = px[i];
      const v = lum > 142 ? 255 : lum < 88 ? 16 : lum;
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    width: outW,
    height: outH,
  };
}

// ============================================================================
// PDF Utilities, Compiler & Template Generators (jsPDF + pdf-lib + pdfjs-dist)
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizePdfFilename(rawName: string, fallback = 'ShMp3100_Scan'): string {
  const trimmed = rawName.trim() || fallback;
  const sanitized = trimmed.replace(/[<>:"/\\|?*]+/g, '_');
  return sanitized.toLowerCase().endsWith('.pdf') ? sanitized : `${sanitized}.pdf`;
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function drawJsPdfWatermark(
  doc: jsPDF,
  pageW: number,
  pageH: number,
  enabled: boolean,
  text: string,
  opacity: number,
  placement: WatermarkPlacement
) {
  if (!enabled || !text.trim()) return;
  const stamp = text.trim();
  const alpha = Math.min(0.75, Math.max(0.05, opacity));

  doc.saveGraphicsState();
  // @ts-expect-error jsPDF GState is available at runtime
  const gState = new doc.GState({ opacity: alpha });
  doc.setGState(gState);
  doc.setTextColor(109, 40, 217);

  if (placement === 'diagonal') {
    const fontSize = Math.max(18, Math.min(34, pageW * 0.13));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.text(stamp, pageW / 2, pageH / 2, { align: 'center', angle: 35 });
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(stamp, 14, pageH - 9);
  }
  doc.restoreGraphicsState();
}

async function compileScannedPdf(options: {
  pages: ScannedPage[];
  filename: string;
  documentTitle: string;
  authorOrIssuer: string;
  includeIndex: boolean;
  indexEntries: IndexEntry[];
  pageSize: PageSizeOption;
  margin: MarginOption;
  watermarkEnabled: boolean;
  watermarkText: string;
  watermarkOpacity: number;
  watermarkPlacement: WatermarkPlacement;
  pageNumbersEnabled: boolean;
}): Promise<GeneratedPdfResult> {
  if (options.pages.length === 0) {
    throw new Error('Choose or scan at least one image page first.');
  }

  const marginMm =
    options.margin === 'none' ? 0 : options.margin === 'compact' ? 8 : 14;

  let doc: jsPDF | null = null;
  let indexOffset = 0;

  if (options.includeIndex) {
    const indexFormat = options.pageSize === 'letter' ? 'letter' : 'a4';
    doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: indexFormat,
      compress: true,
    });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();

    doc.setFillColor(18, 12, 14);
    doc.rect(0, 0, pw, 36, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(248, 113, 113);
    doc.text('SHMP3100 PDF MAKER · DOCUMENT INDEX', 18, 14);

    doc.setFontSize(19);
    doc.setTextColor(255, 255, 255);
    doc.text(options.documentTitle || 'Scanned Document', 18, 25);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(210, 200, 200);
    const metaSub = [
      options.authorOrIssuer ? `Source: ${options.authorOrIssuer}` : '',
      `Pages: ${options.pages.length}`,
      new Date().toLocaleDateString(),
    ]
      .filter(Boolean)
      .join('  ·  ');
    doc.text(metaSub, 18, 32);

    let y = 50;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 35);
    doc.text('TABLE OF CONTENTS', 18, y);
    y += 5;
    doc.setDrawColor(220, 38, 38);
    doc.setLineWidth(0.5);
    doc.line(18, y, pw - 18, y);
    y += 10;

    const entries =
      options.indexEntries.length > 0
        ? options.indexEntries
        : options.pages.map((p, idx) => ({
            id: p.id,
            pageNumber: idx + 1,
            heading: p.label || `Scanned Page ${idx + 1}`,
            summary: `${p.category} · ${p.filter.toUpperCase()}`,
          }));

    // Estimate index page count first for accurate target page numbering
    const estimatedIndexPages = Math.max(1, Math.ceil(entries.length / 13));

    for (const entry of entries) {
      if (y > ph - 26) {
        doc.addPage(indexFormat, 'portrait');
        y = 24;
      }
      const targetPdfPage = entry.pageNumber + estimatedIndexPages;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(24, 24, 27);
      doc.text(`${entry.pageNumber}. ${entry.heading}`, 18, y);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(185, 28, 28);
      doc.text(`Page ${targetPdfPage}`, pw - 18, y, { align: 'right' });

      if (entry.summary) {
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 110);
        const lines = doc.splitTextToSize(entry.summary, pw - 42);
        doc.text(lines.slice(0, 2), 23, y);
        y += lines.slice(0, 2).length * 4.5;
      }

      y += 3;
      doc.setDrawColor(235, 235, 240);
      doc.setLineWidth(0.25);
      doc.line(18, y, pw - 18, y);
      y += 7;
    }

    indexOffset = doc.getNumberOfPages();
    const preliminaryTotal = options.pages.length + indexOffset;
    for (let ip = 1; ip <= indexOffset; ip++) {
      doc.setPage(ip);
      drawJsPdfWatermark(
        doc,
        pw,
        ph,
        options.watermarkEnabled,
        options.watermarkText,
        options.watermarkOpacity,
        options.watermarkPlacement
      );
      if (options.pageNumbersEnabled) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 130);
        doc.text(`${ip} / ${preliminaryTotal}`, pw - 14, ph - 9, { align: 'right' });
      }
    }
  }
  const totalPages = options.pages.length + indexOffset;

  for (let i = 0; i < options.pages.length; i++) {
    const page = options.pages[i];
    const rendered = await renderProcessedPage(
      page.rawUrl,
      page.crop,
      page.rotation,
      page.filter,
      page.brightness,
      page.contrast
    );

    const pxToMm = 25.4 / 96;
    const imgWmm = rendered.width * pxToMm;

    let pageFormat: string | [number, number] =
      options.pageSize === 'letter' ? 'letter' : 'a4';
    let orientation: 'portrait' | 'landscape' =
      rendered.width > rendered.height ? 'landscape' : 'portrait';

    if (options.pageSize === 'fit') {
      const targetW = Math.max(60, Math.min(420, imgWmm + marginMm * 2));
      const targetH = targetW * (rendered.height / rendered.width) + marginMm * 2;
      orientation = targetW > targetH ? 'landscape' : 'portrait';
      pageFormat = [targetW, targetH];
    }

    if (!doc) {
      doc = new jsPDF({
        orientation,
        unit: 'mm',
        format: pageFormat,
        compress: true,
      });
    } else {
      doc.addPage(pageFormat, orientation);
    }

    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const availW = Math.max(10, pw - marginMm * 2);
    const availH = Math.max(10, ph - marginMm * 2);

    const ratio = Math.min(availW / rendered.width, availH / rendered.height);
    const renderW = rendered.width * ratio;
    const renderH = rendered.height * ratio;
    const x = (pw - renderW) / 2;
    const y = (ph - renderH) / 2;

    doc.addImage(rendered.dataUrl, 'JPEG', x, y, renderW, renderH, undefined, 'FAST');

    drawJsPdfWatermark(
      doc,
      pw,
      ph,
      options.watermarkEnabled,
      options.watermarkText,
      options.watermarkOpacity,
      options.watermarkPlacement
    );

    if (options.pageNumbersEnabled) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 130);
      doc.text(`${i + 1 + indexOffset} / ${totalPages}`, pw - 14, ph - 9, {
        align: 'right',
      });
    }
  }

  if (!doc) throw new Error('Failed to create PDF.');

  const filename = normalizePdfFilename(options.filename, 'ShMp3100_Scan');
  doc.setProperties({
    title: options.documentTitle || filename.replace(/\.pdf$/i, ''),
    author: options.authorOrIssuer || 'ShMp3100',
    creator: 'ShMp3100 Tool PDFMR',
  });

  const blob = doc.output('blob');
  return {
    blob,
    url: URL.createObjectURL(blob),
    filename,
    pageCount: totalPages,
    sizeBytes: blob.size,
  };
}

async function inspectPdfFile(file: File): Promise<QueuedPdfItem> {
  const bytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    fileName: file.name,
    sizeBytes: file.size,
    pageCount: pdfDoc.getPageCount(),
    title: pdfDoc.getTitle() || file.name.replace(/\.pdf$/i, ''),
    author: pdfDoc.getAuthor() || 'Unspecified',
  };
}

function parsePageRanges(rangeStr: string, maxPages: number): number[] {
  const cleaned = rangeStr.trim();
  if (!cleaned) {
    throw new Error('Enter page numbers or ranges (for example: 1-3, 5).');
  }
  const indices: number[] = [];
  const seen = new Set<number>();
  const tokens = cleaned
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token.includes('-')) {
      const [rawStart, rawEnd] = token.split('-').map((s) => s.trim());
      const start = Number(rawStart);
      const end = Number(rawEnd);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        end > maxPages ||
        start > end
      ) {
        throw new Error(`Invalid range "${token}". Must be 1–${maxPages}.`);
      }
      for (let p = start; p <= end; p++) {
        if (!seen.has(p - 1)) {
          seen.add(p - 1);
          indices.push(p - 1);
        }
      }
    } else {
      const pageNum = Number(token);
      if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > maxPages) {
        throw new Error(`Invalid page "${token}". Must be 1–${maxPages}.`);
      }
      if (!seen.has(pageNum - 1)) {
        seen.add(pageNum - 1);
        indices.push(pageNum - 1);
      }
    }
  }
  return indices;
}

async function processToolkitPdf(options: {
  tool: PdfToolkitTool;
  files: QueuedPdfItem[];
  filename: string;
  splitRange: string;
  rotateDegrees: 90 | 180 | 270;
  rotateRange: string;
  metaTitle: string;
  metaAuthor: string;
  watermarkEnabled: boolean;
  watermarkText: string;
  watermarkOpacity: number;
  pageNumbersEnabled: boolean;
}): Promise<GeneratedPdfResult> {
  let doc: PDFDocument;
  if (options.tool === 'merge') {
    if (options.files.length < 2) {
      throw new Error('Add at least 2 PDF files to merge.');
    }
    doc = await PDFDocument.create();
    for (const item of options.files) {
      const buf = await item.file.arrayBuffer();
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const copied = await doc.copyPages(src, src.getPageIndices());
      copied.forEach((p) => doc.addPage(p));
    }
  } else {
    if (options.files.length === 0) {
      throw new Error('Select a PDF file first.');
    }
    const buf = await options.files[0].file.arrayBuffer();
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });

    if (options.tool === 'split') {
      const indices = parsePageRanges(options.splitRange, src.getPageCount());
      doc = await PDFDocument.create();
      const copied = await doc.copyPages(src, indices);
      copied.forEach((p) => doc.addPage(p));
    } else {
      doc = src;
      if (options.tool === 'rotate') {
        const pages = doc.getPages();
        const indices = options.rotateRange.trim()
          ? parsePageRanges(options.rotateRange, pages.length)
          : pages.map((_, i) => i);
        for (const idx of indices) {
          const cur = pages[idx].getRotation().angle;
          pages[idx].setRotation(degrees((cur + options.rotateDegrees) % 360));
        }
      }
    }
  }

  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const regFont = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  pages.forEach((page, idx) => {
    const { width, height } = page.getSize();
    if (
      (options.watermarkEnabled || options.tool === 'watermark') &&
      options.watermarkText.trim()
    ) {
      const text = options.watermarkText.trim();
      const size = Math.max(20, Math.min(42, width * 0.068));
      const tw = boldFont.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: Math.max(24, (width - tw * 0.8) / 2),
        y: height * 0.42,
        size,
        font: boldFont,
        color: rgb(0.43, 0.16, 0.85),
        opacity: options.watermarkOpacity,
        rotate: degrees(35),
      });
    }
    if (options.pageNumbersEnabled || options.tool === 'page-numbers') {
      const label = `${idx + 1} / ${pages.length}`;
      const lw = regFont.widthOfTextAtSize(label, 9);
      page.drawText(label, {
        x: width - lw - 28,
        y: 22,
        size: 9,
        font: regFont,
        color: rgb(0.35, 0.35, 0.4),
      });
    }
  });

  if (options.tool === 'metadata') {
    if (options.metaTitle.trim()) doc.setTitle(options.metaTitle.trim());
    if (options.metaAuthor.trim()) doc.setAuthor(options.metaAuthor.trim());
  }
  doc.setCreator('ShMp3100 Tool PDFMR');

  const bytes = await doc.save({ useObjectStreams: true });
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const filename = normalizePdfFilename(options.filename, 'ShMp3100_Toolkit');

  return {
    blob,
    url,
    filename,
    pageCount: doc.getPageCount(),
    sizeBytes: blob.size,
  };
}

// ============================================================================
// All-in-One Conversion Engines (Word/PPT/Excel/HTML/TXT <-> PDF)
// ============================================================================

async function extractTextFromDocx(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) throw new Error('Could not find document content inside .docx file.');
  const xmlText = await xmlFile.async('text');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
  const paragraphs = Array.from(xmlDoc.getElementsByTagName('w:p'));
  const lines = paragraphs
    .map((p) =>
      Array.from(p.getElementsByTagName('w:t'))
        .map((n) => n.textContent || '')
        .join('')
        .trim()
    )
    .filter(Boolean);
  return lines.join('\n\n') || '(Empty Word document)';
}

async function extractSlidesFromPptx(file: File): Promise<string[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideNames = Object.keys(zip.files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
      return na - nb;
    });
  if (slideNames.length === 0) throw new Error('No slides found inside .pptx file.');
  const parser = new DOMParser();
  const slides: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.file(name)!.async('text');
    const doc = parser.parseFromString(xml, 'application/xml');
    const texts = Array.from(doc.getElementsByTagName('a:t'))
      .map((n) => n.textContent?.trim() || '')
      .filter(Boolean);
    slides.push(texts.join('\n') || 'Slide');
  }
  return slides;
}

function parseCsvRows(raw: string): string[][] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const sep = line.includes('\t') ? '\t' : ',';
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === sep && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else current += ch;
    }
    cells.push(current.trim());
    return cells;
  });
}

async function extractRowsFromXlsx(file: File): Promise<string[][]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parser = new DOMParser();
  const sharedStrings: string[] = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const ssXml = parser.parseFromString(await ssFile.async('text'), 'application/xml');
    Array.from(ssXml.getElementsByTagName('si')).forEach((si) => {
      const txt = Array.from(si.getElementsByTagName('t'))
        .map((t) => t.textContent || '')
        .join('');
      sharedStrings.push(txt);
    });
  }
  const sheetName = Object.keys(zip.files).find((k) =>
    /^xl\/worksheets\/sheet1\.xml$/i.test(k)
  );
  if (!sheetName) throw new Error('Could not find worksheet inside .xlsx file.');
  const sheetDoc = parser.parseFromString(
    await zip.file(sheetName)!.async('text'),
    'application/xml'
  );
  const rows: string[][] = [];
  Array.from(sheetDoc.getElementsByTagName('row')).forEach((rowEl) => {
    const rowCells: string[] = [];
    Array.from(rowEl.getElementsByTagName('c')).forEach((cellEl) => {
      const type = cellEl.getAttribute('t');
      const v = cellEl.getElementsByTagName('v')[0]?.textContent || '';
      if (type === 's') rowCells.push(sharedStrings[Number(v)] || '');
      else {
        const inlineT = cellEl.getElementsByTagName('t')[0]?.textContent;
        rowCells.push(inlineT ?? v);
      }
    });
    if (rowCells.some(Boolean)) rows.push(rowCells);
  });
  return rows;
}

function extractReadableHtmlLines(htmlRaw: string): { title: string; blocks: string[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlRaw, 'text/html');
  doc.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
  const title = doc.title?.trim() || doc.querySelector('h1')?.textContent?.trim() || 'HTML Document';
  const blocks: string[] = [];
  doc.body.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre').forEach((el) => {
    const t = el.textContent?.replace(/\s+/g, ' ').trim();
    if (t) blocks.push(t);
  });
  if (blocks.length === 0 && doc.body.textContent?.trim()) {
    blocks.push(doc.body.textContent.replace(/\s+/g, ' ').trim());
  }
  return { title, blocks };
}

async function convertSourceToPdf(options: {
  tool: PdfToolkitTool;
  textInput: string;
  sourceFile: File | null;
  filename: string;
  watermarkEnabled: boolean;
  watermarkText: string;
  watermarkOpacity: number;
}): Promise<GeneratedPdfResult> {
  const { tool, textInput, sourceFile } = options;

  if (tool === 'ppt-to-pdf') {
    let slides: string[] = [];
    if (sourceFile && sourceFile.name.toLowerCase().endsWith('.pptx')) {
      slides = await extractSlidesFromPptx(sourceFile);
    } else {
      const raw = sourceFile ? await sourceFile.text() : textInput;
      slides = raw
        .split(/\n---+\n|\r?\n\r?\n\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (slides.length === 0) {
      throw new Error('Upload a .pptx file or enter slide text (separate slides with ---).');
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [254, 142.9] });
    slides.forEach((slideText, idx) => {
      if (idx > 0) doc.addPage([254, 142.9], 'landscape');
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      doc.setFillColor(24, 18, 43);
      doc.rect(0, 0, pw, ph, 'F');
      doc.setFillColor(109, 40, 217);
      doc.rect(0, 0, pw, 3.5, 'F');

      const lines = slideText.split(/\r?\n/).filter(Boolean);
      const heading = lines[0] || `Slide ${idx + 1}`;
      const body = lines.slice(1).join('\n');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(255, 255, 255);
      const hLines = doc.splitTextToSize(heading, pw - 36);
      doc.text(hLines.slice(0, 2), 18, 28);

      if (body) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(13);
        doc.setTextColor(225, 220, 240);
        const bLines = doc.splitTextToSize(body, pw - 36);
        doc.text(bLines.slice(0, 11), 18, 52);
      }

      doc.setFontSize(9);
      doc.setTextColor(180, 175, 210);
      doc.text(`ShMp3100 Tool PDFMR · Slide ${idx + 1} / ${slides.length}`, pw - 18, ph - 10, {
        align: 'right',
      });
      drawJsPdfWatermark(
        doc,
        pw,
        ph,
        options.watermarkEnabled,
        options.watermarkText,
        options.watermarkOpacity,
        'footer'
      );
    });

    const outName = normalizePdfFilename(
      options.filename || sourceFile?.name.replace(/\.[^.]+$/, '') || 'Presentation',
      'ShMp3100_Slides'
    );
    const blob = doc.output('blob');
    return {
      blob,
      url: URL.createObjectURL(blob),
      filename: outName,
      pageCount: slides.length,
      sizeBytes: blob.size,
    };
  }

  if (tool === 'excel-to-pdf') {
    let rows: string[][] = [];
    if (sourceFile && sourceFile.name.toLowerCase().endsWith('.xlsx')) {
      rows = await extractRowsFromXlsx(sourceFile);
    } else {
      const raw = sourceFile ? await sourceFile.text() : textInput;
      rows = parseCsvRows(raw);
    }
    if (rows.length === 0) {
      throw new Error('Upload a .xlsx / .csv file or paste comma-separated rows.');
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const cols = Math.max(...rows.map((r) => r.length));
    const colW = Math.max(22, (pw - 28) / Math.max(1, Math.min(cols, 8)));

    let y = 24;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(24, 24, 36);
    doc.text(sourceFile?.name || 'Spreadsheet Export', 14, 15);

    rows.forEach((row, rIdx) => {
      if (y > ph - 18) {
        doc.addPage('a4', 'landscape');
        y = 18;
      }
      const isHeader = rIdx === 0;
      if (isHeader) {
        doc.setFillColor(109, 40, 217);
        doc.rect(14, y - 5, pw - 28, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
      } else {
        if (rIdx % 2 === 0) {
          doc.setFillColor(245, 243, 255);
          doc.rect(14, y - 5, pw - 28, 7.5, 'F');
        }
        doc.setTextColor(35, 35, 45);
        doc.setFont('helvetica', 'normal');
      }
      doc.setFontSize(8.5);
      row.slice(0, 8).forEach((cell, cIdx) => {
        const clipped = cell.length > 26 ? `${cell.slice(0, 24)}..` : cell;
        doc.text(clipped, 16 + cIdx * colW, y);
      });
      y += 8;
    });

    const totalSheetPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalSheetPages; i++) {
      doc.setPage(i);
      drawJsPdfWatermark(
        doc,
        pw,
        ph,
        options.watermarkEnabled,
        options.watermarkText,
        options.watermarkOpacity,
        'footer'
      );
    }

    const outName = normalizePdfFilename(
      options.filename || sourceFile?.name.replace(/\.[^.]+$/, '') || 'Spreadsheet',
      'ShMp3100_Sheet'
    );
    const blob = doc.output('blob');
    return {
      blob,
      url: URL.createObjectURL(blob),
      filename: outName,
      pageCount: doc.getNumberOfPages(),
      sizeBytes: blob.size,
    };
  }

  let title = sourceFile?.name.replace(/\.[^.]+$/, '') || 'Converted Document';
  let paragraphs: string[] = [];

  if (tool === 'word-to-pdf') {
    if (sourceFile && sourceFile.name.toLowerCase().endsWith('.docx')) {
      const txt = await extractTextFromDocx(sourceFile);
      paragraphs = txt.split(/\n{2,}/);
    } else {
      const raw = sourceFile ? await sourceFile.text() : textInput;
      paragraphs = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    }
  } else if (tool === 'html-to-pdf') {
    const raw = sourceFile ? await sourceFile.text() : textInput;
    const parsed = extractReadableHtmlLines(raw);
    title = parsed.title;
    paragraphs = parsed.blocks;
  } else {
    const raw = sourceFile ? await sourceFile.text() : textInput;
    paragraphs = raw.split(/\r?\n/);
  }

  const cleanText = paragraphs.join('\n').trim();
  if (!cleanText) {
    throw new Error('Upload a document file or enter text content to convert to PDF.');
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();

  doc.setFillColor(109, 40, 217);
  doc.rect(0, 0, pw, 26, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(title.slice(0, 62), 16, 16);

  doc.setFont(tool === 'txt-to-pdf' ? 'courier' : 'helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(25, 25, 32);

  let y = 38;
  for (const para of paragraphs) {
    if (!para.trim()) {
      y += 4;
      continue;
    }
    const wrapped = doc.splitTextToSize(para, pw - 32);
    for (const line of wrapped) {
      if (y > ph - 20) {
        doc.addPage('a4', 'portrait');
        y = 20;
      }
      doc.text(line, 16, y);
      y += 5.4;
    }
    y += 2.5;
  }

  const totalP = doc.getNumberOfPages();
  for (let i = 1; i <= totalP; i++) {
    doc.setPage(i);
    drawJsPdfWatermark(
      doc,
      pw,
      ph,
      options.watermarkEnabled,
      options.watermarkText,
      options.watermarkOpacity,
      'footer'
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(130, 130, 140);
    doc.text(`${i} / ${totalP}`, pw - 16, ph - 9, { align: 'right' });
  }

  const outName = normalizePdfFilename(options.filename || title, 'ShMp3100_Document');
  const blob = doc.output('blob');
  return {
    blob,
    url: URL.createObjectURL(blob),
    filename: outName,
    pageCount: totalP,
    sizeBytes: blob.size,
  };
}

async function convertPdfToTarget(
  tool: PdfToolkitTool,
  file: File
): Promise<ConvertedPreviewOutput> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const baseName = file.name.replace(/\.pdf$/i, '') || 'Document';

  if (tool === 'pdf-to-image' || tool === 'pdf-to-ppt') {
    const renderedImages: { pageNumber: number; url: string; text: string }[] = [];
    const zip = new JSZip();

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1] || '';
      zip.file(`${baseName}_page_${p}.png`, base64, { base64: true });

      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .trim();

      renderedImages.push({ pageNumber: p, url: dataUrl, text: pageText });
    }

    if (tool === 'pdf-to-image') {
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      return {
        title: `Rendered ${renderedImages.length} PNG page(s) from ${file.name}`,
        images: renderedImages.map((r) => ({ pageNumber: r.pageNumber, url: r.url })),
        downloadUrl: URL.createObjectURL(zipBlob),
        downloadName: `${baseName}_images.zip`,
      };
    }

    const slidesHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${baseName} Slides</title><style>body{margin:0;font-family:system-ui,sans-serif;background:#1e1b4b;color:#fff;padding:32px}h1{font-size:20px;margin-bottom:24px}.slide{background:#fff;color:#111;border-radius:16px;padding:20px;margin:0 auto 24px;max-width:900px}.slide img{width:100%;border-radius:8px}.note{margin-top:12px;font-size:13px;color:#475569;line-height:1.5}</style></head><body><h1>${baseName} — ShMp3100 Slide Deck (${renderedImages.length} slides)</h1>${renderedImages
      .map(
        (s) =>
          `<section class="slide"><div>Slide ${s.pageNumber}</div><img src="${s.url}" alt="Slide ${s.pageNumber}" /><p class="note">${s.text.replace(/</g, '&lt;')}</p></section>`
      )
      .join('')}</body></html>`;

    const deckBlob = new Blob([slidesHtml], { type: 'text/html' });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    return {
      title: `Created ${renderedImages.length}-slide deck from ${file.name}`,
      images: renderedImages.map((r) => ({ pageNumber: r.pageNumber, url: r.url })),
      downloadUrl: URL.createObjectURL(deckBlob),
      downloadName: `${baseName}_slides.html`,
      secondaryUrl: URL.createObjectURL(zipBlob),
      secondaryName: `${baseName}_slide_images.zip`,
    };
  }

  const pageTexts: string[] = [];
  const csvRows: string[][] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rowMap = new Map<number, { x: number; str: string }[]>();
    for (const item of tc.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const tr = item.transform;
      const yBucket = Math.round((tr?.[5] || 0) / 5) * 5;
      const xPos = tr?.[4] || 0;
      const list = rowMap.get(yBucket) || [];
      list.push({ x: xPos, str: item.str });
      rowMap.set(yBucket, list);
    }

    const sortedYs = Array.from(rowMap.keys()).sort((a, b) => b - a);
    const lines: string[] = [];
    for (const yKey of sortedYs) {
      const cells = (rowMap.get(yKey) || []).sort((a, b) => a.x - b.x);
      lines.push(cells.map((c) => c.str).join(' '));
      csvRows.push(cells.map((c) => c.str.replace(/"/g, '""')));
    }
    pageTexts.push(`--- Page ${p} ---\n${lines.join('\n')}`);
  }

  const fullText =
    pageTexts.join('\n\n') ||
    '(No selectable text found; use OCR & Auto-Index for scanned pages.)';

  if (tool === 'pdf-to-excel') {
    const csvContent = csvRows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const csvBlob = new Blob(
      [csvContent || `"Extracted Text"\n"${fullText.replace(/"/g, '""')}"`],
      { type: 'text/csv;charset=utf-8' }
    );
    return {
      title: `Extracted ${csvRows.length} rows into CSV from ${file.name}`,
      textPreview: csvContent.slice(0, 3000),
      downloadUrl: URL.createObjectURL(csvBlob),
      downloadName: `${baseName}_table.csv`,
    };
  }

  const docHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${baseName}</title></head><body><h1>${baseName}</h1><pre style="font-family:Calibri,sans-serif;white-space:pre-wrap;">${fullText.replace(
    /</g,
    '&lt;'
  )}</pre></body></html>`;
  const docBlob = new Blob([docHtml], { type: 'application/msword' });
  const txtBlob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });

  return {
    title: `Extracted ${pdf.numPages} page(s) to Word & TXT from ${file.name}`,
    textPreview: fullText.slice(0, 4000),
    downloadUrl: URL.createObjectURL(docBlob),
    downloadName: `${baseName}.doc`,
    secondaryUrl: URL.createObjectURL(txtBlob),
    secondaryName: `${baseName}.txt`,
  };
}

// ============================================================================
// Main Application: ShMp3100 Tool — All-in-One PDF Workspace + Scan Studio
// ============================================================================

export default function App() {
  // Primary Mode: All-in-One Workspace (image_633ed9b7.png UI) OR Dedicated Scan Document Studio (35baa0fa...png UI)
  const [section, setSection] = useState<WorkspaceSection>('all-tools');
  const [scanStudioActive, setScanStudioActive] = useState(false);
  const [scanStep, setScanStep] = useState<ScanStudioStep>('scan');
  const [scanCategory, setScanCategory] = useState<ScanCategory>('Doc');
  const [editTab, setEditTab] = useState<EditTab>('crop');
  const [menuOpen, setMenuOpen] = useState(false);
  const [rgbModeScan, setRgbModeScan] = useState(true);

  // Camera & Auto-Detection State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const docConvertInputRef = useRef<HTMLInputElement | null>(null);
  const latestAddedPageIdRef = useRef<string | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraState, setCameraState] = useState<'idle' | 'active' | 'error'>('idle');
  const [cameraError, setCameraError] = useState('');
  const [flashOn, setFlashOn] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const [aiScanEnabled, setAiScanEnabled] = useState(true);
  const [autoFocusEnabled, setAutoFocusEnabled] = useState(true);
  const [detectedBox, setDetectedBox] = useState<DetectedBox | null>(null);
  const [focusScore, setFocusScore] = useState(0);
  const [focusReticle, setFocusReticle] = useState<{
    x: number;
    y: number;
    locking: boolean;
  } | null>(null);
  const [lockProgress, setLockProgress] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  // Image-to-PDF / Scanned Pages Queue
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);

  // Auto-Analysis, Book Name, Filename & Auto-Index State
  const [documentTitle, setDocumentTitle] = useState('Scanned Document');
  const [authorOrIssuer, setAuthorOrIssuer] = useState('ShMp3100 PDF Maker');
  const [filename, setFilename] = useState('ShMp3100_Document');
  const [includeIndex, setIncludeIndex] = useState(true);
  const [indexEntries, setIndexEntries] = useState<IndexEntry[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // PDF Output Settings (Default Watermark & Stamp locked; untick requires Rs 1,200)
  const [pageSize, setPageSize] = useState<PageSizeOption>('a4');
  const [margin, setMargin] = useState<MarginOption>('compact');
  const [watermarkUnlocked, setWatermarkUnlocked] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [watermarkText, setWatermarkText] = useState('ShMp3100 Tool PDFMR');
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.2);
  const [watermarkPlacement, setWatermarkPlacement] =
    useState<WatermarkPlacement>('diagonal');
  const [pageNumbersEnabled, setPageNumbersEnabled] = useState(true);

  // Finish / Export State
  const [isCompiling, setIsCompiling] = useState(false);
  const [finalPdf, setFinalPdf] = useState<GeneratedPdfResult | null>(null);
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);
  const [exportHistory, setExportHistory] = useState<ExportRecord[]>([]);

  // Toolkit & Converter State
  const [toolkitTool, setToolkitTool] = useState<PdfToolkitTool>('txt-to-pdf');
  const [toolkitFiles, setToolkitFiles] = useState<QueuedPdfItem[]>([]);
  const [sourceDocFile, setSourceDocFile] = useState<File | null>(null);
  const [workspaceTextInput, setWorkspaceTextInput] = useState('');
  const [convertedOutput, setConvertedOutput] =
    useState<ConvertedPreviewOutput | null>(null);
  const [signatureName, setSignatureName] = useState('ShMp3100');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingSigRef = useRef(false);
  const [splitRange, setSplitRange] = useState('1');
  const [rotateDegrees, setRotateDegrees] = useState<90 | 180 | 270>(90);
  const [rotateRange, setRotateRange] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaAuthor, setMetaAuthor] = useState('ShMp3100');
  const [protectNotice, setProtectNotice] = useState(
    'CONFIDENTIAL · PROTECTED BY SHMP3100 PDFMR'
  );

  // Templates State (Invoice, Project Brief, Certificate)
  const [activeTemplate, setActiveTemplate] = useState<TemplateKind>('invoice');
  const [invoiceClient, setInvoiceClient] = useState('Acme Studio Ltd.');
  const [invoiceNumber, setInvoiceNumber] = useState('INV-2026-104');
  const [invoiceItems, setInvoiceItems] = useState<InvoiceLineItem[]>([
    { id: '1', description: 'Document Digitization & Archiving', qty: 1, unitPrice: 180 },
    { id: '2', description: 'PDF Index & Compliance Package', qty: 2, unitPrice: 65 },
  ]);
  const [briefTitle, setBriefTitle] = useState('Q4 Digital Archive Specification');
  const [briefSummary, setBriefSummary] = useState(
    'Complete document capture, automated OCR indexing, and standardized PDF delivery workflow.'
  );
  const [briefScope, setBriefScope] = useState(
    '1. High-resolution edge-cropped page scanning\n2. Automated chapter index generation\n3. Embedded ShMp3100 Tool PDFMR verification stamp'
  );
  const [certRecipient, setCertRecipient] = useState('Ahmad Tariq');
  const [certCourse, setCertCourse] = useState(
    'Excellence in Digital Document Engineering'
  );
  const [certIssuer, setCertIssuer] = useState('ShMp3100 Studio');

  // Toast
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const notify = useCallback((kind: 'success' | 'error', text: string) => {
    setToast({ id: Date.now(), kind, text });
  }, []);

  const handleToggleWatermark = useCallback(() => {
    if (!watermarkUnlocked) {
      setShowUnlockModal(true);
      notify('error', 'Default watermark & stamp is locked. Unlock for Rs 1,200 to untick.');
      return;
    }
    setWatermarkEnabled((v) => !v);
  }, [watermarkUnlocked, notify]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(t);
  }, [toast]);

  const activePage = pages[selectedPageIdx] || pages[0] || null;
  const isRgbActive = (scanStudioActive && scanStep === 'finish') || rgbModeScan;

  const invoiceTotal = useMemo(
    () =>
      invoiceItems.reduce(
        (sum, item) => sum + (Number(item.qty) || 0) * (Number(item.unitPrice) || 0),
        0
      ),
    [invoiceItems]
  );

  // ==========================================================================
  // Camera Lifecycle + Hardware Torch + Real-Time Document Edge Detection
  // ==========================================================================

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (facing: 'environment' | 'user') => {
      stopCamera();
      setCameraState('idle');
      setCameraError('');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraState('error');
        setCameraError('Camera API unavailable here. Upload images via Gallery below.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
          audio: false,
        });
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (track && autoFocusEnabled) {
          const caps = track.getCapabilities?.() as
            | (MediaTrackCapabilities & { focusMode?: string[] })
            | undefined;
          if (caps?.focusMode?.includes('continuous')) {
            track
              .applyConstraints({
                advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
              })
              .catch(() => {});
          }
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState('active');
      } catch (err) {
        setCameraState('error');
        setCameraError(
          err instanceof Error
            ? `Camera unavailable (${err.message}). Use Gallery to choose document images.`
            : 'Camera access denied. Use Gallery to choose document images.'
        );
      }
    },
    [stopCamera, autoFocusEnabled]
  );

  const handleTapToFocus = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (cameraState !== 'active') return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.min(0.92, Math.max(0.08, (e.clientX - rect.left) / rect.width));
      const y = Math.min(0.92, Math.max(0.08, (e.clientY - rect.top) / rect.height));
      setFocusReticle({ x, y, locking: true });

      const track = streamRef.current?.getVideoTracks()?.[0];
      if (track) {
        const caps = track.getCapabilities?.() as
          | (MediaTrackCapabilities & { focusMode?: string[]; pointsOfInterest?: boolean })
          | undefined;
        try {
          const adv: Record<string, unknown> = {};
          if (caps?.focusMode?.includes('single-shot')) adv.focusMode = 'single-shot';
          else if (caps?.focusMode?.includes('continuous')) adv.focusMode = 'continuous';
          if (caps?.pointsOfInterest) adv.pointsOfInterest = [{ x, y }];
          if (Object.keys(adv).length > 0) {
            await track.applyConstraints({
              advanced: [adv as MediaTrackConstraintSet],
            });
          }
        } catch {
          // Ignore unsupported browser constraints; visual reticle + sharpness meter still run
        }
      }

      window.setTimeout(() => {
        setFocusReticle((prev) => (prev ? { ...prev, locking: false } : null));
      }, 650);
    },
    [cameraState]
  );

  useEffect(() => {
    if (scanStudioActive && scanStep === 'scan') {
      startCamera(facingMode);
    } else {
      stopCamera();
      setDetectedBox(null);
      setFocusScore(0);
      setFocusReticle(null);
      setLockProgress(0);
    }
    return () => stopCamera();
  }, [scanStudioActive, scanStep, facingMode, startCamera, stopCamera]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    const caps = track.getCapabilities?.() as
      | (MediaTrackCapabilities & { torch?: boolean })
      | undefined;
    if (caps?.torch) {
      track
        .applyConstraints({
          advanced: [{ torch: flashOn } as MediaTrackConstraintSet],
        })
        .catch(() => {});
    }
  }, [flashOn, cameraState]);

  useEffect(() => {
    if (!scanStudioActive || scanStep !== 'scan' || cameraState !== 'active') return;

    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      if (!detectCanvasRef.current) {
        detectCanvasRef.current = document.createElement('canvas');
      }
      const c = detectCanvasRef.current;
      const sampleW = 192;
      const sampleH = Math.max(
        112,
        Math.round(sampleW * (video.videoHeight / video.videoWidth))
      );
      if (c.width !== sampleW || c.height !== sampleH) {
        c.width = sampleW;
        c.height = sampleH;
      }

      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, sampleW, sampleH);

      const box = detectDocumentBoundsFromCanvas(c);
      const sharpness = computeFrameFocusScore(c, box);
      setDetectedBox(box);
      setFocusScore(sharpness);

      const focusOk = !autoFocusEnabled || sharpness >= 34;
      if (box && focusOk && autoCapture && !isCapturing) {
        setLockProgress((p) => Math.min(100, p + 25));
      } else {
        setLockProgress(0);
      }
    }, 220);

    return () => window.clearInterval(timer);
  }, [scanStudioActive, scanStep, cameraState, autoCapture, autoFocusEnabled, isCapturing]);

  // ==========================================================================
  // Image Upload / Camera Capture + Automatic Page Crop
  // ==========================================================================

  const refinePageWithAiInBackground = useCallback(
    async (pageId: string, rawUrl: string, category: ScanCategory) => {
      setIsAiProcessing(true);
      try {
        const aiRes = await requestAiDetectAndCrop(rawUrl, category);
        const clampCrop = (v: unknown) => {
          const n = Number(v);
          return Number.isFinite(n) ? Math.min(0.42, Math.max(0, n)) : 0;
        };
        const aiCrop: CropBox = {
          left: clampCrop(aiRes.left),
          top: clampCrop(aiRes.top),
          right: clampCrop(aiRes.right),
          bottom: clampCrop(aiRes.bottom),
        };
        const hasValidCrop =
          aiCrop.left + aiCrop.right < 0.78 && aiCrop.top + aiCrop.bottom < 0.78;
        const aiFilter: ScanFilter =
          aiRes.recommendedFilter === 'original' ||
          aiRes.recommendedFilter === 'crisp' ||
          aiRes.recommendedFilter === 'grayscale' ||
          aiRes.recommendedFilter === 'bw'
            ? aiRes.recommendedFilter
            : category === 'Doc' || category === 'Receipt'
              ? 'crisp'
              : 'original';

        if (!hasValidCrop && !aiRes.pageHeading?.trim()) return;

        const rendered = hasValidCrop
          ? await renderProcessedPage(rawUrl, aiCrop, 0, aiFilter, 104, 114)
          : null;

        setPages((prev) =>
          prev.map((p) => {
            if (p.id !== pageId) return p;
            return {
              ...p,
              crop: hasValidCrop ? aiCrop : p.crop,
              filter: aiFilter,
              label: aiRes.pageHeading?.trim() || p.label,
              processedUrl: rendered ? rendered.dataUrl : p.processedUrl,
              width: rendered ? rendered.width : p.width,
              height: rendered ? rendered.height : p.height,
            };
          })
        );

        if (aiRes.pageHeading?.trim()) {
          const heading = aiRes.pageHeading.trim();
          setIndexEntries((prev) =>
            prev.map((e) =>
              e.id === pageId
                ? {
                    ...e,
                    heading,
                    summary: `AI Auto-Cropped · Focus: ${aiRes.focusQuality || 'sharp'}`,
                  }
                : e
            )
          );
        }

        if (aiRes.documentTitle?.trim()) {
          const cleanTitle = aiRes.documentTitle.trim();
          setDocumentTitle((cur) => (cur === 'Scanned Document' ? cleanTitle : cur));
          setFilename((cur) =>
            cur === 'ShMp3100_Document'
              ? cleanTitle.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') ||
                'ShMp3100_Document'
              : cur
          );
        }
      } catch {
        // Instant local auto-crop remains intact seamlessly
      } finally {
        setIsAiProcessing(false);
      }
    },
    []
  );

  const addRawImageAsScannedPage = useCallback(
    async (
      rawUrl: string,
      source: 'camera' | 'gallery',
      label: string,
      presetBox?: DetectedBox | null,
      runAi = aiScanEnabled
    ) => {
      const localCrop: CropBox = presetBox
        ? {
            top: Math.min(0.35, Math.max(0, Number(presetBox.y.toFixed(3)))),
            left: Math.min(0.35, Math.max(0, Number(presetBox.x.toFixed(3)))),
            right: Math.min(
              0.35,
              Math.max(0, Number((1 - (presetBox.x + presetBox.w)).toFixed(3)))
            ),
            bottom: Math.min(
              0.35,
              Math.max(0, Number((1 - (presetBox.y + presetBox.h)).toFixed(3)))
            ),
          }
        : await autoDetectCropBoxFromUrl(rawUrl);

      const defaultFilter: ScanFilter =
        scanCategory === 'Doc' || scanCategory === 'Receipt' ? 'crisp' : 'original';

      const rendered = await renderProcessedPage(
        rawUrl,
        localCrop,
        0,
        defaultFilter,
        104,
        112
      );

      const newId = `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newPage: ScannedPage = {
        id: newId,
        rawUrl,
        processedUrl: rendered.dataUrl,
        width: rendered.width,
        height: rendered.height,
        rotation: 0,
        crop: localCrop,
        filter: defaultFilter,
        brightness: 104,
        contrast: 112,
        category: scanCategory,
        source,
        label,
      };

      latestAddedPageIdRef.current = newId;
      setPages((prev) => [...prev, newPage]);
      setIndexEntries((prevIdx) =>
        prevIdx.some((e) => e.id === newId)
          ? prevIdx
          : [
              ...prevIdx,
              {
                id: newId,
                pageNumber: prevIdx.length + 1,
                heading: label || `${scanCategory} Page ${prevIdx.length + 1}`,
                summary: `${label} · Auto-cropped`,
              },
            ]
      );

      if (runAi) {
        void refinePageWithAiInBackground(newId, rawUrl, scanCategory);
      }
    },
    [scanCategory, aiScanEnabled, refinePageWithAiInBackground]
  );

  useEffect(() => {
    if (pages.length === 0) {
      setSelectedPageIdx(0);
      return;
    }
    const targetId = latestAddedPageIdRef.current;
    if (targetId) {
      const idx = pages.findIndex((p) => p.id === targetId);
      if (idx >= 0) {
        setSelectedPageIdx(idx);
        latestAddedPageIdRef.current = null;
        return;
      }
    }
    setSelectedPageIdx((cur) => Math.min(cur, pages.length - 1));
  }, [pages]);

  const handleScanCapture = useCallback(
    async (forceAi = false) => {
      if (isCapturing) return;
      const video = videoRef.current;
      if (!video || cameraState !== 'active') {
        galleryInputRef.current?.click();
        return;
      }

      setIsCapturing(true);
      setLockProgress(0);
      try {
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 960;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, w, h);
        const rawUrl = canvas.toDataURL('image/jpeg', 0.9);

        await addRawImageAsScannedPage(
          rawUrl,
          'camera',
          `${scanCategory}_Scan_${pages.length + 1}`,
          detectedBox,
          forceAi || aiScanEnabled
        );
        notify('success', `Captured & auto-cropped page ${pages.length + 1}!`);
      } catch {
        notify('error', 'Failed to capture scanned page.');
      } finally {
        setIsCapturing(false);
      }
    },
    [
      cameraState,
      isCapturing,
      aiScanEnabled,
      addRawImageAsScannedPage,
      scanCategory,
      pages.length,
      detectedBox,
      notify,
    ]
  );

  useEffect(() => {
    if (
      lockProgress >= 100 &&
      autoCapture &&
      scanStudioActive &&
      scanStep === 'scan' &&
      !isCapturing
    ) {
      handleScanCapture(true);
    }
  }, [lockProgress, autoCapture, scanStudioActive, scanStep, isCapturing, handleScanCapture]);

  const handleImageFilesChosen = useCallback(
    async (rawFiles: FileList | File[], openStudioEdit = false) => {
      const list = Array.from(rawFiles);
      const validFiles: File[] = [];
      let skipped = 0;

      for (const file of list) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const ok =
          ACCEPTED_IMAGE_MIME.has(file.type.toLowerCase()) ||
          ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext);
        if (!ok) skipped++;
        else validFiles.push(file);
      }

      const results = await Promise.allSettled(
        validFiles.map((file) => {
          const rawUrl = URL.createObjectURL(file);
          return addRawImageAsScannedPage(
            rawUrl,
            'gallery',
            file.name.replace(/\.[^.]+$/, '')
          );
        })
      );

      const addedCount = results.filter((r) => r.status === 'fulfilled').length;
      skipped += results.length - addedCount;

      if (addedCount > 0) {
        notify(
          'success',
          `${aiScanEnabled ? 'AI auto-cropped' : 'Auto-cropped'} ${addedCount} ${addedCount === 1 ? 'document image' : 'document images'}.`
        );
        if (openStudioEdit) {
          setScanStudioActive(true);
          setScanStep('edit');
        }
      }
      if (skipped > 0) {
        notify(
          'error',
          `Skipped ${skipped} unsupported file(s). Use JPG, PNG, GIF, BMP, or WEBP.`
        );
      }
    },
    [addRawImageAsScannedPage, aiScanEnabled, notify]
  );

  // ==========================================================================
  // Edit & Manage Page Updaters + Auto-Analyze Book / Index
  // ==========================================================================

  const updateActivePage = useCallback(
    async (
      patch: Partial<
        Pick<
          ScannedPage,
          'crop' | 'rotation' | 'filter' | 'brightness' | 'contrast' | 'label'
        >
      >
    ) => {
      if (!activePage) return;
      const nextCrop = patch.crop ?? activePage.crop;
      const nextRot = patch.rotation ?? activePage.rotation;
      const nextFilter = patch.filter ?? activePage.filter;
      const nextBright = patch.brightness ?? activePage.brightness;
      const nextContrast = patch.contrast ?? activePage.contrast;

      const rendered = await renderProcessedPage(
        activePage.rawUrl,
        nextCrop,
        nextRot,
        nextFilter,
        nextBright,
        nextContrast
      );

      setPages((prev) =>
        prev.map((p) =>
          p.id === activePage.id
            ? {
                ...p,
                ...patch,
                processedUrl: rendered.dataUrl,
                width: rendered.width,
                height: rendered.height,
              }
            : p
        )
      );
    },
    [activePage]
  );

  const applyFilterToAllPages = async (
    filter: ScanFilter,
    brightness: number,
    contrast: number
  ) => {
    if (pages.length === 0) return;
    const updated = await Promise.all(
      pages.map(async (p) => {
        const rendered = await renderProcessedPage(
          p.rawUrl,
          p.crop,
          p.rotation,
          filter,
          brightness,
          contrast
        );
        return {
          ...p,
          filter,
          brightness,
          contrast,
          processedUrl: rendered.dataUrl,
          width: rendered.width,
          height: rendered.height,
        };
      })
    );
    setPages(updated);
    notify('success', `Applied "${filter}" scan filter to all ${updated.length} pages.`);
  };

  const handleAutoAnalyzeAndIndex = useCallback(async () => {
    if (pages.length === 0 || isAnalyzing) return;
    setIsAnalyzing(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 7000);
    try {
      const payloadImages = await Promise.all(
        pages.slice(0, 4).map(async (p) => {
          try {
            const img = await readImageElement(p.processedUrl);
            const scale = Math.min(1, 640 / Math.max(img.naturalWidth || 640, img.naturalHeight || 640));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round((img.naturalWidth || 640) * scale));
            c.height = Math.max(1, Math.round((img.naturalHeight || 640) * scale));
            c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
            return {
              mimeType: 'image/jpeg',
              dataBase64: c.toDataURL('image/jpeg', 0.72).split(',')[1] || '',
            };
          } catch {
            return {
              mimeType: 'image/jpeg',
              dataBase64: p.processedUrl.split(',')[1] || '',
            };
          }
        })
      );

      const res = await fetch('/api/analyze-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          images: payloadImages,
          scanMode: scanCategory,
        }),
      });

      if (!res.ok) throw new Error('Smart analyzer unavailable; applied local index.');

      const data = (await res.json()) as {
        documentTitle?: string;
        suggestedFilename?: string;
        authorOrIssuer?: string;
        indexEntries?: Array<{
          pageNumber?: number;
          heading?: string;
          summary?: string;
        }>;
      };

      const detectedTitle = data.documentTitle?.trim() || `${scanCategory} Scan`;
      const detectedFile =
        data.suggestedFilename?.trim() ||
        detectedTitle.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

      setDocumentTitle(detectedTitle);
      if (detectedFile) setFilename(detectedFile);
      if (data.authorOrIssuer?.trim()) setAuthorOrIssuer(data.authorOrIssuer.trim());

      if (Array.isArray(data.indexEntries) && data.indexEntries.length > 0) {
        setIndexEntries(
          pages.map((p, idx) => {
            const match = data.indexEntries?.find((e) => e.pageNumber === idx + 1);
            return {
              id: p.id,
              pageNumber: idx + 1,
              heading: match?.heading?.trim() || p.label || `Page ${idx + 1}`,
              summary:
                match?.summary?.trim() || `${scanCategory} · ${p.filter.toUpperCase()}`,
            };
          })
        );
      }

      setIncludeIndex(true);
      notify('success', `Identified "${detectedTitle}" and built automatic index!`);
    } catch {
      const firstLabel = pages[0]?.label || `${scanCategory}_Document`;
      const cleanName = firstLabel.replace(/[^a-zA-Z0-9_-]+/g, '_');
      setDocumentTitle(firstLabel.replace(/_/g, ' '));
      setFilename(`${cleanName}_${pages.length}p`);
      setIndexEntries(
        pages.map((p, idx) => ({
          id: p.id,
          pageNumber: idx + 1,
          heading: p.label || `${scanCategory} Page ${idx + 1}`,
          summary: `${p.category} · Filter: ${p.filter}`,
        }))
      );
      setIncludeIndex(true);
      notify('success', `Auto-indexed ${pages.length} pages and updated filename.`);
    } finally {
      window.clearTimeout(timeoutId);
      setIsAnalyzing(false);
    }
  }, [pages, isAnalyzing, scanCategory, notify]);

  const handleBuildFinalPdf = useCallback(async () => {
    if (pages.length === 0 || isCompiling) return;
    setIsCompiling(true);
    try {
      const result = await compileScannedPdf({
        pages,
        filename,
        documentTitle,
        authorOrIssuer,
        includeIndex,
        indexEntries,
        pageSize,
        margin,
        watermarkEnabled,
        watermarkText,
        watermarkOpacity,
        watermarkPlacement,
        pageNumbersEnabled,
      });

      setFinalPdf(result);
      setExportHistory((prev) => [
        {
          id: `exp-${Date.now()}`,
          filename: result.filename,
          url: result.url,
          sizeBytes: result.sizeBytes,
          pageCount: result.pageCount,
          createdAt: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
        ...prev.slice(0, 8),
      ]);

      triggerDownload(result.url, result.filename);
      notify(
        'success',
        `PDF ready & downloaded: ${result.filename} (${result.pageCount} pages)`
      );
    } catch (err) {
      notify(
        'error',
        err instanceof Error ? err.message : 'Failed to build final PDF.'
      );
    } finally {
      setIsCompiling(false);
    }
  }, [
    pages,
    isCompiling,
    filename,
    documentTitle,
    authorOrIssuer,
    includeIndex,
    indexEntries,
    pageSize,
    margin,
    watermarkEnabled,
    watermarkText,
    watermarkOpacity,
    watermarkPlacement,
    pageNumbersEnabled,
    notify,
  ]);

  const handleGoToFinishPdf = () => {
    if (pages.length === 0) {
      notify('error', 'Choose or scan at least one page first.');
      return;
    }
    setScanStudioActive(true);
    setScanStep('finish');
    if (documentTitle === 'Scanned Document' && !isAnalyzing) {
      handleAutoAnalyzeAndIndex();
    }
  };

  // Launch Scan Document Studio on chosen files or camera
  const openScanDocumentStudio = (initialStep: ScanStudioStep = 'scan') => {
    setScanStudioActive(true);
    setScanStep(initialStep);
  };

  // ==========================================================================
  // Workspace Toolkit & Template Handlers
  // ==========================================================================

  const handleOpenToolkitOption = (tool: PdfToolkitTool) => {
    setConvertedOutput(null);
    setToolkitTool(tool);
    setSection('toolkit');
    setScanStudioActive(false);
  };

  const handleAddToolkitPdfs = async (rawFiles: FileList | File[]) => {
    const list = Array.from(rawFiles);
    const valid: QueuedPdfItem[] = [];
    for (const f of list) {
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        try {
          valid.push(await inspectPdfFile(f));
        } catch {
          // ignore
        }
      }
    }
    if (valid.length > 0) {
      setToolkitFiles((prev) =>
        toolkitTool === 'merge' ? [...prev, ...valid] : [valid[0]]
      );
      setSplitRange(`1-${Math.min(2, valid[0].pageCount)}`);
      if (!metaTitle) setMetaTitle(valid[0].title);
      notify('success', `Loaded ${valid.length} PDF file(s).`);
    } else {
      notify('error', 'Please select valid PDF files.');
    }
  };

  const handleRunToolkitExport = async () => {
    setIsCompiling(true);
    setConvertedOutput(null);
    try {
      if (
        toolkitTool === 'word-to-pdf' ||
        toolkitTool === 'ppt-to-pdf' ||
        toolkitTool === 'excel-to-pdf' ||
        toolkitTool === 'html-to-pdf' ||
        toolkitTool === 'txt-to-pdf'
      ) {
        const res = await convertSourceToPdf({
          tool: toolkitTool,
          textInput: workspaceTextInput,
          sourceFile: sourceDocFile,
          filename,
          watermarkEnabled,
          watermarkText,
          watermarkOpacity,
        });
        setFinalPdf(res);
        triggerDownload(res.url, res.filename);
        setExportHistory((prev) => [
          {
            id: `exp-${Date.now()}`,
            filename: res.filename,
            url: res.url,
            sizeBytes: res.sizeBytes,
            pageCount: res.pageCount,
            createdAt: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
          ...prev.slice(0, 8),
        ]);
        notify('success', `Converted & downloaded ${res.filename}!`);
        return;
      }

      if (
        toolkitTool === 'pdf-to-word' ||
        toolkitTool === 'pdf-to-image' ||
        toolkitTool === 'pdf-to-ppt' ||
        toolkitTool === 'pdf-to-excel'
      ) {
        if (toolkitFiles.length === 0) throw new Error('Select a PDF file first.');
        const out = await convertPdfToTarget(toolkitTool, toolkitFiles[0].file);
        setConvertedOutput(out);
        triggerDownload(out.downloadUrl, out.downloadName);
        notify('success', out.title);
        return;
      }

      if (toolkitTool === 'ocr') {
        if (toolkitFiles.length === 0) throw new Error('Select a PDF file first.');
        const bytes = new Uint8Array(await toolkitFiles[0].file.arrayBuffer());
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        const maxSample = Math.min(3, pdf.numPages);
        const imgs: { mimeType: string; dataBase64: string }[] = [];
        const localLines: string[] = [];

        for (let p = 1; p <= maxSample; p++) {
          const page = await pdf.getPage(p);
          const rawVp = page.getViewport({ scale: 1 });
          const fitScale = Math.min(1.2, 640 / Math.max(rawVp.width, rawVp.height));
          const vp = page.getViewport({ scale: fitScale });
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(vp.width));
          c.height = Math.max(1, Math.round(vp.height));
          const ctx = c.getContext('2d');
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
            imgs.push({
              mimeType: 'image/jpeg',
              dataBase64: c.toDataURL('image/jpeg', 0.72).split(',')[1] || '',
            });
          }
          try {
            const tc = await page.getTextContent();
            const txt = tc.items
              .map((it) => ('str' in it ? it.str : ''))
              .join(' ')
              .trim();
            if (txt) localLines.push(`Page ${p}: ${txt.slice(0, 220)}`);
          } catch {
            // ignore text extraction issues
          }
        }

        let summaryText = '';
        let outFileName = `${toolkitFiles[0].fileName.replace(/\.pdf$/i, '')}_OCR_Index.txt`;
        let detectedTitle = toolkitFiles[0].title;

        try {
          const ocrController = new AbortController();
          const ocrTimer = window.setTimeout(() => ocrController.abort(), 10000);
          let res: Response;
          try {
            res = await fetch('/api/analyze-document', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: ocrController.signal,
              body: JSON.stringify({ images: imgs, scanMode: 'PDF OCR' }),
            });
          } finally {
            window.clearTimeout(ocrTimer);
          }
          if (!res.ok) throw new Error('OCR service busy');
          const data = (await res.json()) as {
            documentTitle?: string;
            suggestedFilename?: string;
            authorOrIssuer?: string;
            indexEntries?: { pageNumber?: number; heading?: string; summary?: string }[];
          };
          detectedTitle = data.documentTitle || toolkitFiles[0].title;
          outFileName = `${data.suggestedFilename || 'OCR_Index'}.txt`;
          summaryText = [
            `Detected Title: ${detectedTitle}`,
            `Suggested Filename: ${data.suggestedFilename || toolkitFiles[0].fileName}`,
            `Issuer / Author: ${data.authorOrIssuer || 'Detected Document'}`,
            '',
            'Auto-Index Breakdown:',
            ...(data.indexEntries || []).map(
              (e) => `Page ${e.pageNumber}: ${e.heading} — ${e.summary || ''}`
            ),
          ].join('\n');
          notify('success', `OCR detected "${detectedTitle}"!`);
        } catch {
          summaryText = [
            `Document Title: ${toolkitFiles[0].title}`,
            `Total Pages: ${pdf.numPages}`,
            `Issuer / Author: ${toolkitFiles[0].author}`,
            '',
            'Local Text & Page Index Extraction:',
            ...(localLines.length > 0
              ? localLines
              : Array.from({ length: pdf.numPages }, (_, i) => `Page ${i + 1}: Scanned image page`)),
          ].join('\n');
          notify('success', `Extracted local page index for ${toolkitFiles[0].fileName}.`);
        }

        const txtBlob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' });
        setConvertedOutput({
          title: `OCR & Auto-Index completed for ${toolkitFiles[0].fileName}`,
          textPreview: summaryText,
          downloadUrl: URL.createObjectURL(txtBlob),
          downloadName: outFileName,
        });
        return;
      }

      if (toolkitTool === 'sign' || toolkitTool === 'protect') {
        if (toolkitFiles.length === 0) throw new Error('Select a PDF file first.');
        const buf = await toolkitFiles[0].file.arrayBuffer();
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
        const pdfPages = doc.getPages();
        const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

        if (toolkitTool === 'sign') {
          const lastPage = pdfPages[pdfPages.length - 1];
          const { width } = lastPage.getSize();
          if (signatureDataUrl) {
            const pngBytes = await fetch(signatureDataUrl).then((r) => r.arrayBuffer());
            const sigImg = await doc.embedPng(pngBytes);
            lastPage.drawImage(sigImg, { x: width - 170, y: 42, width: 130, height: 48 });
          } else {
            lastPage.drawText(`Signed: ${signatureName || 'ShMp3100'}`, {
              x: width - 190,
              y: 46,
              size: 13,
              font: boldFont,
              color: rgb(0.1, 0.25, 0.65),
            });
          }
        } else {
          pdfPages.forEach((pg) => {
            const { width } = pg.getSize();
            pg.drawText(protectNotice, {
              x: 24,
              y: 22,
              size: 8.5,
              font: boldFont,
              color: rgb(0.75, 0.14, 0.14),
              opacity: 0.7,
            });
            pg.drawText('VERIFIED READ-ONLY', {
              x: width - 130,
              y: 22,
              size: 8.5,
              font: boldFont,
              color: rgb(0.3, 0.35, 0.45),
              opacity: 0.7,
            });
          });
          if (metaTitle.trim()) doc.setTitle(metaTitle.trim());
          if (metaAuthor.trim()) doc.setAuthor(metaAuthor.trim());
        }
        doc.setCreator('ShMp3100 Tool PDFMR');
        const outBytes = await doc.save({ useObjectStreams: true });
        const blob = new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const outName = normalizePdfFilename(
          `${toolkitFiles[0].fileName.replace(/\.pdf$/i, '')}_${toolkitTool}`,
          'ShMp3100_Signed'
        );
        setFinalPdf({
          blob,
          url,
          filename: outName,
          pageCount: doc.getPageCount(),
          sizeBytes: blob.size,
        });
        triggerDownload(url, outName);
        notify('success', `Downloaded ${outName}!`);
        return;
      }

      const res = await processToolkitPdf({
        tool: toolkitTool,
        files: toolkitFiles,
        filename,
        splitRange,
        rotateDegrees,
        rotateRange,
        metaTitle,
        metaAuthor,
        watermarkEnabled,
        watermarkText,
        watermarkOpacity,
        pageNumbersEnabled,
      });
      setFinalPdf(res);
      triggerDownload(res.url, res.filename);
      setExportHistory((prev) => [
        {
          id: `exp-${Date.now()}`,
          filename: res.filename,
          url: res.url,
          sizeBytes: res.sizeBytes,
          pageCount: res.pageCount,
          createdAt: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
        ...prev.slice(0, 8),
      ]);
      notify('success', `Downloaded ${res.filename} (${res.pageCount} pages).`);
    } catch (err) {
      notify(
        'error',
        err instanceof Error ? err.message : 'Workspace operation failed.'
      );
    } finally {
      setIsCompiling(false);
    }
  };

  const handleGenerateTemplatePdf = async (kind: TemplateKind) => {
    setIsCompiling(true);
    try {
      let doc: jsPDF;
      let outName = 'ShMp3100_Template.pdf';

      if (kind === 'invoice') {
        doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pw = doc.internal.pageSize.getWidth();
        const ph = doc.internal.pageSize.getHeight();
        doc.setFillColor(109, 40, 217);
        doc.rect(0, 0, pw, 34, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.setTextColor(255, 255, 255);
        doc.text('INVOICE', 18, 20);
        doc.setFontSize(10);
        doc.text(invoiceNumber, pw - 18, 16, { align: 'right' });
        doc.text(new Date().toLocaleDateString(), pw - 18, 23, { align: 'right' });

        doc.setTextColor(30, 30, 40);
        doc.setFontSize(11);
        doc.text(`Billed To: ${invoiceClient}`, 18, 48);

        let y = 64;
        doc.setFillColor(243, 240, 255);
        doc.rect(18, y - 6, pw - 36, 9, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text('Description', 22, y);
        doc.text('Qty', pw - 68, y, { align: 'right' });
        doc.text('Unit', pw - 44, y, { align: 'right' });
        doc.text('Total', pw - 22, y, { align: 'right' });
        y += 10;

        doc.setFont('helvetica', 'normal');
        invoiceItems.forEach((item) => {
          const lineTotal = item.qty * item.unitPrice;
          doc.text(item.description.slice(0, 48), 22, y);
          doc.text(String(item.qty), pw - 68, y, { align: 'right' });
          doc.text(`$${item.unitPrice.toFixed(2)}`, pw - 44, y, { align: 'right' });
          doc.text(`$${lineTotal.toFixed(2)}`, pw - 22, y, { align: 'right' });
          y += 8;
        });

        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(109, 40, 217);
        doc.text(`Grand Total: $${invoiceTotal.toFixed(2)}`, pw - 22, y, {
          align: 'right',
        });
        drawJsPdfWatermark(doc, pw, ph, watermarkEnabled, watermarkText, 0.14, 'footer');
        outName = normalizePdfFilename(invoiceNumber, 'Invoice');
      } else if (kind === 'brief') {
        doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pw = doc.internal.pageSize.getWidth();
        const ph = doc.internal.pageSize.getHeight();
        doc.setFillColor(30, 27, 75);
        doc.rect(0, 0, pw, 36, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.setTextColor(255, 255, 255);
        doc.text(briefTitle.slice(0, 52), 18, 22);

        doc.setTextColor(25, 25, 35);
        doc.setFontSize(12);
        doc.text('Executive Summary', 18, 52);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10.5);
        const sumLines = doc.splitTextToSize(briefSummary, pw - 36);
        doc.text(sumLines, 18, 60);

        const scopeY = 64 + sumLines.length * 6 + 10;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('Deliverables & Scope', 18, scopeY);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10.5);
        doc.text(doc.splitTextToSize(briefScope, pw - 36), 18, scopeY + 8);
        drawJsPdfWatermark(doc, pw, ph, watermarkEnabled, watermarkText, 0.14, 'footer');
        outName = normalizePdfFilename(briefTitle, 'Project_Brief');
      } else {
        doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pw = doc.internal.pageSize.getWidth();
        const ph = doc.internal.pageSize.getHeight();
        doc.setDrawColor(109, 40, 217);
        doc.setLineWidth(3);
        doc.rect(12, 12, pw - 24, ph - 24);
        doc.setDrawColor(167, 139, 250);
        doc.setLineWidth(0.8);
        doc.rect(16, 16, pw - 32, ph - 32);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(109, 40, 217);
        doc.text('CERTIFICATE OF RECOGNITION', pw / 2, 46, { align: 'center' });

        doc.setFontSize(30);
        doc.setTextColor(24, 24, 36);
        doc.text(certRecipient || 'Recipient Name', pw / 2, 86, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(14);
        doc.setTextColor(75, 85, 99);
        doc.text(certCourse, pw / 2, 110, { align: 'center' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(`Issued by ${certIssuer} · ${new Date().toLocaleDateString()}`, pw / 2, 154, {
          align: 'center',
        });
        drawJsPdfWatermark(doc, pw, ph, watermarkEnabled, watermarkText, 0.12, 'footer');
        outName = normalizePdfFilename(`Certificate_${certRecipient}`, 'Certificate');
      }

      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const res: GeneratedPdfResult = {
        blob,
        url,
        filename: outName,
        pageCount: doc.getNumberOfPages(),
        sizeBytes: blob.size,
      };
      setFinalPdf(res);
      triggerDownload(url, outName);
      notify('success', `Generated & downloaded ${outName}!`);
    } catch {
      notify('error', 'Could not generate template PDF.');
    } finally {
      setIsCompiling(false);
    }
  };

  const pageOrderMove = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= pages.length) return;
    setPages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setIndexEntries((prev) => {
      const next = [...prev];
      if (next[idx] && next[target]) {
        const [moved] = next.splice(idx, 1);
        next.splice(target, 0, moved);
        return next.map((e, i) => ({ ...e, pageNumber: i + 1 }));
      }
      return next;
    });
    setSelectedPageIdx(target);
  };

  const removePageById = (id: string) => {
    const target = pages.find((p) => p.id === id);
    if (target?.rawUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(target.rawUrl);
    }
    const nextPages = pages.filter((p) => p.id !== id);
    setPages(nextPages);
    setSelectedPageIdx((cur) => Math.max(0, Math.min(cur, nextPages.length - 1)));
    setIndexEntries((prev) =>
      prev
        .filter((e) => e.id !== id)
        .map((e, i) => ({ ...e, pageNumber: i + 1 }))
    );
    if (nextPages.length === 0 && scanStudioActive && scanStep !== 'scan') {
      setScanStep('scan');
      notify('error', 'All pages removed — returned to Scan screen.');
    }
  };

  const accentBorderColor = isRgbActive
    ? 'border-cyan-400 shadow-[0_0_24px_rgba(34,211,238,0.45)]'
    : 'border-[#EF4444] shadow-[0_0_24px_rgba(239,68,68,0.45)]';

  return (
    <div
      className={
        scanStudioActive
          ? `flex min-h-screen flex-col text-white transition-colors duration-500 ${
              isRgbActive ? 'rgb-studio-bg' : 'scan-studio-bg'
            }`
          : 'workspace-lavender-bg flex min-h-screen flex-col text-slate-900'
      }
    >
      {/* Hidden File Inputs */}
      <input
        ref={galleryInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/jpg,image/png,image/gif,image/bmp,image/webp"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleImageFilesChosen(e.target.files, scanStudioActive);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        multiple={toolkitTool === 'merge'}
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleAddToolkitPdfs(e.target.files);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={docConvertInputRef}
        type="file"
        accept=".docx,.pptx,.xlsx,.csv,.tsv,.html,.htm,.txt,.md"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] || null;
          if (file) {
            setSourceDocFile(file);
            notify('success', `Loaded ${file.name} for conversion.`);
          }
          e.target.value = '';
        }}
      />

      {/* ====================================================================
          MODE A: DEDICATED DARK SCAN DOCUMENT / EDIT / RGB FINISH STUDIO
          (Activated ONLY on Scan Document / Image-to-PDF Scan Mode)
         ==================================================================== */}
      {scanStudioActive ? (
        <>
          {flashOn && scanStep === 'scan' && (
            <div
              aria-hidden="true"
              className="pointer-events-none fixed inset-0 z-10 border-[14px] border-white/25 bg-white/10"
            />
          )}

          {/* Scan Document Top Header (Matching 35baa0fa...png) */}
          <header className="relative z-30 mx-auto w-full max-w-[1160px] px-4 pt-3 sm:px-6">
            <div className="relative flex items-center justify-between rounded-2xl border border-white/10 bg-[#1B0F11]/85 px-4 py-3 shadow-2xl backdrop-blur-xl">
              <button
                type="button"
                onClick={() => {
                  if (scanStep === 'finish') setScanStep('edit');
                  else if (scanStep === 'edit') setScanStep('scan');
                  else {
                    setScanStudioActive(false);
                    setSection('image-scan');
                  }
                }}
                aria-label="Back"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/90 transition-colors hover:bg-white/10 cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {scanStep === 'scan'
                    ? 'Workspace'
                    : scanStep === 'finish'
                      ? 'Edit'
                      : 'Scanner'}
                </span>
              </button>

              <div className="text-center">
                <h1 className="font-display text-lg font-extrabold tracking-tight text-white sm:text-xl">
                  {scanStep === 'scan'
                    ? 'Scan Document'
                    : scanStep === 'edit'
                      ? 'Edit & Manage'
                      : 'Finish PDF'}
                </h1>
                <p className="font-mono-tabular text-[11px] font-medium tracking-wider text-white/60">
                  SHMP3100 PDF Maker
                </p>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label="Studio options menu"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/90 transition-colors hover:bg-white/10 cursor-pointer"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-12 z-50 w-60 rounded-2xl border border-white/15 bg-[#171115]/95 p-2 shadow-2xl backdrop-blur-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setRgbModeScan((v) => !v);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
                    >
                      <span>Studio Light Mode</span>
                      <span className="font-mono-tabular text-[11px] text-cyan-300">
                        {isRgbActive ? 'RGB Light' : 'Crimson'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAutoCapture((v) => !v);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
                    >
                      <span>Auto-Capture on Lock</span>
                      <span className="font-mono-tabular text-[11px] text-red-400">
                        {autoCapture ? 'ON' : 'OFF'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFacingMode((f) =>
                          f === 'environment' ? 'user' : 'environment'
                        );
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
                    >
                      <span>Switch Camera</span>
                      <span className="text-[11px] text-white/60">
                        {facingMode === 'environment' ? 'Rear' : 'Front'}
                      </span>
                    </button>
                    <div className="my-1 border-t border-white/10" />
                    <button
                      type="button"
                      onClick={() => {
                        setScanStudioActive(false);
                        setSection('all-tools');
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-white/85 hover:bg-white/10 cursor-pointer"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      <span>Back to All-in-One Workspace</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Clean Step Switcher Strip */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div
                className={`flex items-center gap-1.5 rounded-2xl p-1.5 backdrop-blur-xl transition-all ${
                  isRgbActive
                    ? 'rgb-neon-bar'
                    : 'border border-white/10 bg-black/40'
                }`}
              >
                {(
                  [
                    { id: 'scan', label: '1. Scan' },
                    { id: 'edit', label: `2. Edit & Manage (${pages.length})` },
                    { id: 'finish', label: '3. Finish PDF' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      if ((s.id === 'finish' || s.id === 'edit') && pages.length === 0) {
                        notify('error', 'Scan or choose at least one image first.');
                        return;
                      }
                      if (s.id === 'finish') handleGoToFinishPdf();
                      else setScanStep(s.id);
                    }}
                    className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                      scanStep === s.id
                        ? isRgbActive || s.id === 'finish'
                          ? 'bg-gradient-to-r from-rose-500 via-fuchsia-500 to-cyan-400 text-white shadow-[0_0_20px_rgba(34,211,238,0.65),0_0_32px_rgba(236,72,153,0.45)]'
                          : 'bg-[#DC2626] text-white shadow-[0_0_14px_rgba(220,38,38,0.55)]'
                        : isRgbActive
                          ? 'text-white/80 hover:bg-white/10 hover:text-cyan-200'
                          : 'text-white/65 hover:text-white'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {pages.length > 0 && scanStep === 'scan' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setScanStep('edit')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-white/15 cursor-pointer"
                  >
                    <span>Edit ({pages.length})</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleGoToFinishPdf}
                    className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl p-[1.5px] cursor-pointer"
                  >
                    <span className="rgb-spectrum-glow absolute inset-0" />
                    <span className="relative inline-flex items-center gap-1.5 rounded-[10px] bg-[#0B0A10] px-3.5 py-1.5 text-xs font-bold text-white">
                      <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
                      <span>Finish PDF</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </header>

          {/* SCAN VIEWFINDER (BIG DOCUMENT SCREEN + AI CAPTURE + AUTO-FOCUS + AUTO-CROP) */}
          {scanStep === 'scan' && (
            <main className="relative z-20 mx-auto flex w-full max-w-[1440px] flex-1 flex-col items-center justify-between gap-3 px-3 py-2 sm:px-6 sm:py-3">
              <div className="relative flex w-full max-w-[1320px] flex-1 flex-col items-center justify-center gap-4 sm:flex-row sm:gap-5">
                <div
                  onClick={handleTapToFocus}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files.length > 0) {
                      handleImageFilesChosen(e.dataTransfer.files, true);
                    }
                  }}
                  className={`relative flex h-[71vh] min-h-[500px] max-h-[880px] w-full max-w-[880px] flex-1 items-center justify-center overflow-hidden rounded-[36px] border-2 bg-[#07060d] sm:h-[74vh] sm:rounded-[44px] cursor-crosshair ${
                    isRgbActive
                      ? 'border-cyan-400/45 shadow-[0_0_38px_rgba(34,211,238,0.22),0_0_72px_rgba(168,85,247,0.2),0_24px_80px_rgba(0,0,0,0.88)]'
                      : 'border-white/25 shadow-[0_24px_80px_rgba(0,0,0,0.85)]'
                  }`}
                >
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className={`h-full w-full object-cover ${
                      cameraState === 'active' ? 'opacity-100' : 'opacity-0'
                    }`}
                  />

                  {/* Top Live Detection & Page Focus HUD */}
                  <div className="pointer-events-none absolute inset-x-0 top-5 z-20 flex flex-wrap items-center justify-center gap-2 px-6 text-center">
                    <p className="rounded-full border border-white/15 bg-black/65 px-3.5 py-1.5 text-xs font-semibold text-white/95 backdrop-blur-md">
                      {isAiProcessing
                        ? 'AI Detecting Page Edges & Auto-Cropping...'
                        : detectedBox
                          ? autoCapture
                            ? `Page Detected · Auto-Capture ${lockProgress}%`
                            : 'Page Edges Locked · Ready to Auto-Crop'
                          : 'Frame document page · Tap anywhere to focus'}
                    </p>
                    {cameraState === 'active' && (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono-tabular text-[11px] font-bold backdrop-blur-md ${
                          focusScore >= 55
                            ? 'border-emerald-400/50 bg-emerald-950/70 text-emerald-300'
                            : focusScore >= 34
                              ? 'border-amber-400/50 bg-amber-950/70 text-amber-200'
                              : 'border-white/15 bg-black/65 text-white/75'
                        }`}
                      >
                        <Focus className="h-3.5 w-3.5" />
                        <span>
                          Focus: {focusScore}%{' '}
                          {focusScore >= 55 ? 'Sharp' : focusScore >= 34 ? 'Good' : 'Adjust'}
                        </span>
                      </span>
                    )}
                    {aiScanEnabled && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/45 bg-cyan-950/70 px-3 py-1.5 text-[11px] font-bold text-cyan-200 backdrop-blur-md">
                        <Wand2 className="h-3 w-3" />
                        <span>AI Auto-Crop ON</span>
                      </span>
                    )}
                  </div>

                  {/* Auto-Detected Document Edge Overlay */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute z-10 transition-all duration-200"
                    style={{
                      left: detectedBox ? `${detectedBox.x * 100}%` : '6%',
                      top: detectedBox ? `${detectedBox.y * 100}%` : '10%',
                      width: detectedBox ? `${detectedBox.w * 100}%` : '88%',
                      height: detectedBox ? `${detectedBox.h * 100}%` : '80%',
                    }}
                  >
                    <span
                      className={`absolute left-0 top-0 h-10 w-10 rounded-tl-2xl border-l-[4px] border-t-[4px] ${accentBorderColor}`}
                    />
                    <span
                      className={`absolute right-0 top-0 h-10 w-10 rounded-tr-2xl border-r-[4px] border-t-[4px] ${accentBorderColor}`}
                    />
                    <span
                      className={`absolute bottom-0 left-0 h-10 w-10 rounded-bl-2xl border-b-[4px] border-l-[4px] ${accentBorderColor}`}
                    />
                    <span
                      className={`absolute bottom-0 right-0 h-10 w-10 rounded-br-2xl border-b-[4px] border-r-[4px] ${accentBorderColor}`}
                    />
                    <div
                      className={`animate-scan-sweep absolute inset-x-2 h-[3px] rounded-full ${
                        isRgbActive
                          ? 'rgb-spectrum-glow shadow-[0_0_18px_rgba(34,211,238,0.85)]'
                          : 'bg-gradient-to-r from-transparent via-[#FF3B3B] to-transparent shadow-[0_0_22px_rgba(255,45,45,0.95)]'
                      }`}
                    />
                  </div>

                  {/* Tap-to-Focus Reticle */}
                  {focusReticle && (
                    <div
                      aria-hidden="true"
                      style={{
                        left: `${focusReticle.x * 100}%`,
                        top: `${focusReticle.y * 100}%`,
                      }}
                      className={`pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 p-4 transition-all duration-300 ${
                        focusReticle.locking
                          ? 'scale-110 border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.75)]'
                          : 'scale-95 border-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.7)]'
                      }`}
                    >
                      <Crosshair className="h-5 w-5 text-white" />
                    </div>
                  )}

                  {pages.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPageIdx(pages.length - 1);
                        setScanStep('edit');
                      }}
                      className="absolute bottom-5 left-6 z-20 flex items-center gap-2.5 rounded-2xl border border-white/25 bg-black/75 p-2 pr-3.5 text-left text-white shadow-lg backdrop-blur-md transition-transform hover:scale-[1.03] cursor-pointer"
                    >
                      <img
                        src={pages[pages.length - 1].processedUrl}
                        alt="Latest scanned page"
                        className="h-12 w-9 rounded-lg object-cover border border-white/20"
                      />
                      <div>
                        <p className="text-xs font-bold leading-tight">
                          View Scan ({pages.length})
                        </p>
                        <p className="text-[11px] text-cyan-300">Open &amp; Edit</p>
                      </div>
                    </button>
                  )}

                  {cameraState === 'idle' && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/65 px-6 text-center text-sm text-white/80">
                      <RefreshCw className="h-7 w-7 animate-spin text-red-400" />
                      <span>Starting HD auto-focus &amp; edge detection camera...</span>
                    </div>
                  )}

                  {cameraState === 'error' && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-[#090712]/90 p-8 text-center sm:p-10 cursor-default"
                    >
                      <div
                        className={`flex h-18 w-18 items-center justify-center rounded-2xl border ${
                          isRgbActive
                            ? 'border-cyan-400/50 bg-gradient-to-br from-rose-500/20 via-purple-500/20 to-cyan-500/20 shadow-[0_0_28px_rgba(34,211,238,0.45)]'
                            : 'border-red-500/35 bg-red-500/15'
                        }`}
                      >
                        <Camera
                          className={`h-9 w-9 ${
                            isRgbActive ? 'text-cyan-300' : 'text-red-400'
                          }`}
                        />
                      </div>
                      <div className="max-w-lg space-y-2">
                        <h2 className="font-display text-xl font-bold text-white sm:text-2xl">
                          Scan Document Viewfinder Ready
                        </h2>
                        <p className="text-sm leading-relaxed text-white/75 sm:text-base">
                          {cameraError}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => startCamera(facingMode)}
                          className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-3 text-xs font-bold text-white shadow-[0_0_16px_rgba(255,255,255,0.08)] hover:bg-white/20 sm:text-sm cursor-pointer"
                        >
                          <RefreshCw className="h-4 w-4" />
                          <span>Retry Camera</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => galleryInputRef.current?.click()}
                          className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-xs font-bold text-white sm:text-sm cursor-pointer ${
                            isRgbActive
                              ? 'rgb-neon-cta hover:brightness-110'
                              : 'bg-[#DC2626] hover:bg-[#B91C1C]'
                          }`}
                        >
                          <Upload className="h-4 w-4" />
                          <span>Choose Document Image &amp; Auto-Crop</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Vertical Mode Rail */}
                <div
                  className={`flex flex-row gap-2 overflow-x-auto rounded-2xl p-2 shadow-xl backdrop-blur-xl sm:flex-col sm:gap-3 ${
                    isRgbActive
                      ? 'rgb-neon-bar'
                      : 'border border-white/12 bg-[#1B0D10]/85'
                  }`}
                >
                  {SCAN_CATEGORIES.map((cat) => {
                    const Icon = cat.icon;
                    const active = scanCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setScanCategory(cat.id)}
                        className="flex flex-col items-center gap-1 rounded-xl p-1.5 transition-all cursor-pointer"
                      >
                        <span
                          className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all ${
                            active
                              ? isRgbActive
                                ? 'border-cyan-300 bg-gradient-to-br from-rose-500/80 via-fuchsia-500/80 to-cyan-400/90 text-white shadow-[0_0_20px_rgba(34,211,238,0.7),0_0_28px_rgba(236,72,153,0.45)]'
                                : 'border-[#FF3B3B] bg-[#DC2626] text-white shadow-[0_0_18px_rgba(239,68,68,0.75)]'
                              : 'border-white/15 bg-white/5 text-white/70 hover:text-white'
                          }`}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <span
                          className={`text-[11px] font-semibold ${
                            active ? 'text-white' : 'text-white/55'
                          }`}
                        >
                          {cat.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bottom Control Dock (Gallery · Auto-Focus · Pages Count/View · Merged AI SCAN · Flash) */}
              <div className="w-full max-w-[820px] space-y-2 pb-1">
                <div
                  className={`relative flex items-center justify-between gap-2 rounded-3xl px-4 py-3 backdrop-blur-xl sm:px-8 ${
                    isRgbActive
                      ? 'rgb-neon-dock'
                      : 'border border-white/12 bg-[#1A0D0F]/90 shadow-2xl'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex flex-col items-center gap-1 text-white/90 transition-all hover:text-cyan-200 cursor-pointer"
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                        isRgbActive
                          ? 'border-fuchsia-400/45 bg-fuchsia-500/15 shadow-[0_0_16px_rgba(217,70,239,0.4)] hover:shadow-[0_0_22px_rgba(34,211,238,0.65)]'
                          : 'border-white/10 bg-white/5'
                      }`}
                    >
                      <ImageIcon className="h-5 w-5" />
                    </span>
                    <span className="text-[11px] font-semibold">Gallery</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAutoFocusEnabled((v) => !v)}
                    className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      autoFocusEnabled
                        ? 'text-cyan-200'
                        : 'text-white/75 hover:text-white'
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                        autoFocusEnabled
                          ? isRgbActive
                            ? 'border-cyan-300/75 bg-gradient-to-br from-emerald-500/25 via-cyan-500/25 to-indigo-500/25 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.65),0_0_28px_rgba(16,185,129,0.45)]'
                            : 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300 shadow-[0_0_14px_rgba(16,185,129,0.45)]'
                          : 'border-white/15 bg-white/5'
                      }`}
                    >
                      <Focus className="h-5 w-5" />
                    </span>
                    <span className="text-[11px] font-semibold">
                      {autoFocusEnabled ? 'Auto-Focus' : 'Manual'}
                    </span>
                  </button>

                  {/* Page Viewer & Count Badge Button (Red-Box Slot between Auto-Focus & AI Scan) */}
                  <button
                    type="button"
                    onClick={() => {
                      if (pages.length === 0) {
                        notify(
                          'error',
                          'No pages yet — scan or upload an image first to view pages.'
                        );
                        return;
                      }
                      setScanStep('edit');
                    }}
                    title="View & manage scanned pages"
                    className="group relative flex flex-col items-center gap-1 text-white/95 transition-all hover:scale-[1.04] cursor-pointer"
                  >
                    <span
                      className={`relative flex h-10 w-10 items-center justify-center overflow-visible rounded-xl border transition-all ${
                        pages.length > 0
                          ? 'border-violet-300/80 bg-gradient-to-br from-rose-500/25 via-violet-500/30 to-cyan-400/25 shadow-[0_0_20px_rgba(168,85,247,0.65),0_0_26px_rgba(34,211,238,0.45)]'
                          : isRgbActive
                            ? 'border-cyan-400/50 bg-cyan-500/15 shadow-[0_0_16px_rgba(34,211,238,0.4)]'
                            : 'border-white/15 bg-white/5'
                      }`}
                    >
                      {pages.length > 0 ? (
                        <img
                          src={
                            (pages[selectedPageIdx] || pages[pages.length - 1])
                              .processedUrl
                          }
                          alt={`Page ${selectedPageIdx + 1} of ${pages.length}`}
                          className="h-8 w-6 rounded object-cover border border-white/30"
                        />
                      ) : (
                        <FileText className="h-5 w-5 text-cyan-200" />
                      )}
                      <span
                        className={`font-mono-tabular absolute -right-2 -top-2 inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-white ${
                          pages.length > 0
                            ? 'bg-gradient-to-r from-rose-500 via-fuchsia-500 to-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.85)]'
                            : 'border border-cyan-400/60 bg-[#121024] text-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                        }`}
                      >
                        {pages.length}
                      </span>
                    </span>
                    <span className="font-mono-tabular text-[11px] font-bold text-cyan-200">
                      {pages.length > 0
                        ? `P.${Math.min(selectedPageIdx + 1, pages.length)}/${pages.length}`
                        : 'Pages (0)'}
                    </span>
                  </button>

                  {/* Merged AI SCAN Control (AI Scan + AI Crop + Auto-Capture fitted together) */}
                  <div className="relative -my-5 flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => handleScanCapture(true)}
                      disabled={isCapturing}
                      className="relative flex h-24 w-24 items-center justify-center rounded-full p-[3px] transition-transform active:scale-95 disabled:opacity-60 cursor-pointer"
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute inset-0 rounded-full ${
                          isRgbActive || aiScanEnabled || autoCapture
                            ? 'rgb-spectrum-glow shadow-[0_0_32px_rgba(34,211,238,0.75),0_0_48px_rgba(236,72,153,0.45)]'
                            : 'bg-gradient-to-b from-[#FF5252] to-[#B91C1C] shadow-[0_0_32px_rgba(239,68,68,0.85)]'
                        }`}
                      />
                      <span className="relative flex h-full w-full flex-col items-center justify-center rounded-full bg-[#0E0B1A] text-white">
                        {isCapturing ? (
                          <RefreshCw className="h-6 w-6 animate-spin text-cyan-300" />
                        ) : (
                          <Wand2 className="h-6 w-6 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.85)]" />
                        )}
                        <span className="font-display mt-0.5 text-[11px] font-extrabold tracking-wider">
                          {isCapturing
                            ? 'SAVING'
                            : cameraState === 'active'
                              ? 'AI SCAN'
                              : 'AI UPLOAD'}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !(aiScanEnabled && autoCapture);
                        setAiScanEnabled(next || true);
                        setAutoCapture(next);
                        notify(
                          'success',
                          next
                            ? 'AI Scan merged mode: AI Crop + Auto-Capture ON!'
                            : 'AI Auto-Capture paused (AI Crop stays ON on tap).'
                        );
                      }}
                      className={`relative z-10 -mt-3 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                        autoCapture
                          ? 'border-cyan-300 bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 text-slate-950 shadow-[0_0_16px_rgba(34,211,238,0.75)]'
                          : 'border-cyan-400/50 bg-[#100D1F] text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.35)] hover:bg-white/15'
                      }`}
                    >
                      <Sparkles className="h-2.5 w-2.5" />
                      <span>
                        {autoCapture ? 'AI Crop + Auto ON' : 'AI Crop · Tap Auto'}
                      </span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setFlashOn((f) => !f)}
                    className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      flashOn ? 'text-amber-300' : 'text-white/90 hover:text-amber-200'
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
                        flashOn
                          ? 'border-amber-300/75 bg-amber-400/20 shadow-[0_0_18px_rgba(251,191,36,0.6)]'
                          : isRgbActive
                            ? 'border-rose-400/45 bg-rose-500/15 shadow-[0_0_16px_rgba(244,63,94,0.35)]'
                            : 'border-white/10 bg-white/5'
                      }`}
                    >
                      <Zap className="h-5 w-5" />
                    </span>
                    <span className="text-[11px] font-semibold">
                      {flashOn ? 'Flash On' : 'Flash'}
                    </span>
                  </button>
                </div>

                <p className="text-center text-[11px] text-white/70">
                  AI Scanner (AI Crop + Auto-Cap):{' '}
                  <span className="font-semibold text-cyan-300">
                    {autoCapture ? 'Auto + AI Crop ON' : 'AI Crop ON'}
                  </span>{' '}
                  · Mode: <span className="font-semibold text-white/90">{scanCategory}</span> ·{' '}
                  <span className="font-mono-tabular font-semibold text-fuchsia-300">
                    {pages.length} page(s)
                  </span>
                </p>
              </div>
            </main>
          )}

          {/* EDIT & MANAGE (5 Friendly Options) */}
          {scanStep === 'edit' && (
            <main className="relative z-20 mx-auto grid w-full max-w-[1260px] flex-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1.15fr_0.95fr]">
              <div className="flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-[#140B0D]/85 p-5 backdrop-blur-xl">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono-tabular text-xs font-bold text-red-400">
                      Page {selectedPageIdx + 1} of {pages.length}
                    </span>
                    <span className="mx-2 text-white/30">·</span>
                    <span className="text-xs font-semibold text-white/80">
                      {activePage?.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setScanStep('scan')}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      <span>Scan More</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      <span>Add Image</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-1 items-center justify-center py-2">
                  {activePage && (
                    <div className="paper-sheet-preview relative flex max-h-[440px] w-full max-w-[360px] items-center justify-center overflow-hidden rounded-sm p-3">
                      <img
                        src={activePage.processedUrl}
                        alt={activePage.label}
                        className="max-h-[416px] w-auto max-w-full object-contain"
                      />
                      {watermarkEnabled && watermarkText.trim() && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 flex items-center justify-center"
                          style={{ opacity: watermarkOpacity }}
                        >
                          {watermarkPlacement === 'diagonal' ? (
                            <span className="rotate-[-32deg] font-display text-lg font-extrabold text-violet-700">
                              {watermarkText}
                            </span>
                          ) : (
                            <span className="absolute bottom-2 left-3 text-[9px] font-bold text-violet-700">
                              {watermarkText}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-2.5 overflow-x-auto border-t border-white/10 pt-3">
                  {pages.map((p, idx) => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPageIdx(idx)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedPageIdx(idx);
                        }
                      }}
                      className={`flex w-20 shrink-0 cursor-pointer flex-col items-center rounded-xl border p-1.5 transition-all ${
                        idx === selectedPageIdx
                          ? 'border-red-500 bg-red-500/15'
                          : 'border-white/10 bg-white/5 hover:border-white/25'
                      }`}
                    >
                      <img
                        src={p.processedUrl}
                        alt={`Page ${idx + 1}`}
                        className="h-20 w-16 rounded object-cover"
                      />
                      <span className="font-mono-tabular mt-1 text-[10px] font-bold text-white/80">
                        P.{idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-[#140B0D]/90 p-5 backdrop-blur-xl">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {EDIT_TABS.map((t) => {
                      const Icon = t.icon;
                      const active = editTab === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setEditTab(t.id)}
                          className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-bold transition-all cursor-pointer ${
                            active
                              ? 'border-red-500 bg-red-500/20 text-white'
                              : 'border-white/10 bg-white/5 text-white/65 hover:text-white'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {editTab === 'crop' && activePage && (
                    <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-white">
                          Automatic &amp; Fine Edge Crop
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isAiProcessing}
                            onClick={async () => {
                              setIsAiProcessing(true);
                              try {
                                const aiRes = await requestAiDetectAndCrop(
                                  activePage.rawUrl,
                                  activePage.category
                                );
                                const clampCrop = (v: unknown) => {
                                  const n = Number(v);
                                  return Number.isFinite(n)
                                    ? Math.min(0.42, Math.max(0, n))
                                    : 0;
                                };
                                const nextCrop: CropBox = {
                                  left: clampCrop(aiRes.left),
                                  top: clampCrop(aiRes.top),
                                  right: clampCrop(aiRes.right),
                                  bottom: clampCrop(aiRes.bottom),
                                };
                                if (
                                  nextCrop.left + nextCrop.right < 0.78 &&
                                  nextCrop.top + nextCrop.bottom < 0.78
                                ) {
                                  await updateActivePage({ crop: nextCrop });
                                  notify('success', 'AI detected page edges & auto-cropped!');
                                } else {
                                  const box = await autoDetectCropBoxFromUrl(
                                    activePage.rawUrl
                                  );
                                  await updateActivePage({ crop: box });
                                  notify('success', 'Auto-cropped page bounds!');
                                }
                              } catch (err) {
                                const box = await autoDetectCropBoxFromUrl(
                                  activePage.rawUrl
                                );
                                await updateActivePage({ crop: box });
                                notify(
                                  'error',
                                  err instanceof Error
                                    ? `${err.message} Applied local auto-crop instead.`
                                    : 'Applied local auto-crop.'
                                );
                              } finally {
                                setIsAiProcessing(false);
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
                          >
                            <Wand2 className="h-3.5 w-3.5" />
                            <span>{isAiProcessing ? 'AI Cropping...' : 'AI Auto-Crop'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const box = await autoDetectCropBoxFromUrl(
                                activePage.rawUrl
                              );
                              await updateActivePage({ crop: box });
                              notify('success', 'Re-ran automatic page edge detection!');
                            }}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 cursor-pointer"
                          >
                            Auto-Crop Page
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateActivePage({
                                crop: { top: 0, right: 0, bottom: 0, left: 0 },
                              })
                            }
                            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 cursor-pointer"
                          >
                            Full Frame
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        {(['top', 'bottom', 'left', 'right'] as const).map((edge) => (
                          <label key={edge} className="block">
                            <div className="mb-1 flex justify-between capitalize text-white/75">
                              <span>{edge} Trim</span>
                              <span className="font-mono-tabular">
                                {Math.round(activePage.crop[edge] * 100)}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={0.35}
                              step={0.01}
                              value={activePage.crop[edge]}
                              onChange={(e) =>
                                updateActivePage({
                                  crop: {
                                    ...activePage.crop,
                                    [edge]: Number(e.target.value),
                                  },
                                })
                              }
                              className="w-full accent-red-500 cursor-pointer"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {editTab === 'filter' && activePage && (
                    <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white">
                          Scan Filter Settings
                        </h3>
                        <button
                          type="button"
                          onClick={() =>
                            applyFilterToAllPages(
                              activePage.filter,
                              activePage.brightness,
                              activePage.contrast
                            )
                          }
                          className="text-xs font-bold text-red-400 hover:underline cursor-pointer"
                        >
                          Apply to All Pages
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {(
                          [
                            { id: 'original', label: 'Original' },
                            { id: 'crisp', label: 'Crisp Color' },
                            { id: 'grayscale', label: 'Grayscale' },
                            { id: 'bw', label: 'B&W Ink' },
                          ] as const
                        ).map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => updateActivePage({ filter: f.id })}
                            className={`rounded-xl border py-2 text-xs font-bold cursor-pointer ${
                              activePage.filter === f.id
                                ? 'border-red-500 bg-red-500/20 text-white'
                                : 'border-white/10 bg-white/5 text-white/70 hover:text-white'
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>

                      <div className="space-y-3 text-xs">
                        <label className="block">
                          <div className="mb-1 flex justify-between text-white/75">
                            <span>Brightness</span>
                            <span className="font-mono-tabular">
                              {activePage.brightness}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={70}
                            max={140}
                            value={activePage.brightness}
                            onChange={(e) =>
                              updateActivePage({ brightness: Number(e.target.value) })
                            }
                            className="w-full accent-red-500 cursor-pointer"
                          />
                        </label>
                        <label className="block">
                          <div className="mb-1 flex justify-between text-white/75">
                            <span>Contrast</span>
                            <span className="font-mono-tabular">
                              {activePage.contrast}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={80}
                            max={175}
                            value={activePage.contrast}
                            onChange={(e) =>
                              updateActivePage({ contrast: Number(e.target.value) })
                            }
                            className="w-full accent-red-500 cursor-pointer"
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {editTab === 'arrange' && activePage && (
                    <div className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <h3 className="text-sm font-bold text-white">
                        Rotate &amp; Manage Page Order
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateActivePage({
                              rotation: (((activePage.rotation + 270) % 360) as
                                | 0
                                | 90
                                | 180
                                | 270),
                            })
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-2.5 text-xs font-bold text-white hover:bg-white/10 cursor-pointer"
                        >
                          <RotateCcw className="h-4 w-4" />
                          <span>Rotate Left</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateActivePage({
                              rotation: (((activePage.rotation + 90) % 360) as
                                | 0
                                | 90
                                | 180
                                | 270),
                            })
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-2.5 text-xs font-bold text-white hover:bg-white/10 cursor-pointer"
                        >
                          <RotateCw className="h-4 w-4" />
                          <span>Rotate Right</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={selectedPageIdx === 0}
                          onClick={() => pageOrderMove(selectedPageIdx, -1)}
                          className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/15 bg-white/5 py-2 text-xs font-semibold text-white disabled:opacity-35 cursor-pointer"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" />
                          <span>Earlier</span>
                        </button>
                        <button
                          type="button"
                          disabled={selectedPageIdx === pages.length - 1}
                          onClick={() => pageOrderMove(selectedPageIdx, 1)}
                          className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/15 bg-white/5 py-2 text-xs font-semibold text-white disabled:opacity-35 cursor-pointer"
                        >
                          <span>Later</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removePageById(activePage.id)}
                          className="inline-flex items-center justify-center gap-1 rounded-xl border border-red-500/30 bg-red-500/10 py-2 text-xs font-bold text-red-300 hover:bg-red-500/20 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {editTab === 'index' && (
                    <div className="space-y-3.5 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-white">
                          Book / Document Name &amp; Auto Index
                        </h3>
                        <button
                          type="button"
                          disabled={isAnalyzing}
                          onClick={handleAutoAnalyzeAndIndex}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50 cursor-pointer"
                        >
                          <Wand2 className="h-3.5 w-3.5" />
                          <span>
                            {isAnalyzing ? 'Analyzing...' : 'Analyze Book & Index'}
                          </span>
                        </button>
                      </div>

                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold text-white/70">
                            Book / Document Title
                          </span>
                          <input
                            type="text"
                            value={documentTitle}
                            onChange={(e) => setDocumentTitle(e.target.value)}
                            className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white focus:border-red-400 focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold text-white/70">
                            Output Filename (.pdf)
                          </span>
                          <input
                            type="text"
                            value={filename}
                            onChange={(e) => setFilename(e.target.value)}
                            className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white focus:border-red-400 focus:outline-none"
                          />
                        </label>
                      </div>

                      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <span className="text-xs font-semibold text-white">
                          Add Auto-Index Page (Page 1)
                        </span>
                        <button
                          type="button"
                          onClick={() => setIncludeIndex((v) => !v)}
                          className={`rounded-lg px-3 py-1 text-xs font-bold cursor-pointer ${
                            includeIndex
                              ? 'bg-red-600 text-white'
                              : 'bg-white/10 text-white/60'
                          }`}
                        >
                          {includeIndex ? 'Included' : 'Off'}
                        </button>
                      </div>

                      {includeIndex && (
                        <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                          {indexEntries.map((entry, i) => (
                            <div key={entry.id} className="flex items-center gap-2">
                              <span className="font-mono-tabular shrink-0 text-[11px] text-red-400">
                                P.{entry.pageNumber}
                              </span>
                              <input
                                type="text"
                                value={entry.heading}
                                onChange={(e) =>
                                  setIndexEntries((prev) =>
                                    prev.map((it, idx) =>
                                      idx === i ? { ...it, heading: e.target.value } : it
                                    )
                                  )
                                }
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white focus:border-red-400 focus:outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {editTab === 'stamp' && (
                    <div className="space-y-3.5 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <h3 className="text-sm font-bold text-white">
                        Watermark &amp; Page Layout
                      </h3>

                      <div className="grid grid-cols-3 gap-1.5">
                        {(['a4', 'letter', 'fit'] as const).map((sz) => (
                          <button
                            key={sz}
                            type="button"
                            onClick={() => setPageSize(sz)}
                            className={`rounded-lg border py-1.5 text-xs font-bold uppercase cursor-pointer ${
                              pageSize === sz
                                ? 'border-red-500 bg-red-500/20 text-white'
                                : 'border-white/10 bg-white/5 text-white/65'
                            }`}
                          >
                            {sz}
                          </button>
                        ))}
                      </div>

                      <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-xs font-semibold text-white cursor-pointer">
                            <input
                              type="checkbox"
                              checked={watermarkEnabled}
                              onChange={handleToggleWatermark}
                              className="h-4 w-4 accent-red-500 cursor-pointer"
                            />
                            <span>Default Watermark &amp; Stamp</span>
                          </label>
                          <button
                            type="button"
                            onClick={handleToggleWatermark}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 border border-amber-400/40 px-2.5 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/30 cursor-pointer whitespace-nowrap"
                          >
                            <Lock className="h-3 w-3" />
                            <span>
                              {watermarkUnlocked
                                ? watermarkEnabled
                                  ? 'On'
                                  : 'Off'
                                : 'Locked · Rs 1,200'}
                            </span>
                          </button>
                        </div>
                        <p className="text-[11px] text-white/55">
                          Default stamp stays ON. Untick / remove watermark requires Rs 1,200 unlock.
                        </p>
                      </div>

                      {watermarkEnabled && (
                        <input
                          type="text"
                          value={watermarkText}
                          readOnly={!watermarkUnlocked}
                          onClick={() => {
                            if (!watermarkUnlocked) setShowUnlockModal(true);
                          }}
                          onChange={(e) => {
                            if (watermarkUnlocked) setWatermarkText(e.target.value);
                          }}
                          className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/90 focus:border-red-400 focus:outline-none disabled:opacity-75"
                        />
                      )}

                      <div className="grid grid-cols-3 gap-1.5">
                        {(['none', 'compact', 'standard'] as const).map((mg) => (
                          <button
                            key={mg}
                            type="button"
                            onClick={() => setMargin(mg)}
                            className={`rounded-lg border py-1.5 text-xs font-bold capitalize cursor-pointer ${
                              margin === mg
                                ? 'border-cyan-400 bg-cyan-500/20 text-white'
                                : 'border-white/10 bg-white/5 text-white/65'
                            }`}
                          >
                            {mg} Margin
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        {(['diagonal', 'footer'] as const).map((pos) => (
                          <button
                            key={pos}
                            type="button"
                            onClick={() => setWatermarkPlacement(pos)}
                            className={`rounded-lg border py-1.5 text-xs font-bold capitalize cursor-pointer ${
                              watermarkPlacement === pos
                                ? 'border-violet-400 bg-violet-500/20 text-white'
                                : 'border-white/10 bg-white/5 text-white/65'
                            }`}
                          >
                            {pos} Stamp
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <span className="text-xs font-semibold text-white">
                          Page Numbers
                        </span>
                        <button
                          type="button"
                          onClick={() => setPageNumbersEnabled((v) => !v)}
                          className={`rounded-lg px-3 py-1 text-xs font-bold cursor-pointer ${
                            pageNumbersEnabled
                              ? 'bg-red-600 text-white'
                              : 'bg-white/10 text-white/60'
                          }`}
                        >
                          {pageNumbersEnabled ? 'On' : 'Off'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-white/10 pt-4">
                  <button
                    type="button"
                    onClick={handleGoToFinishPdf}
                    className="relative flex w-full items-center justify-center overflow-hidden rounded-2xl p-[2px] cursor-pointer"
                  >
                    <span className="rgb-spectrum-glow absolute inset-0" />
                    <span className="relative flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#100D14] py-3 text-sm font-extrabold text-white transition-colors hover:bg-[#191322]">
                      <Sparkles className="h-4 w-4 text-cyan-300" />
                      <span>Finish PDF (RGB Studio)</span>
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </button>
                </div>
              </div>
            </main>
          )}

          {/* FINISH PDF WITH RGB LIGHT */}
          {scanStep === 'finish' && (
            <main className="relative z-20 mx-auto w-full max-w-[980px] flex-1 px-4 py-6 sm:px-6">
              <div className="relative overflow-hidden rounded-[28px] p-[2px] shadow-[0_24px_80px_rgba(34,211,238,0.22)]">
                <div aria-hidden="true" className="rgb-spectrum-glow absolute inset-0" />

                <div className="relative rounded-[26px] bg-[#0E0B14]/95 p-6 backdrop-blur-2xl sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
                    <div>
                      <p className="font-mono-tabular text-xs font-bold uppercase tracking-widest text-cyan-300">
                        RGB Studio Finish
                      </p>
                      <h2 className="font-display mt-1 text-2xl font-extrabold text-white">
                        Ready to Export Your PDF
                      </h2>
                      <p className="mt-1 text-xs text-white/65">
                        Auto-detected document title, renamed file, scan filter settings, and automatic index page.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isAnalyzing}
                      onClick={handleAutoAnalyzeAndIndex}
                      className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 cursor-pointer"
                    >
                      <Wand2 className="h-4 w-4" />
                      <span>
                        {isAnalyzing
                          ? 'Analyzing Book / Doc...'
                          : 'Re-Analyze Name & Index'}
                      </span>
                    </button>
                  </div>

                  <div className="mt-6 grid gap-6 md:grid-cols-2">
                    <div className="space-y-4">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold text-white/75">
                          Detected Book / Document Name
                        </span>
                        <input
                          type="text"
                          value={documentTitle}
                          onChange={(e) => setDocumentTitle(e.target.value)}
                          className="w-full rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm font-semibold text-white focus:border-cyan-400 focus:outline-none"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold text-white/75">
                          PDF Filename (Auto-Renamed)
                        </span>
                        <div className="flex items-center rounded-xl border border-white/15 bg-white/5 focus-within:border-cyan-400">
                          <input
                            type="text"
                            value={filename}
                            onChange={(e) => setFilename(e.target.value)}
                            className="w-full bg-transparent px-3.5 py-2.5 text-sm font-semibold text-white focus:outline-none"
                          />
                          <span className="font-mono-tabular pr-3.5 text-xs text-white/50">
                            .pdf
                          </span>
                        </div>
                      </label>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">
                            Automatic Index Page (Page 1)
                          </span>
                          <button
                            type="button"
                            onClick={() => setIncludeIndex((v) => !v)}
                            className={`rounded-lg px-3 py-1 text-xs font-bold cursor-pointer ${
                              includeIndex
                                ? 'bg-emerald-500 text-black'
                                : 'bg-white/10 text-white/60'
                            }`}
                          >
                            {includeIndex ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>
                        {includeIndex && (
                          <div className="mt-3 max-h-40 space-y-1.5 overflow-y-auto pr-1">
                            {indexEntries.map((entry, idx) => (
                              <div key={entry.id} className="flex items-center gap-2">
                                <span className="font-mono-tabular shrink-0 text-[11px] text-cyan-300">
                                  P.{entry.pageNumber}
                                </span>
                                <input
                                  type="text"
                                  value={entry.heading}
                                  onChange={(e) =>
                                    setIndexEntries((prev) =>
                                      prev.map((it, i) =>
                                        i === idx
                                          ? { ...it, heading: e.target.value }
                                          : it
                                      )
                                    )
                                  }
                                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 text-xs text-white focus:border-cyan-400 focus:outline-none"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col justify-between space-y-4">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                          <span className="mb-2 block text-xs font-bold text-white">
                            Quick Scan Filter (All Pages)
                          </span>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {(
                              [
                                { id: 'original', label: 'Original' },
                                { id: 'crisp', label: 'Crisp' },
                                { id: 'grayscale', label: 'Gray' },
                                { id: 'bw', label: 'B&W' },
                              ] as const
                            ).map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => applyFilterToAllPages(f.id, 104, 115)}
                                className={`rounded-xl border py-1.5 text-xs font-bold cursor-pointer ${
                                  activePage?.filter === f.id
                                    ? 'border-cyan-400 bg-cyan-500/20 text-white'
                                    : 'border-white/10 bg-white/5 text-white/70 hover:text-white'
                                }`}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-xs">
                          <div className="flex justify-between">
                            <span className="text-white/60">Scanned Pages</span>
                            <span className="font-mono-tabular font-bold text-white">
                              {pages.length} {includeIndex ? '+ 1 Index' : ''}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-white/60">Page Format</span>
                            <span className="font-mono-tabular font-bold uppercase text-white">
                              {pageSize} · {margin}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-white/60">Watermark Stamp</span>
                            <button
                              type="button"
                              onClick={handleToggleWatermark}
                              className="inline-flex items-center gap-1.5 font-semibold text-cyan-300 hover:underline cursor-pointer"
                            >
                              {!watermarkUnlocked && <Lock className="h-3 w-3 text-amber-300" />}
                              <span>
                                {watermarkEnabled
                                  ? `${watermarkText}${watermarkUnlocked ? '' : ' (Untick Rs 1,200)'}`
                                  : 'Removed'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <button
                          type="button"
                          disabled={isCompiling}
                          onClick={handleBuildFinalPdf}
                          className="relative flex w-full items-center justify-center overflow-hidden rounded-2xl p-[2px] cursor-pointer disabled:opacity-50"
                        >
                          <span className="rgb-spectrum-glow absolute inset-0" />
                          <span className="relative flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#0B0912] py-3.5 text-sm font-extrabold text-white hover:bg-[#141022]">
                            <Download className="h-4 w-4 text-cyan-300" />
                            <span>
                              {isCompiling ? 'Compiling PDF...' : 'Download Final PDF'}
                            </span>
                          </span>
                        </button>

                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            disabled={!finalPdf}
                            onClick={() => finalPdf && setPreviewModalUrl(finalPdf.url)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-2.5 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-40 cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5 text-cyan-300" />
                            <span>Preview PDF</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setScanStep('scan')}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-2.5 text-xs font-bold text-white hover:bg-white/10 cursor-pointer"
                          >
                            <Camera className="h-3.5 w-3.5" />
                            <span>Scan More</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </main>
          )}
        </>
      ) : (
        /* ====================================================================
           MODE B: MAIN ALL-IN-ONE PDF WORKSPACE (EXACT MATCH TO image_633ed9b7.png)
           ==================================================================== */
        <>
          {/* Frosted Transparent Top Bar */}
          <header className="sticky top-0 z-30 border-b border-white/40 bg-white/45 backdrop-blur-md">
            <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-6 px-4 py-3.5 sm:px-6">
              {/* Zone 1: Brand Wordmark */}
              <button
                type="button"
                onClick={() => setSection('all-tools')}
                className="flex items-center gap-2.5 text-left cursor-pointer shrink-0"
              >
                <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full shadow-sm">
                  <img
                    src="/assets/aistudio/logo_of_shmp_3100_company-removebg-preview_e6609efe.png"
                    alt="ShMp3100 Tool logo"
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="font-display text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap">
                  ShMp3100 Tool
                </span>
              </button>

              {/* Zone 2: Single-line Nav Link (All Tools only; 3 sub-links hidden per request) */}
              <nav className="hidden md:flex items-center gap-7 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => setSection('all-tools')}
                  className={`border-b-2 pb-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    section === 'all-tools'
                      ? 'border-[#6D28D9] text-[#6D28D9]'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Tools
                </button>
              </nav>

              {/* Zone 3: Primary Camera Scan CTA */}
              <button
                type="button"
                onClick={() => openScanDocumentStudio('scan')}
                className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#5B21B6] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Camera className="h-4 w-4" />
                <span>Camera Scan</span>
              </button>
            </div>

            {/* Mobile Nav Strip (All Tools only) */}
            <div className="flex gap-4 overflow-x-auto border-t border-purple-100/70 px-4 py-2 text-xs font-semibold md:hidden">
              <button
                type="button"
                onClick={() => setSection('all-tools')}
                className={`whitespace-nowrap pb-0.5 cursor-pointer ${
                  section === 'all-tools'
                    ? 'border-b-2 border-[#6D28D9] text-[#6D28D9]'
                    : 'text-slate-600'
                }`}
              >
                All Tools
              </button>
            </div>
          </header>

          {/* SECTION 1: ALL TOOLS (Exact layout & card grid from image_633ed9b7.png) */}
          {section === 'all-tools' && (
            <main className="mx-auto w-full max-w-[1220px] flex-1 space-y-10 px-4 py-8 sm:px-6">
              {/* Hero Card (Transparent Glass) */}
              <section className="flex flex-col justify-between gap-6 rounded-3xl border border-white/45 bg-white/38 p-7 shadow-lg backdrop-blur-md sm:p-10 lg:flex-row lg:items-center">
                <div className="max-w-xl space-y-2.5">
                  <h1 className="font-display text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                    All-in-one PDF Workspace
                  </h1>
                  <p className="text-sm font-medium leading-relaxed text-slate-900 sm:text-base">
                    Convert images, scan documents with your camera, merge or split PDFs, rotate pages, and publish templates with your{' '}
                    <span className="font-bold text-[#5B21B6]">
                      ShMp3100 Tool PDFMR
                    </span>{' '}
                    watermark—all inside one fast web app.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSection('image-scan')}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#5B21B6] cursor-pointer"
                  >
                    <FilePlus2 className="h-4 w-4" />
                    <span>Create PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openScanDocumentStudio('scan')}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/60 bg-white/55 px-5 py-3 text-sm font-bold text-slate-900 shadow-xs backdrop-blur-sm transition-colors hover:bg-white/75 cursor-pointer"
                  >
                    <Camera className="h-4 w-4 text-slate-800" />
                    <span>Scan Document</span>
                  </button>
                </div>
              </section>

              {/* Convert & Create PDF */}
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/45 bg-white/38 px-4 py-2.5 shadow-sm backdrop-blur-md">
                  <h2 className="font-display text-xl font-extrabold text-slate-950">
                    Convert &amp; Create PDF
                  </h2>
                  <p className="text-xs font-semibold text-slate-800">
                    Select any tool to launch its workspace
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {/* Card 1: Image to PDF (Choose File + Apply Scan Document) */}
                  <button
                    type="button"
                    onClick={() => setSection('image-scan')}
                    className="flex items-center gap-4 rounded-2xl border border-white/45 bg-white/35 p-5 text-left shadow-sm backdrop-blur-md transition-all hover:border-white/80 hover:bg-white/50 hover:shadow-md cursor-pointer"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#6D28D9] text-white shadow-sm">
                      <ImageIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-bold text-slate-950">
                        Image to PDF
                      </h3>
                      <p className="truncate text-xs font-medium text-slate-800">
                        JPG, JPEG, PNG, GIF, BMP, WEBP · Choose &amp; Scan
                      </p>
                    </div>
                  </button>

                  {/* Card 2: Camera Scanner (Launches Dark Scan Document UI) */}
                  <button
                    type="button"
                    onClick={() => openScanDocumentStudio('scan')}
                    className="flex items-center gap-4 rounded-2xl border border-white/45 bg-white/35 p-5 text-left shadow-sm backdrop-blur-md transition-all hover:border-white/80 hover:bg-white/50 hover:shadow-md cursor-pointer"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white shadow-sm">
                      <Camera className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-bold text-slate-950">
                        Camera Scanner
                      </h3>
                      <p className="truncate text-xs font-medium text-slate-800">
                        Live auto-detect, auto-crop &amp; RGB finish
                      </p>
                    </div>
                  </button>

                  {/* Card 3: TXT & Notes to PDF */}
                  <button
                    type="button"
                    onClick={() => handleOpenToolkitOption('txt-to-pdf')}
                    className="flex items-center gap-4 rounded-2xl border border-white/45 bg-white/35 p-5 text-left shadow-sm backdrop-blur-md transition-all hover:border-white/80 hover:bg-white/50 hover:shadow-md cursor-pointer"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                      <FileText className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-bold text-slate-950">
                        TXT &amp; Notes to PDF
                      </h3>
                      <p className="truncate text-xs font-medium text-slate-800">
                        Turn text notes into clean vector PDFs
                      </p>
                    </div>
                  </button>

                  {/* Card 4: Invoice Generator */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTemplate('invoice');
                      setSection('templates');
                    }}
                    className="flex items-center gap-4 rounded-2xl border border-white/45 bg-white/35 p-5 text-left shadow-sm backdrop-blur-md transition-all hover:border-white/80 hover:bg-white/50 hover:shadow-md cursor-pointer"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                      <Receipt className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-bold text-slate-950">
                        Invoice Generator
                      </h3>
                      <p className="truncate text-xs font-medium text-slate-800">
                        Editable line items with automatic totals
                      </p>
                    </div>
                  </button>

                  {/* Card 5: Project Brief PDF */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTemplate('brief');
                      setSection('templates');
                    }}
                    className="flex items-center gap-4 rounded-2xl border border-white/45 bg-white/35 p-5 text-left shadow-sm backdrop-blur-md transition-all hover:border-white/80 hover:bg-white/50 hover:shadow-md cursor-pointer"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                      <Code2 className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-bold text-slate-950">
                        Project Brief PDF
                      </h3>
                      <p className="truncate text-xs font-medium text-slate-800">
                        Structured specification &amp; report sheet
                      </p>
                    </div>
                  </button>

                  {/* Card 6: Certificate Maker */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTemplate('certificate');
                      setSection('templates');
                    }}
                    className="flex items-center gap-4 rounded-2xl border border-white/45 bg-white/35 p-5 text-left shadow-sm backdrop-blur-md transition-all hover:border-white/80 hover:bg-white/50 hover:shadow-md cursor-pointer"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">
                      <Award className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-bold text-slate-950">
                        Certificate Maker
                      </h3>
                      <p className="truncate text-xs font-medium text-slate-800">
                        Landscape bordered certificate press
                      </p>
                    </div>
                  </button>

                  {/* Remaining Convert to PDF Cards (Word, PPT, Excel, HTML) */}
                  {TOOLKIT_ITEMS.filter(
                    (t) => t.group === 'Convert to PDF' && t.id !== 'txt-to-pdf'
                  ).map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleOpenToolkitOption(item.id)}
                        className="flex items-center gap-4 rounded-2xl border border-white/45 bg-white/35 p-5 text-left shadow-sm backdrop-blur-md transition-all hover:border-white/80 hover:bg-white/50 hover:shadow-md cursor-pointer"
                      >
                        <span
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${item.badgeColor}`}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <h3 className="font-display text-base font-bold text-slate-950">
                            {item.label}
                          </h3>
                          <p className="truncate text-xs font-medium text-slate-800">
                            {item.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Convert from PDF */}
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/45 bg-white/38 px-4 py-2.5 shadow-sm backdrop-blur-md">
                  <h2 className="font-display text-xl font-extrabold text-slate-950">
                    Convert from PDF
                  </h2>
                  <p className="text-xs font-semibold text-slate-800">
                    Extract text, images, tables &amp; slide decks
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {TOOLKIT_ITEMS.filter((t) => t.group === 'Convert from PDF').map(
                    (item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleOpenToolkitOption(item.id)}
                          className="flex items-center gap-4 rounded-2xl border border-white/45 bg-white/35 p-5 text-left shadow-sm backdrop-blur-md transition-all hover:border-white/80 hover:bg-white/50 hover:shadow-md cursor-pointer"
                        >
                          <span
                            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${item.badgeColor}`}
                          >
                            <Icon className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <h3 className="font-display text-base font-bold text-slate-950">
                              {item.label}
                            </h3>
                            <p className="truncate text-xs font-medium text-slate-800">
                              {item.description}
                            </p>
                          </div>
                        </button>
                      );
                    }
                  )}
                </div>
              </section>

              {/* Manage & Edit PDF */}
              <section className="space-y-4 pb-8">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/45 bg-white/38 px-4 py-2.5 shadow-sm backdrop-blur-md">
                  <h2 className="font-display text-xl font-extrabold text-slate-950">
                    Manage &amp; Edit PDF
                  </h2>
                  <p className="text-xs font-semibold text-slate-800">
                    Client-side pdf-lib document engine
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {TOOLKIT_ITEMS.filter((t) => t.group === 'Manage & Edit PDF').map(
                    (item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleOpenToolkitOption(item.id)}
                          className="flex items-center gap-4 rounded-2xl border border-white/45 bg-white/35 p-5 text-left shadow-sm backdrop-blur-md transition-all hover:border-white/80 hover:bg-white/50 hover:shadow-md cursor-pointer"
                        >
                          <span
                            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${item.badgeColor}`}
                          >
                            <Icon className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <h3 className="font-display text-base font-bold text-slate-950">
                              {item.label}
                            </h3>
                            <p className="truncate text-xs font-medium text-slate-800">
                              {item.description}
                            </p>
                          </div>
                        </button>
                      );
                    }
                  )}
                </div>
              </section>
            </main>
          )}

          {/* SECTION 2: IMAGE TO PDF (CHOOSE FILE) + APPLY SCAN DOCUMENT STUDIO */}
          {section === 'image-scan' && (
            <main className="mx-auto w-full max-w-[1160px] flex-1 space-y-6 px-4 py-8 sm:px-6">
              <div className="rounded-3xl border border-white/45 bg-white/45 p-6 shadow-lg backdrop-blur-md sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/40 pb-5">
                  <div>
                    <h1 className="font-display text-2xl font-extrabold text-slate-950">
                      Image to PDF — Choose File &amp; Apply Scan Document
                    </h1>
                    <p className="mt-1 text-xs font-medium text-slate-800 sm:text-sm">
                      Choose image files or launch Camera Scan, then apply automatic edge-crop, scan filters, 5 edit tools, auto-index, and RGB Finish PDF.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openScanDocumentStudio('scan')}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    <ScanLine className="h-4 w-4 text-red-400" />
                    <span>Open Scan Document Camera</span>
                  </button>
                </div>

                {/* Choose Image File Dropzone */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files.length > 0) {
                      handleImageFilesChosen(e.dataTransfer.files, false);
                    }
                  }}
                  className="mt-6 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/60 bg-white/25 px-6 py-10 text-center backdrop-blur-sm"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#6D28D9] text-white shadow-sm">
                    <Upload className="h-6 w-6" />
                  </span>
                  <h2 className="font-display mt-3 text-lg font-bold text-slate-950">
                    Choose Document / Image Files
                  </h2>
                  <p className="mt-1 text-xs font-medium text-slate-800">
                    Drag &amp; drop JPG, JPEG, PNG, GIF, BMP, or WEBP — AI auto-cropped automatically on upload
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      disabled={isAiProcessing}
                      onClick={() => galleryInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#5B21B6] disabled:opacity-60 cursor-pointer"
                    >
                      {isAiProcessing ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileImage className="h-4 w-4" />
                      )}
                      <span>
                        {isAiProcessing ? 'AI Auto-Cropping...' : 'Choose File(s)'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiScanEnabled((v) => !v)}
                      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold cursor-pointer ${
                        aiScanEnabled
                          ? 'border-cyan-500/50 bg-cyan-50 text-cyan-800 hover:bg-cyan-100'
                          : 'border-slate-300 bg-white/80 text-slate-700 hover:bg-white'
                      }`}
                    >
                      <Wand2 className="h-4 w-4" />
                      <span>
                        AI Document Crop: {aiScanEnabled ? 'ON (Default)' : 'OFF'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={pages.length === 0}
                      onClick={() => openScanDocumentStudio('edit')}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
                    >
                      <ScanLine className="h-4 w-4 text-red-600" />
                      <span>Apply Scan Document UI on Chosen Files ({pages.length})</span>
                    </button>
                  </div>
                </div>

                {/* Locked Default Watermark & Stamp Strip */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/75 px-4 py-3">
                  <label className="flex items-center gap-2.5 text-xs font-bold text-slate-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={watermarkEnabled}
                      onChange={handleToggleWatermark}
                      className="h-4 w-4 rounded border-amber-400 text-[#6D28D9] accent-[#6D28D9] cursor-pointer"
                    />
                    <span>Default Watermark &amp; Stamp ({watermarkText})</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleToggleWatermark}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 cursor-pointer"
                  >
                    <Lock className="h-3 w-3" />
                    <span>
                      {watermarkUnlocked
                        ? watermarkEnabled
                          ? 'Unlocked · Click to Untick'
                          : 'Off · Click to Enable'
                        : 'Locked ON · Untick Rs 1,200'}
                    </span>
                  </button>
                </div>

                {/* Chosen Document Pages Queue */}
                {pages.length > 0 && (
                  <div className="mt-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-display text-sm font-bold text-slate-900">
                        Auto-Cropped Document Queue ({pages.length} page
                        {pages.length === 1 ? '' : 's'})
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openScanDocumentStudio('edit')}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
                        >
                          <Sliders className="h-3.5 w-3.5 text-red-400" />
                          <span>Scan Document Edit (5 Tools)</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleGoToFinishPdf}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#6D28D9] px-4 py-2 text-xs font-bold text-white hover:bg-[#5B21B6] cursor-pointer"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Finish PDF (Auto-Index &amp; RGB)</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                      {pages.map((p, idx) => (
                        <div
                          key={p.id}
                          className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2.5"
                        >
                          <img
                            src={p.processedUrl}
                            alt={p.label}
                            className="aspect-[3/4] w-full rounded-xl bg-white object-contain"
                          />
                          <div className="mt-2 flex items-center justify-between text-xs">
                            <span className="font-mono-tabular font-bold text-slate-700">
                              P.{idx + 1} · {p.filter}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPageIdx(idx);
                                  openScanDocumentStudio('edit');
                                }}
                                className="rounded-lg bg-violet-100 px-2 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-200 cursor-pointer"
                              >
                                Scan Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => removePageById(p.id)}
                                aria-label="Remove page"
                                className="rounded-lg p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </main>
          )}

          {/* SECTION 3: PDF TOOLKIT (All Converters + Manage Tools) */}
          {section === 'toolkit' && (
            <main className="mx-auto w-full max-w-[1220px] flex-1 px-4 py-8 sm:px-6">
              <div className="grid gap-6 rounded-3xl border border-white/45 bg-white/48 p-6 shadow-lg backdrop-blur-md lg:grid-cols-[260px_1fr]">
                <aside className="space-y-4 border-b border-white/40 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
                  {(
                    [
                      'Convert to PDF',
                      'Convert from PDF',
                      'Manage & Edit PDF',
                    ] as const
                  ).map((groupName) => (
                    <div key={groupName} className="space-y-1">
                      <p className="px-2 pb-1 text-[11px] font-bold text-slate-700">
                        {groupName}
                      </p>
                      {TOOLKIT_ITEMS.filter((t) => t.group === groupName).map((t) => {
                        const Icon = t.icon;
                        const active = toolkitTool === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => handleOpenToolkitOption(t.id)}
                            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold transition-colors cursor-pointer ${
                              active
                                ? 'bg-[#6D28D9] text-white shadow-sm'
                                : 'text-slate-800 hover:bg-white/45 hover:text-slate-950'
                            }`}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{t.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </aside>

                <div className="space-y-5">
                  {(() => {
                    const activeMeta = TOOLKIT_ITEMS.find((i) => i.id === toolkitTool);
                    const isConvertToPdf =
                      toolkitTool === 'word-to-pdf' ||
                      toolkitTool === 'ppt-to-pdf' ||
                      toolkitTool === 'excel-to-pdf' ||
                      toolkitTool === 'html-to-pdf' ||
                      toolkitTool === 'txt-to-pdf';

                    return (
                      <>
                        <div className="border-b border-white/40 pb-3">
                          <h1 className="font-display text-xl font-extrabold text-slate-950">
                            {activeMeta?.label}
                          </h1>
                          <p className="text-xs font-medium text-slate-800">
                            {activeMeta?.description}
                          </p>
                        </div>

                        {isConvertToPdf ? (
                          <div className="space-y-4">
                            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/60 bg-white/25 px-6 py-7 text-center backdrop-blur-sm">
                              <Upload className="h-6 w-6 text-[#6D28D9]" />
                              <p className="mt-2 text-xs font-semibold text-slate-900">
                                {sourceDocFile
                                  ? `Selected: ${sourceDocFile.name} (${formatBytes(sourceDocFile.size)})`
                                  : 'Choose a file (.docx, .pptx, .xlsx, .csv, .html, .txt) or paste content below'}
                              </p>
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => docConvertInputRef.current?.click()}
                                  className="rounded-xl bg-[#6D28D9] px-4 py-2 text-xs font-bold text-white hover:bg-[#5B21B6] cursor-pointer"
                                >
                                  Choose Source File
                                </button>
                                {sourceDocFile && (
                                  <button
                                    type="button"
                                    onClick={() => setSourceDocFile(null)}
                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                            </div>

                            <textarea
                              rows={6}
                              value={workspaceTextInput}
                              onChange={(e) => setWorkspaceTextInput(e.target.value)}
                              placeholder={
                                toolkitTool === 'excel-to-pdf'
                                  ? 'Item,Qty,Price\nDocument Scan,2,40.00'
                                  : toolkitTool === 'ppt-to-pdf'
                                    ? 'Slide 1 Title\nBullet point\n---\nSlide 2 Title\nSummary'
                                    : toolkitTool === 'html-to-pdf'
                                      ? '<h1>Title</h1><p>Paste HTML here...</p>'
                                      : 'Type or paste document text here...'
                              }
                              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-900 focus:border-[#6D28D9] focus:outline-none"
                            />
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/40 px-6 py-7 text-center">
                              <FilePlus2 className="h-7 w-7 text-[#6D28D9]" />
                              <p className="mt-2 text-sm font-bold text-slate-900">
                                {toolkitTool === 'merge'
                                  ? 'Choose 2 or more PDF files to merge'
                                  : 'Choose a PDF file to process'}
                              </p>
                              <button
                                type="button"
                                onClick={() => pdfInputRef.current?.click()}
                                className="mt-3 rounded-xl bg-[#6D28D9] px-4 py-2 text-xs font-bold text-white hover:bg-[#5B21B6] cursor-pointer"
                              >
                                Choose PDF {toolkitTool === 'merge' ? 'Files' : 'File'}
                              </button>
                            </div>

                            {toolkitTool === 'sign' && (
                              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-800">
                                    Draw Signature or Type Name
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const c = sigCanvasRef.current;
                                      c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
                                      setSignatureDataUrl(null);
                                    }}
                                    className="text-xs font-semibold text-[#6D28D9] hover:underline cursor-pointer"
                                  >
                                    Clear Pad
                                  </button>
                                </div>
                                <canvas
                                  ref={sigCanvasRef}
                                  width={480}
                                  height={120}
                                  onPointerDown={(e) => {
                                    const c = sigCanvasRef.current;
                                    if (!c) return;
                                    isDrawingSigRef.current = true;
                                    const rect = c.getBoundingClientRect();
                                    const ctx = c.getContext('2d');
                                    if (!ctx) return;
                                    ctx.strokeStyle = '#4c1d95';
                                    ctx.lineWidth = 2.5;
                                    ctx.lineCap = 'round';
                                    ctx.beginPath();
                                    ctx.moveTo(
                                      ((e.clientX - rect.left) / rect.width) * c.width,
                                      ((e.clientY - rect.top) / rect.height) * c.height
                                    );
                                  }}
                                  onPointerMove={(e) => {
                                    if (!isDrawingSigRef.current || !sigCanvasRef.current)
                                      return;
                                    const c = sigCanvasRef.current;
                                    const rect = c.getBoundingClientRect();
                                    const ctx = c.getContext('2d');
                                    if (!ctx) return;
                                    ctx.lineTo(
                                      ((e.clientX - rect.left) / rect.width) * c.width,
                                      ((e.clientY - rect.top) / rect.height) * c.height
                                    );
                                    ctx.stroke();
                                  }}
                                  onPointerUp={() => {
                                    isDrawingSigRef.current = false;
                                    if (sigCanvasRef.current) {
                                      setSignatureDataUrl(
                                        sigCanvasRef.current.toDataURL('image/png')
                                      );
                                    }
                                  }}
                                  onPointerLeave={() => {
                                    if (isDrawingSigRef.current && sigCanvasRef.current) {
                                      isDrawingSigRef.current = false;
                                      setSignatureDataUrl(
                                        sigCanvasRef.current.toDataURL('image/png')
                                      );
                                    }
                                  }}
                                  onPointerCancel={() => {
                                    isDrawingSigRef.current = false;
                                  }}
                                  className="h-28 w-full touch-none rounded-xl border border-slate-200 bg-white cursor-crosshair"
                                />
                                <input
                                  type="text"
                                  value={signatureName}
                                  onChange={(e) => setSignatureName(e.target.value)}
                                  placeholder="Typed signature name"
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#6D28D9] focus:outline-none"
                                />
                              </div>
                            )}

                            {toolkitTool === 'protect' && (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <input
                                  type="text"
                                  value={protectNotice}
                                  onChange={(e) => setProtectNotice(e.target.value)}
                                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 sm:col-span-2"
                                />
                                <input
                                  type="text"
                                  value={metaTitle}
                                  onChange={(e) => setMetaTitle(e.target.value)}
                                  placeholder="Document Title"
                                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                                />
                                <input
                                  type="text"
                                  value={metaAuthor}
                                  onChange={(e) => setMetaAuthor(e.target.value)}
                                  placeholder="Author"
                                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                                />
                              </div>
                            )}

                            {toolkitTool === 'split' && (
                              <input
                                type="text"
                                value={splitRange}
                                onChange={(e) => setSplitRange(e.target.value)}
                                placeholder="Page Range (e.g. 1-3, 5)"
                                className="font-mono-tabular w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                              />
                            )}

                            {toolkitTool === 'rotate' && (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="grid grid-cols-3 gap-1.5">
                                  {([90, 180, 270] as const).map((deg) => (
                                    <button
                                      key={deg}
                                      type="button"
                                      onClick={() => setRotateDegrees(deg)}
                                      className={`rounded-xl border py-2 text-xs font-bold cursor-pointer ${
                                        rotateDegrees === deg
                                          ? 'border-[#6D28D9] bg-violet-50 text-[#6D28D9]'
                                          : 'border-slate-200 bg-white text-slate-600'
                                      }`}
                                    >
                                      {deg}°
                                    </button>
                                  ))}
                                </div>
                                <input
                                  type="text"
                                  value={rotateRange}
                                  onChange={(e) => setRotateRange(e.target.value)}
                                  placeholder="All pages (or e.g. 1, 3)"
                                  className="font-mono-tabular rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                                />
                              </div>
                            )}

                            {toolkitTool === 'metadata' && (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <input
                                  type="text"
                                  value={metaTitle}
                                  onChange={(e) => setMetaTitle(e.target.value)}
                                  placeholder="Document Title"
                                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                                />
                                <input
                                  type="text"
                                  value={metaAuthor}
                                  onChange={(e) => setMetaAuthor(e.target.value)}
                                  placeholder="Author"
                                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                                />
                              </div>
                            )}

                            {/* Locked Default Watermark & Stamp Status in PDF Toolkit */}
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/75 p-3.5 space-y-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <label className="flex items-center gap-2.5 text-xs font-bold text-slate-900 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={watermarkEnabled}
                                    onChange={handleToggleWatermark}
                                    className="h-4 w-4 rounded border-amber-400 text-[#6D28D9] accent-[#6D28D9] cursor-pointer"
                                  />
                                  <span>Default Watermark &amp; Stamp</span>
                                </label>
                                <button
                                  type="button"
                                  onClick={handleToggleWatermark}
                                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 cursor-pointer"
                                >
                                  <Lock className="h-3 w-3" />
                                  <span>
                                    {watermarkUnlocked
                                      ? watermarkEnabled
                                        ? 'Unlocked · Click to Untick'
                                        : 'Off · Click to Enable'
                                      : 'Locked · Untick Rs 1,200'}
                                  </span>
                                </button>
                              </div>
                              {toolkitTool === 'watermark' && (
                                <input
                                  type="text"
                                  value={watermarkText}
                                  readOnly={!watermarkUnlocked}
                                  onClick={() => {
                                    if (!watermarkUnlocked) setShowUnlockModal(true);
                                  }}
                                  onChange={(e) => {
                                    if (watermarkUnlocked) setWatermarkText(e.target.value);
                                  }}
                                  placeholder="Watermark text"
                                  className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#6D28D9] focus:outline-none"
                                />
                              )}
                            </div>

                            {toolkitFiles.length > 0 && (
                              <div className="space-y-2">
                                {toolkitFiles.map((item, idx) => (
                                  <div
                                    key={item.id}
                                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5"
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-bold text-slate-900">
                                        {item.fileName}
                                      </p>
                                      <p className="font-mono-tabular text-[11px] text-slate-500">
                                        {item.pageCount}p · {formatBytes(item.sizeBytes)}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {toolkitTool === 'merge' && (
                                        <>
                                          <button
                                            type="button"
                                            disabled={idx === 0}
                                            onClick={() =>
                                              setToolkitFiles((prev) => {
                                                const next = [...prev];
                                                const [m] = next.splice(idx, 1);
                                                next.splice(idx - 1, 0, m);
                                                return next;
                                              })
                                            }
                                            className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
                                          >
                                            <ArrowUp className="h-3.5 w-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            disabled={idx === toolkitFiles.length - 1}
                                            onClick={() =>
                                              setToolkitFiles((prev) => {
                                                const next = [...prev];
                                                const [m] = next.splice(idx, 1);
                                                next.splice(idx + 1, 0, m);
                                                return next;
                                              })
                                            }
                                            className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
                                          >
                                            <ArrowDown className="h-3.5 w-3.5" />
                                          </button>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setToolkitFiles((prev) =>
                                            prev.filter((p) => p.id !== item.id)
                                          )
                                        }
                                        className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:text-red-600 cursor-pointer"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={
                            isCompiling ||
                            (!isConvertToPdf &&
                              (toolkitTool === 'merge'
                                ? toolkitFiles.length < 2
                                : toolkitFiles.length < 1))
                          }
                          onClick={handleRunToolkitExport}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#6D28D9] py-3 text-sm font-bold text-white hover:bg-[#5B21B6] disabled:opacity-40 cursor-pointer"
                        >
                          <FileCheck2 className="h-4 w-4" />
                          <span>
                            {isCompiling
                              ? 'Processing...'
                              : `Execute ${activeMeta?.label || 'Tool'} & Download`}
                          </span>
                        </button>

                        {convertedOutput && (
                          <div className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-bold text-slate-900">
                                {convertedOutput.title}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    triggerDownload(
                                      convertedOutput.downloadUrl,
                                      convertedOutput.downloadName
                                    )
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#6D28D9] px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  <span>{convertedOutput.downloadName}</span>
                                </button>
                                {convertedOutput.secondaryUrl &&
                                  convertedOutput.secondaryName && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        triggerDownload(
                                          convertedOutput.secondaryUrl!,
                                          convertedOutput.secondaryName!
                                        )
                                      }
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 cursor-pointer"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      <span>{convertedOutput.secondaryName}</span>
                                    </button>
                                  )}
                              </div>
                            </div>
                            {convertedOutput.textPreview && (
                              <pre className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-800 whitespace-pre-wrap">
                                {convertedOutput.textPreview}
                              </pre>
                            )}
                            {convertedOutput.images &&
                              convertedOutput.images.length > 0 && (
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                  {convertedOutput.images.map((img) => (
                                    <div
                                      key={img.pageNumber}
                                      className="overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5"
                                    >
                                      <img
                                        src={img.url}
                                        alt={`Page ${img.pageNumber}`}
                                        className="w-full rounded object-contain"
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          triggerDownload(
                                            img.url,
                                            `page_${img.pageNumber}.png`
                                          )
                                        }
                                        className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg bg-slate-900 py-1 text-[11px] font-bold text-white cursor-pointer"
                                      >
                                        <Download className="h-3 w-3" />
                                        <span>Page {img.pageNumber} PNG</span>
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </main>
          )}

          {/* SECTION 4: TEMPLATES (Invoice, Project Brief, Certificate) */}
          {section === 'templates' && (
            <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6">
              <div className="rounded-3xl border border-white/45 bg-white/48 p-6 shadow-lg backdrop-blur-md sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
                  <div>
                    <h1 className="font-display text-2xl font-extrabold text-slate-900">
                      PDF Document Templates
                    </h1>
                    <p className="text-xs text-slate-500">
                      Generate clean vector PDFs with your {watermarkText} watermark.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleToggleWatermark}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 cursor-pointer"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span>
                        Watermark: {watermarkEnabled ? 'Locked ON (Untick Rs 1,200)' : 'Off'}
                      </span>
                    </button>
                    <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
                      {(
                        [
                          { id: 'invoice', label: 'Invoice' },
                          { id: 'brief', label: 'Project Brief' },
                          { id: 'certificate', label: 'Certificate' },
                        ] as const
                      ).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setActiveTemplate(t.id)}
                          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold cursor-pointer ${
                            activeTemplate === t.id
                              ? 'bg-[#6D28D9] text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {activeTemplate === 'invoice' && (
                  <div className="mt-6 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        type="text"
                        value={invoiceClient}
                        onChange={(e) => setInvoiceClient(e.target.value)}
                        placeholder="Client Name"
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900"
                      />
                      <input
                        type="text"
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        placeholder="Invoice Number"
                        className="font-mono-tabular rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900"
                      />
                    </div>
                    <div className="space-y-2">
                      {invoiceItems.map((it, idx) => (
                        <div key={it.id} className="grid grid-cols-[1fr_70px_90px_auto] gap-2">
                          <input
                            type="text"
                            value={it.description}
                            onChange={(e) =>
                              setInvoiceItems((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, description: e.target.value } : x
                                )
                              )
                            }
                            className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900"
                          />
                          <input
                            type="number"
                            value={it.qty}
                            onChange={(e) =>
                              setInvoiceItems((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, qty: Number(e.target.value) } : x
                                )
                              )
                            }
                            className="font-mono-tabular rounded-xl border border-slate-200 px-2.5 py-2 text-xs text-slate-900"
                          />
                          <input
                            type="number"
                            value={it.unitPrice}
                            onChange={(e) =>
                              setInvoiceItems((prev) =>
                                prev.map((x, i) =>
                                  i === idx
                                    ? { ...x, unitPrice: Number(e.target.value) }
                                    : x
                                )
                              )
                            }
                            className="font-mono-tabular rounded-xl border border-slate-200 px-2.5 py-2 text-xs text-slate-900"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setInvoiceItems((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="rounded-xl px-2 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-2">
                        <button
                          type="button"
                          onClick={() =>
                            setInvoiceItems((prev) => [
                              ...prev,
                              {
                                id: String(Date.now()),
                                description: 'Additional PDF Service',
                                qty: 1,
                                unitPrice: 50,
                              },
                            ])
                          }
                          className="inline-flex items-center gap-1 text-xs font-bold text-[#6D28D9] cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Add Line Item</span>
                        </button>
                        <span className="font-mono-tabular text-sm font-extrabold text-slate-900">
                          Total: ${invoiceTotal.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {activeTemplate === 'brief' && (
                  <div className="mt-6 space-y-3">
                    <input
                      type="text"
                      value={briefTitle}
                      onChange={(e) => setBriefTitle(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900"
                    />
                    <textarea
                      rows={3}
                      value={briefSummary}
                      onChange={(e) => setBriefSummary(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-900"
                    />
                    <textarea
                      rows={4}
                      value={briefScope}
                      onChange={(e) => setBriefScope(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-900"
                    />
                  </div>
                )}

                {activeTemplate === 'certificate' && (
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      value={certRecipient}
                      onChange={(e) => setCertRecipient(e.target.value)}
                      placeholder="Recipient Name"
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900"
                    />
                    <input
                      type="text"
                      value={certIssuer}
                      onChange={(e) => setCertIssuer(e.target.value)}
                      placeholder="Issuing Organization"
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900"
                    />
                    <input
                      type="text"
                      value={certCourse}
                      onChange={(e) => setCertCourse(e.target.value)}
                      placeholder="Achievement / Program"
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 sm:col-span-2"
                    />
                  </div>
                )}

                <button
                  type="button"
                  disabled={isCompiling}
                  onClick={() => handleGenerateTemplatePdf(activeTemplate)}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#6D28D9] py-3 text-sm font-bold text-white hover:bg-[#5B21B6] disabled:opacity-45 cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>
                    {isCompiling
                      ? 'Generating Vector PDF...'
                      : `Generate & Download ${activeTemplate.toUpperCase()} PDF`}
                  </span>
                </button>
              </div>
            </main>
          )}
        </>
      )}

      {/* ====================================================================
          In-App PDF Viewer Modal
         ==================================================================== */}
      {previewModalUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-[#120D14]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <span className="font-display text-sm font-bold text-white">
                {finalPdf?.filename}
              </span>
              <div className="flex items-center gap-2">
                {finalPdf && (
                  <button
                    type="button"
                    onClick={() => triggerDownload(finalPdf.url, finalPdf.filename)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-3 py-1.5 text-xs font-bold text-black cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewModalUrl(null)}
                  aria-label="Close PDF preview"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 text-white/75 hover:bg-white/10 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <iframe
              src={previewModalUrl}
              title="Compiled PDF Preview"
              className="h-full w-full flex-1 bg-white"
            />
          </div>
        </div>
      )}

      {/* ====================================================================
          Rs 1,200 Watermark & Stamp Unlock Modal
         ==================================================================== */}
      {showUnlockModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-3xl border border-purple-200 bg-white p-6 text-slate-900 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <Lock className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-extrabold text-slate-900">
                    Unlock Watermark Removal
                  </h2>
                  <p className="text-xs font-medium text-slate-500">
                    ShMp3100 Tool PDFMR Pro License
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowUnlockModal(false)}
                aria-label="Close unlock dialog"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-bold text-amber-900">
                  Untick Default Watermark &amp; Stamp
                </span>
                <span className="font-mono-tabular text-2xl font-extrabold text-[#6D28D9]">
                  Rs 1,200
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-700">
                By default, the <span className="font-bold">{watermarkText}</span> watermark &amp; stamp stay locked ON across all PDFs. Upgrade for <span className="font-bold">Rs 1,200</span> to untick, customize, or remove watermark stamps.
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setShowUnlockModal(false);
                  notify(
                    'success',
                    'Contact ShMp3100 Studio (Rs 1,200 Pro Plan) to activate watermark removal.'
                  );
                }}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#5B21B6] cursor-pointer"
              >
                <ShieldCheck className="h-4 w-4" />
                <span>Get Pro License · Rs 1,200</span>
              </button>
              <button
                type="button"
                onClick={() => setShowUnlockModal(false)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Keep Default Stamp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          Toast Feedback
         ==================================================================== */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-2.5 rounded-2xl border px-4 py-3 text-xs font-semibold shadow-2xl backdrop-blur-xl ${
            toast.kind === 'success'
              ? 'border-emerald-500/40 bg-[#0D1A12]/95 text-emerald-200'
              : 'border-red-500/40 bg-[#1F0B0D]/95 text-red-200'
          }`}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          )}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
