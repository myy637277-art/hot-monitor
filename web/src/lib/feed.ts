import type {
  CollectProgress,
  DigestResponse,
  DigestSendResponse,
  DigestSettings,
  DiscoverResponse,
  SourcesResponse,
  SourceStatus,
  StoriesResponse,
  TrustedResponse,
  WatchesResponse,
} from '@hot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function useSources() {
  const client = useQueryClient();
  const wasRunning = useRef(false);
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => getJson<SourcesResponse>('/api/v1/sources'),
    refetchInterval: (query) => (query.state.data?.running || query.state.data?.ai.scoring ? 2000 : false),
  });

  useEffect(() => {
    const busy = Boolean(sources.data?.running || sources.data?.ai.scoring);
    if (wasRunning.current && !busy) {
      void client.invalidateQueries({ queryKey: ['stories'] });
      void client.invalidateQueries({ queryKey: ['watches'] });
      void client.invalidateQueries({ queryKey: ['discover'] });
    }
    wasRunning.current = busy;
  }, [sources.data?.running, sources.data?.ai.scoring, client]);

  return sources;
}

export function useStories() {
  const sources = useSources();
  return useQuery({
    queryKey: ['stories'],
    queryFn: () => getJson<StoriesResponse>('/api/v1/stories?limit=100'),
    refetchInterval: sources.data?.running || sources.data?.ai.scoring ? 2000 : false,
  });
}

export function useCollect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/collect', { method: 'POST' });
      if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['sources'] });
      await client.invalidateQueries({ queryKey: ['stories'] });
    },
  });
}

export function useWatches() {
  const sources = useSources();
  return useQuery({
    queryKey: ['watches'],
    queryFn: () => getJson<WatchesResponse>('/api/v1/watches'),
    refetchInterval: sources.data?.running || sources.data?.ai.scoring ? 2000 : false,
  });
}

async function watchRequest(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (body?.error === 'duplicate') throw new Error('这个关键词已经在列表里');
  throw new Error('没有保存成功');
}

export function useAddWatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (keyword: string) =>
      watchRequest('/api/v1/watches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyword }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['watches'] }),
  });
}

export function usePauseWatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; paused: boolean }) =>
      watchRequest(`/api/v1/watches/${input.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused: input.paused }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['watches'] }),
  });
}

export function useDeleteWatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => watchRequest(`/api/v1/watches/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['watches'] }),
  });
}

export function useDiscover() {
  const sources = useSources();
  return useQuery({
    queryKey: ['discover'],
    queryFn: () => getJson<DiscoverResponse>('/api/v1/discover'),
    refetchInterval: sources.data?.running || sources.data?.ai.scoring ? 2000 : false,
  });
}

async function interestRequest(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (body?.error === 'duplicate') throw new Error('这个方向名称已经有了');
  if (body?.error === 'limit') throw new Error('最多 20 个方向');
  throw new Error('没有保存成功');
}

function interestBody(input: { label: string; terms: string[] }) {
  return JSON.stringify({ label: input.label, terms: input.terms });
}

export function useAddInterest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { label: string; terms: string[] }) =>
      interestRequest('/api/v1/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: interestBody(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['discover'] }),
  });
}

export function useUpdateInterest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; label: string; terms: string[] }) =>
      interestRequest(`/api/v1/discover/${input.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: interestBody(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['discover'] }),
  });
}

export function useDeleteInterest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => interestRequest(`/api/v1/discover/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['discover'] }),
  });
}

export function useDigest() {
  return useQuery({
    queryKey: ['digest'],
    queryFn: () => getJson<DigestResponse>('/api/v1/digest'),
  });
}

export function useSaveDigest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: Pick<DigestSettings, 'enabled' | 'hour' | 'minute' | 'includeHome' | 'includeKeywords'>) => {
      const res = await fetch('/api/v1/digest', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('没有保存成功');
      return (await res.json()) as DigestResponse;
    },
    onSuccess: (data) => client.setQueryData(['digest'], data),
  });
}

export function useSendDigest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/digest/send', { method: 'POST' });
      if (!res.ok) throw new Error('没有发送成功');
      return (await res.json()) as DigestSendResponse;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['digest'] });
    },
  });
}

export function useSetSourceEnabled() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; enabled: boolean }) => {
      const res = await fetch(`/api/v1/sources/${encodeURIComponent(input.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: input.enabled }),
      });
      if (!res.ok) throw new Error('没有保存成功');
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

export function useTrusted() {
  return useQuery({
    queryKey: ['trusted'],
    queryFn: () => getJson<TrustedResponse>('/api/v1/trusted'),
  });
}

export function useAddTrusted() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: 'domain' | 'handle'; value: string }) => {
      const res = await fetch('/api/v1/trusted', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (res.ok) return;
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === 'duplicate') throw new Error('这个来源已经在名单里');
      if (body?.error === 'bad_value') throw new Error(input.kind === 'handle' ? '账号格式不对' : '域名格式不对');
      throw new Error('没有保存成功');
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['trusted'] });
    },
  });
}

export function useDeleteTrusted() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/trusted/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('没有删除成功');
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['trusted'] });
    },
  });
}

export function collectStatus(running: boolean, progress?: CollectProgress): string | null {
  if (!running) return null;
  return `${progress?.sourceName || '准备来源'} · 已到 ${progress?.items ?? 0} 条`;
}

export function usageLabel(source: SourceStatus): string {
  const cap = source.usage.cap == null ? '' : ` / 上限 ${source.usage.cap}`;
  return `今日 ${source.usage.requests} 次${cap} · ${source.usage.items} 条`;
}
