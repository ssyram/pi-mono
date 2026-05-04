import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSessionDir } from "../storage.js";
import { buildFileVisualizerDocument, buildSessionVisualizerDocument } from "./document.js";
import { renderVisualizerHtml } from "./render-html.js";
import type { VisualizerArtifactOptions, VisualizerArtifactResult } from "./types.js";

const DEFAULT_ARTIFACT_NAME = "steering-flow-visualizer.html";

function isPathInside(root: string, target: string): boolean {
	const rel = relative(resolve(root), resolve(target));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function assertExistingFileInsideCwd(cwd: string, filePath: string, label: string): Promise<string> {
	const resolved = resolve(cwd, filePath);
	const [realCwd, realFile] = await Promise.all([
		realpath(cwd),
		realpath(resolved),
	]);
	if (!isPathInside(realCwd, realFile)) throw new Error(`${label} must be within cwd.`);
	const stat = await lstat(realFile);
	if (!stat.isFile()) throw new Error(`${label} must be a regular file.`);
	return realFile;
}

async function resolveOutputPath(cwd: string, outputFile?: string): Promise<string> {
	const requested = !outputFile || outputFile.trim().length === 0
		? resolve(cwd, ".pi", DEFAULT_ARTIFACT_NAME)
		: resolve(cwd, outputFile);
	if (extname(requested).toLowerCase() !== ".html") throw new Error("Output path must end with .html.");
	const realCwd = await realpath(cwd);
	const outputDir = dirname(requested);
	const realDir = await realpath(outputDir).catch(() => undefined);
	if (realDir && !isPathInside(realCwd, realDir) && resolve(realCwd) !== resolve(realDir)) {
		throw new Error("Output directory must be within cwd.");
	}
	if (!realDir && !isPathInside(realCwd, outputDir) && resolve(realCwd) !== resolve(outputDir)) {
		throw new Error("Output directory must be within cwd.");
	}
	try {
		await lstat(requested);
		throw new Error("Output path already exists; choose a new file.");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return requested;
		throw error;
	}
}

export async function createVisualizerArtifact(options: VisualizerArtifactOptions): Promise<VisualizerArtifactResult> {
	const outputPath = await resolveOutputPath(options.cwd, options.outputFile);
	let mode: "session" | "file" = "session";
	let sourceLabel: string;
	let fsmCount: number;
	let html: string;
	let warnings: string[] = [];

	if (options.flowFile) {
		const absFlow = await assertExistingFileInsideCwd(options.cwd, options.flowFile, "Flow file path");
		const content = await readFile(absFlow, "utf8");
		const { document, warnings: w } = buildFileVisualizerDocument(content, absFlow);
		warnings = w;
		html = renderVisualizerHtml(document);
		mode = "file";
		sourceLabel = relative(resolve(options.cwd), absFlow) || ".";
		fsmCount = document.fsms.length;
	} else {
		const sessionDir = getSessionDir(options.cwd, options.sessionId);
		const { document, warnings: w } = await buildSessionVisualizerDocument(sessionDir, options.sessionId);
		warnings = w;
		html = renderVisualizerHtml(document);
		sourceLabel = document.sourceLabel;
		fsmCount = document.fsms.length;
	}

	await mkdir(dirname(outputPath), { recursive: true });
	const file = await open(outputPath, "wx");
	try {
		await file.writeFile(html, "utf8");
	} finally {
		await file.close();
	}
	return { mode, outputPath, sourceLabel, fsmCount, warnings };
}

export function visualizerModuleDir(): string {
	return dirname(fileURLToPath(import.meta.url));
}
