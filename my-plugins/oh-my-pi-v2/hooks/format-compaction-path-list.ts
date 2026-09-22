interface PathNode {
	segment: string;
	children: Map<string, PathNode>;
	terminals: number;
	forms: string[];
}

function pathSegments(path: string): string[] | undefined {
	const absolute = path.startsWith("/");
	const segments = (absolute ? path.slice(1) : path).split("/");
	if (
		segments.some(
			(segment) => !segment || /[^A-Za-z0-9._@%+=~-]/.test(segment) || segment === "." || segment === "..",
		)
	)
		return undefined;
	if (absolute) segments[0] = `/${segments[0]}`;
	return segments;
}

export function formatCompactionPathList(paths: readonly string[]): string {
	const baseline = paths.join("\n");
	try {
		if (paths.length < 2) return baseline;
		const roots = new Map<string, PathNode>();
		const nodes: PathNode[] = [];
		const output: (string | PathNode)[] = [];

		for (const path of paths) {
			const segments = pathSegments(path);
			if (!segments) {
				output.push(path);
				continue;
			}
			let children = roots;
			for (let index = 0; index < segments.length; index++) {
				const segment = segments[index];
				let node = children.get(segment);
				if (!node) {
					node = { segment, children: new Map(), terminals: 0, forms: [] };
					children.set(segment, node);
					nodes.push(node);
					if (index === 0) output.push(node);
				}
				if (index === segments.length - 1) node.terminals++;
				children = node.children;
			}
		}

		for (let index = nodes.length - 1; index >= 0; index--) {
			const node = nodes[index];
			const children = [...node.children.values()].flatMap((child) => child.forms);
			node.forms = Array<string>(node.terminals).fill(node.segment);
			if (children.length > 0) {
				const suffix = children.length === 1 ? children[0] : `{${children.join(",")}}`;
				node.forms.push(`${node.segment}/${suffix}`);
			}
		}

		const compacted = output.flatMap((item) => (typeof item === "string" ? [item] : item.forms)).join("\n");
		return compacted.length < baseline.length ? compacted : baseline;
	} catch {
		return baseline;
	}
}
