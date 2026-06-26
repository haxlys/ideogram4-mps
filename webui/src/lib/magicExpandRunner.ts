import { magicPrompt } from "@/api/client";
import type { MagicExpandPayload } from "@/state/types";

export type { MagicExpandPayload };

export interface MagicExpandSuccess {
  rawJson: string;
  model: string;
}

interface MagicExpandListener {
  onSuccess: (result: MagicExpandSuccess) => void;
  onError: (error: unknown) => void;
}

interface MagicExpandFlight {
  promise: Promise<MagicExpandSuccess>;
  listeners: Set<MagicExpandListener>;
  settled: MagicExpandSuccess | { error: unknown } | null;
}

const flights = new Map<number, MagicExpandFlight>();

function ensureFlight(requestId: number, payload: MagicExpandPayload): MagicExpandFlight {
  const existing = flights.get(requestId);
  if (existing) return existing;

  for (const [id, flight] of flights) {
    if (flight.settled !== null) flights.delete(id);
  }

  const promise = magicPrompt(
    payload.prompt,
    payload.width,
    payload.height,
    payload.imagesB64,
  ).then((res) => ({
    rawJson: JSON.stringify(res.caption, null, 2),
    model: res.model,
  }));

  const flight: MagicExpandFlight = { promise, listeners: new Set(), settled: null };
  flights.set(requestId, flight);

  void promise.then(
    (result) => {
      flight!.settled = result;
      for (const listener of flight!.listeners) {
        listener.onSuccess(result);
      }
    },
    (error) => {
      flight!.settled = { error };
      for (const listener of flight!.listeners) {
        listener.onError(error);
      }
    },
  );

  return flight;
}

/**
 * Attach UI handlers for an in-flight expand. StrictMode remounts re-subscribe to the
 * same requestId without starting a second API call.
 */
export function subscribeMagicExpand(
  requestId: number,
  payload: MagicExpandPayload,
  listener: MagicExpandListener,
): () => void {
  const flight = ensureFlight(requestId, payload);
  if (flight.settled !== null) {
    if ("error" in flight.settled) {
      listener.onError(flight.settled.error);
    } else {
      listener.onSuccess(flight.settled);
    }
    return () => {};
  }

  flight.listeners.add(listener);
  return () => {
    flight.listeners.delete(listener);
  };
}

export function isMagicExpandInFlight(requestId?: number): boolean {
  if (requestId != null) return flights.has(requestId);
  return flights.size > 0;
}