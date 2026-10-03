import React from 'react';
import { Info, TrendingUp, AlertCircle, Activity, type LucideIcon } from 'lucide-react';

export type KpiTheme = 'orange' | 'blue' | 'yellow' | 'red' | 'green' | 'neutral';
export type KpiCardTone = 'neutral' | 'success' | 'warning' | 'critical' | 'info' | KpiTheme;

export interface KpiCardProps {
  id?: string;
  label: string;
  value: React.ReactNode;
  detail?: string;
  trendValue?: string;
  isPositive?: boolean;
  bgColor?: string;
  borderColor?: string;
  badgeColor?: string;
  icon?: LucideIcon | React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }> | React.ReactNode;
  showInfo?: boolean;
  isLoading?: boolean;
  className?: string;
  compact?: boolean;
  theme?: KpiTheme;
  tone?: KpiCardTone;
  showTrend?: boolean;
  onClick?: () => void;
}

const THEME_PALETTES: Record<
  KpiTheme,
  {
    iconBg: string;
    iconBorder: string;
    iconText: string;
  }
> = {
  orange: {
    iconBg: 'bg-[#FFF9F2]',
    iconBorder: 'border-[#FFE7CC]',
    iconText: 'text-[#FF9500]',
  },
  blue: {
    iconBg: 'bg-[#F0F7FF]',
    iconBorder: 'border-[#D0E7FF]',
    iconText: 'text-[#007AFF]',
  },
  yellow: {
    iconBg: 'bg-[#FFF9F2]',
    iconBorder: 'border-[#FFE7CC]',
    iconText: 'text-[#FF9500]',
  },
  red: {
    iconBg: 'bg-[#FFF0F2]',
    iconBorder: 'border-[#FFD0D8]',
    iconText: 'text-[#FF2D55]',
  },
  green: {
    iconBg: 'bg-[#E8F8EE]',
    iconBorder: 'border-[#BBE8CD]',
    iconText: 'text-[#008460]',
  },
  neutral: {
    iconBg: 'bg-slate-50',
    iconBorder: 'border-slate-200',
    iconText: 'text-slate-600',
  },
};

/**
 * Reusable Bento KPI Card matching Tossana design system exactly.
 */
export function KpiCard({
  id,
  label,
  value,
  detail,
  trendValue,
  isPositive = true,
  bgColor,
  borderColor,
  icon = Activity,
  showInfo = true,
  isLoading = false,
  className = '',
  compact = false,
  theme,
  tone,
  onClick,
}: KpiCardProps) {
  // Resolve theme or tone
  let themeKey: KpiTheme = 'blue';
  if (theme) {
    themeKey = theme;
  } else if (tone) {
    if (tone === 'critical') themeKey = 'red';
    else if (tone === 'warning') themeKey = 'yellow';
    else if (tone === 'info') themeKey = 'blue';
    else if (tone === 'success') themeKey = 'green';
    else if (tone in THEME_PALETTES) themeKey = tone as KpiTheme;
  }

  const palette = THEME_PALETTES[themeKey] || THEME_PALETTES.blue;

  // Render Icon
  let iconNode: React.ReactNode = null;
  if (React.isValidElement(icon)) {
    iconNode = icon;
  } else if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null && 'render' in icon)) {
    const IconComp = icon as React.ComponentType<{ size?: number; strokeWidth?: number }>;
    iconNode = <IconComp size={18} strokeWidth={2.2} />;
  } else {
    iconNode = <Activity size={18} strokeWidth={2.2} />;
  }

  return (
    <div
      id={id}
      onClick={onClick}
      className={`group relative flex flex-col justify-between p-4 sm:p-5 rounded-[22px] border border-slate-200/80 bg-white shadow-2xs hover:shadow-xs transition-all duration-200 overflow-hidden ${
        compact ? 'h-[135px] p-3.5' : 'h-[145px] sm:h-[155px]'
      } ${bgColor || ''} ${borderColor || ''} ${className}`}
    >
      {/* Top row: Label + Info icon on Left | Circular Icon Badge on Right */}
      <div className="flex items-center justify-between w-full gap-2">
        <div className="flex items-center gap-1.5 min-w-0 pr-1">
          <span className="text-xs sm:text-[13px] font-bold text-slate-700 truncate">
            {label}
          </span>
          {showInfo && !compact && (
            <Info
              size={13}
              className="text-slate-400 hover:text-slate-600 transition-colors shrink-0"
              strokeWidth={2}
              aria-label="Information"
            />
          )}
        </div>

        {/* Circular Icon Badge matching Tossana reference */}
        <div
          className={`flex size-9 sm:size-10 items-center justify-center rounded-full border transition-all shrink-0 ${palette.iconBg} ${palette.iconBorder} ${palette.iconText}`}
        >
          {iconNode}
        </div>
      </div>

      {/* Middle: Big bold metric number */}
      <div className="my-auto py-0.5">
        <div className="text-[26px] sm:text-[30px] font-extrabold text-slate-900 leading-none">
          {isLoading ? (
            <span className="inline-block w-16 h-7 bg-slate-100 rounded-md animate-pulse" />
          ) : (
            value
          )}
        </div>
      </div>

      {/* Bottom row: Detail text on Left | Trend Pill Badge on Right */}
      <div className="flex items-center justify-between w-full gap-2 pt-1">
        <span className="text-xs font-medium text-slate-500 truncate">
          {detail}
        </span>

        {trendValue && (
          <div
            className={`h-6 rounded-full px-2.5 flex items-center gap-1 shrink-0 text-xs font-bold leading-none border-2 border-white shadow-sm ${
              isPositive
                ? 'bg-[#E8F8EE] text-[#008460]'
                : 'bg-[#FFF0F2] text-[#EF4444]'
            }`}
          >
            <span>{trendValue}</span>
            {isPositive ? (
              <TrendingUp size={12} strokeWidth={2.2} />
            ) : (
              <AlertCircle size={12} strokeWidth={2.2} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
