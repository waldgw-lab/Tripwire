import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

export function ThemeSwitcher({ collapsed = false, compact = false }: { collapsed?: boolean; compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark';
  const Icon = dark ? Moon : Sun;
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  const toggle = () => setTheme(dark ? 'light' : 'dark');
  const iconButton = (mobile: boolean) => (
    <button type="button" onClick={toggle} aria-label={label} title={label} aria-pressed={dark}
      data-testid={mobile ? 'button-theme-mobile' : 'button-theme-collapsed'}
      className={cn('h-8 w-8 items-center justify-center rounded-md border focus-visible:outline-2 focus-visible:outline-offset-2',
        mobile ? 'inline-flex border-border bg-card text-foreground hover:bg-muted' : 'mx-auto hidden border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent md:flex')}>
      <Icon className="h-4 w-4" />
    </button>
  );
  if (compact) return iconButton(true);
  return (
    <div>
      <div role="group" aria-label="Appearance" className={cn('grid grid-cols-2 gap-1 rounded-md border border-sidebar-border p-1', collapsed && 'md:hidden')}>
        {(['light', 'dark'] as const).map(value => {
          const ModeIcon = value === 'light' ? Sun : Moon;
          return <button key={value} type="button" onClick={() => setTheme(value)} aria-pressed={theme === value}
            data-testid={`button-theme-${value}`} title={`Use ${value} mode`}
            className={cn('inline-flex h-7 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium capitalize focus-visible:outline-2 focus-visible:outline-offset-2',
              theme === value ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent')}>
            <ModeIcon className="h-3.5 w-3.5" />{value}
          </button>;
        })}
      </div>
      {collapsed && iconButton(false)}
    </div>
  );
}
