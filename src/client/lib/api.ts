import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BoardData,
  GroupDetail,
  JoinInfo,
  MeResponse,
  PlayerStatus,
  SessionDetail,
} from "../../shared/types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError((data.error as string) ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

export const Api = {
  me: () => req<MeResponse>("/me"),
  createGroup: (name: string) => req<{ id: string }>("/groups", post({ name })),
  group: (id: string) => req<GroupDetail>(`/groups/${id}`),
  setMemberRole: (groupId: string, userId: string, role: string) =>
    req(`/groups/${groupId}/members/${userId}`, patch({ role })),
  removeMember: (groupId: string, userId: string) =>
    req(`/groups/${groupId}/members/${userId}`, { method: "DELETE" }),

  createSession: (
    groupId: string | null,
    body: {
      name: string;
      venue?: string | null;
      startsAt?: number | null;
      durationMin?: number | null;
      courts: number;
      courtLabels?: string[];
      maxPlayers: number;
      pointsPerMatch: number;
      format: string;
      copyPlayersFrom?: string | null;
      mixedPairs?: boolean;
      groupByLevel?: boolean;
      fixedTeams?: boolean;
    },
  ) => req<{ id: string }>(groupId ? `/groups/${groupId}/sessions` : "/sessions", post(body)),
  session: (id: string) => req<SessionDetail>(`/sessions/${id}`),
  updateSession: (id: string, body: Record<string, unknown>) => req(`/sessions/${id}`, patch(body)),
  deleteSession: (id: string) => req(`/sessions/${id}`, { method: "DELETE" }),
  sessionAction: (id: string, action: string) => req(`/sessions/${id}/status`, post({ action })),

  addGuest: (id: string, guestName: string) => req(`/sessions/${id}/players`, post({ guestName })),
  playerAction: (id: string, playerId: string, action: string, extra: Record<string, unknown> = {}) =>
    req(`/sessions/${id}/players/${playerId}`, patch({ action, ...extra })),
  selfCheckin: (id: string) => req(`/sessions/${id}/checkin`, post({})),
  setMyGender: (id: string, gender: "woman" | "man" | null) => req(`/sessions/${id}/gender`, post({ gender })),
  leave: (id: string) => req(`/sessions/${id}/leave`, post({})),

  nextRound: (id: string, opts: { force?: boolean; regenerate?: boolean } = {}) =>
    req<{ roundNumber?: number }>(`/sessions/${id}/rounds`, post(opts)),
  undoRound: (id: string, roundId: string) =>
    req(`/sessions/${id}/rounds/${roundId}`, { method: "DELETE" }),

  score: (matchId: string, scoreA: number, scoreB: number) =>
    req<{ status: string }>(`/matches/${matchId}/score`, post({ scoreA, scoreB })),
  confirmScore: (matchId: string) => req(`/matches/${matchId}/confirm`, post({})),
  disputeScore: (matchId: string) => req(`/matches/${matchId}/dispute`, post({})),

  joinInfo: (code: string) => req<JoinInfo>(`/join/${code}`),
  join: (code: string, opts: { here?: boolean; gender?: "woman" | "man" | null } = {}) =>
    req<{ status: PlayerStatus }>(`/join/${code}`, post(opts)),
  board: (code: string) => req<BoardData>(`/board/${code}`),
};

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let live = true;
    fnRef
      .current()
      .then((d) => {
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Poll while the tab is visible — court-side "real-time" without websockets. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[], enabled = true): Loaded<T> {
  const loaded = useLoad(fn, deps);
  const { reload } = loaded;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, ms);
    return () => clearInterval(id);
  }, [ms, reload, enabled]);
  return loaded;
}
