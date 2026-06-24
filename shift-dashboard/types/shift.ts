export type Member = '久保' | '古田' | '太田' | '';
export type Destination = 'いなべ' | '南丹';

export type MonthShiftData = {
  [day: number]: {
    [dest in Destination]?: Member | 'holiday';
  };
};

export type ShiftStore = {
  [monthKey: string]: MonthShiftData;
};

export const MEMBERS: Member[] = ['久保', '古田', '太田'];
export const DESTINATIONS: Destination[] = ['いなべ', '南丹'];
export const START_YEAR = 2026;
export const START_MONTH = 6;
