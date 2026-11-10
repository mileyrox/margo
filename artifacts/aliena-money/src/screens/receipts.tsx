import { useEffect, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  customFetch, getGetFinanceDashboardQueryKey, getGetProductComparisonsQueryKey, getGetPurchaseHistoryQueryKey, getGetReceiptsQueryKey,
  useCreateReceipt, useDeleteReceipt, useGetProductComparisons, useGetReceipts, useRequestUploadUrl, useScanReceiptImage,
} from '@workspace/api-client-react';
import type { ReceiptInput, ReceiptScanResult } from '@workspace/api-client-react';
import { ChevronDown, FileImage, ReceiptText, ScanBarcode, Upload } from 'lucide-react';
import { EmptyState, ErrorState, PageTitle, Skeleton } from '@/components/margo/chrome';
import { ProductArt } from '@/components/margo/art';
import { artFor, bandFor } from '@/lib/swap-catalog';
import { EngineResult, findSwap, type EngineLookup } from '@/components/margo/engine';
import { cents, dateLabel, messageOf, money } from '@/lib/format';

export function ReceiptPage() {
  const qc = useQueryClient();
  const query = useGetReceipts();
  const comparisons = useGetProductComparisons();
  const create = useCreateReceipt();
  const remove = useDeleteReceipt();
  const uploadUrl = useRequestUploadUrl();
  const scanImage = useScanReceiptImage();
  const search = useSearch();
  const barcodeMode = new URLSearchParams(search).get('scan') === 'barcode';
  const [file, setFile] = useState<File | null>(null);
  const [scanResult, setScanResult] = useState<ReceiptScanResult | null>(null);
  const [objectPath, setObjectPath] = useState<string | null>(null);
  const [fixItems, setFixItems] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [cameraMessage, setCameraMessage] = useState('');
  const [barcodeResult, setBarcodeResult] = useState<EngineLookup | null>(null);
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  useEffect(() => {
    if (!barcode) return;
    let cancelled = false;
    setBarcodeBusy(true); setBarcodeResult(null);
    findSwap({ barcode })
      .then((result) => { if (!cancelled) { setBarcodeResult(result); setCameraMessage(''); } })
      .catch((reason) => { if (!cancelled) setCameraMessage(messageOf(reason)); })
      .finally(() => { if (!cancelled) setBarcodeBusy(false); });
    return () => { cancelled = true; };
  }, [barcode]);
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!cameraActive) return;
    type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
    type DetectorConstructor = new (options?: { formats: string[] }) => Detector;
    const DetectorApi = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    let stream: MediaStream | undefined;
    let frame = 0;
    let stopped = false;
    if (!DetectorApi) {
      setCameraMessage('Barcode scanning is not supported in this browser yet. You can still scan a receipt.');
      setCameraActive(false);
      return;
    }
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const detector = new DetectorApi({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
        const scan = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const [result] = await detector.detect(videoRef.current);
            if (result?.rawValue) {
              setBarcode(result.rawValue);
              setCameraMessage('Got it. Looking for swaps…');
              setCameraActive(false);
              return;
            }
          } catch { /* Keep trying on the next frame. */ }
          frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch (reason) {
        setCameraMessage(messageOf(reason));
        setCameraActive(false);
      }
    };
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [cameraActive]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: getGetReceiptsQueryKey() }), qc.invalidateQueries({ queryKey: getGetProductComparisonsQueryKey() }), qc.invalidateQueries({ queryKey: getGetPurchaseHistoryQueryKey() }), qc.invalidateQueries({ queryKey: getGetFinanceDashboardQueryKey() })]);
  const choose = (selected?: File) => {
    setError(''); setNotice('');
    if (!selected) return;
    if (!['image/jpeg', 'image/png'].includes(selected.type)) { setError('Choose a JPG or PNG photo.'); return; }
    if (selected.size > 10 * 1024 * 1024) { setError('Choose a file under 10 MB.'); return; }
    setFile(selected); setScanResult(null); setObjectPath(null); setFixItems(false);
  };
  const saveReceipt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setNotice('');
    if (!file) { setError('Choose or take a receipt photo first.'); return; }
    try {
      if (!scanResult || !objectPath) {
        const requested = await uploadUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type } });
        // Signed object-storage uploads use their URL's grant, not app cookies.
        await customFetch(requested.uploadURL, { method: 'PUT', credentials: 'omit', headers: { 'Content-Type': file.type }, body: file, responseType: 'text' });
        const result = await scanImage.mutateAsync({ data: { objectPath: requested.objectPath } });
        setObjectPath(requested.objectPath); setScanResult(result);
        if (!result.merchant || !result.items.length) setNotice("I couldn't read every detail. Tap “Fix an item” to correct anything I missed.");
        return;
      }
      const form = new FormData(event.currentTarget);
      const merchant = String(form.get('merchant') || '').trim();
      const purchasedAt = String(form.get('purchasedAt') || '');
      const total = Number(form.get('total'));
      if (!merchant || !purchasedAt || !Number.isFinite(total) || total < 0) { setError('Check the store, date, and total.'); return; }
      const input: ReceiptInput = { merchant, purchasedAt, total, objectPath, items: scanResult.items.filter((item) => item.productName.trim() && item.unitPrice > 0) };
      await create.mutateAsync({ data: input });
      await refresh();
      setFile(null); setScanResult(null); setObjectPath(null); if (fileInput.current) fileInput.current.value = '';
      setNotice("Receipt saved. I'm finding cheaper swaps for each item now. They'll show on the Swaps tab in about a minute.");
    } catch (reason) { setError(messageOf(reason)); }
  };
  const deleteOne = (id: string) => {
    if (!window.confirm('Delete this receipt?')) return;
    remove.mutate({ id }, { onSuccess: () => { void refresh(); }, onError: (reason) => setError(messageOf(reason)) });
  };
  const busy = create.isPending || uploadUrl.isPending || scanImage.isPending;
  const totalYearly = (comparisons.data || []).reduce((sum, item) => sum + Number(item.annualSavings || 0), 0);

  return <div className="m-page">
    <PageTitle title={barcodeMode ? 'Scan a barcode' : 'Receipts'} subtitle={barcodeMode ? 'Check one product before you buy.' : "Snap a receipt and I'll look for cheaper swaps."} />

    {barcodeMode && <section className="m-card m-stack">
      <div className="m-row-icon"><span className="m-sheet-icon blue"><ScanBarcode aria-hidden="true" /></span><span><strong>Point your camera at the barcode</strong><small className="m-muted">Hold it steady inside the frame.</small></span></div>
      {cameraActive ? <><video className="m-video" ref={videoRef} muted playsInline aria-label="Barcode scanner camera" /><button className="m-btn outline" type="button" onClick={() => setCameraActive(false)}>Stop camera</button></>
        : <button className="m-btn navy" type="button" onClick={() => { setCameraMessage(''); setBarcode(''); setCameraActive(true); }}>Open camera</button>}
      {barcodeBusy && <small className="m-muted" role="status">Looking up this product…</small>}
      {cameraMessage && <small className="m-muted" role="status">{cameraMessage}</small>}
    </section>}
    {barcodeMode && barcodeResult && <><EngineResult lookup={barcodeResult} /><p className="m-fine">Product details from <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> and Open Beauty Facts, available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">Open Database License</a>.</p></>}

    <form className="m-card m-stack" onSubmit={saveReceipt}>
      <h2 className="m-h2">{scanResult ? 'Check what I found' : 'Start with a photo'}</h2>
      <label className="m-picker" htmlFor="receipt-photo">
        <input ref={fileInput} id="receipt-photo" type="file" accept="image/jpeg,image/png" capture="environment" onChange={(event) => choose(event.target.files?.[0])} />
        {preview ? <img src={preview} alt="Receipt preview" /> : <span className="m-sheet-icon burgundy"><Upload aria-hidden="true" /></span>}
        <strong>{file?.name || 'Take a photo or upload'}</strong>
        <small className="m-muted">JPG or PNG, up to 10 MB</small>
      </label>
      {scanResult && <>
        <div className="m-fields">
          <label className="full">Store<input className="m-input" name="merchant" defaultValue={scanResult.merchant} placeholder="Store name" required maxLength={120} /></label>
          <label>Date<input className="m-input" name="purchasedAt" type="date" defaultValue={scanResult.purchasedAt || ''} required /></label>
          <label>Total<input className="m-input" name="total" type="number" min="0" step=".01" defaultValue={scanResult.total || ''} required /></label>
        </div>
        <div className="m-list">{scanResult.items.map((item, index) => <div className="m-line pad" key={`${item.productName}-${index}`}>
          {fixItems ? <span className="m-fix">
            <input aria-label={`Fix item ${index + 1}`} className="m-input" defaultValue={item.productName} onChange={(event) => setScanResult((current) => current && ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, productName: event.target.value } : row) }))} />
            <input aria-label={`Fix price ${index + 1}`} className="m-input price" type="number" min="0" step=".01" value={item.unitPrice} onChange={(event) => setScanResult((current) => current && ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: Number(event.target.value) || 0 } : row) }))} />
          </span> : <><span>{item.productName || 'Unclear item'}</span><strong>{cents(item.unitPrice)}</strong></>}
        </div>)}</div>
      </>}
      {error && <div className="m-error" role="alert">{error}</div>}
      {notice && <div className="m-success" role="status">{notice}</div>}
      <button className="m-btn navy" disabled={busy}>{busy ? 'Reading…' : scanResult ? 'Looks right, save it' : 'Read my receipt'}</button>
      {scanResult && <button className="m-link-button" type="button" onClick={() => setFixItems((value) => !value)}>{fixItems ? 'Done fixing' : 'Fix an item'}</button>}
    </form>

    {comparisons.data?.length ? <section className="m-section">
      <div className="m-section-head"><h2>Swaps from your receipts</h2><span className="m-save-tag">{money(totalYearly)}/yr</span></div>
      {comparisons.data.map((item, index) => {
        const art = artFor(`${item.category} ${item.productName}`);
        return <article className="m-card m-receipt-swap" key={`${item.productName}-${index}`}>
          <div className="m-receipt-pair">
            <div><ProductArt art={art} band={bandFor(item.productName)} width={64} label={item.productName} /><small className="m-muted">You bought</small><strong>{item.productName}</strong><span className="m-strike">{cents(item.unitPrice)}</span></div>
            <div className="best"><ProductArt art={art} band={bandFor(item.alternativeName, true)} width={64} label={item.alternativeName} /><small className="burgundy">Cheaper option</small><strong>{item.alternativeName}</strong><span className="m-price">{cents(item.alternativePrice)}</span></div>
          </div>
          <div className="m-line"><span className="m-muted">{item.category} · about {Math.round(item.unitsPerYear)} a year</span><span className="m-save-tag">Save {money(item.annualSavings)}/yr</span></div>
        </article>;
      })}
    </section> : null}

    <section className="m-section">
      <div className="m-section-head"><h2>Saved receipts</h2><span className="m-muted">{query.data?.length || 0}</span></div>
      {query.isLoading ? <div className="m-card"><Skeleton /></div> : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : query.data?.length ? <div className="m-card m-list">
        {query.data.map((receipt) => <div className="m-budget-row" key={receipt.id}>
          <button type="button" className="m-receipt-row" aria-expanded={expanded === receipt.id} onClick={() => setExpanded(expanded === receipt.id ? null : receipt.id)}>
            <span className="m-tx-icon expense">{receipt.objectPath ? <FileImage aria-hidden="true" /> : <ReceiptText aria-hidden="true" />}</span>
            <span className="m-tx-copy"><strong>{receipt.merchant}</strong><small>{dateLabel(receipt.purchasedAt)} · {receipt.items.length} items</small></span>
            <strong>{cents(receipt.total)}</strong>
            <ChevronDown className={expanded === receipt.id ? 'turned' : ''} aria-hidden="true" />
          </button>
          {expanded === receipt.id && <div className="m-budget-detail">
            {receipt.items.length ? receipt.items.map((item, index) => <div className="m-line" key={`${item.productName}-${index}`}><span>{item.productName}</span><span>{cents(item.unitPrice)}</span></div>) : <span className="m-muted">No items were saved with this receipt.</span>}
            <button className="m-link-button danger" onClick={() => deleteOne(receipt.id)}>Delete receipt</button>
          </div>}
        </div>)}
      </div> : <div className="m-card"><EmptyState title="Your receipts will live here" body="Scan one and I'll keep the photo and the swaps together." /></div>}
    </section>
  </div>;
}
