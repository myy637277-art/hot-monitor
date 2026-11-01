import type { ReactNode } from 'react';
import type { SourceType } from '@hot/shared';

export interface StorySource {
  id: string;
  name: string;
  type: SourceType;
  url: string | null;
}

export function httpUrl(url: string | null | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url;
}

const linkClass = 'no-underline text-inherit';

export function StorySourceLink({ source, children }: { source: StorySource; children: ReactNode }) {
  const href = httpUrl(source.url);
  if (!href) return children;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

export function StoryTitleLink({ title, href }: { title: string; href: string | null }) {
  const url = httpUrl(href);
  if (!url) return title;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={linkClass}>
      {title}
    </a>
  );
}

export function rulesBadge(aiMode: string | null, reason: string | null): string | null {
  if (aiMode !== 'rules') return null;
  const text = reason ?? '';
  const labels = [
    'DeepSeek 超时',
    'DeepSeek 返回无法解析',
    'DeepSeek 鉴权失败',
    'DeepSeek 额度不足',
    'DeepSeek 限流',
    'DeepSeek 请求失败',
    '免费模型超时',
    '免费模型返回无法解析',
    '免费模型鉴权失败',
    '免费模型额度不足',
    '免费模型限流',
    '免费模型请求失败',
    'AI 今日额度已用完',
    '模型连续失败，暂仅规则判断',
  ];
  for (const label of labels) if (text.includes(label)) return label;
  const http = /(?:DeepSeek|免费模型) HTTP \d+/.exec(text);
  if (http) return http[0];
  return '仅规则判断';
}
