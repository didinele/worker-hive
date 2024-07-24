import type { Picker } from './Picker.js';

export class RoundRobinPicker implements Picker {
	#amount: number = 0;

	#current: number;

	public constructor() {
		this.#current = 0;
	}

	public pick(): number {
		const picked = this.#current;
		this.#current = (this.#current + 1) % this.#amount;
		return picked;
	}

	public setAmount(amount: number): void {
		this.#amount = amount;
		this.#current = 0;
	}
}
