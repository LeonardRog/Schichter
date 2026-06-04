'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SHIFTS, isOff } from '@/lib/shifts';

interface ShiftData {
  employee: string;
  month: string;
  shifts: Record<string, string>;
}

interface CalendarEvent {
  day: string;
  eventId: string;
  code: string;
}

type Step = 1 | 2 | 3;

export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [lastName, setLastName] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [shiftData, setShiftData] = useState<ShiftData | null>(null);
  const [error, setError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAddingEvents, setIsAddingEvents] = useState(false);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [updatingDay, setUpdatingDay] = useState<string | null>(null);
  const [shouldAutoAdd, setShouldAutoAdd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      const saved = sessionStorage.getItem('schichtplan_data');
      if (saved) {
        setShiftData(JSON.parse(saved));
        setStep(3);
        setShouldAutoAdd(true);
      }
      setIsAuthenticated(true);
      window.history.replaceState({}, '', '/');
    }
    if (params.get('error') === 'auth_failed') {
      setError('Google-Anmeldung fehlgeschlagen. Bitte versuche es erneut.');
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const handleFileChange = useCallback((file: File) => {
    setImage(file);
    setImagePreview(URL.createObjectURL(file));
    setError('');
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileChange(file);
    },
    [handleFileChange]
  );

  const analyze = async () => {
    if (!image || !lastName.trim()) {
      setError('Bitte Bild und Nachnamen eingeben.');
      return;
    }
    setIsAnalyzing(true);
    setError('');
    const formData = new FormData();
    formData.append('image', image);
    formData.append('lastName', lastName.trim());
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 65_000);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setShiftData(data);
        setStep(2);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Die Analyse hat zu lange gedauert. Bitte ein kleineres oder klareres Foto verwenden.');
      } else {
        setError('Analysefehler. Bitte versuche es erneut.');
      }
    } finally {
      clearTimeout(timeoutId);
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (shouldAutoAdd && isAuthenticated && step === 3 && addedCount === null && !isAddingEvents) {
      setShouldAutoAdd(false);
      addToCalendar();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoAdd, isAuthenticated, step]);

  const updateLocalShift = (day: string, newCode: string) => {
    if (!shiftData) return;
    setShiftData({ ...shiftData, shifts: { ...shiftData.shifts, [day]: newCode } });
    setEditingDay(null);
  };

  const confirmAndAdd = () => {
    setEditingDay(null);
    if (!isAuthenticated) {
      connectGoogle();
      return;
    }
    setStep(3);
    setShouldAutoAdd(true);
  };

  const connectGoogle = () => {
    if (shiftData) {
      sessionStorage.setItem('schichtplan_data', JSON.stringify(shiftData));
    }
    window.location.href = '/api/auth/google';
  };

  const addToCalendar = async () => {
    if (!shiftData) return;
    setIsAddingEvents(true);
    setError('');
    try {
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftData }),
      });
      if (res.status === 401) {
        setIsAuthenticated(false);
        setError('Sitzung abgelaufen. Bitte erneut mit Google verbinden.');
        return;
      }
      const data = await res.json();
      setAddedCount(data.addedCount);
      setCalendarEvents(data.events ?? []);
    } catch {
      setError('Fehler beim Hinzufügen. Bitte versuche es erneut.');
    } finally {
      setIsAddingEvents(false);
    }
  };

  const reset = () => {
    setStep(1);
    setImage(null);
    setImagePreview('');
    setLastName('');
    setShiftData(null);
    setError('');
    setIsAuthenticated(false);
    setAddedCount(null);
    setCalendarEvents([]);
    setEditingDay(null);
    setUpdatingDay(null);
    sessionStorage.removeItem('schichtplan_data');
  };

  const updateShift = async (day: string, eventId: string, newCode: string) => {
    if (!shiftData) return;
    setUpdatingDay(day);
    setError('');
    try {
      const res = await fetch('/api/calendar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, newCode, day, month: shiftData.month }),
      });
      if (res.ok) {
        setCalendarEvents((prev) => prev.map((e) => (e.day === day ? { ...e, code: newCode } : e)));
        setEditingDay(null);
      } else {
        setError('Fehler beim Aktualisieren der Schicht.');
      }
    } catch {
      setError('Fehler beim Aktualisieren der Schicht.');
    } finally {
      setUpdatingDay(null);
    }
  };

  const getDaysInMonth = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo, 0).getDate();
  };

  const getMonthName = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  };

  const getDayLabel = (m: string, day: number) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, day).toLocaleDateString('de-DE', { weekday: 'short' });
  };

  const countShifts = (data: ShiftData) =>
    Object.values(data.shifts).filter((c) => !isOff(c) && SHIFTS[c.toUpperCase()]).length;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-lg mx-auto px-4 py-8 pb-16">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Schichtplan</h1>
          <p className="text-slate-500 mt-1 text-sm">Dienstplan-Foto &rarr; Google Kalender</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center mb-8">
          {(['Hochladen', 'Prüfen', 'Kalender'] as const).map((label, i) => {
            const s = (i + 1) as Step;
            const active = step >= s;
            return (
              <div key={s} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                      active ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-200 text-slate-400'
                    }`}
                  >
                    {s}
                  </div>
                  <span className={`text-xs mt-1 ${active ? 'text-blue-600 font-medium' : 'text-slate-400'}`}>
                    {label}
                  </span>
                </div>
                {s < 3 && (
                  <div
                    className={`w-16 h-0.5 mb-4 mx-1 transition-colors ${step > s ? 'bg-blue-600' : 'bg-slate-200'}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-start gap-2">
            <span className="mt-0.5 shrink-0">&#x26A0;</span>
            <span>{error}</span>
          </div>
        )}

        {/* ─── Step 1: Upload ─────────────────────────────────── */}
        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">
            <h2 className="font-semibold text-lg text-slate-800">Dienstplan hochladen</h2>

            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors select-none ${
                imagePreview
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileChange(f);
                }}
              />
              {imagePreview ? (
                <div className="space-y-2">
                  <img
                    src={imagePreview}
                    alt="Dienstplan"
                    className="max-h-52 mx-auto rounded-lg object-contain"
                  />
                  <p className="text-blue-600 text-sm font-medium">Tippen zum Ändern</p>
                </div>
              ) : (
                <div className="space-y-3 py-4">
                  <div className="text-5xl">&#x1F4CB;</div>
                  <div>
                    <p className="text-slate-700 font-medium">Foto hier ablegen</p>
                    <p className="text-slate-400 text-sm mt-1">oder tippen zum Auswählen / Fotografieren</p>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Dein Nachname
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && analyze()}
                placeholder="z.B. Müller"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 placeholder:text-slate-400"
              />
            </div>

            <button
              onClick={analyze}
              disabled={isAnalyzing || !image || !lastName.trim()}
              className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isAnalyzing ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner />
                  Analysiere Dienstplan...
                </span>
              ) : (
                'Analysieren'
              )}
            </button>
          </div>
        )}

        {/* ─── Step 2: Edit & Confirm ─────────────────────────── */}
        {step === 2 && shiftData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-lg text-slate-800">{shiftData.employee}</h2>
              <p className="text-slate-500 text-sm">{getMonthName(shiftData.month)}</p>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(SHIFTS).map(([code, info]) => (
                <span key={code} className={`text-xs px-2.5 py-1 rounded-full font-medium ${info.bgColor} ${info.textColor}`}>
                  {code} &ndash; {info.title}
                </span>
              ))}
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-slate-100 text-slate-400">
                / &ndash; Frei
              </span>
            </div>

            <p className="text-xs text-slate-400">Tippe auf einen Tag, um die Schicht zu korrigieren.</p>

            {/* All days — editable */}
            <div className="space-y-1 max-h-[22rem] overflow-y-auto -mx-1 px-1">
              {Array.from({ length: getDaysInMonth(shiftData.month) }, (_, i) => i + 1).map((day) => {
                const rawCode = shiftData.shifts[day.toString()] ?? '/';
                const dayOff = isOff(rawCode);
                const code = dayOff ? '/' : rawCode.toUpperCase();
                const shift = dayOff ? null : SHIFTS[code];
                const bgColor = shift?.bgColor ?? 'bg-slate-50';
                const textColor = shift?.textColor ?? 'text-slate-400';
                const isEditing = editingDay === day.toString();

                return (
                  <div key={day} className="rounded-xl border border-slate-100 overflow-hidden">
                    <button
                      onClick={() => setEditingDay(isEditing ? null : day.toString())}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left transition-colors ${bgColor}`}
                    >
                      <span className="text-slate-600 text-sm font-medium">
                        {getDayLabel(shiftData.month, day)}&nbsp;{day}.
                      </span>
                      <span className={`text-sm font-semibold flex items-center gap-1.5 ${textColor}`}>
                        {dayOff ? (
                          <span className="opacity-40">/</span>
                        ) : (
                          <>
                            {code}
                            {shift && !shift.allDay && (
                              <span className="text-xs font-normal opacity-60">{shift.startTime}&#8211;{shift.endTime}</span>
                            )}
                          </>
                        )}
                        <svg className="w-3.5 h-3.5 opacity-30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828A2 2 0 0110 16.414H8v-2a2 2 0 01.586-1.414z" />
                        </svg>
                      </span>
                    </button>

                    {isEditing && (
                      <div className="flex gap-2 p-2.5 bg-slate-50 border-t border-slate-100 flex-wrap">
                        {Object.entries(SHIFTS).map(([c, info]) => (
                          <button
                            key={c}
                            onClick={() => updateLocalShift(day.toString(), c)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${info.bgColor} ${info.textColor} ${c === code && !dayOff ? 'ring-2 ring-offset-1 ring-slate-400' : 'opacity-70 hover:opacity-100'}`}
                          >
                            {c}
                          </button>
                        ))}
                        <button
                          onClick={() => updateLocalShift(day.toString(), '/')}
                          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all bg-slate-100 text-slate-500 ${dayOff ? 'ring-2 ring-offset-1 ring-slate-400' : 'opacity-70 hover:opacity-100'}`}
                        >
                          /
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-center text-slate-500 text-sm">
              {countShifts(shiftData)} Schichten
            </p>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setStep(1); setShiftData(null); setEditingDay(null); }}
                className="flex-none py-3 px-4 border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors"
              >
                Zurück
              </button>
              <button
                onClick={confirmAndAdd}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 active:scale-[.98] transition-all text-sm leading-tight"
              >
                Alle korrekt &rarr; In Kalender eintragen
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 3: Calendar ───────────────────────────────── */}
        {step === 3 && shiftData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">
            {addedCount !== null ? (
              /* ── Success ── */
              <div className="space-y-5 py-2">
                <div className="text-center space-y-2">
                  <div className="text-6xl">&#x2705;</div>
                  <h2 className="font-semibold text-xl text-slate-800">Fertig!</h2>
                  <p className="text-slate-600">
                    <span className="font-bold text-blue-600">{addedCount} Schichten</span> wurden zu
                    deinem Google Kalender hinzugefügt.
                  </p>
                </div>

                {calendarEvents.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-0.5">
                      Nachträglich korrigieren
                    </p>
                    <div className="max-h-72 overflow-y-auto space-y-1 -mx-1 px-1">
                      {[...calendarEvents]
                        .sort((a, b) => parseInt(a.day, 10) - parseInt(b.day, 10))
                        .map(({ day, eventId, code: currentCode }) => {
                          const shift = SHIFTS[currentCode.toUpperCase()];
                          const isEditing = editingDay === day;
                          const isUpdating = updatingDay === day;
                          return (
                            <div key={day} className="rounded-xl border border-slate-200 overflow-hidden">
                              <button
                                onClick={() => setEditingDay(isEditing ? null : day)}
                                disabled={isUpdating}
                                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left transition-colors ${shift?.bgColor ?? 'bg-slate-50'} disabled:opacity-60`}
                              >
                                <span className="text-slate-700 text-sm font-medium">
                                  {getDayLabel(shiftData.month, parseInt(day, 10))}&nbsp;{day}.
                                </span>
                                <span className={`text-sm font-semibold flex items-center gap-1.5 ${shift?.textColor ?? 'text-slate-600'}`}>
                                  {isUpdating && <Spinner />}
                                  {currentCode.toUpperCase()}
                                  {!isUpdating && (
                                    <svg className="w-3.5 h-3.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828A2 2 0 0110 16.414H8v-2a2 2 0 01.586-1.414z" />
                                    </svg>
                                  )}
                                </span>
                              </button>
                              {isEditing && (
                                <div className="flex gap-2 p-2.5 bg-slate-50 border-t border-slate-100 flex-wrap">
                                  {Object.entries(SHIFTS).map(([code, info]) => (
                                    <button
                                      key={code}
                                      disabled={isUpdating}
                                      onClick={() => updateShift(day, eventId, code)}
                                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${info.bgColor} ${info.textColor} ${code === currentCode.toUpperCase() ? 'ring-2 ring-offset-1 ring-slate-400' : 'opacity-70 hover:opacity-100'} disabled:opacity-30`}
                                    >
                                      {code}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                <button
                  onClick={reset}
                  className="w-full py-3 border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors"
                >
                  Neuen Dienstplan einlesen
                </button>
              </div>
            ) : (
              /* ── Loading ── */
              <div className="py-10 flex flex-col items-center gap-4">
                <Spinner size="lg" />
                <p className="text-slate-500 text-sm">Füge Schichten zum Kalender hinzu…</p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Spinner({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'h-10 w-10 text-blue-500' : 'h-5 w-5';
  return (
    <svg className={`animate-spin ${cls}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
