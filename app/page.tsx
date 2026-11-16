'use client';

import { useMemo, useRef, useState } from 'react';

const formatMeta: Record<string, string> = {
  png: 'PNG — صورة', jpg: 'JPG — صورة', jpeg: 'JPG — صورة', webp: 'WEBP — صورة',
  avif: 'AVIF — صورة', bmp: 'BMP — صورة', pdf: 'PDF — مستند', txt: 'TXT — نص',
  md: 'Markdown', html: 'HTML', json: 'JSON', csv: 'CSV', xml: 'XML', docx: 'DOCX — Word',
};

const imageInputs = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'];
const textInputs = ['txt', 'md', 'html', 'json', 'csv', 'xml', 'docx'];
const imageOutputs = ['png', 'jpg', 'webp', 'avif', 'pdf'];
const outputMap: Record<string, string[]> = {
  png: imageOutputs.filter((x) => x !== 'png'), jpg: imageOutputs.filter((x) => x !== 'jpg'),
  jpeg: imageOutputs.filter((x) => x !== 'jpg'), webp: imageOutputs.filter((x) => x !== 'webp'),
  avif: imageOutputs.filter((x) => x !== 'avif'), bmp: imageOutputs.filter((x) => x !== 'bmp'),
  txt: ['md', 'html', 'json', 'docx'], md: ['txt', 'html', 'docx'],
  html: ['txt', 'md', 'docx'], json: ['txt', 'csv', 'html', 'docx'],
  csv: ['txt', 'json', 'docx'], xml: ['txt'], docx: ['txt', 'md', 'html'],
};
const maxBytes = 4 * 1024 * 1024;

function getExtension(name: string) { return (name.split('.').pop() || '').toLowerCase(); }
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

  const availableTargets = useMemo(() => (file ? outputMap[sourceFormat] || [] : []), [file, sourceFormat]);

  const clearDownload = () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setDownloadName('');
  };

  const handleSelectFile = (selected?: File) => {
    if (!selected) return;
    clearDownload();
    setStatus(null);
    const ext = getExtension(selected.name);
    if (!(imageInputs.includes(ext) || textInputs.includes(ext))) {
      setFile(null);
      setSourceFormat('');
      setTargetFormat('');
      setStatus({ type: 'error', message: 'هذه الصيغة غير مدعومة. اختر صورة أو TXT أو MD أو HTML أو JSON أو CSV أو XML أو DOCX.' });
      return;
    }
    if (selected.size > maxBytes) {
      setFile(null);
      setSourceFormat('');
      setTargetFormat('');
      setStatus({ type: 'error', message: 'الحد الأقصى لحجم الملف 4 ميجابايت في نسخة Vercel التجريبية.' });
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
    setStatus({ type: 'info', message: 'جارٍ تحويل الملف على خادم التطبيق…' });
    clearDownload();
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('targetFormat', targetFormat);
      const response = await fetch('/api/convert', { method: 'POST', body: form });
      if (!response.ok) {
        let message = 'فشل التحويل.';
        try { const data = await response.json(); message = data.error || message; }
        catch { message = (await response.text()) || message; }
        throw new Error(message);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const base = file.name.replace(/\.[^/.]+$/, '') || 'converted-file';
      const name = encodedName ? decodeURIComponent(encodedName) : plainName || `${base}.${targetFormat}`;
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setDownloadName(name);
      setStatus({ type: 'success', message: 'اكتمل التحويل؛ الملف جاهز للتنزيل.' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'تعذر إكمال التحويل.' });
    } finally { setIsLoading(false); }
  };

  const resetFile = () => {
    clearDownload(); setFile(null); setSourceFormat(''); setTargetFormat(''); setStatus(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <main className="page-shell">
      <header className="topbar shell">
        <div className="brand-wrap"><div className="brand-mark">✦</div><div className="brand-text">صيغة</div></div>
        <div className="status-pill"><span className="dot" /> خصوصية: التحويل عبر خادم الموقع</div>
      </header>
      <section className="shell hero">
        <div className="eyebrow">محوّل ملفات عملي وسهل</div>
        <h1>حوّل ملفاتك إلى <span>الصيغة المناسبة</span></h1>
        <p>حوّل الصور والمستندات والبيانات بين صيغ مختارة. ارفع الملف، اختر الصيغة، ثم نزّل النتيجة.</p>
        <div className="chips"><span>PNG</span><span>JPG</span><span>WEBP</span><span>PDF للصور</span><span>TXT</span><span>JSON</span><span>CSV</span><span>HTML</span><span>DOCX</span></div>
      </section>
      <section className="shell app-box">
        <div className={`dropzone ${dragging ? 'dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleSelectFile(e.dataTransfer.files?.[0]); }}
          role="button" tabIndex={0} aria-label="اختر ملفاً أو اسحبه هنا"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}>
          <div className="upload-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M5 17v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1"/></svg></div>
          <h3>اسحب ملفك هنا</h3><p>أو اختره من جهازك — الحد الأقصى 4 ميجابايت</p>
          <button type="button" className="primary-btn" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>اختيار ملف</button>
          <input ref={inputRef} type="file" className="hidden-input" onChange={(e) => handleSelectFile(e.target.files?.[0])}
            accept=".png,.jpg,.jpeg,.webp,.avif,.bmp,.txt,.md,.markdown,.html,.htm,.json,.csv,.xml,.docx" />
        </div>
        {file && <div className="file-row"><div className="file-icon">{sourceFormat.toUpperCase()}</div><div className="file-info"><div className="file-name">{file.name}</div><div className="file-meta">{bytesToLabel(file.size)} · {formatMeta[sourceFormat] || sourceFormat.toUpperCase()}</div></div><button type="button" className="remove-btn" onClick={resetFile} aria-label="إزالة الملف">×</button></div>}
        <div className="converter-row">
          <div className="field-box"><label>الصيغة الحالية</label><div className="field-value"><span className="mini-dot"/><span>{sourceFormat ? formatMeta[sourceFormat] || sourceFormat.toUpperCase() : 'لم يتم اختيار ملف'}</span></div></div>
          <div className="swap-btn" aria-hidden="true">⇄</div>
          <div className="field-box"><label htmlFor="target-format">التحويل إلى</label><div className="select-wrap"><select id="target-format" value={targetFormat} onChange={(e) => { setTargetFormat(e.target.value); setStatus(null); }} disabled={!file || !availableTargets.length}><option value="">اختر الصيغة</option>{availableTargets.map((format) => <option key={format} value={format}>{formatMeta[format] || format.toUpperCase()}</option>)}</select></div></div>
        </div>
        <button type="button" className="action-btn" onClick={onConvert} disabled={!file || !targetFormat || isLoading}>{isLoading ? <span className="spinner"/> : <span>⇩</span>}{isLoading ? 'جارٍ التحويل…' : 'تحويل الملف'}</button>
        {status && <div className={`status ${status.type}`} role="status" aria-live="polite">{status.message}</div>}
        {downloadUrl && <div className="download-box"><div><div className="download-title">ملف جاهز للتنزيل</div><div className="download-name">{downloadName}</div></div><a className="download-btn" href={downloadUrl} download={downloadName}>تنزيل</a></div>}
      </section>
      <section className="shell features">
        <div className="feature-card"><div className="feature-icon">⚡</div><div><h4>سريع</h4><p>واجهة مباشرة وتحويلات محددة للأنواع المدعومة.</p></div></div>
        <div className="feature-card"><div className="feature-icon">🔒</div><div><h4>بلا تخزين دائم</h4><p>يعالج الخادم الملف للطلب ولا يوفّر مساحة تخزين أو سجل تنزيل.</p></div></div>
        <div className="feature-card"><div className="feature-icon">📦</div><div><h4>صيغ واضحة</h4><p>صور ومستندات وبيانات، مع إظهار خيارات التحويل المناسبة لكل ملف.</p></div></div>
      </section>
      <footer className="shell footer">لا يدعم التطبيق كل صيغ الملفات. تتم معالجة الملفات مؤقتاً على خادم Vercel؛ لا ترفع ملفات حساسة.</footer>
    </main>
  );
}
