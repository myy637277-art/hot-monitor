import { useRef, useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import type { DigestReason, DigestSettings, IntegrationName, SourceRunStatus, TrustKind } from '@hot/shared';
import { Badge, type Tone } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { HudCard } from '../components/ui/HudCard.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import {
  collectStatus,
  usageLabel,
  useAddTrusted,
  useCollect,
  useDeleteTrusted,
  useDigest,
  useSaveDigest,
  useSendDigest,
  useSetSourceEnabled,
  useSources,
  useTrusted,
} from '../lib/feed.ts';
import type { HealthState } from '../lib/useHealth.ts';

const integrationLabels: Record<IntegrationName, string> = {
  deepseek: 'DeepSeek',
  twitterapiIo: 'twitterapi.io',
  serverchan: 'Server酱',
};

const sourceTone: Record<SourceRunStatus, Tone> = {
  ok: 'ok',
  paused: 'warn',
  skipped: 'warn',
  error: 'danger',
  unconfigured: 'info',
  idle: 'info',
  disabled: 'info',
};

export function SettingsPage() {
  const health = useOutletContext<HealthState>();
  const integrations = health.status === 'ok' || health.status === 'stale' ? health.health.integrations : null;
  const sources = useSources();
  const toggleSource = useSetSourceEnabled();
  const collect = useCollect();
  const collecting = collect.isPending || Boolean(sources.data?.running);
  const status = collectStatus(Boolean(sources.data?.running), sources.data?.progress);

  return (
    <>
      <PageHeader code="05 SETTINGS" title="设置">
        各来源今天的状态和用量。可以关掉某个来源。日报和可信来源在下面。
      </PageHeader>

      <HudCard
        code="SOURCES"
        title="来源状态"
        className="mb-4"
        action={
          <Button onClick={() => collect.mutate()} disabled={collecting}>
            {collecting ? `采集中 · ${sources.data?.progress?.items ?? 0} 条` : '立即采集'}
          </Button>
        }
      >
        {status && (
          <p aria-live="polite" className="mb-3 text-sm text-bone">
            {status}
          </p>
        )}
        {sources.data?.embedding.skipped && sources.data.embedding.reason && (
          <p className="mb-3 text-sm text-muted">{sources.data.embedding.reason}</p>
        )}
        {sources.data?.ai && (
          <p className="mb-3 text-sm text-muted">
            {sources.data.ai.reason ? `${sources.data.ai.reason}。` : ''}
            AI 今日 {sources.data.ai.used} 次
            {sources.data.ai.cap != null ? ` / 上限 ${sources.data.ai.cap}` : ''}
            {sources.data.ai.modelNote ? `。${sources.data.ai.modelNote}` : ''}
          </p>
        )}
        {sources.isPending && <p className="text-sm text-muted">正在读取来源状态…</p>}
        {sources.isError && (
          <p role="alert" className="text-sm text-accent-text">
            来源状态加载失败。确认后端已启动后再试。
          </p>
        )}
        {sources.data && (
          <ul className="space-y-2">
            {sources.data.sources.map((source) => (
              <li key={source.id} className="flex flex-col gap-2 border border-line px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="font-medium">{source.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted">{source.type}</span>
                  {(source.pauseReason || source.lastError) && (
                    <span className="mt-1 block text-xs text-muted">{source.pauseReason ?? source.lastError}</span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={sourceTone[source.status]}>{source.statusText}</Badge>
                  <span className="font-mono text-xs text-muted">{usageLabel(source)}</span>
                  <Button
                    variant="ghost"
                    disabled={toggleSource.isPending}
                    onClick={() => toggleSource.mutate({ id: source.id, enabled: !source.enabled })}
                  >
                    {source.enabled ? '关闭' : '开启'}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </HudCard>

      <DigestCard serverchan={integrations?.serverchan ?? null} />
      <TrustCard />

      <HudCard code="KEYS" title="密钥配置" className="mb-4">
          <p className="mb-3 text-sm text-muted">只显示是否已在 server/.env 中设置，不会显示具体值。</p>
          {integrations && (
            <p className="mb-3 text-sm text-muted">
              {integrations.serverchan
                ? 'Server酱已设置。关键词命中和日报会推送到微信。'
                : '未配置 SERVERCHAN_SENDKEY，命中只记在站内，不推送到微信。'}
            </p>
          )}
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {(Object.keys(integrationLabels) as IntegrationName[]).map((k) => (
              <li key={k} className="flex items-center justify-between gap-2 border border-line px-3 py-2">
                <span>{integrationLabels[k]}</span>
                {integrations === null ? (
                  <Badge tone="info">未知</Badge>
                ) : integrations[k] ? (
                  <Badge tone="ok">已设置</Badge>
                ) : (
                  <Badge tone="info">未设置</Badge>
                )}
              </li>
            ))}
          </ul>
        </HudCard>
    </>
  );
}

const digestStatus: Record<DigestReason, string> = {
  sent: '已推送到微信',
  empty: '没有内容，未发送',
  unconfigured: '未配置 Server酱，未发送',
  failed: '推送失败',
  skipped: '今天的定时日报已经发过',
};

function padTime(value: number): string {
  return String(value).padStart(2, '0');
}

function DigestCard({ serverchan }: { serverchan: boolean | null }) {
  const digest = useDigest();
  return (
    <HudCard code="DIGEST" title="日报" className="mb-4">
      <p className="mb-3 text-sm text-muted">
        默认 08:00（北京时间）。打开「每天推送」后，到点先采集，采完再推一次。关键词命中要另外勾选。没有内容不会发送。
      </p>
      {serverchan === false && <p className="mb-3 text-sm text-muted">未配置 Server酱，日报只会记结果，不会推到微信。</p>}
      {digest.isPending && <p className="text-sm text-muted">正在读取日报设置…</p>}
      {digest.isError && (
        <p role="alert" className="text-sm text-accent-text">
          日报设置加载失败。确认后端已启动后再试。
        </p>
      )}
      {digest.data && <DigestForm settings={digest.data.digest} />}
    </HudCard>
  );
}

function DigestForm({ settings }: { settings: DigestSettings }) {
  const save = useSaveDigest();
  const send = useSendDigest();
  const sending = useRef(false);
  const [hour, setHour] = useState(settings.hour);
  const [minute, setMinute] = useState(settings.minute);
  const [includeHome, setIncludeHome] = useState(settings.includeHome);
  const [includeKeywords, setIncludeKeywords] = useState(settings.includeKeywords);
  const [enabled, setEnabled] = useState(settings.enabled);
  const payload = { enabled, hour, minute, includeHome, includeKeywords };
  const busy = save.isPending || send.isPending;
  const reason = send.data?.reason ?? settings.lastStatus;
  const count = send.data?.count;
  const httpStatus = send.data?.httpStatus ?? settings.lastHttpStatus;
  const statusText = reason ? digestStatus[reason] : null;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(payload);
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="text-sm" htmlFor="digest-hour">
          <span className="mb-1 block text-muted">时（北京时间）</span>
          <input
            id="digest-hour"
            type="number"
            min={0}
            max={23}
            value={hour}
            onChange={(event) => setHour(clamp(event.target.value, 23))}
            className="min-h-11 w-full border border-line bg-ink px-3 text-bone sm:w-28"
          />
        </label>
        <label className="text-sm" htmlFor="digest-minute">
          <span className="mb-1 block text-muted">分</span>
          <input
            id="digest-minute"
            type="number"
            min={0}
            max={59}
            value={minute}
            onChange={(event) => setMinute(clamp(event.target.value, 59))}
            className="min-h-11 w-full border border-line bg-ink px-3 text-bone sm:w-28"
          />
        </label>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={includeHome} onChange={(event) => setIncludeHome(event.target.checked)} />
          首页当天故事
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={includeKeywords} onChange={(event) => setIncludeKeywords(event.target.checked)} />
          关键词命中
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          每天推送
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          保存
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (sending.current) return;
            sending.current = true;
            save.mutate(payload, {
              onSuccess: () => send.mutate(undefined, { onSettled: () => { sending.current = false; } }),
              onError: () => { sending.current = false; },
            });
          }}
        >
          立即发送日报
        </Button>
      </div>
      {save.isError && (
        <p role="alert" className="text-sm text-accent-text">
          {save.error.message}
        </p>
      )}
      {send.isError && (
        <p role="alert" className="text-sm text-accent-text">
          {send.error.message}
        </p>
      )}
      <p aria-live="polite" className="text-sm text-muted">
        当前 {padTime(settings.hour)}:{padTime(settings.minute)}
        {settings.enabled ? ' · 每天推送已打开' : ' · 每天推送未打开'}
        {settings.lastSentOn ? ` · 定时已发 ${settings.lastSentOn}` : ''}
        {statusText ? ` · ${statusText}` : ''}
        {reason === 'sent' && count != null ? ` · ${count} 条` : ''}
        {reason === 'failed' && httpStatus != null ? ` · HTTP ${httpStatus}` : ''}
      </p>
    </form>
  );
}

function clamp(raw: string, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) return 0;
  return Math.min(max, Math.max(0, value));
}

function TrustCard() {
  const trusted = useTrusted();
  const add = useAddTrusted();
  const remove = useDeleteTrusted();
  const [kind, setKind] = useState<TrustKind>('handle');
  const [value, setValue] = useState('');
  const sources = trusted.data?.sources ?? [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    add.mutate({ kind, value }, { onSuccess: () => setValue('') });
  };

  return (
    <HudCard code="TRUST" title="可信来源" className="mb-4">
      <p className="mb-3 text-sm text-muted">
        名单里的域名和 X 账号更可信，也不会被当成仿冒。没点名的 X 仍要至少 10 万粉丝、浏览量至少 1000 才入库，可信度更低。
      </p>
      {trusted.isPending && <p className="text-sm text-muted">正在读取可信来源…</p>}
      {trusted.isError && (
        <p role="alert" className="mb-3 text-sm text-accent-text">
          可信来源加载失败。确认后端已启动后再试。
        </p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <label className="text-sm">
          <span className="mb-1 block text-muted">类型</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value === 'domain' ? 'domain' : 'handle')}
            className="min-h-11 border border-line bg-ink px-3 text-bone"
          >
            <option value="handle">X 账号</option>
            <option value="domain">域名</option>
          </select>
        </label>
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block text-muted">{kind === 'handle' ? '账号' : '域名'}</span>
          <input
            value={value}
            maxLength={80}
            onChange={(event) => setValue(event.target.value)}
            className="min-h-11 w-full border border-line bg-ink px-3 text-bone"
          />
        </label>
        <Button type="submit" className="sm:self-end" disabled={add.isPending || !value.trim()}>
          添加
        </Button>
      </form>
      {add.isError && (
        <p role="alert" className="mt-3 text-sm text-accent-text">
          {add.error.message}
        </p>
      )}
      {sources.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sources.map((source) => (
            <li key={source.id} className="flex flex-col gap-2 border border-line px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge tone="info">{source.kind === 'handle' ? 'X' : '域名'}</Badge>
                <span className="font-medium">{source.kind === 'handle' ? `@${source.value}` : source.value}</span>
              </span>
              <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(source.id)}>
                删除
              </Button>
            </li>
          ))}
        </ul>
      )}
    </HudCard>
  );
}
