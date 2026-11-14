import { useLocation } from 'wouter';

/*
 * "Scan a receipt" opens the phone camera right away. Browsers only open the camera from the tap itself,
 * so the tap clicks this hidden photo input directly. The photo is handed to the Receipts page, which reads it at once.
 */
let input: HTMLInputElement | null = null;
let pending: File | null = null;
export const RECEIPT_EVENT = 'margo-receipt-photo';

/** The photo just taken, if any (only handed out once). */
export function takeReceiptPhoto() { const file = pending; pending = null; return file; }

/** Call from a tap. Falls back to the Receipts page if the hidden input isn't there. */
export function openReceiptCamera(fallback: () => void) {
  if (input) input.click(); else fallback();
}

/** Mounted once in the app shell. */
export function ReceiptCameraInput() {
  const [, setLocation] = useLocation();
  return <input ref={(el) => { input = el; }} type="file" accept="image/jpeg,image/png" capture="environment" hidden aria-hidden="true" tabIndex={-1}
    onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      pending = file;
      setLocation('/receipts?scan=receipt');
      window.dispatchEvent(new Event(RECEIPT_EVENT));
    }} />;
}
