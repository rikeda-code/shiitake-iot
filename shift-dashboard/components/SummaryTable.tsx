'use client';

import { DESTINATIONS, MEMBERS } from '@/types/shift';

interface Props {
  summary: Record<string, Record<string, number>>;
}

export default function SummaryTable({ summary }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-3 py-1 text-left">行き先</th>
            {MEMBERS.map(m => (
              <th key={m} className="border border-gray-300 px-3 py-1">{m}</th>
            ))}
            <th className="border border-gray-300 px-3 py-1 text-gray-500">未割当</th>
          </tr>
        </thead>
        <tbody>
          {DESTINATIONS.map(dest => (
            <tr key={dest}>
              <td className="border border-gray-300 px-3 py-1 font-medium">{dest}</td>
              {MEMBERS.map(m => (
                <td key={m} className="border border-gray-300 px-3 py-1 text-center">
                  {summary[dest]?.[m] ?? 0}
                </td>
              ))}
              <td className="border border-gray-300 px-3 py-1 text-center text-gray-500">
                {summary[dest]?.unassigned ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
