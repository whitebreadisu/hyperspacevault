import { authedFetch } from "./authedFetch";
import { ApiError } from "./errors";

export interface CardSet {
  id: number;
  code: string;
  name: string;
  is_base_set: boolean;
  release_date: string | null;
}

export async function getSets(): Promise<CardSet[]> {
  const res = await authedFetch("/api/sets");
  // BL-154: migrated from a bare `throw new Error`.
  if (!res.ok) throw new ApiError(`Failed to fetch sets: ${res.status}`, res.status);
  return res.json();
}
