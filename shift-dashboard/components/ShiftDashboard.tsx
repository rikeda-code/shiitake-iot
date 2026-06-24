'use client';

import { useState, useMemo } from 'react';
import { START_YEAR, START_MONTH } from '@/types/shift';
import { useShiftData } from '@/hooks/useShiftData';
import ShiftTable from './ShiftTable';
import SummaryTable from './SummaryTable';
import PdfExportButton from './PdfExportButton';

export default function ShiftDashboard() {
  const [year, setYear] = useState(START_YEAR);
  const [month, setMonth] = useState(START_MONTH);

  const { shiftData, setCell, toggleHoliday, isHoliday, getSummary } = useShiftData(year, month);
  const summary = useMemo(() => getSummary(), [getSummary]);

  const isAtStart = year === START_YEAR && month === START_MONTH;

  const prevMonth = () => {
    if (isAtStart) return;
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  return (
    <div id="shift-export-area" className="p-6 bg-white min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            disabled={isAtStart}
            className="px-3 py-1 border border-gray-300 rounded disabled:opacity-30 hover:bg-gray-50 text-lg"
          >
            ◀
          </button>
          <h1 className="text-xl font-bold">{year}年{month}月</h1>
          <button
            onClick={nextMonth}
            className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 text-lg"
          >
            ▶
          </button>
        </div>
        <PdfExportButton year={year} month={month} />
      </div>

      {/* Summary */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-600 mb-2">行き先別 担当回数</h2>
        <SummaryTable summary={summary} />
      </div>

      {/* Shift Table */}
      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">シフト表（日付ヘッダーをクリックで休日トグル）</h2>
        <ShiftTable
          year={year}
          month={month}
          shiftData={shiftData}
          isHoliday={isHoliday}
          setCell={setCell}
          toggleHoliday={toggleHoliday}
        />
      </div>
    </div>
  );
}
