import { createContext, useContext } from 'react';

export const HomeSummaryContext = createContext(null);

/** { s: the summary (undefined while loading), periods, setPeriod(key, days) }; see HomeSummaryProvider. */
export function useHomeSummary() {
  const v = useContext(HomeSummaryContext);
  if (!v) throw new Error('useHomeSummary needs HomeSummaryProvider');
  return v;
}
