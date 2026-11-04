// Dollar amounts never leave the quote: they are removed before anything is stored.
export const stripMoney = (t) => String(t || "").replace(/\$\s?[\d,]+(\.\d+)?/g, "$[removed]");
