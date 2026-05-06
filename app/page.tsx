'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SHIFTS, isOff } from '@/lib/shifts';

interface ShiftData {
  employee: string;
  month: string;
  shifts: Record<string, string>;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      const saved = sessionStorage.getItem('schichtplan_data');
      if (saved) {
        setShiftData(JSON.parse(saved));
        setStep(3);
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
      if (file && file.type.startsWith('image/')) handleFileChange(file);
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
    sessionStorage.removeItem('schichtplan_data');
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
                accept="image/*"
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

        {/* ─── Step 2: Preview ────────────────────────────────── */}
        {step === 2 && shiftData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-lg text-slate-800">{shiftData.employee}</h2>
              <p className="text-slate-500 text-sm">{getMonthName(shiftData.month)}</p>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(SHIFTS).map(([code, info]) => (
                <span
                  key={code}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium ${info.bgColor} ${info.textColor}`}
                >
                  {code} &ndash; {info.title}
                </span>
              ))}
            </div>

            {/* Shift list */}
            <div className="space-y-1.5 max-h-72 overflow-y-auto -mx-1 px-1">
              {Array.from({ length: getDaysInMonth(shiftData.month) }, (_, i) => i + 1).map((day) => {
                const code = shiftData.shifts[day.toString()] ?? '/';
                if (isOff(code)) return null;
                const shift = SHIFTS[code.toUpperCase()];
                if (!shift) return null;
                return (
                  <div
                    key={day}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl ${shift.bgColor}`}
                  >
                    <span className="text-slate-600 text-sm font-medium">
                      {getDayLabel(shiftData.month, day)}&nbsp;{day}.
                    </span>
                    <span className={`text-sm font-semibold ${shift.textColor}`}>
                      {shift.title} &bull; {shift.startTime}&#8211;{shift.endTime}
                      {shift.reminder && (
                        <span className="ml-1 text-xs bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded-full">
                          Erinnerung
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="text-center text-slate-500 text-sm">
              {countShifts(shiftData)} Schichten gefunden
            </p>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setStep(1); setShiftData(null); }}
                className="flex-1 py-3 border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors"
              >
                Zurück
              </button>
              <button
                onClick={() => (isAuthenticated ? setStep(3) : connectGoogle())}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 active:scale-[.98] transition-all"
              >
                Weiter
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 3: Calendar ───────────────────────────────── */}
        {step === 3 && shiftData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">
            {addedCount !== null ? (
              <div className="text-center space-y-4 py-6">
                <div className="text-6xl">&#x2705;</div>
                <h2 className="font-semibold text-xl text-slate-800">Fertig!</h2>
                <p className="text-slate-600">
                  <span className="font-bold text-blue-600">{addedCount} Schichten</span> wurden zu
                  deinem Google Kalender hinzugefügt.
                </p>
                <button
                  onClick={reset}
                  className="w-full py-3 border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors"
                >
                  Neuen Dienstplan einlesen
                </button>
              </div>
            ) : (
              <>
                <div>
                  <h2 className="font-semibold text-lg text-slate-800">Zu Google Kalender hinzufügen</h2>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 space-y-1">
                  <p className="font-medium text-slate-800">{shiftData.employee}</p>
                  <p className="text-slate-500 text-sm">{getMonthName(shiftData.month)}</p>
                  <p className="text-slate-500 text-sm">{countShifts(shiftData)} Schichten</p>
                </div>

                {!isAuthenticated ? (
                  <button
                    onClick={connectGoogle}
                    className="w-full py-3.5 bg-white border-2 border-slate-200 text-slate-700 rounded-xl font-semibold hover:border-slate-300 hover:bg-slate-50 active:scale-[.98] transition-all flex items-center justify-center gap-2.5"
                  >
                    <GoogleIcon />
                    Mit Google verbinden
                  </button>
                ) : (
                  <button
                    onClick={addToCalendar}
                    disabled={isAddingEvents}
                    className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isAddingEvents ? (
                      <span className="flex items-center justify-center gap-2">
                        <Spinner />
                        Füge Schichten hinzu...
                      </span>
                    ) : (
                      'Zum Kalender hinzufügen'
                    )}
                  </button>
                )}

                <button
                  onClick={() => setStep(2)}
                  className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors"
                >
                  &larr; Zurück zur Vorschau
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
