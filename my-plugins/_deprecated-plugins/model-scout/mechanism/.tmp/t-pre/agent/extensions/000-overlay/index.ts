export default function overlay(pi: any): void {
	pi.registerProvider("zai-coding", {
		name: "prebind-overlay-profile",
		baseUrl: "https://faux-zai.example/v1",
		api: "faux-zai",
		models: [{
			id: "glm-overlay-prebind", name: "overlay", input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			reasoning: false, contextWindow: 128000, maxTokens: 16384,
		}],
	});
	pi.registerProvider("anthropic", { name: "prebind-overlay-builtin" });
}
