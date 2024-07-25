import { setTimeout, clearTimeout } from 'node:timers';
import { Worker } from 'node:worker_threads';
import type { AsyncEventEmitter } from '@vladfrangu/async_event_emitter';
import { LifeCycleEvents, type LifeCycleEventsMap } from '../hive/Hive.js';
import { isValidMessage, type InternalPayloadFields } from '../util/isValidMessage.js';

export interface RequiredBeeManagerOptions {
	scriptPath: string;
}

export interface OptionalBeeManagerOptions {
	jobTimeout?: number;
	workerData?: any;
}

export type BeeManagerOptions = OptionalBeeManagerOptions & RequiredBeeManagerOptions;

export const DefaultBeeManagerOptions = {
	workerData: {},
	jobTimeout: 15_000,
} as const satisfies Required<OptionalBeeManagerOptions>;

interface PendingMessageActions {
	reject(reason: Error): void;
	resolve(value: unknown): void;
}

/**
 * Manages an individual bee (worker).
 */
export class BeeManager {
	readonly #lifeCycle: AsyncEventEmitter<LifeCycleEventsMap>;

	public readonly id: number;

	readonly #options: Required<BeeManagerOptions>;

	#worker: Worker | null = null;

	readonly #pending: Map<number, PendingMessageActions> = new Map();

	public get isBusy(): boolean {
		return this.#pending.size > 0;
	}

	public constructor(lifeCycle: AsyncEventEmitter<LifeCycleEventsMap>, id: number, options: BeeManagerOptions) {
		this.#lifeCycle = lifeCycle;
		this.id = id;
		this.#options = { ...DefaultBeeManagerOptions, ...options };
		this.#pending = new Map();
	}

	public async init(): Promise<void> {
		if (this.#worker) {
			await this.terminate();
		}

		const worker = new Worker(this.#options.scriptPath, {
			workerData: this.#options.workerData,
		});

		this.#lifeCycle.emit(LifeCycleEvents.WorkerSpawned, this.id);
		this.setupThreadEvents(worker);

		this.#worker = worker;
	}

	public async terminate(): Promise<boolean> {
		if (!this.#worker) {
			return false;
		}

		await this.#worker.terminate();
		this.destroy();

		return true;
	}

	public async send(kind: number, payload: Record<string, any>, signal?: AbortSignal): Promise<unknown> {
		if (!this.#worker) {
			throw new Error('Worker not initialized');
		}

		const nonce = Math.random();

		const data = {
			__nonce: nonce,
			__kind: kind,
			...payload,
		} satisfies InternalPayloadFields;

		this.#worker.postMessage(data);

		// eslint-disable-next-line promise/param-names
		return new Promise((pRes, pRej) => {
			const abortCallback = () => {
				// eslint-disable-next-line @typescript-eslint/no-use-before-define
				reject(new Error('Job aborted by caller'));
			};

			if (signal) {
				signal.addEventListener('abort', abortCallback);
			}

			const timeout = setTimeout(() => {
				// eslint-disable-next-line @typescript-eslint/no-use-before-define
				reject(new Error('Job timed out'));
				this.#lifeCycle.emit(LifeCycleEvents.WorkerJobTimedOut, this.id);
			}, this.#options.jobTimeout);

			const cleanup = () => {
				this.#pending.delete(nonce);
				clearTimeout(timeout);

				if (signal) {
					signal.removeEventListener('abort', abortCallback);
				}

				this.#lifeCycle.emit(LifeCycleEvents.WorkerJobCompleted, this.id);

				if (this.#pending.size === 0) {
					this.#lifeCycle.emit(LifeCycleEvents.WorkerFree, this.id);
				}
			};

			const resolve = (value: unknown): void => {
				cleanup();
				pRes(value);
			};

			const reject = (reason: Error): void => {
				cleanup();
				pRej(reason);
			};

			this.#pending.set(nonce, { resolve, reject });
		});
	}

	private setupThreadEvents(worker: Worker): void {
		worker
			.on('online', () => {
				this.#lifeCycle.emit(LifeCycleEvents.WorkerOnline, this.id);
			})
			.on('exit', (code) => {
				this.#lifeCycle.emit(LifeCycleEvents.WorkerExit, this.id, code);
				this.destroy();
			})
			.on('error', (error) => {
				this.#lifeCycle.emit(LifeCycleEvents.WorkerError, this.id, error);
				this.destroy();
			})
			.on('messageerror', (error) => {
				this.#lifeCycle.emit(LifeCycleEvents.WorkerMessageError, this.id, error);
			})
			.on('message', async (message) => this.handleMessage(message));
	}

	private async handleMessage(message: any): Promise<void> {
		if (!isValidMessage(message)) {
			this.#lifeCycle.emit(LifeCycleEvents.Error, new Error('Invalid message received from worker'));
			this.destroy();
			return;
		}

		const { __nonce: nonce, __kind, ...data } = message;
		const actions = this.#pending.get(nonce);

		if (!actions) {
			this.#lifeCycle.emit(LifeCycleEvents.WorkerHangingResponse, this.id, data);
			return;
		}

		actions.resolve(data);
	}

	private destroy(): void {
		this.#worker?.removeAllListeners();
		this.#worker = null;

		if (this.#pending.size) {
			for (const { reject } of this.#pending.values()) {
				reject(new Error('Worker terminated'));
			}
		}
	}
}
