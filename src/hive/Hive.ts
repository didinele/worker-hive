import { once } from 'node:events';
import { AsyncEventEmitter } from '@vladfrangu/async_event_emitter';
import { BeeManager, type BeeManagerOptions } from '../bee/BeeManager.js';
import { filteredOnce } from '../util/filteredEventOnce.js';
import type { Picker } from './picker/Picker.js';
import { RoundRobinPicker } from './picker/RoundRobinPicker.js';

export enum LifeCycleEvents {
	Error = 'error',
	WorkerError = 'workerError',
	WorkerExit = 'workerExit',
	WorkerFree = 'workerFree',
	WorkerHangingResponse = 'workerHangingResponse',
	WorkerMessageError = 'workerMessageError',
	WorkerOnline = 'workerOnline',
	WorkerSpawned = 'workerSpawned',
}

export interface LifeCycleEventsMap {
	[LifeCycleEvents.Error]: [error: Error];
	[LifeCycleEvents.WorkerSpawned]: [id: number];
	[LifeCycleEvents.WorkerOnline]: [id: number];
	[LifeCycleEvents.WorkerExit]: [id: number, code: number];
	[LifeCycleEvents.WorkerFree]: [id: number];
	[LifeCycleEvents.WorkerError]: [id: number, error: Error];
	[LifeCycleEvents.WorkerMessageError]: [id: number, error: Error];
	[LifeCycleEvents.WorkerHangingResponse]: [id: number, response: unknown];
}

export interface RequiredHiveOptions {
	beeOptions: BeeManagerOptions;
}

export interface OptionalHiveOptions {
	buildPicker(): Picker;
}

export type HiveOptions = OptionalHiveOptions & RequiredHiveOptions;

export const DefaultHiveOptions = {
	buildPicker(): Picker {
		return new RoundRobinPicker();
	},
} as const satisfies Required<OptionalHiveOptions>;

export class Hive {
	readonly #options: Required<HiveOptions>;

	readonly #picker: Picker;

	readonly #managers: BeeManager[] = [];

	public readonly lifeCycle: AsyncEventEmitter<LifeCycleEventsMap>;

	public get size(): number {
		return this.#managers.length;
	}

	public constructor(options: HiveOptions) {
		this.#options = options;
		this.#picker = this.#options.buildPicker();

		this.lifeCycle = new AsyncEventEmitter();
		this.setupLifeCycleEvents();
	}

	public async scale(amount: number): Promise<void> {
		this.#picker.setAmount(this.#managers.length);

		if (this.size > amount) {
			const diff = this.size - amount;
			const toKill = this.#managers.splice(-diff);

			const promises = await Promise.all(
				toKill.map(async (manager) => {
					// Let it finish existing work if any
					if (manager.isBusy) {
						await filteredOnce(this.lifeCycle, LifeCycleEvents.WorkerFree, (id) => id === manager.id);
					}

					await manager.terminate();
				}),
			);

			await Promise.all(promises);
			return;
		}

		if (this.size < amount) {
			const diff = amount - this.size;
			const promises: Promise<void>[] = [];

			for (let beeId = 0; beeId < diff; beeId++) {
				const manager = new BeeManager(this.lifeCycle, beeId, this.#options.beeOptions);
				this.#managers.push(manager);
				promises.push(manager.init());
			}

			await Promise.all(promises);
		}
	}

	// TODO
	public async send(payload: any): Promise<any> {
		const index = this.#picker.pick();
		const manager = this.#managers.at(index);

		if (!manager) {
			throw new Error(`No worker available at index ${index}.`);
		}

		return manager.send(0, payload);
	}

	public async restart(id: number): Promise<void> {
		const manager = this.#managers[id];
		if (!manager) {
			throw new Error(`No worker with id ${id}`);
		}

		await manager.init();
	}

	private setupLifeCycleEvents(): void {
		this.lifeCycle.on(LifeCycleEvents.WorkerError, (id, cause) => {
			const count = this.lifeCycle.listenerCount(LifeCycleEvents.WorkerError);
			if (count <= 1) {
				const error = new Error(`Unhandled WorkerError event for worker ${id}`, { cause });
				this.lifeCycle.emit(LifeCycleEvents.Error, error);
			}
		});

		this.lifeCycle.on(LifeCycleEvents.WorkerMessageError, (id, cause) => {
			const count = this.lifeCycle.listenerCount(LifeCycleEvents.WorkerMessageError);
			if (count <= 1) {
				const error = new Error(`Unhandled WorkerMessageError event for worker ${id}`, { cause });
				this.lifeCycle.emit(LifeCycleEvents.Error, error);
			}
		});
	}
}
