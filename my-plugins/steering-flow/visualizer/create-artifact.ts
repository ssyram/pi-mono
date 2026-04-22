import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile as fsReadFile } from "node:fs/promises";
import { getSessionDir } from "../storage.js";
import { buildFileVisualizerDocument, buildSessionVisualizerDocument } from "./document.js";
import { renderVisualizerHtml } from "./render-html.js";
import type { VisualizerArtifactOptions, VisualizerArtifactResult } from "./types.js";

const DEFAULT_ARTIFACT_NAME = "steering-flow-visualizer.html";

function resolveOutputPath(cwd: string, outputFile?: string): string {
	if (!outputFile || outputFile.trim().length === 0) {
		return resolve(cwd, ".pi", DEFAULT_ARTIFACT_NAME);
	}
	return isAbsolute(outputFile) ? outputFile : resolve(cwd, outputFile);
}

export async function createVisualizerArtifact(options: VisualizerArtifactOptions): Promise<VisualizerArtifactResult> {
	const outputPath = resolveOutputPath(options.cwd, options.outputFile);
	let mode: "session" | "file" = "session";
	let sourceLabel: string;
	let fsmCount: number;
	let html: string;

	if (options.flowFile) {
		const absFlow = isAbsolute(options.flowFile) ? options.flowFile : resolve(options.cwd, options.flowFile);
		const content = await fsReadFile(absFlow, "utf8");
		const doc = buildFileVisualizerDocument(content, absFlow);
		html = renderVisualizerHtml(doc);
		mode = "file";
		sourceLabel = absFlow;
		fsmCount = doc.fsms.length;
	} else {
		const sessionDir = getSessionDir(options.cwd, options.sessionId);
		const doc = await buildSessionVisualizerDocument(sessionDir, options.sessionId);
		html = renderVisualizerHtml(doc);
		sourceLabel = doc.sourceLabel;
		fsmCount = doc.fsms.length;
	}

	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, html, "utf8");
	return { mode, outputPath, sourceLabel, fsmCount };
}

export function visualizerModuleDir(): string {
	return dirname(fileURLToPath(import.meta.url));
}
