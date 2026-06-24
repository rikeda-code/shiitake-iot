'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MonthShiftData, Destination, Member } from '@/types/shift';
import { DESTINATIONS } from '@/types/shift';

const STORAGE_KEY = 'shift_store';

function loadStore(): Record<string, MonthShiftData> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStore(store: Record<string, MonthShiftData>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function useShiftData(year: number, month: number) {
  const [store, setStore] = useState<Record<string, MonthShiftData>>({});
  const key = monthKey(year, month);

  useEffect(() => {
    setStore(loadStore());
  }, []);

  const shiftData: MonthShiftData = store[key] ?? {};

  const persist = useCallback((nextStore: Record<string, MonthShiftData>) => {
    setStore(nextStore);
    saveStore(nextStore);
  }, []);

  const setCell = useCallback((day: number, dest: Destination, value: Member | 'holiday') => {
    const next = { ...store };
    if (!next[key]) next[key] = {};
    next[key] = { ...next[key], [day]: { ...next[key][day], [dest]: value } };
    persist(next);
  }, [store, key, persist]);

  const toggleHoliday = useCallback((day: number) => {
    const next = { ...store };
    if (!next[key]) next[key] = {};
    const dayData = next[key][day] ?? {};
    const isCurrentlyHoliday = DESTINATIONS.every(d => dayData[d] === 'holiday');
    if (isCurrentlyHoliday) {
      const updated = { ...dayData };
      DESTINATIONS.forEach(d => { updated[d] = '' as Member; });
      next[key] = { ...next[key], [day]: updated };
    } else {
      const updated: Record<string, string> = {};
      DESTINATIONS.forEach(d => { updated[d] = 'holiday'; });
      next[key] = { ...next[key], [day]: updated as MonthShiftData[number] };
    }
    persist(next);
  }, [store, key, persist]);

  const isHoliday = useCallback((day: number): boolean => {
    const dayData = shiftData[day];
    if (!dayData) return false;
    return DESTINATIONS.every(d => dayData[d] === 'holiday');
  }, [shiftData]);

  const getSummary = useCallback(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const result: Record<string, Record<string, number>> = {};
    DESTINATIONS.forEach(dest => {
      result[dest] = { 久保: 0, 古田: 0, 太田: 0, unassigned: 0 };
    });

    for (let d = 1; d <= daysInMonth; d++) {
      const dayData = shiftData[d];
      DESTINATIONS.forEach(dest => {
        const val = dayData?.[dest];
        if (val === 'holiday') return;
        if (val === '久保' || val === '古田' || val === '太田') {
          result[dest][val]++;
        } else {
          result[dest].unassigned++;
        }
      });
    }
    return result;
  }, [shiftData, year, month]);

  const clearMonth = useCallback(() => {
    const next = { ...store };
    delete next[key];
    persist(next);
  }, [store, key, persist]);

  return { shiftData, setCell, toggleHoliday, isHoliday, getSummary, clearMonth };
}
