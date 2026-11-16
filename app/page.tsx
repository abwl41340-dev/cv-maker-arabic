'use client';

import { useMemo, useRef, useState } from 'react';

const formatMeta: Record<string, { label: string; group: 'images' | 'documents' | 'data' }> = {
  png: { label: 'PNG', group: 'images' },
  jpg: { label: 'JPG', group: 'images' },
  jpeg: { label: 'JPG', group: 'images' },
  webp: { label: 'WEBP', group: 'images' },
  avif: { label: 'AVIF', group: 'images' },
  bmp: { label: 'BMP', group: 'images' },
  pdf: { label: 'PDF', group: 'documents' },
  txt: { label: 'TXT', group: 'documents' },
  md: { label: 'MD', group: 'documents' },
  html: { label: 'HTML', group: 'documents' },
  json: { label: 'JSON', group: 'data' },
  csv: { label: 'CSV', group: 'data' },
  xml: { label: 'XML', group: 'data' },
  docx: { label: 'DOCX', group: 'documents' },
  zip: { label: 'ZIP', group: 'documents' },
};

const imageFormats = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'pdf'];
const documentFormats = ['txt', 'md', 'html', 'json', 'csv', 'xml', 'docx', 'pdf'];

const supportedFormats = [...new Set([...imageFormats, ...documentFormats])];

function getExtension(name: string) {
  return (name.split('.').pop() || '').toLowerCase();
}

function bytesToLabel(size: number) {
  if (size < 1024) return `${size} بايت`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export default function HomePage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceFormat, setSourceFormat] = useState('');
  const [targetFormat, setTargetFormat] = useState('');
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState('');

  const availableTargets = useMemo(() => {
    if (!file) return [];

    const ext = getExtension(file.name);
    const all = supportedFormats.filter((v) => v !== ext);
    const preferred = ext === 'jpg' || ext === 'jpeg' ? ['png', 'webp', 'pdf', 'txt', 'json', 'jpg'] : all;

    const set = new Set(preferred.filter((v) => supportedFormats.includes(v)));
    return Array.from(set).map((value) => ({ value, label: formatMeta[value]?.label || value.toUpperCase() }));
  }, [file]);

  const handleSelectFile = (selected: File | undefined) => {
    setStatus(null);
    setDownloadUrl(null);
    if (!selected) return;

    const ext = getExtension(selected.name);
    if (!supportedFormats.includes(ext)) {
      setStatus({ type: 'error', message: `نوع الملف ${ext || 'غير معروف'} غير مدعوم في هذه النسخة. حاول JPG، PNG، PDF، TXT، JSON، CSV، HTML أو DOCX.` });
      return;
    }

    setFile(selected);
    setSourceFormat(ext);
    setTargetFormat('');
  };

  const onConvert = async () => {
    if (!file || !targetFormat) {
      setStatus({ type: 'error', message: 'يرجى اختيار ملف ثم تحديد صيغة التحويل.' });
      return;
    }

    setIsLoading(true);
    setStatus({ type: 'info', message: 'جارٍ التحويل...' });

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('targetFormat', targetFormat);

      const response = await fetch('/api/convert', {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'فشل التحويل.');
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition');
      const fileNameFromHeader = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || disposition?.match(/filename="([^"]+)"/)?.[1];
      const base = file.name.replace(/\.[^/.]+$/, '');
      const name = decodeURIComponent(fileNameFromHeader || `${base}.${targetFormat}`);

      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setDownloadName(name);
      setStatus({ type: 'success', message: 'تمت العملية بنجاح، الملف جاهز للتنزيل.' });
    } catch (error: any) {
      setStatus({ type: 'error', message: error?.message || 'تعذر إكمال التحويل.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (!downloadUrl) return;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <main className="page-shell">
      <header className="topbar shell">
        <div className="brand-wrap">
          <div className="brand-mark">✦</div>
          <div className="brand-text">صيغة</div>
        </div>
        <div className="status-pill">
          <span className="dot" /> معالجة محلية وآمنة
        </div>
      </header>

      <section className="shell hero">
        <div className="eyebrow">محول إنترنت + ملفات</div>
        <h1>
          حول أي ملف إلى <span>صيغة مناسبة لك</span>
        </h1>
        <p>
          أداة احترافية لتحويل الصور والملفات النصية والوثائق بين الصيغ الشائعة بدون رفع الملفات إلى خادم خارجي.
        </p>
        <div className="chips">
          <span>PNG</span>
          <span>JPG</span>
          <span>WEBP</span>
          <span>PDF</span>
          <span>TXT</span>
          <span>JSON</span>
          <span>CSV</span>
          <span>HTML</span>
          <span>DOCX</span>
        </div>
      </section>

      <section className="shell app-box">
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleSelectFile(e.dataTransfer.files?.[0]);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <div className="upload-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 16V4m0 0-4 4m4-4 4 4" />
              <path d="M5 17v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1" />
            </svg>
          </div>
          <h3>اسحب ملفك هنا</h3>
          <p>أو اختره من جهازك مباشرة</p>
          <button type="button" className="primary-btn">اختيار ملف</button>
          <input
            ref={inputRef}
            type="file"
            className="hidden-input"
            onChange={(e) => handleSelectFile(e.target.files?.[0])}
            accept=".png,.jpg,.jpeg,.webp,.avif,.bmp,.pdf,.txt,.md,.html,.json,.csv,.xml,.docx,.zip"
          />
        </div>

        {file && (
          <div className="file-row">
            <div className="file-icon">{(sourceFormat || 'FILE').toUpperCase().slice(0, 5)}</div>
            <div className="file-info">
              <div className="file-name">{file.name}</div>
              <div className="file-meta">{bytesToLabel(file.size)} • {formatMeta[sourceFormat]?.label || sourceFormat.toUpperCase()}</div>
            </div>
            <button type="button" className="remove-btn" onClick={() => { setFile(null); setSourceFormat(''); setTargetFormat(''); setStatus(null); setDownloadUrl(null); if (inputRef.current) inputRef.current.value = ''; }}>
              ×
            </button>
          </div>
        )}

        <div className="converter-row">
          <div className="field-box">
            <label>الصيغة الحالية</label>
            <div className="field-value">
              <span className="mini-dot" />
              <span>{sourceFormat ? formatMeta[sourceFormat]?.label || sourceFormat.toUpperCase() : 'لم يتم اختيار ملف'}</span>
            </div>
          </div>

          <button type="button" className="swap-btn" onClick={() => {
            if (!file || !targetFormat) return;
            const oldSource = sourceFormat;
            setSourceFormat(targetFormat);
            setTargetFormat(oldSource);
          }}>
            ⇄
          </button>

          <div className="field-box">
            <label>التحويل إلى</label>
            <div className="select-wrap">
              <select value={targetFormat} onChange={(e) => setTargetFormat(e.target.value)} disabled={!file || !availableTargets.length}>
                <option value="">اختر الصيغة</option>
                {availableTargets.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button type="button" className="action-btn" onClick={onConvert} disabled={!file || !targetFormat || isLoading}>
          {isLoading ? <span className="spinner" /> : <span>⇩</span>}
          {isLoading ? 'جارٍ التحويل...' : 'تحويل الملف'}
        </button>

        {status && <div className={`status ${status.type}`}>{status.message}</div>}

        {downloadUrl && (
          <div className="download-box">
            <div>
              <div className="download-title">ملف جاهز للتنزيل</div>
              <div className="download-name">{downloadName}</div>
            </div>
            <button type="button" className="download-btn" onClick={handleDownload}>تنزيل</button>
          </div>
        )}
      </section>

      <section className="shell features">
        <div className="feature-card">
          <div className="feature-icon">⚡</div>
          <div>
            <h4>سريع</h4>
            <p>تحويل فوري للملفات المشهورة في ثوانٍ.</p>
          </div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">🔒</div>
          <div>
            <h4>آمن</h4>
            <p>المعالجة داخل المتصفح أو الخادم الخاص بك دون مشاركة الملفات مع جهات خارجية.</p>
          </div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">📦</div>
          <div>
            <h4>متعدد</h4>
            <p>صور، نصوص، بيانات، ملفات PDF، DOCX، ZIP، وأدوات تحويل ذات قيمة مرتفعة.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
