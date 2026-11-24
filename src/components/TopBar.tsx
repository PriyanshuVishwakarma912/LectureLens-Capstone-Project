import { LogIn, LogOut, User as UserIcon } from 'lucide-react';
import type { User } from '../lib/firebase';

export type ActiveView = 'workspace' | 'library' | 'guide';

interface TopBarProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  user: User | null;
  authReady: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  libraryCount: number;
}

export function TopBar({
  activeView,
  onNavigate,
  user,
  authReady,
  onSignIn,
  onSignOut,
  libraryCount,
}: TopBarProps) {
  return (
    <header className="no-print sticky top-0 z-30 bg-[#F8FAFC]/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-[1380px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('workspace')}
          className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 hover:text-sky-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded"
        >
          LectureLens
        </button>

        {/* Zone 2: Concise Single-Line Navigation */}
        <nav
          aria-label="Primary navigation"
          className="hidden sm:flex items-center gap-7 text-sm font-medium"
        >
          <button
            type="button"
            onClick={() => onNavigate('workspace')}
            className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
              activeView === 'workspace'
                ? 'text-slate-900 border-sky-600'
                : 'text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            Workspace
          </button>
          <button
            type="button"
            onClick={() => onNavigate('library')}
            className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
              activeView === 'library'
                ? 'text-slate-900 border-sky-600'
                : 'text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            Study Library{user && libraryCount > 0 ? ` (${libraryCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('guide')}
            className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
              activeView === 'guide'
                ? 'text-slate-900 border-sky-600'
                : 'text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            How It Works
          </button>
        </nav>

        {/* Zone 3: Single Primary Account Action */}
        <div className="flex items-center gap-3 shrink-0">
          {!authReady ? (
            <div className="h-9 w-28 rounded-lg bg-slate-200/70 animate-pulse" aria-hidden="true" />
          ) : user ? (
            <button
              type="button"
              onClick={onSignOut}
              title={`Signed in as ${user.email || user.displayName || 'Learner'}`}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <UserIcon className="w-3.5 h-3.5 text-sky-600 shrink-0" />
              <span className="max-w-[120px] truncate">
                {user.displayName?.split(' ')[0] || 'Account'}
              </span>
              <LogOut className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2"
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Mobile compact secondary nav row */}
      <div className="sm:hidden border-t border-slate-200/80 px-4 py-2 flex items-center justify-around text-xs font-medium">
        <button
          type="button"
          onClick={() => onNavigate('workspace')}
          className={`px-3 py-1 whitespace-nowrap shrink-0 ${
            activeView === 'workspace' ? 'text-sky-700 font-semibold' : 'text-slate-600'
          }`}
        >
          Workspace
        </button>
        <button
          type="button"
          onClick={() => onNavigate('library')}
          className={`px-3 py-1 whitespace-nowrap shrink-0 ${
            activeView === 'library' ? 'text-sky-700 font-semibold' : 'text-slate-600'
          }`}
        >
          Library{user && libraryCount > 0 ? ` (${libraryCount})` : ''}
        </button>
        <button
          type="button"
          onClick={() => onNavigate('guide')}
          className={`px-3 py-1 whitespace-nowrap shrink-0 ${
            activeView === 'guide' ? 'text-sky-700 font-semibold' : 'text-slate-600'
          }`}
        >
          Guide
        </button>
      </div>
    </header>
  );
}
