import { useMemo, useState } from 'react';
import { useGetDashboardQuery } from '../../api/dnApi.js';
import { HomeSummaryContext } from './useHomeSummary.js';

/**
 * One dashboard request for the whole Home page. The trend, the vendor card and the lots summary each
 * pick their own period; all three go in the same request, so Home asks once every two minutes
 * instead of once per card (choosing a period refetches the one summary).
 */
export function HomeSummaryProvider({ children }) {
  const [periods, setPeriods] = useState({ trendDays: 30, glanceDays: 30, vendorDays: 90 });
  const { data } = useGetDashboardQuery(periods, { pollingInterval: 120_000 });
  const value = useMemo(() => ({
    s: data,
    periods,
    setPeriod: (key, days) => setPeriods((p) => ({ ...p, [key]: days })),
  }), [data, periods]);
  return <HomeSummaryContext.Provider value={value}>{children}</HomeSummaryContext.Provider>;
}
