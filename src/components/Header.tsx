import React from 'react';
import { Menu, ChevronDown } from 'lucide-react';

interface HeaderProps {
  setCurrentPage: (page: any) => void;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  setShowProfileModal: (show: boolean) => void;
  currentUser: any;
}

export const Header: React.FC<HeaderProps> = ({
  setCurrentPage,
  dropdownOpen,
  setDropdownOpen,
  setShowProfileModal,
  currentUser,
}) => {
  return (
    <header className="px-4 md:px-6 py-4 border-b border-[var(--color-border)] shrink-0 select-none safe-pt bg-transparent">
      <div className="flex items-center justify-between w-[94%] sm:w-full mx-auto">
        <div className="flex items-center gap-3">
          {/* Top Left: Hamburger Menu Trigger */}
          <button 
            id="hamburger-sidebar-toggle"
            onClick={() => setCurrentPage('dashboard')}
            className="p-2.5 -ml-2 rounded-xl text-[var(--color-text)] hover:bg-[var(--color-border)] active:scale-95 transition-all cursor-pointer"
            title="Open Dashboard"
          >
            <Menu className="w-5.1 h-5.1" />
          </button>

          <div className="relative">
            {/* Top Left Text: Boeki App name */}
            <button 
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 text-lg font-sans font-extrabold tracking-tight text-[var(--color-text)] hover:opacity-80 active:scale-95 transition-all text-left"
            >
              <div className="flex flex-col text-left">
                <span className="text-sm font-comfortaa font-black text-[var(--color-text)] tracking-wider">BOEKI</span>
                <span className="text-[8px] font-mono font-bold tracking-widest text-[#F95C4B] uppercase">Quant Core</span>
              </div>
              <ChevronDown className="w-4 h-4 text-[var(--color-subtext)] ml-1 shrink-0" />
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)}></div>
                <div className="absolute top-full left-0 mt-2.5 w-52 rounded-2xl bg-[var(--color-card)] border border-[var(--color-border)] p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-top-1">
                  <div className="px-3 py-1.5 text-[9px] font-mono text-[var(--color-subtext)] uppercase tracking-widest border-b border-[var(--color-border)] font-bold">Selected Agent</div>
                  <button 
                    onClick={() => { setDropdownOpen(false); }}
                    className="w-full text-left px-3.5 py-2.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)] rounded-xl flex items-center gap-2 mt-1 font-semibold"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-550"></span>
                    <span>Boeki Quant Core</span>
                  </button>
                  <button 
                    onClick={() => { setDropdownOpen(false); }}
                    className="w-full text-left px-3.5 py-2.5 text-xs text-[var(--color-text)]/40 hover:bg-[var(--color-border)] rounded-xl flex items-center gap-2 cursor-not-allowed mt-1"
                    disabled
                  >
                    <span className="w-2 h-2 rounded-full bg-black/20"></span>
                    <span>Multi-Agent Mesh (Soon)</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Custom System Active Indicator */}
        <div className="hidden sm:flex items-center gap-2 bg-zinc-950/40 px-3.5 py-1.5 rounded-xl border border-[var(--color-border)] select-none">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-wider">AI Comparison Core Active</span>
        </div>

        {/* Top Right: Profile badge to maintain layout balance */}
        <button 
          onClick={() => setShowProfileModal(true)}
          title="Profile Management"
          className="w-8 h-8 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] text-[11px] font-black text-[var(--color-text)] flex items-center justify-center font-mono shadow-sm overflow-hidden shrink-0 cursor-pointer hover:scale-105 hover:border-[var(--color-text)] transition-all duration-200"
        >
          {currentUser?.photoURL ? (
            <img src={currentUser.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span>
              {(currentUser?.displayName || 'Manasseh')[0].toUpperCase()}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};

export default Header;
