import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  Landmark,
} from 'lucide-react';
import KnowledgeGraph3D from '../components/KnowledgeGraph3D';

export default function Landing() {
  const navigate = useNavigate();
  const scrollTrackRef = useRef(null);
  const progressBarRef = useRef(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    let ticking = false;

    const updateScroll = () => {
      const track = scrollTrackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const total = track.offsetHeight - window.innerHeight;
      if (total <= 0) return;

      const progress = Math.max(0, Math.min(1, -rect.top / total));

      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${progress * 100}%`;
      }

      setScrollProgress(progress);
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateScroll);
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    updateScroll();

    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const jumpTo = (target) => {
    const track = scrollTrackRef.current;
    if (!track) return;
    const total = track.offsetHeight - window.innerHeight;
    window.scrollTo({ top: track.offsetTop + target * total, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans antialiased selection:bg-slate-900 selection:text-white">
      {/* 1. TOP NAV */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
              <Landmark size={16} className="text-amber-400" />
            </div>
            <span className="font-bold text-slate-900 text-sm tracking-tight">ps_banks</span>
          </div>

          <button
            onClick={() => navigate('/login')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm transition-transform active:scale-95"
          >
            <span>Launch App</span>
            <ArrowRight size={13} />
          </button>
        </div>
      </header>

      {/* 2. HERO */}
      <section className="pt-32 pb-8 px-6 max-w-3xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight">
          Stop bank attrition <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-600 via-amber-600 to-emerald-700">
            before it happens.
          </span>
        </h1>
        <p className="mt-3 text-slate-500 text-sm sm:text-base max-w-md mx-auto">
          3D interactive resolution of customer and institutional friction.
        </p>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs font-mono text-slate-400">
          <ChevronDown size={14} className="animate-bounce text-slate-600" />
          <span>Scroll to explore</span>
        </div>
      </section>

      {/* 3. TALL 3D TRACK */}
      <div ref={scrollTrackRef} className="relative h-[400vh] w-full">
        <div className="sticky top-0 h-screen w-full overflow-hidden bg-white">
          <KnowledgeGraph3D scrollProgress={scrollProgress} />

          {/* LEFT SLIM ACTION DOCK */}
          <aside className="absolute left-6 top-24 z-20 w-56 pointer-events-none">
            <div className="pointer-events-auto bg-white/95 rounded-2xl border border-slate-200/90 p-3.5 shadow-xl space-y-3">
              <button
                onClick={() => navigate('/login')}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold shadow hover:bg-slate-800 transition-colors group"
              >
                <span className="flex items-center gap-2">
                  <Landmark size={14} className="text-amber-400" />
                  <span>Open Console</span>
                </span>
                <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
              </button>

              <div>
                <div className="w-full h-1 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    ref={progressBarRef}
                    className="h-full bg-gradient-to-r from-orange-600 via-amber-500 to-emerald-600 will-change-[width]"
                    style={{ width: `${scrollProgress * 100}%` }}
                  />
                </div>
                <div className="flex justify-between items-center mt-2 text-[10px] font-mono text-slate-400">
                  <button onClick={() => jumpTo(0.0)} className="hover:text-slate-900">
                    01
                  </button>
                  <button onClick={() => jumpTo(0.3)} className="hover:text-slate-900">
                    02
                  </button>
                  <button onClick={() => jumpTo(0.55)} className="hover:text-amber-700 font-bold">
                    Fix ⚡
                  </button>
                  <button onClick={() => jumpTo(0.85)} className="hover:text-emerald-700 font-bold">
                    Core
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* 4. CLEAN MINIMAL CLOSER */}
      <section className="py-20 px-6 max-w-4xl mx-auto border-t border-slate-100 text-center">
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
          Precision Banking Intelligence
        </h2>
        <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
          Live machine learning, automated compliance, and real-time retention.
        </p>

        <div className="mt-8">
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-md transition-transform active:scale-95 inline-flex items-center gap-2"
          >
            <span>Launch Console Now</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </section>

      {/* 5. FOOTER */}
      <footer className="border-t border-slate-100 py-6 px-6 text-center text-[11px] font-mono text-slate-400">
        ps_banks &bull; localhost:5173
      </footer>
    </div>
  );
}
