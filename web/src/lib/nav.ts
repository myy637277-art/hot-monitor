import { Compass, Crosshair, Fire, GearSix, Newspaper, type Icon } from '@phosphor-icons/react';

export interface NavItem {
  to: string;
  label: string;
  code: string;
  icon: Icon;
}

export const navItems: NavItem[] = [
  { to: '/', label: '热点', code: '01 HOT FEED', icon: Fire },
  { to: '/watch', label: '监控', code: '02 WATCH', icon: Crosshair },
  { to: '/digest', label: '日报', code: '03 DIGEST', icon: Newspaper },
  { to: '/discover', label: '发现', code: '04 DISCOVER', icon: Compass },
  { to: '/settings', label: '设置', code: '05 SETTINGS', icon: GearSix },
];
