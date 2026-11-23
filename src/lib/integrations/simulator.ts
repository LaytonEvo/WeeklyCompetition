/**
 * Provider-agnostic boundary for automated shot-data ingestion (e.g. TrackMan,
 * Foresight/FSX, Uneekor, GSPro). NO simulator integration is implemented or
 * connected: in this release staff record every shot manually in the live
 * console, which is the supported workflow.
 *
 * A future provider must:
 *  1. Implement `SimulatorProvider` against the vendor's DOCUMENTED API, with
 *     credentials verified in a test environment first.
 *  2. Map each vendor shot to `IngestedShot` with a stable `simulatorShotId`
 *     (the shots table enforces uniqueness on active shots, so re-delivered
 *     vendor events cannot create duplicates).
 *  3. Feed shots through `recordShot()` in src/server/rounds.ts so all
 *     validation, audit logging and hole-in-one rules still apply. Staff
 *     verification on round completion remains mandatory.
 */
export interface IngestedShot {
  simulatorShotId: string;
  /** Distance to the hole in millimetres as reported by the simulator. */
  distanceMm: number | null;
  onGreen: boolean;
  holed: boolean;
  capturedAt: Date;
  /** Optional screenshot/evidence bytes from the vendor. */
  evidence?: { contentType: string; data: Buffer };
}

export interface SimulatorProvider {
  id: string;
  displayName: string;
  /** Pull shots taken on a bay since a point in time. */
  fetchShots(bayExternalId: string, since: Date): Promise<IngestedShot[]>;
  /** Verify credentials/connectivity. Must be called and pass before enabling. */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

/** Registered providers. Intentionally empty: nothing is connected. */
export const SIMULATOR_PROVIDERS: Record<string, SimulatorProvider> = {};

export function isSimulatorIntegrationConnected(): boolean {
  return Object.keys(SIMULATOR_PROVIDERS).length > 0;
}
