import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import * as mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun } from 'docx';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const IMAGE_INPUTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp']);
const TEXT_INPUTS = new Set(['txt', 'md', 'html', 'json', 'csv', 'xml', 'docx']);
const TARGETS: Record<string, Set<string>> = {
  png: new Set(['jpg', 'webp', 'avif', 'pdf']), jpg: new Set(['png', 'webp', 'avif', 'pdf']),
  jpeg: new Set(['png', 'webp', 'avif', 'pdf']), webp: new Set(['png', 'jpg', 'avif', 'pdf']),
  avif: new Set(['png', 'jpg', 'webp', 'pdf']), bmp: new Set(['png', 'jpg', 'webp', 'pdf']),
  txt: new Set(['md', 'html', 'json', 'docx']), md: new Set(['txt', 'html', 'docx']),
  html: new Set(['txt', 'md', 'docx']), json: new Set(['txt', 'csv', 'html', 'docx']),
  csv: new Set(['txt', 'json', 'docx']), xml: new Set(['txt']),
  docx: new Set(['txt', 'md', 'html']),
};

function extOf(name: string) { return (name.split('.').pop() || '').toLowerCase(); }
function mimeOf(ext: string) {
  const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif',
    pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
    html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8', csv: 'text/csv; charset=utf-8',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return types[ext] || 'application/octet-stream';
}
function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let current = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { current += '"'; i++; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(current); current = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(current); if (row.some((cell) => cell.trim())) rows.push(row); row = []; current = '';
    } else current += char;
  }
  if (current || row.length) { row.push(current); if (row.some((cell) => cell.trim())) rows.push(row); }
  return rows;
}
function csvToJson(text: string) {
  const rows = parseCsv(text);
  if (!rows.length) return '[]';
  const headers = rows[0].map((value, i) => value.trim() || `column_${i + 1}`);
  return JSON.stringify(rows.slice(1).map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? '']))), null, 2);
}
function jsonToCsv(text: string) {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== 'object' || data[0] === null) throw new Error('يجب أن يحتوي JSON على مصفوفة من الكائنات لتحويله إلى CSV.');
  const records = data as Record<string, unknown>[];
  const headers = [...new Set(records.flatMap((item) => Object.keys(item)))];
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [headers.map(quote).join(','), ...records.map((item) => headers.map((header) => quote(item[header])).join(','))].join('\r\n');
}
function textToHtml(text: string) {
  const paragraphs = escapeHtml(text).split(/\n{2,}/).map((part) => `<p>${part.replace(/\n/g, '<br>')}</p>`).join('\n');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مستند محوّل</title></head><body style="font:16px/1.8 system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px">${paragraphs}</body></html>`;
}
function markdownToHtml(text: string) {
  const html = escapeHtml(text).replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>مستند محوّل</title></head><body style="font:16px/1.8 system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px">${html}</body></html>`;
}
function htmlToText(text: string) { return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h[1-6]>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(); }
async function textToDocx(text: string) {
  const document = new Document({ sections: [{ children: text.split('\n').map((line) => new Paragraph({ children: [new TextRun(line || ' ')] })) }] });
  return new Uint8Array(await Packer.toBuffer(document));
}

async function convert(file: File, source: string, target: string): Promise<Uint8Array> {
  const input = Buffer.from(await file.arrayBuffer());
  if (IMAGE_INPUTS.has(source)) {
    if (target === 'pdf') {
      const png = await sharp(input).rotate().png().toBuffer();
      const metadata = await sharp(png).metadata();
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([metadata.width || 600, metadata.height || 800]);
      const image = await pdf.embedPng(png);
      page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      return new Uint8Array(await pdf.save());
    }
    const format = target === 'jpg' ? 'jpeg' : target;
    return new Uint8Array(await sharp(input).rotate().toFormat(format as 'png' | 'jpeg' | 'webp' | 'avif').toBuffer());
  }

  let text = source === 'docx' ? (await mammoth.extractRawText({ buffer: input })).value : input.toString('utf8');
  if (target === 'txt') {
    if (source === 'html') text = htmlToText(text);
    return new TextEncoder().encode(text);
  }
  if (target === 'md') {
    if (source === 'html') text = htmlToText(text);
    return new TextEncoder().encode(text);
  }
  if (target === 'html') {
    if (source === 'md') text = markdownToHtml(text);
    else if (source !== 'html') text = textToHtml(source === 'json' ? JSON.stringify(JSON.parse(text), null, 2) : text);
    return new TextEncoder().encode(text);
  }
  if (target === 'json') {
    const json = source === 'csv' ? csvToJson(text) : JSON.stringify(JSON.parse(text), null, 2);
    return new TextEncoder().encode(json);
  }
  if (target === 'csv') return new TextEncoder().encode(jsonToCsv(text));
  if (target === 'docx') return textToDocx(text);
  throw new Error(`التحويل من ${source} إلى ${target} غير متاح.`);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    const target = String(form.get('targetFormat') || '').toLowerCase();
    if (!(file instanceof File)) return NextResponse.json({ error: 'لم يتم إرسال ملف صالح.' }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: 'الملف فارغ.' }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'الحد الأقصى لحجم الملف 4 ميجابايت.' }, { status: 413 });

    const source = extOf(file.name);
    if (!IMAGE_INPUTS.has(source) && !TEXT_INPUTS.has(source)) return NextResponse.json({ error: 'صيغة الملف غير مدعومة.' }, { status: 415 });
    if (!TARGETS[source]?.has(target)) return NextResponse.json({ error: `التحويل من ${source} إلى ${target || 'الصيغة المطلوبة'} غير مدعوم.` }, { status: 400 });

    const output = await convert(file, source, target);
    const base = file.name.replace(/\.[^/.]+$/, '') || 'converted-file';
    const fileName = `${base}.${target}`;
    return new Response(output, { headers: {
      'Content-Type': mimeOf(target),
      'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'حدث خطأ أثناء التحويل.';
    return NextResponse.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
