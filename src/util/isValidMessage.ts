export interface InternalPayloadFields {
	__kind: number;
	__nonce: number;
}

export function isValidMessage(message: any): message is InternalPayloadFields {
	if (typeof message !== 'object') {
		return false;
	}

	if (!('__nonce' in message) || typeof message.__nonce !== 'number') {
		return false;
	}

	// eslint-disable-next-line sonarjs/prefer-single-boolean-return
	if (!('__kind' in message) || typeof message.__kind !== 'number') {
		return false;
	}

	return true;
}
