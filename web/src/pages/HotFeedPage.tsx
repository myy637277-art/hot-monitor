import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Agent, agents, type AgentId } from '../components/agents/Agent.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Meter } from '../components/ui/Meter.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { httpUrl, rulesBadge, StorySourceLink, StoryTitleLink } from '../components/story-link.tsx';
import { collectStatus, useCollect, useSources, useStories } from '../lib/feed.ts';
import { asFeedSort, asVerdictFilter, orderHomepage, type FeedSort, type VerdictFilter } from '../lib/feed-view.ts';
import { fmtDateTime, type HealthState } from '../lib/useHealth.ts';

function BackendStatus({
  state,
  lastCollectAt,
  lastCollectNote,
}: {
  state: HealthState;
  lastCollectAt: string | null;
  lastCollectNote: string | null;
}) {
  const connected = state.status === 'ok' || state.status === 'stale';
  const title =
    state.status === 'loading'
      ? '正在连接后端…'
      : state.status === 'ok'
        ? '后端已连接'
        : state.status === 'stale'
          ? '后端已连接（心跳超时）'
          : '后端未连接';

  return (
    <p data-testid="backend-status" className="text-sm text-muted">
      {title}
      {connected && (
        <>
          {' · 心跳 '}
          <span data-testid="heartbeat-time">{fmtDateTime(state.health.heartbeat.lastAt)}</span>
          {` · ${state.health.heartbeat.count} / ${state.health.heartbeat.intervalSec}s`}
        </>
      )}
      {connected && lastCollectAt && (
        <>
          {' · 上次采集 '}
          <span>{fmtDateTime(lastCollectAt)}</span>
          {lastCollectNote ? ` · ${lastCollectNote}` : ''}
        </>
      )}
      {state.status === 'down' && (
        <>
          {' '}
          请在另一个终端运行 <code className="font-mono text-accent-text">npm run dev:server</code>，页面会每 5 秒自动重试。
        </>
      )}
    </p>
  );
}

const HOME_PREVIEW = 15;

function countText(value: number | null): string {
  return value == null ? '—' : String(value);
}

function StatTile({ label, value, tint = false }: { label: string; value: string; tint?: boolean }) {
  return (
    <li className={tint ? 'rounded-xl border border-accent/40 bg-accent/10 px-3 py-3' : 'rounded-xl border border-line bg-panel px-3 py-3'}>
      <p className="font-mono text-2xl font-semibold text-bone">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </li>
  );
}

export function HotFeedPage() {
  const health = useOutletContext<HealthState>();
  const sources = useSources();
  const stories = useStories();
  const collect = useCollect();
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<FeedSort>('composite');
  const [verdict, setVerdict] = useState<VerdictFilter>('all');
  const collecting = collect.isPending || Boolean(sources.data?.running);
  const status = collectStatus(Boolean(sources.data?.running), sources.data?.progress);

  const list = stories.data?.stories ?? null;
  const view = list ? orderHomepage(list, sort, verdict) : null;
  const sourceList = sources.data?.sources ?? null;
  const trouble = sourceList
    ? sourceList.filter((source) => source.status === 'error' || source.status === 'paused' || source.status === 'skipped').length
    : null;

  return (
    <>
      <PageHeader
        compact
        code="01 HOT FEED"
        title="热点"
        action={
          <Button
            className="rounded-full bg-[#2f6fed] text-white hover:bg-[#4c86f6] active:bg-[#2559c7]"
            onClick={() => collect.mutate()}
            disabled={collecting}
          >
            {collecting ? `采集中 · ${sources.data?.progress?.items ?? 0} 条` : '立即采集'}
          </Button>
        }
      >
        近 7 天、有发布时间的热点。微博和 B 站不出现在这页。先显示 15 条代表故事。
      </PageHeader>

      <div className="mb-4 flex flex-col gap-3 border-b border-line pb-4">
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {(Object.keys(agents) as AgentId[]).map((id) => (
            <li key={id} className="flex items-center gap-2">
              <div className="w-10 shrink-0">
                <Agent id={id} decorative />
              </div>
              <p className="text-sm leading-tight">
                <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 align-middle" style={{ background: agents[id].accent }} />
                {agents[id].name}
                <span className="mt-0.5 block text-xs text-muted">{agents[id].feature}</span>
              </p>
            </li>
          ))}
        </ul>
        <BackendStatus
          state={health}
          lastCollectAt={sources.data?.lastCollectAt ?? null}
          lastCollectNote={sources.data?.lastCollectNote ?? null}
        />
      </div>

      <ul className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="已加载故事" value={countText(list ? list.length : null)} />
        <StatTile label="来源" value={countText(sourceList ? sourceList.length : null)} />
        <StatTile label="正常来源" value={countText(sourceList ? sourceList.filter((source) => source.status === 'ok').length : null)} />
        <StatTile label="异常来源" value={countText(trouble)} tint />
      </ul>

      {status && (
        <p aria-live="polite" className="mb-3 text-sm text-bone">
          {status}
        </p>
      )}
      {stories.isPending && <p className="text-sm text-muted">正在读取热点…</p>}
      {stories.isError && (
        <p role="alert" className="text-sm text-accent-text">
          热点加载失败。确认后端已启动后再试。
        </p>
      )}
      {list && list.length === 0 && (
        <p className="text-sm text-muted">近 7 天里没有可放上首页的故事。没有发布时间的条目、微博和 B 站都不会出现在这里。</p>
      )}
      {list && list.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <label className="text-sm">
            <span className="mb-1 block text-muted">排序</span>
            <select
              value={sort}
              onChange={(event) => setSort(asFeedSort(event.target.value))}
              className="min-h-11 border border-line bg-ink px-3 text-bone"
            >
              <option value="composite">综合</option>
              <option value="credibility">可信度</option>
              <option value="strength">来源强弱</option>
              <option value="hotness">热度</option>
              <option value="newest">最新发布</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">判定</span>
            <select
              value={verdict}
              onChange={(event) => setVerdict(asVerdictFilter(event.target.value))}
              className="min-h-11 border border-line bg-ink px-3 text-bone"
            >
              <option value="all">全部</option>
              <option value="reliable">可靠</option>
              <option value="uncertain">存疑</option>
              <option value="unverified">未核实</option>
            </select>
          </label>
        </div>
      )}
      {list && list.length > 0 && view && view.length === 0 && (
        <p className="text-sm text-muted">这个判定下没有故事。</p>
      )}
      {view && view.length > 0 && (
        <>
          <ul className="space-y-3">
              {(showAll ? view : view.slice(0, HOME_PREVIEW)).map((story) => {
                const href = story.sources.map((source) => httpUrl(source.url)).find((url) => url != null) ?? null;
                const rules = rulesBadge(story.aiMode, story.credibilityReason);
                const headline = story.eventTitle ?? story.title;
                const line = story.summaryZh ?? story.summary;
                return (
                  <li key={story.id} className="story-card">
                    <article className="story-card-body relative flex flex-col gap-3 p-4 sm:p-5">
                      <span aria-hidden="true" className="absolute top-0 left-0 h-0.5 w-8 bg-accent" />
                      <div className="flex flex-wrap gap-2">
                        {story.sources.map((source) => (
                          <StorySourceLink key={`${source.id}:${source.url ?? ''}`} source={source}>
                            <Badge tone="info">{source.name}</Badge>
                          </StorySourceLink>
                        ))}
        {story.feedBadge && <Badge tone="ok">{story.feedBadge}</Badge>}
                        {story.unverified && <Badge tone="warn">未经过模型核实</Badge>}
                        {rules && <Badge tone="info">{rules}</Badge>}
                        {story.credibility != null && story.credibility <= 30 && <Badge tone="danger">低可信</Badge>}
                      </div>
                      <h3 className="leading-snug font-semibold">
                        <StoryTitleLink title={headline} href={href} />
                      </h3>
                      {line && <p className="text-sm leading-relaxed text-muted">{line}</p>}
                      {story.hotness != null && <Meter label="热度" value={story.hotness} />}
                      {story.credibility != null && (
                        <Meter label="可信度" value={story.credibility} tone={story.credibility >= 60 ? 'ok' : 'warn'} />
                      )}
                      {story.feedReason && <p className="text-xs leading-relaxed text-muted">{story.feedReason}</p>}
                      {story.credibilityReason && <p className="text-xs leading-relaxed text-muted">{story.credibilityReason}</p>}
                      <p className="mt-auto font-mono text-xs text-muted">
                        {fmtDateTime(story.publishedAt ?? story.updatedAt)} · {story.sources.length} 个来源
                      </p>
                    </article>
                  </li>
                );
              })}
            </ul>
            {!showAll && view.length > HOME_PREVIEW && (
              <div className="mt-4">
                <Button variant="ghost" onClick={() => setShowAll(true)}>
                  更多 · {view.length - HOME_PREVIEW}
                </Button>
              </div>
            )}
        </>
      )}
    </>
  );
}
