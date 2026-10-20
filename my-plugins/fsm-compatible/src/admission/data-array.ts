export function isDataArray(value: unknown): value is unknown[] {
	if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) return false;
	}
	return true;
}
