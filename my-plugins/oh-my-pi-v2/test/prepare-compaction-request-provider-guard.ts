export let providerCallCount = 0;

export function completeSimple(): never {
	providerCallCount++;
	throw new Error("Provider calls are forbidden in compact request tests");
}
