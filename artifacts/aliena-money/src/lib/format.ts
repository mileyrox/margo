export const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0));

export const cents = (value: number | null | undefined) =>
  value == null ? 'Price unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export const dateLabel = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

export const shortDate = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
};

/** True when a YYYY-MM-DD date is within the last `days` days (today counts). */
export const withinDays = (value: string, days: number) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (days - 1));
  return date >= start;
};

export const today = () => new Date().toISOString().slice(0, 10);

export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const messageOf = (error: unknown) => {
  if (!(error instanceof Error)) return 'Something went wrong. Try again.';
  // API errors arrive as "HTTP 503 Service Unavailable: <reason>"; show people just the reason.
  const reason = error.message.replace(/^HTTP \d{3}[^:]*:\s*/, '').trim();
  if (/^HTTP \d{3}/.test(reason) || !reason) return error.message.startsWith('HTTP 401') ? 'Please sign in again.' : 'Something went wrong. Try again.';
  return reason;
};

export const parseList = (value: string | undefined): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
};
