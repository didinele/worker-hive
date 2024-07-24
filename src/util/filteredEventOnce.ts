import { AsyncEventEmitter, type GetAsyncEventEmitterEventParameters } from '@vladfrangu/async_event_emitter';

export async function filteredOnce<Emitter extends AsyncEventEmitter<any>, EventName extends PropertyKey>(
	emitter: Emitter,
	eventName: EventName,
	filter: (...args: GetAsyncEventEmitterEventParameters<Emitter, EventName>) => boolean,
): Promise<void> {
	let passed = false;

	do {
		const args = await AsyncEventEmitter.once(emitter, eventName);
		passed = filter(...args);
	} while (!passed);
}
