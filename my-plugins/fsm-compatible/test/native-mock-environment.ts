export function nativeMockEnvironment(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (/(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS|AWS_PROFILE|AWS_CONFIG_FILE)/i.test(key)) env[key] = "";
	}
	return { ...env, OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
		OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", AWS_EC2_METADATA_DISABLED: "true",
		HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "", ...extra };
}
