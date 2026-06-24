'use client';

import type { MonthShiftData, Destination, Member } from '@/types/shift';
import { DESTINATIONS, MEMBERS } from '@/types/shift';

const MEMBER_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  久保: { bg: '#E6F1FB', text: '#0C447C', border: '#85B7EB' },
  古田: { bg: '#EAF3DE', text: '#27500A', border: '#97C459' },
  太田: { bg: '#FAEEDA', text: '#633806', border: '#EF9F27' },
};

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  year: number;
  month: number;
  shiftData: MonthShiftData;
  isHoliday: (day: number) => boolean;
  setCell: (day: number, dest: Destination, value: Member | 'holiday') => void;
  toggleHoliday: (day: number) => void;
}

export default function ShiftTable({ year, month, shiftData, isHoliday, setCell, toggleHoliday }: Props) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  function getDow(day: number) {
    return new Date(year, month - 1, day).getDay();
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs" style={{ minWidth: `${daysInMonth * 44 + 80}px` }}>
        <thead>
          <tr>
            <th
              className="sticky left-0 bg-white z-10 border border-gray-300 px-2 py-1 text-left"
              style={{ minWidth: 72, fontSize: 13 }}
            >
              行き先
            </th>
            {days.map(day => {
              const dow = getDow(day);
              const isSat = dow === 6;
              const isSun = dow === 0;
              return (
                <th
                  key={day}
                  className="border border-gray-300 text-center cursor-pointer select-none"
                  style={{ minWidth: 44, fontSize: 11 }}
                  onClick={() => toggleHoliday(day)}
                  title="クリックで休日トグル"
                >
                  <div>{day}</div>
                  <div style={{ color: isSat ? '#2563EB' : isSun ? '#DC2626' : undefined }}>
                    {DAY_NAMES[dow]}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {DESTINATIONS.map(dest => (
            <tr key={dest}>
              <td
                className="sticky left-0 bg-white z-10 border border-gray-300 px-2 py-1 font-medium"
                style={{ fontSize: 13 }}
              >
                {dest}
              </td>
              {days.map(day => {
                const holiday = isHoliday(day);
                const val = shiftData[day]?.[dest];
                const member = (val === 'holiday' || val === undefined) ? '' : val as Member;
                const style = member ? MEMBER_STYLE[member] : undefined;

                if (holiday) {
                  return (
                    <td
                      key={day}
                      className="border border-gray-300 text-center text-gray-400 bg-gray-100"
                      style={{ minWidth: 44, fontSize: 12 }}
                    >
                      －
                    </td>
                  );
                }

                return (
                  <td
                    key={day}
                    className="border p-0"
                    style={{
                      minWidth: 44,
                      backgroundColor: style?.bg,
                      borderColor: style?.border ?? '#D1D5DB',
                    }}
                  >
                    <select
                      value={member}
                      onChange={e => setCell(day, dest, e.target.value as Member)}
                      className="w-full h-full border-0 bg-transparent text-center cursor-pointer appearance-none py-1"
                      style={{ fontSize: 12, color: style?.text, minWidth: 44 }}
                    >
                      <option value="">－</option>
                      {MEMBERS.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </td>
                );
              })}
            </tr>
          ))}
          {/* Footer: summary row */}
          <tr className="bg-gray-50">
            <td
              className="sticky left-0 bg-gray-50 z-10 border border-gray-300 px-2 py-1 text-gray-500 text-center"
              style={{ fontSize: 11 }}
            >
              担当
            </td>
            {days.map(day => {
              const holiday = isHoliday(day);
              if (holiday) {
                return (
                  <td key={day} className="border border-gray-300 text-center text-gray-400 bg-gray-100" style={{ fontSize: 11 }}>
                    休
                  </td>
                );
              }
              const members = DESTINATIONS.map(dest => {
                const val = shiftData[day]?.[dest];
                return (val && val !== 'holiday') ? val as string : '';
              }).filter(Boolean);

              return (
                <td key={day} className="border border-gray-300 text-center" style={{ fontSize: 10, lineHeight: '1.2' }}>
                  {members.map((m, i) => (
                    <div key={i} style={{ color: MEMBER_STYLE[m]?.text }}>{m}</div>
                  ))}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
