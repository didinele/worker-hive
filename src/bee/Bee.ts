import { isMainThread, parentPort } from 'node:worker_threads';
import { isValidMessage } from '../util/isValidMessage.js';

type HandlersObject<
	MessageKind extends number,
	PayloadMap extends Record<MessageKind, Record<string, any>>,
	ResultMap extends Record<MessageKind, any>,
> = {
	[Kind in MessageKind]: (payload: PayloadMap[Kind]) => Promise<ResultMap[Kind]>;
};

export class Bee<
	MessageKind extends number,
	PayloadMap extends Record<MessageKind, Record<string, any>>,
	ResultMap extends Record<MessageKind, any>,
> {
	readonly #handlers: HandlersObject<MessageKind, PayloadMap, ResultMap>;

	public constructor(handlers: HandlersObject<MessageKind, PayloadMap, ResultMap>) {
		if (isMainThread) {
			throw new Error('Bee cannot be instantiated in the main thread');
		}

		this.#handlers = handlers;
		this.setupListeners();
	}

	private setupListeners(): void {
		parentPort!.on('message', async (message) => {
			if (!isValidMessage(message)) {
				throw new Error('Invalid message received');
			}

			const { __kind, __nonce, ...data } = message;
			const result = await this.handleMessage(__kind, data);

			parentPort!.postMessage({ __nonce, __kind, result });
		});
	}

	private async handleMessage(kind: number, payload: any): Promise<any> {
		if (!(kind in this.#handlers)) {
			throw new Error(`No handler for message kind ${kind}`);
		}

		const handler = this.#handlers[kind as MessageKind];
		return handler(payload);
	}
}
