#!/usr/bin/env -S node --import tsx

import { cwd, exit, stderr, stdout } from "node:process";
import { createVisualizerArtifact } from "./visualizer/index.js";

interface VisualizerCliArgs {
	flowFile: string;
	outputFile?: string;
}

const HELP = `Usage: steering-flow-visualize <FLOW_FILE.yaml|json> [-o OUTPUT.html]

Generate a static HTML visualization from a steering-flow YAML, JSON, or Markdown-front-matter flow file.

Arguments:
  FLOW_FILE          Flow config file to visualize.

Options:
  -o, --output FILE  Output HTML path. Defaults to .pi/steering-flow-visualizer.html.
  -h, --help         Show this help.
`;

function parseArgs(args: string[]): VisualizerCliArgs | "help" {
	let flowFile: string | undefined;
	let outputFile: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-h" || arg === "--help") return "help";
		if (arg === "-o" || arg === "--output") {
			const next = args[i + 1];
			if (!next) throw new Error(`${arg} requires an output path`);
			outputFile = next;
			i++;
			continue;
		}
		if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
		if (flowFile) throw new Error(`Unexpected extra argument: ${arg}`);
		flowFile = arg;
	}

	if (!flowFile) throw new Error("Missing FLOW_FILE argument");
	return { flowFile, outputFile };
}

async function main(): Promise<void> {
	const parsed = parseArgs(process.argv.slice(2));
	if (parsed === "help") {
		stdout.write(HELP);
		return;
	}

	const result = await createVisualizerArtifact({
		cwd: cwd(),
		flowFile: parsed.flowFile,
		outputFile: parsed.outputFile,
		sessionId: "cli",
	});

	stdout.write(`Generated ${result.mode} visualizer for ${result.sourceLabel}\n`);
	stdout.write(`FSMs: ${result.fsmCount}\n`);
	stdout.write(`Output: ${result.outputPath}\n`);
	for (const warning of result.warnings) stderr.write(`Warning: ${warning}\n`);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	stderr.write(`Error: ${message}\n`);
	exit(1);
});
