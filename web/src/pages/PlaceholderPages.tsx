import { useState, type FormEvent } from 'react';
import { Agent } from '../components/agents/Agent.tsx';
import { httpUrl, StorySourceLink, StoryTitleLink } from '../components/story-link.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { HudCard } from '../components/ui/HudCard.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { useAddInterest, useDeleteInterest, useDigest, useDiscover, useUpdateInterest } from '../lib/feed.ts';
import { HoldList } from './WatchPage.tsx';
import { fmtDateTime } from '../lib/useHealth.ts';
import type { DigestLog, DigestReason } from '@hot/shared';

const digestLogStatus: Record<DigestReason, string> = {
  sent: '已推送到微信',
  empty: '没有内容，未发送',
  unconfigured: '未配置 Server酱，未发送',
  failed: '推送失败',
  skipped: '今天的定时日报已经发过',
};

export function DigestPage() {
  const digest = useDigest();
  const logs = digest.data?.logs ?? [];
  return (
    <>
      <PageHeader code="03 DIGEST" title="定时日报">
        推送时间和范围在设置页。这里是最近 30 次发送记录，不含正文。
      </PageHeader>
      <HudCard code="LOG" title="发送记录">
        {digest.isPending && <p className="text-sm text-muted">正在读取发送记录…</p>}
        {digest.isError && (
          <p role="alert" className="text-sm text-accent-text">
            发送记录加载失败。确认后端已启动后再试。
          </p>
        )}
        {digest.data && logs.length === 0 && <p className="text-sm text-muted">还没有发送记录。</p>}
        {logs.length > 0 && (
          <ul className="space-y-2">
            {logs.map((log) => (
              <DigestLogRow key={log.id} log={log} />
            ))}
          </ul>
        )}
      </HudCard>
    </>
  );
}

function DigestLogRow({ log }: { log: DigestLog }) {
  const http = log.reason === 'failed' && log.httpStatus != null ? ` · HTTP ${log.httpStatus}` : '';
  return (
    <li className="border border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{digestLogStatus[log.reason]}</span>
        <Badge tone="info">{log.mode === 'manual' ? '手动' : '定时'}</Badge>
        <Badge tone={log.reason === 'failed' ? 'warn' : 'info'}>{`${log.count} 条`}</Badge>
      </div>
      <p className="mt-1 font-mono text-xs text-muted">
        {fmtDateTime(log.sentAt)}
        {http}
      </p>
    </li>
  );
}

export function DiscoverPage() {
  const discover = useDiscover();
  const add = useAddInterest();
  const update = useUpdateInterest();
  const remove = useDeleteInterest();
  const [label, setLabel] = useState('');
  const [terms, setTerms] = useState<string[]>(['']);
  const [editing, setEditing] = useState<string | null>(null);
  const stories = discover.data?.stories ?? [];
  const holds = discover.data?.holds ?? [];
  const directions = discover.data?.interests ?? [];
  const cleanTerms = terms.map((term) => term.trim()).filter(Boolean).slice(0, 5);
  const busy = add.isPending || update.isPending;
  const formError = add.error ?? update.error ?? remove.error;
  const full = directions.length >= 20 && editing == null;

  const reset = () => {
    setLabel('');
    setTerms(['']);
    setEditing(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim() || cleanTerms.length === 0) return;
    const body = { label: label.trim(), terms: cleanTerms };
    if (editing) update.mutate({ id: editing, ...body }, { onSuccess: reset });
    else add.mutate(body, { onSuccess: reset });
  };

  return (
    <>
      <PageHeader code="04 DISCOVER" title="兴趣发现">
        自己添加方向。每个方向写一个名称，再写最多 5 个搜索词。对上的故事会核对相关性和来源，通过后才出现在这一页。
      </PageHeader>

      <HudCard code="DOMAINS" title="方向" className="mb-4">
        {discover.isPending && <p className="text-sm text-muted">正在读取方向…</p>}
        {discover.isError && (
          <p role="alert" className="text-sm text-accent-text">
            方向加载失败。确认后端已启动后再试。
          </p>
        )}
        {formError && (
          <p role="alert" className="mb-3 text-sm text-accent-text">
            {formError.message}
          </p>
        )}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">名称</span>
            <input
              id="interest-label"
              value={label}
              maxLength={40}
              onChange={(event) => setLabel(event.target.value)}
              className="min-h-11 w-full border border-line bg-ink px-3 text-bone"
            />
          </label>
          {terms.map((term, index) => (
            <label key={index} className="text-sm">
              <span className="mb-1 block text-muted">搜索词 {index + 1}</span>
              <input
                value={term}
                maxLength={40}
                aria-label={`搜索词 ${index + 1}`}
                onChange={(event) => setTerms(terms.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
                className="min-h-11 w-full border border-line bg-ink px-3 text-bone"
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            {terms.length < 5 && (
              <Button type="button" variant="ghost" onClick={() => setTerms([...terms, ''])}>
                再加一个词
              </Button>
            )}
            <Button type="submit" disabled={busy || full || !label.trim() || cleanTerms.length === 0}>
              {editing ? '保存' : '添加'}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={reset}>
                取消
              </Button>
            )}
          </div>
          {full && <p className="text-sm text-muted">最多 20 个方向。</p>}
        </form>
        {discover.data && directions.length === 0 && (
          <div className="mt-4 flex items-center gap-3">
            <div className="w-12 shrink-0">
              <Agent id="blaze" expression="smug" />
            </div>
            <p className="text-sm text-muted">还没有方向。写一个名称和搜索词，再到首页点「立即采集」。</p>
          </div>
        )}
        {directions.length > 0 && (
          <ul className="mt-4 space-y-2">
            {directions.map((interest) => (
              <li key={interest.id} className="flex flex-col gap-2 border border-line px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium">{interest.label}</span>
                  {interest.terms.map((term) => (
                    <Badge key={term} tone="info">
                      {term}
                    </Badge>
                  ))}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(interest.id);
                      setLabel(interest.label);
                      setTerms(interest.terms.length > 0 ? interest.terms : ['']);
                    }}
                  >
                    改名
                  </Button>
                  <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(interest.id)}>
                    删除
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </HudCard>

      {discover.data && directions.length > 0 && stories.length === 0 && holds.length === 0 && (
        <HudCard code="EMPTY" title="还没有新故事">
          <p className="text-sm text-muted">到首页点「立即采集」。近 7 天里对得上的故事会出现在这里。</p>
        </HudCard>
      )}
      {stories.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">对上的故事</h2>
          <ul className="space-y-3">
            {stories.map((story) => {
              const href = story.sources.map((source) => httpUrl(source.url)).find((url) => url != null) ?? null;
              const headline = story.eventTitle ?? story.title;
              return (
                <li key={story.id} className="story-card">
                  <div className="story-card-body relative flex flex-col gap-3 p-4 sm:p-5">
                    <span aria-hidden="true" className="absolute top-0 left-0 h-0.5 w-8 bg-accent" />
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="info">{story.interestLabel}</Badge>
                    {story.sources.map((source) => (
                      <StorySourceLink key={`${source.id}:${source.url ?? ''}`} source={source}>
                        <Badge tone="info">{source.name}</Badge>
                      </StorySourceLink>
                    ))}
                  </div>
                  <h3 className="mt-2 leading-snug font-semibold">
                    <StoryTitleLink title={headline} href={href} />
                  </h3>
                  {(story.summaryZh || story.summary) && (
                    <p className="mt-1 text-sm leading-relaxed text-muted">{story.summaryZh ?? story.summary}</p>
                  )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <HoldList holds={holds} />
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <PageHeader code="404" title="页面不存在" />
      <div className="w-14">
        <Agent id="lynx" expression="down" />
      </div>
    </>
  );
}
