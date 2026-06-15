import { StreamIngestResult } from "../../shared/streamTypes.js";
import { LegacyChatIngestPayload, normalizeLegacyChatMessage } from "./normalize.js";

export function ingestLegacyChatPayload(payload: LegacyChatIngestPayload): StreamIngestResult {
  return {
    ok: true,
    message: normalizeLegacyChatMessage(payload)
  };
}
