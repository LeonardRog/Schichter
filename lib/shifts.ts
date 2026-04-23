export interface ShiftInfo {
  title: string;
  startTime: string;
  endTime: string;
  nextDay?: boolean;
  reminder?: boolean;
  bgColor: string;
  textColor: string;
}

export const SHIFTS: Record<string, ShiftInfo> = {
  F: {
    title: 'Frühdienst',
    startTime: '06:00',
    endTime: '14:00',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
  },
  S: {
    title: 'Spätdienst',
    startTime: '14:00',
    endTime: '22:00',
    bgColor: 'bg-orange-100',
    textColor: 'text-orange-800',
  },
  N: {
    title: 'Nachtdienst',
    startTime: '22:00',
    endTime: '06:00',
    nextDay: true,
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-800',
  },
  S1: {
    title: 'Spätdienst S1',
    startTime: '13:00',
    endTime: '21:00',
    reminder: true,
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
  },
};

export function isOff(code: string): boolean {
  const trimmed = code.trim();
  return trimmed === '/' || trimmed === '//' || trimmed === '' || trimmed === '-';
}
