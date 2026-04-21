/**
 * Registers optional async handlers for MIP-003 routes. Use `set*` methods or the
 * chainable `startJob` / `status` / `availability` methods; getters return the
 * active handler for the HTTP layer.
 */

/** Runs when `POST /start_job` is accepted; return value is stored as the job result. */
export type StartJobHandler = (
  identifierFromPurchaser: string,
  inputData: Record<string, unknown>,
) => Promise<unknown>;

/** Optional override for `GET /status`; replaces the default in-memory implementation. */
export type StatusHandler = (
  jobId: string,
) => Promise<Record<string, unknown>>;

/** Optional override for `GET /availability`; replaces the default JSON body. */
export type AvailabilityHandler = () => Promise<Record<string, unknown>>;

export class AgentEndpointHandler {
  private _startJobHandler: StartJobHandler | undefined;
  private _statusHandler: StatusHandler | undefined;
  private _availabilityHandler: AvailabilityHandler | undefined;

  /** Registers `start_job` handler and returns it (chainable). */
  startJob(func: StartJobHandler): StartJobHandler {
    this._startJobHandler = func;
    return func;
  }

  /** Registers `status` handler and returns it (chainable). */
  status(func: StatusHandler): StatusHandler {
    this._statusHandler = func;
    return func;
  }

  /** Registers `availability` handler and returns it (chainable). */
  availability(func: AvailabilityHandler): AvailabilityHandler {
    this._availabilityHandler = func;
    return func;
  }

  setStartJobHandler(handler: StartJobHandler): void {
    this._startJobHandler = handler;
  }

  setStatusHandler(handler: StatusHandler): void {
    this._statusHandler = handler;
  }

  setAvailabilityHandler(handler: AvailabilityHandler): void {
    this._availabilityHandler = handler;
  }

  getStartJobHandler(): StartJobHandler | undefined {
    return this._startJobHandler;
  }

  getStatusHandler(): StatusHandler | undefined {
    return this._statusHandler;
  }

  getAvailabilityHandler(): AvailabilityHandler | undefined {
    return this._availabilityHandler;
  }
}
