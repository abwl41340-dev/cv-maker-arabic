'use client';

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from 'react';

const formats: Record<string, string> = {
  png: 'PNG صورة', jpg: 'JPG صورة', jpeg: 'JPEG صورة', webp: 'WEBP صورة', avif: 'AVIF صورة', bmp: 'BMP صورة',
  pdf: 'PDF مستند', docx: 'Word DOCX', xlsx: 'Excel XLSX', xlsm: 'Excel XLSM', txt: 'نص TXT', md: 'Markdown',
  html: 'HTML', htm: 'HTML', json: 'JSON', csv: 'CSV', xml: 'XML',
};
const outputs: Record<string, string[]> = {
  png: ['jpg', 'webp', 'avif', 'pdf'], jpg: ['png', 'webp', 'avif', 'pdf'], jpeg: ['png', 'webp', 'avif', 'pdf'],
  webp: ['png', 'jpg', 'avif', 'pdf'], avif: ['png', 'jpg', 'webp', 'pdf'], bmp: ['png', 'jpg', 'webp', 'pdf'],
  pdf: ['txt', 'docx', 'md'], txt: ['md', 'html', 'json', 'docx'], md: ['txt', 'html', 'docx'],
  html: ['txt', 'md', 'docx'], htm: ['txt', 'md', 'docx'], json: ['txt', 'csv', 'html', 'docx'],
  csv: ['txt', 'json', 'xlsx', 'docx'], xml: ['txt'], docx: ['txt', 'md', 'html'], xlsx: ['csv', 'json', 'txt'], xlsm: ['csv', 'json', 'txt'],
};
const MAX_TOTAL = 4 * 1024 * 1024;
const extension = (name: string) => (name.split('.').pop() || '').toLowerCase();
const sizeLabel = (size: number) => size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(2)} MB`;

export default function HomePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ type: string; message: string } | null>(null);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);

  const commonTargets = useMemo(() => {
    if (!files.length) return [];
    return (outputs[extension(files[0].name)] || []).filter((targetFormat) => files.every((file) => (outputs[extension(file.name)] || []).includes(targetFormat)));
  }, [files]);
  const allPdf = files.length > 1 && files.every((file) => extension(file.name) === 'pdf');
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  function clearDownload() {
    if (download) URL.revokeObjectURL(download.url);
    setDownload(null);
  }
  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    const combined = [...files, ...incoming].slice(0, 8);
    if (incoming.some((file) => !outputs[extension(file.name)])) {
      setStatus({ type: 'error', message: 'توجد صيغة غير مدعومة. راجع الصيغ المتاحة أسفل منطقة الرفع.' }); return;
    }
    if (combined.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL) {
      setStatus({ type: 'error', message: 'الحد الأقصى لحجم جميع الملفات هو 4 ميجابايت على Vercel.' }); return;
    }
    clearDownload(); setStatus(null); setFiles(combined); setTarget('');
  }
  function removeFile(index: number) {
    clearDownload(); setFiles(files.filter((_, i) => i !== index)); setTarget(''); setStatus(null);
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files);
  }
  function onInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  }
  async function convert(action = 'convert') {
    if (!files.length || (action === 'convert' && !target)) return;
    setBusy(true); setStatus({ type: 'info', message: action === 'merge-pdf' ? 'جارٍ دمج ملفات PDF…' : 'جارٍ تحويل الملفات…' }); clearDownload();
    try {
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      form.append('targetFormat', target);
      form.append('action', action);
      const response = await fetch('/api/convert', { method: 'POST', body: form });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'تعذر تحويل الملفات.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const name = encoded ? decodeURIComponent(encoded) : plain || (files.length > 1 ? 'converted-files.zip' : `${files[0].name.replace(/\.[^.]+$/, '')}.${target}`);
      setDownload({ url: URL.createObjectURL(blob), name });
      setStatus({ type: 'success', message: 'اكتملت العملية. حمل النتيجة قبل بدء تحويل جديد.' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : 'حدث خطأ غير متوقع.' });
    } finally { setBusy(false); }
  }

  return <main className="app-shell">
    <header className="topbar wrap"><a className="brand" href="#" aria-label="صيغة الرئيسية"><span className="brand-icon">S</span><span>صيغة<span className="brand-dot">.</span></span></a><div className="top-links"><span className="secure"><i/> معالجة مؤقتة وآمنة</span><a href="#formats">الصيغ المدعومة</a></div></header>
    <section className="hero wrap"><div className="hero-kicker"><span>✦</span> مساحة عملك للتحويل</div><h1>كل ملفاتك، <em>في الصيغة المناسبة.</em></h1><p>حوّل المستندات والصور والبيانات، أو ادمج ملفات PDF — من واجهة واحدة بسيطة وواضحة.</p><div className="hero-stats"><span><b>15+</b> صيغة مدعومة</span><span className="stat-sep"/><span><b>8</b> ملفات بالدفعة</span><span className="stat-sep"/><span><b>0</b> تخزين دائم</span></div></section>
    <section className="converter wrap"><div className="converter-head"><div><div className="section-label">أداة التحويل</div><h2>ابدأ بملفاتك</h2></div><div className="privacy-tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></svg> لا نحتفظ بملفاتك</div></div>
      <div className={`dropzone ${dragging ? 'is-dragging' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} role="button" tabIndex={0} aria-label="اختر الملفات أو اسحبها هنا" onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}>
        <div className="upload-symbol"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 15V3m0 0L7 8m5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg></div><h3>اسحب الملفات وأفلتها هنا</h3><p>أو <button type="button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>تصفح جهازك</button> — حتى 8 ملفات، وبإجمالي لا يتجاوز 4 ميجابايت</p><div className="upload-support">صور · PDF · Word · Excel · CSV · JSON</div><input ref={inputRef} className="visually-hidden" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.avif,.bmp,.pdf,.txt,.md,.html,.htm,.json,.csv,.xml,.docx,.xlsx,.xlsm" onChange={onInput}/>
      </div>
      {files.length > 0 && <div className="file-list"><div className="file-list-head"><span>الملفات المختارة <b>{files.length}</b></span><span>{sizeLabel(totalSize)} / 4 MB</span></div>{files.map((file, index) => <div className="file-item" key={`${file.name}-${index}`}><span className={`file-badge badge-${extension(file.name)}`}>{extension(file.name).slice(0,4).toUpperCase()}</span><div className="file-details"><strong>{file.name}</strong><small>{formats[extension(file.name)] || extension(file.name).toUpperCase()} · {sizeLabel(file.size)}</small></div><button className="remove-file" type="button" onClick={() => removeFile(index)} aria-label={`إزالة ${file.name}`}>×</button></div>)}</div>}
      <div className="convert-controls"><div className="format-field"><label>من</label><div className="format-value">{files.length === 0 ? 'اختر ملفات للبدء' : files.length === 1 ? formats[extension(files[0].name)] : `${files.length} ملفات مختارة`}<span>▾</span></div></div><span className="arrow">←</span><div className="format-field"><label htmlFor="target-format">إلى</label><select id="target-format" value={target} disabled={!files.length || !commonTargets.length} onChange={(e) => setTarget(e.target.value)}><option value="">{files.length ? 'اختر صيغة الإخراج' : 'بانتظار الملفات'}</option>{commonTargets.map((format) => <option key={format} value={format}>{formats[format] || format.toUpperCase()}</option>)}</select></div></div>
      <button className="convert-button" type="button" onClick={() => convert()} disabled={!files.length || !target || busy}>{busy ? <span className="loading-ring"/> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg>}{busy ? 'جارٍ المعالجة…' : files.length > 1 ? `تحويل ${files.length} ملفات` : 'تحويل الملف'}</button>
      {allPdf && <button className="merge-button" type="button" disabled={busy} onClick={() => convert('merge-pdf')}>＋ دمج ملفات PDF في مستند واحد</button>}
      {status && <div className={`notice notice-${status.type}`} role="status" aria-live="polite">{status.message}</div>}
      {download && <div className="result-card"><div className="result-check">✓</div><div className="result-info"><strong>ملفك جاهز</strong><span>{download.name}</span></div><a href={download.url} download={download.name} className="download-button">تنزيل <span>↓</span></a></div>}
      <p className="privacy-note">تعالج الملفات مؤقتاً في خادم التطبيق لإنتاج النتيجة، ثم تُرسل إليك مباشرة دون تخزين دائم. لا ترفع بيانات شديدة الحساسية.</p>
    </section>
    <section className="wrap tools-section" id="formats"><div className="section-label">أدوات عملية</div><h2>ماذا يمكنك أن تفعل؟</h2><div className="tool-grid"><article className="tool-card"><span className="tool-icon purple">▧</span><div><h3>تحويل الصور</h3><p>PNG وJPG وWEBP وAVIF، مع تحويل الصور إلى PDF.</p></div></article><article className="tool-card"><span className="tool-icon rose">▤</span><div><h3>مستندات PDF وWord</h3><p>استخراج النص من PDF، إنشاء DOCX، وقراءة نص مستندات Word.</p></div></article><article className="tool-card"><span className="tool-icon green">▦</span><div><h3>Excel وبيانات</h3><p>قراءة أول ورقة عمل من XLSX وتحويلها إلى CSV أو JSON.</p></div></article><article className="tool-card"><span className="tool-icon blue">⇄</span><div><h3>تحويل دفعي</h3><p>حوّل عدة ملفات إلى الصيغة نفسها ونزّلها في ZIP واحد.</p></div></article><article className="tool-card"><span className="tool-icon amber">⊕</span><div><h3>دمج ملفات PDF</h3><p>اجمع عدة ملفات PDF في مستند واحد بالترتيب المختار.</p></div></article><article className="tool-card"><span className="tool-icon slate">⌘</span><div><h3>بيانات منظمة</h3><p>تحويل JSON وCSV وTXT وMarkdown وHTML بين صيغ مناسبة.</p></div></article></div></section>
    <section className="wrap limitations"><strong>تنبيه حول الدعم:</strong> لا توجد أداة واحدة تحول كل الملفات بلا حدود. هذا الإصدار لا يحول DOCX إلى PDF، ولا يدعم XLSX إلى PDF، ولا يحول الصوت أو الفيديو. ملفات XLSX تستخدم أول ورقة عمل فقط؛ خلايا المعادلات تعرض قيمة Excel المخزنة. حد الملفات 4 ميجابايت بسبب حدود Vercel، وقد لا يستخرج PDF الممسوح ضوئياً نصاً دون OCR.</section>
    <footer className="wrap footer"><a className="brand footer-brand" href="#"><span className="brand-icon">S</span><span>صيغة<span className="brand-dot">.</span></span></a><span>تحويل واضح. ملفاتك لك.</span><span>© صيغة</span></footer>
  </main>;
}
