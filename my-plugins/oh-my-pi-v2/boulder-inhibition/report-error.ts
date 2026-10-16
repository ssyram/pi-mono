export function reportBoulderDiagnostic(message: string): void {
	try {
		console.error(message);
	} catch {
		// Diagnostics must not become a second exception.
	}
}
