/** Percent change of this month against last month, or null when last month had nothing. */
export const monthTrend = (thisMonth, lastMonth) => (lastMonth ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null);
