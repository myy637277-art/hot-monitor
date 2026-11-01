import { useState, type FormEvent } from 'react';
import type { ClaimHold, NotifyChannel } from '@hot/shared';
import { Agent } from '../components/agents/Agent.tsx';
import { Badge, type Tone } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { HudCard } from '../components/ui/HudCard.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { useAddWatch, useDeleteWatch, usePauseWatch, useWatches } from '../lib/feed.ts';
import { fmtDateTime } from '../lib/useHealth.ts';
import { httpUrl, StoryTitleLink } from '../components/story-link.tsx';

const channelLabel: Record<NotifyChannel, { text: string; tone: Tone }> = {
  sent: { text: '已推送微信', tone: 'ok' },
  skipped: { text: '仅站内', tone: 'info' },
  failed: { text: '微信推送失败', tone: 'warn' },
};

export function WatchPage() {
  const watches = useWatches();
  const add = useAddWatch();
  const pause = usePauseWatch();
  const remove = useDeleteWatch();
  const [keyword, setKeyword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = keyword.trim();
    if (!next) return;
    add.mutate(next, { onSuccess: () => setKeyword('') });
  };

  return (
    <>
      <PageHeader code="02 WATCH" title="关键词监控">
        添加关键词。下一次采集会搜索这个词。新故事对上之后先核对相关性和来源，通过才记通知并推送到微信。同一条故事不会重复提醒。暂停后再继续，从继续的时刻重新算。
      </PageHeader>

      <HudCard code="KEYWORDS" title="关键词" className="mb-4">
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block text-muted">关键词</span>
            <input
              id="watch-keyword"
              value={keyword}
              maxLength={40}
              onChange={(event) => setKeyword(event.target.value)}
              className="min-h-11 w-full border border-line bg-ink px-3 text-bone"
            />
          </label>
          <Button type="submit" className="sm:self-end" disabled={add.isPending || !keyword.trim()}>
            添加
          </Button>
        </form>
        {add.isError && (
          <p role="alert" className="mt-3 text-sm text-accent-text">
            {add.error.message}
          </p>
        )}
        {watches.isPending && <p className="mt-3 text-sm text-muted">正在读取监控…</p>}
        {watches.isError && (
          <p role="alert" className="mt-3 text-sm text-accent-text">
            监控列表加载失败。确认后端已启动后再试。
          </p>
        )}
        {watches.data && watches.data.watches.length === 0 && (
          <div className="mt-4 flex items-center gap-3">
            <div className="w-12 shrink-0">
              <Agent id="lynx" expression="focus" />
            </div>
            <p className="text-sm text-muted">还没有关键词。添加后，到设置页点「立即采集」，新故事会在下面出现。</p>
          </div>
        )}
        {watches.data && watches.data.watches.length > 0 && (
          <ul className="mt-4 space-y-2">
            {watches.data.watches.map((watch) => (
              <li key={watch.id} className="flex flex-col gap-2 border border-line px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium">{watch.keyword}</span>
                  <Badge tone={watch.paused ? 'warn' : 'ok'}>{watch.paused ? '已暂停' : '监控中'}</Badge>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    disabled={pause.isPending}
                    onClick={() => pause.mutate({ id: watch.id, paused: !watch.paused })}
                  >
                    {watch.paused ? '继续' : '暂停'}
                  </Button>
                  <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(watch.id)}>
                    删除
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </HudCard>

      <HudCard code="HITS" title="命中">
        {watches.data?.matchNote && <p className="mb-3 text-sm text-bone">{watches.data.matchNote}</p>}
        {watches.data && watches.data.notifications.length === 0 && (
          <p className="text-sm text-muted">还没有命中。已有的热点不会补发，只有添加关键词之后新采集的故事才会提醒。</p>
        )}
        {watches.data && watches.data.notifications.length > 0 && (
          <ul className="space-y-2">
            {watches.data.notifications.map((note) => {
              const channel =
                note.channel === 'failed' && note.httpStatus != null
                  ? { text: `Server酱 HTTP ${note.httpStatus}`, tone: 'warn' as const }
                  : channelLabel[note.channel];
              return (
                <li key={note.id} className="border border-line px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      <StoryTitleLink title={note.title} href={httpUrl(note.url)} />
                    </span>
                    <Badge tone="info">{note.keyword}</Badge>
                    <Badge tone={channel.tone}>{channel.text}</Badge>
                  </div>
                  {note.body !== note.title && <p className="mt-1 text-sm text-muted">{note.body}</p>}
                  <p className="mt-1 font-mono text-xs text-muted">{fmtDateTime(note.createdAt)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </HudCard>
      <HoldList holds={watches.data?.holds ?? []} />
    </>
  );
}

export function HoldList({ holds }: { holds: ClaimHold[] }) {
  const waiting = holds.filter((hold) => hold.status === 'pending');
  const rejected = holds.filter((hold) => hold.status === 'reject');
  if (waiting.length === 0 && rejected.length === 0) return null;
  return (
    <>
      {waiting.length > 0 && (
        <HudCard code="WAIT" title="等待核对" className="mb-4">
          <ul className="space-y-2">
            {waiting.map((hold) => (
              <li key={`${hold.label}:${hold.storyId}`} className="border border-line px-3 py-2">
                <p className="font-medium">
                  <StoryTitleLink title={hold.title} href={hold.url} />
                </p>
                <p className="mt-1 text-sm text-muted">{hold.reason}</p>
              </li>
            ))}
          </ul>
        </HudCard>
      )}
      {rejected.length > 0 && (
        <HudCard code="HOLD" title="未通过">
          <ul className="space-y-2">
            {rejected.map((hold) => (
              <li key={`${hold.label}:${hold.storyId}`} className="border border-line px-3 py-2">
                <p className="font-medium">
                  <StoryTitleLink title={hold.title} href={hold.url} />
                </p>
                <p className="mt-1 text-sm text-muted">{hold.reason}</p>
              </li>
            ))}
          </ul>
        </HudCard>
      )}
    </>
  );
}
