const dateDaysAgo = (days: number) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

export const demoBankActivity = {
  isDemo: true,
  institution: "Aliena sample bank",
  accounts: [
    {
      id: "demo-checking",
      name: "Everyday checking",
      mask: "0842",
      kind: "Checking",
      balance: 3284.16,
    },
    {
      id: "demo-savings",
      name: "Rainy day savings",
      mask: "6017",
      kind: "Savings",
      balance: 9400,
    },
  ],
  transactions: [
    { id: "demo-1", merchant: "Green Market", category: "Groceries", amount: -63.2, date: dateDaysAgo(0), accountId: "demo-checking" },
    { id: "demo-2", merchant: "Juniper Coffee", category: "Dining & coffee", amount: -8.75, date: dateDaysAgo(1), accountId: "demo-checking" },
    { id: "demo-3", merchant: "City Transit", category: "Transportation", amount: -23.5, date: dateDaysAgo(2), accountId: "demo-checking" },
    { id: "demo-4", merchant: "Studio North", category: "Income", amount: 2600, date: dateDaysAgo(3), accountId: "demo-checking" },
    { id: "demo-5", merchant: "Lumen Utilities", category: "Utilities", amount: -84, date: dateDaysAgo(4), accountId: "demo-checking" },
    { id: "demo-6", merchant: "Sunbeam Books", category: "Shopping", amount: -19.5, date: dateDaysAgo(5), accountId: "demo-checking" },
  ],
} as const;
