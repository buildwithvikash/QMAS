import { Loader2, Mic, Sparkles, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useGetAiStatusQuery, useTidyObservationMutation } from '../../api/aiApi.js';
import { apiError } from '../../utils/apiError.js';

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition ?? window.webkitSpeechRecognition : null;

/**
 * Dictation for inspection text: the browser's speech recognition (Indian English) writes what the
 * inspector says; `onText` receives the text to add. With AI set up, "Tidy" turns the dictated text
 * into clean inspection wording (numbers as digits, units) before it is added. Hidden where the
 * browser has no speech recognition (it needs Chrome or Edge, and a secure address).
 */
export default function VoiceButton({ onText, context = {}, className = '' }) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const rec = useRef(null);
  const { data: ai } = useGetAiStatusQuery();
  const [tidy, { isLoading: tidying }] = useTidyObservationMutation();
  useEffect(() => () => rec.current?.abort(), []);
  if (!Recognition) return null;

  const start = () => {
    const r = new Recognition();
    r.lang = 'en-IN';
    r.interimResults = true;
    r.continuous = true;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        if (e.results[i].isFinal) finalText += `${e.results[i][0].transcript} `;
        else interim += e.results[i][0].transcript;
      }
      setHeard(`${finalText}${interim}`.trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed') toast.error('Allow the microphone for this site to dictate.');
      else if (e.error !== 'aborted' && e.error !== 'no-speech') toast.error('Dictation stopped. Check the microphone and connection.');
      setListening(false);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setHeard('');
    r.start();
    setListening(true);
  };
  const stop = () => rec.current?.stop();

  const use = async (withAi) => {
    let text = heard.trim();
    if (!text) return;
    if (withAi) {
      try {
        text = (await tidy({ text, ...context }).unwrap()).text;
      } catch (err) {
        toast.error(apiError(err).message);
        return;
      }
    }
    onText(text);
    setHeard('');
  };

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <button type="button" onClick={listening ? stop : start} title={listening ? 'Stop dictation' : 'Dictate'} aria-label={listening ? 'Stop dictation' : 'Dictate'}
        className={`inline-flex items-center gap-1 h-7 px-2 rounded-md border text-[11px] font-medium cursor-pointer ${listening ? 'border-rose-300 bg-rose-50 text-rose-700 animate-pulse' : 'border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-700'}`}>
        {listening ? <Square className="w-3 h-3" /> : <Mic className="w-3.5 h-3.5" />}{listening ? 'Stop' : 'Speak'}
      </button>
      {heard && !listening && (
        <>
          <span className="max-w-56 truncate text-[11px] italic text-slate-500" title={heard}>“{heard}”</span>
          <button type="button" onClick={() => use(false)} className="h-7 px-2 rounded-md bg-slate-100 text-[11px] font-medium text-slate-700 hover:bg-slate-200 cursor-pointer">Add</button>
          {ai?.configured && (
            <button type="button" onClick={() => use(true)} disabled={tidying} className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-violet-50 text-[11px] font-medium text-violet-800 hover:bg-violet-100 cursor-pointer disabled:opacity-60">
              {tidying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Tidy &amp; add
            </button>
          )}
        </>
      )}
      {listening && heard && <span className="max-w-56 truncate text-[11px] text-slate-500">{heard}</span>}
    </span>
  );
}
