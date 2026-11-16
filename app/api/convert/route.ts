import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import * as mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun } from 'docx';

const SUPPORTED = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'pdf', 'txt', 'md', 'html', 'json', 'csv', 'xml', 'docx', 'zip']);

function normaliseFormat(name: string) {
  return (name || '').replace(/^\./, '').toLowerCase();
}

function getMimeType(ext: string) {
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    html: 'text/html; charset=utf-8',
    json: 'application/json; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    zip: 'application/zip',
  };

  return map[ext] || 'application/octet-stream';
}

async function readText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return buffer.toString('utf-8');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(current);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      current = '';
      continue;
    }
    current += ch;
  }

  if (current || row.length) {
    row.push(current);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }

  return rows;
}

function csvToJson(text: string) {
  const rows = parseCsv(text);
  if (!rows.length) return '[]';
  const headers = rows[0].map((h, index) => h.trim() || `column_${index + 1}`);
  const data = rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] ?? '';
    });
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

function jsonToCsv(text: string) {
  const data = JSON.parse(text);
  if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== 'object') {
    throw new Error('يجب أن يكون JSON على هيئة مصفوفة من الكائنات لتحويله إلى CSV.');
  }
  const headers = [...new Set(data.flatMap((item: any) => Object.keys(item)))] as string[];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [headers.map(escape).join(',')];
  data.forEach((item: any) => {
    rows.push(headers.map((header) => escape(item[header])).join(','));
  });
  return rows.join('\n');
}

function htmlFromText(text: string) {
  const safe = escapeHtml(text).replace(/\n{2,}/g, '</p><p>');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>مستند محوّل</title></head><body style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;padding:40px;max-width:800px;margin:auto;"> <p>${safe.replace(/\n/g, '<br>')}</p></body></html>`;
}

function markdownToHtml(text: string) {
  const safe = escapeHtml(text)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Markdown</title></head><body style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;padding:40px;max-width:800px;margin:auto;">${safe}</body></html>`;
}

async function textToDocx(text: string) {
  const doc = new Document({
    sections: [{
      properties: {},
      children: text.split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line || ' ', size: 24 })] }))
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

async function docxToText(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function imageToPdf(buffer: Buffer) {
  const image = await sharp(buffer).rotate().flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } }).toFormat('png').toBuffer();
  const sharpMeta = await sharp(image).metadata();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([Number(sharpMeta.width || 600), Number(sharpMeta.height || 800)]);
  const embedded = await pdf.embedPng(image);
  page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  return Buffer.from(await pdf.save());
}

async function convertFile(originalName: string, file: File, targetFormat: string) {
  const inputExt = normaliseFormat(originalName);
  const normalTarget = normaliseFormat(targetFormat);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (!SUPPORTED.has(inputExt)) {
    throw new Error(`صيغة الإدخال ${inputExt || 'غير معروفة'} غير مدعومة.`);
  }

  if (!SUPPORTED.has(normalTarget)) {
    throw new Error(`صيغة الإخراج ${normalTarget} غير مدعومة.`);
  }

  if (['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'].includes(inputExt) && ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'].includes(normalTarget)) {
    const output = await sharp(buffer).toFormat(normalTarget === 'jpg' ? 'jpeg' : normalTarget as any).toBuffer();
    return { buffer: output, ext: normalTarget, mimeType: getMimeType(normalTarget) };
  }

  if (['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'].includes(inputExt) && normalTarget === 'pdf') {
    const output = await imageToPdf(buffer);
    return { buffer: output, ext: 'pdf', mimeType: getMimeType('pdf') };
  }

  if (inputExt === 'pdf' && ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'].includes(normalTarget)) {
    const image = await sharp(buffer).toFormat(normalTarget === 'jpg' ? 'jpeg' : normalTarget as any).toBuffer();
    return { buffer: image, ext: normalTarget, mimeType: getMimeType(normalTarget) };
  }

  if (['txt', 'md', 'html', 'json', 'csv', 'xml'].includes(inputExt) || inputExt === 'docx') {
    let text = '';
    if (inputExt === 'docx') {
      text = await docxToText(buffer);
    } else {
      text = buffer.toString('utf-8');
    }

    if (normalTarget === 'txt') {
      return { buffer: Buffer.from(text, 'utf-8'), ext: 'txt', mimeType: getMimeType('txt') };
    }

    if (normalTarget === 'html') {
      const content = inputExt === 'md' ? markdownToHtml(text) : inputExt === 'json' ? htmlFromText(JSON.stringify(JSON.parse(text), null, 2)) : inputExt === 'csv' ? htmlFromText(text) : text;
      return { buffer: Buffer.from(content, 'utf-8'), ext: 'html', mimeType: getMimeType('html') };
    }

    if (normalTarget === 'md') {
      const content = inputExt === 'html' ? text.replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n').trim() : text;
      return { buffer: Buffer.from(content, 'utf-8'), ext: 'md', mimeType: getMimeType('md') };
    }

    if (normalTarget === 'json') {
      if (inputExt === 'csv') {
        return { buffer: Buffer.from(csvToJson(text), 'utf-8'), ext: 'json', mimeType: getMimeType('json') };
      }
      JSON.parse(text);
      return { buffer: Buffer.from(JSON.stringify(JSON.parse(text), null, 2), 'utf-8'), ext: 'json', mimeType: getMimeType('json') };
    }

    if (normalTarget === 'csv') {
      if (inputExt === 'json') {
        return { buffer: Buffer.from(jsonToCsv(text), 'utf-8'), ext: 'csv', mimeType: getMimeType('csv') };
      }
      return { buffer: Buffer.from(text, 'utf-8'), ext: 'csv', mimeType: getMimeType('csv') };
    }

    if (normalTarget === 'xml') {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<root>${escapeHtml(text)}</root>`;
      return { buffer: Buffer.from(xml, 'utf-8'), ext: 'xml', mimeType: getMimeType('xml') };
    }

    if (normalTarget === 'docx') {
      const output = await textToDocx(text);
      return { buffer: Buffer.from(output), ext: 'docx', mimeType: getMimeType('docx') };
    }
  }

  if (inputExt === 'json' && normalTarget === 'csv') {
    return { buffer: Buffer.from(jsonToCsv(buffer.toString('utf-8')), 'utf-8'), ext: 'csv', mimeType: getMimeType('csv') };
  }

  if (inputExt === 'csv' && normalTarget === 'json') {
    return { buffer: Buffer.from(csvToJson(buffer.toString('utf-8')), 'utf-8'), ext: 'json', mimeType: getMimeType('json') };
  }

  if (inputExt === 'txt' && normalTarget === 'html') {
    return { buffer: Buffer.from(htmlFromText(buffer.toString('utf-8')), 'utf-8'), ext: 'html', mimeType: getMimeType('html') };
  }

  if (inputExt === 'txt' && normalTarget === 'md') {
    return { buffer: Buffer.from(buffer.toString('utf-8'), 'utf-8'), ext: 'md', mimeType: getMimeType('md') };
  }

  if (inputExt === 'html' && normalTarget === 'txt') {
    return { buffer: Buffer.from(buffer.toString('utf-8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 'utf-8'), ext: 'txt', mimeType: getMimeType('txt') };
  }

  if (inputExt === 'html' && normalTarget === 'md') {
    const text = buffer.toString('utf-8').replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n').trim();
    return { buffer: Buffer.from(text, 'utf-8'), ext: 'md', mimeType: getMimeType('md') };
  }

  if (normalTarget === inputExt) {
    return { buffer, ext: inputExt, mimeType: getMimeType(inputExt) };
  }

  throw new Error(`لا توجد تحويلات مدعومة من ${inputExt} إلى ${normalTarget}.`);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    const targetFormat = String(form.get('targetFormat') || '').trim();

    if (!file) {
      return NextResponse.json({ error: 'لم يتم إرسال ملف.' }, { status: 400 });
    }

    const originalName = file.name;
    const result = await convertFile(originalName, file, targetFormat);
    const fileName = `${originalName.replace(/\.[^/.]+$/, '') || 'converted-file'}.${result.ext}`;

    return new Response(result.buffer, {
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'حدث خطأ في التحويل.' },
      { status: 400 }
    );
  }
}
