import type { ReactNode } from 'react';

export type AgentId = 'lynx' | 'echo' | 'blaze';
export type Expression = 'default' | 'focus' | 'smug' | 'down';

export interface AgentProfile {
  id: AgentId;
  name: string;
  codename: string;
  role: string;
  feature: string;
  accent: string;
}

export const agents: Record<AgentId, AgentProfile> = {
  lynx: { id: 'lynx', name: '灵眸', codename: 'LYNX', role: '侦察员', feature: '关键词监控', accent: '#17e5c9' },
  echo: { id: 'echo', name: '回声', codename: 'ECHO', role: '情报员', feature: '定时日报', accent: '#f5b83d' },
  blaze: { id: 'blaze', name: '烈锋', codename: 'BLAZE', role: '先锋', feature: '兴趣发现', accent: '#ff4655' },
};

export const expressionLabels: Record<Expression, string> = {
  default: '默认',
  focus: '专注',
  smug: '得意',
  down: '宕机',
};

const LINE = '#1a1410';

const looks: Record<AgentId, { skin: string; blush: string; jacket: string; jacketShade: string }> = {
  lynx: { skin: '#f6d3be', blush: '#ff8d86', jacket: '#1c3144', jacketShade: '#2a455c' },
  echo: { skin: '#f0c4a0', blush: '#ff8d86', jacket: '#3a3428', jacketShade: '#4e4636' },
  blaze: { skin: '#e7b08a', blush: '#ff8d86', jacket: '#3a2228', jacketShade: '#542e36' },
};

function Eye({ cx, cy, mode }: { cx: number; cy: number; mode: 'open' | 'narrow' | 'wink' | 'cross' }) {
  if (mode === 'wink') {
    return <path d={`M${cx - 9} ${cy + 1} Q${cx} ${cy - 7} ${cx + 9} ${cy + 1}`} stroke={LINE} strokeWidth={3.4} fill="none" strokeLinecap="round" />;
  }
  if (mode === 'cross') {
    return (
      <path
        d={`M${cx - 7} ${cy - 8} L${cx + 7} ${cy + 8} M${cx + 7} ${cy - 8} L${cx - 7} ${cy + 8}`}
        stroke={LINE}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
    );
  }
  const h = mode === 'narrow' ? 12 : 22;
  const w = 10;
  return (
    <g>
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={w / 2} fill={LINE} />
      {mode === 'open' && <circle cx={cx + 1.4} cy={cy - h / 5} r={1.7} fill="#fff" />}
    </g>
  );
}

function Eyes({ expression }: { expression: Expression }) {
  const left = expression === 'smug' ? 'wink' : expression === 'down' ? 'cross' : expression === 'focus' ? 'narrow' : 'open';
  const right = expression === 'down' ? 'cross' : expression === 'focus' ? 'narrow' : 'open';
  const brow = expression === 'focus' ? 4 : expression === 'smug' ? -2 : expression === 'down' ? -3 : 0;
  return (
    <g>
      <path d={`M64 ${78 + brow} L86 ${82 + brow}`} stroke={LINE} strokeWidth={3} strokeLinecap="round" fill="none" />
      <path d={`M136 ${78 - brow} L114 ${82 + (expression === 'smug' ? 3 : brow)}`} stroke={LINE} strokeWidth={3} strokeLinecap="round" fill="none" />
      <Eye cx={76} cy={96} mode={left} />
      <Eye cx={124} cy={96} mode={right} />
    </g>
  );
}

function Mouth({ expression }: { expression: Expression }) {
  const stroke = { stroke: LINE, strokeWidth: 3, strokeLinecap: 'round' as const, fill: 'none' };
  switch (expression) {
    case 'default':
      return <path d="M90 122 Q100 130 110 122" {...stroke} />;
    case 'focus':
      return <path d="M92 124 H108" {...stroke} />;
    case 'smug':
      return <path d="M86 120 Q102 132 116 118" {...stroke} />;
    case 'down':
      return <path d="M88 130 Q100 122 112 130" {...stroke} />;
  }
}

function LynxHair() {
  return (
    <g>
      <polygon points="28,118 18,72 52,48 46,96" fill="#c5d2dc" />
      <polygon points="46,96 36,52 78,28 70,78" fill="#e7eef3" />
      <polygon points="70,78 62,22 108,14 96,70" fill="#f7fbfd" />
      <polygon points="96,70 100,16 142,30 124,74" fill="#d5e0e8" />
      <polygon points="124,74 138,36 176,62 158,108" fill="#eef3f7" />
      <polygon points="150,112 168,70 188,96 176,128" fill="#b7c6d1" />
      <path d="M34 108 C28 78 58 58 78 64 C70 88 52 102 34 108Z" fill="#f4f8fb" />
      <path d="M166 104 C178 74 150 52 132 66 C146 86 158 96 166 104Z" fill="#f7fbfd" />
    </g>
  );
}

function EchoHair() {
  return (
    <g>
      <polygon points="36,132 22,78 58,46 52,110" fill="#2a1e1a" />
      <polygon points="52,110 44,48 92,28 78,96" fill="#4a342c" />
      <polygon points="78,96 86,24 128,26 112,92" fill="#3b2a24" />
      <polygon points="112,92 122,30 168,52 150,108" fill="#5c4036" />
      <polygon points="150,108 164,58 184,88 170,136" fill="#2a1e1a" />
      <path d="M48 108 C42 86 62 74 74 80 C66 98 56 108 48 108Z" fill="#6a4b3e" />
      <path d="M152 106 C164 84 146 70 132 80 C142 96 150 104 152 106Z" fill="#6a4b3e" />
    </g>
  );
}

function BlazeHair() {
  return (
    <g>
      <polygon points="34,120 24,74 58,58 50,108" fill="#2a181c" />
      <polygon points="48,100 40,46 72,18 66,78" fill="#3d242a" />
      <polygon points="66,78 74,8 108,22 92,72" fill="#241418" />
      <polygon points="92,72 112,6 140,28 122,74" fill="#4a2c32" />
      <polygon points="122,78 146,24 176,58 156,104" fill="#2a181c" />
      <polygon points="156,108 172,64 190,92 174,128" fill="#3d242a" />
      <polygon points="96,34 112,2 124,36" fill="#ff4655" />
    </g>
  );
}

function FrontLocks({ id }: { id: AgentId }) {
  if (id === 'lynx') {
    return (
      <g>
        <polygon points="58,78 72,58 86,80" fill="#f7fbfd" />
        <polygon points="84,80 100,52 116,80" fill="#e7eef3" />
        <polygon points="114,78 130,56 146,82" fill="#f4f8fb" />
      </g>
    );
  }
  if (id === 'echo') {
    return (
      <g>
        <polygon points="54,86 70,58 88,88" fill="#3b2a24" />
        <polygon points="86,88 100,54 118,88" fill="#2a1e1a" />
        <polygon points="116,86 132,60 148,88" fill="#4a342c" />
      </g>
    );
  }
  return (
    <g>
      <polygon points="56,84 74,58 90,86" fill="#3d242a" />
      <polygon points="112,86 130,56 148,84" fill="#2a181c" />
    </g>
  );
}

function Gear({ id, accent }: { id: AgentId; accent: string }): ReactNode {
  switch (id) {
    case 'lynx':
      return (
        <g>
          <path d="M48 78 H152" stroke={LINE} strokeWidth={5} strokeLinecap="round" />
          <rect x="52" y="66" width="38" height="18" rx="8" fill={accent} stroke={LINE} strokeWidth={3} />
          <rect x="110" y="66" width="38" height="18" rx="8" fill={accent} stroke={LINE} strokeWidth={3} />
          <path d="M60 72 H78" stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.8} />
          <path d="M118 72 H136" stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.8} />
          <path d="M36 112 C28 96 36 84 48 86" stroke="#163044" strokeWidth={8} fill="none" strokeLinecap="round" />
          <path d="M164 112 C172 96 164 84 152 86" stroke="#163044" strokeWidth={8} fill="none" strokeLinecap="round" />
        </g>
      );
    case 'echo':
      return (
        <g>
          <path d="M36 104 C36 52 164 52 164 104" stroke={LINE} strokeWidth={7} fill="none" />
          <rect x="16" y="96" width="24" height="40" rx="10" fill={accent} stroke={LINE} strokeWidth={3} />
          <rect x="160" y="96" width="24" height="40" rx="10" fill={accent} stroke={LINE} strokeWidth={3} />
          <circle cx="28" cy="116" r="4" fill="#fff3d0" />
          <circle cx="172" cy="116" r="4" fill="#fff3d0" />
          <path d="M40 132 Q28 156 52 158" stroke={LINE} strokeWidth={3} fill="none" strokeLinecap="round" />
          <circle cx="54" cy="158" r="4" fill={accent} stroke={LINE} strokeWidth={2} />
        </g>
      );
    case 'blaze':
      return (
        <g>
          <path d="M46 70 Q100 56 154 70 L154 82 Q100 70 46 82Z" fill={accent} />
          <path d="M150 72 L184 60 L172 88Z" fill={accent} />
          <path d="M62 74 H96" stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.75} />
          <path d="M46 150 L62 146 M48 158 L62 155" stroke={accent} strokeWidth={3} strokeLinecap="round" />
        </g>
      );
  }
}

function Bust({ id }: { id: AgentId }) {
  const look = looks[id];
  return (
    <g>
      <ellipse cx="100" cy="228" rx="46" ry="6" fill="#000" opacity={0.35} />
      <path d="M58 236 C58 186 72 168 100 168 C128 168 142 186 142 236 Z" fill={look.jacket} />
      <path d="M78 190 L100 214 L122 190" stroke={LINE} strokeWidth={4} fill="none" strokeLinejoin="round" />
      <path d="M64 214 L132 188" stroke={agents[id].accent} strokeWidth={5} strokeLinecap="round" />
      <path d="M86 168 H114 L108 184 H92 Z" fill={look.jacketShade} />
      {id === 'lynx' && <LynxHair />}
      {id === 'echo' && <EchoHair />}
      {id === 'blaze' && <BlazeHair />}
      <ellipse cx="100" cy="108" rx="58" ry="52" fill={look.skin} />
      <ellipse cx="62" cy="118" rx="8" ry="4.5" fill={look.blush} opacity={0.55} />
      <ellipse cx="138" cy="118" rx="8" ry="4.5" fill={look.blush} opacity={0.55} />
      <FrontLocks id={id} />
      <Gear id={id} accent={agents[id].accent} />
    </g>
  );
}

interface AgentProps {
  id: AgentId;
  expression?: Expression;
  /** Hide from assistive tech when the agent's name is already shown as text nearby. */
  decorative?: boolean;
  className?: string;
}

export function Agent({ id, expression = 'default', decorative = false, className = '' }: AgentProps) {
  const profile = agents[id];
  const label = `原创角色 ${profile.name}（${profile.role}），表情：${expressionLabels[expression]}`;

  return (
    <svg
      viewBox="0 0 200 240"
      className={`block h-auto w-full ${className}`}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      data-agent={id}
      data-expression={expression}
    >
      <Bust id={id} />
      <Eyes expression={expression} />
      <Mouth expression={expression} />
    </svg>
  );
}
