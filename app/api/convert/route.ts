import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import * as mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun } from 'docx';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 8;
const IMAGE_INPUTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp']);
const TEXT_INPUTS = new Set(['txt', 'md', 'html', 'htm', 'json', 'csv', 'xml', 'docx']);
const SPREADSHEET_INPUTS = new Set(['xlsx', 'xlsm']);
const PDF_INPUTS = new Set(['pdf']);
const TARGETS: Record<string, Set<string>> = {
  png: new Set(['jpg', 'webp', 'avif', 'pdf']), jpg: new Set(['png', 'webp', 'avif', 'pdf']),
  jpeg: new Set(['png', 'webp', 'avif', 'pdf']), webp: new Set(['png', 'jpg', 'avif', 'pdf']),
  avif: new Set(['png', 'jpg', 'webp', 'pdf']), bmp: new Set(['png', 'jpg', 'webp', 'pdf']),
  pdf: new Set(['txt', 'docx', 'md']),
  txt: new Set(['md', 'html', 'json', 'docx']), md: new Set(['txt', 'html', 'docx']),
  html: new Set(['txt', 'md', 'docx']), htm: new Set(['txt', 'md', 'docx']),
  json: new Set(['txt', 'csv', 'html', 'docx']), csv: new Set(['txt', 'json', 'xlsx', 'docx']),
  xml: new Set(['txt']), docx: new Set(['txt', 'md', 'html']),
  xlsx: new Set(['csv', 'json', 'txt']), xlsm: new Set(['csv', 'json', 'txt']),
};

function extension(name: string) { return (name.split('.').pop() || '').toLowerCase(); }
function isSupported(ext: string) { return IMAGE_INPUTS.has(ext) || TEXT_INPUTS.has(ext) || SPREADSHEET_INPUTS.has(ext) || PDF_INPUTS.has(ext); }
function mimeType(ext: string) {
  const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', html: 'text/html; charset=utf-8',
    json: 'application/json; charset=utf-8', csv: 'text/csv; charset=utf-8', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip',
  };
  return types[ext] || 'application/octet-stream';
}
function safeBase(name: string) { return (name.replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100) || 'converted-file'); }
function encodeText(text: string) { return new TextEncoder().encode(text); }
function escapeHtml(text: string) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some((v) => v.trim())) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); if (row.some((v) => v.trim())) rows.push(row); }
  return rows;
}
function csvRecords(text: string) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((v, i) => v.trim() || `column_${i + 1}`);
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}
function recordsCsv(records: Record<string, unknown>[]) {
  if (!records.length) return '';
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.map(quote).join(','), ...records.map((record) => headers.map((h) => quote(record[h])).join(','))].join('\r\n');
}
function htmlToText(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h[1-6]>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
function textHtml(text: string) {
  const body = escapeHtml(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مستند محوّل</title></head><body style="font:16px/1.8 system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px">${body}</body></html>`;
}
function markdownHtml(text: string) {
  const body = escapeHtml(text).replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>مستند محوّل</title></head><body style="font:16px/1.8 system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px">${body}</body></html>`;
}
async function makeDocx(text: string) {
  const doc = new Document({ sections: [{ children: text.split('\n').map((line) => new Paragraph({ children: [new TextRun(line || ' ')] })) }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}
async function pdfText(buffer: Buffer) {
  // pdfjs-dist's legacy build runs in Node without a browser canvas for text extraction.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true });
  const document = await task.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const words = content.items.map((item: any) => typeof item.str === 'string' ? item.str : '').filter(Boolean);
      pages.push(words.join(' '));
    }
  } finally { await document.destroy(); }
  return pages.join('\n\n');
}
async function workbookData(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => rows.push((row.values as unknown[]).slice(1)));
  if (!rows.length) return [];
  const headers = rows[0].map((v, i) => String(v ?? `column_${i + 1}`));
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ''])));
}
async function makeWorkbook(records: Record<string, unknown>[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  if (headers.length) {
    sheet.addRow(headers);
    records.forEach((record) => sheet.addRow(headers.map((header) => {
      const value = record[header];
      return value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : value;
    })));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns = headers.map((header) => ({ header, key: header, width: Math.min(Math.max(header.length + 3, 14), 36) }));
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
async function convertOne(file: File, target: string): Promise<{ bytes: Uint8Array; ext: string }> {
  const source = extension(file.name);
  const input = Buffer.from(await file.arrayBuffer());
  if (!TARGETS[source]?.has(target)) throw new Error(`التحويل من ${source} إلى ${target} غير مدعوم.`);

  if (IMAGE_INPUTS.has(source)) {
    if (target === 'pdf') {
      const png = await sharp(input).rotate().png().toBuffer();
      const meta = await sharp(png).metadata();
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([meta.width || 600, meta.height || 800]);
      const image = await pdf.embedPng(png);
      page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      return { bytes: new Uint8Array(await pdf.save()), ext: 'pdf' };
    }
    const imageTarget = target === 'jpg' ? 'jpeg' : target;
    const bytes = await sharp(input).rotate().toFormat(imageTarget as 'jpeg' | 'png' | 'webp' | 'avif').toBuffer();
    return { bytes: new Uint8Array(bytes), ext: target };
  }

  if (SPREADSHEET_INPUTS.has(source)) {
    const records = await workbookData(input);
    if (target === 'json') return { bytes: encodeText(JSON.stringify(records, null, 2)), ext: 'json' };
    if (target === 'csv') return { bytes: encodeText(recordsCsv(records)), ext: 'csv' };
    return { bytes: encodeText(records.map((record) => Object.values(record).join('\t')).join('\n')), ext: 'txt' };
  }

  let text = source === 'pdf' ? await pdfText(input)
    : source === 'docx' ? (await mammoth.extractRawText({ buffer: input })).value
    : input.toString('utf8');
  if (source === 'html' || source === 'htm') text = htmlToText(text);
  if (target === 'txt' || target === 'md') return { bytes: encodeText(text), ext: target };
  if (target === 'html') {
    const html = source === 'md' ? markdownHtml(text) : textHtml(source === 'json' ? JSON.stringify(JSON.parse(text), null, 2) : text);
    return { bytes: encodeText(html), ext: 'html' };
  }
  if (target === 'json') {
    const json = source === 'csv' ? JSON.stringify(csvRecords(text), null, 2) : JSON.stringify(JSON.parse(text), null, 2);
    return { bytes: encodeText(json), ext: 'json' };
  }
  if (target === 'csv') {
    if (source !== 'json') throw new Error('إنشاء CSV متاح من ملف JSON يحتوي على مصفوفة كائنات.');
    const records = JSON.parse(text);
    if (!Array.isArray(records) || records.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('يجب أن يحتوي JSON على مصفوفة من الكائنات.');
    return { bytes: encodeText(recordsCsv(records)), ext: 'csv' };
  }
  if (target === 'docx') return { bytes: await makeDocx(text), ext: 'docx' };
  throw new Error(`التحويل من ${source} إلى ${target} غير مدعوم.`);
}

async function mergePdfs(files: File[]) {
  const output = await PDFDocument.create();
  for (const file of files) {
    if (extension(file.name) !== 'pdf') throw new Error('دمج PDF يقبل ملفات PDF فقط.');
    const source = await PDFDocument.load(await file.arrayBuffer());
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }
  return new Uint8Array(await output.save());
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);
    const target = String(form.get('targetFormat') || '').toLowerCase().trim();
    const action = String(form.get('action') || 'convert');
    if (!files.length) return NextResponse.json({ error: 'اختر ملفاً واحداً على الأقل.' }, { status: 400 });
    if (files.length > MAX_FILES) return NextResponse.json({ error: `الحد الأقصى ${MAX_FILES} ملفات في العملية الواحدة.` }, { status: 413 });
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (files.some((file) => file.size === 0)) return NextResponse.json({ error: 'أحد الملفات فارغ.' }, { status: 400 });
    if (files.some((file) => file.size > MAX_FILE_BYTES) || total > MAX_TOTAL_BYTES) return NextResponse.json({ error: 'الحد الأقصى 4 ميجابايت إجمالاً، و4 ميجابايت لكل ملف.' }, { status: 413 });
    if (files.some((file) => !isSupported(extension(file.name)))) return NextResponse.json({ error: 'تتضمن العملية صيغة غير مدعومة.' }, { status: 415 });

    if (action === 'merge-pdf') {
      if (files.length < 2) return NextResponse.json({ error: 'اختر ملفي PDF على الأقل للدمج.' }, { status: 400 });
      const bytes = await mergePdfs(files);
      return new Response(bytes, { headers: { 'Content-Type': mimeType('pdf'), 'Content-Disposition': 'attachment; filename="merged.pdf"', 'Cache-Control': 'no-store' } });
    }

    const results = await Promise.all(files.map(async (file) => {
      const result = await convertOne(file, target);
      return { name: `${safeBase(file.name)}.${result.ext}`, ...result };
    }));
    if (results.length === 1) {
      const result = results[0];
      return new Response(result.bytes, { headers: {
        'Content-Type': mimeType(result.ext),
        'Content-Disposition': `attachment; filename="${result.name}"; filename*=UTF-8''${encodeURIComponent(result.name)}`,
        'Cache-Control': 'no-store',
      } });
    }
    const zip = new JSZip();
    results.forEach((result) => zip.file(result.name, result.bytes));
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 5 } });
    return new Response(archive, { headers: { 'Content-Type': mimeType('zip'), 'Content-Disposition': 'attachment; filename="converted-files.zip"', 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'حدث خطأ أثناء التحويل.';
    return NextResponse.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
