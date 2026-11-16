import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Award,
  Camera,
  Check,
  CheckCircle2,
  Code2,
  Download,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FileStack,
  FileText,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  LayoutGrid,
  Plus,
  RefreshCw,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  Stamp,
  Trash2,
  X,
} from 'lucide-react';

// ============================================================================
// Types & Interfaces
// ============================================================================

type AppView = 'tools' | 'image-scan' | 'pdf-toolkit' | 'template-press';
type PdfToolkitTool =
  | 'merge'
  | 'split'
  | 'rotate'
  | 'watermark'
  | 'page-numbers'
  | 'metadata';
type ScanFilter = 'original' | 'crisp' | 'mono';
type PageSizeOption = 'a4' | 'letter' | 'fit';
type OrientationOption = 'portrait' | 'landscape';
type MarginOption = 'none' | 'compact' | 'standard';
type WatermarkPlacement = 'diagonal' | 'footer';
type TemplateKind = 'invoice' | 'certificate' | 'brief' | 'note';

interface WatermarkSettings {
  enabled: boolean;
  text: string;
  opacity: number;
  placement: WatermarkPlacement;
}

interface PageNumberSettings {
  enabled: boolean;
  position: 'bottom-right' | 'bottom-center';
}

interface ExportConfig {
  filename: string;
  pageSize: PageSizeOption;
  orientation: OrientationOption;
  margin: MarginOption;
  watermark: WatermarkSettings;
  pageNumbers: PageNumberSettings;
}

interface QueuedImageItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  filter: ScanFilter;
  source: 'upload' | 'camera';
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

interface ExportedRecord {
  id: string;
  filename: string;
  url: string;
  sizeBytes: number;
  pageCount: number;
  toolLabel: string;
  createdAt: string;
}

interface InvoiceLineItem {
  id: string;
  description: string;
  qty: number;
  rate: number;
}

interface TemplateDocumentState {
  kind: TemplateKind;
  title: string;
  subtitle: string;
  senderName: string;
  recipientName: string;
  referenceCode: string;
  dateText: string;
  bodyText: string;
  currency: string;
  lineItems: InvoiceLineItem[];
  signatureName: string;
}

interface GeneratedPdfResult {
  blob: Blob;
  url: string;
  filename: string;
  pageCount: number;
  sizeBytes: number;
}

interface CapturedFrame {
  id: string;
  rawUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  filter: ScanFilter;
}

interface ToastMessage {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

// ============================================================================
// Constants & Presets
// ============================================================================

const ACCEPTED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
]);

const TEMPLATE_PRESETS: Record<TemplateKind, TemplateDocumentState> = {
  invoice: {
    kind: 'invoice',
    title: 'Studio Services Invoice',
    subtitle: 'Design, document automation, and production delivery',
    senderName: 'ShMp3100 Studio',
    recipientName: 'Northstar Systems Ltd.',
    referenceCode: 'INV-2026-041',
    dateText: 'November 16, 2026',
    bodyText:
      'Payment due within 14 days via bank transfer. Thank you for working with ShMp3100 Studio.',
    currency: '$',
    lineItems: [
      { id: 'li-1', description: 'Interface Architecture & Layout Design', qty: 1, rate: 850 },
      { id: 'li-2', description: 'Document Automation & PDF Pipeline', qty: 2, rate: 320 },
    ],
    signatureName: 'ShMp3100',
  },
  certificate: {
    kind: 'certificate',
    title: 'Certificate of Achievement',
    subtitle: 'ShMp3100 Design & Engineering Studio',
    senderName: 'ShMp3100 Tool',
    recipientName: 'Avery Chen',
    referenceCode: 'CERT-3100-08',
    dateText: 'November 16, 2026',
    bodyText:
      'For demonstrating excellence in modern web interface craft, document engineering, and accessible software design.',
    currency: '$',
    lineItems: [],
    signatureName: 'ShMp3100 Director',
  },
  brief: {
    kind: 'brief',
    title: 'Project Specification Brief',
    subtitle: 'Structured Document',
    senderName: 'ShMp3100 Engineering',
    recipientName: 'Core Product Team',
    referenceCode: 'DOC-2026-11',
    dateText: 'November 16, 2026',
    bodyText:
      'Objective: Deliver a browser-native PDF studio supporting image conversion, live camera document scanning, page merging, splitting, rotation, and vector template printing.\n\nDeliverables:\n1. Multi-format image pipeline (JPG, PNG, WEBP, GIF, BMP) with scan contrast presets.\n2. Deterministic PDF manipulation via pdf-lib for merging, splitting, and stamping.\n3. Live sheet preview synchronized with export settings.',
    currency: '$',
    lineItems: [],
    signatureName: 'Prepared by ShMp3100',
  },
  note: {
    kind: 'note',
    title: 'Plain Text & Notes to PDF',
    subtitle: 'TXT / Memorandum',
    senderName: 'ShMp3100',
    recipientName: 'Archive Copy',
    referenceCode: 'TXT-002',
    dateText: 'November 16, 2026',
    bodyText:
      'Paste or type any text, notes, or document copy here. Every change updates the live sheet preview and exports directly as a crisp vector PDF stamped with your chosen watermark.',
    currency: '$',
    lineItems: [],
    signatureName: 'ShMp3100',
  },
};

const TOOLKIT_ITEMS: {
  id: PdfToolkitTool;
  label: string;
  description: string;
  colorClass: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'merge',
    label: 'Merge PDFs',
    description: 'Combine multiple PDFs in sequence',
    colorClass: 'bg-[#2563EB]',
    icon: Layers,
  },
  {
    id: 'split',
    label: 'Split & Extract',
    description: 'Extract exact page ranges',
    colorClass: 'bg-[#7C3AED]',
    icon: Scissors,
  },
  {
    id: 'rotate',
    label: 'Rotate Pages',
    description: 'Rotate sheets 90°, 180°, or 270°',
    colorClass: 'bg-[#EA580C]',
    icon: RotateCw,
  },
  {
    id: 'watermark',
    label: 'Watermark Stamp',
    description: 'Apply ShMp3100 Tool PDFMR stamp',
    colorClass: 'bg-[#16A34A]',
    icon: Stamp,
  },
  {
    id: 'page-numbers',
    label: 'Page Numbers',
    description: 'Number pages bottom-right or center',
    colorClass: 'bg-[#0284C7]',
    icon: Hash,
  },
  {
    id: 'metadata',
    label: 'Metadata & Clean',
    description: 'Edit Title, Author & rebuild stream',
    colorClass: 'bg-[#4F46E5]',
    icon: SlidersHorizontal,
  },
];

const TEMPLATE_ITEMS: { id: TemplateKind; label: string }[] = [
  { id: 'invoice', label: 'Studio Invoice' },
  { id: 'certificate', label: 'Certificate' },
  { id: 'brief', label: 'Brief to PDF' },
  { id: 'note', label: 'TXT to PDF' },
];

// ============================================================================
// Pure Browser PDF Engine (jsPDF + pdf-lib)
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizePdfFilename(rawName: string, fallback = 'ShMp3100_Document'): string {
  const trimmed = rawName.trim() || fallback;
  const sanitized = trimmed.replace(/[<>:"/\\|?*]+/g, '_');
  return sanitized.toLowerCase().endsWith('.pdf') ? sanitized : `${sanitized}.pdf`;
}

function readImageDimensions(
  src: string
): Promise<{ width: number; height: number; img: HTMLImageElement }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width || 1000,
        height: img.naturalHeight || img.height || 1000,
        img,
      });
    };
    img.onerror = () => reject(new Error('Unable to decode image file.'));
    img.src = src;
  });
}

async function processImageToDataUrl(
  src: string,
  rotation: 0 | 90 | 180 | 270,
  filter: ScanFilter
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { img, width, height } = await readImageDimensions(src);
  const swap = rotation === 90 || rotation === 270;
  const outW = swap ? height : width;
  const outH = swap ? width : height;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotation * Math.PI) / 180);

  if (filter === 'crisp') {
    ctx.filter = 'contrast(1.25) brightness(1.06) saturate(1.08)';
  } else if (filter === 'mono') {
    ctx.filter = 'grayscale(1) contrast(1.42) brightness(1.08)';
  } else {
    ctx.filter = 'none';
  }

  ctx.drawImage(img, -width / 2, -height / 2, width, height);
  ctx.restore();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  return { dataUrl, width: outW, height: outH };
}

function drawJsPdfWatermark(
  doc: jsPDF,
  pageW: number,
  pageH: number,
  watermark: WatermarkSettings
) {
  if (!watermark.enabled || !watermark.text.trim()) return;
  const text = watermark.text.trim();
  const alpha = Math.min(0.75, Math.max(0.05, watermark.opacity));

  doc.saveGraphicsState();
  // @ts-expect-error jsPDF GState is available at runtime
  const gState = new doc.GState({ opacity: alpha });
  doc.setGState(gState);
  doc.setTextColor(108, 60, 225);

  if (watermark.placement === 'diagonal') {
    const fontSize = Math.max(18, Math.min(34, pageW * 0.13));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.text(text, pageW / 2, pageH / 2, {
      align: 'center',
      angle: 35,
    });
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(text, 14, pageH - 9);
  }
  doc.restoreGraphicsState();
}

function drawJsPdfPageNumber(
  doc: jsPDF,
  pageW: number,
  pageH: number,
  pageIndex: number,
  totalPages: number,
  position: 'bottom-right' | 'bottom-center'
) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 94, 130);
  const label = `${pageIndex} / ${totalPages}`;
  if (position === 'bottom-center') {
    doc.text(label, pageW / 2, pageH - 9, { align: 'center' });
  } else {
    doc.text(label, pageW - 14, pageH - 9, { align: 'right' });
  }
}

async function buildPdfFromImages(
  items: QueuedImageItem[],
  config: ExportConfig
): Promise<GeneratedPdfResult> {
  if (items.length === 0) {
    throw new Error('Add at least one image or camera scan before exporting.');
  }

  const marginMm =
    config.margin === 'none' ? 0 : config.margin === 'compact' ? 8 : 16;

  let doc: jsPDF | null = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const processed = await processImageToDataUrl(
      item.previewUrl,
      item.rotation,
      item.filter
    );

    const pxToMm = 25.4 / 96;
    const imgWmm = processed.width * pxToMm;

    let pageFormat: string | [number, number] =
      config.pageSize === 'letter' ? 'letter' : 'a4';
    let orientation: 'portrait' | 'landscape' = config.orientation;

    if (config.pageSize === 'fit') {
      const targetW = Math.max(60, Math.min(420, imgWmm + marginMm * 2));
      const targetH = targetW * (processed.height / processed.width) + marginMm * 2;
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

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const availW = Math.max(10, pageW - marginMm * 2);
    const availH = Math.max(10, pageH - marginMm * 2);

    const ratio = Math.min(availW / processed.width, availH / processed.height);
    const renderW = processed.width * ratio;
    const renderH = processed.height * ratio;
    const x = (pageW - renderW) / 2;
    const y = (pageH - renderH) / 2;

    doc.addImage(processed.dataUrl, 'JPEG', x, y, renderW, renderH, undefined, 'FAST');
    drawJsPdfWatermark(doc, pageW, pageH, config.watermark);
    if (config.pageNumbers.enabled) {
      drawJsPdfPageNumber(
        doc,
        pageW,
        pageH,
        i + 1,
        items.length,
        config.pageNumbers.position
      );
    }
  }

  if (!doc) {
    throw new Error('Failed to initialize PDF document.');
  }

  const filename = normalizePdfFilename(config.filename, 'ShMp3100_Images');
  doc.setProperties({
    title: filename.replace(/\.pdf$/i, ''),
    creator: 'ShMp3100 Tool PDFMR',
    author: 'ShMp3100',
  });

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);

  return {
    blob,
    url,
    filename,
    pageCount: items.length,
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

async function applyPdfLibOverlays(
  pdfDoc: PDFDocument,
  watermark: WatermarkSettings,
  pageNumbers: PageNumberSettings
) {
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const total = pages.length;

  pages.forEach((page, idx) => {
    const { width, height } = page.getSize();

    if (watermark.enabled && watermark.text.trim()) {
      const text = watermark.text.trim();
      const alpha = Math.min(0.75, Math.max(0.05, watermark.opacity));
      if (watermark.placement === 'diagonal') {
        const size = Math.max(20, Math.min(44, width * 0.07));
        const textWidth = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: Math.max(24, (width - textWidth * 0.82) / 2),
          y: height * 0.42,
          size,
          font,
          color: rgb(0.42, 0.24, 0.88),
          opacity: alpha,
          rotate: degrees(35),
        });
      } else {
        page.drawText(text, {
          x: 28,
          y: 22,
          size: 9,
          font,
          color: rgb(0.42, 0.24, 0.88),
          opacity: Math.max(0.25, alpha),
        });
      }
    }

    if (pageNumbers.enabled) {
      const label = `${idx + 1} / ${total}`;
      const size = 9;
      const labelWidth = regularFont.widthOfTextAtSize(label, size);
      const x =
        pageNumbers.position === 'bottom-center'
          ? (width - labelWidth) / 2
          : width - labelWidth - 28;
      page.drawText(label, {
        x,
        y: 22,
        size,
        font: regularFont,
        color: rgb(0.38, 0.35, 0.5),
      });
    }
  });
}

async function mergePdfFiles(
  items: QueuedPdfItem[],
  config: ExportConfig
): Promise<GeneratedPdfResult> {
  if (items.length < 2) {
    throw new Error('Upload at least 2 PDF files to merge.');
  }

  const merged = await PDFDocument.create();
  for (const item of items) {
    const buffer = await item.file.arrayBuffer();
    const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const copied = await merged.copyPages(source, source.getPageIndices());
    copied.forEach((p) => merged.addPage(p));
  }

  await applyPdfLibOverlays(merged, config.watermark, config.pageNumbers);
  const filename = normalizePdfFilename(config.filename, 'ShMp3100_Merged');
  merged.setTitle(filename.replace(/\.pdf$/i, ''));
  merged.setCreator('ShMp3100 Tool PDFMR');

  const outBytes = await merged.save();
  const blob = new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  return {
    blob,
    url,
    filename,
    pageCount: merged.getPageCount(),
    sizeBytes: blob.size,
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
        throw new Error(
          `Invalid range "${token}". Pages must be between 1 and ${maxPages}.`
        );
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
        throw new Error(
          `Invalid page "${token}". Must be between 1 and ${maxPages}.`
        );
      }
      if (!seen.has(pageNum - 1)) {
        seen.add(pageNum - 1);
        indices.push(pageNum - 1);
      }
    }
  }

  if (indices.length === 0) {
    throw new Error('No valid pages selected.');
  }
  return indices;
}

async function splitPdfFile(
  item: QueuedPdfItem,
  rangeStr: string,
  config: ExportConfig
): Promise<GeneratedPdfResult> {
  const buffer = await item.file.arrayBuffer();
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const indices = parsePageRanges(rangeStr, source.getPageCount());

  const target = await PDFDocument.create();
  const copied = await target.copyPages(source, indices);
  copied.forEach((p) => target.addPage(p));

  await applyPdfLibOverlays(target, config.watermark, config.pageNumbers);
  const filename = normalizePdfFilename(
    config.filename,
    `${item.title}_extracted`
  );
  target.setTitle(filename.replace(/\.pdf$/i, ''));
  target.setCreator('ShMp3100 Tool PDFMR');

  const outBytes = await target.save();
  const blob = new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  return {
    blob,
    url,
    filename,
    pageCount: target.getPageCount(),
    sizeBytes: blob.size,
  };
}

async function rotatePdfFile(
  item: QueuedPdfItem,
  rotateBy: 90 | 180 | 270,
  rangeStr: string,
  config: ExportConfig
): Promise<GeneratedPdfResult> {
  const buffer = await item.file.arrayBuffer();
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages = doc.getPages();
  const indices = rangeStr.trim()
    ? parsePageRanges(rangeStr, pages.length)
    : pages.map((_, i) => i);

  for (const idx of indices) {
    const page = pages[idx];
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + rotateBy) % 360));
  }

  await applyPdfLibOverlays(doc, config.watermark, config.pageNumbers);
  const filename = normalizePdfFilename(config.filename, `${item.title}_rotated`);
  doc.setCreator('ShMp3100 Tool PDFMR');

  const outBytes = await doc.save();
  const blob = new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  return {
    blob,
    url,
    filename,
    pageCount: doc.getPageCount(),
    sizeBytes: blob.size,
  };
}

async function stampPdfFile(
  item: QueuedPdfItem,
  config: ExportConfig,
  customMeta?: { title: string; author: string }
): Promise<GeneratedPdfResult> {
  const buffer = await item.file.arrayBuffer();
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  await applyPdfLibOverlays(doc, config.watermark, config.pageNumbers);

  if (customMeta) {
    if (customMeta.title.trim()) doc.setTitle(customMeta.title.trim());
    if (customMeta.author.trim()) doc.setAuthor(customMeta.author.trim());
  }
  doc.setCreator('ShMp3100 Tool PDFMR');

  const outBytes = await doc.save({ useObjectStreams: true });
  const blob = new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const filename = normalizePdfFilename(config.filename, `${item.title}_stamped`);

  return {
    blob,
    url,
    filename,
    pageCount: doc.getPageCount(),
    sizeBytes: blob.size,
  };
}

async function buildTemplatePdf(
  tpl: TemplateDocumentState,
  config: ExportConfig
): Promise<GeneratedPdfResult> {
  const doc = new jsPDF({
    orientation: tpl.kind === 'certificate' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: config.pageSize === 'letter' ? 'letter' : 'a4',
    compress: true,
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  if (tpl.kind === 'certificate') {
    doc.setDrawColor(108, 60, 225);
    doc.setLineWidth(1.2);
    doc.rect(12, 12, pageW - 24, pageH - 24);
    doc.setDrawColor(196, 181, 253);
    doc.setLineWidth(0.4);
    doc.rect(16, 16, pageW - 32, pageH - 32);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(108, 60, 225);
    doc.text(
      tpl.subtitle.toUpperCase() || 'CERTIFICATE OF ACHIEVEMENT',
      pageW / 2,
      42,
      { align: 'center' }
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    doc.setTextColor(30, 27, 75);
    doc.text(tpl.title || 'Certificate Title', pageW / 2, 62, {
      align: 'center',
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(100, 94, 130);
    doc.text('Presented to', pageW / 2, 82, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(30, 27, 75);
    doc.text(tpl.recipientName || 'Recipient Name', pageW / 2, 98, {
      align: 'center',
    });

    doc.setDrawColor(108, 60, 225);
    doc.setLineWidth(0.6);
    doc.line(pageW / 2 - 55, 104, pageW / 2 + 55, 104);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(76, 70, 108);
    const wrapped = doc.splitTextToSize(tpl.bodyText || '', pageW - 80);
    doc.text(wrapped, pageW / 2, 120, { align: 'center' });

    doc.setFontSize(10);
    doc.text(tpl.dateText || '', 42, pageH - 34);
    doc.line(35, pageH - 40, 95, pageH - 40);
    doc.text(
      tpl.signatureName || tpl.senderName || 'Authorized Signatory',
      pageW - 42,
      pageH - 34,
      { align: 'right' }
    );
    doc.line(pageW - 95, pageH - 40, pageW - 35, pageH - 40);
  } else if (tpl.kind === 'invoice') {
    doc.setFillColor(108, 60, 225);
    doc.rect(0, 0, pageW, 38, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(tpl.title || 'INVOICE', 18, 21);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(233, 226, 255);
    doc.text(tpl.referenceCode || 'INV-2026-001', 18, 29);

    doc.text(tpl.senderName || 'ShMp3100 Studio', pageW - 18, 20, {
      align: 'right',
    });
    doc.text(tpl.dateText || '', pageW - 18, 27, { align: 'right' });

    doc.setTextColor(30, 27, 75);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('BILL TO', 18, 54);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.text(tpl.recipientName || 'Client Name', 18, 61);

    doc.setFontSize(9.5);
    doc.setTextColor(100, 94, 130);
    doc.text(tpl.subtitle || '', 18, 68);

    let y = 84;
    doc.setFillColor(243, 239, 254);
    doc.rect(18, y, pageW - 36, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(76, 29, 149);
    doc.text('DESCRIPTION', 22, y + 6);
    doc.text('QTY', pageW - 72, y + 6, { align: 'right' });
    doc.text('RATE', pageW - 46, y + 6, { align: 'right' });
    doc.text('AMOUNT', pageW - 22, y + 6, { align: 'right' });

    y += 14;
    let grandTotal = 0;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    for (const row of tpl.lineItems) {
      const lineTotal = row.qty * row.rate;
      grandTotal += lineTotal;
      doc.setTextColor(30, 27, 75);
      doc.text(row.description || 'Service Item', 22, y);
      doc.text(String(row.qty), pageW - 72, y, { align: 'right' });
      doc.text(`${tpl.currency}${row.rate.toFixed(2)}`, pageW - 46, y, {
        align: 'right',
      });
      doc.text(`${tpl.currency}${lineTotal.toFixed(2)}`, pageW - 22, y, {
        align: 'right',
      });
      doc.setDrawColor(233, 226, 255);
      doc.line(18, y + 3.5, pageW - 18, y + 3.5);
      y += 10;
    }

    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(108, 60, 225);
    doc.text('TOTAL DUE', pageW - 64, y);
    doc.setTextColor(30, 27, 75);
    doc.text(`${tpl.currency}${grandTotal.toFixed(2)}`, pageW - 22, y, {
      align: 'right',
    });

    if (tpl.bodyText.trim()) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(100, 94, 130);
      const notes = doc.splitTextToSize(tpl.bodyText, pageW - 36);
      doc.text(notes, 18, y + 18);
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(108, 60, 225);
    doc.text((tpl.subtitle || 'DOCUMENT BRIEF').toUpperCase(), 20, 24);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(30, 27, 75);
    doc.text(tpl.title || 'Untitled Document', 20, 35);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 94, 130);
    const metaLine = [
      tpl.senderName,
      tpl.recipientName,
      tpl.dateText,
      tpl.referenceCode,
    ]
      .filter(Boolean)
      .join('  ·  ');
    doc.text(metaLine, 20, 44);

    doc.setDrawColor(229, 221, 251);
    doc.line(20, 49, pageW - 20, 49);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(30, 27, 75);
    const bodyLines = doc.splitTextToSize(tpl.bodyText || '', pageW - 40);
    doc.text(bodyLines, 20, 60);

    if (tpl.signatureName.trim()) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(tpl.signatureName, 20, pageH - 28);
    }
  }

  drawJsPdfWatermark(doc, pageW, pageH, config.watermark);
  if (config.pageNumbers.enabled) {
    drawJsPdfPageNumber(doc, pageW, pageH, 1, 1, config.pageNumbers.position);
  }

  const filename = normalizePdfFilename(config.filename, `ShMp3100_${tpl.kind}`);
  doc.setProperties({
    title: tpl.title || filename.replace(/\.pdf$/i, ''),
    creator: 'ShMp3100 Tool PDFMR',
    author: tpl.senderName || 'ShMp3100',
  });

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);

  return {
    blob,
    url,
    filename,
    pageCount: 1,
    sizeBytes: blob.size,
  };
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ============================================================================
// Brand Emblem SVG
// ============================================================================

function ShMpBrandLogo({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="shmp-cloud" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="55%" stopColor="#6C3CE1" />
          <stop offset="100%" stopColor="#9333EA" />
        </linearGradient>
        <linearGradient id="shmp-laptop" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </linearGradient>
        <linearGradient id="shmp-shield" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="#131826" />
      <path
        d="M27 43 C27 32, 36 25, 45 25 C48 16, 61 16, 67 25 C76 25, 80 34, 76 43 C80 49, 76 55, 69 55 L31 55 C24 55, 21 49, 27 43Z"
        fill="url(#shmp-cloud)"
      />
      <circle cx="42" cy="34" r="2" fill="white" opacity="0.85" />
      <circle cx="56" cy="30" r="1.5" fill="white" opacity="0.7" />
      <rect x="22" y="57" width="56" height="27" rx="3.5" fill="url(#shmp-laptop)" />
      <rect x="26" y="60" width="48" height="20" rx="2" fill="#0F172A" />
      <circle cx="42" cy="70" r="6.5" fill="#38BDF8" />
      <circle cx="42" cy="70" r="3" fill="#0F172A" />
      <path
        d="M60 63 L70 63 L70 72 C70 76, 65 79, 65 79 C65 79, 60 76, 60 72Z"
        fill="url(#shmp-shield)"
      />
      <path
        d="M63 70 L65 72 L68 68"
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="17" y="84" width="66" height="4" rx="2" fill="#1E40AF" />
    </svg>
  );
}

// ============================================================================
// Main Single-File Web Application: ShMp3100 Tool — PDFMR Studio
// ============================================================================

export default function App() {
  const hiddenImageInputRef = useRef<HTMLInputElement | null>(null);
  const toolkitPdfInputRef = useRef<HTMLInputElement | null>(null);

  // Main View State (All Tools Hub vs Active Workspace)
  const [view, setView] = useState<AppView>('tools');
  const [activeToolkitTool, setActiveToolkitTool] = useState<PdfToolkitTool>('merge');

  // Camera Scanner Modal State
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraState, setCameraState] = useState<'idle' | 'active' | 'error'>('idle');
  const [cameraError, setCameraError] = useState('');
  const [cameraFilter, setCameraFilter] = useState<ScanFilter>('crisp');
  const [capturedFrames, setCapturedFrames] = useState<CapturedFrame[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);

  // Image & Scan Workbench State
  const [images, setImages] = useState<QueuedImageItem[]>([]);
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);
  const [isDraggingImage, setIsDraggingImage] = useState(false);

  // PDF Toolkit State
  const [pdfFiles, setPdfFiles] = useState<QueuedPdfItem[]>([]);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);
  const [splitRange, setSplitRange] = useState('1');
  const [rotateDegrees, setRotateDegrees] = useState<90 | 180 | 270>(90);
  const [rotateRange, setRotateRange] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaAuthor, setMetaAuthor] = useState('ShMp3100');

  // Template Press State
  const [templateState, setTemplateState] = useState<TemplateDocumentState>(
    TEMPLATE_PRESETS.invoice
  );

  // Export & Watermark Config
  const [exportConfig, setExportConfig] = useState<ExportConfig>({
    filename: 'ShMp3100_Document',
    pageSize: 'a4',
    orientation: 'portrait',
    margin: 'standard',
    watermark: {
      enabled: true,
      text: 'ShMp3100 Tool PDFMR',
      opacity: 0.2,
      placement: 'diagonal',
    },
    pageNumbers: {
      enabled: true,
      position: 'bottom-right',
    },
  });

  const [isExporting, setIsExporting] = useState(false);
  const [exportsHistory, setExportsHistory] = useState<ExportedRecord[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const notify = useCallback((kind: 'success' | 'error', text: string) => {
    setToast({ id: Date.now(), kind, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // ==========================================================================
  // Camera Lifecycle & Controls
  // ==========================================================================

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCameraStream = useCallback(
    async (facing: 'environment' | 'user') => {
      stopCameraStream();
      setCameraState('idle');
      setCameraError('');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraState('error');
        setCameraError('Camera API is not supported in this browser.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1600 },
            height: { ideal: 1200 },
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState('active');
      } catch (err) {
        setCameraState('error');
        setCameraError(
          err instanceof Error
            ? `Camera unavailable (${err.message}). Allow permission or upload image files directly.`
            : 'Camera access denied. Allow permissions and retry.'
        );
      }
    },
    [stopCameraStream]
  );

  useEffect(() => {
    if (cameraOpen) {
      startCameraStream(facingMode);
    } else {
      stopCameraStream();
      setCapturedFrames([]);
    }
    return () => stopCameraStream();
  }, [cameraOpen, facingMode, startCameraStream, stopCameraStream]);

  useEffect(() => {
    if (!cameraOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCameraOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cameraOpen]);

  const handleCaptureCameraPage = async () => {
    const video = videoRef.current;
    if (!video || cameraState !== 'active' || isCapturing) return;

    setIsCapturing(true);
    try {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 960;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const rawUrl = canvas.toDataURL('image/jpeg', 0.94);
      const processed = await processImageToDataUrl(rawUrl, 0, cameraFilter);

      setCapturedFrames((prev) => [
        ...prev,
        {
          id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          rawUrl,
          previewUrl: processed.dataUrl,
          width: processed.width,
          height: processed.height,
          filter: cameraFilter,
        },
      ]);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleCycleCapturedFilter = async (frameId: string, nextFilter: ScanFilter) => {
    const target = capturedFrames.find((c) => c.id === frameId);
    if (!target) return;
    const processed = await processImageToDataUrl(target.rawUrl, 0, nextFilter);
    setCapturedFrames((prev) =>
      prev.map((c) =>
        c.id === frameId
          ? { ...c, filter: nextFilter, previewUrl: processed.dataUrl }
          : c
      )
    );
  };

  const handleCommitCameraScans = () => {
    if (capturedFrames.length === 0) return;
    const queued: QueuedImageItem[] = capturedFrames.map((frame, index) => ({
      id: frame.id,
      fileName: `Camera_Scan_${index + 1}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: Math.round((frame.previewUrl.length * 3) / 4),
      previewUrl: frame.previewUrl,
      width: frame.width,
      height: frame.height,
      rotation: 0,
      filter: frame.filter,
      source: 'camera',
    }));

    setImages((prev) => {
      const next = [...prev, ...queued];
      setSelectedImageIdx(prev.length);
      return next;
    });
    setCameraOpen(false);
    setView('image-scan');
    notify(
      'success',
      `Added ${queued.length} scanned ${queued.length === 1 ? 'page' : 'pages'} to workbench.`
    );
  };

  // ==========================================================================
  // File Handlers
  // ==========================================================================

  const handleAddImageFiles = useCallback(
    async (rawFiles: FileList | File[]) => {
      const list = Array.from(rawFiles);
      const added: QueuedImageItem[] = [];
      let skipped = 0;

      for (const file of list) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const isSupported =
          ACCEPTED_IMAGE_MIME.has(file.type.toLowerCase()) ||
          ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext);

        if (!isSupported) {
          skipped++;
          continue;
        }

        const previewUrl = URL.createObjectURL(file);
        try {
          const { width, height } = await readImageDimensions(previewUrl);
          added.push({
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            fileName: file.name,
            mimeType: file.type || `image/${ext}`,
            sizeBytes: file.size,
            previewUrl,
            width,
            height,
            rotation: 0,
            filter: 'original',
            source: 'upload',
          });
        } catch {
          URL.revokeObjectURL(previewUrl);
          skipped++;
        }
      }

      if (added.length > 0) {
        setImages((prev) => {
          const next = [...prev, ...added];
          setSelectedImageIdx(prev.length);
          return next;
        });
        notify(
          'success',
          `Added ${added.length} ${added.length === 1 ? 'image' : 'images'} to the workbench.`
        );
      }
      if (skipped > 0) {
        notify(
          'error',
          `Skipped ${skipped} unsupported file(s). Supported: JPG, JPEG, PNG, GIF, BMP, WEBP.`
        );
      }
    },
    [notify]
  );

  const handleAddPdfFiles = useCallback(
    async (rawFiles: FileList | File[]) => {
      const list = Array.from(rawFiles);
      const valid: QueuedPdfItem[] = [];
      let failed = 0;

      for (const file of list) {
        if (
          file.type !== 'application/pdf' &&
          !file.name.toLowerCase().endsWith('.pdf')
        ) {
          failed++;
          continue;
        }
        try {
          const inspected = await inspectPdfFile(file);
          valid.push(inspected);
        } catch {
          failed++;
        }
      }

      if (valid.length > 0) {
        const singleFileTool = activeToolkitTool !== 'merge';
        setPdfFiles((prev) => (singleFileTool ? [valid[0]] : [...prev, ...valid]));
        if (valid[0]) {
          setSplitRange(`1-${Math.min(2, valid[0].pageCount)}`);
          if (!metaTitle) setMetaTitle(valid[0].title);
        }
        notify(
          'success',
          `Loaded ${valid.length} PDF ${valid.length === 1 ? 'document' : 'documents'}.`
        );
      }

      if (failed > 0) {
        notify('error', `Could not read ${failed} non-PDF or invalid file(s).`);
      }
    },
    [activeToolkitTool, metaTitle, notify]
  );

  // ==========================================================================
  // Export Orchestration
  // ==========================================================================

  const canExport = useMemo(() => {
    if (view === 'image-scan') return images.length > 0;
    if (view === 'template-press') return true;
    if (view === 'pdf-toolkit') {
      if (activeToolkitTool === 'merge') return pdfFiles.length >= 2;
      return pdfFiles.length >= 1;
    }
    return false;
  }, [view, images.length, activeToolkitTool, pdfFiles.length]);

  const exportLabel = useMemo(() => {
    if (view === 'image-scan') return 'Create & Download PDF';
    if (view === 'template-press') return 'Export Template PDF';
    if (view === 'pdf-toolkit') {
      if (activeToolkitTool === 'merge') return 'Merge & Download';
      if (activeToolkitTool === 'split') return 'Extract Pages';
      if (activeToolkitTool === 'rotate') return 'Rotate & Save';
      if (activeToolkitTool === 'watermark') return 'Apply Stamp & Save';
      if (activeToolkitTool === 'page-numbers') return 'Number & Save';
      return 'Save Clean PDF';
    }
    return 'Create PDF';
  }, [view, activeToolkitTool]);

  const handlePrimaryExport = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      let result: GeneratedPdfResult;
      let toolLabel = 'Image PDF';

      if (view === 'image-scan') {
        result = await buildPdfFromImages(images, exportConfig);
        toolLabel = 'Images to PDF';
      } else if (view === 'template-press') {
        result = await buildTemplatePdf(templateState, exportConfig);
        toolLabel = `Template · ${templateState.kind}`;
      } else if (activeToolkitTool === 'merge') {
        result = await mergePdfFiles(pdfFiles, exportConfig);
        toolLabel = 'Merged PDF';
      } else if (activeToolkitTool === 'split') {
        result = await splitPdfFile(pdfFiles[0], splitRange, exportConfig);
        toolLabel = 'Split Pages';
      } else if (activeToolkitTool === 'rotate') {
        result = await rotatePdfFile(
          pdfFiles[0],
          rotateDegrees,
          rotateRange,
          exportConfig
        );
        toolLabel = `Rotated ${rotateDegrees}°`;
      } else if (activeToolkitTool === 'metadata') {
        result = await stampPdfFile(pdfFiles[0], exportConfig, {
          title: metaTitle,
          author: metaAuthor,
        });
        toolLabel = 'Metadata Clean';
      } else {
        const forcedConfig: ExportConfig = {
          ...exportConfig,
          watermark:
            activeToolkitTool === 'watermark'
              ? { ...exportConfig.watermark, enabled: true }
              : exportConfig.watermark,
          pageNumbers:
            activeToolkitTool === 'page-numbers'
              ? { ...exportConfig.pageNumbers, enabled: true }
              : exportConfig.pageNumbers,
        };
        result = await stampPdfFile(pdfFiles[0], forcedConfig);
        toolLabel =
          activeToolkitTool === 'watermark' ? 'Watermarked PDF' : 'Numbered PDF';
      }

      triggerDownload(result.url, result.filename);

      setExportsHistory((prev) => [
        {
          id: `exp-${Date.now()}`,
          filename: result.filename,
          url: result.url,
          sizeBytes: result.sizeBytes,
          pageCount: result.pageCount,
          toolLabel,
          createdAt: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
        ...prev.slice(0, 9),
      ]);

      notify(
        'success',
        `Downloaded ${result.filename} (${result.pageCount} ${
          result.pageCount === 1 ? 'page' : 'pages'
        }, ${formatBytes(result.sizeBytes)}).`
      );
    } catch (err) {
      notify(
        'error',
        err instanceof Error ? err.message : 'PDF generation failed.'
      );
    } finally {
      setIsExporting(false);
    }
  };

  // Helper computed values for live preview
  const activeImage = images[selectedImageIdx] || images[0] || null;
  const totalToolkitPages = pdfFiles.reduce((acc, f) => acc + f.pageCount, 0);
  const totalInvoiceAmount = templateState.lineItems.reduce(
    (sum, item) => sum + item.qty * item.rate,
    0
  );

  const getFilterCss = (filter: ScanFilter) => {
    if (filter === 'crisp') return 'contrast(1.25) brightness(1.06) saturate(1.08)';
    if (filter === 'mono') return 'grayscale(1) contrast(1.42) brightness(1.08)';
    return 'none';
  };

  const sheetAspectClass =
    exportConfig.pageSize === 'fit'
      ? 'aspect-[4/5]'
      : exportConfig.orientation === 'landscape'
        ? exportConfig.pageSize === 'letter'
          ? 'aspect-[11/8.5] max-w-[640px]'
          : 'aspect-[1.414/1] max-w-[640px]'
        : exportConfig.pageSize === 'letter'
          ? 'aspect-[8.5/11] max-w-[440px]'
          : 'aspect-[1/1.414] max-w-[440px]';

  const marginPaddingClass =
    exportConfig.margin === 'none'
      ? 'p-0'
      : exportConfig.margin === 'compact'
        ? 'p-4'
        : 'p-8';

  const openPresetTool = (
    nextView: AppView,
    toolkit?: PdfToolkitTool,
    templateKind?: TemplateKind
  ) => {
    if (toolkit) setActiveToolkitTool(toolkit);
    if (templateKind) setTemplateState(TEMPLATE_PRESETS[templateKind]);
    setView(nextView);
  };

  return (
    <div className="lavender-backdrop flex min-h-screen flex-col text-[#1E1B4B]">
      {/* ====================================================================
          Top Bar (3-Zone Contract)
         ==================================================================== */}
      <header className="sticky top-0 z-40 h-16 border-b border-[#E5DDFB] bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-[1380px] items-center justify-between gap-8 px-4 sm:px-8">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => setView('tools')}
            className="flex items-center gap-3 whitespace-nowrap shrink-0 cursor-pointer text-left"
          >
            <ShMpBrandLogo size={34} />
            <span className="font-display text-lg font-extrabold tracking-tight text-[#1E1B4B] whitespace-nowrap shrink-0">
              ShMp3100 Tool
            </span>
          </button>

          {/* Zone 2: 4 Single-line Navigation Links */}
          <nav
            aria-label="App workspaces"
            className="hidden md:flex items-center gap-7"
          >
            <button
              type="button"
              onClick={() => setView('tools')}
              className={`py-1.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                view === 'tools'
                  ? 'text-[#6C3CE1] underline decoration-2 underline-offset-8'
                  : 'text-[#645E82] hover:text-[#1E1B4B]'
              }`}
            >
              All Tools
            </button>
            <button
              type="button"
              onClick={() => setView('image-scan')}
              className={`py-1.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                view === 'image-scan'
                  ? 'text-[#6C3CE1] underline decoration-2 underline-offset-8'
                  : 'text-[#645E82] hover:text-[#1E1B4B]'
              }`}
            >
              Image &amp; Scan
            </button>
            <button
              type="button"
              onClick={() => setView('pdf-toolkit')}
              className={`py-1.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                view === 'pdf-toolkit'
                  ? 'text-[#6C3CE1] underline decoration-2 underline-offset-8'
                  : 'text-[#645E82] hover:text-[#1E1B4B]'
              }`}
            >
              PDF Toolkit
            </button>
            <button
              type="button"
              onClick={() => setView('template-press')}
              className={`py-1.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                view === 'template-press'
                  ? 'text-[#6C3CE1] underline decoration-2 underline-offset-8'
                  : 'text-[#645E82] hover:text-[#1E1B4B]'
              }`}
            >
              Templates
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center shrink-0">
            {view === 'tools' ? (
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#6C3CE1] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#5B21B6] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Camera className="h-4 w-4 shrink-0" />
                <span>Camera Scan</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePrimaryExport}
                disabled={!canExport || isExporting}
                className="inline-flex items-center gap-2 rounded-xl bg-[#6C3CE1] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="h-4 w-4 shrink-0" />
                <span>{isExporting ? 'Generating...' : exportLabel}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Navigation Strip */}
      <div className="border-b border-[#E5DDFB] bg-white/80 px-4 py-2 md:hidden">
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#F3EFFE] p-1">
          {(
            [
              { id: 'tools', label: 'Tools' },
              { id: 'image-scan', label: 'Images' },
              { id: 'pdf-toolkit', label: 'Toolkit' },
              { id: 'template-press', label: 'Forms' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={`rounded-lg py-1.5 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                view === tab.id
                  ? 'bg-white text-[#6C3CE1] shadow-sm'
                  : 'text-[#645E82]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ====================================================================
          Main Web Application Content
         ==================================================================== */}
      <main className="mx-auto w-full max-w-[1380px] flex-1 px-4 py-8 sm:px-8">
        {/* VIEW A: ALL TOOLS WEB APP DASHBOARD (No phone frame, direct web UI) */}
        {view === 'tools' && (
          <div className="space-y-8">
            {/* Lavender App Hero Card directly on the Web Page */}
            <div className="flex flex-col justify-between gap-6 rounded-3xl border border-[#DFD4FC] bg-gradient-to-br from-[#F3EFFE] via-[#EAE0FE] to-[#FFFFFF] p-6 shadow-[0_18px_48px_rgba(108,60,225,0.1)] sm:flex-row sm:items-center sm:p-8">
              <div className="max-w-2xl space-y-2.5">
                <h1 className="font-display text-2xl font-extrabold text-[#1E1B4B] sm:text-3xl">
                  All-in-one PDF Workspace
                </h1>
                <p className="text-sm leading-relaxed text-[#544D73] sm:text-base">
                  Convert images, scan documents with your camera, merge or split PDFs, rotate pages, and publish templates with your <span className="font-semibold text-[#4C1D95]">ShMp3100 Tool PDFMR</span> watermark—all inside one fast web app.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => openPresetTool('image-scan')}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#6C3CE1] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#5B21B6] whitespace-nowrap cursor-pointer"
                >
                  <ImagePlus className="h-4 w-4" />
                  <span>Create PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#DFD4FC] bg-white px-5 py-2.5 text-sm font-bold text-[#4C1D95] transition-colors hover:border-[#6C3CE1] whitespace-nowrap cursor-pointer"
                >
                  <Camera className="h-4 w-4 text-[#6C3CE1]" />
                  <span>Scan Document</span>
                </button>
              </div>
            </div>

            {/* Section 1: Convert & Create PDF (Direct Web Page Grid) */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-extrabold text-[#1E1B4B]">
                  Convert &amp; Create PDF
                </h2>
                <span className="text-xs font-medium text-[#645E82]">
                  Select any tool to launch its workspace
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <button
                  type="button"
                  onClick={() => openPresetTool('image-scan')}
                  className="flex items-center gap-4 rounded-2xl border border-[#E5DDFB] bg-white p-4 text-left shadow-[0_10px_28px_rgba(108,60,225,0.06)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#6C3CE1] cursor-pointer"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#7C3AED] text-white shadow-sm">
                    <ImageIcon className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-display text-base font-extrabold text-[#1E1B4B]">
                      Image to PDF
                    </div>
                    <p className="mt-0.5 text-xs text-[#645E82]">
                      JPG, JPEG, PNG, GIF, BMP, WEBP
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="flex items-center gap-4 rounded-2xl border border-[#E5DDFB] bg-white p-4 text-left shadow-[0_10px_28px_rgba(108,60,225,0.06)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#6C3CE1] cursor-pointer"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#EA580C] text-white shadow-sm">
                    <Camera className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-display text-base font-extrabold text-[#1E1B4B]">
                      Camera Scanner
                    </div>
                    <p className="mt-0.5 text-xs text-[#645E82]">
                      Live multi-page scan &amp; contrast filters
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => openPresetTool('template-press', undefined, 'note')}
                  className="flex items-center gap-4 rounded-2xl border border-[#E5DDFB] bg-white p-4 text-left shadow-[0_10px_28px_rgba(108,60,225,0.06)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#6C3CE1] cursor-pointer"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#2563EB] text-white shadow-sm">
                    <FileText className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-display text-base font-extrabold text-[#1E1B4B]">
                      TXT &amp; Notes to PDF
                    </div>
                    <p className="mt-0.5 text-xs text-[#645E82]">
                      Turn text notes into clean vector PDFs
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => openPresetTool('template-press', undefined, 'invoice')}
                  className="flex items-center gap-4 rounded-2xl border border-[#E5DDFB] bg-white p-4 text-left shadow-[0_10px_28px_rgba(108,60,225,0.06)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#6C3CE1] cursor-pointer"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#16A34A] text-white shadow-sm">
                    <FileSpreadsheet className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-display text-base font-extrabold text-[#1E1B4B]">
                      Invoice Generator
                    </div>
                    <p className="mt-0.5 text-xs text-[#645E82]">
                      Editable line items with automatic totals
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => openPresetTool('template-press', undefined, 'brief')}
                  className="flex items-center gap-4 rounded-2xl border border-[#E5DDFB] bg-white p-4 text-left shadow-[0_10px_28px_rgba(108,60,225,0.06)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#6C3CE1] cursor-pointer"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#4F46E5] text-white shadow-sm">
                    <Code2 className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-display text-base font-extrabold text-[#1E1B4B]">
                      Project Brief PDF
                    </div>
                    <p className="mt-0.5 text-xs text-[#645E82]">
                      Structured specification &amp; report sheet
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    openPresetTool('template-press', undefined, 'certificate')
                  }
                  className="flex items-center gap-4 rounded-2xl border border-[#E5DDFB] bg-white p-4 text-left shadow-[0_10px_28px_rgba(108,60,225,0.06)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#6C3CE1] cursor-pointer"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0284C7] text-white shadow-sm">
                    <Award className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-display text-base font-extrabold text-[#1E1B4B]">
                      Certificate Maker
                    </div>
                    <p className="mt-0.5 text-xs text-[#645E82]">
                      Landscape bordered certificate press
                    </p>
                  </div>
                </button>
              </div>
            </section>

            {/* Section 2: Manage & Edit PDF */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-extrabold text-[#1E1B4B]">
                  Manage &amp; Edit PDF
                </h2>
                <span className="text-xs font-medium text-[#645E82]">
                  Client-side pdf-lib document engine
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {TOOLKIT_ITEMS.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => openPresetTool('pdf-toolkit', tool.id)}
                      className="flex items-center gap-4 rounded-2xl border border-[#E5DDFB] bg-white p-4 text-left shadow-[0_10px_28px_rgba(108,60,225,0.06)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#6C3CE1] cursor-pointer"
                    >
                      <span
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${tool.colorClass}`}
                      >
                        <Icon className="h-6 w-6" />
                      </span>
                      <div className="min-w-0">
                        <div className="font-display text-base font-extrabold text-[#1E1B4B]">
                          {tool.label}
                        </div>
                        <p className="mt-0.5 text-xs text-[#645E82]">
                          {tool.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Section 3: Session Exports & Default Stamp Quick Config */}
            <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-[#E5DDFB] bg-white p-5 shadow-[0_10px_28px_rgba(108,60,225,0.05)]">
                <div className="flex items-center justify-between border-b border-[#EDE7FE] pb-3">
                  <h2 className="font-display text-base font-extrabold text-[#1E1B4B]">
                    Session Exported Files
                  </h2>
                  <span className="font-mono-tabular text-xs font-semibold text-[#6C3CE1]">
                    {exportsHistory.length} files
                  </span>
                </div>

                {exportsHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <FolderOpen className="h-8 w-8 text-[#A78BFA]" />
                    <p className="mt-2.5 text-sm font-semibold text-[#1E1B4B]">
                      No PDFs exported in this session yet
                    </p>
                    <p className="mt-1 max-w-sm text-xs text-[#645E82]">
                      Pick any converter or toolkit option above to create and download your first PDF.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 divide-y divide-[#F1ECFE]">
                    {exportsHistory.map((rec) => (
                      <div
                        key={rec.id}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#1E1B4B]">
                            {rec.filename}
                          </p>
                          <p className="font-mono-tabular text-xs text-[#645E82]">
                            {rec.toolLabel} · {rec.pageCount}p · {formatBytes(rec.sizeBytes)} · {rec.createdAt}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => triggerDownload(rec.url, rec.filename)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#EDE7FE] px-3 py-1.5 text-xs font-bold text-[#4C1D95] hover:bg-[#6C3CE1] hover:text-white cursor-pointer shrink-0"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Download</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[#E5DDFB] bg-white p-5 shadow-[0_10px_28px_rgba(108,60,225,0.05)]">
                <div className="border-b border-[#EDE7FE] pb-3">
                  <h2 className="font-display text-base font-extrabold text-[#1E1B4B]">
                    Default Watermark &amp; Stamp
                  </h2>
                  <p className="mt-0.5 text-xs text-[#645E82]">
                    Applied automatically when enabled across tools.
                  </p>
                </div>

                <div className="mt-4 space-y-3.5">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-[#645E82]">
                      Watermark Text
                    </span>
                    <input
                      type="text"
                      value={exportConfig.watermark.text}
                      onChange={(e) =>
                        setExportConfig((prev) => ({
                          ...prev,
                          watermark: { ...prev.watermark, text: e.target.value },
                        }))
                      }
                      className="w-full rounded-xl border border-[#DFD4FC] bg-[#FAF8FF] px-3 py-2 text-sm font-medium text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                    />
                  </label>

                  <div className="flex items-center justify-between rounded-xl border border-[#EDE7FE] bg-[#FAF8FF] px-3.5 py-2.5">
                    <span className="text-xs font-semibold text-[#1E1B4B]">
                      Enable Watermark Stamp
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={exportConfig.watermark.enabled}
                      onClick={() =>
                        setExportConfig((prev) => ({
                          ...prev,
                          watermark: {
                            ...prev.watermark,
                            enabled: !prev.watermark.enabled,
                          },
                        }))
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                        exportConfig.watermark.enabled
                          ? 'bg-[#6C3CE1]'
                          : 'bg-[#DDD6FE]'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          exportConfig.watermark.enabled
                            ? 'translate-x-6'
                            : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-[#EDE7FE] bg-[#FAF8FF] px-3.5 py-2.5">
                    <span className="text-xs font-semibold text-[#1E1B4B]">
                      Include Page Numbers
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={exportConfig.pageNumbers.enabled}
                      onClick={() =>
                        setExportConfig((prev) => ({
                          ...prev,
                          pageNumbers: {
                            ...prev.pageNumbers,
                            enabled: !prev.pageNumbers.enabled,
                          },
                        }))
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                        exportConfig.pageNumbers.enabled
                          ? 'bg-[#6C3CE1]'
                          : 'bg-[#DDD6FE]'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          exportConfig.pageNumbers.enabled
                            ? 'translate-x-6'
                            : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* VIEW B: INTERACTIVE 3-COLUMN STUDIO WORKBENCH */}
        {view !== 'tools' && (
          <div className="overflow-hidden rounded-3xl border border-[#E2D8FA] bg-white/95 shadow-[0_24px_64px_rgba(76,29,149,0.12)] backdrop-blur-md">
            {/* Workbench Top Mode Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#EDE7FE] bg-[#FAF8FF] px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setView('tools')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#DFD4FC] bg-white px-3 py-2 text-xs font-bold text-[#4C1D95] hover:border-[#6C3CE1] whitespace-nowrap cursor-pointer"
                >
                  <LayoutGrid className="h-3.5 w-3.5 text-[#6C3CE1]" />
                  <span>All Tools</span>
                </button>

                <div className="flex flex-wrap items-center gap-1 rounded-xl bg-[#EDE7FE] p-1">
                  {(
                    [
                      { id: 'image-scan', label: 'Image & Scan' },
                      { id: 'pdf-toolkit', label: 'PDF Toolkit' },
                      { id: 'template-press', label: 'Template & TXT' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setView(item.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                        view === item.id
                          ? 'bg-white text-[#6C3CE1] shadow-sm'
                          : 'text-[#645E82] hover:text-[#1E1B4B]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#DFD4FC] bg-white px-3.5 py-2 text-xs font-bold text-[#4C1D95] transition-colors hover:border-[#6C3CE1] whitespace-nowrap cursor-pointer"
                >
                  <Camera className="h-4 w-4 text-[#6C3CE1]" />
                  <span>Camera Scan</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrimaryExport}
                  disabled={!canExport || isExporting}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#6C3CE1] px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>{isExporting ? 'Generating...' : exportLabel}</span>
                </button>
              </div>
            </div>

            {/* 3-Column Studio Body */}
            <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_290px]">
              {/* Left Tool & Session Rail */}
              <aside className="flex flex-col justify-between border-b border-[#EDE7FE] bg-[#FCFAFF] p-4 lg:border-b-0 lg:border-r">
                <div className="space-y-5">
                  {view === 'image-scan' && (
                    <>
                      <div>
                        <h3 className="text-xs font-bold text-[#645E82]">
                          Input Sources
                        </h3>
                        <div className="mt-2.5 space-y-2">
                          <button
                            type="button"
                            onClick={() => hiddenImageInputRef.current?.click()}
                            className="flex w-full items-center gap-2.5 rounded-xl border border-[#E5DDFB] bg-white px-3 py-2.5 text-left text-xs font-semibold text-[#1E1B4B] transition-colors hover:border-[#6C3CE1] cursor-pointer"
                          >
                            <ImagePlus className="h-4 w-4 text-[#6C3CE1]" />
                            <span>Add Image Files</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCameraOpen(true)}
                            className="flex w-full items-center gap-2.5 rounded-xl border border-[#E5DDFB] bg-white px-3 py-2.5 text-left text-xs font-semibold text-[#1E1B4B] transition-colors hover:border-[#6C3CE1] cursor-pointer"
                          >
                            <Camera className="h-4 w-4 text-[#6C3CE1]" />
                            <span>Scan via Camera</span>
                          </button>
                          <input
                            ref={hiddenImageInputRef}
                            type="file"
                            multiple
                            accept="image/jpeg,image/jpg,image/png,image/gif,image/bmp,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length > 0) {
                                handleAddImageFiles(e.target.files);
                              }
                              e.target.value = '';
                            }}
                          />
                        </div>
                      </div>

                      <div className="border-t border-[#EDE7FE] pt-4">
                        <h3 className="text-xs font-bold text-[#645E82]">
                          Batch Scan Filters
                        </h3>
                        <div className="mt-2 space-y-1">
                          {(
                            [
                              { id: 'original', label: 'Original Color' },
                              { id: 'crisp', label: 'Crisp Document' },
                              { id: 'mono', label: 'Mono Ink' },
                            ] as const
                          ).map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              disabled={images.length === 0}
                              onClick={() => {
                                setImages((prev) =>
                                  prev.map((item) => ({ ...item, filter: preset.id }))
                                );
                                notify(
                                  'success',
                                  `Applied ${preset.label} to all pages.`
                                );
                              }}
                              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-[#4C456B] hover:bg-[#EDE7FE] hover:text-[#1E1B4B] disabled:opacity-40 cursor-pointer"
                            >
                              <span>{preset.label}</span>
                              <span className="text-[11px] text-[#6C3CE1]">Apply</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {view === 'pdf-toolkit' && (
                    <div>
                      <h3 className="text-xs font-bold text-[#645E82]">
                        PDF Operations
                      </h3>
                      <div className="mt-2.5 space-y-1">
                        {TOOLKIT_ITEMS.map((tool) => {
                          const Icon = tool.icon;
                          const active = activeToolkitTool === tool.id;
                          return (
                            <button
                              key={tool.id}
                              type="button"
                              onClick={() => setActiveToolkitTool(tool.id)}
                              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-colors cursor-pointer ${
                                active
                                  ? 'bg-[#EDE7FE] text-[#4C1D95]'
                                  : 'text-[#645E82] hover:bg-[#F3EFFE] hover:text-[#1E1B4B]'
                              }`}
                            >
                              <Icon
                                className={`h-4 w-4 shrink-0 ${
                                  active ? 'text-[#6C3CE1]' : 'text-[#847DA3]'
                                }`}
                              />
                              <span className="truncate">{tool.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {view === 'template-press' && (
                    <div>
                      <h3 className="text-xs font-bold text-[#645E82]">
                        Document Templates
                      </h3>
                      <div className="mt-2.5 space-y-1">
                        {TEMPLATE_ITEMS.map((tpl) => {
                          const active = templateState.kind === tpl.id;
                          return (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() =>
                                setTemplateState(TEMPLATE_PRESETS[tpl.id])
                              }
                              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition-colors cursor-pointer ${
                                active
                                  ? 'bg-[#EDE7FE] text-[#4C1D95]'
                                  : 'text-[#645E82] hover:bg-[#F3EFFE] hover:text-[#1E1B4B]'
                              }`}
                            >
                              <FileStack
                                className={`h-4 w-4 shrink-0 ${
                                  active ? 'text-[#6C3CE1]' : 'text-[#847DA3]'
                                }`}
                              />
                              <span className="truncate">{tpl.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Recent Exports */}
                <div className="mt-8 border-t border-[#EDE7FE] pt-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-[#645E82]">
                      Recent Exports
                    </h3>
                    <span className="font-mono-tabular text-[11px] font-semibold text-[#6C3CE1]">
                      {exportsHistory.length}
                    </span>
                  </div>
                  {exportsHistory.length === 0 ? (
                    <p className="mt-2 text-xs text-[#847DA3]">
                      Exported PDFs appear here for instant re-download.
                    </p>
                  ) : (
                    <div className="mt-2.5 space-y-2">
                      {exportsHistory.slice(0, 4).map((rec) => (
                        <div
                          key={rec.id}
                          className="flex items-center justify-between gap-2 border-b border-[#F1ECFE] pb-2 last:border-b-0"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-[#1E1B4B]">
                              {rec.filename}
                            </p>
                            <p className="font-mono-tabular text-[10px] text-[#645E82]">
                              {rec.pageCount}p · {formatBytes(rec.sizeBytes)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => triggerDownload(rec.url, rec.filename)}
                            aria-label={`Download ${rec.filename}`}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#EDE7FE] text-[#6C3CE1] hover:bg-[#6C3CE1] hover:text-white cursor-pointer"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </aside>

              {/* Center Workbench Canvas */}
              <div className="min-h-[560px] bg-[#F5F2FF] p-4 sm:p-6">
                {/* WORKSPACE 1: IMAGE & SCAN */}
                {view === 'image-scan' && (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingImage(true);
                    }}
                    onDragLeave={() => setIsDraggingImage(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingImage(false);
                      if (e.dataTransfer.files.length > 0) {
                        handleAddImageFiles(e.dataTransfer.files);
                      }
                    }}
                    className="flex h-full flex-col justify-between gap-5"
                  >
                    {images.length === 0 ? (
                      <div
                        className={`flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
                          isDraggingImage
                            ? 'border-[#6C3CE1] bg-[#EDE7FE]/70'
                            : 'border-[#D8CCF9] bg-white/80'
                        }`}
                      >
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EDE7FE] text-[#6C3CE1]">
                          <ImagePlus className="h-7 w-7" />
                        </div>
                        <h3 className="font-display mt-4 text-xl font-extrabold text-[#1E1B4B]">
                          Drop images or scan documents
                        </h3>
                        <p className="mt-1.5 max-w-md text-sm text-[#645E82]">
                          Supports JPG, JPEG, PNG, GIF, BMP, and WEBP. Reorder pages, rotate orientation, and export with your ShMp3100 Tool PDFMR stamp.
                        </p>
                        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                          <button
                            type="button"
                            onClick={() => hiddenImageInputRef.current?.click()}
                            className="inline-flex items-center gap-2 rounded-xl bg-[#6C3CE1] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#5B21B6] cursor-pointer"
                          >
                            <ImagePlus className="h-4 w-4" />
                            <span>Browse Images</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCameraOpen(true)}
                            className="inline-flex items-center gap-2 rounded-xl border border-[#DFD4FC] bg-white px-5 py-2.5 text-sm font-bold text-[#4C1D95] hover:border-[#6C3CE1] cursor-pointer"
                          >
                            <Camera className="h-4 w-4 text-[#6C3CE1]" />
                            <span>Scan with Camera</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col items-center gap-4">
                          {activeImage && (
                            <div className="flex w-full max-w-[640px] flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5DDFB] bg-white px-4 py-2.5 text-xs">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="font-mono-tabular font-bold text-[#6C3CE1]">
                                  Page {selectedImageIdx + 1}/{images.length}
                                </span>
                                <span className="text-[#C4B5FD]" aria-hidden="true">·</span>
                                <span className="truncate font-semibold text-[#1E1B4B]">
                                  {activeImage.fileName}
                                </span>
                                <span className="font-mono-tabular hidden text-[#645E82] sm:inline">
                                  · {formatBytes(activeImage.sizeBytes)}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 rounded-lg bg-[#F3EFFE] p-0.5">
                                  {(
                                    [
                                      { id: 'original', label: 'Raw' },
                                      { id: 'crisp', label: 'Crisp' },
                                      { id: 'mono', label: 'Mono' },
                                    ] as const
                                  ).map((f) => (
                                    <button
                                      key={f.id}
                                      type="button"
                                      onClick={() =>
                                        setImages((prev) =>
                                          prev.map((item) =>
                                            item.id === activeImage.id
                                              ? { ...item, filter: f.id }
                                              : item
                                          )
                                        )
                                      }
                                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                                        activeImage.filter === f.id
                                          ? 'bg-white text-[#6C3CE1] shadow-sm'
                                          : 'text-[#645E82] hover:text-[#1E1B4B]'
                                      }`}
                                    >
                                      {f.label}
                                    </button>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setImages((prev) =>
                                      prev.map((item) =>
                                        item.id === activeImage.id
                                          ? {
                                              ...item,
                                              rotation: (((item.rotation + 90) %
                                                360) as 0 | 90 | 180 | 270),
                                            }
                                          : item
                                      )
                                    )
                                  }
                                  aria-label="Rotate image 90 degrees"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5DDFB] bg-white text-[#4C1D95] hover:border-[#6C3CE1] cursor-pointer"
                                >
                                  <RotateCw className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          )}

                          {activeImage && (
                            <div
                              className={`paper-preview-sheet relative flex w-full items-center justify-center overflow-hidden rounded-sm transition-all ${sheetAspectClass} ${marginPaddingClass}`}
                            >
                              <img
                                src={activeImage.previewUrl}
                                alt={activeImage.fileName}
                                className="max-h-full max-w-full object-contain transition-transform"
                                style={{
                                  transform: `rotate(${activeImage.rotation}deg)`,
                                  filter: getFilterCss(activeImage.filter),
                                }}
                              />

                              {exportConfig.watermark.enabled &&
                                exportConfig.watermark.text.trim() && (
                                  <div
                                    aria-hidden="true"
                                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                                    style={{ opacity: exportConfig.watermark.opacity }}
                                  >
                                    {exportConfig.watermark.placement === 'diagonal' ? (
                                      <span className="rotate-[-32deg] select-none font-display text-2xl font-extrabold text-[#6C3CE1]">
                                        {exportConfig.watermark.text}
                                      </span>
                                    ) : (
                                      <span className="absolute bottom-2.5 left-4 text-[10px] font-bold text-[#6C3CE1]">
                                        {exportConfig.watermark.text}
                                      </span>
                                    )}
                                  </div>
                                )}

                              {exportConfig.pageNumbers.enabled && (
                                <span
                                  className={`font-mono-tabular pointer-events-none absolute bottom-2.5 text-[10px] text-[#645E82] ${
                                    exportConfig.pageNumbers.position === 'bottom-center'
                                      ? 'left-1/2 -translate-x-1/2'
                                      : 'right-4'
                                  }`}
                                >
                                  {selectedImageIdx + 1} / {images.length}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Page Filmstrip */}
                        <div className="rounded-2xl border border-[#E5DDFB] bg-white p-3">
                          <div className="mb-2.5 flex items-center justify-between">
                            <span className="text-xs font-bold text-[#1E1B4B]">
                              Page Sequence ({images.length})
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => hiddenImageInputRef.current?.click()}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5DDFB] bg-[#FAF8FF] px-2.5 py-1.5 text-xs font-semibold text-[#4C1D95] hover:border-[#6C3CE1] cursor-pointer"
                              >
                                <ImagePlus className="h-3.5 w-3.5" />
                                <span>Add</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  images.forEach((img) => {
                                    if (img.previewUrl.startsWith('blob:')) {
                                      URL.revokeObjectURL(img.previewUrl);
                                    }
                                  });
                                  setImages([]);
                                  setSelectedImageIdx(0);
                                }}
                                className="text-xs font-semibold text-[#DC2626] hover:underline cursor-pointer"
                              >
                                Clear
                              </button>
                            </div>
                          </div>

                          <div className="flex gap-2.5 overflow-x-auto pb-1">
                            {images.map((item, idx) => {
                              const selected = idx === selectedImageIdx;
                              return (
                                <div
                                  key={item.id}
                                  onClick={() => setSelectedImageIdx(idx)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setSelectedImageIdx(idx);
                                    }
                                  }}
                                  className={`flex w-28 shrink-0 cursor-pointer flex-col rounded-xl border p-1.5 transition-colors ${
                                    selected
                                      ? 'border-[#6C3CE1] bg-[#F3EFFE]'
                                      : 'border-[#E5DDFB] bg-[#FAF8FF] hover:border-[#C4B5FD]'
                                  }`}
                                >
                                  <div className="relative h-24 w-full overflow-hidden rounded-lg bg-white">
                                    <img
                                      src={item.previewUrl}
                                      alt={item.fileName}
                                      className="h-full w-full object-contain"
                                      style={{
                                        transform: `rotate(${item.rotation}deg)`,
                                        filter: getFilterCss(item.filter),
                                      }}
                                    />
                                    <span className="font-mono-tabular absolute left-1 top-1 rounded bg-[#1E1B4B]/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                      {idx + 1}
                                    </span>
                                  </div>
                                  <div className="mt-1.5 flex items-center justify-between">
                                    <div className="flex items-center gap-0.5">
                                      <button
                                        type="button"
                                        disabled={idx === 0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setImages((prev) => {
                                            const next = [...prev];
                                            const [moved] = next.splice(idx, 1);
                                            next.splice(idx - 1, 0, moved);
                                            return next;
                                          });
                                          setSelectedImageIdx(idx - 1);
                                        }}
                                        aria-label={`Move page ${idx + 1} left`}
                                        className="inline-flex h-6 w-6 items-center justify-center rounded text-[#645E82] hover:bg-white disabled:opacity-30 cursor-pointer"
                                      >
                                        <ArrowLeft className="h-3 w-3" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={idx === images.length - 1}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setImages((prev) => {
                                            const next = [...prev];
                                            const [moved] = next.splice(idx, 1);
                                            next.splice(idx + 1, 0, moved);
                                            return next;
                                          });
                                          setSelectedImageIdx(idx + 1);
                                        }}
                                        aria-label={`Move page ${idx + 1} right`}
                                        className="inline-flex h-6 w-6 items-center justify-center rounded text-[#645E82] hover:bg-white disabled:opacity-30 cursor-pointer"
                                      >
                                        <ArrowRight className="h-3 w-3" />
                                      </button>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (item.previewUrl.startsWith('blob:')) {
                                          URL.revokeObjectURL(item.previewUrl);
                                        }
                                        const next = images.filter((i) => i.id !== item.id);
                                        setImages(next);
                                        setSelectedImageIdx(
                                          Math.max(0, Math.min(selectedImageIdx, next.length - 1))
                                        );
                                      }}
                                      aria-label={`Delete page ${idx + 1}`}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded text-[#847DA3] hover:text-[#DC2626] cursor-pointer"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* WORKSPACE 2: PDF TOOLKIT */}
                {view === 'pdf-toolkit' && (
                  <div className="grid h-full gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                    <div className="space-y-4">
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDraggingPdf(true);
                        }}
                        onDragLeave={() => setIsDraggingPdf(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDraggingPdf(false);
                          if (e.dataTransfer.files.length > 0) {
                            handleAddPdfFiles(e.dataTransfer.files);
                          }
                        }}
                        className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                          isDraggingPdf
                            ? 'border-[#6C3CE1] bg-[#EDE7FE]/70'
                            : 'border-[#D8CCF9] bg-white'
                        }`}
                      >
                        <FilePlus2 className="h-7 w-7 text-[#6C3CE1]" />
                        <p className="mt-2 text-sm font-bold text-[#1E1B4B]">
                          {activeToolkitTool === 'merge'
                            ? 'Drop 2 or more PDF files to merge'
                            : 'Drop a PDF file to process'}
                        </p>
                        <p className="mt-1 text-xs text-[#645E82]">
                          Processed locally via pdf-lib · Instant download
                        </p>
                        <button
                          type="button"
                          onClick={() => toolkitPdfInputRef.current?.click()}
                          className="mt-4 rounded-xl bg-[#6C3CE1] px-4 py-2 text-xs font-bold text-white hover:bg-[#5B21B6] cursor-pointer"
                        >
                          Select PDF {activeToolkitTool === 'merge' ? 'Files' : 'File'}
                        </button>
                        <input
                          ref={toolkitPdfInputRef}
                          type="file"
                          accept="application/pdf,.pdf"
                          multiple={activeToolkitTool === 'merge'}
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              handleAddPdfFiles(e.target.files);
                            }
                            e.target.value = '';
                          }}
                        />
                      </div>

                      {activeToolkitTool === 'split' && (
                        <div className="rounded-2xl border border-[#E5DDFB] bg-white p-4">
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-bold text-[#1E1B4B]">
                              Page Range to Extract
                            </span>
                            <input
                              type="text"
                              value={splitRange}
                              onChange={(e) => setSplitRange(e.target.value)}
                              placeholder="e.g. 1-3, 5"
                              className="font-mono-tabular w-full rounded-xl border border-[#DFD4FC] bg-[#FAF8FF] px-3 py-2 text-sm text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                            />
                          </label>
                        </div>
                      )}

                      {activeToolkitTool === 'rotate' && (
                        <div className="space-y-3 rounded-2xl border border-[#E5DDFB] bg-white p-4">
                          <div>
                            <span className="mb-1.5 block text-xs font-bold text-[#1E1B4B]">
                              Clockwise Angle
                            </span>
                            <div className="grid grid-cols-3 gap-2">
                              {([90, 180, 270] as const).map((deg) => (
                                <button
                                  key={deg}
                                  type="button"
                                  onClick={() => setRotateDegrees(deg)}
                                  className={`rounded-xl border py-2 text-xs font-bold cursor-pointer ${
                                    rotateDegrees === deg
                                      ? 'border-[#6C3CE1] bg-[#EDE7FE] text-[#4C1D95]'
                                      : 'border-[#E5DDFB] bg-[#FAF8FF] text-[#645E82]'
                                  }`}
                                >
                                  {deg}°
                                </button>
                              ))}
                            </div>
                          </div>
                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-[#1E1B4B]">
                              Target Pages (optional)
                            </span>
                            <input
                              type="text"
                              value={rotateRange}
                              onChange={(e) => setRotateRange(e.target.value)}
                              placeholder="All pages (or e.g. 1, 3-4)"
                              className="font-mono-tabular w-full rounded-xl border border-[#DFD4FC] bg-[#FAF8FF] px-3 py-2 text-xs text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                            />
                          </label>
                        </div>
                      )}

                      {activeToolkitTool === 'metadata' && (
                        <div className="grid gap-3 rounded-2xl border border-[#E5DDFB] bg-white p-4 sm:grid-cols-2">
                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-[#1E1B4B]">
                              Document Title
                            </span>
                            <input
                              type="text"
                              value={metaTitle}
                              onChange={(e) => setMetaTitle(e.target.value)}
                              className="w-full rounded-xl border border-[#DFD4FC] bg-[#FAF8FF] px-3 py-2 text-xs text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-[#1E1B4B]">
                              Author
                            </span>
                            <input
                              type="text"
                              value={metaAuthor}
                              onChange={(e) => setMetaAuthor(e.target.value)}
                              className="w-full rounded-xl border border-[#DFD4FC] bg-[#FAF8FF] px-3 py-2 text-xs text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                            />
                          </label>
                        </div>
                      )}

                      {pdfFiles.length > 0 && (
                        <div className="space-y-2">
                          {pdfFiles.map((item, idx) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-3 rounded-xl border border-[#E5DDFB] bg-white px-3.5 py-2.5"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <FileText className="h-4 w-4 shrink-0 text-[#6C3CE1]" />
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-bold text-[#1E1B4B]">
                                    {item.fileName}
                                  </p>
                                  <p className="font-mono-tabular text-[11px] text-[#645E82]">
                                    {item.pageCount}p · {formatBytes(item.sizeBytes)}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                {activeToolkitTool === 'merge' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={idx === 0}
                                      onClick={() =>
                                        setPdfFiles((prev) => {
                                          const next = [...prev];
                                          const [m] = next.splice(idx, 1);
                                          next.splice(idx - 1, 0, m);
                                          return next;
                                        })
                                      }
                                      aria-label="Move PDF up"
                                      className="inline-flex h-7 w-7 items-center justify-center rounded text-[#645E82] hover:bg-[#F3EFFE] disabled:opacity-30 cursor-pointer"
                                    >
                                      <ArrowUp className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx === pdfFiles.length - 1}
                                      onClick={() =>
                                        setPdfFiles((prev) => {
                                          const next = [...prev];
                                          const [m] = next.splice(idx, 1);
                                          next.splice(idx + 1, 0, m);
                                          return next;
                                        })
                                      }
                                      aria-label="Move PDF down"
                                      className="inline-flex h-7 w-7 items-center justify-center rounded text-[#645E82] hover:bg-[#F3EFFE] disabled:opacity-30 cursor-pointer"
                                    >
                                      <ArrowDown className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPdfFiles((prev) =>
                                      prev.filter((p) => p.id !== item.id)
                                    )
                                  }
                                  aria-label={`Remove ${item.fileName}`}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded text-[#847DA3] hover:text-[#DC2626] cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* PDF Blueprint Preview Sheet */}
                    <div className="flex items-start justify-center">
                      <div className="paper-preview-sheet relative flex aspect-[1/1.414] w-full max-w-[350px] flex-col justify-between overflow-hidden rounded-sm p-6">
                        <div>
                          <div className="flex items-center justify-between border-b border-[#EDE7FE] pb-2.5">
                            <span className="font-mono-tabular text-[10px] font-bold text-[#645E82]">
                              PDF BLUEPRINT
                            </span>
                            <span className="font-mono-tabular text-[10px] font-bold text-[#6C3CE1]">
                              {activeToolkitTool.toUpperCase()}
                            </span>
                          </div>
                          {pdfFiles.length === 0 ? (
                            <div className="mt-20 text-center">
                              <p className="font-display text-base font-bold text-[#1E1B4B]">
                                Awaiting PDF File
                              </p>
                              <p className="mt-1 text-xs text-[#645E82]">
                                Upload a PDF on the left to inspect page counts and apply edits.
                              </p>
                            </div>
                          ) : (
                            <div className="mt-4 space-y-2.5 text-xs">
                              <div className="flex justify-between">
                                <span className="text-[#645E82]">Loaded Files</span>
                                <span className="font-mono-tabular font-bold">
                                  {pdfFiles.length}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[#645E82]">Total Pages</span>
                                <span className="font-mono-tabular font-bold">
                                  {totalToolkitPages}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        {exportConfig.watermark.enabled &&
                          exportConfig.watermark.text.trim() && (
                            <div
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 flex items-center justify-center"
                              style={{ opacity: exportConfig.watermark.opacity }}
                            >
                              {exportConfig.watermark.placement === 'diagonal' ? (
                                <span className="rotate-[-32deg] font-display text-xl font-extrabold text-[#6C3CE1]">
                                  {exportConfig.watermark.text}
                                </span>
                              ) : (
                                <span className="absolute bottom-3 left-5 text-[9px] font-bold text-[#6C3CE1]">
                                  {exportConfig.watermark.text}
                                </span>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                )}

                {/* WORKSPACE 3: TEMPLATE & TXT PRESS */}
                {view === 'template-press' && (
                  <div className="grid h-full gap-5 xl:grid-cols-[310px_1fr]">
                    <div className="space-y-3 rounded-2xl border border-[#E5DDFB] bg-white p-4">
                      <h3 className="font-display text-sm font-extrabold text-[#1E1B4B]">
                        Document Fields
                      </h3>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold text-[#645E82]">
                          Title
                        </span>
                        <input
                          type="text"
                          value={templateState.title}
                          onChange={(e) =>
                            setTemplateState({
                              ...templateState,
                              title: e.target.value,
                            })
                          }
                          className="w-full rounded-xl border border-[#DFD4FC] bg-[#FAF8FF] px-3 py-1.5 text-xs text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold text-[#645E82]">
                          Subtitle
                        </span>
                        <input
                          type="text"
                          value={templateState.subtitle}
                          onChange={(e) =>
                            setTemplateState({
                              ...templateState,
                              subtitle: e.target.value,
                            })
                          }
                          className="w-full rounded-xl border border-[#DFD4FC] bg-[#FAF8FF] px-3 py-1.5 text-xs text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold text-[#645E82]">
                            From
                          </span>
                          <input
                            type="text"
                            value={templateState.senderName}
                            onChange={(e) =>
                              setTemplateState({
                                ...templateState,
                                senderName: e.target.value,
                              })
                            }
                            className="w-full rounded-xl border border-[#DFD4FC] bg-[#FAF8FF] px-2.5 py-1.5 text-xs text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold text-[#645E82]">
                            To
                          </span>
                          <input
                            type="text"
                            value={templateState.recipientName}
                            onChange={(e) =>
                              setTemplateState({
                                ...templateState,
                                recipientName: e.target.value,
                              })
                            }
                            className="w-full rounded-xl border border-[#DFD4FC] bg-[#FAF8FF] px-2.5 py-1.5 text-xs text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                          />
                        </label>
                      </div>

                      {templateState.kind === 'invoice' && (
                        <div className="space-y-2 border-t border-[#EDE7FE] pt-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-[#1E1B4B]">
                              Line Items
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setTemplateState({
                                  ...templateState,
                                  lineItems: [
                                    ...templateState.lineItems,
                                    {
                                      id: `li-${Date.now()}`,
                                      description: 'Additional Item',
                                      qty: 1,
                                      rate: 100,
                                    },
                                  ],
                                })
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-[#6C3CE1] cursor-pointer"
                            >
                              <Plus className="h-3 w-3" />
                              <span>Add</span>
                            </button>
                          </div>
                          {templateState.lineItems.map((row) => (
                            <div
                              key={row.id}
                              className="grid grid-cols-[1fr_44px_56px_24px] items-center gap-1"
                            >
                              <input
                                type="text"
                                value={row.description}
                                onChange={(e) =>
                                  setTemplateState({
                                    ...templateState,
                                    lineItems: templateState.lineItems.map((li) =>
                                      li.id === row.id
                                        ? { ...li, description: e.target.value }
                                        : li
                                    ),
                                  })
                                }
                                className="rounded border border-[#DFD4FC] bg-[#FAF8FF] px-2 py-1 text-[11px] text-[#1E1B4B]"
                              />
                              <input
                                type="number"
                                min={1}
                                value={row.qty}
                                onChange={(e) =>
                                  setTemplateState({
                                    ...templateState,
                                    lineItems: templateState.lineItems.map((li) =>
                                      li.id === row.id
                                        ? {
                                            ...li,
                                            qty: Math.max(
                                              1,
                                              Number(e.target.value) || 1
                                            ),
                                          }
                                        : li
                                    ),
                                  })
                                }
                                className="font-mono-tabular rounded border border-[#DFD4FC] bg-[#FAF8FF] px-1.5 py-1 text-right text-[11px]"
                              />
                              <input
                                type="number"
                                min={0}
                                value={row.rate}
                                onChange={(e) =>
                                  setTemplateState({
                                    ...templateState,
                                    lineItems: templateState.lineItems.map((li) =>
                                      li.id === row.id
                                        ? {
                                            ...li,
                                            rate: Math.max(
                                              0,
                                              Number(e.target.value) || 0
                                            ),
                                          }
                                        : li
                                    ),
                                  })
                                }
                                className="font-mono-tabular rounded border border-[#DFD4FC] bg-[#FAF8FF] px-1.5 py-1 text-right text-[11px]"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setTemplateState({
                                    ...templateState,
                                    lineItems: templateState.lineItems.filter(
                                      (li) => li.id !== row.id
                                    ),
                                  })
                                }
                                aria-label="Remove item"
                                className="inline-flex h-6 w-6 items-center justify-center text-[#847DA3] hover:text-[#DC2626] cursor-pointer"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold text-[#645E82]">
                          {templateState.kind === 'invoice' ? 'Notes' : 'Body Copy'}
                        </span>
                        <textarea
                          rows={5}
                          value={templateState.bodyText}
                          onChange={(e) =>
                            setTemplateState({
                              ...templateState,
                              bodyText: e.target.value,
                            })
                          }
                          className="w-full rounded-xl border border-[#DFD4FC] bg-[#FAF8FF] px-3 py-2 text-xs leading-relaxed text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                        />
                      </label>
                    </div>

                    {/* Live Template Sheet */}
                    <div className="flex items-start justify-center">
                      <div
                        className={`paper-preview-sheet relative w-full overflow-hidden rounded-sm p-8 ${
                          templateState.kind === 'certificate'
                            ? 'max-w-[620px] aspect-[1.414/1]'
                            : 'max-w-[500px] min-h-[640px]'
                        }`}
                      >
                        {templateState.kind === 'certificate' ? (
                          <div className="flex h-full flex-col justify-between border-2 border-[#6C3CE1] p-6 text-center">
                            <div className="space-y-2.5 pt-2">
                              <p className="text-[11px] font-bold tracking-widest text-[#6C3CE1]">
                                {templateState.subtitle.toUpperCase()}
                              </p>
                              <h3 className="font-display text-2xl font-extrabold text-[#1E1B4B]">
                                {templateState.title}
                              </h3>
                              <p className="pt-1 text-xs text-[#645E82]">
                                Presented to
                              </p>
                              <p className="font-display text-2xl font-bold text-[#1E1B4B]">
                                {templateState.recipientName}
                              </p>
                              <div className="mx-auto h-[2px] w-32 bg-[#6C3CE1]" />
                              <p className="mx-auto max-w-md pt-2 text-xs leading-relaxed text-[#4C456B]">
                                {templateState.bodyText}
                              </p>
                            </div>
                            <div className="flex justify-between px-4 pb-2 text-[11px] text-[#645E82]">
                              <span className="border-t border-[#C4B5FD] pt-1">
                                {templateState.dateText}
                              </span>
                              <span className="border-t border-[#C4B5FD] pt-1 font-bold text-[#1E1B4B]">
                                {templateState.signatureName}
                              </span>
                            </div>
                          </div>
                        ) : templateState.kind === 'invoice' ? (
                          <div>
                            <div className="-mx-8 -mt-8 mb-6 flex items-center justify-between bg-[#6C3CE1] px-8 py-5 text-white">
                              <div>
                                <h3 className="font-display text-lg font-extrabold">
                                  {templateState.title}
                                </h3>
                                <p className="font-mono-tabular text-xs text-[#E9E2FF]">
                                  {templateState.referenceCode}
                                </p>
                              </div>
                              <div className="text-right text-xs">
                                <p className="font-bold">
                                  {templateState.senderName}
                                </p>
                                <p className="text-[#E9E2FF]">
                                  {templateState.dateText}
                                </p>
                              </div>
                            </div>
                            <div className="mb-5">
                              <p className="text-[10px] font-bold text-[#645E82]">
                                BILL TO
                              </p>
                              <p className="text-sm font-bold text-[#1E1B4B]">
                                {templateState.recipientName}
                              </p>
                            </div>
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="bg-[#F3EFFE] text-[10px] font-bold text-[#4C1D95]">
                                  <th className="px-2 py-2">ITEM</th>
                                  <th className="px-2 py-2 text-right">QTY</th>
                                  <th className="px-2 py-2 text-right">RATE</th>
                                  <th className="px-2 py-2 text-right">AMOUNT</th>
                                </tr>
                              </thead>
                              <tbody>
                                {templateState.lineItems.map((row) => (
                                  <tr
                                    key={row.id}
                                    className="border-b border-[#F1ECFE]"
                                  >
                                    <td className="px-2 py-2">
                                      {row.description}
                                    </td>
                                    <td className="font-mono-tabular px-2 py-2 text-right">
                                      {row.qty}
                                    </td>
                                    <td className="font-mono-tabular px-2 py-2 text-right">
                                      {templateState.currency}
                                      {row.rate.toFixed(2)}
                                    </td>
                                    <td className="font-mono-tabular px-2 py-2 text-right font-bold">
                                      {templateState.currency}
                                      {(row.qty * row.rate).toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="mt-4 flex justify-end gap-5 text-sm font-extrabold">
                              <span className="text-[#6C3CE1]">TOTAL</span>
                              <span className="font-mono-tabular">
                                {templateState.currency}
                                {totalInvoiceAmount.toFixed(2)}
                              </span>
                            </div>
                            <p className="mt-6 text-xs text-[#645E82]">
                              {templateState.bodyText}
                            </p>
                          </div>
                        ) : (
                          <div>
                            <p className="text-[10px] font-bold tracking-widest text-[#6C3CE1]">
                              {templateState.subtitle.toUpperCase()}
                            </p>
                            <h3 className="font-display mt-1.5 text-2xl font-extrabold text-[#1E1B4B]">
                              {templateState.title}
                            </h3>
                            <p className="mt-2 border-b border-[#EDE7FE] pb-3 text-xs text-[#645E82]">
                              {[
                                templateState.senderName,
                                templateState.recipientName,
                                templateState.dateText,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                            <div className="mt-5 whitespace-pre-line text-xs leading-relaxed text-[#1E1B4B]">
                              {templateState.bodyText}
                            </div>
                          </div>
                        )}

                        {exportConfig.watermark.enabled &&
                          exportConfig.watermark.text.trim() && (
                            <div
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 flex items-center justify-center"
                              style={{ opacity: exportConfig.watermark.opacity }}
                            >
                              {exportConfig.watermark.placement === 'diagonal' ? (
                                <span className="rotate-[-32deg] font-display text-2xl font-extrabold text-[#6C3CE1]">
                                  {exportConfig.watermark.text}
                                </span>
                              ) : (
                                <span className="absolute bottom-3 left-6 text-[10px] font-bold text-[#6C3CE1]">
                                  {exportConfig.watermark.text}
                                </span>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Print & Watermark Inspector Rail */}
              <aside className="flex flex-col justify-between border-t border-[#EDE7FE] bg-[#FCFAFF] p-4 lg:border-l lg:border-t-0">
                <div className="space-y-4">
                  <div className="border-b border-[#EDE7FE] pb-3">
                    <h3 className="font-display text-sm font-extrabold text-[#1E1B4B]">
                      Print &amp; Stamp Inspector
                    </h3>
                    <p className="mt-0.5 text-xs text-[#645E82]">
                      Configure output format and watermark stamp.
                    </p>
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-[#645E82]">
                      Filename
                    </span>
                    <div className="flex items-center rounded-xl border border-[#DFD4FC] bg-white focus-within:border-[#6C3CE1]">
                      <input
                        type="text"
                        value={exportConfig.filename}
                        onChange={(e) =>
                          setExportConfig((prev) => ({
                            ...prev,
                            filename: e.target.value,
                          }))
                        }
                        className="w-full bg-transparent px-3 py-2 text-xs font-semibold text-[#1E1B4B] focus:outline-none"
                      />
                      <span className="font-mono-tabular pr-3 text-xs text-[#847DA3]">
                        .pdf
                      </span>
                    </div>
                  </label>

                  {view !== 'pdf-toolkit' && (
                    <div className="space-y-3 border-t border-[#EDE7FE] pt-3">
                      <div>
                        <span className="mb-1.5 block text-xs font-semibold text-[#645E82]">
                          Page Size
                        </span>
                        <div className="grid grid-cols-3 gap-1.5">
                          {(
                            [
                              { id: 'a4', label: 'A4' },
                              { id: 'letter', label: 'Letter' },
                              ...(view === 'image-scan'
                                ? [{ id: 'fit', label: 'Fit' }]
                                : []),
                            ] as { id: PageSizeOption; label: string }[]
                          ).map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() =>
                                setExportConfig((prev) => ({
                                  ...prev,
                                  pageSize: s.id,
                                }))
                              }
                              className={`rounded-lg border py-1.5 text-xs font-bold cursor-pointer ${
                                exportConfig.pageSize === s.id
                                  ? 'border-[#6C3CE1] bg-[#EDE7FE] text-[#4C1D95]'
                                  : 'border-[#E5DDFB] bg-white text-[#645E82]'
                              }`}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {view === 'image-scan' && exportConfig.pageSize !== 'fit' && (
                        <div>
                          <span className="mb-1.5 block text-xs font-semibold text-[#645E82]">
                            Orientation
                          </span>
                          <div className="grid grid-cols-2 gap-1.5">
                            {(
                              [
                                { id: 'portrait', label: 'Portrait' },
                                { id: 'landscape', label: 'Landscape' },
                              ] as { id: OrientationOption; label: string }[]
                            ).map((o) => (
                              <button
                                key={o.id}
                                type="button"
                                onClick={() =>
                                  setExportConfig((prev) => ({
                                    ...prev,
                                    orientation: o.id,
                                  }))
                                }
                                className={`rounded-lg border py-1.5 text-xs font-bold cursor-pointer ${
                                  exportConfig.orientation === o.id
                                    ? 'border-[#6C3CE1] bg-[#EDE7FE] text-[#4C1D95]'
                                    : 'border-[#E5DDFB] bg-white text-[#645E82]'
                                }`}
                              >
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {view === 'image-scan' && (
                        <div>
                          <span className="mb-1.5 block text-xs font-semibold text-[#645E82]">
                            Margins
                          </span>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(
                              [
                                { id: 'none', label: 'None' },
                                { id: 'compact', label: 'Compact' },
                                { id: 'standard', label: 'Standard' },
                              ] as { id: MarginOption; label: string }[]
                            ).map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() =>
                                  setExportConfig((prev) => ({
                                    ...prev,
                                    margin: m.id,
                                  }))
                                }
                                className={`rounded-lg border py-1.5 text-xs font-bold cursor-pointer ${
                                  exportConfig.margin === m.id
                                    ? 'border-[#6C3CE1] bg-[#EDE7FE] text-[#4C1D95]'
                                    : 'border-[#E5DDFB] bg-white text-[#645E82]'
                                }`}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-3 border-t border-[#EDE7FE] pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#1E1B4B]">
                        Watermark Stamp
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={exportConfig.watermark.enabled}
                        onClick={() =>
                          setExportConfig((prev) => ({
                            ...prev,
                            watermark: {
                              ...prev.watermark,
                              enabled: !prev.watermark.enabled,
                            },
                          }))
                        }
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                          exportConfig.watermark.enabled
                            ? 'bg-[#6C3CE1]'
                            : 'bg-[#DDD6FE]'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            exportConfig.watermark.enabled
                              ? 'translate-x-6'
                              : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {exportConfig.watermark.enabled && (
                      <div className="space-y-2.5">
                        <input
                          type="text"
                          value={exportConfig.watermark.text}
                          onChange={(e) =>
                            setExportConfig((prev) => ({
                              ...prev,
                              watermark: { ...prev.watermark, text: e.target.value },
                            }))
                          }
                          className="w-full rounded-xl border border-[#DFD4FC] bg-white px-3 py-1.5 text-xs text-[#1E1B4B] focus:border-[#6C3CE1] focus:outline-none"
                        />
                        <div className="grid grid-cols-2 gap-1.5">
                          {(['diagonal', 'footer'] as const).map((place) => (
                            <button
                              key={place}
                              type="button"
                              onClick={() =>
                                setExportConfig((prev) => ({
                                  ...prev,
                                  watermark: { ...prev.watermark, placement: place },
                                }))
                              }
                              className={`rounded-lg border py-1.5 text-xs font-semibold capitalize cursor-pointer ${
                                exportConfig.watermark.placement === place
                                  ? 'border-[#6C3CE1] bg-[#EDE7FE] text-[#4C1D95]'
                                  : 'border-[#E5DDFB] bg-white text-[#645E82]'
                              }`}
                            >
                              {place}
                            </button>
                          ))}
                        </div>
                        <div>
                          <div className="mb-1 flex justify-between text-[11px] text-[#645E82]">
                            <span>Opacity</span>
                            <span className="font-mono-tabular font-bold text-[#1E1B4B]">
                              {Math.round(exportConfig.watermark.opacity * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.08}
                            max={0.6}
                            step={0.02}
                            value={exportConfig.watermark.opacity}
                            onChange={(e) =>
                              setExportConfig((prev) => ({
                                ...prev,
                                watermark: {
                                  ...prev.watermark,
                                  opacity: Number(e.target.value),
                                },
                              }))
                            }
                            className="w-full accent-[#6C3CE1] cursor-pointer"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-[#EDE7FE] pt-3">
                    <span className="text-xs font-bold text-[#1E1B4B]">
                      Page Numbers
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={exportConfig.pageNumbers.enabled}
                      onClick={() =>
                        setExportConfig((prev) => ({
                          ...prev,
                          pageNumbers: {
                            ...prev.pageNumbers,
                            enabled: !prev.pageNumbers.enabled,
                          },
                        }))
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                        exportConfig.pageNumbers.enabled
                          ? 'bg-[#6C3CE1]'
                          : 'bg-[#DDD6FE]'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          exportConfig.pageNumbers.enabled
                            ? 'translate-x-6'
                            : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className="mt-6 border-t border-[#EDE7FE] pt-4">
                  <button
                    type="button"
                    onClick={handlePrimaryExport}
                    disabled={!canExport || isExporting}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#6C3CE1] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                  >
                    <FileCheck2 className="h-4 w-4 shrink-0" />
                    <span>{isExporting ? 'Compiling PDF...' : exportLabel}</span>
                  </button>
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>

      {/* ====================================================================
          Quiet Footer
         ==================================================================== */}
      <footer className="border-t border-[#E5DDFB] bg-white/75 px-4 py-4 text-xs text-[#645E82] sm:px-8">
        <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-[#1E1B4B]">
            © 2026 ShMp3100 Tool PDFMR
          </span>
          <span>
            Supported images: JPG, JPEG, PNG, GIF, BMP, WEBP · All processing stays in your browser
          </span>
        </div>
      </footer>

      {/* ====================================================================
          Camera Document Scanner Modal
         ==================================================================== */}
      {cameraOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1B4B]/65 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="camera-modal-title"
        >
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-[#DFD4FC] bg-white text-[#1E1B4B] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#EDE7FE] px-5 py-4">
              <div>
                <h2
                  id="camera-modal-title"
                  className="font-display text-lg font-extrabold"
                >
                  Camera Document Scanner
                </h2>
                <p className="text-xs text-[#645E82]">
                  Point at your document, capture one or more pages, and add directly to the PDF workbench.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                aria-label="Close camera scanner"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E5DDFB] text-[#645E82] hover:bg-[#F3EFFE] hover:text-[#1E1B4B] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[1.45fr_1fr]">
              <div className="flex flex-col gap-3">
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[#DFD4FC] bg-[#131122]">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className={`h-full w-full object-cover ${
                      cameraState === 'active' ? 'opacity-100' : 'opacity-0'
                    }`}
                    style={{
                      filter:
                        cameraFilter === 'crisp'
                          ? 'contrast(1.22) brightness(1.05)'
                          : cameraFilter === 'mono'
                            ? 'grayscale(1) contrast(1.4)'
                            : 'none',
                    }}
                  />

                  {cameraState === 'active' && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-6 border border-dashed border-[#A78BFA]/70"
                    >
                      <span className="absolute -left-[1px] -top-[1px] h-4 w-4 border-l-2 border-t-2 border-[#6C3CE1]" />
                      <span className="absolute -right-[1px] -top-[1px] h-4 w-4 border-r-2 border-t-2 border-[#6C3CE1]" />
                      <span className="absolute -bottom-[1px] -left-[1px] h-4 w-4 border-b-2 border-l-2 border-[#6C3CE1]" />
                      <span className="absolute -bottom-[1px] -right-[1px] h-4 w-4 border-b-2 border-r-2 border-[#6C3CE1]" />
                    </div>
                  )}

                  {cameraState === 'idle' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-[#DDD6FE]">
                      <RefreshCw className="h-5 w-5 animate-spin text-[#A78BFA]" />
                      <span>Starting camera feed...</span>
                    </div>
                  )}

                  {cameraState === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
                      <Camera className="h-8 w-8 text-[#A78BFA]" />
                      <p className="max-w-sm text-sm text-[#EDE9FE]">
                        {cameraError}
                      </p>
                      <button
                        type="button"
                        onClick={() => startCameraStream(facingMode)}
                        className="rounded-xl bg-[#6C3CE1] px-4 py-2 text-xs font-bold text-white hover:bg-[#5B21B6] cursor-pointer"
                      >
                        Retry Camera
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1 rounded-xl bg-[#F3EFFE] p-1">
                    {(
                      [
                        { id: 'original', label: 'Original' },
                        { id: 'crisp', label: 'Crisp Scan' },
                        { id: 'mono', label: 'Mono Ink' },
                      ] as const
                    ).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setCameraFilter(preset.id)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                          cameraFilter === preset.id
                            ? 'bg-white text-[#6C3CE1] shadow-sm'
                            : 'text-[#645E82] hover:text-[#1E1B4B]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setFacingMode((m) =>
                          m === 'environment' ? 'user' : 'environment'
                        )
                      }
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#DFD4FC] bg-white px-3 text-xs font-bold text-[#4C1D95] hover:border-[#6C3CE1] cursor-pointer"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      <span>Flip</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCaptureCameraPage}
                      disabled={cameraState !== 'active' || isCapturing}
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#6C3CE1] px-4 text-xs font-bold text-white hover:bg-[#5B21B6] disabled:opacity-40 cursor-pointer"
                    >
                      <Camera className="h-4 w-4" />
                      <span>{isCapturing ? 'Capturing...' : 'Capture Page'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-[#EDE7FE] bg-[#FAF8FF] p-4">
                <div>
                  <div className="mb-3 flex items-center justify-between border-b border-[#EDE7FE] pb-2">
                    <h3 className="text-sm font-bold text-[#1E1B4B]">
                      Captured Queue
                    </h3>
                    <span className="font-mono-tabular text-xs font-semibold text-[#6C3CE1]">
                      {capturedFrames.length}p
                    </span>
                  </div>

                  {capturedFrames.length === 0 ? (
                    <div className="flex h-48 flex-col items-center justify-center text-center">
                      <p className="text-xs font-semibold text-[#645E82]">
                        No captured pages yet.
                      </p>
                      <p className="mt-1 text-[11px] text-[#847DA3]">
                        Capture a document page to add it here.
                      </p>
                    </div>
                  ) : (
                    <div className="max-h-[290px] space-y-2 overflow-y-auto pr-1">
                      {capturedFrames.map((frame, index) => (
                        <div
                          key={frame.id}
                          className="flex items-center gap-3 rounded-xl border border-[#E5DDFB] bg-white p-2"
                        >
                          <img
                            src={frame.previewUrl}
                            alt={`Scan ${index + 1}`}
                            className="h-14 w-11 rounded border border-[#EDE7FE] object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-[#1E1B4B]">
                              Page {index + 1}
                            </p>
                            <div className="mt-1 flex gap-2">
                              {(['original', 'crisp', 'mono'] as const).map((f) => (
                                <button
                                  key={f}
                                  type="button"
                                  onClick={() =>
                                    handleCycleCapturedFilter(frame.id, f)
                                  }
                                  className={`text-[11px] cursor-pointer ${
                                    frame.filter === f
                                      ? 'font-bold text-[#6C3CE1] underline'
                                      : 'text-[#847DA3]'
                                  }`}
                                >
                                  {f === 'original'
                                    ? 'Raw'
                                    : f === 'crisp'
                                      ? 'Crisp'
                                      : 'Mono'}
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setCapturedFrames((prev) =>
                                prev.filter((c) => c.id !== frame.id)
                              )
                            }
                            aria-label={`Remove scan ${index + 1}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#847DA3] hover:text-[#DC2626] cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex justify-end gap-2 border-t border-[#EDE7FE] pt-3">
                  <button
                    type="button"
                    onClick={() => setCameraOpen(false)}
                    className="rounded-xl border border-[#E5DDFB] bg-white px-3.5 py-2 text-xs font-bold text-[#645E82] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={capturedFrames.length === 0}
                    onClick={handleCommitCameraScans}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#6C3CE1] px-4 py-2 text-xs font-bold text-white hover:bg-[#5B21B6] disabled:opacity-40 cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>Add to Workbench</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          Toast Notification
         ==================================================================== */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-2.5 rounded-2xl border px-4 py-3 text-xs font-semibold shadow-xl ${
            toast.kind === 'success'
              ? 'border-[#BBF7D0] bg-white text-[#166534]'
              : 'border-[#FECACA] bg-white text-[#991B1B]'
          }`}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-[#DC2626]" />
          )}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
